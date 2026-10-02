import { Ban, CheckCircle2, Clock, ShoppingCart } from 'lucide-react';
import type { PillBadgeVariant, PillBadgeVariants } from '../common/PillBadge';

/** v7.0.86 (TD-108): نشان‌های درخواست خرید، مشترک میز تدارکات و جزئیات درخواست. */
const STATUS_BASE = 'px-2.5 py-1 font-bold rounded-lg text-xs flex items-center gap-1.5';
const pending: PillBadgeVariant = { label: 'در انتظار بررسی و تایید', className: `${STATUS_BASE} bg-amber-100 text-amber-900`, icon: Clock, iconClassName: 'w-3.5 h-3.5 text-amber-600' };
const ordered: PillBadgeVariant = { label: 'تایید شده (در حال خرید)', className: `${STATUS_BASE} bg-sky-100 text-sky-900`, icon: ShoppingCart, iconClassName: 'w-3.5 h-3.5 text-sky-600' };
const received: PillBadgeVariant = { label: 'خرید و تحویل انبار شده', className: `${STATUS_BASE} bg-emerald-100 text-emerald-900`, icon: CheckCircle2, iconClassName: 'w-3.5 h-3.5 text-emerald-600' };
const rejected: PillBadgeVariant = { label: 'رد شده / لغو', className: `${STATUS_BASE} bg-rose-100 text-rose-900`, icon: Ban, iconClassName: 'w-3.5 h-3.5 text-rose-600' };

export const REQUISITION_STATUS_BADGES: PillBadgeVariants = {
  pending, under_review: pending, manager_approval: pending,
  ordered, approved: ordered,
  received, completed: received,
  rejected, cancelled: rejected,
};
/** وضعیت ناشناخته با همان متن خام نمایش داده می‌شود */
export const REQUISITION_STATUS_FALLBACK: PillBadgeVariant = { className: 'px-2.5 py-1 bg-slate-100 text-slate-800 font-bold rounded-lg text-xs' };

const PRIORITY_BASE = 'px-2 py-0.5 rounded text-[10px]';
const priorityClasses = {
  urgent: `${PRIORITY_BASE} bg-rose-500 text-white font-black animate-pulse`,
  high: `${PRIORITY_BASE} bg-amber-500 text-slate-950 font-bold`,
  low: `${PRIORITY_BASE} bg-slate-200 text-slate-700 font-bold`,
  normal: `${PRIORITY_BASE} bg-blue-100 text-blue-800 font-bold`,
};

/** برچسب کوتاه (فهرست میز تدارکات) */
export const REQUISITION_PRIORITY_BADGES: PillBadgeVariants = {
  urgent: { label: 'فوری', className: priorityClasses.urgent },
  high: { label: 'بالا', className: priorityClasses.high },
  low: { label: 'پایین', className: priorityClasses.low },
};
export const REQUISITION_PRIORITY_FALLBACK: PillBadgeVariant = { label: 'عادی', className: priorityClasses.normal };

/** برچسب کامل (پنجره جزئیات درخواست) */
export const REQUISITION_PRIORITY_DETAIL_BADGES: PillBadgeVariants = {
  urgent: { label: 'فوری / اضطراری', className: priorityClasses.urgent },
  high: { label: 'اولویت بالا', className: priorityClasses.high },
  low: { label: 'اولویت پایین', className: priorityClasses.low },
};
export const REQUISITION_PRIORITY_DETAIL_FALLBACK: PillBadgeVariant = { label: 'اولویت عادی', className: priorityClasses.normal };
