/**
 * v9.0.200 (TD-553، B03-11): سطح‌های سرفصل و قاعده بالادست، مشترک سرور و فرم سرفصل: بالادست هر حساب دقیقاً یک
 * سطح بالاتر است (گروه ← کل ← معین ← تفصیلی) و حساب گروه بالادست ندارد.
 */

export const ACCOUNT_LEVELS = ['group', 'general', 'subsidiary', 'detailed'] as const;
export type AccountLevelCode = (typeof ACCOUNT_LEVELS)[number];

export const ACCOUNT_LEVEL_LABELS: Record<AccountLevelCode, string> = {
  group: 'گروه',
  general: 'کل',
  subsidiary: 'معین',
  detailed: 'تفصیلی',
};

export function accountLevelLabel(level: string | null | undefined): string {
  return ACCOUNT_LEVEL_LABELS[level as AccountLevelCode] ?? 'نامشخص';
}

/** سطح بالادست یک سطح؛ گروه بالادست ندارد (null) */
export function parentLevelOf(level: string | null | undefined): AccountLevelCode | null {
  const index = ACCOUNT_LEVELS.indexOf(level as AccountLevelCode);
  return index > 0 ? ACCOUNT_LEVELS[index - 1] : null;
}
