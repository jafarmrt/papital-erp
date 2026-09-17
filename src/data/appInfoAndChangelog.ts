import { SYSTEM_UPDATES, type AIUpdateLog } from './changelogs';

export type { AIUpdateLog };
export { SYSTEM_UPDATES };

export interface AppFeature {
  id: string;
  title: string;
  description: string;
  category: 'انبارداری' | 'مالی و فاکتور' | 'پروژه و تولید' | 'مشتریان و CRM' | 'سیستمی و امنیت' | 'گزارش‌گیری';
  iconName: string;
}

export interface TechStackItem {
  name: string;
  version?: string;
  role: string;
  category: 'فرانت‌اند (Frontend)' | 'بک‌اند (Backend)' | 'پایگاه‌داده و ذخیره‌سازی' | 'امنیت و یکپارچه‌سازی';
  badgeColor?: string;
}

export const APP_FEATURES: AppFeature[] = [
  {
    id: 'double-entry-accounting',
    title: 'حسابداری دوبل و دفاتر استاندارد مالی',
    description: 'کدینگ ۴ سطحی حساب‌ها، دفتر روزنامه، دفتر کل، تراز آزمایشی، سود و زیان، ترازنامه و صدور هوشمند اسناد دوبل با کلیدهای میانبر و تراز خودکار.',
    category: 'مالی و فاکتور',
    iconName: 'FileText'
  },
  {
    id: 'trial-balance-4level',
    title: 'تراز آزمایشی ۴ سطحی، دفتر روزنامه و نسبت‌های مالی',
    description: 'مشاهده یکپارچه ساختار درختی گروه، کل، معین و تفصیلی بدون نیاز به فیلتر دستی، ترازهای ۲، ۴، ۶ و ۸ ستونی، دفتر روزنامه رسمی متوالی و داشبورد نسبت‌های نقدینگی و سودآوری.',
    category: 'مالی و فاکتور',
    iconName: 'Scale'
  },
  {
    id: 'inventory-accounting-segregation',
    title: 'تفکیک حسابداری موجودی مواد اولیه و محصولات ساخته‌شده',
    description: 'انتساب هوشمند و خودکار اقلام رسید خرید و رسید تولید به سرفصل‌های معین ۱۴۰۱ (مواد اولیه) و ۱۴۰۳ (محصولات نهایی) و بستانکار دقیق در حواله‌های خروج و ضایعات.',
    category: 'مالی و فاکتور',
    iconName: 'Boxes'
  },
  {
    id: 'treasury-cheques',
    title: 'خزانه‌داری متمرکز و ردیابی چک صیادی',
    description: 'مدیریت حساب‌های بانکی، صندوق و تنخواه‌گردان، گردش و رهگیری چک‌های صیادی و صدور خودکار سند تراکنش‌های خزانه.',
    category: 'مالی و فاکتور',
    iconName: 'Landmark'
  },
  {
    id: 'fiscal-closing',
    title: 'بستن خودکار سال مالی و اسناد افتتاحیه/اختتامیه',
    description: 'بستن مکانیزه حساب‌های موقت به سود و زیان جاری، محاسبه سود/زیان ویژه و صدور اسناد اختتامیه و افتتاحیه سال جدید.',
    category: 'مالی و فاکتور',
    iconName: 'Lock'
  },
  {
    id: 'multi-warehouse',
    title: 'مدیریت چند انباره متمرکز',
    description: 'تعریف و مدیریت چندین انبار مجزا همراه با ردیابی موجودی به تفکیک انبار و ثبت اسناد انتقال بین انبارها.',
    category: 'انبارداری',
    iconName: 'Building2'
  },
  {
    id: 'project-management',
    title: 'مدیریت پروژه‌ها و مراحل تولید کارگاهی',
    description: 'برنامه‌ریزی پروژه‌های تولیدی، تخصیص مواد اولیه، رزرو کالا در انبار و رهگیری مراحل کارگاهی (برش، چاپ، پخت، بسته‌بندی).',
    category: 'پروژه و تولید',
    iconName: 'Layers'
  },
  {
    id: 'crm-sales',
    title: 'مدیریت ارتباط با مشتریان (CRM)',
    description: 'قیچی فروش و کانبان لیدها، پرونده کامل مشتری، ثبت فعالیت‌ها و پیگیری‌ها همراه با تبدیل مستقیم لید به پیش‌فاکتور.',
    category: 'مشتریان و CRM',
    iconName: 'Users'
  },
  {
    id: 'wac-pricing',
    title: 'محاسبه قیمت تمام‌شده (WAC) و استراتژی فروش',
    description: 'محاسبه خودکار میانگین موزون قیمت تمام‌شده (Weighted Average Cost) و تعیین قیمت بر اساس سطوح مختلف مشتریان.',
    category: 'مالی و فاکتور',
    iconName: 'Calculator'
  },
  {
    id: 'invoicing-remittance',
    title: 'صدور فاکتور رسمی و حواله خروج',
    description: 'ثبت و صدور انواع فاکتور فروش، پیش‌فاکتور، حواله خروج و رسید ورود کالا با فرمت استاندارد چاپ و لوگوی اختصاصی.',
    category: 'مالی و فاکتور',
    iconName: 'FileOutput'
  },
  {
    id: 'multi-currency',
    title: 'پشتیبانی کامل از چند ارز',
    description: 'امکان قیمت‌گذاری و ثبت اسناد به ارزهای مختلف (ریال، دلار، یورو، درهم، پوند) همراه با فرمت‌دهی خودکار.',
    category: 'مالی و فاکتور',
    iconName: 'DollarSign'
  },
  {
    id: 'transfers-album',
    title: 'آلبوم و شناسایی کدهای ترنسفر',
    description: 'شناسایی هوشمند کدهای ترنسفر از روی SKU محصولات (مانند 003)، آپلود تصاویر طرح‌ها و مشاهده کارهای مرتبط.',
    category: 'انبارداری',
    iconName: 'Sparkles'
  },
  {
    id: 'woocommerce-integration',
    title: 'یکپارچه‌سازی آنلاین ووکامرس',
    description: 'دریافت وب‌هوک سفارشات ووکامرس، صدور خودکار فاکتور فروش و کسر هوشمند موجودی انبار بر اساس SKU.',
    category: 'سیستمی و امنیت',
    iconName: 'ShoppingCart'
  },
  {
    id: 'unified-excel',
    title: 'مدیریت یکپارچه ورودی/خروجی اکسل',
    description: 'خروجی کامل محصولات، قیمت‌ها و موجودی‌ها در قالب اکسل و بروزرسانی دسته‌جمعی داده‌ها با اعتبارسنجی خطاسنج.',
    category: 'انبارداری',
    iconName: 'FileSpreadsheet'
  },
  {
    id: 'reorder-alerts',
    title: 'هشدار آستانه سفارش مجدد',
    description: 'پایش هوشمند موجودی اقلام و نمایش لیست کالاهای نیازمند تامین به همراه محاسبه کسری متمرکز مواد اولیه.',
    category: 'گزارش‌گیری',
    iconName: 'AlertTriangle'
  },
  {
    id: 'inventory-audit',
    title: 'انبارگردانی دوره‌ای و مغایرت‌گیری',
    description: 'ماژول اختصاصی ثبت شمارش واقعی انبار، ثبت اتوماتیک مغایرت‌های اضافه/کسری و اصلاح خودکار موجودی.',
    category: 'انبارداری',
    iconName: 'ClipboardList'
  },
  {
    id: 'daily-logs',
    title: 'ثبت روزانه گزارش کار و یادداشت‌ها',
    description: 'ثبت گزارش‌های روزانه پرسنل، امکان منشن کردن کاربران، هشتگ‌گذاری موضوعی و نمایش در تایم‌لاین.',
    category: 'گزارش‌گیری',
    iconName: 'BookOpen'
  },
  {
    id: 'gallery-upload',
    title: 'گالری تصویری و ذخیره‌سازی فایل',
    description: 'آپلود تصویر کالاها، ذخیره‌سازی روی دیسک سرور (public/uploads) و نمایش شبکه‌ای در گالری با فیلتر پیشرفته.',
    category: 'انبارداری',
    iconName: 'Image'
  },
  {
    id: 'system-health',
    title: 'عیب‌یابی و تست سلامت سیستم (System Health)',
    description: 'تست لحظه‌ای اتصال به پایگاه‌داده PostgreSQL، دسترسی نوشتن به پوشه ذخیره‌سازی، وضعیت SSL و میزان مصرف RAM.',
    category: 'سیستمی و امنیت',
    iconName: 'Activity'
  },
  {
    id: 'access-control',
    title: 'سطوح دسترسی و مدیریت کاربران',
    description: 'تفکیک نقش‌های کاربری (مدیر، انباردار، کاربر عادی)، امنیت احراز هویت با JWT و رمزنگاری کلمه عبور.',
    category: 'سیستمی و امنیت',
    iconName: 'ShieldCheck'
  },
  {
    id: 'visual-workflow-designer',
    title: 'طراح بصری ورک‌فلو و موتور فرآیندها (Visual Workflow Engine)',
    description: 'طراح بوم بصری چرخه‌های کاری، تعریف حالات و گذارها، کارتابل متمرکز تاییدات و نگهداری اسنپ‌شات تغییرناپذیر DSL برای اسناد در جریان.',
    category: 'سیستمی و امنیت',
    iconName: 'GitMerge'
  },
  {
    id: 'workflow-rule-engine',
    title: 'موتور پیشرفته ارزیابی قوانین شرطی (Advanced Rule Engine)',
    description: 'ارزیابی هوشمند قوانین شرطی چندمتغیره با منطق AND و OR روی کلیه اسناد ERP (فاکتور، کالا، پروژه، مشتری و اسناد مالی) جهت تاییدات مشروط.',
    category: 'سیستمی و امنیت',
    iconName: 'Cpu'
  },
  {
    id: 'workflow-versioning-rollback',
    title: 'مدیریت نسخ تعاریف فرآیند و بازگردانی (Workflow Versioning & Rollback)',
    description: 'ثبت تاریخچه تغییرناپذیر نسخه تعاریف فرآیندها در دیتابیس و قابلیت بازگردانی (Rollback) اتمیک بدون آسیب به نمونه‌های فعال.',
    category: 'سیستمی و امنیت',
    iconName: 'History'
  },
  {
    id: 'audit-log-sanitization',
    title: 'سیستم ممیزی پیشرفته و ماسک هوشمند داده‌ها (Audit Trail)',
    description: 'ثبت اسنپ‌شات کامل قبل و بعد تغییرات حساس در سیستم به همراه ماسک اتوماتیک کلمات عبور، توکن‌ها و کوکی‌ها با [PROTECTED].',
    category: 'سیستمی و امنیت',
    iconName: 'FileCheck'
  },
  {
    id: 'schema-diagnostics',
    title: 'عیب‌یابی خودکار اسکیما و سنجش صحت دیتابیس (Schema Health Diagnostics)',
    description: 'سنجش خودکار تطابق اسکیماهای Drizzle با مایگریشن‌های PostgreSQL، اعتبارسنجی فیلدهای مالی NUMERIC(18,4) و خودترمیم‌سازی اتصال دیتابیس.',
    category: 'سیستمی و امنیت',
    iconName: 'Database'
  },
  {
    id: 'domain-event-bus',
    title: 'گذرگاه رویداد دامنه و الگوی Transactional Outbox',
    description: 'انتشار اتمیک رویدادهای کسب‌وکار در داخل تراکنش‌های پایگاه‌داده، تضمین تحویل حداقل یک‌بار با ورکر پس‌زمینه و ارسال وب‌هوک با امضای HMAC-SHA256.',
    category: 'سیستمی و امنیت',
    iconName: 'Radio'
  },
  {
    id: 'dead-letter-queue-eventsourcing',
    title: 'صف پیام‌های مرده (DLQ) و بازسازی کاردکس رویدادمحور',
    description: 'قرنطینه خودکار رویدادهای خطا پس از ۵ تلاش، بازپخش دستی و شبیه‌سازی‌شده (Dry-Run)، و بازسازی موجودی و تاریخچه کاردکس از جریان رویدادها.',
    category: 'سیستمی و امنیت',
    iconName: 'ShieldAlert'
  },
  {
    id: 'automated-test-suite',
    title: 'سوئیت آزمون‌های جامع ۱۵ سناریویی (Automated E2E Test Suite)',
    description: 'مجموعه آزمون‌های اتوماتیک همنوایی قفل رکوردها، قراردادهای امضای چندگانه، اعتبارسنجی تراز مالی، وب‌هوک‌ها و عدم دسترسی غیرمجاز در CLI و پنل ادمین.',
    category: 'سیستمی و امنیت',
    iconName: 'CheckCircle'
  }
];

export const TECH_STACK: TechStackItem[] = [
  { name: 'React 19', role: 'کتابخانه پیشرفته ساخت رابط کاربری با کامپایلر نسل جدید و کارایی فوق‌العاده', category: 'فرانت‌اند (Frontend)' },
  { name: 'TanStack Query v5', role: 'مدیریت داده‌ها، کشینگ هوشمند، همگام‌سازی پس‌زمینه و ابطال خودکار کش', category: 'فرانت‌اند (Frontend)' },
  { name: 'TypeScript', role: 'توسعه مطمئن با تایپینگ قوی و جلوگیری از خطاهای زمان اجرا', category: 'فرانت‌اند (Frontend)' },
  { name: 'Vite', role: 'ابزار ساخت و کامپایل سریع و بهینه‌سازی دارایی‌ها', category: 'فرانت‌اند (Frontend)' },
  { name: 'Tailwind CSS v4', role: 'فریم‌ورک استایل‌دهی هوشمند و پاسخ‌گو (Responsive) با متغیرهای مدرن', category: 'فرانت‌اند (Frontend)' },
  { name: 'Lucide React', role: 'مجموعه آیکون‌های وکتور استاندارد و مدرن', category: 'فرانت‌اند (Frontend)' },
  { name: 'Motion (v12+)', role: 'موتور انیمیشن‌های روان و انتقال نماها منطبق با React 19', category: 'فرانت‌اند (Frontend)' },
  { name: 'Recharts', role: 'کتابخانه نمودارسازی داده‌ها و گزارش‌های آماری', category: 'فرانت‌اند (Frontend)' },
  { name: 'Node.js & Express', role: 'سرور مقیاس‌پذیر و مدیریت مسیرهای RESTful API با میدل‌ورهای امنیتی', category: 'بک‌اند (Backend)' },
  { name: 'Drizzle ORM', role: 'ارتباط نوع‌دار و سریع با پایگاه‌داده بدون کوئری‌های خام ناامن', category: 'بک‌اند (Backend)' },
  { name: 'Zod Validation', role: 'اعتبارسنجی دقیق داده‌های ورودی API بر اساس اسکیما', category: 'بک‌اند (Backend)' },
  { name: 'Workflow Engine Core', role: 'موتور تراکنشی چرخه‌های کاری با قفل‌گذاری همنوایی SELECT FOR UPDATE و اسنپ‌شات DSL تغییرناپذیر', category: 'بک‌اند (Backend)' },
  { name: 'DomainEventBus & Outbox', role: 'گذرگاه مرکزی رویدادها با بافر تلمتری، ثبت اتمیک در Outbox و بازپخش خطایابی', category: 'بک‌اند (Backend)' },
  { name: 'Workflow Rule Engine', role: 'موتور ارزیابی قوانین شرطی بر پایه منطق AND/OR و استخراج زمینه داده‌ای ERP', category: 'بک‌اند (Backend)' },
  { name: 'DocumentService Engine', role: 'موتور متمرکز تراکنش‌های انبار، محاسبه WAC و حرکت کالایی با تفکیک ۱۴۰۱ و ۱۴۰۳', category: 'بک‌اند (Backend)' },
  { name: 'Accounting & Ledger Engine', role: 'موتور متمرکز صدور اسناد دوبل، تراز خودکار ۴ سطحی و محاسبات صورت‌های مالی اساسی', category: 'بک‌اند (Backend)' },
  { name: 'PostgreSQL', role: 'پایگاه‌داده رابطه‌ای قدرتمند برای نگهداری مطمئن داده‌های انبار، دفاتر دوبل و تراکنش‌ها', category: 'پایگاه‌داده و ذخیره‌سازی' },
  { name: 'FileSystem Storage', role: 'ذخیره‌سازی بهینه تصاویر روی دیسک سرور در مسیر public/uploads', category: 'پایگاه‌داده و ذخیره‌سازی' },
  { name: 'JSONB Multi-Location', role: 'ساختار نوین ذخیره‌سازی موجودی به تفکیک انبار در ستون‌های JSONB', category: 'پایگاه‌داده و ذخیره‌سازی' },
  { name: 'Workflow Versioning Storage', role: 'ذخیره‌سازی افزایشی و تغییرناپذیر نسخه‌های DSL در جدول workflow_definition_versions', category: 'پایگاه‌داده و ذخیره‌سازی' },
  { name: 'Dead Letter Queue Storage', role: 'جدول ذخیره‌سازی رخدادهای قرنطینه با ردیابی استک ارور و جزئیات بازپخش', category: 'پایگاه‌داده و ذخیره‌سازی' },
  { name: 'JWT & HttpOnly Cookies', role: 'احراز هویت امن توکن‌محور در کوکی‌های HttpOnly با الگوریتم Bcrypt', category: 'امنیت و یکپارچه‌سازی' },
  { name: 'HMAC-SHA256 Webhooks', role: 'امضای رمزنگاری‌شده محموله‌های خروجی وب‌هوک و هدرهای یکتای تحویل جهت امنیت بالا', category: 'امنیت و یکپارچه‌سازی' },
  { name: 'Audit Trail & Masking Engine', role: 'ممیزی جامع قبل و بعد تغییرات همراه با پاک‌سازی هوشمند کلمات عبور و توکن‌ها', category: 'امنیت و یکپارچه‌سازی' },
  { name: 'WooCommerce Webhooks', role: 'پردازش خودکار رویدادهای سفارش فروشگاه آنلاین با تطابق خودکار SKU و صدور فاکتور', category: 'امنیت و یکپارچه‌سازی' },
  { name: 'Intl Jalali & Currency', role: 'بومی‌سازی کامل تاریخ هجری شمسی و فرمت‌دهی خودکار چند ارز', category: 'امنیت و یکپارچه‌سازی' }
];

export const getLatestAppVersion = (): string => {
  if (SYSTEM_UPDATES && SYSTEM_UPDATES.length > 0) {
    const latest = SYSTEM_UPDATES[0].version;
    return latest.startsWith('v') ? latest : `v${latest}`;
  }
  return 'v4.0.0';
};
