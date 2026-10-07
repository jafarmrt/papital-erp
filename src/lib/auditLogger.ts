import { orm } from '../db/drizzle.js';
import { activityLogs } from '../db/schema.js';
import { logger } from '../middleware/logger.js';
import { systemNowUtcIso } from '../lib/businessClock.js';
import { sql, lt, and, inArray, notInArray, count, not, type SQL } from 'drizzle-orm';
import type { Request } from 'express';
import { ValidationError } from '../errors/customErrors.js';
import { FinancialDecimal } from './financialDecimal.js';
import { toPersianDigits } from '../utils/persianNumber.js';
import { CRITICAL_AUDIT_ACTIONS, MIN_AUDIT_RETENTION_DAYS, PURGEABLE_AUDIT_ENTITIES } from './audit/auditRetention.js';

// Regex patterns to identify sensitive keys that MUST NEVER be stored in audit logs
const SENSITIVE_KEY_REGEX = /^(password|pass|new_password|current_password|newpassword|currentpassword|old_password|oldpassword|confirmpassword|confirm_password|token|access_token|accesstoken|refresh_token|refreshtoken|auth_token|authtoken|secret|jwt|apikey|api_key|authorization|cookie|card_number|credit_card|cvv|ssn)$/i;

/**
 * Recursively sanitizes any sensitive credentials (passwords, tokens, secrets) from objects or arrays.
 * Replaces sensitive values with '[PROTECTED]' or boolean flags.
 */
export function sanitizeSensitiveData<T = unknown>(obj: T, depth = 0, seen = new WeakSet()): T {
  if (obj === null || obj === undefined) return obj;
  if (depth > 6) return '[MAX_DEPTH_REACHED]' as unknown as T;

  if (typeof obj === 'string') {
    // If string contains JWT-like token (eyJh...) mask it
    if (/^Bearer\s+[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$/i.test(obj.trim())) {
      return 'Bearer [PROTECTED_JWT]' as unknown as T;
    }
    if (/^eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$/i.test(obj.trim())) {
      return '[PROTECTED_JWT]' as unknown as T;
    }
    return obj;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  // v7.0.67 (P2-6): مبلغ Decimal/Money در اسنپ‌شات ممیزی عدد است (نه ساختار داخلی Decimal)
  if (obj instanceof FinancialDecimal) {
    return obj.toNumber() as unknown as T;
  }

  // Prevent circular references
  if (seen.has(obj as object)) {
    return '[CIRCULAR]' as unknown as T;
  }
  seen.add(obj as object);

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeSensitiveData(item, depth + 1, seen)) as unknown as T;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEY_REGEX.test(key)) {
      sanitized[key] = '[PROTECTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeSensitiveData(value, depth + 1, seen);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized as T;
}

/**
 * آدرس IP کلاینت برای لاگ ممیزی.
 * v7.0.41 (TD-182): فقط req.ip که Express آن را بر اساس TRUST_PROXY (src/lib/trustProxy.ts) فقط از پراکسی‌های
 * قابل‌اعتماد استخراج می‌کند؛ هدرهای X-Forwarded-For / X-Real-IP خام در کنترل کلاینت‌اند و خوانده نمی‌شوند.
 */
export function extractClientIp(req?: Request | { headers?: Record<string, unknown>; socket?: { remoteAddress?: string }; ip?: string } | null): string {
  if (!req) return '';
  return req.ip || req.socket?.remoteAddress || '';
}

/**
 * Calculates field-by-field differences between previous and updated objects for audit snapshots.
 */
export function computeAuditDiff(
  before: Record<string, unknown> = {},
  after: Record<string, unknown> = {},
  ignoreFields: string[] = ['updatedAt', 'updated_at', 'password']
): { hasChanges: boolean; diff: Record<string, { before: unknown; after: unknown }> } {
  const diff: Record<string, { before: unknown; after: unknown }> = {};
  const allKeys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);

  for (const key of allKeys) {
    if (ignoreFields.includes(key)) continue;

    const valBefore = before ? before[key] : undefined;
    const valAfter = after ? after[key] : undefined;

    // Serialize objects for comparison
    const strBefore = typeof valBefore === 'object' && valBefore !== null ? JSON.stringify(valBefore) : String(valBefore ?? '');
    const strAfter = typeof valAfter === 'object' && valAfter !== null ? JSON.stringify(valAfter) : String(valAfter ?? '');

    if (strBefore !== strAfter) {
      diff[key] = {
        before: sanitizeSensitiveData(valBefore),
        after: sanitizeSensitiveData(valAfter)
      };
    }
  }

  return {
    hasChanges: Object.keys(diff).length > 0,
    diff
  };
}

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'SETTING_CHANGE'
  | 'EXPORT'
  | 'RESTORE'
  | 'AUDIT_APPLY'
  | 'RECONCILIATION_EXECUTE'
  | 'VIEW'
  | 'AUDIT'
  | 'SEED'
  | 'IMPORT'
  | 'PURGE'
  | (string & {});

export interface AuditLogParams {
  userId?: number;
  username?: string;
  userFullName?: string;
  action: AuditAction;
  entity: string; // e.g. 'کالا', 'فاکتور', 'کاربر', 'نقش', 'مشتری', 'تنظیمات', 'قیمت کالا', 'انبار', 'موجودی انبار', 'احراز هویت'
  entityId?: string | number;
  description: string;
  details?: {
    before?: unknown;
    after?: unknown;
    changes?: Record<string, { before: unknown; after: unknown }> | unknown;
    [key: string]: unknown;
  } | unknown;
  ipAddress?: string;
  req?: Request | any; // If express req is passed, IP & User are auto-extracted if missing
  strict?: boolean; // When true, does not swallow insertion errors; re-throws after structured logging
  throwOnError?: boolean; // Alias for strict
  tx?: any; // Allows participating in an ongoing database transaction (insertion errors then always propagate)
}

export interface AuditLogResult {
  success: boolean;
  id?: number;
  error?: unknown;
}

/**
 * Persistently writes a hardened, sanitized audit log record to the database.
 * Supports transactional execution, strict error propagation, and emergency structured fallback logging.
 */
export async function logActivity(params: AuditLogParams): Promise<AuditLogResult> {
  const ipAddress = params.ipAddress || (params.req ? extractClientIp(params.req) : '');
  const reqUser = params.req?.user as { id?: number; username?: string; full_name?: string } | undefined;
  const userId = params.userId ?? reqUser?.id;
  const username = params.username || reqUser?.username || 'سیستم';
  const userFullName = params.userFullName || reqUser?.full_name || '';

  // Guarantee full sanitization on all recorded metadata
  const sanitizedDetails = sanitizeSensitiveData(params.details || {});
  const nowTimestamp = systemNowUtcIso();

  try {
    const executor = params.tx || orm;
    const [inserted] = await executor.insert(activityLogs).values({
      userId: userId ? Number(userId) : null,
      username: String(username).trim(),
      userFullName: String(userFullName).trim(),
      action: params.action,
      entity: params.entity,
      entityId: params.entityId !== undefined && params.entityId !== null ? String(params.entityId) : '',
      description: params.description,
      details: sanitizedDetails,
      ipAddress: ipAddress || '',
      timestamp: nowTimestamp
    }).returning({ id: activityLogs.id });

    return {
      success: true,
      id: inserted?.id
    };
  } catch (err) {
    // Critical Fallback: ensure unwritten audit record is preserved in structured application logs
    logger.error({
      message: 'CRITICAL: Error recording hardened activity log to database',
      error: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      auditFallbackRecord: {
        userId: userId ? Number(userId) : null,
        username: String(username).trim(),
        userFullName: String(userFullName).trim(),
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        description: params.description,
        timestamp: nowTimestamp,
        ipAddress,
        details: sanitizedDetails
      }
    });

    // v8.0.77 (TD-324): خطای درج درون تراکنش، تراکنش را باطل کرده است؛ بلعیدنش COMMIT را بی‌صدا به ROLLBACK بدل می‌کند
    if (params.strict === true || params.throwOnError === true || params.tx) {
      throw err;
    }

    return {
      success: false,
      error: err
    };
  }
}

// v9.0.154 (TD-522): کمینه نگه‌داشت و رده‌بندی موجودیت‌ها در `src/lib/audit/auditRetention.ts`، مشترک با فرم پاک‌سازی
export {
  MIN_AUDIT_RETENTION_DAYS,
  CRITICAL_AUDIT_ACTIONS,
  CRITICAL_AUDIT_ENTITIES,
  CRITICAL_AUDIT_ENTITY_PREFIXES,
  PURGEABLE_AUDIT_ENTITIES
} from './audit/auditRetention.js';

export interface PurgeAuditLogsOptions {
  retentionDays?: number;
  tx?: any;
  actorUsername?: string;
  actorUserId?: number;
  actorIp?: string;
}

export interface PurgeAuditLogsResult {
  success: boolean;
  purgedCount: number;
  cutoffDate: string;
  retentionDays: number;
  error?: unknown;
}

/** ردیف‌هایی که پاک‌سازی می‌تواند پاک کند: بخش پاک‌شدنی و اقدامی که بحرانی نیست */
function purgeableAuditRowCondition(): SQL {
  return and(
    inArray(activityLogs.entity, [...PURGEABLE_AUDIT_ENTITIES]),
    notInArray(activityLogs.action, [...CRITICAL_AUDIT_ACTIONS])
  ) as SQL;
}

/**
 * پاک‌سازی سجل قدیمی‌تر از دوره نگه‌داشت (پیش‌فرض و کمینه ۹۰ روز). v9.0.154 (TD-522، تصمیم ت۴ الف): فقط سجل بخش‌های
 * `PURGEABLE_AUDIT_ENTITIES` با اقدامی جز `CRITICAL_AUDIT_ACTIONS` پاک می‌شود؛ گزینه خاموش کردن حفاظت
 * (`preserveCritical: false`) و پاک کردن زودتر از کمینه (`allowForceRecent`) برداشته شد. تاریخ برش از ساعت کسب‌وکار
 * (`systemNowUtcIso`) است و خود پاک‌سازی در سجل ثبت می‌شود.
 */
export async function purgeOldAuditLogs(
  retentionDaysOrOptions: number | PurgeAuditLogsOptions = MIN_AUDIT_RETENTION_DAYS
): Promise<PurgeAuditLogsResult & { valueOf: () => number; [Symbol.toPrimitive]: (hint: string) => number | string }> {
  const options: PurgeAuditLogsOptions = typeof retentionDaysOrOptions === 'number'
    ? { retentionDays: retentionDaysOrOptions }
    : (retentionDaysOrOptions || {});

  const retentionDays = options.retentionDays ?? MIN_AUDIT_RETENTION_DAYS;

  if (typeof retentionDays !== 'number' || !Number.isFinite(retentionDays) || retentionDays <= 0) {
    throw new ValidationError('مدت زمان نگه‌داشت لاگ‌های ممیزی باید یک عدد معتبر و مثبت باشد.');
  }

  if (retentionDays < MIN_AUDIT_RETENTION_DAYS) {
    throw new ValidationError(
      `سجل تازه‌تر از ${toPersianDigits(MIN_AUDIT_RETENTION_DAYS)} روز پاک نمی‌شود؛ دوره نگه‌داشت را دست‌کم ${toPersianDigits(MIN_AUDIT_RETENTION_DAYS)} روز بگذارید.`
    );
  }

  const nowIso = systemNowUtcIso();
  const nowMs = new Date(nowIso).getTime();
  const cutoffMs = nowMs - retentionDays * 24 * 60 * 60 * 1000;
  const cutoffDate = new Date(cutoffMs).toISOString();

  try {
    const executor = options.tx || orm;
    const result = await executor.delete(activityLogs).where(and(lt(activityLogs.timestamp, cutoffDate), purgeableAuditRowCondition()));
    const purgedCount = Number((result as any)?.rowCount || 0);

    // ثبت ردپای خود عملیات پاکسازی در سیستم ممیزی
    if (purgedCount > 0) {
      await logActivity({
        action: 'PURGE',
        entity: 'تنظیمات سیستم',
        entityId: 'audit_purge',
        description: `پاکسازی ایمن تاریخچه ممیزی: تعداد ${purgedCount} رکورد با قدمت بیش از ${retentionDays} روز حذف شد (تاریخ برش: ${cutoffDate}).`,
        details: {
          purgedCount,
          cutoffDate,
          retentionDays,
          purgeableEntities: [...PURGEABLE_AUDIT_ENTITIES]
        },
        username: options.actorUsername || 'سیستم',
        userId: options.actorUserId,
        ipAddress: options.actorIp,
        tx: options.tx
      });
    }

    const report: PurgeAuditLogsResult & { valueOf: () => number; [Symbol.toPrimitive]: (hint: string) => number | string } = {
      success: true,
      purgedCount,
      cutoffDate,
      retentionDays,
      valueOf: () => purgedCount,
      [Symbol.toPrimitive]: (hint: string) => (hint === 'number' ? purgedCount : String(purgedCount))
    };

    return report;
  } catch (err) {
    logger.error({ message: 'Error executing safe audit log purge', error: err });
    if (err instanceof ValidationError) throw err;
    throw err;
  }
}

export interface AuditLogIntegrityReport {
  healthy: boolean;
  totalLogs: number;
  /** ردیف‌هایی که پاک‌سازی هرگز پاک نمی‌کند (v9.0.154، TD-522) */
  criticalLogsCount: number;
  earliestTimestamp: string | null;
  latestTimestamp: string | null;
  minRetentionDays: number;
}

/**
 * بررسی سلامت و یکپارچگی ثبت لاگ‌های ممیزی در سامانه
 */
export async function checkAuditLogIntegrity(): Promise<AuditLogIntegrityReport> {
  try {
    const [stats] = await orm.select({
      total: count(),
      earliest: sql<string>`min(${activityLogs.timestamp})`,
      latest: sql<string>`max(${activityLogs.timestamp})`
    }).from(activityLogs);

    const [critical] = await orm.select({
      criticalCount: count()
    }).from(activityLogs).where(not(purgeableAuditRowCondition()));

    const totalLogs = Number(stats?.total || 0);

    return {
      healthy: true,
      totalLogs,
      criticalLogsCount: Number(critical?.criticalCount || 0),
      earliestTimestamp: stats?.earliest || null,
      latestTimestamp: stats?.latest || null,
      minRetentionDays: MIN_AUDIT_RETENTION_DAYS
    };
  } catch (err) {
    logger.error({ message: 'Error checking audit log integrity', error: err });
    return {
      healthy: false,
      totalLogs: 0,
      criticalLogsCount: 0,
      earliestTimestamp: null,
      latestTimestamp: null,
      minRetentionDays: MIN_AUDIT_RETENTION_DAYS
    };
  }
}

