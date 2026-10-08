import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Clock, FileCheck, Lock, Search } from 'lucide-react';
import { formatPersianNumber } from '../../../utils';
import { JalaliDateInput } from '../../common/JalaliDateInput';
import type { VoucherListFilters, VoucherStatusCounts } from '../../../lib/accounting/voucherList';
import { VOUCHER_TYPES, VOUCHER_TYPE_LABELS, isVoucherTypeCode, type VoucherTypeCode } from '../../../lib/accounting/voucherTypes';

/**
 * v9.0.115 (TD-565): برگه‌های وضعیت و صافی‌های فهرست اسناد حسابداری (استخراج‌شده از JournalVouchersTab).
 * شمارنده‌ها شمار سرور با صافی‌های فعلی‌اند، نه شمار صفحه‌ای که مرورگر دارد؛ تاریخ‌ها ISO نگه داشته می‌شوند.
 */

interface StatusTab {
  key: string;
  label: string;
  icon?: ReactNode;
  active: string;
  idle: string;
  activeCount: string;
  idleCount: string;
}

const STATUS_TABS: StatusTab[] = [
  {
    key: 'all', label: 'همه اسناد حسابداری',
    active: 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs border border-slate-200 dark:border-slate-600',
    idle: 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white',
    activeCount: 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-bold',
    idleCount: 'bg-slate-200/70 dark:bg-slate-700/70 text-slate-600 dark:text-slate-400',
  },
  {
    key: 'draft', label: 'پیش‌نویس‌ها (یادداشت اولیه)', icon: <Clock className="w-3.5 h-3.5" />,
    active: 'bg-amber-500 text-white shadow-xs',
    idle: 'text-amber-800 dark:text-amber-300 hover:bg-amber-100/60 dark:hover:bg-amber-950/40',
    activeCount: 'bg-white/20 text-white font-bold',
    idleCount: 'bg-amber-200/70 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200',
  },
  {
    key: 'approved', label: 'تایید شده (حسابرسی‌شده)', icon: <FileCheck className="w-3.5 h-3.5" />,
    active: 'bg-blue-600 text-white shadow-xs',
    idle: 'text-blue-800 dark:text-blue-300 hover:bg-blue-100/60 dark:hover:bg-blue-950/40',
    activeCount: 'bg-white/20 text-white font-bold',
    idleCount: 'bg-blue-200/70 dark:bg-blue-900/60 text-blue-900 dark:text-blue-200',
  },
  {
    key: 'permanent', label: 'دائم و قطعی (قفل دفاتر)', icon: <Lock className="w-3.5 h-3.5" />,
    active: 'bg-emerald-600 text-white shadow-xs',
    idle: 'text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100/60 dark:hover:bg-emerald-950/40',
    activeCount: 'bg-white/20 text-white font-bold',
    idleCount: 'bg-emerald-200/70 dark:bg-emerald-900/60 text-emerald-900 dark:text-emerald-200',
  },
];

// v9.0.195 (TD-573): صافی نوع از فهرست مشترک نوع‌ها (تسویه هم)
const VOUCHER_TYPE_OPTIONS: Array<[string, string]> = [
  ['all', 'همه انواع اسناد'],
  ...VOUCHER_TYPES.map((type): [string, string] => [type, VOUCHER_TYPE_LABELS[type]]),
];

const VOUCHER_TYPE_BADGES: Record<VoucherTypeCode, string> = {
  general: 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-200',
  sales: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  purchase: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  treasury: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  payroll: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  opening: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
  closing: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
  adjustment: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  settlement: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
};

/** رنگ نشان نوع سند در فهرست اسناد */
export function voucherTypeBadge(type: unknown): string {
  return isVoucherTypeCode(type) ? VOUCHER_TYPE_BADGES[type] : VOUCHER_TYPE_BADGES.general;
}

interface VoucherListToolbarProps {
  filters: VoucherListFilters;
  statusCounts: VoucherStatusCounts;
  onChange: (patch: Partial<VoucherListFilters>) => void;
}

export function VoucherListToolbar({ filters, statusCounts, onChange }: VoucherListToolbarProps) {
  const counts: Record<string, number> = {
    ...statusCounts,
    all: statusCounts.draft + statusCounts.approved + statusCounts.permanent,
  };
  const inputClass = 'w-28 px-2.5 py-2 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white font-mono focus:ring-2 focus:ring-indigo-500 outline-none';

  return (
    <>
      {/* برگه‌های وضعیت (پیش‌نویس، تایید شده، دائم) با شمار سرور */}
      <div className="flex flex-wrap items-center gap-2 bg-slate-100/80 dark:bg-slate-800/80 p-1.5 rounded-2xl border border-slate-200/70 dark:border-slate-700/70">
        {STATUS_TABS.map(tab => {
          const isActive = filters.status === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => onChange({ status: tab.key })}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${isActive ? tab.active : tab.idle}`}
            >
              {tab.icon}
              <span>{tab.label}</span>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-mono ${isActive ? tab.activeCount : tab.idleCount}`}>
                {formatPersianNumber(counts[tab.key] ?? 0)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="جست‌وجو در شماره سند، شرح یا عطف..."
            value={filters.search}
            onChange={e => onChange({ search: e.target.value })}
            className="w-full pr-9 pl-3 py-2 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          />
        </div>

        <select
          value={filters.voucherType}
          onChange={e => onChange({ voucherType: e.target.value })}
          aria-label="نوع سند"
          className="px-3 py-2 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white"
        >
          {VOUCHER_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>

        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-500">از:</span>
            <JalaliDateInput value={filters.startDate} onChange={iso => onChange({ startDate: iso })} className={inputClass} containerClassName="inline-block" />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-500">تا:</span>
            <JalaliDateInput value={filters.endDate} onChange={iso => onChange({ endDate: iso })} className={inputClass} containerClassName="inline-block" />
          </div>
          {(filters.startDate || filters.endDate) && (
            <button
              onClick={() => onChange({ startDate: '', endDate: '' })}
              className="text-xs text-rose-500 hover:text-rose-700 font-medium px-1.5 py-1 cursor-pointer"
            >
              پاک‌کردن تاریخ
            </button>
          )}
        </div>
      </div>
    </>
  );
}

interface VoucherListPagerProps {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
}

/** پایین جدول: «x تا y از total سند» و صفحه قبل و بعد */
export function VoucherListPager({ page, limit, total, onPageChange }: VoucherListPagerProps) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const first = total === 0 ? 0 : (page - 1) * limit + 1;
  const last = Math.min(total, page * limit);
  return (
    <div className="p-3 sm:p-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs text-slate-500">
      <div data-testid="voucher-list-range">
        {formatPersianNumber(first)} تا {formatPersianNumber(last)} از {formatPersianNumber(total)} سند
        {totalPages > 1 && <span> — صفحه {formatPersianNumber(page)} از {formatPersianNumber(totalPages)}</span>}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
            title="صفحه قبل"
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
          >
            <ChevronRight size={15} />
          </button>
          <button
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            title="صفحه بعد"
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
          >
            <ChevronLeft size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
