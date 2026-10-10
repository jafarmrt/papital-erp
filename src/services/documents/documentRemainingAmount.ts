import { and, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documents, treasuryTransactions } from '../../db/schema.js';
import { fin, type FinancialDecimal } from '../../lib/financialDecimal.js';
import { documentEventAmounts } from './documentEventAmount.js';
import { settledAmount } from './documentSettlement.js';

/** Purchase documents are settled by payments, every other linked document by receipts (`PAYMENT_DOCUMENT_TYPES` of treasury links). */
const PURCHASE_SETTLED_TYPES: readonly string[] = ['purchase', 'receipt'];

/**
 * v10.0.59 (TD-938): the payable amount of a document (`documentEventAmounts`, in its own currency) and the sum of its
 * settlements (`settledAmount`, the sum the document page shows), read in the caller's transaction. Treasury reads it through
 * `registerDocumentRemainingReader`, wired by the composition root, so the treasury core imports no document package.
 */
export async function readDocumentPayableAndSettled(
  tx: DbExecutor,
  documentId: number,
): Promise<{ refNumber: string | null; payable: FinancialDecimal; settled: FinancialDecimal } | null> {
  const [doc] = await tx.select({ type: documents.type, refNumber: documents.refNumber })
    .from(documents).where(eq(documents.id, documentId));
  if (!doc) return null;
  const payable = fin((await documentEventAmounts(tx, documentId)).totalAmount);
  const rows = await tx.select({
    id: treasuryTransactions.id, documentId: treasuryTransactions.documentId, amount: treasuryTransactions.amount,
    type: treasuryTransactions.type, status: treasuryTransactions.status, reversalOfId: treasuryTransactions.reversalOfId,
  }).from(treasuryTransactions)
    .where(and(
      eq(treasuryTransactions.documentId, documentId),
      eq(treasuryTransactions.isDeleted, 0),
      inArray(treasuryTransactions.status, ['completed', 'voided']),
    ));
  return { refNumber: doc.refNumber, payable, settled: settledAmount(rows, PURCHASE_SETTLED_TYPES.includes(doc.type)) };
}
