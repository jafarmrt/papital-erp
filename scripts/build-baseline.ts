import * as schema from '../src/db/schema.js';
import { is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import fs from 'fs';
import { pool } from '../src/db/drizzle.js';

export function buildBaselineSql(): string {
  const statements: string[] = [];

  // Extension
  statements.push('CREATE EXTENSION IF NOT EXISTS pg_trgm;');

  // Sequences
  statements.push('CREATE SEQUENCE IF NOT EXISTS journal_voucher_number_seq START WITH 1 INCREMENT BY 1;');
  statements.push('CREATE SEQUENCE IF NOT EXISTS treasury_tx_number_seq START WITH 1 INCREMENT BY 1;');

  // Process tables
  const tables: PgTable[] = [];
  for (const [_key, val] of Object.entries(schema)) {
    if (is(val, PgTable)) {
      tables.push(val as PgTable);
    }
  }

  // Sort tables
  const orderPriority = [
    'app_settings', 'users', 'roles', 'warehouses', 'categories', 'task_categories',
    'customers', 'changelogs', 'migrations_log', 'items', 'documents', 'document_ref_counters',
    'item_code_counters', 'document_items', 'transactions', 'item_prices', 'activity_logs',
    'personnel', 'transfers', 'production_projects', 'project_stages', 'daily_work_logs',
    'pending_materials', 'piecework_tasks', 'piecework_task_rate_history', 'piecework_personnel_rates',
    'piecework_payrolls', 'piecework_logs', 'accounts', 'journal_vouchers', 'journal_voucher_items',
    'bank_accounts', 'cheques', 'treasury_transactions', 'accounting_settings', 'crm_leads',
    'crm_activities', 'workflow_definitions', 'workflow_definition_versions', 'workflow_states',
    'workflow_transitions', 'workflow_instances', 'workflow_pending_approvals', 'workflow_history_logs',
    'workflow_tasks', 'workflow_delegations', 'outbox_events', 'event_action_rules', 'event_action_logs',
    'dead_letter_events', 'webhook_subscriptions', 'webhook_deliveries', 'woocommerce_order_logs',
    'form_drafts', 'project_bom_allocations', 'idempotency_keys', 'notifications'
  ];

  tables.sort((a, b) => {
    const nameA = getTableConfig(a).name;
    const nameB = getTableConfig(b).name;
    const idxA = orderPriority.indexOf(nameA);
    const idxB = orderPriority.indexOf(nameB);
    return (idxA >= 0 ? idxA : 999) - (idxB >= 0 ? idxB : 999);
  });

  for (const table of tables) {
    const config = getTableConfig(table);
    const colsSql: string[] = [];

    for (const col of config.columns) {
      const colIdent = col.name === 'user' ? '"user"' : col.name;
      let colDef = `  ${colIdent} ${col.getSQLType()}`;
      if (col.primary) {
        colDef += ' PRIMARY KEY';
      } else {
        if (col.notNull) colDef += ' NOT NULL';
        if (col.isUnique) colDef += ' UNIQUE';
        if (col.hasDefault) {
          if (typeof col.default === 'string') {
            colDef += ` DEFAULT '${col.default.replace(/'/g, "''")}'`;
          } else if (typeof col.default === 'number') {
            colDef += ` DEFAULT ${col.default}`;
          } else if (typeof col.default === 'boolean') {
            colDef += ` DEFAULT ${col.default ? 'TRUE' : 'FALSE'}`;
          } else if (typeof col.default === 'object' && col.default !== null) {
            colDef += ` DEFAULT '${JSON.stringify(col.default)}'::jsonb`;
          }
        }
      }
      colsSql.push(colDef);
    }

    // Table create
    statements.push(`CREATE TABLE IF NOT EXISTS ${config.name} (\n${colsSql.join(',\n')}\n);`);

    // Indexes
    for (const idx of config.indexes) {
      const idxConfig = idx.config;
      const idxName = idxConfig.name;
      if (idxName === 'customers_name_trgm_idx') {
        statements.push('CREATE INDEX IF NOT EXISTS customers_name_trgm_idx ON customers USING gin (name gin_trgm_ops);');
      } else if (idxName === 'items_name_trgm_idx') {
        statements.push('CREATE INDEX IF NOT EXISTS items_name_trgm_idx ON items USING gin (name gin_trgm_ops);');
      } else {
        const colNames = idxConfig.columns.map((c: any) => c.name).join(', ');
        statements.push(`CREATE INDEX IF NOT EXISTS ${idxName} ON ${config.name} (${colNames});`);
      }
    }
  }

  // Constraints DO block
  statements.push(`DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_items_stocks_object') THEN
    ALTER TABLE items ADD CONSTRAINT chk_items_stocks_object CHECK (stocks IS NULL OR jsonb_typeof(stocks) = 'object');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_pp_inv_control_object') THEN
    ALTER TABLE production_projects ADD CONSTRAINT chk_pp_inv_control_object CHECK (inventory_control IS NULL OR jsonb_typeof(inventory_control) = 'object');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cheques_history_array') THEN
    ALTER TABLE cheques ADD CONSTRAINT chk_cheques_history_array CHECK (status_history IS NULL OR jsonb_typeof(status_history) = 'array');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_wi_dsl_object') THEN
    ALTER TABLE workflow_instances ADD CONSTRAINT chk_wi_dsl_object CHECK (snapshot_dsl IS NULL OR jsonb_typeof(snapshot_dsl) = 'object');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_items_wac_nonneg') THEN
    ALTER TABLE items ADD CONSTRAINT chk_items_wac_nonneg CHECK (weighted_average_cost >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bank_balance_nonneg') THEN
    ALTER TABLE bank_accounts ADD CONSTRAINT chk_bank_balance_nonneg CHECK (initial_balance >= 0 AND current_balance >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tt_amount_pos') THEN
    ALTER TABLE treasury_transactions ADD CONSTRAINT chk_tt_amount_pos CHECK (amount > 0);
  END IF;
END $$;`);

  // Functions and triggers
  statements.push(`CREATE OR REPLACE FUNCTION sync_item_current_stock()
RETURNS TRIGGER AS $$
DECLARE
  calculated_stock NUMERIC(18,4);
BEGIN
  IF NEW.stocks IS NULL OR NEW.stocks = '{}'::jsonb OR jsonb_typeof(NEW.stocks) <> 'object' THEN
    calculated_stock := 0;
  ELSE
    SELECT COALESCE(
      (SELECT SUM((NULLIF(value, '')::numeric)) FROM jsonb_each_text(NEW.stocks)),
      0
    ) INTO calculated_stock;
  END IF;
  
  IF NEW.current_stock IS DISTINCT FROM calculated_stock THEN
    NEW.current_stock := calculated_stock;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`);

  statements.push(`DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sync_item_current_stock') THEN
    CREATE TRIGGER trg_sync_item_current_stock
    BEFORE INSERT OR UPDATE OF stocks, current_stock ON items
    FOR EACH ROW
    EXECUTE FUNCTION sync_item_current_stock();
  END IF;
END $$;`);

  statements.push(`CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`);

  const updatedTables = [
    'users', 'personnel', 'treasury_transactions', 'workflow_instances',
    'item_prices', 'project_stages', 'transfers', 'crm_leads',
    'accounting_settings', 'event_action_rules', 'webhook_subscriptions',
    'woocommerce_order_logs', 'form_drafts'
  ];

  for (const tbl of updatedTables) {
    statements.push(`DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_${tbl}_updated_at') THEN
    CREATE TRIGGER trg_${tbl}_updated_at BEFORE UPDATE ON ${tbl} FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;`);
  }

  return statements.join('\n--> statement-breakpoint\n');
}

async function main() {
  const sql = buildBaselineSql();
  fs.writeFileSync('drizzle/0000_v3_baseline.sql', sql, 'utf8');
  console.log('Successfully written drizzle/0000_v3_baseline.sql');

  const stmts = sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);
  console.log(`Testing ${stmts.length} statements against database...`);

  const failed: any[] = [];
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i];
    try {
      await pool.query(s);
    } catch (err: any) {
      failed.push({ index: i, error: err.message, stmt: s.slice(0, 100) });
    }
  }

  console.log('FAILED STATEMENTS:', failed.length);
  if (failed.length > 0) {
    console.log(failed);
    process.exit(1);
  } else {
    console.log('ALL STATEMENTS PASSED 100% CLEANLY!');
    process.exit(0);
  }
}

if (process.argv[1]?.endsWith('build-baseline.ts') || process.argv[1]?.endsWith('build-baseline.js')) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
