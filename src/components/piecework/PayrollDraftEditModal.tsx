import { FormEvent, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import { fetchJson } from '../../api';
import { PieceworkPayroll } from '../../types';
import { errorMessageOf, formatCurrencyLabel, formatPersianCode } from '../../utils';
import { PayrollDeductionsField, deductionsNeedDescription } from './PayrollDeductionsField';
import { PayrollStatutoryFields } from './PayrollStatutoryFields';
import { EMPTY_STATUTORY_ENTRY, statutoryPayloadOf, type PayrollStatutoryEntry } from '../../lib/payroll/statutoryForm';
import { DecimalInput } from '../common/DecimalInput';
import { DialogLayer } from '../common/DialogLayer';

/** v10.0.210 (TD-1087): فیشی که بیمه یا مالیاتش با شرح تغییر کرده، همان مبلغ‌ها و شرح را در فرم نشان می‌دهد */
const storedStatutoryEntry = (p: PieceworkPayroll): PayrollStatutoryEntry => (p.statutoryOverrideReason
  ? { employeeInsurance: String(p.employeeInsurance ?? ''), employerInsurance: String(p.employerInsurance ?? ''), incomeTax: String(p.incomeTax ?? ''), reason: p.statutoryOverrideReason }
  : EMPTY_STATUTORY_ENTRY);

const nonNegative = (raw: string): number => Math.max(0, Number(raw) || 0);

/**
 * v10.0.200 (TD-1242، طرح حقوق §۳.۱ بند ۳): ویرایش فیش پیش‌نویس — عنوان، پاداش، بیمه و مالیات (v10.0.210)، سایر کسورات و شرحش، کسر مساعده. سرور خالص
 * را دوباره حساب و سند پیش‌نویس فیش را از نو می‌سازد؛ فیش تأییدشده یا با سند تأییدشده را با پیام خودش رد می‌کند.
 */
export function PayrollDraftEditModal({ payroll, onClose, onSaved }: { payroll: PieceworkPayroll | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [bonuses, setBonuses] = useState(0);
  const [deductions, setDeductions] = useState(0);
  const [description, setDescription] = useState('');
  const [advance, setAdvance] = useState(0);
  const [statutory, setStatutory] = useState<PayrollStatutoryEntry>(EMPTY_STATUTORY_ENTRY);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!payroll) return;
    setTitle(payroll.title || '');
    setBonuses(Number(payroll.totalBonuses || 0));
    setDeductions(Number(payroll.totalDeductions || 0));
    setDescription(payroll.deductionsDescription || '');
    setAdvance(Number(payroll.advanceDeduction || 0));
    setStatutory(storedStatutoryEntry(payroll));
  }, [payroll]);

  if (!payroll) return null;
  const inputCurLbl = formatCurrencyLabel('IRR');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    try {
      const res = await fetchJson(`/piecework/payrolls/${payroll.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, bonuses, deductions, deductionsDescription: deductions > 0 ? description.trim() : '', advanceDeduction: advance, ...statutoryPayloadOf(statutory) }),
      }) as { statutoryWarning?: string | null };
      toast.success(`فیش ${formatPersianCode(payroll.payrollNumber)} ویرایش شد و سند پیش‌نویس آن دوباره ساخته شد.`);
      if (res?.statutoryWarning) toast(res.statutoryWarning, { icon: '⚠️' });
      onSaved();
      onClose();
    } catch (err) {
      toast.error(errorMessageOf(err) || 'خطا در ویرایش فیش پیش‌نویس');
    } finally {
      setIsSaving(false);
    }
  };

  const fieldClass = 'w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 font-mono';
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <DialogLayer onClose={onClose} disabled={isSaving} />
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="p-5 bg-slate-50 border-b border-slate-200 flex items-center justify-between shrink-0">
          <h2 className="text-sm font-black text-slate-900">{`ویرایش فیش پیش‌نویس ${formatPersianCode(payroll.payrollNumber)}`}</h2>
          <button type="button" onClick={onClose} aria-label="بستن" className="p-1.5 hover:bg-slate-200 text-slate-500 rounded-full cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col min-h-0">
          <div className="p-6 space-y-4 overflow-y-auto">
            <div>
              <label htmlFor="draft-payroll-title" className="block text-xs font-bold text-slate-700 mb-1">عنوان فیش</label>
              <input id="draft-payroll-title" type="text" maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} className={fieldClass} />
            </div>
            <div>
              <label htmlFor="draft-payroll-bonuses" className="block text-xs font-bold text-slate-700 mb-1">{`پاداش / مزایا (${inputCurLbl})`}</label>
              <DecimalInput id="draft-payroll-bonuses" min="0" value={bonuses} onValueChange={(v) => setBonuses(nonNegative(v))} className={fieldClass} />
            </div>
            <PayrollStatutoryFields personnelId={payroll.personnelId} startDate={payroll.startDate} endDate={payroll.endDate}
              gross={Number(payroll.totalPieceworkAmount || 0) + Number(payroll.totalFixedAmount || 0) + bonuses} entry={statutory} onChange={setStatutory} />
            <PayrollDeductionsField amount={deductions} onAmountChange={setDeductions} description={description} onDescriptionChange={setDescription} currencyLabel={inputCurLbl} />
            <div>
              <label htmlFor="draft-payroll-advance" className="block text-xs font-bold text-slate-700 mb-1">{`کسر مساعده (${inputCurLbl})`}</label>
              <DecimalInput id="draft-payroll-advance" min="0" value={advance} onValueChange={(v) => setAdvance(nonNegative(v))} className={fieldClass} />
            </div>
            <p className="text-[10px] text-slate-500 font-bold leading-5">کارکرد و حقوق ثابت فیش همان صدور می‌ماند؛ خالص و سند پیش‌نویس فیش دوباره ساخته می‌شود.</p>
          </div>
          <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200 shrink-0">
            <button type="button" onClick={onClose} disabled={isSaving} className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl font-bold text-xs hover:bg-slate-200 cursor-pointer disabled:opacity-50">انصراف</button>
            <button type="submit" disabled={isSaving || deductionsNeedDescription(deductions, description)} className="px-5 py-2 bg-emerald-600 text-white rounded-xl font-bold text-xs hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">
              {isSaving ? 'در حال ذخیره...' : 'ذخیره فیش پیش‌نویس'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
