import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm, pool } from '../../db/drizzle.js';
import { webhookDeliveries, webhookSubscriptions } from '../../db/schema.js';

/**
 * Package 15 (events and integrations), TD-707 / B15-05 (decision t3 a): webhook subscriptions use the event types the
 * server publishes. Migration *_webhook_event_patterns converts stored dotted patterns with a mapping table and records
 * the old list, deactivates a subscription left with no pattern or addressed to a documentation domain, and the service
 * refuses any other pattern. On v9.0.379 the migration did not exist, a dotted pattern was accepted and a subscription
 * to «document.invoiced» received nothing for an approved invoice.
 */
export async function runWebhookEventPatternTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_webhook_event_patterns_real_types_td_707';
  if (!shouldRun(id, 'td707', 'b15-05', 'webhook', 'package15')) return results;

  const name = 'v9.0.380: webhook subscriptions are converted to and accept only published event types, and a converted one receives the invoice event (TD-707)';
  const tStart = Date.now();
  const tag = `td707_${Date.now()}`;
  const savedPort = process.env.PORT;
  const receiver = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => { res.statusCode = 200; res.end('{}'); });
  });
  const subIds: number[] = [];
  try {
    const port = await new Promise<number>(resolve => receiver.listen(0, '127.0.0.1', () => resolve((receiver.address() as AddressInfo).port)));
    process.env.PORT = String(port); // the SSRF guard's echo exception: this server's own port and the exact echo path
    const target = `http://127.0.0.1:${port}/api/events/webhook-echo`;
    const { WebhookSubscriptionService } = await import('../../services/events/webhookSubscriptionService.js');
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const send = (method: 'post' | 'put', url: string, body: object) =>
      request(app)[method](url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body);
    const wrong: string[] = [];

    // 1. legacy subscriptions with the old presets, stored as they were before the migration
    const legacy = async (label: string, eventPatterns: string[], targetUrl = target, isActive = 1) => {
      const created = await WebhookSubscriptionService.createSubscription({ name: `${tag} ${label}`, targetUrl: target, eventPatterns: ['*'], timeoutMs: 3000 });
      await pool.query('UPDATE webhook_subscriptions SET event_patterns = $1::jsonb, target_url = $2, is_active = $3 WHERE id = $4',
        [JSON.stringify(eventPatterns), targetUrl, isActive, created.id]);
      subIds.push(created.id);
      return created.id;
    };
    const invoicedId = await legacy('invoiced', ['document.invoiced', 'inventory.stock_out']);
    const wildId = await legacy('wild', ['inventory.*', 'treasury.*']);
    const settledId = await legacy('settled', ['document.settled']);
    const demoId = await legacy('demo', ['document.invoiced'], 'https://shop.example.com/wp-json/erp/v1/webhook');
    const validId = await legacy('valid', ['StockIssued', 'InvoiceApproved']);
    const allId = await legacy('all', ['document.*', '*']);

    const migrationFile = fs.readdirSync(path.resolve(process.cwd(), 'drizzle')).find(f => /^\d{4}_webhook_event_patterns\.sql$/.test(f));
    if (migrationFile) {
      const sqlText = fs.readFileSync(path.resolve(process.cwd(), 'drizzle', migrationFile), 'utf8');
      for (let run = 0; run < 2; run++) for (const stmt of sqlText.split('--> statement-breakpoint')) await pool.query(stmt);
    } else {
      wrong.push('migration *_webhook_event_patterns.sql not found');
    }
    const rows = await orm.select({ id: webhookSubscriptions.id, eventPatterns: webhookSubscriptions.eventPatterns, isActive: webhookSubscriptions.isActive })
      .from(webhookSubscriptions).where(inArray(webhookSubscriptions.id, subIds));
    const of = (sid: number) => rows.find(r => r.id === sid);
    const expect = (sid: number, label: string, patterns: string[], active: number) => {
      const row = of(sid);
      const got = [...((row?.eventPatterns as string[] | null) ?? [])].sort();
      if (JSON.stringify(got) !== JSON.stringify([...patterns].sort()) || row?.isActive !== active) {
        wrong.push(`${label}: patterns ${JSON.stringify(got)} active ${row?.isActive}, expected ${JSON.stringify(patterns)} active ${active}`);
      }
    };
    expect(invoicedId, 'document.invoiced + inventory.stock_out', ['InvoiceApproved', 'StockIssued'], 1);
    expect(wildId, 'inventory.* + treasury.*', ['InventoryReorderAlert', 'StockAdjusted', 'StockIssued', 'StockReceived', 'TreasuryTransactionApproved'], 1);
    expect(settledId, 'document.settled', ['document.settled'], 0);
    expect(demoId, 'example.com subscription', ['InvoiceApproved'], 0);
    expect(validId, 'already valid', ['InvoiceApproved', 'StockIssued'], 1);
    expect(allId, 'with *', ['*'], 1);
    if (migrationFile) {
      const repairs = await pool.query('SELECT subscription_id, old_patterns, dropped_patterns, deactivated FROM webhook_event_pattern_repairs WHERE subscription_id = ANY($1::int[])', [subIds]);
      const repaired = new Map(repairs.rows.map((r: { subscription_id: number; old_patterns: string[]; dropped_patterns: string[]; deactivated: number }) => [r.subscription_id, r]));
      if (repaired.has(validId) || repaired.size !== 5) wrong.push(`repair rows for ${[...repaired.keys()].join(',')}`);
      const settled = repaired.get(settledId);
      if (!settled || settled.deactivated !== 1 || JSON.stringify(settled.dropped_patterns) !== '["document.settled"]') wrong.push(`settled repair: ${JSON.stringify(settled)}`);
      if (JSON.stringify(repaired.get(invoicedId)?.old_patterns) !== '["document.invoiced","inventory.stock_out"]') wrong.push(`old patterns not recorded: ${JSON.stringify(repaired.get(invoicedId))}`);
    }

    // 2. the converted subscription receives an approved invoice event
    const now = new Date().toISOString();
    const event = {
      eventId: `${tag}_invoice`, eventType: 'InvoiceApproved', aggregateType: 'Document' as const, aggregateId: '707',
      payload: { documentId: 707 }, metadata: { userId: 0, userName: 'td707', timestamp: now }, occurredAt: now,
    } as unknown as Parameters<typeof WebhookSubscriptionService.dispatchDomainEventToSubscribers>[0];
    const dispatched = await WebhookSubscriptionService.dispatchDomainEventToSubscribers(event) as unknown as { attempts?: Promise<unknown>[] } | undefined;
    await Promise.all(dispatched?.attempts ?? []);
    const deliveries = await orm.select({ subscriptionId: webhookDeliveries.subscriptionId, status: webhookDeliveries.status })
      .from(webhookDeliveries).where(inArray(webhookDeliveries.subscriptionId, subIds));
    const deliveredTo = new Set(deliveries.filter(d => d.status === 'success').map(d => d.subscriptionId));
    if (!deliveredTo.has(invoicedId) || !deliveredTo.has(allId) || !deliveredTo.has(validId)) wrong.push(`invoice event delivered to ${[...deliveredTo].join(',')}`);
    if (deliveredTo.has(demoId) || deliveredTo.has(settledId) || deliveredTo.has(wildId)) wrong.push(`invoice event reached an inactive or unrelated subscription: ${[...deliveredTo].join(',')}`);

    // 3. the service refuses a pattern that is no published event type, and an old one blocks activation
    const create = await send('post', '/api/events/webhooks', { name: `${tag} new`, targetUrl: target, eventPatterns: ['document.invoiced'] });
    const strays = await orm.select({ id: webhookSubscriptions.id }).from(webhookSubscriptions).where(inArray(webhookSubscriptions.name, [`${tag} new`]));
    subIds.push(...strays.map(r => r.id));
    if (create.status !== 422 || create.body?.code !== 'WEBHOOK_EVENT_PATTERN_UNKNOWN' || strays.length > 0) wrong.push(`create with document.invoiced: ${create.status} ${create.body?.code}`);
    const edit = await send('put', `/api/events/webhooks/${validId}`, { eventPatterns: ['InvoiceApproved', 'InvoiceCancelled'] });
    if (edit.status !== 422 || edit.body?.code !== 'WEBHOOK_EVENT_PATTERN_UNKNOWN') wrong.push(`edit with InvoiceCancelled: ${edit.status} ${edit.body?.code}`);
    const toggle = await send('post', `/api/events/webhooks/${settledId}/toggle`, {});
    if (toggle.status !== 422 || toggle.body?.code !== 'WEBHOOK_EVENT_PATTERN_UNKNOWN') wrong.push(`activate with document.settled: ${toggle.status} ${toggle.body?.code}`);
    const fixed = await send('put', `/api/events/webhooks/${settledId}`, { eventPatterns: ['TreasuryTransactionApproved', 'TreasuryTransactionApproved'], isActive: 1 });
    if (fixed.status !== 200 || JSON.stringify(fixed.body?.data?.eventPatterns) !== '["TreasuryTransactionApproved"]' || fixed.body?.data?.isActive !== 1) {
      wrong.push(`choose events and activate: ${fixed.status} ${JSON.stringify(fixed.body?.data?.eventPatterns ?? fixed.body?.message)}`);
    }

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'dotted patterns converted (rerun idempotent), document.settled and example.com subscriptions deactivated and recorded; the converted subscription received InvoiceApproved; unknown patterns refused 422 on create, edit and activation',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (savedPort === undefined) delete process.env.PORT; else process.env.PORT = savedPort;
    receiver.closeAllConnections();
    await new Promise<void>(resolve => receiver.close(() => resolve()));
    if (subIds.length > 0) {
      await pool.query('DELETE FROM webhook_event_pattern_repairs WHERE subscription_id = ANY($1::int[])', [subIds]).catch(() => undefined);
      await pool.query('DELETE FROM integration_delivery_jobs WHERE kind = $1 AND target_id = ANY($2::int[])', ['webhook', subIds]).catch(() => undefined);
      await orm.delete(webhookDeliveries).where(inArray(webhookDeliveries.subscriptionId, subIds)).catch(() => undefined);
      await orm.delete(webhookSubscriptions).where(inArray(webhookSubscriptions.id, subIds)).catch(() => undefined);
    }
  }
  return results;
}
