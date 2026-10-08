import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { assertRealTestDatabase } from '../src/tests/testRunner.js';
import { setupTestSchema } from '../src/tests/setup/testDb.js';
import { bootstrapTestMasterData } from '../src/tests/setup/testBootstrap.js';
import { runBusinessYearSimulation, SimulationResult } from '../src/tests/simulation/businessYearSimulator.js';

/**
 * v8.0.1 — اجرای شبیه‌ساز «یک سال کاری» روی PostgreSQL واقعی، هر بذر در یک اسکیمای ایزوله تازه (V8_MASTER_ROADMAP.md).
 *
 *   npm run simulate:year -- --seeds=1,2,3 --steps=400 [--check-every=10] [--verbose] [--report=dist/sim.json]
 *
 * همان محیط تست CI لازم است (DATABASE_URL واقعی، NODE_ENV=test). هر بذر اسکیمای خودش را می‌سازد و در پایان حذف می‌کند،
 * پس ناوردایی‌ها روی پایگاه‌داده‌ای بررسی می‌شوند که فقط داده همین شبیه‌سازی را دارد. کد خروج ۱ یعنی دست‌کم یک نقض.
 */

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find(a => a.startsWith(prefix))?.slice(prefix.length);
}

async function runSeed(seed: number, steps: number, checkEvery: number, verbose: boolean): Promise<SimulationResult> {
  const ctx = await setupTestSchema();
  try {
    await bootstrapTestMasterData();
    return await runBusinessYearSimulation({
      seed,
      steps,
      checkEvery,
      log: verbose ? (line: string) => console.log(`  [${seed}] ${line}`) : undefined,
    });
  } finally {
    await ctx.teardown();
  }
}

async function main(): Promise<void> {
  const seeds = (argValue('seeds') ?? '1').split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n));
  const steps = Number(argValue('steps') ?? 300);
  const checkEvery = Number(argValue('check-every') ?? 10);
  const verbose = process.argv.includes('--verbose');
  const reportPath = argValue('report');

  await assertRealTestDatabase();

  const results: SimulationResult[] = [];
  for (const seed of seeds) {
    console.log(`\n▶ Simulating seed ${seed} (${steps} steps)`);
    const result = await runSeed(seed, steps, checkEvery, verbose);
    results.push(result);
    console.log(`  Operations: ${result.counts.ok} succeeded, ${result.counts.rejected} rejected, ${result.counts.skipped} without action`);
    console.log(`  Final gap between inventory value and the general ledger: ${result.finalInventoryGap} rials`);
    if (result.findings.length === 0) {
      console.log('  ✅ No invariant violated');
    } else {
      console.log(`  ❌ ${result.findings.length} violations:`);
      for (const f of result.findings) {
        console.log(`   - [${f.invariant}] ${f.key} (step ${f.firstStep}, ${f.firstOp}): ${f.message}`);
        if (f.expected !== undefined || f.actual !== undefined) console.log(`       expected: ${f.expected ?? '-'} | actual: ${f.actual ?? '-'}`);
        const stepRecord = result.steps.find(s => s.step === f.firstStep);
        if (stepRecord) console.log(`       step ${stepRecord.step}: ${stepRecord.detail}`);
      }
    }
  }

  if (reportPath) {
    fs.writeFileSync(path.resolve(process.cwd(), reportPath), JSON.stringify(results, null, 2), 'utf-8');
    console.log(`\n📁 Report: ${reportPath}`);
  }
  const total = results.reduce((s, r) => s + r.findings.length, 0);
  console.log(`\n${total === 0 ? '✅' : '❌'} Total violations across ${results.length} seeds: ${total}`);
  process.exit(total === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal simulation error:', err);
  process.exit(2);
});
