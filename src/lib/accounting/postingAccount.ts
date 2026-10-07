/**
 * v9.0.198 (TD-549، B03-07): حساب قابل ثبت (حسابی که ردیف سند روی آن می‌نشیند)، مشترک سرور و فرم‌های سند.
 *
 * ردیف سند فقط روی حساب فعالِ معین یا تفصیلی می‌نشیند که زیرحساب فعال ندارد (برگ درخت). تراز آزمایشی هر سطح را جدا
 * می‌خواند و صورت‌های مالی و بستن سال سطح معین را، پس ردیف روی حساب گروه یا کل در آن‌ها دیده نمی‌شد.
 */

export const POSTING_ACCOUNT_LEVELS = ['subsidiary', 'detailed'] as const;

export type PostingRefusal = 'missing' | 'inactive' | 'summary_level' | 'has_children';

export interface PostingAccountLike {
  id: number;
  code?: string | null;
  name?: string | null;
  level?: string | null;
  parentId?: number | null;
  isActive?: number | boolean | null;
  isDeleted?: number | boolean | null;
}

const isOn = (flag: number | boolean | null | undefined, fallback: boolean) => (flag === undefined || flag === null ? fallback : Boolean(Number(flag)));

/** چرا ردیف روی این حساب نمی‌نشیند؛ null یعنی قابل ثبت است */
export function postingRefusal(account: PostingAccountLike | undefined, hasActiveChild: boolean): PostingRefusal | null {
  if (!account || isOn(account.isDeleted, false)) return 'missing';
  if (!isOn(account.isActive, true)) return 'inactive';
  if (!(POSTING_ACCOUNT_LEVELS as readonly string[]).includes(String(account.level ?? ''))) return 'summary_level';
  if (hasActiveChild) return 'has_children';
  return null;
}

/** حساب‌های قابل ثبت از فهرست حساب‌های حذف‌نشده (برای انتخابگر حساب فرم‌های سند) */
export function postingAccountsOf<T extends PostingAccountLike>(accounts: readonly T[]): T[] {
  const parentsWithActiveChild = new Set<number>();
  for (const a of accounts) {
    if (a.parentId && !isOn(a.isDeleted, false) && isOn(a.isActive, true)) parentsWithActiveChild.add(Number(a.parentId));
  }
  return accounts.filter(a => postingRefusal(a, parentsWithActiveChild.has(Number(a.id))) === null);
}

const REFUSAL_TEXT: Record<PostingRefusal, string> = {
  missing: 'یافت نشد یا حذف شده است',
  inactive: 'غیرفعال است',
  summary_level: 'حساب گروه یا کل است؛ ردیف را روی حساب معین یا تفصیلی زیر آن ثبت کنید',
  has_children: 'زیرحساب فعال دارد؛ ردیف را روی زیرحساب آن ثبت کنید',
};

export function postingRefusalText(reason: PostingRefusal): string {
  return REFUSAL_TEXT[reason];
}
