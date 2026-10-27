import { and, asc, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { cheques, documents, settlementAllocations, treasuryTransactions } from '../../db/schema.js';
import { fin, type FinancialDecimal } from '../../lib/financialDecimal.js';
import { LAPSED_CHEQUE_STATUSES, type SettlementAllocationView } from '../../lib/treasury/settlementAllocation.js';

/**
 * v11 phase 6.1t (M11 / U2, decision ت۵۲-۵): the live parts of receipts, payments and cheques that settle documents
 * (`settlement_allocations`). A part is live while it is not replaced and its source is live: the treasury row completed,
 * not deleted and not itself a reversal (its void makes it `voided`), the cheque not deleted and not bounced or returned.
 * A document's paid amount is its direct-linked treasury rows (`settledAmount`) plus these parts.
 */
export const liveAllocationCondition = and(
  eq(settlementAllocations.isDeleted, 0),
  or(
    and(
      eq(treasuryTransactions.isDeleted, 0),
      eq(treasuryTransactions.status, 'completed'),
      isNull(treasuryTransactions.reversalOfId),
    ),
    and(
      eq(cheques.isDeleted, 0),
      // a cheque without a status (imported rows) is live, as the window of its parts treats it (review of M11)
      or(isNull(cheques.status), notInArray(cheques.status, [...LAPSED_CHEQUE_STATUSES])),
    ),
  ),
);

/** The live parts on these documents, in the order they were made */
export async function fetchLiveAllocations(executor: DbExecutor, docIds: number[]): Promise<SettlementAllocationView[]> {
  if (docIds.length === 0) return [];
  const rows = await executor.select({
    id: settlementAllocations.id,
    documentId: settlementAllocations.documentId,
    refNumber: documents.refNumber,
    amount: settlementAllocations.amount,
    treasuryId: treasuryTransactions.id,
    transactionNumber: treasuryTransactions.transactionNumber,
    treasuryDate: treasuryTransactions.date,
    method: treasuryTransactions.method,
    chequeId: cheques.id,
    chequeNumber: cheques.chequeNumber,
    issueDate: cheques.issueDate,
    chequeStatus: cheques.status,
  })
    .from(settlementAllocations)
    .innerJoin(documents, eq(documents.id, settlementAllocations.documentId))
    .leftJoin(treasuryTransactions, eq(treasuryTransactions.id, settlementAllocations.treasuryTransactionId))
    .leftJoin(cheques, eq(cheques.id, settlementAllocations.chequeId))
    .where(and(inArray(settlementAllocations.documentId, docIds), liveAllocationCondition))
    .orderBy(asc(settlementAllocations.id));
  return rows.map(r => r.treasuryId !== null
    ? {
      id: r.id, documentId: r.documentId, refNumber: String(r.refNumber ?? r.documentId), amount: fin(r.amount).toNumber(),
      source: 'treasury' as const, sourceId: r.treasuryId, sourceNumber: r.transactionNumber ?? '',
      date: String(r.treasuryDate ?? '').slice(0, 10), status: r.method ?? '',
    }
    : {
      id: r.id, documentId: r.documentId, refNumber: String(r.refNumber ?? r.documentId), amount: fin(r.amount).toNumber(),
      source: 'cheque' as const, sourceId: Number(r.chequeId), sourceNumber: r.chequeNumber ?? '',
      date: String(r.issueDate ?? '').slice(0, 10), status: r.chequeStatus ?? '',
    });
}

/** The sum of the live parts of each document */
export function allocatedAmounts(rows: ReadonlyArray<Pick<SettlementAllocationView, 'documentId' | 'amount'>>): Map<number, FinancialDecimal> {
  const sums = new Map<number, FinancialDecimal>();
  for (const row of rows) sums.set(row.documentId, (sums.get(row.documentId) ?? fin(0)).add(row.amount));
  return sums;
}

/** The sum of the live parts of one document, read in the caller's transaction (the remaining check of a new settlement) */
export async function allocatedAmountOf(executor: DbExecutor, documentId: number): Promise<FinancialDecimal> {
  const [row] = await executor.select({ total: sql<string>`COALESCE(SUM(${settlementAllocations.amount}), 0)::text` })
    .from(settlementAllocations)
    .leftJoin(treasuryTransactions, eq(treasuryTransactions.id, settlementAllocations.treasuryTransactionId))
    .leftJoin(cheques, eq(cheques.id, settlementAllocations.chequeId))
    .where(and(eq(settlementAllocations.documentId, documentId), liveAllocationCondition));
  return fin(row?.total ?? 0);
}
