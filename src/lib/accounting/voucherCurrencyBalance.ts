import { fin, FinancialMath, type FinancialDecimal } from '../financialDecimal';
import { VOUCHER_BALANCE_TOLERANCE } from '../voucherBalance';

/**
 * v9.0.190 (TD-551، B03-09، تصمیم ت۷ الف مالک محصول): ارز، نرخ و تراز ردیف‌های سند حسابداری دستی، مشترک سرور و فرم.
 *
 * - ارز ردیف: ارز خود ردیف، وگرنه ارز سند، وگرنه ریال (خالی و «ریال» = IRR).
 * - ردیف غیرریالی نرخ مثبت لازم دارد؛ هرگز نرخ ۱ به جای نرخ نانوشته.
 * - تراز: سندی که همه ردیف‌هایش یک ارز و یک نرخ دارند در همان ارز سنجیده می‌شود؛ سند چندارزی یا چندنرخی به ریال، با قاعده
 *   TD-260 (ردیف ارزی = مبلغ × نرخ همان ردیف، گرد به ریال). پیش‌تر «۱۰۰ دلار / ۱۰۰ ریال» روی مبلغ خام تراز بود و
 *   تراز آزمایشی ریالی را ۵۹٬۹۹۹٬۹۰۰ ریال نامتراز می‌کرد.
 */

export interface CurrencyBalanceRow {
  debit?: unknown;
  credit?: unknown;
  currency?: unknown;
  exchangeRate?: unknown;
}

export interface VoucherCurrencyBalance {
  /** true: تراز به ریال سنجیده شد (سند چندارزی یا چندنرخی)؛ false: در ارز یگانه ردیف‌ها */
  inRial: boolean;
  /** ارز جمع‌ها: IRR وقتی inRial، وگرنه ارز ردیف‌ها */
  currency: string;
  totalDebit: number;
  totalCredit: number;
  difference: number;
  isBalanced: boolean;
  /** شماره (از ۱) ردیف‌های غیرریالی بی نرخ مثبت؛ با این ردیف‌ها تراز ریالی سنجیده نمی‌شود */
  rowsWithoutRate: number[];
}

/** کد ارز: خالی ← null (یعنی ارز بالادست)، «ریال» ← IRR، وگرنه حروف بزرگ */
function currencyCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  if (code === '') return null;
  return code === 'ریال' ? 'IRR' : code;
}

/** ارز ردیف: ارز خود ردیف، وگرنه ارز سند، وگرنه IRR */
export function voucherRowCurrency(rowCurrency: unknown, voucherCurrency?: unknown): string {
  return currencyCode(rowCurrency) ?? currencyCode(voucherCurrency) ?? 'IRR';
}

/** نرخ مثبت ردیف یا null (ردیف ریالی همیشه ۱) */
export function voucherRowRate(currency: string, exchangeRate: unknown): FinancialDecimal | null {
  if (currency === 'IRR') return fin(1);
  if (exchangeRate === null || exchangeRate === undefined || exchangeRate === '') return null;
  try {
    const rate = fin(exchangeRate as string | number);
    return rate.isPositive() ? rate : null;
  } catch {
    return null;
  }
}

function amountOf(value: unknown): FinancialDecimal {
  if (value === null || value === undefined || value === '') return fin(0);
  try {
    return fin(value as string | number);
  } catch {
    return fin(0);
  }
}

export function computeVoucherCurrencyBalance(rows: readonly CurrencyBalanceRow[] | null | undefined, voucherCurrency?: unknown): VoucherCurrencyBalance {
  const safeRows = Array.isArray(rows) ? rows : [];
  const resolved = safeRows.map(row => {
    const currency = voucherRowCurrency(row.currency, voucherCurrency);
    return { currency, rate: voucherRowRate(currency, row.exchangeRate), debit: amountOf(row.debit), credit: amountOf(row.credit) };
  });
  const rowsWithoutRate = resolved.flatMap((r, i) => (r.rate === null ? [i + 1] : []));
  const currencies = new Set(resolved.map(r => r.currency));
  const rates = new Set(resolved.map(r => r.rate?.toString() ?? '-'));
  const single = currencies.size <= 1 && rates.size <= 1;
  const toRial = (amount: FinancialDecimal, r: typeof resolved[number]) =>
    (r.currency === 'IRR' ? amount : amount.multiply(r.rate ?? 0).round(0));
  const debits = resolved.map(r => (single ? r.debit : toRial(r.debit, r)));
  const credits = resolved.map(r => (single ? r.credit : toRial(r.credit, r)));
  const totalDebit = FinancialMath.sum(debits);
  const totalCredit = FinancialMath.sum(credits);
  const difference = totalDebit.subtract(totalCredit).abs();
  return {
    inRial: !single,
    currency: single ? (resolved[0]?.currency ?? voucherRowCurrency(undefined, voucherCurrency)) : 'IRR',
    totalDebit: totalDebit.toNumber(),
    totalCredit: totalCredit.toNumber(),
    difference: difference.toNumber(),
    isBalanced: rowsWithoutRate.length === 0 && totalDebit.isPositive() && difference.lessThanOrEqual(VOUCHER_BALANCE_TOLERANCE),
    rowsWithoutRate,
  };
}
