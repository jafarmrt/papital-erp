import '../src/lib/processTimezone.js';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import {
  NIGHTLY_VERIFY_REPORT_VERSION, nightlyWorse, parseNightlyReport,
  type NightlyHealthCount, type NightlyInvariantCount, type NightlyVerifyReport,
} from '../src/lib/system/nightlyVerify.js';
import { terminalLine } from '../src/lib/terminalText.js';

/**
 * v10.2.14 (O-04, 10.2 package 13): the nightly check on a copy of the backup. Run only by `scripts/nightly-verify.sh`:
 *   tsx scripts/nightly-verify.ts --report <file> --backup <name>                 (DATABASE_URL = the drill copy)
 *   tsx scripts/nightly-verify.ts --report <file> --backup <name> --restore-failed
 * The first form runs the financial health check and every business invariant over the whole copy, compares the counts
 * with the previous report and writes the new one; the second records a backup that did not restore. It only reads the
 * copy and refuses any database that is not a restore drill (`erp_restore_drill_*`).
 * Exit: 0 = nothing worse than the night before; 1 = a step failed or a check got worse; 2 = not a drill database.
 */

function argValue(name: string): string {
  const i = process.argv.indexOf(name);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (!v) throw new Error(`missing ${name}`);
  return v;
}

function readPrevious(file: string): NightlyVerifyReport | null {
  try {
    return parseNightlyReport(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Written to a temporary file and renamed, so the health page never reads half a report */
function writeReport(file: string, report: NightlyVerifyReport): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o644 });
  fs.renameSync(tmp, file);
}

function baseReport(backup: string): NightlyVerifyReport {
  return {
    version: NIGHTLY_VERIFY_REPORT_VERSION, finishedAt: new Date().toISOString(), backupFile: path.basename(backup),
    restoreOk: true, health: null, invariants: null, worse: [], errors: [],
  };
}

async function verifyCopy(report: NightlyVerifyReport): Promise<number> {
  // imported here so that --restore-failed needs no database
  const { pool } = await import('../src/db/drizzle.js');
  const { isRehearsalDatabase, rehearsalErrorCause, REHEARSAL_DATABASE_PREFIX } = await import('../src/db/upgradeRehearsal.js');
  try {
    const database = (await pool.query<{ db: string }>('SELECT current_database() AS db')).rows[0]?.db ?? '';
    if (!isRehearsalDatabase(database)) {
      console.error(`REFUSED: ${database} is not a restore-drill copy (${REHEARSAL_DATABASE_PREFIX}*); the nightly check reads only such a copy`);
      return 2;
    }
    console.log(`Checking the backup copy ${database}`);

    try {
      const { FinancialHealthService } = await import('../src/services/accounting/financialHealth.service.js');
      const { healthStatuses } = await import('../src/db/upgradeRehearsal.js');
      const statuses = healthStatuses(await FinancialHealthService.runHealthCheck());
      const health: NightlyHealthCount[] = [...statuses].map(([id, s]) => ({ id, status: s.status, count: s.count }))
        .sort((a, b) => a.id.localeCompare(b.id));
      report.health = health;
      const bad = health.filter(h => h.status !== 'healthy');
      console.log(`  financial health check: ${health.length} checks, ${bad.length} not healthy`);
      for (const h of bad) console.log(`    ${h.id}: ${h.status} (${h.count})`);
    } catch (err: unknown) {
      report.errors.push(`financial health check: ${rehearsalErrorCause(err)}`);
    }

    try {
      const { checkBusinessInvariants } = await import('../src/tests/invariants/businessInvariants.js');
      const ids = async (sql: string) => (await pool.query<{ id: number }>(sql)).rows.map(r => Number(r.id));
      const violations = await checkBusinessInvariants({
        itemIds: await ids('SELECT id FROM items ORDER BY id'),
        documentIdAfter: 0,
        voucherIdAfter: 0,
        bankAccountIds: await ids('SELECT id FROM bank_accounts WHERE is_deleted = 0 ORDER BY id'),
        payrollIdAfter: 0,
        partyIds: await ids('SELECT id FROM customers WHERE is_deleted = 0 ORDER BY id'),
        chequeIdAfter: 0,
        treasuryIdAfter: 0,
        projectIds: await ids('SELECT id FROM production_projects WHERE is_deleted = 0 ORDER BY id'),
        fiscalYears: await ids(`SELECT fiscal_year AS id FROM fiscal_periods WHERE status = 'closed' ORDER BY 1`),
      });
      const counts = new Map<string, number>();
      for (const v of violations) counts.set(v.invariant, (counts.get(v.invariant) ?? 0) + 1);
      const invariants: NightlyInvariantCount[] = [...counts].map(([invariant, count]) => ({ invariant, count }))
        .sort((a, b) => a.invariant.localeCompare(b.invariant));
      report.invariants = invariants;
      console.log(`  business invariants: ${violations.length} violation(s)`);
      for (const i of invariants) console.log(`    ${i.invariant}: ${i.count}`);
    } catch (err: unknown) {
      report.errors.push(`business invariants: ${rehearsalErrorCause(err)}`);
    }
    for (const e of report.errors) console.log(terminalLine(`  ✗ ${e}`));
    return 0;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function main(): Promise<number> {
  const file = argValue('--report');
  const report = baseReport(argValue('--backup'));
  const previous = readPrevious(file);
  if (process.argv.includes('--restore-failed')) {
    report.restoreOk = false;
    report.errors.push('the backup did not pass the restore drill');
  } else {
    const code = await verifyCopy(report);
    if (code === 2) return 2;
  }
  report.worse = nightlyWorse(previous, report);
  report.finishedAt = new Date().toISOString();
  writeReport(file, report);
  for (const w of report.worse) console.log(`  ✗ worse than the night before: ${w}`);
  const failed = !report.restoreOk || report.health === null || report.invariants === null || report.worse.length > 0;
  console.log(failed ? `Nightly check FAILED (report: ${file})` : `Nightly check passed (report: ${file})`);
  return failed ? 1 : 0;
}

main()
  .then(code => process.exit(code))
  .catch((err: unknown) => {
    console.error(terminalLine(`NIGHTLY CHECK ERROR: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  });
