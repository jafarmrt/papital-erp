import { useEffect, useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import { Item } from '../../types';
import { fetchJson } from '../../api';
import { errorMessageOf, formatPersianDateTime } from '../../utils';
import { ITEM_CODE_CHANGE_REASON_MAX, itemCodeChangeError } from '../../lib/items/itemCodeChange';
import { PHONE_SHEET_OVERLAY, PHONE_TAP_TARGET } from '../../lib/pwa/phoneLayout';

interface CodeHistoryRow {
  oldCode: string;
  newCode: string;
  reason: string;
  username: string;
  createdAt: string;
}

interface ItemCodeChangeModalProps {
  item: Item;
  onClose: () => void;
  onChanged: () => void;
}

/**
 * v10.1.7 (D-15, TD-1264): «تغییر کد» of the item list, shown with `products.change_code`. The code is the online shop's
 * SKU: the window says the site's code is changed by hand, and lists the item's earlier codes.
 */
export function ItemCodeChangeModal({ item, onClose, onChanged }: ItemCodeChangeModalProps) {
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<CodeHistoryRow[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetchJson<{ data?: CodeHistoryRow[] }>(`/items/${item.id}/code-history`, { signal: controller.signal })
      .then(res => setHistory(Array.isArray(res?.data) ? res.data : []))
      .catch(() => { if (!controller.signal.aborted) setHistory([]); });
    return () => controller.abort();
  }, [item.id]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = itemCodeChangeError(item.code, code, reason);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setIsSaving(true);
    try {
      await fetchJson(`/items/${item.id}/change-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim(), reason: reason.trim(), version: item.version }),
      });
      toast.success(`کد کالا به ${code.trim()} تغییر کرد؛ کد این کالا را در سایت هم تغییر دهید.`);
      onChanged();
      onClose();
    } catch (err) {
      setError(errorMessageOf(err) || 'تغییر کد کالا انجام نشد.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={PHONE_SHEET_OVERLAY} role="dialog" aria-label="تغییر کد کالا">
      <form onSubmit={submit} className="bg-white w-full sm:max-w-md sm:rounded-2xl shadow-2xl flex flex-col max-h-full sm:max-h-[90vh]">
        <div className="p-4 border-b border-slate-200 bg-slate-50 shrink-0">
          <h2 className="text-sm font-bold text-slate-800">تغییر کد کالا</h2>
          <p className="text-xs text-slate-500 mt-1">{item.name}</p>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto flex-1 text-xs">
          <div>
            <span className="block text-slate-500 mb-1">کد فعلی</span>
            <span className="font-mono font-bold text-slate-700" dir="ltr">{item.code}</span>
          </div>
          <label className="block">
            <span className="block text-slate-600 font-bold mb-1">کد تازه</span>
            <input
              type="text"
              value={code}
              onChange={e => setCode(e.target.value)}
              dir="ltr"
              className={`w-full border border-slate-300 rounded-xl px-3 py-2 text-sm font-mono text-left ${PHONE_TAP_TARGET}`}
            />
          </label>
          <label className="block">
            <span className="block text-slate-600 font-bold mb-1">دلیل تغییر</span>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              maxLength={ITEM_CODE_CHANGE_REASON_MAX}
              rows={3}
              className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm"
            />
          </label>
          <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-2.5 leading-6">
            کد کالا همان کد کالا در فروشگاه اینترنتی است. پس از تغییر، کد همین کالا را در سایت هم دستی تغییر دهید. سفارشی که تا آن زمان با کد قدیم برسد، کالا را پیدا می‌کند.
          </p>
          {error && <p className="text-rose-700 font-bold" role="alert">{error}</p>}
          {history.length > 0 && (
            <div>
              <span className="block text-slate-600 font-bold mb-1">کدهای قبلی</span>
              <ul className="space-y-1.5">
                {history.map(h => (
                  <li key={`${h.createdAt}-${h.oldCode}`} className="border border-slate-200 rounded-lg p-2">
                    <span className="font-mono" dir="ltr">{h.oldCode} → {h.newCode}</span>
                    <span className="block text-slate-500 mt-0.5">{formatPersianDateTime(h.createdAt)}{h.username ? ` · ${h.username}` : ''}</span>
                    <span className="block text-slate-600 mt-0.5">{h.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="p-4 border-t border-slate-200 flex justify-end gap-2 bg-slate-50 shrink-0">
          <button type="button" onClick={onClose} className={`px-4 py-2 border border-slate-300 rounded-xl bg-white text-slate-700 text-xs font-bold ${PHONE_TAP_TARGET}`}>
            انصراف
          </button>
          <button type="submit" disabled={isSaving} className={`px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold disabled:opacity-50 text-xs ${PHONE_TAP_TARGET}`}>
            {isSaving ? 'در حال ثبت...' : 'تغییر کد'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default ItemCodeChangeModal;
