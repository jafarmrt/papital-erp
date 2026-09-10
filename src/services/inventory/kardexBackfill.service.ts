import { orm } from '../../db/drizzle.js';
import { items, transactions } from '../../db/schema.js';
import { and, eq, sql } from 'drizzle-orm';
import { fin } from '../../lib/financialDecimal.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { logger } from '../../middleware/logger.js';

export const KARDEX_BACKFILL_REF = 'موجودی اولیه (تطبیق سیستم)';

export interface KardexBackfillSummary {
  candidateItems: number;
  insertedRows: number;
  repairedRows: number;
  zeroWacItems: number;
}

export class KardexBackfillService {
  static async syncMissingInitialTransactions(): Promise<KardexBackfillSummary> {
    const candidates = await orm.execute(sql`
      SELECT i.id, i.current_stock, i.stocks, i.weighted_average_cost
      FROM ${items} i
      LEFT JOIN (
        SELECT item_id, SUM(quantity) as total_in
        FROM ${transactions}
        WHERE type = 'in' AND is_deleted = 0
        GROUP BY item_id
      ) t ON i.id = t.item_id
      WHERE i.is_deleted = 0 AND i.current_stock > 0 AND COALESCE(t.total_in, 0) = 0
    `);

    const candidateRows = Array.isArray(candidates?.rows) ? candidates.rows : [];
    const todayStr = await businessTodayIsoDate();
    let insertedRows = 0;
    let zeroWacItems = 0;
    let repairedRows = 0;

    await orm.transaction(async (tx) => {
      for (const row of candidateRows) {
        const itemId = Number(row.id);
        const totalStock = Number(row.current_stock || 0);
        const stocksObj = (row.stocks as Record<string, number>) || {};
        const wac = Number(row.weighted_average_cost || 0);

        const [lockedItem] = await tx
          .select({ id: items.id, weightedAverageCost: items.weightedAverageCost })
          .from(items)
          .where(and(eq(items.id, itemId), eq(items.isDeleted, 0)))
          .for('update');

        if (!lockedItem) continue;

        const [stillMissing] = await tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(and(eq(transactions.itemId, itemId), eq(transactions.type, 'in'), eq(transactions.isDeleted, 0)))
          .limit(1);

        if (stillMissing) continue;

        if (wac <= 0) {
          zeroWacItems++;
          logger.warn(`[Kardex Backfill] Item ${itemId} has stock but zero WAC — synthetic ledger rows will carry unitPrice=0`);
        }

        const effectiveWac = wac > 0 ? fin(wac).round(4).toNumber() : 0;

        if (Object.keys(stocksObj).length > 0) {
          for (const [whCode, qtyVal] of Object.entries(stocksObj)) {
            const qty = Number(qtyVal || 0);
            if (qty > 0) {
              await tx.insert(transactions).values({
                itemId,
                type: 'in',
                quantity: qty,
                unitPrice: effectiveWac,
                totalPrice: fin(effectiveWac).multiply(qty).round(4).toNumber(),
                date: todayStr,
                documentType: 'audit',
                documentRef: KARDEX_BACKFILL_REF,
                location: whCode,
                notes: 'ثبت موجودی اولیه جهت گردش کالا',
                createdBy: 'سیستم',
                isDeleted: 0
              });
              insertedRows++;
            }
          }
        } else if (totalStock > 0) {
          await tx.insert(transactions).values({
            itemId,
            type: 'in',
            quantity: totalStock,
            unitPrice: effectiveWac,
            totalPrice: fin(effectiveWac).multiply(totalStock).round(4).toNumber(),
            date: todayStr,
            documentType: 'audit',
            documentRef: KARDEX_BACKFILL_REF,
            location: 'main',
            notes: 'ثبت موجودی اولیه جهت گردش کالا',
            createdBy: 'سیستم',
            isDeleted: 0
          });
          insertedRows++;
        }
      }

      const poisoned = await tx
        .select({ id: transactions.id, quantity: transactions.quantity, wac: items.weightedAverageCost })
        .from(transactions)
        .innerJoin(items, eq(transactions.itemId, items.id))
        .where(and(
          eq(transactions.documentRef, KARDEX_BACKFILL_REF),
          eq(transactions.unitPrice, 0),
          eq(transactions.isDeleted, 0)
        ));

      for (const row of poisoned) {
        const wac = Number(row.wac || 0);
        if (wac > 0) {
          await tx
            .update(transactions)
            .set({
              unitPrice: fin(wac).round(4).toNumber(),
              totalPrice: fin(wac).multiply(Number(row.quantity) || 0).round(4).toNumber()
            })
            .where(eq(transactions.id, row.id));
          repairedRows++;
        }
      }
    });

    const summary: KardexBackfillSummary = {
      candidateItems: candidateRows.length,
      insertedRows,
      repairedRows,
      zeroWacItems
    };

    if (insertedRows > 0 || repairedRows > 0) {
      logger.info(`[Kardex Backfill] candidates=${summary.candidateItems} inserted=${insertedRows} repaired=${repairedRows} zeroWacItems=${zeroWacItems}`);
    }

    return summary;
  }
}
