import { FinancialHealthService } from '../src/services/accounting/financialHealth.service.js';

async function testFinancialHealth() {
  console.log('--- شروع تست آزمون‌های ممیزی و بازرس سلامت مالی (Phase 5) ---');
  const start = Date.now();

  const report = await FinancialHealthService.runHealthCheck();
  const elapsed = Date.now() - start;

  console.log(`امتیاز کلی سلامت مالی: ${report.overallScore}٪`);
  console.log(`رتبه کیفی: ${report.healthGrade}`);
  console.log(`وضعیت کلی: ${report.healthStatus}`);
  console.log(`مدت زمان اسکن درونی: ${report.scanDurationMs}ms (کل تست: ${elapsed}ms)`);
  console.log(`تعداد آزمون‌های اجرا شده: ${report.tests.length}`);
  console.log(`آزمون‌های سالم: ${report.summary.healthyTestsCount}`);
  console.log(`آزمون‌های نیازمند بررسی: ${report.summary.warningTestsCount}`);
  console.log(`آزمون‌های دارای خطا: ${report.summary.errorTestsCount}`);

  // اعتبارسنجی‌ها
  if (typeof report.overallScore !== 'number' || report.overallScore < 0 || report.overallScore > 100) {
    throw new Error(`Invalid overallScore: ${report.overallScore}`);
  }

  if (report.tests.length < 5) {
    throw new Error(`Expected at least 5 tests, got ${report.tests.length}`);
  }

  const testIds = report.tests.map(t => t.id);
  const expectedTestIds = [
    'vouchers_balance',
    'unnatural_balances',
    'inventory_reconciliation',
    'commercial_docs_unlinked',
    'overdue_cheques',
    'bank_accounts_mapping'
  ];

  for (const expectedId of expectedTestIds) {
    if (!testIds.includes(expectedId)) {
      throw new Error(`Missing expected test: ${expectedId}`);
    }
  }

  for (const test of report.tests) {
    console.log(`  [${test.status.toUpperCase()}] ${test.title}: ${test.message}`);
    if (test.metrics) {
      console.log(`    Metrics:`, JSON.stringify(test.metrics));
    }
  }

  console.log('--- تمام تست‌های بازرس سلامت مالی با موفقیت تایید شدند ---');
}

testFinancialHealth()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
