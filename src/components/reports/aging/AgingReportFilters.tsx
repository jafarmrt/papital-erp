import { Calendar } from 'lucide-react';
import { JalaliDateInput } from '../../common/JalaliDateInput';
import { ReportPickField, pickLabelWithCode } from '../ReportPickField';
import { REPORT_DATE_INPUT_CLASS, REPORT_LABEL_CLASS, REPORT_SELECT_CLASS } from '../reportFieldClasses';
import { PICK_LIST_URLS } from '../../../lib/permissions/pickLists';
import { TREASURY_CURRENCIES } from '../../../lib/treasury/treasuryCurrency';
import {
  AGING_KINDS, AGING_KIND_LABELS, AGING_PARTY_LABELS, AGING_SORTS, AGING_SORT_LABELS,
  type AgingKind, type AgingReportParams, type AgingSort,
} from '../../../lib/reports/agingReport';
import { formatCurrencyLabel } from '../../../utils';

/**
 * v10.1.10 (D-03، طرح گزارش‌های مدیریتی §۳): پالایه‌های «سن مطالبات و بدهی‌ها»: مطالبات یا بدهی‌ها، تاریخ گزارش، ارز، یک
 * طرف حساب (فهرست انتخاب مشتریان یا تأمین‌کنندگان، TD-887)، «فقط سندهای تأییدشده» و ترتیب. هر تغییر گزارش را از صفحه
 * نخست دوباره می‌خواند؛ عوض کردن مطالبات و بدهی‌ها طرف حساب انتخاب‌شده را برمی‌دارد.
 */

interface AgingReportFiltersProps {
  params: AgingReportParams;
  partyLabel?: string;
  onChange: (patch: Partial<AgingReportParams>, partyLabel?: string | null) => void;
}

export function AgingReportFilters({ params, partyLabel, onChange }: AgingReportFiltersProps) {
  const partyType = params.kind === 'receivable' ? 'customer' : 'supplier';
  return (
    <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm space-y-3 no-print">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-slate-100 dark:bg-slate-900/60 p-1 rounded-xl" role="group" aria-label="نوع گزارش">
          {AGING_KINDS.map(kind => (
            <button
              key={kind}
              type="button"
              aria-pressed={params.kind === kind}
              onClick={() => { if (params.kind !== kind) onChange({ kind: kind as AgingKind, partyId: null }, null); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${params.kind === kind
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'}`}
            >
              {AGING_KIND_LABELS[kind]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <Calendar className="w-3.5 h-3.5 text-slate-400" aria-hidden />
          <span>تاریخ گزارش:</span>
          <JalaliDateInput
            value={params.asOf}
            onChange={iso => iso && onChange({ asOf: iso })}
            className={REPORT_DATE_INPUT_CLASS}
            containerClassName="inline-block"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-700">
        <label className={REPORT_LABEL_CLASS}>
          <span>ارز</span>
          <select aria-label="ارز" value={params.currency} onChange={e => onChange({ currency: e.target.value })} className={REPORT_SELECT_CLASS}>
            <option value="all">همه ارزها به ریال</option>
            {TREASURY_CURRENCIES.map(c => <option key={c} value={c}>{formatCurrencyLabel(c)}</option>)}
          </select>
        </label>
        <ReportPickField
          key={partyType}
          label={AGING_PARTY_LABELS[params.kind]}
          url={`${PICK_LIST_URLS.customers}?partyType=${partyType}`}
          value={params.partyId}
          valueLabel={partyLabel}
          mapRow={row => ({ value: Number(row.id), label: pickLabelWithCode(row.name, row.code) })}
          onPick={(partyId, label) => onChange({ partyId }, label ?? null)}
        />
        <label className={REPORT_LABEL_CLASS}>
          <span>ترتیب</span>
          <select aria-label="ترتیب" value={params.sort} onChange={e => onChange({ sort: e.target.value as AgingSort })} className={REPORT_SELECT_CLASS}>
            {AGING_SORTS.map(s => <option key={s} value={s}>{AGING_SORT_LABELS[s]}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={params.approvedOnly}
            onChange={e => onChange({ approvedOnly: e.target.checked })}
            className="w-4 h-4 accent-indigo-600"
          />
          فقط سندهای تأییدشده
        </label>
      </div>
    </div>
  );
}
