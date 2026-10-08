import React, { useState } from 'react';
import { X, Plus, Loader2, Check, FileText } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Item } from '../../types';
import { fetchJson } from '../../api';
import { formatPersianNumber, formatPersianPrice, getErrorMessage, getTodayIsoDate } from '../../utils';
import { JalaliDateInput } from '../common/JalaliDateInput';
import { apiFieldErrors } from '../../lib/apiFieldErrors';
import {
  REQUISITION_PRIORITIES, REQUISITION_PRIORITY_LABELS, requisitionFormErrors, type RequisitionPriority,
} from '../../lib/procurement/requisitionFields';
import { FieldError, RequisitionItemRowEditor, type NewRequisitionRow } from './RequisitionItemRowEditor';

interface CreateRequisitionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const newRow = (suffix: string | number): NewRequisitionRow => ({
  id: `item-${Date.now()}-${suffix}`,
  itemId: null,
  itemCode: '',
  itemName: '',
  unit: 'عدد',
  requestedQty: 1,
  unitPriceEstimate: 0,
  notes: '',
});

export function CreateRequisitionModal({
  isOpen,
  onClose,
  onSuccess
}: CreateRequisitionModalProps) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<RequisitionPriority>('normal');
  // تاریخ نیاز ISO است و با تقویم شمسی نشان داده می‌شود (TD-232)
  const [requiredDate, setRequiredDate] = useState(() => getTodayIsoDate());
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [items, setItems] = useState<NewRequisitionRow[]>(() => [newRow(0)]);
  // v9.0.348 (TD-901، ت۵): خطای هر فیلد (بررسی فرم یا Zod سرور) زیر همان فیلد؛ پیش‌تر فقط در اعلان می‌آمد
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const hasErrors = Object.keys(fieldErrors).length > 0;

  if (!isOpen) return null;

  const clearError = (key: string) => {
    if (fieldErrors[key]) setFieldErrors(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key)));
  };

  const handleAddItem = () => {
    setItems(prev => [...prev, newRow(prev.length)]);
  };

  const handleRemoveItem = (id: string) => {
    if (items.length <= 1) {
      setFieldErrors(prev => ({ ...prev, items: 'دست‌کم یک قلم کالا برای درخواست خرید لازم است' }));
      return;
    }
    setItems(prev => prev.filter(i => i.id !== id));
    // کلید خطای ردیف‌ها شماره ردیف است؛ با حذف ردیف شماره‌ها جابه‌جا می‌شوند
    setFieldErrors(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith('items'))));
  };

  // v9.0.347 (TD-700، B10-13): کالا از فهرست انتخاب کالا با جست‌وجوی سرور برگزیده می‌شود
  const handleSelectWarehouseItem = (rowId: string, matched: Item | undefined) => {
    if (!matched) return;
    const index = items.findIndex(i => i.id === rowId);
    clearError(`items.${index}.itemName`);
    setItems(prev => prev.map(i => i.id !== rowId ? i : {
      ...i,
      itemId: matched.id,
      itemCode: matched.code || '',
      itemName: matched.name,
      unit: matched.unit || 'عدد',
      unitPriceEstimate: Number(matched.weightedAverageCost ?? 0) || 0,
    }));
  };

  const handleUpdateItemField = <K extends keyof NewRequisitionRow>(rowId: string, field: K, val: NewRequisitionRow[K]) => {
    clearError(`items.${items.findIndex(i => i.id === rowId)}.${String(field)}`);
    setItems(prev => prev.map(i => i.id === rowId ? { ...i, [field]: val } : i));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors = requisitionFormErrors(title, items);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setIsSubmitting(true);
    try {
      const res = await fetchJson<{ success: boolean; message?: string }>('/api/procurement/requisitions', {
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
    } catch (err: unknown) {
      const serverErrors = apiFieldErrors(err);
      if (Object.keys(serverErrors).length > 0) setFieldErrors(serverErrors);
      else toast.error(getErrorMessage(err));
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
              <p className="text-xs text-slate-500 mt-0.5">ایجاد درخواست خرید مواد، ابزارآلات و اقلام عمومی انبار</p>
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
        <form onSubmit={handleSubmit} noValidate className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
            <div className="sm:col-span-2">
              <label htmlFor="requisition-title" className="block font-bold text-slate-700 mb-1">
                عنوان درخواست خرید <span className="text-rose-500">*</span>:
              </label>
              <input
                id="requisition-title"
                type="text"
                placeholder="مثلاً: خرید ورق‌های برنجی و مهره‌های فلزی طرح بهار"
                value={title}
                onChange={e => { setTitle(e.target.value); clearError('title'); }}
                aria-invalid={Boolean(fieldErrors.title)}
                aria-describedby={fieldErrors.title ? 'requisition-title-error' : undefined}
                className={`w-full p-2 bg-white border rounded-lg text-slate-800 font-bold focus:ring-2 focus:ring-amber-400 focus:outline-none ${fieldErrors.title ? 'border-rose-500' : 'border-slate-300'}`}
              />
              <FieldError id="requisition-title-error" message={fieldErrors.title} />
            </div>

            <div>
              <label htmlFor="requisition-priority" className="block font-bold text-slate-700 mb-1">اولویت خرید:</label>
              <select
                id="requisition-priority"
                value={priority}
                onChange={e => { setPriority(e.target.value as RequisitionPriority); clearError('priority'); }}
                aria-invalid={Boolean(fieldErrors.priority)}
                className="w-full p-2 bg-white border border-slate-300 rounded-lg text-slate-800 font-bold focus:ring-2 focus:ring-amber-400 focus:outline-none"
              >
                {REQUISITION_PRIORITIES.map(p => <option key={p} value={p}>{REQUISITION_PRIORITY_LABELS[p]}</option>)}
              </select>
              <FieldError id="requisition-priority-error" message={fieldErrors.priority} />
            </div>

            <div>
              <label htmlFor="requisition-required-date" className="block font-bold text-slate-700 mb-1">تاریخ نیاز به کالا:</label>
              <JalaliDateInput
                value={requiredDate}
                onChange={iso => { setRequiredDate(iso); clearError('requiredDate'); }}
                placeholder="تاریخ نیاز"
              />
              <FieldError id="requisition-required-date-error" message={fieldErrors.requiredDate} />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="requisition-notes" className="block font-bold text-slate-700 mb-1">توضیحات و مشخصات فنی:</label>
              <input
                id="requisition-notes"
                type="text"
                placeholder="برند، عیار، ابعاد یا ملاحظات بازرسی"
                value={notes}
                onChange={e => { setNotes(e.target.value); clearError('notes'); }}
                className="w-full p-2 bg-white border border-slate-300 rounded-lg text-slate-800 focus:ring-2 focus:ring-amber-400 focus:outline-none"
              />
              <FieldError id="requisition-notes-error" message={fieldErrors.notes} />
            </div>
          </div>

          {/* Items Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 text-sm">اقلام درخواستی ({formatPersianNumber(items.length)} قلم)</span>
              <button
                type="button"
                onClick={handleAddItem}
                className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 font-bold text-xs rounded-xl flex items-center gap-1.5 border border-amber-200 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                افزودن سطر جدید
              </button>
            </div>
            <FieldError id="requisition-items-error" message={fieldErrors.items} />

            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-2.5 text-center w-10">ردیف</th>
                    <th className="p-2.5 w-56">انتخاب از فهرست کالا</th>
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
                    <RequisitionItemRowEditor
                      key={row.id}
                      row={row}
                      index={idx}
                      errors={fieldErrors}
                      onSelectItem={handleSelectWarehouseItem}
                      onChange={handleUpdateItemField}
                      onRemove={handleRemoveItem}
                    />
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

          {hasErrors && (
            <p role="alert" className="text-xs font-bold text-rose-600">
              برخی فیلدها نیاز به اصلاح دارند؛ پیام هر خطا زیر همان فیلد آمده است.
            </p>
          )}

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
