# Physical deletes allowed in production code (OBS-R2-15, decision ت۴۰ item 19)

Business rows are never deleted physically: they are soft-deleted with `is_deleted = 1` and, for stock, reversed (AGENTS.md
§3 and §19, DB-009). The architecture ratchet (`npm run ratchet:architecture`, metric `hardDeletes`) counts every
`x.delete(<schema table>)`, every delete on a database executor or chained with `.where` / `.returning` (a table held in
a variable too) and every SQL text with `DELETE FROM` or `TRUNCATE` in production code; the files below are the only
exceptions, each with its reason, and their counts may only go down. A new physical delete needs its own line here and a
product-owner decision; a file that no longer deletes is removed from this list in the same change
(Vitest `hardDeleteExceptions.test.ts` keeps this list and the baseline equal).

| File | What it deletes | Why the delete is physical |
|---|---|---|
| `src/lib/auditLogger.ts` | activity log rows older than 90 days of the purgeable sections | the system admin's audit purge (TD-522): only operational sections, never financial or security rows |
| `src/services/customers/customerTags.service.ts` | the links between a party and a tag that the save removed | a link row is the state of the party's tag list; the party and the tag stay, and the audit row keeps the before and after |
| `src/services/events/deadLetterQueueService.ts` | dead-letter rows already replayed or dismissed | queue housekeeping («پاک‌سازی صف خطا»); the event stays in the outbox |
| `src/services/events/integrationParentDelete.ts` | a webhook subscription or an automatic rule | integration settings, not business records; its delivery jobs are cancelled and the audit row keeps the before |
| `src/services/events/outboxService.ts` | completed outbox events older than 90 days | the daily operational purge (OBS-R2-10); never an event whose dead-letter row is waiting |
| `src/services/idempotency.service.ts` | expired idempotency keys | the daily operational purge; a key only lives for its window |
| `src/services/messenger/messengerLinks.service.ts` | used or expired one-time link codes | a one-time code has no history; the link itself is kept |
| `src/services/projects/projectManagers.ts` | the manager rows a project save removed | a row is the state of the project's manager list; the audit row keeps the before and after |
| `src/services/system/factoryReset.service.ts` | every business table | the system admin's factory reset, confirmed by typing «حذف همه» |
| `src/services/users/roleAdmin.service.ts` | a role with no active user and no workflow step | roles are settings; the delete is audited with the role before |
| `src/services/woocommerce/wcSyncRunPurge.ts` | automatic WooCommerce stock push runs older than 30 days | the daily operational purge (10.2 package 6, review of PR #327): a run row a minute is a log, not a record; manual pushes and refreshes stay |
| `src/services/workflow/workflowDesignTables.ts` | the live step and action rows of a definition being saved | the design is rewritten from the saved version; every version stays in `workflow_definition_versions` and running instances keep their snapshot |
| `src/services/workflow/workflowTermination.ts` | the pending approvals of a terminated instance | approvals waiting on a step that no longer runs; the history and tasks stay |
| `src/services/workflow/workflowTransitionExecutor.ts` | the pending approvals of the step being left | approvals of a step that is no longer current; the history keeps every signature |

## Files on disk

These remove files, not rows, so the ratchet does not count them; they are written here so that every physical delete
the code makes has its reason. Each is run by the system admin by hand, previews by default and writes an audit row.

| What it deletes | Where | Why the delete is physical |
|---|---|---|
| attachment files with no `file_attachments` row, older than 60 minutes | `src/services/attachments/attachmentOrphanCleanup.service.ts` | the save transaction that wrote them rolled back (TD-224); a detached attachment's file is kept |
| image files of `public/uploads` whose UUID no row of any table names (a soft-deleted or copied record included; only the audit log is not read): first moved to `public/uploads/.orphaned/<day>/` (older than 60 minutes, only those of the confirmed preview), removed only after 30 days there and a fresh re-read of the rows; a held file named again is moved back | `src/services/system/orphanUploadsCleanup.service.ts` | a replaced image (item, transfer design, avatar, raw material request) left its old file behind (OBS-R2-60) |
