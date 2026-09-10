-- V3.1.46 — TD-070: اتصال رسمی سند انبار/فاکتور به پروژه تولید (documents.project_id)
-- ردیابی یگانه سند↔پروژه؛ جایگزین اتکا به متن یادداشت‌ها و projectId گذرا
ALTER TABLE documents ADD COLUMN IF NOT EXISTS project_id integer REFERENCES production_projects(id);
CREATE INDEX IF NOT EXISTS idx_docs_project ON documents (project_id);
