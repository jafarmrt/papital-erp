import { SYSTEM_UPDATES, type AIUpdateLog } from './changelogs';

export type { AIUpdateLog };
export { SYSTEM_UPDATES };

export interface AppFeature {
  id: string;
  title: string;
  description: string;
  category: 'انبارداری' | 'مالی و فاکتور' | 'پروژه و تولید' | 'مشتریان و ارتباط با مشتری' | 'سامانه و امنیت' | 'گزارش‌گیری';
  iconName: string;
}

export interface TechStackItem {
  name: string;
  version?: string;
  role: string;
  category: 'رابط کاربری' | 'کارساز' | 'پایگاه‌داده و ذخیره‌سازی' | 'امنیت و یکپارچه‌سازی';
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
    description: 'مشاهده یکپارچه ساختار درختی گروه، کل، معین و تفصیلی بدون نیاز به پالایش دستی، ترازهای ۲، ۴، ۶ و ۸ ستونی، دفتر روزنامه رسمی متوالی و پیشخوان نسبت‌های نقدینگی و سودآوری.',
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
    title: 'ارتباط با مشتری',
    description: 'قیف فروش پرونده‌ها، پرونده کامل مشتری، ثبت اقدام‌ها و پیگیری‌ها همراه با تبدیل مستقیم پرونده فروش به پیش‌فاکتور.',
    category: 'مشتریان و ارتباط با مشتری',
    iconName: 'Users'
  },
  {
    id: 'wac-pricing',
    title: 'محاسبه قیمت تمام‌شده (میانگین موزون بها) و راهبرد فروش',
    description: 'محاسبه خودکار میانگین موزون قیمت تمام‌شده و تعیین قیمت بر اساس سطوح مختلف مشتریان.',
    category: 'مالی و فاکتور',
    iconName: 'Calculator'
  },
  {
    id: 'invoicing-remittance',
    title: 'صدور فاکتور رسمی و حواله خروج',
    description: 'ثبت و صدور انواع فاکتور فروش، پیش‌فاکتور، حواله خروج و رسید ورود کالا با قالب استاندارد چاپ و نشان تجاری اختصاصی.',
    category: 'مالی و فاکتور',
    iconName: 'FileOutput'
  },
  {
    id: 'multi-currency',
    title: 'پشتیبانی کامل از چند ارز',
    description: 'امکان قیمت‌گذاری و ثبت اسناد به ارزهای مختلف (ریال، دلار، یورو، درهم، پوند) همراه با قالب‌بندی خودکار.',
    category: 'مالی و فاکتور',
    iconName: 'DollarSign'
  },
  {
    id: 'transfers-album',
    title: 'آلبوم و شناسایی کدهای ترنسفر',
    description: 'شناسایی هوشمند کدهای ترنسفر از روی SKU محصولات (مانند 003)، بارگذاری تصاویر طرح‌ها و مشاهده کارهای مرتبط.',
    category: 'انبارداری',
    iconName: 'Sparkles'
  },
  {
    id: 'woocommerce-integration',
    title: 'یکپارچه‌سازی برخط ووکامرس',
    description: 'دریافت وب‌هوک سفارشات ووکامرس، صدور خودکار فاکتور فروش و کسر هوشمند موجودی انبار بر اساس SKU.',
    category: 'سامانه و امنیت',
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
    description: 'پایش هوشمند موجودی اقلام و نمایش فهرست کالاهای نیازمند تامین به همراه محاسبه کسری متمرکز مواد اولیه.',
    category: 'گزارش‌گیری',
    iconName: 'AlertTriangle'
  },
  {
    id: 'inventory-audit',
    title: 'انبارگردانی دوره‌ای و مغایرت‌گیری',
    description: 'بخش اختصاصی ثبت شمارش واقعی انبار، ثبت خودکار مغایرت‌های اضافه/کسری و اصلاح خودکار موجودی.',
    category: 'انبارداری',
    iconName: 'ClipboardList'
  },
  {
    id: 'daily-logs',
    title: 'ثبت روزانه گزارش کار و یادداشت‌ها',
    description: 'ثبت گزارش‌های روزانه پرسنل، امکان اشاره به کاربران، برچسب‌گذاری موضوعی و نمایش در خط زمانی.',
    category: 'گزارش‌گیری',
    iconName: 'BookOpen'
  },
  {
    id: 'gallery-upload',
    title: 'گالری تصویری و ذخیره‌سازی فایل',
    description: 'بارگذاری تصویر کالاها، ذخیره‌سازی روی دیسک کارساز و نمایش شبکه‌ای در گالری با پالایش پیشرفته.',
    category: 'انبارداری',
    iconName: 'Image'
  },
  {
    id: 'system-health',
    title: 'عیب‌یابی و آزمون سلامت سامانه',
    description: 'آزمون لحظه‌ای اتصال به پایگاه‌داده PostgreSQL، دسترسی نوشتن به پوشه ذخیره‌سازی، وضعیت SSL و میزان مصرف حافظه.',
    category: 'سامانه و امنیت',
    iconName: 'Activity'
  },
  {
    id: 'access-control',
    title: 'سطوح دسترسی و مدیریت کاربران',
    description: 'تفکیک نقش‌های کاربری (مدیر، انباردار، کاربر عادی)، امنیت احراز هویت با JWT و رمزنگاری کلمه عبور.',
    category: 'سامانه و امنیت',
    iconName: 'ShieldCheck'
  },
  {
    id: 'visual-workflow-designer',
    title: 'طراح بصری گردش کار و موتور فرآیندها',
    description: 'طراح بوم بصری چرخه‌های کاری، تعریف حالات و گذارها، کارتابل متمرکز تاییدات و نگهداری تصویر لحظه‌ای تغییرناپذیر تعریف فرآیند برای اسناد در جریان.',
    category: 'سامانه و امنیت',
    iconName: 'GitMerge'
  },
  {
    id: 'workflow-rule-engine',
    title: 'موتور پیشرفته ارزیابی قوانین شرطی',
    description: 'ارزیابی هوشمند قوانین شرطی چندمتغیره با منطق «و» و «یا» روی کلیه اسناد ERP (فاکتور، کالا، پروژه، مشتری و اسناد مالی) جهت تاییدات مشروط.',
    category: 'سامانه و امنیت',
    iconName: 'Cpu'
  },
  {
    id: 'workflow-versioning-rollback',
    title: 'مدیریت نسخ تعاریف فرآیند و تاریخچه نسخه‌ها',
    description: 'ثبت تاریخچه تغییرناپذیر نسخه تعاریف فرآیندها در پایگاه‌داده، بی‌آنکه نمونه‌های در جریان آسیب ببینند؛ هر نمونه با همان نسخه‌ای که با آن آغاز شده ادامه می‌یابد.',
    category: 'سامانه و امنیت',
    iconName: 'History'
  },
  {
    id: 'audit-log-sanitization',
    title: 'سامانه ممیزی پیشرفته و پوشاندن هوشمند داده‌ها',
    description: 'ثبت تصویر کامل قبل و بعد تغییرات حساس در سامانه به همراه پوشاندن خودکار کلمات عبور، نشانه‌های ورود و کوکی‌ها.',
    category: 'سامانه و امنیت',
    iconName: 'FileCheck'
  },
  {
    id: 'schema-diagnostics',
    title: 'عیب‌یابی خودکار ساختار و سنجش صحت پایگاه‌داده',
    description: 'سنجش خودکار تطابق ساختار جدول‌ها با فایل‌های ارتقای پایگاه‌داده PostgreSQL، اعتبارسنجی ستون‌های مالی اعشاری و ترمیم خودکار اتصال پایگاه‌داده.',
    category: 'سامانه و امنیت',
    iconName: 'Database'
  },
  {
    id: 'domain-event-bus',
    title: 'گذرگاه رویداد دامنه و صندوق خروجی تراکنشی',
    description: 'انتشار یکپارچه رویدادهای کسب‌وکار در داخل تراکنش‌های پایگاه‌داده، تضمین تحویل حداقل یک‌بار با پردازشگر پس‌زمینه و ارسال وب‌هوک با امضای HMAC-SHA256.',
    category: 'سامانه و امنیت',
    iconName: 'Radio'
  },
  {
    id: 'dead-letter-queue-eventsourcing',
    title: 'صف پیام‌های مرده (DLQ) و بازسازی کاردکس رویدادمحور',
    description: 'قرنطینه خودکار رویدادهای خطا پس از ۵ تلاش، بازپخش دستی و آزمایشی، و بازسازی موجودی و تاریخچه کاردکس از جریان رویدادها.',
    category: 'سامانه و امنیت',
    iconName: 'ShieldAlert'
  },
  {
    id: 'automated-test-suite',
    title: 'مجموعه آزمون‌های جامع ۱۵ سناریویی',
    description: 'مجموعه آزمون‌های خودکار همروندی قفل رکوردها، قراردادهای امضای چندگانه، اعتبارسنجی تراز مالی، وب‌هوک‌ها و جلوگیری از دسترسی غیرمجاز در خط فرمان و پنل مدیریت.',
    category: 'سامانه و امنیت',
    iconName: 'CheckCircle'
  }
];

export const TECH_STACK: TechStackItem[] = [
  { name: 'React 19', role: 'کتابخانه پیشرفته ساخت رابط کاربری با کارایی بالا', category: 'رابط کاربری' },
  { name: 'TanStack Query v5', role: 'مدیریت داده‌ها، حافظه موقت هوشمند، همگام‌سازی پس‌زمینه و نوسازی خودکار حافظه موقت', category: 'رابط کاربری' },
  { name: 'TypeScript', role: 'توسعه مطمئن با نوع‌دهی قوی و جلوگیری از خطاهای زمان اجرا', category: 'رابط کاربری' },
  { name: 'Vite', role: 'ابزار ساخت سریع بسته برنامه و بهینه‌سازی فایل‌ها', category: 'رابط کاربری' },
  { name: 'Tailwind CSS v4', role: 'چارچوب ظاهرسازی هوشمند و سازگار با اندازه صفحه', category: 'رابط کاربری' },
  { name: 'Lucide React', role: 'مجموعه نمادهای برداری استاندارد و مدرن', category: 'رابط کاربری' },
  { name: 'Motion (v12+)', role: 'موتور پویانمایی روان و انتقال نماها منطبق با React 19', category: 'رابط کاربری' },
  { name: 'Recharts', role: 'کتابخانه نمودارسازی داده‌ها و گزارش‌های آماری', category: 'رابط کاربری' },
  { name: 'Node.js & Express', role: 'کارساز مقیاس‌پذیر و مدیریت مسیرهای API با لایه‌های میانی امنیتی', category: 'کارساز' },
  { name: 'Drizzle ORM', role: 'ارتباط نوع‌دار و سریع با پایگاه‌داده بدون پرس‌وجوهای خام ناامن', category: 'کارساز' },
  { name: 'Zod Validation', role: 'اعتبارسنجی دقیق داده‌های ورودی API بر اساس طرح داده', category: 'کارساز' },
  { name: 'Workflow Engine Core', role: 'موتور تراکنشی چرخه‌های کاری با قفل ردیف‌ها و تصویر لحظه‌ای تغییرناپذیر تعریف فرآیند', category: 'کارساز' },
  { name: 'DomainEventBus & Outbox', role: 'گذرگاه مرکزی رویدادها با ثبت یکپارچه در صندوق خروجی و بازپخش خطایابی', category: 'کارساز' },
  { name: 'Workflow Rule Engine', role: 'موتور ارزیابی قوانین شرطی بر پایه منطق «و» / «یا» و استخراج زمینه داده‌ای ERP', category: 'کارساز' },
  { name: 'DocumentService Engine', role: 'موتور متمرکز تراکنش‌های انبار، محاسبه میانگین موزون بها و حرکت کالایی با تفکیک ۱۴۰۱ و ۱۴۰۳', category: 'کارساز' },
  { name: 'Accounting & Ledger Engine', role: 'موتور متمرکز صدور اسناد دوبل، تراز خودکار ۴ سطحی و محاسبات صورت‌های مالی اساسی', category: 'کارساز' },
  { name: 'PostgreSQL', role: 'پایگاه‌داده رابطه‌ای قدرتمند برای نگهداری مطمئن داده‌های انبار، دفاتر دوبل و تراکنش‌ها', category: 'پایگاه‌داده و ذخیره‌سازی' },
  { name: 'FileSystem Storage', role: 'ذخیره‌سازی بهینه تصاویر روی دیسک کارساز', category: 'پایگاه‌داده و ذخیره‌سازی' },
  { name: 'JSONB Multi-Location', role: 'ساختار نوین ذخیره‌سازی موجودی به تفکیک انبار در ستون‌های JSONB', category: 'پایگاه‌داده و ذخیره‌سازی' },
  { name: 'Workflow Versioning Storage', role: 'ذخیره‌سازی افزایشی و تغییرناپذیر نسخه‌های تعریف فرآیند', category: 'پایگاه‌داده و ذخیره‌سازی' },
  { name: 'Dead Letter Queue Storage', role: 'جدول ذخیره‌سازی رخدادهای قرنطینه با ردیابی جزئیات خطا و بازپخش', category: 'پایگاه‌داده و ذخیره‌سازی' },
  { name: 'JWT & HttpOnly Cookies', role: 'احراز هویت امن با نشانه ورود در کوکی‌های HttpOnly و رمزنگاری Bcrypt', category: 'امنیت و یکپارچه‌سازی' },
  { name: 'HMAC-SHA256 Webhooks', role: 'امضای رمزنگاری‌شده محموله‌های خروجی وب‌هوک و سرآیندهای یکتای تحویل جهت امنیت بالا', category: 'امنیت و یکپارچه‌سازی' },
  { name: 'Audit Trail & Masking Engine', role: 'ممیزی جامع قبل و بعد تغییرات همراه با پوشاندن هوشمند کلمات عبور و نشانه‌های ورود', category: 'امنیت و یکپارچه‌سازی' },
  { name: 'WooCommerce Webhooks', role: 'پردازش خودکار رویدادهای سفارش فروشگاه برخط با تطابق خودکار SKU و صدور فاکتور', category: 'امنیت و یکپارچه‌سازی' },
  { name: 'Intl Jalali & Currency', role: 'بومی‌سازی کامل تاریخ هجری شمسی و قالب‌بندی خودکار چند ارز', category: 'امنیت و یکپارچه‌سازی' }
];

export const getLatestAppVersion = (): string => {
  if (SYSTEM_UPDATES && SYSTEM_UPDATES.length > 0) {
    const latest = SYSTEM_UPDATES[0].version;
    return latest.startsWith('v') ? latest : `v${latest}`;
  }
  return 'v5.0.0';
};
