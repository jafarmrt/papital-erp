import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { eventActionRules, roles, users, webhookSubscriptions } from '../../db/schema.js';
import { decryptSecret } from '../../lib/secretBox.js';

/**
 * Package 15 (events and integrations), TD-710 / B15-08 (decision t6 a): the webhook signing key, the rule token and the
 * partner header values are masked in every answer, for every user and the admin too; the key is shown once, by create and
 * rotate-secret; a masked value on save keeps the stored one, only for the stored address. On v9.0.359 the toggle and PUT
 * answers returned the full key to an events.manage holder, and an events.view reader saw the partner API token in
 * `customHeaders` and the rule's `secretToken` (in the rule list and the replay simulation too).
 */
const MASK = '********';
const PARTNER_TOKEN = 'Bearer PARTNER-API-TOKEN-TD710';
const RULE_TOKEN = 'tok_td710_rule_partner_secret';
const RULE_HEADER = 'Bearer RULE-HEADER-TD710';

export async function runWebhookSecretMaskTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_webhook_secrets_masked_in_every_response_td_710';
  if (!shouldRun(id, 'td710', 'b15-08', 'webhook', 'package15')) return results;

  const name = 'v9.0.360: webhook key, rule token and partner headers are masked in every answer, shown once on create and rotate, and kept on a masked save (TD-710)';
  const tStart = Date.now();
  const roleIds: number[] = [];
  const userIds: number[] = [];
  const subIds: number[] = [];
  const ruleIds: number[] = [];
  try {
    const { getTestApp, getAdminSession, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestRole, createTestUser } = await import('../fixtures/factories.js');
    const app = await getTestApp();
    type Session = { cookie: string; csrfToken: string };
    const userWith = async (permissions: string[]): Promise<Session> => {
      const role = await createTestRole({ permissions });
      roleIds.push(role.id);
      const user = await createTestUser({ role: role.code });
      userIds.push(user.id);
      return loginTestUserWithSession(app, user.username);
    };
    const admin = await getAdminSession();
    const viewer = await userWith(['events.view']);
    const manager = await userWith(['events.view', 'events.manage']);
    const send = (who: Session, method: 'get' | 'post' | 'put', url: string, body?: object) => {
      const r = request(app)[method](url).set('Cookie', who.cookie).set('x-csrf-token', who.csrfToken);
      return body === undefined ? r : r.send(body);
    };
    const wrong: string[] = [];
    const leaks = (label: string, body: unknown, secrets: string[]) => {
      const text = JSON.stringify(body);
      for (const secret of secrets) if (text.includes(secret)) wrong.push(`${label} leaks ${secret.slice(0, 14)}…`);
    };

    // 1. webhook: create shows the key once, every other answer masks the key and the header values
    const targetUrl = 'https://partner-td710.example.com/hook';
    const created = await send(admin, 'post', '/api/events/webhooks', {
      name: 'td710 partner', targetUrl, eventPatterns: ['*'], customHeaders: { Authorization: PARTNER_TOKEN },
    });
    const subId = Number(created.body?.data?.id);
    if (subId) subIds.push(subId);
    const createdKey = String(created.body?.data?.secretKey ?? '');
    if (created.status !== 201 || !/^whsec_[0-9a-f]{48}$/.test(createdKey) || created.body?.data?.customHeaders?.Authorization !== MASK) {
      wrong.push(`create: ${created.status} key ${createdKey.slice(0, 10)} header ${created.body?.data?.customHeaders?.Authorization}`);
    }
    const listViewer = await send(viewer, 'get', '/api/events/webhooks');
    const oneViewer = await send(viewer, 'get', `/api/events/webhooks/${subId}`);
    const listAdmin = await send(admin, 'get', '/api/events/webhooks');
    const toggled = await send(manager, 'post', `/api/events/webhooks/${subId}/toggle`, {});
    const putEmpty = await send(manager, 'put', `/api/events/webhooks/${subId}`, {});
    for (const [label, res] of [['viewer list', listViewer], ['viewer get', oneViewer], ['admin list', listAdmin], ['manager toggle', toggled], ['manager PUT {}', putEmpty]] as const) {
      if (res.status !== 200) wrong.push(`${label}: ${res.status}`);
      leaks(label, res.body, [createdKey, PARTNER_TOKEN]);
    }
    if (oneViewer.body?.data?.secretKey !== MASK || oneViewer.body?.data?.customHeaders?.Authorization !== MASK) {
      wrong.push(`viewer get not masked: ${JSON.stringify(oneViewer.body?.data).slice(0, 160)}`);
    }

    // 2. a masked header value is kept for the same address and refused for another one
    const keepHeaders = await send(manager, 'put', `/api/events/webhooks/${subId}`, { name: 'td710 renamed', customHeaders: { Authorization: MASK } });
    const otherUrl = await send(manager, 'put', `/api/events/webhooks/${subId}`, { targetUrl: 'https://collector-td710.example.com/x', customHeaders: { Authorization: MASK } });
    const urlOnly = await send(manager, 'put', `/api/events/webhooks/${subId}`, { targetUrl: 'https://collector-td710.example.com/x' });
    const [subRow] = await orm.select().from(webhookSubscriptions).where(eq(webhookSubscriptions.id, subId));
    // stored encrypted since v9.0.361 (TD-898)
    if (keepHeaders.status !== 200 || decryptSecret((subRow?.customHeaders as Record<string, string>)?.Authorization) !== PARTNER_TOKEN) {
      wrong.push(`masked header same address: ${keepHeaders.status}, stored ${JSON.stringify(subRow?.customHeaders)}`);
    }
    for (const [label, res] of [['masked header other address', otherUrl], ['other address without headers', urlOnly]] as const) {
      if (res.status !== 422 || res.body?.code !== 'INTEGRATION_SECRET_REENTRY_REQUIRED') wrong.push(`${label}: ${res.status} ${res.body?.code ?? ''}`);
    }
    if (subRow?.targetUrl !== targetUrl) wrong.push(`target changed to ${subRow?.targetUrl}`);

    // 3. rotate-secret shows a new key once and stores it
    const rotated = await send(manager, 'post', `/api/events/webhooks/${subId}/rotate-secret`, {});
    const newKey = String(rotated.body?.data?.secretKey ?? '');
    const [afterRotate] = await orm.select({ k: webhookSubscriptions.secretKey }).from(webhookSubscriptions).where(eq(webhookSubscriptions.id, subId));
    if (rotated.status !== 200 || !/^whsec_[0-9a-f]{48}$/.test(newKey) || newKey === createdKey || decryptSecret(afterRotate?.k) !== newKey) {
      wrong.push(`rotate: ${rotated.status} new key ${newKey.slice(0, 10)}, stored ${String(afterRotate?.k).slice(0, 10)}`);
    }

    // 4. rules: token and header values masked for every reader, a masked save keeps them only for the same address
    const ruleUrl = 'https://rules-td710.example.com/in';
    const ruleCreated = await send(admin, 'post', '/api/events/action-rules', {
      name: 'td710 rule', eventType: 'InvoiceApproved', actionType: 'webhook', isActive: 0,
      actionConfigJson: { url: ruleUrl, secretToken: RULE_TOKEN, headers: { Authorization: RULE_HEADER } },
    });
    const ruleId = Number(ruleCreated.body?.data?.id);
    if (ruleId) ruleIds.push(ruleId);
    const rulesViewer = await send(viewer, 'get', '/api/events/action-rules');
    const ruleViewer = await send(viewer, 'get', `/api/events/action-rules/${ruleId}`);
    const ruleToggled = await send(manager, 'post', `/api/events/action-rules/${ruleId}/toggle`, {});
    for (const [label, res] of [['rule create', ruleCreated], ['viewer rules', rulesViewer], ['viewer rule', ruleViewer], ['rule toggle', ruleToggled]] as const) {
      if (res.status !== 200 && res.status !== 201) wrong.push(`${label}: ${res.status}`);
      leaks(label, res.body, [RULE_TOKEN, RULE_HEADER]);
    }
    const replay = await send(manager, 'post', '/api/events/timeline/simulate-replay', { eventType: 'InvoiceApproved', aggregateType: 'Document', aggregateId: '1', dryRun: true });
    if (replay.status !== 200 || !JSON.stringify(replay.body).includes('td710 rule')) wrong.push(`replay simulation: ${replay.status} ${JSON.stringify(replay.body).slice(0, 120)}`);
    leaks('replay simulation', replay.body, [RULE_TOKEN, RULE_HEADER]);
    const masked = ruleViewer.body?.data?.actionConfigJson;
    if (masked?.secretToken !== MASK || masked?.headers?.Authorization !== MASK) wrong.push(`viewer rule not masked: ${JSON.stringify(masked)}`);
    const ruleSave = await send(manager, 'put', `/api/events/action-rules/${ruleId}`, { name: 'td710 rule renamed', actionConfigJson: masked });
    const ruleMoved = await send(manager, 'put', `/api/events/action-rules/${ruleId}`, { actionConfigJson: { ...masked, url: 'https://collector-td710.example.com/r' } });
    const [ruleRow] = await orm.select().from(eventActionRules).where(eq(eventActionRules.id, ruleId));
    const storedConfig = ruleRow?.actionConfigJson as { url?: string; secretToken?: string; headers?: Record<string, string> } | undefined;
    if (ruleSave.status !== 200 || storedConfig?.secretToken !== RULE_TOKEN || storedConfig?.headers?.Authorization !== RULE_HEADER || storedConfig?.url !== ruleUrl) {
      wrong.push(`masked rule save: ${ruleSave.status}, stored ${JSON.stringify(storedConfig)}`);
    }
    leaks('rule save', ruleSave.body, [RULE_TOKEN, RULE_HEADER]);
    if (ruleMoved.status !== 422 || ruleMoved.body?.code !== 'INTEGRATION_SECRET_REENTRY_REQUIRED') wrong.push(`masked rule to another address: ${ruleMoved.status} ${ruleMoved.body?.code ?? ''}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'create / rotate show the key once; viewer, admin, toggle and PUT answers mask key and headers; rules mask token and headers; masked save keeps values for the same address, 422 for another',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (ruleIds.length > 0) await orm.delete(eventActionRules).where(inArray(eventActionRules.id, ruleIds)).catch(() => undefined);
    if (subIds.length > 0) await orm.delete(webhookSubscriptions).where(inArray(webhookSubscriptions.id, subIds)).catch(() => undefined);
    if (userIds.length > 0) await orm.update(users).set({ isDeleted: 1 }).where(inArray(users.id, userIds)).catch(() => undefined);
    if (roleIds.length > 0) await orm.delete(roles).where(inArray(roles.id, roleIds)).catch(() => undefined);
  }
  return results;
}
