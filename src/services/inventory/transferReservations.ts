import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documentItems, documents } from '../../db/schema.js';
import { RESERVING_DOCUMENT_STATUS, RESERVING_DOCUMENT_TYPES } from '../../lib/documents/reservingDocuments.js';
import { fin, type DecimalValue, type FinancialDecimal } from '../../lib/financialDecimal.js';
import { ConflictError } from '../../errors/customErrors.js';
import { formatPersianNumber } from '../../utils/persianNumber.js';
import { createWarehouseResolver } from './warehouseResolver.js';

const fa = (n: FinancialDecimal) => formatPersianNumber(n.toNumber(), 4);

/**
 * v11 phase 6.1j (S4): a transfer leaves the item's total stock as it is, so the sellable gate's total part (stock less
 * every reservation) cannot be broken by it. What it can break is a sales proforma whose line takes the item from the
 * source warehouse: it would be refused at finalize for lack of stock there. The transfer is refused (409
 * `TRANSFER_BREAKS_RESERVATION`) when the source keeps less than those lines reserve, naming them. A project reservation
 * has no warehouse (it is matched on the item), so it does not limit a transfer. Before, a transfer looked only at the
 * source warehouse's stock. The item is locked by the caller.
 */
export async function assertTransferKeepsReservations(tx: DbExecutor, params: {
  itemId: number;
  itemLabel: string;
  unit: string;
  from: { code: string; name: string };
  sourceStock: DecimalValue;
  quantity: DecimalValue;
}): Promise<void> {
  const lines = await tx
    .select({ documentId: documents.id, refNumber: documents.refNumber, quantity: documentItems.quantity, location: documentItems.location })
    .from(documentItems)
    .innerJoin(documents, eq(documentItems.documentId, documents.id))
    .where(and(
      eq(documentItems.itemId, params.itemId),
      eq(documentItems.isDeleted, 0),
      eq(documents.isDeleted, 0),
      inArray(documents.type, [...RESERVING_DOCUMENT_TYPES]),
      eq(documents.status, RESERVING_DOCUMENT_STATUS),
    ))
    .orderBy(asc(documents.id), asc(documentItems.id));
  if (lines.length === 0) return;

  const resolveWh = await createWarehouseResolver(tx);
  const holders = new Map<number, { ref: string; qty: FinancialDecimal }>();
  for (const line of lines) {
    const qty = fin((line.quantity ?? 0) as DecimalValue);
    if (!qty.isPositive() || resolveWh(line.location ?? '') !== params.from.code) continue;
    const prev = holders.get(line.documentId);
    holders.set(line.documentId, { ref: line.refNumber || `PRO-${line.documentId}`, qty: prev ? prev.qty.add(qty) : qty });
  }
  const reserved = Array.from(holders.values()).reduce((sum, h) => sum.add(h.qty), fin(0));
  const left = fin(params.sourceStock).subtract(fin(params.quantity));
  if (!left.lessThan(reserved)) return;

  const room = fin(params.sourceStock).subtract(reserved);
  const names = Array.from(holders.values(), h => `«${h.ref}» (${fa(h.qty)})`).join('، ');
  throw new ConflictError(
    `انتقال ${fa(fin(params.quantity))} ${params.unit} کالای ${params.itemLabel} از انبار «${params.from.name}» رزرو پیش‌فاکتورهای `
      + `فروشی را که از همین انبار برمی‌دارند می‌شکند: ${names}. موجودی انبار ${fa(fin(params.sourceStock))} و رزرو آن‌ها `
      + `${fa(reserved)} است؛ بیش از ${fa(room.isPositive() ? room : fin(0))} ${params.unit} منتقل نمی‌شود.`,
    {
      sourceStock: fin(params.sourceStock).toNumber(),
      reserved: reserved.toNumber(),
      holders: Array.from(holders, ([documentId, h]) => ({ documentId, refNumber: h.ref, quantity: h.qty.toNumber() })),
    },
    'TRANSFER_BREAKS_RESERVATION',
  );
}
