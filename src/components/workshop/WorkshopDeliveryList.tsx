import React, { useId, useState } from 'react';
import toast from 'react-hot-toast';
import { PackageCheck } from 'lucide-react';
import { WorkshopSheet } from './WorkshopSheet';
import { useWorkshopMutation, workshopRequests } from '../../hooks/queries/useWorkshopQueries';
import type { MyWorkshopDeliveries, WorkshopDelivery } from '../../lib/workshop/workshopContract';
import { DELIVERY_CONFIRMATION_LABELS, WORKSHOP_NOTE_MAX, type DeliveryConfirmationStatus } from '../../lib/workshop/workshopSchedule';
import { deliveryKindLabel, deliveryNoteError, isOpenDelivery } from '../../lib/workshop/workshopView';
import { PHONE_TAP_TARGET } from '../../lib/pwa/phoneLayout';
import { formatPersianDate } from '../../utils/dateUtils';
import { formatPersianCode, formatPersianNumber } from '../../utils/persianNumber';
import { getErrorMessage } from '../../utils/formatters';

/**
 * v10.1.40 (N-01 part 3, plan §4.3 «حواله‌های من», decision ت۱ الف): the remittances and allocations recorded with the
 * worker as recipient. The worker answers «تحویل گرفتم» or «مغایرت دارد» with a note; stock never changes here.
 */
export function WorkshopDeliveryList({ data }: { data: MyWorkshopDeliveries }): React.ReactElement {
  const [open, setOpen] = useState<WorkshopDelivery | null>(null);
  const deliveries = Array.isArray(data.deliveries) ? data.deliveries : [];

  if (deliveries.length === 0) return <p className="text-center text-sm text-gray-500 py-10">حواله‌ای به نام شما ثبت نشده است.</p>;
  return (
    <>
      <ul className="space-y-3">
        {deliveries.map(d => (
          <li key={`${d.kind}-${d.id}`} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
            <div className="flex justify-between gap-2">
              <div>
                <p className="font-bold text-gray-900 dark:text-white">{deliveryKindLabel(d)} {formatPersianCode(d.reference)}</p>
                <p className="text-xs text-gray-500">{formatPersianDate(d.date)}{d.projectTitle ? ` · ${d.projectTitle}` : ''}</p>
              </div>
              {d.confirmation && (
                <span className={`shrink-0 self-start text-xs font-bold rounded-lg px-2 py-1 ${
                  d.confirmation.status === 'received' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
                  {DELIVERY_CONFIRMATION_LABELS[d.confirmation.status]}
                </span>
              )}
            </div>
            <ul className="mt-2 text-sm text-gray-700 dark:text-gray-200 space-y-0.5">
              {d.lines.map((line, index) => (
                <li key={`${line.itemCode}-${index}`}>{line.itemName}: {formatPersianNumber(line.quantity, 4)} {line.unit}</li>
              ))}
            </ul>
            {d.confirmation?.note && <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">توضیح شما: {d.confirmation.note}</p>}
            {isOpenDelivery(d) && (
              <button type="button" onClick={() => setOpen(d)}
                className={`${PHONE_TAP_TARGET} mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold bg-blue-600 text-white hover:bg-blue-700`}>
                <PackageCheck className="w-4 h-4" aria-hidden="true" /> پاسخ دریافت
              </button>
            )}
          </li>
        ))}
      </ul>
      {open && <DeliveryConfirmSheet delivery={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function DeliveryConfirmSheet({ delivery, onClose }: { delivery: WorkshopDelivery; onClose: () => void }): React.ReactElement {
  const [status, setStatus] = useState<DeliveryConfirmationStatus>('received');
  const [note, setNote] = useState('');
  const ids = useId();
  const confirm = useWorkshopMutation(workshopRequests.confirmDelivery);
  const noteError = deliveryNoteError(status, note);

  const send = async () => {
    try {
      await confirm.mutateAsync({ kind: delivery.kind, id: delivery.id, status, note });
      toast.success(status === 'received' ? 'دریافت ثبت شد.' : 'مغایرت ثبت شد و به انبار خبر داده شد.');
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  return (
    <WorkshopSheet title={`${deliveryKindLabel(delivery)} ${formatPersianCode(delivery.reference)}`} onClose={onClose}
      saving={confirm.isPending} actions={[{ label: 'ثبت پاسخ', blockedBy: noteError, onClick: () => void send() }]}>
      <fieldset className="space-y-2">
        <legend className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-1">کالاها را دریافت کردید؟</legend>
        {(['received', 'discrepancy'] as const).map(option => (
          <label key={option} htmlFor={`${ids}-${option}`}
            className={`${PHONE_TAP_TARGET} flex items-center gap-2 border rounded-xl px-3 py-2 cursor-pointer ${
              status === option ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-700'}`}>
            <input id={`${ids}-${option}`} type="radio" name={`${ids}-status`} checked={status === option}
              onChange={() => setStatus(option)} disabled={confirm.isPending} />
            <span className="text-sm">{DELIVERY_CONFIRMATION_LABELS[option]}</span>
          </label>
        ))}
      </fieldset>
      <div>
        <label htmlFor={`${ids}-note`} className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-1">
          توضیح{status === 'discrepancy' ? '' : ' (اختیاری)'}
        </label>
        <textarea id={`${ids}-note`} value={note} onChange={e => setNote(e.target.value)} maxLength={WORKSHOP_NOTE_MAX} rows={3}
          disabled={confirm.isPending} aria-invalid={noteError !== null}
          className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-900" />
        {noteError && <p className="mt-1 text-xs text-rose-600">{noteError}</p>}
      </div>
      <p className="text-xs text-gray-500">پاسخ شما موجودی انبار را تغییر نمی‌دهد؛ در مغایرت، ثبت‌کننده حواله و انبار خبردار می‌شوند.</p>
    </WorkshopSheet>
  );
}

export default WorkshopDeliveryList;
