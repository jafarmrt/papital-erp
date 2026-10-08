import 'dotenv/config';
import { pool } from '../src/db/drizzle.js';
import { DateCalendarReportService } from '../src/services/system/dateCalendarReport.service.js';

/**
 * v7.0.131 (TD-232): گزارش فقط‌خواندنی تقویم ستون‌های تاریخ متنی (هیچ داده‌ای تغییر نمی‌کند).
 *   npm run dates:report            ← جدول خوانا
 *   npm run dates:report -- --json  ← خروجی JSON
 * در استقرار Docker همان گزارش با GET /api/system/date-calendar-report (مدیر سیستم) در دسترس است.
 */
async function main(): Promise<void> {
  const report = await DateCalendarReportService.buildReport();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log('🔎 Calendar report of text date columns (read-only)');
  console.log('   Final storage format: Gregorian ISO (YYYY-MM-DD); shown as Jalali everywhere\n');
  console.table(report.columns.map(c => ({
    'Column': `${c.table}.${c.column}`,
    'Rule': c.rule === 'iso' ? 'ISO' : c.rule === 'isots' ? 'Gregorian timestamp' : c.rule === 'any' ? 'Any' : '—',
    'Validated': c.ruleValidated ? '✓' : '✗',
    'Total': c.total,
    'Empty': c.empty,
    'ISO': c.iso,
    'Other Gregorian': c.gregorian,
    'Jalali': c.jalali,
    'Invalid': c.invalid,
  })));
  for (const c of report.columns.filter(col => col.invalidSamples.length > 0)) {
    console.log(`⚠️ ${c.table}.${c.column}: sample invalid values: ${c.invalidSamples.map(v => `"${v}"`).join(', ')}`);
  }
  const t = report.totals;
  console.log(`\nTotal: ISO ${t.iso}, Gregorian in another format ${t.gregorian}, Jalali ${t.jalali}, invalid ${t.invalid}`);
}

main()
  .catch((err) => {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
