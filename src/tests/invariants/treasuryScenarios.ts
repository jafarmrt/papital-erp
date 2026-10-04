import { and, eq } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { accounts } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { BankAccountService } from '../../services/accounting/treasury/bankAccount.service.js';
import { ChequeLifecycleService } from '../../services/accounting/treasury/chequeLifecycle.service.js';
import { TreasuryTransactionService } from '../../services/accounting/treasury/treasuryTransaction.service.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { getErrorMessage } from '../../utils/formatters.js';

/**
 * v8.0.19 — سناریوهای حوزه C (خزانه و چک صیادی) برای سوئیت business_invariants: آزمون‌های سخت‌گیرانه رفع‌ها
 * (فهرست مشکلات؛ خالی یعنی رفتار درست) و کاوش‌های یافته‌های باز (true یعنی یافته هنوز رخ می‌دهد).
 */

let seq = 0;
const tag = (prefix: string) => `${prefix}-${Date.now().toString().slice(-7)}-${++seq}`;
const CHEQUE_BASE = { bankName: 'ملت', issueDate: '2026-03-01', dueDate: '2026-04-01', username: 'inv' };

async function accountIdByCode(code: string): Promise<number> {
  const [row] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, code), eq(accounts.isDeleted, 0)));
  if (!row) throw new Error(`حساب ${code} در کدینگ آزمون نیست`);
  return row.id;
}

async function voucherWatermark(): Promise<number> {
  const res = await pool.query<{ m: string }>('SELECT COALESCE(MAX(id), 0)::text AS m FROM journal_vouchers');
  return Number(res.rows[0].m);
}

/** گردش ریالی حساب (قاعده تراز آزمایشی) در اسناد فعال پس از شناسه داده‌شده، همه وضعیت‌ها */
async function irrNet(code: string, afterVoucherId: number): Promise<string> {
  const res = await pool.query<{ n: string }>(
    `SELECT COALESCE(SUM(CASE WHEN UPPER(COALESCE(NULLIF(i.currency, ''), NULLIF(v.currency, ''), 'IRR')) = 'IRR' THEN i.debit - i.credit
                              ELSE ROUND(i.debit * COALESCE(NULLIF(i.exchange_rate, 0), 1), 0)
                                 - ROUND(i.credit * COALESCE(NULLIF(i.exchange_rate, 0), 1), 0) END), 0)::text AS n
       FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id JOIN accounts a ON a.id = i.account_id
      WHERE v.is_deleted = 0 AND i.is_deleted = 0 AND a.code = $1 AND v.id > $2`, [code, afterVoucherId]);
  return fin(res.rows[0]?.n ?? 0).toString();
}

async function activeVoucherCount(chequeId: number): Promise<number> {
  const res = await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM journal_vouchers WHERE source_cheque_id = $1 AND is_deleted = 0', [chequeId]);
  return Number(res.rows[0]?.n ?? 0);
}

async function bankWithLedgerAccount(title: string, glCode = '1003', currency = 'IRR') {
  return BankAccountService.createBankAccount({ title: `${title} ${tag('B')}`, type: 'bank', accountId: await accountIdByCode(glCode), initialBalance: 0, currency });
}

/**
 * TD-271: حذف یک چک فقط اسناد همان چک را باطل می‌کند، نه اسناد چک دیگری با همان شماره (شماره چک یکتا نیست)؛ هر سند
 * چرخه عمر چک به آن پیوند صریح دارد. اگر سند قدیمی بی‌پیوندِ شماره‌ای که چک دیگری هم دارد مانده باشد، حذف رد می‌شود.
 */
export async function checkChequeDeleteKeepsOtherCheques(): Promise<string[]> {
  const problems: string[] = [];
  const mark = await voucherWatermark();
  const number = tag('CHQ');
  const first = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'received', chequeNumber: number, amount: 1000000, partyName: 'مشتری آزمون چک الف' });
  const second = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'received', chequeNumber: number, amount: 2000000, partyName: 'مشتری آزمون چک ب', bankName: 'صادرات' });
  await ChequeLifecycleService.updateChequeStatus(second.id, { status: 'in_collection', actionDate: '2026-03-10', username: 'inv' });
  if (await activeVoucherCount(second.id) !== 2) problems.push(`چک دوم باید دو سند پیوندشده داشته باشد (ثبت و در جریان وصول): ${await activeVoucherCount(second.id)}`);

  await ChequeLifecycleService.deleteCheque(first.id, { username: 'inv' });
  if (await activeVoucherCount(first.id) !== 0) problems.push('حذف چک اول سند خودش را باطل نکرد');
  if (await activeVoucherCount(second.id) !== 2) problems.push(`حذف چک اول اسناد چک دوم با همان شماره را باطل کرد (اسناد فعال چک دوم: ${await activeVoucherCount(second.id)})`);
  // فقط چک دوم مانده: ۲٬۰۰۰٬۰۰۰ در جریان وصول، اسناد نزد صندوق صفر، بستانکار مشتری ۲٬۰۰۰٬۰۰۰
  const nets = { '1101': await irrNet('1101', mark), '1102': await irrNet('1102', mark), '1201': await irrNet('1201', mark) };
  if (!fin(nets['1101']).isZero() || !fin(nets['1102']).equals(2000000) || !fin(nets['1201']).equals(-2000000)) {
    problems.push(`دفتر کل پس از حذف چک اول: ${JSON.stringify(nets)}، انتظار ۱۱۰۱=۰، ۱۱۰۲=۲٬۰۰۰٬۰۰۰، ۱۲۰۱=−۲٬۰۰۰٬۰۰۰`);
  }

  // سند قدیمی بی‌پیوند (ثبت پیش از v8.0.19) برای شماره‌ای که چک دیگری هم دارد: حذف رد می‌شود و چیزی باطل نمی‌شود
  const legacyNumber = tag('CHQ');
  const keep = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'received', chequeNumber: legacyNumber, amount: 300000, partyName: 'مشتری آزمون چک ج' });
  await ChequeLifecycleService.updateChequeStatus(keep.id, { status: 'in_collection', actionDate: '2026-03-10', username: 'inv' });
  await pool.query(`UPDATE journal_vouchers SET source_cheque_id = NULL WHERE source_cheque_id = $1 AND id <> $2`, [keep.id, keep.voucherId]);
  const other = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'received', chequeNumber: legacyNumber, amount: 400000, partyName: 'مشتری آزمون چک د' });
  let refusal: string | null = null;
  try {
    await ChequeLifecycleService.deleteCheque(other.id, { username: 'inv' });
  } catch (err) {
    refusal = getErrorMessage(err);
  }
  if (!refusal?.includes('پیوند ندارد')) problems.push(`حذف چک با سند قدیمی بی‌پیوندِ شماره مشترک رد نشد (${refusal ?? 'پذیرفته شد'})`);
  const legacyActive = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM journal_vouchers WHERE reference_module = 'cheque' AND reference_number = $1 AND is_deleted = 0`, [legacyNumber]);
  if (Number(legacyActive.rows[0]?.n ?? 0) !== 3) problems.push(`اسناد شماره مشترک پس از حذف ردشده باید ۳ سند فعال باشند: ${legacyActive.rows[0]?.n}`);
  return problems;
}

// ── کاوش یافته‌های باز (true = یافته هنوز رخ می‌دهد) ───────────────────────────

/** TD-272: برگشت چک پرداختی سند ندارد؛ اسناد پرداختنی (۳۱۰۱) می‌ماند و بدهی تأمین‌کننده برنمی‌گردد */
export async function probePaidChequeBounceWithoutVoucher(): Promise<boolean> {
  const mark = await voucherWatermark();
  const bank = await bankWithLedgerAccount('بانک کاوش چک پرداختی');
  const cheque = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'paid', chequeNumber: tag('P'), amount: 500000, partyName: 'تامین‌کننده کاوش', bankAccountId: bank.id });
  await ChequeLifecycleService.updateChequeStatus(cheque.id, { status: 'bounced', actionDate: '2026-04-02', username: 'inv' });
  return !fin(await irrNet('3101', mark)).isZero();
}

/** TD-273: عودت چک برگشتی به صادرکننده سند ندارد؛ مطالبه در اسناد واخواستی (۱۱۰۳) می‌ماند و به حساب مشتری برنمی‌گردد */
export async function probeReturnedChequeStaysInProtest(): Promise<boolean> {
  const mark = await voucherWatermark();
  const cheque = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'received', chequeNumber: tag('R'), amount: 300000, partyName: 'مشتری کاوش برگشتی' });
  await ChequeLifecycleService.updateChequeStatus(cheque.id, { status: 'bounced', actionDate: '2026-04-02', username: 'inv' });
  await ChequeLifecycleService.updateChequeStatus(cheque.id, { status: 'returned', actionDate: '2026-04-03', username: 'inv' });
  return !fin(await irrNet('1103', mark)).isZero();
}

/** TD-274: دریافت/پرداخت ارزی خزانه با نرخ ۱ در سند حسابداری ثبت می‌شود (۱۰۰ دلار = ۱۰۰ ریال) */
export async function probeForeignTreasuryAtRateOne(): Promise<boolean> {
  const mark = await voucherWatermark();
  const usdCash = await BankAccountService.createBankAccount({ title: `صندوق دلاری کاوش ${tag('U')}`, type: 'cash', accountId: await accountIdByCode('1002'), initialBalance: 0, currency: 'USD' });
  await TreasuryTransactionService.createTreasuryTransaction({
    type: 'receipt', method: 'cash', amount: 100, currency: 'USD', exchangeRate: 600000, bankAccountId: usdCash.id,
    partyType: 'customer', partyName: 'مشتری دلاری کاوش', date: '2026-04-02', username: 'inv',
  });
  return !fin(await irrNet('1002', mark)).equals(60000000);
}

/** TD-275: چک ارزی نرخ تسعیر ندارد و اسناد آن با نرخ ۱ ثبت می‌شوند (۵۰ دلار = ۵۰ ریال) */
export async function probeForeignChequeAtRateOne(): Promise<boolean> {
  const mark = await voucherWatermark();
  await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'received', chequeNumber: tag('U'), amount: 50, currency: 'USD', partyName: 'مشتری دلاری کاوش' });
  return fin(await irrNet('1101', mark)).equals(50);
}

/** TD-276: پس از وصول چک، حساب بانکی در تطبیق خزانه با دفتر «مغایر» نشان داده می‌شود (مانده خزانه وصول چک را نمی‌شمارد) */
export async function probeClearedChequeMakesBankDiscrepant(): Promise<boolean> {
  const mark = await voucherWatermark();
  const bank = await bankWithLedgerAccount('بانک کاوش وصول');
  const cheque = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'received', chequeNumber: tag('C'), amount: 700000, partyName: 'مشتری کاوش وصول' });
  await ChequeLifecycleService.updateChequeStatus(cheque.id, { status: 'passed', bankAccountId: bank.id, actionDate: '2026-04-02', username: 'inv' });
  const drafts = await pool.query<{ id: number }>(`SELECT id FROM journal_vouchers WHERE id > $1 AND is_deleted = 0 AND status = 'draft'`, [mark]);
  if (drafts.rows.length > 0) await VoucherService.approveJournalVouchers(drafts.rows.map(r => r.id), undefined, 'inv');
  const row = (await BankAccountService.getBankAccounts()).find(b => b.id === bank.id);
  return row?.syncStatus === 'discrepant';
}

/** TD-277: وصول چک به حساب بانکی بدون سرفصل معین پذیرفته می‌شود ولی سندی ندارد؛ اسناد دریافتنی (۱۱۰۱) هرگز بسته نمی‌شود */
export async function probeChequeClearedIntoBankWithoutLedger(): Promise<boolean> {
  const mark = await voucherWatermark();
  const bank = await BankAccountService.createBankAccount({ title: `بانک بی‌سرفصل کاوش ${tag('N')}`, type: 'bank', initialBalance: 0, currency: 'IRR' });
  const cheque = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'received', chequeNumber: tag('N'), amount: 400000, partyName: 'مشتری کاوش بی‌سرفصل' });
  try {
    await ChequeLifecycleService.updateChequeStatus(cheque.id, { status: 'passed', bankAccountId: bank.id, actionDate: '2026-04-02', username: 'inv' });
  } catch {
    return false;
  }
  return !fin(await irrNet('1101', mark)).isZero();
}

/** TD-278: دریافت «چک» در فرم خزانه اسناد دریافتنی (۱۱۰۱) را بدهکار می‌کند ولی رکورد چکی نمی‌سازد که روزی وصول شود */
export async function probeTreasuryChequeMethodWithoutCheque(): Promise<boolean> {
  const bank = await bankWithLedgerAccount('بانک کاوش روش چک');
  const before = await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM cheques');
  await TreasuryTransactionService.createTreasuryTransaction({
    type: 'receipt', method: 'cheque', amount: 900000, bankAccountId: bank.id, partyType: 'customer', partyName: 'مشتری کاوش روش چک', date: '2026-04-02', username: 'inv',
  });
  const after = await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM cheques');
  return Number(after.rows[0].n) === Number(before.rows[0].n);
}

/** TD-279: چک خرج‌شده (واگذارشده به تأمین‌کننده) اگر برگشت بخورد قابل ثبت نیست (خرج وضعیت پایانی است) */
export async function probeSpentChequeCannotBounce(): Promise<boolean> {
  const cheque = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'received', chequeNumber: tag('S'), amount: 600000, partyName: 'مشتری کاوش خرج' });
  await ChequeLifecycleService.updateChequeStatus(cheque.id, { status: 'spent', transfereePartyName: 'تامین‌کننده کاوش خرج', actionDate: '2026-04-02', username: 'inv' });
  try {
    await ChequeLifecycleService.updateChequeStatus(cheque.id, { status: 'bounced', actionDate: '2026-04-05', username: 'inv' });
    return false;
  } catch {
    return true;
  }
}
