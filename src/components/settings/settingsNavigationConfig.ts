import { 
  Sliders, 
  Landmark, 
  Building2, 
  Layers, 
  Globe, 
  ShieldAlert, 
  List, 
  FolderTree, 
  Tags, 
  ShoppingBag, 
  ShieldCheck, 
  Activity,
  LucideIcon
} from 'lucide-react';

export interface SettingTabItem {
  id: string;
  label: string;
  shortDesc: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  permission?: string;
  keywords: string[];
}

export interface SettingCategoryGroup {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  colorClass: string;
  tabs: SettingTabItem[];
}

export const SETTINGS_GROUPS: SettingCategoryGroup[] = [
  {
    id: 'base',
    title: 'عمومی و پایه',
    description: 'اطلاعات کسب‌وکار، لوگو، منطقه زمانی و استراتژی‌های قیمت‌گذاری',
    icon: Sliders,
    colorClass: 'text-indigo-600 bg-indigo-50 border-indigo-200',
    tabs: [
      {
        id: 'general',
        label: 'تنظیمات عمومی',
        shortDesc: 'اطلاعات شرکت، ارز، لوگو، پیش‌شماره فاکتور و دوره‌های راکد',
        icon: List,
        keywords: ['شرکت', 'تلفن', 'آدرس', 'ارز', 'لوگو', 'فاکتور', 'تندگردش', 'کندگردش', 'راکد', 'ساعت', 'زمان', 'عمومی']
      },
      {
        id: 'pricing',
        label: 'سیاست‌های قیمتی',
        shortDesc: 'فرمول‌های قیمت‌گذاری، استراتژی‌ها و ضرایب سود کالاها',
        icon: Tags,
        keywords: ['قیمت', 'سیاست قیمتی', 'فرمول', 'ضریب', 'سود', 'فروش', 'نرخ', 'قیمت‌گذاری']
      }
    ]
  },
  {
    id: 'finance',
    title: 'مالی و حسابداری',
    description: 'سرفصل‌های پیش‌فرض، اسناد دوبل و درخت سلسله‌مراتبی حساب‌ها',
    icon: Landmark,
    colorClass: 'text-emerald-600 bg-emerald-50 border-emerald-200',
    tabs: [
      {
        id: 'accounting',
        label: 'تنظیمات حسابداری',
        shortDesc: 'سرفصل‌های پیش‌فرض خرید/فروش/انبار و تنظیمات سند خودکار',
        icon: Landmark,
        keywords: ['حسابداری', 'سرفصل', 'اسناد', 'سند خودکار', 'دوره مالی', 'معین پیش‌فرض', 'بانک', 'صندوق']
      },
      {
        id: 'chart_of_accounts',
        label: 'کدینگ حساب‌ها',
        shortDesc: 'درخت ۴ سطحی گروه، کل، معین و تفصیلی حسابداری ایران',
        icon: FolderTree,
        permission: 'accounting.coa',
        keywords: ['کدینگ', 'درخت حساب', 'گروه', 'کل', 'معین', 'تفصیلی', 'حساب', 'دفتر']
      }
    ]
  },
  {
    id: 'inventory',
    title: 'انبار و موجودی کالا',
    description: 'دسته‌بندی اقلام، مدیریت انبارها، آستانه سفارش و کنترل موجودی منفی',
    icon: Building2,
    colorClass: 'text-amber-600 bg-amber-50 border-amber-200',
    tabs: [
      {
        id: 'categories',
        label: 'دسته‌بندی‌های انبار',
        shortDesc: '۲۲ دسته‌بندی استاندارد، پیشوند کدینگ و واحدهای سنجش پیش‌فرض',
        icon: FolderTree,
        keywords: ['دسته', 'دسته‌بندی', 'انبار', 'پیشوند', 'واحد', 'کالا', 'مواد اولیه', 'محصول']
      },
      {
        id: 'warehouses',
        label: 'مدیریت انبارها',
        shortDesc: 'تعریف انبارهای فیزیکی، کد انبار و وضعیت فعالیت',
        icon: Building2,
        keywords: ['انبار', 'محل نگهداری', 'کد انبار', 'انبارها', 'سوله', 'موجودی انبار']
      },
      {
        id: 'inventory_integrity',
        label: 'سیاست کنترل موجودی منفی',
        shortDesc: 'قوانین یکپارچگی انبار، جلوگیری از کسری و قفل صدور کالا',
        icon: ShieldCheck,
        keywords: ['موجودی منفی', 'کنترل موجودی', 'قفل', 'انبارگردانی', 'یکپارچگی', 'کسری', 'عدم موجودی']
      },
      {
        id: 'inventory_control',
        label: 'الگوی کنترل موجودی و خرید',
        shortDesc: 'بخش‌ها و سرفصل‌های کنترل موجودی و لیست اقلام در آستانه خرید',
        icon: ShoppingBag,
        keywords: ['کنترل موجودی', 'لیست خرید', 'آستانه سفارش', 'الگو', 'خرید', 'تامین']
      }
    ]
  },
  {
    id: 'production',
    title: 'تولید و کارگاه',
    description: 'الگوهای ایستگاه‌ها و مراحل پیش‌فرض پروژه‌ها و عناوین وظایف',
    icon: Layers,
    colorClass: 'text-purple-600 bg-purple-50 border-purple-200',
    tabs: [
      {
        id: 'projects',
        label: 'الگوهای مراحل تولید',
        shortDesc: 'ورک‌فلوها و مراحل پیش‌فرض پروژه‌ها و خطوط ساخت',
        icon: Layers,
        keywords: ['تولید', 'پروژه', 'مراحل تولید', 'ایستگاه', 'ورک‌فلو', 'الگو', 'ساخت']
      },
      {
        id: 'task_titles',
        label: 'عناوین و دسته‌بندی‌های کاری',
        shortDesc: 'وظایف، عملیات ساخت، دسته‌بندی مشاغل و اجرت‌های کارگاهی',
        icon: Layers,
        keywords: ['کار', 'وظایف', 'تسک', 'عناوین کاری', 'شغل', 'عملیات', 'اجرت', 'دستمزد']
      }
    ]
  },
  {
    id: 'integration',
    title: 'اتصالات و وب‌سرویس',
    description: 'همگام‌سازی با فروشگاه ووکامرس، وب‌هوک‌ها و سفارش‌های اینترنتی',
    icon: Globe,
    colorClass: 'text-cyan-600 bg-cyan-50 border-cyan-200',
    tabs: [
      {
        id: 'woocommerce',
        label: 'اتصال به ووکامرس',
        shortDesc: 'کلیدهای API، هوک‌ها، همگام‌سازی لحظه‌ای موجودی و سفارش‌ها',
        icon: Globe,
        keywords: ['ووکامرس', 'فروشگاه', 'سایت', 'woocommerce', 'همگام‌سازی', 'وب‌هوک', 'سفارش آنلاین', 'اینترنت']
      }
    ]
  },
  {
    id: 'system_ops',
    title: 'سیستم و نگهداری',
    description: 'پایش سلامت، آزمون‌های پایگاه‌داده، پیکربندی و پاکسازی داده‌ها',
    icon: ShieldAlert,
    colorClass: 'text-rose-600 bg-rose-50 border-rose-200',
    tabs: [
      {
        id: 'health',
        label: 'وضعیت سلامت سیستم',
        shortDesc: 'بررسی ارتباط با دیتابیس، جدول‌ها، اتصالات و لاگ‌های خطا',
        icon: Activity,
        keywords: ['سلامت', 'دیتابیس', 'سرور', 'تست', 'خطا', 'سلامت سیستم', 'پایگاه داده', 'دیسک']
      },
      {
        id: 'system_config',
        label: 'پیکربندی سیستمی',
        shortDesc: 'پرچم‌های اجرایی، اندپوینت‌های تست و دسترسی‌های ویژه',
        icon: ShieldAlert,
        adminOnly: true,
        keywords: ['پیکربندی', 'کانفیگ', 'تست', 'سیستم', 'فلگ', 'مدیر', 'اندپوینت']
      },
      {
        id: 'system',
        label: 'عملیات سیستمی',
        shortDesc: 'پاکسازی داده‌های تستی، بازنشانی تراکنش‌ها و ابزارهای نگهداری',
        icon: ShieldAlert,
        adminOnly: true,
        keywords: ['عملیات سیستمی', 'پاکسازی', 'ریست', 'حذف داده', 'داده آزمایشی', 'تراکنش']
      }
    ]
  }
];

export function getVisibleGroups(
  groups: SettingCategoryGroup[],
  userRole: string,
  userPermissions?: { permissions: string[]; isAdmin: boolean }
): SettingCategoryGroup[] {
  const isAdmin = userRole === 'admin' || userPermissions?.isAdmin;
  const isManager = userRole === 'manager';
  const hasCoaPerm = userPermissions?.permissions?.includes('accounting.coa');

  return groups
    .map(group => {
      const filteredTabs = group.tabs.filter(tab => {
        if (tab.adminOnly && !isAdmin) return false;
        if (tab.permission === 'accounting.coa') {
          return isAdmin || isManager || hasCoaPerm;
        }
        return true;
      });

      return {
        ...group,
        tabs: filteredTabs
      };
    })
    .filter(group => group.tabs.length > 0);
}

export function findGroupByTabId(groups: SettingCategoryGroup[], tabId: string): SettingCategoryGroup | undefined {
  return groups.find(g => g.tabs.some(t => t.id === tabId));
}

export function findTabById(groups: SettingCategoryGroup[], tabId: string): SettingTabItem | undefined {
  for (const group of groups) {
    const tab = group.tabs.find(t => t.id === tabId);
    if (tab) return tab;
  }
  return undefined;
}
