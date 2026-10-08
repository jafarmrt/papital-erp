import { personnelVersion } from '../fixtures/personnelVersion.js';
import request from 'supertest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { accounts, activityLogs, journalVoucherItems, journalVouchers, personnel, pieceworkLogs, pieceworkPayrolls, pieceworkTasks } from '../../db/schema.js';
import { money } from '../../lib/money.js';

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
    await runCase(results, importId, 'v9.0.25: in the Excel import an empty gender, employment status or nationality cell means unchanged on update; the default is only for a new personnel (TD-436)', async (ids) => {
      const { send } = await adminClient();
      const tag = tagOf();
      const code = `IMP-${tag}`;
      const created = await send('post', '/api/personnel', {
        firstName: 'مریم', lastName: `اکسل ${tag}`, personnelCode: code, gender: 'زن', employmentStatus: 'قطع همکاری',
        nationality: 'افغانستانی', endDate: '2026-03-11', terminationReason: 'پایان قرارداد',
      });
      if (created.status !== 201) throw new Error(`Personnel create returned ${created.status}`);
      ids.push(Number(created.body.id));
      const wrong: string[] = [];
      // ۱) ستون‌ها نیامده، ۲) ستون‌ها با خانه خالی (شکل ارسال پیش‌نمایش)
      for (const [label, extra] of [['بی ستون', {}], ['خانه خالی', { gender: '', employmentStatus: '', nationality: '' }]] as const) {
        const res = await send('post', '/api/personnel/bulk-import', { rows: [{ personnelCode: code, firstName: 'مریم', lastName: `اکسل ${tag}`, phone: '09351234567', ...extra }] });
        if (res.status !== 200 || res.body?.updatedCount !== 1) wrong.push(`${label}: import ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
        const [row] = await orm.select().from(personnel).where(eq(personnel.id, Number(created.body.id)));
        if (row.gender !== 'زن' || row.employmentStatus !== 'قطع همکاری' || row.nationality !== 'افغانستانی') {
          wrong.push(`${label}: became ${row.gender}, ${row.employmentStatus}, ${row.nationality}`);
        }
        if (row.phone !== '09351234567') wrong.push(`${label}: phone became ${row.phone}`);
      }
      // ۳) مقدار صریح جایگزین می‌شود
      await send('post', '/api/personnel/bulk-import', { rows: [{ personnelCode: code, firstName: 'مریم', employmentStatus: 'فعال' }] });
      const [after] = await orm.select().from(personnel).where(eq(personnel.id, Number(created.body.id)));
      if (after.employmentStatus !== 'فعال') wrong.push(`explicit status "active" became ${after.employmentStatus}`);
      // ۴) پرسنل تازه بی این ستون‌ها پیش‌فرض می‌گیرد
      const fresh = await send('post', '/api/personnel/bulk-import', { rows: [{ personnelCode: `${code}-N`, firstName: 'تازه', lastName: `اکسل ${tag}` }] });
      const [newRow] = await orm.select().from(personnel).where(and(eq(personnel.personnelCode, `${code}-N`), eq(personnel.isDeleted, 0)));
      if (newRow) ids.push(newRow.id);
      if (fresh.status !== 200 || !newRow || newRow.gender !== 'مرد' || newRow.employmentStatus !== 'فعال' || newRow.nationality !== 'ایرانی') {
        wrong.push(`new personnel: ${fresh.status} ${JSON.stringify(newRow ? [newRow.gender, newRow.employmentStatus, newRow.nationality] : null)}`);
      }
      if (wrong.length > 0) throw new Error(wrong.join('; '));
      return 'خانه خالی و ستون نیامده: زن، قطع همکاری، افغانستانی ماند و تلفن به‌روز شد؛ مقدار صریح جایگزین شد؛ پرسنل تازه پیش‌فرض گرفت';
    });
  }

  const auditId = 'reg_personnel_audit_snapshot_td_437';
  if (shouldRun(auditId, 'td437', 'personnel', 'audit', 'package12')) {
    await runCase(results, auditId, 'v9.0.26: the personnel audit row has the before and after of the changed fields and the IP, without the Nobitex password; the Excel import writes one row per personnel (TD-437)', async (ids) => {
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
        if (created.status !== 201) throw new Error(`Personnel create returned ${created.status}`);
        const pid = Number(created.body.id);
        ids.push(pid);
        const put = await send('put', `/api/personnel/${pid}`, {
          version: await personnelVersion(pid),
          firstName: 'زهرا', lastName: `ممیزی ${tag}`, salaryType: 'monthly_fixed', monthlySalary: 60000000,
          shebaNumber: 'IR550560000000009876543210', nobitexPassword: 'New#437',
        });
        if (put.status !== 200) throw new Error(`Personnel edit returned ${put.status}`);
        const logs = await logsOf(pid);
        const create = logs.find(l => l.action === 'CREATE');
        const update = logs.find(l => l.action === 'UPDATE');
        const cd = (create?.details ?? {}) as { after?: Record<string, unknown> };
        if (Number(cd.after?.monthlySalary) !== 45000000) wrong.push(`the create row has no after value: ${JSON.stringify(create?.details).slice(0, 120)}`);
        const ud = (update?.details ?? {}) as { before?: Record<string, unknown>; after?: Record<string, unknown>; nobitexPasswordChanged?: boolean };
        if (Number(ud.before?.monthlySalary) !== 45000000 || Number(ud.after?.monthlySalary) !== 60000000) wrong.push(`salary before and after ${JSON.stringify(ud).slice(0, 160)}`);
        // v9.0.213 (TD-530، تصمیم ت۷ الف): شبا تا ۴ رقم آخر پوشیده است و تغییرش دیده می‌شود
        if (ud.before?.shebaNumber !== '****7890' || ud.after?.shebaNumber !== '****3210') wrong.push(`Sheba before and after ${JSON.stringify([ud.before?.shebaNumber, ud.after?.shebaNumber])}`);
        if (ud.before && 'firstName' in ud.before) wrong.push('an unchanged field appears in the audit log');
        if (ud.nobitexPasswordChanged !== true) wrong.push('the Nobitex password change is not flagged');
        const raw = JSON.stringify(logs.map(l => l.details));
        if (raw.includes('Old#437') || raw.includes('New#437') || raw.includes('enc:v1:')) wrong.push('the Nobitex password or its encrypted text appears in the audit log');
        if (!create?.ipAddress || !update?.ipAddress) wrong.push(`IP not recorded (create "${create?.ipAddress}", edit "${update?.ipAddress}")`);

        // ورود اکسل: ردیف ممیزی برای هر پرسنل ساخته‌شده یا به‌روزشده
        const imp = await send('post', '/api/personnel/bulk-import', { rows: [
          { personnelCode: `AUD-${tag}`, firstName: 'زهرا', phone: '09121112233' },
          { personnelCode: `AUD-${tag}-N`, firstName: 'تازه', lastName: `ممیزی ${tag}` },
        ] });
        if (imp.status !== 200) throw new Error(`Excel import returned ${imp.status}`);
        const [fresh] = await orm.select({ id: personnel.id }).from(personnel).where(and(eq(personnel.personnelCode, `AUD-${tag}-N`), eq(personnel.isDeleted, 0)));
        if (fresh) ids.push(fresh.id);
        const importUpdate = (await logsOf(pid)).filter(l => l.action === 'UPDATE').pop();
        const iu = (importUpdate?.details ?? {}) as { before?: Record<string, unknown>; after?: Record<string, unknown> };
        if (iu.before?.phone !== '' || iu.after?.phone !== '09121112233') wrong.push(`Excel import did not create an update audit row with the phone before and after ${JSON.stringify(iu).slice(0, 120)}`);
        if (!fresh || !(await logsOf(fresh.id)).some(l => l.action === 'CREATE')) wrong.push('Excel import did not create an audit row for the new personnel');

        // حذف: مقدار قبل
        await send('delete', `/api/personnel/${pid}`);
        const del = (await logsOf(pid)).find(l => l.action === 'DELETE');
        if (Number(((del?.details ?? {}) as { before?: Record<string, unknown> }).before?.monthlySalary) !== 60000000) wrong.push('the delete row has no before value');

        if (wrong.length > 0) throw new Error(wrong.join('; '));
        return 'ثبت (بعد)، ویرایش (فقط حقوق و شبای قبل و بعد، علامت تغییر رمز بی متن رمز)، IP، یک ردیف برای هر پرسنل ورود اکسل و حذف (قبل)';
      } finally {
        if (previousKey === undefined) delete process.env.ERP_SECRETS_KEY; else process.env.ERP_SECRETS_KEY = previousKey;
      }
    });
  }

  const salaryId = 'reg_personnel_salary_decimal_input_td_438';
  if (shouldRun(salaryId, 'td438', 'personnel', 'salary', 'package12')) {
    await runCase(results, salaryId, 'v9.0.27: the monthly salary is read with decimalInput: text and negatives are refused, Persian digits accepted and an empty field is zero (TD-438)', async (ids) => {
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
        if (res.status !== 400 || made.length > 0) wrong.push(`create with "${value}": ${res.status} and ${made.length} personnel`);
      }
      // ۲) ارقام فارسی و جداکننده هزارگان پذیرفته می‌شود؛ خانه خالی صفر است
      const fa = await send('post', '/api/personnel', { ...base('فارسی'), monthlySalary: '۴۵٬۰۰۰٬۰۰۰' });
      if (fa.status === 201) ids.push(Number(fa.body.id));
      if (fa.status !== 201 || await salaryOf(Number(fa.body.id)) !== 45000000) wrong.push(`create with Persian-digit "45,000,000": ${fa.status}`);
      const empty = await send('post', '/api/personnel', { ...base('خالی'), monthlySalary: '' });
      if (empty.status === 201) ids.push(Number(empty.body.id));
      if (empty.status !== 201 || await salaryOf(Number(empty.body.id)) !== 0) wrong.push(`create with an empty cell: ${empty.status}`);

      // ۳) ویرایش: متن و منفی رد می‌شود و حقوق دست نمی‌خورد؛ نیامدن فیلد حقوق را نگه می‌دارد؛ خانه خالی صفر می‌کند
      if (fa.status === 201) {
        const pid = Number(fa.body.id);
        for (const value of ['abc', '-5000000']) {
          const res = await send('put', `/api/personnel/${pid}`, { version: await personnelVersion(pid), ...base('فارسی'), monthlySalary: value });
          if (res.status !== 400 || await salaryOf(pid) !== 45000000) wrong.push(`edit with "${value}": ${res.status} and salary ${await salaryOf(pid)}`);
        }
        const keep = await send('put', `/api/personnel/${pid}`, { version: await personnelVersion(pid), ...base('فارسی'), jobTitle: 'زرگر' });
        if (keep.status !== 200 || await salaryOf(pid) !== 45000000) wrong.push(`edit without the salary field: ${keep.status} and salary ${await salaryOf(pid)}`);
        const clear = await send('put', `/api/personnel/${pid}`, { version: await personnelVersion(pid), ...base('فارسی'), monthlySalary: '' });
        if (clear.status !== 200 || await salaryOf(pid) !== 0) wrong.push(`edit with an empty cell: ${clear.status} and salary ${await salaryOf(pid)}`);
      }
      if (wrong.length > 0) throw new Error(wrong.join('; '));
      return 'متن و منفی در ثبت و ویرایش ۴۰۰ بی تغییر؛ ارقام فارسی ۴۵٬۰۰۰٬۰۰۰ پذیرفته؛ خانه خالی صفر؛ نیامدن فیلد حقوق را نگه داشت';
    });
  }

  const codeId = 'reg_personnel_code_unique_td_439';
  if (shouldRun(codeId, 'td439', 'personnel', 'code', 'concurrency', 'package12')) {
    await runCase(results, codeId, 'v9.0.28: the personnel code is unique among active personnel (ignoring case and spaces) with a partial unique index; a concurrent create makes one personnel and the health check finds old duplicates (TD-439)', async (ids) => {
      const { send } = await adminClient();
      const tag = tagOf();
      const code = `PC-${tag}`;
      const wrong: string[] = [];
      const activeWithCode = async () => (await orm.select({ id: personnel.id }).from(personnel)
        .where(and(sql`lower(btrim(${personnel.personnelCode})) = ${code.toLowerCase()}::text`, eq(personnel.isDeleted, 0)))).map(r => r.id);

      // ۱) پنج ثبت هم‌زمان با یک کد (با تفاوت حروف و فاصله): فقط یکی ۲۰۱
      const variants = [code, code.toLowerCase(), ` ${code} `, code, `${code.toLowerCase()} `];
      const burst = await Promise.all(variants.map((c, i) => send('post', '/api/personnel', { firstName: 'هم‌زمان', lastName: `${tag} ${i}`, personnelCode: c })));
      const made = await activeWithCode();
      ids.push(...made);
      const statuses = burst.map(r => r.status).sort().join(',');
      if (made.length !== 1 || statuses !== '201,400,400,400,400') wrong.push(`concurrent create made ${made.length} active personnel with one code (statuses ${statuses})`);
      if (burst.some(r => r.status === 400 && !String(r.body?.error ?? '').includes('کد پرسنلی'))) wrong.push(`the duplicate message is not in Persian: ${JSON.stringify(burst.find(r => r.status === 400)?.body).slice(0, 120)}`);

      // ۲) ویرایش پرسنل دیگر به همین کد با حروف کوچک رد می‌شود
      const other = await send('post', '/api/personnel', { firstName: 'دیگر', lastName: tag, personnelCode: `${code}-B` });
      if (other.status === 201) ids.push(Number(other.body.id));
      const put = await send('put', `/api/personnel/${other.body.id}`, { version: await personnelVersion(other.body.id), firstName: 'دیگر', lastName: tag, personnelCode: ` ${code.toLowerCase()}` });
      if (put.status !== 400) wrong.push(`edit to a duplicate code returned ${put.status}`);

      // ۳) ورود اکسل همان کد را با حروف دیگر پرسنل موجود می‌شناسد، نه پرسنل تازه
      const imp = await send('post', '/api/personnel/bulk-import', { rows: [{ personnelCode: ` ${code.toLowerCase()} `, firstName: 'هم‌زمان', phone: '09131234567' }] });
      const afterImport = await activeWithCode();
      ids.push(...afterImport.filter(x => !ids.includes(x)));
      if (imp.status !== 200 || imp.body?.createdCount !== 0 || imp.body?.updatedCount !== 1 || afterImport.length !== 1) {
        wrong.push(`Excel import by code: ${JSON.stringify(imp.body).slice(0, 120)} and ${afterImport.length} active personnel`);
      }

      // ۴) کد پرسنل حذف‌شده دوباره قابل استفاده است
      if (made[0]) {
        await send('delete', `/api/personnel/${made[0]}`);
        const reuse = await send('post', '/api/personnel', { firstName: 'جانشین', lastName: tag, personnelCode: code });
        if (reuse.status === 201) ids.push(Number(reuse.body.id));
        if (reuse.status !== 201) wrong.push(`the code of a deleted personnel returned ${reuse.status}`);
      }

      // ۵) تکرار قدیمی (پایگاه‌داده‌ای که مهاجرت 0054 ایندکس را نساخت) در بازرس سلامت
      try {
        await orm.transaction(async (tx) => {
          await tx.execute(sql`DROP INDEX IF EXISTS uq_personnel_code_active`);
          const [dup] = await tx.insert(personnel).values({ fullName: `کد تکراری قدیمی ${tag}`, personnelCode: code.toLowerCase() }).returning({ id: personnel.id });
          const { findDuplicatePersonnelCodes, buildPersonnelCodeHealthTest } = await import('../../services/personnel/personnelCode.js');
          const dups = await findDuplicatePersonnelCodes(tx);
          const health = buildPersonnelCodeHealthTest(dups, false);
          if (!dups.some(r => r.id === dup.id) || health.status !== 'warning' || health.count < 1) wrong.push(`the health check did not find the duplicate code ${JSON.stringify({ n: dups.length, status: health.status })}`);
          tx.rollback();
        }).catch((err: unknown) => {
          if (!(err instanceof Error && err.message.toLowerCase().includes('rollback'))) throw err;
        });
      } catch (err) {
        wrong.push(`old duplicate code: ${err instanceof Error ? err.message : String(err)}`);
      }

      // ۶) بازرس سلامت روی داده تمیز: قید در پایگاه‌داده هست
      const { FinancialHealthService } = await import('../../services/accounting/financialHealth.service.js');
      const report = await FinancialHealthService.runHealthCheck();
      const check = report.tests.find(t => t.id === 'personnel_code_uniqueness');
      if (!check || check.metrics?.uniqueIndexPresent !== 1) wrong.push(`personnel code health test ${JSON.stringify(check?.metrics ?? null)}`);

      if (wrong.length > 0) throw new Error(wrong.join('; '));
      return 'پنج ثبت هم‌زمان یک پرسنل (چهار ۴۰۰ فارسی)؛ ویرایش به کد تکراری ۴۰۰؛ ورود اکسل کد با حروف دیگر را به‌روزرسانی کرد؛ کد پرسنل حذف‌شده آزاد؛ تکرار قدیمی در بازرس سلامت';
    });
  }

  const deleteId = 'reg_personnel_delete_guard_td_441';
  if (shouldRun(deleteId, 'td441', 'personnel', 'delete', 'package12')) {
    await runCase(results, deleteId, 'v9.0.29: a personnel with an unsettled payslip, a work log without a payslip, a permanent account balance or a draft voucher is not deleted (409 with reasons and the end-of-employment suggestion); a settled personnel is deleted (TD-441)', async (ids) => {
      const { send } = await adminClient();
      const { VoucherService } = await import('../../services/accounting/voucher.service.js');
      const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
      const today = await businessTodayIsoDate();
      const tag = tagOf();
      const wrong: string[] = [];
      const payrollIds: number[] = [];
      const logIds: number[] = [];
      const voucherIds: number[] = [];
      let taskId: number | null = null;
      try {
        const accountOf = async (type: string) => {
          const [a] = await orm.select({ id: accounts.id }).from(accounts).where(eq(accounts.accountType, type)).orderBy(accounts.id).limit(1);
          if (!a) throw new Error(`no account of type ${type}`);
          return a.id;
        };
        const [assetAcc, liabilityAcc, expenseAcc] = [await accountOf('asset'), await accountOf('liability'), await accountOf('expense')];
        const person = async (label: string) => {
          const res = await send('post', '/api/personnel', { firstName: label, lastName: `حذف ${tag}`, personnelCode: `DEL-${tag}-${ids.length}` });
          if (res.status !== 201) throw new Error(`Personnel create returned ${res.status}`);
          ids.push(Number(res.body.id));
          return { id: Number(res.body.id), fullName: String(res.body.fullName) };
        };
        const voucher = async (status: string, rows: Array<{ accountId: number; debit: number; credit: number; personnelId?: number }>) => {
          const total = rows.reduce((t, r) => t + r.debit, 0);
          const [v] = await orm.insert(journalVouchers).values({
            voucherNumber: await VoucherService.getNextVoucherNumber(), date: today, description: `آزمون حذف پرسنل ${tag}`, status,
            totalDebit: money(total), totalCredit: money(total),
          }).returning({ id: journalVouchers.id });
          voucherIds.push(v.id);
          await orm.insert(journalVoucherItems).values(rows.map((r, i) => ({
            voucherId: v.id, accountId: r.accountId, rowOrder: i + 1, debit: money(r.debit), credit: money(r.credit),
            detailedType: r.personnelId ? 'personnel' : 'none', detailedId: r.personnelId ?? null,
          })));
        };
        const isActive = async (pid: number) => (await orm.select({ id: personnel.id }).from(personnel)
          .where(and(eq(personnel.id, pid), eq(personnel.isDeleted, 0)))).length === 1;
        // reasons the server's delete refusal names (compared with its Persian message)
        const WORK_LOG_REASON = 'کارکرد';
        const BALANCE_REASON = 'مانده حساب';
        const DRAFT_VOUCHER_REASON = 'سند حسابداری پیش‌نویس';
        const expectRefused = async (pid: number, label: string, mustMention: string) => {
          const res = await send('delete', `/api/personnel/${pid}`);
          const message = String(res.body?.error ?? res.body?.message ?? '');
          if (res.status !== 409 || !message.includes(mustMention) || !message.includes('قطع همکاری')) wrong.push(`${label}: delete ${res.status} with message "${message.slice(0, 160)}"`);
          if (!(await isActive(pid))) wrong.push(`${label}: personnel was deleted`);
        };

        // ۱) فیش تأییدشده پرداخت‌نشده ۸۷٬۰۰۰٬۰۰۰ ریالی
        const unpaid = await person('فیش‌دار');
        const [pay] = await orm.insert(pieceworkPayrolls).values({
          payrollNumber: `PAY-DEL-${tag}`, personnelId: unpaid.id, startDate: today, endDate: today, title: 'فیش آزمون', netPayable: money(87000000), status: 'approved',
        }).returning({ id: pieceworkPayrolls.id });
        payrollIds.push(pay.id);
        await expectRefused(unpaid.id, 'personnel with an approved unpaid payslip', `PAY-DEL-${tag}`);

        // ۲) کارکرد بی فیش
        const worker = await person('کارکرددار');
        const [task] = await orm.insert(pieceworkTasks).values({ code: `T-DEL-${tag}`, title: `کار آزمون ${tag}` }).returning({ id: pieceworkTasks.id });
        taskId = task.id;
        const [log] = await orm.insert(pieceworkLogs).values({ personnelId: worker.id, taskId: task.id, date: today, quantity: 3, unitRate: money(100000), totalAmount: money(300000) }).returning({ id: pieceworkLogs.id });
        logIds.push(log.id);
        await expectRefused(worker.id, 'personnel with a work log without a payslip', WORK_LOG_REASON);

        // ۳) مانده مساعده در سند تأییدشده (حساب دائم)
        const advance = await person('مساعده‌دار');
        await voucher('approved', [{ accountId: assetAcc, debit: 5000000, credit: 0, personnelId: advance.id }, { accountId: liabilityAcc, debit: 0, credit: 5000000 }]);
        await expectRefused(advance.id, 'personnel with an advance balance', BALANCE_REASON);

        // ۴) سند حسابداری پیش‌نویس
        const drafted = await person('پیش‌نویس‌دار');
        await voucher('draft', [{ accountId: expenseAcc, debit: 2000000, credit: 0, personnelId: drafted.id }, { accountId: liabilityAcc, debit: 0, credit: 2000000, personnelId: drafted.id }]);
        await expectRefused(drafted.id, 'personnel with a draft voucher', DRAFT_VOUCHER_REASON);

        // ۵) تسویه‌شده: فیش پرداخت‌شده، هزینه حقوق (حساب موقت) و بدهی پرداخت‌شده ← حذف آزاد است
        const settled = await person('تسویه‌شده');
        const [paid] = await orm.insert(pieceworkPayrolls).values({
          payrollNumber: `PAY-DEL-${tag}-P`, personnelId: settled.id, startDate: today, endDate: today, title: 'فیش پرداخت‌شده', netPayable: money(4000000), paidAmount: money(4000000), status: 'paid',
        }).returning({ id: pieceworkPayrolls.id });
        payrollIds.push(paid.id);
        await voucher('approved', [{ accountId: expenseAcc, debit: 4000000, credit: 0, personnelId: settled.id }, { accountId: liabilityAcc, debit: 0, credit: 4000000, personnelId: settled.id }]);
        await voucher('approved', [{ accountId: liabilityAcc, debit: 4000000, credit: 0, personnelId: settled.id }, { accountId: assetAcc, debit: 0, credit: 4000000 }]);
        const freed = await send('delete', `/api/personnel/${settled.id}`);
        if (freed.status !== 200 || await isActive(settled.id)) wrong.push(`settled personnel was not deleted (${freed.status}): ${JSON.stringify(freed.body).slice(0, 160)}`);

        if (wrong.length > 0) throw new Error(wrong.join('; '));
        return 'فیش تأییدشده پرداخت‌نشده، کارکرد بی فیش، مانده مساعده و سند پیش‌نویس هر یک ۴۰۹ با دلیل و «قطع همکاری»؛ پرسنل با فیش پرداخت‌شده و فقط مانده هزینه حذف شد';
      } finally {
        if (voucherIds.length > 0) {
          await orm.delete(journalVoucherItems).where(inArray(journalVoucherItems.voucherId, voucherIds)).catch(() => undefined);
          await orm.delete(journalVouchers).where(inArray(journalVouchers.id, voucherIds)).catch(() => undefined);
        }
        if (logIds.length > 0) await orm.delete(pieceworkLogs).where(inArray(pieceworkLogs.id, logIds)).catch(() => undefined);
        if (payrollIds.length > 0) await orm.delete(pieceworkPayrolls).where(inArray(pieceworkPayrolls.id, payrollIds)).catch(() => undefined);
        if (taskId !== null) await orm.delete(pieceworkTasks).where(eq(pieceworkTasks.id, taskId)).catch(() => undefined);
      }
    });
  }

  const occId = 'reg_personnel_edit_occ_td_442';
  if (shouldRun(occId, 'td442', 'personnel', 'occ', 'concurrency', 'package12')) {
    await runCase(results, occId, 'v9.0.30: a personnel edit sends the form\'s version; a stale version or concurrent edit is 409 OCC_CONFLICT and the first change is kept; an edit without a version is 400 (TD-442)', async (ids) => {
      const { send, app, admin } = await adminClient();
      const tag = tagOf();
      const wrong: string[] = [];
      const created = await send('post', '/api/personnel', {
        firstName: 'نرگس', lastName: `نسخه ${tag}`, personnelCode: `OCC-${tag}`, salaryType: 'monthly_fixed', monthlySalary: 40000000, phone: '09121110000',
      });
      if (created.status !== 201) throw new Error(`Personnel create returned ${created.status}`);
      const pid = Number(created.body.id);
      ids.push(pid);
      const detail = async () => (await request(app).get(`/api/personnel/${pid}`).set('Cookie', admin.cookie)).body as Record<string, unknown>;
      const form = (extra: object) => ({ firstName: 'نرگس', lastName: `نسخه ${tag}`, personnelCode: `OCC-${tag}`, salaryType: 'monthly_fixed', ...extra });
      const row = async () => (await orm.select().from(personnel).where(eq(personnel.id, pid)))[0];

      // ۱) بی نسخه ۴۰۰ و بی تغییر
      const noVersion = await send('put', `/api/personnel/${pid}`, form({ monthlySalary: 1 }));
      if (noVersion.status !== 400 || Number((await row()).monthlySalary) !== 40000000) wrong.push(`edit without a version returned ${noVersion.status}`);

      // ۲) دو مدیر فرم را با یک نسخه باز می‌کنند؛ ذخیره دوم تغییر حقوق اولی را پاک نمی‌کند
      const v1 = Number((await detail()).version);
      if (!Number.isInteger(v1) || v1 < 1) wrong.push(`detail has no version: ${v1}`);
      const first = await send('put', `/api/personnel/${pid}`, form({ version: v1, monthlySalary: 52000000, phone: '09121110000' }));
      const second = await send('put', `/api/personnel/${pid}`, form({ version: v1, monthlySalary: 40000000, phone: '09129990000' }));
      const afterTwo = await row();
      if (first.status !== 200) wrong.push(`first save returned ${first.status}`);
      if (second.status !== 409 || second.body?.code !== 'OCC_CONFLICT') wrong.push(`save with a stale version ${second.status} ${JSON.stringify(second.body).slice(0, 120)}`);
      if (Number(afterTwo.monthlySalary) !== 52000000 || afterTwo.phone !== '09121110000') wrong.push(`the first change was lost: salary ${afterTwo.monthlySalary}, phone ${afterTwo.phone}`);
      const v2 = Number((await detail()).version);
      if (v2 !== v1 + 1) wrong.push(`version after save is ${v2}, not ${v1 + 1}`);

      // ۳) دو ذخیره هم‌زمان با یک نسخه: یکی ۲۰۰، دیگری ۴۰۹
      const race = await Promise.all([
        send('put', `/api/personnel/${pid}`, form({ version: v2, monthlySalary: 61000000 })),
        send('put', `/api/personnel/${pid}`, form({ version: v2, monthlySalary: 62000000 })),
      ]);
      const statuses = race.map(r => r.status).sort().join(',');
      if (statuses !== '200,409') wrong.push(`two concurrent saves returned ${statuses}`);

      // ۴) ورود اکسل نسخه را جلو می‌برد، پس فرم بازشده پیش از آن کهنه است
      const v3 = Number((await detail()).version);
      await send('post', '/api/personnel/bulk-import', { rows: [{ personnelCode: `OCC-${tag}`, firstName: 'نرگس', jobTitle: 'مونتاژکار' }] });
      const staleAfterImport = await send('put', `/api/personnel/${pid}`, form({ version: v3, monthlySalary: 1000 }));
      if (staleAfterImport.status !== 409) wrong.push(`stale form after Excel import returned ${staleAfterImport.status}`);

      if (wrong.length > 0) throw new Error(wrong.join('; '));
      return 'بی نسخه ۴۰۰؛ ذخیره با نسخه کهنه ۴۰۹ OCC_CONFLICT و حقوق ذخیره نخست ماند؛ نسخه یکی جلو رفت؛ دو ذخیره هم‌زمان ۲۰۰ و ۴۰۹؛ ورود اکسل فرم پیشین را کهنه کرد';
    });
  }

  const nationalIdTd673 = 'reg_personnel_national_id_ten_digits_td_673';
  if (shouldRun(nationalIdTd673, 'td673', 'personnel', 'national_id', 'package16')) {
    await runCase(results, nationalIdTd673, 'v9.0.248: personnel save refuses a national ID that is not ten digits; only the Excel import pads 8-9 digits and lists the row (TD-673)', async (ids) => {
      const { send } = await adminClient();
      const tag = tagOf();
      const wrong: string[] = [];
      const short = await send('post', '/api/personnel', { firstName: 'کوتاه', lastName: `کد ملی ${tag}`, personnelCode: `NID-${tag}-S`, nationalId: '19' });
      if (short.status !== 422 || short.body?.code !== 'NATIONAL_ID_INVALID') wrong.push(`short ID on save: ${short.status} ${short.body?.code}`);
      if (short.body?.id) ids.push(Number(short.body.id));
      const full = await send('post', '/api/personnel', { firstName: 'کامل', lastName: `کد ملی ${tag}`, personnelCode: `NID-${tag}-F`, nationalId: '۰۰۱۲۳۴۵۶۷۹' });
      if (full.status !== 201) wrong.push(`ten-digit ID on save: ${full.status}`);
      else ids.push(Number(full.body.id));
      const imported = await send('post', '/api/personnel/bulk-import', { rows: [
        { personnelCode: `NID-${tag}-P`, firstName: 'اکسل', lastName: `کد ملی ${tag}`, nationalId: 12345679 },
        { personnelCode: `NID-${tag}-X`, firstName: 'اکسل', lastName: `ناقص ${tag}`, nationalId: '19' },
      ], updateIfExists: false });
      const rows = await orm.select().from(personnel).where(and(sql`${personnel.personnelCode} like ${`NID-${tag}-%`}`, eq(personnel.isDeleted, 0)));
      ids.push(...rows.map(r => r.id).filter(id => !ids.includes(id)));
      const padded = rows.find(r => r.personnelCode === `NID-${tag}-P`);
      if (imported.status !== 200 || imported.body?.createdCount !== 1) wrong.push(`import: ${imported.status} created ${imported.body?.createdCount}`);
      if (padded?.nationalId !== '0012345679') wrong.push(`8-digit Excel ID stored as ${padded?.nationalId}`);
      if (imported.body?.warnings?.length !== 1 || imported.body.warnings[0].row !== 1) wrong.push(`warnings ${JSON.stringify(imported.body?.warnings)}`);
      if (imported.body?.errors?.length !== 1 || imported.body.errors[0].row !== 2) wrong.push(`errors ${JSON.stringify(imported.body?.errors)}`);
      if (rows.some(r => r.personnelCode === `NID-${tag}-X`)) wrong.push('two-digit Excel ID was saved');
      if (wrong.length > 0) throw new Error(wrong.join('; '));
      return 'short ID refused with 422 NATIONAL_ID_INVALID; Excel 8-digit ID padded and listed as a warning, two-digit ID a row error';
    });
  }

  return results;
}
