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
