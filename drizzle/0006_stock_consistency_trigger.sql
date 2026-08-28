-- Migration 0006: Stock Consistency Trigger for items (DB-004)
-- Automatically synchronizes items.current_stock with SUM(items.stocks) on INSERT or UPDATE.

CREATE OR REPLACE FUNCTION sync_item_current_stock()
RETURNS TRIGGER AS $$
DECLARE
  calculated_stock NUMERIC(18,4);
BEGIN
  -- محاسبه مجموع موجودی انبارها از شیء JSONB stocks
  IF NEW.stocks IS NULL OR NEW.stocks = '{}'::jsonb THEN
    calculated_stock := 0;
  ELSE
    SELECT COALESCE(
      (SELECT SUM((NULLIF(value, '')::numeric)) FROM jsonb_each_text(NEW.stocks)),
      0
    ) INTO calculated_stock;
  END IF;
  
  -- اگر current_stock مغایر با مجموع انبارها باشد، آن را اصلاح و همگام کن
  IF NEW.current_stock IS DISTINCT FROM calculated_stock THEN
    RAISE NOTICE 'Stock consistency corrected for item %: % -> %', NEW.id, NEW.current_stock, calculated_stock;
    NEW.current_stock := calculated_stock;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_item_current_stock ON items;

CREATE TRIGGER trg_sync_item_current_stock
BEFORE INSERT OR UPDATE OF stocks, current_stock ON items
FOR EACH ROW
EXECUTE FUNCTION sync_item_current_stock();
