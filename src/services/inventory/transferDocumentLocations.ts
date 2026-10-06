import { and, eq, inArray, isNull } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { transactions, warehouses } from '../../db/schema.js';

/**
 * v9.0.67 (TD-489): انبار مبدأ و مقصد هر حواله انتقال از دو ردیف کاردکس همان سند (خروج = مبدأ، ورود = مقصد)؛ سند
 * ستون جدا برای آن‌ها ندارد. نام انبار از جدول انبارها، با کد به‌جای نام اگر انبار یافت نشود.
 */
export interface TransferDocumentLocations {
  sourceCode: string;
  sourceLocation: string;
  destinationCode: string;
  destinationLocation: string;
}

export async function transferLocationsByDocument(
  docIds: number[],
  executor: DbExecutor = orm,
): Promise<Map<number, TransferDocumentLocations>> {
  const result = new Map<number, TransferDocumentLocations>();
  if (docIds.length === 0) return result;
  const rows = await executor.select({
    documentId: transactions.documentId,
    type: transactions.type,
    code: transactions.location,
    name: warehouses.name,
  })
    .from(transactions)
    .leftJoin(warehouses, eq(warehouses.code, transactions.location))
    .where(and(
      inArray(transactions.documentId, docIds),
      eq(transactions.documentType, 'transfer'),
      eq(transactions.isDeleted, 0),
      isNull(transactions.reversalOfId),
    ));
  for (const row of rows) {
    if (row.documentId === null) continue;
    const entry = result.get(row.documentId) ?? { sourceCode: '', sourceLocation: '', destinationCode: '', destinationLocation: '' };
    const code = row.code ?? '';
    if (row.type === 'out') {
      entry.sourceCode = code;
      entry.sourceLocation = row.name || code;
    } else if (row.type === 'in') {
      entry.destinationCode = code;
      entry.destinationLocation = row.name || code;
    }
    result.set(row.documentId, entry);
  }
  return result;
}
