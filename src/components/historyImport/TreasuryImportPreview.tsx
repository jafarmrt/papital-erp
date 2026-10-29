import { useMemo, useState } from 'react';
import type { TreasuryImportResult } from '../../lib/historyImport/treasuryHistoryImport';
import { rowKey, type PersonnelUse, type ResolvedTreasuryRow } from '../../lib/historyImport/treasurySheet';
import { formatPersianCode, formatPersianNumber } from '../../utils';

/**
 * v11 history import, tool 1: the rows of the file after the server's preview (or post): what each becomes and, for a
 * refused or doubtful row, why. A colleague's row can change its use here; a row like one already recorded can be accepted.
 */
interface Props {
  resolved: ResolvedTreasuryRow[];
  result: TreasuryImportResult | null;
  uses: Record<string, PersonnelUse>;
  accepted: ReadonlySet<string>;
  bankTitle: (id: number) => string;
  amountText: (amount: string) => string;
  onUse: (key: string, use: PersonnelUse) => void;
  onAccept: (key: string, accepted: boolean) => void;
}

const KIND_LABEL: Record<string, string> = { receipt: 'دریافت', payment: 'پرداخت', transfer: 'انتقال', payslip: 'پرداخت فیش حقوق', colleague_expense: 'هزینهٔ پرداختی همکار' };
const USE_LABEL: Record<PersonnelUse, string> = { payslip: 'حقوق (از فیش)', advance: 'مساعده', colleague_account: 'حساب جاری همکار (تنخواه یا بازپرداخت)', other: 'پرداخت دیگر' };

export function TreasuryImportPreview({ resolved, result, uses, accepted, bankTitle, amountText, onUse, onAccept }: Props) {
  const [onlyProblems, setOnlyProblems] = useState(false);
  const outcomeOf = useMemo(() => {
    const map = new Map<string, TreasuryImportResult['rows'][number]>();
    for (const r of result?.rows ?? []) map.set(`${r.sheet}#${r.rowNo}`, r);
    return map;
  }, [result]);
  const shown = resolved.filter(r => {
    if (!onlyProblems) return true;
    const o = outcomeOf.get(rowKey(r.parsed));
    return r.status !== 'ready' || (o && o.status !== 'ok');
  });

  const statusCell = (r: ResolvedTreasuryRow) => {
    if (r.status === 'skipped') return <span className="text-slate-500">کنار گذاشته شد: {r.reason}</span>;
    if (r.status === 'unresolved') return <span className="text-rose-600 font-bold">{r.reason}</span>;
    const o = outcomeOf.get(rowKey(r.parsed));
    if (!o) return <span className="text-slate-400">پیش‌نمایش نشده</span>;
    if (o.status === 'error') return <span role="alert" className="text-rose-600 font-bold">{o.message}</span>;
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
    const settled = o.settled?.map(s => `فاکتور ${formatPersianCode(s.refNumber)}: ${amountText(String(s.amount))}`).join('، ');
    return (
      <span className="text-emerald-700 dark:text-emerald-400">
        {result?.committed ? `ثبت شد${o.created?.length ? ` (${o.created.map(formatPersianCode).join('، ')})` : ''}` : 'درست است'}
        {settled && <span className="block text-slate-600 dark:text-slate-300">روی {settled}</span>}
      </span>
    );
  };

  const whatCell = (r: ResolvedTreasuryRow) => {
    if (r.status !== 'ready') return r.parsed.typeText;
    const { row } = r;
    if (row.kind === 'transfer') return `انتقال به ${bankTitle(Number(row.toBankAccountId))}`;
    return KIND_LABEL[row.kind] ?? row.kind;
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
              <th className="p-2">از حساب</th>
              <th className="p-2">چه می‌شود</th>
              <th className="p-2">طرف حساب</th>
              <th className="p-2">مبلغ</th>
              <th className="p-2">نتیجه</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {shown.map(r => {
              const key = rowKey(r.parsed);
              return (
                <tr key={key} className="align-top">
                  <td className="p-2 whitespace-nowrap">{r.parsed.sheet} — {formatPersianNumber(r.parsed.rowNo)}</td>
                  <td className="p-2 whitespace-nowrap">{formatPersianCode(r.parsed.date)}</td>
                  <td className="p-2">{r.status === 'ready' && r.row.kind !== 'colleague_expense' ? bankTitle(r.row.bankAccountId) : r.parsed.bankName}</td>
                  <td className="p-2">
                    {whatCell(r)}
                    {r.status === 'ready' && r.personnel && r.row.kind !== 'colleague_expense' && (
                      <select aria-label={`کاربرد ردیف ${formatPersianNumber(r.parsed.rowNo)}`} className="block mt-1 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-[11px]"
                        value={uses[key] ?? (r.row.kind === 'payslip' ? 'payslip' : r.row.purpose === 'advance' ? 'advance' : r.row.purpose === 'colleague_account' ? 'colleague_account' : 'other')}
                        onChange={e => onUse(key, e.target.value as PersonnelUse)}>
                        {(Object.keys(USE_LABEL) as PersonnelUse[]).map(u => <option key={u} value={u}>{USE_LABEL[u]}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="p-2">{r.parsed.partyName}</td>
                  <td className="p-2 font-bold whitespace-nowrap">{amountText(r.parsed.amount)}</td>
                  <td className="p-2 min-w-[14rem]">{statusCell(r)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
