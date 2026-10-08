-- Drizzle Migration 0088: webhook subscription event patterns use the real event types (v9.0.405 / TD-707, product-owner decision t3 a)
--
-- The webhook form offered dotted patterns («document.invoiced», «inventory.*», «treasury.*» …) while every event the
-- server publishes has a PascalCase type («InvoiceApproved», «StockIssued» …), so a subscription with such a pattern
-- never received anything. Each stored pattern is now converted with the mapping below; «*» and real event types are
-- kept, a pattern without an equivalent («document.settled») is dropped. The old and new pattern lists are recorded in
-- webhook_event_pattern_repairs. A subscription left with no pattern keeps its old list and is deactivated (an empty
-- list would mean «all events»), and so is a subscription addressed to a documentation domain (example.com, example.org,
-- example.net: the seeded demo subscriptions), which would otherwise start sending business events to that host.
-- Runs inside the Drizzle migrator transaction.

CREATE TABLE IF NOT EXISTS webhook_event_pattern_repairs (
  id serial PRIMARY KEY,
  subscription_id integer NOT NULL,
  subscription_name text NOT NULL DEFAULT '',
  target_url text NOT NULL DEFAULT '',
  old_patterns jsonb NOT NULL,
  new_patterns jsonb NOT NULL,
  dropped_patterns jsonb NOT NULL DEFAULT '[]'::jsonb,
  was_active integer NOT NULL,
  deactivated integer NOT NULL DEFAULT 0,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT uq_webhook_event_pattern_repairs_subscription UNIQUE (subscription_id),
  CONSTRAINT chk_webhook_event_pattern_repairs_was_active_flag CHECK (was_active IN (0, 1)),
  CONSTRAINT chk_webhook_event_pattern_repairs_deactivated_flag CHECK (deactivated IN (0, 1))
);
--> statement-breakpoint
WITH published(pattern) AS (
  VALUES ('*'), ('InvoiceCreated'), ('InvoiceApproved'), ('PurchaseCreated'), ('PurchaseApproved'),
         ('StockReceived'), ('StockIssued'), ('StockAdjusted'), ('InventoryReorderAlert'),
         ('TreasuryTransactionApproved'), ('WorkflowTransitioned'), ('WorkflowCompleted'), ('WorkflowRejected'),
         ('woocommerce.order.synced'), ('woocommerce.order.voided')
),
mapping(old_pattern, new_pattern) AS (
  VALUES ('document.*', 'InvoiceCreated'), ('document.*', 'InvoiceApproved'), ('document.*', 'PurchaseCreated'),
         ('document.*', 'PurchaseApproved'),
         ('document.invoiced', 'InvoiceApproved'),
         ('inventory.*', 'StockReceived'), ('inventory.*', 'StockIssued'), ('inventory.*', 'StockAdjusted'),
         ('inventory.*', 'InventoryReorderAlert'),
         ('inventory.stock_in', 'StockReceived'), ('inventory.stock_out', 'StockIssued'),
         ('inventory.stock_alert', 'InventoryReorderAlert'),
         ('treasury.*', 'TreasuryTransactionApproved'),
         ('workflow.*', 'WorkflowTransitioned'), ('workflow.*', 'WorkflowCompleted'), ('workflow.*', 'WorkflowRejected'),
         ('woocommerce.*', 'woocommerce.order.synced'), ('woocommerce.*', 'woocommerce.order.voided')
),
subs AS (
  SELECT s.id, s.name, s.target_url, s.is_active,
         CASE WHEN jsonb_typeof(s.event_patterns) = 'array' THEN s.event_patterns ELSE '[]'::jsonb END AS patterns
    FROM webhook_subscriptions s
),
elems AS (
  SELECT subs.id, e.value AS pattern FROM subs CROSS JOIN LATERAL jsonb_array_elements_text(subs.patterns) AS e(value)
),
converted AS (
  SELECT elems.id, elems.pattern AS new_pattern FROM elems JOIN published p ON p.pattern = elems.pattern
  UNION
  SELECT elems.id, m.new_pattern FROM elems JOIN mapping m ON m.old_pattern = elems.pattern
),
dropped AS (
  SELECT elems.id, jsonb_agg(DISTINCT elems.pattern) AS patterns
    FROM elems
   WHERE NOT EXISTS (SELECT 1 FROM published p WHERE p.pattern = elems.pattern)
     AND NOT EXISTS (SELECT 1 FROM mapping m WHERE m.old_pattern = elems.pattern)
   GROUP BY elems.id
),
plan AS (
  SELECT subs.id, subs.name, subs.target_url, subs.is_active, subs.patterns AS old_patterns,
         CASE
           WHEN EXISTS (SELECT 1 FROM converted c WHERE c.id = subs.id AND c.new_pattern = '*') THEN '["*"]'::jsonb
           ELSE coalesce((SELECT jsonb_agg(c.new_pattern ORDER BY c.new_pattern) FROM converted c WHERE c.id = subs.id), '[]'::jsonb)
         END AS converted_patterns,
         coalesce((SELECT jsonb_agg(DISTINCT e.pattern ORDER BY e.pattern) FROM elems e WHERE e.id = subs.id), '[]'::jsonb) AS old_set,
         coalesce((SELECT d.patterns FROM dropped d WHERE d.id = subs.id), '[]'::jsonb) AS dropped_patterns,
         lower(coalesce(substring(subs.target_url from '^[a-zA-Z][a-zA-Z0-9+.-]*://(?:[^/@]*@)?([^/:?#]+)'), '')) AS host
    FROM subs
)
INSERT INTO webhook_event_pattern_repairs
  (subscription_id, subscription_name, target_url, old_patterns, new_patterns, dropped_patterns, was_active, deactivated)
SELECT plan.id, coalesce(plan.name, ''), coalesce(plan.target_url, ''), plan.old_patterns,
       CASE WHEN plan.converted_patterns = '[]'::jsonb THEN plan.old_patterns ELSE plan.converted_patterns END,
       plan.dropped_patterns,
       CASE WHEN plan.is_active = 1 THEN 1 ELSE 0 END,
       CASE WHEN plan.is_active = 1 AND (
              plan.converted_patterns = '[]'::jsonb
              OR plan.host IN ('example.com', 'example.org', 'example.net')
              OR plan.host LIKE '%.example.com' OR plan.host LIKE '%.example.org' OR plan.host LIKE '%.example.net'
            ) THEN 1 ELSE 0 END
  FROM plan
 WHERE plan.converted_patterns IS DISTINCT FROM plan.old_set
    OR (plan.is_active = 1 AND (
          plan.host IN ('example.com', 'example.org', 'example.net')
          OR plan.host LIKE '%.example.com' OR plan.host LIKE '%.example.org' OR plan.host LIKE '%.example.net'))
ON CONFLICT (subscription_id) DO NOTHING;
--> statement-breakpoint
SELECT erp_update_with_unvalidated_checks('webhook_subscriptions', $sql$
UPDATE webhook_subscriptions s
   SET event_patterns = r.new_patterns,
       is_active = CASE WHEN r.deactivated = 1 THEN 0 ELSE s.is_active END,
       updated_at = now()
  FROM webhook_event_pattern_repairs r
 WHERE r.subscription_id = s.id
   AND (s.event_patterns IS DISTINCT FROM r.new_patterns OR (r.deactivated = 1 AND s.is_active IS DISTINCT FROM 0))
$sql$);
