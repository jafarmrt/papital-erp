import request from 'supertest';
import { inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { crmActivities, crmLeads, customers, roles, users } from '../../db/schema.js';

/**
 * بسته ۹ (مشتریان و CRM) — اطلاعات بانکی طرف حساب فقط برای دارندگان customers.view، customers.manage و accounting.*
 * (تصمیم مالک محصول ت۶ الف) در مسیرهای واقعی Express؛ روی کد پیشین قرمز است.
 */

interface Session { cookie: string; csrfToken: string }

export async function runPartyBankInfoScopeTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'sec_party_bank_info_scope_td_433';
  if (!shouldRun(id, 'security', 'td433', 'customer', 'bank', 'package9')) return results;

  const name = 'v9.0.21: the party list (and its export) and convert to customer give bank details only to holders of customers.view, customers.manage or an accounting.* key; warehouse, documents, CRM, project and procurement get parties without bankInfo (TD-433)';
  const tStart = Date.now();
  const customerIds: number[] = [];
  const leadIds: number[] = [];
  const roleIds: number[] = [];
  const userIds: number[] = [];
  try {
    const { getTestApp, getAdminSession, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestCustomer, createTestRole, createTestUser } = await import('../fixtures/factories.js');
    const { PERMISSION_CATALOG } = await import('../../routes/users.routes.js');
    const { PARTY_BANK_INFO_PERMISSIONS } = await import('../../services/customers/partyBankInfoAccess.js');
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const today = await businessTodayIsoDate();
    const tag = String(Date.now()).slice(-6);
    const wrong: string[] = [];

    const bankInfo = { bankName: 'بانک ملت', accountNumber: `40${tag}`, shaba: `IR0601200000000${tag}123456`, cardNumber: `6104337${tag}123` };
    const party = await createTestCustomer({ name: `تأمین‌کننده بانکی ${tag}`, partyType: 'supplier', phone: `0912${tag}7`, bankInfo });
    customerIds.push(party.id);

    const sessionWith = async (permissions: string[]): Promise<Session> => {
      const role = await createTestRole({ permissions });
      roleIds.push(role.id);
      const user = await createTestUser({ role: role.code });
      userIds.push(user.id);
      return loginTestUserWithSession(app, user.username);
    };
    /**
     * ردیف طرف حساب این آزمون در فهرست انتخاب و، برای دارنده customers.view، در فهرست کامل و خروجی آن. از v9.0.137
     * (TD-887، ت۱۰ الف) فرم‌های بخش‌های دیگر فقط فهرست انتخاب (`/customers/options`) را می‌خوانند.
     */
    const listedRows = async (s: Session, full: boolean) => {
      const get = (path: string) => request(app).get(path).set('Cookie', s.cookie);
      const search = `search=${encodeURIComponent(party.name)}`;
      const pick = (rows: unknown) => (Array.isArray(rows) ? rows : []).find((r: { id?: number }) => r.id === party.id) as Record<string, unknown> | undefined;
      const options = await get(`/api/customers/options?${search}`);
      if (options.status !== 200) throw new Error(`party pick list returned ${options.status}`);
      if (!full) return [pick(options.body?.data)];
      const page = await get(`/api/customers?${search}`);
      const exported = await get(`/api/customers?export=true&${search}`);
      if (page.status !== 200 || exported.status !== 200) throw new Error(`party list returned ${page.status}/${exported.status}`);
      return [pick(options.body?.data), pick(page.body?.data), pick(exported.body)];
    };
    const hasBank = (row: Record<string, unknown> | undefined) => (row?.bankInfo as { shaba?: string } | undefined)?.shaba === bankInfo.shaba;
    const hasAnyBankKey = (row: Record<string, unknown> | undefined) => row !== undefined && ('bankInfo' in row || 'bank_info' in row);

    // ۱) دارندگان مجوز خواندن فهرست بی مجوز طرف حساب یا حسابداری: ردیف هست، اطلاعات بانکی نیست
    for (const permission of ['warehouse.in', 'documents.view', 'documents.create', 'crm.view', 'projects.view', 'procurement.view']) {
      const rows = await listedRows(await sessionWith([permission]), false);
      if (rows.some(r => r === undefined)) wrong.push(`${permission}: party did not appear in the list`);
      if (rows.some(hasAnyBankKey)) wrong.push(`${permission}: bank details appeared in the list or export`);
    }

    // ۲) customers.view، customers.manage، هر مجوز accounting.* و مدیر سامانه: اطلاعات بانکی کامل
    const allowed: Array<[string, string[]]> = [
      ['customers.view', ['customers.view']],
      ['customers.manage', ['documents.view', 'customers.manage']],
      ['accounting.treasury', ['warehouse.in', 'accounting.treasury']],
      ['accounting.reports', ['documents.create', 'accounting.reports']],
    ];
    for (const [label, permissions] of allowed) {
      const rows = await listedRows(await sessionWith(permissions), permissions.includes('customers.view'));
      if (!rows.every(hasBank)) wrong.push(`${label}: bank details did not appear in the list or export`);
    }
    if (!(await listedRows(admin, true)).every(hasBank)) wrong.push('system admin did not get bank details in the list or export');

    // ۳) «تبدیل به مشتری» با نقش فقط ارتباط با مشتری: طرف حساب بی اطلاعات بانکی؛ مدیر سامانه با آن
    const convert = async (s: Session) => {
      const lead = await request(app).post('/api/crm/leads').set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken)
        .send({ title: `پرونده بانکی ${tag}-${leadIds.length + 1}`, customerId: party.id, expectedCloseDate: today });
      if (lead.status !== 201) throw new Error(`creating the sales file returned ${lead.status}`);
      leadIds.push(lead.body.id);
      const res = await request(app).post(`/api/crm/leads/${lead.body.id}/convert-to-customer`).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send({});
      if (res.status !== 200 || res.body?.customer?.id !== party.id) throw new Error(`convert to customer returned ${res.status} (party ${res.body?.customer?.id})`);
      return res.body.customer as Record<string, unknown>;
    };
    if (hasAnyBankKey(await convert(await sessionWith(['crm.view', 'crm.manage'])))) wrong.push('"convert to customer" with a customer-relations-only role returned bank details');
    if (!hasBank(await convert(admin))) wrong.push('"convert to customer" returned no bank details for the system admin');

    // ۴) فهرست مجاز همه مجوزهای accounting.* کاتالوگ را دارد (مجوز حسابداری تازه بی‌صدا جا نمی‌ماند)
    const listed = new Set<string>(PARTY_BANK_INFO_PERMISSIONS);
    const missing = PERMISSION_CATALOG.flatMap(c => c.permissions.map(p => p.key))
      .filter(k => k.startsWith('accounting.') || k === 'customers.view' || k === 'customers.manage')
      .filter(k => !listed.has(k));
    if (missing.length > 0) wrong.push(`مجوزهای بی دسترسی به اطلاعات بانکی: ${missing.join('، ')}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'security', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'six form permissions get the pick list without bankInfo (since v9.0.120); customers.view, customers.manage, accounting.treasury, accounting.reports and the admin get it; "convert to customer" for a CRM-only role does not',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'security', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (leadIds.length > 0) {
      await orm.delete(crmActivities).where(inArray(crmActivities.leadId, leadIds)).catch(() => undefined);
      await orm.delete(crmLeads).where(inArray(crmLeads.id, leadIds)).catch(() => undefined);
    }
    if (customerIds.length > 0) await orm.delete(customers).where(inArray(customers.id, customerIds)).catch(() => undefined);
    if (userIds.length > 0) await orm.delete(users).where(inArray(users.id, userIds)).catch(() => undefined);
    if (roleIds.length > 0) await orm.delete(roles).where(inArray(roles.id, roleIds)).catch(() => undefined);
  }
  return results;
}
