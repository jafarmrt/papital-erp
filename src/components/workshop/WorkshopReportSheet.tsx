import React, { useId, useState } from 'react';
import toast from 'react-hot-toast';
import { DecimalInput } from '../common/DecimalInput';
import { WorkshopSheet, type WorkshopSheetAction } from './WorkshopSheet';
import { useWorkshopMutation, workshopRequests } from '../../hooks/queries/useWorkshopQueries';
import type { WorkshopTaskCard } from '../../lib/workshop/workshopContract';
import { deadlineLabel, WORKSHOP_NOTE_MAX } from '../../lib/workshop/workshopSchedule';
import { isPendingReport, workshopQuantityError } from '../../lib/workshop/workshopView';
import { formatPersianNumber } from '../../utils/persianNumber';
import { getErrorMessage } from '../../utils/formatters';

/**
 * v10.1.40 (N-01 part 3, plan §4.3 «گزارش پایان کار»): the worker reports a finished schedule row with its quantity
 * (decision ت۵ الف: one final quantity, at most the planned one) and a note, edits or withdraws it until the project
 * manager reviews it. The amount is never shown here (decision ت۷ الف).
 */
export function WorkshopReportSheet({ task, onClose }: { task: WorkshopTaskCard; onClose: () => void }): React.ReactElement {
  const pending = isPendingReport(task);
  const report = task.report;
  const [quantity, setQuantity] = useState(() => String(pending && report ? report.quantity : task.quantity || ''));
  const [notes, setNotes] = useState(pending && report ? report.notes : '');
  const ids = useId();

  const submit = useWorkshopMutation(workshopRequests.submitReport);
  const edit = useWorkshopMutation(workshopRequests.editReport);
  const withdraw = useWorkshopMutation(workshopRequests.withdrawReport);
  const saving = submit.isPending || edit.isPending || withdraw.isPending;
  const quantityError = workshopQuantityError(quantity, task.quantity);

  const run = async (send: () => Promise<unknown>, done: string) => {
    try {
      await send();
      toast.success(done);
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const actions: WorkshopSheetAction[] = pending && report
    ? [
        { label: 'پس گرفتن گزارش', tone: 'danger',
          onClick: () => void run(() => withdraw.mutateAsync({ id: report.id, version: report.version }), 'گزارش پس گرفته شد.') },
        { label: 'ذخیره تغییرات', blockedBy: quantityError,
          onClick: () => void run(() => edit.mutateAsync({ id: report.id, version: report.version, quantity, notes }), 'گزارش به‌روز شد.') },
      ]
    : [
        { label: 'ارسال گزارش', blockedBy: quantityError,
          onClick: () => void run(() => submit.mutateAsync({
            projectId: task.projectId, stageId: task.stageId, productId: task.productId, rowId: task.rowId, quantity, notes,
          }), 'گزارش برای مسئول پروژه فرستاده شد.') },
      ];

  return (
    <WorkshopSheet title={pending ? 'گزارش در انتظار تأیید' : 'گزارش پایان کار'} onClose={onClose} saving={saving} actions={actions}>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-gray-500">پروژه</dt><dd className="font-bold text-gray-900 dark:text-white">{task.projectTitle}</dd>
        <dt className="text-gray-500">مرحله</dt><dd>{task.stageTitle}</dd>
        <dt className="text-gray-500">محصول</dt><dd>{task.productName}</dd>
        <dt className="text-gray-500">کار</dt><dd>{task.taskTitle}</dd>
        <dt className="text-gray-500">برنامه</dt><dd>{formatPersianNumber(task.quantity, 4)} {task.unit}</dd>
        <dt className="text-gray-500">مهلت</dt><dd>{deadlineLabel(task.daysLeft)}</dd>
      </dl>
      <div>
        <label htmlFor={`${ids}-qty`} className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-1">تعداد انجام‌شده ({task.unit})</label>
        <DecimalInput id={`${ids}-qty`} value={quantity} onValueChange={setQuantity} min={0} disabled={saving}
          aria-invalid={quantityError !== null} aria-describedby={quantityError ? `${ids}-qty-error` : undefined}
          className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2.5 text-base bg-white dark:bg-gray-900" />
        {quantityError && <p id={`${ids}-qty-error`} className="mt-1 text-xs text-rose-600">{quantityError}</p>}
      </div>
      <div>
        <label htmlFor={`${ids}-notes`} className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-1">توضیح (اختیاری)</label>
        <textarea id={`${ids}-notes`} value={notes} onChange={e => setNotes(e.target.value)} maxLength={WORKSHOP_NOTE_MAX} rows={3}
          disabled={saving}
          className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-900" />
      </div>
      {report?.status === 'rejected' && report.reviewNote && (
        <p className="text-sm bg-rose-50 text-rose-700 border border-rose-200 rounded-xl p-3">دلیل رد گزارش پیشین: {report.reviewNote}</p>
      )}
      <p className="text-xs text-gray-500">پس از تأیید مسئول پروژه، کارکرد این کار ثبت می‌شود و مبلغ آن در «کارهای تأییدشده» دیده می‌شود.</p>
    </WorkshopSheet>
  );
}

export default WorkshopReportSheet;
