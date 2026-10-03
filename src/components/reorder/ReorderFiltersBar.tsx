import { Search } from 'lucide-react';
import { formatPersianNumber } from '../../utils';
import type { StockStatusFilter } from '../../lib/reorderAlerts/reorderItems';

interface ReorderFiltersBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  stockStatusFilter: StockStatusFilter;
  onStockStatusChange: (value: StockStatusFilter) => void;
  selectedCategory: string;
  onCategoryChange: (value: string) => void;
  categories: string[];
  filteredCount: number;
  materialsCount: number;
  productsCount: number;
  onClear: () => void;
}

/** جستجو، فیلتر وضعیت موجودی و دسته‌بندی صفحه نقطه سفارش، با خلاصه تعداد اقلام نمایش‌داده‌شده */
export function ReorderFiltersBar({
  search, onSearchChange, stockStatusFilter, onStockStatusChange, selectedCategory, onCategoryChange,
  categories, filteredCount, materialsCount, productsCount, onClear
}: ReorderFiltersBarProps) {
  return (
    <div className="bg-white p-4 border rounded-xl shadow-xs space-y-3 print:hidden">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Search box */}
        <div className="relative">
          <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
          <input
            type="text"
            placeholder="جستجو کد، نام یا دسته‌بندی..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pr-9 pl-3 py-2 border rounded-xl text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Stock status filter */}
        <div>
          <select
            value={stockStatusFilter}
            onChange={(e) => onStockStatusChange(e.target.value as StockStatusFilter)}
            className="w-full p-2 border rounded-xl text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">همه وضعیت‌ها (موجودی صفر و دارای کسری)</option>
            <option value="zero">فقط کالاهای کاملاً ناموجود (موجودی صفر)</option>
            <option value="below_reorder">فقط کالاهای دارای موجودی کم (زیر آستانه)</option>
          </select>
        </div>

        {/* Category filter */}
        <div>
          <select
            value={selectedCategory}
            onChange={(e) => onCategoryChange(e.target.value)}
            className="w-full p-2 border rounded-xl text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">همه دسته‌بندی‌ها</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex justify-between items-center text-xs text-slate-500 border-t pt-2.5">
        <span>
          نمایش {formatPersianNumber(filteredCount)} مورد هشدار نقطه سفارش
          ({formatPersianNumber(materialsCount)} ماده اولیه + {formatPersianNumber(productsCount)} محصول کارگاهی)
        </span>
        {(stockStatusFilter !== 'all' || selectedCategory !== 'all' || search) && (
          <button
            onClick={onClear}
            className="text-rose-600 hover:underline text-[11px] font-semibold cursor-pointer"
          >
            پاکسازی فیلترها
          </button>
        )}
      </div>
    </div>
  );
}
