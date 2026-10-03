import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';

/**
 * v7.0.131 (TD-232): گزارش فقط‌خواندنی تقویم ستون‌های تاریخ متنی پیش از یکسان‌سازی.
 * برای هر ستون شمار ردیف‌های خالی، ISO میلادی (قالب نهایی)، میلادی با قالب دیگر، شمسی و نامعتبر را می‌دهد
 * (طبقه‌بندی با erp_text_date_kind، مهاجرت 0038) و چند نمونه از مقادیر نامعتبر را نشان می‌دهد. هیچ داده‌ای تغییر نمی‌کند.
 * ستون‌ها همان قاعده آزمون قید قالب تاریخ (P3-15) را دارند: ستون متنی با نام «date» یا reconciled_at / completed_at /
 * last_failed_login_at در جدول‌های اصلی.
 */
export interface DateColumnCalendarStats {
  table: string;
  column: string;
  /** قاعده قید قالب ستون: 'iso' تاریخ میلادی، 'isots' زمان میلادی سرور، 'any' شمسی یا میلادی (فقط تاریخ سند حسابداری)، null بی‌قید */
  rule: 'iso' | 'isots' | 'any' | null;
  /** قید معتبرشده است (همه ردیف‌های موجود هم قاعده را رعایت می‌کنند) */
  ruleValidated: boolean;
  total: number;
  empty: number;
  iso: number;
  gregorian: number;
  jalali: number;
  invalid: number;
  invalidSamples: string[];
}

export interface DateCalendarReport {
  generatedAt: string;
  columns: DateColumnCalendarStats[];
  totals: { iso: number; gregorian: number; jalali: number; invalid: number };
}

const rowsOf = <T>(res: unknown): T[] => (res as { rows: T[] }).rows;

export class DateCalendarReportService {
  static async listTextDateColumns(): Promise<Array<{ table: string; column: string }>> {
    const res = await orm.execute(sql`
      SELECT c.table_name AS "table", c.column_name AS "column"
        FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = current_schema() AND t.table_type = 'BASE TABLE' AND c.data_type = 'text'
         AND left(c.table_name, 1) <> '_'
         AND c.table_name NOT IN ('legacy_date_repairs')
         AND (c.column_name ~ '(^|_)date(_|$)' OR c.column_name IN ('reconciled_at', 'completed_at', 'last_failed_login_at'))
       ORDER BY 1, 2`);
    return rowsOf<{ table: string; column: string }>(res);
  }

  static async buildReport(): Promise<DateCalendarReport> {
    const columns: DateColumnCalendarStats[] = [];
    for (const { table, column } of await this.listTextDateColumns()) {
      const t = sql.identifier(table);
      const c = sql.identifier(column);
      const [stats] = rowsOf<Record<'total' | 'empty' | 'iso' | 'gregorian' | 'jalali' | 'invalid', number>>(await orm.execute(sql`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE k = 'empty')::int AS empty,
               count(*) FILTER (WHERE k = 'iso')::int AS iso,
               count(*) FILTER (WHERE k = 'gregorian')::int AS gregorian,
               count(*) FILTER (WHERE k = 'jalali')::int AS jalali,
               count(*) FILTER (WHERE k = 'invalid')::int AS invalid
          FROM (SELECT erp_text_date_kind(${c}) AS k FROM ${t}) x`));
      const samples = stats.invalid > 0
        ? rowsOf<{ v: string }>(await orm.execute(sql`
            SELECT DISTINCT ${c} AS v FROM ${t} WHERE erp_text_date_kind(${c}) = 'invalid' ORDER BY 1 LIMIT 5`)).map(r => r.v)
        : [];
      const [constraint] = rowsOf<{ def: string; validated: boolean }>(await orm.execute(sql`
        SELECT pg_get_constraintdef(pc.oid) AS def, pc.convalidated AS validated
          FROM pg_constraint pc JOIN pg_class rel ON rel.oid = pc.conrelid
         WHERE rel.relname = ${table} AND rel.relnamespace = current_schema()::regnamespace
           AND pc.conname = ${`chk_${table}_${column}_datefmt`}`));
      const ruleMatch = constraint?.def.match(/'(iso|isots|any)'/);
      const rule = (ruleMatch?.[1] ?? null) as DateColumnCalendarStats['rule'];
      columns.push({ table, column, rule, ruleValidated: !!constraint?.validated, ...stats, invalidSamples: samples });
    }
    const sum = (k: 'iso' | 'gregorian' | 'jalali' | 'invalid') => columns.reduce((acc, col) => acc + col[k], 0);
    return {
      generatedAt: new Date().toISOString(),
      columns,
      totals: { iso: sum('iso'), gregorian: sum('gregorian'), jalali: sum('jalali'), invalid: sum('invalid') },
    };
  }
}
