-- V4.0.13 — Subphase 5.1 (TD-095 / F-4): ارتقای کلید ایدمپوتنسی به ترکیب سه‌گانه (created_by_id, scope, key)
-- حذف قید یکتایی صرفاً روی key و تعریف قید سه‌گانه یکتا جهت ایزوله‌سازی کاربر و جلوگیری از نشت اطلاعات
ALTER TABLE idempotency_keys DROP CONSTRAINT IF EXISTS idempotency_keys_key_key;
ALTER TABLE idempotency_keys DROP CONSTRAINT IF EXISTS idempotency_keys_key_unique;
-- TD-590: the dropped indexes are named in the current schema; an unqualified name was looked up along the
-- search path, so building an isolated test schema dropped public.idx_idemp_user_scope_key
DO $$
BEGIN
  EXECUTE format('DROP INDEX IF EXISTS %I.idx_idempotency_key', current_schema());
  EXECUTE format('DROP INDEX IF EXISTS %I.idx_idemp_user_scope_key', current_schema());
END $$;
CREATE INDEX IF NOT EXISTS idx_idempotency_key ON idempotency_keys (key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_idemp_user_scope_key ON idempotency_keys (created_by_id, scope, key) NULLS NOT DISTINCT;
