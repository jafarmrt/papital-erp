import { ReportPickField, pickLabelWithCode } from '../ReportPickField';
import { ReportRangeFields } from '../ReportRangeFields';
import { REPORT_LABEL_CLASS as LABEL_CLASS, REPORT_SELECT_CLASS as SELECT_CLASS } from '../reportFieldClasses';
import { useCategoriesQuery } from '../../../hooks/queries/useSettingsQueries';
import { PICK_LIST_URLS } from '../../../lib/permissions/pickLists';
import { TREASURY_CURRENCIES } from '../../../lib/treasury/treasuryCurrency';
import { REPORT_COMPARE_LABELS, REPORT_COMPARE_MODES, REPORT_PERIOD_UNITS, REPORT_PERIOD_UNIT_LABELS } from '../../../lib/reports/reportPeriods';
import {
  PURCHASE_DIMENSIONS, PURCHASE_DIMENSION_LABELS, type PurchaseDimension, type PurchaseFilterLabels, type PurchaseReportParams,
} from '../../../lib/reports/purchaseReport';
import { formatCurrencyLabel } from '../../../utils';

/**
 * v10.1.15 (D-03 بخش ۴، ت۱۵): پالایه‌ها و تفکیک گزارش خرید. تأمین‌کننده (و طرف حساب «هر دو») و کالا از فهرست‌های انتخاب
 * (TD-887) خوانده می‌شوند و دسته از دسته‌بندی کالا؛ هر تغییر گزارش را از صفحه نخست دوباره می‌خواند.
 */

interface PurchaseReportFiltersProps {
  params: PurchaseReportParams;
  labels: PurchaseFilterLabels;
  todayIso: string;
  onChange: (patch: Partial<PurchaseReportParams>, labels?: Partial<PurchaseFilterLabels>) => void;
}

export function PurchaseReportFilters({ params, labels, todayIso, onChange }: PurchaseReportFiltersProps) {
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
        <ReportPickField
          label="تأمین‌کننده"
          url={`${PICK_LIST_URLS.customers}?partyType=supplier`}
          value={params.partyId}
          valueLabel={labels.party}
          mapRow={row => ({ value: Number(row.id), label: pickLabelWithCode(row.name, row.code) })}
          onPick={(partyId, party) => onChange({ partyId }, { party })}
        />
        <ReportPickField
          label="کالا"
          url={PICK_LIST_URLS.items}
          value={params.itemId}
          valueLabel={labels.item}
          mapRow={row => ({ value: Number(row.id), label: pickLabelWithCode(row.name, row.code) })}
          onPick={(itemId, item) => onChange({ itemId }, { item })}
        />
        <label className={LABEL_CLASS}>
          <span>دسته کالا</span>
          <select aria-label="دسته کالا" value={params.category ?? ''} onChange={e => onChange({ category: e.target.value || null })} className={SELECT_CLASS}>
            <option value="">همه</option>
            {categoryNames.map(name => <option key={name} value={name}>{name}</option>)}
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
              const groupBy = e.target.value as PurchaseDimension;
              onChange({ groupBy, thenBy: params.thenBy === groupBy ? null : params.thenBy });
            }}
            className={SELECT_CLASS}
          >
            {PURCHASE_DIMENSIONS.map(d => <option key={d} value={d}>{PURCHASE_DIMENSION_LABELS[d]}</option>)}
          </select>
        </label>
        <label className={LABEL_CLASS}>
          <span>تفکیک دوم</span>
          <select aria-label="تفکیک دوم" value={params.thenBy ?? ''} onChange={e => onChange({ thenBy: (e.target.value || null) as PurchaseDimension | null })} className={SELECT_CLASS}>
            <option value="">ندارد</option>
            {PURCHASE_DIMENSIONS.filter(d => d !== params.groupBy).map(d => <option key={d} value={d}>{PURCHASE_DIMENSION_LABELS[d]}</option>)}
          </select>
        </label>
        {usesPeriod && (
          <label className={LABEL_CLASS}>
            <span>دوره</span>
            <select aria-label="دوره" value={params.period} onChange={e => onChange({ period: e.target.value as PurchaseReportParams['period'] })} className={SELECT_CLASS}>
              {REPORT_PERIOD_UNITS.map(u => <option key={u} value={u}>{REPORT_PERIOD_UNIT_LABELS[u]}</option>)}
            </select>
          </label>
        )}
        <label className={LABEL_CLASS}>
          <span>مقایسه با</span>
          <select aria-label="مقایسه با" value={params.compare} onChange={e => onChange({ compare: e.target.value as PurchaseReportParams['compare'] })} className={SELECT_CLASS}>
            {REPORT_COMPARE_MODES.map(m => <option key={m} value={m}>{REPORT_COMPARE_LABELS[m]}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}
