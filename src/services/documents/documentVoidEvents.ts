import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documentItems } from '../../db/schema.js';
import { domainEventBus } from '../events/domainEventBus.js';
import { DomainEventType, type InvoiceEventPayload } from '../events/domainEvents.js';
import { OutboxService } from '../events/outboxService.js';
import { documentEventAmounts } from './documentEventAmount.js';

/**
 * v10.0.36 (TD-931، P5-S-08، تصمیم ت۱۱ «بله»): ابطال فاکتور یا پیش‌فاکتور فروش رویداد `InvoiceVoided` را در outbox همان
 * تراکنش ابطال می‌نویسد، با مبلغ‌های سند پیش از ابطال (سطرها هنوز زنده‌اند) و نام ذخیره‌شده خریدار. پیش‌تر ابطال هیچ
 * رویدادی نمی‌نوشت، پس قانون یا وب‌هوکی که ثبت فاکتور را می‌شنید از ابطال آن بی‌خبر می‌ماند.
 */
export async function recordInvoiceVoided(
  tx: DbExecutor,
  doc: { id: number; type: string | null; status: string | null; refNumber: string | null; buyerName: string | null; currency: string | null },
  user: string,
): Promise<void> {
  if (doc.type !== 'invoice' && doc.type !== 'proforma') return;
  const lines = await tx.select({ id: documentItems.id }).from(documentItems)
    .where(and(eq(documentItems.documentId, doc.id), eq(documentItems.isDeleted, 0)));
  const event = domainEventBus.createEvent<InvoiceEventPayload>(
    DomainEventType.INVOICE_VOIDED,
    'Document',
    String(doc.id),
    {
      documentId: doc.id,
      refNumber: String(doc.refNumber ?? doc.id),
      docType: doc.type,
      ...await documentEventAmounts(tx, doc.id),
      buyerName: doc.buyerName || '',
      currency: doc.currency || 'IRR',
      itemCount: lines.length,
      status: doc.status || '',
    },
    { userName: user },
  );
  await OutboxService.saveToOutbox(tx, event);
}
