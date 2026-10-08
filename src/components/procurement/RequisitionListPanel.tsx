import { Search, AlertTriangle } from 'lucide-react';
import type { PurchaseRequisition } from '../../types';
import { formatPersianNumber } from '../../utils';
import { REQUISITION_DESK_STATUS_TABS, type RequisitionStatusFilter } from '../../lib/procurement/procurementLists';
import { REQUISITION_PRIORITIES, REQUISITION_PRIORITY_LABELS } from '../../lib/procurement/requisitionFields';
import type { ProcurementAccess } from '../../hooks/procurement/useProcurementAccess';
import type { ProcurementPageState } from '../../hooks/procurement/useProcurementPage';
import { ProcurementPager } from './ProcurementPager';
import { RequisitionRow } from './RequisitionRow';

export interface RequisitionListFilters {
  status: RequisitionStatusFilter;
  priority: string;
  search: string;
  page: number;
}

interface RequisitionListPanelProps {
  list: ProcurementPageState<PurchaseRequisition>;
  filters: RequisitionListFilters;
  pageSize: number;
  onFiltersChange: (change: Partial<RequisitionListFilters>) => void;
  access: ProcurementAccess;
  selectedIds: number[];
  onToggleSelect: (req: PurchaseRequisition) => void;
  onSelectAll: (select: boolean) => void;
  onView: (req: PurchaseRequisition) => void;
  onSplit: (req: PurchaseRequisition) => void;
  onDelete: (req: PurchaseRequisition) => void;
  onShowOrders: () => void;
  onRetry: () => void;
}

/**
 * v9.0.353 (TD-697، B10-10): فهرست درخواست‌های میز تدارکات، یک صفحه از سرور با فیلتر وضعیت، اولویت و جست‌وجو (کد،
 * عنوان، پروژه و کالاهای درخواست). پیش‌تر میز ۱۰۰ درخواست آخر را می‌خواند و فیلترها در مرورگر روی همان‌ها بود.
 */
export function RequisitionListPanel({
  list, filters, pageSize, onFiltersChange, access, selectedIds, onToggleSelect, onSelectAll, onView, onSplit, onDelete, onShowOrders, onRetry,
}: RequisitionListPanelProps) {
  const rows = Array.isArray(list.rows) ? list.rows : [];
  return (
    <>
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-slate-100">
          {REQUISITION_DESK_STATUS_TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onFiltersChange({ status: tab.id, page: 1 })}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                filters.status === tab.id ? 'bg-amber-500 text-slate-950 shadow-xs' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="relative flex-1 min-w-[260px]">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              placeholder="جستجو در کد درخواست، عنوان، پروژه یا کالاهای درخواستی..."
              value={filters.search}
              onChange={e => onFiltersChange({ search: e.target.value, page: 1 })}
              className="w-full pl-3 pr-9 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:bg-white focus:ring-2 focus:ring-amber-400 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-bold">اولویت:</span>
            <select
              value={filters.priority}
              onChange={e => onFiltersChange({ priority: e.target.value, page: 1 })}
              className="p-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold focus:bg-white focus:outline-none cursor-pointer"
            >
              <option value="all">همه اولویت‌ها</option>
              {REQUISITION_PRIORITIES.map(priority => (
                <option key={priority} value={priority}>{REQUISITION_PRIORITY_LABELS[priority]}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-bold text-slate-800">
              فهرست درخواست‌های خرید ({formatPersianNumber(list.total)} مورد)
            </span>
            {selectedIds.length > 0 && (
              <span className="px-2 py-0.5 bg-amber-100 text-amber-900 rounded font-bold">
                {formatPersianNumber(selectedIds.length)} مورد انتخاب شده
              </span>
            )}
          </div>
          {access.canManage && (
            <div className="flex items-center gap-2 text-xs">
              <button type="button" onClick={() => onSelectAll(true)} className="text-blue-600 hover:text-blue-800 font-bold cursor-pointer">
                انتخاب همه
              </button>
              <span className="text-slate-300">|</span>
              <button type="button" onClick={() => onSelectAll(false)} className="text-slate-500 hover:text-slate-700 font-bold cursor-pointer">
                لغو انتخاب
              </button>
            </div>
          )}
        </div>

        {list.isLoading ? (
          <div className="p-12 text-center text-slate-500 text-xs">
            در حال بارگذاری کارتابل تدارکات...
          </div>
        ) : list.error ? (
          <div className="p-8 flex flex-col items-center gap-3 text-xs text-rose-800">
            <div className="flex items-center gap-2 font-bold">
              <AlertTriangle className="w-4 h-4 text-rose-600" />
              درخواست‌های خرید بارگذاری نشد: {list.error}
            </div>
            <button type="button" onClick={onRetry} className="px-3 py-1.5 bg-white border border-rose-200 hover:bg-rose-50 rounded-lg font-bold cursor-pointer">
              تلاش دوباره
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs">
            هیچ درخواست خریدی با فیلترهای انتخابی یافت نشد.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                <tr>
                  {access.canManage && <th className="p-3 text-center w-12">انتخاب</th>}
                  <th className="p-3">شماره و اولویت</th>
                  <th className="p-3">عنوان و پروژه</th>
                  <th className="p-3 text-center">اقلام</th>
                  <th className="p-3 text-center">تاریخ نیاز</th>
                  <th className="p-3 text-center">برآورد مبلغ</th>
                  <th className="p-3 text-center">وضعیت گردش کار</th>
                  <th className="p-3 text-center">فاکتورهای خرید مرتبط</th>
                  <th className="p-3 text-center">عملیات تدارکات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(req => (
                  <RequisitionRow
                    key={req.id}
                    req={req}
                    access={access}
                    isSelected={selectedIds.includes(req.id)}
                    onToggleSelect={onToggleSelect}
                    onView={onView}
                    onSplit={onSplit}
                    onDelete={onDelete}
                    onShowOrders={onShowOrders}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ProcurementPager
          page={filters.page}
          pageSize={pageSize}
          total={list.total}
          shown={rows.length}
          isLoading={list.isLoading}
          onPageChange={page => onFiltersChange({ page })}
          noun="درخواست"
        />
      </div>
    </>
  );
}
