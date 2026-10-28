-- v11 phase 7.2 (finding F4 of the v11 full test, card ت۶۲): documents.deleted_at holds the real instant of a void.
--
-- Since migration 0001 the column is timestamptz, but the void wrote the business wall clock (Tehran time, no zone), which
-- a UTC session stored 3.5 hours ahead. The writer now uses now(). This repairs the old rows it can prove: the void's own
-- activity row (action DELETE, entity_id = the document id) carries the wall clock it wrote in details.deletedAt and the
-- real instant in "timestamp". A row whose deleted_at matches that wall clock read as UTC takes the activity row's instant;
-- every change is recorded in legacy_date_repairs (repair_kind 'timezone', old and new value in UTC). A row without such an
-- activity row is left as it is. Running it again changes nothing, since a repaired row no longer matches.
-- Runs inside the Drizzle migrator transaction.

ALTER TABLE legacy_date_repairs DROP CONSTRAINT IF EXISTS chk_legacy_date_repairs_repair_kind;
--> statement-breakpoint
ALTER TABLE legacy_date_repairs ADD CONSTRAINT chk_legacy_date_repairs_repair_kind
  CHECK (repair_kind = ANY (ARRAY['mdy'::text, 'calendar'::text, 'timezone'::text]));
--> statement-breakpoint
WITH matched AS (
  SELECT DISTINCT ON (d.id) d.id, d.deleted_at AS old_at, l."timestamp" AS new_at
    FROM documents d
    JOIN activity_logs l
      ON l.action = 'DELETE'
     AND l.entity = 'اسناد انبار'
     AND l.entity_id = d.id::text
     AND l.details->>'deletedAt' = to_char(d.deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
   WHERE d.deleted_at IS NOT NULL
     AND l."timestamp" IS NOT NULL
     AND abs(extract(epoch FROM d.deleted_at - l."timestamp")) > 60
   ORDER BY d.id, l.id DESC
), recorded AS (
  INSERT INTO legacy_date_repairs (table_name, row_id, column_name, old_value, new_value, status, reason, repair_kind)
  SELECT 'documents', m.id, 'deleted_at',
         to_char(m.old_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
         to_char(m.new_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
         'corrected',
         'void time written as business wall clock; real instant taken from the void activity row',
         'timezone'
    FROM matched m
  RETURNING row_id
)
UPDATE documents d SET deleted_at = m.new_at FROM matched m WHERE d.id = m.id;
