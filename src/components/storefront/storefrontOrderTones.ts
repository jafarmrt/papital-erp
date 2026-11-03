import type { OrderStatus, ReceiptStatus } from '../../lib/storefront/storefrontOrderRules';

/** v11 phase 8.2a: one colour per order and receipt status on the «سفارش‌های سایت» page */
export const ORDER_STATUS_TONES: Readonly<Record<OrderStatus, string>> = {
  awaiting_payment: 'bg-slate-100 text-slate-700',
  payment_submitted: 'bg-amber-50 text-amber-800',
  paid: 'bg-emerald-50 text-emerald-800',
  awaiting_approval: 'bg-amber-50 text-amber-800',
  confirmed: 'bg-emerald-50 text-emerald-800',
  shipped: 'bg-sky-50 text-sky-800',
  delivered: 'bg-violet-50 text-violet-800',
  cancelled: 'bg-rose-50 text-rose-700',
};

export const RECEIPT_STATUS_TONES: Readonly<Record<ReceiptStatus, string>> = {
  pending: 'bg-amber-50 text-amber-800',
  accepted: 'bg-emerald-50 text-emerald-800',
  rejected: 'bg-rose-50 text-rose-700',
};
