import { useId } from 'react';
import { AlertTriangle } from 'lucide-react';
import { formatPersianDate } from '../../utils/dateUtils';
import { formatPersianCode } from '../../utils/persianNumber';
import type { RialDisplay } from '../../lib/rialDisplay';
import { STATUTORY_UNASSIGNED_ACK_LABEL, type StatutoryUnassignedPayments } from '../../lib/treasury/statutoryRemittance';

interface Props {
  accountName: string;
  payments: StatutoryUnassignedPayments;
  rial: RialDisplay;
  acknowledged: boolean;
  disabled: boolean;
  onAcknowledge: (value: boolean) => void;
}

/**
 * v10.1.36 (TD-1243): پرداخت‌هایی که پیش‌تر بی نام پرسنل به «بیمه پرداختنی» یا «مالیات حقوق پرداختنی» زده شده‌اند (فرم خزانه
 * یا سند دستی). معلوم نیست برای کدام ماه بوده‌اند، پس شاید همین فهرست پیش‌تر پرداخت شده باشد؛ تا «بررسی کردم» زده نشود
 * پرداخت ثبت نمی‌شود (کارساز هم بی آن ۴۰۹ می‌دهد).
 */
export function StatutoryUnassignedNotice({ accountName, payments, rial, acknowledged, disabled, onAcknowledge }: Props) {
  const id = useId();
  return (
    <div role="alert" className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 space-y-2">
      <p className="flex items-start gap-1.5 text-xs font-bold text-amber-800 dark:text-amber-200 leading-6">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-1" aria-hidden="true" />
        <span>
          پیش‌تر {rial.amount(Number(payments.amount))} بی نام پرسنل به «{accountName}» پرداخت شده است. اگر بخشی از آن برای همین فهرست است،
          آن را دوباره نپردازید و نخست با سند اصلاحی به نام هر نفر ببرید.
        </span>
      </p>
      {payments.vouchers.length > 0 && (
        <ul className="text-[11px] text-amber-900 dark:text-amber-100 space-y-0.5 pr-6 list-disc">
          {payments.vouchers.map(v => (
            <li key={v.voucherId}>سند {formatPersianCode(v.voucherNumber)}، {formatPersianDate(v.date)}، {rial.amount(Number(v.amount))}</li>
          ))}
        </ul>
      )}
      <label htmlFor={`${id}-ack`} className="flex items-center gap-2 text-xs font-bold text-amber-900 dark:text-amber-100 cursor-pointer">
        <input id={`${id}-ack`} type="checkbox" checked={acknowledged} disabled={disabled} onChange={e => onAcknowledge(e.target.checked)}
          className="w-4 h-4 accent-amber-600" />
        <span>{STATUTORY_UNASSIGNED_ACK_LABEL}</span>
      </label>
    </div>
  );
}
