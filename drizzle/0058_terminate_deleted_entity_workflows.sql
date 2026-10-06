-- Drizzle Migration 0058: close the open workflows of entities that were already voided or deleted (v9.0.40 / TD-447, finding B14-05)
--
-- Product-owner decision ت۵ (2026-10-06): voiding or deleting an entity closes its running workflow in the same transaction
-- (instance TERMINATED, tasks canceled, one history row). Before v9.0.40 nothing closed it: the instance stayed IN_PROGRESS,
-- its tasks stayed in the inbox and its due reminder was still sent. Each open instance whose entity row is soft-deleted
-- (document, journal voucher, item, bank account, purchase requisition) is closed the same way, with one history row in its
-- current step («موجودیت پیش‌تر باطل یا حذف شده بود»). Instances of live entities and of unknown entity types are left as
-- they are.

CREATE TEMP TABLE tmp_wf_deleted_entity_instances ON COMMIT DROP AS
SELECT i.id, i.current_state_id
FROM workflow_instances i
WHERE i.status = 'IN_PROGRESS' AND (
  (i.entity_type = 'document' AND EXISTS (SELECT 1 FROM documents d WHERE d.id::text = i.entity_id AND d.is_deleted = 1))
  OR (i.entity_type IN ('journal_voucher', 'voucher') AND EXISTS (SELECT 1 FROM journal_vouchers v WHERE v.id::text = i.entity_id AND v.is_deleted = 1))
  OR (i.entity_type = 'item' AND EXISTS (SELECT 1 FROM items it WHERE it.id::text = i.entity_id AND it.is_deleted = 1))
  OR (i.entity_type = 'bank_account' AND EXISTS (SELECT 1 FROM bank_accounts b WHERE b.id::text = i.entity_id AND b.is_deleted = 1))
  OR (i.entity_type = 'purchase_requisition' AND EXISTS (SELECT 1 FROM purchase_requisitions r WHERE r.id::text = i.entity_id AND r.is_deleted = 1))
);
--> statement-breakpoint
INSERT INTO workflow_history_logs (instance_id, from_state_id, to_state_id, performed_by_name, action_key, action_title, comment, created_at)
SELECT id, current_state_id, current_state_id, 'سیستم', 'terminate', 'بستن فرایند موجودیت حذف‌شده', 'موجودیت پیش‌تر باطل یا حذف شده بود', now()
FROM tmp_wf_deleted_entity_instances;
--> statement-breakpoint
UPDATE workflow_tasks SET status = 'canceled', completed_at = now()
WHERE status = 'pending' AND instance_id IN (SELECT id FROM tmp_wf_deleted_entity_instances);
--> statement-breakpoint
DELETE FROM workflow_pending_approvals WHERE instance_id IN (SELECT id FROM tmp_wf_deleted_entity_instances);
--> statement-breakpoint
UPDATE workflow_instances SET status = 'TERMINATED', version = version + 1, updated_at = now()
WHERE id IN (SELECT id FROM tmp_wf_deleted_entity_instances);
--> statement-breakpoint
DROP TABLE tmp_wf_deleted_entity_instances;
