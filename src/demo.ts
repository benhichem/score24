import { Scores24Client } from "./scores_client";

async function run() {
  const client = new Scores24Client();

  try {
    // Let's query today's table tennis leagues
    // Formatting matching the user request range
    const startDate = "2026-06-20 00:00:00";
    const endDate = "2026-06-20 23:59:59";

    const leagues = await client.getTableTennisLeagues(startDate, endDate);
    
    console.log("\n==============================================");
    console.log(`Successfully fetched ${leagues.length} leagues!`);
    console.log("==============================================\n");

    for (const leagueData of leagues.slice(0, 5)) {
      const league = leagueData.league;
      const matches = leagueData.matches || [];
      console.log(`🏆 League: ${league.name} (${league.country.name})`);
      console.log(`   Slug: ${league.slug}`);
      console.log(`   Matches (${matches.length}):`);
      
      for (const match of matches.slice(0, 3)) {
        const homeTeam = match.teams[0]?.name || "Unknown";
        const awayTeam = match.teams[1]?.name || "Unknown";
        const score = match.result_score || "VS";
        console.log(`     - [${match.match_date}] ${homeTeam}  ${score}  ${awayTeam} (ID: ${match.id})`);
      }
      if (matches.length > 3) {
        console.log(`     - ... and ${matches.length - 3} more matches`);
      }
      console.log("");
    }
    
    if (leagues.length > 5) {
      console.log(`... and ${leagues.length - 5} more leagues.`);
    }

  } catch (error) {
    console.error("Demo failed with error:", error);
  } finally {
    await client.close();
  }
}

run();
