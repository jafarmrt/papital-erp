-- Drizzle Migration 0055: optimistic lock version for personnel (v9.0.30 / TD-442, product-owner decision D5 «الف»)
--
-- Two managers editing one personnel saved over each other silently: the second save wrote back every field of the form
-- it had loaded and erased the first change (a salary or Sheba change was lost without a message). PUT /personnel/:id
-- now sends the version of the record its form was built from and writes only while that version is still current
-- (409 OCC_CONFLICT otherwise), like customers (TD-403). Existing rows start at version 1; nothing else changes.

ALTER TABLE personnel ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
