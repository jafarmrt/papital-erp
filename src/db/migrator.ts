import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { pool, orm } from './drizzle.js';
import { logger } from '../middleware/logger.js';

export interface MigrationResult {
  success: boolean;
  appliedCount: number;
  errors: string[];
}

/**
 * Resolves the absolute path to the drizzle migrations directory.
 * Works seamlessly in tsx development (ESM), compiled dist/server.cjs (CJS), and custom cwd environments.
 */
export function getMigrationsFolder(): string {
  const currentDir = typeof __dirname !== 'undefined'
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

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
 * Runs Drizzle ORM migrations using the official Drizzle Migrator pipeline.
 * Ensures the single source of truth (drizzle/*.sql) is applied cleanly and idempotently.
 */
export async function runMigrations(): Promise<MigrationResult> {
  const errors: string[] = [];
  const migrationsFolder = getMigrationsFolder();

  logger.info(`[Migrator] Executing Drizzle migrations from: ${migrationsFolder}`);

  try {
    if (!fs.existsSync(migrationsFolder)) {
      throw new Error(`Migrations directory not found at ${migrationsFolder}`);
    }

    // V3.0.9 (TD-063): appliedCount واقعی از روی رکوردهای __drizzle_migrations
    // محاسبه می‌شود (قبلاً ثابت ۱ گزارش می‌شد).
    let before = 0;
    try {
      const res = await pool.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations');
      before = Number(res.rows[0]?.count || 0);
    } catch {
      // Table may not exist on a fresh database yet — before stays 0
    }

    // Execute official Drizzle migration runner (records applied migrations in __drizzle_migrations)
    await migrate(orm, { migrationsFolder });

    // V3.1.13: Ensure project_stages has updated_at column to guarantee trg_project_stages_updated_at trigger compatibility
    try {
      await pool.query(`
        ALTER TABLE project_stages ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();
        DROP TRIGGER IF EXISTS trg_project_stages_updated_at ON project_stages;
        CREATE TRIGGER trg_project_stages_updated_at BEFORE UPDATE ON project_stages FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      `);
    } catch (e: any) {
      logger.warn(`[Migrator] project_stages trigger check: ${e.message}`);
    }

    // V3.1.28: Ensure attachments jsonb columns exist for financial entities
    try {
      await pool.query(`
        ALTER TABLE documents ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb;
        ALTER TABLE journal_vouchers ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb;
        ALTER TABLE cheques ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb;
        ALTER TABLE treasury_transactions ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb;
        ALTER TABLE piecework_payrolls ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb;
        ALTER TABLE production_projects ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb;
      `);
    } catch (e: any) {
      logger.warn(`[Migrator] financial attachments column check: ${e.message}`);
    }

    // V4.0.4 (TD-091 / Subphase 3.1): Ensure piecework_payroll_number_seq exists for atomic payroll numbering
    try {
      await pool.query(`
        CREATE SEQUENCE IF NOT EXISTS piecework_payroll_number_seq START WITH 1001 INCREMENT BY 1;
      `);
    } catch (e: any) {
      logger.warn(`[Migrator] piecework_payroll_number_seq check: ${e.message}`);
    }

    // V4.0.33: Ensure paid_amount column exists on piecework_payrolls for partial payments and backfill past paid payrolls
    try {
      await pool.query(`
        ALTER TABLE piecework_payrolls ADD COLUMN IF NOT EXISTS paid_amount numeric(18, 4) DEFAULT 0;
        UPDATE piecework_payrolls SET paid_amount = net_payable WHERE status = 'paid' AND (paid_amount IS NULL OR paid_amount = 0);
      `);
    } catch (e: any) {
      logger.warn(`[Migrator] piecework_payrolls paid_amount column check: ${e.message}`);
    }

    let after = before;
    try {
      const res = await pool.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations');
      after = Number(res.rows[0]?.count || 0);
    } catch {
      // Keep after = before on query failure
    }

    logger.info(`[Migrator] Drizzle database migrations completed successfully. ${before} → ${after} applied.`);

    return {
      success: true,
      appliedCount: after,
      errors: []
    };
  } catch (err: any) {
    const errorMsg = `[Migrator] Migration execution error: ${err.message}`;
    logger.error(errorMsg, { stack: err.stack });
    errors.push(err.message);
    return {
      success: false,
      appliedCount: 0,
      errors
    };
  }
}

/**
 * Diagnostic tool validating the integrity, table presence, and numeric precision of the schema.
 * Aligned with the canonical single source of truth (src/db/schema.ts).
 */
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
    'item_code_counters', 'project_bom_allocations', 'idempotency_keys'
  ];

  const missingTables: string[] = [];
  const floatColumns: string[] = [];

  try {
    const tableRes = await pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
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
      WHERE table_schema = 'public' 
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
