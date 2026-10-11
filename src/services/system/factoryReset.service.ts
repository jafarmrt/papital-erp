import fs from 'fs';
import type { PgTable } from 'drizzle-orm/pg-core';
import { orm } from '../../db/drizzle.js';
import {
  transactions, documentItems, documents, items,
  warehouses, itemPrices, customers, activityLogs, productionProjects, categories,
  projectStages, projectProductStageProgress, dailyWorkLogs, transfers, notifications, crmLeads, crmActivities,
  users, personnel, taskCategories, pieceworkTasks, pieceworkPersonnelRates, pieceworkTaskRateHistory,
  pieceworkLogs, pieceworkPayrolls, pendingMaterials, accounts, journalVouchers,
  journalVoucherItems, itemOpeningVoucherItems, bankAccounts, cheques, treasuryTransactions, accountingSettings,
  outboxEvents, deadLetterEvents, workflowInstances, workflowTasks,
  workflowHistoryLogs, workflowPendingApprovals, workflowDelegations,
  workflowDefinitionVersions, workflowTransitions, workflowStates, workflowDefinitions,
  eventActionLogs, eventActionRules, webhookDeliveries, webhookSubscriptions,
  projectBomAllocations, formDrafts, idempotencyKeys, woocommerceOrderLogs,
  documentRefCounters, itemCodeCounters, purchaseRequisitions, appSettings,
  fiscalPeriods, fileAttachments, legacyDateRepairs, refFiscalYearCorrections, workflowTaskReopenLog,
  projectReservationReleases, inventoryReconciliationAnomalies, itemWarehouseStocks
} from '../../db/schema.js';
import { logger } from '../../middleware/logger.js';
import { invalidateUserAuthCache } from '../../middleware/auth.js';
import { ConflictError, ForbiddenError } from '../../errors/customErrors.js';
import { runSeed } from '../../db/seed.js';
import { seedDefaultEngines } from './bootData.js';
import { withAdvisoryLock, ADVISORY_LOCK_KEYS } from '../../lib/advisoryLock.js';
import { logActivity } from '../../lib/auditLogger.js';
import { invalidateRoleCache, invalidateSettingsCache } from '../../lib/memoryCache.js';
import { invalidateTimezoneCache } from '../../lib/businessClock.js';
import { AttachmentStorageService } from '../attachments/attachmentStorage.service.js';
import { errorMessageOf } from '../../utils.js';

/**
 * بازنشانی کامل سامانه به وضعیت راه‌اندازی اولیه (POST /admin/clear-data).
 * همه داده‌های عملیاتی و حساب‌های کاربری در یک تراکنش حذف و سپس پیش‌فرض‌های استاندارد دوباره seed می‌شوند.
 * P0-01 (ARCH-01): در پروداکشن یا بدون ALLOW_DANGEROUS_DATA_PURGE=true همیشه مسدود است؛
 * این نگهبان پیش از هر حذف در خود سرویس اجرا می‌شود.
 *
 * TD-245 (تصمیم مالک محصول «همه پاک شود»): سال‌های مالی بسته (fiscal_periods)، ثبت پیوست‌ها و فایل‌های آن‌ها روی
 * دیسک، گزارش‌های اصلاح داده (legacy_date_repairs، ref_fiscal_year_corrections، workflow_task_reopen_log) و جداولی که
 * پیش‌تر فقط با cascade پاک می‌شدند هم صریحاً پاک می‌شوند. کل عملیات زیر قفل مشورتی seed (89345) اجرا می‌شود تا هیچ
 * seed همزمانی با پاک‌سازی تداخل نکند؛ فایل‌ها فقط پس از commit تراکنش حذف می‌شوند و یک ردیف ممیزی در همان تراکنش
 * (پس از پاک شدن activity_logs) می‌ماند.
 */

export interface FactoryResetActor {
  username?: string;
  ip: string;
}

export interface FactoryResetReport {
  /** تعداد ردیف‌های حذف‌شده هر جدول (به ترتیب حذف) */
  deletedRows: Record<string, number>;
  attachmentFiles: { total: number; removed: number; missing: number; failed: number };
}

export const FACTORY_RESET_AUDIT_ENTITY = 'سیستم:بازنشانی کامل';

interface AttachmentFileRemoval {
  removed: number;
  missing: number;
  failed: number;
}

export class FactoryResetService {
  /** P0-01 (ARCH-01): محافظت قطعی در برابر حذف فیزیکی دیتابیس در محیط پروداکشن */
  static assertAllowed(actor: FactoryResetActor): void {
    const isProd = process.env.NODE_ENV === 'production';
    const allowDangerousPurge = process.env.ALLOW_DANGEROUS_DATA_PURGE === 'true';

    if (isProd || !allowDangerousPurge) {
      logger.error({
        message: 'Blocked unauthorized attempt to wipe all ERP operational data via /admin/clear-data',
        user: actor.username,
        nodeEnv: process.env.NODE_ENV,
        allowDangerousPurge,
        ip: actor.ip
      });
      throw new ForbiddenError(
        'عملیات حذف کل داده‌های سامانه در محیط پروداکشن یا بدون فعال‌سازی صریح متغیر ALLOW_DANGEROUS_DATA_PURGE اکیداً مسدود است (مطابق قانون بنیادین RULE 09).'
      );
    }
  }

  /**
   * Wipe & reset all system operational data and users to trigger the initial setup scenario,
   * then re-seed system standard defaults. The guard runs again here so no caller can skip it;
   * the caller logs and rethrows failures.
   */
  static async wipeAndReseed(actor: FactoryResetActor): Promise<FactoryResetReport> {
    this.assertAllowed(actor);

    logger.warn({
      message: 'Authorized /admin/clear-data execution started in non-production environment',
      user: actor.username,
      ip: actor.ip
    });

    // قفل seed پیش از پاک‌سازی گرفته و تا پایان seed دوباره نگه داشته می‌شود؛ اگر seed دیگری در جریان باشد هیچ چیز پاک نمی‌شود
    const outcome = await withAdvisoryLock(ADVISORY_LOCK_KEYS.SEED, async (): Promise<FactoryResetReport> => {
      const { deletedRows, attachmentPaths } = await this.wipeAllData(actor);

      // فایل‌ها فقط پس از commit: اگر تراکنش برگردد ردیف‌ها و فایل‌ها هر دو می‌مانند
      const files = await this.removeAttachmentFiles(attachmentPaths);
      this.invalidateCaches();

      // Re-seed the base data (categories, settings, chart of accounts, task categories, piecework tasks; roles are kept,
      // TD-245) and, as at boot, the default workflows, event rules and webhook subscriptions this reset wiped
      // (v9.0.390, TD-620: before, they stayed missing until the next restart)
      await runSeed();
      await seedDefaultEngines();
      this.invalidateCaches();

      return { deletedRows, attachmentFiles: { total: attachmentPaths.length, ...files } };
    });

    if (!outcome.acquired) {
      throw new ConflictError(
        'راه‌اندازی داده‌های پایه (seed) هم‌اکنون در حال اجراست؛ پاک کردن داده‌ها انجام نشد. چند لحظه دیگر دوباره تلاش کنید.',
        'SEED_RUNNING'
      );
    }

    const report = outcome.result;
    logger.warn({
      message: 'Factory reset completed',
      user: actor.username,
      ip: actor.ip,
      attachmentFiles: report.attachmentFiles
    });
    return report;
  }

  /** همه حذف‌ها در یک تراکنش و به ترتیب کلیدهای خارجی؛ مسیر فایل پیوست‌های حذف‌شده برای حذف پس از commit برمی‌گردد */
  private static async wipeAllData(actor: FactoryResetActor): Promise<{ deletedRows: Record<string, number>; attachmentPaths: string[] }> {
    return orm.transaction(async (tx) => {
      const deletedRows: Record<string, number> = {};
      const wipe = async (name: string, table: PgTable): Promise<void> => {
        const result = await tx.delete(table);
        deletedRows[name] = Number(result.rowCount ?? 0);
      };

      // 1. Logs, Webhooks, Outbox, DLQ, Drafts & Idempotency
      await wipe('event_action_logs', eventActionLogs);
      await wipe('webhook_deliveries', webhookDeliveries);
      await wipe('webhook_subscriptions', webhookSubscriptions);
      await wipe('event_action_rules', eventActionRules);
      await wipe('dead_letter_events', deadLetterEvents);
      await wipe('outbox_events', outboxEvents);
      await wipe('woocommerce_order_logs', woocommerceOrderLogs);
      await wipe('idempotency_keys', idempotencyKeys);
      await wipe('form_drafts', formDrafts);
      await wipe('activity_logs', activityLogs);
      await wipe('notifications', notifications);

      // 1.2. Attachment registry (files on disk are removed only after commit) & data-repair reports (no foreign keys)
      const removedAttachments = await tx.delete(fileAttachments).returning({ storagePath: fileAttachments.storagePath });
      deletedRows.file_attachments = removedAttachments.length;
      await wipe('legacy_date_repairs', legacyDateRepairs);
      await wipe('workflow_task_reopen_log', workflowTaskReopenLog);

      // 3. Fiscal Periods, Treasury & Accounting (fiscal_periods.closing_voucher_id references journal_vouchers)
      await wipe('fiscal_periods', fiscalPeriods);
      await wipe('treasury_transactions', treasuryTransactions);
      await wipe('cheques', cheques);
      await wipe('item_opening_voucher_items', itemOpeningVoucherItems);
      await wipe('journal_voucher_items', journalVoucherItems);
      await wipe('journal_vouchers', journalVouchers);
      await wipe('accounting_settings', accountingSettings);
      await wipe('bank_accounts', bankAccounts);
      await wipe('accounts', accounts);

      // 4. Inventory Transactions & Documents (Must be deleted BEFORE productionProjects, items, customers and crmLeads:
      //    documents.project_id references production_projects without cascade)
      await wipe('project_reservation_releases', projectReservationReleases);
      await wipe('ref_fiscal_year_corrections', refFiscalYearCorrections);
      await wipe('document_items', documentItems);
      // v9.0.447 (TD-903): project_bom_allocations.source_transaction_id references transactions (migration 0092)
      await wipe('project_bom_allocations', projectBomAllocations);
      await wipe('transactions', transactions);
      await wipe('documents', documents);
      await wipe('document_ref_counters', documentRefCounters);
      await wipe('item_code_counters', itemCodeCounters);

      // 4.5. Purchase Requisitions (AFTER documents: documents.procurement_requisition_id references them, v9.0.347 / TD-691;
      //      BEFORE workflowInstances, productionProjects and users)
      await wipe('purchase_requisitions', purchaseRequisitions);

      // 4.6. Workflow Tasks, Delegations, Instances, History & Definitions
      await wipe('workflow_history_logs', workflowHistoryLogs);
      await wipe('workflow_tasks', workflowTasks);
      await wipe('workflow_pending_approvals', workflowPendingApprovals);
      await wipe('workflow_instances', workflowInstances);
      await wipe('workflow_delegations', workflowDelegations);
      await wipe('workflow_definition_versions', workflowDefinitionVersions);
      await wipe('workflow_transitions', workflowTransitions);
      await wipe('workflow_states', workflowStates);
      await wipe('workflow_definitions', workflowDefinitions);

      // 5. Project Dependencies & Allocations (Must be deleted BEFORE items)
      await wipe('piecework_logs', pieceworkLogs);
      await wipe('daily_work_logs', dailyWorkLogs);
      await wipe('project_product_stage_progress', projectProductStageProgress);
      await wipe('project_stages', projectStages);
      await wipe('production_projects', productionProjects);

      // 6. CRM & Customer Relations (Must be deleted BEFORE personnel and customers)
      await wipe('crm_activities', crmActivities);
      await wipe('crm_leads', crmLeads);

      // 7. HR, Piecework & Payroll Records (Must be deleted AFTER CRM and projects)
      await wipe('piecework_payrolls', pieceworkPayrolls);
      await wipe('piecework_personnel_rates', pieceworkPersonnelRates);
      await wipe('piecework_task_rate_history', pieceworkTaskRateHistory);
      await wipe('piecework_tasks', pieceworkTasks);
      await wipe('task_categories', taskCategories);
      await wipe('personnel', personnel);

      // 8. Materials, Transfers, Stock, Items & Customers (items_stocks_archive goes with items via ON DELETE CASCADE)
      await wipe('pending_materials', pendingMaterials);
      await wipe('transfers', transfers);
      await wipe('inventory_reconciliation_anomalies', inventoryReconciliationAnomalies);
      await wipe('item_warehouse_stocks', itemWarehouseStocks);
      await wipe('item_prices', itemPrices);
      await wipe('items', items);
      await wipe('customers', customers);

      // 9. Categories, Warehouses & Settings
      await wipe('categories', categories);
      await wipe('warehouses', warehouses);
      await wipe('app_settings', appSettings);

      // 10. Users (Wipe all user accounts to return system to initial setup state)
      await wipe('users', users);

      const attachmentPaths = Array.from(new Set(removedAttachments.map((row) => row.storagePath)));

      // ممیزی در همان تراکنش و پس از پاک شدن activity_logs: بدون ردیف ممیزی هیچ پاک‌سازی‌ای commit نمی‌شود.
      // کاربر اجراکننده هم حذف شده است، پس فقط نام کاربری و IP ثبت می‌شود (نه user_id).
      await logActivity({
        tx,
        strict: true,
        username: actor.username,
        ipAddress: actor.ip,
        action: 'PURGE',
        entity: FACTORY_RESET_AUDIT_ENTITY,
        description: `بازنشانی کامل سامانه (پاک کردن همه داده‌ها و کاربران، ${attachmentPaths.length} فایل پیوست برای حذف از دیسک) و راه‌اندازی دوباره داده‌های پایه`,
        details: { deletedRows, attachmentFiles: attachmentPaths.length },
      });

      return { deletedRows, attachmentPaths };
    });
  }

  /**
   * حذف فایل پیوست‌های ثبت‌شده‌ای که ردیفشان در تراکنش بازنشانی پاک شد. فقط مسیرهای ثبت‌شده در file_attachments و
   * فقط داخل ریشه انبار پیوست‌ها (AttachmentStorageService.absolutePath مسیر بیرون از ریشه را رد می‌کند).
   * خطای حذف یک فایل فقط ثبت می‌شود و بازنشانی را متوقف نمی‌کند.
   */
  private static async removeAttachmentFiles(storagePaths: string[]): Promise<AttachmentFileRemoval> {
    const result: AttachmentFileRemoval = { removed: 0, missing: 0, failed: 0 };
    for (const storagePath of storagePaths) {
      try {
        await fs.promises.unlink(AttachmentStorageService.absolutePath(storagePath));
        result.removed += 1;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
          result.missing += 1;
          continue;
        }
        result.failed += 1;
        logger.error({
          message: 'Factory reset: failed to remove attachment file after commit',
          storagePath,
          error: errorMessageOf(err)
        });
      }
    }
    return result;
  }

  /** کش‌های درون‌حافظه‌ای کاربران، نقش‌ها و تنظیمات به داده پاک‌شده اشاره نکنند */
  private static invalidateCaches(): void {
    invalidateUserAuthCache();
    invalidateRoleCache();
    invalidateSettingsCache();
    invalidateTimezoneCache();
  }
}
