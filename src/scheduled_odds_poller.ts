import fs from "fs/promises";
import path from "path";
import { Scores24Client, launchSharedBrowser, type MatchOdds, type LeagueData } from "./scores_client";

const DATA_DIR = process.env.DATA_DIR ?? "data";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 60_000);
const WORKER_POOL_SIZE = Number(process.env.WORKER_POOL_SIZE ?? 4);
const INTER_MATCH_DELAY_MS = 750;
const MAX_PRE_ODDS_ATTEMPTS = 3;
const MAX_CONFIRM_ATTEMPTS = 3;
const FILE_DISCOVERY_EVERY_N_TICKS = 3; // ~3 min at the default 60s interval

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

async function appendLiveOdds(slug: string, odds: MatchOdds) {
  const outDir = path.join(DATA_DIR, "live");
  await fs.mkdir(outDir, { recursive: true });
  const filePath = path.join(outDir, `${slug}.json`);

  let history: LiveOddsEntry[] = [];
  try {
    history = JSON.parse(await fs.readFile(filePath, "utf-8"));
  } catch {
    // first write for this match
  }
  history.push({ timestamp: new Date().toISOString(), odds });
  await fs.writeFile(filePath, JSON.stringify(history, null, 2), "utf-8");
}

function promoteDueMatches() {
  const now = Date.now();
  for (const match of activeMatches.values()) {
    if (match.state === "PENDING" && new Date(match.matchDateIso).getTime() <= now) {
      match.state = "POLLING";
      console.log(`[Scheduler] ${match.slug} is due -> POLLING`);
    }
  }
}

// Each worker has its own Page (and thus its own session/token) but shares one Browser process.
async function pollOneMatch(match: ActiveMatch, client: Scores24Client) {
  if (match.state === "POLLING") {
    const odds = await client.getMatchOdds(match.sportSlug, match.slug);

    if (odds) {
      match.everHadOdds = true;
      match.attemptsSinceLastSuccess = 0;
      await appendLiveOdds(match.slug, odds);
      console.log(`[Scheduler] ${match.slug}: odds updated`);
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
    const info = await client.getMatchInfo(ddmmyyyy(match.matchDateIso), match.slug);

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

// Round-robin the due matches across the worker pool, then run each worker's
// batch sequentially -- but all workers run concurrently via Promise.all.
async function pollBatch(toPoll: ActiveMatch[], workers: Scores24Client[]) {
  const buckets: ActiveMatch[][] = Array.from({ length: workers.length }, () => []);
  toPoll.forEach((match, i) => buckets[i % workers.length].push(match));

  await Promise.all(
    buckets.map(async (bucket, workerIndex) => {
      const client = workers[workerIndex]!;
      for (const match of bucket) {
        await pollOneMatch(match, client);
        await Bun.sleep(INTER_MATCH_DELAY_MS);
      }
    })
  );
}

let tickCount = 0;
let isTicking = false;

async function tick(workers: Scores24Client[]) {
  if (isTicking) return;
  isTicking = true;
  try {
    tickCount++;
    if (tickCount === 1 || tickCount % FILE_DISCOVERY_EVERY_N_TICKS === 0) {
      await loadScheduleFile(todayFileName());
    }

    promoteDueMatches();

    const toPoll = [...activeMatches.values()].filter(
      (m) => m.state === "POLLING" || m.state === "CONFIRMING_FINISHED"
    );
    await pollBatch(toPoll, workers);
  } catch (err) {
    console.error("[Scheduler] Tick error:", err);
  } finally {
    isTicking = false;
  }
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await loadScheduleFile(todayFileName());

  const sharedBrowser = await launchSharedBrowser();
  const workers = Array.from({ length: WORKER_POOL_SIZE }, () => new Scores24Client(sharedBrowser));

  setInterval(() => tick(workers), POLL_INTERVAL_MS);
  console.log(`[Scheduler] Started. ${WORKER_POOL_SIZE} workers, polling every ${POLL_INTERVAL_MS}ms.`);

  process.on("SIGINT", async () => {
    console.log("\n[Scheduler] Shutting down...");
    await Promise.all(workers.map((w) => w.close()));
    await sharedBrowser.close();
    process.exit(0);
  });
}

main();
