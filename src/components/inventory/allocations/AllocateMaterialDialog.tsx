import { useEffect, useId, useState, type FormEvent } from 'react';
import { AlertCircle, Boxes } from 'lucide-react';
import { errorMessageOf, formatPersianNumber, parseCleanNumber, formatPersianCode } from '../../../utils';
import { SearchableSelect } from '../../SearchableSelect';
import { DecimalInput } from '../../common/DecimalInput';
import { DialogLayer } from '../../common/DialogLayer';
import { RecipientPersonnelField } from '../../workshop/RecipientPersonnelField';
import type { BomAllocations } from './useBomAllocations';

/**
 * «تخصیص مواد به پروژه»: a raw material from a warehouse to an open project, with who receives it. The form starts
 * afresh on each opening: the first open project and material, quantity 1 and the first active warehouse (TD-751).
 */
export function AllocateMaterialDialog({ list, onClose }: { list: BomAllocations; onClose: () => void }) {
  const fieldId = useId();
  const { projectsList, itemsList, warehousesList, allocate } = list;
  const [selectedProjectId, setSelectedProjectId] = useState<number | ''>(() => projectsList[0]?.id || '');
  const [selectedItemId, setSelectedItemId] = useState<number | ''>(() => itemsList[0]?.id || '');
  const [allocateQty, setAllocateQty] = useState<string>('1');
  // v9.0.411 (TD-751): انبار پیش‌فرض همان انبار فعال با کمترین شناسه (اولین ردیف فهرست، TD-203)، نه «main» که فهرست نشان نمی‌داد
  const [selectedLocation, setSelectedLocation] = useState(() => warehousesList[0]?.code ?? '');
  useEffect(() => {
    if (!selectedLocation && warehousesList.length > 0) setSelectedLocation(warehousesList[0].code);
  }, [warehousesList, selectedLocation]);
  const [allocateNotes, setAllocateNotes] = useState('');
  // v10.1.37 (N-01, TD-1283): the personnel who receives the materials
  const [recipientPersonnelId, setRecipientPersonnelId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId || !selectedItemId) {
      setErrorMsg('لطفاً پروژه و کالای اولیه را انتخاب کنید.');
      return;
    }

    const qtyNum = parseCleanNumber(allocateQty, 0);
    if (qtyNum <= 0) {
      setErrorMsg('تعداد یا مقدار تخصیص باید بزرگتر از صفر باشد.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    try {
      await allocate({ projectId: selectedProjectId, recipientPersonnelId, itemId: selectedItemId, quantity: qtyNum, location: selectedLocation, notes: allocateNotes });
      onClose();
    } catch (err) {
      setErrorMsg(errorMessageOf(err) || 'خطا در ثبت تخصیص به پروژه');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="تخصیص مواد اولیه به پروژه تولید" className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <DialogLayer onClose={onClose} disabled={submitting} />
      <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl text-right animate-in fade-in zoom-in-95 duration-200 max-h-[85vh] flex flex-col overflow-hidden"><div className="p-6 overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2 text-slate-800 font-black">
            <Boxes className="text-blue-600" size={20} />
            <span>تخصیص مواد اولیه به پروژه تولید</span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1"
          >
            ✕
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
            <AlertCircle size={16} />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3.5 text-xs">
          {/* Project Select */}
          <div>
            <label htmlFor={`${fieldId}-selected-project-id`} className="block text-slate-700 font-bold mb-1">پروژه تولید مقصد:</label>
            {/* v9.0.423 (TD-767): فهرست جست‌وجوپذیر به جای select بومی روی همه پروژه‌ها */}
            <SearchableSelect
              id={`${fieldId}-selected-project-id`}
              value={selectedProjectId}
              onChange={(value) => setSelectedProjectId(value ? Number(value) : '')}
              options={projectsList.map((p) => ({ value: p.id, label: `${formatPersianCode(p.projectCode)} - ${p.title}` }))}
              placeholder="انتخاب پروژه"
            />
          </div>

          {/* Raw Material Select */}
          <div>
            <label htmlFor={`${fieldId}-selected-item-id`} className="block text-slate-700 font-bold mb-1">ماده اولیه / قطعه مصرفی:</label>
            <SearchableSelect
              id={`${fieldId}-selected-item-id`}
              value={selectedItemId}
              onChange={(value) => setSelectedItemId(value ? Number(value) : '')}
              options={itemsList.map((item) => ({
                value: item.id,
                label: `${item.name} (${formatPersianCode(item.code)}) - موجودی کل: ${formatPersianNumber(item.currentStock || item.current_stock || 0)} ${item.unit ?? ''}`,
              }))}
              placeholder="انتخاب ماده اولیه"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Quantity */}
            <div>
              <label htmlFor={`${fieldId}-allocate-qty`} className="block text-slate-700 font-bold mb-1">مقدار تخصیص:</label>
              <DecimalInput
                id={`${fieldId}-allocate-qty`}
                step="0.01"
                min="0.01"
                value={allocateQty}
                onValueChange={(v) => setAllocateQty(v)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-mono font-bold"
              />
            </div>

            {/* Warehouse Location */}
            <div>
              <label htmlFor={`${fieldId}-selected-location`} className="block text-slate-700 font-bold mb-1">انبار مبداء کسر موجودی:</label>
              <select
                id={`${fieldId}-selected-location`}
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-medium"
              >
                {warehousesList.length === 0 ? (
                  <option value="">هیچ انباری یافت نشد</option>
                ) : (
                  warehousesList.map((w) => (
                    <option key={w.id} value={w.code}>
                      {w.name} ({formatPersianCode(w.code)})
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label htmlFor={`${fieldId}-allocate-notes`} className="block text-slate-700 font-bold mb-1">توضیحات و بابت (اختیاری):</label>
            <input
              id={`${fieldId}-allocate-notes`}
              type="text"
              value={allocateNotes}
              onChange={(e) => setAllocateNotes(e.target.value)}
              placeholder="مثال: تخصیص برای سری ساخت اول مهر ماه"
              className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <RecipientPersonnelField
            id={`${fieldId}-recipient`}
            value={recipientPersonnelId}
            onChange={setRecipientPersonnelId}
            disabled={submitting}
          />

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl cursor-pointer transition-colors"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl cursor-pointer transition-colors disabled:opacity-50"
            >
              {submitting ? 'در حال ثبت...' : 'تأیید و ثبت تخصیص'}
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  );
}
