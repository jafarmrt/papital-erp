import crypto from 'node:crypto';
import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { roles, users, webhookSubscriptions } from '../../db/schema.js';
import { decryptSecret } from '../../lib/secretBox.js';
import { deleteTestRoles } from '../fixtures/roleCleanup.js';

/**
 * Package 15 (events and integrations), TD-719 / B15-17: editing a webhook keeps its signing key when the form sends the
 * masked key, and «test ping» of a saved webhook signs with the stored key. On v9.0.357 a non-admin manager's save sent the
 * masked «****…abcd» back and the service stored it, so every receiver's HMAC check broke, and the ping needed the key in the
 * body (the masked one, or the fixed 'test_secret_key'). fetch is stubbed, so no request leaves the test.
 */
export async function runWebhookSecretEditTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_webhook_edit_keeps_signing_key_and_ping_uses_it_td_719';
  if (!shouldRun(id, 'td719', 'b15-17', 'webhook', 'package15')) return results;

  const name = 'v9.0.358: a webhook edit with the masked key keeps the stored signing key and the ping of a saved webhook signs with it (TD-719)';
  const tStart = Date.now();
  const storedKey = 'whsec_td719_stored_signing_key_0123456789abcdef';
  const targetUrl = 'https://partner-td719.example.com/hooks/erp';
  const realFetch = globalThis.fetch;
  const sent: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const roleIds: number[] = [];
  const userIds: number[] = [];
  let subscriptionId = 0;
  try {
    const { getTestApp, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestRole, createTestUser } = await import('../fixtures/factories.js');
    const { WebhookSubscriptionService } = await import('../../services/events/webhookSubscriptionService.js');
    const app = await getTestApp();
    const role = await createTestRole({ permissions: ['events.view', 'events.manage'] });
    roleIds.push(role.id);
    const manager = await createTestUser({ role: role.code });
    userIds.push(manager.id);
    const session = await loginTestUserWithSession(app, manager.username);
    const send = (method: 'post' | 'put', url: string, body: object) => request(app)[method](url)
      .set('Cookie', session.cookie).set('x-csrf-token', session.csrfToken).send(body);

    const sub = await WebhookSubscriptionService.createSubscription({
      name: 'td719 partner', targetUrl, secretKey: storedKey, eventPatterns: ['*'], customHeaders: { 'X-Partner-Id': 'td719' },
    });
    subscriptionId = sub.id;
    // the key is stored encrypted since v9.0.361 (TD-898)
    const storedKeyNow = async () => decryptSecret((await orm.select({ k: webhookSubscriptions.secretKey }).from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.id, subscriptionId)))[0]?.k);
    const wrong: string[] = [];

    // 1. a save with the masked key (old non-admin mask, full mask, empty) keeps the stored key
    for (const secretKey of ['**********************abcd', '********', '']) {
      const res = await send('put', `/api/events/webhooks/${subscriptionId}`, { name: `td719 renamed ${secretKey.length}`, secretKey });
      const now = await storedKeyNow();
      if (res.status !== 200 || now !== storedKey) wrong.push(`PUT secretKey ${JSON.stringify(secretKey)}: ${res.status}, stored key now ${now}`);
    }

    // 2. the ping of the saved webhook goes to its stored address, signed with the stored key and with its stored headers
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      sent.push({ url: String(input), headers: { ...(init?.headers as Record<string, string>) }, body: String(init?.body ?? '') });
      return new Response('ok', { status: 200 });
    }) as typeof fetch;
    const ping = await send('post', '/api/events/webhooks/ping', { subscriptionId });
    const delivered = sent[0];
    const expected = delivered ? crypto.createHmac('sha256', storedKey).update(delivered.body, 'utf8').digest('hex') : '';
    if (ping.status !== 200 || ping.body?.keySource !== 'stored' || !delivered || delivered.url !== targetUrl
      || delivered.headers['X-ERP-Signature-256'] !== expected || delivered.headers['X-Partner-Id'] !== 'td719') {
      wrong.push(`ping by id: ${ping.status} ${JSON.stringify(ping.body).slice(0, 200)}, sent ${JSON.stringify(delivered ?? null).slice(0, 300)}`);
    }

    // 3. a draft ping without a key is signed with a one-time key, never the fixed 'test_secret_key'
    sent.length = 0;
    const draft = await send('post', '/api/events/webhooks/ping', { targetUrl: 'https://draft-td719.example.com/hook' });
    const draftSent = sent[0];
    const fixedKeySignature = draftSent ? crypto.createHmac('sha256', 'test_secret_key').update(draftSent.body, 'utf8').digest('hex') : '';
    if (draft.status !== 200 || draft.body?.keySource !== 'temporary' || !draftSent || draftSent.headers['X-ERP-Signature-256'] === fixedKeySignature) {
      wrong.push(`draft ping: ${draft.status} keySource ${draft.body?.keySource}, signed with the fixed key ${draftSent?.headers['X-ERP-Signature-256'] === fixedKeySignature}`);
    }

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'PUT with masked / empty key -> stored key kept; ping by id -> stored address, HMAC with the stored key, stored headers; draft ping -> one-time key',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    globalThis.fetch = realFetch;
    if (subscriptionId) await orm.delete(webhookSubscriptions).where(eq(webhookSubscriptions.id, subscriptionId)).catch(() => undefined);
    if (userIds.length > 0) await orm.update(users).set({ isDeleted: 1 }).where(inArray(users.id, userIds)).catch(() => undefined);
    if (roleIds.length > 0) await deleteTestRoles(inArray(roles.id, roleIds)).catch(() => undefined);
  }
  return results;
}
