-- v8.0.8x (TD-361): فهرست محتوای پایگاه‌داده برای پشتیبان و تمرین بازیابی (scripts/backup.sh و scripts/restore.sh).
-- در تراکنش فراخواننده اجرا می‌شود: backup.sh آن را در همان snapshot اجرا می‌کند که pg_dump می‌خواند، و restore.sh روی
-- پایگاه‌داده بازیابی‌شده؛ دو خروجی باید سطر به سطر یکی باشند. هر جدول: تعداد ردیف و جمع درهم‌سازی متن هر ردیف
-- (مستقل از ترتیب، با حافظه ثابت)؛ هر قید: معتبر بودن (NOT VALID) و تعریف آن. شمارنده‌ها (sequence) تراکنشی نیستند و
-- در مقایسه نمی‌آیند؛ restore.sh جداگانه بررسی می‌کند که از داده عقب نباشند.
-- خروجی با psql -tA -F'|': table|<schema.table>|<rows>|<hash>   و   constraint|<table.constraint>|<t/f>|<md5>
SET LOCAL DateStyle = 'ISO, YMD';
SET LOCAL TimeZone = 'UTC';
SET LOCAL IntervalStyle = 'postgres';
SET LOCAL extra_float_digits = 1;
SET LOCAL bytea_output = 'hex';
SET LOCAL search_path = pg_catalog;
SELECT format('SELECT %L, %L, count(*), coalesce(sum(hashtextextended(t::text, 0)::numeric), 0) FROM %I.%I AS t',
              'table', n.nspname || '.' || c.relname, n.nspname, c.relname)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'r'
   AND n.nspname NOT IN ('pg_catalog', 'information_schema')
   AND n.nspname !~ '^pg_(toast|temp)'
 ORDER BY n.nspname, c.relname
\gexec
SELECT 'constraint', c.conrelid::regclass::text || '.' || c.conname, c.convalidated, md5(pg_get_constraintdef(c.oid))
  FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace
 WHERE c.conrelid <> 0
   AND n.nspname NOT IN ('pg_catalog', 'information_schema')
   AND n.nspname !~ '^pg_(toast|temp)'
 ORDER BY 2;
