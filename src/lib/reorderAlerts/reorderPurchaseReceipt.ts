/**
 * v8.0.110 (TD-387): بدنه «صدور مستقیم سند» از هشدار نقطه سفارش، مطابق `documentCreateSchema` (POST /documents). پیش‌تر
 * شماره سند نداشت و همیشه ۴۲۲ «شماره مرجع الزامی است» می‌گرفت، و نام تأمین‌کننده و قیمت در `partyName` و `totalPrice`
 * می‌رفت که سرور نمی‌شناسد و دور می‌اندازد (رسید بی تأمین‌کننده). شماره را سرور می‌دهد (`refNumber: 'auto'`) و جمع
 * ردیف‌ها را سرور از مقدار و فی حساب می‌کند.
 */
export interface PurchaseReceiptPayload {
  docType: 'receipt';
  status: 'draft' | 'final';
  refNumber: 'auto';
  inOut: 'in';
  buyer_name: string;
  location?: string;
  date: string;
  notes: string;
  items: Array<{ itemId: number; quantity: number; unit_price: number }>;
}

export interface ReorderReceiptLine {
  id: number;
  orderQty: number | string;
  unitPrice?: number | string | null;
}

export function reorderPurchaseReceiptPayload(input: {
  status: 'draft' | 'final';
  supplierName: string;
  warehouse?: string;
  date: string;
  notes: string;
  items: readonly ReorderReceiptLine[];
}): PurchaseReceiptPayload {
  return {
    docType: 'receipt',
    status: input.status,
    refNumber: 'auto',
    inOut: 'in',
    buyer_name: input.supplierName.trim(),
    location: input.warehouse?.trim() || undefined,
    date: input.date,
    notes: input.notes,
    items: input.items.map(it => ({ itemId: it.id, quantity: Number(it.orderQty), unit_price: Number(it.unitPrice || 0) })),
  };
}

/** A line of the reorder purchase form as the price check reads it */
export interface ReorderPricedLine {
  name: string;
  unitPrice?: number | string | null;
  weighted_average_cost?: number | string | null;
}

const isZeroPrice = (line: ReorderPricedLine) => !(Number(line.unitPrice || 0) > 0);

/** Whether the form must ask about donated goods: a final receipt with a line at price zero */
export const receiptNeedsDonatedConfirmation = (status: 'draft' | 'final', items: readonly ReorderPricedLine[]): boolean =>
  status === 'final' && items.some(isZeroPrice);

/**
 * v9.0.403 (TD-830، یافته B07-14): رسید نهایی «صدور مستقیم سند» از هشدار نقطه سفارش ردیف بهای صفر را فقط با تأیید صریح
 * «کالای اهدایی» می‌پذیرد، و هرگز برای کالایی که هنوز میانگین موزون بها ندارد: چنین رسیدی کالا را با بهای صفر وارد انبار
 * می‌کند و پس از آن هیچ فروش و حواله‌ای برایش پذیرفته نمی‌شود (AGENTS §۳، TD-256). پیش‌تر پیش‌فرض بهای کالای بی بها صفر
 * بود و «ثبت سند خرید انبار» بی هیچ هشداری رسید نهایی با بهای صفر می‌ساخت. پیش‌نویس بررسی نمی‌شود؛ نهایی‌سازی بعدی‌اش در
 * صفحه سند است.
 */
export function reorderReceiptPriceError(input: {
  status: 'draft' | 'final';
  donatedConfirmed: boolean;
  items: readonly ReorderPricedLine[];
}): string | null {
  if (!receiptNeedsDonatedConfirmation(input.status, input.items)) return null;
  const zeroLines = input.items.filter(isZeroPrice);
  const withoutCost = zeroLines.find(line => !(Number(line.weighted_average_cost || 0) > 0));
  if (withoutCost) {
    return `«${withoutCost.name}» هنوز میانگین موزون بها ندارد و با بهای صفر بی بها وارد انبار می‌شود؛ پس از آن فروش و حواله‌اش پذیرفته نمی‌شود. بهای خرید آن را وارد کنید.`;
  }
  if (!input.donatedConfirmed) {
    return `بهای «${zeroLines[0].name}» صفر است. اگر کالا اهدایی است، گزینه «کالای اهدایی» را بزنید؛ وگرنه بهای خرید را وارد کنید.`;
  }
  return null;
}
