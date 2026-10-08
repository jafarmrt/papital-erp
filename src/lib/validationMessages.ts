import { z } from 'zod';

/**
 * v9.0.78 (TD-529, B02-14): پیام‌های فارسی خطای اعتبارسنجی. پیش‌تر پیام پیش‌فرض Zod انگلیسی بود («Invalid input: expected
 * string, received undefined») و فقط نام فیلد ترجمه می‌شد. نقشه زیر از روی کد هر issue پیامی می‌سازد که بگوید چه چیزی را
 * عوض کنید («نام کاربری را وارد کنید»، «رمز عبور باید دست‌کم ۶ نویسه باشد»)؛ بسته فارسی خود Zod فقط پشتوانه است. پیامی
 * که خود اسکیما نوشته باشد همیشه بر این نقشه مقدم است.
 */

/** نام فارسی فیلدها؛ فیلد بی‌برچسب با نام خامش در «» نشان داده می‌شود (واژه‌ها فارسی، بی نویسه‌نویسی انگلیسی) */
export const FIELD_LABELS: Record<string, string> = {
  name: 'نام',
  title: 'عنوان',
  content: 'شرح / محتوا',
  code: 'کد',
  unit: 'واحد اندازه گیری',
  category: 'دسته‌بندی',
  reorder_point: 'نقطه سفارش',
  reorderPoint: 'نقطه سفارش',
  weighted_average_cost: 'قیمت میانگین',
  weightedAverageCost: 'قیمت میانگین',
  body: 'اطلاعات ارسالی',
  type: 'نوع',
  quantity: 'مقدار / تعداد',
  price: 'قیمت',
  document_type: 'نوع سند',
  docType: 'نوع سند',
  refNumber: 'شماره مرجع / فاکتور',
  items: 'اقلام',
  image: 'تصویر',
  thumbnail: 'تصویر کوچک',
  date: 'تاریخ',
  startDate: 'تاریخ شروع',
  endDate: 'تاریخ پایان',
  start_date: 'تاریخ شروع',
  end_date: 'تاریخ پایان',
  start_time: 'ساعت شروع',
  end_time: 'ساعت پایان',
  startTime: 'ساعت شروع',
  endTime: 'ساعت پایان',
  work_mode: 'نحوه حضور',
  workMode: 'نحوه حضور',
  work_hours: 'ساعات کارکرد',
  workHours: 'ساعات کارکرد',
  firstName: 'نام',
  lastName: 'نام خانوادگی',
  fullName: 'نام و نام خانوادگی',
  full_name: 'نام و نام خانوادگی',
  personnelCode: 'کد پرسنلی',
  nationalId: 'کد ملی',
  phone: 'شماره تلفن',
  jobTitle: 'عنوان شغلی',
  employmentStatus: 'وضعیت همکاری',
  cardNumber: 'شماره کارت',
  accountNumber: 'شماره حساب',
  shebaNumber: 'شماره شبا',
  bankName: 'نام بانک',
  customRate: 'نرخ اختصاصی',
  defaultRate: 'نرخ پیش‌فرض',
  unitRate: 'نرخ واحد',
  totalAmount: 'مبلغ کل',
  payrollNumber: 'شماره فیش',
  status: 'وضعیت',
  priority: 'اولویت',
  customer_id: 'شناسه مشتری',
  customerId: 'شناسه مشتری',
  customerName: 'نام مشتری',
  customer_name: 'نام مشتری',
  item_id: 'شناسه کالا',
  itemId: 'شناسه کالا',
  projectCode: 'کد پروژه',
  project_code: 'کد پروژه',
  stage_order: 'ترتیب مرحله',
  stageOrder: 'ترتیب مرحله',
  progress_percent: 'درصد پیشرفت',
  progressPercent: 'درصد پیشرفت',
  estimatedValue: 'ارزش تخمینی',
  estimated_value: 'ارزش تخمینی',
  activityDate: 'تاریخ اقدام',
  activity_date: 'تاریخ اقدام',
  nextFollowUpDate: 'تاریخ سررسید پیگیری',
  next_followup_date: 'تاریخ سررسید پیگیری',
  nextFollowUpTask: 'عنوان کار پیگیری',
  next_followup_task: 'عنوان کار پیگیری',
  assignedTo: 'مسئول ارجاع',
  assigned_to: 'مسئول ارجاع',
  username: 'نام کاربری',
  password: 'رمز عبور',
  role: 'نقش کاربر',
  permissions: 'مجوزهای دسترسی',
  description: 'توضیحات',
  notes: 'یادداشت',
  manager_notes: 'یادداشت مدیریتی',
  rejectionReason: 'دلیل عدم تأیید',
  rejection_reason: 'دلیل عدم تأیید',
  settings: 'تنظیمات',
  key: 'کلید تنظیم',
  value: 'مقدار تنظیم',
  prefix: 'پیشوند کد',
  mode: 'حالت',
  id: 'شناسه',
  userId: 'شناسه کاربر',
  user_id: 'شناسه کاربر',
  documentId: 'شناسه سند',
  document_id: 'شناسه سند',
  personnelId: 'شناسه پرسنل',
  leadId: 'شناسه پرونده فروش',
  activityId: 'شناسه فعالیت',
  taskId: 'شناسه کار',
  payrollId: 'شناسه فیش حقوقی',
  ruleId: 'شناسه قانون',
  webhookId: 'شناسه وب‌هوک',
  draftId: 'شناسه پیش‌نویس',
  voucherId: 'شناسه سند حسابداری',
  accountId: 'شناسه حساب',
  warehouseId: 'شناسه انبار',
  categoryId: 'شناسه دسته‌بندی',
  // v9.0.78 (TD-529): برچسب‌های فرم‌های کاربر، ورود و راه‌اندازی و فیلدهای پرتکرار
  current_password: 'رمز عبور فعلی',
  currentPassword: 'رمز عبور فعلی',
  new_password: 'رمز عبور تازه',
  newPassword: 'رمز عبور تازه',
  confirmPassword: 'تکرار رمز عبور',
  setupToken: 'کد راه‌اندازی',
  companyName: 'نام شرکت',
  warehouseName: 'نام انبار',
  address: 'نشانی',
  logo: 'نشان شرکت',
  currency: 'واحد پول',
  email: 'رایانامه',
  avatar: 'تصویر نمایه',
  avatarUrl: 'تصویر نمایه',
  avatar_url: 'تصویر نمایه',
  version: 'نسخه',
  reason: 'دلیل',
  amount: 'مبلغ',
  exchangeRate: 'نرخ ارز',
  exchange_rate: 'نرخ ارز',
  warehouse: 'انبار',
  warehouseCode: 'کد انبار',
  page: 'شماره صفحه',
  limit: 'تعداد در هر صفحه',
  search: 'عبارت جست‌وجو',
  fromDate: 'از تاریخ',
  toDate: 'تا تاریخ',
  method: 'روش پرداخت',
  bankAccountId: 'شناسه حساب بانکی',
  discount: 'تخفیف',
  vatPercent: 'درصد مالیات بر ارزش افزوده',
  unitPrice: 'قیمت واحد',
  isActive: 'وضعیت فعال بودن',
  query: 'پارامترهای جست‌وجو',
  params: 'پارامترهای نشانی',
  // v9.0.314 (TD-688): فیلدهای درخواست خرید
  requestedQty: 'مقدار درخواستی',
  unitPriceEstimate: 'برآورد قیمت واحد',
  itemName: 'نام کالا',
  itemCode: 'کد کالا',
  requiredDate: 'تاریخ نیاز',
  projectId: 'پروژه',
  // v9.0.337 (TD-719): فیلدهای وب‌هوک
  targetUrl: 'نشانی مقصد',
  secretKey: 'کلید امضا',
  customHeaders: 'سرآیندهای سفارشی',
  subscriptionId: 'اشتراک وب‌هوک',
};

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const toPersianDigits = (v: unknown): string => String(v).replace(/[0-9]/g, d => PERSIAN_DIGITS[Number(d)]).replace(/\./g, '٫');

/** نام فیلد خام issue: آخرین بخش غیرعددی مسیر (اندیس آرایه کنار گذاشته می‌شود) */
export function issueFieldKey(path: ReadonlyArray<PropertyKey> | undefined): string | null {
  const parts = (path ?? []).filter(p => typeof p === 'string') as string[];
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

/** برچسب فارسی فیلد یک مسیر */
export function fieldLabel(path: ReadonlyArray<PropertyKey> | undefined): string {
  const key = issueFieldKey(path);
  if (key === null) return 'ورودی';
  return FIELD_LABELS[key] ?? `«${key}»`;
}

const faFallback = z.locales.fa().localeError;

type ZodIssueLike = {
  code?: string;
  path?: PropertyKey[];
  input?: unknown;
  expected?: string;
  origin?: string;
  minimum?: number | bigint | Date;
  maximum?: number | bigint | Date;
  inclusive?: boolean;
  format?: string;
  divisor?: number;
};

function sizeMessage(label: string, iss: ZodIssueLike, big: boolean): string {
  const bound = big ? iss.maximum : iss.minimum;
  const n = bound instanceof Date ? '' : toPersianDigits(bound);
  const inclusive = iss.inclusive !== false;
  switch (iss.origin) {
    case 'string':
      if (!big && Number(bound) <= 1) return `${label} را وارد کنید`;
      return big ? `${label} حداکثر ${n} نویسه می‌تواند باشد` : `${label} باید دست‌کم ${n} نویسه باشد`;
    case 'array':
    case 'set':
      if (!big && Number(bound) <= 1) return `دست‌کم یک مورد برای ${label} وارد کنید`;
      return big ? `${label} حداکثر ${n} مورد می‌تواند داشته باشد` : `${label} باید دست‌کم ${n} مورد داشته باشد`;
    case 'number':
    case 'int':
    case 'bigint':
      if (big) return inclusive ? `${label} حداکثر ${n} می‌تواند باشد` : `${label} باید کمتر از ${n} باشد`;
      return inclusive ? `${label} باید دست‌کم ${n} باشد` : `${label} باید بیشتر از ${n} باشد`;
    case 'date':
      return big ? `${label} از بازه مجاز دیرتر است` : `${label} از بازه مجاز زودتر است`;
    default:
      return big ? `${label} بیش از اندازه مجاز است` : `${label} کمتر از اندازه مجاز است`;
  }
}

function typeMessage(label: string, iss: ZodIssueLike): string {
  if (iss.input === undefined || iss.input === null) return `${label} را وارد کنید`;
  switch (iss.expected) {
    case 'string': return `${label} باید متن باشد`;
    case 'number': return `${label} باید عدد باشد`;
    case 'int': return `${label} باید عدد صحیح باشد`;
    case 'bigint': return `${label} باید عدد صحیح باشد`;
    case 'boolean': return `${label} باید بله یا خیر باشد`;
    case 'array': return `${label} باید فهرستی از موارد باشد`;
    case 'object': return `ساختار ${label} درست نیست`;
    case 'date': return `${label} باید تاریخ درست باشد`;
    default: return `مقدار ${label} درست نیست`;
  }
}

function formatMessage(label: string, iss: ZodIssueLike): string {
  switch (iss.format) {
    case 'email': return `${label} را به شکل نشانی رایانامه درست وارد کنید`;
    case 'url': return `${label} را به شکل نشانی وب درست وارد کنید`;
    case 'date': case 'datetime': case 'time': return `${label} را به شکل تاریخ یا زمان درست وارد کنید`;
    default: return `قالب ${label} درست نیست`;
  }
}

/** پیام فارسی یک issue؛ برای کدی که این‌جا نیست پیام بسته فارسی Zod */
export function persianIssueMessage(issue: unknown): string {
  const iss = issue as ZodIssueLike;
  const label = fieldLabel(iss.path);
  switch (iss.code) {
    case 'invalid_type': return typeMessage(label, iss);
    case 'too_small': return sizeMessage(label, iss, false);
    case 'too_big': return sizeMessage(label, iss, true);
    case 'invalid_value': return `یکی از گزینه‌های مجاز را برای ${label} انتخاب کنید`;
    case 'invalid_format': return formatMessage(label, iss);
    case 'not_multiple_of': return `${label} باید مضربی از ${toPersianDigits(iss.divisor)} باشد`;
    case 'unrecognized_keys': return `داده‌های ناشناخته‌ای در ${label} فرستاده شده است؛ فقط داده‌های همین فرم را بفرستید`;
    case 'invalid_union':
    case 'invalid_key':
    case 'invalid_element':
    case 'custom':
      return `مقدار ${label} درست نیست`;
    default: {
      const fallback = faFallback(issue as Parameters<typeof faFallback>[0]);
      return typeof fallback === 'string' ? fallback : (fallback?.message ?? `مقدار ${label} درست نیست`);
    }
  }
}
