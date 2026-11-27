-- v12 colleague and partner sales, part B2 (docs/roadmap/V12_COLLEAGUE_SALES_START_PLAN.md; owner's decisions of 7 Azar
-- 1405): a treasury receipt from a partner or payment to them may take the personnel purpose 'partner_account' («حساب جاری
-- شریک»): it moves the partner's euro account (mapped 4101, their personnel detail), with the rial difference against the
-- average rate of their open euro balance posted to exchange gain or loss. Only the CHECK of the treasury purposes changes;
-- the cheque book keeps its own purposes (a partner's move is never a cheque). No row changes. Runs inside the Drizzle
-- migrator transaction.
ALTER TABLE treasury_transactions DROP CONSTRAINT IF EXISTS chk_treasury_transactions_purpose;
--> statement-breakpoint
ALTER TABLE treasury_transactions ADD CONSTRAINT chk_treasury_transactions_purpose CHECK ((purpose IS NULL) OR (purpose = ANY (ARRAY['settlement'::text, 'advance'::text, 'deductions'::text, 'colleague_account'::text, 'partner_account'::text, 'other'::text])));
