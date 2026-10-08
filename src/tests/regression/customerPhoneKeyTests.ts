import request from 'supertest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { crmActivities, crmLeads, customers } from '../../db/schema.js';
import { toPersianDigits } from '../../utils/persianNumber.js';

/**
 * بسته ۹ (مشتریان و CRM) — تلفن طرف حساب با کلید تطبیق در مسیرهای واقعی Express؛ روی کد پیشین قرمز است.
 */

interface Session { cookie: string; csrfToken: string }

export async function runCustomerPhoneKeyTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_customer_phone_match_key_td_419';
  if (!shouldRun(id, 'td419', 'customer', 'phone', 'crm', 'package9')) return results;

  const name = 'v9.0.7: the same phone number written another way (spaces, +98, 0098, Persian digits, no leading zero) creates no new party; the sales lead, the form and the import find the same party (TD-419)';
  const tStart = Date.now();
  const customerIds: number[] = [];
  const leadIds: number[] = [];
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestCustomer } = await import('../fixtures/factories.js');
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
    const { phoneMatchKeySql } = await import('../../services/woocommerce/phoneMatchKey.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const send = (method: 'post' | 'put', url: string, body: object, s: Session = admin) =>
      request(app)[method](url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body);
    const today = await businessTodayIsoDate();
    const tag = String(Date.now()).slice(-6);
    const key = `912${tag}7`;
    const p = `0${key}`;
    const holders = async () => (await orm.select({ id: customers.id }).from(customers)
      .where(and(eq(customers.isDeleted, 0), sql`${phoneMatchKeySql(customers.phone)} = ${key}`))).map(r => r.id);
    const wrong: string[] = [];

    const c = await createTestCustomer({ name: `خانم رضایی ${tag}`, phone: p });
    customerIds.push(c.id);

    // ۱) پرونده فروش با سه نگارش دیگر همان شماره به همان طرف حساب پیوند می‌خورد و اختلاف تلفنی ثبت نمی‌شود
    const formats = [`0912 ${tag.slice(0, 3)} ${tag.slice(3)}7`, `+98${key}`, toPersianDigits(p)];
    for (const [i, phone] of formats.entries()) {
      const lead = await send('post', '/api/crm/leads', { title: `فرصت ${tag}-${i}`, customerName: `مریم رضایی ${tag}`, phone, expectedCloseDate: today });
      if (lead.status !== 201) throw new Error(`creating a sales file with "${phone}" returned ${lead.status}`);
      leadIds.push(lead.body.id);
      const linked = Number(lead.body.customerId);
      if (linked !== c.id) {
        if (linked > 0) customerIds.push(linked);
        wrong.push(`sales file with "${phone}" was linked to party ${linked}, not ${c.id}`);
      }
      if (String(lead.body.notes ?? '').includes('تلفن پرونده')) wrong.push(`a phone difference was recorded for "${phone}"`);
    }

    // ۲) فرم طرف حساب: ساخت با ۰۰۹۸ و ویرایش طرف حساب دیگر به ‎+98 تکراری است؛ ویرایش خود طرف حساب با نگارش دیگر شماره‌اش رد نمی‌شود
    const created = await send('post', '/api/customers', { name: `مشتری دیگر ${tag}`, phone: `0098 ${key}` });
    if (created.status === 200 && created.body?.id) customerIds.push(created.body.id);
    if (created.status !== 400) wrong.push(`creating a party with the same number in 0098 form returned ${created.status}, not 400`);
    const d = await createTestCustomer({ name: `آقای نوری ${tag}`, phone: `0912${tag}8` });
    customerIds.push(d.id);
    const movedPhone = await send('put', `/api/customers/${d.id}`, { name: d.name, phone: `+98${key}`, version: d.version });
    if (movedPhone.status !== 400) wrong.push(`editing another party phone to the same number returned ${movedPhone.status}, not 400`);
    const own = await send('put', `/api/customers/${c.id}`, { name: c.name, phone: formats[0], version: c.version });
    if (own.status !== 200) wrong.push(`editing a party with another spelling of its own number returned ${own.status}`);

    // ۳) درون‌ریزی: تلفنی که اکسل صفر اولش را انداخته همان طرف حساب است
    const imported = await send('post', '/api/customers/bulk-import', { rows: [{ name: `رضایی اکسل ${tag}`, phone: key }], updateIfExists: false });
    if (imported.status !== 200 || imported.body?.createdCount !== 0 || (imported.body?.errors ?? []).length !== 1) {
      wrong.push(`import of the same number without a leading zero: ${imported.status}, created ${imported.body?.createdCount}, errors ${(imported.body?.errors ?? []).length}`);
    }

    const finalHolders = await holders();
    for (const h of finalHolders) if (!customerIds.includes(h)) customerIds.push(h);
    if (JSON.stringify(finalHolders) !== JSON.stringify([c.id])) wrong.push(`active parties with this number are ${JSON.stringify(finalHolders)}, not [${c.id}]`);

    if (wrong.length > 0) throw new Error(wrong.join(', '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'three sales files with spaces, +98 and Persian digits linked to the same party; the create form and moving the number returned 400 and editing the party itself 200; import without a leading zero created nothing; one active party for the number',
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
    if (customerIds.length > 0) await orm.update(customers).set({ isDeleted: 1 }).where(inArray(customers.id, customerIds)).catch(() => undefined);
  }
  return results;
}
