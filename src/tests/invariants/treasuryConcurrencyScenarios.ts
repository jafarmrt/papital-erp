import { pool } from '../../db/drizzle.js';
import { BankAccountService } from '../../services/accounting/treasury/bankAccount.service.js';
import { ChequeLifecycleService } from '../../services/accounting/treasury/chequeLifecycle.service.js';
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
