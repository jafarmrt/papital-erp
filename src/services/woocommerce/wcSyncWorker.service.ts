import { logger } from '../../middleware/logger.js';
import { WC_AUTO_PUSH_INTERVAL_MS } from '../../lib/woocommerce/wcAutoPush.js';
import { runSyncSteps, type WcSyncStep } from '../../lib/woocommerce/wcSyncSteps.js';
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
const STEPS: WcSyncStep[] = [
  { name: 'auto push', run: () => runAutoPushOnce() },
  { name: 'price push', run: () => runPricePushOnce() },
  { name: 'SKU rename', run: () => runSkuRenameOnce() },
  { name: 'nightly re-read', run: () => runNightlyOnce() },
];

export class WcShopSyncWorker {
  private static timer: ReturnType<typeof setInterval> | null = null;
  private static running = false;

  private static runInBackground(): void {
    if (this.running) return;
    this.running = true;
    void (async () => {
      try {
        await runSyncSteps(STEPS, logger);
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
