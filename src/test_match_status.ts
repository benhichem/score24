import { Scores24Client } from "./scores_client";

async function run() {
  const client = new (Scores24Client as any)();

  try {
    const matchSlug = "21-06-2026-pavel-fojt-michal-vedmoch";
    const sportSlug = "table-tennis";

    await client.ensureSession();
    
    const result = await client.page!.evaluate(async (params: any) => {
      const url = `https://scores24.live/rapi/localized/matches/${params.sportSlug}/${params.matchSlug}?lang=en&audience=us`;
      
      const headers = {
        "accept": "*/*",
        "accept-language": "en-US,en;q=0.9",
        "x-api-token": params.token,
        "x-bot-identifier": "client",
        "x-ssr-ip": params.ip,
        "x-user-cache": params.userCache,
        "x-user-ip": params.ip,
        "x-requested-with": "XMLHttpRequest"
      };

      const response = await fetch(url, { method: "GET", headers });
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${await response.text()}`);
      }
      
      return response.json();
    }, {
      matchSlug,
      sportSlug,
      token: client.token,
      ip: client.ip,
      userCache: client.userCache
    });

    console.log("Response:", JSON.stringify(result, null, 2).substring(0, 500));
    
  } catch (error) {
    console.error("Test failed:", error);
  } finally {
    await client.close();
  }
}

run();
