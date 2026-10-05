import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { transactions } from '../../db/schema.js';
import { fin, type FinancialDecimal } from '../../lib/financialDecimal.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { isoToJalaliDate, jalaliMonthStart } from '../../utils/calendarDate.js';

/**
 * v8.0.54 (TD-316): نمودار «گردش کالا» به ماه شمسی، مانند روند ماهانه خزانه (AGENTS.md §1.10). پیش‌تر API ماه
 * میلادی می‌داد و مرورگر روز اول آن را به نام ماه شمسی تبدیل می‌کرد، پس گردش ۱ تا ۱۱ فروردین زیر اسفند می‌آمد.
 * بازه، ماه شمسیِ امروز (ساعت توافقی) و پنج ماه پیش از آن است.
 */

export const MOVEMENT_TREND_MONTHS = 6;

export interface MonthlyMovementTrend {
  /** ماه شمسی `YYYY/MM` */
  month: string;
  type: 'in' | 'out';
  total: number;
}

export interface DailyMovementRow {
  day: string;
  type: string;
  total: string | number | null;
}

/** جمع روزانه گردش ← جمع هر ماه شمسی و نوع، به ترتیب ماه */
export function bucketMovementsByJalaliMonth(rows: DailyMovementRow[]): MonthlyMovementTrend[] {
  const totals = new Map<string, FinancialDecimal>();
  for (const row of rows) {
    const month = isoToJalaliDate(row.day).slice(0, 7);
    if (!month) continue;
    const key = `${month}|${row.type === 'in' ? 'in' : 'out'}`;
    totals.set(key, (totals.get(key) ?? fin(0)).add(row.total ?? 0));
  }
  return Array.from(totals.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, total]) => {
      const [month, type] = key.split('|');
      return { month, type: type === 'in' ? 'in' : 'out', total: total.round(4).toNumber() };
    });
}

/** گردش ورود و خروج کاردکس (ردیف‌های فعال) در شش ماه شمسی اخیر */
export async function getMonthlyMovementTrends(): Promise<MonthlyMovementTrend[]> {
  const windowStart = jalaliMonthStart(await businessTodayIsoDate(), MOVEMENT_TREND_MONTHS - 1);
  if (!windowStart) return [];
  const result = await orm.execute(sql`
    SELECT to_char(${transactions.date}, 'YYYY-MM-DD') AS day, ${transactions.type} AS type, SUM(${transactions.quantity})::text AS total
    FROM ${transactions}
    WHERE ${transactions.isDeleted} = 0 AND ${transactions.date} >= ${`${windowStart} 00:00:00`}::timestamp
    GROUP BY 1, 2
    ORDER BY 1 ASC
  `);
  return bucketMovementsByJalaliMonth(result.rows as unknown as DailyMovementRow[]);
}
