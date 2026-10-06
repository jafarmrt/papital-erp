import request from 'supertest';
import { inArray, like, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { crmActivities, crmLeads, customers } from '../../db/schema.js';
import { containsLikePattern } from '../../lib/sqlLike.js';

/**
 * بسته ۹ (مشتریان و CRM) — ثبت اقدام CRM با پرونده یا طرف حساب ناموجود در مسیر واقعی Express؛ روی کد پیشین قرمز است.
 */

export async function runCrmActivityParentsTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_crm_activity_parents_exist_td_426';
  if (!shouldRun(id, 'td426', 'crm', 'activity', 'package9')) return results;

  const name = 'v9.0.17: اقدام CRM با پرونده فروش یا طرف حساب ناموجود یا حذف‌شده با ۴۲۲ رد می‌شود و ردیفی ثبت نمی‌شود؛ شناسه متنی ۵۰۰ نمی‌دهد؛ اقدام با والد معتبر ثبت می‌شود (TD-426)';
  const tStart = Date.now();
  const tag = `TD426-${String(Date.now()).slice(-6)}`;
  const leadIds: number[] = [];
  const customerIds: number[] = [];
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestCustomer } = await import('../fixtures/factories.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const post = (body: Record<string, unknown>) => request(app).post('/api/crm/activities')
      .set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send({ type: 'call', ...body });
    const wrong: string[] = [];

    const [maxLead] = await orm.select({ n: sql<string>`COALESCE(MAX(${crmLeads.id}), 0)::text` }).from(crmLeads);
    const [maxCustomer] = await orm.select({ n: sql<string>`COALESCE(MAX(${customers.id}), 0)::text` }).from(customers);
    const missingLead = Number(maxLead?.n ?? 0) + 1_000_000;
    const missingCustomer = Number(maxCustomer?.n ?? 0) + 1_000_000;

    const [lead] = await orm.insert(crmLeads).values({ title: `پرونده ${tag}` }).returning({ id: crmLeads.id });
    const [deletedLead] = await orm.insert(crmLeads).values({ title: `پرونده حذف‌شده ${tag}`, isDeleted: 1 }).returning({ id: crmLeads.id });
    leadIds.push(lead.id, deletedLead.id);
    const party = await createTestCustomer({ name: `طرف حساب ${tag}`, phone: `0937${String(Date.now()).slice(-7)}` });
    const removedParty = await createTestCustomer({ name: `طرف حساب حذف‌شده ${tag}`, phone: `0938${String(Date.now()).slice(-7)}` });
    customerIds.push(party.id, removedParty.id);
    await orm.update(customers).set({ isDeleted: 1 }).where(inArray(customers.id, [removedParty.id]));

    const refused: Array<[string, Record<string, unknown>, number[]]> = [
      ['دو والد ناموجود', { leadId: missingLead, customerId: missingCustomer }, [422]],
      ['پرونده ناموجود', { leadId: missingLead }, [422]],
      ['طرف حساب ناموجود', { customerId: missingCustomer }, [422]],
      ['پرونده حذف‌شده', { leadId: deletedLead.id }, [422]],
      ['طرف حساب حذف‌شده', { customerId: removedParty.id }, [422]],
      ['شناسه متنی پرونده', { leadId: 'abc' }, [400, 422]],
    ];
    for (const [label, body, statuses] of refused) {
      const res = await post({ title: `${label} ${tag}`, ...body });
      if (!statuses.includes(res.status)) wrong.push(`${label}: ${res.status}، نه ${statuses.join(' یا ')}`);
    }
    const stored = await orm.select({ id: crmActivities.id }).from(crmActivities).where(like(crmActivities.title, containsLikePattern(tag)));
    if (stored.length > 0) wrong.push(`${stored.length} اقدام با والد نامعتبر ذخیره شد`);

    const ok = await post({ title: `اقدام معتبر ${tag}`, leadId: String(lead.id), customerId: party.id });
    if (ok.status !== 201 || ok.body?.leadId !== lead.id || ok.body?.customerId !== party.id) {
      wrong.push(`اقدام با والد معتبر ${ok.status} داد (${JSON.stringify({ leadId: ok.body?.leadId, customerId: ok.body?.customerId })})`);
    }

    if (wrong.length > 0) throw new Error(wrong.join('، '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'پرونده و طرف حساب ناموجود یا حذف‌شده ۴۲۲ و بی ردیف؛ اقدام با پرونده و طرف حساب معتبر ۲۰۱',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    await orm.delete(crmActivities).where(like(crmActivities.title, containsLikePattern(tag))).catch(() => undefined);
    if (leadIds.length > 0) {
      await orm.delete(crmActivities).where(inArray(crmActivities.leadId, leadIds)).catch(() => undefined);
      await orm.update(crmLeads).set({ isDeleted: 1 }).where(inArray(crmLeads.id, leadIds)).catch(() => undefined);
    }
    if (customerIds.length > 0) await orm.update(customers).set({ isDeleted: 1 }).where(inArray(customers.id, customerIds)).catch(() => undefined);
  }
  return results;
}
