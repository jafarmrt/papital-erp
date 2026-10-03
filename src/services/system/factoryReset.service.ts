import { orm } from '../../db/drizzle.js';
import {
  transactions, documentItems, documents, items,
  warehouses, itemPrices, customers, activityLogs, productionProjects, categories,
  projectStages, projectProductStageProgress, dailyWorkLogs, transfers, notifications, crmLeads, crmActivities,
  users, personnel, taskCategories, pieceworkTasks, pieceworkPersonnelRates, pieceworkTaskRateHistory,
  pieceworkLogs, pieceworkPayrolls, pendingMaterials, accounts, journalVouchers,
  journalVoucherItems, bankAccounts, cheques, treasuryTransactions, accountingSettings,
  outboxEvents, deadLetterEvents, workflowInstances, workflowTasks,
  workflowHistoryLogs, workflowPendingApprovals, workflowDelegations,
  workflowDefinitionVersions, workflowTransitions, workflowStates, workflowDefinitions,
  eventActionLogs, eventActionRules, webhookDeliveries, webhookSubscriptions,
  projectBomAllocations, formDrafts, idempotencyKeys, woocommerceOrderLogs,
  documentRefCounters, itemCodeCounters, purchaseRequisitions, appSettings
} from '../../db/schema.js';
import { logger } from '../../middleware/logger.js';
import { ForbiddenError } from '../../errors/customErrors.js';
import { runSeed } from '../../db/seed.js';

/**
 * بازنشانی کامل سامانه به وضعیت راه‌اندازی اولیه (POST /admin/clear-data).
 * همه داده‌های عملیاتی و حساب‌های کاربری در یک تراکنش حذف و سپس پیش‌فرض‌های استاندارد دوباره seed می‌شوند.
 * P0-01 (ARCH-01): در پروداکشن یا بدون ALLOW_DANGEROUS_DATA_PURGE=true همیشه مسدود است؛
 * این نگهبان پیش از هر حذف در خود سرویس اجرا می‌شود.
 */

export interface FactoryResetActor {
  username?: string;
  ip: string;
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
        'عملیات حذف کل داده‌های سیستم در محیط پروداکشن یا بدون فعال‌سازی صریح متغیر ALLOW_DANGEROUS_DATA_PURGE اکیداً مسدود است (مطابق قانون بنیادین RULE 09).'
      );
    }
  }

  /**
   * Wipe & reset all system operational data and users to trigger the initial setup scenario,
   * then re-seed system standard defaults. The guard runs again here so no caller can skip it;
   * the caller logs and rethrows failures.
   */
  static async wipeAndReseed(actor: FactoryResetActor): Promise<void> {
    this.assertAllowed(actor);

    logger.warn({
      message: 'Authorized /admin/clear-data execution started in non-production environment',
      user: actor.username,
      ip: actor.ip
    });

    await orm.transaction(async (tx) => {
      // 1. Logs, Webhooks, Outbox, DLQ, Drafts & Idempotency
      await tx.delete(eventActionLogs);
      await tx.delete(webhookDeliveries);
      await tx.delete(webhookSubscriptions);
      await tx.delete(eventActionRules);
      await tx.delete(deadLetterEvents);
      await tx.delete(outboxEvents);
      await tx.delete(woocommerceOrderLogs);
      await tx.delete(idempotencyKeys);
      await tx.delete(formDrafts);
      await tx.delete(activityLogs);
      await tx.delete(notifications);

      // 1.5. Purchase Requisitions (Must be deleted BEFORE workflowInstances, productionProjects, and users)
      await tx.delete(purchaseRequisitions);

      // 2. Workflow Tasks, Delegations, Instances, History & Definitions
      await tx.delete(workflowHistoryLogs);
      await tx.delete(workflowTasks);
      await tx.delete(workflowPendingApprovals);
      await tx.delete(workflowInstances);
      await tx.delete(workflowDelegations);
      await tx.delete(workflowDefinitionVersions);
      await tx.delete(workflowTransitions);
      await tx.delete(workflowStates);
      await tx.delete(workflowDefinitions);

      // 3. Project Dependencies & Allocations (Must be deleted BEFORE transactions, projectStages and productionProjects)
      await tx.delete(pieceworkLogs);
      await tx.delete(dailyWorkLogs);
      await tx.delete(projectProductStageProgress);
      await tx.delete(projectBomAllocations);
      await tx.delete(projectStages);
      await tx.delete(productionProjects);

      // 4. Treasury & Accounting Transactions (Must be deleted BEFORE documents and accounts)
      await tx.delete(treasuryTransactions);
      await tx.delete(cheques);
      await tx.delete(journalVoucherItems);
      await tx.delete(journalVouchers);
      await tx.delete(accountingSettings);
      await tx.delete(bankAccounts);
      await tx.delete(accounts);

      // 5. Inventory Transactions & Documents (Must be deleted BEFORE items, customers and crmLeads)
      await tx.delete(documentItems);
      await tx.delete(transactions);
      await tx.delete(documents);
      await tx.delete(documentRefCounters);
      await tx.delete(itemCodeCounters);

      // 6. CRM & Customer Relations (Must be deleted BEFORE personnel and customers)
      await tx.delete(crmActivities);
      await tx.delete(crmLeads);

      // 7. HR, Piecework & Payroll Records (Must be deleted AFTER CRM and projects)
      await tx.delete(pieceworkPayrolls);
      await tx.delete(pieceworkPersonnelRates);
      await tx.delete(pieceworkTaskRateHistory);
      await tx.delete(pieceworkTasks);
      await tx.delete(taskCategories);
      await tx.delete(personnel);

      // 9. Materials, Transfers, Items & Customers
      await tx.delete(pendingMaterials);
      await tx.delete(transfers);
      await tx.delete(itemPrices);
      await tx.delete(items);
      await tx.delete(customers);

      // 10. Categories, Warehouses & Settings
      await tx.delete(categories);
      await tx.delete(warehouses);
      await tx.delete(appSettings);

      // 11. Users (Wipe all user accounts to return system to initial setup state)
      await tx.delete(users);
    });

    // Re-seed system standard defaults (22 categories, default warehouse, standard chart of accounts, task categories, piecework tasks, system roles)
    await runSeed();
  }
}
