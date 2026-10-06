-- Drizzle Migration 0057: close the open approval workflows of documents that are already final (v9.0.39 / TD-446, finding B14-04)
--
-- Product-owner decision ت۴ (2026-10-06): only a sales document (invoice or proforma) in draft or proforma status enters the
-- approval workflow, in its own create transaction. Before v9.0.39 every document, final receipts and invoices included,
-- got an instance at its first step and two tasks in everyone's inbox. Each such open instance of a final, live document is
-- closed: one history row in its current step («سند قطعی ثبت شده بود»), its pending tasks canceled, its pending approvals
-- removed and the instance TERMINATED. Instances of draft or proforma documents are left as they are.

INSERT INTO workflow_history_logs (instance_id, from_state_id, to_state_id, performed_by_name, action_key, action_title, comment, created_at)
SELECT i.id, i.current_state_id, i.current_state_id, 'سیستم', 'terminate', 'بستن فرایند سند قطعی', 'سند قطعی ثبت شده بود', now()
FROM workflow_instances i
JOIN documents d ON i.entity_id = d.id::text
WHERE i.entity_type = 'document' AND i.status = 'IN_PROGRESS' AND d.status = 'final' AND d.is_deleted = 0;
--> statement-breakpoint
UPDATE workflow_tasks t
SET status = 'canceled', completed_at = now()
FROM workflow_instances i, documents d
WHERE t.instance_id = i.id AND t.status = 'pending'
  AND i.entity_type = 'document' AND i.status = 'IN_PROGRESS' AND i.entity_id = d.id::text
  AND d.status = 'final' AND d.is_deleted = 0;
--> statement-breakpoint
DELETE FROM workflow_pending_approvals p
USING workflow_instances i, documents d
WHERE p.instance_id = i.id
  AND i.entity_type = 'document' AND i.status = 'IN_PROGRESS' AND i.entity_id = d.id::text
  AND d.status = 'final' AND d.is_deleted = 0;
--> statement-breakpoint
UPDATE workflow_instances i
SET status = 'TERMINATED', version = i.version + 1, updated_at = now()
FROM documents d
WHERE i.entity_type = 'document' AND i.status = 'IN_PROGRESS' AND i.entity_id = d.id::text
  AND d.status = 'final' AND d.is_deleted = 0;
