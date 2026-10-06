import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { fetchJson } from '../../api';
import { confirmAction } from '../ConfirmDialogHost';
import { useHasPermission } from '../../contexts/AuthContext';
import { errorMessageOf, formatPersianNumber, formatPersianPrice } from '../../utils';
import { WAC_CORRECTION_PERMISSION, type KardexWacDifferenceRow } from '../../lib/inventoryAudit/wacCorrection';

/**
 * v9.0.84 (TD-487، تصمیم ت۳): پس از «بازسازی موجودی از کاردکس» کالاهایی که بهای میانگین آن‌ها با بازپخش کاردکس
 * نمی‌خواند فهرست می‌شوند. دارنده مجوز «اصلاح میانگین بها از کاردکس» هر کالا را جدا اصلاح می‌کند و سرور در همان
 * تراکنش سند پیش‌نویس اختلاف ارزش صادر می‌کند؛ دیگران فقط فهرست را می‌بینند.
 */
export function KardexWacDifferencesPanel({ rows, onCorrected }: { rows: KardexWacDifferenceRow[]; onCorrected?: () => void }) {
  const canCorrect = useHasPermission(WAC_CORRECTION_PERMISSION);
  const [correctingId, setCorrectingId] = useState<number | null>(null);
  const [correctedIds, setCorrectedIds] = useState<number[]>([]);
  if (rows.length === 0) return null;

  const correct = async (row: KardexWacDifferenceRow): Promise<void> => {
    if (correctingId !== null) return;
    const confirmed = await confirmAction({
      title: 'اصلاح بهای میانگین از کاردکس',
      message: `بهای میانگین «${row.itemName}» از ${formatPersianPrice(row.recordedWac)} به ${formatPersianPrice(row.replayWac)} تغییر می‌کند ` +
        `و برای اختلاف ارزش ${formatPersianPrice(Math.abs(row.valueDifference))} سند پیش‌نویس در برابر «کسری و اضافات انبار» صادر می‌شود. ادامه می‌دهید؟`,
      confirmText: 'اصلاح بها',
      cancelText: 'انصراف',
    });
    if (!confirmed) return;
    setCorrectingId(row.itemId);
    try {
      const res = await fetchJson<{ message?: string }>('/inventory/correct-wac', { method: 'POST', body: JSON.stringify({ itemId: row.itemId }) });
      toast.success(res?.message || 'بهای میانگین اصلاح شد.');
      setCorrectedIds(ids => [...ids, row.itemId]);
      onCorrected?.();
    } catch (err) {
      toast.error(errorMessageOf(err) || 'اصلاح بهای میانگین انجام نشد.');
    } finally {
      setCorrectingId(null);
    }
  };

  return (
    <div className="border border-amber-200 rounded-xl overflow-hidden text-xs">
      <div className="bg-amber-50 p-2.5 font-bold text-amber-800 flex items-center gap-2">
        <AlertTriangle size={14} />
        <span>بهای میانگین این کالاها با کاردکس نمی‌خواند و بازسازی آن را تغییر نداد ({formatPersianNumber(rows.length)} کالا)</span>
      </div>
      <div className="max-h-48 overflow-y-auto divide-y divide-slate-100">
        {rows.map(row => {
          const done = correctedIds.includes(row.itemId);
          return (
            <div key={row.itemId} className="p-2.5 flex items-center justify-between gap-2 hover:bg-slate-50">
              <div>
                <span className="font-bold text-slate-800">{row.itemName}</span>
                <span className="font-mono text-slate-400 mr-2">({row.itemCode})</span>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  ثبت‌شده {formatPersianPrice(row.recordedWac)}، کاردکس {formatPersianPrice(row.replayWac)}، موجودی {formatPersianNumber(row.stock)}
                </div>
              </div>
              {done ? (
                <span className="inline-flex items-center gap-1 text-emerald-700 font-bold"><CheckCircle2 size={13} />اصلاح شد</span>
              ) : canCorrect ? (
                <button
                  type="button"
                  onClick={() => { void correct(row); }}
                  disabled={correctingId !== null}
                  className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold disabled:opacity-50"
                >
                  {correctingId === row.itemId ? 'در حال اصلاح...' : 'اصلاح بها'}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {!canCorrect && (
        <div className="p-2.5 bg-slate-50 text-[11px] text-slate-500">اصلاح بهای میانگین فقط با مجوز «اصلاح میانگین بها از کاردکس» ممکن است.</div>
      )}
    </div>
  );
}
