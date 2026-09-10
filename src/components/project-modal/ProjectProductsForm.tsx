import React from 'react';
import { Layers, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import { SearchableSelect } from '../SearchableSelect';
import { Item } from '../../types';
import { formatPersianNumber } from '../../utils';
import { ProductRow } from './types';

interface ProjectProductsFormProps {
  productsList: ProductRow[];
  activeItemsList: Item[];
  getOptionalStageNames: () => string[];
  onAddProductRow: () => void;
  onUpdateProductRow: (index: number, field: string, value: any) => void;
  onRemoveProductRow: (index: number) => void;
}

export const ProjectProductsForm: React.FC<ProjectProductsFormProps> = ({
  productsList,
  activeItemsList,
  getOptionalStageNames,
  onAddProductRow,
  onUpdateProductRow,
  onRemoveProductRow
}) => {
  const optionalStages = getOptionalStageNames();

  return (
    <div className="bg-slate-50/80 p-5 rounded-2xl border border-slate-200/80 space-y-4">
      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
        <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2">
          <Layers size={14} className="text-blue-600" />
          اقلام و محصولات سفارش ({productsList.length} ردیف)
        </h3>
        <button
          type="button"
          onClick={onAddProductRow}
          className="text-xs font-bold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-xl border border-blue-200 flex items-center gap-1.5 transition-all cursor-pointer"
        >
          <Plus size={14} />
          افزودن محصول جدید
        </button>
      </div>

      <div className="space-y-3">
        {productsList.map((product, idx) => (
          <div
            key={product.id || idx}
            className="p-3.5 bg-white rounded-xl border border-slate-200 hover:border-slate-300 transition-all space-y-3 shadow-2xs"
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
              <span className="text-xs font-black text-slate-700 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-800 flex items-center justify-center text-2xs font-bold font-mono">
                  {idx + 1}
                </span>
                ردیف کالا {product.item_name ? `- ${product.item_name}` : ''}
              </span>
              {productsList.length > 1 && (
                <button
                  type="button"
                  onClick={() => onRemoveProductRow(idx)}
                  className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded-lg transition-colors cursor-pointer"
                  title="حذف ردیف"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              {/* Item selection */}
              <div className="sm:col-span-2">
                <label className="block text-2xs font-bold text-slate-600 mb-1">
                  انتخاب کالا / محصول از انبار <span className="text-red-500">*</span>
                </label>
                <SearchableSelect
                  options={activeItemsList
                    .filter((item) => {
                      // Allow currently selected item for this row, but filter out items selected in other rows
                      const isSelectedElsewhere = productsList.some((p, i) => i !== idx && p.item_id === item.id);
                      return !isSelectedElsewhere;
                    })
                    .map((item) => ({
                      value: String(item.id),
                      label: `${item.name} (کد: ${item.code} | موجودی: ${formatPersianNumber(item.current_stock || 0)} ${item.unit || 'عدد'})`,
                    }))}
                  value={product.item_id ? String(product.item_id) : ''}
                  onChange={(val) => onUpdateProductRow(idx, 'item_id', val ? Number(val) : null)}
                  placeholder="جستجوی کالا بر اساس نام یا کد..."
                  className="w-full"
                />
              </div>

              {/* Customer Code */}
              <div>
                <label className="block text-2xs font-bold text-slate-600 mb-1">
                  کد اختصاصی مشتری / سفارش
                </label>
                <input
                  type="text"
                  value={product.customer_code}
                  onChange={(e) => onUpdateProductRow(idx, 'customer_code', e.target.value)}
                  placeholder="مثال: CUST-104"
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono"
                  dir="ltr"
                />
              </div>

              {/* Quantity and Unit */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-2xs font-bold text-slate-600 mb-1">
                    تعداد / تیراژ <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={product.quantity}
                    onChange={(e) => onUpdateProductRow(idx, 'quantity', Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono"
                  />
                </div>
                <div className="w-20">
                  <label className="block text-2xs font-bold text-slate-600 mb-1">واحد</label>
                  <input
                    type="text"
                    value={product.unit}
                    onChange={(e) => onUpdateProductRow(idx, 'unit', e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-2 py-1.5 text-xs text-center focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  />
                </div>
              </div>
            </div>

            {/* Optional Stage Checklist */}
            {optionalStages.length > 0 && (
              <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-3">
                <span className="text-2xs font-bold text-slate-600">مراحل انتخابی این ردیف:</span>
                {optionalStages.map((stgName) => {
                  const currentSelected = product.selected_optional_stages || [];
                  const isChecked = currentSelected.includes(stgName);

                  return (
                    <label
                      key={stgName}
                      className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border cursor-pointer select-none transition-all ${
                        isChecked
                          ? 'bg-blue-50 text-blue-800 border-blue-200 font-bold'
                          : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          let newSelected: string[];
                          if (e.target.checked) {
                            newSelected = Array.from(new Set([...currentSelected, stgName]));
                          } else {
                            newSelected = currentSelected.filter((s) => s !== stgName);
                          }
                          onUpdateProductRow(idx, 'selected_optional_stages', newSelected);
                          onUpdateProductRow(idx, 'needs_assembly', newSelected.length > 0);
                        }}
                        className="hidden"
                      />
                      <CheckCircle2 size={13} className={isChecked ? 'text-blue-600' : 'text-slate-300'} />
                      <span>{stgName}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
