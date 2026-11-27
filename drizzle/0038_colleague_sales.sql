-- v12 colleague and partner sales (docs/roadmap/V12_COLLEAGUE_SALES_START_PLAN.md, part A; owner's decisions of 6 Azar 1405).
--
-- customers: a party may stand for one colleague or partner of the personnel (`personnel_id`), with the running account
-- its sales go to (`running_account`): 'colleague' «حساب جاری همکار» (3208) or 'partner' «حساب جاری شرکا» (4101); '' is
-- an ordinary party. A colleague has at most one such live party.
-- documents: a sales invoice is stamped once, when it is first finalized, with the running account of its party at that
-- time (`running_account`, `running_account_personnel_id`): its voucher debits that account on the colleague's detail
-- instead of trade receivables, and the stamp never follows a later change of the party's link. NULL is «not yet
-- stamped»; every final document already in the books is stamped '' here, so no issued invoice moves off 1201,
-- while an open draft or proforma is stamped when it is finalized (owner's decision 3.2: every final invoice of a linked party).
-- settlement_allocations: a third kind of part, the «تسویه از حساب جاری» of a stamped invoice (`running_account_personnel_id`,
-- no treasury row and no cheque): the invoice's payable less its final returns, so it leaves the receivables list.
-- No other row changes. Runs inside the Drizzle migrator transaction.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS personnel_id integer;
--> statement-breakpoint
ALTER TABLE customers ADD COLUMN IF NOT EXISTS running_account text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE customers ADD CONSTRAINT fk_customers_personnel FOREIGN KEY (personnel_id) REFERENCES personnel(id);
--> statement-breakpoint
ALTER TABLE customers ADD CONSTRAINT chk_customers_running_account CHECK (
  running_account IN ('', 'colleague', 'partner') AND (personnel_id IS NULL) = (running_account = '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_personnel_live ON customers (personnel_id) WHERE is_deleted = 0 AND personnel_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE documents ADD COLUMN IF NOT EXISTS running_account text;
--> statement-breakpoint
ALTER TABLE documents ADD COLUMN IF NOT EXISTS running_account_personnel_id integer;
--> statement-breakpoint
UPDATE documents SET running_account = '' WHERE running_account IS NULL AND status = 'final';
--> statement-breakpoint
ALTER TABLE documents ADD CONSTRAINT fk_documents_running_account_personnel FOREIGN KEY (running_account_personnel_id) REFERENCES personnel(id);
--> statement-breakpoint
ALTER TABLE documents ADD CONSTRAINT chk_documents_running_account CHECK (
  running_account IS NULL OR (
    running_account IN ('', 'colleague', 'partner') AND (running_account_personnel_id IS NULL) = (running_account = '')
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_documents_running_account_personnel_id ON documents (running_account_personnel_id) WHERE running_account_personnel_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE settlement_allocations ADD COLUMN IF NOT EXISTS running_account_personnel_id integer;
--> statement-breakpoint
ALTER TABLE settlement_allocations ADD CONSTRAINT fk_settlement_allocations_running_account_personnel FOREIGN KEY (running_account_personnel_id) REFERENCES personnel(id);
--> statement-breakpoint
-- a part has exactly one source: a treasury row, a cheque or the colleague's running account
ALTER TABLE settlement_allocations DROP CONSTRAINT IF EXISTS chk_settlement_allocations_one_source;
--> statement-breakpoint
ALTER TABLE settlement_allocations ADD CONSTRAINT chk_settlement_allocations_one_source CHECK (
  num_nonnulls(treasury_transaction_id, cheque_id, running_account_personnel_id) = 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_allocations_running_account_document ON settlement_allocations (document_id)
  WHERE is_deleted = 0 AND running_account_personnel_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_settlement_allocations_running_account_personnel_id ON settlement_allocations (running_account_personnel_id)
  WHERE running_account_personnel_id IS NOT NULL;
