-- Drizzle Migration 0079: a payroll's «سایر کسورات» carries its own description (v9.0.329 / TD-861, product-owner decision t5 «الف»)
--
-- The payroll form labelled «سایر کسورات» as «(بیمه/مالیات...)» although nothing computes insurance or tax, and the amount
-- reached the deductions account with no word on what it was. From v9.0.329 a payroll with other deductions above zero needs a
-- description; it is stored here, printed on the payslip and written into the deductions voucher row (the mapped
-- employee deductions payable account, 3205 since migration 0077). Payrolls issued before this migration keep an empty
-- description and are not rewritten. Runs inside the migrator transaction.

ALTER TABLE piecework_payrolls ADD COLUMN IF NOT EXISTS deductions_description text NOT NULL DEFAULT '';
