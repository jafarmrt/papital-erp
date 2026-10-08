import request from 'supertest';
import { eq, inArray, like } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { webhookSubscriptions } from '../../db/schema.js';
import { decryptSecret } from '../../lib/secretBox.js';

/**
 * Package 15 (events and integrations), TD-720 / B15-18: a webhook created without a key gets the server's CSPRNG key, and
 * the timeout the form sends (`timeoutMs`) is stored, within 1 to 30 seconds. On v9.0.337 the create route read only
 * `timeoutSeconds`, so every entered timeout silently became 10 seconds, and any number was accepted on edit.
 */
export async function runWebhookKeyTimeoutTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_webhook_server_key_and_entered_timeout_td_720';
  if (!shouldRun(id, 'td720', 'b15-18', 'webhook', 'package15')) return results;

  const name = 'v9.0.338: a new webhook gets the server-made signing key and the entered timeout, and an out-of-range timeout is refused (TD-720)';
  const tStart = Date.now();
  const namePrefix = 'td720 webhook';
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const send = (method: 'post' | 'put', url: string, body: object) => request(app)[method](url)
      .set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body);
    const base = { targetUrl: 'https://partner-td720.example.com/hook', eventPatterns: ['*'] };
    const wrong: string[] = [];

    const created = await send('post', '/api/events/webhooks', { ...base, name: `${namePrefix} a`, timeoutMs: 15000 });
    const [row] = created.body?.data?.id
      ? await orm.select().from(webhookSubscriptions).where(eq(webhookSubscriptions.id, created.body.data.id))
      : [];
    if (created.status !== 201 || !row) wrong.push(`create: ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
    else {
      // stored encrypted since v9.0.340 (TD-898)
      const key = decryptSecret(row.secretKey) ?? '';
      if (!/^whsec_[0-9a-f]{48}$/.test(key)) wrong.push(`server key not made: ${key.slice(0, 10)}`);
      if (row.timeoutMs !== 15000) wrong.push(`entered timeout 15000 stored as ${row.timeoutMs}`);
    }

    for (const timeoutMs of [99999, 0, 'ten']) {
      const res = await send('post', '/api/events/webhooks', { ...base, name: `${namePrefix} bad ${timeoutMs}`, timeoutMs });
      if (res.status !== 422 || res.body?.code !== 'WEBHOOK_TIMEOUT_INVALID') wrong.push(`create timeout ${timeoutMs}: ${res.status} ${res.body?.code ?? ''}`);
    }
    if (row) {
      const edit = await send('put', `/api/events/webhooks/${row.id}`, { timeoutMs: 500 });
      const [after] = await orm.select({ t: webhookSubscriptions.timeoutMs }).from(webhookSubscriptions).where(eq(webhookSubscriptions.id, row.id));
      if (edit.status !== 422 || after?.t !== 15000) wrong.push(`edit timeout 500: ${edit.status}, stored ${after?.t}`);
    }
    const stray = await orm.select({ id: webhookSubscriptions.id }).from(webhookSubscriptions).where(like(webhookSubscriptions.name, `${namePrefix} bad%`));
    if (stray.length > 0) wrong.push(`${stray.length} refused webhook(s) stored`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'create without key -> whsec_ + 48 hex; timeoutMs 15000 stored; 99999 / 0 / text -> 422 WEBHOOK_TIMEOUT_INVALID, nothing stored; edit 500 -> 422, unchanged',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    const rows = await orm.select({ id: webhookSubscriptions.id }).from(webhookSubscriptions).where(like(webhookSubscriptions.name, `${namePrefix}%`));
    if (rows.length > 0) await orm.delete(webhookSubscriptions).where(inArray(webhookSubscriptions.id, rows.map(r => r.id))).catch(() => undefined);
  }
  return results;
}
