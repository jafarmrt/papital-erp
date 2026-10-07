import { Plus, Package } from 'lucide-react';
import { Item } from '../../../types';
import { formatPersianNumber } from '../../../utils';
import { SearchableSelect } from '../../SearchableSelect';
import type { StockDocumentForm } from '../../../hooks/documents/useStockDocumentForm';
import { PICK_LIST_URLS } from '../../../lib/permissions/pickLists';

interface StockItemPickerProps {
  form: StockDocumentForm;
  onItemSelect: (val: string, rawItem?: Item) => void;
  onAddItem: () => void;
  onCreateItem: () => void;
}

/**
 * TD-080 (بخش ۳): ردیف انتخاب کالا (جستجو، تعداد، فی خرید، افزودن) و نوار بررسی آنی موجودی/رزرو
 * کالای انتخاب‌شده — استخراج‌شده از DocumentsPage.
 */
export function StockItemPicker({ form, onItemSelect, onAddItem, onCreateItem }: StockItemPickerProps) {
  const {
    actionType, canCreateOrEditItem, getItemReservationSummary, currency, selectedItem,
    quantity, setQuantity, unitPrice, setUnitPrice, selectedItemObj,
  } = form;

  return (
    <div className="border-t border-slate-200 pt-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-slate-800">
          <Package size={18} className="text-blue-600" />
          <h3 className="font-bold text-sm">
            {actionType === 'in' ? 'اقلام ورودی / خریداری‌شده' : 'اقلام و کالاهای حواله خروج'}
          </h3>
        </div>
        {actionType === 'out' && (
          <span className="text-xs text-amber-900 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200 font-bold">
            ⚠️ خروج کالا تنها از موجودی آزاد و غیررزروی امکان‌پذیر است
          </span>
        )}
      </div>

      <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className={actionType === 'in' ? "md:col-span-5 w-full" : "md:col-span-8 w-full"}>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-700">جستجو و انتخاب کالا / ماده اولیه</label>
              {canCreateOrEditItem && (
                <button
                  type="button"
                  onClick={onCreateItem}
                  className="text-[11px] text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1 hover:underline cursor-pointer"
                >
                  <Plus size={13} />
                  <span>تعریف کالا / افزودن تصویر کالا</span>
                </button>
              )}
            </div>
            <SearchableSelect
              className="w-full shadow-2xs rounded-xl"
              fetchUrl={PICK_LIST_URLS.items}
              mapResultToOption={(it: Item) => {
                const { totalReservedQty, reservedForOtherProjects, reservedForSelectedProject, maxAllowedForExit } = getItemReservationSummary(it);

                let label = `${it.code} - ${it.name} (موجودی فعلی: ${it.current_stock} ${it.unit})`;

                if (actionType === 'out') {
                  if (totalReservedQty > 0) {
                    if (reservedForOtherProjects > 0) {
                      label += ` | 🔒 رزرو سایر مصارف: ${reservedForOtherProjects} ${it.unit}`;
                    }
                    if (reservedForSelectedProject > 0) {
                      label += ` | 🟢 سهم رزرو این پروژه: ${reservedForSelectedProject} ${it.unit}`;
                    }
                    label += ` | ▫️ سقف مجاز خروج: ${maxAllowedForExit} ${it.unit}`;
                  } else {
                    label += ` | ▫️ مجاز جهت خروج: ${maxAllowedForExit} ${it.unit}`;
                  }
                } else if (it.purchase_price) {
                  label += ` | فی خرید قبلی: ${Number(it.purchase_price).toLocaleString('fa-IR')} ${currency}`;
                }

                return {
                  value: it.id.toString(),
                  label,
                  disabled: actionType === 'out' && maxAllowedForExit <= 0
                };
              }}
              value={selectedItem}
              onChange={onItemSelect}
              placeholder="کد یا نام کالا را تایپ کنید..."
            />
          </div>

          <div className={actionType === 'in' ? "md:col-span-2" : "md:col-span-2"}>
            <label className="block text-xs font-bold mb-1.5 text-slate-700">تعداد / مقدار</label>
            <input 
              type="number" 
              min="0" 
              step="any" 
              value={quantity} 
              onChange={e => setQuantity(e.target.value ? Number(e.target.value) : '')} 
              placeholder="0"
              className="w-full border border-slate-200 bg-white rounded-xl text-sm px-3 py-2 text-center font-mono font-bold focus:outline-none focus:ring-2 focus:ring-blue-500" 
              dir="ltr" 
            />
          </div>

          {actionType === 'in' && (
            <div className="md:col-span-3">
              <label className="block text-xs font-bold mb-1.5 text-slate-700">
                قیمت خرید واحد (فی - {currency})
              </label>
              <input 
                type="number" 
                min="0" 
                step="any" 
                value={unitPrice} 
                onChange={e => setUnitPrice(e.target.value ? Number(e.target.value) : '')} 
                placeholder="مثال: 100000"
                className="w-full border border-slate-200 bg-white rounded-xl text-sm px-3 py-2 text-left font-mono font-bold focus:outline-none focus:ring-2 focus:ring-blue-500" 
                dir="ltr" 
              />
            </div>
          )}

          <div className={actionType === 'in' ? "md:col-span-2" : "md:col-span-2"}>
            <button 
              type="button" 
              onClick={onAddItem} 
              className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl flex items-center justify-center gap-1.5 text-xs sm:text-sm font-bold h-[38px] transition-all shadow-sm shrink-0 cursor-pointer"
            >
              <Plus size={18} /> افزودن به ردیف‌ها
            </button>
          </div>
        </div>

        {/* Instant Item Inspection Banner */}
        {selectedItemObj && actionType === 'out' && (
          <div className="bg-white border border-slate-200 p-3 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-blue-900 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">{selectedItemObj.code}</span>
              <span className="font-bold text-slate-900">{selectedItemObj.name}</span>
            </div>
            {(() => {
              const { reservedForOtherProjects, reservedForSelectedProject, maxAllowedForExit } = getItemReservationSummary(selectedItemObj);
              return (
                <div className="flex flex-wrap items-center gap-2 font-mono">
                  <span className="px-2 py-0.5 bg-slate-100 rounded text-slate-700 border">موجودی کل: {formatPersianNumber(selectedItemObj.current_stock)} {selectedItemObj.unit}</span>
                  {reservedForOtherProjects > 0 && (
                    <span className="px-2 py-0.5 bg-purple-100 text-purple-950 rounded font-bold border border-purple-300">
                      🔒 رزرو سایر پروژه‌ها: {formatPersianNumber(reservedForOtherProjects)} {selectedItemObj.unit}
                    </span>
                  )}
                  {reservedForSelectedProject > 0 && (
                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-950 rounded font-bold border border-emerald-300">
                      🟢 رزرو پروژه انتخاب‌شده: {formatPersianNumber(reservedForSelectedProject)} {selectedItemObj.unit}
                    </span>
                  )}
                  <span className="px-2.5 py-0.5 bg-amber-100 text-amber-950 rounded font-bold border border-amber-300">
                    حداکثر مجاز خروج: {formatPersianNumber(maxAllowedForExit)} {selectedItemObj.unit}
                  </span>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
