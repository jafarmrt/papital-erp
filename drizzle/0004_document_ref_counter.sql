CREATE TABLE IF NOT EXISTS document_ref_counters (
  doc_type VARCHAR(20) NOT NULL,
  fiscal_year INT NOT NULL,
  last_ref_number INT NOT NULL DEFAULT 0,
  PRIMARY KEY (doc_type, fiscal_year)
);

-- Seed document_ref_counters with existing document maximum ref numbers
INSERT INTO document_ref_counters (doc_type, fiscal_year, last_ref_number)
SELECT 
  type AS doc_type, 
  COALESCE(EXTRACT(YEAR FROM date)::INT, 2026) AS fiscal_year, 
  COALESCE(MAX(NULLIF(REGEXP_REPLACE(ref_number, '\D', '', 'g'), '')::INT), 0) AS last_ref_number
FROM documents
WHERE is_deleted = 0
GROUP BY type, COALESCE(EXTRACT(YEAR FROM date)::INT, 2026)
ON CONFLICT (doc_type, fiscal_year) DO NOTHING;
