-- Drizzle Migration 0106: eidi is tax-free (v10.0.223 / TD-1089, product-owner decision t21 "exempt")
--
-- The product owner chose that all eidi is free of payroll tax. Migration 0105 had added the yearly tax-exempt cap of
-- eidi (payroll_eidi_rates.tax_exempt_cap); no eidi payslip takes a tax any more, so the column is dropped. 0105 has not
-- reached production, so no stored eidi tax is rewritten.
ALTER TABLE payroll_eidi_rates DROP COLUMN tax_exempt_cap;
