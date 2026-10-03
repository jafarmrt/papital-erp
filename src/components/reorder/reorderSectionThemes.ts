import { Hammer, ShoppingCart, type LucideIcon } from 'lucide-react';

/**
 * متن‌ها و کلاس‌های دو کادر صفحه نقطه سفارش: مواد اولیه (سفارش خرید، کهربایی) و محصولات کارگاهی
 * (پروژه تولید، نیلی). همان متن‌ها و کلاس‌های دو جدول تکراری صفحه پیشین در یک جا.
 */
export interface ReorderSectionTheme {
  icon: LucideIcon;
  boxBorder: string;
  headerBg: string;
  iconBox: string;
  title: string;
  countBadge: string;
  countSuffix: string;
  description: string;
  costLabel: string;
  costValue: string;
  batchButton: string;
  batchLabel: string;
  batchCounter: string;
  loadingSpinner: string;
  loadingText: string;
  emptyTitle: string;
  emptyText: string;
  thead: string;
  selectAllButton: string;
  selectAllTitle: string;
  checkedIcon: string;
  nameHeader: string;
  deficitHeader: string;
  costHeader: string;
  valueHeader: string;
  actionHeader: string;
  rowHover: string;
  rowSelected: string;
  stockText: string;
  stockBar: string;
  deficitBadge: string;
  valueText: string;
  actionButton: string;
  actionTitle: string;
  actionLabel: string;
}

export const MATERIALS_THEME: ReorderSectionTheme = {
  icon: ShoppingCart,
  boxBorder: 'border-amber-200/80',
  headerBg: 'from-amber-500/10 via-amber-50/70 to-white border-amber-200/80',
  iconBox: 'bg-amber-500 text-slate-950',
  title: 'مواد اولیه در آستانه سفارش',
  countBadge: 'bg-amber-100 text-amber-950',
  countSuffix: 'قلم نیازمند خرید',
  description: 'تامین از طریق ثبت سفارش خرید (تکی یا یکجا) و ارسال به کارتابل تدارکات یا صدور مستقیم سند',
  costLabel: 'برآورد هزینه تامین:',
  costValue: 'text-amber-800',
  batchButton: 'bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950',
  batchLabel: 'ثبت سفارش خرید یکجا',
  batchCounter: 'bg-slate-950 text-white rounded-full text-[10px] font-mono',
  loadingSpinner: 'text-amber-500',
  loadingText: 'در حال بارگیری اقلام مواد اولیه...',
  emptyTitle: 'هیچ ماده اولیه‌ای در وضعیت هشدار نقطه سفارش نیست',
  emptyText: 'تمام مواد اولیه انبار دارای موجودی کافی می‌باشند.',
  thead: 'bg-amber-50/50 text-slate-700 border-b border-amber-100 font-bold',
  selectAllButton: 'hover:text-amber-600',
  selectAllTitle: 'انتخاب همه مواد اولیه',
  checkedIcon: 'text-amber-600',
  nameHeader: 'نام ماده اولیه',
  deficitHeader: 'میزان کسری',
  costHeader: 'میانگین بهای خرید',
  valueHeader: 'برآورد ارزش کسری',
  actionHeader: 'عملیات تامین',
  rowHover: 'hover:bg-amber-50/30',
  rowSelected: 'bg-amber-50/40',
  stockText: 'text-amber-600',
  stockBar: 'bg-amber-500',
  deficitBadge: 'bg-rose-100 text-rose-800',
  valueText: 'text-amber-800',
  actionButton: 'bg-amber-500 hover:bg-amber-600 text-slate-950',
  actionTitle: 'ثبت سفارش خرید برای این ماده اولیه',
  actionLabel: 'ثبت سفارش خرید',
};

export const PRODUCTS_THEME: ReorderSectionTheme = {
  icon: Hammer,
  boxBorder: 'border-indigo-200/80',
  headerBg: 'from-indigo-500/10 via-indigo-50/70 to-white border-indigo-200/80',
  iconBox: 'bg-indigo-600 text-white',
  title: 'محصولات کارگاهی در آستانه سفارش (نیازمند تولید)',
  countBadge: 'bg-indigo-100 text-indigo-950',
  countSuffix: 'محصول کسری',
  description: 'محصولات در کارگاه تولید می‌شوند؛ جهت جبران کسری، برای آن‌ها پروژه تولید تعریف نمایید (فاقد سفارش خرید)',
  costLabel: 'ارزش تخمینی محصولات:',
  costValue: 'text-indigo-800',
  batchButton: 'bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white',
  batchLabel: 'تعریف پروژه تولید یکجا',
  batchCounter: 'bg-white text-indigo-900 rounded-full text-[10px] font-mono font-bold',
  loadingSpinner: 'text-indigo-500',
  loadingText: 'در حال بارگیری اقلام محصولات...',
  emptyTitle: 'هیچ محصولی در وضعیت هشدار نقطه سفارش نیست',
  emptyText: 'تمام محصولات کارگاه دارای موجودی مکفی در انبار می‌باشند.',
  thead: 'bg-indigo-50/50 text-slate-700 border-b border-indigo-100 font-bold',
  selectAllButton: 'hover:text-indigo-600',
  selectAllTitle: 'انتخاب همه محصولات',
  checkedIcon: 'text-indigo-600',
  nameHeader: 'عنوان محصول',
  deficitHeader: 'تیراژ کسری تولید',
  costHeader: 'میانگین بهای ساخت',
  valueHeader: 'ارزش کل کسری',
  actionHeader: 'عملیات تولید',
  rowHover: 'hover:bg-indigo-50/30',
  rowSelected: 'bg-indigo-50/40',
  stockText: 'text-indigo-600',
  stockBar: 'bg-indigo-500',
  deficitBadge: 'bg-indigo-100 text-indigo-900',
  valueText: 'text-indigo-900',
  actionButton: 'bg-indigo-600 hover:bg-indigo-700 text-white',
  actionTitle: 'تعریف پروژه تولید کارگاهی برای این محصول',
  actionLabel: 'تعریف پروژه تولید',
};
