import type { DbTransaction } from '../../db/drizzle.js';
import type { deadLetterEvents } from '../../db/schema.js';

type DeadLetterRow = Pick<typeof deadLetterEvents.$inferSelect, 'source' | 'metadata'>;

/**
 * v9.0.365 (TD-705): a dead letter row of one integration delivery (a webhook subscription or a rule action for one event)
 * carries its delivery row in `metadata.deliveryJobId`; its replay and requeue run that delivery, never the whole event.
 */
export function deadLetterDeliveryJobId(record: DeadLetterRow): number | null {
  if (record.source !== 'webhook' && record.source !== 'action_engine') return null;
  const jobId = Number((record.metadata as Record<string, unknown> | null)?.deliveryJobId);
  return Number.isInteger(jobId) && jobId > 0 ? jobId : null;
}

/** One more attempt of the failed delivery itself (with the row's payload); a failure throws with its reason */
export async function replayDeliveryDeadLetter(jobId: number, payload: unknown): Promise<void> {
  const { IntegrationDeliveryService } = await import('./integrationDelivery.service.js');
  const outcome = await IntegrationDeliveryService.replayDeadJob(jobId, payload);
  if (!outcome.ok) throw new Error(outcome.error || 'Delivery failed again');
}

/** Puts the delivery rows among `rows` back in their own queue (caller's transaction) and returns the rest, for the outbox */
export async function requeueDeliveryDeadLetters<T extends DeadLetterRow>(tx: DbTransaction, rows: T[]): Promise<T[]> {
  const jobIds = rows.map(deadLetterDeliveryJobId).filter((jobId): jobId is number => jobId !== null);
  if (jobIds.length > 0) {
    const { IntegrationDeliveryService } = await import('./integrationDelivery.service.js');
    await IntegrationDeliveryService.requeueDeadJobs(tx, jobIds);
  }
  return rows.filter(row => deadLetterDeliveryJobId(row) === null);
}
