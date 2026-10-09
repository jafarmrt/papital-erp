import type { DbExecutor } from '../../db/drizzle.js';
import { domainEventBus } from '../events/domainEventBus.js';
import { DomainEventType, type InvoiceEventPayload, type PurchaseEventPayload } from '../events/domainEvents.js';
import { OutboxService } from '../events/outboxService.js';
import { documentEventAmounts } from './documentEventAmount.js';

const PURCHASE_TYPES = new Set(['receipt', 'production_receipt', 'purchase']);

/**
 * رویداد نهایی‌سازی سند در outbox همان تراکنش: فاکتور و پیش‌فاکتور فروش `InvoiceApproved` و سند خرید `PurchaseApproved`،
 * هر دو با مبلغ قابل پرداخت سند نهایی‌شده (v9.0.407، TD-713) و شماره نهایی آن. از `finalizeDocument` جدا شد (v10.0.38) تا
 * پرونده چرخه سند در سقف اندازه بماند؛ رفتار همان است.
 */
export async function recordFinalizeEvent(tx: DbExecutor, doc: {
  id: number; type: string; refNumber: string | null; buyerName: string | null; currency: string | null; itemCount: number; user: string;
}): Promise<void> {
  const common = { documentId: doc.id, ...await documentEventAmounts(tx, doc.id), currency: doc.currency || 'IRR', itemCount: doc.itemCount, status: 'final' };
  if (doc.type === 'invoice' || doc.type === 'proforma') {
    await OutboxService.saveToOutbox(tx, domainEventBus.createEvent<InvoiceEventPayload>(
      DomainEventType.INVOICE_APPROVED, 'Document', String(doc.id),
      { ...common, refNumber: doc.refNumber ?? String(doc.id), docType: doc.type, buyerName: doc.buyerName || '' },
      { userName: doc.user },
    ));
  } else if (PURCHASE_TYPES.has(doc.type)) {
    await OutboxService.saveToOutbox(tx, domainEventBus.createEvent<PurchaseEventPayload>(
      DomainEventType.PURCHASE_APPROVED, 'Document', String(doc.id),
      { ...common, refNumber: doc.refNumber ?? String(doc.id), supplierName: doc.buyerName || '' },
      { userName: doc.user },
    ));
  }
}
