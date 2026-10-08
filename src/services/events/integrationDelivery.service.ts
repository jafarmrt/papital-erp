import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { orm, type DbTransaction } from '../../db/drizzle.js';
import { integrationDeliveryJobs } from '../../db/schema.js';
import { ConflictError, NotFoundError } from '../../errors/customErrors.js';
import { logger } from '../../middleware/logger.js';
import { DeadLetterQueueService } from './deadLetterQueueService.js';
import type { BaseDomainEvent } from './domainEvents.js';

/**
 * v9.0.378 (TD-705, B15-03, product-owner decision t2 a): every delivery of an event to an integration has its own durable
 * row in `integration_delivery_jobs` (migration 0086): a webhook subscription x event (`webhook`) and a matching rule's
 * action x event (`rule_action`), unique per (kind, target, event), so a delivery that succeeded is never sent again. The
 * outbox handlers only record these rows (their error still goes back to the outbox), the first attempt runs at once, and
 * this worker retries a failed one after a growing delay (`next_attempt_at`); after `max_attempts` the row is `failed` and
 * moved to the dead letter queue (source `webhook` / `action_engine`, metadata `deliveryJobId`), whose replay runs this row
 * again. Before, webhook retries were three timers lost on a restart, a failed rule action was never run again, the outbox
 * handlers always reported success and nothing reached the dead letter queue.
 */
export type DeliveryKind = 'webhook' | 'rule_action';
export type DeliveryJob = typeof integrationDeliveryJobs.$inferSelect;

export interface DeliveryAttemptOutcome {
  ok: boolean;
  error?: string;
  /** false: retrying cannot help (e.g. a key the server cannot decrypt); the row goes to the dead letter queue at once */
  retryable?: boolean;
  /** the subscription or rule is gone or inactive: the row is closed without a dead letter */
  cancelled?: boolean;
}

export interface DeliveryAttemptContext {
  jobId: number;
  attempt: number;
}

export const RULE_ACTION_MAX_ATTEMPTS = 5;
const WEBHOOK_DEFAULT_ATTEMPTS = 3;
const MAX_ATTEMPTS_CAP = 10;
const STUCK_JOB_MINUTES = 5;

/** Delay before the next attempt after `attempt` failed ones: 5, 10, 20, 40 … seconds, at most 5 minutes */
export function deliveryBackoffSeconds(attempt: number): number {
  return Math.min(300, 5 * 2 ** Math.max(0, attempt - 1));
}

/** Attempts of a webhook subscription's delivery: its retry limit (default 3), between 1 and 10 */
export function webhookMaxAttempts(retryLimit: number | null | undefined): number {
  const limit = Math.trunc(Number(retryLimit)) || WEBHOOK_DEFAULT_ATTEMPTS;
  return Math.min(MAX_ATTEMPTS_CAP, Math.max(1, limit));
}

/** The dead letter row of one delivery: the event id with the delivery's target, so each failed delivery has its own row */
export function deliveryDeadLetterId(job: Pick<DeliveryJob, 'kind' | 'targetId' | 'eventId'>): string {
  return `${job.eventId}#${job.kind === 'webhook' ? 'webhook' : 'rule'}:${job.targetId}`;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function eventOf(job: DeliveryJob): BaseDomainEvent {
  return job.event as BaseDomainEvent;
}

export class IntegrationDeliveryService {
  private static workerIntervalId: NodeJS.Timeout | null = null;
  private static recoveryIntervalId: NodeJS.Timeout | null = null;
  private static isProcessing = false;

  /** Records one delivery; an existing row of the same (kind, target, event) is kept and returned unchanged */
  static async enqueue(kind: DeliveryKind, targetId: number, event: BaseDomainEvent, maxAttempts: number): Promise<DeliveryJob> {
    const [inserted] = await orm.insert(integrationDeliveryJobs).values({
      kind,
      targetId,
      eventId: event.eventId,
      eventType: event.eventType,
      event,
      maxAttempts: Math.max(1, maxAttempts),
    }).onConflictDoNothing().returning();
    if (inserted) return inserted;
    const [existing] = await orm.select().from(integrationDeliveryJobs).where(and(
      eq(integrationDeliveryJobs.kind, kind),
      eq(integrationDeliveryJobs.targetId, targetId),
      eq(integrationDeliveryJobs.eventId, event.eventId),
    ));
    if (!existing) throw new Error(`Delivery job ${kind}/${targetId}/${event.eventId} was neither inserted nor found`);
    return existing;
  }

  /** Takes a pending row whose time has come (row lock, skipped when another worker holds it) and counts the attempt */
  private static async claim(jobId: number): Promise<DeliveryJob | null> {
    return orm.transaction(async (tx) => {
      const [job] = await tx.select().from(integrationDeliveryJobs).where(and(
        eq(integrationDeliveryJobs.id, jobId),
        eq(integrationDeliveryJobs.status, 'pending'),
        lte(integrationDeliveryJobs.nextAttemptAt, sql`now()`),
      )).for('update', { skipLocked: true });
      if (!job) return null;
      const [claimed] = await tx.update(integrationDeliveryJobs)
        .set({ status: 'processing', attempts: job.attempts + 1, lockedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(integrationDeliveryJobs.id, job.id))
        .returning();
      return claimed ?? null;
    });
  }

  /** Runs one attempt of the row when it is pending and due; otherwise does nothing */
  static async runJob(jobId: number): Promise<DeliveryAttemptOutcome | null> {
    const job = await this.claim(jobId);
    if (!job) return null;
    return this.attempt(job, false);
  }

  private static async execute(job: DeliveryJob): Promise<DeliveryAttemptOutcome> {
    const context = { jobId: job.id, attempt: job.attempts };
    try {
      if (job.kind === 'webhook') {
        const { WebhookSubscriptionService } = await import('./webhookSubscriptionService.js');
        return await WebhookSubscriptionService.deliverJobAttempt(job.targetId, eventOf(job), context);
      }
      const { EventActionEngineService } = await import('./eventActionEngineService.js');
      return await EventActionEngineService.runRuleActionAttempt(job.targetId, eventOf(job), context);
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  }

  /** One attempt of a claimed row and its result: done, cancelled, retried later, or failed (dead letter unless a replay) */
  private static async attempt(job: DeliveryJob, replay: boolean): Promise<DeliveryAttemptOutcome> {
    const outcome = await this.execute(job);
    if (outcome.ok) {
      await orm.update(integrationDeliveryJobs)
        .set({ status: 'succeeded', lockedAt: null, lastError: '', updatedAt: sql`now()` })
        .where(eq(integrationDeliveryJobs.id, job.id));
      return outcome;
    }
    const error = outcome.error || 'Unknown delivery error';
    if (outcome.cancelled) {
      await orm.update(integrationDeliveryJobs)
        .set({ status: 'cancelled', lockedAt: null, lastError: error, updatedAt: sql`now()` })
        .where(eq(integrationDeliveryJobs.id, job.id));
      logger.info(`[Integration Delivery] Job #${job.id} (${job.kind} #${job.targetId}) cancelled: ${error}`);
      return outcome;
    }
    const final = replay || outcome.retryable === false || job.attempts >= job.maxAttempts;
    if (!final) {
      const nextAttemptAt = new Date(Date.now() + deliveryBackoffSeconds(job.attempts) * 1000).toISOString();
      await orm.update(integrationDeliveryJobs)
        .set({ status: 'pending', lockedAt: null, lastError: error, nextAttemptAt, updatedAt: sql`now()` })
        .where(eq(integrationDeliveryJobs.id, job.id));
      logger.warn(`[Integration Delivery] Job #${job.id} (${job.kind} #${job.targetId}) attempt ${job.attempts}/${job.maxAttempts} failed, retry at ${nextAttemptAt}: ${error}`);
      return outcome;
    }
    await orm.update(integrationDeliveryJobs)
      .set({ status: 'failed', lockedAt: null, lastError: error, updatedAt: sql`now()` })
      .where(eq(integrationDeliveryJobs.id, job.id));
    logger.error(`[Integration Delivery] Job #${job.id} (${job.kind} #${job.targetId}) failed after ${job.attempts} attempt(s): ${error}`);
    // a failed replay stays in its dead letter row, which records the new failure itself
    if (!replay) await this.moveToDeadLetter(job, error);
    return outcome;
  }

  private static async moveToDeadLetter(job: DeliveryJob, error: string): Promise<void> {
    const event = eventOf(job);
    const target = job.kind === 'webhook' ? `اشتراک وب‌هوک #${job.targetId}` : `اقدام قانون خودکار #${job.targetId}`;
    await DeadLetterQueueService.moveToDeadLetter({
      originalEventId: deliveryDeadLetterId(job),
      eventType: job.eventType,
      aggregateType: String(event.aggregateType ?? ''),
      aggregateId: String(event.aggregateId ?? ''),
      source: job.kind === 'webhook' ? 'webhook' : 'action_engine',
      payload: event.payload ?? {},
      metadata: { ...((event.metadata as unknown as Record<string, unknown>) || {}), deliveryJobId: job.id, deliveryKind: job.kind, deliveryTargetId: job.targetId, originalEventId: job.eventId },
      failureReason: `تحویل به ${target} پس از ${job.attempts} تلاش انجام نشد: ${error}`,
      retryCount: job.attempts,
    }).catch(err => logger.error(`[Integration Delivery] Job #${job.id} could not be moved to the dead letter queue: ${errorText(err)}`));
  }

  /**
   * Replay of a delivery's dead letter row (under that row's lock): one more attempt now, with the edited payload when one
   * is given. A row being attempted is refused (409); a delivered one needs nothing.
   */
  static async replayDeadJob(jobId: number, payload?: unknown): Promise<DeliveryAttemptOutcome> {
    const [job] = await orm.select().from(integrationDeliveryJobs).where(eq(integrationDeliveryJobs.id, jobId));
    if (!job) throw new NotFoundError(`ردیف تحویل #${jobId} یافت نشد.`, undefined, 'DELIVERY_JOB_NOT_FOUND');
    if (job.status === 'succeeded') return { ok: true };
    const event = payload === undefined || payload === null ? eventOf(job) : { ...eventOf(job), payload };
    const [claimed] = await orm.update(integrationDeliveryJobs)
      .set({ status: 'processing', attempts: job.attempts + 1, event, lockedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(integrationDeliveryJobs.id, job.id), eq(integrationDeliveryJobs.status, job.status), inArray(integrationDeliveryJobs.status, ['pending', 'failed', 'cancelled'])))
      .returning();
    if (!claimed) throw new ConflictError(`ردیف تحویل #${jobId} هم‌اکنون در حال ارسال است؛ پس از پایان آن دوباره بکوشید.`, undefined, 'DELIVERY_JOB_BUSY');
    return this.attempt(claimed, true);
  }

  /** Puts failed deliveries back in the queue (requeue of the dead letter queue, in the caller's transaction) */
  static async requeueDeadJobs(tx: DbTransaction, jobIds: number[]): Promise<number> {
    if (jobIds.length === 0) return 0;
    const rows = await tx.update(integrationDeliveryJobs)
      .set({ status: 'pending', attempts: 0, nextAttemptAt: sql`now()`, lockedAt: null, updatedAt: sql`now()` })
      .where(and(inArray(integrationDeliveryJobs.id, jobIds), inArray(integrationDeliveryJobs.status, ['failed', 'cancelled'])))
      .returning({ id: integrationDeliveryJobs.id });
    return rows.length;
  }

  /** One pass of the worker: the due rows, oldest first */
  static async processDueJobs(batchSize = 20): Promise<number> {
    if (this.isProcessing) return 0;
    this.isProcessing = true;
    try {
      const due = await orm.select({ id: integrationDeliveryJobs.id }).from(integrationDeliveryJobs)
        .where(and(eq(integrationDeliveryJobs.status, 'pending'), lte(integrationDeliveryJobs.nextAttemptAt, sql`now()`)))
        .orderBy(asc(integrationDeliveryJobs.nextAttemptAt), asc(integrationDeliveryJobs.id))
        .limit(batchSize);
      const results = await Promise.allSettled(due.map(row => this.runJob(row.id)));
      for (const r of results) {
        if (r.status === 'rejected') logger.error(`[Integration Delivery] Worker attempt error: ${errorText(r.reason)}`);
      }
      return results.filter(r => r.status === 'fulfilled' && r.value !== null).length;
    } finally {
      this.isProcessing = false;
    }
  }

  /** A row left `processing` by a stopped server goes back to the queue (its attempt is counted) */
  static async recoverStuckJobs(stuckMinutes = STUCK_JOB_MINUTES): Promise<number> {
    const cutoff = new Date(Date.now() - stuckMinutes * 60 * 1000).toISOString();
    const rows = await orm.update(integrationDeliveryJobs)
      .set({ status: 'pending', lockedAt: null, nextAttemptAt: sql`now()`, lastError: 'Reset to pending by recovery (stuck in processing)', updatedAt: sql`now()` })
      .where(and(eq(integrationDeliveryJobs.status, 'processing'), lte(integrationDeliveryJobs.lockedAt, cutoff)))
      .returning({ id: integrationDeliveryJobs.id });
    if (rows.length > 0) logger.warn(`[Integration Delivery] Recovered ${rows.length} job(s) stuck in processing`);
    return rows.length;
  }

  static startWorker(intervalMs = 5000): void {
    if (this.workerIntervalId) return;
    this.workerIntervalId = setInterval(() => {
      this.processDueJobs().catch(err => logger.error(`[Integration Delivery] Worker error: ${errorText(err)}`));
    }, intervalMs);
    this.recoveryIntervalId = setInterval(() => {
      this.recoverStuckJobs().catch(err => logger.error(`[Integration Delivery] Recovery error: ${errorText(err)}`));
    }, 60000);
    logger.info(`[Integration Delivery] Worker started with interval ${intervalMs}ms`);
  }

  static stopWorker(): void {
    if (this.workerIntervalId) clearInterval(this.workerIntervalId);
    if (this.recoveryIntervalId) clearInterval(this.recoveryIntervalId);
    this.workerIntervalId = null;
    this.recoveryIntervalId = null;
  }
}
