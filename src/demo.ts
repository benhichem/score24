import { Scores24Client } from "./scores_client";

function getMatchStatusLabel(match: any): string {
  if (match.is_live) {
    return "🔴 LIVE";
  } else if (match.is_finished) {
    return "🟢 Finished";
  } else {
    return "⚪ Scheduled";
  }
}

async function run() {
  const client = new Scores24Client();

  try {
    const startDate = "2026-06-20 00:00:00";
    const endDate = "2026-06-20 23:59:59";

    // 1. Fetch ALL leagues and matches
    console.log("--- 1. Fetching ALL leagues and matches ---");
    const allLeagues = await client.getTableTennisLeagues(startDate, endDate);
    
    console.log(`\nSuccessfully fetched ${allLeagues.length} leagues in total.`);
    
    // Print a few leagues with match status labels
    for (const leagueData of allLeagues.slice(0, 3)) {
      const league = leagueData.league;
      const matches = leagueData.matches || [];
      console.log(`\n🏆 League: ${league.name} (${league.country.name})`);
      console.log(`   Matches (${matches.length}):`);
      
      for (const match of matches.slice(0, 3)) {
        const homeTeam = match.teams[0]?.name || "Unknown";
        const awayTeam = match.teams[1]?.name || "Unknown";
        const score = match.result_score || "VS";
        const statusLabel = getMatchStatusLabel(match);
        const oddsLabel = match.has_odds ? "[Has Odds]" : "[No Odds]";
        
        console.log(`     - [${statusLabel}] [${match.match_date}] ${homeTeam}  ${score}  ${awayTeam} ${oddsLabel} (ID: ${match.id})`);
      }
      if (matches.length > 3) {
        console.log(`     - ... and ${matches.length - 3} more matches`);
      }
    }

    // 2. Fetch ONLY leagues and matches WITH ODDS
    console.log("\n-------------------------------------------------------------");
    console.log("--- 2. Fetching ONLY leagues and matches with ODDS ---");
    console.log("-------------------------------------------------------------");
    const oddsLeagues = await client.getTableTennisLeaguesWithOdds(startDate, endDate);
    
    console.log(`Successfully fetched ${oddsLeagues.length} leagues containing matches with odds.`);
    
    for (const leagueData of oddsLeagues.slice(0, 3)) {
      const league = leagueData.league;
      const matches = leagueData.matches || [];
      console.log(`\n🏆 League: ${league.name} (${league.country.name})`);
      console.log(`   Matches with Odds (${matches.length}):`);
      
      for (const match of matches.slice(0, 3)) {
        const homeTeam = match.teams[0]?.name || "Unknown";
        const awayTeam = match.teams[1]?.name || "Unknown";
        const score = match.result_score || "VS";
        const statusLabel = getMatchStatusLabel(match);
        
        console.log(`     - [${statusLabel}] [${match.match_date}] ${homeTeam}  ${score}  ${awayTeam} (ID: ${match.id})`);
      }
      if (matches.length > 3) {
        console.log(`     - ... and ${matches.length - 3} more matches with odds`);
      }
    }

    // 3. Attach odds to a specific match
    console.log("\n-------------------------------------------------------------");
    console.log("--- 3. Fetching and Attaching Odds to a Match ---");
    console.log("-------------------------------------------------------------");
    
    if (oddsLeagues.length > 0 && oddsLeagues[0].matches.length > 0) {
      // Pick the first match from the first league that has odds
      const match = oddsLeagues[0].matches[0];
      console.log(`Selected Match: ${match.teams[0]?.name} vs ${match.teams[1]?.name} (Slug: ${match.slug})`);
      
      const odds = await client.getMatchOdds(match.sport_slug, match.slug);
      
      if (odds) {
        // Attach the odds to the match object
        match.odds = odds;
        console.log("\nSuccessfully attached odds to the match object! Here is the 'one_two' (Moneyline) market:");
        
        const moneyline = match.odds.lines.find(line => line.market === "one_two");
        if (moneyline) {
           moneyline.rates.forEach(rate => {
             console.log(`  - ${rate.outcome}: ${rate.value}`);
           });
        } else {
           console.log("  (one_two market not found in this match's odds)");
        }
        
        console.log("\nFull match object snippet with odds:");
        console.log(JSON.stringify(match, null, 2).substring(0, 1500) + "\n  ...\n}");
      } else {
        console.log("No odds found for this match.");
      }
    }

  } catch (error) {
    console.error("Demo failed with error:", error);
  } finally {
    await client.close();
    console.log("\nDemo finished, browser closed.");
  }
}

run();
