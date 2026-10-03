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
  console.log('🔎 گزارش تقویم ستون‌های تاریخ متنی (فقط خواندنی)');
  console.log('   قالب نهایی ذخیره: میلادی ISO (YYYY-MM-DD)؛ نمایش همه‌جا شمسی\n');
  console.table(report.columns.map(c => ({
    'ستون': `${c.table}.${c.column}`,
    'یکسان‌شده': c.isoOnly ? '✓' : '',
    'کل': c.total,
    'خالی': c.empty,
    'ISO': c.iso,
    'میلادی دیگر': c.gregorian,
    'شمسی': c.jalali,
    'نامعتبر': c.invalid,
  })));
  for (const c of report.columns.filter(col => col.invalidSamples.length > 0)) {
    console.log(`⚠️ ${c.table}.${c.column} — نمونه مقادیر نامعتبر: ${c.invalidSamples.map(v => `«${v}»`).join('، ')}`);
  }
  const t = report.totals;
  console.log(`\nجمع: ISO ${t.iso} — میلادی با قالب دیگر ${t.gregorian} — شمسی ${t.jalali} — نامعتبر ${t.invalid}`);
}

main()
  .catch((err) => {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
