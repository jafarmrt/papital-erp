import { logger } from '../../middleware/logger.js';
import { ADVISORY_LOCK_KEYS, withAdvisoryLock } from '../../lib/advisoryLock.js';
import { IdempotencyService } from '../idempotency.service.js';
import { OutboxService, OUTBOX_COMPLETED_RETENTION_DAYS } from './outboxService.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface OperationalPurgeResult {
  idempotencyKeys: number;
  outboxEvents: number;
}

/**
 * OBS-R2-10: daily purge of the operational tables that otherwise grow forever: expired idempotency keys and completed
 * outbox events processed more than `OUTBOX_COMPLETED_RETENTION_DAYS` days ago (pending, processing and failed events
 * and every dead-letter row stay). Modelled on `FormDraftService.startCleanup`: once at start, then daily, one run at a
 * time across processes under advisory lock 91100.
 */
export class OperationalPurgeService {
  private static timer: ReturnType<typeof setInterval> | null = null;

  /** One purge; deletes run outside any transaction, each its own statement. */
  static async purgeOnce(): Promise<OperationalPurgeResult> {
    const idempotencyKeys = await IdempotencyService.cleanupExpired();
    const outboxEvents = await OutboxService.purgeProcessedEvents(OUTBOX_COMPLETED_RETENTION_DAYS);
    return { idempotencyKeys, outboxEvents };
  }

  /** One purge at a time across processes (advisory lock 91100); a concurrent run returns null. */
  static async runExclusive(): Promise<OperationalPurgeResult | null> {
    const outcome = await withAdvisoryLock(ADVISORY_LOCK_KEYS.OPERATIONAL_PURGE, () => this.purgeOnce());
    return outcome.acquired ? outcome.result : null;
  }

  private static runInBackground(): void {
    this.runExclusive()
      .then((result) => {
        if (result && (result.idempotencyKeys || result.outboxEvents)) {
          logger.info(`[Operational purge] Deleted ${result.idempotencyKeys} expired idempotency key(s) and ${result.outboxEvents} completed outbox event(s)`);
        }
      })
      .catch((err: unknown) => logger.error(`[Operational purge] Purge failed: ${err instanceof Error ? err.message : String(err)}`));
  }

  /** Daily purge: once at start, then every `intervalMs`. */
  static start(intervalMs: number = DAY_MS): void {
    if (this.timer) return;
    this.runInBackground();
    this.timer = setInterval(() => this.runInBackground(), intervalMs);
    logger.info(`[Operational purge] Daily purge started with interval ${intervalMs}ms`);
  }

  static stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
