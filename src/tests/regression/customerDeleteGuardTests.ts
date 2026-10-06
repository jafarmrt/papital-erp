import request from 'supertest';
import { and, eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { cheques, crmLeads, customers, journalVouchers, productionProjects } from '../../db/schema.js';
import { money } from '../../lib/money.js';

/**
 * بسته ۹ (مشتریان و CRM) — حذف طرف حساب دارای مانده یا کار باز در مسیر واقعی Express؛ روی کد پیشین قرمز است.
 */

export async function runCustomerDeleteGuardTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_customer_delete_refused_with_open_items_td_431';
  if (!shouldRun(id, 'td431', 'customer', 'delete', 'crm', 'package9')) return results;

  const name = 'v9.0.10: طرف حساب دارای مانده، سند حسابداری پیش‌نویس، سند پیش‌نویس یا پیش‌فاکتور، پرونده فروش فعال، پروژه باز یا چک باز حذف نمی‌شود (۴۰۹ با دلیل)؛ طرف حسابی که فقط کار بسته دارد حذف می‌شود (TD-431)';
  const tStart = Date.now();
  const customerIds: number[] = [];
  const leadIds: number[] = [];
  const projectIds: number[] = [];
  const chequeIds: number[] = [];
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestCustomer, createTestItem } = await import('../fixtures/factories.js');
    const { DocumentService } = await import('../../services/document.service.js');
    const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
    const { CHEQUE_TRANSITIONS } = await import('../../services/accounting/treasury/chequeLifecycle.service.js');
    const { OPEN_CHEQUE_STATUSES } = await import('../../services/customers/customerDeleteGuard.js').catch(() => ({ OPEN_CHEQUE_STATUSES: [] as string[] }));

    const app = await getTestApp();
    const admin = await getAdminSession();
    const del = (customerId: number) => request(app).delete(`/api/customers/${customerId}`).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken);
    const isActive = async (customerId: number) => (await orm.select({ id: customers.id }).from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.isDeleted, 0)))).length === 1;
    const today = await businessTodayIsoDate();
    const wh = (await getDefaultWarehouseCode(orm)) as string;
    const item = await createTestItem({ type: 'product', stocks: { [wh]: 5 }, weightedAverageCost: 1_000_000 });
    type DocInput = Parameters<typeof DocumentService.createDocument>[0];
    const doc = (fields: Partial<DocInput>) => DocumentService.createDocument({
      docType: 'invoice', inOut: 'out', status: 'draft', date: today, user: 'td431',
      items: [{ itemId: item.id, quantity: 1, unitPrice: 3_000_000, location: wh }],
      ...fields,
    } as DocInput);

    const tag = String(Date.now()).slice(-6);
    const party = async (label: string, i: number) => {
      const c = await createTestCustomer({ name: `${label} ${tag}`, phone: `0935${tag}${i}` });
      customerIds.push(c.id);
      return c;
    };
    const cheque = async (partyId: number | null, partyName: string, status: string, n: string) => {
      const [row] = await orm.insert(cheques).values({
        type: 'received', chequeNumber: `${tag}${n}`, bankName: 'ملت', issueDate: today, dueDate: today, amount: money(2_500_000),
        partyType: 'customer', partyId, partyName, status,
      }).returning({ id: cheques.id });
      chequeIds.push(row.id);
    };
    const wrong: string[] = [];
    const expectRefused = async (customerId: number, label: string, mustMention: string) => {
      const res = await del(customerId);
      const message = String(res.body?.error ?? res.body?.message ?? '');
      if (res.status !== 409 || !message.includes(mustMention)) wrong.push(`${label}: حذف ${res.status} داد با پیام «${message.slice(0, 160)}»، نه ۴۰۹ با «${mustMention}»`);
      if (!(await isActive(customerId))) wrong.push(`${label}: طرف حساب حذف شد`);
    };

    // ۱) فاکتور نهایی: نخست سند حسابداری پیش‌نویس، پس از تأیید مانده ۳٬۰۰۰٬۰۰۰ حذف را رد می‌کند
    const debtor = await party('گالری فیروزه', 1);
    const invoiceId = await doc({ buyerName: debtor.name, status: 'final' });
    await expectRefused(debtor.id, 'طرف حساب با فاکتور نهایی و سند پیش‌نویس', 'سند حسابداری پیش‌نویس');
    await orm.update(journalVouchers).set({ status: 'approved' }).where(and(eq(journalVouchers.sourceDocumentId, invoiceId), eq(journalVouchers.isDeleted, 0)));
    await expectRefused(debtor.id, 'طرف حساب با مانده سند تأییدشده', 'مانده حساب');

    // ۲) پیش‌نویس و پیش‌فاکتور با همان نام خریدار
    const drafted = await party('بوتیک یاقوت', 2);
    await doc({ buyerName: ` ${drafted.name} `, status: 'proforma' });
    await expectRefused(drafted.id, 'طرف حساب با پیش‌فاکتور', 'پیش‌فاکتور');

    // ۳) پرونده فروش فعال
    const prospect = await party('خانم صالحی', 3);
    const [lead] = await orm.insert(crmLeads).values({ title: `فرصت ${tag}`, customerId: prospect.id, customerName: prospect.name, status: 'active' }).returning({ id: crmLeads.id });
    leadIds.push(lead.id);
    await expectRefused(prospect.id, 'طرف حساب با پرونده فروش فعال', 'پرونده فروش فعال');

    // ۴) پروژه باز
    const client = await party('سفارش‌دهنده سرویس', 4);
    const [project] = await orm.insert(productionProjects).values({ projectCode: `TD431-${tag}`, title: `سرویس ${tag}`, customerId: client.id, customerName: client.name, status: 'in_progress' }).returning({ id: productionProjects.id });
    projectIds.push(project.id);
    await expectRefused(client.id, 'طرف حساب با پروژه باز', 'پروژه باز');

    // ۵) چک باز (با شناسه) و چک قدیمی بی‌شناسه با همان نام
    const drawer = await party('صادرکننده چک', 5);
    await cheque(drawer.id, drawer.name, 'in_treasury', '1');
    await expectRefused(drawer.id, 'طرف حساب با چک در خزانه', 'چک باز');
    const legacy = await party('چک قدیمی', 6);
    await cheque(null, legacy.name, 'bounced', '2');
    await expectRefused(legacy.id, 'طرف حساب با چک برگشتی بی‌شناسه', 'چک باز');

    // ۶) فقط کار بسته: پرونده بردشده، پروژه تمام‌شده، چک وصول‌شده، پیش‌نویس باطل‌شده ← حذف آزاد است
    const settled = await party('مشتری تسویه‌شده', 7);
    const [wonLead] = await orm.insert(crmLeads).values({ title: `برده ${tag}`, customerId: settled.id, status: 'won' }).returning({ id: crmLeads.id });
    leadIds.push(wonLead.id);
    const [doneProject] = await orm.insert(productionProjects).values({ projectCode: `TD431-${tag}-D`, title: `تمام‌شده ${tag}`, customerId: settled.id, status: 'completed' }).returning({ id: productionProjects.id });
    projectIds.push(doneProject.id);
    await cheque(settled.id, settled.name, 'passed', '3');
    const voidedDraft = await doc({ buyerName: settled.name });
    await DocumentService.deleteDocument(voidedDraft, 'td431');
    const freed = await del(settled.id);
    if (freed.status !== 200 || (await isActive(settled.id))) wrong.push(`طرف حساب بی کار باز با ${freed.status} حذف نشد: ${JSON.stringify(freed.body).slice(0, 160)}`);

    // وضعیت‌های باز چک همان وضعیت‌های دارای گام بعدی در ماشین وضعیت چک‌اند
    const derived = Object.entries(CHEQUE_TRANSITIONS).filter(([, next]) => next.length > 0).map(([s]) => s).sort();
    if (JSON.stringify([...OPEN_CHEQUE_STATUSES].sort()) !== JSON.stringify(derived)) wrong.push(`وضعیت‌های باز چک ${JSON.stringify(OPEN_CHEQUE_STATUSES)} است، نه ${JSON.stringify(derived)}`);

    if (wrong.length > 0) throw new Error(wrong.join('، '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'سند پیش‌نویس، مانده تأییدشده، پیش‌فاکتور، پرونده فعال، پروژه باز، چک در خزانه و چک برگشتی بی‌شناسه هر یک ۴۰۹ با دلیل دادند و طرف حساب ماند؛ طرف حساب با کار بسته ۲۰۰',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (chequeIds.length > 0) await orm.update(cheques).set({ isDeleted: 1 }).where(inArray(cheques.id, chequeIds)).catch(() => undefined);
    if (projectIds.length > 0) await orm.update(productionProjects).set({ isDeleted: 1 }).where(inArray(productionProjects.id, projectIds)).catch(() => undefined);
    if (leadIds.length > 0) await orm.delete(crmLeads).where(inArray(crmLeads.id, leadIds)).catch(() => undefined);
    if (customerIds.length > 0) await orm.update(customers).set({ isDeleted: 1 }).where(inArray(customers.id, customerIds)).catch(() => undefined);
  }
  return results;
}
