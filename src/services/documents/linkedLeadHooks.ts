import { and, asc, eq } from 'drizzle-orm';
import type { DbExecutor, DbTransaction } from '../../db/drizzle.js';
import { crmLeads } from '../../db/schema.js';
import { ConflictError } from '../../errors/customErrors.js';

type Lead = typeof crmLeads.$inferSelect;

/**
 * v11 phase 6.4 (C3): what finalizing a lead's proforma into an invoice does with the lead. The documents package does not
 * import the CRM package (package boundary, decision ت۳ الف of phase 2); the composition root (`registerWorkflowDomainActions`)
 * registers the CRM implementation, as it does for the procurement order (`linkedOrderHooks.ts`).
 */
export interface LinkedLeadHooks {
  /** the live lead whose proforma is this document, locked before the items and the document (the void's order) */
  lockLeadOfDocument(tx: DbExecutor, documentId: number): Promise<Lead | null>;
  /** the final invoice is the lead's sale: the lead moves to «فروش موفق» in the finalize transaction */
  markLeadSold(tx: DbTransaction, lead: Lead, invoice: { id: number; refNumber: string | null }, actorName: string): Promise<void>;
}

let hooks: LinkedLeadHooks | null = null;

export function registerLinkedLeadHooks(next: LinkedLeadHooks): void {
  hooks = next;
}

/** The lead of a sales document, locked; null for another type, a document no live lead links, or no registered hooks */
export async function lockLinkedLead(tx: DbExecutor, document: { id: number; type: string | null }): Promise<Lead | null> {
  if (!hooks || (document.type !== 'proforma' && document.type !== 'invoice')) return null;
  return hooks.lockLeadOfDocument(tx, document.id);
}

/**
 * Under the document lock: the lead that links the document now is the one locked before the items. An edit that moved the
 * proforma to another lead and committed while this finalize waited would leave that lead out (it was locked by nobody), so
 * the finalize is refused with a 409 to try again rather than lock a lead out of order (review of v11 phase 6.4).
 */
export async function assertLinkedLeadUnchanged(tx: DbExecutor, document: { id: number; type: string | null }, locked: Lead | null): Promise<void> {
  if (!hooks || (document.type !== 'proforma' && document.type !== 'invoice')) return;
  const [now] = await tx.select({ id: crmLeads.id }).from(crmLeads)
    .where(and(eq(crmLeads.proformaId, document.id), eq(crmLeads.hasProforma, 1), eq(crmLeads.isDeleted, 0)))
    .orderBy(asc(crmLeads.id))
    .limit(1);
  if ((now?.id ?? null) === (locked?.id ?? null)) return;
  throw new ConflictError('پیوند پرونده فروش این سند همین حالا عوض شد؛ دوباره قطعی کنید.', { documentId: document.id }, 'DOCUMENT_LEAD_LINK_CHANGED');
}

export async function markLinkedLeadSold(tx: DbTransaction, lead: Lead | null, invoice: { id: number; refNumber: string | null }, actorName: string): Promise<void> {
  if (!hooks || !lead) return;
  await hooks.markLeadSold(tx, lead, invoice, actorName);
}
