import { orm, pool } from '../../db/drizzle.js';
import { pieceworkLogs } from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { PieceworkService } from '../../services/piecework.service.js';
import { PieceworkPayrollService } from '../../services/piecework/payroll.service.js';
import { getErrorMessage } from '../../utils/formatters.js';
import { raceBehindRowLock } from './concurrencyHarness.js';
import { newTask, newWorker } from './payrollScenarios.js';

/**
 * v8.0.56 — سناریوهای سخت‌گیرانه هم‌زمانی کارکرد و صدور فیش حوزه J برای سوئیت business_invariants.
 * هر تابع فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
 */

const DATE = '2026-05-10';
const PERIOD = { startDate: '2026-05-01', endDate: '2026-05-31', username: 'inv' };

async function addLog(personnelId: number, taskId: number, amount: number): Promise<number> {
  const [row] = await orm.insert(pieceworkLogs).values({
    personnelId, taskId, date: DATE, dateIso: DATE, quantity: 1, unitRate: money(amount), totalAmount: money(amount), status: 'pending',
  }).returning({ id: pieceworkLogs.id });
  return row.id;
}

/** فیش زنده پرسنل در برابر کارکردهای پیوندشده‌اش: جمع کارمزدی فیش، جمع کارکردهای فعال و شمار کارکردهای حذف‌شده پیوندشده */
async function payrollAgainstLogs(personnelId: number): Promise<{ payrolls: number; total: string; linked: string; deletedLinked: number }> {
  const res = await pool.query<{ payrolls: number; total: string; linked: string; deleted_linked: number }>(
    `SELECT COUNT(*)::int AS payrolls,
            COALESCE(SUM(p.total_piecework_amount), 0)::text AS total,
            COALESCE(SUM((SELECT SUM(l.total_amount) FROM piecework_logs l WHERE l.payroll_id = p.id AND l.is_deleted = 0)), 0)::text AS linked,
            COALESCE(SUM((SELECT COUNT(*) FROM piecework_logs l WHERE l.payroll_id = p.id AND l.is_deleted = 1)), 0)::int AS deleted_linked
       FROM piecework_payrolls p WHERE p.personnel_id = $1 AND p.is_deleted = 0`, [personnelId]);
  const r = res.rows[0];
  return { payrolls: r?.payrolls ?? 0, total: r?.total ?? '0', linked: r?.linked ?? '0', deletedLinked: r?.deleted_linked ?? 0 };
}

type Change = 'edit' | 'delete';

/**
 * دو کارکرد ۱۰۰٬۰۰۰ ریالی؛ صدور فیش و ویرایش یکی به ۵۰۰٬۰۰۰ (یا حذفش) پشت قفل همان کارکرد به ترتیب داده‌شده صف می‌کشند.
 * فیش باید همیشه با کارکردهای پیوندشده‌اش هم‌خوان بماند و تغییر پس از فیش رد شود.
 */
async function raceWorkLogChange(change: Change, payrollFirst: boolean): Promise<string[]> {
  const label = `${change === 'edit' ? 'ویرایش' : 'حذف'} ${payrollFirst ? 'پس از' : 'پیش از'} صدور فیش`;
  const worker = await newWorker('کارگر آزمون هم‌زمانی فیش');
  const task = await newTask();
  const target = await addLog(worker, task, 100000);
  await addLog(worker, task, 100000);
  const issue = async () => {
    const result = await PieceworkPayrollService.generatePayroll({ personnelId: worker, ...PERIOD });
    if ('error' in result && result.error) throw new Error(String(result.error));
    return result;
  };
  const alter = () => (change === 'edit'
    ? PieceworkService.updateWorkLog(target, { quantity: 1, unitRate: 500000 })
    : PieceworkService.deleteWorkLog(target));
  const ops: Array<() => Promise<unknown>> = payrollFirst ? [issue, alter] : [alter, issue];
  const outcomes = await raceBehindRowLock<unknown>('piecework_logs', [target], ops, { staggered: true });
  const [payrollOutcome, changeOutcome] = payrollFirst ? outcomes : [outcomes[1], outcomes[0]];

  const problems: string[] = [];
  if (payrollOutcome.status === 'rejected') problems.push(`${label}: صدور فیش رد شد (${getErrorMessage(payrollOutcome.reason)})`);
  if (payrollFirst && changeOutcome.status === 'fulfilled') problems.push(`${label}: کارکرد درج‌شده در فیش ${change === 'edit' ? 'ویرایش' : 'حذف'} شد`);
  if (payrollFirst && changeOutcome.status === 'rejected' && !getErrorMessage(changeOutcome.reason).includes('در فیش حقوقی درج شده')) {
    problems.push(`${label}: تغییر با پیام «در فیش حقوقی درج شده» رد نشد (${getErrorMessage(changeOutcome.reason)})`);
  }
  if (!payrollFirst && changeOutcome.status === 'rejected') problems.push(`${label}: تغییر کارکرد پیش از فیش رد شد (${getErrorMessage(changeOutcome.reason)})`);

  const state = await payrollAgainstLogs(worker);
  const expected = payrollFirst ? '200000' : change === 'edit' ? '600000' : '100000';
  if (state.payrolls !== 1) problems.push(`${label}: ${state.payrolls} فیش زنده، نه یکی`);
  if (Number(state.total) !== Number(expected)) problems.push(`${label}: جمع کارمزدی فیش ${state.total} است، نه ${expected}`);
  if (Number(state.linked) !== Number(state.total)) problems.push(`${label}: جمع کارکردهای پیوندشده ${state.linked} با فیش ${state.total} نمی‌خواند`);
  if (state.deletedLinked > 0) problems.push(`${label}: ${state.deletedLinked} کارکرد حذف‌شده به فیش زنده پیوند دارد`);
  return problems;
}

/**
 * TD-328: ویرایش یا حذف کارکرد هم‌زمان با صدور فیش، فیش و سند حقوق را با کارکردهای پیوندشده‌اش ناهم‌خوان نمی‌کند. پیش‌تر
 * گارد «در فیش است» روی خواندن بی‌قفل بیرون از تراکنش سنجیده می‌شد: ویرایشی که پشت صدور فیش صف کشیده بود پس از آن
 * کارکرد پیوندشده را ۵۰۰٬۰۰۰ می‌کرد (فیش ۲۰۰٬۰۰۰، کارکردها ۶۰۰٬۰۰۰) و حذف، کارکرد پیوندشده را حذف می‌کرد. کارکردی که
 * فیشش حذف شده آزاد است و ویرایش می‌شود.
 */
export async function checkWorkLogFrozenInPayroll(): Promise<string[]> {
  const problems: string[] = [];
  for (const change of ['edit', 'delete'] as const) {
    for (const payrollFirst of [true, false]) problems.push(...await raceWorkLogChange(change, payrollFirst));
  }

  // کارکرد فیش حذف‌شده آزاد است: ویرایش می‌شود و فیش تازه آن را با مقدار تازه برمی‌دارد
  const worker = await newWorker('کارگر آزمون فیش حذف‌شده');
  const task = await newTask();
  const log = await addLog(worker, task, 100000);
  const first = await PieceworkPayrollService.generatePayroll({ personnelId: worker, ...PERIOD });
  const firstId = 'payroll' in first && first.payroll ? Number((first.payroll as { id: number }).id) : 0;
  await pool.query('UPDATE piecework_payrolls SET is_deleted = 1 WHERE id = $1', [firstId]);
  try {
    await PieceworkService.updateWorkLog(log, { quantity: 1, unitRate: 300000 });
  } catch (err) {
    problems.push(`کارکرد فیش حذف‌شده ویرایش نشد (${getErrorMessage(err)})`);
  }
  await PieceworkPayrollService.generatePayroll({ personnelId: worker, ...PERIOD });
  const state = await payrollAgainstLogs(worker);
  if (state.payrolls !== 1 || Number(state.total) !== 300000 || Number(state.linked) !== 300000) {
    problems.push(`فیش تازه پس از ویرایش کارکرد فیش حذف‌شده ناهم‌خوان است (${JSON.stringify(state)})`);
  }
  return problems;
}
