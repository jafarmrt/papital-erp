import request from 'supertest';
import { and, eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { crmActivities, crmLeads, documents } from '../../db/schema.js';

/**
 * بسته ۹ (مشتریان و CRM) — پیش‌فاکتورهای هم‌زمان یک پرونده فروش در مسیر واقعی Express؛ روی کد پیشین قرمز است.
 */

export async function runLeadProformaConcurrencyTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_lead_single_proforma_concurrent_td_424';
  if (!shouldRun(id, 'td424', 'crm', 'proforma', 'concurrency', 'package9')) return results;

  const name = 'v9.0.13: of three concurrent proformas for one sales lead only one is recorded and the lead points to it; the lead note has the proforma\'s real number (TD-424)';
  const tStart = Date.now();
  const leadIds: number[] = [];
  const docIds: number[] = [];
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestItem } = await import('../fixtures/factories.js');
    const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');

    const app = await getTestApp();
    const admin = await getAdminSession();
    const today = await businessTodayIsoDate();
    const wh = (await getDefaultWarehouseCode(orm)) as string;
    const item = await createTestItem({ type: 'product' });
    const tag = String(Date.now()).slice(-6);
    const wrong: string[] = [];

    const [lead] = await orm.insert(crmLeads).values({ title: `دستبند هم‌زمان ${tag}`, customerName: 'خریدار هم‌زمان', stage: 'qualified', status: 'active' }).returning({ id: crmLeads.id });
    leadIds.push(lead.id);
    const issue = () => request(app).post('/api/documents').set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send({
      docType: 'invoice', status: 'proforma', inOut: 'out', refNumber: 'auto', date: today, buyer_name: `خریدار ${tag}`,
      items: [{ itemId: item.id, quantity: 1, unit_price: 2_000_000, location: wh }], crmLeadId: lead.id,
    });
    const responses = await Promise.all([issue(), issue(), issue()]);
    const ok = responses.filter(r => r.status === 200 || r.status === 201);
    const refused = responses.filter(r => r.status === 422);
    if (ok.length !== 1 || refused.length !== 2) wrong.push(`Responses were ${JSON.stringify(responses.map(r => r.status))}, not one 200 and two 422`);
    if (refused.some(r => !String(r.body?.error ?? r.body?.message ?? '').includes('قبلاً پیش‌فاکتور صادر شده'))) wrong.push('The refusal message of the second proforma was not "a proforma was already issued"');

    const linked = await orm.select({ id: documents.id, refNumber: documents.refNumber }).from(documents)
      .where(and(eq(documents.crmLeadId, lead.id), eq(documents.isDeleted, 0)));
    docIds.push(...linked.map(d => d.id));
    if (linked.length !== 1) wrong.push(`${linked.length} active proformas were linked to the sales file, not 1`);
    const [after] = await orm.select().from(crmLeads).where(eq(crmLeads.id, lead.id));
    const winner = Number(ok[0]?.body?.docId);
    if (after.hasProforma !== 1 || after.proformaId !== winner || after.stage !== 'proposal') {
      wrong.push(`The sales file is ${JSON.stringify({ hasProforma: after.hasProforma, proformaId: after.proformaId, stage: after.stage })}, not proforma ${winner} in "proposal"`);
    }
    const quotes = await orm.select({ title: crmActivities.title }).from(crmActivities)
      .where(and(eq(crmActivities.leadId, lead.id), eq(crmActivities.type, 'quote'), eq(crmActivities.isDeleted, 0)));
    const ref = linked[0]?.refNumber ?? '';
    if (quotes.length !== 1 || quotes[0].title !== `صدور پیش‌فاکتور شماره ${ref}`) wrong.push(`The issue note is ${JSON.stringify(quotes.map(q => q.title))}, not one "proforma no. ${ref} issued" note`);

    if (wrong.length > 0) throw new Error(wrong.join(', '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: `Three concurrent requests: one 200 and two 422; the sales file points to proforma ${ref}`,
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (docIds.length > 0) await orm.update(documents).set({ isDeleted: 1 }).where(inArray(documents.id, docIds)).catch(() => undefined);
    if (leadIds.length > 0) {
      await orm.delete(crmActivities).where(inArray(crmActivities.leadId, leadIds)).catch(() => undefined);
      await orm.update(crmLeads).set({ isDeleted: 1 }).where(inArray(crmLeads.id, leadIds)).catch(() => undefined);
    }
  }
  return results;
}
