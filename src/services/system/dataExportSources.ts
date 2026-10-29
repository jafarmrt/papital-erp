import { getTableColumns, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import {
  users, personnel, birthdayGreetings, customers, items, itemCodeHistory, categories, warehouses, itemPrices, itemWarehouseStocks,
  productionProjects, projectStages, projectProductStageProgress, projectBomAllocations, productionReceiptCosts, projectReservationReleases,
  pendingMaterials, transfers, crmLeads, crmActivities, crmLeadStageHistory, customerTags, customerTagLinks, dailyWorkLogs,
  documents, documentItems, historyImportRefs, historyImportPurchaseRefs, transactions, appSettings, roles,
  accounts, fiscalPeriods, journalVouchers, journalVoucherItems, itemOpeningVoucherItems,
  bankAccounts, cheques, treasuryTransactions, pettyCashExpenseLines, colleagueExpenses, colleagueExpenseLines, statutoryRemittanceLines, settlementAllocations, accountingSettings,
  taskCategories, pieceworkTasks, pieceworkPersonnelRates, pieceworkTaskRateHistory, pieceworkLogs, pieceworkPayrolls, payrollStatutoryRates, payrollEidiRates,
  purchaseRequisitions, fileAttachments, eventActionRules,
  workflowDefinitions, workflowDefinitionVersions, workflowStates, workflowTransitions, workflowInstances,
  workflowHistoryLogs, workflowTasks, workflowPendingApprovals, workflowDelegations,
  mediaSections, mediaAssets, projectManagers, stockReceiptConfirmations, workshopTaskReports,
} from '../../db/schema.js';
import { SENSITIVE_SETTING_PATTERN } from '../settings/systemSettings.service.js';

/**
 * v9.0.387 (TD-624، تصمیم ت۷ الف): شیوه خواندن هر جدول خروجی داده‌ها (کلید cursor و، برای اطلاعات ورود، ستون‌های
 * مجاز). فهرست و ترتیب جدول‌ها از `DATA_EXPORT_TABLES` (`src/lib/system/dataExportTables.ts`) می‌آید.
 */

export type Row = Record<string, unknown>;

export interface ExportTableSpec {
  /** database table name; the entry is `<name>.ndjson` */
  name: string;
  table: PgTable;
  /** properties of the primary key, in key order (the cursor) */
  key: string[];
  /** projection; default every column */
  columns?: Record<string, PgColumn>;
  where?: SQL;
  /** rows kept (small tables only; counted after the filter) */
  keep?: (row: Row) => boolean;
}

function withoutColumns(table: PgTable, omit: string[]): Record<string, PgColumn> {
  const columns: Record<string, PgColumn> = { ...getTableColumns(table) };
  for (const name of omit) delete columns[name];
  return columns;
}

type TableSpecSource = Omit<ExportTableSpec, 'name'>;

/**
 * How each exported table is read (v9.0.387, TD-624): its key and, for credentials, its projection. The table list and
 * order come from `DATA_EXPORT_TABLES`; Vitest `dataExportTables.test.ts` checks that both name the same tables.
 */
export const DATA_EXPORT_TABLE_SOURCES: Readonly<Record<string, TableSpecSource>> = {
  // Users WITHOUT password hash, lockout state or token version
  users: {
    table: users, key: ['id'],
    columns: {
      id: users.id, username: users.username, fullName: users.fullName, role: users.role,
      avatarUrl: users.avatarUrl, isDeleted: users.isDeleted, updatedAt: users.updatedAt,
    },
  },
  roles: { table: roles, key: ['id'] },
  // Personnel WITHOUT the third-party exchange password (TD-189)
  personnel: { table: personnel, key: ['id'], columns: withoutColumns(personnel, ['nobitexPassword']) },
  birthday_greetings: { table: birthdayGreetings, key: ['id'] },
  categories: { table: categories, key: ['id'] },
  warehouses: { table: warehouses, key: ['id'] },
  items: { table: items, key: ['id'] },
  item_prices: { table: itemPrices, key: ['id'] },
  item_code_history: { table: itemCodeHistory, key: ['id'] },
  item_warehouse_stocks: { table: itemWarehouseStocks, key: ['id'] },
  transactions: { table: transactions, key: ['id'] },
  transfers: { table: transfers, key: ['id'] },
  documents: { table: documents, key: ['id'] },
  document_items: { table: documentItems, key: ['id'] },
  history_import_refs: { table: historyImportRefs, key: ['kind', 'excelRef'] },
  history_import_purchase_refs: { table: historyImportPurchaseRefs, key: ['documentId'] },
  customers: { table: customers, key: ['id'] },
  crm_leads: { table: crmLeads, key: ['id'] },
  crm_activities: { table: crmActivities, key: ['id'] },
  crm_lead_stage_history: { table: crmLeadStageHistory, key: ['id'] },
  customer_tags: { table: customerTags, key: ['id'] },
  customer_tag_links: { table: customerTagLinks, key: ['id'] },
  daily_work_logs: { table: dailyWorkLogs, key: ['id'] },
  production_projects: { table: productionProjects, key: ['id'] },
  project_stages: { table: projectStages, key: ['id'] },
  project_product_stage_progress: { table: projectProductStageProgress, key: ['id'] },
  project_bom_allocations: { table: projectBomAllocations, key: ['id'] },
  production_receipt_costs: { table: productionReceiptCosts, key: ['documentId'] },
  project_reservation_releases: { table: projectReservationReleases, key: ['id'] },
  pending_materials: { table: pendingMaterials, key: ['id'] },
  project_managers: { table: projectManagers, key: ['id'] },
  stock_receipt_confirmations: { table: stockReceiptConfirmations, key: ['id'] },
  workshop_task_reports: { table: workshopTaskReports, key: ['id'] },
  purchase_requisitions: { table: purchaseRequisitions, key: ['id'] },
  accounts: { table: accounts, key: ['id'] },
  fiscal_periods: { table: fiscalPeriods, key: ['fiscalYear'] },
  journal_vouchers: { table: journalVouchers, key: ['id'] },
  journal_voucher_items: { table: journalVoucherItems, key: ['id'] },
  item_opening_voucher_items: { table: itemOpeningVoucherItems, key: ['voucherId', 'itemId'] },
  bank_accounts: { table: bankAccounts, key: ['id'] },
  cheques: { table: cheques, key: ['id'] },
  treasury_transactions: { table: treasuryTransactions, key: ['id'] },
  petty_cash_expense_lines: { table: pettyCashExpenseLines, key: ['id'] },
  colleague_expenses: { table: colleagueExpenses, key: ['id'] },
  colleague_expense_lines: { table: colleagueExpenseLines, key: ['id'] },
  statutory_remittance_lines: { table: statutoryRemittanceLines, key: ['id'] },
  settlement_allocations: { table: settlementAllocations, key: ['id'] },
  accounting_settings: { table: accountingSettings, key: ['id'] },
  task_categories: { table: taskCategories, key: ['id'] },
  piecework_tasks: { table: pieceworkTasks, key: ['id'] },
  piecework_personnel_rates: { table: pieceworkPersonnelRates, key: ['id'] },
  piecework_task_rate_history: { table: pieceworkTaskRateHistory, key: ['id'] },
  piecework_logs: { table: pieceworkLogs, key: ['id'] },
  piecework_payrolls: { table: pieceworkPayrolls, key: ['id'] },
  payroll_statutory_rates: { table: payrollStatutoryRates, key: ['id'] },
  payroll_eidi_rates: { table: payrollEidiRates, key: ['id'] },
  workflow_definitions: { table: workflowDefinitions, key: ['id'] },
  workflow_definition_versions: { table: workflowDefinitionVersions, key: ['id'] },
  workflow_states: { table: workflowStates, key: ['id'] },
  workflow_transitions: { table: workflowTransitions, key: ['id'] },
  workflow_instances: { table: workflowInstances, key: ['id'] },
  workflow_history_logs: { table: workflowHistoryLogs, key: ['id'] },
  workflow_tasks: { table: workflowTasks, key: ['id'] },
  workflow_pending_approvals: { table: workflowPendingApprovals, key: ['id'] },
  workflow_delegations: { table: workflowDelegations, key: ['id'] },
  event_action_rules: { table: eventActionRules, key: ['id'] },
  // Attachment metadata only; the files stay in the attachment directory (backup.sh archives them)
  file_attachments: { table: fileAttachments, key: ['id'] },
  media_sections: { table: mediaSections, key: ['id'] },
  media_assets: { table: mediaAssets, key: ['id'] },
  // Settings WITHOUT secrets (WooCommerce keys, webhook secrets, tokens)
  app_settings: { table: appSettings, key: ['key'], keep: row => !SENSITIVE_SETTING_PATTERN.test(String(row.key)) },
};

