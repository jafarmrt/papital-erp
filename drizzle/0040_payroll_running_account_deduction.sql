-- v12 colleague and partner sales, part B (docs/roadmap/V12_COLLEAGUE_SALES_START_PLAN.md §4.3; owner's decision 3.3 of
-- 6 Azar 1405): a payslip may deduct what the colleague owes on their running account («کسر از حساب جاری همکار»), beside
-- «کسر مساعده». The payslip's voucher credits «حساب جاری همکار» (3208) on the colleague's detail with it, at most the
-- colleague's debit balance there. Every existing payslip deducts 0. No other row changes. Runs inside the Drizzle
-- migrator transaction.
ALTER TABLE piecework_payrolls ADD COLUMN IF NOT EXISTS running_account_deduction numeric(18,4) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE piecework_payrolls ADD CONSTRAINT chk_piecework_payrolls_running_account_deduction CHECK (running_account_deduction >= 0);
