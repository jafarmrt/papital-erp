import { withUtcTimestampKeys } from '../../lib/serverTimestamp.js';

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

export function withUtcTimestamps<T>(value: T): T {
  return withUtcTimestampKeys(value, WORKFLOW_TIMESTAMP_KEYS);
}
