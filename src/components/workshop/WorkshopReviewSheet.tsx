import React, { useId, useState } from 'react';
import toast from 'react-hot-toast';
import { DecimalInput } from '../common/DecimalInput';
import { JalaliDateInput } from '../common/JalaliDateInput';
import { WorkshopSheet } from './WorkshopSheet';
import { useWorkshopMutation, workshopRequests } from '../../hooks/queries/useWorkshopQueries';
import type { MatrixTickSuggestion, WorkshopReviewItem } from '../../lib/workshop/workshopContract';
import { WORKSHOP_ERRORS, WORKSHOP_NOTE_MAX } from '../../lib/workshop/workshopSchedule';
import { workshopQuantityError } from '../../lib/workshop/workshopView';
import { formatPersianDate, getTodayIsoDate } from '../../utils/dateUtils';
import { formatPersianCode, formatPersianNumber } from '../../utils/persianNumber';
import { getErrorMessage } from '../../utils/formatters';

/**
 * v10.1.40 (N-01 part 3): a project manager approves a report, with the quantity corrected when needed (decision ت۲ الف)
 * and the work log's date (default today), or rejects it with a reason. The server writes the work log at the rate the
 * workshop schedule uses; nothing here asks for insurance, payroll tax or VAT. Manual work logs of the same worker, task
 * and project are listed and the approval waits for «بررسی کردم», as the server asks (TD-1284 review).
 */
export function WorkshopReviewSheet({ item, mode, onClose, onApproved }: {
  item: WorkshopReviewItem;
  mode: 'approve' | 'reject';
  onClose: () => void;
  onApproved: (suggestion: MatrixTickSuggestion | null) => void;
}): React.ReactElement {
  const [quantity, setQuantity] = useState(String(item.report.quantity));
  const [date, setDate] = useState(getTodayIsoDate());
  const [note, setNote] = useState('');
  const [manualChecked, setManualChecked] = useState(false);
  const ids = useId();
  const manualLogs = Array.isArray(item.manualLogs) ? item.manualLogs : [];
  const approve = useWorkshopMutation(workshopRequests.approveReport, { touchesWorkLogs: true });
  const reject = useWorkshopMutation(workshopRequests.rejectReport);
  const saving = approve.isPending || reject.isPending;

  const quantityError = mode === 'approve' ? workshopQuantityError(quantity, item.plannedQuantity) : null;
  const reasonError = mode === 'reject' && note.trim() === '' ? WORKSHOP_ERRORS.rejectReasonRequired.message : null;
  const manualError = mode === 'approve' && manualLogs.length > 0 && !manualChecked
    ? 'کارکرد دستی همین کار را بررسی کنید و «بررسی کردم» را بزنید.' : null;
  const corrected = Number(quantity) !== item.report.quantity;

  const send = async () => {
    try {
      if (mode === 'approve') {
        const result = await approve.mutateAsync({
          id: item.report.id, version: item.report.version, note, date, ...(corrected ? { quantity } : {}),
          ...(manualLogs.length > 0 && manualChecked ? { acknowledgedManualLogIds: manualLogs.map(log => log.id) } : {}),
        });
        toast.success('گزارش تأیید و کارکرد ثبت شد.');
        onClose();
        onApproved(result?.matrixTickSuggestion ?? null);
      } else {
        await reject.mutateAsync({ id: item.report.id, version: item.report.version, reason: note });
        toast.success('گزارش رد شد و به کارکن خبر داده شد.');
        onClose();
      }
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  return (
    <WorkshopSheet title={mode === 'approve' ? 'تأیید گزارش پایان کار' : 'رد گزارش پایان کار'} onClose={onClose} saving={saving}
      actions={[{ label: mode === 'approve' ? 'تأیید و ثبت کارکرد' : 'رد گزارش', tone: mode === 'reject' ? 'danger' : 'primary',
        blockedBy: quantityError ?? reasonError ?? manualError, onClick: () => void send() }]}>
      <p className="text-sm text-gray-700 dark:text-gray-200">
        <b>{item.personnelName}</b>، {item.taskTitle} · {item.productName} · {item.stageTitle}
        <br />
        گزارش: {formatPersianNumber(item.report.quantity, 4)} از {formatPersianNumber(item.plannedQuantity, 4)} {item.unit}
      </p>
      {mode === 'approve' && manualLogs.length > 0 && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 p-3 text-sm text-amber-900 dark:text-amber-100 space-y-2">
          <p className="font-bold">برای همین کارکن و همین کار در این پروژه کارکرد دستی ثبت شده است:</p>
          <ul className="list-disc pr-5 text-xs space-y-0.5">
            {manualLogs.map(log => (
              <li key={log.id}>کارکرد شماره {formatPersianCode(log.id)}، {formatPersianDate(log.date)}، تعداد {formatPersianNumber(log.quantity, 4)}</li>
            ))}
          </ul>
          <p className="text-xs">اگر همین کار پیش‌تر دستی ثبت شده است، گزارش را رد کنید تا کارکرد دو بار ثبت نشود.</p>
          <label htmlFor={`${ids}-manual`} className="flex items-center gap-2 font-bold">
            <input id={`${ids}-manual`} type="checkbox" checked={manualChecked} onChange={e => setManualChecked(e.target.checked)} disabled={saving}
              className="w-5 h-5 rounded" />
            بررسی کردم؛ این گزارش کار دیگری است
          </label>
        </div>
      )}
      {mode === 'approve' && (
        <>
          <div>
            <label htmlFor={`${ids}-qty`} className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-1">تعداد تأییدشده ({item.unit})</label>
            <DecimalInput id={`${ids}-qty`} value={quantity} onValueChange={setQuantity} min={0} disabled={saving}
              aria-invalid={quantityError !== null}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2.5 text-base bg-white dark:bg-gray-900" />
            {quantityError && <p className="mt-1 text-xs text-rose-600">{quantityError}</p>}
          </div>
          <div>
            <label htmlFor={`${ids}-date`} className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-1">تاریخ کارکرد</label>
            <JalaliDateInput id={`${ids}-date`} value={date} onChange={setDate} disabled={saving}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2.5 text-base bg-white dark:bg-gray-900" />
          </div>
        </>
      )}
      <div>
        <label htmlFor={`${ids}-note`} className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-1">
          {mode === 'approve' ? 'توضیح (اختیاری)' : 'دلیل رد'}
        </label>
        <textarea id={`${ids}-note`} value={note} onChange={e => setNote(e.target.value)} maxLength={WORKSHOP_NOTE_MAX} rows={3}
          disabled={saving} aria-invalid={reasonError !== null}
          className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-900" />
        {reasonError && <p className="mt-1 text-xs text-rose-600">{reasonError}</p>}
      </div>
    </WorkshopSheet>
  );
}

export default WorkshopReviewSheet;
