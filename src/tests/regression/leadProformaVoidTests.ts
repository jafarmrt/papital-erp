import request from 'supertest';
import { and, eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { crmActivities, crmLeads } from '../../db/schema.js';

/**
 * بسته ۹ (مشتریان و CRM) — ابطال پیش‌فاکتور پرونده فروش در مسیر واقعی Express؛ روی کد پیشین قرمز است.
 */

export async function runLeadProformaVoidTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_lead_proforma_void_reopens_won_td_423';
  if (!shouldRun(id, 'td423', 'crm', 'proforma', 'void', 'package9')) return results;

  const name = 'v9.0.12: voiding a lead\'s proforma, or the invoice finalized from it, moves a won lead back to proposal and frees it for a new proforma; a refused void leaves the lead alone (TD-423)';
  const tStart = Date.now();
  const leadIds: number[] = [];
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestItem } = await import('../fixtures/factories.js');
    const { DocumentService } = await import('../../services/document.service.js');
    const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');

    const app = await getTestApp();
    const admin = await getAdminSession();
    const send = (req: request.Test) => req.set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken);
    const today = await businessTodayIsoDate();
    const wh = (await getDefaultWarehouseCode(orm)) as string;
    const item = await createTestItem({ type: 'product', stocks: { [wh]: 5 }, weightedAverageCost: 1_000_000 });
    const tag = String(Date.now()).slice(-6);
    const wrong: string[] = [];

    const newLead = async (label: string) => {
      const [lead] = await orm.insert(crmLeads).values({ title: `${label} ${tag}`, customerName: `خریدار ${label}`, stage: 'qualified', status: 'active' }).returning({ id: crmLeads.id });
      leadIds.push(lead.id);
      return lead.id;
    };
    const issueProforma = async (leadId: number) => {
      const res = await send(request(app).post('/api/documents')).send({
        docType: 'invoice', status: 'proforma', inOut: 'out', refNumber: 'auto', date: today, buyer_name: `خریدار ${tag}`,
        items: [{ itemId: item.id, quantity: 1, unit_price: 3_000_000, location: wh }], crmLeadId: leadId,
      });
      const docId = Number(res.body?.id ?? res.body?.docId);
      if (res.status !== 201 && res.status !== 200) throw new Error(`Issuing the proforma returned ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
      return docId;
    };
    const markWon = async (leadId: number, label: string) => {
      const res = await send(request(app).put(`/api/crm/leads/${leadId}`)).send({ stage: 'won' });
      if (res.status !== 200) wrong.push(`${label}: moving to "won" returned ${res.status}`);
    };
    const leadOf = async (leadId: number) => (await orm.select().from(crmLeads).where(eq(crmLeads.id, leadId)))[0];
    const expectLead = async (leadId: number, label: string, want: { stage: string; status: string; hasProforma: number; proformaId: number | null }) => {
      const lead = await leadOf(leadId);
      const got = { stage: lead.stage, status: lead.status, hasProforma: lead.hasProforma, proformaId: lead.proformaId };
      if (JSON.stringify(got) !== JSON.stringify(want)) wrong.push(`${label}: the sales file is ${JSON.stringify(got)}, not ${JSON.stringify(want)}`);
    };

    // ۱) پیش‌فاکتور ← «فروش موفق» ← ابطال پیش‌فاکتور: پرونده به «پیشنهاد» برمی‌گردد و یادداشت دارد
    const wonLead = await newLead('سرویس طلا');
    const proformaId = await issueProforma(wonLead);
    await markWon(wonLead, 'پرونده ۱');
    const voided = await send(request(app).delete(`/api/documents/${proformaId}`));
    if (voided.status !== 200) wrong.push(`Voiding the proforma returned ${voided.status}`);
    await expectLead(wonLead, 'voiding the proforma of a won sales file', { stage: 'proposal', status: 'active', hasProforma: 0, proformaId: null });
    const notes = await orm.select({ title: crmActivities.title, description: crmActivities.description }).from(crmActivities)
      .where(and(eq(crmActivities.leadId, wonLead), eq(crmActivities.isDeleted, 0)));
    if (!notes.some(n => n.title === 'ابطال پیش‌فاکتور' && String(n.description).includes('به «پیش‌فاکتور و پیشنهاد» برگشت'))) {
      wrong.push(`The sales file reversal note was not recorded: ${JSON.stringify(notes.map(n => n.title))}`);
    }
    // پرونده دوباره پیش‌فاکتور می‌پذیرد
    const again = await issueProforma(wonLead).catch((e: unknown) => { wrong.push(`The new proforma was refused: ${String(e)}`); return 0; });
    if (again) await expectLead(wonLead, 'a new proforma after the void', { stage: 'proposal', status: 'active', hasProforma: 1, proformaId: again });

    // ۲) پرونده‌ای که هنوز «پیشنهاد» است فقط آزاد می‌شود
    const openLead = await newLead('انگشتر');
    const openProforma = await issueProforma(openLead);
    await send(request(app).delete(`/api/documents/${openProforma}`));
    await expectLead(openLead, 'voiding the proforma of an open sales file', { stage: 'proposal', status: 'active', hasProforma: 0, proformaId: null });

    // ۳) پیش‌فاکتور نهایی‌شده به فاکتور ← «فروش موفق» ← ابطال فاکتور
    const invoicedLead = await newLead('گردنبند');
    const invoiceId = await issueProforma(invoicedLead);
    await DocumentService.finalizeDocument(invoiceId, 'td423');
    await markWon(invoicedLead, 'پرونده ۳');
    const voidedInvoice = await send(request(app).delete(`/api/documents/${invoiceId}`));
    if (voidedInvoice.status !== 200) wrong.push(`Voiding the invoice returned ${voidedInvoice.status}`);
    await expectLead(invoicedLead, 'voiding the invoice finalized from the proforma', { stage: 'proposal', status: 'active', hasProforma: 0, proformaId: null });

    // ۴) ابطال ردشده (رسیدی که کالایش فروخته شده، TD-265) پرونده را دست نمی‌زند: آزادسازی در همان تراکنش ابطال است
    const fresh = await createTestItem({ type: 'product' });
    const receiptId = await DocumentService.createDocument({
      docType: 'receipt', inOut: 'in', status: 'final', date: today, user: 'td423', buyerName: 'تامین td423',
      items: [{ itemId: fresh.id, quantity: 3, unitPrice: 1000, location: wh }],
    } as Parameters<typeof DocumentService.createDocument>[0]);
    await DocumentService.createDocument({
      docType: 'invoice', inOut: 'out', status: 'final', date: today, user: 'td423', buyerName: 'خریدار td423',
      items: [{ itemId: fresh.id, quantity: 3, unitPrice: 2000, location: wh }],
    } as Parameters<typeof DocumentService.createDocument>[0]);
    const lockedLead = await newLead('رسید مصرف‌شده');
    await orm.update(crmLeads).set({ hasProforma: 1, proformaId: receiptId, stage: 'won', status: 'won' }).where(eq(crmLeads.id, lockedLead));
    const refused = await send(request(app).delete(`/api/documents/${receiptId}`));
    if (refused.status < 400) wrong.push(`Voiding the consumed receipt returned ${refused.status}, not a refusal`);
    await expectLead(lockedLead, 'a refused void', { stage: 'won', status: 'won', hasProforma: 1, proformaId: receiptId });

    if (wrong.length > 0) throw new Error(wrong.join(', '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'Voiding the proforma and the invoice made from it moved the won sales file back to "proposal" and a new proforma was accepted; a refused void kept the sales file',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (leadIds.length > 0) {
      await orm.delete(crmActivities).where(inArray(crmActivities.leadId, leadIds)).catch(() => undefined);
      await orm.update(crmLeads).set({ isDeleted: 1 }).where(inArray(crmLeads.id, leadIds)).catch(() => undefined);
    }
  }
  return results;
}
