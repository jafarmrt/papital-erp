import { orm } from '../db/drizzle.js';
import { activityLogs } from '../db/schema.js';
import { logger } from '../middleware/logger.js';
import { systemNowUtcIso } from '../lib/businessClock.js';
import { sql, lt } from 'drizzle-orm';
import type { Request } from 'express';

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
 * Safely extracts client IP address from express request, honoring proxies.
 */
export function extractClientIp(req?: Request | { headers?: Record<string, unknown>; socket?: { remoteAddress?: string }; ip?: string } | null): string {
  if (!req) return '';
  const headers = req.headers as Record<string, string | string[] | undefined> | undefined;
  const forwarded = headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return String(forwarded[0]).trim();
  }
  return (headers?.['x-real-ip'] as string) || req.socket?.remoteAddress || req.ip || '';
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

export interface AuditLogParams {
  userId?: number;
  username?: string;
  userFullName?: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGIN_FAILED' | 'LOGOUT' | 'SETTING_CHANGE' | 'EXPORT' | 'RESTORE' | 'AUDIT_APPLY' | 'RECONCILIATION_EXECUTE' | 'VIEW' | 'AUDIT' | 'SEED' | 'IMPORT';
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
}

/**
 * Persistently writes a hardened, sanitized audit log record to the database.
 */
export async function logActivity(params: AuditLogParams) {
  try {
    const ipAddress = params.ipAddress || (params.req ? extractClientIp(params.req) : '');
    const reqUser = params.req?.user as { id?: number; username?: string; full_name?: string } | undefined;
    const userId = params.userId ?? reqUser?.id;
    const username = params.username || reqUser?.username || 'سیستم';
    const userFullName = params.userFullName || reqUser?.full_name || '';

    // Guarantee full sanitization on all recorded metadata
    const sanitizedDetails = sanitizeSensitiveData(params.details || {});

    await orm.insert(activityLogs).values({
      userId: userId ? Number(userId) : null,
      username: String(username).trim(),
      userFullName: String(userFullName).trim(),
      action: params.action,
      entity: params.entity,
      entityId: params.entityId !== undefined && params.entityId !== null ? String(params.entityId) : '',
      description: params.description,
      details: sanitizedDetails,
      ipAddress: ipAddress || '',
      timestamp: systemNowUtcIso()
    });
  } catch (err) {
    logger.error({ message: 'Error recording hardened activity log', error: err });
  }
}

/**
 * پاکسازی/بایگانی لاگ‌های ممیزی قدیمی‌تر از تعداد روز مشخص (پیش‌فرض ۹۰ روز)
 */
export async function purgeOldAuditLogs(retentionDays: number = 90): Promise<number> {
  try {
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const result = await orm.delete(activityLogs).where(lt(activityLogs.timestamp, cutoffDate));
    return (result as any)?.rowCount || 0;
  } catch (err) {
    logger.error({ message: 'Error purging old activity logs', error: err });
    return 0;
  }
}

