import { TestCaseResult, makeTestCase } from '../types.js';

/**
 * OBS-R2-05 (decision t5 A), part 2, v10.0.254: the events routes answer their own refusals through errorHandler, so
 * every error carries the uniform schema (`code`, `traceId`, `message` and `error`). On v10.0.253 eight of them were
 * hand-written `res.status(4xx).json({ success: false, message })` answers without a code or trace id.
 */
export async function runEventsErrorContractTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_events_error_contract_obs_r2_05';
  if (!shouldRun(id, 'obs-r2-05', 'events', 'errors', 'package15')) return results;

  const name = 'v10.0.254: events route refusals carry the uniform error schema with code and trace id (OBS-R2-05)';
  const tStart = Date.now();
  const { createHarness } = await import('../security/workflowTestHarness.js');
  const h = await createHarness();
  try {
    const manager = await h.sessionWith(['events.view', 'events.manage']);
    const wrong: string[] = [];
    const expectError = (label: string, res: { status: number; body?: Record<string, unknown> }, status: number, code: string) => {
      const b = res.body ?? {};
      if (res.status !== status || b.code !== code || typeof b.traceId !== 'string' || !b.message || b.error !== b.message) {
        wrong.push(`${label}: ${res.status} ${JSON.stringify(b)}`);
      }
    };
    expectError('missing rule', await h.get('/api/events/action-rules/999999999', manager), 404, 'EVENT_RULE_NOT_FOUND');
    expectError('missing webhook', await h.get('/api/events/webhooks/999999999', manager), 404, 'WEBHOOK_NOT_FOUND');
    expectError('timeline without id', await h.get('/api/events/timeline?type=document', manager), 400, 'BAD_REQUEST');
    expectError('aggregates without type', await h.get('/api/events/timeline/aggregates', manager), 400, 'BAD_REQUEST');

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'missing rule / webhook -> 404 with their codes; timeline and aggregates without parameters -> 400 BAD_REQUEST; each with traceId',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    await h.cleanup();
  }
  return results;
}
