import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { journalVoucherItems } from '../../db/schema.js';
import { fin, type DecimalValue, type FinancialDecimal } from '../../lib/financialDecimal.js';
import { VOUCHER_BALANCE_TOLERANCE } from '../../lib/voucherBalance.js';
import { computeVoucherCurrencyBalance, voucherRowCurrency, voucherRowRate } from '../../lib/accounting/voucherCurrencyBalance.js';
import { formatPersianNumber } from '../../utils.js';
import { UnbalancedVoucherError, ValidationError } from '../../errors/customErrors.js';

/**
 * v9.0.190 (TD-551، B03-09، تصمیم ت۷ الف): سنجش ردیف‌ها و تراز سند حسابداری.
 *
 * - همه مسیرها: سند تک‌ارزی مانند پیش روی مبلغ خام تراز سنجیده می‌شود؛ سند چندارزی به ریال با قاعده TD-260
 *   (ردیف ارزی = مبلغ × نرخ همان ردیف، گرد به ریال) و ردیف ارزی بی نرخ در آن پذیرفته نیست.
 * - سند دستی (ثبت و ویرایش از مسیر اسناد، سند اصلاحی): ارز ردیف بی ارز، ارز سند است؛ هر ردیف غیرریالی نرخ مثبت
 *   لازم دارد (۴۲۲ `VOUCHER_ROW_RATE_REQUIRED`، هرگز نرخ ۱)؛ سند تک‌ارزی با چند نرخ هم به ریال سنجیده می‌شود.
 *   پیش‌تر «۱۰۰ دلار بی نرخ / ۱۰۰ ریال» پذیرفته و دلار با نرخ ۱ ذخیره می‌شد.
 */

export interface VoucherRowAmounts {
  debit: DecimalValue;
  credit: DecimalValue;
  currency?: string;
  exchangeRate?: DecimalValue;
}

export interface VoucherRowTotals {
  sumDebit: FinancialDecimal;
  sumCredit: FinancialDecimal;
}

const rowNumbers = (rows: readonly number[]): string => rows.map(n => formatPersianNumber(n)).join('، ');

function rawTotals(items: readonly VoucherRowAmounts[]): VoucherRowTotals {
  let sumDebit = fin(0);
  let sumCredit = fin(0);
  for (const item of items) {
    const d = fin(item.debit);
    const c = fin(item.credit);
    if (d.isNegative() || c.isNegative()) throw new ValidationError('مبالغ بدهکار و بستانکار نمی‌توانند منفی باشند');
    if (d.isZero() && c.isZero()) throw new ValidationError('هر ردیف سند باید دارای مبلغ بدهکار یا بستانکار باشد');
    sumDebit = sumDebit.add(d);
    sumCredit = sumCredit.add(c);
  }
  return { sumDebit, sumCredit };
}

function unbalanced(debit: FinancialDecimal | number, credit: FinancialDecimal | number, inRial: boolean): UnbalancedVoucherError {
  const d = fin(debit);
  const c = fin(credit);
  const unit = inRial ? ' (به ریال، هر ردیف ارزی با نرخ خودش)' : '';
  return new UnbalancedVoucherError(
    `سند تراز نیست${unit}! جمع بدهکار: ${d.toDisplayString()} و جمع بستانکار: ${c.toDisplayString()} می‌باشد (اختلاف: ${d.subtract(c).abs().toDisplayString()})`,
  );
}

/**
 * جمع خام ردیف‌ها پس از سنجش تراز: تک‌ارزی (و در سند دستی تک‌نرخی) روی مبلغ خام، وگرنه به ریال.
 * جمع برگشتی همان جمع خام پیشین است که در سرآیند سند ذخیره می‌شود.
 */
export function assertVoucherRowsBalanced(
  items: readonly VoucherRowAmounts[],
  voucherCurrency: string | null | undefined,
  options: { manual?: boolean } = {},
): VoucherRowTotals {
  const totals = rawTotals(items);
  const balance = computeVoucherCurrencyBalance(items, voucherCurrency);
  const currencies = new Set(items.map(item => voucherRowCurrency(item.currency, voucherCurrency)));
  const checkRaw = options.manual ? !balance.inRial : currencies.size <= 1;
  if (checkRaw) {
    if (totals.sumDebit.subtract(totals.sumCredit).abs().greaterThan(VOUCHER_BALANCE_TOLERANCE)) {
      throw unbalanced(totals.sumDebit, totals.sumCredit, false);
    }
    return totals;
  }
  if (balance.rowsWithoutRate.length > 0) {
    throw new ValidationError(
      `ردیف ${rowNumbers(balance.rowsWithoutRate)} سند ارزی است و نرخ تبدیل به ریال ندارد؛ نرخ هر ردیف غیرریالی را وارد کنید.`,
      { rows: balance.rowsWithoutRate }, 'VOUCHER_ROW_RATE_REQUIRED',
    );
  }
  if (!balance.isBalanced) throw unbalanced(balance.totalDebit, balance.totalCredit, true);
  return totals;
}

/**
 * ردیف‌های سند دستی با ارز و نرخ قطعی: ارز ردیف (وگرنه ارز سند، وگرنه ریال) و نرخ مثبت ردیف غیرریالی (ریال = ۱).
 * ردیف غیرریالی بی نرخ مثبت رد می‌شود و تراز با قاعده سند دستی سنجیده می‌شود.
 */
export function resolveManualVoucherRows<T extends VoucherRowAmounts>(
  items: readonly T[],
  voucherCurrency: string | null | undefined,
): { rows: Array<T & { currency: string; exchangeRate: string }>; totals: VoucherRowTotals } {
  const missing = items.flatMap((item, i) => {
    const currency = voucherRowCurrency(item.currency, voucherCurrency);
    return voucherRowRate(currency, item.exchangeRate) === null ? [i + 1] : [];
  });
  if (missing.length > 0) {
    throw new ValidationError(
      `ردیف ${rowNumbers(missing)} سند ارزی است و نرخ تبدیل به ریال ندارد؛ نرخ هر ردیف غیرریالی را وارد کنید.`,
      { rows: missing }, 'VOUCHER_ROW_RATE_REQUIRED',
    );
  }
  const rows = items.map(item => {
    const currency = voucherRowCurrency(item.currency, voucherCurrency);
    return { ...item, currency, exchangeRate: voucherRowRate(currency, item.exchangeRate)!.round(4).toString() };
  });
  return { rows, totals: assertVoucherRowsBalanced(rows, voucherCurrency, { manual: true }) };
}

/**
 * تراز سند ذخیره‌شده برای قطعی‌سازی: جمع سرآیند (مانند پیش)، وگرنه ردیف‌های فعال با قاعده ت۷؛ سند چندارزی که به
 * ریال تراز است (جمع خام سرآیندش ارز و ریال را با هم جمع کرده) قطعی می‌شود.
 */
export async function isVoucherBalancedForFinalize(
  tx: DbExecutor,
  voucher: { id: number; totalDebit: DecimalValue; totalCredit: DecimalValue; currency?: string | null },
): Promise<boolean> {
  if (fin(voucher.totalDebit).subtract(fin(voucher.totalCredit)).abs().lessThanOrEqual(VOUCHER_BALANCE_TOLERANCE)) return true;
  const rows = await tx.select({
    debit: journalVoucherItems.debit,
    credit: journalVoucherItems.credit,
    currency: journalVoucherItems.currency,
    exchangeRate: journalVoucherItems.exchangeRate,
  }).from(journalVoucherItems)
    .where(and(eq(journalVoucherItems.voucherId, voucher.id), eq(journalVoucherItems.isDeleted, 0)));
  return computeVoucherCurrencyBalance(rows.map(r => ({
    debit: r.debit?.toString(), credit: r.credit?.toString(), currency: r.currency, exchangeRate: r.exchangeRate?.toString(),
  })), voucher.currency).isBalanced;
}
