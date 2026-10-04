-- Drizzle Migration 0048: per-Jalali-month breakdown of a payroll's fixed salary (v8.0.30 / TD-284)
--
-- Product-owner decision (option b): a payroll's fixed salary is computed for every Jalali month its period covers,
-- a partial month pro rata by days. Each payroll records its share per month ({month, days, monthDays, amount}) so a
-- later payroll of the same month gets exactly the rest of that month. Payrolls issued before this migration keep an
-- empty breakdown: their whole fixed amount counts for the Jalali month of their start date (the former rule).
-- Runs inside the migrator transaction.

ALTER TABLE piecework_payrolls ADD COLUMN IF NOT EXISTS fixed_salary_months jsonb NOT NULL DEFAULT '[]'::jsonb;
