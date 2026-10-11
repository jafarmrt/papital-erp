import http from 'node:http';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { and, eq, inArray, like } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { setProbeEventPatterns } from '../fixtures/eventProbe.js';
import { orm } from '../../db/drizzle.js';
import { appSettings, roles, users, webhookDeliveries, webhookSubscriptions } from '../../db/schema.js';
import { decryptSecret, isEncryptedSecret } from '../../lib/secretBox.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { deleteTestRoles } from '../fixtures/roleCleanup.js';

/**
 * Package 15 (events and integrations), TD-898 (observation 11, decision t7 a): the WooCommerce consumer key and secret,
 * the WooCommerce webhook secret and every webhook subscription's signing key and custom header values are stored with
 * `encryptSecret` and decrypted only inside the server; a value the current ERP_SECRETS_KEY cannot decrypt is never sent
 * (failed delivery, 503 on ping and on the WooCommerce connection, the WooCommerce webhook fails); without the key nothing
 * new is stored (503); `npm run secrets:encrypt` encrypts legacy plain values. On v9.0.360 all of them were plain text in
 * `app_settings` and `webhook_subscriptions`, readable from any backup or database reader.
 */
const WC_KEYS = ['wc_consumer_key', 'wc_consumer_secret', 'wc_webhook_secret', 'wc_store_url'] as const;
const PLAIN = {
  wc_consumer_key: 'ck_td898_consumer_key_0123456789abcdef',
  wc_consumer_secret: 'cs_td898_consumer_secret_0123456789abcdef',
  wc_webhook_secret: 'whs_td898_woocommerce_webhook_secret',
};
const PARTNER_HEADER = 'X-TD898-Partner';
const PARTNER_TOKEN = 'Bearer PARTNER-API-TOKEN-TD898';
const EVENT_TYPE = 'td898.secret_check';
const MASK = '********';
const TEST_KEY = 'td898-test-secrets-key-at-least-32-characters';
const OTHER_KEY = 'td898-another-secrets-key-at-least-32-characters';

type Captured = { headers: http.IncomingHttpHeaders; body: string };

export async function runIntegrationSecretsAtRestTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_integration_secrets_encrypted_at_rest_td_898';
  if (!shouldRun(id, 'td898', 'secrets', 'webhook', 'woocommerce', 'package15')) return results;

  const name = 'v9.0.361: WooCommerce keys and webhook signing keys and headers are stored encrypted, used decrypted inside the server and never sent when they cannot be decrypted (TD-898)';
  const tStart = Date.now();
  const savedEnvKey = process.env.ERP_SECRETS_KEY;
  const savedPort = process.env.PORT;
  const savedSettings = await orm.select().from(appSettings).where(inArray(appSettings.key, [...WC_KEYS]));
  const roleIds: number[] = [];
  const userIds: number[] = [];
  const captured: Captured[] = [];
  const echo = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      captured.push({ headers: req.headers, body });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  const namePrefix = 'td898 webhook';
  try {
    process.env.ERP_SECRETS_KEY = savedEnvKey && savedEnvKey.trim().length >= 32 ? savedEnvKey : TEST_KEY;
    const echoPort = await new Promise<number>(resolve => echo.listen(0, '127.0.0.1', () => resolve((echo.address() as AddressInfo).port)));
    process.env.PORT = String(echoPort); // the local server stands in for this server's own echo endpoint
    const targetUrl = `http://127.0.0.1:${echoPort}/api/events/webhook-echo`;

    const { getTestApp, getAdminSession, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestRole, createTestUser } = await import('../fixtures/factories.js');
    const { postSignedWooWebhook } = await import('../fixtures/wooWebhookHelper.js');
    const { WebhookSubscriptionService } = await import('../../services/events/webhookSubscriptionService.js');
    const { readWcConnectionSettings } = await import('../../services/woocommerce/wcConnectionSettings.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const role = await createTestRole({ permissions: ['settings.manage'] });
    roleIds.push(role.id);
    const user = await createTestUser({ role: role.code });
    userIds.push(user.id);
    const settingsReader = await loginTestUserWithSession(app, user.username);
    type Session = { cookie: string; csrfToken: string };
    const send = (who: Session, method: 'get' | 'post', url: string, body?: object) => {
      const r = request(app)[method](url).set('Cookie', who.cookie).set('x-csrf-token', who.csrfToken);
      return body === undefined ? r : r.send(body);
    };
    const storedSetting = async (key: string) => (await orm.select().from(appSettings).where(eq(appSettings.key, key)))[0]?.value;
    const settingValue = (body: unknown, key: string) => (Array.isArray(body) ? body : []).find((s: { key: string }) => s.key === key)?.value;
    const wrong: string[] = [];
    const settingItems = Object.entries(PLAIN).map(([key, value]) => ({ key, value }));
    const pingPayload = { webhook_id: 898 };

    // 1. WooCommerce keys: stored encrypted, the admin reads them decrypted, others masked, the server uses them decrypted
    const saved = await send(admin, 'post', '/api/settings', { settings: settingItems });
    if (saved.status !== 200) wrong.push(`save WooCommerce keys: ${saved.status} ${JSON.stringify(saved.body).slice(0, 200)}`);
    for (const [key, plain] of Object.entries(PLAIN)) {
      const stored = await storedSetting(key);
      if (!isEncryptedSecret(stored) || String(stored).includes(plain)) wrong.push(`${key} stored as ${String(stored).slice(0, 12)}…`);
    }
    const adminView = await send(admin, 'get', '/api/settings');
    const readerView = await send(settingsReader, 'get', '/api/settings');
    for (const [key, plain] of Object.entries(PLAIN)) {
      if (settingValue(adminView.body, key) !== plain) wrong.push(`admin GET ${key}: ${String(settingValue(adminView.body, key)).slice(0, 12)}`);
      if (settingValue(readerView.body, key) !== MASK) wrong.push(`reader GET ${key}: ${String(settingValue(readerView.body, key)).slice(0, 12)}`);
    }
    if (JSON.stringify(adminView.body).includes('enc:v1:') || JSON.stringify(readerView.body).includes('enc:v1:')) wrong.push('settings answer carries ciphertext');
    const savedAgain = await send(admin, 'post', '/api/settings', { settings: settingItems });
    if (savedAgain.status !== 200 || (savedAgain.body?.changedKeys ?? []).length !== 0) wrong.push(`unchanged save: ${savedAgain.status} changed ${JSON.stringify(savedAgain.body?.changedKeys)}`);
    const connection = await readWcConnectionSettings();
    if (connection.consumerKey !== PLAIN.wc_consumer_key || connection.consumerSecret !== PLAIN.wc_consumer_secret) wrong.push('connection settings not decrypted');
    const signedPing = await postSignedWooWebhook(app, PLAIN.wc_webhook_secret, pingPayload, 'action.woocommerce_webhook_ping');
    if (signedPing.status !== 200 || signedPing.body?.status !== 'ping_received') wrong.push(`WooCommerce ping signed with the secret: ${signedPing.status} ${signedPing.body?.status}`);

    // 2. a webhook subscription: key and header value stored encrypted, sent decrypted and signed with the plain key
    const created = await send(admin, 'post', '/api/events/webhooks', {
      name: `${namePrefix} partner`, targetUrl, eventPatterns: ['*'], customHeaders: { [PARTNER_HEADER]: PARTNER_TOKEN },
    });
    const subId = Number(created.body?.data?.id);
    if (subId) await setProbeEventPatterns(subId, [EVENT_TYPE]);
    const shownKey = String(created.body?.data?.secretKey ?? '');
    const [row] = subId ? await orm.select().from(webhookSubscriptions).where(eq(webhookSubscriptions.id, subId)) : [];
    const storedHeader = String((row?.customHeaders as Record<string, unknown> | undefined)?.[PARTNER_HEADER] ?? '');
    if (created.status !== 201 || !row) wrong.push(`create webhook: ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
    else if (!isEncryptedSecret(row.secretKey) || row.secretKey.includes(shownKey) || !isEncryptedSecret(storedHeader) || storedHeader.includes('PARTNER-API')) {
      wrong.push(`webhook stored key ${row.secretKey.slice(0, 12)}…, header ${storedHeader.slice(0, 12)}…`);
    }
    const deliveryOf = async (eventId: string) => {
      for (let i = 0; i < 50; i++) {
        const [d] = await orm.select().from(webhookDeliveries)
          .where(and(eq(webhookDeliveries.subscriptionId, subId), eq(webhookDeliveries.eventId, eventId)));
        if (d) return d;
        await new Promise(r => setTimeout(r, 100));
      }
      return undefined;
    };
    const dispatch = (eventId: string) => WebhookSubscriptionService.dispatchDomainEventToSubscribers({
      eventId, eventType: EVENT_TYPE, aggregateType: 'WooCommerce', aggregateId: 'td898', payload: { td: 898 }, metadata: {}, occurredAt: new Date().toISOString(),
    } as Parameters<typeof WebhookSubscriptionService.dispatchDomainEventToSubscribers>[0]);
    const partnerRequests = () => captured.filter(c => c.headers[PARTNER_HEADER.toLowerCase()] !== undefined || c.headers['x-erp-event-type'] === EVENT_TYPE);
    if (subId) {
      await dispatch('td898-readable');
      const delivered = await deliveryOf('td898-readable');
      const sent = partnerRequests()[0];
      const expectedSignature = sent ? crypto.createHmac('sha256', shownKey).update(sent.body, 'utf8').digest('hex') : '';
      if (delivered?.status !== 'success' || !sent || sent.headers[PARTNER_HEADER.toLowerCase()] !== PARTNER_TOKEN || sent.headers['x-erp-signature-256'] !== expectedSignature) {
        wrong.push(`readable delivery: ${delivered?.status ?? 'none'}, header ${String(sent?.headers[PARTNER_HEADER.toLowerCase()] ?? '').slice(0, 16)}, signature ${sent?.headers['x-erp-signature-256'] === expectedSignature ? 'ok' : 'wrong'}`);
      }
    }

    // 3. another ERP_SECRETS_KEY (the key was changed or lost): nothing is sent with an empty or wrong value
    process.env.ERP_SECRETS_KEY = OTHER_KEY;
    if (subId) {
      const before = partnerRequests().length;
      await dispatch('td898-unreadable');
      const refused = await deliveryOf('td898-unreadable');
      if (refused?.status !== 'failed' || !/ERP_SECRETS_KEY/.test(String(refused?.errorMessage)) || partnerRequests().length !== before) {
        wrong.push(`unreadable delivery: ${refused?.status ?? 'none'} ${String(refused?.errorMessage ?? '').slice(0, 40)}, sent ${partnerRequests().length - before}`);
      }
      const ping = await send(admin, 'post', '/api/events/webhooks/ping', { subscriptionId: subId });
      if (ping.status !== 503 || ping.body?.code !== 'INTEGRATION_SECRET_UNREADABLE' || partnerRequests().length !== before) {
        wrong.push(`unreadable ping: ${ping.status} ${ping.body?.code ?? ''}, sent ${partnerRequests().length - before}`);
      }
    }
    let connectionError = '';
    try {
      await readWcConnectionSettings();
    } catch (err) {
      connectionError = `${(err as { statusCode?: number }).statusCode} ${(err as { code?: string }).code}`;
    }
    if (connectionError !== '503 INTEGRATION_SECRET_UNREADABLE') wrong.push(`unreadable WooCommerce keys: ${connectionError || 'read'}`);
    const unreadablePing = await postSignedWooWebhook(app, PLAIN.wc_webhook_secret, pingPayload, 'action.woocommerce_webhook_ping');
    if (unreadablePing.status !== 200 || unreadablePing.body?.success !== false) wrong.push(`WooCommerce webhook with an unreadable secret: ${unreadablePing.status} ${unreadablePing.body?.status}`);
    invalidateSettingsCache();
    const maskedView = await send(admin, 'get', '/api/settings');
    if (settingValue(maskedView.body, 'wc_consumer_key') !== MASK || JSON.stringify(maskedView.body).includes('enc:v1:')) {
      wrong.push(`admin GET with an unreadable key: ${String(settingValue(maskedView.body, 'wc_consumer_key')).slice(0, 12)}`);
    }

    // 4. no ERP_SECRETS_KEY: a new secret is refused with 503 and nothing is stored
    delete process.env.ERP_SECRETS_KEY;
    const storedBefore = await storedSetting('wc_consumer_key');
    const noKeySave = await send(admin, 'post', '/api/settings', { settings: [{ key: 'wc_consumer_key', value: 'ck_td898_without_key' }] });
    if (noKeySave.status !== 503 || (await storedSetting('wc_consumer_key')) !== storedBefore) wrong.push(`save without key: ${noKeySave.status}`);
    const noKeyCreate = await send(admin, 'post', '/api/events/webhooks', { name: `${namePrefix} without key`, targetUrl, eventPatterns: ['*'] });
    const strayNoKey = await orm.select({ id: webhookSubscriptions.id }).from(webhookSubscriptions).where(eq(webhookSubscriptions.name, `${namePrefix} without key`));
    if (noKeyCreate.status !== 503 || strayNoKey.length > 0) wrong.push(`create webhook without key: ${noKeyCreate.status}, stored ${strayNoKey.length}`);

    // 5. legacy plain values: the dry run only counts them, apply encrypts them
    process.env.ERP_SECRETS_KEY = savedEnvKey && savedEnvKey.trim().length >= 32 ? savedEnvKey : TEST_KEY;
    await orm.update(appSettings).set({ value: PLAIN.wc_consumer_key }).where(eq(appSettings.key, 'wc_consumer_key'));
    if (subId) await orm.update(webhookSubscriptions).set({ secretKey: 'whsec_td898_legacy_plain', customHeaders: { [PARTNER_HEADER]: PARTNER_TOKEN } }).where(eq(webhookSubscriptions.id, subId));
    const encryption = await import('../../services/system/integrationSecretEncryption.service.js').catch(() => null);
    if (!encryption) throw new Error([...wrong, 'npm run secrets:encrypt does not cover integration secrets'].join('; '));
    const { IntegrationSecretEncryptionService } = encryption;
    const dry = await IntegrationSecretEncryptionService.run({ apply: false });
    if (dry.plaintext < 3 || (await storedSetting('wc_consumer_key')) !== PLAIN.wc_consumer_key) wrong.push(`dry run: plain ${dry.plaintext}, value changed`);
    const applied = await IntegrationSecretEncryptionService.run({ apply: true });
    const legacySetting = await storedSetting('wc_consumer_key');
    const [legacySub] = subId ? await orm.select().from(webhookSubscriptions).where(eq(webhookSubscriptions.id, subId)) : [];
    const legacyHeader = (legacySub?.customHeaders as Record<string, unknown> | undefined)?.[PARTNER_HEADER];
    if (applied.encryptedNow < 3 || !isEncryptedSecret(legacySetting) || decryptSecret(legacySetting) !== PLAIN.wc_consumer_key
      || !isEncryptedSecret(legacySub?.secretKey) || decryptSecret(legacySub?.secretKey) !== 'whsec_td898_legacy_plain'
      || !isEncryptedSecret(legacyHeader) || decryptSecret(legacyHeader) !== PARTNER_TOKEN) {
      wrong.push(`apply: encrypted ${applied.encryptedNow}, setting ${String(legacySetting).slice(0, 8)}, key ${String(legacySub?.secretKey).slice(0, 8)}, header ${String(legacyHeader).slice(0, 8)}`);
    }

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'WooCommerce keys and webhook key/header stored enc:v1, admin reads plain, others masked, delivery signed with the plain key; other key -> failed delivery, ping 503, connection 503, Woo webhook fails; no key -> 503, nothing stored; legacy values: dry run counts, apply encrypts',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (savedEnvKey === undefined) delete process.env.ERP_SECRETS_KEY; else process.env.ERP_SECRETS_KEY = savedEnvKey;
    if (savedPort === undefined) delete process.env.PORT; else process.env.PORT = savedPort;
    await new Promise<void>(resolve => echo.close(() => resolve()));
    await orm.delete(appSettings).where(inArray(appSettings.key, [...WC_KEYS])).catch(() => undefined);
    if (savedSettings.length > 0) await orm.insert(appSettings).values(savedSettings).catch(() => undefined);
    invalidateSettingsCache();
    const subs = await orm.select({ id: webhookSubscriptions.id }).from(webhookSubscriptions).where(like(webhookSubscriptions.name, `${namePrefix}%`));
    if (subs.length > 0) {
      const ids = subs.map(s => s.id);
      await orm.delete(webhookDeliveries).where(inArray(webhookDeliveries.subscriptionId, ids)).catch(() => undefined);
      await orm.delete(webhookSubscriptions).where(inArray(webhookSubscriptions.id, ids)).catch(() => undefined);
    }
    if (userIds.length > 0) await orm.update(users).set({ isDeleted: 1 }).where(inArray(users.id, userIds)).catch(() => undefined);
    if (roleIds.length > 0) await deleteTestRoles(inArray(roles.id, roleIds)).catch(() => undefined);
  }
  return results;
}
