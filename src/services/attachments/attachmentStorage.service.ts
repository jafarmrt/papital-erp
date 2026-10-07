import crypto from 'crypto';
import { MAX_ATTACHMENT_FILE_MB } from '../../lib/attachments/attachmentBodyLimit.js';
import fs from 'fs';
import path from 'path';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import {
  fileAttachments, documents, journalVouchers, cheques, treasuryTransactions, productionProjects, pieceworkPayrolls
} from '../../db/schema.js';
import { ValidationError, ConflictError } from '../../errors/customErrors.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { withAdvisoryLock, ADVISORY_LOCK_KEYS } from '../../lib/advisoryLock.js';
import { ATTACHMENT_ENTITY_TYPES, type AttachmentEntityType } from '../../lib/recordReadPermissions.js';
import { logActivity } from '../../lib/auditLogger.js';
import { logger } from '../../middleware/logger.js';
import { getRequestContext } from '../../lib/requestContext.js';
import type { FinancialAttachment } from '../../types';

/**
 * v7.0.56 (audit P2-9، تصمیم مالک محصول): بدنه فایل پیوست‌ها روی دیسک و فقط فراداده در ستون‌های JSONB.
 *
 * - مسیر ذخیره: public/uploads/.attachments/<نوع رکورد>/<uuid>.<پسوند> — داخل volume و بایگانی پشتیبان uploads؛
 *   مسیر /uploads آن را سرو نمی‌کند و فایل فقط از GET /api/attachments/:id با بررسی مجوز رکورد مالک دریافت می‌شود.
 * - مسیرهای ذخیره رکوردها (سند انبار/فاکتور، سند حسابداری، چک، تراکنش خزانه، پروژه) پیش از نوشتن ستون
 *   attachments، هر data URL را به فایل تبدیل و به‌جایش آدرس /api/attachments/<id> می‌نویسند.
 * - پیوست‌های قدیمی داخل پایگاه‌داده با `npm run attachments:migrate` (پیش‌فرض آزمایشی) منتقل می‌شوند.
 */

export const ATTACHMENT_URL_PREFIX = '/api/attachments/';
/** سقف حجم هر فایل پس از رمزگشایی؛ همان سقف کادر بارگذاری (v9.0.255، TD-641: بدنه مسیرهای پیوست‌دار ۱۴ مگابایت) */
export const MAX_ATTACHMENT_BYTES = MAX_ATTACHMENT_FILE_MB * 1024 * 1024;
/** نوع‌هایی که درون صفحه نمایش داده می‌شوند؛ بقیه (از جمله SVG و HTML) فقط دانلود می‌شوند */
export const INLINE_SAFE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME_PATTERN = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/;
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf',
  'text/plain': 'txt', 'text/csv': 'csv', 'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

// همه این جدول‌ها ستون‌های id (serial) و attachments (jsonb) هم‌نوع دارند؛ نوع یکی برای تایپ عمومی کافی است
const ENTITY_TABLES = {
  document: documents,
  journal_voucher: journalVouchers,
  cheque: cheques,
  treasury_transaction: treasuryTransactions,
  production_project: productionProjects,
  piecework_payroll: pieceworkPayrolls,
} as unknown as Record<AttachmentEntityType, typeof documents>;

export interface InlineAttachmentMigrationReport {
  dryRun: boolean;
  acquired: boolean;
  records: number;
  files: number;
  bytes: number;
  byEntity: Record<string, { records: number; files: number; bytes: number }>;
  failures: Array<{ entityType: AttachmentEntityType; entityId: number; error: string }>;
}

export function getAttachmentsRoot(): string {
  return path.resolve(process.env.ATTACHMENTS_DIR || path.join(process.cwd(), 'public', 'uploads', '.attachments'));
}

function resolveStoragePath(relativePath: string): string {
  const root = getAttachmentsRoot();
  const absolute = path.resolve(root, relativePath);
  if (!absolute.startsWith(root + path.sep)) {
    throw new ValidationError('مسیر فایل پیوست نامعتبر است');
  }
  return absolute;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function decodeDataUrl(dataUrl: string): { mime: string; buffer: Buffer } {
  // پیش از رمزگشایی: Base64 حدود ۴/۳ حجم واقعی است
  if (dataUrl.length > Math.ceil(MAX_ATTACHMENT_BYTES * 1.4) + 256) {
    throw new ValidationError('حجم پیوست بیش از ۱۰ مگابایت است');
  }
  const match = /^data:([^;,]*)((?:;[^;,]*)*),([\s\S]*)$/.exec(dataUrl);
  if (!match) throw new ValidationError('داده پیوست نامعتبر است');
  const declared = (match[1] || '').trim().toLowerCase();
  const isBase64 = /;base64$/i.test(match[2] || '');
  let buffer: Buffer;
  try {
    buffer = isBase64 ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]), 'utf8');
  } catch {
    throw new ValidationError('داده پیوست نامعتبر است');
  }
  if (buffer.length > MAX_ATTACHMENT_BYTES) throw new ValidationError('حجم پیوست بیش از ۱۰ مگابایت است');
  return { mime: MIME_PATTERN.test(declared) ? declared : 'application/octet-stream', buffer };
}

function fileExtension(mime: string, name: string): string {
  if (EXTENSION_BY_MIME[mime]) return EXTENSION_BY_MIME[mime];
  const fromName = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1];
  return fromName ? fromName.toLowerCase() : 'bin';
}

export class AttachmentStorageService {
  static isAttachmentEntityType(value: string): value is AttachmentEntityType {
    return (ATTACHMENT_ENTITY_TYPES as string[]).includes(value);
  }

  static absolutePath(storagePath: string): string {
    return resolveStoragePath(storagePath);
  }

  static async findActive(id: string, executor: DbExecutor = orm) {
    if (!UUID_PATTERN.test(id)) return null;
    const [row] = await executor.select().from(fileAttachments)
      .where(and(eq(fileAttachments.id, id), eq(fileAttachments.isDeleted, 0)));
    return row ?? null;
  }

  private static async storeFile(
    executor: DbExecutor, entityType: AttachmentEntityType, entityId: number, dataUrl: string, name: string, actor: string
  ): Promise<{ id: string; mime: string; size: number }> {
    const { mime, buffer } = decodeDataUrl(dataUrl);
    const id = crypto.randomUUID();
    const storagePath = `${entityType}/${id}.${fileExtension(mime, name)}`;
    const absolute = resolveStoragePath(storagePath);
    await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
    // اگر تراکنش بعداً برگردد، فایل بدون ردیف ثبت روی دیسک می‌ماند و از هیچ مسیری قابل دریافت نیست
    await fs.promises.writeFile(absolute, buffer, { flag: 'wx' });
    await executor.insert(fileAttachments).values({
      id,
      entityType,
      entityId,
      storagePath,
      originalName: name.slice(0, 255),
      mimeType: mime,
      sizeBytes: buffer.length,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      createdBy: actor.slice(0, 120),
    });
    return { id, mime, size: buffer.length };
  }

  /**
   * فهرست پیوست‌های ارسالی برای یک رکورد را آماده ذخیره می‌کند: هر data URL به فایل تبدیل و ثبت می‌شود و
   * فراداده با آدرس /api/attachments/<id> جایش می‌نشیند؛ پیوست‌های ذخیره‌شده قبلی و پیوند http(s) دست نمی‌خورند.
   * فایل‌های این رکورد که دیگر در فهرست نیستند جداشده علامت می‌خورند (فایل روی دیسک می‌ماند).
   * خروجی را فراخواننده در ستون attachments همان رکورد می‌نویسد.
   */
  static async normalizeForRecord(
    executor: DbExecutor, entityType: AttachmentEntityType, entityId: number, input: unknown, actor = '',
    /** false برای انتقال پیوست‌های قدیمی: زمان و کاربر بارگذاری از روی اجراکننده انتقال ساخته نشود */
    options: { stampUploader?: boolean } = {}
  ): Promise<FinancialAttachment[]> {
    const stampUploader = options.stampUploader !== false;
    const list = Array.isArray(input) ? input : [];
    actor = actor || getRequestContext()?.username || '';
    const result: FinancialAttachment[] = [];
    const keptIds: string[] = [];

    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue;
      const { dataUrl: legacyDataUrl, ...item } = raw as Record<string, unknown>;
      const url = asText(item.url);
      const name = asText(item.name) || asText(item.fileName) || 'attachment';
      const inlineSource = url.startsWith('data:') ? url : (asText(legacyDataUrl).startsWith('data:') ? asText(legacyDataUrl) : '');

      if (inlineSource) {
        const stored = await this.storeFile(executor, entityType, entityId, inlineSource, name, actor);
        keptIds.push(stored.id);
        result.push({
          id: stored.id,
          name,
          ...(asText(item.title) ? { title: asText(item.title) } : {}),
          url: `${ATTACHMENT_URL_PREFIX}${stored.id}`,
          size: stored.size,
          type: stored.mime,
          ...(asText(item.uploadedAt) || stampUploader ? { uploadedAt: asText(item.uploadedAt) || systemNowUtcIso() } : {}),
          ...(asText(item.uploadedBy) || (stampUploader && actor) ? { uploadedBy: asText(item.uploadedBy) || actor } : {}),
        });
        continue;
      }

      let storedId = '';
      if (url.startsWith(ATTACHMENT_URL_PREFIX)) {
        storedId = url.slice(ATTACHMENT_URL_PREFIX.length);
        if (!UUID_PATTERN.test(storedId)) throw new ValidationError(`آدرس پیوست «${name}» نامعتبر است`);
        keptIds.push(storedId);
      } else if (url && !/^https?:\/\//i.test(url) && !url.startsWith('/uploads/')) {
        // مثلاً javascript: که در پیوند دانلود اجرا می‌شود
        throw new ValidationError(`آدرس پیوست «${name}» نامعتبر است`);
      }
      result.push({ ...item, id: asText(item.id) || storedId || crypto.randomUUID(), name, url } as FinancialAttachment);
    }

    await executor.update(fileAttachments).set({ isDeleted: 1 }).where(and(
      eq(fileAttachments.entityType, entityType),
      eq(fileAttachments.entityId, entityId),
      eq(fileAttachments.isDeleted, 0),
      ...(keptIds.length > 0 ? [notInArray(fileAttachments.id, keptIds)] : [])
    ));

    return result;
  }

  /** برای مسیرهای ایجاد: پس از درج رکورد، پیوست‌ها را ذخیره و ستون attachments را به‌روز می‌کند */
  static async attachToNewRecord(
    executor: DbExecutor, entityType: AttachmentEntityType, entityId: number, input: unknown, actor = ''
  ): Promise<FinancialAttachment[]> {
    if (!Array.isArray(input) || input.length === 0) return [];
    const stored = await this.normalizeForRecord(executor, entityType, entityId, input, actor);
    const table = ENTITY_TABLES[entityType];
    await executor.update(table).set({ attachments: stored }).where(eq(table.id, entityId));
    return stored;
  }

  /**
   * انتقال پیوست‌های قدیمی (data URL داخل JSONB) به دیسک — فقط با اقدام دستی (`npm run attachments:migrate`
   * یا مسیر مدیر)، پیش‌فرض آزمایشی. هر رکورد در تراکنش جدا و با قفل سطری؛ ستون version رکوردها تغییر نمی‌کند
   * چون محتوای پیوست عوض نمی‌شود. کل اجرا با قفل مشورتی 91004 (یک اجرا در هر لحظه).
   */
  static async migrateInlineAttachments(options: {
    apply: boolean;
    actor: string;
    /** محدود به رکوردهای مشخص (آزمون‌ها و اجرای دوباره هدفمند) */
    scope?: { entityType: AttachmentEntityType; ids: number[] };
  }): Promise<InlineAttachmentMigrationReport> {
    const report: InlineAttachmentMigrationReport = {
      dryRun: !options.apply, acquired: true, records: 0, files: 0, bytes: 0, byEntity: {}, failures: [],
    };

    const outcome = await withAdvisoryLock(ADVISORY_LOCK_KEYS.INLINE_ATTACHMENTS_MIGRATION, async () => {
      for (const entityType of ATTACHMENT_ENTITY_TYPES) {
        if (options.scope && options.scope.entityType !== entityType) continue;
        const table = ENTITY_TABLES[entityType];
        const candidates = await orm.select({ id: table.id }).from(table)
          .where(and(
            sql`${table.attachments}::text LIKE ${'%"data:%'}`,
            ...(options.scope ? [inArray(table.id, options.scope.ids.length > 0 ? options.scope.ids : [-1])] : [])
          ))
          .orderBy(table.id);
        const bucket = (report.byEntity[entityType] = { records: 0, files: 0, bytes: 0 });

        for (const { id } of candidates) {
          try {
            const counted = await orm.transaction(async (tx) => {
              const [row] = await tx.select({ attachments: table.attachments }).from(table)
                .where(eq(table.id, id)).for('update');
              const items = Array.isArray(row?.attachments) ? row.attachments : [];
              const inline = items.filter(a => a && typeof a === 'object'
                && (asText(a.url).startsWith('data:') || asText(a.dataUrl).startsWith('data:')));
              if (inline.length === 0) return { files: 0, bytes: 0 };
              let bytes = 0;
              for (const a of inline) {
                bytes += decodeDataUrl(asText(a.url).startsWith('data:') ? asText(a.url) : asText(a.dataUrl)).buffer.length;
              }
              if (options.apply) {
                const stored = await this.normalizeForRecord(tx, entityType, id, items, options.actor, { stampUploader: false });
                await tx.update(table).set({ attachments: stored }).where(eq(table.id, id));
              }
              return { files: inline.length, bytes };
            });
            if (counted.files > 0) {
              bucket.records += 1;
              bucket.files += counted.files;
              bucket.bytes += counted.bytes;
            }
          } catch (err: unknown) {
            report.failures.push({ entityType, entityId: id, error: err instanceof Error ? err.message : String(err) });
          }
        }
        report.records += bucket.records;
        report.files += bucket.files;
        report.bytes += bucket.bytes;
      }
    });

    if (!outcome.acquired) {
      throw new ConflictError('انتقال پیوست‌ها هم‌اکنون در حال اجراست', 'ATTACHMENT_MIGRATION_RUNNING');
    }

    if (options.apply) {
      await logActivity({
        username: options.actor,
        action: 'UPDATE',
        entity: 'سیستم:پیوست‌ها',
        description: `انتقال ${report.files} پیوست از ${report.records} رکورد به دیسک (${report.failures.length} خطا)`,
        details: { byEntity: report.byEntity, failures: report.failures },
      });
    }
    logger.info(`[Attachments] inline migration ${options.apply ? 'applied' : 'dry run'}: ${report.records} records, ${report.files} files, ${report.bytes} bytes, ${report.failures.length} failures`);
    return report;
  }
}
