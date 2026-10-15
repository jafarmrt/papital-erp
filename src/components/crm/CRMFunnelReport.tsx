import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingDown, Filter as FunnelIcon } from 'lucide-react';
import { fetchJson } from '../../api';
import { formatPersianNumber, getTodayIsoDate } from '../../utils';
import { presetRange, type ReportRange } from '../../lib/reports/reportPeriods';
import { ReportRangeFields } from '../reports/ReportRangeFields';
import type { FunnelReport, FunnelStage } from '../../lib/crm/funnelReport';
import { CRM_LOST_REASON_LABELS, isLostReason } from '../../lib/crm/leadFields';

const STAGE_LABELS: Record<FunnelStage, string> = {
  lead: 'مخاطب اولیه',
  qualified: 'ارزیابی و نیازسنجی',
  proposal: 'پیش‌فاکتور و پیشنهاد',
  won: 'موفق (بسته شد)',
};

interface PersonnelOption {
  id: number | string;
  fullName?: string;
}

export function funnelReportUrl(range: ReportRange, seller: string): string {
  const params = new URLSearchParams({ fromDate: range.from, toDate: range.to });
  if (seller !== 'all') params.set('assignedPersonnelId', seller);
  return `/crm/reports/funnel?${params.toString()}`;
}

const percent = (value: number | null) => (value === null ? '—' : `${formatPersianNumber(value)}٪`);
const days = (value: number | null) => (value === null ? '—' : `${formatPersianNumber(value)} روز`);

/**
 * v10.1.18 (N-02 بخش ۲، تصمیم ت۷): زبانه «گزارش قیف» صفحه ارتباط با مشتری از `GET /crm/reports/funnel`: برای هر مرحله
 * شمار ورود، پیشرفت به مرحله بعد، درصد پیشرفت و میانگین روزهای ماندن، و دلیل‌های از دست رفتن، در یک بازه و برای یک
 * فروشنده. تغییرهای مرحله پیش از این نسخه ثبت نشده‌اند و در گزارش نمی‌آیند.
 */
export function CRMFunnelReport({ personnelList = [] }: { personnelList?: PersonnelOption[] }) {
  const todayIso = getTodayIsoDate();
  const [range, setRange] = useState<ReportRange>(() => presetRange('this_year', todayIso) ?? { from: todayIso, to: todayIso });
  const [seller, setSeller] = useState('all');
  const url = funnelReportUrl(range, seller);
  const { data, isFetching, error } = useQuery({
    queryKey: ['crm', 'funnel', url],
    queryFn: async ({ signal }) => (await fetchJson(url, { signal })) as FunnelReport,
    staleTime: 60 * 1000,
  });
  const stages = Array.isArray(data?.stages) ? data.stages : [];
  const reasons = Array.isArray(data?.lost?.reasons) ? data.lost.reasons : [];
  const maxEntered = Math.max(1, ...stages.map(s => s.entered));

  return (
    <div className="space-y-4" data-testid="crm-funnel-report">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200">
        <ReportRangeFields range={range} todayIso={todayIso} onChange={setRange} />
        <select value={seller} onChange={e => setSeller(e.target.value)} aria-label="فروشنده"
          className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none cursor-pointer">
          <option value="all">همه فروشندگان</option>
          {personnelList.map(p => <option key={p.id} value={String(p.id)}>{p.fullName}</option>)}
        </select>
      </div>

      {error ? (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700" role="alert">گزارش قیف خوانده نشد؛ دوباره تلاش کنید.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
            <h4 className="font-bold text-xs text-slate-800 flex items-center gap-1.5"><FunnelIcon size={14} className="text-blue-600" /> قیف فروش {isFetching ? '…' : ''}</h4>
            {stages.map(row => (
              <div key={row.stage} className="space-y-1" data-testid={`funnel-stage-${row.stage}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="font-bold text-slate-800">{STAGE_LABELS[row.stage]}</span>
                  <span className="text-slate-500">
                    ورود {formatPersianNumber(row.entered)}
                    {row.stage !== 'won' && <> · پیشرفت {formatPersianNumber(row.advanced)} ({percent(row.conversionPercent)})</>}
                    {' · '}میانگین ماندن {days(row.avgDays)}
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(row.entered / maxEntered) * 100}%` }} />
                </div>
              </div>
            ))}
            <p className="text-[10px] text-slate-400">تغییر مرحله‌های پیش از نسخه ۱۰.۱.۱۸ ثبت نشده‌اند و در این گزارش نیستند.</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
            <h4 className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
              <TrendingDown size={14} className="text-rose-600" /> دلیل‌های از دست رفتن ({formatPersianNumber(data?.lost?.count ?? 0)})
            </h4>
            {reasons.length === 0 ? (
              <p className="text-[11px] text-slate-400">در این بازه پرونده‌ای از دست نرفته است.</p>
            ) : reasons.map(r => (
              <div key={r.reason || 'none'} className="flex items-center justify-between text-[11px]">
                <span className="text-slate-700">{isLostReason(r.reason) ? CRM_LOST_REASON_LABELS[r.reason] : 'بی دلیل ثبت‌شده'}</span>
                <span className="font-bold text-slate-900">{formatPersianNumber(r.count)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
