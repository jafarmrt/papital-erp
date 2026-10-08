import { CheckSquare, Square, Package } from 'lucide-react';
import { formatPersianPrice, formatPersianNumber } from '../../utils';
import { SafeImage } from '../SafeImage';
import { freeStockOf, stockPercentOf, type ReorderItem } from '../../lib/reorderAlerts/reorderItems';
import type { ReorderSectionTheme } from './reorderSectionThemes';

interface ReorderItemRowProps {
  item: ReorderItem;
  theme: ReorderSectionTheme;
  isSelected: boolean;
  onToggle: (id: number) => void;
  onAction: (item: ReorderItem) => void;
  onEditReorderPoint: (item: ReorderItem) => void;
}

/** یک ردیف جدول مواد اولیه یا محصولات صفحه نقطه سفارش */
export function ReorderItemRow({ item, theme, isSelected, onToggle, onAction, onEditReorderPoint }: ReorderItemRowProps) {
  const stockPercent = stockPercentOf(item);
  const ActionIcon = theme.icon;

  return (
    <tr
      className={`${theme.rowHover} transition-colors ${isSelected ? theme.rowSelected : item.is_zero_stock ? 'bg-rose-50/20' : ''}`}
    >
      <td className="p-3 text-center print:hidden">
        <button
          type="button"
          onClick={() => onToggle(item.id)}
          className="p-1 cursor-pointer"
        >
          {isSelected ? (
            <CheckSquare className={`w-4 h-4 ${theme.checkedIcon}`} />
          ) : (
            <Square className="w-4 h-4 text-slate-300 hover:text-slate-500" />
          )}
        </button>
      </td>

      <td className="p-3 text-center">
        <div className="w-9 h-9 mx-auto rounded-lg overflow-hidden flex items-center justify-center shrink-0">
          {item.thumbnail || item.image ? (
            <SafeImage src={item.thumbnail || item.image} alt={item.name} className="w-full h-full object-cover" fallbackIcon={<Package size={16} />} />
          ) : (
            <Package size={16} className="text-slate-400" />
          )}
        </div>
      </td>

      <td className="p-3 font-mono font-bold text-slate-800">{item.code}</td>

      <td className="p-3">
        <span className="font-bold text-slate-900 block">{item.name}</span>
        <span className="text-[10px] text-slate-400 font-normal">واحد: {item.unit || 'عدد'}</span>
      </td>

      <td className="p-3 text-slate-600">{item.category || '-'}</td>

      <td className="p-3 text-center">
        <div className="inline-flex flex-col items-center">
          <span className={`font-mono font-extrabold text-sm ${item.is_zero_stock ? 'text-rose-600' : theme.stockText}`}>
            {formatPersianNumber(freeStockOf(item))} {item.unit}
          </span>
          {Number(item.reserved_qty) > 0 && (
            <span className="text-[10px] text-slate-500 mt-0.5">
              موجودی {formatPersianNumber(item.current_stock)}، رزروشده {formatPersianNumber(Number(item.reserved_qty))}
            </span>
          )}
          <div className="w-16 bg-slate-200 h-1.5 rounded-full overflow-hidden mt-1">
            <div
              style={{ width: `${stockPercent}%` }}
              className={`h-full rounded-full ${item.is_zero_stock ? 'bg-rose-600' : theme.stockBar}`}
            />
          </div>
        </div>
      </td>

      <td className="p-3 text-center font-mono text-slate-600">
        {Number(item.in_transit_qty) > 0 ? `${formatPersianNumber(Number(item.in_transit_qty))} ${item.unit}` : '-'}
      </td>

      <td className="p-3 text-center font-mono font-bold text-slate-700">
        {formatPersianNumber(item.reorder_point)} {item.unit}
      </td>

      <td className="p-3 text-center">
        <span className={`px-2 py-1 rounded-lg ${theme.deficitBadge} font-mono font-black text-xs`}>
          {formatPersianNumber(item.deficit)} {item.unit}
        </span>
      </td>

      <td className="p-3 text-center font-mono text-slate-600">
        {item.weighted_average_cost ? formatPersianPrice(item.weighted_average_cost) : '-'}
      </td>

      <td className={`p-3 text-center font-mono font-bold ${theme.valueText}`}>
        {item.deficit_value > 0 ? formatPersianPrice(item.deficit_value) : '-'}
      </td>

      {/* Procurement / Production Action Buttons */}
      <td className="p-3 text-center print:hidden">
        <div className="flex items-center justify-center gap-1.5">
          <button
            type="button"
            onClick={() => onAction(item)}
            title={theme.actionTitle}
            className={`px-2.5 py-1.5 ${theme.actionButton} font-bold rounded-lg text-xs transition-colors flex items-center gap-1 shadow-xs cursor-pointer`}
          >
            <ActionIcon size={13} />
            {theme.actionLabel}
          </button>

          <button
            type="button"
            onClick={() => onEditReorderPoint(item)}
            title="ویرایش نقطه سفارش"
            className="px-2 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer"
          >
            ویرایش نقطه
          </button>
        </div>
      </td>
    </tr>
  );
}
