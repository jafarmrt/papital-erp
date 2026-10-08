import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { crmActivities, crmLeads, customers, roles, users } from '../../db/schema.js';
import { toPersianDigits } from '../../utils/persianNumber.js';

/**
 * بسته ۹ (مشتریان و CRM) — گارد داده پایه طرف حساب در مسیرهای واقعی Express؛ هر آزمون روی کد پیشین قرمز است.
 */

interface Session { cookie: string; csrfToken: string }

export async function runCrmCustomerLinkTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'sec_crm_lead_keeps_customer_master_td_418';
  if (!shouldRun(id, 'security', 'td418', 'crm', 'customer', 'package9')) return results;

  const name = 'v9.0.5: a sales lead does not change an existing party\'s name and phone (with or without customers.manage); it only links or creates a party and the difference goes into the lead\'s notes (TD-418)';
  const tStart = Date.now();
  const customerIds: number[] = [];
  const leadIds: number[] = [];
  const roleIds: number[] = [];
  const userIds: number[] = [];
  try {
    const { getTestApp, getAdminSession, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestCustomer, createTestRole, createTestUser } = await import('../fixtures/factories.js');
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const send = (s: Session, method: 'post' | 'put', url: string, body: object = {}) =>
      request(app)[method](url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body);
    const today = await businessTodayIsoDate();
    const tag = String(Date.now()).slice(-6);
    const customerRow = async (customerId: number) => (await orm.select().from(customers).where(eq(customers.id, customerId)))[0];
    const wrong: string[] = [];

    const role = await createTestRole({ permissions: ['crm.view', 'crm.manage'] });
    roleIds.push(role.id);
    const crmUser = await createTestUser({ role: role.code });
    userIds.push(crmUser.id);
    const crmOnly = await loginTestUserWithSession(app, crmUser.username);

    // ۱) پرونده با شناسه طرف حساب و تلفن دیگر: تلفن و نسخه طرف حساب نمی‌ماند (پیش‌تر تلفن بی افزایش نسخه عوض می‌شد)
    const p1 = `0912${tag}1`;
    const p2 = `0935${tag}9`;
    const c = await createTestCustomer({ name: `مشتری قفل نسخه ${tag}`, phone: p1 });
    customerIds.push(c.id);
    const created = await send(admin, 'post', '/api/crm/leads', { title: `فرصت ${tag}-۱`, customerId: c.id, customerName: 'رابط', phone: p2, expectedCloseDate: today });
    if (created.status !== 201) throw new Error(`creating the sales file returned ${created.status}: ${JSON.stringify(created.body).slice(0, 200)}`);
    leadIds.push(created.body.id);
    let cNow = await customerRow(c.id);
    if (cNow.phone !== p1 || cNow.version !== c.version) wrong.push(`creating the sales file changed the party phone to ${cNow.phone} and the version to ${cNow.version}`);
    if (created.body.customerId !== c.id) wrong.push(`the sales file was linked to party ${created.body.customerId}, not ${c.id}`);
    const notes = String(created.body.notes ?? '');
    if (!notes.includes(toPersianDigits(p2)) || !notes.includes(toPersianDigits(p1))) wrong.push(`the phone difference did not appear in the sales file notes: "${notes}"`);

    // ویرایش و جابه‌جایی مرحله پرونده (فرم همه فیلدها را دوباره می‌فرستد) و «تبدیل به مشتری» هم طرف حساب را عوض نمی‌کنند
    const edited = await send(admin, 'put', `/api/crm/leads/${created.body.id}`, { title: `فرصت ${tag}-۱`, customerId: c.id, customerName: 'رابط', phone: p2, notes, stage: 'qualified' });
    const moved = await send(admin, 'put', `/api/crm/leads/${created.body.id}`, { stage: 'proposal' });
    const converted = await send(admin, 'post', `/api/crm/leads/${created.body.id}/convert-to-customer`);
    if (edited.status !== 200 || moved.status !== 200 || converted.status !== 200) wrong.push(`edit ${edited.status}, stage change ${moved.status}, conversion ${converted.status}`);
    cNow = await customerRow(c.id);
    if (cNow.phone !== p1 || cNow.version !== c.version) wrong.push(`editing or converting the sales file changed the party phone to ${cNow.phone} and the version to ${cNow.version}`);
    const [leadNow] = await orm.select({ notes: crmLeads.notes }).from(crmLeads).where(eq(crmLeads.id, created.body.id));
    const repeats = String(leadNow?.notes ?? '').split('\n').filter(l => l.includes(toPersianDigits(p2))).length;
    if (repeats !== 1) wrong.push(`the phone difference appears ${repeats} times in the sales file notes, not once`);

    // ۲) کاربر فقط با crm.manage: فرم طرف حساب ۴۰۳ است و پرونده هم نام طرف حساب یافته‌شده با تلفن را عوض نمی‌کند
    const q = `0912${tag}2`;
    const d = await createTestCustomer({ name: `فروشگاه نور ${tag}`, phone: q, contactName: 'رابط قدیم' });
    customerIds.push(d.id);
    const direct = await send(crmOnly, 'put', `/api/customers/${d.id}`, { name: `شرکت دیگر ${tag}`, phone: q, version: d.version });
    if (direct.status !== 403) wrong.push(`direct edit of the party with a CRM-only role returned ${direct.status}, not 403`);
    const viaLead = await send(crmOnly, 'post', '/api/crm/leads', { title: `فرصت ${tag}-۲`, company: `شرکت دیگر ${tag}`, customerName: 'آقای ب', phone: q, expectedCloseDate: today });
    if (viaLead.status !== 201) throw new Error(`creating a sales file with a CRM-only role returned ${viaLead.status}`);
    leadIds.push(viaLead.body.id);
    const dNow = await customerRow(d.id);
    if (dNow.name !== d.name || dNow.contactName !== 'رابط قدیم' || dNow.version !== d.version) {
      wrong.push(`the sales file changed party "${d.name}" to name "${dNow.name}", contact "${dNow.contactName}" and version ${dNow.version}`);
    }
    if (viaLead.body.customerId !== d.id) wrong.push(`the sales file with the same phone was linked to ${viaLead.body.customerId}, not ${d.id}`);
    if (!String(viaLead.body.notes ?? '').includes(`شرکت دیگر ${tag}`)) wrong.push('The name difference did not appear in the sales file notes');

    // ۳) طرف حساب یافته‌شده با نام: تلفن و رابط خالی او هم پر نمی‌شود
    const e = await createTestCustomer({ name: `نگارخانه ${tag}`, phone: '', contactName: '' });
    customerIds.push(e.id);
    const r = `0912${tag}3`;
    const byName = await send(crmOnly, 'post', '/api/crm/leads', { title: `فرصت ${tag}-۳`, company: e.name, customerName: 'خانم ج', phone: r, expectedCloseDate: today });
    if (byName.status !== 201) throw new Error(`creating a sales file with the party name returned ${byName.status}`);
    leadIds.push(byName.body.id);
    const eNow = await customerRow(e.id);
    if (byName.body.customerId !== e.id) wrong.push(`the sales file with the party name was linked to ${byName.body.customerId}, not ${e.id}`);
    if ((eNow.phone ?? '') !== '' || (eNow.contactName ?? '') !== '' || eNow.version !== e.version) {
      wrong.push(`the sales file changed the phone and contact of party "${e.name}" to "${eNow.phone}" and "${eNow.contactName}" (version ${eNow.version})`);
    }

    // ۴) طرف حساب تازه همچنان از پرونده ساخته می‌شود
    const s = `0912${tag}4`;
    const fresh = await send(crmOnly, 'post', '/api/crm/leads', { title: `فرصت ${tag}-۴`, company: `شرکت تازه ${tag}`, customerName: 'آقای د', phone: s, expectedCloseDate: today });
    if (fresh.status !== 201) throw new Error(`creating a sales file for a new party returned ${fresh.status}`);
    leadIds.push(fresh.body.id);
    const freshId = Number(fresh.body.customerId);
    if (freshId > 0) customerIds.push(freshId);
    const freshRow = freshId > 0 ? await customerRow(freshId) : undefined;
    if (!freshRow || freshRow.name !== `شرکت تازه ${tag}` || freshRow.phone !== s || freshRow.contactName !== 'آقای د') {
      wrong.push(`the new party was not created correctly: ${JSON.stringify(freshRow ? { name: freshRow.name, phone: freshRow.phone, contactName: freshRow.contactName } : null)}`);
    }

    if (wrong.length > 0) throw new Error(wrong.join(', '));
    results.push(makeTestCase({
      id, name, layer: 'security', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'Creating, editing, changing the stage of and converting a sales file kept the party phone and version, and the difference appeared once in the notes; a CRM-only role did not change the party name, contact or phone; a new party was created',
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
