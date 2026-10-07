import { X, Calendar as CalendarIcon, Clock, Tag, MessageSquare } from 'lucide-react';
import type { DailyWorkLog } from '../../types';
import { formatPersianDate, formatPersianDateTime, formatPersianNumber } from '../../utils';
import { workModeLabel } from '../../lib/dailyLogs/workMode';

interface DailyLogDetailModalProps {
  log: DailyWorkLog | null;
  onClose: () => void;
}

/** v9.0.263 (TD-645): one daily log opened from a notification link (`/daily-logs?id=N`) */
export function DailyLogDetailModal({ log, onClose }: DailyLogDetailModalProps) {
  if (!log) return null;
  const author = log.user_full_name || log.userFullName || log.username;
  const notes = log.manager_notes || log.managerNotes;
  const project = log.project_name || log.projectName;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 font-farsi text-right">
      <div role="dialog" aria-label={log.title} className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden max-h-[85vh] flex flex-col">
        <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
          <h3 className="font-bold text-sm truncate">{log.title}</h3>
          <button onClick={onClose} aria-label="بستن" className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto text-xs">
          <div className="flex flex-wrap items-center gap-2 text-slate-700">
            <span className="font-bold text-slate-900">{author}</span>
            <span className="px-2 py-0.5 rounded-lg bg-slate-100 font-bold">{workModeLabel(log.work_mode || log.workMode)}</span>
            <span className="inline-flex items-center gap-1"><CalendarIcon className="w-3.5 h-3.5 text-blue-500" />{formatPersianDate(log.date)}</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-amber-500" />
              {formatPersianNumber(log.start_time || log.startTime || '')} تا {formatPersianNumber(log.end_time || log.endTime || '')}
              {' '}({formatPersianNumber(log.work_hours ?? log.workHours ?? 0)} ساعت)
            </span>
          </div>

          {project && <p className="text-blue-700">پروژه مرتبط: <span className="font-bold">{project}</span></p>}

          <div className="text-slate-700 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-100 whitespace-pre-wrap">{log.content}</div>

          {Array.isArray(log.tags) && log.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {log.tags.map((t, idx) => (
                <span key={idx} className="inline-flex items-center gap-1 text-[10px] font-semibold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md border border-slate-200">
                  <Tag className="w-3 h-3 text-slate-400" />{t}
                </span>
              ))}
            </div>
          )}

          {notes && (
            <div className="p-2.5 bg-emerald-50/60 border border-emerald-200/80 rounded-xl space-y-1">
              <div className="flex items-center gap-1.5 text-emerald-800 font-bold"><MessageSquare className="w-3.5 h-3.5 text-emerald-600" />بازخورد مدیریت:</div>
              <p className="text-slate-700 text-[11px]">{notes}</p>
            </div>
          )}

          <p className="text-[10px] text-slate-400">ثبت شده: {formatPersianDateTime(log.created_at || log.createdAt)}</p>
        </div>
      </div>
    </div>
  );
}
