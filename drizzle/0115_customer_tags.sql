-- Drizzle Migration 0115: customer tags (v10.1.23, N-02 part 3)
--
-- New tables only. customer_tags holds the tags a customers.manage holder defines (one live tag per name, case and
-- surrounding spaces ignored) and customer_tag_links the tags of each party. Every flag has its CHECK (P3-14), the foreign
-- keys are validated at once because the tables are new, and each foreign key column has an index that leads with it
-- (TD-614). No existing row is written. Runs inside the Drizzle migrator transaction.

CREATE TABLE IF NOT EXISTS customer_tags (
  id serial PRIMARY KEY,
  name text NOT NULL,
  color text NOT NULL DEFAULT 'slate',
  created_by_id integer,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  is_deleted integer NOT NULL DEFAULT 0,
  CONSTRAINT chk_customer_tags_is_deleted_flag CHECK (is_deleted IN (0, 1)),
  CONSTRAINT chk_customer_tags_color CHECK (color IN ('slate', 'blue', 'emerald', 'amber', 'rose', 'purple', 'cyan')),
  CONSTRAINT fk_customer_tags_created_by FOREIGN KEY (created_by_id) REFERENCES users (id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_tags_name_active ON customer_tags (lower(btrim(name))) WHERE is_deleted = 0;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_customer_tags_created_by ON customer_tags (created_by_id) WHERE created_by_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS customer_tag_links (
  id serial PRIMARY KEY,
  customer_id integer NOT NULL,
  tag_id integer NOT NULL,
  created_by_id integer,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT fk_customer_tag_links_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_customer_tag_links_tag FOREIGN KEY (tag_id) REFERENCES customer_tags (id),
  CONSTRAINT fk_customer_tag_links_created_by FOREIGN KEY (created_by_id) REFERENCES users (id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_tag_links_customer_tag ON customer_tag_links (customer_id, tag_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_customer_tag_links_tag ON customer_tag_links (tag_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_customer_tag_links_created_by ON customer_tag_links (created_by_id) WHERE created_by_id IS NOT NULL;
