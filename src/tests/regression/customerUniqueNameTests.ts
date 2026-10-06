import request from 'supertest';
import { and, eq, ilike, inArray, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { crmActivities, crmLeads, customers } from '../../db/schema.js';
import { containsLikePattern } from '../../lib/sqlLike.js';

/**
 * بسته ۹ (مشتریان و CRM) — یکتایی نام طرف حساب فعال زیر درخواست‌های هم‌زمان؛ روی کد پیشین قرمز است.
 */

export async function runCustomerUniqueNameTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_customer_unique_active_name_td_420';
  if (!shouldRun(id, 'td420', 'customer', 'concurrency', 'crm', 'package9')) return results;

  const name = 'v9.0.8: درخواست‌های هم‌زمان با یک نام فقط یک طرف حساب فعال می‌سازند (ایندکس یکتای جزئی نام، مهاجرت 0052) و بقیه پیام نام تکراری می‌گیرند؛ نام حذف‌شده دوباره آزاد است و بازرس سلامت قید را می‌بیند (TD-420)';
  const tStart = Date.now();
  const tag = String(Date.now()).slice(-6);
  const base = `نگارخانه مهر ${tag}`;
  const leadIds: number[] = [];
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const post = (url: string, body: object) => request(app).post(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body);
    const activeWithName = async (n: string) => (await orm.select({ id: customers.id }).from(customers)
      .where(and(eq(customers.isDeleted, 0), sql`lower(btrim(${customers.name})) = lower(btrim(${n}::text))`))).map(r => r.id);
    const wrong: string[] = [];

    // ۱) شش ساخت هم‌زمان با یک نام (تلفن‌های جدا تا فقط نام سنجیده شود)
    const burst = await Promise.all(Array.from({ length: 6 }, (_, i) => post('/api/customers', { name: base, phone: `0912${tag}${i}` })));
    const statuses = burst.map(r => r.status).sort();
    const created = await activeWithName(base);
    if (created.length !== 1) wrong.push(`${created.length} طرف حساب فعال با نام «${base}» ساخته شد، نه ۱ (وضعیت‌ها ${statuses.join(',')})`);
    if (statuses.filter(s => s === 200).length !== 1 || statuses.filter(s => s === 400).length !== 5) wrong.push(`وضعیت‌های ساخت هم‌زمان ${statuses.join(',')} است، نه یک ۲۰۰ و پنج ۴۰۰`);
    const refused = burst.find(r => r.status === 400);
    if (refused && !String(refused.body?.error ?? refused.body?.message ?? '').includes('نام')) wrong.push(`پیام رد ${JSON.stringify(refused.body).slice(0, 120)} است`);

    // ۲) نامی که فقط در فاصله یا حروف بزرگ و کوچک فرق دارد همان نام است
    const latin = `Mehr Gallery ${tag}`;
    const first = await post('/api/customers', { name: latin });
    const variant = await post('/api/customers', { name: `  mehr gallery ${tag} ` });
    if (first.status !== 200 || variant.status !== 400) wrong.push(`نام لاتین ${first.status} و نگارش دیگرش ${variant.status} داد، نه ۲۰۰ و ۴۰۰`);

    // ۳) پرونده فروش با همان نام شرکت به همان طرف حساب پیوند می‌خورد، نه طرف حساب تازه
    const lead = await post('/api/crm/leads', { title: `فرصت ${tag}`, company: ` ${latin.toUpperCase()} `, customerName: 'خانم ب', expectedCloseDate: await businessTodayIsoDate() });
    if (lead.status === 201) leadIds.push(lead.body.id);
    const latinIds = await activeWithName(latin);
    if (lead.status !== 201 || latinIds.length !== 1 || Number(lead.body?.customerId) !== latinIds[0]) {
      wrong.push(`پرونده با نام شرکت به نگارش دیگر: ${lead.status}، پیوند ${lead.body?.customerId}، طرف حساب‌های فعال ${JSON.stringify(latinIds)}`);
    }

    // ۴) پس از حذف، همان نام دوباره ساخته می‌شود (طرف حساب حذف‌شده حساب نمی‌شود)
    await request(app).delete(`/api/customers/${created[0]}`).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken);
    const again = await post('/api/customers', { name: base });
    if (again.status !== 200) wrong.push(`ساخت دوباره نام طرف حساب حذف‌شده ${again.status} داد`);

    // ۵) بازرس سلامت مالی: قید هست و نام تکراری نیست؛ با داده تکراری همان نام‌ها را فهرست می‌کند
    try {
      const { FinancialHealthService } = await import('../../services/accounting/financialHealth.service.js');
      const { buildCustomerNameHealthTest } = await import('../../services/customers/customerNameIntegrity.js');
      const report = await FinancialHealthService.runHealthCheck();
      const check = report.tests.find(t => t.id === 'customer_name_uniqueness');
      if (!check || check.metrics?.uniqueIndexPresent !== 1 || check.count !== 0) wrong.push(`آزمون سلامت نام طرف حساب ${JSON.stringify(check?.metrics ?? null)}`);
      const sample = buildCustomerNameHealthTest([
        { id: 7, name: 'Nour', phone: '', partyType: 'customer' },
        { id: 9, name: ' nour ', phone: '', partyType: 'supplier' },
      ], false);
      if (sample.count !== 1 || sample.status !== 'warning' || !String(sample.items?.[0]?.details).includes('#7، #9')) wrong.push(`گزارش سلامت هم‌نام‌ها ${JSON.stringify({ count: sample.count, status: sample.status, details: sample.items?.[0]?.details })}`);
    } catch (err) {
      wrong.push(`بازرس سلامت نام طرف حساب: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (wrong.length > 0) throw new Error(wrong.join('، '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'شش ساخت هم‌زمان: یک ۲۰۰ و پنج ۴۰۰ با یک ردیف فعال؛ نگارش دیگر نام ۴۰۰؛ پرونده با نام شرکت به همان طرف حساب پیوند خورد؛ نام حذف‌شده دوباره آزاد؛ بازرس سلامت قید را دید',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (leadIds.length > 0) {
      await orm.delete(crmActivities).where(inArray(crmActivities.leadId, leadIds)).catch(() => undefined);
      await orm.delete(crmLeads).where(inArray(crmLeads.id, leadIds)).catch(() => undefined);
    }
    await orm.update(customers).set({ isDeleted: 1 })
      .where(and(ilike(customers.name, containsLikePattern(tag)), eq(customers.isDeleted, 0))).catch(() => undefined);
  }
  return results;
}
