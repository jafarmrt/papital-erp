import { sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import type { HealthCheckTestResult } from '../../types.js';
import { isoToJalaliDate } from '../../utils/calendarDate.js';
import { LEDGER_ROW_FILTER } from './stockMovementDate.js';

/**
 * v9.0.66 (TD-483، تصمیم ت۱ بسته ۶): گردش انبار با تاریخ پس از «امروز» کسب‌وکار ثبت نمی‌شود (`assertStockMovementDate`).
 * ردیف‌های آینده‌ای که پیش از این نسخه ثبت شده‌اند بازنویسی نمی‌شوند و فقط در بررسی سلامت مالی فهرست می‌شوند؛ تا آن
 * تاریخ، گردش امروز همان کالا با قاعده TD-257 («نه پیش از آخرین گردش») رد می‌شود.
 */
export interface FutureStockMovementRow {
  id: number;
  itemId: number;
  itemCode: string | null;
  itemName: string | null;
  type: string;
  quantity: string;
  day: string;
  documentType: string | null;
  documentRef: string | null;
  location: string | null;
}

export async function findFutureStockMovements(executor: DbExecutor = orm, today?: string): Promise<FutureStockMovementRow[]> {
  const day = today ?? await businessTodayIsoDate();
  const res = await executor.execute(sql`
    SELECT t.id, t.item_id AS "itemId", i.code AS "itemCode", i.name AS "itemName", t.type, t.quantity::text AS quantity,
           to_char(t.date, 'YYYY-MM-DD') AS day, t.document_type AS "documentType", t.document_ref AS "documentRef", t.location
      FROM transactions t
      LEFT JOIN items i ON i.id = t.item_id
     WHERE ${LEDGER_ROW_FILTER} AND t.date::date > ${day}::date
     ORDER BY t.date, t.id`);
  return (res.rows ?? []) as unknown as FutureStockMovementRow[];
}

export function buildFutureStockMovementHealthTest(rows: FutureStockMovementRow[]): HealthCheckTestResult {
  const itemCount = new Set(rows.map(r => r.itemId)).size;
  return {
    id: 'stock_future_movements',
    category: 'inventory',
    title: 'گردش انبار با تاریخ آینده',
    description: 'هیچ گردش کاردکسی نباید تاریخی پس از امروز داشته باشد؛ چنین ردیفی گردش امروز همان کالا را تا آن تاریخ می‌بندد',
    status: rows.length > 0 ? 'warning' : 'healthy',
    scoreImpact: -Math.min(10, itemCount * 2),
    count: rows.length,
    message: rows.length > 0
      ? `${rows.length} ردیف کاردکس از ${itemCount} کالا تاریخی پس از امروز دارد. این ردیف‌ها خودکار تغییر نمی‌کنند؛ سند آن‌ها را بررسی کنید.`
      : 'هیچ گردش انباری با تاریخ آینده ثبت نشده است.',
    items: rows.map(r => ({
      id: r.id,
      code: r.itemCode ?? `کالا #${r.itemId}`,
      title: r.itemName ?? `کالا #${r.itemId}`,
      subtitle: `${r.type === 'in' ? 'ورود' : 'خروج'} ${r.quantity} | انبار: ${r.location || '—'} | مرجع: ${r.documentRef || r.documentType || '—'}`,
      date: isoToJalaliDate(r.day),
      details: `ردیف کاردکس #${r.id} با تاریخ ${isoToJalaliDate(r.day)} (TD-483).`,
      linkType: 'item' as const,
      linkId: r.itemId,
    })),
    metrics: { futureRows: rows.length, futureItems: itemCount },
  };
}
