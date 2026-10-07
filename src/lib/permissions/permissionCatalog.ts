/**
 * v9.0.86 (TD-880، مدل مجوز §۴.۲، تصمیم ت۱ و مدل مجوز تأییدشده): کاتالوگ مجوز یک فایل مشترک سرور و مرورگر است.
 * هر کلید عنوان، توضیح و گروه دارد و کلیدی که بی کلید دیگری بی‌معناست آن را در `requires` نام می‌برد (هر کار یک بخش
 * به «مشاهده» همان بخش نیاز دارد). سرور هنگام ذخیره نقش نیازها را می‌افزاید (`withRequiredPermissions`) و فرم نقش با
 * تیک زدن یک مجوز نیازهایش را می‌زند و با برداشتن آن، مجوزهای وابسته را برمی‌دارد (`withoutPermission`).
 * این فایل به چیزی از سرور یا مرورگر وابسته نیست.
 */

/** تنها نقشی که کد برنامه به نامش می‌شناسد: «مدیر سیستم» همیشه همه مجوزها را دارد (مدل مجوز §۴.۱ قاعده ۳) */
export const SYSTEM_ADMIN_ROLE = 'admin';

/** کد نقش «مدیر سیستم» است، بی‌توجه به فاصله و بزرگی حروف */
export function isSystemAdminRole(role: string | null | undefined): boolean {
  return (role ?? '').trim().toLowerCase() === SYSTEM_ADMIN_ROLE;
}

export interface PermissionDefinition {
  readonly key: string;
  readonly title: string;
  readonly description: string;
  /** کلیدهایی که این مجوز بی آن‌ها کار نمی‌کند؛ ذخیره نقش آن‌ها را هم می‌افزاید */
  readonly requires?: readonly string[];
}

export interface PermissionGroupDefinition {
  readonly category: string;
  readonly permissions: readonly PermissionDefinition[];
}

export const PERMISSION_CATALOG: readonly PermissionGroupDefinition[] = [
  {
    category: 'مدیریت کالا و محصولات',
    permissions: [
      { key: 'products.view', title: 'مشاهده کالاها و موجودی', description: 'دسترسی به لیست کالاها، جزئیات و قیمت‌ها' },
      { key: 'products.create', title: 'تعریف کالای جدید', description: 'امکان اضافه کردن کالا و محصول جدید به انبار', requires: ['products.view'] },
      { key: 'products.edit', title: 'ویرایش اطلاعات کالا', description: 'تغییر عنوان، کد، وزن، رنگ و تصویر کالاها', requires: ['products.view'] },
      { key: 'products.edit_price', title: 'ویرایش قیمت‌ها', description: 'تغییر قیمت‌های خرید و فروش کالا', requires: ['products.view'] },
      { key: 'products.delete', title: 'حذف کالا', description: 'امکان حذف نرم کالا از سیستم', requires: ['products.view'] },
    ]
  },
  {
    category: 'انبارداری و جابجایی',
    permissions: [
      { key: 'warehouse.view', title: 'مشاهده انبارها', description: 'مشاهده لیست انبارها و موجودی تفکیکی' },
      { key: 'warehouse.manage', title: 'تعریف و ویرایش انبارها', description: 'افزودن، ویرایش و حذف انبارها', requires: ['warehouse.view'] },
      { key: 'warehouse.in', title: 'ثبت ورود کالا (رسید)', description: 'افزایش موجودی و ثبت رسیدهای ورودی', requires: ['warehouse.view'] },
      { key: 'warehouse.out', title: 'ثبت خروج کالا (حواله)', description: 'کاهش موجودی و ثبت حواله‌های خروجی', requires: ['warehouse.view'] },
      { key: 'warehouse.transfer', title: 'جابجایی بین انبارها', description: 'انتقال کالا از یک انبار به انبار دیگر', requires: ['warehouse.view'] },
      // v8.0.4 (TD-257، تصمیم مالک محصول): استثنای قاعده تاریخ سند انبار؛ پیش‌فرض به هیچ نقشی داده نمی‌شود
      { key: 'warehouse.backdate', title: 'ثبت سند انبار با تاریخ گذشته', description: 'ثبت گردش با تاریخی پیش از آخرین گردش کالا، فقط وقتی موجودی انبار در آن تاریخ و پس از آن منفی نشود', requires: ['warehouse.view'] },
      { key: 'inventory.reconcile', title: 'ممیزی کاردکس و بازسازی انبار', description: 'اجرای بازسازی انبار و تطبیق تراکنش‌ها با لاگ کاردکس', requires: ['warehouse.view'] },
      // v9.0.90 (TD-487، تصمیم ت۳): اصلاح WAC از بازپخش کاردکس با سند پیش‌نویس اختلاف ارزش؛ پیش‌فرض به هیچ نقشی داده نمی‌شود
      { key: 'inventory.wac_correct', title: 'اصلاح میانگین بها از کاردکس', description: 'برابر کردن میانگین بهای کالا با بازپخش کاردکس، همراه با سند پیش‌نویس اختلاف ارزش در برابر «کسری و اضافات انبار»', requires: ['warehouse.view'] },
    ]
  },
  {
    category: 'اسناد و فاکتورها',
    permissions: [
      { key: 'documents.view', title: 'مشاهده فاکتورها', description: 'مشاهده لیست فاکتورهای فروش و پیش‌فاکتورها' },
      { key: 'documents.create', title: 'صدور فاکتور و پیش‌فاکتور', description: 'ثبت پیش‌نویس و پیش‌فاکتور فروش و برگشت از فروش', requires: ['documents.view'] },
      // v9.0.108 (TD-541 / TD-771، تصمیم ت۱ بسته ۸): جای قاعده «کاربر فروش فقط پیش‌فاکتور» که با کد نقش نوشته شده بود
      { key: 'documents.finalize', title: 'قطعی کردن سند فروش', description: 'ثبت قطعی یا نهایی کردن فاکتور، پیش‌فاکتور و برگشت از فروش، با کسر یا افزایش موجودی و صدور سند حسابداری', requires: ['documents.view'] },
      { key: 'documents.edit', title: 'ویرایش فاکتورها', description: 'اصلاح اقلام و مشخصات فاکتورهای صادرشده', requires: ['documents.view'] },
      { key: 'documents.delete', title: 'حذف فاکتور', description: 'حذف فاکتور و برگشت خودکار موجودی کالاها', requires: ['documents.view'] },
    ]
  },
  {
    category: 'انبارگردانی',
    permissions: [
      { key: 'audit.view', title: 'مشاهده انبارگردانی', description: 'مشاهده دوره‌ها و لاگ‌های انبارگردانی' },
      { key: 'audit.create', title: 'شروع دوره انبارگردانی', description: 'ثبت شمارش واقعی فیزیکی کالاها', requires: ['audit.view'] },
      { key: 'audit.apply', title: 'اعمال و تسویه مغایرت', description: 'تأیید نهایی و اصلاح خودکار موجودی انبار', requires: ['audit.view'] },
    ]
  },
  {
    category: 'مدیریت مشتریان',
    permissions: [
      { key: 'customers.view', title: 'مشاهده لیست مشتریان', description: 'مشاهده اطلاعات تماس و سوابق خریداران' },
      { key: 'customers.manage', title: 'مدیریت کامل مشتریان', description: 'افزودن، ویرایش و حذف خریداران', requires: ['customers.view'] },
    ]
  },
  {
    category: 'کنترل پروژه‌های تولید',
    permissions: [
      { key: 'projects.view', title: 'مشاهده پروژه‌ها و مراحل', description: 'دسترسی به لیست پروژه‌ها، گانت چارت، تخته کانبان و مراحل تولید' },
      { key: 'projects.create', title: 'تعریف پروژه تولید جدید', description: 'ایجاد پروژه، تعیین کد مشتری و کد کالا و مراحل پیش‌فرض', requires: ['projects.view'] },
      { key: 'projects.edit', title: 'ویرایش پروژه و مراحل تولید', description: 'تغییر وضعیت، پیشرفت، زمان‌بندی، تخصیص پرسنل و منابع هر مرحله', requires: ['projects.view'] },
      { key: 'projects.delete', title: 'حذف پروژه تولید', description: 'حذف پروژه و مراحل مرتبط با آن', requires: ['projects.view'] },
    ]
  },
  {
    category: 'جریان‌های کاری و کارتابل تاییدات (Workflow)',
    permissions: [
      { key: 'workflow.view', title: 'مشاهده فرآیندها و کارتابل تاییدات', description: 'دسترسی به کارتابل وظایف، مشاهده وضعیت فرآیندها و سوابق امضاها' },
      { key: 'workflow.execute', title: 'شروع و اجرای فرآیندها', description: 'امکان شروع نمونه فرآیند کاری جدید بر روی اسناد و موجودیت‌ها', requires: ['workflow.view'] },
      { key: 'workflow.approve', title: 'تایید و رد درخواست‌ها در کارتابل', description: 'امکان امضا، تایید یا رد درخواست‌ها در کارتابل و فرآیندهای مجاز', requires: ['workflow.view'] },
      { key: 'workflow.manage', title: 'مدیریت و طراحی جریان‌های کاری', description: 'طراحی گرافیکی فرآیندها، نسخه‌بندی DSL، قوانین Rule Engine و تحلیل SLA', requires: ['workflow.view'] },
      { key: 'workflow.admin', title: 'مدیریت ارشد و همگام‌سازی فرآیندها', description: 'همگام‌سازی الگوهای پیش‌فرض و مدیریت تنظیمات ساختاری فرآیندها', requires: ['workflow.view'] },
    ]
  },
  {
    category: 'گذرگاه رویدادها، صف Outbox و وب‌هوک‌ها',
    permissions: [
      { key: 'events.view', title: 'مشاهده رویدادها و صف Outbox', description: 'مشاهده لاگ رویدادهای دامنه، پیام‌های Outbox و پیام‌های قرنطینه (DLQ)' },
      { key: 'events.manage', title: 'مدیریت قوانین رویدادها و وب‌هوک‌ها', description: 'تعریف اکشن‌های خودکار، تنظیم اشتراک‌های وب‌هوک و Replay پیام‌های DLQ', requires: ['events.view'] },
    ]
  },
  {
    category: 'گزارش کار روزانه و اعلان‌ها',
    permissions: [
      { key: 'daily_logs.view', title: 'مشاهده گزارش کارهای روزانه', description: 'مشاهده گزارش کارهای عمومی، منشن‌شده و مجاز' },
      { key: 'daily_logs.create', title: 'ثبت و ویرایش گزارش کار روزانه', description: 'امکان ثبت، ویرایش و حذف گزارش کار روزانه خود', requires: ['daily_logs.view'] },
      { key: 'daily_logs.manage_all', title: 'مدیریت و نظارت کامل گزارش‌ها', description: 'مشاهده تمامی گزارش کارهای محرمانه و ثبت بازخورد و یادداشت مدیریتی', requires: ['daily_logs.view'] },
    ]
  },
  {
    category: 'ارتباط با مشتری و فروش',
    permissions: [
      { key: 'crm.view', title: 'مشاهده ارتباط با مشتری و قیف فروش', description: 'دسترسی به پرونده‌های فروش، قیف فروش، دفترچه تماس‌ها و پیگیری‌ها' },
      { key: 'crm.manage', title: 'مدیریت پرونده‌ها و تماس‌های ارتباط با مشتری', description: 'امکان ثبت، ویرایش، تغییر مراحل فروش و ثبت تماس‌ها و پیگیری‌ها', requires: ['crm.view'] },
      { key: 'crm.delete', title: 'حذف پرونده‌های فروش', description: 'امکان حذف پرونده‌های فروش و سوابق آن‌ها', requires: ['crm.view'] },
    ]
  },
  {
    category: 'مدیریت پرسنل و منابع انسانی',
    permissions: [
      { key: 'personnel.view', title: 'مشاهده لیست و پرونده پرسنل', description: 'دسترسی به مشاهده مشخصات فردی، شغلی و مهارت‌های پرسنل؛ اطلاعات بانکی با پوشش' },
      { key: 'personnel.manage', title: 'مدیریت کامل پرسنل', description: 'امکان ثبت، ویرایش، قطع همکاری و حذف مشخصات پرسنل؛ اطلاعات بانکی پرونده و فیش را بی پوشش می‌بیند', requires: ['personnel.view'] },
      // v9.0.109 (TD-882، مدل مجوز §۴.۲): پیش‌تر بیرون از کاتالوگ بود و کد نقش «مدیر» جای آن را می‌گرفت
      { key: 'personnel.view_sensitive', title: 'مشاهده اطلاعات بانکی پرسنل', description: 'شماره کارت، شبا، شماره حساب و نام کاربری نوبیتکس پرونده پرسنل بدون پوشش', requires: ['personnel.view'] },
    ]
  },
  {
    category: 'دستمرزد و کارهای پرکیسی (Piecework)',
    permissions: [
      { key: 'piecework.view', title: 'مشاهده تعرفه‌ها و گزارش‌های پرکیسی', description: 'مشاهده لیست عناوین کاری، نرخ‌ها، ثبت کارکردها و فیش‌های حقوقی' },
      { key: 'piecework.manage_tasks', title: 'مدیریت عناوین کاری و نرخ‌های پایه', description: 'تعریف و ویرایش کارهای پرکیسی، دسته‌بندی‌ها و نرخ پایه', requires: ['piecework.view'] },
      { key: 'piecework.log', title: 'ثبت و ویرایش کارکرد پرسنل', description: 'ثبت کارکرد روزانه پرسنل و تخصیص به پروژه‌ها', requires: ['piecework.view'] },
      { key: 'piecework.payroll', title: 'محاسبه و صدور فیش حقوقی', description: 'محاسبه کارکرد، کسر مساعده/مساعده و صدور تسویه‌حساب پرکیسی', requires: ['piecework.view'] },
      // v9.0.109 (TD-882): پیش‌تر بیرون از کاتالوگ بود و کد نقش «مدیر» جای آن را می‌گرفت
      { key: 'payroll.view_sensitive', title: 'مشاهده اطلاعات بانکی فیش‌ها', description: 'شماره کارت، شبا و نام کاربری نوبیتکس فیش‌های حقوق بدون پوشش', requires: ['piecework.view'] },
    ]
  },
  {
    category: 'مواد اولیه در انتظار تایید',
    permissions: [
      { key: 'pending_materials.view', title: 'مشاهده درخواست‌های مواد اولیه', description: 'مشاهده پیشنهادها و ثبت مواد اولیه توسط کاربران' },
      { key: 'pending_materials.approve', title: 'تایید و تبدیل به کالا/انبار', description: 'تایید درخواست‌های مواد اولیه و انتقال به انبار اصلی یا رد درخواست', requires: ['pending_materials.view'] },
      { key: 'pending_materials.delete', title: 'حذف درخواست مواد اولیه', description: 'حذف درخواست‌های مواد اولیه ثبت‌شده', requires: ['pending_materials.view'] },
    ]
  },
  {
    category: 'خرید و تدارکات (Procurement)',
    permissions: [
      { key: 'procurement.view', title: 'مشاهده درخواست‌های خرید و کارتابل تدارکات', description: 'مشاهده لیست درخواست‌های خرید، نیازمندی‌های پروژه‌ها و وضعیت تامین' },
      { key: 'procurement.create', title: 'ثبت درخواست خرید جدید', description: 'ثبت درخواست خرید دستی یا کسری کالا مستقل از پروژه‌ها', requires: ['procurement.view'] },
      { key: 'procurement.manage', title: 'مدیریت و استعلام تدارکات', description: 'بررسی درخواست‌ها، ثبت برآورد قیمت، تفکیک اقلام و تخصیص تامین‌کننده', requires: ['procurement.view'] },
      { key: 'procurement.order', title: 'صدور سفارش خرید قطعی و فاکتور خرید', description: 'تبدیل درخواست‌های خرید تاییدشده به اسناد و فاکتورهای خرید رسمی انبار', requires: ['procurement.view'] },
      { key: 'procurement.approve', title: 'تایید کارتابلی درخواست‌های خرید', description: 'تایید مراحل گردش کار درخواست‌های خرید جهت صدور سفارش قطعی', requires: ['procurement.view'] },
    ]
  },
  {
    category: 'حسابداری، اسناد مالی و خزانه‌داری',
    permissions: [
      { key: 'accounting.view', title: 'مشاهده اسناد و دفاتر حسابداری', description: 'دسترسی به اسناد دوبل، دفتر روزنامه، کل، معین و گزارش‌ها' },
      { key: 'accounting.vouchers', title: 'صدور و ویرایش اسناد حسابداری', description: 'امکان ثبت اسناد دوبل مالی، اصلاح و تأیید اسناد', requires: ['accounting.view'] },
      { key: 'accounting.coa', title: 'مدیریت کدینگ حساب‌ها (COA)', description: 'تعریف، ویرایش و حذف حساب‌های گروه، کل، معین و تفصیلی', requires: ['accounting.view'] },
      { key: 'accounting.treasury', title: 'عملیات خزانه‌داری (دریافت و پرداخت)', description: 'ثبت و پیگیری نقدینگی، حساب‌های بانکی، پوز و حواله‌ها', requires: ['accounting.view'] },
      { key: 'accounting.cheques', title: 'مدیریت دفتر چک صیادی', description: 'ثبت چک‌های دریافتی/پرداختی، تغییر وضعیت وصول، برگشت و واگذاری', requires: ['accounting.view'] },
      // v8.0.118 (TD-409، تصمیم مالک محصول): برای مانده‌های افتتاحیه؛ پیش‌فرض به هیچ نقشی داده نمی‌شود
      { key: 'accounting.treasury_no_voucher', title: 'ثبت خزانه و چک بدون سند حسابداری', description: 'ثبت دریافت، پرداخت، انتقال وجه یا چک بدون صدور سند حسابداری (مثلاً مانده افتتاحیه)؛ این موارد در بررسی سلامت مالی فهرست می‌شوند', requires: ['accounting.treasury'] },
      { key: 'accounting.reports', title: 'مشاهده تراز آزمایشی و صورت‌های مالی', description: 'مشاهده تراز آزمایشی، ترازنامه، صورت سود و زیان و کارت حساب', requires: ['accounting.view'] },
      { key: 'accounting.fiscal_close', title: 'اجرای بستن سال مالی', description: 'بستن حساب‌های موقت و دائم سال مالی و صدور اسناد اختتامیه و افتتاحیه سال بعد', requires: ['accounting.view'] },
    ]
  },
  {
    category: 'یکپارچه‌سازی فروشگاه آنلاین (WooCommerce)',
    permissions: [
      { key: 'woocommerce.view', title: 'مشاهده وضعیت اتصال و سفارشات ووکامرس', description: 'مشاهده همگام‌سازی محصولات، کدهای SKU و لاگ سفارشات واردشده' },
      { key: 'woocommerce.manage', title: 'تنظیمات API و همگام‌سازی دستی', description: 'تنظیم کلیدهای API ووکامرس، وب‌هوک‌ها و اجرای همگام‌سازی خودکار', requires: ['woocommerce.view'] },
    ]
  },
  {
    category: 'گزارش‌ها و لاگ فعالیت سیستم (Audit Trail)',
    permissions: [
      { key: 'reports.view', title: 'مشاهده گزارش‌ها و آمار', description: 'دسترسی به نمودارها، گزارش تراکنش‌ها و داشبورد' },
      { key: 'audit_logs.view', title: 'مشاهده دفترچه سوابق تغییرات', description: 'مشاهده لاگ ثبت، ویرایش، حذف و فعالیت‌های تمامی کاربران سیستم' },
    ]
  },
  {
    category: 'مدیریت سیستم و دسترسی‌ها',
    permissions: [
      { key: 'users.manage', title: 'مدیریت کاربران', description: 'تعریف کاربران جدید و تغییر رمز عبور' },
      { key: 'roles.manage', title: 'مدیریت نقش‌ها و ماتریس دسترسی', description: 'تعریف نقش‌های جدید و تنظیم مجوزهای تفکیکی' },
      { key: 'settings.manage', title: 'مدیریت تنظیمات عمومی', description: 'تنظیمات شرکت، لوگو و عیب‌یابی سلامت سرور' },
    ]
  }
];

export const PERMISSION_KEYS: readonly string[] = PERMISSION_CATALOG.flatMap(g => g.permissions.map(p => p.key));

const KEY_SET = new Set(PERMISSION_KEYS);
const DEFINITIONS = new Map(PERMISSION_CATALOG.flatMap(g => g.permissions.map(p => [p.key, p] as const)));

export function isCatalogPermission(key: string): boolean {
  return KEY_SET.has(key);
}

export function permissionDefinition(key: string): PermissionDefinition | undefined {
  return DEFINITIONS.get(key);
}

/** همه نیازهای یک کلید، مستقیم و غیرمستقیم، به ترتیب کاتالوگ (خود کلید نه) */
export function requiredPermissionsOf(key: string): string[] {
  const found = new Set<string>();
  const visit = (k: string) => {
    for (const r of DEFINITIONS.get(k)?.requires ?? []) {
      if (!found.has(r)) {
        found.add(r);
        visit(r);
      }
    }
  };
  visit(key);
  found.delete(key);
  return PERMISSION_KEYS.filter(k => found.has(k));
}

/** همه کلیدهایی که مستقیم یا غیرمستقیم به این کلید نیاز دارند، به ترتیب کاتالوگ */
export function dependentPermissionsOf(key: string): string[] {
  return PERMISSION_KEYS.filter(k => k !== key && requiredPermissionsOf(k).includes(key));
}

/**
 * فهرست مجوز با همه نیازهایش: ترتیب ورودی می‌ماند، تکراری حذف و نیازهای نبوده به ترتیب کاتالوگ افزوده می‌شوند.
 * کلید بیرون از کاتالوگ (ردیف قدیمی، TD-304) دست نمی‌خورد.
 */
export function withRequiredPermissions(keys: readonly string[]): string[] {
  const out = [...new Set(keys)];
  const have = new Set(out);
  const needed = new Set(out.flatMap(requiredPermissionsOf));
  for (const k of PERMISSION_KEYS) {
    if (needed.has(k) && !have.has(k)) out.push(k);
  }
  return out;
}

/** نیازهایی که در فهرست نیستند و ذخیره نقش می‌افزاید */
export function missingRequiredPermissions(keys: readonly string[]): string[] {
  const have = new Set(keys);
  return withRequiredPermissions(keys).filter(k => !have.has(k));
}

/** برداشتن یک مجوز همراه همه مجوزهای وابسته به آن */
export function withoutPermission(keys: readonly string[], key: string): string[] {
  const drop = new Set([key, ...dependentPermissionsOf(key)]);
  return [...new Set(keys)].filter(k => !drop.has(k));
}
