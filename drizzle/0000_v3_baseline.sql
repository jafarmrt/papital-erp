-- ============================================================================
-- Drizzle Migration: 0000_v3_baseline.sql
-- Unified Baseline Migration for Version 3.0.0 Architecture
-- Single Source of Truth for all 55 system tables, atomic sequences, triggers,
-- composite Kardex indexes, and JSONB check constraints.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ----------------------------------------------------------------------------
-- 1. Sequences for Atomic Numbering
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS journal_voucher_number_seq START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS treasury_tx_number_seq START WITH 1 INCREMENT BY 1;

-- ----------------------------------------------------------------------------
-- 2. Core Tables
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
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
  is_deleted INTEGER DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  permissions JSONB DEFAULT '[]'::jsonb,
  is_system INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  type TEXT NOT NULL,
  default_unit TEXT DEFAULT 'عدد'
);

CREATE TABLE IF NOT EXISTS warehouses (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS migrations_log (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS changelogs (
  id SERIAL PRIMARY KEY,
  version TEXT NOT NULL,
  date TIMESTAMP NOT NULL DEFAULT NOW(),
  features TEXT NOT NULL,
  fixes TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT DEFAULT '',
  country TEXT DEFAULT 'ایران',
  province TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  city TEXT DEFAULT '',
  address TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  party_type TEXT DEFAULT 'customer',
  supplier_category TEXT DEFAULT '',
  bank_info JSONB DEFAULT '{}'::jsonb,
  contacts JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS customers_name_trgm_idx ON customers USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_party_type ON customers (party_type);
CREATE INDEX IF NOT EXISTS idx_customers_is_deleted ON customers (is_deleted);

CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
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
  version INTEGER NOT NULL DEFAULT 1,
  is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS items_type_deleted ON items (type, is_deleted);
CREATE INDEX IF NOT EXISTS items_code ON items (code);
CREATE INDEX IF NOT EXISTS items_category ON items (category);
CREATE INDEX IF NOT EXISTS items_name_trgm_idx ON items USING gin (name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  ref_number TEXT NOT NULL,
  date TIMESTAMP NOT NULL DEFAULT NOW(),
  crm_lead_id INTEGER,
  "user" TEXT,
  notes TEXT,
  buyer_name TEXT DEFAULT '',
  buyer_city TEXT DEFAULT '',
  buyer_phone TEXT DEFAULT '',
  buyer_address TEXT DEFAULT '',
  status TEXT DEFAULT 'final',
  currency TEXT DEFAULT 'IRR',
  version INTEGER NOT NULL DEFAULT 1,
  is_deleted INTEGER DEFAULT 0,
  deleted_at TIMESTAMP,
  deleted_by TEXT
);

CREATE INDEX IF NOT EXISTS docs_type_deleted ON documents (type, is_deleted);
CREATE INDEX IF NOT EXISTS docs_date ON documents (date);
CREATE INDEX IF NOT EXISTS idx_docs_buyer_name ON documents (buyer_name);

CREATE TABLE IF NOT EXISTS document_ref_counters (
  doc_type VARCHAR(20) NOT NULL,
  fiscal_year INTEGER NOT NULL,
  last_ref_number INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (doc_type, fiscal_year)
);

CREATE TABLE IF NOT EXISTS item_code_counters (
  scope VARCHAR(20) NOT NULL,
  prefix_key VARCHAR(60) NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, prefix_key)
);

CREATE TABLE IF NOT EXISTS document_items (
  id SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  quantity NUMERIC(18, 4) NOT NULL,
  unit_price NUMERIC(18, 4) DEFAULT 0,
  discount NUMERIC(18, 4) DEFAULT 0,
  location TEXT DEFAULT 'main',
  is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS doc_items_doc_id ON document_items (document_id);
CREATE INDEX IF NOT EXISTS doc_items_item_id ON document_items (item_id);

CREATE TABLE IF NOT EXISTS transactions (
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
  reversal_of_id INTEGER,
  is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS tx_item_date_id_active ON transactions (item_id, is_deleted, date, id);
CREATE INDEX IF NOT EXISTS tx_item_loc_active ON transactions (item_id, location, is_deleted);
CREATE INDEX IF NOT EXISTS tx_item_active_date ON transactions (item_id, is_deleted, date DESC);
CREATE INDEX IF NOT EXISTS tx_doc_id ON transactions (document_id);
CREATE INDEX IF NOT EXISTS tx_date ON transactions (date);
CREATE INDEX IF NOT EXISTS tx_type_deleted ON transactions (type, is_deleted);

CREATE TABLE IF NOT EXISTS item_prices (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id),
  title TEXT NOT NULL,
  price NUMERIC(18, 4) NOT NULL,
  currency TEXT DEFAULT 'IRR',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS item_prices_item_id ON item_prices (item_id);

CREATE TABLE IF NOT EXISTS activity_logs (
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
);

CREATE INDEX IF NOT EXISTS activity_logs_username ON activity_logs (username);
CREATE INDEX IF NOT EXISTS activity_logs_action ON activity_logs (action);
CREATE INDEX IF NOT EXISTS activity_logs_entity ON activity_logs (entity);
CREATE INDEX IF NOT EXISTS activity_logs_timestamp ON activity_logs (timestamp);

CREATE TABLE IF NOT EXISTS production_projects (
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
  version INTEGER NOT NULL DEFAULT 1,
  is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_proj_code ON production_projects (project_code);
CREATE INDEX IF NOT EXISTS idx_proj_status ON production_projects (status);
CREATE INDEX IF NOT EXISTS idx_proj_deleted ON production_projects (is_deleted);

CREATE TABLE IF NOT EXISTS project_stages (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES production_projects(id),
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
  is_deleted INTEGER DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stage_proj ON project_stages (project_id);
CREATE INDEX IF NOT EXISTS idx_stage_order ON project_stages (stage_order);

CREATE TABLE IF NOT EXISTS transfers (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT DEFAULT '',
  image TEXT DEFAULT '',
  thumbnail TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfer_code ON transfers (code);

CREATE TABLE IF NOT EXISTS daily_work_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  username TEXT NOT NULL,
  user_full_name TEXT DEFAULT '',
  date TEXT NOT NULL,
  date_iso TEXT DEFAULT '',
  start_time TEXT DEFAULT '08:00',
  end_time TEXT DEFAULT '17:00',
  work_hours NUMERIC(18, 4) DEFAULT 8,
  work_mode TEXT DEFAULT 'onsite',
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  project_code TEXT DEFAULT '',
  project_id INTEGER REFERENCES production_projects(id),
  task_category TEXT DEFAULT '',
  pieces_completed INTEGER DEFAULT 0,
  status TEXT DEFAULT 'submitted',
  admin_notes TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dwl_user_date ON daily_work_logs (user_id, date);
CREATE INDEX IF NOT EXISTS idx_dwl_user_date_iso ON daily_work_logs (user_id, date_iso);
CREATE INDEX IF NOT EXISTS idx_dwl_project ON daily_work_logs (project_id);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'info',
  link TEXT DEFAULT '',
  is_read INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_user_unread ON notifications (user_id, is_read);

CREATE TABLE IF NOT EXISTS crm_leads (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  city TEXT DEFAULT '',
  province TEXT DEFAULT '',
  source TEXT DEFAULT 'direct',
  status TEXT DEFAULT 'new_lead',
  assigned_to INTEGER REFERENCES users(id),
  sales_rep_id INTEGER,
  estimated_value NUMERIC(18, 4) DEFAULT 0,
  currency TEXT DEFAULT 'IRR',
  priority TEXT DEFAULT 'medium',
  notes TEXT DEFAULT '',
  tags JSONB DEFAULT '[]'::jsonb,
  customer_id INTEGER REFERENCES customers(id),
  proforma_id INTEGER REFERENCES documents(id) ON DELETE SET NULL ON UPDATE CASCADE,
  last_contact_date TIMESTAMP,
  next_follow_up_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by INTEGER REFERENCES users(id),
  is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_crm_status ON crm_leads (status);
CREATE INDEX IF NOT EXISTS idx_crm_assigned ON crm_leads (assigned_to);
CREATE INDEX IF NOT EXISTS idx_crm_customer ON crm_leads (customer_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_documents_crm_lead') THEN
    ALTER TABLE documents ADD CONSTRAINT fk_documents_crm_lead FOREIGN KEY (crm_lead_id) REFERENCES crm_leads(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS crm_activities (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT DEFAULT '',
  activity_date TIMESTAMP DEFAULT NOW(),
  activity_date_iso TEXT DEFAULT '',
  performed_by INTEGER NOT NULL REFERENCES users(id),
  duration_minutes INTEGER DEFAULT 0,
  result TEXT DEFAULT '',
  next_step TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_act_lead ON crm_activities (lead_id);
CREATE INDEX IF NOT EXISTS idx_crm_act_lead_iso ON crm_activities (lead_id, activity_date_iso);

CREATE TABLE IF NOT EXISTS personnel (
  id SERIAL PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  national_id TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  hire_date TEXT DEFAULT '',
  job_title TEXT NOT NULL,
  department TEXT DEFAULT 'تولید',
  status TEXT DEFAULT 'active',
  user_id INTEGER REFERENCES users(id),
  salary_type TEXT DEFAULT 'piecework',
  monthly_salary NUMERIC(18, 4) DEFAULT 0,
  insurance_included INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  emergency_contact JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_personnel_status ON personnel (status);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_crm_leads_sales_rep') THEN
    ALTER TABLE crm_leads ADD CONSTRAINT fk_crm_leads_sales_rep FOREIGN KEY (sales_rep_id) REFERENCES personnel(id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS task_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS piecework_tasks (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category_id INTEGER REFERENCES task_categories(id),
  category_name TEXT DEFAULT '',
  item_id INTEGER REFERENCES items(id),
  item_code TEXT DEFAULT '',
  unit TEXT DEFAULT 'عدد',
  default_rate NUMERIC(18, 4) NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'IRR',
  estimated_minutes NUMERIC(18, 4) DEFAULT 0,
  difficulty_level TEXT DEFAULT 'medium',
  description TEXT DEFAULT '',
  is_active INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pw_task_code ON piecework_tasks (code);
CREATE INDEX IF NOT EXISTS idx_pw_task_category ON piecework_tasks (category_id);

CREATE TABLE IF NOT EXISTS piecework_task_rate_history (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES piecework_tasks(id),
  rate NUMERIC(18, 4) NOT NULL,
  effective_date TIMESTAMP DEFAULT NOW(),
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_pw_rate_hist_task ON piecework_task_rate_history (task_id);

CREATE TABLE IF NOT EXISTS piecework_personnel_rates (
  id SERIAL PRIMARY KEY,
  personnel_id INTEGER NOT NULL REFERENCES personnel(id),
  task_id INTEGER NOT NULL REFERENCES piecework_tasks(id),
  custom_rate NUMERIC(18, 4) NOT NULL,
  notes TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pw_pr_personnel ON piecework_personnel_rates (personnel_id);
CREATE INDEX IF NOT EXISTS idx_pw_pr_task ON piecework_personnel_rates (task_id);

CREATE TABLE IF NOT EXISTS piecework_payrolls (
  id SERIAL PRIMARY KEY,
  payroll_code TEXT NOT NULL UNIQUE,
  personnel_id INTEGER NOT NULL REFERENCES personnel(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  total_pieces INTEGER NOT NULL DEFAULT 0,
  total_base_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  bonus_amount NUMERIC(18, 4) DEFAULT 0,
  deduction_amount NUMERIC(18, 4) DEFAULT 0,
  final_payable NUMERIC(18, 4) NOT NULL DEFAULT 0,
  total_fixed_amount NUMERIC(18, 4) DEFAULT 0,
  currency TEXT DEFAULT 'IRR',
  status TEXT DEFAULT 'draft',
  payment_method TEXT DEFAULT 'bank_transfer',
  payment_ref TEXT DEFAULT '',
  paid_at TIMESTAMP,
  paid_by INTEGER REFERENCES users(id),
  notes TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pw_payroll_personnel ON piecework_payrolls (personnel_id);
CREATE INDEX IF NOT EXISTS idx_pw_payroll_status ON piecework_payrolls (status);

CREATE TABLE IF NOT EXISTS piecework_logs (
  id SERIAL PRIMARY KEY,
  personnel_id INTEGER NOT NULL REFERENCES personnel(id),
  task_id INTEGER NOT NULL REFERENCES piecework_tasks(id),
  project_id INTEGER REFERENCES production_projects(id),
  work_date TEXT NOT NULL,
  work_date_iso TEXT DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_rate NUMERIC(18, 4) NOT NULL DEFAULT 0,
  total_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'IRR',
  status TEXT DEFAULT 'submitted',
  payroll_id INTEGER REFERENCES piecework_payrolls(id) ON DELETE SET NULL ON UPDATE CASCADE,
  approved_by INTEGER REFERENCES users(id),
  approved_at TIMESTAMP,
  notes TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW(),
  is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pw_log_personnel_date ON piecework_logs (personnel_id, work_date);
CREATE INDEX IF NOT EXISTS idx_pw_log_personnel_date_iso ON piecework_logs (personnel_id, work_date_iso);
CREATE INDEX IF NOT EXISTS idx_pw_log_status ON piecework_logs (status);
CREATE INDEX IF NOT EXISTS idx_pw_log_payroll ON piecework_logs (payroll_id);

CREATE TABLE IF NOT EXISTS pending_materials (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT DEFAULT '',
  unit TEXT NOT NULL,
  quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
  purchase_price NUMERIC(18, 4) DEFAULT 0,
  currency TEXT DEFAULT 'IRR',
  supplier_id INTEGER REFERENCES customers(id),
  supplier_name TEXT DEFAULT '',
  location TEXT DEFAULT 'main',
  notes TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  approved_by INTEGER REFERENCES users(id),
  approved_at TIMESTAMP,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pending_mat_status ON pending_materials (status);

-- ----------------------------------------------------------------------------
-- 3. Accounting & Financial Tables
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  level TEXT NOT NULL,
  parent_id INTEGER REFERENCES accounts(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  nature TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT DEFAULT '',
  is_system INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  balance NUMERIC(18, 4) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_accounts_code ON accounts (code);
CREATE INDEX IF NOT EXISTS idx_accounts_level ON accounts (level);
CREATE INDEX IF NOT EXISTS idx_accounts_parent ON accounts (parent_id);

CREATE TABLE IF NOT EXISTS journal_vouchers (
  id SERIAL PRIMARY KEY,
  voucher_number INTEGER NOT NULL,
  voucher_date TIMESTAMP NOT NULL DEFAULT NOW(),
  type TEXT NOT NULL DEFAULT 'general',
  description TEXT NOT NULL,
  reference_type TEXT,
  reference_id INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  total_debit NUMERIC(18, 4) NOT NULL DEFAULT 0,
  total_credit NUMERIC(18, 4) NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  is_deleted INTEGER DEFAULT 0,
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_jv_number ON journal_vouchers (voucher_number);
CREATE INDEX IF NOT EXISTS idx_jv_date ON journal_vouchers (voucher_date);
CREATE INDEX IF NOT EXISTS idx_jv_status ON journal_vouchers (status);
CREATE INDEX IF NOT EXISTS idx_jv_ref ON journal_vouchers (reference_type, reference_id);

CREATE TABLE IF NOT EXISTS journal_voucher_items (
  id SERIAL PRIMARY KEY,
  voucher_id INTEGER NOT NULL REFERENCES journal_vouchers(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  detailed_account_id INTEGER REFERENCES accounts(id),
  row_order INTEGER NOT NULL DEFAULT 1,
  description TEXT NOT NULL,
  debit NUMERIC(18, 4) NOT NULL DEFAULT 0,
  credit NUMERIC(18, 4) NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'IRR',
  currency_rate NUMERIC(18, 4) DEFAULT 1,
  foreign_amount NUMERIC(18, 4) DEFAULT 0,
  is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_jvi_voucher ON journal_voucher_items (voucher_id);
CREATE INDEX IF NOT EXISTS idx_jvi_account ON journal_voucher_items (account_id);
CREATE INDEX IF NOT EXISTS idx_jvi_detailed ON journal_voucher_items (detailed_account_id);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id SERIAL PRIMARY KEY,
  bank_name TEXT NOT NULL,
  branch_name TEXT DEFAULT '',
  account_number TEXT NOT NULL,
  account_type TEXT DEFAULT 'checking',
  shaba_number TEXT DEFAULT '',
  card_number TEXT DEFAULT '',
  pos_terminal_id TEXT DEFAULT '',
  initial_balance NUMERIC(18, 4) DEFAULT 0,
  current_balance NUMERIC(18, 4) DEFAULT 0,
  currency TEXT DEFAULT 'IRR',
  account_id INTEGER REFERENCES accounts(id),
  is_active INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_bank_acc_number ON bank_accounts (account_number);

CREATE TABLE IF NOT EXISTS cheques (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  sayad_number TEXT DEFAULT '',
  serial_number TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  branch_name TEXT DEFAULT '',
  account_number TEXT DEFAULT '',
  amount NUMERIC(18, 4) NOT NULL,
  currency TEXT DEFAULT 'IRR',
  due_date TEXT NOT NULL,
  issue_date TEXT DEFAULT '',
  drawer_name TEXT NOT NULL,
  drawer_national_id TEXT DEFAULT '',
  payee_name TEXT NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'received',
  status_history JSONB DEFAULT '[]'::jsonb,
  bank_account_id INTEGER REFERENCES bank_accounts(id),
  voucher_id INTEGER REFERENCES journal_vouchers(id) ON DELETE SET NULL ON UPDATE CASCADE,
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_cheques_type ON cheques (type);
CREATE INDEX IF NOT EXISTS idx_cheques_status ON cheques (status);
CREATE INDEX IF NOT EXISTS idx_cheques_due_date ON cheques (due_date);
CREATE INDEX IF NOT EXISTS idx_cheques_sayad ON cheques (sayad_number);

CREATE TABLE IF NOT EXISTS treasury_transactions (
  id SERIAL PRIMARY KEY,
  tx_number INTEGER NOT NULL,
  type TEXT NOT NULL,
  date TIMESTAMP NOT NULL DEFAULT NOW(),
  amount NUMERIC(18, 4) NOT NULL,
  currency TEXT DEFAULT 'IRR',
  payment_method TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id INTEGER,
  destination_type TEXT NOT NULL,
  destination_id INTEGER,
  customer_id INTEGER REFERENCES customers(id),
  cheque_id INTEGER REFERENCES cheques(id),
  document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL ON UPDATE CASCADE,
  voucher_id INTEGER REFERENCES journal_vouchers(id) ON DELETE SET NULL ON UPDATE CASCADE,
  reference_number TEXT DEFAULT '',
  description TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_tt_number ON treasury_transactions (tx_number);
CREATE INDEX IF NOT EXISTS idx_tt_date ON treasury_transactions (date);
CREATE INDEX IF NOT EXISTS idx_tt_type ON treasury_transactions (type);
CREATE INDEX IF NOT EXISTS idx_tt_customer ON treasury_transactions (customer_id);

CREATE TABLE IF NOT EXISTS accounting_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT DEFAULT '',
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 4. Workflow Engine Tables
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS workflow_definitions (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  entity_type TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  current_version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_wf_def_code ON workflow_definitions (code);
CREATE INDEX IF NOT EXISTS idx_wf_def_entity ON workflow_definitions (entity_type);

CREATE TABLE IF NOT EXISTS workflow_states (
  id SERIAL PRIMARY KEY,
  workflow_id INTEGER NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  state_type TEXT NOT NULL,
  position_x NUMERIC(18, 4) DEFAULT 0,
  position_y NUMERIC(18, 4) DEFAULT 0,
  sla_hours INTEGER DEFAULT 0,
  color TEXT DEFAULT '#64748b',
  is_initial INTEGER DEFAULT 0,
  is_final INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_wf_state_wf ON workflow_states (workflow_id);

CREATE TABLE IF NOT EXISTS workflow_transitions (
  id SERIAL PRIMARY KEY,
  workflow_id INTEGER NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  from_state_id INTEGER NOT NULL REFERENCES workflow_states(id),
  to_state_id INTEGER NOT NULL REFERENCES workflow_states(id),
  action_code TEXT NOT NULL,
  action_name TEXT NOT NULL,
  required_role TEXT,
  required_permissions JSONB DEFAULT '[]'::jsonb,
  approval_type TEXT DEFAULT 'SINGLE',
  required_approvals_count INTEGER DEFAULT 1,
  rule_conditions_json JSONB DEFAULT '[]'::jsonb,
  auto_actions_json JSONB DEFAULT '[]'::jsonb,
  is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_wf_trans_wf ON workflow_transitions (workflow_id);
CREATE INDEX IF NOT EXISTS idx_wf_trans_from ON workflow_transitions (from_state_id);

CREATE TABLE IF NOT EXISTS workflow_instances (
  id SERIAL PRIMARY KEY,
  workflow_id INTEGER NOT NULL REFERENCES workflow_definitions(id),
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  current_state_id INTEGER NOT NULL REFERENCES workflow_states(id),
  definition_version INTEGER NOT NULL DEFAULT 1,
  snapshot_dsl JSONB DEFAULT '{}'::jsonb,
  started_by INTEGER REFERENCES users(id),
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  status TEXT DEFAULT 'in_progress',
  updated_at TIMESTAMP DEFAULT NOW(),
  is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_wf_inst_entity ON workflow_instances (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_wf_inst_status ON workflow_instances (status);

CREATE TABLE IF NOT EXISTS workflow_pending_approvals (
  id SERIAL PRIMARY KEY,
  instance_id INTEGER NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  transition_id INTEGER NOT NULL REFERENCES workflow_transitions(id),
  approver_id INTEGER REFERENCES users(id),
  approver_role TEXT,
  approval_progress_json JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  status TEXT DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_wf_pa_instance ON workflow_pending_approvals (instance_id);

CREATE TABLE IF NOT EXISTS workflow_history_logs (
  id SERIAL PRIMARY KEY,
  instance_id INTEGER NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  from_state_id INTEGER REFERENCES workflow_states(id),
  to_state_id INTEGER NOT NULL REFERENCES workflow_states(id),
  action_code TEXT NOT NULL,
  performed_by INTEGER REFERENCES users(id),
  performed_at TIMESTAMP DEFAULT NOW(),
  comments TEXT DEFAULT '',
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_wf_hist_instance ON workflow_history_logs (instance_id);

CREATE TABLE IF NOT EXISTS workflow_definition_versions (
  id SERIAL PRIMARY KEY,
  workflow_id INTEGER NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  definition_dsl JSONB NOT NULL,
  published_by INTEGER REFERENCES users(id),
  published_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wf_def_ver_wf ON workflow_definition_versions (workflow_id, version);

CREATE TABLE IF NOT EXISTS workflow_tasks (
  id SERIAL PRIMARY KEY,
  instance_id INTEGER NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  assigned_user_id INTEGER REFERENCES users(id),
  assigned_role TEXT,
  task_title TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  due_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wf_task_inst ON workflow_tasks (instance_id);

CREATE TABLE IF NOT EXISTS workflow_delegations (
  id SERIAL PRIMARY KEY,
  delegator_id INTEGER NOT NULL REFERENCES users(id),
  delegatee_id INTEGER NOT NULL REFERENCES users(id),
  workflow_id INTEGER REFERENCES workflow_definitions(id),
  start_date TIMESTAMP NOT NULL,
  end_date TIMESTAMP NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wf_deleg_users ON workflow_delegations (delegator_id, delegatee_id);

-- ----------------------------------------------------------------------------
-- 5. Outbox, Event Engine, Dead Letter Queue & Webhooks
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS outbox_events (
  id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  status TEXT DEFAULT 'pending',
  retry_count INTEGER DEFAULT 0,
  next_retry_at TIMESTAMP,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  processed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_outbox_status_retry ON outbox_events (status, next_retry_at);

CREATE TABLE IF NOT EXISTS event_action_rules (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  event_type_pattern TEXT NOT NULL,
  conditions_json JSONB DEFAULT '[]'::jsonb,
  action_type TEXT NOT NULL,
  action_config_json JSONB NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ear_pattern ON event_action_rules (event_type_pattern);

CREATE TABLE IF NOT EXISTS event_action_logs (
  id SERIAL PRIMARY KEY,
  rule_id INTEGER REFERENCES event_action_rules(id) ON DELETE SET NULL,
  event_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  executed_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eal_event ON event_action_logs (event_id);

CREATE TABLE IF NOT EXISTS dead_letter_events (
  id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  error_message TEXT,
  stack_trace TEXT,
  failed_at TIMESTAMP DEFAULT NOW(),
  status TEXT DEFAULT 'quarantined',
  replayed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dle_status ON dead_letter_events (status);

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id SERIAL PRIMARY KEY,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  event_pattern TEXT NOT NULL DEFAULT '*',
  is_active INTEGER DEFAULT 1,
  custom_headers JSONB DEFAULT '{}'::jsonb,
  retry_limit INTEGER DEFAULT 3,
  timeout_ms INTEGER DEFAULT 5000,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wh_sub_active ON webhook_subscriptions (is_active);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id SERIAL PRIMARY KEY,
  subscription_id INTEGER NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  response_status INTEGER,
  response_body TEXT,
  latency_ms INTEGER,
  delivery_status TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wh_del_sub ON webhook_deliveries (subscription_id);

CREATE TABLE IF NOT EXISTS woocommerce_order_logs (
  id SERIAL PRIMARY KEY,
  woo_order_id TEXT NOT NULL UNIQUE,
  document_id INTEGER REFERENCES documents(id),
  status TEXT NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_woo_order_id ON woocommerce_order_logs (woo_order_id);

CREATE TABLE IF NOT EXISTS form_drafts (
  id SERIAL PRIMARY KEY,
  form_type TEXT NOT NULL,
  draft_key TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  payload JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_form_drafts_user_type ON form_drafts (user_id, form_type);

CREATE TABLE IF NOT EXISTS project_bom_allocations (
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
);

CREATE INDEX IF NOT EXISTS idx_bom_alloc_proj ON project_bom_allocations (project_id);
CREATE INDEX IF NOT EXISTS idx_bom_alloc_item ON project_bom_allocations (item_id);
CREATE INDEX IF NOT EXISTS idx_bom_alloc_status ON project_bom_allocations (status);
CREATE INDEX IF NOT EXISTS idx_bom_alloc_src_tx ON project_bom_allocations (source_transaction_id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL DEFAULT 'global',
  status TEXT NOT NULL DEFAULT 'processing',
  request_method TEXT,
  request_path TEXT,
  request_payload JSONB,
  response_status INTEGER,
  response_body JSONB,
  created_by_id INTEGER,
  locked_at TIMESTAMP,
  locked_until TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  expires_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_idempotency_key ON idempotency_keys (key);
CREATE INDEX IF NOT EXISTS idx_idempotency_scope_status ON idempotency_keys (scope, status);

-- ----------------------------------------------------------------------------
-- 6. Check Constraints for Financial and JSONB Integrity
-- ----------------------------------------------------------------------------

DO $$
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
END $$;

-- ----------------------------------------------------------------------------
-- 7. Triggers & PostgreSQL Helper Functions
-- ----------------------------------------------------------------------------

-- Function: Stock consistency auto-sync
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

-- Function: Generic updated_at timestamp refresher
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Register updated_at triggers
DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_personnel_updated_at ON personnel;
CREATE TRIGGER trg_personnel_updated_at BEFORE UPDATE ON personnel FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_treasury_tx_updated_at ON treasury_transactions;
CREATE TRIGGER trg_treasury_tx_updated_at BEFORE UPDATE ON treasury_transactions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_workflow_instances_updated_at ON workflow_instances;
CREATE TRIGGER trg_workflow_instances_updated_at BEFORE UPDATE ON workflow_instances FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_item_prices_updated_at ON item_prices;
CREATE TRIGGER trg_item_prices_updated_at BEFORE UPDATE ON item_prices FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_project_stages_updated_at ON project_stages;
CREATE TRIGGER trg_project_stages_updated_at BEFORE UPDATE ON project_stages FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_transfers_updated_at ON transfers;
CREATE TRIGGER trg_transfers_updated_at BEFORE UPDATE ON transfers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_crm_leads_updated_at ON crm_leads;
CREATE TRIGGER trg_crm_leads_updated_at BEFORE UPDATE ON crm_leads FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_accounting_settings_updated_at ON accounting_settings;
CREATE TRIGGER trg_accounting_settings_updated_at BEFORE UPDATE ON accounting_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_event_action_rules_updated_at ON event_action_rules;
CREATE TRIGGER trg_event_action_rules_updated_at BEFORE UPDATE ON event_action_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_webhook_subscriptions_updated_at ON webhook_subscriptions;
CREATE TRIGGER trg_webhook_subscriptions_updated_at BEFORE UPDATE ON webhook_subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_woocommerce_order_logs_updated_at ON woocommerce_order_logs;
CREATE TRIGGER trg_woocommerce_order_logs_updated_at BEFORE UPDATE ON woocommerce_order_logs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_form_drafts_updated_at ON form_drafts;
CREATE TRIGGER trg_form_drafts_updated_at BEFORE UPDATE ON form_drafts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
