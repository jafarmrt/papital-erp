import { logger } from '../../middleware/logger.js';
import { ADVISORY_LOCK_KEYS, withAdvisoryLock } from '../../lib/advisoryLock.js';
import { IdempotencyService } from '../idempotency.service.js';
import { OutboxService, OUTBOX_COMPLETED_RETENTION_DAYS } from './outboxService.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface OperationalPurgeResult {
  idempotencyKeys: number;
  outboxEvents: number;
  /** rows each registered purge removed, by its name */
  others: Record<string, number>;
  /** the purges that failed this run (delta review N-6: one failure never skips the others) */
  failed: string[];
}

/** A purge another package registers from the composition root (`server.ts`), so this package imports none of them */
export type RegisteredPurge = () => Promise<number>;

/**
 * OBS-R2-10: daily purge of the operational tables that otherwise grow forever: expired idempotency keys and completed
 * outbox events processed more than `OUTBOX_COMPLETED_RETENTION_DAYS` days ago (pending, processing and failed events
 * and every dead-letter row stay). Modelled on `FormDraftService.startCleanup`: once at start, then daily, one run at a
 * time across processes under advisory lock 91100.
 */
export class OperationalPurgeService {
  private static timer: ReturnType<typeof setInterval> | null = null;
  private static registered = new Map<string, RegisteredPurge>();

  /** Adds a purge to the daily run (10.2 package 6: the automatic WooCommerce run rows); one per name */
  static register(name: string, purge: RegisteredPurge): void {
    this.registered.set(name, purge);
  }

  /** test hook (delta review N-D): removes a registered purge; does nothing in production */
  static unregisterForTests(name: string): void {
    if (process.env.NODE_ENV !== 'production') this.registered.delete(name);
  }

  /** One purge; deletes run outside any transaction, each its own statement, and each purge on its own. */
  static async purgeOnce(): Promise<OperationalPurgeResult> {
    const failed: string[] = [];
    const attempt = async (name: string, purge: RegisteredPurge): Promise<number> => {
      try {
        return await purge();
      } catch (err) {
        failed.push(name);
        logger.error(`[Operational purge] ${name} failed: ${err instanceof Error ? err.message : String(err)}`);
        return 0;
      }
    };
    const idempotencyKeys = await attempt('idempotencyKeys', () => IdempotencyService.cleanupExpired());
    const outboxEvents = await attempt('outboxEvents', () => OutboxService.purgeProcessedEvents(OUTBOX_COMPLETED_RETENTION_DAYS));
    const others: Record<string, number> = {};
    for (const [name, purge] of this.registered) others[name] = await attempt(name, purge);
    return { idempotencyKeys, outboxEvents, others, failed };
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
        for (const [name, count] of Object.entries(result?.others ?? {})) {
          if (count) logger.info(`[Operational purge] ${name}: deleted ${count} row(s)`);
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
