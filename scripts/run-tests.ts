import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { Phase21TestRunner } from '../src/tests/testRunner.js';
import { setupTestSchema } from '../src/tests/setup/testDb.js';

async function main() {
  const rawArgs = process.argv.slice(2);
  
  // Parse CLI flags and arguments
  let layerArg: any = undefined;
  let isJsonOutput = false;
  let isSummaryOnly = false;
  let reportFilePath: string | null = null;
  let isVerbose = false;

  for (const arg of rawArgs) {
    if (arg === '--json') {
      isJsonOutput = true;
    } else if (arg === '--summary') {
      isSummaryOnly = true;
    } else if (arg === '--verbose' || arg === '-v') {
      isVerbose = true;
    } else if (arg.startsWith('--report-file=')) {
      reportFilePath = arg.replace('--report-file=', '').trim();
    } else if (arg.startsWith('--layer=')) {
      layerArg = arg.replace('--layer=', '').trim();
    } else if (!arg.startsWith('-') && !layerArg) {
      layerArg = arg.trim();
    }
  }

  const isolationEnabled = process.env.ERP_TEST_SCHEMA_ISOLATION === '1';

  // TST-003 companion: the dedicated CLI runner always runs in a test context,
  // so fixture cleanup is safe here (API-endpoint & production remain gated).
  if (process.env.ERP_ALLOW_TEST_CLEANUP !== '0') {
    process.env.ERP_ALLOW_TEST_CLEANUP = '1';
  }

  if (!isJsonOutput) {
    console.log('======================================================================');
    console.log(`🚀 Papital ERP Test Runner Matrix (Phase 8/21 Suite Engine)`);
    console.log(`   Scope Filter : ${layerArg ? `[Layer: ${layerArg}]` : 'ALL (Full 21 Suites Matrix)'}`);
    try {
      const url = new URL(process.env.DATABASE_URL || '');
      console.log(`   Target DB    : postgresql://${url.hostname}:${url.port || 5432}/${url.pathname.replace(/^\//, '')}`);
    } catch {
      console.log(`   Target DB    : [DATABASE_URL not parseable or missing]`);
    }
    console.log(`   Isolation    : ${isolationEnabled ? 'ENABLED (ERP_TEST_SCHEMA_ISOLATION=1)' : 'DISABLED'}`);
    console.log(`   Cleanup Mode : SYNTHETIC TEST ARTIFACTS ONLY (Safe dev preservation)`);
    console.log('======================================================================\n');
  }

  let teardown: (() => Promise<void>) | null = null;

  try {
    if (isolationEnabled) {
      const ctx = await setupTestSchema();
      teardown = ctx.teardown;
    }

    const report = await Phase21TestRunner.runAllTests(layerArg);

    // Compute key quality metrics
    const totalCases = report.totalTests;
    const passPercentage = totalCases > 0 ? ((report.passedCount / totalCases) * 100).toFixed(1) : '0.0';
    const realCodeCases = report.testCases.filter(c => c.executionType === 'real_code').length;
    const realCodePercentage = totalCases > 0 ? ((realCodeCases / totalCases) * 100).toFixed(1) : '0.0';
    const avgDuration = totalCases > 0 ? (report.totalDurationMs / totalCases).toFixed(2) : '0.00';

    if (isJsonOutput) {
      const jsonReport = {
        ...report,
        metrics: {
          passPercentage: Number(passPercentage),
          realCodePercentage: Number(realCodePercentage),
          realCodeCases,
          averageCaseDurationMs: Number(avgDuration),
          executedAt: new Date().toISOString()
        }
      };
      console.log(JSON.stringify(jsonReport, null, 2));
    } else {
      console.log('📊 --- Suite Execution Metrics & Layer Coverage ---');
      console.log(`  ⏱️  Total Duration  : ${report.totalDurationMs} ms (Avg: ${avgDuration} ms/test)`);
      console.log(`  ✅ Passed Tests    : ${report.passedCount} / ${totalCases} (${passPercentage}%)`);
      console.log(`  ❌ Failed Tests    : ${report.failedCount}`);
      console.log(`  🛡️  Real Code Ratio : ${realCodeCases} / ${totalCases} (${realCodePercentage}% real execution)`);
      console.log(`  🚦 Overall Status  : ${report.overallStatus.toUpperCase()}\n`);

      console.log('📑 --- Layer Breakdown ---');
      report.layerSummaries.forEach(ls => {
        const layerPct = ls.total > 0 ? ((ls.passed / ls.total) * 100).toFixed(0) : '0';
        const badge = ls.failed > 0 ? '❌ FAIL' : '✅ PASS';
        console.log(`  ${badge} [${ls.layer.toUpperCase().padEnd(14)}] ${ls.label.padEnd(35)} : ${ls.passed}/${ls.total} (${layerPct}%) in ${ls.durationMs}ms`);
      });

      if (!isSummaryOnly) {
        console.log('\n🎯 --- Critical Path & Security Scenarios ---');
        report.scenarioSummaries.forEach(sc => {
          const icon = sc.passed ? '✅ [PASS]' : '❌ [FAIL]';
          const typeTag = sc.executionType === 'real_code' ? '[REAL-CODE]' : '[SIMULATION]';
          console.log(`  ${icon} ${typeTag} ${sc.title}`);
          if (isVerbose || !sc.passed) {
            console.log(`     └─ Details: ${sc.details}`);
          }
        });
      }

      if (report.overallStatus === 'passed') {
        console.log('\n✨ ALL PHASE 8/21 TEST SUITES PASSED SUCCESSFULLY!');
        process.exitCode = 0;
      } else {
        console.error('\n🚨 TEST SUITE FAILURES DETECTED:');
        report.testCases.filter(c => !c.passed).forEach(c => {
          console.error(`  ❌ [${c.layer}] ${c.name}: ${c.error || c.details}`);
        });
        process.exitCode = 1;
      }
    }

    // Optional CI artifact output
    if (reportFilePath) {
      const fullPath = path.resolve(process.cwd(), reportFilePath);
      fs.writeFileSync(fullPath, JSON.stringify(report, null, 2), 'utf-8');
      if (!isJsonOutput) {
        console.log(`\n📁 Test execution report saved to: ${reportFilePath}`);
      }
    }
  } catch (err) {
    console.error('Fatal test runner execution error:', err);
    process.exitCode = 1;
  } finally {
    if (teardown) {
      await teardown();
    }
  }

  process.exit(process.exitCode ?? 0);
}

main();
