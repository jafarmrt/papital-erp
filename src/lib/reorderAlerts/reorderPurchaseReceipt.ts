/**
 * v8.0.88 (TD-387): بدنه «صدور مستقیم سند» از هشدار نقطه سفارش، مطابق `documentCreateSchema` (POST /documents). پیش‌تر
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
