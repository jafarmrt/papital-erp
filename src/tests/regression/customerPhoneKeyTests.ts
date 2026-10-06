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

  const name = 'v9.0.7: یک شماره تلفن با نگارش دیگر (فاصله، ‎+98، ۰۰۹۸، ارقام فارسی، بی صفر اول) طرف حساب تازه نمی‌سازد؛ پرونده فروش، فرم و درون‌ریزی همان طرف حساب را می‌یابند (TD-419)';
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
      if (lead.status !== 201) throw new Error(`ثبت پرونده با «${phone}» ${lead.status} داد`);
      leadIds.push(lead.body.id);
      const linked = Number(lead.body.customerId);
      if (linked !== c.id) {
        if (linked > 0) customerIds.push(linked);
        wrong.push(`پرونده با «${phone}» به طرف حساب ${linked} پیوند خورد، نه ${c.id}`);
      }
      if (String(lead.body.notes ?? '').includes('تلفن پرونده')) wrong.push(`برای «${phone}» اختلاف تلفن ثبت شد`);
    }

    // ۲) فرم طرف حساب: ساخت با ۰۰۹۸ و ویرایش طرف حساب دیگر به ‎+98 تکراری است؛ ویرایش خود طرف حساب با نگارش دیگر شماره‌اش رد نمی‌شود
    const created = await send('post', '/api/customers', { name: `مشتری دیگر ${tag}`, phone: `0098 ${key}` });
    if (created.status === 200 && created.body?.id) customerIds.push(created.body.id);
    if (created.status !== 400) wrong.push(`ساخت طرف حساب با ۰۰۹۸ همان شماره ${created.status} داد، نه ۴۰۰`);
    const d = await createTestCustomer({ name: `آقای نوری ${tag}`, phone: `0912${tag}8` });
    customerIds.push(d.id);
    const movedPhone = await send('put', `/api/customers/${d.id}`, { name: d.name, phone: `+98${key}`, version: d.version });
    if (movedPhone.status !== 400) wrong.push(`ویرایش تلفن طرف حساب دیگر به همان شماره ${movedPhone.status} داد، نه ۴۰۰`);
    const own = await send('put', `/api/customers/${c.id}`, { name: c.name, phone: formats[0], version: c.version });
    if (own.status !== 200) wrong.push(`ویرایش طرف حساب با نگارش دیگر شماره خودش ${own.status} داد`);

    // ۳) درون‌ریزی: تلفنی که اکسل صفر اولش را انداخته همان طرف حساب است
    const imported = await send('post', '/api/customers/bulk-import', { rows: [{ name: `رضایی اکسل ${tag}`, phone: key }], updateIfExists: false });
    if (imported.status !== 200 || imported.body?.createdCount !== 0 || (imported.body?.errors ?? []).length !== 1) {
      wrong.push(`درون‌ریزی همان شماره بی صفر اول: ${imported.status}، ساخته‌شده ${imported.body?.createdCount}، خطا ${(imported.body?.errors ?? []).length}`);
    }

    const finalHolders = await holders();
    for (const h of finalHolders) if (!customerIds.includes(h)) customerIds.push(h);
    if (JSON.stringify(finalHolders) !== JSON.stringify([c.id])) wrong.push(`طرف حساب‌های فعال این شماره ${JSON.stringify(finalHolders)} است، نه [${c.id}]`);

    if (wrong.length > 0) throw new Error(wrong.join('، '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'سه پرونده با فاصله، ‎+98 و ارقام فارسی به همان طرف حساب پیوند خوردند؛ فرم ساخت و جابه‌جایی شماره را ۴۰۰ داد و ویرایش خود طرف حساب ۲۰۰؛ درون‌ریزی بی صفر اول چیزی نساخت؛ یک طرف حساب فعال برای شماره',
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
