# جدول «مسیر ← مجوز» (Route → Permission)

> ساخته‌شده با `npm run routes:permissions` از روترهای Express. `public` = بدون ورود؛ `login-only` = فقط ورود
> (مجوز درون هندلر یا داده خود کاربر)؛ «a \| b» یعنی یکی کافی است و «&» یعنی هر دو گارد لازم است. `admin` همیشه می‌گذرد.

تعداد مسیرها: 364

| متد | مسیر | مجوز |
|---|---|---|
| GET | `/api/accounting/accounts` | accounting.coa \| accounting.vouchers \| accounting.treasury \| accounting.reports \| accounting.view |
| POST | `/api/accounting/accounts` | accounting.coa |
| DELETE | `/api/accounting/accounts/:id` | accounting.coa |
| PUT | `/api/accounting/accounts/:id` | accounting.coa |
| POST | `/api/accounting/accounts/:id/restore` | accounting.coa |
| POST | `/api/accounting/accounts/seed-default` | admin |
| POST | `/api/accounting/accounts/seed-standard` | admin |
| GET | `/api/accounting/accounts/tree` | accounting.coa \| accounting.reports \| accounting.view |
| GET | `/api/accounting/automation-status` | accounting.reports \| accounting.view |
| GET | `/api/accounting/bank-accounts` | accounting.treasury \| accounting.cheques \| accounting.vouchers \| accounting.reports \| accounting.view \| warehouse.in \| warehouse.out \| documents.view \| documents.create |
| POST | `/api/accounting/bank-accounts` | accounting.treasury |
| DELETE | `/api/accounting/bank-accounts/:id` | accounting.treasury |
| PUT | `/api/accounting/bank-accounts/:id` | accounting.treasury |
| GET | `/api/accounting/bank-accounts/next-code` | accounting.treasury |
| GET | `/api/accounting/bank-accounts/reconciliation-report` | accounting.treasury |
| POST | `/api/accounting/bank-accounts/sync-reconcile` | accounting.treasury |
| GET | `/api/accounting/banks` | accounting.treasury \| accounting.cheques \| accounting.vouchers \| accounting.reports \| accounting.view \| warehouse.in \| warehouse.out \| documents.view \| documents.create |
| POST | `/api/accounting/banks` | accounting.treasury |
| DELETE | `/api/accounting/banks/:id` | accounting.treasury |
| PUT | `/api/accounting/banks/:id` | accounting.treasury |
| GET | `/api/accounting/banks/next-code` | accounting.treasury |
| GET | `/api/accounting/banks/reconciliation-report` | accounting.treasury |
| POST | `/api/accounting/banks/sync-reconcile` | accounting.treasury |
| GET | `/api/accounting/cheques` | accounting.cheques \| accounting.treasury \| accounting.reports \| accounting.view |
| POST | `/api/accounting/cheques` | accounting.cheques |
| DELETE | `/api/accounting/cheques/:id` | accounting.cheques |
| PATCH | `/api/accounting/cheques/:id/status` | accounting.cheques |
| PUT | `/api/accounting/cheques/:id/status` | accounting.cheques |
| GET | `/api/accounting/doc-signatures` | accounting.reports \| accounting.view \| documents.view |
| POST | `/api/accounting/fiscal-closing/execute` | admin |
| GET | `/api/accounting/fiscal-closing/preview` | accounting.vouchers |
| GET | `/api/accounting/mappings` | accounting.coa \| accounting.view |
| POST | `/api/accounting/mappings` | accounting.coa |
| POST | `/api/accounting/quick-fix/sync-all-vouchers` | accounting.vouchers |
| GET | `/api/accounting/reports/account-card` | accounting.reports \| accounting.view \| customers.view \| customers.manage \| documents.view |
| GET | `/api/accounting/reports/balance-sheet` | accounting.reports \| accounting.view |
| GET | `/api/accounting/reports/cash-flow` | accounting.reports \| accounting.treasury \| accounting.view |
| GET | `/api/accounting/reports/cheque-reconciliation` | accounting.reports \| accounting.treasury \| accounting.cheques \| accounting.view |
| GET | `/api/accounting/reports/financial-ratios` | accounting.reports \| accounting.view |
| GET | `/api/accounting/reports/health-check` | accounting.reports \| accounting.view |
| GET | `/api/accounting/reports/income-statement` | accounting.reports \| accounting.view |
| GET | `/api/accounting/reports/journal-book` | accounting.reports \| accounting.view |
| GET | `/api/accounting/reports/ledger` | accounting.reports \| accounting.view \| customers.view \| customers.manage \| documents.view |
| GET | `/api/accounting/reports/parties` | accounting.reports \| accounting.view \| customers.view \| customers.manage \| documents.view |
| GET | `/api/accounting/reports/party-ledger` | accounting.reports \| accounting.view \| customers.view \| customers.manage \| documents.view |
| GET | `/api/accounting/reports/project-detail` | accounting.reports \| accounting.view |
| GET | `/api/accounting/reports/project-summary` | accounting.reports \| accounting.view |
| GET | `/api/accounting/reports/trial-balance` | accounting.reports \| accounting.view |
| GET | `/api/accounting/stats` | accounting.view |
| GET | `/api/accounting/summary` | accounting.view |
| GET | `/api/accounting/treasury` | accounting.treasury \| accounting.reports \| accounting.view |
| POST | `/api/accounting/treasury` | accounting.treasury |
| POST | `/api/accounting/treasury/:id/void` | accounting.treasury |
| POST | `/api/accounting/treasury/preview-voucher` | accounting.treasury |
| POST | `/api/accounting/treasury/reconcile` | accounting.treasury |
| POST | `/api/accounting/treasury/transfer` | accounting.treasury |
| GET | `/api/accounting/vouchers` | accounting.vouchers \| accounting.reports \| accounting.view |
| POST | `/api/accounting/vouchers` | accounting.vouchers |
| DELETE | `/api/accounting/vouchers/:id` | accounting.vouchers |
| GET | `/api/accounting/vouchers/:id` | accounting.vouchers \| accounting.reports \| accounting.view |
| PUT | `/api/accounting/vouchers/:id` | accounting.vouchers |
| POST | `/api/accounting/vouchers/:id/correct` | accounting.vouchers |
| POST | `/api/accounting/vouchers/:id/finalize` | accounting.vouchers |
| POST | `/api/accounting/vouchers/:id/reverse` | accounting.vouchers |
| PUT | `/api/accounting/vouchers/:id/status` | accounting.vouchers |
| POST | `/api/accounting/vouchers/batch-approve` | accounting.vouchers |
| POST | `/api/accounting/vouchers/batch-finalize` | accounting.vouchers |
| GET | `/api/activity-logs` | admin \| manager |
| GET | `/api/activity-logs/filters` | admin \| manager |
| GET | `/api/activity-logs/integrity` | admin \| manager |
| POST | `/api/activity-logs/purge` | admin |
| POST | `/api/admin/clear-data` | admin |
| GET | `/api/attachments/:id` | login-only |
| POST | `/api/attachments/cleanup-orphans` | admin |
| POST | `/api/attachments/migrate-inline` | admin |
| GET | `/api/auth/csrf` | login-only |
| POST | `/api/auth/login` | public |
| POST | `/api/auth/login` | public |
| POST | `/api/auth/logout` | public |
| GET | `/api/auth/me` | login-only |
| GET | `/api/categories` | login-only |
| POST | `/api/categories` | admin \| manager \| products.create \| products.edit |
| DELETE | `/api/categories/:id` | admin \| products.delete |
| PUT | `/api/categories/:id` | admin \| manager \| products.edit |
| POST | `/api/categories/reset-defaults` | admin |
| GET | `/api/check-setup` | public |
| GET | `/api/crm/activities` | crm.view \| customers.view \| customers.manage |
| POST | `/api/crm/activities` | crm.manage |
| PUT | `/api/crm/activities/:id/complete-followup` | crm.manage |
| PUT | `/api/crm/activities/:id/reopen-followup` | crm.manage |
| GET | `/api/crm/followups` | crm.view \| customers.view \| customers.manage |
| GET | `/api/crm/leads` | crm.view \| customers.view \| customers.manage |
| POST | `/api/crm/leads` | crm.manage |
| DELETE | `/api/crm/leads/:id` | crm.delete |
| GET | `/api/crm/leads/:id` | crm.view |
| PUT | `/api/crm/leads/:id` | crm.manage |
| POST | `/api/crm/leads/:id/convert-to-customer` | crm.manage |
| GET | `/api/crm/stats` | crm.view \| customers.view \| customers.manage |
| GET | `/api/csrf` | login-only |
| GET | `/api/customers` | customers.view \| documents.view \| documents.create \| warehouse.in \| crm.view \| projects.view \| procurement.view |
| POST | `/api/customers` | admin \| manager \| sales_manager \| customers.manage |
| DELETE | `/api/customers/:id` | admin \| manager \| sales_manager \| customers.manage |
| PUT | `/api/customers/:id` | admin \| manager \| sales_manager \| customers.manage |
| GET | `/api/customers/:id/account-card` | accounting.reports \| accounting.view \| customers.view \| customers.manage \| documents.view |
| GET | `/api/customers/:id/documents` | documents.view \| documents.create \| documents.edit \| warehouse.view \| warehouse.in \| warehouse.out \| audit.view \| crm.view \| workflow.view |
| POST | `/api/customers/bulk-import` | admin \| manager \| sales_manager \| customers.manage |
| GET | `/api/customers/export-excel` | customers.view |
| GET | `/api/daily-logs` | daily_logs.view |
| POST | `/api/daily-logs` | daily_logs.create |
| DELETE | `/api/daily-logs/:id` | daily_logs.create |
| GET | `/api/daily-logs/:id` | daily_logs.view |
| PUT | `/api/daily-logs/:id` | daily_logs.create |
| PUT | `/api/daily-logs/:id/review` | login-only |
| GET | `/api/daily-logs/stats` | daily_logs.view |
| GET | `/api/daily-logs/summary-report` | daily_logs.manage_all |
| GET | `/api/dashboard-bi-stats` | reports.view \| warehouse.view |
| GET | `/api/documents` | documents.view \| documents.create \| documents.edit \| warehouse.view \| warehouse.in \| warehouse.out \| audit.view \| crm.view \| workflow.view |
| POST | `/api/documents` | admin \| manager \| sales_manager \| accountant \| warehouse_keeper \| documents.create \| warehouse.in \| warehouse.out |
| DELETE | `/api/documents/:id` | documents.delete |
| GET | `/api/documents/:id` | documents.view \| documents.create \| documents.edit \| warehouse.view \| warehouse.in \| warehouse.out \| audit.view \| crm.view \| workflow.view |
| PUT | `/api/documents/:id` | admin \| manager \| sales_manager \| accountant \| warehouse_keeper \| documents.edit |
| PUT | `/api/documents/:id/finalize` | admin \| manager \| warehouse_keeper \| accountant \| documents.edit \| warehouse.in \| warehouse.out |
| PUT | `/api/documents/:id/notes` | admin \| manager \| documents.edit |
| GET | `/api/documents/audit-items` | documents.view \| documents.create \| documents.edit \| warehouse.view \| warehouse.in \| warehouse.out \| audit.view \| crm.view \| workflow.view |
| GET | `/api/documents/by-ref/:ref` | documents.view \| documents.create \| documents.edit \| warehouse.view \| warehouse.in \| warehouse.out \| audit.view \| crm.view \| workflow.view |
| GET | `/api/documents/next-ref` | documents.view \| documents.create \| documents.edit \| warehouse.view \| warehouse.in \| warehouse.out \| audit.view \| crm.view \| workflow.view |
| GET | `/api/drafts` | login-only |
| POST | `/api/drafts` | login-only |
| DELETE | `/api/drafts/:entityType` | login-only |
| GET | `/api/drafts/:entityType` | login-only |
| DELETE | `/api/drafts/id/:id` | login-only |
| GET | `/api/events/action-logs` | events.view |
| GET | `/api/events/action-rules` | events.view |
| POST | `/api/events/action-rules` | events.manage |
| DELETE | `/api/events/action-rules/:id` | events.manage |
| GET | `/api/events/action-rules/:id` | events.view |
| PUT | `/api/events/action-rules/:id` | events.manage |
| POST | `/api/events/action-rules/:id/test` | events.manage |
| POST | `/api/events/action-rules/:id/toggle` | events.manage |
| GET | `/api/events/action-rules/logs` | events.view |
| GET | `/api/events/action-rules/stats` | events.view |
| POST | `/api/events/action-rules/test-draft` | events.manage |
| GET | `/api/events/dlq` | events.view |
| POST | `/api/events/dlq/:id/dismiss` | events.manage |
| PUT | `/api/events/dlq/:id/payload` | events.manage |
| POST | `/api/events/dlq/:id/replay` | events.manage |
| POST | `/api/events/dlq/purge` | events.manage |
| POST | `/api/events/dlq/replay-batch` | events.manage |
| GET | `/api/events/dlq/stats` | events.view |
| GET | `/api/events/domain-events` | events.view |
| POST | `/api/events/domain-events/simulate` | events.manage |
| GET | `/api/events/event-sourcing/aggregates` | events.view |
| POST | `/api/events/event-sourcing/simulate-replay` | events.manage |
| GET | `/api/events/event-sourcing/timeline` | events.view |
| GET | `/api/events/event-sourcing/types` | events.view |
| GET | `/api/events/outbox` | events.view |
| POST | `/api/events/outbox/:eventId/retry` | events.manage |
| POST | `/api/events/outbox/process` | events.manage |
| POST | `/api/events/outbox/process-now` | events.manage |
| POST | `/api/events/outbox/retry-failed` | events.manage |
| GET | `/api/events/outbox/stats` | events.view |
| GET | `/api/events/rules` | events.view |
| POST | `/api/events/rules` | events.manage |
| DELETE | `/api/events/rules/:id` | events.manage |
| GET | `/api/events/rules/:id` | events.view |
| PUT | `/api/events/rules/:id` | events.manage |
| POST | `/api/events/rules/:id/test` | events.manage |
| POST | `/api/events/rules/:id/toggle` | events.manage |
| GET | `/api/events/rules/stats` | events.view |
| GET | `/api/events/timeline` | events.view |
| GET | `/api/events/timeline/aggregates` | events.view |
| POST | `/api/events/timeline/simulate-replay` | events.manage |
| GET | `/api/events/timeline/types` | events.view |
| GET | `/api/events/webhooks` | events.view |
| POST | `/api/events/webhooks` | events.manage |
| DELETE | `/api/events/webhooks/:id` | events.manage |
| GET | `/api/events/webhooks/:id` | events.view |
| PUT | `/api/events/webhooks/:id` | events.manage |
| POST | `/api/events/webhooks/:id/toggle` | events.manage |
| GET | `/api/events/webhooks/deliveries` | events.view |
| GET | `/api/events/webhooks/deliveries/list` | events.view |
| POST | `/api/events/webhooks/ping` | events.manage |
| GET | `/api/events/webhooks/stats` | events.view |
| GET | `/api/export-backup` | admin |
| GET | `/api/global-search` | login-only |
| GET | `/api/health` | public |
| GET | `/api/health/live` | public |
| GET | `/api/health/ready` | public |
| GET | `/api/health/startup` | public |
| GET | `/api/inventory/3way-integrity` | warehouse.view \| inventory.reconcile \| audit.view |
| GET | `/api/inventory/allocations` | warehouse.view \| projects.view |
| POST | `/api/inventory/allocations/:id/consume` | inventory.reconcile \| projects.edit |
| POST | `/api/inventory/allocations/:id/release` | inventory.reconcile \| projects.edit \| warehouse.out |
| POST | `/api/inventory/allocations/allocate` | projects.edit \| warehouse.out |
| GET | `/api/inventory/integrity-audit` | warehouse.view \| inventory.reconcile \| audit.view |
| GET | `/api/inventory/item-kardex/:itemId` | warehouse.view |
| POST | `/api/inventory/kardex-initial-backfill` | inventory.reconcile |
| GET | `/api/inventory/negative-stock-policy` | warehouse.view \| inventory.reconcile \| audit.view |
| PUT | `/api/inventory/negative-stock-policy` | inventory.reconcile |
| POST | `/api/inventory/rebuild-from-ledger` | inventory.reconcile |
| GET | `/api/inventory/report` | warehouse.view \| inventory.reconcile \| audit.view |
| GET | `/api/inventory/reserved-items` | products.view \| reports.view \| warehouse.view \| warehouse.in \| documents.view \| documents.create |
| POST | `/api/inventory/transfer` | warehouse.transfer |
| GET | `/api/inventory/warehouse-stock-reconciliation` | warehouse.view \| inventory.reconcile \| audit.view |
| POST | `/api/inventory/warehouse-stock-reconciliation/repair` | inventory.reconcile |
| GET | `/api/items` | products.view \| products.edit_price \| documents.view \| documents.create \| warehouse.view \| warehouse.in \| audit.view \| projects.view \| crm.view \| procurement.view |
| POST | `/api/items` | admin \| manager \| products.create |
| DELETE | `/api/items/:id` | admin \| products.delete |
| PUT | `/api/items/:id` | admin \| manager \| products.edit |
| GET | `/api/items/:id/prices` | products.view \| products.edit_price \| projects.view |
| POST | `/api/items/:id/prices` | admin \| manager \| products.edit_price |
| GET | `/api/items/:id/prices/history` | products.view \| products.edit_price \| projects.view |
| GET | `/api/items/next-code` | products.view \| products.edit_price \| documents.view \| documents.create \| warehouse.view \| warehouse.in \| audit.view \| projects.view \| crm.view \| procurement.view |
| POST | `/api/items/next-code` | admin \| manager \| products.create \| products.edit |
| GET | `/api/items/prices/all` | products.view \| products.edit_price \| projects.view |
| POST | `/api/items/prices/batch-update` | admin \| manager \| products.edit_price |
| GET | `/api/items/reorder-alerts` | products.view \| products.edit_price \| documents.view \| documents.create \| warehouse.view \| warehouse.in \| audit.view \| projects.view \| crm.view \| procurement.view |
| GET | `/api/items/unified-export` | admin \| manager \| products.view |
| POST | `/api/items/unified-import` | admin \| manager \| products.create \| products.edit |
| POST | `/api/login` | public |
| POST | `/api/login` | public |
| POST | `/api/logout` | public |
| GET | `/api/me` | login-only |
| GET | `/api/menu-visibility` | login-only |
| GET | `/api/metrics` | public |
| GET | `/api/notifications` | login-only |
| DELETE | `/api/notifications/:id` | login-only |
| PUT | `/api/notifications/:id/read` | login-only |
| PUT | `/api/notifications/read-all` | login-only |
| GET | `/api/notifications/unread-count` | login-only |
| GET | `/api/pending-materials` | pending_materials.view \| products.view |
| POST | `/api/pending-materials` | login-only |
| DELETE | `/api/pending-materials/:id` | admin \| manager |
| PUT | `/api/pending-materials/:id` | pending_materials.approve |
| PUT | `/api/pending-materials/:id/approve` | pending_materials.approve |
| PUT | `/api/pending-materials/:id/reject` | pending_materials.approve |
| GET | `/api/permissions` | roles.manage \| users.manage |
| GET | `/api/personnel` | personnel.view \| personnel.manage \| piecework.view \| projects.view \| accounting.view \| crm.view \| documents.view \| documents.create \| warehouse.in |
| POST | `/api/personnel` | admin \| manager \| personnel.manage |
| DELETE | `/api/personnel/:id` | admin \| manager \| personnel.manage |
| GET | `/api/personnel/:id` | personnel.view \| personnel.manage \| piecework.view \| projects.view \| accounting.view \| crm.view \| documents.view \| documents.create \| warehouse.in |
| PUT | `/api/personnel/:id` | admin \| manager \| personnel.manage |
| POST | `/api/personnel/bulk-import` | admin \| manager \| personnel.manage |
| GET | `/api/personnel/export` | admin \| manager \| personnel.manage |
| GET | `/api/piecework/categories` | piecework.view \| piecework.log \| piecework.manage_tasks \| projects.view \| settings.manage |
| POST | `/api/piecework/categories` | personnel.manage \| admin \| settings.manage |
| DELETE | `/api/piecework/categories/:id` | personnel.manage \| admin \| settings.manage |
| PUT | `/api/piecework/categories/:id` | personnel.manage \| admin \| settings.manage |
| GET | `/api/piecework/logs` | piecework.view \| piecework.log \| piecework.manage_tasks \| projects.view \| settings.manage |
| POST | `/api/piecework/logs` | personnel.manage \| piecework.log \| admin |
| DELETE | `/api/piecework/logs/:id` | personnel.manage \| admin |
| PUT | `/api/piecework/logs/:id` | personnel.manage \| admin |
| GET | `/api/piecework/payrolls` | piecework.payroll \| personnel.manage \| accounting.treasury |
| POST | `/api/piecework/payrolls` | personnel.manage \| admin |
| DELETE | `/api/piecework/payrolls/:id` | personnel.manage \| admin |
| GET | `/api/piecework/payrolls/:id` | piecework.payroll \| personnel.manage \| accounting.treasury |
| GET | `/api/piecework/payrolls/:id/payments` | piecework.payroll \| personnel.manage \| accounting.treasury |
| POST | `/api/piecework/payrolls/:id/payments/:transactionId/void` | personnel.manage \| admin |
| POST | `/api/piecework/payrolls/:id/register-payment` | personnel.manage \| admin |
| PUT | `/api/piecework/payrolls/:id/status` | personnel.manage \| admin |
| POST | `/api/piecework/payrolls/:id/sync-voucher` | piecework.payroll \| personnel.manage |
| POST | `/api/piecework/payrolls/generate` | personnel.manage \| admin |
| GET | `/api/piecework/payrolls/mine` | login-only |
| POST | `/api/piecework/personnel-rates` | personnel.manage \| admin |
| GET | `/api/piecework/personnel-rates/:personnelId` | piecework.view \| piecework.log \| piecework.manage_tasks \| projects.view \| settings.manage |
| GET | `/api/piecework/personnel/:id/advance-balance` | piecework.payroll \| personnel.manage \| accounting.treasury |
| POST | `/api/piecework/rates` | personnel.manage \| admin |
| GET | `/api/piecework/rates/:personnelId` | piecework.view \| piecework.log \| piecework.manage_tasks \| projects.view \| settings.manage |
| GET | `/api/piecework/tasks` | piecework.view \| piecework.log \| piecework.manage_tasks \| projects.view \| settings.manage |
| POST | `/api/piecework/tasks` | personnel.manage \| admin |
| GET | `/api/piecework/tasks-history` | piecework.view \| piecework.log \| piecework.manage_tasks \| projects.view \| settings.manage |
| DELETE | `/api/piecework/tasks/:id` | personnel.manage \| admin |
| PUT | `/api/piecework/tasks/:id` | personnel.manage \| admin |
| GET | `/api/piecework/tasks/:id/history` | piecework.view \| piecework.log \| piecework.manage_tasks \| projects.view \| settings.manage |
| POST | `/api/piecework/tasks/:id/restore` | personnel.manage \| admin |
| POST | `/api/piecework/tasks/clear-all` | personnel.manage \| admin |
| POST | `/api/piecework/tasks/clear-defaults` | personnel.manage \| admin |
| POST | `/api/piecework/tasks/import-excel` | personnel.manage \| admin |
| POST | `/api/procurement/consolidate` | procurement.manage \| procurement_officer \| manager \| admin |
| GET | `/api/procurement/inbox/summary` | procurement.view \| procurement_officer \| manager \| admin |
| GET | `/api/procurement/orders` | procurement.view \| procurement_officer \| manager \| admin \| projects.view |
| POST | `/api/procurement/orders/:id/deliver` | procurement.order \| procurement.manage \| procurement_officer \| manager \| admin |
| GET | `/api/procurement/requisitions` | procurement.view \| procurement_officer \| manager \| admin \| projects.view |
| POST | `/api/procurement/requisitions` | procurement.create \| procurement_officer \| manager \| admin \| projects.edit |
| DELETE | `/api/procurement/requisitions/:id` | procurement.manage \| procurement_officer \| manager \| admin |
| GET | `/api/procurement/requisitions/:id` | procurement.view \| procurement_officer \| manager \| admin \| projects.view |
| PUT | `/api/procurement/requisitions/:id` | procurement.manage \| procurement_officer \| manager \| admin |
| POST | `/api/procurement/requisitions/:id/convert-to-orders` | procurement.order \| procurement_officer \| manager \| admin |
| POST | `/api/procurement/requisitions/:id/workflow-action` | procurement.approve \| procurement.manage \| procurement_officer \| manager \| admin |
| GET | `/api/projects` | projects.view \| projects.create \| projects.edit \| documents.view \| documents.create \| warehouse.in \| warehouse.out \| warehouse.view |
| POST | `/api/projects` | projects.create |
| DELETE | `/api/projects/:id` | projects.delete |
| GET | `/api/projects/:id` | projects.view \| projects.create \| projects.edit \| documents.view \| documents.create \| warehouse.in \| warehouse.out \| warehouse.view |
| PUT | `/api/projects/:id` | projects.edit |
| POST | `/api/projects/:id/add-to-inventory` | projects.edit |
| GET | `/api/projects/:id/product-progress` | projects.view \| projects.edit \| projects.create \| warehouse.view \| documents.view |
| PUT | `/api/projects/:id/product-progress` | projects.edit |
| POST | `/api/projects/:id/stages` | projects.edit |
| DELETE | `/api/projects/:id/stages/:stageId` | projects.edit |
| PUT | `/api/projects/:id/stages/:stageId` | projects.edit |
| GET | `/api/public-settings` | public |
| GET | `/api/roles` | users.manage \| roles.manage \| personnel.manage \| workflow.manage \| settings.manage |
| POST | `/api/roles` | roles.manage |
| DELETE | `/api/roles/:id` | roles.manage |
| PUT | `/api/roles/:id` | roles.manage |
| GET | `/api/settings` | login-only |
| POST | `/api/settings` | admin \| manager \| settings.manage |
| POST | `/api/setup` | public |
| GET | `/api/stats` | reports.view \| warehouse.view |
| GET | `/api/system/business-date` | login-only |
| GET | `/api/system/date-calendar-report` | admin |
| GET | `/api/system/env` | admin |
| GET | `/api/system/health` | admin |
| GET | `/api/system/reconciliation-check` | admin |
| POST | `/api/system/reconciliation-fix` | admin |
| GET | `/api/transactions` | warehouse.view \| accounting.view |
| GET | `/api/transfers` | products.view |
| POST | `/api/transfers` | admin \| manager \| warehouse_keeper \| products.create \| products.edit |
| PUT | `/api/transfers` | admin \| manager \| warehouse_keeper \| products.create \| products.edit |
| DELETE | `/api/transfers/:code` | admin \| manager \| products.delete |
| GET | `/api/transfers/:code` | products.view |
| POST | `/api/transfers/:code` | admin \| manager \| warehouse_keeper \| products.create \| products.edit |
| PUT | `/api/transfers/:code` | admin \| manager \| warehouse_keeper \| products.create \| products.edit |
| GET | `/api/users` | users.manage \| roles.manage \| personnel.manage \| workflow.manage \| settings.manage |
| POST | `/api/users` | users.manage |
| DELETE | `/api/users/:id` | users.manage |
| PUT | `/api/users/:id` | users.manage |
| GET | `/api/users/list-simple` | login-only |
| GET | `/api/users/my-permissions` | login-only |
| GET | `/api/users/profile` | login-only |
| PUT | `/api/users/profile` | login-only |
| GET | `/api/warehouses` | login-only |
| POST | `/api/warehouses` | admin |
| DELETE | `/api/warehouses/:id` | admin |
| PUT | `/api/warehouses/:id` | admin |
| GET | `/api/woocommerce/order-logs` | admin \| manager \| woocommerce.view |
| POST | `/api/woocommerce/sync-all-stocks` | admin \| manager \| woocommerce.manage |
| POST | `/api/woocommerce/sync-item` | admin \| manager \| woocommerce.manage |
| POST | `/api/woocommerce/sync-order-by-id` | admin \| manager \| woocommerce.manage |
| GET | `/api/woocommerce/synced-orders` | admin \| manager \| woocommerce.view |
| POST | `/api/woocommerce/test-connection` | admin \| manager \| woocommerce.manage |
| GET | `/api/workflow/analytics/sla` | workflow.manage \| workflow.admin |
| GET | `/api/workflow/definitions` | workflow.manage \| workflow.admin |
| POST | `/api/workflow/definitions` | workflow.manage \| workflow.admin |
| GET | `/api/workflow/definitions/:id` | workflow.manage \| workflow.admin |
| GET | `/api/workflow/definitions/:id/versions` | workflow.manage \| workflow.admin |
| GET | `/api/workflow/definitions/:id/versions/:version` | workflow.manage \| workflow.admin |
| POST | `/api/workflow/definitions/seed-default` | workflow.admin |
| GET | `/api/workflow/delegations` | workflow.view \| workflow.manage \| workflow.admin |
| POST | `/api/workflow/delegations` | workflow.approve \| workflow.manage \| workflow.admin |
| POST | `/api/workflow/delegations/:id/revoke` | workflow.approve \| workflow.manage \| workflow.admin |
| GET | `/api/workflow/inbox` | workflow.view \| workflow.approve \| workflow.execute \| workflow.manage \| workflow.admin |
| GET | `/api/workflow/instance/:entityType/:entityId` | workflow.view \| workflow.approve \| workflow.execute \| workflow.manage \| workflow.admin |
| POST | `/api/workflow/positions` | workflow.manage \| workflow.admin |
| POST | `/api/workflow/start` | workflow.execute \| workflow.manage \| workflow.admin \| workflow.approve \| documents.create \| documents.edit |
| POST | `/api/workflow/tasks/:taskId/execute` | workflow.approve \| workflow.execute \| workflow.manage \| workflow.admin |
| GET | `/api/workflow/tasks/my-tasks` | workflow.view \| workflow.approve \| workflow.execute \| workflow.manage \| workflow.admin |
| GET | `/api/workflow/tasks/stats` | workflow.view \| workflow.approve \| workflow.execute \| workflow.manage \| workflow.admin |
| POST | `/api/workflow/transition` | workflow.approve \| workflow.execute \| workflow.manage \| workflow.admin |
| GET | `/health` | public |
| GET | `/health/live` | public |
| GET | `/health/ready` | public |
| GET | `/health/startup` | public |
| GET | `/metrics` | public |
