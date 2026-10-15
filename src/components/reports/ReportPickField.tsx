import { X } from 'lucide-react';
import { SearchableSelect } from '../SearchableSelect';
import { REPORT_LABEL_CLASS } from './reportFieldClasses';

/**
 * v10.1.10 (D-03): انتخاب یک رکورد از فهرست انتخاب (TD-887) در پالایه زبانه‌های «گزارش‌های مدیریتی»، با دکمه حذف؛ پیش‌تر
 * درون پالایه‌های گزارش فروش بود.
 */

export interface ReportPickRow {
  id?: number | string;
  name?: string;
  code?: string;
  title?: string;
  projectCode?: string;
}

/** «نام (کد)» */
export const pickLabelWithCode = (name: string | undefined, code: string | undefined) => (code ? `${name ?? ''} (${code})` : name ?? '');

interface ReportPickFieldProps {
  label: string;
  url: string;
  value: number | null | undefined;
  valueLabel?: string;
  mapRow: (row: ReportPickRow) => { value: string | number; label: string };
  onPick: (id: number | null, label?: string) => void;
}

export function ReportPickField({ label, url, value, valueLabel, mapRow, onPick }: ReportPickFieldProps) {
  return (
    <div className={REPORT_LABEL_CLASS}>
      <span>{label}</span>
      <div className="flex items-center gap-1">
        <SearchableSelect
          value={value ?? ''}
          valueLabel={valueLabel}
          onChange={(v, raw: ReportPickRow | undefined) => onPick(v ? Number(v) : null, raw ? mapRow(raw).label : undefined)}
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
