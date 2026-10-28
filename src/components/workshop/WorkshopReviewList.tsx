import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Check, X } from 'lucide-react';
import { WorkshopReviewSheet } from './WorkshopReviewSheet';
import { WorkshopSheet } from './WorkshopSheet';
import { useWorkshopMutation, workshopRequests } from '../../hooks/queries/useWorkshopQueries';
import { useHasPermission } from '../../contexts/AuthContext';
import type { MatrixTickSuggestion, WorkshopReviewItem } from '../../lib/workshop/workshopContract';
import { PROJECT_EDIT_PERMISSIONS } from '../../lib/permissions/projectPermissions';
import { PHONE_TAP_TARGET } from '../../lib/pwa/phoneLayout';
import { deadlineLabel, daysUntilDeadline } from '../../lib/workshop/workshopSchedule';
import { formatPersianDate, getTodayIsoDate } from '../../utils/dateUtils';
import { formatPersianNumber } from '../../utils/persianNumber';
import { getErrorMessage } from '../../utils/formatters';

/**
 * v10.1.40 (N-01 part 3, plan §4.3 «بررسی گزارش‌ها»): the reports waiting for a project manager, on the review page and in
 * the project's workshop schedule. Approving writes the work log (decision ت۲ الف); after the last row of a product in a
 * stage, a holder of `projects.edit` is offered the progress matrix tick (decision ت۶ الف), never ticked on their behalf.
 */
export function WorkshopReviewList({ items, emptyText = 'گزارشی در انتظار بررسی نیست.' }: {
  items: readonly WorkshopReviewItem[];
  emptyText?: string;
}): React.ReactElement {
  const [open, setOpen] = useState<{ item: WorkshopReviewItem; mode: 'approve' | 'reject' } | null>(null);
  const [suggestion, setSuggestion] = useState<MatrixTickSuggestion | null>(null);
  const canTick = useHasPermission(PROJECT_EDIT_PERMISSIONS[0]);
  const today = getTodayIsoDate();

  return (
    <>
      {items.length === 0 && <p className="text-center text-sm text-gray-500 py-8">{emptyText}</p>}
      <ul className="space-y-3">
        {items.map(item => (
          <li key={item.report.id} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
            <div className="flex justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold text-gray-900 dark:text-white">{item.personnelName}: {item.taskTitle}</p>
                <p className="text-sm text-gray-600 dark:text-gray-300">{item.productName} · {item.stageTitle}</p>
                <p className="text-xs text-gray-500">{item.projectTitle}</p>
              </div>
              <span className="shrink-0 text-xs text-gray-500">
                {item.deadline ? deadlineLabel(daysUntilDeadline(item.deadline, today)) : deadlineLabel(null)}
              </span>
            </div>
            <p className="mt-2 text-sm">
              گزارش: <b>{formatPersianNumber(item.report.quantity, 4)}</b> از {formatPersianNumber(item.plannedQuantity, 4)} {item.unit}
              <span className="text-xs text-gray-500"> · {formatPersianDate(item.report.createdAt)}</span>
            </p>
            {item.report.notes && <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">توضیح همکار: {item.report.notes}</p>}
            {(item.manualLogs ?? []).length > 0 && (
              <p className="mt-2 text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                برای همین کار {formatPersianNumber((item.manualLogs ?? []).length)} کارکرد دستی ثبت شده است؛ پیش از تأیید بررسی کنید.
              </p>
            )}
            {item.isOwn ? (
              <p className="mt-3 text-xs text-gray-500">گزارش خودتان را نمی‌توانید تأیید یا رد کنید؛ مسئول دیگر پروژه آن را بررسی می‌کند.</p>
            ) : (
            <div className="flex gap-2 mt-3">
              <button type="button" onClick={() => setOpen({ item, mode: 'approve' })}
                className={`${PHONE_TAP_TARGET} flex-1 inline-flex items-center justify-center gap-1 rounded-xl px-3 py-2 text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700`}>
                <Check className="w-4 h-4" aria-hidden="true" /> تأیید
              </button>
              <button type="button" onClick={() => setOpen({ item, mode: 'reject' })}
                className={`${PHONE_TAP_TARGET} flex-1 inline-flex items-center justify-center gap-1 rounded-xl px-3 py-2 text-sm font-bold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100`}>
                <X className="w-4 h-4" aria-hidden="true" /> رد
              </button>
            </div>
            )}
          </li>
        ))}
      </ul>
      {open && (
        <WorkshopReviewSheet item={open.item} mode={open.mode} onClose={() => setOpen(null)}
          onApproved={next => { if (next && canTick && next.itemId !== null) setSuggestion(next); }} />
      )}
      {suggestion && <MatrixTickSheet suggestion={suggestion} onClose={() => setSuggestion(null)} />}
    </>
  );
}

function MatrixTickSheet({ suggestion, onClose }: { suggestion: MatrixTickSuggestion; onClose: () => void }): React.ReactElement {
  const tick = useWorkshopMutation(workshopRequests.tickMatrix, { touchesWorkLogs: true });
  const send = async () => {
    if (suggestion.itemId === null) return;
    try {
      await tick.mutateAsync({ projectId: suggestion.projectId, itemId: suggestion.itemId, stageOrder: suggestion.stageOrder, stageTitle: suggestion.stageTitle });
      toast.success('مرحله در جدول پیشرفت تیک خورد.');
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };
  return (
    <WorkshopSheet title="تیک جدول پیشرفت" onClose={onClose} saving={tick.isPending}
      actions={[{ label: 'تیک بزن', onClick: () => void send() }]}>
      <p className="text-sm text-gray-700 dark:text-gray-200">
        همه کارهای مرحله «{suggestion.stageTitle}» برای «{suggestion.productName}» تأیید شد. این مرحله را در جدول پیشرفت پروژه تمام‌شده بزنم؟
      </p>
      <p className="text-xs text-gray-500">اگر هنوز کاری در این مرحله مانده است، «انصراف» را بزنید؛ بعداً هم از جدول پیشرفت پروژه می‌شود تیک زد.</p>
    </WorkshopSheet>
  );
}

export default WorkshopReviewList;
