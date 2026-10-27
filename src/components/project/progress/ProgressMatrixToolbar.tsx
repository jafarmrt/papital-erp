import type { Dispatch, SetStateAction } from 'react';
import { Package, CheckCircle2, Circle, Save, Search, RotateCcw } from 'lucide-react';
import { toPersianDigits } from '../../../utils';
import type { ProductProgressTicks } from '../../../hooks/useProductProgressTicks';

export type ProgressFilter = 'all' | 'incomplete' | 'completed';

interface ProgressMatrixToolbarProps {
  ticks: ProductProgressTicks;
  canEdit: boolean;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filterProgress: ProgressFilter;
  setFilterProgress: (filter: ProgressFilter) => void;
  selectedSkuIds: ReadonlySet<number>;
  setSelectedSkuIds: Dispatch<SetStateAction<Set<number>>>;
}

/** the matrix's bar: «ثبت» and «انصراف» of the unsent ticks, the search, the progress filter and the selected rows' actions */
export function ProgressMatrixToolbar({ ticks, canEdit, searchQuery, setSearchQuery, filterProgress, setFilterProgress, selectedSkuIds, setSelectedSkuIds }: ProgressMatrixToolbarProps) {
  const { saving, hasChanges, editCount, products, percentOf: progressPercent, reset: resetDirty } = ticks;
  const saveChanges = () => void ticks.save();
  // Bulk operation: Set all stages for selected SKUs
  const setAllStagesForSelectedSkus = (status: 'pending' | 'completed') => ticks.setAllStagesOf(selectedSkuIds, status);
  return (
    <>
      {/* Controls and Batch Operations Bar */}
      <div className="p-3 border-b border-slate-200 bg-slate-50 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center font-bold border border-amber-300 shadow-2xs shrink-0">
              <Package className="w-4 h-4" />
            </div>
            <div>
              <h4 className="font-bold text-slate-900 text-xs">
                ماتریس پیشرفت فیزیکی محصولات (مرحله × کالا)
              </h4>
              <p className="text-[10px] text-slate-500">
                کنترل و تیک‌زدن همزمان وضعیت تکمیل مراحل، پالایش سریع و عملیات گروهی
              </p>
              {!canEdit && (
                <p className="text-[10px] font-bold text-amber-700 mt-0.5">فقط مشاهده: تیک‌زدن مراحل مجوز «ویرایش پروژه و مراحل تولید» می‌خواهد.</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {hasChanges && (
              <button
                type="button"
                onClick={resetDirty}
                disabled={saving}
                className="px-2.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl font-bold text-[11px] flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default"
                title="لغو تمام تغییرات اعمال‌نشده"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>انصراف</span>
              </button>
            )}

            {hasChanges && (
              <button
                type="button"
                onClick={saveChanges}
                disabled={saving}
                className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white rounded-xl font-bold text-[11px] flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs animate-pulse"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? 'در حال ثبت...' : `ثبت ${toPersianDigits(editCount)} تغییر در سامانه`}</span>
              </button>
            )}
          </div>
        </div>

        {/* Search, Filter & Quick Batch Selection */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200/70">
          <div className="flex items-center gap-2 flex-1 min-w-[240px] max-w-md">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="جست‌وجو در نام، کد کالا یا کد مشتری..."
                className="w-full pl-3 pr-8 py-1.5 bg-white border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-amber-400 focus:outline-none placeholder:text-slate-400"
              />
            </div>

            {/* Progress Filter Pills */}
            <div className="flex items-center bg-slate-200/80 p-0.5 rounded-xl text-[10px] font-bold shrink-0">
              <button
                type="button"
                onClick={() => setFilterProgress('all')}
                className={`px-2 py-1 rounded-lg transition-all cursor-pointer ${
                  filterProgress === 'all' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                همه ({toPersianDigits(products.length)})
              </button>
              <button
                type="button"
                onClick={() => setFilterProgress('incomplete')}
                className={`px-2 py-1 rounded-lg transition-all cursor-pointer ${
                  filterProgress === 'incomplete' ? 'bg-white text-amber-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                ناتمام ({toPersianDigits(products.filter(p => progressPercent(p) < 100).length)})
              </button>
              <button
                type="button"
                onClick={() => setFilterProgress('completed')}
                className={`px-2 py-1 rounded-lg transition-all cursor-pointer ${
                  filterProgress === 'completed' ? 'bg-white text-emerald-800 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                تکمیل ({toPersianDigits(products.filter(p => progressPercent(p) === 100).length)})
              </button>
            </div>
          </div>

          {/* Batch Action Toolbar when rows are selected */}
          {canEdit && selectedSkuIds.size > 0 && (
            <div className="flex items-center gap-1.5 bg-amber-100/80 border border-amber-300/80 px-2.5 py-1 rounded-xl text-[11px] animate-fadeIn">
              <span className="font-bold text-amber-950">
                {toPersianDigits(selectedSkuIds.size)} ردیف انتخاب شده:
              </span>
              <button
                type="button"
                onClick={() => setAllStagesForSelectedSkus('completed')}
                disabled={saving}
                className="px-2 py-0.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-bold text-[10px] flex items-center gap-1 cursor-pointer disabled:opacity-50 disabled:cursor-default transition-colors"
              >
                <CheckCircle2 className="w-3 h-3" />
                تمام کردن کلیه مراحل
              </button>
              <button
                type="button"
                onClick={() => setAllStagesForSelectedSkus('pending')}
                disabled={saving}
                className="px-2 py-0.5 bg-slate-700 hover:bg-slate-800 text-white rounded-lg font-bold text-[10px] flex items-center gap-1 cursor-pointer disabled:opacity-50 disabled:cursor-default transition-colors"
              >
                <Circle className="w-3 h-3" />
                ریست به ناتمام
              </button>
              <button
                type="button"
                onClick={() => setSelectedSkuIds(new Set())}
                className="text-slate-600 hover:text-slate-900 text-[10px] font-bold px-1.5 cursor-pointer"
              >
                لغو انتخاب
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
