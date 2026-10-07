import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { LEDGER_ROW_FILTER } from './stockMovementDate.js';

/**
 * v9.0.279 (TD-671، B16-07): شاخص‌های پیشخوان انبار روی دفتر کاردکس (AGENTS §12). ردیف ابطال‌شده و معکوس آن
 * (`LEDGER_ROW_FILTER`) و انتقال بین انبارها (`document_type = 'transfer'`) مصرف نیستند؛ «سند» یک سند است، نه یک ردیف کاردکس؛
 * و «N روز اخیر» امروزِ ساعت توافقی (`businessTodayIsoDate`) و N − ۱ روز پیش از آن است، نه `current_date` نشست UTC.
 * پیش‌تر رسید ۱۰۰ واحدیِ ابطال‌شده با ردیف معکوسش نفر اول «تند گردش» می‌شد و سه سند با پنج ردیف «۵ سند» شمرده می‌شد.
 */

/** نخستین روز (ISO) بازه `days` روزه‌ای که به `today` ختم می‌شود */
export function movementWindowStart(today: string, days: number): string {
  const [y, m, d] = today.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d - (Math.max(1, Math.floor(days)) - 1)));
  return start.toISOString().slice(0, 10);
}

const fromDay = (day: string) => sql`${`${day} 00:00:00`}::timestamp`;

/** ردیف دفتر کاردکسِ گردش واقعی کالا: فعال، نه معکوسِ ردیف ابطال‌شده، نه انتقال بین انبارها */
const MOVEMENT_ROW = sql`${LEDGER_ROW_FILTER} AND COALESCE(t.document_type, '') <> 'transfer'`;

/** شمار سندهای (و ردیف‌های قدیمیِ بی سند) کاردکس در `days` روز اخیر */
export async function recentDocumentCount(days = 7, today?: string): Promise<number> {
  const start = movementWindowStart(today ?? await businessTodayIsoDate(), days);
  const result = await orm.execute(sql`
    SELECT COUNT(DISTINCT COALESCE('d' || t.document_id::text, 't' || t.id::text))::int AS count
    FROM transactions t
    WHERE ${LEDGER_ROW_FILTER} AND t.date >= ${fromDay(start)}
  `);
  return Number((result.rows[0] as { count?: number } | undefined)?.count ?? 0);
}

export interface DashboardMovementRows {
  fastMoving: Record<string, unknown>[];
  slowMoving: Record<string, unknown>[];
  deadStock: Record<string, unknown>[];
}

/** تند گردش، کند گردش و راکد از خروج‌های واقعی دفتر کاردکس */
export async function dashboardMovementRows(
  days: { fastDays: number; slowDays: number; deadDays: number },
  today?: string,
): Promise<DashboardMovementRows> {
  const day = today ?? await businessTodayIsoDate();
  const fastStart = fromDay(movementWindowStart(day, days.fastDays));
  const slowStart = fromDay(movementWindowStart(day, days.slowDays));
  const deadStart = fromDay(movementWindowStart(day, days.deadDays));

  const fastMoving = await orm.execute(sql`
    SELECT i.id, i.name, i.code, i.unit, SUM(t.quantity) AS total_qty, i.current_stock
    FROM transactions t
    JOIN items i ON t.item_id = i.id
    WHERE t.type = 'out' AND ${MOVEMENT_ROW} AND i.is_deleted = 0 AND t.date >= ${fastStart}
    GROUP BY i.id, i.name, i.code, i.unit, i.current_stock
    ORDER BY total_qty DESC, i.id ASC
    LIMIT 5
  `);

  const slowMoving = await orm.execute(sql`
    SELECT i.id, i.name, i.code, i.current_stock, i.unit, i.weighted_average_cost
    FROM items i
    WHERE i.is_deleted = 0 AND i.current_stock > 0
      AND EXISTS (SELECT 1 FROM transactions t WHERE t.item_id = i.id AND t.type = 'out' AND ${MOVEMENT_ROW} AND t.date >= ${deadStart})
      AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.item_id = i.id AND t.type = 'out' AND ${MOVEMENT_ROW} AND t.date >= ${slowStart})
    ORDER BY i.current_stock DESC, i.id ASC
    LIMIT 5
  `);

  const deadStock = await orm.execute(sql`
    SELECT i.id, i.name, i.code, i.current_stock, i.unit, i.weighted_average_cost
    FROM items i
    WHERE i.is_deleted = 0 AND i.current_stock > 0
      AND EXISTS (SELECT 1 FROM transactions t WHERE t.item_id = i.id AND t.type = 'in' AND ${MOVEMENT_ROW} AND t.date < ${deadStart})
      AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.item_id = i.id AND t.type = 'out' AND ${MOVEMENT_ROW} AND t.date >= ${deadStart})
    ORDER BY i.current_stock DESC, i.id ASC
    LIMIT 5
  `);

  return {
    fastMoving: fastMoving.rows as Record<string, unknown>[],
    slowMoving: slowMoving.rows as Record<string, unknown>[],
    deadStock: deadStock.rows as Record<string, unknown>[],
  };
}
