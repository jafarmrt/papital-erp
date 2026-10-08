import type { Writable } from 'stream';
import { and, asc, getTableColumns, gt, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { orm } from '../../db/drizzle.js';
import {
  users, personnel, customers, items, categories, warehouses, itemPrices, itemWarehouseStocks,
  productionProjects, projectStages, transfers, crmLeads, crmActivities, dailyWorkLogs,
  documents, documentItems, transactions, activityLogs, appSettings, roles,
  accounts, journalVouchers, journalVoucherItems, bankAccounts, cheques, treasuryTransactions, accountingSettings,
  pieceworkLogs, pieceworkPayrolls, purchaseRequisitions,
} from '../../db/schema.js';
import { BUILD_INFO } from '../../lib/version.js';
import { businessNowIsoDateTime, businessTodayIsoDate, getDisplayTimezone, systemNowUtcIso } from '../../lib/businessClock.js';
import { zonedDayRangeUtc } from '../../lib/serverTimestamp.js';
import { ZipStreamWriter } from '../../lib/zipStream.js';
import { SENSITIVE_SETTING_PATTERN } from '../settings/systemSettings.service.js';

/**
 * v7.0.29 (TD-188 / audit P1-6) — Safe business-data export (NOT a restorable backup)
 * =====================================================================================
 * Credentials are never exported, and the payload states that real backups are taken with
 * `scripts/backup.sh` (pg_dump) and restored with `scripts/restore.sh`.
 *
 * v9.0.356 (TD-592، تصمیم ت۷ الف): خروجی دیگر یک JSON در حافظه نیست. هر جدول در یک فایل NDJSON درون zip نوشته
 * می‌شود، دسته‌به‌دسته با cursor روی کلید اصلی (`DATA_EXPORT_BATCH_SIZE` ردیف در هر پرس‌وجو) و با رعایت فشار
 * برگشتی پاسخ، پس حافظه پردازه به اندازه یک دسته است. `activity_logs` فقط با گزینه جدا و یک بازه تاریخ می‌آید.
 * `manifest.json` (آخرین فایل) قالب، نسخه، شمار ردیف هر جدول و فیلدهای کنارگذاشته را دارد.
 */

export const DATA_EXPORT_FORMAT = 'papital-erp/data-export@3';
export const DATA_EXPORT_BATCH_SIZE = 1000;

type Row = Record<string, unknown>;

interface ExportTableSpec {
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

export interface DataExportOptions {
  /** include `activity_logs` of these business days (ISO dates, both inclusive) */
  activityLogs?: { from: string; to: string };
  batchSize?: number;
}

export interface DataExportManifest {
  format: string;
  exportedAt: string;
  businessDate: string;
  version: string;
  buildInfo: typeof BUILD_INFO;
  notice: string;
  excludedFields: string[];
  activityLogs: { included: false } | { included: true; from: string; to: string };
  tables: Array<{ name: string; file: string; rows: number }>;
}

const EXCLUDED_FIELDS = [
  'users.password', 'users.failedLoginCount', 'users.lockedUntil', 'users.lastFailedLoginAt', 'users.tokenVersion',
  'users.mustResetPassword', 'personnel.nobitexPassword', 'app_settings (secret keys)',
];

const NOTICE = 'این فایل خروجی داده‌های کسب‌وکاری برای گزارش و بایگانی است و نسخه پشتیبان قابل بازگردانی نیست. '
  + 'هر جدول در یک فایل NDJSON (هر سطر یک ردیف JSON) است و جدول‌ها پشت سر هم و دسته‌به‌دسته خوانده می‌شوند، پس خروجی '
  + 'یک لحظه یگانه از پایگاه‌داده نیست. رمزهای عبور و کلیدهای محرمانه در آن وجود ندارد. پشتیبان واقعی با '
  + 'scripts/backup.sh گرفته و با scripts/restore.sh بازگردانی می‌شود.';

function withoutColumns(table: PgTable, omit: string[]): Record<string, PgColumn> {
  const columns: Record<string, PgColumn> = { ...getTableColumns(table) };
  for (const name of omit) delete columns[name];
  return columns;
}

/** Tables of the export, in file order (activity logs are added only on request) */
function exportTableSpecs(): ExportTableSpec[] {
  const byId = (name: string, table: PgTable): ExportTableSpec => ({ name, table, key: ['id'] });
  return [
    // Users WITHOUT password hash, lockout state or token version
    {
      name: 'users', table: users, key: ['id'],
      columns: {
        id: users.id, username: users.username, fullName: users.fullName, role: users.role,
        avatarUrl: users.avatarUrl, isDeleted: users.isDeleted, updatedAt: users.updatedAt,
      },
    },
    byId('roles', roles),
    // Personnel WITHOUT the third-party exchange password (TD-189)
    { name: 'personnel', table: personnel, key: ['id'], columns: withoutColumns(personnel, ['nobitexPassword']) },
    byId('customers', customers),
    byId('categories', categories),
    byId('warehouses', warehouses),
    byId('items', items),
    byId('item_prices', itemPrices),
    byId('item_warehouse_stocks', itemWarehouseStocks),
    byId('documents', documents),
    byId('document_items', documentItems),
    byId('transactions', transactions),
    byId('transfers', transfers),
    byId('production_projects', productionProjects),
    byId('project_stages', projectStages),
    byId('purchase_requisitions', purchaseRequisitions),
    byId('crm_leads', crmLeads),
    byId('crm_activities', crmActivities),
    byId('daily_work_logs', dailyWorkLogs),
    byId('accounts', accounts),
    byId('journal_vouchers', journalVouchers),
    byId('journal_voucher_items', journalVoucherItems),
    byId('bank_accounts', bankAccounts),
    byId('cheques', cheques),
    byId('treasury_transactions', treasuryTransactions),
    byId('accounting_settings', accountingSettings),
    byId('piecework_logs', pieceworkLogs),
    byId('piecework_payrolls', pieceworkPayrolls),
    // Settings WITHOUT secrets (WooCommerce keys, webhook secrets, tokens)
    { name: 'app_settings', table: appSettings, key: ['key'], keep: row => !SENSITIVE_SETTING_PATTERN.test(String(row.key)) },
  ];
}

/** `(key...) > (last...)`: the rows after the previous batch */
function keyAfter(columns: PgColumn[], values: unknown[]): SQL {
  if (columns.length === 1) return gt(columns[0], values[0]);
  return sql`(${sql.join(columns, sql`, `)}) > (${sql.join(values.map(v => sql`${v}`), sql`, `)})`;
}

/** NDJSON text of a table, one batch per chunk, read with a key cursor */
async function* tableChunks(spec: ExportTableSpec, batchSize: number, counter: { rows: number }): AsyncGenerator<string> {
  const allColumns = getTableColumns(spec.table) as Record<string, PgColumn>;
  const keyColumns = spec.key.map(k => allColumns[k]);
  const projection = spec.columns ?? allColumns;
  let after: unknown[] | null = null;
  for (;;) {
    const conditions = [spec.where, after ? keyAfter(keyColumns, after) : undefined].filter((c): c is SQL => !!c);
    const rows = await orm.select(projection).from(spec.table)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(...keyColumns.map(c => asc(c)))
      .limit(batchSize) as Row[];
    if (rows.length === 0) return;
    const kept = spec.keep ? rows.filter(spec.keep) : rows;
    counter.rows += kept.length;
    if (kept.length) yield `${kept.map(r => JSON.stringify(r)).join('\n')}\n`;
    if (rows.length < batchSize) return;
    const last = rows[rows.length - 1];
    after = spec.key.map(k => last[k]);
  }
}

export class DataExportService {
  /** TD-245: نام فایل خروجی با تاریخ امروز کسب‌وکار (منطقه زمانی توافقی، businessClock) */
  static async buildExportFileName(): Promise<string> {
    return `erp-data-export-${await businessTodayIsoDate()}.zip`;
  }

  /** Tables the export writes with these options (database names) */
  static tableNames(options: DataExportOptions = {}): string[] {
    return [...exportTableSpecs().map(s => s.name), ...(options.activityLogs ? ['activity_logs'] : [])];
  }

  /**
   * Writes the export as a zip to `out` and ends it. Tables are read one after another, `batchSize` rows per
   * query, and every write waits for the output to drain, so memory stays at about one batch.
   */
  static async writeExport(out: Writable, options: DataExportOptions = {}): Promise<DataExportManifest> {
    const batchSize = options.batchSize ?? DATA_EXPORT_BATCH_SIZE;
    const specs = exportTableSpecs();
    if (options.activityLogs) {
      const range = zonedDayRangeUtc(options.activityLogs.from, options.activityLogs.to, await getDisplayTimezone());
      specs.push({
        name: 'activity_logs', table: activityLogs, key: ['id'],
        where: and(sql`${activityLogs.timestamp} >= ${range.from}`, sql`${activityLogs.timestamp} < ${range.before}`),
      });
    }

    const zip = new ZipStreamWriter(out, await businessNowIsoDateTime());
    const tables: DataExportManifest['tables'] = [];
    for (const spec of specs) {
      const counter = { rows: 0 };
      const file = `${spec.name}.ndjson`;
      await zip.addEntry(file, tableChunks(spec, batchSize, counter));
      tables.push({ name: spec.name, file, rows: counter.rows });
    }

    const manifest: DataExportManifest = {
      format: DATA_EXPORT_FORMAT,
      exportedAt: systemNowUtcIso(),
      businessDate: await businessTodayIsoDate(),
      version: BUILD_INFO.version,
      buildInfo: BUILD_INFO,
      notice: NOTICE,
      excludedFields: EXCLUDED_FIELDS,
      activityLogs: options.activityLogs ? { included: true, ...options.activityLogs } : { included: false },
      tables,
    };
    await zip.addEntry('manifest.json', [JSON.stringify(manifest, null, 2)]);
    await zip.finish();
    return manifest;
  }
}
