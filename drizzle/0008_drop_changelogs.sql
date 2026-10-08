-- Migration 0008 (v4.0.29 / TD-111): حذف جدول changelogs
-- این جدول dual-storage زیان‌بار بود: منبع حقیقت واحد چنج‌لاگ‌ها فایل‌های
-- src/data/changelogs/*.ts هستند (تاریخ‌های جلالی حفظ می‌شوند) و تنها
-- مصرف‌کننده جدول (ReleaseGate) اکنون مستقیماً SYSTEM_UPDATES را می‌خواند.

-- TD-590: the table is named in the current schema, never found along the search path
DO $$
BEGIN
  EXECUTE format('DROP TABLE IF EXISTS %I.changelogs', current_schema());
END $$;
