/**
 * فهرست‌های انتخاب (مدل مجوز بسته ۲، تصمیم ت۱۰ الف): فرمی که از فهرست بخش دیگری انتخاب می‌کند (خریدار فاکتور، تأمین‌کننده
 * رسید، طرف حساب سند حسابداری و …) از «فهرست انتخاب» همان بخش می‌خواند که فقط فیلدهای لازم برای انتخاب را دارد، و فهرست
 * کامل هر بخش فقط با مجوز مشاهده همان بخش باز است. پیش‌تر مجوز هر فرم کل فهرست بخش دیگر را باز می‌کرد (یافته «تیک با اثر
 * پنهان» در P02_PERMISSION_MODEL.md §۲.۷). سرور و مرورگر نشانی و فیلدهای هر فهرست را از همین پرونده می‌خوانند؛ مجوزها در
 * `READ_PERMISSIONS` (`src/lib/recordReadPermissions.ts`) و آزمون Vitest `pickLists.test.ts` نگه‌شان می‌دارد.
 *
 * v9.0.137 (TD-887): طرف حساب‌ها. v9.0.138 (TD-888): کالاها. v9.0.139 (TD-889): پروژه‌ها.
 */

export const PICK_LIST_URLS = {
  customers: '/customers/options',
  items: '/items/options',
  projects: '/projects/options',
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

/**
 * فیلدهای فهرست انتخاب کالا: شناسه، کد، نام، واحد، دسته و ویژگی‌ها برای انتخاب در سند، پروژه، خرید، انبارگردانی و
 * ارتباط با مشتری، و موجودی هر انبار (`stocks` و `stock_<کد انبار>`) برای بررسی مقدار خروج و انتقال. نقطه سفارش، رزروها،
 * نسخه رکورد و امکان ثبت افتتاحیه فقط در فهرست کامل (`products.view`) است. نام‌ها همان نام‌های فهرست کامل‌اند (هر دو شکل
 * camelCase و snake_case) تا فرم‌ها بی تغییر از آن بخوانند.
 */
export const ITEM_PICK_FIELDS = [
  'id', 'type', 'name', 'code', 'unit', 'category', 'image', 'thumbnail', 'color', 'weight', 'material', 'size',
  'currentStock', 'current_stock', 'stocks',
] as const;

/** میانگین بهای کالا (بهای تمام‌شده) فقط برای دارندگان `products.view`؛ فرم‌های دیگر قیمت پیش‌فرض را خالی می‌گذارند */
export const ITEM_COST_FIELDS = ['weightedAverageCost', 'weighted_average_cost'] as const;

/** کلید موجودی یک انبار در ردیف کالا */
export const ITEM_WAREHOUSE_STOCK_FIELD = /^stock_.+$/;

export interface ItemPick {
  id: number;
  type: string;
  name: string;
  code: string;
  unit: string;
  category: string | null;
  image: string | null;
  thumbnail: string | null;
  color: string | null;
  weight: number | null;
  material: string | null;
  size: string | null;
  currentStock: number;
  current_stock: number;
  /** موجودی هر انبار با کد انبار */
  stocks: Record<string, number>;
  /** فقط برای دارندگان products.view */
  weightedAverageCost?: number;
  weighted_average_cost?: number;
  [warehouseStock: `stock_${string}`]: number;
}

/**
 * فیلدهای فهرست انتخاب پروژه: شناسه، کد، عنوان، وضعیت و نام مشتری (برچسبی که فرم انبار، انبار پروژه، کارکرد کارمزدی،
 * گزارش روزانه و تخصیص مواد اولیه نشان می‌دهند). محصولات، کنترل موجودی و رزرو، مراحل، زمان‌بندی و پیوست‌ها فقط در فهرست
 * کامل (`projects.view`) و پرونده یک پروژه است.
 */
export const PROJECT_PICK_FIELDS = [
  'id', 'projectCode', 'project_code', 'title', 'status', 'customerName', 'customer_name',
] as const;

export interface ProjectPick {
  id: number;
  projectCode: string;
  project_code: string;
  title: string;
  status: string;
  customerName: string;
  customer_name: string;
}
