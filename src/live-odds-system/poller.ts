import { Scores24Client } from "../scores_client";
import type { SubscriptionManager } from "./subscription_manager";

export class Poller {
  private client: Scores24Client;
  private manager: SubscriptionManager;
  private intervalMs: number;
  private timer: Timer | null = null;
  private isPolling: boolean = false;

  constructor(manager: SubscriptionManager, intervalMs: number = 60000) {
    this.client = new Scores24Client();
    this.manager = manager;
    this.intervalMs = intervalMs;
  }

  public getClient(): Scores24Client {
    return this.client;
  }

  /**
   * Starts the polling loop.
   */
  public start() {
    if (this.timer) return;
    console.log(`[Poller] Starting background poller (Interval: ${this.intervalMs}ms)`);
    
    // Run immediately, then set interval
    this.poll();
    this.timer = setInterval(() => this.poll(), this.intervalMs);
  }

  /**
   * Stops the polling loop.
   */
  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Closes the underlying puppeteer browser.
   */
  public async close() {
    this.stop();
    await this.client.close();
  }

  /**
   * The actual polling logic executed every interval.
   */
  private async poll() {
    if (this.isPolling) {
      console.log("[Poller] Warning: Previous poll still running. Skipping this cycle.");
      return;
    }
    
    this.isPolling = true;

    try {
      const activeSlugs = this.manager.getActiveMatchSlugs();
      if (activeSlugs.length === 0) {
        // No active clients, no need to poll
        return;
      }

      console.log(`[Poller] Fetching odds for ${activeSlugs.length} active match(es)...`);
      await this.client.ensureSession();

      for (const matchSlug of activeSlugs) {
        // Hardcoding table-tennis sport slug for now as that's our focus
        // In a full multi-sport system, the manager would also store the sportSlug.
        const sportSlug = "table-tennis";
        
        try {
          const odds = await this.client.getMatchOdds(sportSlug, matchSlug);
          // Hand off to manager to diff and broadcast
          this.manager.broadcastIfChanged(matchSlug, odds);
        } catch (err) {
          console.error(`[Poller] Error fetching odds for ${matchSlug}:`, err);
        }

        // Small delay between requests to avoid rate limits
        await Bun.sleep(500); 
      }
    } catch (err) {
      console.error("[Poller] Critical error in polling loop:", err);
    } finally {
      this.isPolling = false;
    }
  }
}
