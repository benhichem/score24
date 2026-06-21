import type { ServerWebSocket } from "bun";
import type { MatchOdds } from "../scores_client";

export class SubscriptionManager {
  // Map match slug to array of connected websockets
  private subscriptions: Map<string, Set<ServerWebSocket<any>>> = new Map();
  // Map match slug to last known stringified odds
  private lastKnownOdds: Map<string, string> = new Map();

  /**
   * Subscribes a client to a specific match.
   */
  public subscribe(ws: ServerWebSocket<any>, matchSlug: string) {
    if (!this.subscriptions.has(matchSlug)) {
      this.subscriptions.set(matchSlug, new Set());
    }
    const clients = this.subscriptions.get(matchSlug)!;
    clients.add(ws);
    
    console.log(`[SubManager] Client subscribed to ${matchSlug}. Total clients: ${clients.size}`);

    // If we already have odds for this match, send them immediately
    if (this.lastKnownOdds.has(matchSlug)) {
      ws.send(JSON.stringify({
        type: "odds_update",
        matchSlug,
        odds: JSON.parse(this.lastKnownOdds.get(matchSlug)!)
      }));
    }
  }

  /**
   * Unsubscribes a client from all matches.
   */
  public unsubscribe(ws: ServerWebSocket<any>) {
    for (const [matchSlug, clients] of this.subscriptions.entries()) {
      if (clients.has(ws)) {
        clients.delete(ws);
        console.log(`[SubManager] Client unsubscribed from ${matchSlug}. Remaining clients: ${clients.size}`);
        
        // Cleanup if no clients left
        if (clients.size === 0) {
          this.subscriptions.delete(matchSlug);
          this.lastKnownOdds.delete(matchSlug);
          console.log(`[SubManager] No active clients for ${matchSlug}. Cleaned up state.`);
        }
      }
    }
  }

  /**
   * Compares new odds with memory state and broadcasts to clients if changed.
   */
  public broadcastIfChanged(matchSlug: string, newOdds: MatchOdds | null) {
    if (!newOdds) return;

    const clients = this.subscriptions.get(matchSlug);
    if (!clients || clients.size === 0) return;

    const newOddsStr = JSON.stringify(newOdds);
    const lastOddsStr = this.lastKnownOdds.get(matchSlug);

    if (newOddsStr !== lastOddsStr) {
      console.log(`[SubManager] Odds changed for ${matchSlug}. Broadcasting to ${clients.size} clients.`);
      
      this.lastKnownOdds.set(matchSlug, newOddsStr);
      
      const payload = JSON.stringify({
        type: "odds_update",
        matchSlug,
        odds: newOdds
      });

      for (const client of clients) {
        // Send if connection is still open
        try {
          client.send(payload);
        } catch (e) {
          console.error("[SubManager] Failed to send to a client, removing it.", e);
          this.unsubscribe(client);
        }
      }
    } else {
      console.log(`[SubManager] No odds changes for ${matchSlug}.`);
    }
  }

  /**
   * Returns a list of all currently active match slugs that have subscribers.
   */
  public getActiveMatchSlugs(): string[] {
    return Array.from(this.subscriptions.keys());
  }
}
