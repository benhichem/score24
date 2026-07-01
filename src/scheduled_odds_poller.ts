import fs from "fs/promises";
import path from "path";
import { Scores24Client, type MatchOdds, type LeagueData } from "./scores_client";

const DATA_DIR = process.env.DATA_DIR ?? "data";
const IDLE_WAIT_MS = Number(process.env.POLL_INTERVAL_MS ?? 60_000); // when the queue is empty
const INTER_MATCH_DELAY_MS = 750; // pacing between sequential requests -- keeps us under Cloudflare's rate limit
const MAX_PRE_ODDS_ATTEMPTS = 3;
const MAX_CONFIRM_ATTEMPTS = 3;
const FILE_DISCOVERY_INTERVAL_MS = 3 * 60_000;

type MatchState = "PENDING" | "POLLING" | "CONFIRMING_FINISHED";

interface ActiveMatch {
  slug: string; // bare slug, no date prefix
  sportSlug: string;
  matchDateIso: string;
  state: MatchState;
  attemptsSinceLastSuccess: number;
  everHadOdds: boolean;
  confirmAttempts: number;
}

interface LiveOddsEntry {
  timestamp: string;
  odds: MatchOdds;
}

const activeMatches = new Map<string, ActiveMatch>();
const seenSourceFiles = new Set<string>();

// FIFO queue of slugs awaiting their next poll, oldest-due first. A match
// that's still active gets pushed to the back after being polled, so it
// naturally cycles through in order without needing concurrent workers.
const queue: string[] = [];
const queuedSlugs = new Set<string>();

function enqueue(slug: string) {
  if (queuedSlugs.has(slug)) return;
  queue.push(slug);
  queuedSlugs.add(slug);
}

function dequeue(): string | undefined {
  const slug = queue.shift();
  if (slug !== undefined) queuedSlugs.delete(slug);
  return slug;
}

function stripDatePrefix(slug: string): string {
  return slug.replace(/^\d{2}-\d{2}-\d{4}-/, "");
}

function todayFileName(): string {
  return `matches_${new Date().toISOString().split("T")[0]}.json`;
}

function ddmmyyyy(iso: string): string {
  const [y, m, d] = iso.split("T")[0].split("-");
  return `${d}-${m}-${y}`;
}

async function loadScheduleFile(filename: string) {
  if (seenSourceFiles.has(filename)) return;

  let raw: string;
  try {
    raw = await fs.readFile(path.join(DATA_DIR, filename), "utf-8");
  } catch {
    return; // not generated yet -- try again on the next discovery pass
  }

  const leagues: LeagueData[] = JSON.parse(raw);
  for (const league of leagues) {
    for (const match of league.matches) {
      const slug = stripDatePrefix(match.slug);
      if (activeMatches.has(slug)) continue;
      activeMatches.set(slug, {
        slug,
        sportSlug: match.sport_slug,
        matchDateIso: match.match_date,
        state: "PENDING",
        attemptsSinceLastSuccess: 0,
        everHadOdds: false,
        confirmAttempts: 0,
      });
    }
  }
  seenSourceFiles.add(filename);
  console.log(`[Scheduler] Loaded ${filename}: ${activeMatches.size} matches tracked total`);
}

async function appendLiveOdds(slug: string, odds: MatchOdds): Promise<boolean> {
  const outDir = path.join(DATA_DIR, "live");
  await fs.mkdir(outDir, { recursive: true });
  const filePath = path.join(outDir, `${slug}.json`);

  let history: LiveOddsEntry[] = [];
  try {
    history = JSON.parse(await fs.readFile(filePath, "utf-8"));
  } catch {
    // first write for this match
  }

  const last = history.at(-1);
  if (last && JSON.stringify(last.odds) === JSON.stringify(odds)) {
    return false; // odds unchanged, skip write
  }

  history.push({ timestamp: new Date().toISOString(), odds });
  await fs.writeFile(filePath, JSON.stringify(history, null, 2), "utf-8");
  return true;
}

function promoteDueMatches() {
  const now = Date.now();
  for (const match of activeMatches.values()) {
    if (match.state === "PENDING" && new Date(match.matchDateIso).getTime() <= now) {
      match.state = "POLLING";
      enqueue(match.slug);
      console.log(`[Scheduler] ${match.slug} is due -> POLLING`);
    }
  }
}

async function pollOneMatch(match: ActiveMatch, client: Scores24Client) {
  if (match.state === "POLLING") {
    const odds = await client.getMatchOdds(match.sportSlug, match.slug, match.matchDateIso.split("T")[0]);

    if (odds) {
      match.everHadOdds = true;
      match.attemptsSinceLastSuccess = 0;
      const changed = await appendLiveOdds(match.slug, odds);
      if (changed) console.log(`[Scheduler] ${match.slug}: odds changed, written`);
      else console.log(`[Scheduler] ${match.slug}: odds unchanged, skipped write`);
      return;
    }

    match.attemptsSinceLastSuccess++;
    if (!match.everHadOdds) {
      if (match.attemptsSinceLastSuccess >= MAX_PRE_ODDS_ATTEMPTS) {
        console.log(`[Scheduler] ${match.slug}: no odds ever appeared, abandoning`);
        activeMatches.delete(match.slug);
      }
      return; // pre-match, keep waiting
    }

    // Odds existed before and are gone now -- verify the match actually ended
    match.state = "CONFIRMING_FINISHED";
    return;
  }

  if (match.state === "CONFIRMING_FINISHED") {
    const info = await client.getMatchInfo(match.sportSlug, ddmmyyyy(match.matchDateIso), match.slug);

    if (info?.is_finished) {
      console.log(`[Scheduler] ${match.slug}: confirmed finished, stopping`);
      activeMatches.delete(match.slug);
      return;
    }
    if (info && !info.is_finished) {
      console.log(`[Scheduler] ${match.slug}: still live, resuming polling`);
      match.state = "POLLING";
      return;
    }

    match.confirmAttempts++;
    if (match.confirmAttempts >= MAX_CONFIRM_ATTEMPTS) {
      console.log(`[Scheduler] ${match.slug}: could not confirm status, abandoning`);
      activeMatches.delete(match.slug);
    }
  }
}

async function waitForScheduleFile(): Promise<void> {
  const filename = todayFileName();
  const filePath = path.join(DATA_DIR, filename);
  while (true) {
    try {
      await fs.access(filePath);
      console.log(`[Scheduler] ${filename} found, starting.`);
      return;
    } catch {
      console.log(`[Scheduler] Waiting for ${filename} (daily-fetcher hasn't run yet)...`);
      await Bun.sleep(30_000);
    }
  }
}

// Single sequential loop: one match at a time, oldest-due first. Trades a
// little freshness for never hammering the API concurrently -- a few seconds
// of lag per match is fine, getting rate-limited or crashing the page isn't.
async function runQueueLoop(client: Scores24Client) {
  let lastDiscoveryAt = 0;

  while (true) {
    const now = Date.now();
    if (now - lastDiscoveryAt >= FILE_DISCOVERY_INTERVAL_MS || lastDiscoveryAt === 0) {
      await loadScheduleFile(todayFileName());
      lastDiscoveryAt = now;
    }

    promoteDueMatches();

    const slug = dequeue();
    if (!slug) {
      await Bun.sleep(IDLE_WAIT_MS);
      continue;
    }

    const match = activeMatches.get(slug);
    if (match) {
      try {
        await pollOneMatch(match, client);
      } catch (err) {
        console.error(`[Scheduler] Error polling ${slug}:`, err);
      }

      if (activeMatches.has(slug) && (match.state === "POLLING" || match.state === "CONFIRMING_FINISHED")) {
        enqueue(slug);
      }
    }

    await Bun.sleep(INTER_MATCH_DELAY_MS);
  }
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await waitForScheduleFile();
  await loadScheduleFile(todayFileName());

  const client = new Scores24Client();
  console.log(`[Scheduler] Started. Single sequential worker, ~${INTER_MATCH_DELAY_MS}ms between matches.`);

  const shutdown = async () => {
    console.log("\n[Scheduler] Shutting down...");
    await client.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await runQueueLoop(client);
}

main();
