import { useCallback, useEffect, useState } from 'react';
import { Scale, RefreshCw, FlaskConical, Wrench, AlertTriangle } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { fetchJson } from '../../api';
import { formatPersianNumber } from '../../utils';

/**
 * v7.0.33 (TD-200 / audit P1-9): تطبیق موجودی تفکیکی انبارها با دفتر کاردکس و ترمیم دستی.
 * پیش‌فرض «بررسی آزمایشی» است؛ اعمال ترمیم فقط مقدار موجودی را اصلاح می‌کند، نه بهای میانگین موزون،
 * و مانده‌های منفی و محل‌های نامعلوم کاردکس را دست نمی‌زند.
 */

interface ReconRow {
  itemId: number;
  itemCode: string;
  itemName: string;
  warehouseId: number;
  warehouseCode: string;
  warehouseName: string;
  ledgerQty: number;
  tableQty: number | null;
  status: 'ok' | 'mismatch' | 'negative_ledger' | 'blocked_unresolved';
  codeMismatch: boolean;
}

interface ReconReport {
  summary: {
    itemsChecked: number;
    mismatchRows: number;
    negativeLedgerRows: number;
    blockedItems: number;
    codeMismatchRows: number;
    cacheMismatchItems: number;
    repairableItems: number;
  };
  rows: ReconRow[];
  unresolvedLocations: Array<{ itemId: number; itemCode: string; location: string; qty: number }>;
}

interface RepairResponse {
  message?: string;
  data?: { itemsRepaired: number; rowsChanged: number; negativeLedgerRows: number; blockedItems: number };
}

const STATUS_LABELS: Record<ReconRow['status'], { label: string; className: string }> = {
  ok: { label: 'هم‌خوان', className: 'bg-emerald-100 text-emerald-800' },
  mismatch: { label: 'مغایرت با کاردکس', className: 'bg-amber-100 text-amber-800' },
  negative_ledger: { label: 'مانده منفی — نیازمند سند انبارگردانی', className: 'bg-rose-100 text-rose-800' },
  blocked_unresolved: { label: 'محل نامعلوم در کاردکس', className: 'bg-slate-200 text-slate-700' },
};

export function WarehouseStockReconciliationPanel() {
  const [report, setReport] = useState<ReconReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const loadReport = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await fetchJson<ReconReport>('/inventory/warehouse-stock-reconciliation', { signal });
      setReport(res);
    } catch (err: any) {
      if (err?.name !== 'AbortError') toast.error(err?.message || 'خطا در دریافت گزارش تطبیق موجودی انبارها');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadReport(controller.signal);
    return () => controller.abort();
  }, [loadReport]);

  const runRepair = async (dryRun: boolean) => {
    if (!dryRun && !window.confirm('موجودی انبارهای دارای مغایرت از روی کاردکس اصلاح می‌شود (مانده‌های منفی تغییر نمی‌کنند). ادامه می‌دهید؟')) return;
    setIsSaving(true);
    try {
      const res = await fetchJson<RepairResponse>('/inventory/warehouse-stock-reconciliation/repair', {
        method: 'POST',
        body: JSON.stringify({ dryRun }),
      });
      if (dryRun) {
        setPreview(res.message || null);
      } else {
        setPreview(null);
        toast.success(res.message || 'ترمیم موجودی انبارها انجام شد');
        await loadReport();
      }
    } catch (err: any) {
      toast.error(err?.message || 'خطا در ترمیم موجودی انبارها');
    } finally {
      setIsSaving(false);
    }
  };

  const rows = Array.isArray(report?.rows) ? report!.rows : [];
  const unresolved = Array.isArray(report?.unresolvedLocations) ? report!.unresolvedLocations : [];
  const summary = report?.summary;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm">
      <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Scale size={18} className="text-indigo-600" />
          <div>
            <h3 className="font-bold text-slate-800 text-sm">تطبیق موجودی انبارها با کاردکس</h3>
            <p className="text-[11px] text-slate-500">مقایسه موجودی ثبت‌شده هر انبار با گردش کاردکس؛ ترمیم فقط مقدار موجودی را اصلاح می‌کند.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => loadReport()} disabled={loading} className="px-3 py-1.5 rounded-lg text-xs border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 inline-flex items-center gap-1">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> به‌روزرسانی
          </button>
          <button onClick={() => runRepair(true)} disabled={isSaving || !summary?.repairableItems} className="px-3 py-1.5 rounded-lg text-xs border border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 inline-flex items-center gap-1">
            <FlaskConical size={13} /> بررسی آزمایشی
          </button>
          <button onClick={() => runRepair(false)} disabled={isSaving || !summary?.repairableItems} className="px-3 py-1.5 rounded-lg text-xs bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-1">
            <Wrench size={13} /> {isSaving ? 'در حال اجرا...' : 'اعمال ترمیم'}
          </button>
        </div>
      </div>

      {summary && (
        <div className="px-4 pt-3 flex flex-wrap gap-2 text-[11px]">
          <span className="bg-amber-50 text-amber-800 px-2 py-1 rounded-lg">مغایرت: {formatPersianNumber(summary.mismatchRows)}</span>
          <span className="bg-rose-50 text-rose-800 px-2 py-1 rounded-lg">مانده منفی: {formatPersianNumber(summary.negativeLedgerRows)}</span>
          <span className="bg-slate-100 text-slate-700 px-2 py-1 rounded-lg">کالا با محل نامعلوم: {formatPersianNumber(summary.blockedItems)}</span>
          <span className="bg-sky-50 text-sky-800 px-2 py-1 rounded-lg">کد انبار نادرست: {formatPersianNumber(summary.codeMismatchRows)}</span>
          <span className="bg-indigo-50 text-indigo-800 px-2 py-1 rounded-lg">کالای قابل ترمیم: {formatPersianNumber(summary.repairableItems)}</span>
        </div>
      )}
      {preview && (
        <div className="mx-4 mt-3 p-2.5 rounded-lg bg-indigo-50 border border-indigo-100 text-xs text-indigo-900">{preview}</div>
      )}

      <div className="overflow-x-auto max-h-[60vh] overflow-y-auto mt-3">
        <table className="w-full text-right text-xs">
          <thead className="bg-slate-50 text-slate-500 border-y border-slate-200 sticky top-0">
            <tr>
              <th className="p-2.5 font-semibold">کالا</th>
              <th className="p-2.5 font-semibold">انبار</th>
              <th className="p-2.5 font-semibold">مانده کاردکس</th>
              <th className="p-2.5 font-semibold">موجودی ثبت‌شده</th>
              <th className="p-2.5 font-semibold">وضعیت</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-5 text-center text-slate-400">
                  {loading ? 'در حال بررسی...' : 'موجودی همه انبارها با کاردکس هم‌خوان است.'}
                </td>
              </tr>
            ) : rows.map(r => (
              <tr key={`${r.itemId}-${r.warehouseId}`} className="hover:bg-slate-50/80">
                <td className="p-2.5"><span className="font-mono text-slate-500">{r.itemCode}</span> {r.itemName}</td>
                <td className="p-2.5">{r.warehouseName}</td>
                <td className="p-2.5 font-mono">{formatPersianNumber(r.ledgerQty)}</td>
                <td className="p-2.5 font-mono">{r.tableQty === null ? '—' : formatPersianNumber(r.tableQty)}</td>
                <td className="p-2.5">
                  <span className={`${STATUS_LABELS[r.status].className} px-2 py-0.5 rounded-full font-bold text-[11px]`}>{STATUS_LABELS[r.status].label}</span>
                  {r.codeMismatch && <span className="mr-1 bg-sky-100 text-sky-800 px-2 py-0.5 rounded-full text-[11px]">کد انبار نادرست</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {unresolved.length > 0 && (
        <div className="m-4 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-1">
          <div className="font-bold flex items-center gap-1"><AlertTriangle size={13} className="text-amber-600" /> گردش کاردکس در محل‌های نامعلوم (این کالاها ترمیم نمی‌شوند):</div>
          {unresolved.slice(0, 50).map((u, idx) => (
            <div key={`${u.itemId}-${idx}`}><span className="font-mono">{u.itemCode}</span> — محل «{u.location}»: {formatPersianNumber(u.qty)}</div>
          ))}
        </div>
      )}
    </div>
  );
}
