import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { fin, type FinancialDecimal } from '../../lib/financialDecimal.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { isoToJalaliDate, jalaliMonthStart } from '../../utils/calendarDate.js';
import { LEDGER_ROW_FILTER } from './stockMovementDate.js';

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

/**
 * گردش ورود و خروج دفتر کاردکس در شش ماه شمسی اخیر تا پایان ماه جاری. v9.0.94 (TD-492): تعریف دفتر کاردکس (AGENTS §۱۲)؛
 * ردیف ابطال‌شده و معکوس آن (`LEDGER_ROW_FILTER`) و انتقال بین انبارها (`documentType = 'transfer'` و نوع‌های قدیمی
 * `transfer_in` / `transfer_out`) شمرده نمی‌شوند، چون کالایی وارد یا خارج نشده است؛ ردیف تاریخ‌دار پس از ماه جاری هم بیرون
 * می‌ماند. پیش‌تر انتقال ۴ واحد ورود و خروج را هر کدام ۴ بالا می‌برد و انتقال تاریخ ۲۰۹۹ ماه «1477/10» را به نمودار می‌آورد.
 */
export async function getMonthlyMovementTrends(): Promise<MonthlyMovementTrend[]> {
  const today = await businessTodayIsoDate();
  const windowStart = jalaliMonthStart(today, MOVEMENT_TREND_MONTHS - 1);
  const windowEnd = jalaliMonthStart(today, -1);
  if (!windowStart || !windowEnd) return [];
  const result = await orm.execute(sql`
    SELECT to_char(t.date, 'YYYY-MM-DD') AS day, t.type AS type, SUM(t.quantity)::text AS total
    FROM transactions t
    WHERE ${LEDGER_ROW_FILTER}
      AND t.type IN ('in', 'out')
      AND COALESCE(t.document_type, '') <> 'transfer'
      AND t.date >= ${`${windowStart} 00:00:00`}::timestamp
      AND t.date < ${`${windowEnd} 00:00:00`}::timestamp
    GROUP BY 1, 2
    ORDER BY 1 ASC
  `);
  return bucketMovementsByJalaliMonth(result.rows as unknown as DailyMovementRow[]);
}
