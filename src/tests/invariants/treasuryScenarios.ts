import { and, eq } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { accounts, bankAccounts, cheques, treasuryTransactions } from '../../db/schema.js';
import { fin, type FinancialDecimal } from '../../lib/financialDecimal.js';
import { money } from '../../lib/money.js';
import { AccountingReportService } from '../../services/accounting/accountingReport.service.js';
import { BankAccountService } from '../../services/accounting/treasury/bankAccount.service.js';
import { ChequeLifecycleService } from '../../services/accounting/treasury/chequeLifecycle.service.js';
import { TreasuryTransactionService } from '../../services/accounting/treasury/treasuryTransaction.service.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { DocumentService } from '../../services/document.service.js';
import { createTestItem } from '../fixtures/factories.js';
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
  if (!row) throw new Error(`account ${code} is not in the test chart of accounts`);
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

/** حساب بانکی با سرفصل معین اختصاصی زیر ۱۰۰۳ (مانده دفتری فقط از همین حساب؛ حساب‌های بانکی آزمون دیگر در ۱۰۰۳ اثری ندارند) */
async function bankWithOwnLedgerAccount(title: string) {
  const [parent] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '1003'), eq(accounts.isDeleted, 0)));
  const [ledger] = await orm.insert(accounts).values({
    code: `1003${tag('').replace(/\D/g, '')}`, name: `${title} (سرفصل آزمون)`, level: 'subsidiary', parentId: parent?.id ?? null,
    accountType: 'asset', nature: 'debit', isSystem: 0, isActive: 1, isDeleted: 0,
  }).returning({ id: accounts.id });
  return BankAccountService.createBankAccount({ title: `${title} ${tag('B')}`, type: 'bank', accountId: ledger.id, initialBalance: 0, currency: 'IRR' });
}

async function approveDraftsAfter(mark: number): Promise<void> {
  const drafts = await pool.query<{ id: number }>(`SELECT id FROM journal_vouchers WHERE id > $1 AND is_deleted = 0 AND status = 'draft'`, [mark]);
  if (drafts.rows.length > 0) await VoucherService.approveJournalVouchers(drafts.rows.map(r => r.id), undefined, 'inv');
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
  if (await activeVoucherCount(second.id) !== 2) problems.push(`the second cheque must have two linked vouchers (registration and in collection): ${await activeVoucherCount(second.id)}`);

  await ChequeLifecycleService.deleteCheque(first.id, { username: 'inv' });
  if (await activeVoucherCount(first.id) !== 0) problems.push('Deleting the first cheque did not void its own voucher');
  if (await activeVoucherCount(second.id) !== 2) problems.push(`deleting the first cheque voided the vouchers of the second cheque with the same number (active vouchers of the second cheque: ${await activeVoucherCount(second.id)})`);
  // فقط چک دوم مانده: ۲٬۰۰۰٬۰۰۰ در جریان وصول، اسناد نزد صندوق صفر، بستانکار مشتری ۲٬۰۰۰٬۰۰۰
  const nets = { '1101': await irrNet('1101', mark), '1102': await irrNet('1102', mark), '1201': await irrNet('1201', mark) };
  if (!fin(nets['1101']).isZero() || !fin(nets['1102']).equals(2000000) || !fin(nets['1201']).equals(-2000000)) {
    problems.push(`general ledger after deleting the first cheque: ${JSON.stringify(nets)}, expected 1101=0, 1102=2,000,000, 1201=-2,000,000`);
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
  if (!refusal?.includes('پیوند ندارد')) problems.push(`deleting a cheque with an unlinked legacy voucher of a shared number was not refused (${refusal ?? 'accepted'})`);
  const legacyActive = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM journal_vouchers WHERE reference_module = 'cheque' AND reference_number = $1 AND is_deleted = 0`, [legacyNumber]);
  if (Number(legacyActive.rows[0]?.n ?? 0) !== 3) problems.push(`the vouchers of the shared number must still be 3 active vouchers after the refused delete: ${legacyActive.rows[0]?.n}`);
  return problems;
}

/**
 * TD-274: دریافت، پرداخت و انتقال ارزی خزانه با نرخ تسعیر در سند ثبت می‌شوند — نرخ صریح، یا نرخ فاکتوری که تسویه می‌شود؛
 * تراکنش ارزی بدون نرخ رد می‌شود (هرگز نرخ ۱).
 */
export async function checkForeignTreasuryUsesRate(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const mark = await voucherWatermark();
  const usdCash = await BankAccountService.createBankAccount({ title: `صندوق دلاری ${tag('U')}`, type: 'cash', accountId: await accountIdByCode('1002'), initialBalance: 0, currency: 'USD' });
  const usdBank = await BankAccountService.createBankAccount({ title: `بانک دلاری ${tag('U')}`, type: 'bank', accountId: await accountIdByCode('1004'), initialBalance: 0, currency: 'USD' });
  const receipt = (fields: Record<string, unknown>) => TreasuryTransactionService.createTreasuryTransaction({
    type: 'receipt', method: 'cash', amount: 100, currency: 'USD', bankAccountId: usdCash.id, partyType: 'customer', partyName: 'مشتری دلاری آزمون', date: '2026-04-02', username: 'inv', ...fields,
  });

  // الف) دریافت ۱۰۰ دلار با نرخ صریح ۶۰۰٬۰۰۰ ← ۶۰٬۰۰۰٬۰۰۰ ریال
  await receipt({ exchangeRate: 600000 });

  // ب) تسویه فاکتور دلاری (نرخ فاکتور ۶۵۰٬۰۰۰) بی نرخ صریح ← همان نرخ فاکتور؛ حساب مشتری به ریال بسته می‌شود
  const buyer = `مشتری تسویه دلاری ${tag('I')}`;
  const product = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  await DocumentService.createDocument({ docType: 'receipt', inOut: 'in', status: 'final', date: '2026-04-01', user: 'inv', items: [{ itemId: product.id, quantity: 1, unitPrice: 100000, location: wh }] });
  const invoice = await DocumentService.createDocument({
    docType: 'invoice', inOut: 'out', status: 'final', date: '2026-04-02', user: 'inv', buyerName: buyer, currency: 'USD', exchangeRate: 650000,
    items: [{ itemId: product.id, quantity: 1, unitPrice: 2, location: wh }],
  });
  await receipt({ amount: 2, documentId: invoice, partyName: buyer });
  const buyerNet = await pool.query<{ n: string }>(
    `SELECT COALESCE(SUM(ROUND(i.debit * COALESCE(NULLIF(i.exchange_rate, 0), 1), 0) - ROUND(i.credit * COALESCE(NULLIF(i.exchange_rate, 0), 1), 0)), 0)::text AS n
       FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id JOIN accounts a ON a.id = i.account_id
      WHERE v.is_deleted = 0 AND i.is_deleted = 0 AND a.code = '1201' AND i.detailed_name = $1 AND v.id > $2`, [buyer, mark]);
  if (!fin(buyerNet.rows[0]?.n ?? 0).isZero()) problems.push(`settling a dollar invoice without an explicit rate did not close the customer account in rials: balance ${buyerNet.rows[0]?.n}`);

  // ج) تراکنش یورویی بدون نرخ (نه صریح، نه فاکتور، نه تنظیمات) رد می‌شود
  const eurCash = await BankAccountService.createBankAccount({ title: `صندوق یورویی ${tag('E')}`, type: 'cash', accountId: await accountIdByCode('1002'), initialBalance: 0, currency: 'EUR' });
  let refusal: string | null = null;
  try {
    await receipt({ currency: 'EUR', bankAccountId: eurCash.id });
  } catch (err) {
    refusal = getErrorMessage(err);
  }
  if (!refusal?.includes('نرخ تسعیر')) problems.push(`foreign-currency transaction without an exchange rate was not refused (${refusal ?? 'accepted'})`);

  // د) انتقال ۵۰ دلار از صندوق به بانک دلاری با نرخ ۶۰۰٬۰۰۰
  await TreasuryTransactionService.createTreasuryTransfer({
    amount: 50, currency: 'USD', exchangeRate: 600000, fromBankAccountId: usdCash.id, toBankAccountId: usdBank.id, date: '2026-04-03', username: 'inv',
  });

  // صندوق دلاری: ۶۰٬۰۰۰٬۰۰۰ + ۱٬۳۰۰٬۰۰۰ − ۳۰٬۰۰۰٬۰۰۰؛ بانک دلاری: ۳۰٬۰۰۰٬۰۰۰
  const expected: Record<string, number> = { '1002': 31300000, '1004': 30000000 };
  for (const [code, amount] of Object.entries(expected)) {
    const actual = await irrNet(code, mark);
    if (!fin(actual).equals(amount)) problems.push(`rial movement of ${code}: ${actual}, expected ${amount}`);
  }
  return problems;
}

/**
 * TD-272: برگشت چک پرداختی سند می‌گیرد — بدهکار اسناد پرداختنی، بستانکار تأمین‌کننده؛ پس از برگشت، اسناد پرداختنی بسته
 * و بدهی تأمین‌کننده دوباره باز است. عودت و حذف چک برگشتی دفتر را درست نگه می‌دارند.
 */
export async function checkPaidChequeBounceRestoresSupplier(): Promise<string[]> {
  const problems: string[] = [];
  const bank = await bankWithLedgerAccount('بانک آزمون چک پرداختی');
  const expect = async (label: string, mark: number, expected: Record<string, number>) => {
    for (const [code, amount] of Object.entries(expected)) {
      const actual = await irrNet(code, mark);
      if (!fin(actual).equals(amount)) problems.push(`${label}: movement of ${code} ${actual}, expected ${amount}`);
    }
  };

  // صدور چک ۵۰۰٬۰۰۰ (بدهکار تأمین‌کننده، بستانکار ۳۱۰۱) و برگشت آن ← هر دو حساب صفر
  let mark = await voucherWatermark();
  const bounced = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'paid', chequeNumber: tag('P'), amount: 500000, partyName: 'تامین‌کننده آزمون برگشت', bankAccountId: bank.id });
  await expect('after issuing a paid cheque', mark, { '3101': -500000, '3001': 500000 });
  await ChequeLifecycleService.updateChequeStatus(bounced.id, { status: 'bounced', actionDate: '2026-04-02', username: 'inv' });
  await expect('after a paid cheque bounces', mark, { '3101': 0, '3001': 0 });
  await ChequeLifecycleService.updateChequeStatus(bounced.id, { status: 'returned', actionDate: '2026-04-03', username: 'inv' });
  await expect('after returning a bounced paid cheque', mark, { '3101': 0, '3001': 0 });

  // حذف چک پرداختی برگشتی هر دو سند را باطل می‌کند و دفتر صفر می‌ماند
  mark = await voucherWatermark();
  const removed = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'paid', chequeNumber: tag('P'), amount: 200000, partyName: 'تامین‌کننده آزمون حذف', bankAccountId: bank.id });
  await ChequeLifecycleService.updateChequeStatus(removed.id, { status: 'bounced', actionDate: '2026-04-02', username: 'inv' });
  await ChequeLifecycleService.deleteCheque(removed.id, { username: 'inv' });
  await expect('after deleting a bounced paid cheque', mark, { '3101': 0, '3001': 0 });
  if (await activeVoucherCount(removed.id) !== 0) problems.push('Deleting the bounced paid cheque did not void its vouchers');
  return problems;
}

/**
 * TD-273 (تصمیم مالک محصول — گزینه الف): عودت چک برگشتی به صادرکننده سند می‌گیرد — بدهکار حساب مشتری، بستانکار اسناد
 * واخواستی؛ اسناد واخواستی بسته و مطالبه به حساب جاری مشتری برمی‌گردد. حذف چک عودت‌شده همه اسنادش را باطل می‌کند.
 */
export async function checkReturnedChequeMovesToCustomer(): Promise<string[]> {
  const problems: string[] = [];
  const expect = async (label: string, mark: number, expected: Record<string, number>) => {
    for (const [code, amount] of Object.entries(expected)) {
      const actual = await irrNet(code, mark);
      if (!fin(actual).equals(amount)) problems.push(`${label}: movement of ${code} ${actual}, expected ${amount}`);
    }
  };
  // دریافت چک ۳۰۰٬۰۰۰ (بدهکار ۱۱۰۱، بستانکار ۱۲۰۱)، برگشت (بدهکار ۱۱۰۳، بستانکار ۱۱۰۱) و عودت (بدهکار ۱۲۰۱، بستانکار ۱۱۰۳)
  let mark = await voucherWatermark();
  const cheque = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'received', chequeNumber: tag('R'), amount: 300000, partyName: 'مشتری آزمون عودت' });
  await ChequeLifecycleService.updateChequeStatus(cheque.id, { status: 'bounced', actionDate: '2026-04-02', username: 'inv' });
  await expect('after the bounce', mark, { '1101': 0, '1103': 300000, '1201': -300000 });
  await ChequeLifecycleService.updateChequeStatus(cheque.id, { status: 'returned', actionDate: '2026-04-03', username: 'inv' });
  await expect('after returning it to the drawer', mark, { '1101': 0, '1103': 0, '1201': 0 });

  // چک در جریان وصولی که برگشت خورد و عودت شد: همان نتیجه
  mark = await voucherWatermark();
  const viaBank = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'received', chequeNumber: tag('R'), amount: 200000, partyName: 'مشتری آزمون عودت ب' });
  await ChequeLifecycleService.updateChequeStatus(viaBank.id, { status: 'in_collection', actionDate: '2026-03-20', username: 'inv' });
  await ChequeLifecycleService.updateChequeStatus(viaBank.id, { status: 'bounced', actionDate: '2026-04-02', username: 'inv' });
  await ChequeLifecycleService.updateChequeStatus(viaBank.id, { status: 'returned', actionDate: '2026-04-03', username: 'inv' });
  await expect('after returning a cheque that was in collection', mark, { '1101': 0, '1102': 0, '1103': 0, '1201': 0 });

  // حذف چک عودت‌شده: همه اسنادش باطل و دفتر صفر
  await ChequeLifecycleService.deleteCheque(viaBank.id, { username: 'inv' });
  if (await activeVoucherCount(viaBank.id) !== 0) problems.push('Deleting the returned cheque did not void its vouchers');
  await expect('after deleting the returned cheque', mark, { '1101': 0, '1102': 0, '1103': 0, '1201': 0 });
  return problems;
}

/**
 * TD-275 (تصمیم مالک محصول — گزینه ج): چک ارزی پذیرفته نمی‌شود — نه رکورد چک ساخته می‌شود نه سند حسابداری؛ چک ریالی
 * مثل قبل ثبت می‌شود.
 */
export async function checkForeignChequeRefused(): Promise<string[]> {
  const problems: string[] = [];
  const mark = await voucherWatermark();
  const number = tag('U');
  let refusal: string | null = null;
  try {
    await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'received', chequeNumber: number, amount: 50, currency: 'USD', partyName: 'مشتری دلاری آزمون' });
  } catch (err) {
    refusal = getErrorMessage(err);
  }
  if (!refusal?.includes('چک ارزی')) problems.push(`USD cheque was not refused (${refusal ?? 'accepted'})`);
  const rows = await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM cheques WHERE cheque_number = $1', [number]);
  if (Number(rows.rows[0]?.n ?? 0) !== 0) problems.push('A dollar cheque record was created');
  const vouchers = await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM journal_vouchers WHERE id > $1 AND is_deleted = 0', [mark]);
  if (Number(vouchers.rows[0]?.n ?? 0) !== 0) problems.push('A journal voucher was issued for the dollar cheque');
  const rial = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'received', chequeNumber: tag('R'), amount: 100000, partyName: 'مشتری ریالی آزمون' });
  if (await activeVoucherCount(rial.id) !== 1) problems.push('The rial cheque did not get its registration voucher as before');
  return problems;
}

/**
 * TD-276: چک وصول‌شده در مانده خزانه حساب بانکی شمرده می‌شود — چک دریافتی به حساب واریز و چک پرداختی از آن برداشت شده
 * است؛ مانده خزانه با مانده دفتر یکی و حساب «هم‌خوان» می‌ماند (فهرست حساب‌ها و گزارش تطبیق). چک پرداختی که با
 * bankAccountId: null وصول شود حساب صدور خود را نگه می‌دارد.
 */
export async function checkClearedChequeKeepsBankSynced(): Promise<string[]> {
  const problems: string[] = [];
  const mark = await voucherWatermark();
  const bank = await bankWithOwnLedgerAccount('بانک آزمون وصول چک');
  // واریز ۲٬۰۰۰٬۰۰۰، وصول چک دریافتی ۷۰۰٬۰۰۰ به حساب، پاس شدن چک پرداختی ۳۰۰٬۰۰۰ از حساب ← ۲٬۴۰۰٬۰۰۰
  await TreasuryTransactionService.createTreasuryTransaction({
    type: 'receipt', method: 'bank_transfer', amount: 2000000, bankAccountId: bank.id, partyType: 'customer', partyName: 'مشتری آزمون واریز', date: '2026-04-01', username: 'inv',
  });
  const received = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'received', chequeNumber: tag('C'), amount: 700000, partyName: 'مشتری آزمون وصول' });
  await ChequeLifecycleService.updateChequeStatus(received.id, { status: 'passed', bankAccountId: bank.id, actionDate: '2026-04-02', username: 'inv' });
  const paid = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'paid', chequeNumber: tag('P'), amount: 300000, partyName: 'تامین‌کننده آزمون وصول', bankAccountId: bank.id });
  await ChequeLifecycleService.updateChequeStatus(paid.id, { status: 'passed', bankAccountId: null, actionDate: '2026-04-03', username: 'inv' });
  await approveDraftsAfter(mark);

  const [paidRow] = await orm.select({ bankAccountId: cheques.bankAccountId }).from(cheques).where(eq(cheques.id, paid.id));
  if (paidRow?.bankAccountId !== bank.id) problems.push(`the cleared paid cheque did not keep its bank account (${paidRow?.bankAccountId ?? 'null'})`);

  const listed = (await BankAccountService.getBankAccounts()).find(b => b.id === bank.id);
  const report = (await BankAccountService.getBankReconciliationReport()).accounts.find(b => b.id === bank.id);
  for (const [label, row] of [['فهرست حساب‌ها', listed], ['گزارش تطبیق', report]] as const) {
    if (!row) { problems.push(`${label}: test account not found`); continue; }
    if (!fin(row.treasuryBalance ?? 0).equals(2400000)) problems.push(`${label}: treasury balance ${row.treasuryBalance}, expected 2,400,000`);
    if (!fin(row.ledgerBalance ?? 0).equals(2400000)) problems.push(`${label}: ledger balance ${row.ledgerBalance}, expected 2,400,000`);
    if (row.syncStatus !== 'synced') problems.push(`${label}: account status ${row.syncStatus}, expected synced`);
  }
  return problems;
}

/**
 * TD-277: وصول چک به حساب بانکی بدون سرفصل معین رد می‌شود (مانند تراکنش خزانه) — وضعیت چک، مانده حساب و اسناد دست
 * نمی‌خورند؛ همان چک به حساب بانکی سرفصل‌دار وصول می‌شود و سند وصول اسناد دریافتنی را می‌بندد.
 */
export async function checkChequeClearingNeedsLedgerAccount(): Promise<string[]> {
  const problems: string[] = [];
  const unlinked = await BankAccountService.createBankAccount({ title: `بانک بی‌سرفصل آزمون ${tag('N')}`, type: 'bank', initialBalance: 0, currency: 'IRR' });
  const cheque = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'received', chequeNumber: tag('N'), amount: 400000, partyName: 'مشتری آزمون بی‌سرفصل' });
  const mark = await voucherWatermark();
  let refusal: string | null = null;
  try {
    await ChequeLifecycleService.updateChequeStatus(cheque.id, { status: 'passed', bankAccountId: unlinked.id, actionDate: '2026-04-02', username: 'inv' });
  } catch (err) {
    refusal = getErrorMessage(err);
  }
  if (!refusal?.includes('حساب معین') || !refusal.includes(unlinked.title)) problems.push(`clearing into a bank account without a ledger account was not refused with that account's name (${refusal ?? 'accepted'})`);
  const [row] = await orm.select({ status: cheques.status }).from(cheques).where(eq(cheques.id, cheque.id));
  if (row?.status !== 'received') problems.push(`cheque status after the refused clearing is ${row?.status}, expected received`);
  const bankRow = (await BankAccountService.getBankAccounts()).find(b => b.id === unlinked.id);
  if (!fin(bankRow?.currentBalance ?? 0).isZero()) problems.push(`balance of the account without a ledger account is ${bankRow?.currentBalance}, expected 0`);
  if (!fin(await irrNet('1101', mark)).isZero()) problems.push('The refused clearing issued a notes receivable voucher');

  if (row?.status !== 'received') return problems;
  const linked = await bankWithOwnLedgerAccount('بانک سرفصل‌دار آزمون');
  await ChequeLifecycleService.updateChequeStatus(cheque.id, { status: 'passed', bankAccountId: linked.id, actionDate: '2026-04-02', username: 'inv' });
  if (!fin(await irrNet('1101', mark)).equals(-400000)) problems.push(`clearing into the account with a ledger account did not close notes receivable (1101 movement: ${await irrNet('1101', mark)})`);
  return problems;
}

/**
 * TD-278 (تصمیم مالک محصول — گزینه الف): روش «چک» در فرم خزانه رد می‌شود (چک فقط از دفتر چک) — نه تراکنش، نه سند و نه
 * تغییر مانده. تراکنش چکی پیشین مانده خزانه حساب بانکی را تغییر نمی‌دهد (پولی جابه‌جا نکرده) و ابطال‌پذیر است.
 */
export async function checkTreasuryChequeMethodRefused(): Promise<string[]> {
  const problems: string[] = [];
  const bank = await bankWithOwnLedgerAccount('بانک آزمون روش چک');
  const mark = await voucherWatermark();
  const countRows = async () => Number((await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM treasury_transactions WHERE bank_account_id = $1', [bank.id])).rows[0].n);
  let refusal: string | null = null;
  try {
    await TreasuryTransactionService.createTreasuryTransaction({
      type: 'receipt', method: 'cheque', amount: 900000, bankAccountId: bank.id, partyType: 'customer', partyName: 'مشتری آزمون روش چک', date: '2026-04-02', username: 'inv',
    });
  } catch (err) {
    refusal = getErrorMessage(err);
  }
  if (!refusal?.includes('دفتر چک')) problems.push(`cheque method in the treasury form was not refused (${refusal ?? 'accepted'})`);
  if (await countRows() !== 0) problems.push('The refused cheque method created a treasury transaction');
  if (!fin(await irrNet('1101', mark)).isZero()) problems.push('The refused cheque method debited notes receivable');

  // تراکنش چکی پیشین (ثبت‌شده پیش از v8.0.26): مانده حساب را تغییر نداده بود و سندش ۱۱۰۱ را گرفته بود
  const [legacy] = await orm.insert(treasuryTransactions).values({
    transactionNumber: tag('LEG'), type: 'receipt', date: '2026-04-02', method: 'cheque', amount: money(900000), currency: 'IRR',
    bankAccountId: bank.id, partyType: 'customer', partyName: 'مشتری آزمون چک پیشین', status: 'completed',
  }).returning({ id: treasuryTransactions.id });
  const synced = async (label: string) => {
    const row = (await BankAccountService.getBankAccounts()).find(b => b.id === bank.id);
    if (!fin(row?.treasuryBalance ?? -1).isZero()) problems.push(`${label}: treasury balance ${row?.treasuryBalance}, expected 0`);
    if (row?.syncStatus !== 'synced') problems.push(`${label}: account status ${row?.syncStatus}, expected synced`);
  };
  await synced('تراکنش چکی پیشین');
  try {
    await TreasuryTransactionService.voidTreasuryTransaction(legacy.id, { reason: 'آزمون ابطال تراکنش چکی پیشین', username: 'inv' });
  } catch (err) {
    problems.push(`the earlier cheque-method transaction was not voided (${getErrorMessage(err)})`);
  }
  await synced('پس از ابطال تراکنش چکی پیشین');
  const [bankRow] = await orm.select({ currentBalance: bankAccounts.currentBalance }).from(bankAccounts).where(eq(bankAccounts.id, bank.id));
  if (!fin(bankRow?.currentBalance ?? -1).isZero()) problems.push(`stored account balance after the void is ${bankRow?.currentBalance}, expected 0`);
  return problems;
}

/**
 * TD-280: آشتی دفتر چک با دفاتر (گزارش «آشتی‌سنجی چک‌ها») برای هر گذار چک پرداختی و دریافتی بی‌مغایرت می‌ماند — ۳۱۰۱ با
 * مانده بستانکار مقایسه می‌شود و چک پرداختی برگشتی یا عودت‌شده در آن انتظار نمی‌رود؛ «چک‌های پرداختی باز» در خلاصه مالی
 * چک برگشتی را نمی‌شمارد. (اسناد پیش‌نویس چک پیش از مقایسه تأیید می‌شوند؛ گزارش فقط اسناد تأییدشده را می‌خواند.)
 */
export async function checkChequeReconciliationMatchesLedger(): Promise<string[]> {
  const problems: string[] = [];
  const codes = ['1101', '1102', '1103', '3101'];
  const snapshot = async () => {
    const rows = await AccountingReportService.getChequeReconciliationReport();
    const stats = await AccountingReportService.getFinancialOverviewStats();
    const map = new Map<string, { discrepancy: FinancialDecimal; ledger: FinancialDecimal }>();
    for (const code of codes) {
      const row = rows.find(r => r.code === code);
      map.set(code, { discrepancy: fin(row?.discrepancy ?? 0), ledger: fin(row?.ledgerBalance ?? 0) });
    }
    return { map, paidOpen: fin(stats.totalChequesPaid) };
  };
  const base = await snapshot();
  const mark = await voucherWatermark();
  const expectStep = async (label: string, ledgerDelta: Record<string, number>, paidOpenDelta: number) => {
    await approveDraftsAfter(mark);
    const now = await snapshot();
    for (const code of codes) {
      const b = base.map.get(code)!;
      const n = now.map.get(code)!;
      if (!n.discrepancy.equals(b.discrepancy)) problems.push(`${label}: discrepancy of ${code} went from ${b.discrepancy} to ${n.discrepancy}`);
      const delta = n.ledger.subtract(b.ledger);
      if (!delta.equals(ledgerDelta[code] ?? 0)) problems.push(`${label}: ledger balance change of ${code} is ${delta}, expected ${ledgerDelta[code] ?? 0}`);
    }
    const paidDelta = now.paidOpen.subtract(base.paidOpen);
    if (!paidDelta.equals(paidOpenDelta)) problems.push(`${label}: change of "open paid cheques" is ${paidDelta}, expected ${paidOpenDelta}`);
  };

  const bank = await bankWithOwnLedgerAccount('بانک آزمون آشتی چک');
  const paid = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'paid', chequeNumber: tag('P'), amount: 500000, partyName: 'تامین‌کننده آزمون آشتی', bankAccountId: bank.id });
  await expectStep('issuing a paid cheque', { '3101': 500000 }, 500000);
  await ChequeLifecycleService.updateChequeStatus(paid.id, { status: 'bounced', actionDate: '2026-04-02', username: 'inv' });
  await expectStep('a paid cheque bounces', {}, 0);
  await ChequeLifecycleService.updateChequeStatus(paid.id, { status: 'returned', actionDate: '2026-04-03', username: 'inv' });
  await expectStep('returning a bounced paid cheque', {}, 0);

  const received = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'received', chequeNumber: tag('R'), amount: 300000, partyName: 'مشتری آزمون آشتی' });
  await expectStep('receiving a cheque', { '1101': 300000 }, 0);
  await ChequeLifecycleService.updateChequeStatus(received.id, { status: 'in_collection', actionDate: '2026-03-20', username: 'inv' });
  await expectStep('handing the cheque to the bank for collection', { '1102': 300000 }, 0);
  await ChequeLifecycleService.updateChequeStatus(received.id, { status: 'bounced', actionDate: '2026-04-02', username: 'inv' });
  await expectStep('a received cheque bounces', { '1103': 300000 }, 0);
  await ChequeLifecycleService.updateChequeStatus(received.id, { status: 'returned', actionDate: '2026-04-03', username: 'inv' });
  await expectStep('returning a bounced received cheque', {}, 0);
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

/** TD-275 (کاوش رگرسیون؛ رفع v8.0.23): چک ارزی پذیرفته می‌شد و اسناد آن با نرخ ۱ ثبت می‌شدند (۵۰ دلار = ۵۰ ریال) */
export async function probeForeignChequeAtRateOne(): Promise<boolean> {
  const mark = await voucherWatermark();
  try {
    await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'received', chequeNumber: tag('U'), amount: 50, currency: 'USD', partyName: 'مشتری دلاری کاوش' });
  } catch {
    return false;
  }
  return fin(await irrNet('1101', mark)).equals(50);
}

/**
 * TD-276 (کاوش رگرسیون؛ رفع v8.0.24): پس از وصول چک، حساب بانکی در تطبیق خزانه با دفتر «مغایر» نشان داده می‌شد (مانده
 * خزانه وصول چک را نمی‌شمرد). حساب سرفصل اختصاصی دارد تا حساب‌های بانکی آزمون دیگر در ۱۰۰۳ اثری نداشته باشند.
 */
export async function probeClearedChequeMakesBankDiscrepant(): Promise<boolean> {
  const mark = await voucherWatermark();
  const bank = await bankWithOwnLedgerAccount('بانک کاوش وصول');
  const cheque = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'received', chequeNumber: tag('C'), amount: 700000, partyName: 'مشتری کاوش وصول' });
  await ChequeLifecycleService.updateChequeStatus(cheque.id, { status: 'passed', bankAccountId: bank.id, actionDate: '2026-04-02', username: 'inv' });
  await approveDraftsAfter(mark);
  const row = (await BankAccountService.getBankAccounts()).find(b => b.id === bank.id);
  return row?.syncStatus === 'discrepant';
}

/**
 * TD-277 (کاوش رگرسیون؛ رفع v8.0.25): وصول چک به حساب بانکی بدون سرفصل معین پذیرفته می‌شد ولی سندی نداشت؛ اسناد
 * دریافتنی (۱۱۰۱) هرگز بسته نمی‌شد.
 */
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

/**
 * TD-278 (کاوش رگرسیون؛ رفع v8.0.26): دریافت «چک» در فرم خزانه اسناد دریافتنی (۱۱۰۱) را بدهکار می‌کرد ولی رکورد چکی
 * نمی‌ساخت که روزی وصول شود.
 */
export async function probeTreasuryChequeMethodWithoutCheque(): Promise<boolean> {
  const bank = await bankWithLedgerAccount('بانک کاوش روش چک');
  const before = await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM cheques');
  try {
    await TreasuryTransactionService.createTreasuryTransaction({
      type: 'receipt', method: 'cheque', amount: 900000, bankAccountId: bank.id, partyType: 'customer', partyName: 'مشتری کاوش روش چک', date: '2026-04-02', username: 'inv',
    });
  } catch {
    return false;
  }
  const after = await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM cheques');
  return Number(after.rows[0].n) === Number(before.rows[0].n);
}
