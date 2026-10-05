import { pool } from '../../db/drizzle.js';
import { BankAccountService } from '../../services/accounting/treasury/bankAccount.service.js';
import { ChequeLifecycleService } from '../../services/accounting/treasury/chequeLifecycle.service.js';
import { TreasuryTransactionService } from '../../services/accounting/treasury/treasuryTransaction.service.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { getErrorMessage } from '../../utils/formatters.js';
import { accountIdByCode, outcomeProblems, raceBehindRowLock } from './concurrencyHarness.js';

/**
 * v8.0.49 — سناریوهای سخت‌گیرانه خزانه و چک حوزه J برای سوئیت business_invariants.
 * هر تابع فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
 */

let seq = 0;
const tag = (prefix: string) => `${prefix}-${Date.now().toString().slice(-7)}-${++seq}`;

async function bankBalance(bankId: number): Promise<string> {
  const res = await pool.query<{ b: string }>('SELECT current_balance::text AS b FROM bank_accounts WHERE id = $1', [bankId]);
  return String(Number(res.rows[0]?.b ?? 0));
}

async function chequeRow(chequeId: number): Promise<{ status: string; isDeleted: number }> {
  const res = await pool.query<{ status: string; is_deleted: number }>('SELECT status, is_deleted FROM cheques WHERE id = $1', [chequeId]);
  return { status: res.rows[0]?.status ?? '', isDeleted: Number(res.rows[0]?.is_deleted ?? 0) };
}

async function receivedCheque(amount: number): Promise<number> {
  const cheque = await ChequeLifecycleService.createCheque({
    type: 'received', chequeNumber: tag('J'), bankName: 'ملت', issueDate: '2026-03-01', dueDate: '2026-04-01',
    amount, partyName: 'مشتری آزمون همزمانی', username: 'inv',
  });
  return cheque.id;
}

/**
 * TD-322: چک حذف‌شده تغییر وضعیت نمی‌دهد. پیش‌تر قفل چک شرط حذف‌نشدن نداشت و «وصول» چک حذف‌شده پذیرفته می‌شد و مانده
 * بانک را زیاد می‌کرد؛ حذف و وصول هم‌زمان هم هر دو پذیرفته می‌شدند.
 */
export async function checkDeletedChequeFrozen(): Promise<string[]> {
  const problems: string[] = [];
  const bank = await BankAccountService.createBankAccount({
    title: `بانک آزمون چک ${tag('B')}`, type: 'bank', accountId: await accountIdByCode('1003'), initialBalance: 0, currency: 'IRR',
  });
  const clear = (chequeId: number) => ChequeLifecycleService.updateChequeStatus(chequeId, {
    status: 'passed', bankAccountId: bank.id, actionDate: '2026-04-02', username: 'inv',
  });
  const remove = (chequeId: number) => ChequeLifecycleService.deleteCheque(chequeId, { username: 'inv' });

  const deleted = await receivedCheque(1000);
  await remove(deleted);
  let refused = '';
  try {
    await clear(deleted);
  } catch (err) {
    refused = getErrorMessage(err);
  }
  if (!refused.includes('یافت نشد')) problems.push(`وصول چک حذف‌شده رد نشد (${refused || 'پذیرفته شد'})`);
  let removedAgain = '';
  try {
    await remove(deleted);
  } catch (err) {
    removedAgain = getErrorMessage(err);
  }
  if (!removedAgain.includes('یافت نشد')) problems.push(`حذف دوباره چک حذف‌شده رد نشد (${removedAgain || 'پذیرفته شد'})`);
  if (await bankBalance(bank.id) !== '0') problems.push(`مانده بانک پس از وصول چک حذف‌شده ${await bankBalance(bank.id)} است، نه صفر`);

  // حذف و وصول هم‌زمان: فقط یکی پذیرفته می‌شود و چک یا حذف‌شده و وصول‌نشده است یا وصول‌شده و حذف‌نشده
  for (let run = 0; run < 3; run++) {
    const raced = await receivedCheque(500);
    const before = Number(await bankBalance(bank.id));
    const outcomes = await raceBehindRowLock<unknown>('cheques', [raced], [() => remove(raced), () => clear(raced)]);
    problems.push(...outcomeProblems(['حذف چک', 'وصول چک'], outcomes,
      (label, message) => (label === 'وصول چک' && message.includes('یافت نشد')) || (label === 'حذف چک' && message.includes('وصول'))));
    const accepted = outcomes.filter(o => o.status === 'fulfilled').length;
    const row = await chequeRow(raced);
    const delta = Number(await bankBalance(bank.id)) - before;
    if (accepted !== 1) problems.push(`دور ${run + 1}: از حذف و وصول هم‌زمان ${accepted} پذیرفته شد، نه یکی`);
    if (row.isDeleted === 1 && (row.status === 'passed' || delta !== 0)) problems.push(`دور ${run + 1}: چک حذف‌شده وصول شد (وضعیت ${row.status}، تغییر مانده ${delta})`);
    if (row.isDeleted === 0 && (row.status !== 'passed' || delta !== 500)) problems.push(`دور ${run + 1}: چک حذف‌نشده وصول نشد (وضعیت ${row.status}، تغییر مانده ${delta})`);
  }
  return problems;
}

async function transferRows(voucherId: number): Promise<Array<{ id: number; status: string; type: string }>> {
  const res = await pool.query<{ id: number; status: string; type: string }>(
    `SELECT id, status, type FROM treasury_transactions WHERE voucher_id = $1 AND reversal_of_id IS NULL AND is_deleted = 0 ORDER BY id`, [voucherId]);
  return res.rows;
}

/** سند مشترک انتقال بی‌اثر است: حذف‌شده (پیش‌نویس) یا با یک سند برگشت فعال */
async function voucherNeutralized(voucherId: number): Promise<boolean> {
  const res = await pool.query<{ deleted: number; reversals: number }>(
    `SELECT o.is_deleted AS deleted,
            (SELECT COUNT(*)::int FROM journal_vouchers r WHERE r.reference_id = o.id AND r.is_deleted = 0
               AND r.reference_number IN ('REV-V' || o.voucher_number, 'VOID-REPOST-V' || o.voucher_number)) AS reversals
       FROM journal_vouchers o WHERE o.id = $1`, [voucherId]);
  const row = res.rows[0];
  return Boolean(row && (Number(row.deleted) === 1 || Number(row.reversals) === 1));
}

/**
 * TD-341 (تصمیم مالک محصول — گزینه الف «ابطال هر دو»): ابطال هر طرف انتقال بین بانک‌ها هر دو ردیف، هر دو مانده و سند
 * مشترک را با هم برمی‌گرداند. پیش‌تر ابطال طرف پرداخت سند مشترک را باطل و فقط مانده بانک مبدأ را برمی‌گرداند؛ طرف دریافت
 * دیگر باطل‌شدنی نبود و بانک مقصد مبلغ انتقال را بی‌سند نگه می‌داشت.
 */
export async function checkTransferVoidedTogether(): Promise<string[]> {
  const problems: string[] = [];
  const ledgerAccount = await accountIdByCode('1003');
  const newBank = (initialBalance: number) => BankAccountService.createBankAccount({
    title: `بانک آزمون انتقال ${tag('T')}`, type: 'bank', accountId: ledgerAccount, initialBalance, currency: 'IRR',
  });
  const voidSide = (id: number) => TreasuryTransactionService.voidTreasuryTransaction(id, { reason: 'ابطال انتقال آزمون', username: 'inv' });
  const transfer = async (fromId: number, toId: number) => {
    const res = await TreasuryTransactionService.createTreasuryTransfer({ amount: 1000, fromBankAccountId: fromId, toBankAccountId: toId, username: 'inv' });
    return { payId: res.payment.id, recId: res.receipt.id, voucherId: Number(res.voucherId) };
  };
  const expectRestored = async (label: string, fromId: number, toId: number, voucherId: number) => {
    const [from, to] = [await bankBalance(fromId), await bankBalance(toId)];
    if (from !== '5000' || to !== '0') problems.push(`${label}: مانده مبدأ ${from} و مقصد ${to}، نه ۵۰۰۰ و صفر`);
    const active = (await transferRows(voucherId)).filter(r => r.status !== 'voided');
    if (active.length > 0) problems.push(`${label}: ${active.length} طرف انتقال باطل نشد`);
    if (!await voucherNeutralized(voucherId)) problems.push(`${label}: سند مشترک انتقال بی‌اثر نشد`);
  };

  // ۱) ابطال طرف پرداخت (سند پیش‌نویس) و سپس طرف دریافت
  const a = await newBank(5000);
  const b = await newBank(0);
  const first = await transfer(a.id, b.id);
  await voidSide(first.payId);
  await expectRestored('ابطال طرف پرداخت', a.id, b.id, first.voucherId);
  let again = '';
  try {
    await voidSide(first.recId);
  } catch (err) {
    again = getErrorMessage(err);
  }
  if (!again.includes('قبلاً ابطال')) problems.push(`ابطال طرف دیگرِ انتقال باطل‌شده رد نشد (${again || 'پذیرفته شد'})`);

  // ۲) سند تأییدشده، ابطال طرف دریافت
  const second = await transfer(a.id, b.id);
  await VoucherService.setVoucherStatus(second.voucherId, 'approved');
  await voidSide(second.recId);
  await expectRestored('ابطال طرف دریافت (سند تأییدشده)', a.id, b.id, second.voucherId);

  // ۳) ابطال هم‌زمان هر دو طرف: یکی پذیرفته و دیگری «قبلاً ابطال»
  const third = await transfer(a.id, b.id);
  const outcomes = await raceBehindRowLock<unknown>('bank_accounts', [a.id, b.id], [() => voidSide(third.payId), () => voidSide(third.recId)]);
  problems.push(...outcomeProblems(['ابطال طرف پرداخت', 'ابطال طرف دریافت'], outcomes, (_label, message) => message.includes('قبلاً ابطال')));
  if (outcomes.filter(o => o.status === 'fulfilled').length !== 1) problems.push('از ابطال هم‌زمان دو طرف انتقال یکی پذیرفته نشد');
  await expectRestored('ابطال هم‌زمان دو طرف', a.id, b.id, third.voucherId);

  // ۴) انتقالی که پیش از v8.0.53 نیمه‌باطل شده (طرف پرداخت و سند مشترک باطل، بانک مقصد با مبلغ): طرف دریافت باطل‌شدنی است
  const legacy = await transfer(a.id, b.id);
  await pool.query(`UPDATE treasury_transactions SET status = 'voided' WHERE id = $1`, [legacy.payId]);
  await pool.query('UPDATE bank_accounts SET current_balance = current_balance + 1000 WHERE id = $1', [a.id]);
  await pool.query('UPDATE journal_vouchers SET is_deleted = 1 WHERE id = $1', [legacy.voucherId]);
  await pool.query('UPDATE journal_voucher_items SET is_deleted = 1 WHERE voucher_id = $1', [legacy.voucherId]);
  let repaired = '';
  try {
    await voidSide(legacy.recId);
  } catch (err) {
    repaired = getErrorMessage(err);
  }
  if (repaired) problems.push(`ابطال طرف باقی‌مانده انتقال نیمه‌باطل رد شد: ${repaired}`);
  await expectRestored('ترمیم انتقال نیمه‌باطل', a.id, b.id, legacy.voucherId);
  return problems;
}
