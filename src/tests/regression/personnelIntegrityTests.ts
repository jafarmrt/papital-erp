import request from 'supertest';
import { and, eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, personnel } from '../../db/schema.js';

/**
 * بسته ۱۲ (بخش پرسنل) — یکپارچگی داده پرسنل در مسیرهای واقعی Express؛ هر آزمون روی کد پیشین قرمز است.
 */

type ShouldRun = (id: string, ...extra: string[]) => boolean;
type Session = { cookie: string; csrfToken: string };

async function adminClient() {
  const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  const admin: Session = await getAdminSession();
  const send = (method: 'post' | 'put' | 'delete', url: string, body: object = {}) =>
    request(app)[method](url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body);
  return { app, admin, send };
}

async function runCase(
  results: TestCaseResult[], id: string, name: string, body: (cleanupIds: number[]) => Promise<string>,
): Promise<void> {
  const tStart = Date.now();
  const cleanupIds: number[] = [];
  try {
    const details = await body(cleanupIds);
    results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (cleanupIds.length > 0) await orm.delete(personnel).where(inArray(personnel.id, cleanupIds)).catch(() => undefined);
  }
}

const tagOf = () => String(Date.now()).slice(-6);

export async function runPersonnelIntegrityTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const importId = 'reg_personnel_import_keeps_status_td_436';
  if (shouldRun(importId, 'td436', 'personnel', 'excel', 'package12')) {
    await runCase(results, importId, 'v9.0.25: ورود اکسل با «به‌روزرسانی» خانه خالی جنسیت، وضعیت همکاری و ملیت را «بی تغییر» می‌گیرد؛ پیش‌فرض فقط برای پرسنل تازه است (TD-436)', async (ids) => {
      const { send } = await adminClient();
      const tag = tagOf();
      const code = `IMP-${tag}`;
      const created = await send('post', '/api/personnel', {
        firstName: 'مریم', lastName: `اکسل ${tag}`, personnelCode: code, gender: 'زن', employmentStatus: 'قطع همکاری',
        nationality: 'افغانستانی', endDate: '2026-03-11', terminationReason: 'پایان قرارداد',
      });
      if (created.status !== 201) throw new Error(`ثبت پرسنل ${created.status} داد`);
      ids.push(Number(created.body.id));
      const wrong: string[] = [];
      // ۱) ستون‌ها نیامده، ۲) ستون‌ها با خانه خالی (شکل ارسال پیش‌نمایش)
      for (const [label, extra] of [['بی ستون', {}], ['خانه خالی', { gender: '', employmentStatus: '', nationality: '' }]] as const) {
        const res = await send('post', '/api/personnel/bulk-import', { rows: [{ personnelCode: code, firstName: 'مریم', lastName: `اکسل ${tag}`, phone: '09351234567', ...extra }] });
        if (res.status !== 200 || res.body?.updatedCount !== 1) wrong.push(`${label}: ورود ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
        const [row] = await orm.select().from(personnel).where(eq(personnel.id, Number(created.body.id)));
        if (row.gender !== 'زن' || row.employmentStatus !== 'قطع همکاری' || row.nationality !== 'افغانستانی') {
          wrong.push(`${label}: ${row.gender}، ${row.employmentStatus}، ${row.nationality} شد`);
        }
        if (row.phone !== '09351234567') wrong.push(`${label}: تلفن ${row.phone} شد`);
      }
      // ۳) مقدار صریح جایگزین می‌شود
      await send('post', '/api/personnel/bulk-import', { rows: [{ personnelCode: code, firstName: 'مریم', employmentStatus: 'فعال' }] });
      const [after] = await orm.select().from(personnel).where(eq(personnel.id, Number(created.body.id)));
      if (after.employmentStatus !== 'فعال') wrong.push(`وضعیت صریح «فعال» ${after.employmentStatus} شد`);
      // ۴) پرسنل تازه بی این ستون‌ها پیش‌فرض می‌گیرد
      const fresh = await send('post', '/api/personnel/bulk-import', { rows: [{ personnelCode: `${code}-N`, firstName: 'تازه', lastName: `اکسل ${tag}` }] });
      const [newRow] = await orm.select().from(personnel).where(and(eq(personnel.personnelCode, `${code}-N`), eq(personnel.isDeleted, 0)));
      if (newRow) ids.push(newRow.id);
      if (fresh.status !== 200 || !newRow || newRow.gender !== 'مرد' || newRow.employmentStatus !== 'فعال' || newRow.nationality !== 'ایرانی') {
        wrong.push(`پرسنل تازه: ${fresh.status} ${JSON.stringify(newRow ? [newRow.gender, newRow.employmentStatus, newRow.nationality] : null)}`);
      }
      if (wrong.length > 0) throw new Error(wrong.join('؛ '));
      return 'خانه خالی و ستون نیامده: زن، قطع همکاری، افغانستانی ماند و تلفن به‌روز شد؛ مقدار صریح جایگزین شد؛ پرسنل تازه پیش‌فرض گرفت';
    });
  }

  const auditId = 'reg_personnel_audit_snapshot_td_437';
  if (shouldRun(auditId, 'td437', 'personnel', 'audit', 'package12')) {
    await runCase(results, auditId, 'v9.0.26: ممیزی پرسنل مقدار قبل و بعد فیلدهای تغییرکرده و IP را دارد، بی رمز نوبیتکس؛ ورود اکسل برای هر پرسنل ردیف خود را می‌نویسد (TD-437)', async (ids) => {
      const { send } = await adminClient();
      const tag = tagOf();
      const previousKey = process.env.ERP_SECRETS_KEY;
      process.env.ERP_SECRETS_KEY = previousKey || 'td437-test-key-0123456789-abcdefghijklmnop';
      try {
        const wrong: string[] = [];
        const logsOf = async (pid: number) => (await orm.select().from(activityLogs)
          .where(and(eq(activityLogs.entity, 'پرسنل'), eq(activityLogs.entityId, String(pid))))).sort((x, y) => x.id - y.id);
        const created = await send('post', '/api/personnel', {
          firstName: 'زهرا', lastName: `ممیزی ${tag}`, personnelCode: `AUD-${tag}`, salaryType: 'monthly_fixed', monthlySalary: 45000000,
          shebaNumber: 'IR120120000000001234567890', nobitexPassword: 'Old#437',
        });
        if (created.status !== 201) throw new Error(`ثبت پرسنل ${created.status} داد`);
        const pid = Number(created.body.id);
        ids.push(pid);
        const put = await send('put', `/api/personnel/${pid}`, {
          firstName: 'زهرا', lastName: `ممیزی ${tag}`, salaryType: 'monthly_fixed', monthlySalary: 60000000,
          shebaNumber: 'IR550560000000009876543210', nobitexPassword: 'New#437',
        });
        if (put.status !== 200) throw new Error(`ویرایش پرسنل ${put.status} داد`);
        const logs = await logsOf(pid);
        const create = logs.find(l => l.action === 'CREATE');
        const update = logs.find(l => l.action === 'UPDATE');
        const cd = (create?.details ?? {}) as { after?: Record<string, unknown> };
        if (Number(cd.after?.monthlySalary) !== 45000000) wrong.push(`ردیف ثبت مقدار بعد ندارد: ${JSON.stringify(create?.details).slice(0, 120)}`);
        const ud = (update?.details ?? {}) as { before?: Record<string, unknown>; after?: Record<string, unknown>; nobitexPasswordChanged?: boolean };
        if (Number(ud.before?.monthlySalary) !== 45000000 || Number(ud.after?.monthlySalary) !== 60000000) wrong.push(`حقوق قبل و بعد ${JSON.stringify(ud).slice(0, 160)}`);
        if (ud.before?.shebaNumber !== 'IR120120000000001234567890' || ud.after?.shebaNumber !== 'IR550560000000009876543210') wrong.push('شبای قبل و بعد ثبت نشد');
        if (ud.before && 'firstName' in ud.before) wrong.push('فیلد تغییرنکرده در ممیزی آمد');
        if (ud.nobitexPasswordChanged !== true) wrong.push('تغییر رمز نوبیتکس علامت نخورد');
        const raw = JSON.stringify(logs.map(l => l.details));
        if (raw.includes('Old#437') || raw.includes('New#437') || raw.includes('enc:v1:')) wrong.push('رمز نوبیتکس یا متن رمزشده در ممیزی آمد');
        if (!create?.ipAddress || !update?.ipAddress) wrong.push(`IP ثبت نشد (ثبت «${create?.ipAddress}»، ویرایش «${update?.ipAddress}»)`);

        // ورود اکسل: ردیف ممیزی برای هر پرسنل ساخته‌شده یا به‌روزشده
        const imp = await send('post', '/api/personnel/bulk-import', { rows: [
          { personnelCode: `AUD-${tag}`, firstName: 'زهرا', phone: '09121112233' },
          { personnelCode: `AUD-${tag}-N`, firstName: 'تازه', lastName: `ممیزی ${tag}` },
        ] });
        if (imp.status !== 200) throw new Error(`ورود اکسل ${imp.status} داد`);
        const [fresh] = await orm.select({ id: personnel.id }).from(personnel).where(and(eq(personnel.personnelCode, `AUD-${tag}-N`), eq(personnel.isDeleted, 0)));
        if (fresh) ids.push(fresh.id);
        const importUpdate = (await logsOf(pid)).filter(l => l.action === 'UPDATE').pop();
        const iu = (importUpdate?.details ?? {}) as { before?: Record<string, unknown>; after?: Record<string, unknown> };
        if (iu.before?.phone !== '' || iu.after?.phone !== '09121112233') wrong.push(`ورود اکسل ردیف ممیزی به‌روزرسانی با تلفن قبل و بعد نساخت ${JSON.stringify(iu).slice(0, 120)}`);
        if (!fresh || !(await logsOf(fresh.id)).some(l => l.action === 'CREATE')) wrong.push('ورود اکسل برای پرسنل تازه ردیف ممیزی نساخت');

        // حذف: مقدار قبل
        await send('delete', `/api/personnel/${pid}`);
        const del = (await logsOf(pid)).find(l => l.action === 'DELETE');
        if (Number(((del?.details ?? {}) as { before?: Record<string, unknown> }).before?.monthlySalary) !== 60000000) wrong.push('ردیف حذف مقدار قبل ندارد');

        if (wrong.length > 0) throw new Error(wrong.join('؛ '));
        return 'ثبت (بعد)، ویرایش (فقط حقوق و شبای قبل و بعد، علامت تغییر رمز بی متن رمز)، IP، یک ردیف برای هر پرسنل ورود اکسل و حذف (قبل)';
      } finally {
        if (previousKey === undefined) delete process.env.ERP_SECRETS_KEY; else process.env.ERP_SECRETS_KEY = previousKey;
      }
    });
  }

  const salaryId = 'reg_personnel_salary_decimal_input_td_438';
  if (shouldRun(salaryId, 'td438', 'personnel', 'salary', 'package12')) {
    await runCase(results, salaryId, 'v9.0.27: حقوق ماهانه پرسنل با decimalInput خوانده می‌شود: متن و منفی رد می‌شود، ارقام فارسی پذیرفته و خانه خالی صفر است (TD-438)', async (ids) => {
      const { send } = await adminClient();
      const tag = tagOf();
      const wrong: string[] = [];
      const base = (n: string) => ({ firstName: 'سارا', lastName: `حقوق ${tag} ${n}`, salaryType: 'monthly_fixed' });
      const salaryOf = async (pid: number) => Number((await orm.select({ s: personnel.monthlySalary }).from(personnel).where(eq(personnel.id, pid)))[0]?.s);
      const countOf = async (n: string) => (await orm.select({ id: personnel.id }).from(personnel)
        .where(and(eq(personnel.lastName, `حقوق ${tag} ${n}`), eq(personnel.isDeleted, 0)))).map(r => r.id);

      // ۱) ثبت با متن یا منفی رد می‌شود و پرسنلی ساخته نمی‌شود
      for (const [n, value] of [['متن', 'abc'], ['منفی', '-5000000'], ['منفی عددی', -1]] as const) {
        const res = await send('post', '/api/personnel', { ...base(n), monthlySalary: value });
        const made = await countOf(n);
        ids.push(...made);
        if (res.status !== 400 || made.length > 0) wrong.push(`ثبت با «${value}»: ${res.status} و ${made.length} پرسنل`);
      }
      // ۲) ارقام فارسی و جداکننده هزارگان پذیرفته می‌شود؛ خانه خالی صفر است
      const fa = await send('post', '/api/personnel', { ...base('فارسی'), monthlySalary: '۴۵٬۰۰۰٬۰۰۰' });
      if (fa.status === 201) ids.push(Number(fa.body.id));
      if (fa.status !== 201 || await salaryOf(Number(fa.body.id)) !== 45000000) wrong.push(`ثبت با «۴۵٬۰۰۰٬۰۰۰»: ${fa.status}`);
      const empty = await send('post', '/api/personnel', { ...base('خالی'), monthlySalary: '' });
      if (empty.status === 201) ids.push(Number(empty.body.id));
      if (empty.status !== 201 || await salaryOf(Number(empty.body.id)) !== 0) wrong.push(`ثبت با خانه خالی: ${empty.status}`);

      // ۳) ویرایش: متن و منفی رد می‌شود و حقوق دست نمی‌خورد؛ نیامدن فیلد حقوق را نگه می‌دارد؛ خانه خالی صفر می‌کند
      if (fa.status === 201) {
        const pid = Number(fa.body.id);
        for (const value of ['abc', '-5000000']) {
          const res = await send('put', `/api/personnel/${pid}`, { ...base('فارسی'), monthlySalary: value });
          if (res.status !== 400 || await salaryOf(pid) !== 45000000) wrong.push(`ویرایش با «${value}»: ${res.status} و حقوق ${await salaryOf(pid)}`);
        }
        const keep = await send('put', `/api/personnel/${pid}`, { ...base('فارسی'), jobTitle: 'زرگر' });
        if (keep.status !== 200 || await salaryOf(pid) !== 45000000) wrong.push(`ویرایش بی فیلد حقوق: ${keep.status} و حقوق ${await salaryOf(pid)}`);
        const clear = await send('put', `/api/personnel/${pid}`, { ...base('فارسی'), monthlySalary: '' });
        if (clear.status !== 200 || await salaryOf(pid) !== 0) wrong.push(`ویرایش با خانه خالی: ${clear.status} و حقوق ${await salaryOf(pid)}`);
      }
      if (wrong.length > 0) throw new Error(wrong.join('؛ '));
      return 'متن و منفی در ثبت و ویرایش ۴۰۰ بی تغییر؛ ارقام فارسی ۴۵٬۰۰۰٬۰۰۰ پذیرفته؛ خانه خالی صفر؛ نیامدن فیلد حقوق را نگه داشت';
    });
  }

  return results;
}
