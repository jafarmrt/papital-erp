-- Drizzle Migration 0023: attachment files on disk (v7.0.56 / audit P2-9, product-owner decision)
--
-- Attachments of documents, journal vouchers, cheques, treasury transactions, production projects and
-- piecework payrolls were stored as Base64 data URLs inside the JSONB `attachments` columns: every list query
-- read them, and the table, WAL and backup sizes grew with every scanned receipt. From v7.0.56 the file body is
-- written under public/uploads/.attachments (inside the existing uploads volume and backup archive) and this
-- table registers each file with the record it belongs to; the JSONB columns keep metadata only and point to
-- GET /api/attachments/<id>, which checks the session and the read permission of the owning record.
-- Existing inline attachments are moved by the manual command `npm run attachments:migrate` (dry run first).

CREATE TABLE IF NOT EXISTS file_attachments (
  id uuid PRIMARY KEY,
  entity_type text NOT NULL,
  entity_id integer NOT NULL,
  storage_path text NOT NULL,
  original_name text NOT NULL DEFAULT '',
  mime_type text NOT NULL DEFAULT 'application/octet-stream',
  size_bytes integer NOT NULL,
  sha256 text NOT NULL,
  created_by text NOT NULL DEFAULT '',
  created_at timestamp without time zone NOT NULL DEFAULT now(),
  is_deleted integer NOT NULL DEFAULT 0,
  CONSTRAINT chk_file_attachments_entity_type CHECK (entity_type IN (
    'document', 'journal_voucher', 'cheque', 'treasury_transaction', 'production_project', 'piecework_payroll'
  )),
  CONSTRAINT chk_file_attachments_size CHECK (size_bytes >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_file_attachments_entity ON file_attachments (entity_type, entity_id);
