import { fin, type FinancialDecimal } from '../../lib/financialDecimal.js';

interface OrderLike {
  total?: unknown;
  line_items?: Array<{ sku?: unknown; name?: unknown; quantity?: unknown; total?: unknown }>;
  refunds?: unknown;
}

function amount(raw: unknown): FinancialDecimal {
  const n = Number(raw);
  return raw === undefined || raw === null || raw === '' || !Number.isFinite(n) ? fin(0) : fin(String(raw).trim());
}

/** اقلام سفارش به‌صورت «SKU: مقدار × جمع» مرتب‌شده (نام قلم اگر SKU ندارد) */
function linesOf(order: OrderLike): string[] {
  const lines = Array.isArray(order.line_items) ? order.line_items : [];
  return lines
    .map(li => `${String(li.sku ?? '').trim() || String(li.name ?? '').trim()}: ${amount(li.quantity).toString()} × ${amount(li.total).toString()}`)
    .sort();
}

/** جمع مبلغ استردادهای سفارش (ووکامرس مبلغ استرداد را منفی می‌فرستد) */
function refundedOf(order: OrderLike): FinancialDecimal {
  const refunds = Array.isArray(order.refunds) ? order.refunds as Array<{ total?: unknown }> : [];
  return refunds.reduce((sum, r) => sum.add(amount(r?.total).abs()), fin(0));
}

/**
 * v8.0.43 (TD-294، تصمیم مالک محصول — گزینه الف): تفاوت سفارشِ فاکتورشده با همان سفارش در وب‌هوک یا همگام‌سازی بعدی. اگر اقلام یا
 * مبلغ سفارش عوض شده یا استرداد تازه‌ای آمده باشد متن تفاوت را برمی‌گرداند، وگرنه null. سفارش پیشین بی‌داده (لاگ قدیمی) تفاوتی ندارد.
 */
export function describeOrderChange(previous: OrderLike | null | undefined, current: OrderLike): string | null {
  if (!previous || typeof previous !== 'object') return null;
  const parts: string[] = [];

  const before = linesOf(previous);
  const after = linesOf(current);
  const totalBefore = amount(previous.total);
  const totalAfter = amount(current.total);
  if (before.join('|') !== after.join('|') || !totalBefore.equals(totalAfter)) {
    parts.push(`اقلام یا مبلغ سفارش عوض شده است (پیش‌تر ${before.join('، ') || 'بی‌قلم'} به مبلغ ${totalBefore.toString()}؛ اکنون ${after.join('، ') || 'بی‌قلم'} به مبلغ ${totalAfter.toString()})`);
  }

  const refundedBefore = refundedOf(previous);
  const refundedAfter = refundedOf(current);
  if (refundedAfter.greaterThan(refundedBefore)) {
    parts.push(`استرداد تازه به مبلغ ${refundedAfter.subtract(refundedBefore).toString()} ثبت شده است (جمع استردادها ${refundedAfter.toString()})`);
  }
  return parts.length > 0 ? parts.join('؛ ') : null;
}
