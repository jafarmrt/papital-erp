-- Drizzle Migration 0113: CRM activity edit and delete, lost reason, lead stage history (v10.1.16, N-02 part 2)
--
-- An activity is now edited through PUT /crm/activities/:id with its version (optimistic lock) and soft-deleted through
-- DELETE /crm/activities/:id, both audited. A lead moved to «lost» carries one reason from a fixed list (and a note for
-- «other»). Every stage change from this version on is recorded in crm_lead_stage_history, from which the funnel report
-- is built; earlier changes left no record and are not backfilled. Runs inside the Drizzle migrator transaction.

ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS updated_at timestamp;
--> statement-breakpoint
ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS updated_by text DEFAULT '';
--> statement-breakpoint
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS lost_reason text DEFAULT '';
--> statement-breakpoint
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS lost_reason_note text DEFAULT '';
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_crm_leads_lost_reason' AND conrelid = 'crm_leads'::regclass
  ) THEN
    ALTER TABLE crm_leads ADD CONSTRAINT chk_crm_leads_lost_reason
      CHECK (lost_reason IS NULL OR lost_reason IN ('', 'price', 'quality', 'delivery', 'competitor', 'no_response', 'other'));
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crm_lead_stage_history (
  id serial PRIMARY KEY,
  lead_id integer NOT NULL REFERENCES crm_leads(id),
  from_stage text,
  to_stage text NOT NULL,
  lost_reason text NOT NULL DEFAULT '',
  assigned_personnel_id integer REFERENCES personnel(id),
  changed_by_id integer REFERENCES users(id),
  changed_by_name text NOT NULL DEFAULT '',
  changed_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_crm_lead_stage_history_lead ON crm_lead_stage_history (lead_id, changed_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_crm_lead_stage_history_changed_at ON crm_lead_stage_history (changed_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_crm_lead_stage_history_personnel ON crm_lead_stage_history (assigned_personnel_id) WHERE assigned_personnel_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_crm_lead_stage_history_user ON crm_lead_stage_history (changed_by_id) WHERE changed_by_id IS NOT NULL;
