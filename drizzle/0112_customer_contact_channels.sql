-- Drizzle Migration 0112: customer contact channels (v10.1.13, N-02 part 1)
--
-- A party gets its website, e-mail and Instagram username, each a plain text column with an empty default. Values are
-- normalized and checked by the application (src/lib/customers/contactChannels.ts); no existing row is rewritten.
-- Runs inside the Drizzle migrator transaction.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS website text DEFAULT '';
--> statement-breakpoint
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email text DEFAULT '';
--> statement-breakpoint
ALTER TABLE customers ADD COLUMN IF NOT EXISTS instagram text DEFAULT '';
