/**
 * Closing sweep (#300 review): «پردازش اکنون» drains the outbox outside the pressing request, so the handlers of each
 * event run under the request that recorded it (OBS-R2-16), not the system admin's request. Red on v10.1.65, where
 * the route drained the queue inside its own request.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRequestContext, requestContextStorage } from '../../lib/requestContext';
import { OutboxService } from '../../services/events/outboxService';

afterEach(() => { vi.restoreAllMocks(); });

describe('outbox process-now runs as the worker', () => {
  it('outbox_process_now_leaves_request_context: the batch sees no request context of the admin who pressed it', async () => {
    const seen: Array<string | undefined> = [];
    vi.spyOn(OutboxService, 'processPendingBatch').mockImplementation(async () => {
      await Promise.resolve();
      seen.push(getRequestContext()?.requestId);
      return { processed: 0, succeeded: 0, failed: 0 };
    });
    const admin = { requestId: 'req_admin_press', correlationId: 'corr_admin_press', startTime: 0 };
    await requestContextStorage.run(admin, () => OutboxService.processPendingBatchAsWorker(5));
    expect(OutboxService.processPendingBatch).toHaveBeenCalledWith(5);
    expect(seen).toEqual([undefined]);
  });
});
