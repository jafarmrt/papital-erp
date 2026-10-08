import type { Writable } from 'stream';
import { and, asc, getTableColumns, gt, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { orm } from '../../db/drizzle.js';
import { activityLogs } from '../../db/schema.js';
import { DATA_EXPORT_ACTIVITY_LOG_TABLE, DATA_EXPORT_EXCLUDED_TABLES, DATA_EXPORT_TABLES } from '../../lib/system/dataExportTables.js';
import { DATA_EXPORT_TABLE_SOURCES, type ExportTableSpec, type Row } from './dataExportSources.js';
import { BUILD_INFO } from '../../lib/version.js';
import { businessNowIsoDateTime, businessTodayIsoDate, getDisplayTimezone, systemNowUtcIso } from '../../lib/businessClock.js';
import { zonedDayRangeUtc } from '../../lib/serverTimestamp.js';
import { ZipStreamWriter } from '../../lib/zipStream.js';

/**
 * v7.0.29 (TD-188 / audit P1-6) — Safe business-data export (NOT a restorable backup)
 * =====================================================================================
 * Credentials are never exported, and the payload states that real backups are taken with
 * `scripts/backup.sh` (pg_dump) and restored with `scripts/restore.sh`.
 *
 * v9.0.386 (TD-592، تصمیم ت۷ الف): خروجی دیگر یک JSON در حافظه نیست. هر جدول در یک فایل NDJSON درون zip نوشته
 * می‌شود، دسته‌به‌دسته با cursor روی کلید اصلی (`DATA_EXPORT_BATCH_SIZE` ردیف در هر پرس‌وجو) و با رعایت فشار
 * برگشتی پاسخ، پس حافظه پردازه به اندازه یک دسته است. `activity_logs` فقط با گزینه جدا و یک بازه تاریخ می‌آید.
 * `manifest.json` (آخرین فایل) قالب، نسخه، شمار ردیف هر جدول و فیلدهای کنارگذاشته را دارد.
 *
 * v9.0.387 (TD-624): جدول‌ها از فهرست یگانه `DATA_EXPORT_TABLES` می‌آیند (پروژه و تخصیص، کارمزدی، دوره مالی، گردش کار،
 * قاعده رویداد و فراداده پیوست افزوده شدند) و جدول‌های کنارگذاشته با دلیل در `manifest.json` نوشته می‌شوند.
 */

export const DATA_EXPORT_FORMAT = 'papital-erp/data-export@3';
export const DATA_EXPORT_BATCH_SIZE = 1000;

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
  excludedTables: Record<string, string>;
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

/** Tables of the export, in file order (activity logs are added only on request) */
function exportTableSpecs(): ExportTableSpec[] {
  return DATA_EXPORT_TABLES.map(({ table: name }) => {
    const source = DATA_EXPORT_TABLE_SOURCES[name];
    if (!source) throw new Error(`Data export: no table source for ${name}`);
    return { name, ...source };
  });
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
    return [...DATA_EXPORT_TABLES.map(t => t.table), ...(options.activityLogs ? [DATA_EXPORT_ACTIVITY_LOG_TABLE] : [])];
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
        name: DATA_EXPORT_ACTIVITY_LOG_TABLE, table: activityLogs, key: ['id'],
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
      excludedTables: { ...DATA_EXPORT_EXCLUDED_TABLES },
      activityLogs: options.activityLogs ? { included: true, ...options.activityLogs } : { included: false },
      tables,
    };
    await zip.addEntry('manifest.json', [JSON.stringify(manifest, null, 2)]);
    await zip.finish();
    return manifest;
  }
}
