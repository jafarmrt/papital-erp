-- V3.1.0 — Project Product Stage Progress (پیشرفت ماتریسی SKU × مرحله)
-- مدل: سفارش پروژه = N کد کالا (SKU) × کمیت؛ وضعیت هر SKU در هر مرحله دودویی
-- (تمام/ناتمام) و پیشرفت کل پروژه تجمیع وزن‌دار SKUهاست.
-- Idempotent: IF NOT EXISTS روی جدول و ایندکس‌ها.
CREATE TABLE IF NOT EXISTS project_product_stage_progress (
  id serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES production_projects(id),
  item_id integer NOT NULL REFERENCES items(id),
  item_code text DEFAULT '',
  item_name text DEFAULT '',
  quantity numeric(18,4) DEFAULT 0,
  stage_order integer NOT NULL,
  stage_title text DEFAULT '',
  status text DEFAULT 'pending',
  updated_at text DEFAULT '',
  updated_by_name text DEFAULT '',
  is_deleted integer DEFAULT 0
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_ppsp_project_item_stage
  ON project_product_stage_progress (project_id, item_id, stage_order);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ppsp_item
  ON project_product_stage_progress (project_id, item_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ppsp_order
  ON project_product_stage_progress (project_id, stage_order);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ppsp_deleted
  ON project_product_stage_progress (is_deleted);
