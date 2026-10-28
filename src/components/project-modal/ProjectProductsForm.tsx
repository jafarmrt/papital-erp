import React, { useEffect, useState, useId } from 'react';
import { Layers, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import { SearchableSelect } from '../SearchableSelect';
import { Item } from '../../types';
import { formatPersianNumber, toPersianDigits, formatPersianCode } from '../../utils';
import { ProductRow } from './types';
import { DecimalInput } from '../common/DecimalInput';
import { PICK_LIST_URLS } from '../../lib/permissions/pickLists';
import { pickListServerSearchUrl } from '../../lib/permissions/pickListCap';

interface ProjectProductsFormProps {
  productsList: ProductRow[];
  activeItemsList: Item[];
  getOptionalStageNames: () => string[];
  onAddProductRow: () => void;
  /** `picked` is the item's row when it came from the server's matches (v11 phase 6.1ch, C13) */
  onUpdateProductRow: (index: number, field: string, value: any, picked?: Item) => void;
  onRemoveProductRow: (index: number) => void;
}

function projectItemOption(item: Item): { value: string; label: string } {
  return {
    value: String(item.id),
    label: `${item.name} (کد: ${formatPersianCode(item.code)} | موجودی: ${formatPersianNumber(item.current_stock || 0)} ${item.unit || 'عدد'})`,
  };
}

export const ProjectProductsForm: React.FC<ProjectProductsFormProps> = ({
  productsList,
  activeItemsList,
  getOptionalStageNames,
  onAddProductRow,
  onUpdateProductRow,
  onRemoveProductRow
}) => {
  const fieldId = useId();
  const optionalStages = getOptionalStageNames();

  return (
    <div className="bg-slate-50/80 p-5 rounded-2xl border border-slate-200/80 space-y-4">
      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
        <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2">
          <Layers size={14} className="text-blue-600" />
          اقلام و محصولات سفارش ({toPersianDigits(productsList.length)} ردیف)
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
                  {formatPersianNumber(idx + 1)}
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
                <label htmlFor={`${fieldId}-item_id-${idx}`} className="block text-2xs font-bold text-slate-600 mb-1">
                  انتخاب کالا / محصول از انبار <span className="text-red-500">*</span>
                </label>
                <SearchableSelect
                  id={`${fieldId}-item_id-${idx}`}
                  options={activeItemsList
                    .filter((item) => {
                      // Allow currently selected item for this row, but filter out items selected in other rows
                      const isSelectedElsewhere = productsList.some((p, i) => i !== idx && p.item_id === item.id);
                      return !isSelectedElsewhere;
                    })
                    .map(projectItemOption)}
                  // v11 phase 6.1ch (C13): an item list cut at the cap also searches on the server; the chosen row comes as `raw`
                  serverSearchUrl={pickListServerSearchUrl(activeItemsList, PICK_LIST_URLS.items)}
                  mapResultToOption={projectItemOption}
                  valueLabel={product.item_name || undefined}
                  value={product.item_id ? String(product.item_id) : ''}
                  onChange={(val, raw?: Item) => onUpdateProductRow(idx, 'item_id', val ? Number(val) : null, raw)}
                  placeholder="جست‌وجوی کالا بر اساس نام یا کد..."
                  className="w-full"
                />
              </div>

              {/* Customer Code */}
              <div>
                <label htmlFor={`${fieldId}-customer_code-${idx}`} className="block text-2xs font-bold text-slate-600 mb-1">
                  کد اختصاصی مشتری / سفارش
                </label>
                <input
                  id={`${fieldId}-customer_code-${idx}`}
                  type="text"
                  value={product.customer_code}
                  onChange={(e) => onUpdateProductRow(idx, 'customer_code', e.target.value)}
                  placeholder="کد سفارش نزد مشتری (اختیاری)"
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono"
                  dir="ltr"
                />
              </div>

              {/* Quantity and Unit */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <label htmlFor={`${fieldId}-quantity-${idx}`} className="block text-2xs font-bold text-slate-600 mb-1">
                    تعداد / تیراژ <span className="text-red-500">*</span>
                  </label>
                  <ProductQuantityInput id={`${fieldId}-quantity-${idx}`} value={product.quantity} onChange={(qty) => onUpdateProductRow(idx, 'quantity', qty)} />
                </div>
                <div className="w-20">
                  <label htmlFor={`${fieldId}-unit-${idx}`} className="block text-2xs font-bold text-slate-600 mb-1">واحد</label>
                  <input
                    id={`${fieldId}-unit-${idx}`}
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

/**
 * v10.0.145 (TD-1213): the field shows what the user types. Before, every change went through `Math.max(1, …)`, so an
 * emptied field became 1 at once and typing «20» after it gave 120. Each change is passed on as a number, an empty
 * field as 0; the field is required with a minimum of 1, so the form is not sent empty or zero.
 */
function ProductQuantityInput({ value, onChange, id }: { value: number; onChange: (quantity: number) => void; id?: string }) {
  const [text, setText] = useState<string>(String(value ?? ''));
  useEffect(() => {
    setText(current => (Number(current) === Number(value) ? current : String(value ?? '')));
  }, [value]);
  return (
    <DecimalInput
      id={id}
      min="1"
      required
      value={text}
      onValueChange={(v) => {
        setText(v);
        const parsed = Number(v);
        onChange(Number.isFinite(parsed) ? parsed : 0);
      }}
      className="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono"
    />
  );
}
