import { personnelVersion } from '../fixtures/personnelVersion.js';
import request from 'supertest';
import { inArray, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { personnel, pieceworkPayrolls, users } from '../../db/schema.js';
import { money } from '../../lib/money.js';

/**
 * بسته ۱۲ (بخش پرسنل) — هر کاربر حداکثر به یک پرسنل فعال وصل می‌شود (تصمیم مالک محصول D2 الف) و «فیش‌های من»
 * فیش پرسنل دیگری را نمی‌دهد؛ روی کد پیشین قرمز است: پیوند دوم و پیوند به کاربر ناموجود هر دو ۲۰۱ می‌گرفتند.
 */

interface Session { cookie: string; csrfToken: string }

export async function runPersonnelUserLinkTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'sec_personnel_user_link_unique_td_435';
  if (!shouldRun(id, 'security', 'td435', 'personnel', 'payroll', 'package12')) return results;

  const name = 'v9.0.24: each user links to at most one active personnel, also concurrently (partial unique index, migration 0053); a missing or deleted user gets 422 and my payslips gives no payslip to a user with an old duplicate link (TD-435)';
  const tStart = Date.now();
  const personnelIds: number[] = [];
  const userIds: number[] = [];
  const payrollIds: number[] = [];
  try {
    const { getTestApp, getAdminSession, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestUser } = await import('../fixtures/factories.js');
    const { PayrollReadService } = await import('../../services/piecework/payrollRead.service.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const tag = String(Date.now()).slice(-6);
    const wrong: string[] = [];
    const send = (method: 'post' | 'put', url: string, body: object) =>
      request(app)[method](url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body);
    const newPersonnel = async (label: string, userId?: unknown) => {
      const res = await send('post', '/api/personnel', { firstName: label, lastName: `پیوند ${tag}`, ...(userId !== undefined ? { userId } : {}) });
      if (res.status === 201) personnelIds.push(Number(res.body.id));
      return res;
    };
    const mine = (s: Session) => request(app).get('/api/piecework/payrolls/mine').set('Cookie', s.cookie);

    const employee = await createTestUser({ role: 'daily_logger' });
    userIds.push(employee.id);
    const employeeSession = await loginTestUserWithSession(app, employee.username);

    // ۱) پیوند اول ۲۰۱؛ پیوند دوم همان کاربر در ثبت و در ویرایش ۴۰۹ با نام پرسنل وصل
    const a = await newPersonnel('الف', employee.id);
    if (a.status !== 201) throw new Error(`creating personnel A returned ${a.status}`);
    const b = await newPersonnel('ب', employee.id);
    if (b.status !== 409) wrong.push(`a second link to the same user on create returned ${b.status}, not 409`);
    else if (!String(b.body?.error ?? b.body?.message ?? '').includes(`الف پیوند ${tag}`)) wrong.push(`the duplicate link message does not name the linked personnel: ${JSON.stringify(b.body).slice(0, 160)}`);
    const c = await newPersonnel('ج');
    if (c.status !== 201) throw new Error(`creating personnel C returned ${c.status}`);
    const cId = Number(c.body.id);
    const linkC = await send('put', `/api/personnel/${cId}`, { version: await personnelVersion(cId), firstName: 'ج', lastName: `پیوند ${tag}`, userId: employee.id });
    if (linkC.status !== 409) wrong.push(`a second link to the same user on edit returned ${linkC.status}, not 409`);
    // ویرایش خود پرسنل الف با همان کاربر آزاد است
    const keepA = await send('put', `/api/personnel/${a.body.id}`, { version: await personnelVersion(a.body.id), firstName: 'الف', lastName: `پیوند ${tag}`, userId: employee.id, jobTitle: 'زرگر' });
    if (keepA.status !== 200) wrong.push(`editing personnel A with its own user returned ${keepA.status}`);

    // ۲) «فیش‌های من» فیش پرسنل دیگری را نمی‌دهد (فیش تأییدشده پرسنل ج)
    const [pay] = await orm.insert(pieceworkPayrolls).values({
      payrollNumber: `S4-${tag}`, personnelId: cId, startDate: '2026-09-23', endDate: '2026-10-22', title: `فیش آزمون ${tag}`,
      netPayable: money(87000000), status: 'approved',
    }).returning({ id: pieceworkPayrolls.id });
    payrollIds.push(pay.id);
    const mineRes = await mine(employeeSession);
    const foreign = (Array.isArray(mineRes.body) ? mineRes.body : []).filter((r: { personnelId?: number }) => Number(r.personnelId) !== Number(a.body.id));
    if (mineRes.status !== 200 || foreign.length > 0) wrong.push(`"my payslips" returned ${mineRes.status} and ${foreign.length} payslips of other personnel`);

    // ۳) کاربر ناموجود، حذف‌شده یا شناسه نامعتبر ۴۲۲؛ بی کاربر (خالی) آزاد
    const deletedUser = await createTestUser({ role: 'daily_logger', isDeleted: 1 } as Parameters<typeof createTestUser>[0]);
    userIds.push(deletedUser.id);
    for (const [label, value] of [['ناموجود', 987654321], ['حذف‌شده', deletedUser.id], ['متنی', 'abc'], ['منفی', -3]] as const) {
      const res = await newPersonnel(`نامعتبر ${label}`, value);
      if (res.status !== 422) wrong.push(`linking to user ${label} returned ${res.status}, not 422`);
    }
    const unlinked = await newPersonnel('بی کاربر', '');
    if (unlinked.status !== 201 || unlinked.body?.userId !== null) wrong.push(`personnel without a user returned ${unlinked.status} and userId ${unlinked.body?.userId}`);

    // ۴) چهار ثبت هم‌زمان با یک کاربر تازه: فقط یکی وصل می‌شود
    const racer = await createTestUser({ role: 'daily_logger' });
    userIds.push(racer.id);
    const burst = await Promise.all(Array.from({ length: 4 }, (_, i) => newPersonnel(`هم‌زمان ${i}`, racer.id)));
    const linked = await orm.select({ id: personnel.id }).from(personnel).where(sql`${personnel.userId} = ${racer.id} AND ${personnel.isDeleted} = 0`);
    if (linked.length !== 1) wrong.push(`concurrent creates linked ${linked.length} personnel to one user (statuses ${burst.map(r => r.status).join(',')})`);

    // ۵) پیوند تکراری قدیمی (پایگاه‌داده‌ای که مهاجرت 0053 ایندکس را نساخت): «فیش‌های من» رد می‌کند و بازرس سلامت آن را می‌یابد
    try {
      await orm.transaction(async (tx) => {
        await tx.execute(sql`DROP INDEX IF EXISTS uq_personnel_user_active`);
        const [dup] = await tx.insert(personnel).values({ fullName: `پیوند تکراری قدیمی ${tag}`, userId: employee.id }).returning({ id: personnel.id });
        try {
          await PayrollReadService.listPayrollsForUser(employee.id, tx);
          wrong.push('"My payslips" returned payslips despite an old duplicate link');
        } catch (err) {
          if ((err as { statusCode?: number }).statusCode !== 409) wrong.push(`"my payslips" with a duplicate link: ${err instanceof Error ? err.message : String(err)}`);
        }
        const { findDuplicatePersonnelUserLinks, buildPersonnelUserLinkHealthTest } = await import('../../services/personnel/personnelUserLink.js');
        const dups = await findDuplicatePersonnelUserLinks(tx);
        const health = buildPersonnelUserLinkHealthTest(dups, false);
        if (!dups.some(r => r.id === dup.id) || health.status !== 'warning' || health.count < 1) wrong.push(`the health check did not find the duplicate link ${JSON.stringify({ n: dups.length, status: health.status })}`);
        tx.rollback();
      }).catch((err: unknown) => {
        if (!(err instanceof Error && err.message.toLowerCase().includes('rollback'))) throw err;
      });
    } catch (err) {
      wrong.push(`old duplicate link: ${err instanceof Error ? err.message : String(err)}`);
    }

    // ۶) بازرس سلامت روی داده تمیز: قید هست و پیوند تکراری نیست
    const { FinancialHealthService } = await import('../../services/accounting/financialHealth.service.js');
    const report = await FinancialHealthService.runHealthCheck();
    const check = report.tests.find(t => t.id === 'personnel_user_link_uniqueness');
    if (!check || check.metrics?.uniqueIndexPresent !== 1 || check.count !== 0) wrong.push(`user-personnel link health check ${JSON.stringify(check?.metrics ?? null)}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'security', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'Second link on create and edit is 409; "my payslips" has no payslips of others; a missing, deleted, text or negative user is 422; four concurrent creates make one link; an old duplicate link is 409 and listed by the health check',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'security', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (payrollIds.length > 0) await orm.delete(pieceworkPayrolls).where(inArray(pieceworkPayrolls.id, payrollIds)).catch(() => undefined);
    if (personnelIds.length > 0) await orm.delete(personnel).where(inArray(personnel.id, personnelIds)).catch(() => undefined);
    if (userIds.length > 0) await orm.delete(users).where(inArray(users.id, userIds)).catch(() => undefined);
  }
  return results;
}
