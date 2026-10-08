import { STAGE_STATUSES, STAGE_STATUS_LABELS } from '../../lib/projects/projectStatus';
import { toPersianDigits } from '../../utils';

interface StageStatusFieldProps {
  status: string;
  progress: number;
  onStatusChange: (status: string) => void;
  onProgressChange: (progress: number) => void;
}

/**
 * v9.0.335 (TD-758، تصمیم ت۱ الف): وضعیت و درصد دستی مرحله، فقط برای پروژه بی محصول. در پروژه دارای ماتریس پیشرفت
 * فرم مرحله این فیلدها را نشان نمی‌دهد و نمی‌فرستد، چون ماتریس آن‌ها را تعیین می‌کند.
 */
export function StageStatusField({ status, progress, onStatusChange, onProgressChange }: StageStatusFieldProps) {
  return (
    <div className="bg-slate-100 border border-slate-200 rounded-xl p-2.5 sm:col-span-2 grid grid-cols-2 gap-2">
      <div>
        <label htmlFor="stage-status" className="block text-[11px] font-bold text-slate-700 mb-1">وضعیت مرحله</label>
        <select
          id="stage-status"
          value={status}
          onChange={(e) => onStatusChange(e.target.value)}
          className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-bold text-slate-900 bg-white"
        >
          {STAGE_STATUSES.map(s => <option key={s} value={s}>{STAGE_STATUS_LABELS[s]}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="stage-progress" className="block text-[11px] font-bold text-slate-700 mb-1">
          درصد پیشرفت ({toPersianDigits(progress)}٪)
        </label>
        <input
          id="stage-progress"
          type="range"
          min={0}
          max={100}
          step={5}
          value={progress}
          onChange={(e) => onProgressChange(Math.min(100, Math.max(0, Math.round(Number(e.target.value)))))}
          className="w-full accent-blue-600"
        />
      </div>
    </div>
  );
}
