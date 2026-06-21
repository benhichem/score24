import { SubscriptionManager } from "./subscription_manager";
import { Poller } from "./poller";
import { findMatchInDailyData } from "../find_match";

const PORT = 3000;

const manager = new SubscriptionManager();
// Set to 60000 ms (1 minute) as per user request
const poller = new Poller(manager, 60000); 

poller.start();

Bun.serve({
  port: PORT,
  fetch(req, server) {
    // Upgrade HTTP requests to WebSockets
    if (server.upgrade(req)) {
      return; // upgraded successfully
    }
    return new Response("This is a WebSocket server.", { status: 426 });
  },
  websocket: {
    open(ws) {
      console.log("[Server] New client connected");
    },
    async message(ws, message) {
      try {
        const data = JSON.parse(message as string);
        
        if (data.action === "subscribe" && data.args) {
          console.log("[Server] Received subscribe request:", data.args);
          
          // 1. Look up the match in the daily JSON file
          const match = await findMatchInDailyData(data.args);
          
          if (!match) {
            ws.send(JSON.stringify({
              type: "error",
              message: "Match not found in local data. Ensure daily fetcher has run."
            }));
            return;
          }

          // 2. Dynamically check the website to verify if it's currently live
          console.log(`[Server] Checking website to see if ${match.slug} is currently live...`);
          const client = poller.getClient();
          
          try {
            const startDate = `${data.args.date} 00:00:00`;
            const endDate = `${data.args.date} 23:59:59`;
            const freshLeagues = await client.getTableTennisLeagues(startDate, endDate);
            
            let isCurrentlyLive = false;
            
            // Search the fresh API data for our match
            for (const league of freshLeagues) {
              const freshMatch = league.matches.find(m => m.slug === match.slug);
              if (freshMatch) {
                isCurrentlyLive = freshMatch.is_live;
                break;
              }
            }

            if (!isCurrentlyLive) {
              ws.send(JSON.stringify({
                type: "error",
                message: "Match is not currently live on the website. Streaming is only available for live matches."
              }));
              return;
            }
          } catch (e) {
             console.error("[Server] Failed to verify live status:", e);
             ws.send(JSON.stringify({
                type: "error",
                message: "Failed to verify match status from the website. Please try again."
             }));
             return;
          }

          // 3. Subscribe the client
          ws.send(JSON.stringify({
            type: "subscribed",
            matchSlug: match.slug,
            sportSlug: match.sport_slug
          }));

          manager.subscribe(ws, match.slug);
        } else {
          ws.send(JSON.stringify({ type: "error", message: "Unknown action or invalid payload" }));
        }

      } catch (err) {
        console.error("[Server] Invalid message received:", message);
        ws.send(JSON.stringify({ type: "error", message: "Invalid JSON payload" }));
      }
    },
    close(ws, code, message) {
      console.log(`[Server] Client disconnected (code: ${code})`);
      manager.unsubscribe(ws);
    },
  },
});

console.log(`[Server] Live Odds WebSocket server listening on ws://localhost:${PORT}`);

// Cleanup on exit
process.on('SIGINT', async () => {
  console.log("\n[Server] Shutting down...");
  await poller.close();
  process.exit(0);
});
