import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type pkg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { pool, orm, isMockDatabase } from './drizzle.js';
import { logger } from '../middleware/logger.js';
import { ADVISORY_LOCK_KEYS } from '../lib/advisoryLock.js';
import { planMigrations, type AppliedMigrationRow, type MigrationJournalEntry } from './migrationPlan.js';
import { previousMigrationHashes } from './migrationAmendments.js';

export interface MigrationResult {
  success: boolean;
  appliedCount: number;
  errors: string[];
  /** v8.0.81 (TD-364): ناهمخوانی‌هایی که فقط گزارش می‌شوند (مثلاً فایل مهاجرتِ اجراشده‌ای که بعداً عوض شده) */
  warnings?: string[];
}

export interface RunMigrationsOptions {
  /** فقط برای آزمون و ابزار: پوشه مهاجرت‌ها به‌جای getMigrationsFolder() */
  migrationsFolder?: string;
}

/**
 * Resolves the absolute path to the drizzle migrations directory.
 * Works seamlessly in tsx development (ESM), compiled dist/server.cjs (CJS), and custom cwd environments.
 */
export function getMigrationsFolder(): string {
  let currentDir = process.cwd();
  if (typeof __dirname !== 'undefined') {
    currentDir = __dirname;
  } else {
    try {
      const metaUrl = (import.meta as any)?.url;
      if (metaUrl) currentDir = path.dirname(fileURLToPath(metaUrl));
    } catch {
      currentDir = process.cwd();
    }
  }

  const possiblePaths = [
    path.resolve(process.cwd(), 'drizzle'),
    path.resolve(currentDir, 'drizzle'),
    path.resolve(currentDir, '../drizzle'),
    path.resolve(currentDir, '../../drizzle'),
    path.resolve(process.cwd(), 'dist/drizzle'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p) && fs.existsSync(path.join(p, '0000_v3_baseline.sql'))) {
      return p;
    }
  }

  // Fallback to default relative path
  return path.resolve(process.cwd(), 'drizzle');
}

/**
 * v7.0.42 (TD-192): اسکیمای دفتر ثبت مهاجرت‌های اجراشده (`<schema>.__drizzle_migrations`).
 * در پروداکشن همیشه 'drizzle' است؛ اسکیمای ایزوله تست‌ها (src/tests/setup/testDb.ts) دفتر خودش را دارد،
 * وگرنه اجرای دوم تست‌ها روی همان پایگاه‌داده «همه مهاجرت‌ها اعمال شده» می‌دید و اسکیمای تازه خالی می‌ماند.
 */
const DEFAULT_MIGRATIONS_JOURNAL_SCHEMA = 'drizzle';
let migrationsJournalSchema = DEFAULT_MIGRATIONS_JOURNAL_SCHEMA;

export function getMigrationsJournalSchema(): string {
  return migrationsJournalSchema;
}

/** دفتر مهاجرت را به اسکیمای داده‌شده می‌برد و مقدار قبلی را برای بازگردانی برمی‌گرداند */
export function setMigrationsJournalSchema(schema: string | null): string {
  const previous = migrationsJournalSchema;
  migrationsJournalSchema = schema || DEFAULT_MIGRATIONS_JOURNAL_SCHEMA;
  return previous;
}

function journalTable(): string {
  return `"${migrationsJournalSchema.replace(/"/g, '""')}".__drizzle_migrations`;
}

/** v8.0.81 (TD-364): دفتر مهاجرت کد با درهم‌سازی هر فایل، به همان ترتیب و همان روشی که Drizzle می‌خواند */
export function readMigrationJournal(migrationsFolder: string): MigrationJournalEntry[] {
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as {
    entries: Array<{ idx: number; tag: string; when: number }>;
  };
  const files = readMigrationFiles({ migrationsFolder });
  return journal.entries.map((e, i) => ({ idx: e.idx, tag: e.tag, when: e.when, hash: files[i]?.hash ?? '' }));
}

async function readAppliedMigrations(client: pkg.PoolClient): Promise<AppliedMigrationRow[]> {
  const exists = await client.query<{ ok: boolean }>('SELECT to_regclass($1) IS NOT NULL AS ok', [journalTable()]);
  if (!exists.rows[0]?.ok) return [];
  const res = await client.query<{ hash: string; created_at: string }>(`SELECT hash, created_at FROM ${journalTable()} ORDER BY id`);
  return res.rows.map(r => ({ hash: r.hash, createdAt: Number(r.created_at) }));
}

/**
 * v8.0.82 (TD-366): مهلت دستور مهاجرت‌ها (میلی‌ثانیه، ۰ = بی‌مهلت). مهاجرت‌ها روی اتصال جدا و بیرون از مهلت ۶۰ ثانیه‌ای
 * درخواست‌های برنامه (DB_STATEMENT_TIMEOUT) اجرا می‌شوند؛ مهاجرت داده روی پایگاه‌داده بزرگ واقعی در آن مهلت قطع می‌شد،
 * هر بار از اول تکرار و سرانجام فرایند بسته می‌شد.
 */
function migrationStatementTimeoutMs(): number {
  const value = Number(process.env.MIGRATION_STATEMENT_TIMEOUT ?? 0);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/**
 * Runs Drizzle ORM migrations using the official Drizzle Migrator pipeline.
 * Ensures the single source of truth (drizzle/*.sql) is applied cleanly and idempotently.
 *
 * v8.0.81 (TD-364): پیش از اجرا دفتر کد و پایگاه‌داده مقایسه می‌شوند (`planMigrations`)؛ مهاجرتی که Drizzle بی‌صدا رد
 * می‌کرد، یا پایگاه‌داده‌ای که از این نسخه جلوتر است، اجرا را با خطای روشن متوقف می‌کند.
 * v8.0.82 (TD-366): همه کار روی یک اتصال جدا، بی‌مهلت دستور، و زیر قفل مشورتی MIGRATIONS انجام می‌شود تا دو اجرای
 * هم‌زمان (راه‌اندازی سرور، ابزار دستی) پشت هم بروند، نه اینکه دومی با خطای «از پیش موجود» بشکند.
 */
export async function runMigrations(options: RunMigrationsOptions = {}): Promise<MigrationResult> {
  const migrationsFolder = options.migrationsFolder ?? getMigrationsFolder();

  logger.info(`[Migrator] Executing Drizzle migrations from: ${migrationsFolder}`);

  let client: pkg.PoolClient | undefined;
  let locked = false;
  try {
    if (!fs.existsSync(migrationsFolder)) {
      throw new Error(`Migrations directory not found at ${migrationsFolder}`);
    }

    if (isMockDatabase()) {
      await migrate(orm, { migrationsFolder, migrationsSchema: migrationsJournalSchema });
      return { success: true, appliedCount: 0, errors: [] };
    }

    const entries = readMigrationJournal(migrationsFolder);
    client = await pool.connect();
    await client.query(`SET statement_timeout = ${migrationStatementTimeoutMs()}`);
    await client.query('SET idle_in_transaction_session_timeout = 0');
    await client.query('SELECT pg_advisory_lock($1::bigint)', [ADVISORY_LOCK_KEYS.MIGRATIONS]);
    locked = true;

    // V3.0.9 (TD-063): appliedCount واقعی از روی رکوردهای __drizzle_migrations
    const applied = await readAppliedMigrations(client);
    const plan = planMigrations(entries, applied, previousMigrationHashes());
    for (const warning of plan.warnings) logger.warn(`[Migrator] ${warning}`);
    if (plan.errors.length > 0) {
      for (const error of plan.errors) logger.error(`[Migrator] ${error}`);
      return { success: false, appliedCount: applied.length, errors: plan.errors, warnings: plan.warnings };
    }

    // Execute official Drizzle migration runner (records applied migrations in __drizzle_migrations)
    await migrate(drizzle(client), { migrationsFolder, migrationsSchema: migrationsJournalSchema });
    const after = (await readAppliedMigrations(client)).length;

    logger.info(`[Migrator] Drizzle database migrations completed successfully. ${applied.length} → ${after} applied.`);

    return {
      success: true,
      appliedCount: after,
      errors: [],
      warnings: plan.warnings,
    };
  } catch (err: any) {
    const errorMsg = `[Migrator] Migration execution error: ${err.message}`;
    logger.error(errorMsg, { stack: err.stack });
    return {
      success: false,
      appliedCount: 0,
      errors: [err.message]
    };
  } finally {
    if (client) {
      if (locked) await client.query('SELECT pg_advisory_unlock($1::bigint)', [ADVISORY_LOCK_KEYS.MIGRATIONS]).catch(() => undefined);
      await client.query('RESET statement_timeout').catch(() => undefined);
      await client.query('RESET idle_in_transaction_session_timeout').catch(() => undefined);
      client.release();
    }
  }
}

/**
 * Diagnostic tool validating the integrity, table presence, and numeric precision of the schema.
 * Aligned with the canonical single source of truth (src/db/schema.ts).
 */
// v7.0.24 (TD-174): اسکیمای فعال (current_schema) به‌جای 'public' ثابت — در پروداکشن همان public است
// و در اجرای ایزوله تست‌ها (ERP_TEST_SCHEMA_ISOLATION=1، همانند CI) اسکیمای جعبه‌شنی تست بررسی می‌شود.
export async function validateDbSchema(): Promise<{ valid: boolean; tablesCount: number; floatColumns: string[]; missingTables: string[]; details: any }> {
  const expectedTables = [
    'users', 'roles', 'categories', 'warehouses', 'app_settings', 'customers',
    'items', 'documents', 'document_items', 'transactions', 'item_prices', 'activity_logs',
    'transfers', 'production_projects', 'project_stages', 'daily_work_logs', 'notifications',
    'crm_leads', 'crm_activities', 'personnel', 'task_categories', 'piecework_tasks',
    'piecework_task_rate_history', 'piecework_personnel_rates', 'piecework_logs', 'piecework_payrolls', 'pending_materials',
    'accounts', 'journal_vouchers', 'journal_voucher_items', 'bank_accounts', 'cheques',
    'treasury_transactions', 'accounting_settings', 'workflow_definitions', 'workflow_states',
    'workflow_transitions', 'workflow_instances', 'workflow_pending_approvals', 'workflow_history_logs',
    'workflow_definition_versions', 'workflow_tasks', 'workflow_delegations', 'outbox_events',
    'event_action_rules', 'event_action_logs', 'dead_letter_events', 'webhook_subscriptions',
    'webhook_deliveries', 'woocommerce_order_logs', 'form_drafts', 'document_ref_counters',
    'item_code_counters', 'project_bom_allocations', 'idempotency_keys', 'item_warehouse_stocks'
  ];

  const missingTables: string[] = [];
  const floatColumns: string[] = [];

  try {
    const tableRes = await pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
    `);
    const existingTableNames = new Set(tableRes.rows.map((r: any) => r.table_name));

    for (const t of expectedTables) {
      if (!existingTableNames.has(t)) {
        missingTables.push(t);
      }
    }

    // Check for non-numeric floating point columns in financial/stock tables
    const colRes = await pool.query(`
      SELECT table_name, column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = current_schema()
        AND data_type IN ('double precision', 'real', 'float')
    `);

    for (const r of colRes.rows) {
      floatColumns.push(`${r.table_name}.${r.column_name} (${r.data_type})`);
    }

    const valid = missingTables.length === 0 && floatColumns.length === 0;

    return {
      valid,
      tablesCount: existingTableNames.size,
      missingTables,
      floatColumns,
      details: {
        expectedCount: expectedTables.length,
        existingCount: existingTableNames.size
      }
    };
  } catch (err: any) {
    return {
      valid: false,
      tablesCount: 0,
      missingTables: expectedTables,
      floatColumns: [],
      details: { error: err.message }
    };
  }
}
