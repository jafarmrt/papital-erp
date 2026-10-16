/**
 * Closing sweep, OBS-R2-16: a domain event recorded during a request carries the request's trace and correlation ids,
 * and its background dispatch (outbox worker, no request) runs its handlers under them. Red on v10.1.55.
 */
import { describe, expect, it } from 'vitest';
import { getRequestContext, requestContextStorage } from '../../lib/requestContext';
import { createDomainEvent } from '../../services/events/domainEvents';
import { domainEventBus } from '../../services/events/domainEventBus';

const ORIGIN = { requestId: 'req_obs16origin', correlationId: 'corr_obs16origin', startTime: 0 };

describe('OBS-R2-16 events keep their origin request', () => {
  it('obs_r2_16_event_carries_request_ids: an event made during a request names its trace and correlation ids', () => {
    const event = requestContextStorage.run(ORIGIN, () => createDomainEvent({
      eventType: 'StockIssued', aggregateType: 'Item', aggregateId: 1, payload: {},
    }));
    expect(event.metadata.requestId).toBe(ORIGIN.requestId);
    expect(event.metadata.correlationId).toBe(ORIGIN.correlationId);
    const outside = createDomainEvent({ eventType: 'StockIssued', aggregateType: 'Item', aggregateId: 1, payload: {} });
    expect(outside.metadata.requestId).toBeUndefined();
    expect(outside.metadata.correlationId).toBe(outside.eventId);
  });

  it('obs_r2_16_background_dispatch_context: a dispatch without a request runs its handlers under the origin request id', async () => {
    const type = 'ObsR2SixteenProbe';
    const seen: Array<string | undefined> = [];
    domainEventBus.subscribe(type, () => { seen.push(getRequestContext()?.requestId); }, 'obs-r2-16-probe');
    const event = requestContextStorage.run(ORIGIN, () => createDomainEvent({ eventType: type, aggregateType: 'Item', aggregateId: 1, payload: {} }));
    expect(getRequestContext()).toBeUndefined();
    const result = await domainEventBus.dispatchTracked(event);
    expect(result.failures).toEqual([]);
    expect(seen).toEqual([ORIGIN.requestId]);
    const replayed = await requestContextStorage.run({ requestId: 'req_obs16replay', correlationId: 'c', startTime: 0 }, () => domainEventBus.dispatchTracked(event));
    expect(replayed.failures).toEqual([]);
    expect(seen[1]).toBe('req_obs16replay');
  });
});
