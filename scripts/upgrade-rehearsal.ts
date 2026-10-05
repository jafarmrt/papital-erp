import '../src/lib/processTimezone.js';
import 'dotenv/config';
import { pool } from '../src/db/drizzle.js';
import { runMigrations } from '../src/db/migrator.js';
import {
  compareRehearsal, healthStatuses, isRehearsalDatabase, REHEARSAL_DATABASE_PREFIX, snapshotBusinessData, type HealthStatus,
} from '../src/db/upgradeRehearsal.js';
import { FinancialHealthService } from '../src/services/accounting/financialHealth.service.js';

/**
 * v8.0.88 (TD-367): مهاجرت‌های همین کد را روی رونوشت بازیابی‌شده داده اجرا و پیش و پس را مقایسه می‌کند.
 * فقط از `scripts/upgrade-rehearsal.sh` اجرا می‌شود (DATABASE_URL = پایگاه‌داده تمرین)؛ روی هر پایگاه‌داده دیگری رد می‌شود.
 * کد خروج: ۰ = ارتقا روی این داده امن است، ۱ = مهاجرت شکست خورد یا جمع‌ها عوض شدند، ۲ = پایگاه‌داده تمرین نیست.
 */

const SHOW = 40;

async function health(label: string): Promise<Map<string, HealthStatus> | null> {
  try {
    return healthStatuses(await FinancialHealthService.runHealthCheck());
  } catch (err: unknown) {
    console.log(`  ! financial health check ${label} not available: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function appliedMigrations(): Promise<number> {
  const r = await pool.query<{ n: string | null }>(
    `SELECT CASE WHEN to_regclass('drizzle.__drizzle_migrations') IS NULL THEN '0' ELSE (SELECT count(*)::text FROM drizzle.__drizzle_migrations) END AS n`,
  );
  return Number(r.rows[0]?.n ?? 0);
}

function list(title: string, lines: string[]): void {
  if (lines.length === 0) return;
  console.log(title);
  for (const line of lines.slice(0, SHOW)) console.log(`    ${line}`);
  if (lines.length > SHOW) console.log(`    … and ${lines.length - SHOW} more`);
}

async function main(): Promise<number> {
  const database = (await pool.query<{ db: string }>('SELECT current_database() AS db')).rows[0]?.db ?? '';
  if (!isRehearsalDatabase(database)) {
    console.error(`REFUSED: ${database} is not a restore-drill copy (${REHEARSAL_DATABASE_PREFIX}*); the rehearsal never migrates any other database`);
    return 2;
  }
  console.log(`Rehearsing the upgrade on ${database}`);
  const appliedBefore = await appliedMigrations();
  const before = await snapshotBusinessData(pool);
  const healthBefore = await health('before the migrations');

  const result = await runMigrations();
  for (const warning of result.warnings ?? []) console.log(`  ! ${warning}`);
  if (!result.success) {
    list('✗ migrations FAILED on this data: the service would stop at startup after this update', result.errors);
    return 1;
  }
  console.log(`  ✓ migrations: ${result.appliedCount - appliedBefore} applied (${appliedBefore} → ${result.appliedCount})`);

  const after = await snapshotBusinessData(pool);
  const healthAfter = await health('after the migrations');
  const findings = compareRehearsal(before, after, healthBefore, healthAfter);
  list('  Notes:', findings.notices);
  if (findings.problems.length > 0) {
    list(`✗ the migrations changed ${findings.problems.length} business total(s) or health check(s) (before → after):`, findings.problems);
    return 1;
  }
  console.log(`  ✓ ledger totals per account, stock and average cost per item, stock per warehouse and bank balances unchanged; financial health not worse`);
  return 0;
}

main()
  .then(async code => {
    await pool.end();
    process.exit(code);
  })
  .catch(async (err: unknown) => {
    console.error('REHEARSAL ERROR', err);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
