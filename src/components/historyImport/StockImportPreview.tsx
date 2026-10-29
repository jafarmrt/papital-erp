import { useMemo, useState } from 'react';
import type { StockImportResult } from '../../lib/historyImport/stockHistoryImport';
import type { ResolvedStockRow } from '../../lib/historyImport/stockSheet';
import { rowKey } from '../../lib/historyImport/treasurySheet';
import { formatPersianCode, formatPersianNumber } from '../../utils';

/**
 * v11 history import, tool 2: the rows of the file after the server's preview (or post): what each becomes and, for a
 * refused or doubtful row, why. A code the app does not know can be mapped to the app's code here; a row like one already
 * recorded can be accepted.
 */
interface Props {
  resolved: ResolvedStockRow[];
  result: StockImportResult | null;
  accepted: ReadonlySet<string>;
  warehouseTitle: (code: string | null | undefined) => string;
  onAccept: (key: string, accepted: boolean) => void;
  onMapCode: (code: string, target: string) => void;
}

const KIND_LABEL: Record<string, string> = {
  opening: 'موجودی اولیه', purchase: 'رسید خرید', production: 'رسید تولید', consumption: 'حواله مصرف', waste: 'ضایعات', transfer: 'انتقال',
};

function CodeFix({ code, onMap }: { code: string; onMap: (target: string) => void }) {
  const [target, setTarget] = useState('');
  return (
    <span className="flex items-center gap-1 mt-1">
      <input aria-label={`کد درست برای ${code}`} dir="ltr" className="w-28 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-1 text-[11px]"
        value={target} onChange={e => setTarget(e.target.value)} placeholder="کد برنامه" />
      <button type="button" className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300" disabled={!target.trim()} onClick={() => onMap(target.trim())}>وصل کن</button>
      <button type="button" className="text-[11px] text-slate-500" onClick={() => onMap('')}>کنار بگذار</button>
    </span>
  );
}

export function StockImportPreview({ resolved, result, accepted, warehouseTitle, onAccept, onMapCode }: Props) {
  const [onlyProblems, setOnlyProblems] = useState(false);
  const outcomeOf = useMemo(() => {
    const map = new Map<string, StockImportResult['rows'][number]>();
    for (const r of result?.rows ?? []) map.set(`${r.sheet}#${r.rowNo}`, r);
    return map;
  }, [result]);
  const shown = resolved.filter(r => {
    if (!onlyProblems) return true;
    const o = outcomeOf.get(rowKey(r.parsed));
    return r.status !== 'ready' || (o && o.status !== 'ok');
  });

  const statusCell = (r: ResolvedStockRow) => {
    if (r.status === 'skipped') return <span className="text-slate-500">کنار گذاشته شد: {r.reason}</span>;
    if (r.status === 'unresolved') return <span className="text-rose-600 font-bold">{r.reason}</span>;
    const o = outcomeOf.get(rowKey(r.parsed));
    if (!o) return <span className="text-slate-400">پیش‌نمایش نشده</span>;
    if (o.status === 'error') {
      return (
        <span role="alert" className="text-rose-600 font-bold">
          {o.message}
          {o.unknownCode && <CodeFix code={o.unknownCode} onMap={target => onMapCode(o.unknownCode as string, target)} />}
        </span>
      );
    }
    if (o.status === 'duplicate') {
      return (
        <span className="text-amber-700 dark:text-amber-400">
          {o.message}
          <label className="flex items-center gap-1 mt-1 font-bold">
            <input type="checkbox" checked={accepted.has(rowKey(r.parsed))} onChange={e => onAccept(rowKey(r.parsed), e.target.checked)} />
            تکراری نیست، ثبت شود
          </label>
        </span>
      );
    }
    return (
      <span className="text-emerald-700 dark:text-emerald-400">
        {result?.committed ? `ثبت شد${o.created?.length ? ` (${o.created.map(formatPersianCode).join('، ')})` : ''}` : 'درست است'}
      </span>
    );
  };

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        <input type="checkbox" checked={onlyProblems} onChange={e => setOnlyProblems(e.target.checked)} />
        فقط ردیف‌های دارای ایراد
      </label>
      <div className="overflow-x-auto max-h-[55vh]">
        <table className="w-full text-xs text-right">
          <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 sticky top-0">
            <tr>
              <th className="p-2">برگه و ردیف</th>
              <th className="p-2">تاریخ</th>
              <th className="p-2">چه می‌شود</th>
              <th className="p-2">کد کالا</th>
              <th className="p-2">تعداد</th>
              <th className="p-2">انبار</th>
              <th className="p-2">نتیجه</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {shown.map(r => (
              <tr key={rowKey(r.parsed)} className="align-top">
                <td className="p-2 whitespace-nowrap">{r.parsed.sheet} — {formatPersianNumber(r.parsed.rowNo)}</td>
                <td className="p-2 whitespace-nowrap">{formatPersianCode(r.status === 'ready' ? r.row.date : r.parsed.date)}</td>
                <td className="p-2">{r.status === 'ready' ? KIND_LABEL[r.row.kind] : r.parsed.typeText}</td>
                <td className="p-2 whitespace-nowrap" dir="ltr">{formatPersianCode(r.status === 'ready' ? r.row.itemCode : r.parsed.code)}</td>
                <td className="p-2 font-bold whitespace-nowrap">{formatPersianCode(r.parsed.quantity)}</td>
                <td className="p-2">
                  {r.status === 'ready' ? warehouseTitle(r.row.warehouse) : r.parsed.warehouseName}
                  {r.status === 'ready' && r.row.kind === 'transfer' && ` ← ${warehouseTitle(r.row.toWarehouse)}`}
                </td>
                <td className="p-2 min-w-[14rem]">{statusCell(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
