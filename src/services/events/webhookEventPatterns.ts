import { ValidationError } from '../../errors/customErrors.js';
import { ALL_EVENTS_PATTERN, unknownEventPatterns } from '../../lib/events/eventTypeCatalog.js';

/**
 * v9.0.405 (TD-707، B15-05، تصمیم ت۳ الف): الگوهای رویداد اشتراک وب‌هوک فقط «همه رویدادها» (`*`) یا نوع‌های منتشرشونده
 * `PUBLISHED_EVENT_TYPES` هستند؛ الگوی دیگر (مثل `document.invoiced` که با هیچ رویدادی جور نمی‌شد) ۴۲۲
 * `WEBHOOK_EVENT_PATTERN_UNKNOWN` است. فهرست خالی یا دارای `*` همان «همه رویدادها» است و تکرارها حذف می‌شوند.
 */
export const WEBHOOK_EVENT_PATTERN_UNKNOWN = 'WEBHOOK_EVENT_PATTERN_UNKNOWN';

function unknownPatternsError(unknown: string[]): ValidationError {
  const names = unknown.map(p => `«${p}»`).join('، ');
  return new ValidationError(
    `این رویدادها در سامانه منتشر نمی‌شوند: ${names}. رویدادهای اشتراک را از فهرست فرم یا «همه رویدادها» برگزینید.`,
    { unknownPatterns: unknown },
    WEBHOOK_EVENT_PATTERN_UNKNOWN,
  );
}

export function resolveEventPatterns(patterns: unknown): string[] {
  if (patterns === undefined || patterns === null) return [ALL_EVENTS_PATTERN];
  if (!Array.isArray(patterns)) throw unknownPatternsError([String(patterns)]);
  const list = [...new Set(patterns.map(p => (typeof p === 'string' ? p.trim() : String(p))))];
  const unknown = unknownEventPatterns(list);
  if (unknown.length > 0) throw unknownPatternsError(unknown);
  if (list.length === 0 || list.includes(ALL_EVENTS_PATTERN)) return [ALL_EVENTS_PATTERN];
  return list;
}

/** اشتراکی که الگوی نادرست قدیمی دارد (مهاجرت آن را غیرفعال کرده است) تا برگزیدن رویدادها فعال نمی‌شود */
export function assertActivatableEventPatterns(stored: unknown): void {
  const unknown = unknownEventPatterns(Array.isArray(stored) ? stored : []);
  if (unknown.length > 0) throw unknownPatternsError(unknown);
}
