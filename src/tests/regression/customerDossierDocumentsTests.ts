import request from 'supertest';
import { inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { customers, roles, users } from '../../db/schema.js';
import { deleteTestRoles } from '../fixtures/roleCleanup.js';

/**
 * بسته ۹ (مشتریان و CRM) — اسناد پرونده مشتری در مسیر واقعی Express؛ روی کد پیشین قرمز است.
 */

interface Session { cookie: string; csrfToken: string }

export async function runCustomerDossierDocumentsTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_customer_dossier_documents_by_buyer_td_417';
  if (!shouldRun(id, 'td417', 'customer', 'dossier', 'crm', 'package9')) return results;

  const name = 'v9.0.6: the customer dossier documents are only sales documents with an equal buyer name; a namesake buyer\'s document, a note holding the name and a warehouse receipt do not appear (TD-417)';
  const tStart = Date.now();
  const customerIds: number[] = [];
  const roleIds: number[] = [];
  const userIds: number[] = [];
  try {
    const { getTestApp, getAdminSession, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestCustomer, createTestItem, createTestRole, createTestUser } = await import('../fixtures/factories.js');
    const { DocumentService } = await import('../../services/document.service.js');
    const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');

    const app = await getTestApp();
    const admin = await getAdminSession();
    const get = (url: string, s: Session = admin) => request(app).get(url).set('Cookie', s.cookie);
    const today = await businessTodayIsoDate();
    const wh = (await getDefaultWarehouseCode(orm)) as string;
    const item = await createTestItem({ type: 'product', stocks: { [wh]: 5 }, weightedAverageCost: 100000 });
    type DocInput = Parameters<typeof DocumentService.createDocument>[0];
    const doc = (fields: Partial<DocInput>) => DocumentService.createDocument({
      docType: 'invoice', inOut: 'out', status: 'draft', date: today, user: 'td417',
      items: [{ itemId: item.id, quantity: 1, unitPrice: 500000, location: wh }],
      ...fields,
    } as DocInput);

    const tag = String(Date.now()).slice(-6);
    const a = await createTestCustomer({ name: `علی کاظمی ${tag}`, phone: `0912${tag}5` });
    const b = await createTestCustomer({ name: `علی کاظمی ${tag}نژاد`, phone: `0912${tag}6` });
    customerIds.push(a.id, b.id);

    // سه سند فروش A: فاکتور نهایی، پیش‌فاکتور و پیش‌نویس فاکتور
    const own = [
      await doc({ buyerName: a.name, status: 'final' }),
      await doc({ buyerName: a.name, status: 'proforma' }),
      await doc({ buyerName: ` ${a.name} ` }),
    ];
    // نباید بیایند: فاکتور B که نامش نام A را دارد، فاکتور خریدار دیگری که نام A در یادداشتش است، رسید انبار به نام A
    const foreign = [
      await doc({ buyerName: b.name }),
      await doc({ buyerName: `خریدار دیگر ${tag}`, notes: `تحویل به ${a.name}` }),
      await doc({ docType: 'receipt', inOut: 'in', buyerName: a.name }),
    ];

    const wrong: string[] = [];
    const res = await get(`/api/customers/${a.id}/documents`);
    if (res.status !== 200) throw new Error(`documents of dossier A returned status ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
    const ids = (Array.isArray(res.body?.data) ? res.body.data : []).map((d: { id: number }) => Number(d.id)).sort((x: number, y: number) => x - y);
    const expected = [...own].sort((x, y) => x - y);
    if (JSON.stringify(ids) !== JSON.stringify(expected)) wrong.push(`documents of dossier A are ${JSON.stringify(ids)}, not ${JSON.stringify(expected)}`);
    const leaked = foreign.filter(f => ids.includes(f));
    if (leaked.length > 0) wrong.push(`${leaked.length} documents of others or warehouse receipts appeared in dossier A`);
    if (res.body?.total !== 3) wrong.push(`document count of dossier A is ${res.body?.total}, not 3`);

    const bRes = await get(`/api/customers/${b.id}/documents`);
    const bIds = (Array.isArray(bRes.body?.data) ? bRes.body.data : []).map((d: { id: number }) => Number(d.id));
    if (JSON.stringify(bIds) !== JSON.stringify([foreign[0]])) wrong.push(`documents of dossier B are ${JSON.stringify(bIds)}, not [${foreign[0]}]`);

    // دسترسی: همان مجوزهای فهرست اسناد (نقش فقط ارتباط با مشتری پرونده را می‌بیند)؛ طرف حساب ناموجود ۴۰۴
    const crmRole = await createTestRole({ permissions: ['crm.view'] });
    roleIds.push(crmRole.id);
    const crmUser = await createTestUser({ role: crmRole.code });
    userIds.push(crmUser.id);
    const viaCrm = await get(`/api/customers/${a.id}/documents`, await loginTestUserWithSession(app, crmUser.username));
    if (viaCrm.status !== 200) wrong.push(`the crm.view holder did not get the dossier documents (${viaCrm.status})`);
    const missing = await get('/api/customers/987654321/documents');
    if (missing.status !== 404) wrong.push(`documents of a missing party returned ${missing.status}, not 404`);

    if (wrong.length > 0) throw new Error(wrong.join(', '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'dossier A: its own final invoice, proforma and draft (3); not the invoice of B, the invoice with the name of A in its notes, or the warehouse receipt; dossier B only its own document; crm.view 200, missing 404',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (userIds.length > 0) await orm.delete(users).where(inArray(users.id, userIds)).catch(() => undefined);
    if (roleIds.length > 0) await deleteTestRoles(inArray(roles.id, roleIds)).catch(() => undefined);
    if (customerIds.length > 0) await orm.update(customers).set({ isDeleted: 1 }).where(inArray(customers.id, customerIds)).catch(() => undefined);
  }
  return results;
}
