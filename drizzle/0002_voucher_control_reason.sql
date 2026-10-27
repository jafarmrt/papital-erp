-- v11 phase 6.1b (M3, decision ت۵۲-۲): the reason a manual voucher, or the replacement of a corrected voucher, posts on a
-- control account (a treasury, party, payroll, statutory, eidi, advance, cheque or inventory account). Only a user with
-- accounting.control_adjustment writes such a voucher, and the reason stays on it; every other voucher keeps it empty.
ALTER TABLE journal_vouchers ADD COLUMN IF NOT EXISTS control_reason text NOT NULL DEFAULT '';
