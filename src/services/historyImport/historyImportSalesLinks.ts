/** v11 history import, tool 3: how a past sales invoice is tied to its Excel number and to the sales file it closed. */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { DbExecutor, DbTransaction } from '../../db/drizzle.js';
import { crmLeads, documents, historyImportRefs } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { isClosedLead } from '../../lib/crm/leadProformaRule.js';
import { toPersianDigits } from '../../utils.js';
import { markLeadWonByInvoice } from '../crm/crmLeadOutcome.js';
import { permissionHolderUserIdsWith } from '../notifications/notificationRecipients.js';

type Lead = typeof crmLeads.$inferSelect;

/** The kind of `history_import_refs` row a past sales invoice is recorded under. */
export const SALES_INVOICE_REF_KIND = 'sales_invoice';

/** The live document an Excel invoice number was recorded as, if any (locked, so two imports never both take a number). */
export async function documentOfExcelRef(tx: DbExecutor, excelRef: string): Promise<{ id: number; refNumber: string } | null> {
  const res = await tx.execute(sql`
    SELECT d.id, d.ref_number AS "refNumber"
      FROM history_import_refs r
      JOIN documents d ON d.id = r.document_id
     WHERE r.kind = ${SALES_INVOICE_REF_KIND} AND r.excel_ref = ${excelRef}
       AND d.is_deleted = 0 AND d.type = 'invoice' AND d.status = 'final'
       FOR UPDATE OF r`);
  const row = res.rows?.[0] as { id: number; refNumber: string } | undefined;
  return row ? { id: Number(row.id), refNumber: String(row.refNumber) } : null;
}

/** Records the Excel number of a past sales invoice; the row of a voided invoice with that number is taken over. */
export async function recordExcelRef(tx: DbExecutor, excelRef: string, documentId: number): Promise<void> {
  await tx.insert(historyImportRefs).values({ kind: SALES_INVOICE_REF_KIND, excelRef, documentId })
    .onConflictDoUpdate({ target: [historyImportRefs.kind, historyImportRefs.excelRef], set: { documentId, createdAt: sql`now()` } });
}

/**
 * «شماره پرونده» of the sales sheet (owner's decision 7 Aban 1405): the invoice closed that sales file, so it is linked to
 * it and the file moves to «فروش موفق», as when the file's proforma becomes a final invoice (the invoice takes the file's
 * proforma place, so voiding it releases the file the same way). Only by the number the user wrote, never by the customer's
 * name. The file is locked and checked before the invoice is written (the order the invoice form locks in). Refused: a file
 * that does not exist, without a customer or of another customer, closed («از دست رفته» left as it is, or already won) or
 * archived, or that already has a proforma or invoice (one invoice per file).
 */
export async function lockLeadForImportedInvoice(
  tx: DbExecutor,
  leadId: number,
  invoice: { customerId: number | null; excelRef: string },
): Promise<Lead> {
  const [lead] = await tx.select().from(crmLeads).where(and(eq(crmLeads.id, leadId), eq(crmLeads.isDeleted, 0))).for('update');
  const fa = toPersianDigits(String(leadId));
  const invoiceFa = toPersianDigits(invoice.excelRef);
  if (!lead) throw new ValidationError(`پرونده فروش شمارهٔ ${fa} (ستون «شماره پرونده» فاکتور ${invoiceFa}) در برنامه نیست.`, undefined, 'HISTORY_IMPORT_LEAD_NOT_FOUND');
  if (!lead.customerId) {
    throw new ValidationError(`پرونده فروش شمارهٔ ${fa} مشتری ندارد؛ اول مشتری پرونده را در «ارتباط با مشتری» تعیین کنید، یا «شماره پرونده» فاکتور ${invoiceFa} را خالی بگذارید.`, undefined, 'HISTORY_IMPORT_LEAD_OTHER_CUSTOMER');
  }
  if (lead.customerId !== invoice.customerId) {
    throw new ValidationError(`پرونده فروش شمارهٔ ${fa} مال مشتری دیگری است؛ «شماره پرونده» فاکتور ${invoiceFa} را درست کنید.`, undefined, 'HISTORY_IMPORT_LEAD_OTHER_CUSTOMER');
  }
  if (lead.stage === 'lost' || lead.status === 'lost') {
    throw new ValidationError(`پرونده فروش شمارهٔ ${fa} «از دست رفته» است و فاکتور ${invoiceFa} به آن وصل نمی‌شود؛ اگر این فروش همان پرونده است، اول پرونده را در «ارتباط با مشتری» باز کنید، وگرنه «شماره پرونده» را خالی بگذارید.`, undefined, 'HISTORY_IMPORT_LEAD_LOST');
  }
  if (isClosedLead(lead) || lead.status === 'archived') {
    throw new ValidationError(`پرونده فروش شمارهٔ ${fa} بسته یا بایگانی است و فاکتور ${invoiceFa} به آن وصل نمی‌شود؛ «شماره پرونده» را درست کنید یا خالی بگذارید.`, undefined, 'HISTORY_IMPORT_LEAD_CLOSED');
  }
  const [linked] = await tx.select({ id: documents.id }).from(documents)
    .where(and(eq(documents.crmLeadId, lead.id), eq(documents.isDeleted, 0), inArray(documents.type, ['invoice', 'proforma']), ne(documents.status, 'voided')))
    .limit(1);
  if ((Number(lead.hasProforma) === 1 && lead.proformaId) || linked) {
    throw new ValidationError(`پرونده فروش شمارهٔ ${fa} پیش‌فاکتور یا فاکتور دیگری دارد؛ هر پرونده فقط یک فاکتور می‌گیرد.`, undefined, 'HISTORY_IMPORT_LEAD_HAS_INVOICE');
  }
  return lead;
}

/** The imported invoice takes the locked file's proforma place and the file moves to «فروش موفق». */
export async function closeLeadWithImportedInvoice(tx: DbExecutor, lead: Lead, invoiceId: number, actor: { id: number | null; name: string }): Promise<void> {
  const [doc] = await tx.select({ refNumber: documents.refNumber }).from(documents).where(eq(documents.id, invoiceId));
  await tx.update(documents).set({ crmLeadId: lead.id }).where(eq(documents.id, invoiceId));
  await tx.update(crmLeads).set({ hasProforma: 1, proformaId: invoiceId }).where(eq(crmLeads.id, lead.id));
  await markLeadWonByInvoice(tx as DbTransaction, lead, { id: invoiceId, refNumber: doc?.refNumber ?? null },
    actor, permissionHolderUserIdsWith);
}
