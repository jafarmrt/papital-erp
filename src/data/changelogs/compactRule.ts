import { AIUpdateLog } from './types';

/**
 * v7.0.54 (تصمیم مالک محصول): قاعده چنج‌لاگ کوتاه سری فعال (7.ts).
 * هر نسخه همچنان یک مدخل دارد، اما فقط نکات مهم: تغییرات مهم و باگ‌های مهم و بحرانی.
 * جزئیات پیاده‌سازی (نام فایل‌ها و تست‌ها، ثبت بدهی، ارتقای نسخه) در commit و TECH_DEBT ثبت می‌شود، نه در چنج‌لاگ.
 * این محدودیت‌ها را `npm run check:version` (scripts/check-version-sync.ts) و تست unit_changelog_compact_rule بررسی می‌کنند.
 */
export const CHANGELOG_ENTRY_LIMITS = {
  titleMaxChars: 90,
  summaryMaxChars: 300,
  maxChanges: 4,
  maxFixes: 4,
  itemMaxChars: 150,
} as const;

/** ردیف «ارتقای نسخه سیستم به …» تکرار خود شماره نسخه است و در چنج‌لاگ کوتاه جایی ندارد */
const ROUTINE_ITEM_PATTERN = /ارتقای نسخه/;

export function findCompactRuleViolations(entries: AIUpdateLog[]): string[] {
  const L = CHANGELOG_ENTRY_LIMITS;
  const violations: string[] = [];
  for (const e of entries) {
    const v = e.version;
    const changes = Array.isArray(e.changes) ? e.changes : [];
    const fixes = Array.isArray(e.fixes) ? e.fixes : [];
    if ((e.title || '').length > L.titleMaxChars) violations.push(`${v}: title longer than ${L.titleMaxChars} characters`);
    if ((e.summary || '').length > L.summaryMaxChars) violations.push(`${v}: summary longer than ${L.summaryMaxChars} characters (${e.summary.length})`);
    if (changes.length === 0) violations.push(`${v}: no changes`);
    if (changes.length > L.maxChanges) violations.push(`${v}: more than ${L.maxChanges} changes (${changes.length})`);
    if (fixes.length > L.maxFixes) violations.push(`${v}: more than ${L.maxFixes} fixes (${fixes.length})`);
    for (const item of [...changes, ...fixes]) {
      if (item.length > L.itemMaxChars) violations.push(`${v}: item longer than ${L.itemMaxChars} characters: "${item.slice(0, 40)}…"`);
      if (ROUTINE_ITEM_PATTERN.test(item)) violations.push(`${v}: routine version-bump item: "${item.slice(0, 40)}…"`);
    }
  }
  return violations;
}
