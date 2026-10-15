import { Calendar } from 'lucide-react';
import { JalaliDateInput } from '../common/JalaliDateInput';
import {
  REPORT_RANGE_PRESETS, REPORT_RANGE_PRESET_LABELS, presetRange, type ReportRange, type ReportRangePreset,
} from '../../lib/reports/reportPeriods';
import { REPORT_DATE_INPUT_CLASS } from './reportFieldClasses';

/**
 * v10.1.8 (D-03، طرح گزارش‌های مدیریتی §۵): بازه گزارش‌های مدیریتی با تقویم شمسی و میان‌برهای «این ماه، ماه قبل، این
 * فصل، فصل قبل، امسال، سال قبل». تاریخ‌ها ISO‌اند؛ خالی کردن یک سر بازه پذیرفته نمی‌شود چون هر گزارش بازه کامل دارد.
 */

const INPUT_CLASS = REPORT_DATE_INPUT_CLASS;

interface ReportRangeFieldsProps {
  range: ReportRange;
  todayIso: string;
  onChange: (range: ReportRange) => void;
}

/** میان‌بری که بازه کنونی همان است */
export function activePreset(range: ReportRange, todayIso: string): ReportRangePreset | null {
  return REPORT_RANGE_PRESETS.find(p => {
    const r = presetRange(p, todayIso);
    return r?.from === range.from && r?.to === range.to;
  }) ?? null;
}

export function ReportRangeFields({ range, todayIso, onChange }: ReportRangeFieldsProps) {
  const active = activePreset(range, todayIso);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
      <Calendar className="w-3.5 h-3.5 text-slate-400" aria-hidden />
      <span>از:</span>
      <JalaliDateInput value={range.from} onChange={iso => iso && onChange({ from: iso, to: range.to })} className={INPUT_CLASS} containerClassName="inline-block" />
      <span>تا:</span>
      <JalaliDateInput value={range.to} onChange={iso => iso && onChange({ from: range.from, to: iso })} className={INPUT_CLASS} containerClassName="inline-block" />
      <div className="flex flex-wrap gap-1" role="group" aria-label="میان‌بر بازه">
        {REPORT_RANGE_PRESETS.map(preset => (
          <button
            key={preset}
            type="button"
            aria-pressed={active === preset}
            onClick={() => {
              const next = presetRange(preset, todayIso);
              if (next) onChange(next);
            }}
            className={`px-2.5 py-1 rounded-lg border font-bold cursor-pointer transition-colors ${
              active === preset
                ? 'bg-indigo-600 border-indigo-600 text-white'
                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-indigo-400'
            }`}
          >
            {REPORT_RANGE_PRESET_LABELS[preset]}
          </button>
        ))}
      </div>
    </div>
  );
}
