import { useState } from 'react';
import toast from 'react-hot-toast';
import { X, Gift } from 'lucide-react';
import { fetchJson } from '../../api';
import { errorMessageOf, getTodayJalaliDate, formatPersianCode } from '../../utils';
import { toPersianDigits } from '../../utils/persianNumber';
import { normalizeDecimalString, toLatinDigits } from '../../lib/numericInput';
import { useRialDisplay } from '../../hooks/useAppCurrency';
import { useOnlineStatus } from '../../lib/pwa/useOnlineStatus';
import { EIDI_METHOD_LABELS, EIDI_NOT_COVERED_NOTE, EIDI_OVERRIDE_REASON_MAX, type EidiPayslipSuggestion } from '../../lib/payroll/eidi';
import { SearchableSelect } from '../SearchableSelect';
import { DialogLayer } from '../common/DialogLayer';
import { idempotentReplayMessage, isIdempotentReplay } from '../../lib/idempotentReplay';
import { useEidiPreviewQuery } from '../../hooks/queries/usePayrollWindowQueries';
import { useOpeningRead } from '../../hooks/queries/readOnEveryOpening';

/**
 * v10.0.222 (TD-1089، طرح حقوق §۳.۸، ت۱۵ الف): صدور «فیش عیدی» پیش‌نویس یک پرسنل برای یک سال. مبلغ پیشنهادی را سرور
 * حساب می‌کند؛ مبلغ دیگر فقط با شرح فرستاده می‌شود. فیش مثل فیش حقوق تأیید و پرداخت می‌شود.
 */

interface Preview {
  fullName: string;
  period: { startIso: string; endIso: string; workedDays: number };
  suggestion: EidiPayslipSuggestion;
  /** v10.1.35 (TD-1282): «مشمول عیدی» پرونده پرسنل */
  eidiCovered?: boolean;
  draftWarning: string | null;
}

interface Props {
  personnelSelectOptions: { value: string; label: string }[];
  onClose: () => void;
  onIssued: () => void;
}

export function PayrollEidiModal({ personnelSelectOptions, onClose, onIssued }: Props) {
  const rial = useRialDisplay();
  const online = useOnlineStatus();
  const thisYear = Number(toLatinDigits(getTodayJalaliDate()).slice(0, 4));
  const [personnelId, setPersonnelId] = useState('');
  const [year, setYear] = useState(thisYear);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  // 10.3 (ARCH review finding 3): the suggestion comes from the shared cache under `piecework`, so a payslip issued or
  // approved elsewhere while this window is open (which changes the draft warning) refreshes it
  const previewQuery = useEidiPreviewQuery<Preview>(personnelId ? Number(personnelId) : null, year);
  // only a suggestion read in this window, whose last read succeeded, enables the issue (a failed refresh blocks it, as
  // a failed read did before)
  const previewRead = useOpeningRead(previewQuery, true);
  const preview = personnelId ? (previewRead.current ?? null) : null;
  const previewError = personnelId && previewRead.error ? errorMessageOf(previewRead.error) : null;

  const entered = normalizeDecimalString(amount);
  const suggested = preview?.suggestion.amount ?? '0';
  const overridden = entered !== '' && Math.abs(Number(entered) - Number(suggested)) >= 1;
  const finalAmount = entered !== '' ? Number(entered) : Number(suggested);
  const blocked = !preview || finalAmount <= 0 || (overridden && !reason.trim()) || saving || !online;

  const submit = async () => {
    if (blocked) return;
    setSaving(true);
    try {
      const res = await fetchJson('/piecework/eidi-payslips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personnelId: Number(personnelId), year, ...(overridden ? { amount: entered, overrideReason: reason.trim() } : {}) }),
        acceptReplay: true,
      }) as unknown;
      // v10.2.34 (#351 review L1): a repeat of an issue that already ran has no payslip number; the list shows the payslip
      if (isIdempotentReplay(res)) toast(idempotentReplayMessage(res), { icon: 'ℹ️' });
      else toast.success(`فیش عیدی ${formatPersianCode((res as { payrollNumber?: string } | null)?.payrollNumber)} پیش‌نویس صادر شد؛ پرداخت آن پس از تأیید کاربر دیگری است.`);
      onIssued();
      onClose();
    } catch (err) {
      toast.error(errorMessageOf(err));
    } finally {
      setSaving(false);
    }
  };

  const years = [thisYear - 1, thisYear];
  const s = preview?.suggestion;
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <DialogLayer onClose={onClose} disabled={saving} />
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="p-5 bg-slate-50 border-b border-slate-200 flex items-center justify-between shrink-0">
          <h2 className="text-sm font-black text-slate-900 flex items-center gap-2"><Gift className="w-4 h-4 text-emerald-600" /> صدور فیش عیدی</h2>
          <button type="button" onClick={onClose} aria-label="بستن" className="p-1.5 hover:bg-slate-200 text-slate-500 rounded-full cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto text-xs">
          <SearchableSelect options={personnelSelectOptions} value={personnelId} onChange={(v) => setPersonnelId(v ? String(v) : '')}
            placeholder="جست‌وجو و انتخاب پرسنل..." maxResults={50} className="w-full text-xs font-bold" />
          <select aria-label="سال عیدی" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold">
            {years.map(y => <option key={y} value={y}>{`سال ${toPersianDigits(String(y))}`}</option>)}
          </select>
          {previewError && <p className="font-bold text-rose-700">{previewError}</p>}
          {preview && s && (
            <div className="bg-slate-50 rounded-xl p-3 space-y-1 font-bold text-slate-700">
              <p>{`روش: ${EIDI_METHOD_LABELS[s.method]} — ${toPersianDigits(String(preview.period.workedDays))} روز همکاری در سال`}</p>
              {preview.eidiCovered === false && <p className="text-amber-700">{EIDI_NOT_COVERED_NOTE}</p>}
              {s.entitlement === null
                ? <p>{`عیدی انباشته پرداخت‌نشده: ${rial.amount(Number(s.remainingAccrual))}`}</p>
                : <p>{`حق عیدی سال: ${rial.amount(Number(s.entitlement))}`}</p>}
              <p className="text-emerald-700">{`مبلغ پیشنهادی: ${rial.amount(Number(s.amount))}`}</p>
              {preview.draftWarning && <p className="text-amber-700">{preview.draftWarning}</p>}
            </div>
          )}
          <label className="block font-bold text-slate-700" htmlFor="eidi-amount">مبلغ عیدی (خالی یعنی مبلغ پیشنهادی)</label>
          <input id="eidi-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono font-bold" />
          {overridden && (
            <>
              <label className="block font-bold text-slate-700" htmlFor="eidi-reason">شرح مبلغ دستی *</label>
              <input id="eidi-reason" value={reason} maxLength={EIDI_OVERRIDE_REASON_MAX} onChange={(e) => setReason(e.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold" />
            </>
          )}
        </div>
        <div className="p-4 border-t border-slate-200 flex justify-end gap-2 shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2 bg-slate-100 rounded-xl font-bold text-xs cursor-pointer">انصراف</button>
          <button type="button" onClick={() => void submit()} disabled={blocked} className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold text-xs disabled:opacity-50 cursor-pointer">
            {saving ? 'در حال صدور...' : 'صدور فیش عیدی'}
          </button>
        </div>
      </div>
    </div>
  );
}
