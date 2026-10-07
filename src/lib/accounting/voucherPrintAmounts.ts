import { fin } from '../financialDecimal';
import { computeVoucherCurrencyBalance, voucherRowCurrency, voucherRowRate, type CurrencyBalanceRow } from './voucherCurrencyBalance';

/**
 * v9.0.158 (TD-573، B03-31): مبلغ‌های چاپ سند حسابداری با قاعده تراز TD-551.
 *
 * - سندی که همه ردیف‌هایش یک ارز و یک نرخ دارند در همان ارز چاپ می‌شود و سرستون‌ها نام همان ارز را دارند.
 * - سند چندارزی یا چندنرخی به ریال چاپ می‌شود: ردیف ارزی مبلغ × نرخ همان ردیف (گرد به ریال) است و مبلغ ارزی و نرخش زیر آن
 *   می‌آید (`original`).
 * پیش‌تر سرستون همیشه «(ریال)» بود و سند ۱۰۰ دلاری «۱۰۰» زیر «بدهکار (ریال)» چاپ می‌شد.
 */

export interface VoucherPrintRowAmounts {
  debit: number;
  credit: number;
  /** مبلغ ارزی ردیف و نرخش، فقط وقتی سند به ریال چاپ می‌شود و ردیف ریالی نیست */
  original: { currency: string; rate: number | null; debit: number; credit: number } | null;
}

export interface VoucherPrintAmounts {
  /** ارز ستون‌ها، جمع‌ها و مبلغ به حروف */
  currency: string;
  inRial: boolean;
  /** نرخ یگانه سند ارزی تک‌ارز (برای نمایش زیر سرآیند)؛ null برای سند ریالی یا چندارزی */
  rate: number | null;
  rows: VoucherPrintRowAmounts[];
  totalDebit: number;
  totalCredit: number;
  /** شماره (از ۱) ردیف‌های ارزی بی نرخ؛ جمع ریالی آن‌ها را ندارد */
  rowsWithoutRate: number[];
}

function amount(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  try {
    return fin(value as string | number).toNumber();
  } catch {
    return 0;
  }
}

export function voucherPrintAmounts(items: readonly CurrencyBalanceRow[] | null | undefined, voucherCurrency?: unknown): VoucherPrintAmounts {
  const safeItems = Array.isArray(items) ? items : [];
  const balance = computeVoucherCurrencyBalance(safeItems, voucherCurrency);
  const rows = safeItems.map((item): VoucherPrintRowAmounts => {
    const currency = voucherRowCurrency(item.currency, voucherCurrency);
    const debit = amount(item.debit);
    const credit = amount(item.credit);
    if (!balance.inRial || currency === 'IRR') return { debit, credit, original: null };
    const rate = voucherRowRate(currency, item.exchangeRate);
    const toRial = (value: number) => (rate ? fin(value).multiply(rate).round(0).toNumber() : 0);
    return { debit: toRial(debit), credit: toRial(credit), original: { currency, rate: rate ? rate.toNumber() : null, debit, credit } };
  });
  const firstRate = safeItems.length > 0 ? voucherRowRate(balance.currency, safeItems[0].exchangeRate) : null;
  return {
    currency: balance.currency,
    inRial: balance.inRial,
    rate: !balance.inRial && balance.currency !== 'IRR' && firstRate ? firstRate.toNumber() : null,
    rows,
    totalDebit: balance.totalDebit,
    totalCredit: balance.totalCredit,
    rowsWithoutRate: balance.rowsWithoutRate,
  };
}
