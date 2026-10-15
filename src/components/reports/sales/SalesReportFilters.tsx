import { X } from 'lucide-react';
import { SearchableSelect } from '../../SearchableSelect';
import { ReportRangeFields } from '../ReportRangeFields';
import { useCategoriesQuery } from '../../../hooks/queries/useSettingsQueries';
import { PICK_LIST_URLS } from '../../../lib/permissions/pickLists';
import { TREASURY_CURRENCIES } from '../../../lib/treasury/treasuryCurrency';
import { REPORT_COMPARE_LABELS, REPORT_COMPARE_MODES, REPORT_PERIOD_UNITS, REPORT_PERIOD_UNIT_LABELS } from '../../../lib/reports/reportPeriods';
import {
  SALES_CHANNELS, SALES_CHANNEL_LABELS, SALES_DIMENSIONS, SALES_DIMENSION_LABELS,
  type SalesChannel, type SalesDimension, type SalesFilterLabels, type SalesReportParams,
} from '../../../lib/reports/salesReport';
import { formatCurrencyLabel } from '../../../utils';

/**
 * v10.1.7 (D-03، طرح گزارش‌های مدیریتی §۲.۲ و §۵): پالایه‌ها و تفکیک گزارش فروش. مشتری، کالا و پروژه از فهرست‌های انتخاب
 * (TD-887) خوانده می‌شوند و دسته از دسته‌بندی کالا؛ هر تغییر گزارش را از صفحه نخست دوباره می‌خواند.
 */

interface SalesReportFiltersProps {
  params: SalesReportParams;
  labels: SalesFilterLabels;
  todayIso: string;
  onChange: (patch: Partial<SalesReportParams>, labels?: Partial<SalesFilterLabels>) => void;
}

interface PickRow {
  id?: number | string;
  name?: string;
  code?: string;
  title?: string;
  projectCode?: string;
}

const SELECT_CLASS = 'px-2.5 py-1.5 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-800 dark:text-slate-100 font-bold outline-none focus:ring-2 focus:ring-indigo-500';
const LABEL_CLASS = 'flex flex-col gap-1 text-[11px] font-bold text-slate-500 dark:text-slate-400';

const withCode = (name: string | undefined, code: string | undefined) => (code ? `${name ?? ''} (${code})` : name ?? '');

function PickField({ label, url, value, valueLabel, mapRow, onPick }: {
  label: string;
  url: string;
  value: number | null | undefined;
  valueLabel?: string;
  mapRow: (row: PickRow) => { value: string | number; label: string };
  onPick: (id: number | null, label?: string) => void;
}) {
  return (
    <div className={LABEL_CLASS}>
      <span>{label}</span>
      <div className="flex items-center gap-1">
        <SearchableSelect
          value={value ?? ''}
          valueLabel={valueLabel}
          onChange={(v, raw: PickRow | undefined) => onPick(v ? Number(v) : null, raw ? mapRow(raw).label : undefined)}
          placeholder="همه"
          fetchUrl={url}
          mapResultToOption={mapRow}
          maxResults={30}
          className="w-48"
        />
        {value ? (
          <button type="button" onClick={() => onPick(null)} aria-label={`حذف ${label}`} className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function SalesReportFilters({ params, labels, todayIso, onChange }: SalesReportFiltersProps) {
  const { data: categories = [] } = useCategoriesQuery();
  const categoryNames = Array.from(new Set(categories.map(c => (c?.name ?? '').trim()).filter(Boolean)));
  const usesPeriod = params.groupBy === 'period' || params.thenBy === 'period';

  return (
    <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm space-y-3 no-print">
      <ReportRangeFields range={{ from: params.from, to: params.to }} todayIso={todayIso} onChange={range => onChange(range)} />
      <div className="flex flex-wrap items-end gap-3">
        <label className={LABEL_CLASS}>
          <span>ارز</span>
          <select aria-label="ارز" value={params.currency} onChange={e => onChange({ currency: e.target.value })} className={SELECT_CLASS}>
            <option value="all">همه ارزها به ریال</option>
            {TREASURY_CURRENCIES.map(c => <option key={c} value={c}>{formatCurrencyLabel(c)}</option>)}
          </select>
        </label>
        <PickField
          label="مشتری"
          url={`${PICK_LIST_URLS.customers}?partyType=customer`}
          value={params.partyId}
          valueLabel={labels.party}
          mapRow={row => ({ value: Number(row.id), label: withCode(row.name, row.code) })}
          onPick={(partyId, party) => onChange({ partyId }, { party })}
        />
        <PickField
          label="کالا"
          url={PICK_LIST_URLS.items}
          value={params.itemId}
          valueLabel={labels.item}
          mapRow={row => ({ value: Number(row.id), label: withCode(row.name, row.code) })}
          onPick={(itemId, item) => onChange({ itemId }, { item })}
        />
        <label className={LABEL_CLASS}>
          <span>دسته کالا</span>
          <select aria-label="دسته کالا" value={params.category ?? ''} onChange={e => onChange({ category: e.target.value || null })} className={SELECT_CLASS}>
            <option value="">همه</option>
            {categoryNames.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <PickField
          label="پروژه"
          url={PICK_LIST_URLS.projects}
          value={params.projectId}
          valueLabel={labels.project}
          mapRow={row => ({ value: Number(row.id), label: withCode(row.title, row.projectCode) })}
          onPick={(projectId, project) => onChange({ projectId }, { project })}
        />
        <label className={LABEL_CLASS}>
          <span>کانال فروش</span>
          <select aria-label="کانال فروش" value={params.channel ?? ''} onChange={e => onChange({ channel: (e.target.value || null) as SalesChannel | null })} className={SELECT_CLASS}>
            <option value="">همه</option>
            {SALES_CHANNELS.map(c => <option key={c} value={c}>{SALES_CHANNEL_LABELS[c]}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-700">
        <label className={LABEL_CLASS}>
          <span>تفکیک</span>
          <select
            aria-label="تفکیک"
            value={params.groupBy}
            onChange={e => {
              const groupBy = e.target.value as SalesDimension;
              onChange({ groupBy, thenBy: params.thenBy === groupBy ? null : params.thenBy });
            }}
            className={SELECT_CLASS}
          >
            {SALES_DIMENSIONS.map(d => <option key={d} value={d}>{SALES_DIMENSION_LABELS[d]}</option>)}
          </select>
        </label>
        <label className={LABEL_CLASS}>
          <span>تفکیک دوم</span>
          <select aria-label="تفکیک دوم" value={params.thenBy ?? ''} onChange={e => onChange({ thenBy: (e.target.value || null) as SalesDimension | null })} className={SELECT_CLASS}>
            <option value="">ندارد</option>
            {SALES_DIMENSIONS.filter(d => d !== params.groupBy).map(d => <option key={d} value={d}>{SALES_DIMENSION_LABELS[d]}</option>)}
          </select>
        </label>
        {usesPeriod && (
          <label className={LABEL_CLASS}>
            <span>دوره</span>
            <select aria-label="دوره" value={params.period} onChange={e => onChange({ period: e.target.value as SalesReportParams['period'] })} className={SELECT_CLASS}>
              {REPORT_PERIOD_UNITS.map(u => <option key={u} value={u}>{REPORT_PERIOD_UNIT_LABELS[u]}</option>)}
            </select>
          </label>
        )}
        <label className={LABEL_CLASS}>
          <span>مقایسه با</span>
          <select aria-label="مقایسه با" value={params.compare} onChange={e => onChange({ compare: e.target.value as SalesReportParams['compare'] })} className={SELECT_CLASS}>
            {REPORT_COMPARE_MODES.map(m => <option key={m} value={m}>{REPORT_COMPARE_LABELS[m]}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}
