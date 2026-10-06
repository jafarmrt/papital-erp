import request from 'supertest';
import { inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { crmLeads, customers } from '../../db/schema.js';

/**
 * بسته ۹ (مشتریان و CRM) — فیلتر «مشتری» پرونده‌های فروش در مسیر واقعی Express؛ روی کد پیشین قرمز است.
 */

export async function runCrmLeadCustomerFilterTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_crm_lead_filter_by_customer_id_td_429';
  if (!shouldRun(id, 'td429', 'crm', 'lead', 'filter', 'package9')) return results;

  const name = 'v9.0.15: فیلتر «مشتری» پرونده‌های فروش با شناسه طرف حساب کار می‌کند و پرونده قدیمی بی شناسه را فقط با نام برابر می‌آورد؛ پرونده‌ای که نام رابط دارد پیدا می‌شود (TD-429)';
  const tStart = Date.now();
  const customerIds: number[] = [];
  const leadIds: number[] = [];
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestCustomer } = await import('../fixtures/factories.js');
    const { buildLeadQueryParams } = await import('../../hooks/useCRMFilters.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const tag = String(Date.now()).slice(-6);
    const wrong: string[] = [];

    const party = await createTestCustomer({ name: `شرکت آینه ${tag}`, phone: `0936${tag}1`, contactName: 'آقای صادقی' });
    const other = await createTestCustomer({ name: `شرکت آینه کاری ${tag}`, phone: `0936${tag}2` });
    customerIds.push(party.id, other.id);
    const lead = async (title: string, fields: Partial<typeof crmLeads.$inferInsert>) => {
      const [row] = await orm.insert(crmLeads).values({ title: `${title} ${tag}`, ...fields }).returning({ id: crmLeads.id });
      leadIds.push(row.id);
      return row.id;
    };
    // فرم پرونده: نام رابط در customer_name و نام طرف حساب در company
    const linked = await lead('سرویس عروس', { customerId: party.id, customerName: 'آقای صادقی', company: party.name });
    const legacy = await lead('پرونده قدیمی', { customerId: null, customerName: 'رابط قدیمی', company: ` ${party.name} ` });
    await lead('پرونده طرف دیگر', { customerId: other.id, customerName: 'آقای صادقی', company: other.name });
    await lead('پرونده قدیمی طرف دیگر', { customerId: null, customerName: other.name });

    // صفحه همان پارامتری را می‌فرستد که buildLeadQueryParams می‌سازد
    const params = buildLeadQueryParams({ filterCustomer: String(party.id), searchTerm: tag });
    const res = await request(app).get(`/api/crm/leads?${params.toString()}`).set('Cookie', admin.cookie);
    const rows: Array<{ id: number }> = Array.isArray(res.body?.data) ? res.body.data : (Array.isArray(res.body) ? res.body : []);
    const got = rows.map(r => r.id).sort((a, b) => a - b);
    const want = [linked, legacy].sort((a, b) => a - b);
    if (res.status !== 200 || JSON.stringify(got) !== JSON.stringify(want)) {
      wrong.push(`فیلتر مشتری با «${params.toString()}» پرونده‌های ${JSON.stringify(got)} را داد (${res.status})، نه ${JSON.stringify(want)}`);
    }

    if (wrong.length > 0) throw new Error(wrong.join('، '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'پرونده با رابط «آقای صادقی» و پرونده قدیمی هم‌نام آمدند؛ پرونده‌های طرف حساب دیگر نیامدند',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (leadIds.length > 0) await orm.delete(crmLeads).where(inArray(crmLeads.id, leadIds)).catch(() => undefined);
    if (customerIds.length > 0) await orm.update(customers).set({ isDeleted: 1 }).where(inArray(customers.id, customerIds)).catch(() => undefined);
  }
  return results;
}
