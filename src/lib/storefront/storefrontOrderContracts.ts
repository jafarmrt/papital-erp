import type { CancelReason, OrderStatus, ReceiptStatus } from './storefrontOrderRules.js';

/**
 * v11 phase 8.2a: the answers of the order routes, one contract for the server, the ERP orders screen and the storefront
 * app (`AGENTS.md` §6.5). Amounts are whole rials as digit strings; `…Toman` is the same amount in tomans for the buyer.
 * A buyer's answer carries only that order and that buyer's own address; no cost, no other customer, no accounting row.
 */

/** `POST /api/storefront/v1/shipping/quote` */
export interface ShippingQuoteRequest {
  province: string;
  lines: Array<{ slug: string; quantity: number }>;
}

export interface ShippingOption {
  code: string;
  title: string;
  description: string;
  /** 'cost': the amount is added to the order; 'on_delivery': the buyer pays the courier, the order adds nothing */
  kind: 'cost' | 'on_delivery';
  amount: string;
  amountToman: string;
  free: boolean;
}

export interface ShippingQuoteAnswer {
  itemsAmount: string;
  /** the methods this cart and province can use, in the site's order (a weight-priced method needs every item's weight) */
  options: ShippingOption[];
}

/** `POST /api/storefront/v1/orders` */
export interface PlaceOrderRequest {
  /** a key the app makes for this checkout; the same key and body answer the same order again */
  requestKey: string;
  recipientName: string;
  phone: string;
  province: string;
  city: string;
  address: string;
  postalCode: string;
  note: string;
  shippingMethod: string;
  lines: Array<{ slug: string; quantity: number }>;
}

export interface OrderPaymentInfo {
  cardNumber: string;
  cardHolder: string;
  bankName: string;
  iban: string;
}

export interface BuyerOrderLine {
  slug: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: string;
  lineAmount: string;
}

export interface BuyerReceipt {
  reference: string;
  paidAt: string;
  cardLast4: string;
  amount: string;
  status: ReceiptStatus;
  statusTitle: string;
  rejectReason: string;
  createdAt: string;
}

export interface BuyerOrder {
  number: string;
  status: OrderStatus;
  statusTitle: string;
  createdAt: string;
  /** until when the stock is held for an unpaid order (null once a receipt waits or the order is past payment) */
  payBefore: string | null;
  recipient: { name: string; phone: string; province: string; city: string; address: string; postalCode: string };
  note: string;
  shipping: { code: string; title: string; kind: 'cost' | 'on_delivery'; amount: string };
  lines: BuyerOrderLine[];
  itemsAmount: string;
  payableAmount: string;
  payableToman: string;
  /** where to pay; only while the order waits for payment */
  payment: OrderPaymentInfo | null;
  /** whether the buyer may send a receipt now */
  canSendReceipt: boolean;
  receipts: BuyerReceipt[];
  trackingCode: string;
  cancelReason: CancelReason | null;
  cancelReasonTitle: string;
}

/** The answer of placing an order: the order, and its tracking key (also answered again to a repeat of the same request) */
export interface PlacedOrder {
  order: BuyerOrder;
  accessKey: string;
}

/** `POST /api/storefront/v1/orders/:number/receipts` */
export interface ReceiptRequest {
  reference: string;
  /** ISO time of the transfer as the buyer gives it */
  paidAt: string;
  cardLast4: string;
  amount: string;
}

/** The ERP orders list (`GET /api/storefront/orders`) */
export interface AdminOrderRow {
  id: number;
  number: string;
  createdAt: string;
  recipientName: string;
  phone: string;
  city: string;
  status: OrderStatus;
  payableAmount: string;
  hasPendingReceipt: boolean;
  payBefore: string | null;
}

export interface AdminOrderPage {
  data: AdminOrderRow[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminReceipt extends BuyerReceipt {
  id: number;
  reviewedBy: string;
  reviewedAt: string | null;
  treasuryTransactionId: number | null;
}

export interface AdminOrderDetail extends Omit<BuyerOrder, 'payment' | 'canSendReceipt' | 'receipts'> {
  id: number;
  version: number;
  customerId: number;
  documentId: number;
  documentRef: string;
  documentStatus: string;
  receipts: AdminReceipt[];
  updatedBy: string;
  /** what the screen may offer now */
  actions: { confirm: boolean; reject: boolean; cancel: boolean; fulfil: 'shipped' | 'delivered' | null };
}
