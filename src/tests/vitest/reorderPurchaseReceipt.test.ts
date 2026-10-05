import { describe, expect, it } from 'vitest';
import { documentCreateSchema } from '../../routes/documents.routes';
import { reorderPurchaseReceiptPayload } from '../../lib/reorderAlerts/reorderPurchaseReceipt';

// v8.0.110 (TD-387): «صدور مستقیم سند» از نقطه سفارش بدنه‌ای می‌فرستد که POST /documents می‌پذیرد
describe('reorder direct purchase receipt (TD-387)', () => {
  const payload = reorderPurchaseReceiptPayload({
    status: 'draft',
    supplierName: '  تأمین‌کننده نمونه ',
    warehouse: '',
    date: '1405/07/13',
    notes: 'تامین کسری نقطه سفارش انبار',
    items: [{ id: 7, orderQty: '12', unitPrice: 250000 }, { id: 8, orderQty: 3, unitPrice: null }],
  });

  it('passes the document create schema with the supplier and line prices kept', () => {
    const parsed = documentCreateSchema.safeParse({ body: payload });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.body.buyer_name).toBe('تأمین‌کننده نمونه');
    expect(parsed.data.body.refNumber).toBe('auto');
    expect(parsed.data.body.items.map(i => [i.itemId, i.quantity, i.unit_price])).toEqual([[7, 12, 250000], [8, 3, 0]]);
  });

  it('leaves the warehouse to the server when none is chosen', () => {
    expect(payload.location).toBeUndefined();
    expect(payload.inOut).toBe('in');
  });
});
