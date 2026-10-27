-- v11 phase 6.1ث (S2, decision ت۵۲-۳): a project's production receipt costs the project's real cost, its work in progress
-- (1402). Each receipt records how the server priced it under the project lock: the project's 1402 before it, what it takes
-- from 1402 (below zero only when it closes a 1402 below zero), the rule and the reason of a cost other than the real one. Its voucher credits 1402 with exactly that amount and
-- posts the difference to the lines' value on the new account 6005 «اختلاف بهای تولید». A receipt recorded before has no row
-- and keeps its voucher.
CREATE TABLE IF NOT EXISTS production_receipt_costs (
    document_id integer PRIMARY KEY,
    project_id integer NOT NULL,
    wip_balance numeric(18,4) NOT NULL,
    wip_credit numeric(18,4) NOT NULL,
    cost_rule text NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_production_receipt_costs_rule CHECK ((cost_rule = ANY (ARRAY['share'::text, 'complete'::text, 'entered'::text, 'no_wip'::text]))),
    CONSTRAINT chk_production_receipt_costs_wip_credit CHECK (((wip_credit >= (0)::numeric) OR (wip_credit = wip_balance))),
    CONSTRAINT fk_production_receipt_costs_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    CONSTRAINT fk_production_receipt_costs_project FOREIGN KEY (project_id) REFERENCES production_projects(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_production_receipt_costs_project_id ON production_receipt_costs USING btree (project_id);
--> statement-breakpoint
-- The variance account under «بهای تمام‌شده محصولات فروش‌رفته» (60), for an install whose chart already has its group; a
-- new install gets it from the standard chart. An install that already uses code 6005 keeps its account (the mapping page
-- can point «اختلاف بهای تولید» elsewhere).
INSERT INTO accounts (code, name, level, parent_id, account_type, nature, is_system, is_active, is_deleted)
SELECT '6005', 'اختلاف بهای تولید', 'subsidiary', parent.id, 'cost_of_sales', 'both', 1, 1, 0
FROM accounts parent
WHERE parent.code = '60' AND parent.is_deleted = 0
  AND NOT EXISTS (SELECT 1 FROM accounts existing WHERE existing.code = '6005' AND existing.is_deleted = 0)
ORDER BY parent.id
LIMIT 1;
