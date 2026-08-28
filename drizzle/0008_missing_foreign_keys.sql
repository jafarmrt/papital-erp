-- Migration: 0008_missing_foreign_keys.sql
-- Description: Add missing Foreign Key constraints for accounts, crm_leads, cheques, treasury_transactions, and piecework_logs.

DO $$ 
BEGIN
    -- 1. Self-reference accounts.parent_id -> accounts(id)
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_accounts_parent') THEN
        ALTER TABLE accounts 
          ADD CONSTRAINT fk_accounts_parent 
          FOREIGN KEY (parent_id) REFERENCES accounts(id) 
          ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    -- 2. CRM Leads proforma -> documents(id)
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_crm_leads_proforma') THEN
        ALTER TABLE crm_leads 
          ADD CONSTRAINT fk_crm_leads_proforma 
          FOREIGN KEY (proforma_id) REFERENCES documents(id) 
          ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    -- 3. Cheques voucher -> journal_vouchers(id)
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_cheques_voucher') THEN
        ALTER TABLE cheques 
          ADD CONSTRAINT fk_cheques_voucher 
          FOREIGN KEY (voucher_id) REFERENCES journal_vouchers(id) 
          ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    -- 4. Treasury transactions voucher -> journal_vouchers(id)
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_treasury_tx_voucher') THEN
        ALTER TABLE treasury_transactions 
          ADD CONSTRAINT fk_treasury_tx_voucher 
          FOREIGN KEY (voucher_id) REFERENCES journal_vouchers(id) 
          ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    -- 5. Treasury transactions document -> documents(id)
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_treasury_tx_document') THEN
        ALTER TABLE treasury_transactions 
          ADD CONSTRAINT fk_treasury_tx_document 
          FOREIGN KEY (document_id) REFERENCES documents(id) 
          ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    -- 6. Piecework logs payroll -> piecework_payrolls(id)
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_piecework_logs_payroll') THEN
        ALTER TABLE piecework_logs 
          ADD CONSTRAINT fk_piecework_logs_payroll 
          FOREIGN KEY (payroll_id) REFERENCES piecework_payrolls(id) 
          ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
