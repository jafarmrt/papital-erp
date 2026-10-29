-- v11 (owner's decision 7 Aban 1405): the issuer of a payslip may pay it once another user approved it. The payslip
-- keeps who approved it, so the rule reads the approver and not only the status: a payslip approved before this column
-- (up to v10.0.192 a payslip was issued already approved, with no approval step) has no approver, and its issuer does not
-- pay it until another user puts it back to draft and approves it again, or someone else pays it. New nullable column and
-- its index; no existing row is changed. Runs inside the Drizzle migrator transaction.

ALTER TABLE piecework_payrolls ADD COLUMN IF NOT EXISTS approved_by_id integer REFERENCES users(id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_piecework_payrolls_approved_by_id ON piecework_payrolls (approved_by_id) WHERE approved_by_id IS NOT NULL;
