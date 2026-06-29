import { Browser, Page } from "puppeteer";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

export interface LeagueMatch {
  id: string;
  slug: string;
  sport_slug: string;
  match_date: string;
  result_score: string;
  has_odds: boolean;
  has_prediction: boolean;
  league_slug: string;
  unique_tournament_name: string;
  teams: Array<{
    id: string;
    slug: string;
    name: string;
    short_name: string;
    country?: { iso: string };
  }>;
  status: { code: string };
  is_live: boolean;
  is_finished: boolean;
  winner?: number;
  odds?: MatchOdds;
}

export interface MatchOdds {
  markets: string[];
  lines: Array<{
    market: string;
    rates: Array<{
      outcome: string;
      outcome_value?: string | null;
      value: number;
    }>;
  }>;
}

export interface LeagueData {
  league: {
    slug: string;
    name: string;
    sport_slug: string;
    country: {
      slug: string;
      name: string;
      iso: string;
      logo: string;
    };
  };
  matches: LeagueMatch[];
}

function isoToDdMmYyyy(isoDate: string): string {
  const [y, m, d] = isoDate.split("T")[0].split("-");
  return `${d}-${m}-${y}`;
}

export interface MatchInfo {
  is_finished: boolean;
  is_live: boolean;
}

export class Scores24Client {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private ownsBrowser: boolean;
  private token: string | null = null;
  private ip: string | null = null;
  private userCache: string | null = null;
  private tokenExpiry: number = 0; // UTC timestamp in seconds

  constructor(sharedBrowser?: Browser) {
    this.browser = sharedBrowser ?? null;
    this.ownsBrowser = !sharedBrowser;
  }

  private async initBrowser() {
    if (!this.browser) {
      console.log("[Scores24Client] Starting headless browser process...");
      this.browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
    }
    if (!this.page) {
      this.page = await this.browser.newPage();
      await this.page.setViewport({ width: 1280, height: 800 });
      await this.page.setUserAgent(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );
    }
  }

  // Crashed/navigated-away frames leave the Page object unusable forever;
  // drop it so the next ensureSession() call creates a fresh one.
  private async recoverFromPageCrash(e: unknown): Promise<boolean> {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("detached Frame") && !msg.includes("disposed")) return false;

    console.warn("[Scores24Client] Page crashed, recreating for next attempt...");
    try {
      await this.page?.close();
    } catch {
      // already gone
    }
    this.page = null;
    this.token = null;
    this.tokenExpiry = 0;
    return true;
  }

  private decodeTokenExpiry(token: string): number {
    try {
      const base64Payload = token.split(".")[0];
      const decoded = JSON.parse(Buffer.from(base64Payload, "base64").toString("utf-8"));
      return decoded.exp || 0;
    } catch {
      return 0;
    }
  }

  public async ensureSession() {
    await this.initBrowser();

    const now = Math.floor(Date.now() / 1000);
    // If we have a token that is valid for at least the next 2 minutes, reuse the active session
    if (this.token && this.tokenExpiry > now + 120) {
      return;
    }

    console.log("[Scores24Client] Session token expired or missing. Fetching new token from scores24.live...");

    // Navigate to homepage to get the latest window.__API_TOKEN__ and initialize cookies
    await this.page!.goto("https://scores24.live/en", { waitUntil: "networkidle2", timeout: 60000 });

    // Wait until the required window variables are initialized
    await this.page!.waitForFunction(() => {
      const win = window as any;
      return typeof win.__API_TOKEN__ === "string" &&
        win.__API_TOKEN__.length > 0 &&
        win.__STORE__ &&
        win.__STORE__.userSettings &&
        win.__STORE__.userSettings.ip;
    });

    const info = await this.page!.evaluate(() => {
      const win = window as any;
      return {
        token: win.__API_TOKEN__,
        ip: win.__STORE__.userSettings.ip,
        userCache: win.__STORE__.config?.config?.X_USER_CACHE || ""
      };
    });

    this.token = info.token;
    this.ip = info.ip;
    this.userCache = info.userCache;
    this.tokenExpiry = this.decodeTokenExpiry(info.token);

    console.log(`[Scores24Client] Session established. Token expires at ${new Date(this.tokenExpiry * 1000).toISOString()}`);
  }

  /**
   * Fetches leagues and matches for Table Tennis within a specific date range.
   * Dates should be formatted as YYYY-MM-DD HH:mm:ss in UTC timezone.
   */
  public async getTableTennisLeagues(startDate: string, endDate: string): Promise<LeagueData[]> {
    await this.ensureSession();

    console.log(`[Scores24Client] Fetching table tennis leagues between ${startDate} and ${endDate}...`);

    const result = await this.page!.evaluate(async (params) => {
      const url = `https://scores24.live/rapi/sport/table-tennis/leagues?date_between[]=${encodeURIComponent(params.startDate)}&date_between[]=${encodeURIComponent(params.endDate)}&is_bot=false&is_open=true&lang=en&match_filter=all&with_live=true`;

      const headers = {
        "accept": "*/*",
        "accept-language": "en-US,en;q=0.9",
        "x-api-token": params.token,
        "x-bot-identifier": "client",
        "x-country": "dz",
        "x-ssr-ip": params.ip,
        "x-user-cache": params.userCache,
        "x-user-ip": params.ip,
        "x-requested-with": "XMLHttpRequest"
      };

      const response = await fetch(url, { method: "GET", headers });

      if (!response.ok) {
        throw new Error(`API returned status ${response.status}: ${await response.text()}`);
      }

      return response.json();
    }, {
      startDate,
      endDate,
      token: this.token!,
      ip: this.ip!,
      userCache: this.userCache!
    });

    return result.data || [];
  }

  /**
   * Fetches leagues and matches for Table Tennis within a specific date range,
   * and filters them to ONLY return matches that have odds (has_odds === true).
   * Leagues that do not contain any matches with odds are excluded.
   */
  public async getTableTennisLeaguesWithOdds(startDate: string, endDate: string): Promise<LeagueData[]> {
    const allLeagues = await this.getTableTennisLeagues(startDate, endDate);
    return allLeagues
      .map((leagueData) => {
        const matchesWithOdds = (leagueData.matches || []).filter((match) => match.has_odds);
        return {
          ...leagueData,
          matches: matchesWithOdds,
        };
      })
      .filter((leagueData) => leagueData.matches.length > 0);
  }

  /**
   * Fetches detailed odds (lines) for a specific match.
   * `isoDate` (YYYY-MM-DD) is required when `matchSlug` is the bare slug (no
   * date prefix) -- it's used to rebuild the DD-MM-YYYY-slug the API expects.
   * Omit it when `matchSlug` is already date-prefixed.
   */
  public async getMatchOdds(sportSlug: string, matchSlug: string, isoDate?: string): Promise<MatchOdds | null> {
    await this.ensureSession();

    const fullSlug = isoDate ? `${isoToDdMmYyyy(isoDate)}-${matchSlug}` : matchSlug;
    console.log(`[Scores24Client] Fetching odds for match ${fullSlug}...`);

    try {
      const result = await this.page!.evaluate(async (params) => {
        const url = `https://scores24.live/rapi/localized/matches/${encodeURIComponent(params.sportSlug)}/${encodeURIComponent(params.matchSlug)}/lines?lang=en&audience=us`;

        const headers = {
          "accept": "*/*",
          "accept-language": "en-US,en;q=0.9",
          "x-api-token": params.token,
          "x-bot-identifier": "client",
          "x-country": "dz",
          "x-ssr-ip": params.ip,
          "x-user-cache": params.userCache,
          "x-user-ip": params.ip,
          "x-requested-with": "XMLHttpRequest"
        };

        const response = await fetch(url, { method: "GET", headers });

        if (!response.ok) {
          throw new Error(`API returned status ${response.status}: ${await response.text()}`);
        }

        return response.json();
      }, {
        matchSlug: fullSlug,
        sportSlug,
        token: this.token!,
        ip: this.ip!,
        userCache: this.userCache!
      });

      if (!result?.data?.lines?.edges) return null;

      const lines = result.data.lines.edges.map((edge: any) => {
        const node = edge.node;
        const rates = node.topRates?.[0]?.values?.map((val: any) => ({
          outcome: val.outcome,
          outcome_value: val.outcome_value,
          value: val.value
        })) || [];
        return {
          market: node.market,
          rates
        };
      });

      return {
        markets: result.data.markets || [],
        lines
      };
    } catch (e) {
      await this.recoverFromPageCrash(e);
      console.error(`[Scores24Client] Failed to fetch odds for ${matchSlug}:`, e);
      return null;
    }
  }

  /**
   * Fetches match status (is_live / is_finished) for a bare slug + its match date.
   */
  public async getMatchInfo(sportSlug: string, ddmmyyyyDate: string, matchSlug: string): Promise<MatchInfo | null> {
    await this.ensureSession();

    const fullSlug = `${ddmmyyyyDate}-${matchSlug}`;
    console.log(`[Scores24Client] Fetching match info for ${fullSlug}...`);

    try {
      const result = await this.page!.evaluate(async (params) => {
        const url = `https://scores24.live/rapi/localized/matches/${encodeURIComponent(params.sportSlug)}/${encodeURIComponent(params.matchSlug)}?lang=en&audience=us`;

        const headers = {
          "accept": "*/*",
          "accept-language": "en-US,en;q=0.9",
          "x-api-token": params.token,
          "x-bot-identifier": "client",
          "x-country": "dz",
          "x-ssr-ip": params.ip,
          "x-user-cache": params.userCache,
          "x-user-ip": params.ip,
          "x-requested-with": "XMLHttpRequest"
        };

        const response = await fetch(url, { method: "GET", headers });

        if (!response.ok) {
          throw new Error(`API returned status ${response.status}: ${await response.text()}`);
        }

        return response.json();
      }, {
        matchSlug: fullSlug,
        sportSlug,
        token: this.token!,
        ip: this.ip!,
        userCache: this.userCache!
      });

      if (!result?.data) return null;

      return {
        is_finished: !!result.data.is_finished,
        is_live: !!result.data.is_live
      };
    } catch (e) {
      await this.recoverFromPageCrash(e);
      console.error(`[Scores24Client] Failed to fetch match info for ${fullSlug}:`, e);
      return null;
    }
  }

  public async close() {
    if (this.page) {
      await this.page.close();
      this.page = null;
    }
    if (this.browser && this.ownsBrowser) {
      console.log("[Scores24Client] Closing browser...");
      await this.browser.close();
      this.browser = null;
    }
  }
}
