import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { appSettings, eventActionRules, items } from '../../db/schema.js';
import { decryptSecret, isEncryptedSecret } from '../../lib/secretBox.js';
import { DomainEventType } from '../../services/events/domainEvents.js';

/**
 * Closing sweep, decision ت۴۰ items 2 and 4:
 * - OBS-PR-07: an action rule's webhook token and header values are stored encrypted, kept by «********» on edit, opened
 *   only to send, never sent (and not retried) when the key cannot open them, and encrypted from legacy plain text by
 *   `npm run secrets:encrypt`. Red on v10.1.58, which stored them in plain text.
 * - OBS-R2-82: every WooCommerce request passes the SSRF guard and follows no redirect. Red on v10.1.58, where the stock
 *   sync sent the keys to the stored address without the guard.
 */
type ShouldRun = (id: string, ...extra: string[]) => boolean;
type Config = { url?: string; secretToken?: string; headers?: Record<string, string> };

const TOKEN = 'tok-obs-pr-07-plain';
const HEADER = 'hdr-obs-pr-07-plain';
const BROKEN_CIPHERTEXT = 'enc:v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAA';

export async function runClosingIntegrationGuardTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const ruleId = 'reg_rule_secrets_encrypted_obs_pr_07';
  if (shouldRun(ruleId, 'obs_pr_07', 'webhook', 'secrets', 'security')) {
    const tStart = Date.now();
    const previousKey = process.env.ERP_SECRETS_KEY;
    let createdId: number | null = null;
    try {
      process.env.ERP_SECRETS_KEY = previousKey || 'obs-pr-07-test-key-0123456789-abcdefghij';
      const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
      const { EventActionEngineService } = await import('../../services/events/eventActionEngineService.js');
      const { IntegrationSecretEncryptionService } = await import('../../services/system/integrationSecretEncryption.service.js');
      const app = await getTestApp();
      const admin = await getAdminSession();
      const send = (method: 'post' | 'put', url: string, body: object) =>
        request(app)[method](url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body);
      const stored = async () => {
        const [row] = await orm.select().from(eventActionRules).where(eq(eventActionRules.id, Number(createdId)));
        return (row?.actionConfigJson ?? {}) as Config;
      };
      const wrong: string[] = [];
      const url = 'https://partner-obs-pr-07.example.com/hook';

      const created = await send('post', '/api/events/action-rules', {
        name: `OBS-PR-07 ${Date.now()}`, eventType: DomainEventType.INVOICE_APPROVED, actionType: 'webhook', isActive: 0,
        actionConfigJson: { url, method: 'POST', secretToken: TOKEN, headers: { 'X-Api-Key': HEADER } },
      });
      if (created.status !== 201 && created.status !== 200) throw new Error(`creating the rule answered ${created.status}: ${JSON.stringify(created.body).slice(0, 200)}`);
      createdId = Number(created.body?.id ?? created.body?.data?.id);
      const first = await stored();
      if (!isEncryptedSecret(first.secretToken) || String(first.secretToken).includes(TOKEN)) wrong.push(`token stored as ${String(first.secretToken).slice(0, 12)}…`);
      if (!isEncryptedSecret(first.headers?.['X-Api-Key'])) wrong.push(`header stored as ${String(first.headers?.['X-Api-Key']).slice(0, 12)}…`);

      // «********» on an edit at the same address keeps the stored values
      const edited = await send('put', `/api/events/action-rules/${createdId}`, {
        actionConfigJson: { url, method: 'POST', secretToken: '********', headers: { 'X-Api-Key': '********' } },
      });
      if (edited.status !== 200) wrong.push(`masked edit answered ${edited.status}`);
      const second = await stored();
      if (decryptSecret(second.secretToken) !== TOKEN || decryptSecret(second.headers?.['X-Api-Key']) !== HEADER) wrong.push('the masked edit did not keep the stored token and header');
      if (!isEncryptedSecret(second.secretToken)) wrong.push('the masked edit stored the token in plain text');

      // a token the current key cannot open is never sent and the delivery is not retried
      await orm.update(eventActionRules).set({ isActive: 1, actionConfigJson: { ...second, secretToken: BROKEN_CIPHERTEXT } })
        .where(eq(eventActionRules.id, createdId));
      const { domainEventBus } = await import('../../services/events/domainEventBus.js');
      const event = domainEventBus.createEvent(DomainEventType.INVOICE_APPROVED, 'Document', 'obs-pr-07', { totalAmount: 1 });
      const outcome = await EventActionEngineService.runRuleActionAttempt(createdId, event, { jobId: 0, attempt: 1 });
      await orm.update(eventActionRules).set({ isActive: 0 }).where(eq(eventActionRules.id, createdId));
      if (outcome.ok !== false || outcome.retryable !== false || !String(outcome.error).includes('ERP_SECRETS_KEY')) wrong.push(`unreadable token: ${JSON.stringify(outcome)}`);

      // a legacy plain token is encrypted by «npm run secrets:encrypt -- --apply»
      await orm.update(eventActionRules).set({ actionConfigJson: { url, method: 'POST', secretToken: TOKEN, headers: { 'X-Api-Key': HEADER } } })
        .where(eq(eventActionRules.id, createdId));
      const { countSecretsAtRest } = await import('../../services/system/secretsAtRestHealth.js');
      const plainBefore = (await countSecretsAtRest()).plaintext.webhooks;
      await IntegrationSecretEncryptionService.run({ apply: true });
      const plainAfter = (await countSecretsAtRest()).plaintext.webhooks;
      if (plainBefore - plainAfter < 2) wrong.push(`the health check counted ${plainBefore} plain webhook secrets before and ${plainAfter} after secrets:encrypt`);
      const third = await stored();
      if (!isEncryptedSecret(third.secretToken) || decryptSecret(third.secretToken) !== TOKEN || !isEncryptedSecret(third.headers?.['X-Api-Key'])) {
        wrong.push('secrets:encrypt left the rule token or header in plain text');
      }

      if (wrong.length > 0) throw new Error(wrong.join('; '));
      results.push(makeTestCase({
        id: ruleId, name: 'OBS-PR-07: an action rule webhook token and header values are stored encrypted and never sent when unreadable',
        layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
        details: 'create stores enc:v1 values; masked edit keeps them; unreadable token -> failed, retryable false; secrets:encrypt seals legacy plain values and the health check counts them until then',
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: ruleId, name: 'OBS-PR-07: action rule secrets encrypted at rest', layer: 'regression', executionType: 'real_database',
        passed: false, durationMs: Date.now() - tStart, error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      if (createdId) await orm.delete(eventActionRules).where(eq(eventActionRules.id, createdId)).catch(() => undefined);
      if (previousKey === undefined) delete process.env.ERP_SECRETS_KEY; else process.env.ERP_SECRETS_KEY = previousKey;
    }
  }

  const wooId = 'reg_woocommerce_request_guard_obs_r2_82';
  if (shouldRun(wooId, 'obs_r2_82', 'woocommerce', 'ssrf', 'security')) {
    const tStart = Date.now();
    const keys = ['wc_store_url', 'wc_consumer_key', 'wc_consumer_secret'];
    let before: Array<{ key: string; value: string }> = [];
    let itemId: number | null = null;
    try {
      const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
      const { createTestItem } = await import('../fixtures/factories.js');
      const app = await getTestApp();
      const admin = await getAdminSession();
      before = await orm.select({ key: appSettings.key, value: appSettings.value }).from(appSettings).where(inArray(appSettings.key, keys));
      await orm.delete(appSettings).where(inArray(appSettings.key, keys));
      // a stored shop address inside the server's network (legacy plain keys are read as they are)
      await orm.insert(appSettings).values([
        { key: 'wc_store_url', value: 'http://127.0.0.1:9' },
        { key: 'wc_consumer_key', value: 'ck_obs_r2_82' },
        { key: 'wc_consumer_secret', value: 'cs_obs_r2_82' },
      ]);
      const item = await createTestItem();
      itemId = item.id;
      const res = await request(app).post('/api/woocommerce/sync-item').set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send({ itemId });
      if (res.status !== 422 || res.body?.code !== 'UNSAFE_TARGET_URL') {
        throw new Error(`stock sync to an internal shop address answered ${res.status} ${JSON.stringify(res.body).slice(0, 200)}, expected 422 UNSAFE_TARGET_URL`);
      }
      results.push(makeTestCase({
        id: wooId, name: 'OBS-R2-82: every WooCommerce request passes the SSRF guard, not only the connection test',
        layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
        details: 'sync-item with a stored 127.0.0.1 shop address -> 422 UNSAFE_TARGET_URL before any request',
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: wooId, name: 'OBS-R2-82: WooCommerce requests pass the SSRF guard', layer: 'regression', executionType: 'real_database',
        passed: false, durationMs: Date.now() - tStart, error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      await orm.delete(appSettings).where(inArray(appSettings.key, keys)).catch(() => undefined);
      if (before.length > 0) await orm.insert(appSettings).values(before).catch(() => undefined);
      if (itemId) await orm.delete(items).where(eq(items.id, itemId)).catch(() => undefined);
    }
  }
  return results;
}
