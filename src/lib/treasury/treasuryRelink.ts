/**
 * v10.0.123 (TD-1122): گزینه انتقال دریافت یا پرداخت به سند دیگر (`GET /accounting/treasury/:id/document-options`)،
 * مشترک سرور و پنجره «انتقال به سند دیگر».
 */
export interface TreasuryRelinkOption {
  id: number;
  refNumber: string;
  type: string;
  status: string;
  /** تاریخ میلادی ISO سند */
  date: string;
  buyerName: string;
}

/** دکمه انتقال فقط برای دریافت مشتری یا پرداخت تأمین‌کننده زنده‌ای که فیش حقوق نیست (همان قاعده سرور) */
export function canRelinkTreasuryRow(tx: {
  type?: string | null; partyType?: string | null; status?: string | null;
  reversalOfId?: number | null; payrollId?: number | null;
}): boolean {
  if (tx.status && tx.status !== 'completed') return false;
  if (tx.reversalOfId || tx.payrollId) return false;
  return (tx.type === 'receipt' && tx.partyType === 'customer') || (tx.type === 'payment' && tx.partyType === 'supplier');
}
