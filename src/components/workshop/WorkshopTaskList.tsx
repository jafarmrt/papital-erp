import React, { useState } from 'react';
import { CheckCircle2, ClipboardList } from 'lucide-react';
import { WorkshopReportSheet } from './WorkshopReportSheet';
import type { MyWorkshopTasks, WorkshopTaskCard } from '../../lib/workshop/workshopContract';
import { deadlineLabel, WORKSHOP_ERRORS } from '../../lib/workshop/workshopSchedule';
import {
  canReportTask, DEADLINE_TONE_CLASSES, deadlineTone, isPendingReport, orderTaskCards, reportStatusLabel, taskCardKey,
} from '../../lib/workshop/workshopView';
import { PHONE_TAP_TARGET } from '../../lib/pwa/phoneLayout';
import { useRialDisplay } from '../../hooks/useAppCurrency';
import { formatPersianDate } from '../../utils/dateUtils';
import { formatPersianNumber } from '../../utils/persianNumber';

/**
 * v10.1.40 (N-01 part 3, plan §4.3 «کارهای من»): the worker's schedule rows by deadline, a reminder's row first, each with
 * its deadline colour and report state; below them the approved reports with their amount (decision ت۷ الف).
 */
export function WorkshopTaskList({ data, highlighted }: { data: MyWorkshopTasks; highlighted: string | null }): React.ReactElement {
  const [open, setOpen] = useState<WorkshopTaskCard | null>(null);
  const rial = useRialDisplay();
  const tasks = orderTaskCards(Array.isArray(data.tasks) ? data.tasks : [], highlighted);
  const approved = Array.isArray(data.approved) ? data.approved : [];

  return (
    <div className="space-y-5">
      {tasks.length === 0 ? (
        <p className="text-center text-sm text-gray-500 py-10">کار بازی به شما سپرده نشده است.</p>
      ) : (
        <ul className="space-y-3">
          {tasks.map(task => {
            const key = taskCardKey(task);
            const tone = deadlineTone(task.daysLeft);
            const pending = isPendingReport(task);
            const reportable = canReportTask(task);
            return (
              <li key={key} data-task-key={key}
                className={`bg-white dark:bg-gray-800 rounded-2xl border p-4 shadow-sm ${key === highlighted ? 'border-blue-400 ring-2 ring-blue-200' : 'border-gray-200 dark:border-gray-700'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-gray-900 dark:text-white">{task.taskTitle || 'کار بی عنوان'}</p>
                    <p className="text-sm text-gray-600 dark:text-gray-300">{task.productName} · {task.stageTitle}</p>
                    <p className="text-xs text-gray-500">{task.projectTitle}</p>
                  </div>
                  <span className={`shrink-0 text-xs font-bold border rounded-lg px-2 py-1 ${DEADLINE_TONE_CLASSES[tone]}`}>{deadlineLabel(task.daysLeft)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-3">
                  <span className="text-sm text-gray-700 dark:text-gray-200">برنامه: {formatPersianNumber(task.quantity, 4)} {task.unit}</span>
                  {task.report && <span className="text-xs font-bold text-gray-600 dark:text-gray-300">{reportStatusLabel(task.report.status)}</span>}
                </div>
                {task.taskId === null && <p className="mt-2 text-xs text-amber-700">عنوان کار این ردیف مشخص نیست؛ به مسئول پروژه بگویید.</p>}
                {task.taskId !== null && !(task.quantity > 0) && <p className="mt-2 text-xs text-amber-700">{WORKSHOP_ERRORS.rowQuantityMissing.message}</p>}
                {(reportable || pending) && (
                  <button type="button" onClick={() => setOpen(task)}
                    className={`${PHONE_TAP_TARGET} mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold ${
                      pending ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
                    <ClipboardList className="w-4 h-4" aria-hidden="true" />
                    {pending ? 'دیدن یا تغییر گزارش' : 'گزارش پایان کار'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {approved.length > 0 && (
        <section aria-label="کارهای تأییدشده" className="space-y-2">
          <h3 className="font-bold text-gray-800 dark:text-gray-100 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-hidden="true" /> کارهای تأییدشده
          </h3>
          <ul className="space-y-2">
            {approved.map(item => (
              <li key={item.reportId} className="bg-emerald-50/60 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/40 rounded-xl p-3 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-bold text-gray-900 dark:text-white">{item.taskTitle}</span>
                  <span className="font-bold text-emerald-700">{rial.amount(item.amount)}</span>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-300">
                  {item.productName} · {item.stageTitle} · {formatPersianNumber(item.quantity, 4)} · {item.reviewedAt ? formatPersianDate(item.reviewedAt) : ''}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {open && <WorkshopReportSheet task={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

export default WorkshopTaskList;
