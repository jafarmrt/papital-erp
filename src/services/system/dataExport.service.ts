import { orm } from '../../db/drizzle.js';
import {
  users, personnel, customers, items, categories, warehouses, itemPrices, itemWarehouseStocks,
  productionProjects, projectStages, transfers, crmLeads, crmActivities, dailyWorkLogs,
  documents, documentItems, transactions, activityLogs, appSettings, roles,
  accounts, journalVouchers, journalVoucherItems, bankAccounts, cheques, treasuryTransactions, accountingSettings,
  pieceworkLogs, pieceworkPayrolls, purchaseRequisitions,
} from '../../db/schema.js';
import { BUILD_INFO } from '../../lib/version.js';
import { businessTodayIsoDate, systemNowUtcIso } from '../../lib/businessClock.js';
import { SENSITIVE_SETTING_PATTERN } from '../settings/systemSettings.service.js';

/**
 * v7.0.29 (TD-188 / audit P1-6) — Safe business-data export (NOT a restorable backup)
 * =====================================================================================
 * The previous "backup" endpoint dumped every user's bcrypt hash, the staff `nobitex_password`
 * column and the WooCommerce / webhook secrets in plain JSON, yet omitted the whole accounting
 * ledger, payroll and normalized stock tables, and ran ~18 unbounded SELECT * queries in
 * parallel (enough to exhaust the 20-connection pool). It also had no restore path.
 *
 * Now: credentials are never exported, accounting/payroll/stock tables are included, queries run
 * sequentially, and the payload states explicitly that real backups are taken with
 * `scripts/backup.sh` (pg_dump) and restored with `scripts/restore.sh`.
 */

export const DATA_EXPORT_FORMAT = 'papital-erp/data-export@2';

export class DataExportService {
  /** TD-245: نام فایل خروجی با تاریخ امروز کسب‌وکار (منطقه زمانی توافقی، businessClock) */
  static async buildExportFileName(): Promise<string> {
    return `erp-data-export-${await businessTodayIsoDate()}.json`;
  }

  static async buildExport(): Promise<Record<string, unknown>> {
    // Users WITHOUT password hash, lockout state or token version
    const safeUsers = await orm.select({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      role: users.role,
      avatarUrl: users.avatarUrl,
      isDeleted: users.isDeleted,
      updatedAt: users.updatedAt,
    }).from(users);

    // Personnel WITHOUT the third-party exchange password (TD-189)
    const personnelRows = await orm.select().from(personnel);
    const safePersonnel = personnelRows.map(({ nobitexPassword: _omitted, ...rest }) => rest);

    // Settings WITHOUT secrets (WooCommerce keys, webhook secrets, tokens)
    const settingsRows = await orm.select().from(appSettings);
    const safeSettings = settingsRows.filter(row => !SENSITIVE_SETTING_PATTERN.test(row.key));

    // Sequential reads keep the connection pool available for live traffic
    const data: Record<string, unknown> = {
      users: safeUsers,
      roles: await orm.select().from(roles),
      personnel: safePersonnel,
      customers: await orm.select().from(customers),
      categories: await orm.select().from(categories),
      warehouses: await orm.select().from(warehouses),
      items: await orm.select().from(items),
      itemPrices: await orm.select().from(itemPrices),
      itemWarehouseStocks: await orm.select().from(itemWarehouseStocks),
      documents: await orm.select().from(documents),
      documentItems: await orm.select().from(documentItems),
      transactions: await orm.select().from(transactions),
      transfers: await orm.select().from(transfers),
      productionProjects: await orm.select().from(productionProjects),
      projectStages: await orm.select().from(projectStages),
      purchaseRequisitions: await orm.select().from(purchaseRequisitions),
      crmLeads: await orm.select().from(crmLeads),
      crmActivities: await orm.select().from(crmActivities),
      dailyWorkLogs: await orm.select().from(dailyWorkLogs),
      accounts: await orm.select().from(accounts),
      journalVouchers: await orm.select().from(journalVouchers),
      journalVoucherItems: await orm.select().from(journalVoucherItems),
      bankAccounts: await orm.select().from(bankAccounts),
      cheques: await orm.select().from(cheques),
      treasuryTransactions: await orm.select().from(treasuryTransactions),
      accountingSettings: await orm.select().from(accountingSettings),
      pieceworkLogs: await orm.select().from(pieceworkLogs),
      pieceworkPayrolls: await orm.select().from(pieceworkPayrolls),
      activityLogs: await orm.select().from(activityLogs),
      appSettings: safeSettings,
    };

    return {
      format: DATA_EXPORT_FORMAT,
      exportedAt: systemNowUtcIso(),
      version: BUILD_INFO.version,
      buildInfo: BUILD_INFO,
      notice: 'این فایل خروجی داده‌های کسب‌وکاری برای گزارش و بایگانی است و نسخه پشتیبان قابل بازگردانی نیست. رمزهای عبور و کلیدهای محرمانه در آن وجود ندارد. پشتیبان واقعی با scripts/backup.sh گرفته و با scripts/restore.sh بازگردانی می‌شود.',
      excludedFields: ['users.password', 'users.failedLoginCount', 'users.lockedUntil', 'users.tokenVersion', 'personnel.nobitexPassword', 'appSettings (secret keys)'],
      data,
    };
  }
}
