import React, { useState } from 'react';
import { X, Plus, Trash2, Loader2, Check, FileText } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Item } from '../../types';
import { fetchJson } from '../../api';
import { getTodayJalaliDate, formatPersianPrice } from '../../utils';

interface CreateRequisitionModalProps {
  isOpen: boolean;
  warehouseItems: Item[];
  onClose: () => void;
  onSuccess: () => void;
}

interface NewItemRow {
  id: string;
  itemId: number | null;
  itemCode: string;
  itemName: string;
  unit: string;
  requestedQty: number;
  unitPriceEstimate: number;
  notes: string;
}

export function CreateRequisitionModal({
  isOpen,
  warehouseItems,
  onClose,
  onSuccess
}: CreateRequisitionModalProps) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<'urgent' | 'high' | 'normal' | 'low'>('normal');
  const [requiredDate, setRequiredDate] = useState(() => getTodayJalaliDate());
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [items, setItems] = useState<NewItemRow[]>([
    {
      id: `item-${Date.now()}`,
      itemId: null,
      itemCode: '',
      itemName: '',
      unit: 'عدد',
      requestedQty: 1,
      unitPriceEstimate: 0,
      notes: ''
    }
  ]);

  if (!isOpen) return null;

  const handleAddItem = () => {
    setItems(prev => [
      ...prev,
      {
        id: `item-${Date.now()}-${prev.length}`,
        itemId: null,
        itemCode: '',
        itemName: '',
        unit: 'عدد',
        requestedQty: 1,
        unitPriceEstimate: 0,
        notes: ''
      }
    ]);
  };

  const handleRemoveItem = (id: string) => {
    if (items.length <= 1) {
      toast.error('حداقل یک قلم کالا باید در درخواست خرید وجود داشته باشد.');
      return;
    }
    setItems(prev => prev.filter(i => i.id !== id));
  };

  const handleSelectWarehouseItem = (rowId: string, itemId: number) => {
    const matched = warehouseItems.find(w => w.id === itemId);
    if (!matched) return;

    setItems(prev => prev.map(i => {
      if (i.id !== rowId) return i;
      return {
        ...i,
        itemId: matched.id,
        itemCode: matched.code || '',
        itemName: matched.name,
        unit: matched.unit || 'عدد',
        unitPriceEstimate: (matched as any).purchase_price || (matched as any).unit_price || matched.weightedAverageCost || 0
      };
    }));
  };

  const handleUpdateItemField = (rowId: string, field: keyof NewItemRow, val: any) => {
    setItems(prev => prev.map(i => i.id === rowId ? { ...i, [field]: val } : i));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error('عنوان درخواست خرید الزامی است.');
      return;
    }

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.itemName.trim()) {
        toast.error(`نام کالا برای ردیف ${i + 1} الزامی است.`);
        return;
      }
      if (it.requestedQty <= 0) {
        toast.error(`مقدار درخواستی ردیف ${i + 1} باید بزرگتر از صفر باشد.`);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const res = await fetchJson<{ success: boolean; data?: any; message?: string }>('/api/procurement/requisitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          priority,
          requiredDate,
          notes: notes.trim(),
          items: items.map(i => ({
            itemId: i.itemId,
            itemCode: i.itemCode,
            itemName: i.itemName,
            unit: i.unit,
            requestedQty: Number(i.requestedQty),
            unitPriceEstimate: Number(i.unitPriceEstimate || 0),
            notes: i.notes
          }))
        })
      });

      toast.success(res.message || 'درخواست خرید با موفقیت ایجاد گردید.');
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'خطا در ثبت درخواست خرید');
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalEstimate = items.reduce((s, i) => s + (i.requestedQty * i.unitPriceEstimate), 0);

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center z-50 p-4 font-farsi">
      <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 animate-fadeIn">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center font-bold">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-slate-900 text-base">ثبت درخواست خرید جدید</h3>
              <p className="text-xs text-slate-500 mt-0.5">ایجاد درخواست خرید متریال، ابزارآلات و اقلام عمومی انبار</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
            <div className="sm:col-span-2">
              <label className="block font-bold text-slate-700 mb-1">
                عنوان درخواست خرید <span className="text-rose-500">*</span>:
              </label>
              <input
                type="text"
                placeholder="مثلاً: خرید ورق‌های برنجی و مهره‌های فلزی طرح بهار"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full p-2 bg-white border border-slate-300 rounded-lg text-slate-800 font-bold focus:ring-2 focus:ring-amber-400 focus:outline-none"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">اولویت خرید:</label>
              <select
                value={priority}
                onChange={e => setPriority(e.target.value as any)}
                className="w-full p-2 bg-white border border-slate-300 rounded-lg text-slate-800 font-bold focus:ring-2 focus:ring-amber-400 focus:outline-none"
              >
                <option value="normal">عادی</option>
                <option value="high">بالا</option>
                <option value="urgent">فوری / اضطراری</option>
                <option value="low">پایین</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">تاریخ نیاز به کالا:</label>
              <input
                type="text"
                value={requiredDate}
                onChange={e => setRequiredDate(e.target.value)}
                className="w-full p-2 bg-white border border-slate-300 rounded-lg text-slate-800 font-mono focus:ring-2 focus:ring-amber-400 focus:outline-none"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-bold text-slate-700 mb-1">توضیحات و مشخصات فنی:</label>
              <input
                type="text"
                placeholder="برند، عیار، ابعاد یا ملاحظات بازرسی"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="w-full p-2 bg-white border border-slate-300 rounded-lg text-slate-800 focus:ring-2 focus:ring-amber-400 focus:outline-none"
              />
            </div>
          </div>

          {/* Items Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 text-sm">اقلام درخواستی ({items.length} قلم)</span>
              <button
                type="button"
                onClick={handleAddItem}
                className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 font-bold text-xs rounded-xl flex items-center gap-1.5 border border-amber-200 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                افزودن سطر جدید
              </button>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-2.5 text-center w-10">ردیف</th>
                    <th className="p-2.5 w-56">انتخاب از انبار</th>
                    <th className="p-2.5">نام و مشخصات کالا</th>
                    <th className="p-2.5 text-center w-20">واحد</th>
                    <th className="p-2.5 text-center w-24">مقدار</th>
                    <th className="p-2.5 text-center w-32">برآورد قیمت واحد (ریال)</th>
                    <th className="p-2.5 text-center">جمع ردیف</th>
                    <th className="p-2.5 text-center w-12">حذف</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((row, idx) => (
                    <tr key={row.id} className="hover:bg-slate-50/50">
                      <td className="p-2.5 text-center font-mono text-slate-400">{idx + 1}</td>
                      <td className="p-2.5">
                        <select
                          onChange={e => handleSelectWarehouseItem(row.id, Number(e.target.value))}
                          value={row.itemId || ''}
                          className="w-full p-1.5 bg-slate-50 border border-slate-300 rounded text-slate-700 text-xs focus:bg-white"
                        >
                          <option value="">انتخاب کالای کاتالوگ...</option>
                          {warehouseItems.map(w => (
                            <option key={w.id} value={w.id}>
                              {w.name} {w.code ? `(${w.code})` : ''}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2.5">
                        <input
                          type="text"
                          placeholder="نام کالا"
                          value={row.itemName}
                          onChange={e => handleUpdateItemField(row.id, 'itemName', e.target.value)}
                          className="w-full p-1.5 bg-white border border-slate-300 rounded font-bold text-slate-800"
                        />
                      </td>
                      <td className="p-2.5 text-center">
                        <input
                          type="text"
                          value={row.unit}
                          onChange={e => handleUpdateItemField(row.id, 'unit', e.target.value)}
                          className="w-16 p-1.5 bg-white border border-slate-300 rounded text-center text-slate-800"
                        />
                      </td>
                      <td className="p-2.5 text-center">
                        <input
                          type="number"
                          min={0.001}
                          step="any"
                          value={row.requestedQty === 0 ? '' : row.requestedQty}
                          onChange={e => handleUpdateItemField(row.id, 'requestedQty', e.target.value === '' ? 0 : Number(e.target.value))}
                          placeholder="۱"
                          className="w-20 p-1.5 bg-white border border-slate-300 rounded text-center font-mono font-bold text-slate-800 focus:ring-2 focus:ring-amber-400 focus:outline-none"
                          dir="ltr"
                        />
                      </td>
                      <td className="p-2.5 text-center">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={row.unitPriceEstimate === 0 ? '' : row.unitPriceEstimate}
                          onChange={e => handleUpdateItemField(row.id, 'unitPriceEstimate', e.target.value === '' ? 0 : Number(e.target.value))}
                          placeholder="۰"
                          className="w-28 p-1.5 bg-white border border-slate-300 rounded text-center font-mono text-slate-800 focus:ring-2 focus:ring-amber-400 focus:outline-none"
                          dir="ltr"
                        />
                      </td>
                      <td className="p-2.5 text-center font-mono font-bold text-amber-700">
                        {formatPersianPrice(row.requestedQty * row.unitPriceEstimate)}
                      </td>
                      <td className="p-2.5 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(row.id)}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Summary Banner */}
          <div className="flex items-center justify-between p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs">
            <span className="font-bold text-amber-900">برآورد کل هزینه خرید:</span>
            <span className="text-base font-black font-mono text-slate-900">
              {formatPersianPrice(totalEstimate)}
            </span>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl font-bold text-xs transition-colors cursor-pointer"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-black text-xs rounded-xl flex items-center gap-2 transition-all shadow-md cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  در حال ثبت...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  ثبت رسمی درخواست خرید
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
