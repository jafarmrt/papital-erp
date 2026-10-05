import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { accounts, bankAccounts } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { NO_VOUCHER_TREASURY_PERMISSION } from '../../lib/noVoucherPermission.js';
import { BankAccountService } from '../../services/accounting/treasury/bankAccount.service.js';
import { ChequeLifecycleService } from '../../services/accounting/treasury/chequeLifecycle.service.js';
import { TreasuryTransactionService } from '../../services/accounting/treasury/treasuryTransaction.service.js';
import { FinancialHealthService } from '../../services/accounting/financialHealth.service.js';
import { invalidateUserAuthCache } from '../../middleware/auth.js';
import { createTestRole, createTestUser } from '../fixtures/factories.js';
import { getTestApp, loginTestUserWithSession } from '../fixtures/httpTestHelper.js';
import { getErrorMessage } from '../../utils/formatters.js';
import { checkProformaInvoiceTakesFinalizeDate } from './dateBoundaryScenarios.js';
import { checkPayrollChequeMethodRefused } from './payrollScenarios.js';
import { checkProjectDeleteNeedsReleasedAllocations } from './projectScenarios.js';

/**
 * v8.0.113 — سناریوهای تصمیم‌های مالک محصول بر مشاهده‌های ممیزی (TD-409) برای سوئیت business_invariants. هر تابع
 * فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست. TD-410 تا TD-412 کنار سناریوهای حوزه خودشان‌اند.
 */

let seq = 0;
const tag = (prefix: string) => `${prefix}${Date.now().toString().slice(-7)}${++seq}`;

async function refusalOf(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return getErrorMessage(err);
  }
}

async function bankWithLedger(title: string): Promise<number> {
  const [parent] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '1003'), eq(accounts.isDeleted, 0)));
  const [ledger] = await orm.insert(accounts).values({
    code: `1003${tag('')}`, name: `${title} (سرفصل آزمون)`, level: 'subsidiary', parentId: parent?.id ?? null, accountType: 'asset', nature: 'debit', isSystem: 0, isActive: 1, isDeleted: 0,
  }).returning({ id: accounts.id });
  const bank = await BankAccountService.createBankAccount({ title: `${title} ${tag('B')}`, type: 'bank', accountId: ledger.id, initialBalance: 0, currency: 'IRR' });
  return bank.id;
}

async function balanceOf(bankId: number): Promise<string> {
  const [row] = await orm.select({ b: bankAccounts.currentBalance }).from(bankAccounts).where(eq(bankAccounts.id, bankId));
  return fin(row?.b ?? 0).toString();
}

async function treasuryRows(bankId: number): Promise<number> {
  return Number((await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM treasury_transactions WHERE bank_account_id = $1', [bankId])).rows[0].n);
}

/** کاربر غیرمدیر با نقشی که فقط مجوزهای داده‌شده را دارد، و جلسه HTTP واقعی او */
async function sessionWith(permissions: string[]) {
  const code = `td409_${tag('r')}`;
  await createTestRole({ code, name: code, permissions });
  const user = await createTestUser({ username: `td409_${tag('u')}`, role: code });
  invalidateUserAuthCache(user.id);
  return loginTestUserWithSession(await getTestApp(), user.username);
}

/**
 * TD-409 (تصمیم مالک محصول — گزینه الف): دریافت و پرداخت، انتقال وجه و چک «بدون سند حسابداری» بی‌مجوز جدا رد می‌شوند
 * (نه تراکنش، نه تغییر مانده)؛ کاربر خزانه بی‌آن مجوز از روت ۴۰۳ می‌گیرد و با آن مجوز ثبت می‌شود؛ تراکنش و چک بی‌سند در
 * بررسی سلامت مالی فهرست می‌شوند و تراکنش سنددار نه.
 */
export async function checkNoVoucherTreasuryNeedsPermission(): Promise<string[]> {
  const problems: string[] = [];
  const bankId = await bankWithLedger('بانک آزمون بی‌سند');
  const otherBankId = await bankWithLedger('بانک آزمون بی‌سند مقصد');
  const base = { method: 'bank_transfer' as const, bankAccountId: bankId, partyType: 'other' as const, date: '2026-04-02', username: 'inv' };

  const receipt = await refusalOf(() => TreasuryTransactionService.createTreasuryTransaction({ ...base, type: 'receipt', amount: 800000, partyName: 'مانده آزمون بی‌مجوز', createVoucher: false }));
  if (!receipt?.includes('مجوز')) problems.push(`دریافت بی‌سند بی‌مجوز رد نشد (${receipt ?? 'پذیرفته شد'})`);
  const transfer = await refusalOf(() => TreasuryTransactionService.createTreasuryTransfer({ amount: 1, fromBankAccountId: bankId, toBankAccountId: otherBankId, date: '2026-04-02', username: 'inv', createVoucher: false }));
  if (!transfer?.includes('مجوز')) problems.push(`انتقال بی‌سند بی‌مجوز رد نشد (${transfer ?? 'پذیرفته شد'})`);
  const chequeNumber = tag('NV');
  const cheque = await refusalOf(() => ChequeLifecycleService.createCheque({
    type: 'received', chequeNumber, bankName: 'ملت', issueDate: '2026-04-02', dueDate: '2026-05-02', amount: 300000, partyName: 'مشتری آزمون چک بی‌سند', username: 'inv', createVoucher: false,
  }));
  if (!cheque?.includes('مجوز')) problems.push(`چک بی‌سند بی‌مجوز رد نشد (${cheque ?? 'پذیرفته شد'})`);
  if (await treasuryRows(bankId) !== 0 || !fin(await balanceOf(bankId)).isZero()) problems.push('ثبت بی‌سند ردشده تراکنش یا مانده بانک ساخت');
  if (Number((await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM cheques WHERE cheque_number = $1', [chequeNumber])).rows[0].n) !== 0) problems.push('چک بی‌سند ردشده ثبت شد');

  // روت: کاربر خزانه بی‌مجوز جدا ۴۰۳ می‌گیرد؛ با مجوز جدا دریافت بی‌سند ثبت می‌شود
  const app = await getTestApp();
  const body = { type: 'receipt', method: 'bank_transfer', amount: 800000, bankAccountId: bankId, partyType: 'other', partyName: 'مانده افتتاحیه آزمون', date: '2026-04-02', createVoucher: false };
  const plain = await sessionWith(['accounting.treasury']);
  const denied = await request(app).post('/api/accounting/treasury').set('Cookie', plain.cookie).set('x-csrf-token', plain.csrfToken).send(body);
  if (denied.status !== 403) problems.push(`روت به کاربر خزانه بی‌مجوز جدا ${denied.status} داد، انتظار ۴۰۳`);
  if (await treasuryRows(bankId) !== 0) problems.push('روت برای کاربر بی‌مجوز تراکنش بی‌سند ثبت کرد');
  const allowed = await sessionWith(['accounting.treasury', NO_VOUCHER_TREASURY_PERMISSION]);
  const created = await request(app).post('/api/accounting/treasury').set('Cookie', allowed.cookie).set('x-csrf-token', allowed.csrfToken).send(body);
  if (created.status !== 201) problems.push(`روت به دارنده مجوز جدا ${created.status} داد، انتظار ۲۰۱ (${JSON.stringify(created.body).slice(0, 160)})`);
  if (!fin(await balanceOf(bankId)).equals(800000)) problems.push(`مانده بانک پس از دریافت بی‌سند مجاز ${await balanceOf(bankId)}، انتظار ۸۰۰٬۰۰۰`);

  // بررسی سلامت مالی: تراکنش و چک بی‌سند فهرست می‌شوند، تراکنش سنددار نه
  const withVoucher = await TreasuryTransactionService.createTreasuryTransaction({ ...base, type: 'receipt', amount: 100000, partyType: 'customer', partyName: 'مشتری آزمون سنددار' });
  const freeCheque = await ChequeLifecycleService.createCheque({
    type: 'received', chequeNumber, bankName: 'ملت', issueDate: '2026-04-02', dueDate: '2026-05-02', amount: 300000, partyName: 'مشتری آزمون چک بی‌سند', username: 'inv', createVoucher: false, allowNoVoucher: true,
  });
  const report = await FinancialHealthService.runHealthCheck();
  const test = report.tests.find(t => t.id === 'treasury_without_voucher');
  const listed = new Set((test?.items ?? []).map(i => String(i.id)));
  const createdId = Number(created.body?.id ?? 0);
  if (!test) problems.push('بررسی سلامت مالی آزمون «تراکنش‌های خزانه و چک‌های بدون سند حسابداری» را ندارد');
  if (!listed.has(`treasury-${createdId}`)) problems.push(`دریافت بی‌سند ${createdId} در بررسی سلامت مالی فهرست نشد`);
  if (!listed.has(`cheque-${freeCheque.id}`)) problems.push(`چک بی‌سند ${freeCheque.id} در بررسی سلامت مالی فهرست نشد`);
  if (listed.has(`treasury-${withVoucher.id}`)) problems.push('تراکنش سنددار در فهرست بی‌سندها آمد');
  if (test && test.status !== 'warning') problems.push(`وضعیت آزمون بی‌سندها ${test.status}، انتظار warning`);
  return problems;
}

/** آزمون‌های تصمیم‌های مالک محصول بر مشاهده‌های ممیزی (v8.0.113 به بعد) در جدول سوئیت business_invariants */
export const DECISION_CHECKS: Array<[string, string, (wh: string) => Promise<string[]>, string]> = [
  ['inv_td_409_no_voucher_treasury_permission', 'v8.0.113: خزانه و چک «بدون سند حسابداری» فقط با مجوز جدا ثبت می‌شوند و در بررسی سلامت مالی فهرست می‌شوند (TD-409، گزینه الف)',
    () => checkNoVoucherTreasuryNeedsPermission(), 'دریافت، انتقال و چک بی‌سند بی‌مجوز رد شدند؛ روت ۴۰۳ و با مجوز ۲۰۱؛ بی‌سندها در بررسی سلامت فهرست شدند'],
  ['inv_td_410_proforma_invoice_finalize_date', 'v8.0.113: فاکتورِ حاصل از پیش‌فاکتور تاریخ روز نهایی‌سازی را می‌گیرد (سند، سال شماره، کاردکس و سند حسابداری) و تاریخ و شماره پیش‌فاکتور در یادداشت می‌ماند (TD-410، گزینه الف)',
    checkProformaInvoiceTakesFinalizeDate, 'پیش‌فاکتور ۱۳۹۸/۰۳/۱۲ امروز نهایی شد؛ فاکتور، کاردکس و سند حسابداری تاریخ امروز؛ یادداشت با شماره و تاریخ پیش‌فاکتور'],
  ['inv_td_411_payroll_cheque_method_refused', 'v8.0.113: روش «چک» در پرداخت حقوق رد می‌شود و اثری نمی‌گذارد؛ انتقال بانکی پذیرفته است (TD-411، گزینه الف)',
    () => checkPayrollChequeMethodRefused(), 'پرداخت چکی رد شد بی تراکنش و تغییر مانده؛ پرداخت با انتقال بانکی ثبت شد'],
  ['inv_td_412_project_delete_needs_released_allocations', 'v8.0.113: پروژه با تخصیص مواد باز حذف نمی‌شود؛ پس از آزادسازی حذف می‌شود و گردش ۱۴۰۲ آن صفر است (TD-412، گزینه الف)',
    checkProjectDeleteNeedsReleasedAllocations, 'حذف با تخصیص باز رد شد؛ پس از آزادسازی حذف شد؛ تخصیص به پروژه حذف‌شده رد شد'],
];
