import type { ReactNode } from 'react';
import { Trophy, Users } from 'lucide-react';
import type { ReportMoney } from '../../../hooks/reports/useReportMoney';
import type { SalesTopEntry } from '../../../lib/reports/salesReport';
import { formatPersianNumber, formatPersianCode } from '../../../utils';

/**
 * v10.1.8 (D-03، طرح گزارش‌های مدیریتی §۲.۳): ده کالای پرفروش و ده مشتری بزرگ بازه، به فروش خالص پس از برگشت، با همان
 * پالایه‌های گزارش.
 */

function TopList({ title, icon, entries, money, withQuantity }: {
  title: string;
  icon: ReactNode;
  entries: SalesTopEntry[];
  money: ReportMoney;
  withQuantity: boolean;
}) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm p-4">
      <h3 className="flex items-center gap-2 text-sm font-black text-slate-800 dark:text-slate-100 mb-2">{icon}{title}</h3>
      {entries.length === 0 ? (
        <p className="text-xs text-slate-500 py-4 text-center">فروشی نیست.</p>
      ) : (
        <ol className="space-y-1">
          {entries.map((entry, index) => (
            <li key={entry.key} className="flex items-center justify-between gap-3 text-xs py-1 border-b border-slate-100 dark:border-slate-700 last:border-0">
              <span className="flex items-center gap-2 min-w-0">
                <span className="w-5 text-center font-black text-slate-400">{formatPersianNumber(index + 1)}</span>
                <span className="font-bold text-slate-800 dark:text-slate-100 truncate">{entry.label}</span>
                {entry.code && <span className="text-[11px] text-slate-500 font-mono">{formatPersianCode(entry.code)}</span>}
              </span>
              <span className="flex items-center gap-3 shrink-0 font-mono">
                {withQuantity && entry.quantity !== null && (
                  <span className="text-slate-500">{formatPersianNumber(entry.quantity, 4)}{entry.unit ? ` ${entry.unit}` : ''}</span>
                )}
                <span className="font-black text-indigo-700 dark:text-indigo-300">{money.format(entry.netAfterReturns)}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function SalesTopLists({ topItems, topCustomers, money }: { topItems: SalesTopEntry[]; topCustomers: SalesTopEntry[]; money: ReportMoney }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <TopList title={`ده کالای پرفروش (${money.label})`} icon={<Trophy className="w-4 h-4 text-amber-500" />} entries={topItems} money={money} withQuantity />
      <TopList title={`ده مشتری بزرگ (${money.label})`} icon={<Users className="w-4 h-4 text-indigo-500" />} entries={topCustomers} money={money} withQuantity={false} />
    </div>
  );
}
