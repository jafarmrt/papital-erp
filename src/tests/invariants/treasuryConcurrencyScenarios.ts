import { pool } from '../../db/drizzle.js';
import { BankAccountService } from '../../services/accounting/treasury/bankAccount.service.js';
import { ChequeLifecycleService } from '../../services/accounting/treasury/chequeLifecycle.service.js';
import { TreasuryTransactionService } from '../../services/accounting/treasury/treasuryTransaction.service.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { getErrorMessage } from '../../utils/formatters.js';
import { accountIdByCode, outcomeProblems, raceBehindRowLock } from './concurrencyHarness.js';
import { miscContraAccountId } from '../fixtures/treasuryParty.js';

/**
 * v8.0.69 — سناریوهای سخت‌گیرانه خزانه و چک حوزه J برای سوئیت business_invariants.
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
  if (!refused.includes('یافت نشد')) problems.push(`clearing a deleted cheque was not refused (${refused || 'accepted'})`);
  let removedAgain = '';
  try {
    await remove(deleted);
  } catch (err) {
    removedAgain = getErrorMessage(err);
  }
  if (!removedAgain.includes('یافت نشد')) problems.push(`deleting a deleted cheque again was not refused (${removedAgain || 'accepted'})`);
  if (await bankBalance(bank.id) !== '0') problems.push(`Bank balance after clearing a deleted cheque is ${await bankBalance(bank.id)}, not zero`);

  // حذف و وصول هم‌زمان: فقط یکی پذیرفته می‌شود و چک یا حذف‌شده و وصول‌نشده است یا وصول‌شده و حذف‌نشده
  for (let run = 0; run < 3; run++) {
    const raced = await receivedCheque(500);
    const before = Number(await bankBalance(bank.id));
    const outcomes = await raceBehindRowLock<unknown>('cheques', [raced], [() => remove(raced), () => clear(raced)]);
    const expectedRefusal = (label: string, message: string) =>
      (label === 'cheque clearing' && message.includes('یافت نشد')) || (label === 'cheque delete' && message.includes('وصول'));
    problems.push(...outcomeProblems(['cheque delete', 'cheque clearing'], outcomes, expectedRefusal));
    const accepted = outcomes.filter(o => o.status === 'fulfilled').length;
    const row = await chequeRow(raced);
    const delta = Number(await bankBalance(bank.id)) - before;
    if (accepted !== 1) problems.push(`Round ${run + 1}: ${accepted} of the concurrent delete and clearing were accepted, not one`);
    if (row.isDeleted === 1 && (row.status === 'passed' || delta !== 0)) problems.push(`Round ${run + 1}: a deleted cheque was cleared (status ${row.status}, balance change ${delta})`);
    if (row.isDeleted === 0 && (row.status !== 'passed' || delta !== 500)) problems.push(`Round ${run + 1}: a cheque that was not deleted was not cleared (status ${row.status}, balance change ${delta})`);
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
    if (from !== '5000' || to !== '0') problems.push(`${label}: source balance ${from} and destination ${to}, not 5000 and zero`);
    const active = (await transferRows(voucherId)).filter(r => r.status !== 'voided');
    if (active.length > 0) problems.push(`${label}: ${active.length} transfer sides were not voided`);
    if (!await voucherNeutralized(voucherId)) problems.push(`${label}: the shared transfer voucher was not neutralized`);
  };

  // ۱) ابطال طرف پرداخت (سند پیش‌نویس) و سپس طرف دریافت
  const a = await newBank(5000);
  const b = await newBank(0);
  const first = await transfer(a.id, b.id);
  await voidSide(first.payId);
  await expectRestored('payment side void', a.id, b.id, first.voucherId);
  let again = '';
  try {
    await voidSide(first.recId);
  } catch (err) {
    again = getErrorMessage(err);
  }
  if (!again.includes('قبلاً ابطال')) problems.push(`voiding the other side of a voided transfer was not refused (${again || 'accepted'})`);

  // ۲) سند تأییدشده، ابطال طرف دریافت
  const second = await transfer(a.id, b.id);
  await VoucherService.setVoucherStatus(second.voucherId, 'approved');
  await voidSide(second.recId);
  await expectRestored('receipt side void (approved voucher)', a.id, b.id, second.voucherId);

  // ۳) ابطال هم‌زمان هر دو طرف: یکی پذیرفته و دیگری «قبلاً ابطال»
  const third = await transfer(a.id, b.id);
  const outcomes = await raceBehindRowLock<unknown>('bank_accounts', [a.id, b.id], [() => voidSide(third.payId), () => voidSide(third.recId)]);
  const alreadyVoided = (_label: string, message: string) => message.includes('قبلاً ابطال');
  problems.push(...outcomeProblems(['payment side void', 'receipt side void'], outcomes, alreadyVoided));
  if (outcomes.filter(o => o.status === 'fulfilled').length !== 1) problems.push('Of the concurrent voids of both transfer sides, not exactly one was accepted');
  await expectRestored('concurrent void of both sides', a.id, b.id, third.voucherId);

  // ۴) انتقالی که پیش از v8.0.73 نیمه‌باطل شده (طرف پرداخت و سند مشترک باطل، بانک مقصد با مبلغ): طرف دریافت باطل‌شدنی است
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
  if (repaired) problems.push(`Voiding the remaining side of a half-voided transfer was refused: ${repaired}`);
  await expectRestored('repair of a half-voided transfer', a.id, b.id, legacy.voucherId);
  return problems;
}

/**
 * TD-340 (تصمیم مالک محصول — گزینه الف «از تراکنش‌ها»): «همگام‌سازی مانده بانک‌ها» مانده جاری را زیر قفل بانک‌ها از مانده
 * اول دوره، تراکنش‌های خزانه و چک‌های وصول‌شده می‌سازد و اختلاف با دفتر کل را فقط گزارش می‌کند. پیش‌تر مانده با دفتر کل
 * (بی اسناد پیش‌نویس) بازنویسی می‌شد: پرداخت پیش‌نویس ۳۰۰ مانده ۷۰۰ را ۱۰۰۰ می‌کرد، سند افتتاحیه پیش‌نویس مانده اول دوره را
 * حذف می‌کرد، و پرداخت هم‌زمان با همگام‌سازی گم می‌شد.
 */
export async function checkBankSyncFromTransactions(): Promise<string[]> {
  const problems: string[] = [];
  const ledgerAccount = await accountIdByCode('1003');
  const newBank = (initialBalance: number) => BankAccountService.createBankAccount({
    title: `بانک آزمون همگام‌سازی ${tag('S')}`, type: 'bank', accountId: ledgerAccount, initialBalance, currency: 'IRR',
  });
  const contraAccountId = await miscContraAccountId();
  const move = (bankAccountId: number, type: 'receipt' | 'payment', amount: number) => TreasuryTransactionService.createTreasuryTransaction({
    type, method: 'bank_transfer', amount, bankAccountId, partyType: 'other', contraAccountId, partyName: 'طرف آزمون همگام‌سازی', username: 'inv',
  });
  const sync = () => BankAccountService.recalculateAndSyncBankBalances();

  // ۱) دریافت ۱۰۰۰ با سند تأییدشده و پرداخت ۳۰۰ با سند پیش‌نویس: مانده ۷۰۰ می‌ماند
  const x = await newBank(0);
  const received = await move(x.id, 'receipt', 1000);
  if (received.voucherId) await VoucherService.setVoucherStatus(received.voucherId, 'approved');
  await move(x.id, 'payment', 300);
  const report = await sync();
  if (await bankBalance(x.id) !== '700') problems.push(`Balance after sync is ${await bankBalance(x.id)}, not 700 (draft payment)`);
  const reported = report.accounts.find(a => a.id === x.id);
  if (Number(reported?.treasuryBalance) !== 700) problems.push(`The sync report showed the treasury balance as ${reported?.treasuryBalance}, not 700`);

  // ۲) پرداخت ۴۰۰ هم‌زمان با همگام‌سازی: پرداخت گم نمی‌شود
  const outcomes = await raceBehindRowLock<unknown>('bank_accounts', [x.id], [() => move(x.id, 'payment', 400), () => sync()]);
  problems.push(...outcomeProblems(['payment 400', 'sync'], outcomes, () => false));
  if (await bankBalance(x.id) !== '300') problems.push(`Balance after a payment concurrent with the sync is ${await bankBalance(x.id)}, not 300`);

  // ۳) مانده اول دوره ۶۰۰۰ با سند افتتاحیه پیش‌نویس و دریافت ۱۰۰۰: مانده ۷۰۰۰ می‌ماند
  const w = await newBank(6000);
  await move(w.id, 'receipt', 1000);
  await sync();
  if (await bankBalance(w.id) !== '7000') problems.push(`Balance of the account with a draft opening voucher after sync is ${await bankBalance(w.id)}, not 7000`);
  return problems;
}

/**
 * TD-1217: «در جریان وصول» با حساب بانکی و «وصول» هم‌زمان همان چک بن‌بست (deadlock) نمی‌سازند. پیش‌تر مسیر غیروصول اول چک
 * را قفل می‌کرد و هنگام نوشتن حساب بانکی قفل کلید خارجی بانک را می‌خواست، در حالی که «وصول» بانک را FOR UPDATE گرفته و
 * منتظر چک بود؛ یکی از دو کار با 40P01 رد می‌شد (آزمون «۱۲ کاربر هم‌زمان» شبیه‌ساز روی CI).
 */
export async function checkChequeStatusBankLockOrder(): Promise<string[]> {
  const problems: string[] = [];
  const bank = await BankAccountService.createBankAccount({
    title: `بانک آزمون ترتیب قفل چک ${tag('L')}`, type: 'bank', accountId: await accountIdByCode('1003'), initialBalance: 0, currency: 'IRR',
  });
  const move = (chequeId: number, status: 'in_collection' | 'passed') => ChequeLifecycleService.updateChequeStatus(chequeId, {
    status, bankAccountId: bank.id, actionDate: '2026-04-02', username: 'inv',
  });
  for (let run = 0; run < 3; run++) {
    const raced = await receivedCheque(700);
    const before = Number(await bankBalance(bank.id));
    const outcomes = await raceBehindRowLock<unknown>('cheques', [raced], [() => move(raced, 'in_collection'), () => move(raced, 'passed')], { staggered: true });
    const transitionRefused = (_label: string, message: string) => message.includes('مجاز نیست');
    problems.push(...outcomeProblems(['send to collection', 'cheque clearing'], outcomes, transitionRefused).map(p => `Round ${run + 1}: ${p}`));
    const row = await chequeRow(raced);
    const delta = Number(await bankBalance(bank.id)) - before;
    if (row.status !== 'passed' || delta !== 700) problems.push(`Round ${run + 1}: the cheque ended as ${row.status} with balance change ${delta}, not cleared with 700`);
  }
  return problems;
}
