-- drizzle/0010_jsonb_check_constraints.sql

-- ۰. پاکسازی و اصلاح داده‌های غیرمجاز و نامعتبر موجود جهت امکان‌پذیری اعمال قیود CHECK
UPDATE items SET stocks = '{}'::jsonb WHERE stocks IS NOT NULL AND jsonb_typeof(stocks) != 'object';
UPDATE production_projects SET inventory_control = '{}'::jsonb WHERE inventory_control IS NOT NULL AND jsonb_typeof(inventory_control) != 'object';
UPDATE cheques SET status_history = '[]'::jsonb WHERE status_history IS NOT NULL AND jsonb_typeof(status_history) != 'array';
UPDATE workflow_instances SET snapshot_dsl = '{}'::jsonb WHERE snapshot_dsl IS NOT NULL AND jsonb_typeof(snapshot_dsl) != 'object';
UPDATE items SET weighted_average_cost = 0 WHERE weighted_average_cost < 0;
UPDATE bank_accounts SET initial_balance = 0 WHERE initial_balance < 0;
UPDATE bank_accounts SET current_balance = 0 WHERE current_balance < 0;
UPDATE treasury_transactions SET amount = 1 WHERE amount <= 0;

-- ۱. stocks در items باید object باشد
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_items_stocks_object') THEN
    ALTER TABLE items 
      ADD CONSTRAINT chk_items_stocks_object 
      CHECK (stocks IS NULL OR jsonb_typeof(stocks) = 'object');
  END IF;
END $$;

-- ۲. inventoryControl در production_projects باید object باشد
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_pp_inv_control_object') THEN
    ALTER TABLE production_projects 
      ADD CONSTRAINT chk_pp_inv_control_object 
      CHECK (inventory_control IS NULL OR jsonb_typeof(inventory_control) = 'object');
  END IF;
END $$;

-- ۳. statusHistory در cheques باید array باشد
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cheques_history_array') THEN
    ALTER TABLE cheques 
      ADD CONSTRAINT chk_cheques_history_array 
      CHECK (status_history IS NULL OR jsonb_typeof(status_history) = 'array');
  END IF;
END $$;

-- ۴. workflowInstances.snapshotDsl باید object باشد
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_wi_dsl_object') THEN
    ALTER TABLE workflow_instances 
      ADD CONSTRAINT chk_wi_dsl_object 
      CHECK (snapshot_dsl IS NULL OR jsonb_typeof(snapshot_dsl) = 'object');
  END IF;
END $$;

-- ۵. همه‌ی مبالغ مالی باید non-negative (غیرمنفی) یا مثبت باشند
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_items_wac_nonneg') THEN
    ALTER TABLE items 
      ADD CONSTRAINT chk_items_wac_nonneg 
      CHECK (weighted_average_cost >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bank_balance_nonneg') THEN
    ALTER TABLE bank_accounts 
      ADD CONSTRAINT chk_bank_balance_nonneg 
      CHECK (initial_balance >= 0 AND current_balance >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tt_amount_pos') THEN
    ALTER TABLE treasury_transactions 
      ADD CONSTRAINT chk_tt_amount_pos 
      CHECK (amount > 0);
  END IF;
END $$;
