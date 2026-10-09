import request from 'supertest';
import { inArray, like } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { customers, eventActionRules, webhookSubscriptions } from '../../db/schema.js';

/**
 * Phase 3 lane L2 (TD-979, OBS-R2-06): the writer routes that read their body without Zod now refuse a malformed body
 * with 400 VALIDATION_ERROR before any write. On v10.0.20 each of these requests reached the service: the customer import
 * took any number of rows, a rule or a webhook took a non-text name, the task import took an unknown mode, and the item
 * code counter took an unknown item type as a product and moved the product series.
 */
export async function runWriterRouteZodTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_writer_route_bodies_zod_td_979';
  if (!shouldRun(id, 'td979', 'obs-r2-06', 'zod', 'package15')) return results;

  const name = 'v10.0.21: writer routes refuse a malformed body with 400 before any write (TD-979)';
  const tStart = Date.now();
  const tag = `td979-${Date.now()}`;
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const send = (method: 'post' | 'put' | 'delete', url: string, body?: object) => {
      const r = request(app)[method](url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken);
      return body ? r.send(body) : r;
    };
    const wrong: string[] = [];
    const expect400 = async (label: string, method: 'post' | 'put' | 'delete', url: string, body?: object) => {
      const res = await send(method, url, body);
      if (res.status !== 400 || res.body?.code !== 'VALIDATION_ERROR') wrong.push(`${label}: ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
    };

    const tooMany = Array.from({ length: 5001 }, (_, i) => ({ name: `${tag} customer ${i}` }));
    await expect400('customer import of 5001 rows', 'post', '/api/customers/bulk-import', { rows: tooMany });
    await expect400('customer import row that is not an object', 'post', '/api/customers/bulk-import', { rows: ['x'] });
    await expect400('personnel import updateIfExists as text', 'post', '/api/personnel/bulk-import', { rows: [{ firstName: tag }], updateIfExists: 'yes' });
    await expect400('task import unknown mode', 'post', '/api/piecework/tasks/import-excel', { rows: [{ title: tag }], mode: 'wipe' });
    await expect400('action rule with a numeric name', 'post', '/api/events/action-rules', { name: 123, eventType: 'StockIssued' });
    await expect400('webhook with a numeric name', 'post', '/api/events/webhooks', { name: 7, targetUrl: 'https://td979.example.com/h', eventPatterns: ['*'] });
    await expect400('webhook edit with patterns as text', 'put', '/api/events/webhooks/999999999', { eventPatterns: 'all' });
    await expect400('DLQ batch replay with text ids', 'post', '/api/events/dlq/replay-batch', { ids: ['a'] });
    await expect400('event simulation with a non-object payload', 'post', '/api/events/domain-events/simulate', { eventType: 'StockIssued', payload: 'x' });
    await expect400('timeline replay with dryRun as text', 'post', '/api/events/event-sourcing/simulate-replay', { eventType: 'StockIssued', dryRun: 'no' });
    await expect400('item code for an unknown type', 'post', '/api/items/next-code', { type: 'service', prefix: 'TD' });
    await expect400('inbox task with an unknown action', 'post', '/api/workflow/tasks/999999999/execute', { action: 'maybe' });

    const storedCustomers = await orm.select({ id: customers.id }).from(customers).where(like(customers.name, `${tag}%`));
    if (storedCustomers.length > 0) wrong.push(`${storedCustomers.length} customers stored by a refused import`);
    const storedRules = await orm.select({ id: eventActionRules.id }).from(eventActionRules).where(like(eventActionRules.name, '123'));
    if (storedRules.length > 0) wrong.push('a rule named 123 was stored');

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: '12 malformed bodies on import, event, webhook, item code and inbox routes -> 400 VALIDATION_ERROR, nothing stored',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    const stray = await orm.select({ id: customers.id }).from(customers).where(like(customers.name, `${tag}%`));
    if (stray.length > 0) await orm.delete(customers).where(inArray(customers.id, stray.map(r => r.id))).catch(() => undefined);
    const hooks = await orm.select({ id: webhookSubscriptions.id }).from(webhookSubscriptions).where(like(webhookSubscriptions.targetUrl, '%td979.example.com%'));
    if (hooks.length > 0) await orm.delete(webhookSubscriptions).where(inArray(webhookSubscriptions.id, hooks.map(r => r.id))).catch(() => undefined);
  }
  return results;
}
