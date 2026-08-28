-- Migration: 0009_soft_delete_cascade.sql
-- Description: Add deleted_at and deleted_by columns to documents table, and is_deleted column to document_items table.

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' AND column_name = 'deleted_at'
    ) THEN
        ALTER TABLE documents ADD COLUMN deleted_at TIMESTAMP;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' AND column_name = 'deleted_by'
    ) THEN
        ALTER TABLE documents ADD COLUMN deleted_by VARCHAR(100);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'document_items' AND column_name = 'is_deleted'
    ) THEN
        ALTER TABLE document_items ADD COLUMN is_deleted INTEGER DEFAULT 0;
    END IF;
END $$;
