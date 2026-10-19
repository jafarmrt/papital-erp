import { logger } from '../../middleware/logger.js';
import { WC_AUTO_PUSH_INTERVAL_MS } from '../../lib/woocommerce/wcAutoPush.js';
import { runAutoPushOnce } from './wcAutoPush.service.js';
import { runPricePushOnce, runSkuRenameOnce } from './wcFieldPush.service.js';
import { runNightlyOnce } from './wcNightly.service.js';

/**
 * 10.2 package 6 (D-04 parts B and C): the worker started and stopped by `server.ts`. Once a minute, after the stock writes
 * have committed and never inside them, it runs in turn the automatic stock push, the price push, the SKU rename and the
 * nightly re-read, each behind its own setting and each taking the `WOOCOMMERCE_SYNC` lock on its own (one exchange with
 * the shop at a time); one step's failure never skips the next, and a minute whose steps are still running is skipped.
 * Terminal output is English (AGENTS §6): the Persian reasons are on the run rows the WooCommerce tab shows.
 */
type Step = { name: string; run: () => Promise<{ state: string; result?: { syncedCount: number; failedCount: number } }> };

const STEPS: Step[] = [
  { name: 'auto push', run: () => runAutoPushOnce() },
  { name: 'price push', run: () => runPricePushOnce() },
  { name: 'SKU rename', run: () => runSkuRenameOnce() },
  { name: 'nightly re-read', run: () => runNightlyOnce() },
];

async function runStep(step: Step): Promise<void> {
  try {
    const outcome = await step.run();
    if (outcome.result) {
      logger.info(`[WooCommerce ${step.name}] ${outcome.result.syncedCount} product(s) updated, ${outcome.result.failedCount} failed`);
    } else if (outcome.state === 'failed') {
      logger.warn(`[WooCommerce ${step.name}] Run failed; the next attempt waits (see the WooCommerce tab)`);
    } else if (outcome.state === 'read') {
      logger.info(`[WooCommerce ${step.name}] The shop catalog was read`);
    }
  } catch (err) {
    logger.error(`[WooCommerce ${step.name}] Run failed: ${err instanceof Error ? err.name : 'unknown error'}`);
  }
}

export class WcShopSyncWorker {
  private static timer: ReturnType<typeof setInterval> | null = null;
  private static running = false;

  private static runInBackground(): void {
    if (this.running) return;
    this.running = true;
    void (async () => {
      try {
        for (const step of STEPS) await runStep(step);
      } finally {
        this.running = false;
      }
    })();
  }

  static start(intervalMs: number = WC_AUTO_PUSH_INTERVAL_MS): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.runInBackground(), intervalMs);
    this.timer.unref?.();
    logger.info(`[WooCommerce sync worker] Started with interval ${intervalMs}ms`);
  }

  static stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
