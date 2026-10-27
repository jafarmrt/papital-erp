import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { useHasPermission } from '../../../contexts/AuthContext';
import { useControlAccountsQuery } from '../../../hooks/accounting/useVoucherQueries';
import {
  CONTROL_ADJUSTMENT_PERMISSION, CONTROL_REASON_MAX, controlAccountLine, controlAccountsOfRows, type ControlAccountEntry,
} from '../../../lib/accounting/controlAccounts';
import { toPersianDigits } from '../../../utils';

/** the control accounts among a voucher form's rows and whether the user may post on them (the server checks both) */
export function useControlAccountRows(accountIds: ReadonlyArray<number | string | null | undefined>, enabled: boolean) {
  const query = useControlAccountsQuery(enabled);
  const mayAdjust = useHasPermission(CONTROL_ADJUSTMENT_PERMISSION);
  return { hits: controlAccountsOfRows(accountIds, query.data), mayAdjust };
}

interface ControlAccountNoticeProps {
  hits: ControlAccountEntry[];
  mayAdjust: boolean;
  /** the voucher form's reason field; the correction form passes none, its correction reason is stored as the reason */
  reason?: {
    id: string;
    value: string;
    onChange: (value: string) => void;
    inputRef?: React.Ref<HTMLTextAreaElement>;
  };
}

/**
 * v11 phase 6.1b (M3, decision ت۵۶-۳): a row on a control account is named with the book its entries come from. A user
 * with «اصلاح حساب کنترلی» writes the reason here; any other user is told the voucher will not be saved.
 */
export function ControlAccountNotice({ hits, mayAdjust, reason }: ControlAccountNoticeProps) {
  if (hits.length === 0) return null;
  const tone = mayAdjust
    ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200'
    : 'bg-rose-50 dark:bg-rose-950/30 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200';
  return (
    <div role="status" className={`p-3.5 rounded-xl border text-xs space-y-2 ${tone}`}>
      <div className="flex items-start gap-2">
        <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
        <div className="leading-relaxed space-y-1">
          <div className="font-bold">
            {!mayAdjust
              ? 'این سند روی حساب کنترلی است و با اجازهٔ شما ثبت نمی‌شود.'
              : reason
                ? 'این سند روی حساب کنترلی ثبت می‌شود؛ دلیل آن را بنویسید.'
                : 'این سند روی حساب کنترلی ثبت می‌شود؛ علت اصلاح بالا دلیل این ثبت است.'}
          </div>
          <ul className="list-disc list-inside text-[11px] opacity-90 space-y-0.5">
            {hits.map(entry => <li key={entry.id}>{controlAccountLine(entry, toPersianDigits)}</li>)}
          </ul>
          <div className="text-[11px] opacity-90">
            {mayAdjust
              ? 'هر حساب کنترلی دفتر خودش را دارد؛ ثبت دستی روی آن، آن دفتر را از دفتر کل جدا می‌کند. دلیل در سند می‌ماند.'
              : 'ثبت این حساب‌ها از همان دفترهاست. اگر اصلاح دستی لازم است، کسی که اجازهٔ «اصلاح حساب کنترلی» دارد آن را با نوشتن دلیل ثبت کند.'}
          </div>
        </div>
      </div>
      {mayAdjust && reason && (
        <div>
          <label htmlFor={reason.id} className="block font-semibold mb-1">دلیل ثبت روی حساب کنترلی *</label>
          <textarea
            id={reason.id}
            ref={reason.inputRef}
            value={reason.value}
            onChange={e => reason.onChange(e.target.value)}
            maxLength={CONTROL_REASON_MAX}
            rows={2}
            aria-required="true"
            placeholder="مثال: اصلاح ماندهٔ افتتاحیهٔ بانک طبق صورت‌حساب پایان سال"
            className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500 outline-none"
          />
        </div>
      )}
    </div>
  );
}
