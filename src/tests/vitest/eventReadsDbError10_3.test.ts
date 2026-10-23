// @vitest-environment node
/**
 * 10.3 (ARCH review, package 2 part 17): when the database failed, the event screens' reads answered as if there were
 * nothing: zero webhooks with a 100% success rate, an empty dead letter queue, an empty outbox, no matching records and
 * an empty timeline. Each read now passes the failure on, so the route answers with an error the screen shows.
 * 10.3 package 3: the read no longer logs it too; errorHandler writes the one log line (without the SQL text, TD-1320).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const { logged } = vi.hoisted(() => ({ logged: vi.fn() }));
vi.mock('../../db/drizzle.js', () => {
  // every query of the chain, awaited at any step, fails as a lost connection does
  const failing = () => Promise.reject(new Error('connection refused'));
  const chain: Record<string, unknown> = {};
  for (const step of ['from', 'where', 'groupBy', 'orderBy', 'limit', 'offset', 'innerJoin', 'leftJoin']) chain[step] = () => chain;
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => failing().then(resolve, reject);
  return { orm: { select: () => chain, transaction: failing } };
});
vi.mock('../../middleware/logger.js', () => ({ logger: { error: logged, info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

import { WebhookSubscriptionService } from '../../services/events/webhookSubscriptionService';
import { DeadLetterQueueService } from '../../services/events/deadLetterQueueService';
import { OutboxService } from '../../services/events/outboxService';
import { EventSourcingReplayService } from '../../services/events/eventSourcingReplayService';

afterEach(() => { logged.mockClear(); });

const READS: Array<[string, () => Promise<unknown>]> = [
  ['the webhook stats', () => WebhookSubscriptionService.getStats()],
  ['the webhook subscriptions', () => WebhookSubscriptionService.getSubscriptions()],
  ['the webhook deliveries', () => WebhookSubscriptionService.getDeliveries({ limit: 10 })],
  ['the dead letter stats', () => DeadLetterQueueService.getStats()],
  ['the dead letters', () => DeadLetterQueueService.getEvents({ limit: 10 })],
  ['the outbox stats', () => OutboxService.getOutboxStats()],
  ['the aggregate search', () => EventSourcingReplayService.searchAggregates('document', '', 10)],
  ['the aggregate timeline', () => EventSourcingReplayService.getAggregateTimeline('document', '21', { includeAudit: true })],
];

describe('event reads pass a database failure on (10.3)', () => {
  it.each(READS)('%s: a failed read is passed on once, never answered as empty or logged twice', async (_name, read) => {
    await expect(read()).rejects.toThrow('connection refused');
    expect(logged).not.toHaveBeenCalled();
  });
});
