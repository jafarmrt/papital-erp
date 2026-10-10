import { orm } from '../../db/drizzle.js';
import { items, transactions } from '../../db/schema.js';
import { and, eq, sql } from 'drizzle-orm';
import { fin, type DecimalValue } from '../../lib/financialDecimal.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { logger } from '../../middleware/logger.js';
import { withAdvisoryLock, ADVISORY_LOCK_KEYS } from '../../lib/advisoryLock.js';
import { ItemWarehouseStockService } from './itemWarehouseStock.service.js';
import { lockStockItems } from './stockItemLocks.js';
import { money } from '../../lib/money.js';

export const KARDEX_BACKFILL_REF = 'موجودی اولیه (تطبیق سیستم)';

export interface KardexBackfillSummary {
  candidateItems: number;
  insertedRows: number;
  zeroWacItems: number;
}

export class KardexBackfillService {
  /**
   * v7.0.31 (TD-193 / audit P1-8): اجرای دستی (به‌جای هر بوت هر Pod) با قفل مشورتی تا در کل خوشه فقط یک
   * اجرا فعال باشد. `locked: true` یعنی اجرای دیگری در جریان است و کاری انجام نشد.
   */
  static async runExclusive(): Promise<{ locked: true } | ({ locked: false } & KardexBackfillSummary)> {
    const outcome = await withAdvisoryLock(ADVISORY_LOCK_KEYS.KARDEX_INITIAL_BACKFILL, () => this.syncMissingInitialTransactions());
    if (!outcome.acquired) return { locked: true };
    return { locked: false, ...outcome.result };
  }

  static async syncMissingInitialTransactions(): Promise<KardexBackfillSummary> {
    const candidates = await orm.execute(sql`
      SELECT i.id, i.current_stock, i.weighted_average_cost
      FROM ${items} i
      LEFT JOIN (
        SELECT item_id, SUM(quantity) as total_in
        FROM ${transactions}
        WHERE type = 'in' AND is_deleted = 0
        GROUP BY item_id
      ) t ON i.id = t.item_id
      WHERE i.is_deleted = 0 AND i.current_stock > 0 AND COALESCE(t.total_in, 0) = 0
      ORDER BY i.id
    `);

    const candidateRows = Array.isArray(candidates?.rows) ? candidates.rows : [];
    const todayStr = await businessTodayIsoDate();
    let insertedRows = 0;
    let zeroWacItems = 0;

    await orm.transaction(async (tx) => {
      // v10.0.157 (OBS-R1-80): همه کالاها یک‌جا، به ترتیب شناسه و با `FOR NO KEY UPDATE` (TD-320)، همان قفل مسیرهای سند؛
      // پیش‌تر هر کالا جدا با `FOR UPDATE` و به ترتیب دلخواه پرس‌وجو قفل می‌شد و با ثبت هم‌زمان سند بن‌بست می‌ساخت
      await lockStockItems(tx, candidateRows.map(row => Number(row.id)));
      for (const row of candidateRows) {
        const itemId = Number(row.id);
        const wacRaw = (row.weighted_average_cost ?? 0) as DecimalValue;
        const wac = Number(wacRaw);

        const [lockedItem] = await tx
          .select({ id: items.id, weightedAverageCost: items.weightedAverageCost })
          .from(items)
          .where(and(eq(items.id, itemId), eq(items.isDeleted, 0)));

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

        const effectiveWac = wac > 0 ? fin(wacRaw).round(4) : fin(0);

        // v7.0.48 (TD-214): موجودی هر انبار از جدول نرمال (ستون JSONB حذف شد)؛ چون current_stock مجموع همین جدول است،
        // کالای دارای موجودی همیشه ردیف جدول دارد و محل کاردکس همان کد استاندارد انبار ردیف است.
        const tableStock = await ItemWarehouseStockService.getStockSnapshot(tx, itemId);
        for (const [whCode, qtyVal] of Object.entries(tableStock.byCode)) {
          const qty = Number(qtyVal || 0);
          if (qty > 0) {
            await tx.insert(transactions).values({
              itemId,
              type: 'in',
              quantity: qty,
              unitPrice: money(effectiveWac),
              totalPrice: money(effectiveWac.multiply(qty).round(4)),
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
      }
      // v9.0.92 (TD-488، تصمیم ت۳): ردیف کاردکس تغییرناپذیر است. پیش‌تر ردیف‌های پیشین همین ابزار با بهای ۰ در هر اجرا
      // با WAC روز بازقیمت‌گذاری می‌شدند و بازپخش کاردکس دیگر به WAC زنده نمی‌رسید (I13). اختلاف بها از «اصلاح بهای
      // میانگین» (TD-487) با سند پیش‌نویس می‌رود.
    });

    const summary: KardexBackfillSummary = {
      candidateItems: candidateRows.length,
      insertedRows,
      zeroWacItems
    };

    if (insertedRows > 0) {
      logger.info(`[Kardex Backfill] candidates=${summary.candidateItems} inserted=${insertedRows} zeroWacItems=${zeroWacItems}`);
    }

    return summary;
  }
}
