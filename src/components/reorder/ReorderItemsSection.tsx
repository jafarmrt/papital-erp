import { RefreshCw, CheckCircle2, CheckSquare, Square } from 'lucide-react';
import { formatPersianPrice, formatPersianNumber } from '../../utils';
import type { ReorderItem } from '../../lib/reorderAlerts/reorderItems';
import type { ReorderSectionTheme } from './reorderSectionThemes';
import { ReorderItemRow } from './ReorderItemRow';

interface ReorderItemsSectionProps {
  theme: ReorderSectionTheme;
  items: ReorderItem[];
  loading: boolean;
  deficitCost: number;
  selectedIds: Set<number>;
  allSelected: boolean;
  onToggle: (id: number) => void;
  onToggleAll: () => void;
  onBatchAction: () => void;
  onAction: (item: ReorderItem) => void;
  onEditReorderPoint: (item: ReorderItem) => void;
}

/**
 * کادر مواد اولیه (ثبت سفارش خرید) یا محصولات کارگاهی (تعریف پروژه تولید) در آستانه سفارش:
 * سربرگ با برآورد ارزش و دکمه عملیات یکجا، و جدول اقلام با انتخاب تیک‌دار.
 */
export function ReorderItemsSection({
  theme, items, loading, deficitCost, selectedIds, allSelected,
  onToggle, onToggleAll, onBatchAction, onAction, onEditReorderPoint
}: ReorderItemsSectionProps) {
  const Icon = theme.icon;

  return (
    <div className={`bg-white border-2 ${theme.boxBorder} rounded-2xl shadow-xs overflow-hidden`}>
      {/* Box Header */}
      <div className={`bg-gradient-to-r ${theme.headerBg} p-4 border-b flex flex-wrap items-center justify-between gap-3`}>
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl ${theme.iconBox} flex items-center justify-center font-black shadow-sm`}>
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-black text-slate-900 text-base">
                {theme.title}
              </h2>
              <span className={`px-2.5 py-0.5 ${theme.countBadge} font-black rounded-lg text-xs font-mono`}>
                {formatPersianNumber(items.length)} {theme.countSuffix}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {theme.description}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-slate-600">
            {theme.costLabel} <span className={`font-mono ${theme.costValue} font-black text-sm`}>{formatPersianPrice(deficitCost)}</span>
          </span>

          <button
            type="button"
            onClick={onBatchAction}
            disabled={selectedIds.size === 0}
            className={`px-4 py-2 ${theme.batchButton} font-black text-xs rounded-xl flex items-center gap-2 transition-all shadow-xs cursor-pointer`}
          >
            <Icon className="w-4 h-4" />
            <span>{theme.batchLabel}</span>
            {selectedIds.size > 0 && (
              <span className={`px-2 py-0.5 ${theme.batchCounter}`}>
                {formatPersianNumber(selectedIds.size)}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Table of Items */}
      {loading ? (
        <div className="p-10 text-center text-slate-400 space-y-2">
          <RefreshCw className={`animate-spin mx-auto ${theme.loadingSpinner}`} size={24} />
          <p className="text-xs">{theme.loadingText}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="p-8 text-center text-slate-400 space-y-2">
          <CheckCircle2 className="mx-auto text-emerald-500" size={32} />
          <p className="text-sm font-bold text-slate-700">{theme.emptyTitle}</p>
          <p className="text-xs text-slate-400">{theme.emptyText}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-right">
            <thead className={theme.thead}>
              <tr>
                <th className="p-3 text-center w-12 print:hidden">
                  <button
                    type="button"
                    onClick={onToggleAll}
                    className={`p-1 text-slate-600 ${theme.selectAllButton} cursor-pointer`}
                    title={theme.selectAllTitle}
                  >
                    {allSelected ? (
                      <CheckSquare className={`w-4 h-4 ${theme.checkedIcon}`} />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400" />
                    )}
                  </button>
                </th>
                <th className="p-3 text-center w-14">تصویر</th>
                <th className="p-3">کد کالا</th>
                <th className="p-3">{theme.nameHeader}</th>
                <th className="p-3">دسته‌بندی</th>
                <th className="p-3 text-center">موجودی آزاد</th>
                <th className="p-3 text-center">در راه</th>
                <th className="p-3 text-center">نقطه سفارش</th>
                <th className="p-3 text-center">{theme.deficitHeader}</th>
                <th className="p-3 text-center">{theme.costHeader}</th>
                <th className="p-3 text-center">{theme.valueHeader}</th>
                <th className="p-3 text-center print:hidden">{theme.actionHeader}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <ReorderItemRow
                  key={item.id}
                  item={item}
                  theme={theme}
                  isSelected={selectedIds.has(item.id)}
                  onToggle={onToggle}
                  onAction={onAction}
                  onEditReorderPoint={onEditReorderPoint}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
