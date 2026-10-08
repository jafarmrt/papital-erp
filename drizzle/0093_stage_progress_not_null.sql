-- Drizzle Migration 0093: required columns of project_product_stage_progress (v9.0.448 / TD-613, finding B01-33,
-- product-owner decision t5 «الف» of package 1)
--
-- The Drizzle schema declares item_code, quantity, stage_title and status of project_product_stage_progress NOT NULL
-- (with defaults), but the table was created with them nullable, so a row written outside the application could hold
-- NULL there. Each column is made NOT NULL only when it holds no NULL; old rows are never rewritten here (rule of
-- TD-231). A column left nullable raises a WARNING (reported by the migrator), is listed by the financial health check
-- (conditional_constraints_missing) with its NULL count and is made NOT NULL by the system admin once the data is fixed.
-- Runs inside the Drizzle migrator transaction.

DO $$
DECLARE
  col text;
  has_null boolean;
BEGIN
  FOREACH col IN ARRAY ARRAY['item_code', 'quantity', 'stage_title', 'status'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'project_product_stage_progress'
        AND column_name = col AND is_nullable = 'YES'
    ) THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM project_product_stage_progress WHERE %I IS NULL)', col) INTO has_null;
      IF has_null THEN
        RAISE WARNING 'project_product_stage_progress.% has NULL rows; NOT NULL not created (see the financial health check)', col;
      ELSE
        EXECUTE format('ALTER TABLE project_product_stage_progress ALTER COLUMN %I SET NOT NULL', col);
      END IF;
    END IF;
  END LOOP;
END $$;
