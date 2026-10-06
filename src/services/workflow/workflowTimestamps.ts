import { serverTimestampToUtcIso } from '../../lib/serverTimestamp.js';

/**
 * TD-468 (یافته B14-26): زمان‌های سرور جدول‌های گردش کار (timestamp بی منطقه، ساعت UTC) با Z به مرورگر می‌روند
 * (AGENTS §1.10)؛ پیش‌تر بی منطقه می‌رفتند و مرورگر آن‌ها را ساعت منطقه توافقی می‌خواند، پس هر زمانی میان ۰۰:۰۰ و ۰۳:۳۰
 * تهران روز قبل نشان داده می‌شد. فقط مقدارهای این کلیدها و فقط رشته «تاریخ و ساعت» بی منطقه تبدیل می‌شوند؛ تاریخ
 * کسب‌وکار (YYYY-MM-DD) و زمانی که منطقه دارد دست نمی‌خورد.
 */
export const WORKFLOW_TIMESTAMP_KEYS = new Set([
  'createdAt', 'updatedAt', 'dueAt', 'completedAt', 'slaRemindedAt', 'startDate', 'endDate', 'signedAt',
  'enteredAt', 'reopenedAt', 'publishedAt', 'lastActionAt', 'startedAt', 'timestamp',
]);

const SERVER_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

export function withUtcTimestamps<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => withUtcTimestamps(v)) as T;
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = typeof v === 'string' && WORKFLOW_TIMESTAMP_KEYS.has(key) && SERVER_TIMESTAMP.test(v.trim())
      ? serverTimestampToUtcIso(v)
      : withUtcTimestamps(v);
  }
  return out as T;
}
