import type { PgTable } from 'drizzle-orm/pg-core';
import {
  transactions, documentItems, documents, items,
  warehouses, itemPrices, customers, activityLogs, productionProjects, categories,
  projectStages, projectProductStageProgress, dailyWorkLogs, transfers, notifications, crmLeads, crmActivities, crmLeadStageHistory, customerTagLinks, customerTags,
  stockReceiptConfirmations, workshopTaskReports, projectManagers,
  users, personnel, birthdayGreetings, taskCategories, pieceworkTasks, pieceworkPersonnelRates, pieceworkTaskRateHistory,
  pieceworkLogs, pieceworkPayrolls, pendingMaterials, accounts, journalVouchers,
  journalVoucherItems, itemOpeningVoucherItems, bankAccounts, cheques, treasuryTransactions, pettyCashExpenseLines, accountingSettings,
  outboxEvents, deadLetterEvents, workflowInstances, workflowTasks,
  workflowHistoryLogs, workflowPendingApprovals, workflowDelegations,
  workflowDefinitionVersions, workflowTransitions, workflowStates, workflowDefinitions,
  eventActionLogs, eventActionRules, webhookDeliveries, webhookSubscriptions,
  projectBomAllocations, productionReceiptCosts, formDrafts, idempotencyKeys, woocommerceOrderLogs, wcProductLinks, wcSyncRuns,
  documentRefCounters, itemCodeCounters, purchaseRequisitions, appSettings,
  fiscalPeriods, fileAttachments, legacyDateRepairs, refFiscalYearCorrections, workflowTaskReopenLog,
  projectReservationReleases, inventoryReconciliationAnomalies, itemWarehouseStocks,
  integrationDeliveryJobs, eventActionRuleRetirements, webhookEventPatternRepairs, itemPriceTitleCleanup,
  dailyLogVisibilityRepairs, statutoryRemittanceLines, settlementAllocations, payrollStatutoryRates, payrollEidiRates, itemCodeHistory,
  mediaAssets, mediaSections, messengerLinkCodes, userMessengerLinks, userNotificationPreferences, messengerBots, userSessions,
} from '../../db/schema.js';

/**
 * v10.1.45 (OBS-R1-12): what the factory reset wipes, in foreign-key order (a row is deleted before the rows it
 * references), and what it keeps. Every table of the Drizzle schema is in exactly one of the two lists, and Vitest
 * `factoryResetTables.test.ts` checks both the coverage and the order, so a new table is classified in the same change.
 * Before, sixteen tables added after TD-245 were never wiped, and a row in one that references an item, a user, a
 * treasury row or a personnel (item code history, messenger links, statutory remittance lines) refused the whole reset.
 */
export interface FactoryResetWipe {
  name: string;
  table: PgTable;
}

export const FACTORY_RESET_WIPE_ORDER: readonly FactoryResetWipe[] = [
  // 1. Logs, webhooks, integration deliveries, outbox, DLQ, drafts and idempotency
  { name: 'event_action_logs', table: eventActionLogs },
  { name: 'webhook_deliveries', table: webhookDeliveries },
  { name: 'integration_delivery_jobs', table: integrationDeliveryJobs },
  { name: 'webhook_subscriptions', table: webhookSubscriptions },
  { name: 'event_action_rules', table: eventActionRules },
  { name: 'event_action_rule_retirements', table: eventActionRuleRetirements },
  { name: 'webhook_event_pattern_repairs', table: webhookEventPatternRepairs },
  { name: 'dead_letter_events', table: deadLetterEvents },
  { name: 'outbox_events', table: outboxEvents },
  { name: 'woocommerce_order_logs', table: woocommerceOrderLogs },
  { name: 'wc_product_links', table: wcProductLinks },
  { name: 'wc_sync_runs', table: wcSyncRuns },
  { name: 'idempotency_keys', table: idempotencyKeys },
  { name: 'form_drafts', table: formDrafts },
  { name: 'activity_logs', table: activityLogs },
  { name: 'notifications', table: notifications },

  // 1.2. Attachment registry (files on disk are removed only after commit) and data-repair reports (no foreign keys)
  { name: 'file_attachments', table: fileAttachments },
  { name: 'legacy_date_repairs', table: legacyDateRepairs },
  { name: 'workflow_task_reopen_log', table: workflowTaskReopenLog },
  { name: 'item_price_title_cleanup', table: itemPriceTitleCleanup },
  { name: 'daily_log_visibility_repairs', table: dailyLogVisibilityRepairs },

  // 3. Fiscal periods, treasury and accounting (fiscal_periods.closing_voucher_id references journal_vouchers;
  //    statutory remittance lines reference treasury rows and personnel; settlement allocations reference treasury rows,
  //    cheques and documents)
  { name: 'fiscal_periods', table: fiscalPeriods },
  { name: 'settlement_allocations', table: settlementAllocations },
  { name: 'petty_cash_expense_lines', table: pettyCashExpenseLines },
  { name: 'statutory_remittance_lines', table: statutoryRemittanceLines },
  { name: 'treasury_transactions', table: treasuryTransactions },
  { name: 'cheques', table: cheques },
  { name: 'item_opening_voucher_items', table: itemOpeningVoucherItems },
  { name: 'journal_voucher_items', table: journalVoucherItems },
  { name: 'journal_vouchers', table: journalVouchers },
  { name: 'accounting_settings', table: accountingSettings },
  { name: 'bank_accounts', table: bankAccounts },
  { name: 'accounts', table: accounts },

  // 4. Inventory transactions and documents (before projects, items, customers and leads)
  { name: 'stock_receipt_confirmations', table: stockReceiptConfirmations },
  { name: 'workshop_task_reports', table: workshopTaskReports },
  { name: 'project_managers', table: projectManagers },
  { name: 'project_reservation_releases', table: projectReservationReleases },
  { name: 'ref_fiscal_year_corrections', table: refFiscalYearCorrections },
  { name: 'production_receipt_costs', table: productionReceiptCosts },
  { name: 'document_items', table: documentItems },
  { name: 'project_bom_allocations', table: projectBomAllocations },
  { name: 'transactions', table: transactions },
  { name: 'documents', table: documents },
  { name: 'document_ref_counters', table: documentRefCounters },
  { name: 'item_code_counters', table: itemCodeCounters },

  // 4.5. Purchase requisitions (after documents, before workflow instances, projects and users)
  { name: 'purchase_requisitions', table: purchaseRequisitions },

  // 4.6. Workflow tasks, delegations, instances, history and definitions
  { name: 'workflow_history_logs', table: workflowHistoryLogs },
  { name: 'workflow_tasks', table: workflowTasks },
  { name: 'workflow_pending_approvals', table: workflowPendingApprovals },
  { name: 'workflow_instances', table: workflowInstances },
  { name: 'workflow_delegations', table: workflowDelegations },
  { name: 'workflow_definition_versions', table: workflowDefinitionVersions },
  { name: 'workflow_transitions', table: workflowTransitions },
  { name: 'workflow_states', table: workflowStates },
  { name: 'workflow_definitions', table: workflowDefinitions },

  // 5. Project dependencies (before items)
  { name: 'piecework_logs', table: pieceworkLogs },
  { name: 'daily_work_logs', table: dailyWorkLogs },
  { name: 'project_product_stage_progress', table: projectProductStageProgress },
  { name: 'project_stages', table: projectStages },
  { name: 'production_projects', table: productionProjects },

  // 6. CRM and customer relations (before personnel and customers)
  { name: 'crm_activities', table: crmActivities },
  { name: 'crm_lead_stage_history', table: crmLeadStageHistory },
  { name: 'crm_leads', table: crmLeads },
  { name: 'customer_tag_links', table: customerTagLinks },
  { name: 'customer_tags', table: customerTags },

  // 7. HR, piecework and payroll records, with the yearly insurance, tax and eidi rates
  { name: 'birthday_greetings', table: birthdayGreetings },
  { name: 'piecework_payrolls', table: pieceworkPayrolls },
  { name: 'piecework_personnel_rates', table: pieceworkPersonnelRates },
  { name: 'piecework_task_rate_history', table: pieceworkTaskRateHistory },
  { name: 'piecework_tasks', table: pieceworkTasks },
  { name: 'task_categories', table: taskCategories },
  { name: 'personnel', table: personnel },
  { name: 'payroll_statutory_rates', table: payrollStatutoryRates },
  { name: 'payroll_eidi_rates', table: payrollEidiRates },

  // 8. Materials, transfers, stock, media library, items and customers (items_stocks_archive goes with items by
  //    ON DELETE CASCADE; the media files on disk are removed only after commit; media_sections keeps its system
  //    section «محصولات», which only migration 0096 creates)
  { name: 'pending_materials', table: pendingMaterials },
  { name: 'transfers', table: transfers },
  { name: 'inventory_reconciliation_anomalies', table: inventoryReconciliationAnomalies },
  { name: 'item_warehouse_stocks', table: itemWarehouseStocks },
  { name: 'item_prices', table: itemPrices },
  { name: 'item_code_history', table: itemCodeHistory },
  { name: 'media_assets', table: mediaAssets },
  { name: 'media_sections', table: mediaSections },
  { name: 'items', table: items },
  { name: 'customers', table: customers },

  // 9. Categories, warehouses and settings
  { name: 'categories', table: categories },
  { name: 'warehouses', table: warehouses },
  { name: 'app_settings', table: appSettings },

  // 10. Messenger links and bots, then the users (back to the initial setup)
  { name: 'messenger_link_codes', table: messengerLinkCodes },
  { name: 'user_messenger_links', table: userMessengerLinks },
  { name: 'user_notification_preferences', table: userNotificationPreferences },
  { name: 'messenger_bots', table: messengerBots },
  { name: 'user_sessions', table: userSessions },
  { name: 'users', table: users },
];

/** tables the factory reset never wipes, with the reason */
export const FACTORY_RESET_KEPT_TABLES: Readonly<Record<string, string>> = {
  roles: 'the roles are kept (TD-245); a fresh install has only the system admin role',
  migrations_log: 'the record of applied migrations belongs to the database schema, not to its business data',
};

/** the system media section «محصولات» stays; only the sections users made are wiped */
export const MEDIA_SYSTEM_SECTION_KIND = 'products';
