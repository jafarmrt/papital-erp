import React from 'react';
import { WarehouseItem } from '../../../hooks/queries/useSettingsQueries';
import { ItemFormData } from './types';

interface ItemWarehouseStockFormProps {
  warehouses?: WarehouseItem[];
  form: ItemFormData;
  setForm: React.Dispatch<React.SetStateAction<ItemFormData>>;
}

export const ItemWarehouseStockForm: React.FC<ItemWarehouseStockFormProps> = ({
  warehouses = [],
  form,
  setForm
}) => {
  return (
    <div className="space-y-4">
      {warehouses.length > 0 ? (
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            موجودی اولیه به تفکیک انبارها
          </label>
          <div className="grid grid-cols-2 gap-3 bg-slate-50/70 p-3 rounded-xl border border-slate-200">
            {warehouses.map(w => (
              <div key={w.id}>
                <label className="block text-2xs font-medium text-slate-600 mb-1 truncate">
                  {w.name}
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={form.stocks[w.code] ?? form.stocks[w.id] ?? ''}
                  onChange={e => {
                    const val = parseFloat(e.target.value) || 0;
                    setForm({
                      ...form,
                      stocks: { ...form.stocks, [w.code]: val, [w.id]: val }
                    });
                  }}
                  className="w-full border border-slate-300/80 rounded-xl px-2.5 py-1.5 text-xs font-mono text-left bg-white outline-none focus:ring-1 focus:ring-blue-500"
                  dir="ltr"
                  placeholder="0"
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl text-amber-800 text-xs flex items-start gap-2">
            <span className="font-bold">توجه:</span>
            <span>هنوز هیچ انباری در سامانه تعریف نشده است. برای تفکیک مکان‌های نگهداری می‌توانید از بخش تنظیمات انبارها را ایجاد کنید، یا فعلاً موجودی کل اولیه را در کادر زیر وارد نمایید:</span>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">موجودی کل اولیه</label>
            <input
              type="number"
              min="0"
              step="any"
              value={form.current_stock}
              onChange={e => setForm({ ...form, current_stock: parseFloat(e.target.value) || 0 })}
              className="w-full border border-slate-300/80 rounded-xl px-3 py-2 text-left font-mono text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500"
              dir="ltr"
            />
          </div>
        </div>
      )}

      {/* Initial cost */}
      <div>
        <label className="block text-xs font-bold text-slate-700 mb-1">
          بهای تمام‌شده اولیه (WAC / خرید)
        </label>
        <input
          type="number"
          min="0"
          step="any"
          value={form.initial_cost}
          onChange={e => setForm({ ...form, initial_cost: parseFloat(e.target.value) || 0 })}
          className="w-full border border-slate-300/80 rounded-xl px-3 py-2 text-left font-mono text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500"
          dir="ltr"
          placeholder="0"
        />
      </div>
    </div>
  );
};
