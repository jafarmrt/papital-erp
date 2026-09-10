import React, { useState } from 'react';
import { 
  X, Layers, Check, Loader2, AlertCircle
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { PurchaseRequisition } from '../../types';
import { fetchJson } from '../../api';

interface ConsolidateRequisitionsModalProps {
  isOpen: boolean;
  selectedRequisitions: PurchaseRequisition[];
  onClose: () => void;
  onSuccess: () => void;
}

export function ConsolidateRequisitionsModal({
  isOpen,
  selectedRequisitions,
  onClose,
  onSuccess
}: ConsolidateRequisitionsModalProps) {
  const [title, setTitle] = useState(
    () => `تجمیع درخواست‌های خرید (${selectedRequisitions.map(r => r.code).join('، ')})`
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error('عنوان درخواست تجمیعی الزامی است.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetchJson<{ success: boolean; message?: string }>('/api/procurement/consolidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requisitionIds: selectedRequisitions.map(r => r.id),
          title: title.trim()
        })
      });

      toast.success(res.message || 'درخواست‌های خرید با موفقیت تجمیع شدند.');
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'خطا در تجمیع درخواست‌های خرید');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center z-50 p-4 font-farsi">
      <div className="bg-white rounded-2xl max-w-xl w-full flex flex-col shadow-2xl border border-slate-200 animate-fadeIn">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center font-bold">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-slate-900 text-base">تجمیع درخواست‌های خرید</h3>
              <p className="text-xs text-slate-500 mt-0.5">ادغام اقلام مشترک برای خرید عمده با تخفیف حجمی</p>
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

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1">
              درخواست‌های انتخابی جهت تجمیع ({selectedRequisitions.length} مورد):
            </label>
            <div className="flex flex-wrap gap-1.5 p-3 bg-slate-50 border border-slate-200 rounded-xl">
              {selectedRequisitions.map(r => (
                <span key={r.id} className="px-2.5 py-1 bg-white border border-slate-300 rounded-lg font-mono font-bold text-slate-800">
                  {r.code} - {r.projectName || r.title}
                </span>
              ))}
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">عنوان درخواست تجمیعی جدید:</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full p-2 bg-white border border-slate-300 rounded-lg text-slate-800 font-bold focus:ring-2 focus:ring-purple-400 focus:outline-none"
            />
          </div>

          <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl text-purple-900 leading-relaxed">
            💡 اقلام یکسان بر اساس کد یا شناسه انبار به صورت خودکار با یکدیگر جمع شده و به عنوان یک درخواست خرید واحد به جریان خواهند افتاد.
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl font-bold transition-colors cursor-pointer"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-bold rounded-xl flex items-center gap-2 transition-all shadow-md cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  در حال تجمیع...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  ایجاد درخواست تجمیعی
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
