-- v12 phase 8e (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §5, owner's decision of 21 Aban 1405): a site order proven by an
-- email code. email is the address as the buyer typed it and email_key its matching key (lower case); both '' = an order
-- proven by its phone, or by nothing (the texts and the email both off), as every order before this one. Such an order
-- goes on the customer with that email, never on one found by its (unproven) phone; its open-orders limit counts by the
-- email; it is opened on another device with the email and a new code; and no text goes to its unproven phone.
-- Runs inside the Drizzle migrator transaction.

ALTER TABLE storefront_orders ADD COLUMN IF NOT EXISTS email text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE storefront_orders ADD COLUMN IF NOT EXISTS email_key text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE storefront_orders DROP CONSTRAINT IF EXISTS chk_storefront_orders_email_pair;
--> statement-breakpoint
ALTER TABLE storefront_orders ADD CONSTRAINT chk_storefront_orders_email_pair CHECK ((email = '') = (email_key = ''));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_orders_email_key ON storefront_orders (email_key, status) WHERE email_key <> '';
