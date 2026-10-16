-- Drizzle Migration 0122: unique national ID among active personnel (OBS-R2-56, product-owner decision ت۴۰)
--
-- A personnel's national ID was checked only for its format, so two active personnel could hold one national ID. A
-- non-empty national ID is now unique among active personnel (is_deleted = 0), compared as btrim(national_id) like the
-- application (src/services/personnel/personnelNationalIdUnique.ts), which maps a violation of this index to the Persian
-- 409 PERSONNEL_NATIONAL_ID_TAKEN. A soft-deleted personnel does not count and an empty value is not a national ID.
--
-- The index is created only when active personnel hold no duplicate: old values are never changed here. When duplicates
-- exist the index is skipped with a warning and the financial health check lists them (personnel_national_id_uniqueness).

DO $$
BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'uq_personnel_national_id_active')) IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM personnel WHERE is_deleted = 0 AND btrim(national_id) <> ''
      GROUP BY btrim(national_id) HAVING COUNT(*) > 1
    ) THEN
      RAISE WARNING 'personnel has duplicate national IDs among active personnel; uq_personnel_national_id_active not created (see the financial health check)';
    ELSE
      CREATE UNIQUE INDEX uq_personnel_national_id_active ON personnel (btrim(national_id))
        WHERE is_deleted = 0 AND btrim(national_id) <> '';
    END IF;
  END IF;
END $$;
