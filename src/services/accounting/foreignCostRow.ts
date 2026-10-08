import { fin, type DecimalValue, type FinancialDecimal } from '../../lib/financialDecimal.js';

/**
 * v8.0.18 (TD-261، تصمیم مالک محصول — گزینه ب): ردیف بهای ریالی (بهای تمام‌شده، موجودی کالا، کالای اهدایی) در سند ارزی.
 *
 * بهای کاردکس ریالی است. ردیف در ارز سند می‌ماند (مبلغ تا ۴ رقم اعشار) و نرخ همان ردیف = مبلغ ریالی ÷ مبلغ ارزی، تا
 * مبلغ × نرخ (قاعده تراز آزمایشی و گزارش‌ها) دقیقاً همان ارزش ریالی کاردکس باشد. پیش‌تر نرخ سند به کار می‌رفت و گرد
 * کردن مبلغ ارزی در هر ردیف تا نرخ/۲۰۰۰۰ ریال اختلاف می‌ساخت (۰٫۱۶۶۷ × ۶۰۰٬۰۰۰ = ۱۰۰٬۰۲۰ به‌جای ۱۰۰٬۰۰۰).
 * سند ریالی (نرخ ۱) بی‌تغییر است.
 */
const MIN_FOREIGN_AMOUNT = fin('0.0001');

export interface ForeignCostRow {
  /** مبلغ ردیف به ارز سند */
  amount: FinancialDecimal;
  /** نرخ همان ردیف (ریال برای یک واحد ارز سند) */
  exchangeRate: FinancialDecimal;
}

function isForeignRate(docRate: FinancialDecimal): boolean {
  return docRate.isPositive() && !docRate.equals(1);
}

/** مبلغ ارزی بخش ریالی یک ردیف (بی نرخ ردیف)؛ مبلغ مثبتی که به صفر گرد شود کمینه ۰٫۰۰۰۱ است */
export function irrToForeignAmount(irrAmount: DecimalValue, docRate: DecimalValue): FinancialDecimal {
  const irr = fin(irrAmount);
  const rate = fin(docRate);
  if (!isForeignRate(rate)) return irr.round(4);
  if (!irr.isPositive()) return fin(0);
  const amount = irr.divide(rate, 4);
  return amount.isPositive() ? amount : MIN_FOREIGN_AMOUNT;
}

/** نرخ ردیفی که ارزش ریالی کل آن irrTotal و مبلغ ارزی آن amount است؛ در سند ریالی همان نرخ سند */
export function rowExchangeRate(irrTotal: DecimalValue, amount: DecimalValue, docRate: DecimalValue): FinancialDecimal {
  const rate = fin(docRate);
  const foreign = fin(amount);
  if (!isForeignRate(rate) || !foreign.isPositive()) return rate.isPositive() ? rate : fin(1);
  return fin(irrTotal).divide(foreign, 4);
}

/** ردیف تمام‌ریالی (مثلاً بهای تمام‌شده یک گروه کالا) در سند ارزی */
export function foreignCostRow(irrAmount: DecimalValue, docRate: DecimalValue): ForeignCostRow {
  const amount = irrToForeignAmount(irrAmount, docRate);
  return { amount, exchangeRate: rowExchangeRate(irrAmount, amount, docRate) };
}

const RATE_STEP = fin('0.0001');
/** Upper bound of the rate search; an amount of at most 10,000 units always finds its rial within it */
const MAX_RATE_STEPS = 2000;

/**
 * v10.0.3 (TD-1030): a 4-decimal row rate at which the row's amount comes to exactly `targetRial` under the report rule
 * (amount × row rate, rounded to the rial; TD-260). The amount and the rate are both stored to 4 decimals, so
 * rial ÷ amount alone could miss the rial by one and leave a foreign voucher one rial out of balance; the nearest rate
 * that hits the rial is taken. When no 4-decimal rate hits it (an amount above 10,000 units), rial ÷ amount stays.
 */
export function rateForRial(amount: DecimalValue, targetRial: DecimalValue, docRate: DecimalValue): FinancialDecimal {
  const foreign = fin(amount);
  const target = fin(targetRial);
  const base = rowExchangeRate(target, foreign, docRate);
  if (!isForeignRate(fin(docRate)) || !foreign.isPositive()) return base;
  const hits = (rate: FinancialDecimal) => foreign.multiply(rate).round(0).equals(target);
  for (let k = 0; k <= MAX_RATE_STEPS; k++) {
    const up = base.add(RATE_STEP.multiply(k));
    if (hits(up)) return up;
    const down = base.subtract(RATE_STEP.multiply(k));
    if (down.isPositive() && hits(down)) return down;
  }
  return base;
}

export interface BalancedCostRows {
  /** one row per rial part, each worth its part rounded to the rial */
  parts: ForeignCostRow[];
  /** the opposite row: the sum of the parts' amounts, worth exactly the sum of the parts' rials */
  total: ForeignCostRow;
}

/**
 * v10.0.3 (TD-1030): rial Kardex parts (finished goods, raw materials …) and their opposite row (cost of sales, work in
 * progress) of a foreign document, so that the voucher balances in rials as well as in its currency: each part is worth
 * its rial value rounded to the rial and the opposite row exactly their sum. A rial document keeps `foreignCostRow`.
 */
export function balancedCostRows(irrParts: DecimalValue[], docRate: DecimalValue): BalancedCostRows {
  const rate = fin(docRate);
  if (!isForeignRate(rate)) {
    const parts = irrParts.map(p => foreignCostRow(p, rate));
    const totalIrr = irrParts.reduce<FinancialDecimal>((sum, p) => sum.add(p), fin(0));
    const amount = parts.reduce<FinancialDecimal>((sum, p) => sum.add(p.amount), fin(0)).round(4);
    return { parts, total: { amount, exchangeRate: rowExchangeRate(totalIrr, amount, rate) } };
  }
  let totalRial = fin(0);
  let totalAmount = fin(0);
  const parts = irrParts.map(p => {
    const amount = irrToForeignAmount(p, rate);
    const rial = fin(p).round(0);
    if (!amount.isPositive()) return { amount, exchangeRate: rate };
    totalRial = totalRial.add(rial);
    totalAmount = totalAmount.add(amount);
    return { amount, exchangeRate: rateForRial(amount, rial, rate) };
  });
  const amount = totalAmount.round(4);
  return { parts, total: { amount, exchangeRate: rateForRial(amount, totalRial, rate) } };
}
