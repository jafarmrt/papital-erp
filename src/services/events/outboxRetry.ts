import { and, asc, eq, inArray } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { deadLetterEvents, outboxEvents } from '../../db/schema.js';
import { ConflictError, NotFoundError } from '../../errors/customErrors.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { lockIdleDeadLetterRows } from './deadLetterRowLock.js';
import { DeadLetterQueueService, unresolvedDeadLetterCondition } from './deadLetterQueueService.js';

/**
 * v9.0.432 (TD-716، B15-14): «تلاش دوباره» رویداد ناموفق outbox (یکی یا همه) فقط رویداد `failed` را به صف برمی‌گرداند و در
 * همان تراکنش ردیف باز صف خطای همان رویداد را مانند بازگردانی گروهی (TD-245) «بازپخش‌شده» علامت می‌زند، تا همان رویداد
 * دوباره از صف خطا بازپخش نشود؛ شکست دوباره، ردیف را با `moveToDeadLetter` دوباره قرنطینه می‌کند. رویدادی که ردیف صف
 * خطایش هم‌اکنون بازپخش می‌شود کنار می‌ماند (یکی: ۴۰۹). پیش‌تر ردیف صف خطا «قرنطینه» می‌ماند و تلاش دوباره یک رویداد
 * تکمیل‌شده را هم دوباره اجرا می‌کرد.
 */
export const OUTBOX_EVENT_NOT_FAILED = 'OUTBOX_EVENT_NOT_FAILED';

export interface OutboxRetryResult {
  retried: number;
  /** DLQ rows marked replayed because their event went back to the outbox */
  deadLettersResolved: number;
  /** events left failed because their DLQ row is being replayed or changed right now */
  skippedBusy: string[];
}

export async function retryFailedOutboxEvents(options: { eventId?: string; userId?: number } = {}): Promise<OutboxRetryResult> {
  return orm.transaction(async (tx) => {
    if (options.eventId !== undefined) {
      const [row] = await tx.select({ status: outboxEvents.status }).from(outboxEvents).where(eq(outboxEvents.eventId, options.eventId));
      if (!row) throw new NotFoundError(`رویداد ${options.eventId} در صندوق خروجی یافت نشد.`);
      if (row.status !== 'failed') {
        throw new ConflictError(`رویداد ${options.eventId} ناموفق نیست (وضعیت ${row.status})؛ فقط رویداد ناموفق دوباره فرستاده می‌شود.`, { eventId: options.eventId, status: row.status }, OUTBOX_EVENT_NOT_FAILED);
      }
    }
    const failed = await tx
      .select({ id: outboxEvents.id, eventId: outboxEvents.eventId })
      .from(outboxEvents)
      .where(options.eventId !== undefined ? and(eq(outboxEvents.status, 'failed'), eq(outboxEvents.eventId, options.eventId)) : eq(outboxEvents.status, 'failed'))
      .orderBy(asc(outboxEvents.id))
      .for('update');
    if (failed.length === 0) return { retried: 0, deadLettersResolved: 0, skippedBusy: [] };

    const deadLetters = await tx
      .select({ id: deadLetterEvents.id, originalEventId: deadLetterEvents.originalEventId })
      .from(deadLetterEvents)
      .where(and(inArray(deadLetterEvents.originalEventId, failed.map(f => f.eventId)), unresolvedDeadLetterCondition()))
      .orderBy(asc(deadLetterEvents.id))
      .for('update');
    const idle = await lockIdleDeadLetterRows(tx, deadLetters);
    const idleIds = new Set(idle.map(d => d.id));
    const busyEvents = new Set(deadLetters.filter(d => !idleIds.has(d.id)).map(d => d.originalEventId));
    if (options.eventId !== undefined && busyEvents.size > 0) {
      throw new ConflictError(`رویداد ${options.eventId} هم‌اکنون از صف خطا بازپخش می‌شود؛ پس از پایان آن دوباره تلاش کنید.`, { eventId: options.eventId }, 'DLQ_REPLAY_IN_PROGRESS');
    }

    const retryIds = failed.filter(f => !busyEvents.has(f.eventId)).map(f => f.id);
    if (retryIds.length > 0) {
      await tx
        .update(outboxEvents)
        .set({ status: 'pending', retryCount: 0, nextRetryAt: null, lastError: null, lockedAt: null, lockedBy: null })
        .where(inArray(outboxEvents.id, retryIds));
    }
    if (idle.length > 0) {
      const nowIso = systemNowUtcIso();
      await tx
        .update(deadLetterEvents)
        .set(DeadLetterQueueService.resolutionFields('replayed', options.userId, `بازگردانده به صندوق خروجی با «تلاش دوباره» در ${nowIso}`, nowIso))
        .where(inArray(deadLetterEvents.id, idle.map(d => d.id)));
    }
    return { retried: retryIds.length, deadLettersResolved: idle.length, skippedBusy: [...busyEvents] };
  });
}
