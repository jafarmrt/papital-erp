CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS journal_voucher_number_seq START WITH 1 INCREMENT BY 1;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS treasury_tx_number_seq START WITH 1 INCREMENT BY 1;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password text NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL,
  avatar_url text DEFAULT '',
  must_reset_password integer DEFAULT 0,
  failed_login_count integer DEFAULT 0,
  locked_until text,
  token_version integer DEFAULT 0,
  is_deleted integer DEFAULT 0,
  updated_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS roles (
  id serial PRIMARY KEY,
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  description text DEFAULT '',
  permissions jsonb DEFAULT '[]'::jsonb,
  is_system integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS warehouses (
  id serial PRIMARY KEY,
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  is_active integer DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS categories (
  id serial PRIMARY KEY,
  name text NOT NULL,
  prefix text NOT NULL,
  type text NOT NULL,
  default_unit text DEFAULT 'عدد'
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS task_categories (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  description text DEFAULT '',
  is_deleted integer DEFAULT 0,
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS customers (
  id serial PRIMARY KEY,
  name text NOT NULL,
  contact_name text DEFAULT '',
  country text DEFAULT 'ایران',
  province text DEFAULT '',
  phone text DEFAULT '',
  city text DEFAULT '',
  address text DEFAULT '',
  notes text DEFAULT '',
  party_type text DEFAULT 'customer',
  supplier_category text DEFAULT '',
  bank_info jsonb DEFAULT '{}'::jsonb,
  contacts jsonb DEFAULT '[]'::jsonb,
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  is_deleted integer DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS customers_name_trgm_idx ON customers USING gin (name gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_customers_party_type ON customers (party_type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_customers_is_deleted ON customers (is_deleted);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS changelogs (
  id serial PRIMARY KEY,
  version text NOT NULL,
  date timestamp NOT NULL,
  features text NOT NULL,
  fixes text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS migrations_log (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  applied_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS items (
  id serial PRIMARY KEY,
  type text NOT NULL,
  name text NOT NULL,
  code text NOT NULL,
  current_stock numeric(18, 4) DEFAULT 0,
  unit text NOT NULL,
  category text DEFAULT '',
  image text DEFAULT '',
  thumbnail text DEFAULT '',
  reorder_point numeric(18, 4) DEFAULT 0,
  weighted_average_cost numeric(18, 4) DEFAULT 0,
  stocks jsonb DEFAULT '{}'::jsonb,
  color text,
  weight numeric(18, 4),
  material text,
  size text,
  last_kardex_rebuild_at timestamp,
  version integer NOT NULL DEFAULT 1,
  is_deleted integer DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS items_type_deleted ON items (type, is_deleted);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS items_code ON items (code);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS items_category ON items (category);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS items_name_trgm_idx ON items USING gin (name gin_trgm_ops);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS documents (
  id serial PRIMARY KEY,
  type text NOT NULL,
  ref_number text NOT NULL,
  date timestamp NOT NULL,
  crm_lead_id integer,
  "user" text,
  notes text,
  buyer_name text DEFAULT '',
  buyer_city text DEFAULT '',
  buyer_phone text DEFAULT '',
  buyer_address text DEFAULT '',
  status text DEFAULT 'final',
  currency text DEFAULT 'IRR',
  version integer NOT NULL DEFAULT 1,
  is_deleted integer DEFAULT 0,
  deleted_at timestamp,
  deleted_by text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS docs_type_deleted ON documents (type, is_deleted);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS docs_date ON documents (date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_docs_buyer_name ON documents (buyer_name);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS document_ref_counters (
  doc_type varchar(20) NOT NULL,
  fiscal_year integer NOT NULL,
  last_ref_number integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS item_code_counters (
  scope varchar(20) NOT NULL,
  prefix_key varchar(60) NOT NULL,
  last_number integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS document_items (
  id serial PRIMARY KEY,
  document_id integer NOT NULL,
  item_id integer NOT NULL,
  quantity numeric(18, 4) NOT NULL,
  unit_price numeric(18, 4) DEFAULT 0,
  discount numeric(18, 4) DEFAULT 0,
  location text DEFAULT 'main',
  is_deleted integer DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS doc_items_doc_id ON document_items (document_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS doc_items_item_id ON document_items (item_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS transactions (
  id serial PRIMARY KEY,
  item_id integer NOT NULL,
  document_id integer,
  type text NOT NULL,
  quantity numeric(18, 4) NOT NULL,
  unit_price numeric(18, 4) DEFAULT 0,
  total_price numeric(18, 4) DEFAULT 0,
  date timestamp NOT NULL,
  document_type text,
  document_ref text,
  created_by text,
  notes text,
  location text DEFAULT 'main',
  reversal_of_id integer,
  is_deleted integer DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tx_item_date_id_active ON transactions (item_id, is_deleted, date, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tx_item_loc_active ON transactions (item_id, location, is_deleted);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tx_item_active_date ON transactions (item_id, is_deleted, date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tx_doc_id ON transactions (document_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tx_date ON transactions (date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tx_type_deleted ON transactions (type, is_deleted);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS item_prices (
  id serial PRIMARY KEY,
  item_id integer NOT NULL,
  title text NOT NULL,
  price numeric(18, 4) NOT NULL,
  currency text DEFAULT 'IRR',
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  updated_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  is_deleted integer DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS item_prices_item_id ON item_prices (item_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS activity_logs (
  id serial PRIMARY KEY,
  user_id integer,
  username text NOT NULL,
  user_full_name text DEFAULT '',
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text DEFAULT '',
  description text NOT NULL,
  details jsonb DEFAULT '{}'::jsonb,
  ip_address text DEFAULT '',
  timestamp timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS activity_logs_username ON activity_logs (username);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS activity_logs_action ON activity_logs (action);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS activity_logs_entity ON activity_logs (entity);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS activity_logs_timestamp ON activity_logs (timestamp);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS personnel (
  id serial PRIMARY KEY,
  first_name text DEFAULT '',
  last_name text DEFAULT '',
  full_name text NOT NULL,
  personnel_code text DEFAULT '',
  user_id integer,
  gender text DEFAULT 'مرد',
  birth_date text DEFAULT '',
  nationality text DEFAULT 'ایرانی',
  national_id text DEFAULT '',
  phone text DEFAULT '',
  employment_status text DEFAULT 'فعال',
  salary_type text DEFAULT 'none',
  monthly_salary numeric(18, 4) DEFAULT 0,
  job_title text DEFAULT '',
  education text DEFAULT '',
  end_date text DEFAULT '',
  termination_reason text DEFAULT '',
  specialized_skills text DEFAULT '',
  other_skills text DEFAULT '',
  referral_source text DEFAULT '',
  card_number text DEFAULT '',
  account_number text DEFAULT '',
  sheba_number text DEFAULT '',
  bank_name text DEFAULT '',
  nobitex_username text DEFAULT '',
  nobitex_password text DEFAULT '',
  address text DEFAULT '',
  notes text DEFAULT '',
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  updated_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  is_deleted integer DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_personnel_code ON personnel (personnel_code);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_personnel_user ON personnel (user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_personnel_status ON personnel (employment_status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_personnel_deleted ON personnel (is_deleted);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS transfers (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  title text DEFAULT '',
  image text DEFAULT '',
  thumbnail text DEFAULT '',
  notes text DEFAULT '',
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  updated_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_transfer_code ON transfers (code);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS production_projects (
  id serial PRIMARY KEY,
  project_code text NOT NULL UNIQUE,
  title text NOT NULL,
  customer_id integer,
  customer_name text DEFAULT '',
  item_id integer,
  item_code text DEFAULT '',
  item_name text DEFAULT '',
  quantity numeric(18, 4) NOT NULL DEFAULT 1,
  unit text DEFAULT 'عدد',
  start_date text DEFAULT '',
  end_date text DEFAULT '',
  status text DEFAULT 'planned',
  priority text DEFAULT 'medium',
  description text DEFAULT '',
  products jsonb DEFAULT '[]'::jsonb,
  inventory_control jsonb DEFAULT '{}'::jsonb,
  stage_schedules jsonb DEFAULT '{}'::jsonb,
  custom_stages jsonb DEFAULT '[]'::jsonb,
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  created_by text DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  is_deleted integer DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_proj_code ON production_projects (project_code);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_proj_status ON production_projects (status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_proj_deleted ON production_projects (is_deleted);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS project_stages (
  id serial PRIMARY KEY,
  project_id integer NOT NULL,
  stage_order integer NOT NULL DEFAULT 1,
  title text NOT NULL,
  status text DEFAULT 'pending',
  start_date text DEFAULT '',
  end_date text DEFAULT '',
  assigned_personnel jsonb DEFAULT '[]'::jsonb,
  required_resources jsonb DEFAULT '[]'::jsonb,
  progress_percent integer DEFAULT 0,
  notes text DEFAULT '',
  completed_at text DEFAULT '',
  is_deleted integer DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_stage_proj ON project_stages (project_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_stage_order ON project_stages (stage_order);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS daily_work_logs (
  id serial PRIMARY KEY,
  user_id integer NOT NULL,
  username text NOT NULL,
  user_full_name text DEFAULT '',
  date text NOT NULL,
  date_iso text DEFAULT '',
  start_time text DEFAULT '08:00',
  end_time text DEFAULT '17:00',
  work_hours numeric(18, 4) DEFAULT 8,
  work_mode text DEFAULT 'onsite',
  title text NOT NULL,
  content text NOT NULL,
  project_id integer,
  project_name text DEFAULT '',
  tags jsonb DEFAULT '[]'::jsonb,
  mentions jsonb DEFAULT '[]'::jsonb,
  visibility text DEFAULT 'public',
  allowed_users jsonb DEFAULT '[]'::jsonb,
  status text DEFAULT 'submitted',
  manager_notes text DEFAULT '',
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  is_deleted integer DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dwl_user ON daily_work_logs (user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dwl_date ON daily_work_logs (date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dwl_date_iso ON daily_work_logs (date_iso);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dwl_vis ON daily_work_logs (visibility);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dwl_deleted ON daily_work_logs (is_deleted);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS pending_materials (
  id serial PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  unit text NOT NULL,
  category text DEFAULT '',
  type text DEFAULT 'raw_material',
  project_id integer,
  project_title text DEFAULT '',
  requested_by text DEFAULT '',
  status text DEFAULT 'pending',
  reorder_point numeric(18, 4) DEFAULT 0,
  weighted_average_cost numeric(18, 4) DEFAULT 0,
  color text DEFAULT '',
  weight numeric(18, 4) DEFAULT 0,
  material text DEFAULT '',
  size text DEFAULT '',
  image text DEFAULT '',
  thumbnail text DEFAULT '',
  rejection_reason text DEFAULT '',
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  is_deleted integer DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pmat_status ON pending_materials (status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pmat_code ON pending_materials (code);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pmat_deleted ON pending_materials (is_deleted);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS piecework_tasks (
  id serial PRIMARY KEY,
  code text NOT NULL,
  title text NOT NULL,
  category text DEFAULT 'سایر',
  default_rate numeric(18, 4) DEFAULT 0,
  unit text DEFAULT 'عدد',
  description text DEFAULT '',
  is_active integer DEFAULT 1,
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  is_deleted integer DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ptask_code ON piecework_tasks (code);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ptask_cat ON piecework_tasks (category);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ptask_deleted ON piecework_tasks (is_deleted);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS piecework_task_rate_history (
  id serial PRIMARY KEY,
  task_id integer NOT NULL,
  task_code text DEFAULT '',
  task_title text DEFAULT '',
  old_rate numeric(18, 4) DEFAULT 0,
  new_rate numeric(18, 4) NOT NULL,
  change_type text DEFAULT 'rate_change',
  reason text DEFAULT '',
  changed_by_user_id integer,
  changed_by_username text DEFAULT '',
  effective_date text NOT NULL,
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ptrh_task ON piecework_task_rate_history (task_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ptrh_created ON piecework_task_rate_history (created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS piecework_personnel_rates (
  id serial PRIMARY KEY,
  personnel_id integer NOT NULL,
  task_id integer NOT NULL,
  custom_rate numeric(18, 4) NOT NULL,
  updated_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  is_deleted integer DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ppr_personnel ON piecework_personnel_rates (personnel_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ppr_task ON piecework_personnel_rates (task_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS piecework_payrolls (
  id serial PRIMARY KEY,
  payroll_number text NOT NULL,
  personnel_id integer NOT NULL,
  start_date text NOT NULL,
  end_date text NOT NULL,
  title text NOT NULL,
  total_piecework_amount numeric(18, 4) NOT NULL DEFAULT 0,
  total_bonuses numeric(18, 4) DEFAULT 0,
  total_deductions numeric(18, 4) DEFAULT 0,
  net_payable numeric(18, 4) NOT NULL,
  total_fixed_amount numeric(18, 4) DEFAULT 0,
  advance_deduction numeric(18, 4) DEFAULT 0,
  status text DEFAULT 'draft',
  payment_date text DEFAULT '',
  payment_method text DEFAULT '',
  payment_reference text DEFAULT '',
  notes text DEFAULT '',
  created_by_id integer,
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  is_deleted integer DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ppay_personnel ON piecework_payrolls (personnel_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ppay_number ON piecework_payrolls (payroll_number);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ppay_status ON piecework_payrolls (status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ppay_deleted ON piecework_payrolls (is_deleted);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS piecework_logs (
  id serial PRIMARY KEY,
  personnel_id integer NOT NULL,
  task_id integer NOT NULL,
  project_id integer,
  date text NOT NULL,
  date_iso text DEFAULT '',
  quantity numeric(18, 4) NOT NULL,
  unit_rate numeric(18, 4) NOT NULL,
  total_amount numeric(18, 4) NOT NULL,
  notes text DEFAULT '',
  payroll_id integer,
  status text DEFAULT 'pending',
  created_by_id integer,
  created_by_username text DEFAULT '',
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  is_deleted integer DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_plog_personnel ON piecework_logs (personnel_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_plog_task ON piecework_logs (task_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_plog_project ON piecework_logs (project_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_plog_date ON piecework_logs (date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_plog_date_iso ON piecework_logs (date_iso);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_plog_payroll ON piecework_logs (payroll_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_plog_deleted ON piecework_logs (is_deleted);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS accounts (
  id serial PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  level text NOT NULL,
  parent_id integer,
  account_type text NOT NULL,
  nature text NOT NULL DEFAULT 'debit',
  description text DEFAULT '',
  is_system integer DEFAULT 0,
  is_active integer DEFAULT 1,
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  is_deleted integer DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_acc_code ON accounts (code);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_acc_parent ON accounts (parent_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_acc_level ON accounts (level);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_acc_type ON accounts (account_type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_acc_deleted ON accounts (is_deleted);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS journal_vouchers (
  id serial PRIMARY KEY,
  voucher_number integer NOT NULL,
  manual_voucher_number text DEFAULT '',
  date text NOT NULL,
  voucher_type text DEFAULT 'general',
  status text DEFAULT 'approved',
  total_debit numeric(18, 4) NOT NULL DEFAULT 0,
  total_credit numeric(18, 4) NOT NULL DEFAULT 0,
  description text NOT NULL,
  reference_module text DEFAULT 'manual',
  reference_id integer,
  reference_number text DEFAULT '',
  currency text DEFAULT 'IRR',
  created_by_id integer,
  created_by_username text DEFAULT '',
  approved_by_id integer,
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  is_deleted integer DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_jv_number ON journal_vouchers (voucher_number);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_jv_date ON journal_vouchers (date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_jv_status ON journal_vouchers (status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_jv_module ON journal_vouchers (reference_module);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_jv_deleted ON journal_vouchers (is_deleted);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS journal_voucher_items (
  id serial PRIMARY KEY,
  voucher_id integer NOT NULL,
  account_id integer NOT NULL,
  row_order integer DEFAULT 1,
  detailed_type text DEFAULT 'none',
  detailed_id integer,
  detailed_name text DEFAULT '',
  debit numeric(18, 4) NOT NULL DEFAULT 0,
  credit numeric(18, 4) NOT NULL DEFAULT 0,
  currency text DEFAULT 'IRR',
  exchange_rate numeric(18, 4) DEFAULT 1,
  description text DEFAULT '',
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_jvi_voucher ON journal_voucher_items (voucher_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_jvi_account ON journal_voucher_items (account_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_jvi_detailed ON journal_voucher_items (detailed_type, detailed_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS bank_accounts (
  id serial PRIMARY KEY,
  code text NOT NULL,
  title text NOT NULL,
  type text NOT NULL DEFAULT 'bank',
  bank_name text DEFAULT '',
  account_number text DEFAULT '',
  sheba_number text DEFAULT '',
  card_number text DEFAULT '',
  branch text DEFAULT '',
  initial_balance numeric(18, 4) DEFAULT 0,
  current_balance numeric(18, 4) DEFAULT 0,
  currency text DEFAULT 'IRR',
  account_id integer,
  is_active integer DEFAULT 1,
  notes text DEFAULT '',
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  is_deleted integer DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_bank_code ON bank_accounts (code);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_bank_type ON bank_accounts (type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_bank_deleted ON bank_accounts (is_deleted);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS cheques (
  id serial PRIMARY KEY,
  type text NOT NULL,
  cheque_number text NOT NULL,
  sayad_number text DEFAULT '',
  bank_name text NOT NULL,
  branch text DEFAULT '',
  issue_date text NOT NULL,
  due_date text NOT NULL,
  amount numeric(18, 4) NOT NULL,
  currency text DEFAULT 'IRR',
  party_type text DEFAULT 'customer',
  party_id integer,
  party_name text NOT NULL,
  status text DEFAULT 'received',
  drawer_name text DEFAULT '',
  payee_name text DEFAULT '',
  bank_account_id integer,
  voucher_id integer,
  description text DEFAULT '',
  status_history jsonb DEFAULT '[]'::jsonb,
  created_by_id integer,
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  is_deleted integer DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_chq_type ON cheques (type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_chq_due ON cheques (due_date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_chq_status ON cheques (status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_chq_sayad ON cheques (sayad_number);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_chq_deleted ON cheques (is_deleted);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS treasury_transactions (
  id serial PRIMARY KEY,
  transaction_number text NOT NULL,
  type text NOT NULL,
  date text NOT NULL,
  method text NOT NULL,
  amount numeric(18, 4) NOT NULL,
  currency text DEFAULT 'IRR',
  exchange_rate numeric(18, 4) DEFAULT 1,
  bank_account_id integer,
  party_type text DEFAULT 'customer',
  party_id integer,
  party_name text NOT NULL,
  tracking_number text DEFAULT '',
  voucher_id integer,
  cheque_id integer,
  document_id integer,
  payroll_id integer,
  reversal_of_id integer,
  description text DEFAULT '',
  status text DEFAULT 'completed',
  reconciled integer DEFAULT 0,
  reconciled_at text DEFAULT '',
  reconciled_batch text DEFAULT '',
  created_by_id integer,
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  updated_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  is_deleted integer DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_tt_type ON treasury_transactions (type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_tt_date ON treasury_transactions (date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_tt_bank ON treasury_transactions (bank_account_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_tt_deleted ON treasury_transactions (is_deleted);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS accounting_settings (
  id serial PRIMARY KEY,
  key text NOT NULL UNIQUE,
  account_id integer,
  description text DEFAULT '',
  updated_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crm_leads (
  id serial PRIMARY KEY,
  title text NOT NULL,
  customer_id integer,
  customer_name text DEFAULT '',
  phone text DEFAULT '',
  company text DEFAULT '',
  source text DEFAULT 'تماس تلفنی',
  stage text DEFAULT 'lead',
  estimated_value numeric(18, 4) DEFAULT 0,
  currency text DEFAULT 'IRR',
  probability integer DEFAULT 50,
  assigned_to text DEFAULT '',
  assigned_personnel_id integer,
  expected_close_date text DEFAULT '',
  notes text DEFAULT '',
  status text DEFAULT 'active',
  contacts jsonb DEFAULT '[]'::jsonb,
  has_proforma integer DEFAULT 0,
  proforma_id integer,
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  updated_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  created_by text DEFAULT '',
  is_deleted integer DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_crm_stage ON crm_leads (stage);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_crm_assigned ON crm_leads (assigned_to);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_crm_deleted ON crm_leads (is_deleted);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crm_activities (
  id serial PRIMARY KEY,
  lead_id integer,
  customer_id integer,
  type text NOT NULL,
  title text NOT NULL,
  description text DEFAULT '',
  result text DEFAULT '',
  logged_by text DEFAULT '',
  assigned_to text DEFAULT '',
  assigned_personnel_id integer,
  mentions jsonb DEFAULT '[]'::jsonb,
  activity_date text DEFAULT '',
  activity_date_iso text DEFAULT '',
  next_followup_date text DEFAULT '',
  next_followup_date_iso text DEFAULT '',
  next_followup_task text DEFAULT '',
  is_followup_completed integer DEFAULT 0,
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  is_deleted integer DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_crm_act_lead ON crm_activities (lead_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_crm_act_cust ON crm_activities (customer_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_crm_act_date ON crm_activities (activity_date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_crm_act_date_iso ON crm_activities (activity_date_iso);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_crm_act_next_iso ON crm_activities (next_followup_date_iso);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_crm_act_deleted ON crm_activities (is_deleted);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  entity_type text NOT NULL,
  version integer DEFAULT 1,
  is_active integer DEFAULT 1,
  description text DEFAULT '',
  dsl_json jsonb DEFAULT '{}'::jsonb,
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS workflow_definition_versions (
  id serial PRIMARY KEY,
  definition_id integer NOT NULL,
  version integer NOT NULL,
  title text NOT NULL,
  description text DEFAULT '',
  dsl_json jsonb DEFAULT '{}'::jsonb,
  created_by integer,
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_wdv_def_ver ON workflow_definition_versions (definition_id, version);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS workflow_states (
  id serial PRIMARY KEY,
  workflow_definition_id integer NOT NULL,
  state_key text NOT NULL,
  title text NOT NULL,
  state_type text DEFAULT 'intermediate',
  color text DEFAULT 'gray',
  step_order integer DEFAULT 0,
  sla_hours integer DEFAULT 24,
  position_x integer DEFAULT 100,
  position_y integer DEFAULT 100
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS workflow_transitions (
  id serial PRIMARY KEY,
  workflow_definition_id integer NOT NULL,
  from_state_id integer NOT NULL,
  to_state_id integer NOT NULL,
  action_key text NOT NULL,
  title text NOT NULL,
  required_role text DEFAULT '',
  required_permission text DEFAULT '',
  approval_rule_type text DEFAULT 'SINGLE',
  k_value integer DEFAULT 1,
  rule_conditions_json jsonb DEFAULT '[]'::jsonb,
  auto_action_key text DEFAULT ''
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS workflow_instances (
  id serial PRIMARY KEY,
  workflow_definition_id integer NOT NULL,
  definition_version integer DEFAULT 1,
  snapshot_dsl jsonb DEFAULT '{}'::jsonb,
  approval_progress_json jsonb DEFAULT '{}'::jsonb,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  current_state_id integer NOT NULL,
  status text DEFAULT 'IN_PROGRESS',
  started_by integer,
  started_by_name text DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  updated_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS workflow_pending_approvals (
  id serial PRIMARY KEY,
  instance_id integer NOT NULL,
  transition_id integer NOT NULL,
  assigned_role text DEFAULT '',
  assigned_user_id integer,
  status text DEFAULT 'PENDING',
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS workflow_history_logs (
  id serial PRIMARY KEY,
  instance_id integer NOT NULL,
  from_state_id integer,
  to_state_id integer,
  transition_id integer,
  performed_by integer,
  performed_by_name text DEFAULT '',
  action_key text NOT NULL,
  action_title text DEFAULT '',
  comment text DEFAULT '',
  snapshot_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS workflow_tasks (
  id serial PRIMARY KEY,
  instance_id integer NOT NULL,
  transition_id integer,
  assigned_user_id integer,
  assigned_role text DEFAULT '',
  candidate_users jsonb DEFAULT '[]'::jsonb,
  candidate_roles jsonb DEFAULT '[]'::jsonb,
  delegated_to_user_id integer,
  status text NOT NULL DEFAULT 'pending',
  title text NOT NULL,
  description text DEFAULT '',
  due_at timestamp,
  completed_at timestamp,
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_wft_instance ON workflow_tasks (instance_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_wft_assigned_user ON workflow_tasks (assigned_user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_wft_status ON workflow_tasks (status);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS workflow_delegations (
  id serial PRIMARY KEY,
  from_user_id integer NOT NULL,
  to_user_id integer NOT NULL,
  scope text NOT NULL DEFAULT 'ALL',
  start_date timestamp NOT NULL,
  end_date timestamp NOT NULL,
  is_active integer DEFAULT 1,
  reason text DEFAULT '',
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_wfd_from_user ON workflow_delegations (from_user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_wfd_to_user ON workflow_delegations (to_user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_wfd_active ON workflow_delegations (is_active);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS outbox_events (
  id serial PRIMARY KEY,
  event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  payload jsonb DEFAULT '{}'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  retry_count integer DEFAULT 0,
  next_retry_at timestamp,
  last_error text DEFAULT '',
  occurred_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  processed_at timestamp,
  locked_at timestamp,
  locked_by text DEFAULT ''
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_outbox_status_next ON outbox_events (status, next_retry_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_outbox_aggregate ON outbox_events (aggregate_type, aggregate_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_outbox_status_locked ON outbox_events (status, locked_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS event_action_rules (
  id serial PRIMARY KEY,
  name text NOT NULL,
  description text DEFAULT '',
  event_type text NOT NULL,
  conditions_json jsonb DEFAULT '[]'::jsonb,
  action_type text NOT NULL,
  action_config_json jsonb DEFAULT '{}'::jsonb,
  is_active integer DEFAULT 1,
  execution_count integer DEFAULT 0,
  last_executed_at timestamp,
  created_by integer,
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  updated_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_action_rules_event_active ON event_action_rules (event_type, is_active);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS event_action_logs (
  id serial PRIMARY KEY,
  rule_id integer,
  rule_name text DEFAULT '',
  event_id text NOT NULL,
  event_type text NOT NULL,
  action_type text NOT NULL,
  status text NOT NULL,
  result jsonb DEFAULT '{}'::jsonb,
  error_message text DEFAULT '',
  execution_duration_ms integer DEFAULT 0,
  executed_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_action_logs_rule ON event_action_logs (rule_id, executed_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_action_logs_event ON event_action_logs (event_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS dead_letter_events (
  id serial PRIMARY KEY,
  original_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  source text NOT NULL DEFAULT 'outbox',
  payload jsonb DEFAULT '{}'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  failure_reason text NOT NULL,
  error_stack text DEFAULT '',
  retry_count integer DEFAULT 0,
  status text NOT NULL DEFAULT 'quarantined',
  quarantined_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  resolved_at timestamp,
  resolved_by integer,
  resolution_notes text DEFAULT ''
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dlq_status ON dead_letter_events (status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dlq_event_type ON dead_letter_events (event_type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dlq_aggregate ON dead_letter_events (aggregate_type, aggregate_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id serial PRIMARY KEY,
  name text NOT NULL,
  target_url text NOT NULL,
  secret_key text NOT NULL,
  event_patterns jsonb DEFAULT '["*"]'::jsonb,
  custom_headers jsonb DEFAULT '{}'::jsonb,
  is_active integer DEFAULT 1,
  retry_limit integer DEFAULT 3,
  timeout_ms integer DEFAULT 5000,
  total_deliveries integer DEFAULT 0,
  successful_deliveries integer DEFAULT 0,
  failed_deliveries integer DEFAULT 0,
  last_delivery_at timestamp,
  last_status text DEFAULT 'idle',
  last_error text DEFAULT '',
  created_by integer,
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  updated_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_webhook_subs_active ON webhook_subscriptions (is_active);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id serial PRIMARY KEY,
  subscription_id integer NOT NULL,
  subscription_name text DEFAULT '',
  event_id text NOT NULL,
  event_type text NOT NULL,
  target_url text NOT NULL,
  status_code integer DEFAULT 0,
  status text NOT NULL,
  response_body text DEFAULT '',
  error_message text DEFAULT '',
  signature text DEFAULT '',
  attempt integer DEFAULT 1,
  duration_ms integer DEFAULT 0,
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_webhook_deliv_sub ON webhook_deliveries (subscription_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_webhook_deliv_event ON webhook_deliveries (event_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS woocommerce_order_logs (
  id serial PRIMARY KEY,
  wc_order_id text NOT NULL UNIQUE,
  erp_document_id integer,
  status text NOT NULL,
  buyer_name text DEFAULT '',
  total_amount numeric(15, 2) DEFAULT '0',
  payload jsonb,
  error_message text DEFAULT '',
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  updated_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_wc_order_id ON woocommerce_order_logs (wc_order_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_wc_status ON woocommerce_order_logs (status);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS form_drafts (
  id serial PRIMARY KEY,
  user_id integer,
  username text DEFAULT '',
  session_id text DEFAULT '',
  entity_type text NOT NULL,
  draft_key text DEFAULT 'default',
  payload jsonb NOT NULL,
  summary text DEFAULT '',
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  updated_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  expires_at timestamp,
  is_deleted integer DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_form_drafts_user_entity ON form_drafts (user_id, entity_type, draft_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_form_drafts_session ON form_drafts (session_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_form_drafts_updated ON form_drafts (updated_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS project_bom_allocations (
  id serial PRIMARY KEY,
  project_id integer NOT NULL,
  project_code text NOT NULL,
  item_id integer NOT NULL,
  item_code text NOT NULL,
  item_name text NOT NULL,
  quantity numeric(18, 4) NOT NULL,
  unit text DEFAULT 'عدد',
  source_transaction_id integer,
  source_location text DEFAULT 'main',
  status text NOT NULL DEFAULT 'allocated',
  user_id integer,
  username text DEFAULT '',
  notes text DEFAULT '',
  allocated_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  consumed_at timestamp,
  released_at timestamp,
  is_deleted integer DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_bom_alloc_proj ON project_bom_allocations (project_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_bom_alloc_item ON project_bom_allocations (item_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_bom_alloc_status ON project_bom_allocations (status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_bom_alloc_src_tx ON project_bom_allocations (source_transaction_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id serial PRIMARY KEY,
  key text NOT NULL UNIQUE,
  scope text NOT NULL DEFAULT 'global',
  status text NOT NULL DEFAULT 'processing',
  request_method text,
  request_path text,
  request_payload jsonb,
  response_status integer,
  response_body jsonb,
  created_by_id integer,
  locked_at timestamp,
  locked_until timestamp,
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb,
  completed_at timestamp,
  expires_at timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_idempotency_key ON idempotency_keys (key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_idempotency_scope_status ON idempotency_keys (scope, status);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS notifications (
  id serial PRIMARY KEY,
  user_id integer NOT NULL,
  sender_id integer,
  sender_name text DEFAULT '',
  type text DEFAULT 'mention',
  title text NOT NULL,
  message text NOT NULL,
  link text DEFAULT '',
  is_read integer DEFAULT 0,
  created_at timestamp DEFAULT '{"decoder":{},"shouldInlineParams":false,"usedTables":[],"queryChunks":[{"value":["now()"]}]}'::jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications (user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_notif_read ON notifications (is_read);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_item_current_stock()
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
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sync_item_current_stock') THEN
    CREATE TRIGGER trg_sync_item_current_stock
    BEFORE INSERT OR UPDATE OF stocks, current_stock ON items
    FOR EACH ROW
    EXECUTE FUNCTION sync_item_current_stock();
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_users_updated_at') THEN
    CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_personnel_updated_at') THEN
    CREATE TRIGGER trg_personnel_updated_at BEFORE UPDATE ON personnel FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_treasury_transactions_updated_at') THEN
    CREATE TRIGGER trg_treasury_transactions_updated_at BEFORE UPDATE ON treasury_transactions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_workflow_instances_updated_at') THEN
    CREATE TRIGGER trg_workflow_instances_updated_at BEFORE UPDATE ON workflow_instances FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_item_prices_updated_at') THEN
    CREATE TRIGGER trg_item_prices_updated_at BEFORE UPDATE ON item_prices FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_project_stages_updated_at') THEN
    CREATE TRIGGER trg_project_stages_updated_at BEFORE UPDATE ON project_stages FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_transfers_updated_at') THEN
    CREATE TRIGGER trg_transfers_updated_at BEFORE UPDATE ON transfers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_crm_leads_updated_at') THEN
    CREATE TRIGGER trg_crm_leads_updated_at BEFORE UPDATE ON crm_leads FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_accounting_settings_updated_at') THEN
    CREATE TRIGGER trg_accounting_settings_updated_at BEFORE UPDATE ON accounting_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_event_action_rules_updated_at') THEN
    CREATE TRIGGER trg_event_action_rules_updated_at BEFORE UPDATE ON event_action_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_webhook_subscriptions_updated_at') THEN
    CREATE TRIGGER trg_webhook_subscriptions_updated_at BEFORE UPDATE ON webhook_subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_woocommerce_order_logs_updated_at') THEN
    CREATE TRIGGER trg_woocommerce_order_logs_updated_at BEFORE UPDATE ON woocommerce_order_logs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_form_drafts_updated_at') THEN
    CREATE TRIGGER trg_form_drafts_updated_at BEFORE UPDATE ON form_drafts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;