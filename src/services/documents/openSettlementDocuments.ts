import { and, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { cheques, customers, settlementAllocations, treasuryTransactions } from '../../db/schema.js';
import { NotFoundError } from '../../errors/customErrors.js';
import { fin } from '../../lib/financialDecimal.js';
import { SETTLEABLE_DOCUMENT_STATUSES, type OpenSettlementDocument } from '../../lib/treasury/settlementAllocation.js';
import { DocumentQueryService } from './documentQuery.service.js';
import type { FormattedDocument } from './types.js';

/**
 * v11 phase 6.1t (M11 / U2, decision ت۵۲-۵): the documents a receipt, payment or cheque can settle, oldest first (day,
 * then id), with what is left on each by the rule of the document list (`remainingAmount`: payable less settlements and
 * final returns). The rule of a direct link: a receipt settles the customer's sales invoices and proformas, a payment the
 * supplier's purchase documents, of the same currency; the party by id, and a legacy document without one by its exact
 * name; a draft is left out (`SETTLEABLE_DOCUMENT_STATUSES`). Only reading: the server checks everything again under its
 * locks when the parts are written.
 *
 * With a source (the window of a recorded receipt or cheque) the party, side and currency are the source's own, and a
 * document it already settles stays in the list with that amount (`allocatedHere`), also when its remaining is zero.
 */

export const RECEIPT_SETTLED_TYPES = ['invoice', 'proforma'];
export const PAYMENT_SETTLED_TYPES = ['purchase', 'receipt'];
const OPEN_DOCUMENTS_LIMIT = 200;

export interface OpenDocumentsQuery {
  direction: 'receipt' | 'payment';
  partyType: string;
  partyId: number | null;
  partyName: string;
  currency: string;
}

async function sourceQuery(source: { treasuryId: number } | { chequeId: number }): Promise<{ query: OpenDocumentsQuery; here: Map<number, number> }> {
  const here = new Map<number, number>();
  if ('treasuryId' in source) {
    const [row] = await orm.select().from(treasuryTransactions)
      .where(and(eq(treasuryTransactions.id, source.treasuryId), eq(treasuryTransactions.isDeleted, 0)));
    if (!row) throw new NotFoundError('تراکنش خزانه یافت نشد');
    if (row.documentId) here.set(row.documentId, fin(row.amount).toNumber());
    const parts = await orm.select({ documentId: settlementAllocations.documentId, amount: settlementAllocations.amount })
      .from(settlementAllocations)
      .where(and(eq(settlementAllocations.treasuryTransactionId, row.id), eq(settlementAllocations.isDeleted, 0)));
    for (const p of parts) here.set(p.documentId, fin(p.amount).toNumber());
    return {
      query: {
        direction: row.type === 'payment' ? 'payment' : 'receipt',
        partyType: row.partyType || 'other', partyId: row.partyId ?? null, partyName: row.partyName, currency: row.currency || 'IRR',
      },
      here,
    };
  }
  const [cheque] = await orm.select().from(cheques).where(and(eq(cheques.id, source.chequeId), eq(cheques.isDeleted, 0)));
  if (!cheque) throw new NotFoundError('چک یافت نشد');
  const parts = await orm.select({ documentId: settlementAllocations.documentId, amount: settlementAllocations.amount })
    .from(settlementAllocations)
    .where(and(eq(settlementAllocations.chequeId, cheque.id), eq(settlementAllocations.isDeleted, 0)));
  for (const p of parts) here.set(p.documentId, fin(p.amount).toNumber());
  return {
    query: {
      direction: cheque.type === 'paid' ? 'payment' : 'receipt',
      partyType: cheque.partyType || (cheque.type === 'paid' ? 'supplier' : 'customer'),
      partyId: cheque.partyId ?? null, partyName: cheque.partyName, currency: cheque.currency || 'IRR',
    },
    here,
  };
}

export async function listOpenSettlementDocuments(
  input: OpenDocumentsQuery | { source: { treasuryId: number } | { chequeId: number } },
): Promise<OpenSettlementDocument[]> {
  const { query, here } = 'source' in input ? await sourceQuery(input.source) : { query: input, here: new Map<number, number>() };
  if (query.partyType !== (query.direction === 'receipt' ? 'customer' : 'supplier')) return [];
  let legacyName = query.partyName.trim();
  if (query.partyId) {
    const [party] = await orm.select({ name: customers.name }).from(customers).where(eq(customers.id, query.partyId));
    if (party) legacyName = party.name.trim();
  }
  if (!query.partyId && !legacyName) return [];
  const found = await DocumentQueryService.getDocuments({
    types: query.direction === 'receipt' ? RECEIPT_SETTLED_TYPES : PAYMENT_SETTLED_TYPES,
    ...(query.partyId ? { party: { id: query.partyId, legacyName } } : { buyerName: legacyName }),
    isExport: true,
  });
  const docs: FormattedDocument[] = Array.isArray(found) ? found : found.data;
  const currency = (query.currency || 'IRR').trim().toUpperCase();
  return docs
    .filter(d => ((d.currency || 'IRR').trim().toUpperCase()) === currency)
    .map(d => ({
      id: d.id,
      refNumber: String(d.refNumber ?? d.id),
      type: d.type,
      status: d.status ?? '',
      date: d.date ? String(d.date).slice(0, 10) : '',
      currency,
      payable: Number(d.payableAmount) || 0,
      settled: Number(d.paidAmount) || 0,
      remaining: Number(d.remainingAmount) || 0,
      allocatedHere: here.get(d.id) ?? 0,
    }))
    .filter(d => (d.remaining > 0 && SETTLEABLE_DOCUMENT_STATUSES.includes(d.status)) || d.allocatedHere > 0)
    .sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1))
    // the oldest open documents up to the limit, and every document this source already settles
    .filter((d, i) => i < OPEN_DOCUMENTS_LIMIT || d.allocatedHere > 0);
}
