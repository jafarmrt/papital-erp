import type { DbExecutor, DbTransaction } from '../../db/drizzle.js';
import type { crmLeads } from '../../db/schema.js';

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

export async function markLinkedLeadSold(tx: DbTransaction, lead: Lead | null, invoice: { id: number; refNumber: string | null }, actorName: string): Promise<void> {
  if (!hooks || !lead) return;
  await hooks.markLeadSold(tx, lead, invoice, actorName);
}
