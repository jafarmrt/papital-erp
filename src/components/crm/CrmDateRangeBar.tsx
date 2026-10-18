import { Calendar } from 'lucide-react';
import { JalaliDateInput } from '../common/JalaliDateInput';
import type { CrmDatePreset } from '../../hooks/useCRMFilters';

const PRESETS: ReadonlyArray<{ key: Exclude<CrmDatePreset, 'custom'>; label: string }> = [
  { key: '1m', label: 'یک ماه اخیر (پیش‌فرض)' },
  { key: '7d', label: '۷ روز اخیر' },
  { key: 'today', label: 'امروز' },
  { key: 'all', label: 'همه زمان‌ها' },
];

interface CrmDateRangeBarProps {
  datePreset: CrmDatePreset;
  fromDate: string;
  toDate: string;
  onPreset: (preset: Exclude<CrmDatePreset, 'custom'>) => void;
  onFromDate: (iso: string) => void;
  onToDate: (iso: string) => void;
}

/**
 * The date range of the activity book (v10.2 package 7, OBS-R2-32: it filters the activities only, and says so; it was
 * labelled «فیلتر زمانی» as if it filtered the whole page).
 */
export function CrmDateRangeBar({ datePreset, fromDate, toDate, onPreset, onFromDate, onToDate }: CrmDateRangeBarProps) {
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200/80">
      <div className="flex items-center gap-2 flex-wrap">
        <Calendar size={16} className="text-blue-600 shrink-0" />
        <span className="text-xs font-bold text-slate-700">بازه زمانی دفترچه اقدام‌ها:</span>
        <div className="flex flex-wrap items-center gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => onPreset(p.key)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                datePreset === p.key ? 'bg-blue-600 text-white shadow-2xs' : 'bg-white text-slate-600 hover:bg-slate-200 border border-slate-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 w-full sm:w-auto text-xs">
        <label htmlFor="crm-range-from" className="text-slate-500 text-[11px]">از:</label>
        <JalaliDateInput
          id="crm-range-from"
          placeholder="از تاریخ"
          value={fromDate}
          onChange={onFromDate}
          containerClassName="inline-block"
          className="w-24 px-2 py-1 bg-white border border-slate-200 rounded-lg text-[11px] text-center outline-none focus:border-blue-500"
        />
        <label htmlFor="crm-range-to" className="text-slate-500 text-[11px]">تا:</label>
        <JalaliDateInput
          id="crm-range-to"
          placeholder="تا تاریخ"
          value={toDate}
          onChange={onToDate}
          containerClassName="inline-block"
          calendarPosition="bottom-left"
          className="w-24 px-2 py-1 bg-white border border-slate-200 rounded-lg text-[11px] text-center outline-none focus:border-blue-500"
        />
      </div>
    </div>
  );
}
