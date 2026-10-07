import '../src/lib/processTimezone.js';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { Phase21TestRunner, assertRealTestDatabase, assertRunnerEnvironment } from '../src/tests/testRunner.js';
import { setupTestSchema } from '../src/tests/setup/testDb.js';
import { bootstrapTestMasterData } from '../src/tests/setup/testBootstrap.js';

async function main() {
  const rawArgs = process.argv.slice(2);
  
  // Parse CLI flags and arguments
  let layerArg: any = undefined;
  let isJsonOutput = false;
  let isSummaryOnly = false;
  let reportFilePath: string | null = null;
  let isVerbose = false;
  let testFilter: string | undefined = undefined;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === '--json') {
      isJsonOutput = true;
    } else if (arg === '--summary') {
      isSummaryOnly = true;
    } else if (arg === '--verbose' || arg === '-v') {
      isVerbose = true;
    } else if (arg.startsWith('--test=')) {
      testFilter = arg.replace('--test=', '').trim();
    } else if ((arg === '--test' || arg === '-t') && i + 1 < rawArgs.length) {
      testFilter = rawArgs[++i].trim();
    } else if (arg.startsWith('--filter=')) {
      testFilter = arg.replace('--filter=', '').trim();
    } else if ((arg === '--filter' || arg === '-f') && i + 1 < rawArgs.length) {
      testFilter = rawArgs[++i].trim();
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Papital ERP Test Runner Usage:
  npx tsx scripts/run-tests.ts [options] [suite/layer]

Options:
  --suite=<name>, -s <name>     Run a specific test suite (e.g., database, unit, regression)
  --test=<id/name>, -t <name>   Run specific test(s) matching ID or keyword (e.g. td-144, coa)
  --filter=<pattern>, -f        Alias for --test
  --layer=<name>, -l <name>     Run a specific layer filter
  --summary                     Print only summary metrics
  --json                        Output JSON formatted report
  --verbose, -v                 Print detailed execution steps
  --report-file=<path>          Save JSON report to file

Available Suites:
  unit                Pure in-memory unit tests (financial math, Iranian IDs/cards/phones, rule engine)
  database (or db)    PostgreSQL schema, triggers, JSONB check constraints, foreign keys
  workflow (or wf)    Workflow states, transitions, approvals, quorum, SLA
  concurrency         Optimistic locking, concurrent stock issues, race conditions
  regression (or reg) Regression suite for critical production fixes
  document_integrity  Document finalization, stock reservation, voucher reversal
  business_logic      Kardex invariants, atomic codes, menu deny-list
  business_invariants Business-logic invariants, one-year simulator, known-findings baseline (v8)
  critical_path       Voucher sequences, single stock deduction, idempotency
  penetration (or pen) HTTP penetration tests (XSS, SQLi, SSRF, brute-force resistance)
  security (or sec)   Authorization policies, token validation, password hashing
  integration         Cross-module service integration
  api                 HTTP endpoints and response contract validation
  recovery (or rec)   Reconciliation, backup restore, failure self-healing
  e2e                 End-to-end user journey scenarios
`);
      process.exit(0);
    } else if (arg.startsWith('--report-file=')) {
      reportFilePath = arg.replace('--report-file=', '').trim();
    } else if (arg === '--report-file' && i + 1 < rawArgs.length) {
      reportFilePath = rawArgs[++i].trim();
    } else if (arg.startsWith('--layer=')) {
      layerArg = arg.replace('--layer=', '').trim();
    } else if ((arg === '--layer' || arg === '-l') && i + 1 < rawArgs.length) {
      layerArg = rawArgs[++i].trim();
    } else if (arg.startsWith('--suite=')) {
      layerArg = arg.replace('--suite=', '').trim();
    } else if ((arg === '--suite' || arg === '-s') && i + 1 < rawArgs.length) {
      layerArg = rawArgs[++i].trim();
    } else if (!arg.startsWith('-') && !layerArg) {
      layerArg = arg.trim();
    }
  }

  // Normalize suite/layer aliases
  if (layerArg) {
    const normalized = String(layerArg).toLowerCase().replace(/[-_]/g, '');
    const aliasMap: Record<string, string> = {
      unit: 'unit',
      integration: 'integration',
      api: 'api',
      db: 'database',
      database: 'database',
      workflow: 'workflow',
      wf: 'workflow',
      concurrency: 'concurrency',
      concurrent: 'concurrency',
      security: 'security',
      sec: 'security',
      regression: 'regression',
      reg: 'regression',
      e2e: 'e2e',
      recovery: 'recovery',
      rec: 'recovery',
      penetration: 'penetration',
      pen: 'penetration',
      criticalpath: 'critical_path',
      critical: 'critical_path',
      crit: 'critical_path',
      docintegrity: 'document_integrity',
      documentintegrity: 'document_integrity',
      document: 'document_integrity',
      docs: 'document_integrity',
      businesslogic: 'business_logic',
      businesslogicaudit: 'business_logic',
      audit: 'business_logic',
      businessinvariants: 'business_invariants',
      invariants: 'business_invariants',
      inv: 'business_invariants'
    };
    // v9.0.186 (TD-608): an unknown suite used to run nothing and report PASSED
    if (!aliasMap[normalized]) {
      console.error(`Unknown test suite "${layerArg}". Known suites: ${[...new Set(Object.values(aliasMap))].join(', ')}`);
      process.exit(1);
    }
    layerArg = aliasMap[normalized];
  }

  // v9.0.186 (TD-608): refused before any schema, migration or seed is written (the check used to run after them)
  try {
    assertRunnerEnvironment();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // TD-134 (Roadmap 2.5): ایزولاسیون کامل دیتابیس تست‌ها به‌صورت پیش‌فرض فعال است مگر با ERP_TEST_SCHEMA_ISOLATION=0 خاموش شود
  const isolationEnabled = process.env.ERP_TEST_SCHEMA_ISOLATION !== '0';

  // TST-003 companion: the dedicated CLI runner always runs in a test context,
  // so fixture cleanup is safe here (API-endpoint & production remain gated).
  if (process.env.ERP_ALLOW_TEST_CLEANUP !== '0') {
    process.env.ERP_ALLOW_TEST_CLEANUP = '1';
  }

  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'c8f49a1b3e7d20569a0e4b81c3d5f7a29e4b6c8d0f1a3e5b7c9d1e3f5a7b9c1d';
  }

  if (!isJsonOutput) {
    console.log('======================================================================');
    console.log(`🚀 Papital ERP Test Runner Matrix (Phase 8/21 Suite Engine)`);
    console.log(`   Scope Filter : ${layerArg ? `[Layer: ${layerArg}]` : 'ALL (Full 21 Suites Matrix)'}${testFilter ? ` [Test Filter: "${testFilter}"]` : ''}`);
    try {
      const url = new URL(process.env.DATABASE_URL || '');
      console.log(`   Target DB    : postgresql://${url.hostname}:${url.port || 5432}/${url.pathname.replace(/^\//, '')}`);
    } catch {
      console.log(`   Target DB    : [DATABASE_URL not parseable or missing]`);
    }
    console.log(`   Isolation    : ${isolationEnabled ? 'ENABLED (Default in V7 / TD-134)' : 'DISABLED'}`);
    console.log(`   Cleanup Mode : SYNTHETIC TEST ARTIFACTS ONLY (Safe dev preservation)`);
    console.log('======================================================================\n');
  }

  let teardown: (() => Promise<void>) | null = null;

  try {
    // v7.0.38 (P2-12): پیش از ساخت اسکیما و seed؛ وگرنه مهاجرت و داده پایه روی mockPool «موفق» گزارش می‌شوند
    await assertRealTestDatabase();

    if (isolationEnabled) {
      const ctx = await setupTestSchema();
      teardown = ctx.teardown;
    }

    // v7.0.24 (TD-174): همان داده‌های پایه‌ای که server.ts هنگام راه‌اندازی می‌سازد (seed ایدم‌پوتنت)
    await bootstrapTestMasterData();

    const report = await Phase21TestRunner.runAllTests(layerArg, testFilter);

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

    // v9.0.186 (TD-608): a filter that matches no test is a failure, never a pass; a mistyped test id must not turn green
    if (totalCases === 0) {
      console.error(`\nNo test ran: suite ${layerArg ?? 'all'}${testFilter ? `, filter "${testFilter}"` : ''} matched no test.`);
      process.exitCode = 1;
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
