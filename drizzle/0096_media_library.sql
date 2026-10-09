-- Drizzle Migration 0096: the media library (v10.0.21, N-05)
--
-- New tables only. media_sections holds the system section «محصولات» (kind 'products', one live row) and the sections
-- users create; media_assets holds the metadata of each image or video, whose files live on disk under MEDIA_DIR. Every
-- flag has its CHECK (P3-14), the foreign keys are validated at once because the tables are new, and each foreign key
-- column has an index that leads with it (TD-614). Runs inside the Drizzle migrator transaction.

CREATE TABLE IF NOT EXISTS media_sections (
  id serial PRIMARY KEY,
  kind text NOT NULL DEFAULT 'custom',
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_by text NOT NULL DEFAULT '',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  is_deleted integer NOT NULL DEFAULT 0,
  CONSTRAINT chk_media_sections_is_deleted_flag CHECK (is_deleted IN (0, 1)),
  CONSTRAINT chk_media_sections_kind CHECK (kind IN ('products', 'custom'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_media_sections_products ON media_sections (kind) WHERE kind = 'products' AND is_deleted = 0;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_media_sections_title_active ON media_sections (lower(btrim(title))) WHERE is_deleted = 0;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS media_assets (
  id serial PRIMARY KEY,
  section_id integer NOT NULL,
  item_id integer,
  kind text NOT NULL,
  shot_type text NOT NULL DEFAULT 'other',
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  is_cover integer NOT NULL DEFAULT 0,
  original_name text NOT NULL DEFAULT '',
  mime_type text NOT NULL,
  size_bytes integer NOT NULL,
  sha256 text NOT NULL,
  width integer,
  height integer,
  duration_seconds numeric(10, 2),
  is_low_quality integer NOT NULL DEFAULT 0,
  light_bytes integer,
  thumb_bytes integer,
  light_error text NOT NULL DEFAULT '',
  created_by text NOT NULL DEFAULT '',
  created_by_user_id integer,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  is_deleted integer NOT NULL DEFAULT 0,
  deleted_at timestamp,
  CONSTRAINT chk_media_assets_is_cover_flag CHECK (is_cover IN (0, 1)),
  CONSTRAINT chk_media_assets_is_low_quality_flag CHECK (is_low_quality IN (0, 1)),
  CONSTRAINT chk_media_assets_is_deleted_flag CHECK (is_deleted IN (0, 1)),
  CONSTRAINT chk_media_assets_kind CHECK (kind IN ('image', 'video')),
  CONSTRAINT chk_media_assets_shot_type CHECK (shot_type IN ('white_background', 'side', 'detail', 'on_model', 'packaging', 'video', 'other')),
  CONSTRAINT chk_media_assets_size CHECK (size_bytes > 0 AND size_bytes <= 52428800),
  CONSTRAINT chk_media_assets_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT fk_media_assets_section FOREIGN KEY (section_id) REFERENCES media_sections (id),
  CONSTRAINT fk_media_assets_item FOREIGN KEY (item_id) REFERENCES items (id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_media_assets_section_id ON media_assets (section_id, is_deleted, sort_order);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_media_assets_item_id ON media_assets (item_id) WHERE item_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_media_assets_sha256 ON media_assets (sha256);
--> statement-breakpoint
INSERT INTO media_sections (kind, title, description, sort_order, created_by)
SELECT 'products', 'محصولات', 'تصویرها و فیلم‌های هر محصول', 0, 'سیستم'
WHERE NOT EXISTS (SELECT 1 FROM media_sections WHERE kind = 'products' AND is_deleted = 0);
