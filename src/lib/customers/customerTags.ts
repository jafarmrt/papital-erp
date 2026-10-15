/**
 * v10.1.23 (N-02 بخش ۳، ت۱۳ طرح ارتباط با مشتری): برچسب طرف حساب. فهرست برچسب‌ها را دارنده `customers.manage` تعریف می‌کند
 * (مثلاً «عمده‌فروش»، «مغازه»، «فروش برخط»، «نمایشگاه») و هر طرف حساب چند برچسب دارد؛ فهرست طرف حساب‌ها و پرونده‌های فروش با
 * برچسب پالایش می‌شوند. قاعده‌ها مشترک کارساز و فرم‌ها هستند.
 */

export const CUSTOMER_TAG_COLORS = ['slate', 'blue', 'emerald', 'amber', 'rose', 'purple', 'cyan'] as const;
export type CustomerTagColor = typeof CUSTOMER_TAG_COLORS[number];

export const CUSTOMER_TAG_COLOR_LABELS: Record<CustomerTagColor, string> = {
  slate: 'خاکستری',
  blue: 'آبی',
  emerald: 'سبز',
  amber: 'زرد',
  rose: 'سرخ',
  purple: 'بنفش',
  cyan: 'فیروزه‌ای',
};

/** رنگ نشان برچسب (Tailwind)؛ رنگ ناشناخته خاکستری است */
export const CUSTOMER_TAG_COLOR_CLASSES: Record<CustomerTagColor, string> = {
  slate: 'bg-slate-100 text-slate-700 border-slate-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
  purple: 'bg-purple-50 text-purple-700 border-purple-200',
  cyan: 'bg-cyan-50 text-cyan-700 border-cyan-200',
};

export const CUSTOMER_TAG_NAME_MAX = 40;
/** بیشترین شمار برچسب یک طرف حساب */
export const CUSTOMER_TAGS_PER_PARTY_MAX = 20;

/** برچسبی که روی طرف حساب نشان داده می‌شود */
export interface CustomerTag {
  id: number;
  name: string;
  color: CustomerTagColor;
}

/** سطر `GET /customers/tags` */
export interface CustomerTagRow extends CustomerTag {
  version: number;
  /** شمار طرف حساب‌های حذف‌نشده‌ای که این برچسب را دارند */
  customerCount: number;
}

export function isCustomerTagColor(value: unknown): value is CustomerTagColor {
  return typeof value === 'string' && (CUSTOMER_TAG_COLORS as readonly string[]).includes(value);
}

export function tagColorClass(color: string | null | undefined): string {
  return CUSTOMER_TAG_COLOR_CLASSES[isCustomerTagColor(color) ? color : 'slate'];
}

/** خطای نام برچسب، یا null */
export function customerTagNameError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'نام برچسب را بنویسید.';
  if (trimmed.length > CUSTOMER_TAG_NAME_MAX) return `نام برچسب حداکثر ${CUSTOMER_TAG_NAME_MAX.toLocaleString('fa-IR')} نویسه است.`;
  return null;
}

/** کلید نام، هم‌ارز `lower(btrim(name))` نمایه یکتای `uq_customer_tags_name_active` */
export function customerTagNameKey(name: string): string {
  return name.trim().toLowerCase();
}
