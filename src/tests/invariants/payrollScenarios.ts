import { and, eq } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { accounts, bankAccounts, personnel, pieceworkLogs, pieceworkPayrolls, pieceworkTasks } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { money } from '../../lib/money.js';
import { PayrollPaymentService } from '../../services/accounting/payrollPayment.service.js';
import { PayrollPaymentVoidService } from '../../services/accounting/payrollPaymentVoid.service.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { BankAccountService } from '../../services/accounting/treasury/bankAccount.service.js';
import { TreasuryTransactionService } from '../../services/accounting/treasury/treasuryTransaction.service.js';
import { PieceworkPayrollService } from '../../services/piecework/payroll.service.js';
import { getErrorMessage } from '../../utils/formatters.js';
import { miscContraAccountId } from '../fixtures/treasuryParty.js';

/**
 * v8.0.28 — سناریوهای حوزه D (حقوق و کارمزدی) برای سوئیت business_invariants: آزمون سخت‌گیرانه رفع‌ها (فهرست مشکلات؛
 * خالی یعنی رفتار درست) و کاوش یافته‌های باز (true یعنی یافته هنوز رخ می‌دهد).
 */

let seq = 0;
const tag = (prefix: string) => `${prefix}${Date.now().toString().slice(-7)}${++seq}`;
const PERIOD = { startDate: '2026-04-01', endDate: '2026-04-30', username: 'inv' };

export async function newWorker(name: string, salary?: { salaryType: string; monthlySalary: number }): Promise<number> {
  const [row] = await orm.insert(personnel).values({
    fullName: `${name} ${tag('W')}`,
    salaryType: salary?.salaryType ?? 'piecework',
    monthlySalary: money(salary?.monthlySalary ?? 0),
  }).returning({ id: personnel.id });
  return row.id;
}

export async function newTask(): Promise<number> {
  const [row] = await orm.insert(pieceworkTasks).values({ code: tag('PT'), title: `کار آزمون حقوق ${tag('')}`, defaultRate: money(1) }).returning({ id: pieceworkTasks.id });
  return row.id;
}

export async function addLog(personnelId: number, taskId: number, date: string, amount: number): Promise<void> {
  await orm.insert(pieceworkLogs).values({
    personnelId, taskId, date, dateIso: date, quantity: 1, unitRate: money(amount), totalAmount: money(amount), status: 'pending',
  });
}

/** گردش حساب برای تفصیلی یک پرسنل (اسناد و ردیف‌های فعال، همه وضعیت‌ها) */
export async function personNet(code: string, personnelId: number): Promise<string> {
  const res = await pool.query<{ n: string }>(
    `SELECT COALESCE(SUM(i.debit - i.credit), 0)::text AS n FROM journal_voucher_items i
       JOIN journal_vouchers v ON v.id = i.voucher_id JOIN accounts a ON a.id = i.account_id
      WHERE v.is_deleted = 0 AND i.is_deleted = 0 AND a.code = $1 AND i.detailed_type = 'personnel' AND i.detailed_id = $2`, [code, personnelId]);
  return fin(res.rows[0]?.n ?? 0).toString();
}

export async function payrollCount(personnelId: number): Promise<number> {
  const res = await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM piecework_payrolls WHERE personnel_id = $1 AND is_deleted = 0', [personnelId]);
  return Number(res.rows[0]?.n ?? 0);
}

/** حساب بانکی با سرفصل اختصاصی زیر ۱۰۰۳ و مانده ۵٬۰۰۰٬۰۰۰ برای پرداخت حقوق */
export async function fundedBank(): Promise<number> {
  const [parent] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '1003'), eq(accounts.isDeleted, 0)));
  const [ledger] = await orm.insert(accounts).values({
    code: `1003${tag('')}`, name: 'بانک آزمون حقوق', level: 'subsidiary', parentId: parent?.id ?? null, accountType: 'asset', nature: 'debit', isSystem: 0, isActive: 1, isDeleted: 0,
  }).returning({ id: accounts.id });
  const bank = await BankAccountService.createBankAccount({ title: `بانک آزمون حقوق ${tag('B')}`, type: 'bank', accountId: ledger.id, initialBalance: 0, currency: 'IRR' });
  await TreasuryTransactionService.createTreasuryTransaction({
    type: 'receipt', method: 'bank_transfer', amount: 5000000, bankAccountId: bank.id, partyType: 'other', contraAccountId: await miscContraAccountId(), partyName: 'واریز آزمون حقوق', date: '2026-04-01', username: 'inv',
  });
  return bank.id;
}

async function generate(personnelId: number, extra: Record<string, unknown> = {}) {
  return PieceworkPayrollService.generatePayroll({ personnelId, ...PERIOD, ...extra });
}

export async function refusalOf(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return getErrorMessage(err);
  }
}

/**
 * TD-281: وضعیت فیش فقط «پیش‌نویس» یا «تأییدشده» دستی تنظیم می‌شود و فیش پرداخت‌دار وضعیت دستی نمی‌گیرد؛ کارکردی که به
 * فیش زنده‌ای پیوند دارد (حتی با وضعیت «pending» باقی‌مانده از نسخه‌های پیشین) در فیش تازه شمرده نمی‌شود؛ کارکرد فیش
 * حذف‌شده آزاد است و فقط یک بار دوباره پیوند می‌خورد.
 */
export async function checkPayrollStatusKeepsLifecycle(): Promise<string[]> {
  const problems: string[] = [];
  const task = await newTask();

  // الف) وضعیت غیرمجاز رد می‌شود؛ پیش‌نویس ← تأییدشده مجاز است
  const w1 = await newWorker('کارگر آزمون وضعیت');
  await addLog(w1, task, '2026-04-05', 1000000);
  const first = await generate(w1);
  if (!first.payroll) return [`صدور فیش آزمون ناموفق بود (${first.error})`];
  const refusal = await refusalOf(() => PieceworkPayrollService.updatePayrollStatus(first.payroll!.id, { status: 'pending', username: 'inv' }));
  if (!refusal?.includes('مجاز نیست')) problems.push(`وضعیت «pending» برای فیش رد نشد (${refusal ?? 'پذیرفته شد'})`);
  const toggle = await refusalOf(async () => {
    await PieceworkPayrollService.updatePayrollStatus(first.payroll!.id, { status: 'draft', username: 'inv' });
    await PieceworkPayrollService.updatePayrollStatus(first.payroll!.id, { status: 'approved', username: 'inv' });
  });
  if (toggle) problems.push(`گذار پیش‌نویس ← تأییدشده رد شد (${toggle})`);

  // ب) کارکرد «pending» پیوندخورده به فیش زنده (داده نسخه‌های پیشین) در فیش تازه شمرده نمی‌شود
  await orm.update(pieceworkLogs).set({ status: 'pending' }).where(eq(pieceworkLogs.payrollId, first.payroll.id));
  const second = await generate(w1);
  if (second.payroll) problems.push(`کارکرد فیش زنده دوباره در فیش ${second.payroll.payrollNumber} شمرده شد (${second.payroll.totalPieceworkAmount})`);
  const owed = await personNet('3201', w1);
  if (!fin(owed).equals(-1000000)) problems.push(`حقوق پرداختنی کارگر ${owed}، انتظار ۱٬۰۰۰٬۰۰۰− (یک بار)`);

  // ج) کارکرد فیش حذف‌شده (پیوند باقی‌مانده از نسخه‌های پیشین) آزاد است و فقط یک بار دوباره پیوند می‌خورد
  const w2 = await newWorker('کارگر آزمون فیش حذف‌شده');
  await addLog(w2, task, '2026-04-06', 600000);
  const orphaned = await generate(w2);
  if (!orphaned.payroll) return [...problems, `صدور فیش آزمون ناموفق بود (${orphaned.error})`];
  await orm.update(pieceworkPayrolls).set({ isDeleted: 1 }).where(eq(pieceworkPayrolls.id, orphaned.payroll.id));
  const reissued = await generate(w2);
  if (!reissued.payroll || !fin(reissued.payroll.totalPieceworkAmount).equals(600000)) {
    problems.push(`کارکرد فیش حذف‌شده در فیش تازه شمرده نشد (${reissued.payroll?.totalPieceworkAmount ?? reissued.error})`);
  } else {
    const third = await generate(w2);
    if (third.payroll) problems.push(`کارکرد دوباره‌پیوندخورده در فیش سوم هم شمرده شد (${third.payroll.totalPieceworkAmount})`);
  }

  // د) فیش پرداخت‌شده وضعیت دستی نمی‌گیرد و حذفش رد می‌شود
  const w3 = await newWorker('کارگر آزمون فیش پرداخت‌شده');
  await addLog(w3, task, '2026-04-07', 800000);
  const paid = await generate(w3);
  if (!paid.payroll) return [...problems, `صدور فیش آزمون ناموفق بود (${paid.error})`];
  await PayrollPaymentService.registerPayrollPayment({ payrollId: paid.payroll.id, bankAccountId: await fundedBank(), paymentDate: '2026-05-01', username: 'inv' });
  const back = await refusalOf(() => PieceworkPayrollService.updatePayrollStatus(paid.payroll!.id, { status: 'approved', username: 'inv' }));
  if (!back?.includes('پرداخت ثبت‌شده')) problems.push(`فیش پرداخت‌شده به «approved» برگشت (${back ?? 'پذیرفته شد'})`);
  const removed = await refusalOf(() => PieceworkPayrollService.deletePayroll(paid.payroll!.id, { username: 'inv' }));
  if (!removed) problems.push('فیش پرداخت‌شده حذف شد');
  const settled = await personNet('3201', w3);
  if (!fin(settled).isZero()) problems.push(`حقوق پرداختنی فیش پرداخت‌شده ${settled}، انتظار ۰`);
  return problems;
}

/**
 * TD-282 (تصمیم مالک محصول — گزینه الف): کسر مساعده بیش از مانده مساعده تسویه‌نشده پرسنل رد می‌شود — نه فیش، نه سند و نه
 * پیوند کارکرد؛ کسر تا سقف مانده (مساعده پرداخت‌شده از خزانه) پذیرفته و حساب مساعده پرسنل صفر می‌شود.
 */
export async function checkAdvanceDeductionWithinBalance(): Promise<string[]> {
  const problems: string[] = [];
  const task = await newTask();
  const worker = await newWorker('کارگر آزمون مساعده');
  await addLog(worker, task, '2026-04-05', 1000000);

  const refused = await generate(worker, { advanceDeduction: 300000 });
  if (refused.status !== 400 || !refused.error?.includes('مانده مساعده')) problems.push(`کسر مساعده بی‌مساعده رد نشد (${refused.status} ${refused.error ?? ''})`);
  if (await payrollCount(worker) !== 0) problems.push('برای کسر مساعده ردشده فیش ساخته شد');
  if (!fin(await personNet('1301', worker)).isZero()) problems.push('کسر مساعده ردشده حساب مساعده را بستانکار کرد');

  // مساعده ۲۰۰٬۰۰۰ از خزانه؛ کسر همان مبلغ پذیرفته می‌شود و حساب مساعده صفر می‌ماند
  const workerName = (await orm.select({ fullName: personnel.fullName }).from(personnel).where(eq(personnel.id, worker)))[0]?.fullName ?? 'کارگر';
  await TreasuryTransactionService.createTreasuryTransaction({
    type: 'payment', method: 'bank_transfer', amount: 200000, bankAccountId: await fundedBank(), partyType: 'personnel', partyId: worker, partyName: workerName,
    purpose: 'advance', date: '2026-04-02', username: 'inv',
  });
  const over = await generate(worker, { advanceDeduction: 200001 });
  if (over.status !== 400) problems.push(`کسر مساعده یک ریال بیش از مانده رد نشد (${over.status})`);
  const accepted = await generate(worker, { advanceDeduction: 200000 });
  if (!accepted.payroll) {
    problems.push(`کسر مساعده تا سقف مانده رد شد (${accepted.error})`);
  } else if (!fin(accepted.payroll.netPayable).equals(800000)) {
    problems.push(`خالص فیش ${accepted.payroll.netPayable}، انتظار ۸۰۰٬۰۰۰`);
  }
  const advance = await personNet('1301', worker);
  if (!fin(advance).isZero()) problems.push(`مانده مساعده پرسنل پس از کسر ${advance}، انتظار ۰`);
  return problems;
}

/**
 * TD-284 (تصمیم مالک محصول — گزینه ب): حقوق ثابت برای هر ماه شمسیِ بازه فیش، ماه ناقص به نسبت روزها — فیش دوماهه دو ماه،
 * دو فیش نیم‌ماهه روی هم دقیقاً یک ماه؛ فیش پیش از v8.0.30 (بی‌تفکیک ماهانه) ماه شروعش را کامل حساب می‌کند.
 */
export async function checkFixedSalaryProratedByMonth(): Promise<string[]> {
  const problems: string[] = [];
  const salary = { salaryType: 'monthly_fixed', monthlySalary: 10000000 };
  const issue = (personnelId: number, startDate: string, endDate: string) => PieceworkPayrollService.generatePayroll({ personnelId, startDate, endDate, username: 'inv' });
  const fixedOf = (r: Awaited<ReturnType<typeof issue>>) => (r.payroll ? fin(r.payroll.totalFixedAmount).toString() : `رد: ${r.error}`);

  // الف) ۱۴۰۵/۰۱/۰۱ تا ۱۴۰۵/۰۲/۳۱ ← دو ماه
  const w1 = await newWorker('کارمند آزمون دوماهه', salary);
  const two = await issue(w1, '2026-03-21', '2026-05-21');
  if (!two.payroll || !fin(two.payroll.totalFixedAmount).equals(20000000)) problems.push(`فیش دوماهه ${fixedOf(two)}، انتظار ۲۰٬۰۰۰٬۰۰۰`);
  else if ((two.payroll.fixedSalaryMonths ?? []).length !== 2) problems.push(`تفکیک ماهانه فیش دوماهه ${JSON.stringify(two.payroll.fixedSalaryMonths)}`);

  // ب) ۱۴۰۵/۰۴/۰۱ تا ۱۵ و ۱۶ تا ۳۱ ← ۴٬۸۳۸٬۷۱۰ + ۵٬۱۶۱٬۲۹۰ = یک ماه
  const w2 = await newWorker('کارمند آزمون نیم‌ماهه', salary);
  const firstHalf = await issue(w2, '2026-06-22', '2026-07-06');
  if (!firstHalf.payroll || !fin(firstHalf.payroll.totalFixedAmount).equals(4838710)) problems.push(`نیمه اول ماه ${fixedOf(firstHalf)}، انتظار ۴٬۸۳۸٬۷۱۰`);
  else if (!String(firstHalf.payroll.notes ?? '').includes('1405/04 — ۱۵ از ۳۱ روز')) problems.push(`یادداشت فیش نیم‌ماهه تفکیک ماهانه ندارد (${firstHalf.payroll.notes})`);
  const secondHalf = await issue(w2, '2026-07-07', '2026-07-22');
  if (!secondHalf.payroll || !fin(secondHalf.payroll.totalFixedAmount).equals(5161290)) problems.push(`نیمه دوم ماه ${fixedOf(secondHalf)}، انتظار ۵٬۱۶۱٬۲۹۰`);
  const owed = await personNet('3201', w2);
  if (!fin(owed).equals(-10000000)) problems.push(`حقوق پرداختنی ماه با دو فیش ${owed}، انتظار ۱۰٬۰۰۰٬۰۰۰−`);

  // ج) فیش پیشین بی‌تفکیک (۱۴۰۵/۰۳) ماه کامل شمرده می‌شود؛ ماه بعد کامل داده می‌شود
  const w3 = await newWorker('کارمند آزمون فیش پیشین', salary);
  await orm.insert(pieceworkPayrolls).values({
    payrollNumber: `LEG-${tag('')}`, personnelId: w3, startDate: '2026-05-22', endDate: '2026-06-21', title: 'فیش پیشین آزمون',
    totalFixedAmount: money(10000000), netPayable: money(10000000), status: 'approved',
  });
  const sameMonth = await issue(w3, '2026-06-07', '2026-06-21');
  if (sameMonth.payroll) problems.push(`ماه فیش پیشین دوباره حقوق گرفت (${fixedOf(sameMonth)})`);
  const nextMonth = await issue(w3, '2026-06-22', '2026-07-22');
  if (!nextMonth.payroll || !fin(nextMonth.payroll.totalFixedAmount).equals(10000000)) problems.push(`ماه پس از فیش پیشین ${fixedOf(nextMonth)}، انتظار ۱۰٬۰۰۰٬۰۰۰`);
  return problems;
}

/**
 * TD-283 (تصمیم مالک محصول — گزینه الف): پرداخت فیش حقوق ابطال‌پذیر است — مانده حساب بانکی، سند پرداخت (معکوس سند
 * تأییدشده)، مبلغ پرداخت‌شده و وضعیت فیش و کارکردها برمی‌گردند؛ ابطال دوباره رد می‌شود و فیشی که همه پرداخت‌هایش باطل
 * شده حذف می‌شود و حقوق پرداختنی پرسنل صفر می‌شود.
 */
export async function checkPayrollPaymentVoidable(): Promise<string[]> {
  const problems: string[] = [];
  const worker = await newWorker('کارگر آزمون ابطال پرداخت');
  await addLog(worker, await newTask(), '2026-04-05', 1000000);
  const issued = await generate(worker);
  if (!issued.payroll) return [`صدور فیش آزمون ناموفق بود (${issued.error})`];
  const payrollId = issued.payroll.id;
  const bankId = await fundedBank();
  const mark = (await pool.query<{ m: string }>('SELECT COALESCE(MAX(id), 0)::text AS m FROM journal_vouchers')).rows[0].m;
  const first = await PayrollPaymentService.registerPayrollPayment({ payrollId, bankAccountId: bankId, amount: 600000, paymentDate: '2026-05-01', username: 'inv' });
  const second = await PayrollPaymentService.registerPayrollPayment({ payrollId, bankAccountId: bankId, amount: 400000, paymentDate: '2026-05-02', username: 'inv' });
  // اسناد پرداخت تأیید می‌شوند تا ابطال سند معکوس بگیرد
  const drafts = await pool.query<{ id: number }>(`SELECT id FROM journal_vouchers WHERE id > $1 AND is_deleted = 0 AND status = 'draft'`, [mark]);
  if (drafts.rows.length > 0) await VoucherService.approveJournalVouchers(drafts.rows.map(r => r.id), undefined, 'inv');

  const state = async () => {
    const [payroll] = await orm.select({ status: pieceworkPayrolls.status, paidAmount: pieceworkPayrolls.paidAmount }).from(pieceworkPayrolls).where(eq(pieceworkPayrolls.id, payrollId));
    const [bank] = await orm.select({ currentBalance: bankAccounts.currentBalance }).from(bankAccounts).where(eq(bankAccounts.id, bankId));
    const logs = await orm.select({ status: pieceworkLogs.status }).from(pieceworkLogs).where(eq(pieceworkLogs.personnelId, worker));
    return { status: payroll?.status, paid: fin(payroll?.paidAmount ?? 0), bank: fin(bank?.currentBalance ?? 0), logs: logs.map(l => l.status), owed: fin(await personNet('3201', worker)) };
  };
  const expectState = async (label: string, expected: { status: string; paid: number; bank: number; owed: number; logs: string }) => {
    const s = await state();
    if (s.status !== expected.status) problems.push(`${label}: وضعیت فیش ${s.status}، انتظار ${expected.status}`);
    if (!s.paid.equals(expected.paid)) problems.push(`${label}: پرداخت‌شده ${s.paid}، انتظار ${expected.paid}`);
    if (!s.bank.equals(expected.bank)) problems.push(`${label}: مانده حساب بانکی ${s.bank}، انتظار ${expected.bank}`);
    if (!s.owed.equals(expected.owed)) problems.push(`${label}: حقوق پرداختنی ${s.owed}، انتظار ${expected.owed}`);
    if (!s.logs.every(l => l === expected.logs)) problems.push(`${label}: وضعیت کارکردها ${s.logs.join('،')}، انتظار ${expected.logs}`);
  };
  await expectState('پس از دو پرداخت', { status: 'paid', paid: 1000000, bank: 4000000, owed: 0, logs: 'paid' });

  await PayrollPaymentVoidService.voidPayrollPayment({ payrollId, transactionId: second.transactionId, reason: 'آزمون ابطال پرداخت دوم', username: 'inv' });
  await expectState('پس از ابطال پرداخت دوم', { status: 'partially_paid', paid: 600000, bank: 4400000, owed: -400000, logs: 'approved' });
  const again = await refusalOf(() => PayrollPaymentVoidService.voidPayrollPayment({ payrollId, transactionId: second.transactionId, reason: 'تکرار', username: 'inv' }));
  if (!again?.includes('قبلاً ابطال')) problems.push(`ابطال دوباره پرداخت رد نشد (${again ?? 'پذیرفته شد'})`);
  const foreign = await refusalOf(() => PayrollPaymentVoidService.voidPayrollPayment({ payrollId: payrollId + 100000, transactionId: first.transactionId, reason: 'فیش دیگر', username: 'inv' }));
  if (!foreign) problems.push('ابطال پرداخت با شناسه فیش دیگر پذیرفته شد');

  await PayrollPaymentVoidService.voidPayrollPayment({ payrollId, transactionId: first.transactionId, reason: 'آزمون ابطال پرداخت اول', username: 'inv' });
  await expectState('پس از ابطال هر دو پرداخت', { status: 'approved', paid: 0, bank: 5000000, owed: -1000000, logs: 'approved' });
  const listed = (await BankAccountService.getBankAccounts()).find(b => b.id === bankId);
  if (!fin(listed?.treasuryBalance ?? -1).equals(5000000)) problems.push(`مانده خزانه حساب بانکی ${listed?.treasuryBalance}، انتظار ۵٬۰۰۰٬۰۰۰`);

  const removed = await refusalOf(() => PieceworkPayrollService.deletePayroll(payrollId, { username: 'inv' }));
  if (removed) problems.push(`فیش بی‌پرداخت حذف نشد (${removed})`);
  const owedAfterDelete = await personNet('3201', worker);
  if (!fin(owedAfterDelete).isZero()) problems.push(`حقوق پرداختنی پس از حذف فیش ${owedAfterDelete}، انتظار ۰`);
  return problems;
}

// ── کاوش یافته‌های باز (true = یافته هنوز رخ می‌دهد) ───────────────────────────

/** TD-281 (کاوش رگرسیون؛ رفع v8.0.28): برگرداندن فیش به «pending» کارکردهایش را در فیش بعدی دوباره می‌شمرد */
export async function probePayrollStatusDoubleCountsLogs(): Promise<boolean> {
  const worker = await newWorker('کارگر کاوش وضعیت');
  await addLog(worker, await newTask(), '2026-04-05', 1000000);
  const first = await generate(worker);
  if (!first.payroll) return false;
  if (await refusalOf(() => PieceworkPayrollService.updatePayrollStatus(first.payroll!.id, { status: 'pending', username: 'inv' }))) return false;
  const second = await generate(worker);
  return Boolean(second.payroll);
}

/**
 * TD-282 (کاوش رگرسیون؛ رفع v8.0.29): کسر مساعده بیش از مانده مساعده پرسنل پذیرفته می‌شد؛ حساب مساعده او بستانکار (منفی) و
 * خالص پرداختنی کم می‌شد.
 */
export async function probeAdvanceDeductionBeyondBalance(): Promise<boolean> {
  const worker = await newWorker('کارگر کاوش مساعده');
  await addLog(worker, await newTask(), '2026-04-05', 1000000);
  const result = await refusalOf(() => generate(worker, { advanceDeduction: 300000 }));
  if (result) return false;
  return fin(await personNet('1301', worker)).isNegative();
}

/**
 * TD-283 (کاوش رگرسیون؛ رفع v8.0.31): پرداخت فیش حقوق ابطال‌پذیر نبود — ابطال تراکنش خزانه آن رد می‌شد، فیش پرداخت‌شده حذف
 * نمی‌شد و مسیر دیگری نبود. اکنون true فقط وقتی است که ابطال از مسیر فیش هم رد شود.
 */
export async function probePayrollPaymentNotVoidable(): Promise<boolean> {
  const worker = await newWorker('کارگر کاوش ابطال پرداخت');
  await addLog(worker, await newTask(), '2026-04-05', 700000);
  const payroll = await generate(worker);
  if (!payroll.payroll) return false;
  const paid = await PayrollPaymentService.registerPayrollPayment({ payrollId: payroll.payroll.id, bankAccountId: await fundedBank(), paymentDate: '2026-05-01', username: 'inv' });
  const refused = await refusalOf(() => PayrollPaymentVoidService.voidPayrollPayment({ payrollId: payroll.payroll!.id, transactionId: paid.transactionId, reason: 'کاوش ابطال پرداخت حقوق', username: 'inv' }));
  return Boolean(refused);
}

/**
 * TD-284 (کاوش رگرسیون؛ رفع v8.0.30): حقوق ثابت هر فیش یک ماه کامل بود — فیش دوماهه یک ماه و فیش نیم‌ماهه یک ماه کامل
 * حقوق می‌گرفت.
 */
export async function probeFixedSalaryOneMonthPerPayroll(): Promise<boolean> {
  const worker = await newWorker('کارمند کاوش حقوق ثابت', { salaryType: 'monthly_fixed', monthlySalary: 10000000 });
  // ۱۴۰۵/۰۱/۰۱ تا ۱۴۰۵/۰۲/۳۱ (دو ماه شمسی)
  const twoMonths = await PieceworkPayrollService.generatePayroll({ personnelId: worker, startDate: '2026-03-21', endDate: '2026-05-21', username: 'inv' });
  return Boolean(twoMonths.payroll) && fin(twoMonths.payroll!.totalFixedAmount).equals(10000000);
}

/**
 * TD-411 (تصمیم مالک محصول — گزینه الف، مثل TD-278): روش «چک» در پرداخت حقوق رد می‌شود — نه تراکنش خزانه، نه سند و نه
 * تغییر مانده بانک یا وضعیت فیش؛ همان پرداخت با انتقال بانکی پذیرفته است.
 */
export async function checkPayrollChequeMethodRefused(): Promise<string[]> {
  const problems: string[] = [];
  const worker = await newWorker('کارگر آزمون پرداخت چکی');
  await addLog(worker, await newTask(), '2026-04-06', 700000);
  const issued = await generate(worker);
  if (!issued.payroll) return [`صدور فیش آزمون ناموفق بود (${issued.error})`];
  const payrollId = issued.payroll.id;
  const bankId = await fundedBank();
  const paymentsOf = async () => Number((await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM treasury_transactions WHERE payroll_id = $1', [payrollId])).rows[0].n);

  const refused = await refusalOf(() => PayrollPaymentService.registerPayrollPayment({ payrollId, bankAccountId: bankId, method: 'cheque', paymentDate: '2026-05-01', username: 'inv' }));
  if (!refused?.includes('چک')) problems.push(`پرداخت حقوق با روش چک رد نشد (${refused ?? 'پذیرفته شد'})`);
  const [bank] = await orm.select({ currentBalance: bankAccounts.currentBalance }).from(bankAccounts).where(eq(bankAccounts.id, bankId));
  if (!fin(bank?.currentBalance ?? 0).equals(5000000)) problems.push(`مانده بانک پس از پرداخت چکی ردشده ${bank?.currentBalance}، انتظار ۵٬۰۰۰٬۰۰۰`);
  if (await paymentsOf() !== 0) problems.push('پرداخت چکی ردشده تراکنش خزانه ساخت');
  const [payroll] = await orm.select({ status: pieceworkPayrolls.status, paidAmount: pieceworkPayrolls.paidAmount }).from(pieceworkPayrolls).where(eq(pieceworkPayrolls.id, payrollId));
  if (!fin(payroll?.paidAmount ?? 0).isZero()) problems.push(`پرداخت‌شده فیش پس از پرداخت چکی ردشده ${payroll?.paidAmount}`);

  const bankTransfer = await refusalOf(() => PayrollPaymentService.registerPayrollPayment({ payrollId, bankAccountId: bankId, method: 'bank_transfer', paymentDate: '2026-05-01', username: 'inv' }));
  if (bankTransfer) problems.push(`پرداخت حقوق با انتقال بانکی رد شد (${bankTransfer})`);
  if (await paymentsOf() !== 1) problems.push('پرداخت با انتقال بانکی تراکنش خزانه نساخت');
  return problems;
}
