import fs from "fs/promises";
import path from "path";
import { LeagueData, LeagueMatch } from "./scores_client";

export interface FindMatchArgs {
  p1: string;
  p2: string;
  date: string; // The date string "YYYY-MM-DD"
  league?: string;
}

/**
 * Searches for a specific match in the generated daily JSON data.
 */
export async function findMatchInDailyData(args: FindMatchArgs): Promise<LeagueMatch | null> {
  const filePath = path.join(process.cwd(), "data", `matches_${args.date}.json`);

  try {
    const fileContent = await fs.readFile(filePath, "utf-8");
    const leagues: LeagueData[] = JSON.parse(fileContent);

    const p1Lower = args.p1.toLowerCase();
    const p2Lower = args.p2.toLowerCase();
    const leagueLower = args.league?.toLowerCase();

    for (const leagueData of leagues) {
      // If a league was specified, skip if it doesn't match
      if (leagueLower && !leagueData.league.name.toLowerCase().includes(leagueLower)) {
        continue;
      }

      for (const match of leagueData.matches) {
        if (match.teams && match.teams.length >= 2) {
          const t1 = match.teams[0]?.name?.toLowerCase() || "";
          const t2 = match.teams[1]?.name?.toLowerCase() || "";

          // Check if both players are involved in this match
          const hasP1 = t1.includes(p1Lower) || t2.includes(p1Lower);
          const hasP2 = t1.includes(p2Lower) || t2.includes(p2Lower);

          if (hasP1 && hasP2) {
            return match; // Found the match!
          }
        }
      }
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.error(`Data file for date ${args.date} not found at ${filePath}`);
    } else {
      console.error("Error reading or parsing data file:", error);
    }
  }

  return null;
}

// ---------------------------------------------------------
// Quick Test Execution
// ---------------------------------------------------------
if (import.meta.main) {
  (async () => {
    console.log("Searching for Pavel Fojt vs Michal Vedmoch on 2026-06-21...");

    const result = await findMatchInDailyData({
      p1: "Pavel Fojt",
      p2: "Michal Vedmoch",
      date: "2026-06-21"
    });

    if (result) {
      console.log("\nMatch Found!");
      console.log(`- League: ${result.unique_tournament_name}`);
      console.log(`- Slug: ${result.slug}`);
      console.log(`- Start Time: ${result.match_date}`);
      console.log(`- Has Odds: ${result.has_odds}`);
      if (result.odds) {
        console.log(`- Moneyline Odds (one_two):`,
          result.odds.lines.find((l: any) => l.market === "one_two")?.rates || "Not Found"
        );
      }
    } else {
      console.log("\nMatch not found.");
    }
  })();
}
