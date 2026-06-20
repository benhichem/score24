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

export class Scores24Client {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private token: string | null = null;
  private ip: string | null = null;
  private userCache: string | null = null;
  private tokenExpiry: number = 0; // UTC timestamp in seconds

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

  private decodeTokenExpiry(token: string): number {
    try {
      const base64Payload = token.split(".")[0];
      const decoded = JSON.parse(Buffer.from(base64Payload, "base64").toString("utf-8"));
      return decoded.exp || 0;
    } catch {
      return 0;
    }
  }

  private async ensureSession() {
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

  public async close() {
    if (this.browser) {
      console.log("[Scores24Client] Closing browser...");
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
}
