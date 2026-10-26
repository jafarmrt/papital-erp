import React, { useState, useId } from 'react';
import { formatPersianNumber, formatPersianCode } from '../../utils';
import type { ReorderItem } from '../../lib/reorderAlerts/reorderItems';
import { DecimalInput } from '../common/DecimalInput';
import { DialogLayer } from '../common/DialogLayer';

interface ReorderPointEditModalProps {
  item: ReorderItem;
  saving: boolean;
  onCancel: () => void;
  /** مقدار واردشده (رشته خام فیلد)؛ اعتبارسنجی و ذخیره با صفحه است */
  onSave: (value: string) => void;
}

/** مودال ویرایش سریع نقطه سفارش یک کالا؛ مقدار اولیه نقطه سفارش فعلی کالاست */
export function ReorderPointEditModal({ item, saving, onCancel, onSave }: ReorderPointEditModalProps) {
  const fieldId = useId();
  const [newReorderPoint, setNewReorderPoint] = useState<string>(() => String(item.reorder_point));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(newReorderPoint);
  };

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <DialogLayer onClose={onCancel} disabled={saving} />
      <div className="bg-white rounded-2xl max-w-md w-full shadow-xl space-y-4 max-h-[85vh] overflow-y-auto p-6">
        <h3 className="font-bold text-slate-800 text-base">ویرایش نقطه سفارش کالا</h3>
        <p className="text-xs text-slate-500">
          تنظیم حد آستانه هشدار برای <strong className="text-slate-800">{item.name}</strong> (کد: {formatPersianCode(item.code)})
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor={`${fieldId}-new-reorder-point`} className="block text-xs font-bold text-slate-700 mb-1">
              نقطه سفارش جدید (تعداد/مقدار به {item.unit}):
            </label>
            <DecimalInput
              id={`${fieldId}-new-reorder-point`}
              min="0"
              value={newReorderPoint}
              onValueChange={(v) => setNewReorderPoint(v)}
              className="w-full p-2.5 border rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
            <p className="text-[10px] text-slate-400 mt-1">
              موجودی فعلی این کالا در انبار: <span className="font-bold text-slate-700">{formatPersianNumber(item.current_stock)} {item.unit}</span> است.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 border rounded-xl text-xs font-semibold hover:bg-slate-50 cursor-pointer"
              disabled={saving}
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              {saving ? 'در حال ذخیره...' : 'ذخیره تغییرات'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
