-- drizzle/0011_updated_at_triggers.sql

-- ۰. افزودن ستون updated_at به جداول فاقد آن
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE treasury_transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- ۱. تابع مشترک set_updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ۲. تریگرها برای جداول دارای updated_at
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
