import 'dotenv/config';
import { Phase21TestRunner } from '../src/tests/testRunner.js';
import { setupTestSchema } from '../src/tests/setup/testDb.js';

async function main() {
  const layerArg = process.argv[2] as any;
  const isolationEnabled = process.env.ERP_TEST_SCHEMA_ISOLATION === '1';

  // TST-003 companion: the dedicated CLI runner always runs in a test context,
  // so fixture cleanup is safe here (API-endpoint & production remain gated).
  // V10-0.1: cleanup itself is additionally hardened internally (hard gate +
  // synthetic-only patterns), so running against a shared dev database can
  // never destroy real business data anymore.
  if (process.env.ERP_ALLOW_TEST_CLEANUP !== '0') {
    process.env.ERP_ALLOW_TEST_CLEANUP = '1';
  }

  console.log('=====================================================');
  console.log(`Phase 8/21 Comprehensive Test Runner Executing${layerArg ? ` [Filter: ${layerArg}]` : ''}...`);
  try {
    const url = new URL(process.env.DATABASE_URL || '');
    console.log(`Target database : ${url.hostname}:${url.port || 5432}/${url.pathname.replace(/^\//, '')}`);
    if (isolationEnabled) {
      console.log('Schema isolation: ENABLED (ERP_TEST_SCHEMA_ISOLATION=1)');
    }
    console.log('Cleanup policy  : SYNTHETIC TEST ARTIFACTS ONLY (V10-0.1) — business data is preserved.');
  } catch {
    console.log('Target database : DATABASE_URL not parseable');
  }
  console.log('=====================================================\n');

  let teardown: (() => Promise<void>) | null = null;

  try {
    // TST-007: opt-in full schema isolation for the whole batch
    if (isolationEnabled) {
      const ctx = await setupTestSchema();
      teardown = ctx.teardown;
    }

    const report = await Phase21TestRunner.runAllTests(layerArg);

    console.log(`Duration: ${report.totalDurationMs} ms`);
    console.log(`Passed: ${report.passedCount} / ${report.totalTests}`);
    console.log(`Failed: ${report.failedCount}\n`);

    console.log('--- Layer Summaries ---');
    report.layerSummaries.forEach(ls => {
      console.log(`  [${ls.layer.toUpperCase()}] ${ls.label}: ${ls.passed}/${ls.total} Passed (${ls.durationMs}ms)`);
    });

    console.log('\n--- Critical Scenarios Audit ---');
    report.scenarioSummaries.forEach(sc => {
      const icon = sc.passed ? '[PASS]' : '[FAIL]';
      console.log(`  ${icon} ${sc.title}: ${sc.details}`);
    });

    if (report.overallStatus === 'passed') {
      console.log('\nALL PHASE 8/21 TEST SUITES PASSED!');
      process.exitCode = 0;
    } else {
      console.error('\nTEST SUITE FAILURES DETECTED!');
      report.testCases.filter(c => !c.passed).forEach(c => {
        console.error(`  x [${c.layer}] ${c.name}: ${c.error}`);
      });
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('Fatal test execution error:', err);
    process.exitCode = 1;
  } finally {
    if (teardown) {
      await teardown();
    }
  }

  process.exit(process.exitCode ?? 0);
}

main();
