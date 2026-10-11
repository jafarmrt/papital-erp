import { TestCaseResult, makeTestCase } from '../types.js';

/** Persian refusal of a private or reserved address by the SSRF guard. */
const PRIVATE_ADDRESS_REFUSAL = 'داخلی یا رزروشده';
/** Persian refusal of a scheme other than http / https. */
const PROTOCOL_REFUSAL = 'فقط نشانی‌های http و https';

/**
 * OBS-R2-05 (decision t5 A), v10.0.251: creating or editing a webhook subscription leaves every error to errorHandler.
 * An unsafe target address is a 422 `UNSAFE_TARGET_URL` with a Persian message, the answer's `error` is that same message, and a
 * missing subscription is a 404 `WEBHOOK_NOT_FOUND`. On v10.0.250 the route caught the guard's error itself: an unsafe address was a 400 with the English
 * `SSRF blocked: ...` sentence plus an `error` field, any other failure a 500 that echoed the raw error text,
 * and editing or switching a missing subscription a 500 from a plain `Error`.
 */
export async function runWebhookErrorContractTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_webhook_error_contract_obs_r2_05';
  if (!shouldRun(id, 'obs-r2-05', 'webhook', 'ssrf', 'errors', 'package15')) return results;

  const name = 'v10.0.251: an unsafe webhook address is a Persian 422 UNSAFE_TARGET_URL through errorHandler, never raw error text (OBS-R2-05)';
  const tStart = Date.now();
  const { createHarness } = await import('../security/workflowTestHarness.js');
  const h = await createHarness();
  const created: number[] = [];
  try {
    const manager = await h.sessionWith(['events.view', 'events.manage']);
    const wrong: string[] = [];
    const refusedProperly = (label: string, res: { status: number; body?: Record<string, unknown> }, mark: string) => {
      const message = String(res.body?.message ?? '');
      if (res.status !== 422 || res.body?.code !== 'UNSAFE_TARGET_URL' || !message.includes(mark) || res.body?.error !== message) {
        wrong.push(`${label}: ${res.status} ${JSON.stringify(res.body)}`);
      }
    };

    const base = { name: `OBS-R2-05 ${h.tag}`, eventPatterns: ['*'] };
    refusedProperly('create to a private address', await h.post('/api/events/webhooks', { ...base, targetUrl: 'http://10.1.2.3/hook' }, manager), PRIVATE_ADDRESS_REFUSAL);
    refusedProperly('create with ftp', await h.post('/api/events/webhooks', { ...base, targetUrl: 'ftp://files.example.com/hook' }, manager), PROTOCOL_REFUSAL);

    const ok = await h.post('/api/events/webhooks', { ...base, targetUrl: 'https://obs-r2-05.example.com/hook' }, manager);
    const subId = Number((ok.body?.data as { id?: number } | undefined)?.id);
    if (ok.status !== 201 || !subId) wrong.push(`safe create: ${ok.status} ${JSON.stringify(ok.body)}`);
    else {
      created.push(subId);
      refusedProperly('edit to a loopback address', await h.put(`/api/events/webhooks/${subId}`, { targetUrl: 'http://127.0.0.1:9/x' }, manager), PRIVATE_ADDRESS_REFUSAL);
      const missing = await h.put('/api/events/webhooks/999999999', { name: 'x' }, manager);
      const toggleMissing = await h.post('/api/events/webhooks/999999999/toggle', {}, manager);
      if (toggleMissing.status !== 404 || toggleMissing.body?.code !== 'WEBHOOK_NOT_FOUND') wrong.push(`toggle a missing subscription: ${toggleMissing.status} ${toggleMissing.body?.code}`);
      if (missing.status !== 404 || missing.body?.code !== 'WEBHOOK_NOT_FOUND') wrong.push(`edit a missing subscription: ${missing.status} ${JSON.stringify(missing.body)}`);
    }

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'private / ftp create and loopback edit -> 422 UNSAFE_TARGET_URL in Persian (error = message); safe create 201; missing edit and toggle 404 WEBHOOK_NOT_FOUND',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    for (const subId of created) await h.q('DELETE FROM webhook_subscriptions WHERE id = $1', [subId]);
    await h.cleanup();
  }
  return results;
}
