import { pool } from '../../db/drizzle.js';
import { BankAccountService } from '../../services/accounting/treasury/bankAccount.service.js';
import { ChequeLifecycleService } from '../../services/accounting/treasury/chequeLifecycle.service.js';
import { TreasuryTransactionService } from '../../services/accounting/treasury/treasuryTransaction.service.js';
import { getErrorMessage } from '../../utils/formatters.js';
import { accountIdByCode, outcomeProblems, raceBehindRowLock } from './concurrencyHarness.js';
import { miscContraAccountId } from '../fixtures/treasuryParty.js';

/**
 * v8.0.78 — سناریوهای سخت‌گیرانه نگهداری حساب بانکی حوزه J برای سوئیت business_invariants.
 * هر تابع فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
 */

let seq = 0;
const tag = (prefix: string) => `${prefix}-${Date.now().toString().slice(-7)}-${++seq}`;

async function bankRow(bankId: number): Promise<{ current: number; initial: number; isDeleted: number; code: string }> {
  const res = await pool.query<{ c: string; i: string; is_deleted: number; code: string }>(
    'SELECT current_balance::text AS c, initial_balance::text AS i, is_deleted, code FROM bank_accounts WHERE id = $1', [bankId]);
  const r = res.rows[0];
  return { current: Number(r?.c ?? 0), initial: Number(r?.i ?? 0), isDeleted: Number(r?.is_deleted ?? 0), code: r?.code ?? '' };
}

async function adjustmentVouchers(bankId: number): Promise<number> {
  const res = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM journal_vouchers
      WHERE reference_module = 'treasury_opening' AND reference_id = $1 AND voucher_type = 'adjustment' AND is_deleted = 0`, [bankId]);
  return res.rows[0]?.n ?? 0;
}

async function activeTransactions(bankId: number): Promise<number> {
  const res = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM treasury_transactions WHERE bank_account_id = $1 AND COALESCE(status, '') <> 'voided'`, [bankId]);
  return res.rows[0]?.n ?? 0;
}

async function refusal(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return getErrorMessage(err);
  }
}

/**
 * TD-325: نگهداری حساب بانکی زیر قفل. پیش‌تر دو ویرایش هم‌زمان «مانده اول دوره» ۱۰۰ ← ۱۵۰ موجودی جاری را ۲۰۰ و دو سند
 * اصلاحی می‌ساختند؛ حساب‌های کارت‌خوان هم‌زمان کد POS تکراری می‌گرفتند و کد دستی تکراری پذیرفته می‌شد؛ حساب در میانه ثبت
 * دریافت با تراکنش فعال حذف می‌شد و حسابی که چک داشت هم حذف می‌شد.
 */
export async function checkBankAccountMaintenanceLocked(): Promise<string[]> {
  const problems: string[] = [];
  const ledger = await accountIdByCode('1003');
  const newBank = (initialBalance: number, type: 'bank' | 'pos' = 'bank', code?: string) => BankAccountService.createBankAccount({
    title: `بانک آزمون نگهداری ${tag('M')}`, type, code, accountId: ledger, initialBalance, currency: 'IRR', username: 'inv',
  });

  // ۱) دو ویرایش هم‌زمان مانده اول دوره ۱۰۰ ← ۱۵۰
  const edited = await newBank(100);
  const setInitial = () => BankAccountService.updateBankAccount(edited.id, { title: edited.title, initialBalance: 150, username: 'inv' });
  const edits = await raceBehindRowLock<unknown>('bank_accounts', [edited.id], [setInitial, setInitial]);
  problems.push(...outcomeProblems(['first edit', 'second edit'], edits, () => false));
  const afterEdit = await bankRow(edited.id);
  if (afterEdit.current !== 150 || afterEdit.initial !== 150) problems.push(`after two concurrent edits 100 -> 150, current balance is ${afterEdit.current} and opening balance is ${afterEdit.initial}, not 150`);
  const adjustments = await adjustmentVouchers(edited.id);
  if (adjustments !== 1) problems.push(`${adjustments} opening balance adjustment vouchers were issued, not one`);

  // ۲) کد خودکار هم‌زمان یکتا، و کد دستی تکراری رد
  const created = await Promise.allSettled(Array.from({ length: 5 }, () => newBank(0, 'pos')));
  const codes = created.filter((o): o is PromiseFulfilledResult<Awaited<ReturnType<typeof newBank>>> => o.status === 'fulfilled').map(o => o.value.code);
  if (codes.length !== 5) problems.push(`of five concurrent POS accounts, ${codes.length} were created`);
  if (new Set(codes).size !== codes.length) problems.push(`concurrent accounts got duplicate automatic codes (${codes.join(', ')})`);
  const customCode = tag('CUSTOM');
  await newBank(0, 'bank', customCode);
  const duplicate = await refusal(() => newBank(0, 'bank', customCode.toLowerCase()));
  if (!duplicate?.includes('ثبت شده است')) problems.push(`duplicate manual code was not refused (${duplicate ?? 'accepted'})`);
  const takenByEdit = await refusal(() => BankAccountService.updateBankAccount(edited.id, { code: customCode, username: 'inv' }));
  if (!takenByEdit?.includes('ثبت شده است')) problems.push(`editing the code to another account's code was not refused (${takenByEdit ?? 'accepted'})`);

  // ۳) حذف هم‌زمان با ثبت دریافت: حساب حذف‌شده با تراکنش فعال نمی‌ماند
  const busy = await newBank(0);
  const contraAccountId = await miscContraAccountId();
  const receipt = () => TreasuryTransactionService.createTreasuryTransaction({
    type: 'receipt', method: 'bank_transfer', amount: 1000, bankAccountId: busy.id, partyType: 'other', contraAccountId, partyName: 'واریز آزمون حذف', date: '2026-04-01', username: 'inv',
  });
  const outcomes = await raceBehindRowLock<unknown>('bank_accounts', [busy.id], [receipt, () => BankAccountService.deleteBankAccount(busy.id)], { staggered: true });
  const expectedRefusal = (label: string, message: string) =>
    (label === 'delete account' && message.includes('تراکنش ثبت شده')) || (label === 'record receipt' && message.includes('یافت نشد'));
  problems.push(...outcomeProblems(['record receipt', 'delete account'], outcomes, expectedRefusal));
  const busyRow = await bankRow(busy.id);
  const busyTx = await activeTransactions(busy.id);
  if (busyRow.isDeleted === 1 && busyTx > 0) problems.push(`deleted account has ${busyTx} active transactions`);

  // ۴) حسابی که چک وصول‌شده دارد حذف نمی‌شود
  const chequeBank = await newBank(0);
  const cheque = await ChequeLifecycleService.createCheque({
    type: 'received', chequeNumber: tag('C'), bankName: 'ملت', issueDate: '2026-03-01', dueDate: '2026-04-01',
    amount: 7000, partyName: 'مشتری آزمون حذف حساب', username: 'inv',
  });
  await ChequeLifecycleService.updateChequeStatus(cheque.id, { status: 'passed', bankAccountId: chequeBank.id, actionDate: '2026-04-02', username: 'inv' });
  const withCheque = await refusal(() => BankAccountService.deleteBankAccount(chequeBank.id));
  if (!withCheque?.includes('چک ثبت شده')) problems.push(`deleting an account with a cleared cheque was not refused (${withCheque ?? 'accepted'})`);
  if ((await bankRow(chequeBank.id)).isDeleted !== 0) problems.push('account with a cleared cheque was deleted');
  return problems;
}
