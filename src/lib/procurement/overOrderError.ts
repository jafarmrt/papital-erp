import type { OverOrderedItem } from '../../components/procurement/OverOrderWarning';

/** کد پاسخ ۴۲۲ سرور برای سفارش بیش از مانده درخواست بی دلیل (`convertToPurchaseOrders`) */
export const OVER_ORDER_REASON_REQUIRED = 'OVER_ORDER_REASON_REQUIRED';

interface ServerOverOrder {
  itemId?: unknown;
  itemName?: unknown;
  excess?: unknown;
}

/**
 * v10.0.252 (OBS-R2-37): کالاهای سفارش بیش از مانده که سرور در ۴۲۲ `OVER_ORDER_REASON_REQUIRED` نام می‌برد
 * (`details.overOrders`)، به شکل هشدار فرم. سرور مانده را برای هر کالا روی همه ردیف‌هایش می‌سنجد و فرم برای هر ردیف؛ پس
 * سرور می‌تواند سفارشی را بیش از مانده بداند که فرم ندانسته است. پیش‌تر فرم فقط پیام را نشان می‌داد و کادر دلیل را باز
 * نمی‌کرد، پس سفارش بی‌راه ثبت می‌ماند. هر خطای دیگر فهرست خالی است.
 */
export function overOrdersFromError(err: unknown, unitOf: (itemId: number) => string = () => 'عدد'): OverOrderedItem[] {
  const e = err as { code?: unknown; details?: { overOrders?: unknown } } | null;
  if (!e || e.code !== OVER_ORDER_REASON_REQUIRED) return [];
  const rows = Array.isArray(e.details?.overOrders) ? (e.details.overOrders as ServerOverOrder[]) : [];
  return rows
    .map(row => ({
      key: `server-${Number(row.itemId)}`,
      itemName: String(row.itemName ?? ''),
      unit: unitOf(Number(row.itemId)),
      excess: Number(row.excess),
    }))
    .filter(row => Number.isFinite(row.excess) && row.excess > 0);
}
