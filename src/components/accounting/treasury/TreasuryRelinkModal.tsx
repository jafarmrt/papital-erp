import React, { useState } from 'react';
import { Link2 } from 'lucide-react';
import { formatPersianDate, formatPersianPrice } from '../../../utils';
import type { TreasuryTransaction } from '../../../types';
import { useTreasuryRelinkOptionsQuery } from '../../../hooks/accounting/useTreasuryQueries';

/**
 * v10.0.48 (TD-1122): «انتقال به سند دیگر». سرور از v9.0.272 (TD-779) انتقال دریافت یا پرداخت به سند فعال دیگر را
 * می‌پذیرد ولی صفحه فقط «علی‌الحساب» داشت. پنجره فقط سندهایی را نشان می‌دهد که سرور می‌پذیرد (هم‌سو، هم‌ارز، هم‌طرف).
 */
export const TreasuryRelinkModal: React.FC<{
  target: TreasuryTransaction | null;
  onClose: () => void;
  onConfirm: (id: number, documentId: number) => Promise<void>;
}> = ({ target, onClose, onConfirm }) => {
  const options = useTreasuryRelinkOptionsQuery(target ? target.id : null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  if (!target) return null;
  const rows = Array.isArray(options.data) ? options.data : [];

  const close = () => { setChosen(null); onClose(); };
  const confirm = async () => {
    if (chosen === null) return;
    setSaving(true);
    try {
      await onConfirm(target.id, chosen);
      close();
    } catch {
      // پیام خطا را صفحه نشان می‌دهد
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-lg w-full max-h-[85vh] flex flex-col border border-slate-200 dark:border-slate-700">
        <div className="p-5 border-b border-slate-100 dark:border-slate-700">
          <h3 className="font-bold text-indigo-700 dark:text-indigo-300 text-base flex items-center gap-2">
            <Link2 size={18} />
            انتقال به سند دیگر
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-6">
            تراکنش «<span className="font-mono font-bold">{target.transactionNumber}</span>» به مبلغ{' '}
            <span className="font-bold">{formatPersianPrice(target.amount)}</span> در تسویه سند انتخابی شمرده می‌شود؛
            سند حسابداری آن تغییر نمی‌کند.
          </p>
        </div>
        <div className="p-5 overflow-y-auto flex-1 space-y-2">
          {options.isLoading ? (
            <p className="text-xs text-slate-500">در حال خواندن سندها…</p>
          ) : options.isError ? (
            <p className="text-xs text-rose-600">سندها خوانده نشد؛ دوباره تلاش کنید.</p>
          ) : rows.length === 0 ? (
            <p className="text-xs text-slate-500">سند فعال دیگری از همین طرف حساب و با همین ارز نیست.</p>
          ) : rows.map(doc => (
            <label key={doc.id} className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40">
              <input type="radio" name="relink-document" checked={chosen === doc.id} onChange={() => setChosen(doc.id)} disabled={saving} />
              <span className="text-xs font-bold text-slate-800 dark:text-slate-100">سند {doc.refNumber}</span>
              <span className="text-[11px] text-slate-500">{doc.date ? formatPersianDate(doc.date) : '—'}</span>
              <span className="text-[11px] text-slate-500 truncate">{doc.buyerName}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-slate-100 dark:border-slate-700">
          <button type="button" onClick={close} disabled={saving}
            className="px-4 py-2 text-xs font-bold border border-slate-200 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer disabled:opacity-50">
            انصراف
          </button>
          <button type="button" onClick={() => { void confirm(); }} disabled={saving || chosen === null}
            className="px-4 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-colors cursor-pointer disabled:opacity-50">
            {saving ? 'در حال انتقال…' : 'انتقال به این سند'}
          </button>
        </div>
      </div>
    </div>
  );
};
