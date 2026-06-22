import fs from "fs/promises";
import path from "path";
import { Scores24Client } from "./scores_client";

// Sleep helper to avoid rate limiting
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  const client = new Scores24Client();
  
  // Dynamically compute today's date in YYYY-MM-DD format (UTC)
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0]; // e.g. "2026-06-22"
  const startDate = `${dateStr} 00:00:00`;
  const endDate = `${dateStr} 23:59:59`;

  const outputDir = path.join(process.cwd(), "data");
  const outputFile = path.join(outputDir, `matches_${dateStr}.json`);

  try {
    // Ensure the data directory exists
    await fs.mkdir(outputDir, { recursive: true });

    console.log(`[DailyFetcher] Fetching all Table Tennis leagues for ${dateStr}...`);
    
    // 1. Fetch all leagues and matches for the day
    const leagues = await client.getTableTennisLeagues(startDate, endDate);
    console.log(`[DailyFetcher] Retrieved ${leagues.length} leagues.`);

    let totalMatches = 0;
    let matchesWithOddsCount = 0;

    // 2. Iterate through all leagues and matches to fetch and attach odds
    for (const leagueData of leagues) {
      const matches = leagueData.matches || [];
      totalMatches += matches.length;
      
      console.log(`[DailyFetcher] Processing League: ${leagueData.league.name} (${matches.length} matches)`);
      
      for (const match of matches) {
        if (match.has_odds) {
          matchesWithOddsCount++;
          console.log(`  -> Fetching odds for match: ${match.slug}`);
          
          try {
            const odds = await client.getMatchOdds(match.sport_slug, match.slug);
            if (odds) {
              match.odds = odds;
            }
          } catch (err) {
             console.error(`  -> [Error] Failed to fetch odds for ${match.slug}:`, err);
          }
          
          // Wait 1 second to prevent rate-limiting or getting blocked by Cloudflare (429 errors)
          await sleep(1000); 
        }
      }
    }

    console.log(`\n[DailyFetcher] Summary:`);
    console.log(`- Total Leagues: ${leagues.length}`);
    console.log(`- Total Matches: ${totalMatches}`);
    console.log(`- Matches with Odds Attached: ${matchesWithOddsCount}`);
    
    // 3. Save the result to a JSON file
    console.log(`\n[DailyFetcher] Saving data to ${outputFile}...`);
    await fs.writeFile(outputFile, JSON.stringify(leagues, null, 2), "utf-8");
    console.log(`[DailyFetcher] Data successfully saved!`);

  } catch (error) {
    console.error("[DailyFetcher] Script failed:", error);
  } finally {
    await client.close();
    console.log("[DailyFetcher] Browser closed.");
  }
}

run();
