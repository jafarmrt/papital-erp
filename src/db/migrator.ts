import { pool, orm } from './drizzle.js';
import { logger } from '../middleware/logger.js';

export interface MigrationStep {
  id: string;
  name: string;
  sql: string;
}

/**
 * Core DDL definitions ensuring all system tables, columns, indexes, and constraints exist.
 * All financial amounts, prices, and quantities are strictly NUMERIC(18, 4).
 */
export const CORE_TABLE_DDLS: MigrationStep[] = [
  {
    id: '001_app_settings',
    name: 'Create app_settings table',
    sql: `CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`
  },
  {
    id: '002_users',
    name: 'Create users table',
    sql: `CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL,
      avatar_url TEXT DEFAULT '',
      must_reset_password INTEGER DEFAULT 0,
      failed_login_count INTEGER DEFAULT 0,
      locked_until TEXT,
      token_version INTEGER DEFAULT 0,
      is_deleted INTEGER DEFAULT 0
    )`
  },
  {
    id: '003_roles',
    name: 'Create roles table',
    sql: `CREATE TABLE IF NOT EXISTS roles (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      permissions JSONB DEFAULT '[]'::jsonb,
      is_system INTEGER DEFAULT 0
    )`
  },
  {
    id: '004_categories',
    name: 'Create categories table',
    sql: `CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      prefix TEXT NOT NULL,
      type TEXT NOT NULL,
      default_unit TEXT DEFAULT 'عدد'
    )`
  },
  {
    id: '005_warehouses',
    name: 'Create warehouses table',
    sql: `CREATE TABLE IF NOT EXISTS warehouses (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      is_active INTEGER DEFAULT 1
    )`
  },
  {
    id: '006_changelogs',
    name: 'Create changelogs table',
    sql: `CREATE TABLE IF NOT EXISTS changelogs (
      id SERIAL PRIMARY KEY,
      version TEXT NOT NULL,
      date TIMESTAMP NOT NULL DEFAULT NOW(),
      features TEXT NOT NULL,
      fixes TEXT NOT NULL
    )`
  },
  {
    id: '007_customers',
    name: 'Create customers table',
    sql: `CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      contact_name TEXT DEFAULT '',
      country TEXT DEFAULT 'ایران',
      province TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      city TEXT DEFAULT '',
      address TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      contacts JSONB DEFAULT '[]'::jsonb,
      party_type TEXT DEFAULT 'customer',
      supplier_category TEXT DEFAULT '',
      bank_info JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW(),
      is_deleted INTEGER DEFAULT 0
    )`
  },
  {
    id: '008_items',
    name: 'Create items table',
    sql: `CREATE TABLE IF NOT EXISTS items (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      current_stock NUMERIC(18, 4) DEFAULT 0,
      unit TEXT NOT NULL,
      category TEXT DEFAULT '',
      image TEXT DEFAULT '',
      thumbnail TEXT DEFAULT '',
      reorder_point NUMERIC(18, 4) DEFAULT 0,
      weighted_average_cost NUMERIC(18, 4) DEFAULT 0,
      stocks JSONB DEFAULT '{}'::jsonb,
      color TEXT,
      weight NUMERIC(18, 4),
      material TEXT,
      size TEXT,
      last_kardex_rebuild_at TIMESTAMP,
      is_deleted INTEGER DEFAULT 0
    )`
  },
  {
    id: '009_documents',
    name: 'Create documents table',
    sql: `CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      ref_number TEXT NOT NULL,
      date TIMESTAMP NOT NULL DEFAULT NOW(),
      "user" TEXT,
      notes TEXT,
      buyer_name TEXT DEFAULT '',
      buyer_city TEXT DEFAULT '',
      buyer_phone TEXT DEFAULT '',
      buyer_address TEXT DEFAULT '',
      status TEXT DEFAULT 'final',
      currency TEXT DEFAULT 'IRR',
      is_deleted INTEGER DEFAULT 0
    )`
  },
  {
    id: '010_document_items',
    name: 'Create document_items table',
    sql: `CREATE TABLE IF NOT EXISTS document_items (
      id SERIAL PRIMARY KEY,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      item_id INTEGER NOT NULL REFERENCES items(id),
      quantity NUMERIC(18, 4) NOT NULL,
      unit_price NUMERIC(18, 4) DEFAULT 0,
      discount NUMERIC(18, 4) DEFAULT 0,
      location TEXT DEFAULT 'main'
    )`
  },
  {
    id: '011_transactions',
    name: 'Create transactions table',
    sql: `CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      item_id INTEGER NOT NULL REFERENCES items(id),
      document_id INTEGER REFERENCES documents(id),
      type TEXT NOT NULL,
      quantity NUMERIC(18, 4) NOT NULL,
      unit_price NUMERIC(18, 4) DEFAULT 0,
      total_price NUMERIC(18, 4) DEFAULT 0,
      date TIMESTAMP NOT NULL DEFAULT NOW(),
      document_type TEXT,
      document_ref TEXT,
      created_by TEXT,
      notes TEXT,
      location TEXT DEFAULT 'main',
      is_deleted INTEGER DEFAULT 0
    )`
  },
  {
    id: '012_item_prices',
    name: 'Create item_prices table',
    sql: `CREATE TABLE IF NOT EXISTS item_prices (
      id SERIAL PRIMARY KEY,
      item_id INTEGER NOT NULL REFERENCES items(id),
      title TEXT NOT NULL,
      price NUMERIC(18, 4) NOT NULL,
      currency TEXT DEFAULT 'IRR',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      is_deleted INTEGER DEFAULT 0
    )`
  },
  {
    id: '013_activity_logs',
    name: 'Create activity_logs table',
    sql: `CREATE TABLE IF NOT EXISTS activity_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      username TEXT NOT NULL,
      user_full_name TEXT DEFAULT '',
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT DEFAULT '',
      description TEXT NOT NULL,
      details JSONB DEFAULT '{}'::jsonb,
      ip_address TEXT DEFAULT '',
      timestamp TIMESTAMP DEFAULT NOW()
    )`
  },
  {
    id: '014_transfers',
    name: 'Create transfers table',
    sql: `CREATE TABLE IF NOT EXISTS transfers (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      title TEXT DEFAULT '',
      image TEXT DEFAULT '',
      thumbnail TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`
  },
  {
    id: '015_production_projects',
    name: 'Create production_projects table',
    sql: `CREATE TABLE IF NOT EXISTS production_projects (
      id SERIAL PRIMARY KEY,
      project_code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      customer_id INTEGER REFERENCES customers(id),
      customer_name TEXT DEFAULT '',
      item_id INTEGER REFERENCES items(id),
      item_code TEXT DEFAULT '',
      item_name TEXT DEFAULT '',
      quantity NUMERIC(18, 4) NOT NULL DEFAULT 1,
      unit TEXT DEFAULT 'عدد',
      start_date TEXT DEFAULT '',
      end_date TEXT DEFAULT '',
      status TEXT DEFAULT 'planned',
      priority TEXT DEFAULT 'medium',
      description TEXT DEFAULT '',
      products JSONB DEFAULT '[]'::jsonb,
      inventory_control JSONB DEFAULT '{}'::jsonb,
      stage_schedules JSONB DEFAULT '{}'::jsonb,
      custom_stages JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMP DEFAULT NOW(),
      created_by TEXT DEFAULT '',
      is_deleted INTEGER DEFAULT 0
    )`
  },
  {
    id: '016_project_stages',
    name: 'Create project_stages table',
    sql: `CREATE TABLE IF NOT EXISTS project_stages (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES production_projects(id) ON DELETE CASCADE,
      stage_order INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      start_date TEXT DEFAULT '',
      end_date TEXT DEFAULT '',
      assigned_personnel JSONB DEFAULT '[]'::jsonb,
      required_resources JSONB DEFAULT '[]'::jsonb,
      progress_percent INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      completed_at TEXT DEFAULT '',
      is_deleted INTEGER DEFAULT 0
    )`
  },
  {
    id: '017_daily_work_logs',
    name: 'Create daily_work_logs table',
    sql: `CREATE TABLE IF NOT EXISTS daily_work_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      username TEXT NOT NULL,
      user_full_name TEXT DEFAULT '',
      date TEXT NOT NULL,
      start_time TEXT DEFAULT '08:00',
      end_time TEXT DEFAULT '17:00',
      work_hours NUMERIC(18, 4) DEFAULT 8,
      work_mode TEXT DEFAULT 'onsite',
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      project_id INTEGER REFERENCES production_projects(id),
      project_name TEXT DEFAULT '',
      tags JSONB DEFAULT '[]'::jsonb,
      mentions JSONB DEFAULT '[]'::jsonb,
      visibility TEXT DEFAULT 'public',
      allowed_users JSONB DEFAULT '[]'::jsonb,
      status TEXT DEFAULT 'submitted',
      manager_notes TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW(),
      is_deleted INTEGER DEFAULT 0
    )`
  },
  {
    id: '018_notifications',
    name: 'Create notifications table',
    sql: `CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      sender_id INTEGER REFERENCES users(id),
      sender_name TEXT DEFAULT '',
      type TEXT DEFAULT 'mention',
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      link TEXT DEFAULT '',
      is_read INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )`
  },
  {
    id: '019_crm_leads',
    name: 'Create crm_leads table',
    sql: `CREATE TABLE IF NOT EXISTS crm_leads (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      customer_id INTEGER REFERENCES customers(id),
      customer_name TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      company TEXT DEFAULT '',
      source TEXT DEFAULT 'تماس تلفنی',
      stage TEXT DEFAULT 'lead',
      estimated_value NUMERIC(18, 4) DEFAULT 0,
      currency TEXT DEFAULT 'IRR',
      probability INTEGER DEFAULT 50,
      assigned_to TEXT DEFAULT '',
      expected_close_date TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      contacts JSONB DEFAULT '[]'::jsonb,
      has_proforma INTEGER DEFAULT 0,
      proforma_id INTEGER,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      created_by TEXT DEFAULT '',
      is_deleted INTEGER DEFAULT 0
    )`
  },
  {
    id: '020_crm_activities',
    name: 'Create crm_activities table',
    sql: `CREATE TABLE IF NOT EXISTS crm_activities (
      id SERIAL PRIMARY KEY,
      lead_id INTEGER REFERENCES crm_leads(id) ON DELETE CASCADE,
      customer_id INTEGER REFERENCES customers(id),
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      result TEXT DEFAULT '',
      logged_by TEXT DEFAULT '',
      assigned_to TEXT DEFAULT '',
      mentions JSONB DEFAULT '[]'::jsonb,
      activity_date TEXT DEFAULT '',
      next_followup_date TEXT DEFAULT '',
      next_followup_task TEXT DEFAULT '',
      is_followup_completed INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      is_deleted INTEGER DEFAULT 0
    )`
  },
  {
    id: '021_personnel',
    name: 'Create personnel table',
    sql: `CREATE TABLE IF NOT EXISTS personnel (
      id SERIAL PRIMARY KEY,
      first_name TEXT DEFAULT '',
      last_name TEXT DEFAULT '',
      full_name TEXT NOT NULL,
      personnel_code TEXT DEFAULT '',
      user_id INTEGER REFERENCES users(id),
      gender TEXT DEFAULT 'مرد',
      birth_date TEXT DEFAULT '',
      nationality TEXT DEFAULT 'ایرانی',
      national_id TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      employment_status TEXT DEFAULT 'فعال',
      job_title TEXT DEFAULT '',
      education TEXT DEFAULT '',
      end_date TEXT DEFAULT '',
      termination_reason TEXT DEFAULT '',
      specialized_skills TEXT DEFAULT '',
      other_skills TEXT DEFAULT '',
      referral_source TEXT DEFAULT '',
      card_number TEXT DEFAULT '',
      account_number TEXT DEFAULT '',
      sheba_number TEXT DEFAULT '',
      bank_name TEXT DEFAULT '',
      nobitex_username TEXT DEFAULT '',
      nobitex_password TEXT DEFAULT '',
      address TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      is_deleted INTEGER DEFAULT 0
    )`
  },
  {
    id: '022_task_categories',
    name: 'Create task_categories table',
    sql: `CREATE TABLE IF NOT EXISTS task_categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      is_deleted INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )`
  },
  {
    id: '023_piecework_tasks',
    name: 'Create piecework_tasks table',
    sql: `CREATE TABLE IF NOT EXISTS piecework_tasks (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT DEFAULT 'سایر',
      default_rate NUMERIC(18, 4) DEFAULT 0,
      unit TEXT DEFAULT 'عدد',
      description TEXT DEFAULT '',
      is_active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT NOW(),
      is_deleted INTEGER DEFAULT 0
    )`
  },
  {
    id: '024_piecework_personnel_rates',
    name: 'Create piecework_personnel_rates table',
    sql: `CREATE TABLE IF NOT EXISTS piecework_personnel_rates (
      id SERIAL PRIMARY KEY,
      personnel_id INTEGER NOT NULL REFERENCES personnel(id),
      task_id INTEGER NOT NULL REFERENCES piecework_tasks(id),
      custom_rate NUMERIC(18, 4) NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW(),
      is_deleted INTEGER DEFAULT 0
    )`
  },
  {
    id: '025_piecework_logs',
    name: 'Create piecework_logs table',
    sql: `CREATE TABLE IF NOT EXISTS piecework_logs (
      id SERIAL PRIMARY KEY,
      personnel_id INTEGER NOT NULL REFERENCES personnel(id),
      task_id INTEGER NOT NULL REFERENCES piecework_tasks(id),
      project_id INTEGER REFERENCES production_projects(id),
      date TEXT NOT NULL,
      quantity NUMERIC(18, 4) NOT NULL,
      unit_rate NUMERIC(18, 4) NOT NULL,
      total_amount NUMERIC(18, 4) NOT NULL,
      notes TEXT DEFAULT '',
      payroll_id INTEGER,
      status TEXT DEFAULT 'pending',
      created_by_id INTEGER REFERENCES users(id),
      created_by_username TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW(),
      is_deleted INTEGER DEFAULT 0
    )`
  },
  {
    id: '026_piecework_payrolls',
    name: 'Create piecework_payrolls table',
    sql: `CREATE TABLE IF NOT EXISTS piecework_payrolls (
      id SERIAL PRIMARY KEY,
      payroll_number TEXT NOT NULL,
      personnel_id INTEGER NOT NULL REFERENCES personnel(id),
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      title TEXT NOT NULL,
      total_piecework_amount NUMERIC(18, 4) DEFAULT 0,
      total_bonuses NUMERIC(18, 4) DEFAULT 0,
      total_deductions NUMERIC(18, 4) DEFAULT 0,
      net_payable NUMERIC(18, 4) NOT NULL,
      status TEXT DEFAULT 'draft',
      payment_date TEXT DEFAULT '',
      payment_method TEXT DEFAULT '',
      payment_reference TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_by_id INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      is_deleted INTEGER DEFAULT 0
    )`
  },
  {
    id: '027_pending_materials',
    name: 'Create pending_materials table',
    sql: `CREATE TABLE IF NOT EXISTS pending_materials (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      category TEXT DEFAULT '',
      type TEXT DEFAULT 'raw_material',
      project_id INTEGER,
      project_title TEXT DEFAULT '',
      requested_by TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      reorder_point NUMERIC(18, 4) DEFAULT 0,
      weighted_average_cost NUMERIC(18, 4) DEFAULT 0,
      color TEXT DEFAULT '',
      weight NUMERIC(18, 4) DEFAULT 0,
      material TEXT DEFAULT '',
      size TEXT DEFAULT '',
      image TEXT DEFAULT '',
      thumbnail TEXT DEFAULT '',
      rejection_reason TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW(),
      is_deleted INTEGER DEFAULT 0
    )`
  },
  {
    id: '028_accounts',
    name: 'Create accounts table',
    sql: `CREATE TABLE IF NOT EXISTS accounts (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      level TEXT NOT NULL,
      parent_id INTEGER,
      account_type TEXT NOT NULL,
      nature TEXT NOT NULL,
      description TEXT DEFAULT '',
      is_system INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT NOW(),
      is_deleted INTEGER DEFAULT 0
    )`
  },
  {
    id: '029_journal_vouchers',
    name: 'Create journal_vouchers table',
    sql: `CREATE TABLE IF NOT EXISTS journal_vouchers (
      id SERIAL PRIMARY KEY,
      voucher_number INTEGER NOT NULL,
      manual_voucher_number TEXT DEFAULT '',
      date TEXT NOT NULL,
      voucher_type TEXT DEFAULT 'general',
      status TEXT DEFAULT 'approved',
      total_debit NUMERIC(18, 4) DEFAULT 0,
      total_credit NUMERIC(18, 4) DEFAULT 0,
      description TEXT NOT NULL,
      reference_module TEXT DEFAULT 'manual',
      reference_id INTEGER,
      reference_number TEXT DEFAULT '',
      currency TEXT DEFAULT 'IRR',
      created_by_id INTEGER,
      created_by_username TEXT DEFAULT '',
      approved_by_id INTEGER,
      created_at TIMESTAMP DEFAULT NOW(),
      is_deleted INTEGER DEFAULT 0
    )`
  },
  {
    id: '030_journal_voucher_items',
    name: 'Create journal_voucher_items table',
    sql: `CREATE TABLE IF NOT EXISTS journal_voucher_items (
      id SERIAL PRIMARY KEY,
      voucher_id INTEGER NOT NULL REFERENCES journal_vouchers(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      row_order INTEGER DEFAULT 1,
      detailed_type TEXT DEFAULT 'none',
      detailed_id INTEGER,
      detailed_name TEXT DEFAULT '',
      debit NUMERIC(18, 4) DEFAULT 0,
      credit NUMERIC(18, 4) DEFAULT 0,
      currency TEXT DEFAULT 'IRR',
      exchange_rate NUMERIC(18, 4) DEFAULT 1,
      description TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW()
    )`
  },
  {
    id: '031_bank_accounts',
    name: 'Create bank_accounts table',
    sql: `CREATE TABLE IF NOT EXISTS bank_accounts (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT DEFAULT 'bank',
      bank_name TEXT DEFAULT '',
      account_number TEXT DEFAULT '',
      sheba_number TEXT DEFAULT '',
      card_number TEXT DEFAULT '',
      branch TEXT DEFAULT '',
      initial_balance NUMERIC(18, 4) DEFAULT 0,
      current_balance NUMERIC(18, 4) DEFAULT 0,
      currency TEXT DEFAULT 'IRR',
      account_id INTEGER REFERENCES accounts(id),
      is_active INTEGER DEFAULT 1,
      notes TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW(),
      is_deleted INTEGER DEFAULT 0
    )`
  },
  {
    id: '032_cheques',
    name: 'Create cheques table',
    sql: `CREATE TABLE IF NOT EXISTS cheques (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      cheque_number TEXT NOT NULL,
      sayad_number TEXT DEFAULT '',
      bank_name TEXT NOT NULL,
      branch TEXT DEFAULT '',
      issue_date TEXT NOT NULL,
      due_date TEXT NOT NULL,
      amount NUMERIC(18, 4) NOT NULL,
      currency TEXT DEFAULT 'IRR',
      party_type TEXT DEFAULT 'customer',
      party_id INTEGER,
      party_name TEXT NOT NULL,
      status TEXT DEFAULT 'received',
      drawer_name TEXT DEFAULT '',
      payee_name TEXT DEFAULT '',
      bank_account_id INTEGER REFERENCES bank_accounts(id),
      voucher_id INTEGER REFERENCES journal_vouchers(id),
      description TEXT DEFAULT '',
      status_history JSONB DEFAULT '[]'::jsonb,
      created_by_id INTEGER,
      created_at TIMESTAMP DEFAULT NOW(),
      is_deleted INTEGER DEFAULT 0
    )`
  },
  {
    id: '033_treasury_transactions',
    name: 'Create treasury_transactions table',
    sql: `CREATE TABLE IF NOT EXISTS treasury_transactions (
      id SERIAL PRIMARY KEY,
      transaction_number TEXT NOT NULL,
      type TEXT NOT NULL,
      date TEXT NOT NULL,
      method TEXT NOT NULL,
      amount NUMERIC(18, 4) NOT NULL,
      currency TEXT DEFAULT 'IRR',
      exchange_rate NUMERIC(18, 4) DEFAULT 1,
      bank_account_id INTEGER REFERENCES bank_accounts(id),
      party_type TEXT DEFAULT 'customer',
      party_id INTEGER,
      party_name TEXT NOT NULL,
      tracking_number TEXT DEFAULT '',
      voucher_id INTEGER REFERENCES journal_vouchers(id),
      cheque_id INTEGER REFERENCES cheques(id),
      document_id INTEGER,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'completed',
      created_by_id INTEGER,
      created_at TIMESTAMP DEFAULT NOW(),
      is_deleted INTEGER DEFAULT 0
    )`
  },
  {
    id: '034_accounting_settings',
    name: 'Create accounting_settings table',
    sql: `CREATE TABLE IF NOT EXISTS accounting_settings (
      id SERIAL PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      value JSONB DEFAULT '{}'::jsonb,
      account_id INTEGER,
      description TEXT DEFAULT '',
      updated_at TIMESTAMP DEFAULT NOW()
    )`
  },
  {
    id: '035_workflow_definitions',
    name: 'Create workflow_definitions table',
    sql: `CREATE TABLE IF NOT EXISTS workflow_definitions (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      version INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 1,
      description TEXT DEFAULT '',
      dsl_json JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    )`
  },
  {
    id: '036_workflow_states',
    name: 'Create workflow_states table',
    sql: `CREATE TABLE IF NOT EXISTS workflow_states (
      id SERIAL PRIMARY KEY,
      workflow_definition_id INTEGER NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
      state_key TEXT NOT NULL,
      title TEXT NOT NULL,
      state_type TEXT DEFAULT 'intermediate',
      color TEXT DEFAULT 'gray',
      step_order INTEGER DEFAULT 0
    )`
  },
  {
    id: '037_workflow_transitions',
    name: 'Create workflow_transitions table',
    sql: `CREATE TABLE IF NOT EXISTS workflow_transitions (
      id SERIAL PRIMARY KEY,
      workflow_definition_id INTEGER NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
      from_state_id INTEGER NOT NULL REFERENCES workflow_states(id) ON DELETE CASCADE,
      to_state_id INTEGER NOT NULL REFERENCES workflow_states(id) ON DELETE CASCADE,
      action_key TEXT NOT NULL,
      title TEXT NOT NULL,
      required_role TEXT DEFAULT '',
      required_permission TEXT DEFAULT '',
      approval_rule_type TEXT DEFAULT 'SINGLE',
      k_value INTEGER DEFAULT 1,
      rule_conditions_json JSONB DEFAULT '[]'::jsonb,
      auto_action_key TEXT DEFAULT ''
    )`
  },
  {
    id: '038_workflow_instances',
    name: 'Create workflow_instances table',
    sql: `CREATE TABLE IF NOT EXISTS workflow_instances (
      id SERIAL PRIMARY KEY,
      workflow_definition_id INTEGER NOT NULL REFERENCES workflow_definitions(id),
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      current_state_id INTEGER NOT NULL REFERENCES workflow_states(id),
      status TEXT DEFAULT 'IN_PROGRESS',
      started_by INTEGER REFERENCES users(id),
      started_by_name TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`
  },
  {
    id: '039_workflow_pending_approvals',
    name: 'Create workflow_pending_approvals table',
    sql: `CREATE TABLE IF NOT EXISTS workflow_pending_approvals (
      id SERIAL PRIMARY KEY,
      instance_id INTEGER NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
      transition_id INTEGER NOT NULL REFERENCES workflow_transitions(id),
      assigned_role TEXT DEFAULT '',
      assigned_user_id INTEGER REFERENCES users(id),
      status TEXT DEFAULT 'PENDING',
      created_at TIMESTAMP DEFAULT NOW()
    )`
  },
  {
    id: '040_workflow_history_logs',
    name: 'Create workflow_history_logs table',
    sql: `CREATE TABLE IF NOT EXISTS workflow_history_logs (
      id SERIAL PRIMARY KEY,
      instance_id INTEGER NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
      from_state_id INTEGER REFERENCES workflow_states(id),
      to_state_id INTEGER REFERENCES workflow_states(id),
      transition_id INTEGER REFERENCES workflow_transitions(id),
      performed_by INTEGER REFERENCES users(id),
      performed_by_name TEXT DEFAULT '',
      action_key TEXT NOT NULL,
      action_title TEXT DEFAULT '',
      comment TEXT DEFAULT '',
      snapshot_data JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    )`
  },
  {
    id: '041_workflow_instances_phase2',
    name: 'Add phase 2 columns to workflow_instances',
    sql: `
      ALTER TABLE workflow_instances ADD COLUMN IF NOT EXISTS definition_version INTEGER DEFAULT 1;
      ALTER TABLE workflow_instances ADD COLUMN IF NOT EXISTS snapshot_dsl JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE workflow_instances ADD COLUMN IF NOT EXISTS approval_progress_json JSONB DEFAULT '{}'::jsonb;
    `
  },
  {
    id: '042_workflow_phase3_sla',
    name: 'Add phase 3 SLA and canvas columns to workflow_states',
    sql: `
      ALTER TABLE workflow_states ADD COLUMN IF NOT EXISTS sla_hours INTEGER DEFAULT 24;
      ALTER TABLE workflow_states ADD COLUMN IF NOT EXISTS position_x INTEGER DEFAULT 100;
      ALTER TABLE workflow_states ADD COLUMN IF NOT EXISTS position_y INTEGER DEFAULT 100;
    `
  },
  {
    id: '043_workflow_definition_versions',
    name: 'Create workflow_definition_versions table',
    sql: `CREATE TABLE IF NOT EXISTS workflow_definition_versions (
      id SERIAL PRIMARY KEY,
      definition_id INTEGER NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      dsl_json JSONB DEFAULT '{}'::jsonb,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    )`
  },
  {
    id: '044_workflow_tasks',
    name: 'Create workflow_tasks table',
    sql: `CREATE TABLE IF NOT EXISTS workflow_tasks (
      id SERIAL PRIMARY KEY,
      instance_id INTEGER NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
      transition_id INTEGER REFERENCES workflow_transitions(id),
      assigned_user_id INTEGER REFERENCES users(id),
      assigned_role TEXT DEFAULT '',
      candidate_users JSONB DEFAULT '[]'::jsonb,
      candidate_roles JSONB DEFAULT '[]'::jsonb,
      delegated_to_user_id INTEGER REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'pending',
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      due_at TIMESTAMP,
      completed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )`
  },
  {
    id: '045_workflow_delegations',
    name: 'Create workflow_delegations table',
    sql: `CREATE TABLE IF NOT EXISTS workflow_delegations (
      id SERIAL PRIMARY KEY,
      from_user_id INTEGER NOT NULL REFERENCES users(id),
      to_user_id INTEGER NOT NULL REFERENCES users(id),
      scope TEXT NOT NULL DEFAULT 'ALL',
      start_date TIMESTAMP NOT NULL,
      end_date TIMESTAMP NOT NULL,
      is_active INTEGER DEFAULT 1,
      reason TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW()
    )`
  },
  {
    id: '046_outbox_events',
    name: 'Create outbox_events table',
    sql: `CREATE TABLE IF NOT EXISTS outbox_events (
      id SERIAL PRIMARY KEY,
      event_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      payload JSONB DEFAULT '{}'::jsonb,
      metadata JSONB DEFAULT '{}'::jsonb,
      retry_count INTEGER DEFAULT 0,
      next_retry_at TIMESTAMP,
      last_error TEXT DEFAULT '',
      occurred_at TIMESTAMP DEFAULT NOW(),
      processed_at TIMESTAMP
    )`
  },
  {
    id: '047_event_action_rules',
    name: 'Create event_action_rules table',
    sql: `CREATE TABLE IF NOT EXISTS event_action_rules (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      event_type TEXT NOT NULL,
      conditions_json JSONB DEFAULT '[]'::jsonb,
      action_type TEXT NOT NULL,
      action_config_json JSONB DEFAULT '{}'::jsonb,
      is_active INTEGER DEFAULT 1,
      execution_count INTEGER DEFAULT 0,
      last_executed_at TIMESTAMP,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`
  },
  {
    id: '048_event_action_logs',
    name: 'Create event_action_logs table',
    sql: `CREATE TABLE IF NOT EXISTS event_action_logs (
      id SERIAL PRIMARY KEY,
      rule_id INTEGER REFERENCES event_action_rules(id) ON DELETE CASCADE,
      rule_name TEXT DEFAULT '',
      event_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      action_type TEXT NOT NULL,
      status TEXT NOT NULL,
      result JSONB DEFAULT '{}'::jsonb,
      error_message TEXT DEFAULT '',
      execution_duration_ms INTEGER DEFAULT 0,
      executed_at TIMESTAMP DEFAULT NOW()
    )`
  },
  {
    id: '049_dead_letter_events',
    name: 'Create dead_letter_events table',
    sql: `CREATE TABLE IF NOT EXISTS dead_letter_events (
      id SERIAL PRIMARY KEY,
      original_event_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'outbox',
      payload JSONB DEFAULT '{}'::jsonb,
      metadata JSONB DEFAULT '{}'::jsonb,
      failure_reason TEXT NOT NULL,
      error_stack TEXT DEFAULT '',
      retry_count INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'quarantined',
      quarantined_at TIMESTAMP DEFAULT NOW(),
      resolved_at TIMESTAMP,
      resolved_by INTEGER REFERENCES users(id),
      resolution_notes TEXT DEFAULT ''
    )`
  },
  {
    id: '050_webhook_subscriptions',
    name: 'Create webhook_subscriptions table',
    sql: `CREATE TABLE IF NOT EXISTS webhook_subscriptions (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      target_url TEXT NOT NULL,
      secret_key TEXT NOT NULL,
      event_patterns JSONB DEFAULT '["*"]'::jsonb,
      custom_headers JSONB DEFAULT '{}'::jsonb,
      is_active INTEGER DEFAULT 1,
      retry_limit INTEGER DEFAULT 3,
      timeout_ms INTEGER DEFAULT 5000,
      total_deliveries INTEGER DEFAULT 0,
      successful_deliveries INTEGER DEFAULT 0,
      failed_deliveries INTEGER DEFAULT 0,
      last_delivery_at TIMESTAMP,
      last_status TEXT DEFAULT 'idle',
      last_error TEXT DEFAULT '',
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`
  },
  {
    id: '051_webhook_deliveries',
    name: 'Create webhook_deliveries table',
    sql: `CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id SERIAL PRIMARY KEY,
      subscription_id INTEGER NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
      subscription_name TEXT DEFAULT '',
      event_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      target_url TEXT NOT NULL,
      status_code INTEGER DEFAULT 0,
      status TEXT NOT NULL,
      response_body TEXT DEFAULT '',
      error_message TEXT DEFAULT '',
      signature TEXT DEFAULT '',
      attempt INTEGER DEFAULT 1,
      duration_ms INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )`
  },
  {
    id: '052_woocommerce_order_logs',
    name: 'Create woocommerce_order_logs table',
    sql: `CREATE TABLE IF NOT EXISTS woocommerce_order_logs (
      id SERIAL PRIMARY KEY,
      wc_order_id TEXT NOT NULL UNIQUE,
      erp_document_id INTEGER,
      status TEXT NOT NULL,
      buyer_name TEXT DEFAULT '',
      total_amount NUMERIC(18, 4) DEFAULT 0,
      payload JSONB,
      error_message TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`
  },
  {
    id: '053_idempotency_keys',
    name: 'Create idempotency_keys table',
    sql: `CREATE TABLE IF NOT EXISTS idempotency_keys (
      id SERIAL PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      scope TEXT NOT NULL DEFAULT 'global',
      status TEXT NOT NULL DEFAULT 'processing',
      request_method TEXT,
      request_path TEXT,
      request_payload JSONB,
      response_status INTEGER,
      response_body JSONB,
      created_by_id INTEGER REFERENCES users(id),
      locked_at TIMESTAMP,
      locked_until TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      completed_at TIMESTAMP,
      expires_at TIMESTAMP
    )`
  },
  {
    id: '054_form_drafts',
    name: 'Create form_drafts table',
    sql: `CREATE TABLE IF NOT EXISTS form_drafts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      username TEXT DEFAULT '',
      session_id TEXT DEFAULT '',
      entity_type TEXT NOT NULL,
      draft_key TEXT DEFAULT 'default',
      payload JSONB NOT NULL,
      summary TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP,
      is_deleted INTEGER DEFAULT 0
    )`
  },
  {
    id: '055_project_bom_allocations',
    name: 'Create project_bom_allocations table',
    sql: `CREATE TABLE IF NOT EXISTS project_bom_allocations (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES production_projects(id),
      project_code TEXT NOT NULL,
      item_id INTEGER NOT NULL REFERENCES items(id),
      item_code TEXT NOT NULL,
      item_name TEXT NOT NULL,
      quantity NUMERIC(18, 4) NOT NULL,
      unit TEXT DEFAULT 'عدد',
      source_transaction_id INTEGER REFERENCES transactions(id),
      source_location TEXT DEFAULT 'main',
      status TEXT NOT NULL DEFAULT 'allocated',
      user_id INTEGER REFERENCES users(id),
      username TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      allocated_at TIMESTAMP DEFAULT NOW(),
      consumed_at TIMESTAMP,
      released_at TIMESTAMP,
      is_deleted INTEGER DEFAULT 0
    )`
  }
];

/**
 * Self-healing column synchronization & index migrations
 */
export const SCHEMA_ALTERATIONS: MigrationStep[] = [
  { id: 'alt_001_categories_default_unit', name: 'Add default_unit to categories', sql: "ALTER TABLE categories ADD COLUMN IF NOT EXISTS default_unit text DEFAULT 'عدد'" },
  { id: 'alt_002_crm_activities_fields', name: 'Add missing columns to crm_activities', sql: `
    ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS assigned_to text DEFAULT '';
    ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS mentions jsonb DEFAULT '[]'::jsonb;
    ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS activity_date text DEFAULT '';
    ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS next_followup_date text DEFAULT '';
    ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS next_followup_task text DEFAULT '';
    ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS is_followup_completed integer DEFAULT 0;
    ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS is_deleted integer DEFAULT 0;
  ` },
  { id: 'alt_003_crm_leads_fields', name: 'Add missing columns to crm_leads', sql: `
    ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS has_proforma integer DEFAULT 0;
    ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS proforma_id integer;
    ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS assigned_to text DEFAULT '';
    ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS contacts jsonb DEFAULT '[]'::jsonb;
  ` },
  { id: 'alt_004_users_avatar', name: 'Add avatar_url to users', sql: "ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text DEFAULT ''" },
  { id: 'alt_005_notifications_fields', name: 'Add missing columns to notifications', sql: `
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS sender_name text DEFAULT '';
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link text DEFAULT '';
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read integer DEFAULT 0;
  ` },
  { id: 'alt_006_personnel_fields', name: 'Add missing columns to personnel', sql: `
    ALTER TABLE personnel ADD COLUMN IF NOT EXISTS nobitex_username text DEFAULT '';
    ALTER TABLE personnel ADD COLUMN IF NOT EXISTS nobitex_password text DEFAULT '';
    ALTER TABLE personnel ADD COLUMN IF NOT EXISTS card_number text DEFAULT '';
    ALTER TABLE personnel ADD COLUMN IF NOT EXISTS account_number text DEFAULT '';
    ALTER TABLE personnel ADD COLUMN IF NOT EXISTS sheba_number text DEFAULT '';
    ALTER TABLE personnel ADD COLUMN IF NOT EXISTS bank_name text DEFAULT '';
    ALTER TABLE personnel ADD COLUMN IF NOT EXISTS is_deleted integer DEFAULT 0;
  ` },
  { id: 'alt_007_customers_fields', name: 'Add missing columns to customers', sql: `
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS contact_name text DEFAULT '';
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS country text DEFAULT 'ایران';
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS province text DEFAULT '';
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS contacts jsonb DEFAULT '[]'::jsonb;
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS party_type text DEFAULT 'customer';
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS supplier_category text DEFAULT '';
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS bank_info jsonb DEFAULT '{}'::jsonb;
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_deleted integer DEFAULT 0;
  ` },
  { id: 'alt_008_transactions_fields', name: 'Add missing columns to transactions', sql: `
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS location text DEFAULT 'main';
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS notes text DEFAULT '';
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS document_type text;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS document_ref text;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS created_by text;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS document_id integer;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reversal_of_id integer;
    ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS locked_at timestamp;
  ` },
  { id: 'alt_009_production_projects_fields', name: 'Add jsonb fields to production_projects', sql: `
    ALTER TABLE production_projects ADD COLUMN IF NOT EXISTS products jsonb DEFAULT '[]'::jsonb;
    ALTER TABLE production_projects ADD COLUMN IF NOT EXISTS inventory_control jsonb DEFAULT '{}'::jsonb;
    ALTER TABLE production_projects ADD COLUMN IF NOT EXISTS stage_schedules jsonb DEFAULT '{}'::jsonb;
    ALTER TABLE production_projects ADD COLUMN IF NOT EXISTS custom_stages jsonb DEFAULT '[]'::jsonb;
  ` },
  { id: 'alt_010_items_fields', name: 'Add missing columns to items', sql: `
    ALTER TABLE items ADD COLUMN IF NOT EXISTS stocks jsonb DEFAULT '{}'::jsonb;
    ALTER TABLE items ADD COLUMN IF NOT EXISTS color text;
    ALTER TABLE items ADD COLUMN IF NOT EXISTS weight numeric(18, 4);
    ALTER TABLE items ADD COLUMN IF NOT EXISTS material text;
    ALTER TABLE items ADD COLUMN IF NOT EXISTS size text;
  ` },
  {
    id: 'alt_011_type_conversions',
    name: 'Self-healing legacy type conversions to NUMERIC(18,4) and TIMESTAMP',
    sql: `DO $$
    BEGIN
      -- Date text to timestamp conversions
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'date' AND data_type = 'text') THEN
        ALTER TABLE transactions ALTER COLUMN date TYPE timestamp USING date::timestamp;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'documents' AND column_name = 'date' AND data_type = 'text') THEN
        ALTER TABLE documents ALTER COLUMN date TYPE timestamp USING date::timestamp;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'changelogs' AND column_name = 'date' AND data_type = 'text') THEN
        ALTER TABLE changelogs ALTER COLUMN date TYPE timestamp USING date::timestamp;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'created_at' AND data_type = 'text') THEN
        ALTER TABLE customers ALTER COLUMN created_at TYPE timestamp USING created_at::timestamp;
        ALTER TABLE customers ALTER COLUMN created_at SET DEFAULT now();
      END IF;

      -- Financial & Quantity Numeric(18, 4) Conversions
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'items' AND column_name = 'current_stock' AND data_type = 'double precision') THEN
        ALTER TABLE items ALTER COLUMN current_stock TYPE NUMERIC(18, 4) USING current_stock::numeric(18, 4);
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'items' AND column_name = 'reorder_point' AND data_type = 'double precision') THEN
        ALTER TABLE items ALTER COLUMN reorder_point TYPE NUMERIC(18, 4) USING reorder_point::numeric(18, 4);
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'items' AND column_name = 'weighted_average_cost' AND data_type = 'double precision') THEN
        ALTER TABLE items ALTER COLUMN weighted_average_cost TYPE NUMERIC(18, 4) USING weighted_average_cost::numeric(18, 4);
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'items' AND column_name = 'weight' AND data_type = 'double precision') THEN
        ALTER TABLE items ALTER COLUMN weight TYPE NUMERIC(18, 4) USING weight::numeric(18, 4);
      END IF;

      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'quantity' AND data_type = 'double precision') THEN
        ALTER TABLE transactions ALTER COLUMN quantity TYPE NUMERIC(18, 4) USING quantity::numeric(18, 4);
      END IF;

      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'document_items' AND column_name = 'quantity' AND data_type = 'double precision') THEN
        ALTER TABLE document_items ALTER COLUMN quantity TYPE NUMERIC(18, 4) USING quantity::numeric(18, 4);
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'document_items' AND column_name = 'unit_price' AND data_type = 'double precision') THEN
        ALTER TABLE document_items ALTER COLUMN unit_price TYPE NUMERIC(18, 4) USING unit_price::numeric(18, 4);
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'document_items' AND column_name = 'discount' AND data_type = 'double precision') THEN
        ALTER TABLE document_items ALTER COLUMN discount TYPE NUMERIC(18, 4) USING discount::numeric(18, 4);
      END IF;

      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'item_prices' AND column_name = 'price' AND data_type = 'double precision') THEN
        ALTER TABLE item_prices ALTER COLUMN price TYPE NUMERIC(18, 4) USING price::numeric(18, 4);
      END IF;

      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'production_projects' AND column_name = 'quantity' AND data_type = 'double precision') THEN
        ALTER TABLE production_projects ALTER COLUMN quantity TYPE NUMERIC(18, 4) USING quantity::numeric(18, 4);
      END IF;

      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'daily_work_logs' AND column_name = 'work_hours' AND data_type = 'double precision') THEN
        ALTER TABLE daily_work_logs ALTER COLUMN work_hours TYPE NUMERIC(18, 4) USING work_hours::numeric(18, 4);
      END IF;

      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'crm_leads' AND column_name = 'estimated_value' AND data_type = 'double precision') THEN
        ALTER TABLE crm_leads ALTER COLUMN estimated_value TYPE NUMERIC(18, 4) USING estimated_value::numeric(18, 4);
      END IF;

      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'piecework_tasks' AND column_name = 'default_rate' AND data_type = 'double precision') THEN
        ALTER TABLE piecework_tasks ALTER COLUMN default_rate TYPE NUMERIC(18, 4) USING default_rate::numeric(18, 4);
      END IF;

      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'piecework_personnel_rates' AND column_name = 'custom_rate' AND data_type = 'double precision') THEN
        ALTER TABLE piecework_personnel_rates ALTER COLUMN custom_rate TYPE NUMERIC(18, 4) USING custom_rate::numeric(18, 4);
      END IF;

      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'piecework_logs' AND column_name = 'quantity' AND data_type = 'double precision') THEN
        ALTER TABLE piecework_logs ALTER COLUMN quantity TYPE NUMERIC(18, 4) USING quantity::numeric(18, 4);
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'piecework_logs' AND column_name = 'unit_rate' AND data_type = 'double precision') THEN
        ALTER TABLE piecework_logs ALTER COLUMN unit_rate TYPE NUMERIC(18, 4) USING unit_rate::numeric(18, 4);
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'piecework_logs' AND column_name = 'total_amount' AND data_type = 'double precision') THEN
        ALTER TABLE piecework_logs ALTER COLUMN total_amount TYPE NUMERIC(18, 4) USING total_amount::numeric(18, 4);
      END IF;

      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'piecework_payrolls' AND column_name = 'total_piecework_amount' AND data_type = 'double precision') THEN
        ALTER TABLE piecework_payrolls ALTER COLUMN total_piecework_amount TYPE NUMERIC(18, 4) USING total_piecework_amount::numeric(18, 4);
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'piecework_payrolls' AND column_name = 'total_bonuses' AND data_type = 'double precision') THEN
        ALTER TABLE piecework_payrolls ALTER COLUMN total_bonuses TYPE NUMERIC(18, 4) USING total_bonuses::numeric(18, 4);
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'piecework_payrolls' AND column_name = 'total_deductions' AND data_type = 'double precision') THEN
        ALTER TABLE piecework_payrolls ALTER COLUMN total_deductions TYPE NUMERIC(18, 4) USING total_deductions::numeric(18, 4);
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'piecework_payrolls' AND column_name = 'net_payable' AND data_type = 'double precision') THEN
        ALTER TABLE piecework_payrolls ALTER COLUMN net_payable TYPE NUMERIC(18, 4) USING net_payable::numeric(18, 4);
      END IF;

      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pending_materials' AND column_name = 'reorder_point' AND data_type = 'double precision') THEN
        ALTER TABLE pending_materials ALTER COLUMN reorder_point TYPE NUMERIC(18, 4) USING reorder_point::numeric(18, 4);
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pending_materials' AND column_name = 'weighted_average_cost' AND data_type = 'double precision') THEN
        ALTER TABLE pending_materials ALTER COLUMN weighted_average_cost TYPE NUMERIC(18, 4) USING weighted_average_cost::numeric(18, 4);
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pending_materials' AND column_name = 'weight' AND data_type = 'double precision') THEN
        ALTER TABLE pending_materials ALTER COLUMN weight TYPE NUMERIC(18, 4) USING weight::numeric(18, 4);
      END IF;

      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'journal_vouchers' AND column_name = 'total_debit' AND data_type = 'double precision') THEN
        ALTER TABLE journal_vouchers ALTER COLUMN total_debit TYPE NUMERIC(18, 4) USING total_debit::numeric(18, 4);
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'journal_vouchers' AND column_name = 'total_credit' AND data_type = 'double precision') THEN
        ALTER TABLE journal_vouchers ALTER COLUMN total_credit TYPE NUMERIC(18, 4) USING total_credit::numeric(18, 4);
      END IF;

      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'journal_voucher_items' AND column_name = 'debit' AND data_type = 'double precision') THEN
        ALTER TABLE journal_voucher_items ALTER COLUMN debit TYPE NUMERIC(18, 4) USING debit::numeric(18, 4);
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'journal_voucher_items' AND column_name = 'credit' AND data_type = 'double precision') THEN
        ALTER TABLE journal_voucher_items ALTER COLUMN credit TYPE NUMERIC(18, 4) USING credit::numeric(18, 4);
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'journal_voucher_items' AND column_name = 'exchange_rate' AND data_type = 'double precision') THEN
        ALTER TABLE journal_voucher_items ALTER COLUMN exchange_rate TYPE NUMERIC(18, 4) USING exchange_rate::numeric(18, 4);
      END IF;

      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bank_accounts' AND column_name = 'initial_balance' AND data_type = 'double precision') THEN
        ALTER TABLE bank_accounts ALTER COLUMN initial_balance TYPE NUMERIC(18, 4) USING initial_balance::numeric(18, 4);
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bank_accounts' AND column_name = 'current_balance' AND data_type = 'double precision') THEN
        ALTER TABLE bank_accounts ALTER COLUMN current_balance TYPE NUMERIC(18, 4) USING current_balance::numeric(18, 4);
      END IF;

      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cheques' AND column_name = 'amount' AND data_type = 'double precision') THEN
        ALTER TABLE cheques ALTER COLUMN amount TYPE NUMERIC(18, 4) USING amount::numeric(18, 4);
      END IF;

      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'treasury_transactions' AND column_name = 'amount' AND data_type = 'double precision') THEN
        ALTER TABLE treasury_transactions ALTER COLUMN amount TYPE NUMERIC(18, 4) USING amount::numeric(18, 4);
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'treasury_transactions' AND column_name = 'exchange_rate' AND data_type = 'double precision') THEN
        ALTER TABLE treasury_transactions ALTER COLUMN exchange_rate TYPE NUMERIC(18, 4) USING exchange_rate::numeric(18, 4);
      END IF;
    END $$;`
  },
  {
    id: 'alt_023_financial_check_constraints',
    name: 'Add financial and quantity non-negative check constraints',
    sql: `DO $$
    BEGIN
      -- CHECK constraints on journal_vouchers
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_jv_debit_positive') THEN
        ALTER TABLE journal_vouchers ADD CONSTRAINT chk_jv_debit_positive CHECK (total_debit >= 0);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_jv_credit_positive') THEN
        ALTER TABLE journal_vouchers ADD CONSTRAINT chk_jv_credit_positive CHECK (total_credit >= 0);
      END IF;

      -- CHECK constraints on journal_voucher_items
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_jvi_debit_positive') THEN
        ALTER TABLE journal_voucher_items ADD CONSTRAINT chk_jvi_debit_positive CHECK (debit >= 0);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_jvi_credit_positive') THEN
        ALTER TABLE journal_voucher_items ADD CONSTRAINT chk_jvi_credit_positive CHECK (credit >= 0);
      END IF;

      -- CHECK constraints on document_items
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_doc_items_qty_positive') THEN
        ALTER TABLE document_items ADD CONSTRAINT chk_doc_items_qty_positive CHECK (quantity >= 0);
      END IF;

      -- CHECK constraints on transactions
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tx_qty_positive') THEN
        ALTER TABLE transactions ADD CONSTRAINT chk_tx_qty_positive CHECK (quantity >= 0);
      END IF;

      -- CHECK constraints on cheques
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cheques_amount_positive') THEN
        ALTER TABLE cheques ADD CONSTRAINT chk_cheques_amount_positive CHECK (amount >= 0);
      END IF;

      -- CHECK constraints on treasury_transactions
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tt_amount_positive') THEN
        ALTER TABLE treasury_transactions ADD CONSTRAINT chk_tt_amount_positive CHECK (amount >= 0);
      END IF;
    END $$;`
  },
  {
    id: 'alt_017_occ_version_columns',
    name: 'Add OCC version column to key business tables',
    sql: `
      ALTER TABLE items ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1 NOT NULL;
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1 NOT NULL;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1 NOT NULL;
      ALTER TABLE production_projects ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1 NOT NULL;
      ALTER TABLE journal_vouchers ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1 NOT NULL;
      ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1 NOT NULL;
      ALTER TABLE cheques ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1 NOT NULL;
      ALTER TABLE treasury_transactions ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1 NOT NULL;
      ALTER TABLE workflow_instances ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1 NOT NULL;
    `
  },
  {
    id: 'alt_018_users_must_reset_password',
    name: 'Add must_reset_password column to users table',
    sql: `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS must_reset_password INTEGER DEFAULT 0;
    `
  },
  {
    id: 'alt_019_users_failed_login_lockout',
    name: 'Add failed_login_count and locked_until columns to users table',
    sql: `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INTEGER DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TEXT;
    `
  },
  {
    id: 'alt_020_voucher_number_sequence',
    name: 'Create journal_voucher_number_seq and synchronize with max voucher number',
    sql: `
      CREATE SEQUENCE IF NOT EXISTS journal_voucher_number_seq START WITH 1 INCREMENT BY 1;
      SELECT setval(
        'journal_voucher_number_seq',
        COALESCE(
          (SELECT MAX(voucher_number) FROM journal_vouchers WHERE is_deleted = 0),
          1
        )
      );
    `
  },
  {
    id: 'alt_021_treasury_tx_number_sequence',
    name: 'Create treasury_tx_number_seq and unique active index on treasury_transactions(transaction_number)',
    sql: `
      CREATE SEQUENCE IF NOT EXISTS treasury_tx_number_seq START WITH 1 INCREMENT BY 1;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_uniq_tt_number_active 
        ON treasury_transactions(transaction_number) 
        WHERE is_deleted = 0;
      SELECT setval(
        'treasury_tx_number_seq',
        GREATEST(
          COALESCE(
            (SELECT COUNT(*) FROM treasury_transactions WHERE is_deleted = 0),
            1
          ),
          1
        )
      );
    `
  },
  {
    id: 'alt_022_document_ref_counters',
    name: 'Create document_ref_counters table and synchronize maximum ref numbers',
    sql: `
      CREATE TABLE IF NOT EXISTS document_ref_counters (
        doc_type VARCHAR(20) NOT NULL,
        fiscal_year INT NOT NULL,
        last_ref_number INT NOT NULL DEFAULT 0,
        PRIMARY KEY (doc_type, fiscal_year)
      );
      INSERT INTO document_ref_counters (doc_type, fiscal_year, last_ref_number)
      SELECT 
        type AS doc_type, 
        COALESCE(EXTRACT(YEAR FROM date)::INT, 2026) AS fiscal_year, 
        COALESCE(MAX(NULLIF(REGEXP_REPLACE(ref_number, '\\D', '', 'g'), '')::INT), 0) AS last_ref_number
      FROM documents
      WHERE is_deleted = 0
      GROUP BY type, COALESCE(EXTRACT(YEAR FROM date)::INT, 2026)
      ON CONFLICT (doc_type, fiscal_year) DO NOTHING;
    `
  },
  {
    id: 'alt_023_transactions_unit_price',
    name: 'Add unit_price column to transactions table if missing',
    sql: `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS unit_price NUMERIC(18, 4) DEFAULT 0;`
  },
  {
    id: 'alt_024_transactions_total_price',
    name: 'Add total_price column to transactions table if missing',
    sql: `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS total_price NUMERIC(18, 4) DEFAULT 0;`
  },
  {
    id: 'alt_025_items_last_kardex_rebuild_at',
    name: 'Add last_kardex_rebuild_at column to items table if missing',
    sql: `ALTER TABLE items ADD COLUMN IF NOT EXISTS last_kardex_rebuild_at TIMESTAMP;`
  },
  {
    id: 'alt_026_stock_consistency_trigger',
    name: 'Create PostgreSQL function and trigger to ensure items.current_stock is atomic SUM(stocks)',
    sql: `
      CREATE OR REPLACE FUNCTION sync_item_current_stock()
      RETURNS TRIGGER AS $$
      DECLARE
        calculated_stock NUMERIC(18,4);
      BEGIN
        IF NEW.stocks IS NULL OR NEW.stocks = '{}'::jsonb THEN
          calculated_stock := 0;
        ELSE
          SELECT COALESCE(
            (SELECT SUM((NULLIF(value, '')::numeric)) FROM jsonb_each_text(NEW.stocks)),
            0
          ) INTO calculated_stock;
        END IF;
        
        IF NEW.current_stock IS DISTINCT FROM calculated_stock THEN
          RAISE NOTICE 'Stock consistency corrected for item %: % -> %', NEW.id, NEW.current_stock, calculated_stock;
          NEW.current_stock := calculated_stock;
        END IF;
        
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_sync_item_current_stock ON items;

      CREATE TRIGGER trg_sync_item_current_stock
      BEFORE INSERT OR UPDATE OF stocks, current_stock ON items
      FOR EACH ROW
      EXECUTE FUNCTION sync_item_current_stock();
    `
  },
  {
    id: 'alt_027_outbox_events_locked_columns',
    name: 'Add locked_at and locked_by columns to outbox_events table if missing',
    sql: `
      ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP;
      ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS locked_by TEXT DEFAULT '';
    `
  },
  {
    id: 'alt_028_jsonb_and_financial_check_constraints',
    name: 'Add JSONB type check constraints and non-negative financial amount check constraints',
    sql: `
      -- Data sanitization for legacy rows before enforcing check constraints
      UPDATE items SET stocks = '{}'::jsonb WHERE stocks IS NOT NULL AND jsonb_typeof(stocks) != 'object';
      UPDATE production_projects SET inventory_control = '{}'::jsonb WHERE inventory_control IS NOT NULL AND jsonb_typeof(inventory_control) != 'object';
      UPDATE cheques SET status_history = '[]'::jsonb WHERE status_history IS NOT NULL AND jsonb_typeof(status_history) != 'array';
      UPDATE workflow_instances SET snapshot_dsl = '{}'::jsonb WHERE snapshot_dsl IS NOT NULL AND jsonb_typeof(snapshot_dsl) != 'object';
      UPDATE items SET weighted_average_cost = 0 WHERE weighted_average_cost < 0;
      UPDATE bank_accounts SET initial_balance = 0 WHERE initial_balance < 0;
      UPDATE bank_accounts SET current_balance = 0 WHERE current_balance < 0;
      UPDATE treasury_transactions SET amount = 1 WHERE amount <= 0;

      DO $$
      BEGIN
        -- 1. stocks in items must be object
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_items_stocks_object') THEN
          ALTER TABLE items ADD CONSTRAINT chk_items_stocks_object CHECK (stocks IS NULL OR jsonb_typeof(stocks) = 'object');
        END IF;

        -- 2. inventory_control in production_projects must be object
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_pp_inv_control_object') THEN
          ALTER TABLE production_projects ADD CONSTRAINT chk_pp_inv_control_object CHECK (inventory_control IS NULL OR jsonb_typeof(inventory_control) = 'object');
        END IF;

        -- 3. status_history in cheques must be array
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cheques_history_array') THEN
          ALTER TABLE cheques ADD CONSTRAINT chk_cheques_history_array CHECK (status_history IS NULL OR jsonb_typeof(status_history) = 'array');
        END IF;

        -- 4. snapshot_dsl in workflow_instances must be object
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_wi_dsl_object') THEN
          ALTER TABLE workflow_instances ADD CONSTRAINT chk_wi_dsl_object CHECK (snapshot_dsl IS NULL OR jsonb_typeof(snapshot_dsl) = 'object');
        END IF;

        -- 5. Non-negative financial constraints
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_items_wac_nonneg') THEN
          ALTER TABLE items ADD CONSTRAINT chk_items_wac_nonneg CHECK (weighted_average_cost >= 0);
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bank_balance_nonneg') THEN
          ALTER TABLE bank_accounts ADD CONSTRAINT chk_bank_balance_nonneg CHECK (initial_balance >= 0 AND current_balance >= 0);
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tt_amount_pos') THEN
          ALTER TABLE treasury_transactions ADD CONSTRAINT chk_tt_amount_pos CHECK (amount > 0);
        END IF;
      END $$;
    `
  },
  {
    id: 'alt_029_updated_at_triggers',
    name: 'Add updated_at column to missing tables and set_updated_at BEFORE UPDATE triggers',
    sql: `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
      ALTER TABLE treasury_transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

      CREATE OR REPLACE FUNCTION set_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
      CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users 
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

      DROP TRIGGER IF EXISTS trg_personnel_updated_at ON personnel;
      CREATE TRIGGER trg_personnel_updated_at BEFORE UPDATE ON personnel 
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

      DROP TRIGGER IF EXISTS trg_treasury_tx_updated_at ON treasury_transactions;
      CREATE TRIGGER trg_treasury_tx_updated_at BEFORE UPDATE ON treasury_transactions 
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

      DROP TRIGGER IF EXISTS trg_workflow_instances_updated_at ON workflow_instances;
      CREATE TRIGGER trg_workflow_instances_updated_at BEFORE UPDATE ON workflow_instances 
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

      DROP TRIGGER IF EXISTS trg_item_prices_updated_at ON item_prices;
      CREATE TRIGGER trg_item_prices_updated_at BEFORE UPDATE ON item_prices 
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

      DROP TRIGGER IF EXISTS trg_project_stages_updated_at ON project_stages;
      CREATE TRIGGER trg_project_stages_updated_at BEFORE UPDATE ON project_stages 
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

      DROP TRIGGER IF EXISTS trg_transfers_updated_at ON transfers;
      CREATE TRIGGER trg_transfers_updated_at BEFORE UPDATE ON transfers 
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

      DROP TRIGGER IF EXISTS trg_crm_leads_updated_at ON crm_leads;
      CREATE TRIGGER trg_crm_leads_updated_at BEFORE UPDATE ON crm_leads 
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

      DROP TRIGGER IF EXISTS trg_accounting_settings_updated_at ON accounting_settings;
      CREATE TRIGGER trg_accounting_settings_updated_at BEFORE UPDATE ON accounting_settings 
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

      DROP TRIGGER IF EXISTS trg_event_action_rules_updated_at ON event_action_rules;
      CREATE TRIGGER trg_event_action_rules_updated_at BEFORE UPDATE ON event_action_rules 
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

      DROP TRIGGER IF EXISTS trg_webhook_subscriptions_updated_at ON webhook_subscriptions;
      CREATE TRIGGER trg_webhook_subscriptions_updated_at BEFORE UPDATE ON webhook_subscriptions 
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

      DROP TRIGGER IF EXISTS trg_woocommerce_order_logs_updated_at ON woocommerce_order_logs;
      CREATE TRIGGER trg_woocommerce_order_logs_updated_at BEFORE UPDATE ON woocommerce_order_logs 
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

      DROP TRIGGER IF EXISTS trg_form_drafts_updated_at ON form_drafts;
      CREATE TRIGGER trg_form_drafts_updated_at BEFORE UPDATE ON form_drafts 
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `
  },
  {
    id: 'alt_030_documents_soft_delete_columns',
    name: 'Ensure documents soft-delete columns (deleted_at, deleted_by) exist to match ORM schema (Phase 8 drift fix)',
    sql: `
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_by TEXT DEFAULT '';
    `
  },
  {
    id: 'alt_031_document_items_soft_delete_column',
    name: 'Ensure document_items soft-delete column (is_deleted) exists to match ORM schema (Phase 8 drift fix)',
    sql: `
      ALTER TABLE document_items ADD COLUMN IF NOT EXISTS is_deleted INTEGER DEFAULT 0;
    `
  },
  {
    id: 'alt_032_item_stock_trigger_defer_invalid_shape',
    name: 'Harden sync_item_current_stock trigger: defer non-object stocks shapes to chk_items_stocks_object CHECK constraint',
    sql: `
      CREATE OR REPLACE FUNCTION sync_item_current_stock()
      RETURNS TRIGGER AS $$
      DECLARE
        calculated_stock NUMERIC;
      BEGIN
        -- Phase 8 fix: when stocks JSONB is not an object, skip sync and let the
        -- chk_items_stocks_object CHECK constraint produce the canonical violation
        -- (previously jsonb_each_text raised an opaque runtime error first,
        -- masking the constraint and breaking DB-020 audit expectations).
        IF NEW.stocks IS NOT NULL AND jsonb_typeof(NEW.stocks) != 'object' THEN
          RETURN NEW;
        END IF;

        IF NEW.stocks IS NULL THEN
          calculated_stock := 0;
        ELSE
          SELECT COALESCE(
            (SELECT SUM((NULLIF(value, '')::numeric)) FROM jsonb_each_text(NEW.stocks)),
            0
          ) INTO calculated_stock;
        END IF;

        IF NEW.current_stock IS DISTINCT FROM calculated_stock THEN
          RAISE NOTICE 'Stock consistency corrected for item %: % -> %', NEW.id, NEW.current_stock, calculated_stock;
          NEW.current_stock := calculated_stock;
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `
  },
  {
    id: 'alt_033_users_token_version_soft_delete',
    name: 'V9 Phase 2.2: add users token_version (session invalidation) and is_deleted (soft delete) columns',
    sql: `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_deleted INTEGER DEFAULT 0;
    `
  },
  {
    id: 'alt_034_date_normalization_v10',
    name: 'V10 Phase 1.2: normalize shifted-Jalali timestamps in documents/transactions, unify journal voucher text dates to ISO, and remap document_ref_counters to Jalali year keys',
    sql: `
      CREATE OR REPLACE FUNCTION v10_jal_cal(jy_in integer)
      RETURNS TABLE(leap_out integer, gy_out integer, march_out integer)
      LANGUAGE plpgsql IMMUTABLE AS $fn$
      DECLARE
        bl constant integer := 20;
        gy integer := jy_in + 621;
        leap_j integer := -14;
        jp integer := -61;
        jump_l integer := 0;
        jm integer;
        i integer;
        n integer;
        leap_g integer;
        march integer;
        breaks constant int[] := ARRAY[-61,9,38,199,426,686,756,818,1111,1181,1210,1635,2060,2097,2192,2262,2324,2394,2456,3178];
      BEGIN
        FOR i IN 1 .. bl - 1 LOOP
          jm := breaks[i];
          jump_l := jm - jp;
          IF jy_in < jm THEN EXIT; END IF;
          leap_j := leap_j + (jump_l / 33) * 8 + ((jump_l % 33) / 4);
          jp := jm;
        END LOOP;
        n := jy_in - jp;
        leap_j := leap_j + (n / 33) * 8 + (((n % 33) + 3) / 4);
        IF (jump_l % 33) = 4 AND (jump_l - n) = 4 THEN leap_j := leap_j + 1; END IF;
        leap_g := (gy / 4) - (((gy / 100) + 1) * 3 / 4) - 150;
        march := 20 + leap_j - leap_g;
        IF (jump_l - n) < 6 THEN n := n - jump_l + ((jump_l + 4) / 33) * 33; END IF;
        leap_out := ((n + 1) % 33) - 1;
        leap_out := (leap_out % 4);
        IF leap_out = -1 THEN leap_out := 4; END IF;
        gy_out := gy; march_out := march;
        RETURN NEXT;
      END;
      $fn$;

      CREATE OR REPLACE FUNCTION v10_g2d(gy integer, gm integer, gd integer)
      RETURNS integer LANGUAGE plpgsql IMMUTABLE AS $fn$
      DECLARE d integer;
      BEGIN
        d := ((gy + ((gm - 8) / 6) + 100100) * 1461) / 4
           + ((153 * ((gm + 9) % 12) + 2) / 5)
           + gd - 34840408;
        d := d - ((((gy + 100100 + ((gm - 8) / 6)) / 100) * 3) / 4) + 752;
        RETURN d;
      END;
      $fn$;

      CREATE OR REPLACE FUNCTION v10_d2g(jdn integer)
      RETURNS TABLE(gy integer, gm integer, gd integer)
      LANGUAGE plpgsql IMMUTABLE AS $fn$
      DECLARE j integer; i integer;
      BEGIN
        j := 4 * jdn + 139361631;
        j := j + ((((4 * jdn + 183187720) / 146097) * 3) / 4) * 4 - 3908;
        i := ((j % 1461) / 4) * 5 + 308;
        gd := ((i % 153) / 5) + 1;
        gm := ((i / 153) % 12) + 1;
        gy := (j / 1461) - 100100 + ((8 - gm) / 6);
        RETURN NEXT;
      END;
      $fn$;

      CREATE OR REPLACE FUNCTION v10_jalali_to_gregorian_ts(ts_in timestamp)
      RETURNS timestamp LANGUAGE plpgsql IMMUTABLE AS $fn$
      DECLARE
        rec record; jdn integer; g record;
        jy integer; jm integer; jd integer;
      BEGIN
        jy := EXTRACT(YEAR FROM ts_in)::int;
        jm := EXTRACT(MONTH FROM ts_in)::int;
        jd := EXTRACT(DAY FROM ts_in)::int;
        SELECT * INTO rec FROM v10_jal_cal(jy);
        jdn := v10_g2d(rec.gy_out, 3, rec.march_out) + (jm - 1) * 31 - (jm / 7) * (jm - 7) + jd - 1;
        SELECT * INTO g FROM v10_d2g(jdn);
        RETURN make_timestamp(
          g.gy, g.gm, g.gd,
          COALESCE(NULLIF(EXTRACT(HOUR FROM ts_in), 0), 0)::int,
          COALESCE(NULLIF(EXTRACT(MINUTE FROM ts_in), 0), 0)::int,
          COALESCE(EXTRACT(SECOND FROM ts_in), 0)
        );
      END;
      $fn$;

      CREATE OR REPLACE FUNCTION v10_is_shifted_jalali(ts_in timestamp)
      RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $fn$
      BEGIN
        RETURN EXTRACT(YEAR FROM ts_in) BETWEEN 1300 AND 1500;
      END;
      $fn$;

      -- 1. documents.date: shifted-Jalali timestamps -> true Gregorian (time-of-day preserved)
      UPDATE documents SET date = v10_jalali_to_gregorian_ts(date)
      WHERE v10_is_shifted_jalali(date);

      -- 2. transactions.date: same treatment
      UPDATE transactions SET date = v10_jalali_to_gregorian_ts(date)
      WHERE v10_is_shifted_jalali(date);

      -- 3. journal_vouchers.date is TEXT with mixed formats:
      --    a) rows that ARE shifted-Jalali parseable ("1405/8/15" style, full 4-digit year)
      UPDATE journal_vouchers SET date = v10_jalali_to_gregorian_ts(
        make_timestamp(
          SUBSTRING(date, 1, 4)::int,
          LPAD(SPLIT_PART(REPLACE(SUBSTRING(date,6), '-', '/'), '/', 1), 2, '0')::int,
          LPAD(SPLIT_PART(REPLACE(SUBSTRING(date,6), '-', '/'), '/', 2), 2, '0')::int,
          0, 0, 0
        ))::date::text
      WHERE date ~ '^1[345][0-9]{2}[/-][0-9]{1,2}[/-][0-9]{1,2}';
      --    b) already-Gregorian but slash format -> dash ISO for lexical consistency
      UPDATE journal_vouchers SET date = REPLACE(REPLACE(SUBSTRING(date, 1, 19), '/', '-'), 'T', ' ')
      WHERE date ~ '^20[0-9]{2}/' AND NOT date ~ '^20[0-9]{2}-';

      -- 4. Sanity guard: no shifted years may remain anywhere
      DO $guard$
      BEGIN
        IF EXISTS (SELECT 1 FROM documents WHERE v10_is_shifted_jalali(date))
        OR EXISTS (SELECT 1 FROM transactions WHERE v10_is_shifted_jalali(date)) THEN
          RAISE EXCEPTION 'V10 date normalization incomplete — shifted-Jalali values remain';
        END IF;
      END;
      $guard$;

      -- 5. document_ref_counters: re-key Gregorian years onto their Jalali equivalents
      --    (GREATEST merge keeps the highest consumed ref per key for continuity).
      INSERT INTO document_ref_counters (doc_type, fiscal_year, last_ref_number)
      SELECT doc_type,
             CASE WHEN fiscal_year >= 2000 THEN fiscal_year - 621 ELSE fiscal_year END AS target_fy,
             last_ref_number
      FROM document_ref_counters src WHERE fiscal_year >= 2000
      ON CONFLICT (doc_type, fiscal_year) DO UPDATE SET last_ref_number =
        GREATEST(document_ref_counters.last_ref_number, EXCLUDED.last_ref_number);

      INSERT INTO document_ref_counters (doc_type, fiscal_year, last_ref_number)
      SELECT doc_type, fiscal_year - 622, last_ref_number
      FROM document_ref_counters src WHERE fiscal_year >= 2000
      ON CONFLICT (doc_type, fiscal_year) DO UPDATE SET last_ref_number =
        GREATEST(document_ref_counters.last_ref_number, EXCLUDED.last_ref_number);

      DELETE FROM document_ref_counters WHERE fiscal_year BETWEEN 2000 AND 2100;

      DROP FUNCTION IF EXISTS v10_is_shifted_jalali(timestamp);
    `
  },
  {
    id: 'alt_035_item_code_counters',
    name: 'V10 Phase 2.1: create atomic item_code_counters table for unique sequential item codes (replaces MAX()+1 pattern)',
    sql: `
      CREATE TABLE IF NOT EXISTS item_code_counters (
        scope VARCHAR(20) NOT NULL,
        prefix_key VARCHAR(60) NOT NULL,
        last_number INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (scope, prefix_key)
      );
    `
  },
  {
    id: 'alt_036_crm_assigned_personnel',
    name: 'V10 Phase 4.1: link CRM leads/activities to personnel (assigned_personnel_id) with snapshot backfill by exact full-name match',
    sql: `
      ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS assigned_personnel_id INTEGER REFERENCES personnel(id);
      ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS assigned_personnel_id INTEGER REFERENCES personnel(id);
      CREATE INDEX IF NOT EXISTS idx_crm_lead_personnel ON crm_leads(assigned_personnel_id);
      CREATE INDEX IF NOT EXISTS idx_crm_act_personnel ON crm_activities(assigned_personnel_id);

      -- Best-effort backfill of legacy textual snapshots (exact case-insensitive match only; null-safe & idempotent)
      UPDATE crm_leads l
      SET assigned_personnel_id = p.id
      FROM personnel p
      WHERE (l.assigned_personnel_id IS NULL)
        AND lower(btrim(l.assigned_to)) = lower(btrim(p.full_name));

      UPDATE crm_activities a
      SET assigned_personnel_id = p.id
      FROM personnel p
      WHERE (a.assigned_personnel_id IS NULL)
        AND a.assigned_to IS NOT NULL
        AND btrim(a.assigned_to) <> ''
        AND lower(btrim(a.assigned_to)) = lower(btrim(p.full_name));
    `
  },
  {
    id: 'alt_037_documents_crm_lead_id',
    name: 'V10 Phase 4.3: formal CRM link on documents (crm_lead_id FK) with best-effort backfill from legacy textual notes tag',
    sql: `
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS crm_lead_id INTEGER REFERENCES crm_leads(id);
      CREATE INDEX IF NOT EXISTS idx_documents_crm_lead ON documents(crm_lead_id);

      -- Backfill سوابق موجود: برچسب متنی قدیمی «CRM #n» در یادداشت‌ها → لینک رسمی
      UPDATE documents d
      SET crm_lead_id = cl.id
      FROM crm_leads cl
      WHERE d.crm_lead_id IS NULL
        AND d.notes IS NOT NULL
        AND cl.is_deleted = 0
        AND cl.id::text = substring(d.notes FROM '(?i)CRM\\s*#\\s*([0-9]+)');
    `
  },
  {
    id: 'alt_038_payroll_fixed_salary',
    name: 'V10 Phase 4.4: fixed/mixed salary model (personnel.salary_type + monthly_salary), payroll fixed portion column and treasury↔payroll link',
    sql: `
      ALTER TABLE personnel ADD COLUMN IF NOT EXISTS salary_type TEXT NOT NULL DEFAULT 'none';
      ALTER TABLE personnel ADD COLUMN IF NOT EXISTS monthly_salary NUMERIC(18, 4) DEFAULT 0;

      ALTER TABLE piecework_payrolls ADD COLUMN IF NOT EXISTS total_fixed_amount NUMERIC(18, 4) DEFAULT 0;

      ALTER TABLE treasury_transactions ADD COLUMN IF NOT EXISTS payroll_id INTEGER REFERENCES piecework_payrolls(id);
      CREATE INDEX IF NOT EXISTS idx_tt_payroll ON treasury_transactions(payroll_id);
    `
  }
];

/**
 * Performance Indexes & Constraints
 */
export const CORE_INDEXES: MigrationStep[] = [
  { id: 'idx_001_items_code_active', name: 'Unique active item code index', sql: 'CREATE UNIQUE INDEX IF NOT EXISTS items_code_active ON items(code) WHERE is_deleted = 0' },
  { id: 'idx_002_items_type_deleted', name: 'Items type deleted index', sql: 'CREATE INDEX IF NOT EXISTS items_type_deleted ON items(type, is_deleted)' },
  { id: 'idx_003_items_category', name: 'Items category index', sql: 'CREATE INDEX IF NOT EXISTS items_category ON items(category)' },
  { id: 'idx_004_docs_type_deleted', name: 'Docs type deleted index', sql: 'CREATE INDEX IF NOT EXISTS docs_type_deleted ON documents(type, is_deleted)' },
  { id: 'idx_005_docs_date', name: 'Docs date index', sql: 'CREATE INDEX IF NOT EXISTS docs_date ON documents(date)' },
  { id: 'idx_006_docs_buyer_name', name: 'Docs buyer name index', sql: 'CREATE INDEX IF NOT EXISTS idx_docs_buyer_name ON documents(buyer_name)' },
  { id: 'idx_007_doc_items_doc_id', name: 'Doc items doc id index', sql: 'CREATE INDEX IF NOT EXISTS doc_items_doc_id ON document_items(document_id)' },
  { id: 'idx_008_doc_items_item_id', name: 'Doc items item id index', sql: 'CREATE INDEX IF NOT EXISTS doc_items_item_id ON document_items(item_id)' },
  { id: 'idx_009_tx_item_id', name: 'Tx item id index', sql: 'CREATE INDEX IF NOT EXISTS tx_item_id ON transactions(item_id)' },
  { id: 'idx_010_tx_doc_id', name: 'Tx doc id index', sql: 'CREATE INDEX IF NOT EXISTS tx_doc_id ON transactions(document_id)' },
  { id: 'idx_011_tx_date', name: 'Tx date index', sql: 'CREATE INDEX IF NOT EXISTS tx_date ON transactions(date)' },
  { id: 'idx_012_tx_type_deleted', name: 'Tx type deleted index', sql: 'CREATE INDEX IF NOT EXISTS tx_type_deleted ON transactions(type, is_deleted)' },
  { id: 'idx_013_item_prices_item_id', name: 'Item prices item id index', sql: 'CREATE INDEX IF NOT EXISTS item_prices_item_id ON item_prices(item_id)' },
  { id: 'idx_014_customers_party_type', name: 'Customers party type index', sql: 'CREATE INDEX IF NOT EXISTS idx_customers_party_type ON customers(party_type)' },
  { id: 'idx_015_customers_is_deleted', name: 'Customers is deleted index', sql: 'CREATE INDEX IF NOT EXISTS idx_customers_is_deleted ON customers(is_deleted)' },
  { id: 'idx_016_proj_code', name: 'Projects code index', sql: 'CREATE INDEX IF NOT EXISTS idx_proj_code ON production_projects(project_code)' },
  { id: 'idx_017_proj_status', name: 'Projects status index', sql: 'CREATE INDEX IF NOT EXISTS idx_proj_status ON production_projects(status)' },
  { id: 'idx_018_stage_proj', name: 'Stages project id index', sql: 'CREATE INDEX IF NOT EXISTS idx_stage_proj ON project_stages(project_id)' },
  { id: 'idx_019_dwl_user', name: 'Daily work logs user index', sql: 'CREATE INDEX IF NOT EXISTS idx_dwl_user ON daily_work_logs(user_id)' },
  { id: 'idx_020_dwl_date', name: 'Daily work logs date index', sql: 'CREATE INDEX IF NOT EXISTS idx_dwl_date ON daily_work_logs(date)' },
  { id: 'idx_021_dwl_vis', name: 'Daily work logs visibility index', sql: 'CREATE INDEX IF NOT EXISTS idx_dwl_vis ON daily_work_logs(visibility)' },
  { id: 'idx_022_notif_user', name: 'Notifications user index', sql: 'CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id)' },
  { id: 'idx_023_notif_read', name: 'Notifications read index', sql: 'CREATE INDEX IF NOT EXISTS idx_notif_read ON notifications(is_read)' },
  { id: 'idx_024_crm_leads_stage', name: 'CRM leads stage index', sql: 'CREATE INDEX IF NOT EXISTS idx_crm_leads_stage ON crm_leads(stage)' },
  { id: 'idx_025_crm_leads_assigned', name: 'CRM leads assigned index', sql: 'CREATE INDEX IF NOT EXISTS idx_crm_leads_assigned ON crm_leads(assigned_to)' },
  { id: 'idx_026_crm_act_lead', name: 'CRM activities lead index', sql: 'CREATE INDEX IF NOT EXISTS idx_crm_act_lead ON crm_activities(lead_id)' },
  { id: 'idx_027_acc_code', name: 'Accounts code index', sql: 'CREATE INDEX IF NOT EXISTS idx_acc_code ON accounts(code)' },
  { id: 'idx_028_acc_parent', name: 'Accounts parent id index', sql: 'CREATE INDEX IF NOT EXISTS idx_acc_parent ON accounts(parent_id)' },
  { id: 'idx_029_acc_deleted', name: 'Accounts deleted index', sql: 'CREATE INDEX IF NOT EXISTS idx_acc_deleted ON accounts(is_deleted)' },
  { id: 'idx_030_jv_number', name: 'Journal vouchers number index', sql: 'CREATE INDEX IF NOT EXISTS idx_jv_number ON journal_vouchers(voucher_number)' },
  { id: 'idx_031_jv_date', name: 'Journal vouchers date index', sql: 'CREATE INDEX IF NOT EXISTS idx_jv_date ON journal_vouchers(date)' },
  { id: 'idx_032_jv_deleted', name: 'Journal vouchers deleted index', sql: 'CREATE INDEX IF NOT EXISTS idx_jv_deleted ON journal_vouchers(is_deleted)' },
  { id: 'idx_033_jvi_voucher', name: 'Journal voucher items voucher index', sql: 'CREATE INDEX IF NOT EXISTS idx_jvi_voucher ON journal_voucher_items(voucher_id)' },
  { id: 'idx_034_jvi_account', name: 'Journal voucher items account index', sql: 'CREATE INDEX IF NOT EXISTS idx_jvi_account ON journal_voucher_items(account_id)' },
  { id: 'idx_035_bank_code', name: 'Bank accounts code index', sql: 'CREATE INDEX IF NOT EXISTS idx_bank_code ON bank_accounts(code)' },
  { id: 'idx_036_bank_deleted', name: 'Bank accounts deleted index', sql: 'CREATE INDEX IF NOT EXISTS idx_bank_deleted ON bank_accounts(is_deleted)' },
  { id: 'idx_037_chq_type', name: 'Cheques type index', sql: 'CREATE INDEX IF NOT EXISTS idx_chq_type ON cheques(type)' },
  { id: 'idx_038_chq_due', name: 'Cheques due date index', sql: 'CREATE INDEX IF NOT EXISTS idx_chq_due ON cheques(due_date)' },
  { id: 'idx_039_chq_status', name: 'Cheques status index', sql: 'CREATE INDEX IF NOT EXISTS idx_chq_status ON cheques(status)' },
  { id: 'idx_040_chq_deleted', name: 'Cheques deleted index', sql: 'CREATE INDEX IF NOT EXISTS idx_chq_deleted ON cheques(is_deleted)' },
  { id: 'idx_041_tt_type', name: 'Treasury transactions type index', sql: 'CREATE INDEX IF NOT EXISTS idx_tt_type ON treasury_transactions(type)' },
  { id: 'idx_042_tt_date', name: 'Treasury transactions date index', sql: 'CREATE INDEX IF NOT EXISTS idx_tt_date ON treasury_transactions(date)' },
  { id: 'idx_043_tt_bank', name: 'Treasury transactions bank index', sql: 'CREATE INDEX IF NOT EXISTS idx_tt_bank ON treasury_transactions(bank_account_id)' },
  { id: 'idx_044_tt_deleted', name: 'Treasury transactions deleted index', sql: 'CREATE INDEX IF NOT EXISTS idx_tt_deleted ON treasury_transactions(is_deleted)' },
  { id: 'idx_045_wdv_def_ver', name: 'Workflow definition version index', sql: 'CREATE INDEX IF NOT EXISTS idx_wdv_def_ver ON workflow_definition_versions(definition_id, version)' },
  { id: 'idx_046_wft_instance', name: 'Workflow task instance index', sql: 'CREATE INDEX IF NOT EXISTS idx_wft_instance ON workflow_tasks(instance_id)' },
  { id: 'idx_047_wft_user', name: 'Workflow task user index', sql: 'CREATE INDEX IF NOT EXISTS idx_wft_user ON workflow_tasks(assigned_user_id)' },
  { id: 'idx_048_wft_status', name: 'Workflow task status index', sql: 'CREATE INDEX IF NOT EXISTS idx_wft_status ON workflow_tasks(status)' },
  { id: 'idx_049_wfd_from', name: 'Workflow delegation from user index', sql: 'CREATE INDEX IF NOT EXISTS idx_wfd_from ON workflow_delegations(from_user_id)' },
  { id: 'idx_050_wfd_to', name: 'Workflow delegation to user index', sql: 'CREATE INDEX IF NOT EXISTS idx_wfd_to ON workflow_delegations(to_user_id)' },
  { id: 'idx_051_outbox_status_retry', name: 'Outbox event status retry index', sql: 'CREATE INDEX IF NOT EXISTS idx_outbox_status_retry ON outbox_events(status, next_retry_at)' },
  { id: 'idx_052_outbox_aggregate', name: 'Outbox event aggregate index', sql: 'CREATE INDEX IF NOT EXISTS idx_outbox_aggregate ON outbox_events(aggregate_type, aggregate_id)' },
  { id: 'idx_053_action_rules_event_active', name: 'Action rules event active index', sql: 'CREATE INDEX IF NOT EXISTS idx_action_rules_event_active ON event_action_rules(event_type, is_active)' },
  { id: 'idx_054_action_logs_rule', name: 'Action logs rule date index', sql: 'CREATE INDEX IF NOT EXISTS idx_action_logs_rule ON event_action_logs(rule_id, executed_at)' },
  { id: 'idx_055_action_logs_event', name: 'Action logs event index', sql: 'CREATE INDEX IF NOT EXISTS idx_action_logs_event ON event_action_logs(event_id)' },
  { id: 'idx_056_dlq_status', name: 'Dead letter queue status index', sql: 'CREATE INDEX IF NOT EXISTS idx_dlq_status ON dead_letter_events(status)' },
  { id: 'idx_057_dlq_event_type', name: 'Dead letter queue event type index', sql: 'CREATE INDEX IF NOT EXISTS idx_dlq_event_type ON dead_letter_events(event_type)' },
  { id: 'idx_058_dlq_aggregate', name: 'Dead letter queue aggregate index', sql: 'CREATE INDEX IF NOT EXISTS idx_dlq_aggregate ON dead_letter_events(aggregate_type, aggregate_id)' },
  { id: 'idx_059_webhook_subs_active', name: 'Webhook subscriptions active index', sql: 'CREATE INDEX IF NOT EXISTS idx_webhook_subs_active ON webhook_subscriptions(is_active)' },
  { id: 'idx_060_webhook_deliv_sub', name: 'Webhook deliveries subscription index', sql: 'CREATE INDEX IF NOT EXISTS idx_webhook_deliv_sub ON webhook_deliveries(subscription_id, created_at)' },
  { id: 'idx_061_webhook_deliv_event', name: 'Webhook deliveries event index', sql: 'CREATE INDEX IF NOT EXISTS idx_webhook_deliv_event ON webhook_deliveries(event_id)' },
  { id: 'idx_062_wc_order_id', name: 'WooCommerce order id index', sql: 'CREATE INDEX IF NOT EXISTS idx_wc_order_id ON woocommerce_order_logs(wc_order_id)' },
  { id: 'idx_063_wc_status', name: 'WooCommerce status index', sql: 'CREATE INDEX IF NOT EXISTS idx_wc_status ON woocommerce_order_logs(status)' },
  { id: 'idx_064_plog_personnel', name: 'Piecework logs personnel index', sql: 'CREATE INDEX IF NOT EXISTS idx_plog_personnel ON piecework_logs(personnel_id)' },
  { id: 'idx_065_plog_task', name: 'Piecework logs task index', sql: 'CREATE INDEX IF NOT EXISTS idx_plog_task ON piecework_logs(task_id)' },
  { id: 'idx_066_plog_project', name: 'Piecework logs project index', sql: 'CREATE INDEX IF NOT EXISTS idx_plog_project ON piecework_logs(project_id)' },
  { id: 'idx_067_plog_date', name: 'Piecework logs date index', sql: 'CREATE INDEX IF NOT EXISTS idx_plog_date ON piecework_logs(date)' },
  { id: 'idx_068_plog_payroll', name: 'Piecework logs payroll index', sql: 'CREATE INDEX IF NOT EXISTS idx_plog_payroll ON piecework_logs(payroll_id)' },
  { id: 'idx_069_plog_deleted', name: 'Piecework logs deleted index', sql: 'CREATE INDEX IF NOT EXISTS idx_plog_deleted ON piecework_logs(is_deleted)' },
  { id: 'idx_070_ppay_personnel', name: 'Piecework payrolls personnel index', sql: 'CREATE INDEX IF NOT EXISTS idx_ppay_personnel ON piecework_payrolls(personnel_id)' },
  { id: 'idx_071_ppay_number', name: 'Piecework payrolls number index', sql: 'CREATE INDEX IF NOT EXISTS idx_ppay_number ON piecework_payrolls(payroll_number)' },
  { id: 'idx_072_ppay_status', name: 'Piecework payrolls status index', sql: 'CREATE INDEX IF NOT EXISTS idx_ppay_status ON piecework_payrolls(status)' },
  { id: 'idx_073_ppay_deleted', name: 'Piecework payrolls deleted index', sql: 'CREATE INDEX IF NOT EXISTS idx_ppay_deleted ON piecework_payrolls(is_deleted)' },
  { id: 'idx_074_pmat_status', name: 'Pending materials status index', sql: 'CREATE INDEX IF NOT EXISTS idx_pmat_status ON pending_materials(status)' },
  { id: 'idx_075_pmat_code', name: 'Pending materials code index', sql: 'CREATE INDEX IF NOT EXISTS idx_pmat_code ON pending_materials(code)' },
  { id: 'idx_076_pmat_deleted', name: 'Pending materials deleted index', sql: 'CREATE INDEX IF NOT EXISTS idx_pmat_deleted ON pending_materials(is_deleted)' },
  { id: 'idx_077_uniq_accounts_code_active', name: 'Unique active account code index', sql: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_uniq_accounts_code_active ON accounts(code) WHERE is_deleted = 0' },
  { id: 'idx_078_uniq_bank_code_active', name: 'Unique active bank code index', sql: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_uniq_bank_code_active ON bank_accounts(code) WHERE is_deleted = 0' },
  { id: 'idx_079_uniq_piecework_task_code_active', name: 'Unique active piecework task code index', sql: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_uniq_ptask_code_active ON piecework_tasks(code) WHERE is_deleted = 0' },
  { id: 'idx_080_uniq_piecework_payroll_number_active', name: 'Unique active piecework payroll number index', sql: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_uniq_ppay_num_active ON piecework_payrolls(payroll_number) WHERE is_deleted = 0' },
  { id: 'idx_081_uniq_doc_type_ref_active', name: 'Unique active document type and ref index', sql: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_uniq_doc_type_ref_active ON documents(type, ref_number) WHERE is_deleted = 0' },
  { id: 'idx_082_uniq_jv_number_active', name: 'Unique active journal voucher number index', sql: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_uniq_jv_number_active ON journal_vouchers(voucher_number) WHERE is_deleted = 0' },
  { id: 'idx_083_idempotency_key', name: 'Idempotency key unique index', sql: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_key ON idempotency_keys(key)' },
  { id: 'idx_084_idempotency_scope_status', name: 'Idempotency scope status index', sql: 'CREATE INDEX IF NOT EXISTS idx_idempotency_scope_status ON idempotency_keys(scope, status)' },
  { id: 'idx_085_form_drafts_user_entity', name: 'Form drafts user entity key index', sql: 'CREATE INDEX IF NOT EXISTS idx_form_drafts_user_entity ON form_drafts(user_id, entity_type, draft_key)' },
  { id: 'idx_086_form_drafts_session', name: 'Form drafts session index', sql: 'CREATE INDEX IF NOT EXISTS idx_form_drafts_session ON form_drafts(session_id)' },
  { id: 'idx_087_form_drafts_updated', name: 'Form drafts updated index', sql: 'CREATE INDEX IF NOT EXISTS idx_form_drafts_updated ON form_drafts(updated_at)' },
  { id: 'idx_088_tx_item_date_id_active', name: 'Composite Kardex Index on transactions (item_id, is_deleted, date, id)', sql: 'CREATE INDEX IF NOT EXISTS tx_item_date_id_active ON transactions(item_id, is_deleted, date, id)' },
  { id: 'idx_089_tx_item_loc_active', name: 'Transaction Item Location Active Index (item_id, location, is_deleted)', sql: 'CREATE INDEX IF NOT EXISTS tx_item_loc_active ON transactions(item_id, location, is_deleted)' },
  { id: 'idx_090_tx_item_active_date', name: 'Transaction Item Active Date Descending Index (item_id, is_deleted, date DESC)', sql: 'CREATE INDEX IF NOT EXISTS tx_item_active_date ON transactions(item_id, is_deleted, date DESC)' },
  { id: 'idx_091_tx_drop_redundant_item_id', name: 'Drop redundant single column item_id index on transactions', sql: 'DROP INDEX IF EXISTS tx_item_id' },
  { id: 'idx_092_analyze_transactions', name: 'Update PostgreSQL optimizer statistics for transactions table', sql: 'ANALYZE transactions' },
  { id: 'idx_093_outbox_status_locked', name: 'Outbox status and locked_at index', sql: 'CREATE INDEX IF NOT EXISTS idx_outbox_status_locked ON outbox_events(status, locked_at)' }
];

/**
 * Retrieves pending migration steps that have not been logged in migrations_log.
 */
export async function getPendingMigrations(client?: any): Promise<MigrationStep[]> {
  const runner = client || pool;
  await runner.query(`
    CREATE TABLE IF NOT EXISTS migrations_log (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT NOW()
    )
  `);

  const res = await runner.query(`SELECT name FROM migrations_log`);
  const appliedSet = new Set<string>(res.rows.map((r: any) => r.name));

  const allSteps = [...CORE_TABLE_DDLS, ...SCHEMA_ALTERATIONS, ...CORE_INDEXES];
  return allSteps.filter(step => !appliedSet.has(step.id));
}

/**
 * Runs the complete database schema migration pipeline inside an atomic PostgreSQL transaction.
 * Tracks applied migrations in migrations_log table. Rolls back all changes if any step fails.
 */
export async function runMigrations(): Promise<{ success: boolean; appliedCount: number; errors: string[] }> {
  logger.info('[Migrator] Executing database schema migration pipeline (atomic transaction)...');
  const errors: string[] = [];
  let appliedCount = 0;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Ensure migrations_log tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations_log (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // 2. Query already applied migration names
    const appliedRes = await client.query(`SELECT name FROM migrations_log`);
    const appliedSet = new Set<string>(appliedRes.rows.map((r: any) => r.name));

    const allSteps = [...CORE_TABLE_DDLS, ...SCHEMA_ALTERATIONS, ...CORE_INDEXES];
    const pendingSteps = allSteps.filter(step => !appliedSet.has(step.id));

    if (pendingSteps.length === 0) {
      logger.info('[Migrator] Database schema is up-to-date (0 pending migrations).');
      await client.query('COMMIT');
      return { success: true, appliedCount: 0, errors: [] };
    }

    logger.info(`[Migrator] Found ${pendingSteps.length} pending migration steps out of ${allSteps.length} total.`);

    // 3. Execute each pending step within the transaction and log to migrations_log
    for (const step of pendingSteps) {
      try {
        await client.query(step.sql);
        await client.query(
          `INSERT INTO migrations_log (name, applied_at) VALUES ($1, NOW()) ON CONFLICT (name) DO NOTHING`,
          [step.id]
        );
        appliedCount++;
      } catch (e: any) {
        const msg = `Migration step failed [${step.id} - ${step.name}]: ${e.message}`;
        logger.error(`[Migrator] ${msg}`);
        throw new Error(msg);
      }
    }

    // 4. Data self-healing operations inside the transaction
    try {
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'transactions' AND column_name = 'user'
          ) THEN
            EXECUTE 'UPDATE transactions SET created_by = "user" WHERE created_by IS NULL';
          END IF;
        END $$;
      `);
    } catch (e: any) {
      // Non-critical data migration
    }

    try {
      await client.query(`
        UPDATE transactions t
        SET 
          unit_price = di.unit_price,
          total_price = di.unit_price * t.quantity
        FROM document_items di
        WHERE t.document_id = di.document_id 
          AND t.item_id = di.item_id
          AND (t.unit_price IS NULL OR t.unit_price = 0)
          AND di.unit_price IS NOT NULL
          AND di.unit_price > 0;

        UPDATE transactions SET unit_price = 0 WHERE unit_price IS NULL;
        UPDATE transactions SET total_price = COALESCE(unit_price * quantity, 0) WHERE total_price IS NULL OR total_price = 0;
      `);
    } catch (e: any) {
      logger.warn(`[Migrator] Transactions unit_price/total_price backfill warning: ${e.message}`);
    }

    await client.query('COMMIT');
    logger.info(`[Migrator] Successfully applied ${appliedCount} pending migrations in atomic transaction.`);

    return {
      success: true,
      appliedCount,
      errors: []
    };
  } catch (err: any) {
    await client.query('ROLLBACK');
    const errorMsg = `[Migrator] Rolled back all migrations due to error: ${err.message}`;
    logger.error(errorMsg);
    errors.push(err.message);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Diagnostic tool validating the integrity, table presence, and numeric precision of the schema.
 * Aligned with the canonical single source of truth (src/db/schema.ts).
 */
export async function validateDbSchema(): Promise<{ valid: boolean; tablesCount: number; floatColumns: string[]; missingTables: string[]; details: any }> {
  const expectedTables = [
    'users', 'roles', 'categories', 'warehouses', 'app_settings', 'changelogs', 'customers',
    'items', 'documents', 'document_items', 'transactions', 'item_prices', 'activity_logs',
    'transfers', 'production_projects', 'project_stages', 'daily_work_logs', 'notifications',
    'crm_leads', 'crm_activities', 'personnel', 'task_categories', 'piecework_tasks',
    'piecework_personnel_rates', 'piecework_logs', 'piecework_payrolls', 'pending_materials',
    'accounts', 'journal_vouchers', 'journal_voucher_items', 'bank_accounts', 'cheques',
    'treasury_transactions', 'accounting_settings', 'workflow_definitions', 'workflow_states',
    'workflow_transitions', 'workflow_instances', 'workflow_pending_approvals', 'workflow_history_logs',
    'workflow_definition_versions', 'workflow_tasks', 'workflow_delegations', 'outbox_events',
    'event_action_rules', 'event_action_logs', 'dead_letter_events', 'webhook_subscriptions',
    'webhook_deliveries', 'woocommerce_order_logs', 'form_drafts', 'document_ref_counters',
    'item_code_counters',
    'migrations_log'
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
  } catch (err) {
    return {
      valid: false,
      tablesCount: 0,
      missingTables: expectedTables,
      floatColumns: [],
      details: { error: err.message }
    };
  }
}
