/**
 * فهرست‌های انتخاب (مدل مجوز بسته ۲، تصمیم ت۱۰ الف): فرمی که از فهرست بخش دیگری انتخاب می‌کند (خریدار فاکتور، تأمین‌کننده
 * رسید، طرف حساب سند حسابداری و …) از «فهرست انتخاب» همان بخش می‌خواند که فقط فیلدهای لازم برای انتخاب را دارد، و فهرست
 * کامل هر بخش فقط با مجوز مشاهده همان بخش باز است. پیش‌تر مجوز هر فرم کل فهرست بخش دیگر را باز می‌کرد (یافته «تیک با اثر
 * پنهان» در P02_PERMISSION_MODEL.md §۲.۷). سرور و مرورگر نشانی و فیلدهای هر فهرست را از همین پرونده می‌خوانند؛ مجوزها در
 * `READ_PERMISSIONS` (`src/lib/recordReadPermissions.ts`) و آزمون Vitest `pickLists.test.ts` نگه‌شان می‌دارد.
 *
 * v9.0.120 (TD-887): طرف حساب‌ها.
 */

export const PICK_LIST_URLS = {
  customers: '/customers/options',
} as const;

/**
 * فیلدهای فهرست انتخاب طرف حساب: کارت تماس (برای پر کردن خریدار فاکتور، نمایش در پرونده فروش و انتخاب تأمین‌کننده)، بی
 * یادداشت داخلی و نسخه رکورد. اطلاعات بانکی جدا و فقط با قاعده TD-433 (`canSeePartyBankInfo`) می‌آید.
 */
export const CUSTOMER_PICK_FIELDS = [
  'id', 'name', 'partyType', 'supplierCategory', 'contactName', 'phone', 'country', 'province', 'city', 'address', 'contacts',
] as const;

export interface CustomerPickContact {
  id?: string;
  name?: string;
  role?: string;
  phone?: string;
  isPrimary?: boolean;
}

export interface CustomerPick {
  id: number;
  name: string;
  partyType: string | null;
  supplierCategory: string | null;
  contactName: string | null;
  phone: string | null;
  country: string | null;
  province: string | null;
  city: string | null;
  address: string | null;
  contacts: CustomerPickContact[] | null;
  /** فقط برای دارندگان customers.view، customers.manage و مجوزهای accounting.* (TD-433) */
  bankInfo?: { bankName?: string; accountNumber?: string; shaba?: string; cardNumber?: string } | null;
}
