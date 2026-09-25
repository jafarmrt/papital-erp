-- V5.0.14 (TD-116): ادغام کلیدهای شبح موجودی در کد انبار صحیح + پشتیبان برای بازگشت
DO $$
DECLARE r record; default_code text; unknown_keys text;
BEGIN
  SELECT code INTO default_code FROM warehouses WHERE is_active = 1 ORDER BY id LIMIT 1;
  IF default_code IS NULL THEN RAISE NOTICE 'TD-116: no active warehouse, skipped'; RETURN; END IF;

  CREATE TABLE IF NOT EXISTS _repair_0010_items_stocks_backup AS
    SELECT id, stocks, current_stock, now() AS backed_up_at FROM items WHERE false;
  INSERT INTO _repair_0010_items_stocks_backup (id, stocks, current_stock, backed_up_at)
    SELECT id, stocks, current_stock, now() FROM items
    WHERE EXISTS (SELECT 1 FROM jsonb_object_keys(stocks) k
                  WHERE k NOT IN (SELECT code FROM warehouses));

  -- نگاشت: نام هر انبار به کد همان انبار؛ برچسب‌های ثابت قدیمی به انبار پیش‌فرض
  FOR r IN
    SELECT name AS src, code AS dst FROM warehouses WHERE name IS NOT NULL AND name <> code
    UNION ALL SELECT 'انبار اصلی', default_code
    UNION ALL SELECT 'انبار مرکزی', default_code
  LOOP
    UPDATE items
      SET stocks = (stocks - r.src) || jsonb_build_object(
            r.dst, COALESCE((stocks->>r.dst)::numeric, 0) + COALESCE((stocks->>r.src)::numeric, 0))
      WHERE stocks ? r.src AND r.src <> r.dst;
    UPDATE transactions   SET location = r.dst WHERE location = r.src AND r.src <> r.dst;
    UPDATE document_items SET location = r.dst WHERE location = r.src AND r.src <> r.dst;
  END LOOP;

  -- هم‌ترازی موجودی کل با جمع انبارها (Single Source of Truth)
  UPDATE items i SET current_stock = s.total
  FROM (SELECT id, COALESCE((SELECT SUM(v::numeric) FROM jsonb_each_text(stocks) e(k, v)), 0) AS total FROM items) s
  WHERE s.id = i.id AND i.current_stock IS DISTINCT FROM s.total;

  -- کلیدهای ناشناخته (مثلاً انبار غیرفعال) خودکار جابه‌جا نمی‌شوند؛ فقط گزارش می‌شوند
  SELECT string_agg(DISTINCT k, '، ') INTO unknown_keys
  FROM items, jsonb_object_keys(stocks) k
  WHERE k NOT IN (SELECT code FROM warehouses WHERE is_active = 1) AND is_deleted = 0;
  IF unknown_keys IS NOT NULL THEN
    RAISE WARNING 'TD-116: stock keys not mapped to an active warehouse: %', unknown_keys;
  END IF;
END $$;
