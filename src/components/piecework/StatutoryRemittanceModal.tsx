import { useEffect, useId, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Landmark } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { Modal } from '../common/Modal';
import { JalaliDateInput } from '../common/JalaliDateInput';
import { DecimalInput, refuseInvalidDecimalInputs } from '../common/DecimalInput';
import { StatutoryRemittanceLines } from './StatutoryRemittanceLines';
import { StatutoryUnassignedNotice } from './StatutoryUnassignedNotice';
import { useRialDisplay } from '../../hooks/useAppCurrency';
import { useOnlineStatus } from '../../lib/pwa/useOnlineStatus';
import { OFFLINE_SUBMIT_TITLE } from '../../lib/pwa/phoneLayout';
import { invalidatePreset } from '../../lib/queryInvalidation';
import { errorMessageOf, getTodayIsoDate } from '../../utils';
import { jalaliMonthLabel } from '../../utils/calendarDate';
import { toPersianDigits } from '../../utils/persianNumber';
import {
  STATUTORY_REMITTANCE_METHODS, STATUTORY_REMITTANCE_NOTHING, STATUTORY_REMITTANCE_TEXT, hasStatutoryUnassignedPayments,
  statutoryRemittanceDescription, statutoryRemittanceDraftLines, statutoryRemittanceFormError, statutoryRemittancePayload,
  statutoryRemittanceTotal,
  type StatutoryRemittanceDraftLine, type StatutoryRemittanceKind, type StatutoryRemittanceMethod, type StatutoryRemittanceOptions,
} from '../../lib/treasury/statutoryRemittance';
import type { BankAccountOption } from '../../types';

interface Props {
  kind: StatutoryRemittanceKind;
  jalaliYear: number;
  jalaliMonth: number;
  onClose: () => void;
}

interface ContraAccountOption { id: number; code: string; name: string; statutoryKind?: 'insurance' | 'tax' }

const listOf = <T,>(res: unknown): T[] => (Array.isArray(res) ? res : (Array.isArray((res as { data?: unknown })?.data) ? (res as { data: T[] }).data : [])) as T[];
const field = 'w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl';
const labelClass = 'block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1';

/**
 * v10.1.36 (TD-1243، تصمیم ت۳۳ الف): یک پرداخت خزانه برای بیمه یا مالیات حقوق کل فهرست یک ماه. کارساز برای هر نفر یک ردیف
 * بدهکار به نام خودش روی «بیمه پرداختنی» یا «مالیات حقوق پرداختنی» و یک ردیف بستانکار بانک می‌زند؛ جریمه دیرکرد اختیاری است.
 * فقط پرسنلی که در فیش‌های تأییدشده این ماه بیمه یا مالیات دارند می‌آیند (بیمه و مالیات اختیاری است).
 */
export function StatutoryRemittanceModal({ kind, jalaliYear, jalaliMonth, onClose }: Props) {
  const text = STATUTORY_REMITTANCE_TEXT[kind];
  const rial = useRialDisplay();
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const id = useId();
  const [options, setOptions] = useState<StatutoryRemittanceOptions | null>(null);
  const [loadError, setLoadError] = useState('');
  const [lines, setLines] = useState<StatutoryRemittanceDraftLine[]>([]);
  const [banks, setBanks] = useState<BankAccountOption[]>([]);
  const [penaltyAccounts, setPenaltyAccounts] = useState<ContraAccountOption[]>([]);
  const [bankAccountId, setBankAccountId] = useState('');
  const [date, setDate] = useState(getTodayIsoDate());
  const [method, setMethod] = useState<StatutoryRemittanceMethod>('bank_transfer');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [description, setDescription] = useState('');
  const [penaltyAmount, setPenaltyAmount] = useState('');
  const [penaltyAccountId, setPenaltyAccountId] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    fetchJson(`/accounting/treasury/statutory-remittance/options?kind=${kind}&year=${jalaliYear}&month=${jalaliMonth}`, { signal })
      .then((res: StatutoryRemittanceOptions) => { if (!signal.aborted) { setOptions(res); setLines(statutoryRemittanceDraftLines(res)); } })
      .catch((err: unknown) => { if (!signal.aborted) setLoadError(errorMessageOf(err)); });
    fetchJson('/accounting/bank-accounts/options', { signal })
      .then((res: unknown) => { if (!signal.aborted) setBanks(listOf<BankAccountOption>(res).filter(b => (b.currency || 'IRR') === 'IRR' && b.hasLedgerAccount)); })
      .catch(() => undefined);
    fetchJson('/accounting/treasury/contra-accounts', { signal })
      // جریمه هزینه است: «بیمه پرداختنی» و «مالیات حقوق پرداختنی» سرفصل جریمه نیستند (کارساز هم رد می‌کند)
      .then((res: unknown) => { if (!signal.aborted) setPenaltyAccounts(listOf<ContraAccountOption>(res).filter(a => !a.statutoryKind)); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [kind, jalaliYear, jalaliMonth]);

  const total = useMemo(() => statutoryRemittanceTotal(lines, penaltyAmount), [lines, penaltyAmount]);
  const monthLabel = jalaliMonthLabel(`${jalaliYear}/${String(jalaliMonth).padStart(2, '0')}`);
  const nothing = options !== null && lines.length === 0;
  const unassigned = hasStatutoryUnassignedPayments(options);

  const changeLine = (personnelId: number, change: Partial<StatutoryRemittanceDraftLine>) => {
    setLines(prev => prev.map(l => (l.personnelId === personnelId ? { ...l, ...change } : l)));
    setFormError('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || refuseInvalidDecimalInputs(formRef.current)) return;
    const error = statutoryRemittanceFormError({ lines, bankAccountId, penaltyAmount, penaltyAccountId, unassignedPayments: unassigned, unassignedAcknowledged: acknowledged });
    setFormError(error);
    if (error) return;
    setSaving(true);
    try {
      const body = statutoryRemittancePayload({
        kind, jalaliYear, jalaliMonth, lines, bankAccountId, penaltyAmount, penaltyAccountId, date, method, trackingNumber, description,
        unassignedPayments: unassigned, unassignedAcknowledged: acknowledged,
      });
      await fetchJson('/accounting/treasury/statutory-remittance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      toast.success(`${text.button} با سند حسابداری ثبت شد؛ مانده هر نفر به نام خودش بسته شد.`);
      void invalidatePreset(queryClient, 'settlementChange');
      onClose();
    } catch (err) {
      setFormError(errorMessageOf(err));
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-2 w-full">
      <div className="text-[11px] text-slate-600 dark:text-slate-300">جمع پرداخت: <span className="font-bold">{rial.amount(total.toNumber())}</span></div>
      <div className="flex gap-2">
        <button type="button" onClick={onClose} disabled={saving}
          className="px-4 py-2 text-xs font-bold border border-slate-200 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50">انصراف</button>
        <button type="submit" form={`${id}-form`} disabled={saving || !online || !options || nothing || (unassigned && !acknowledged)}
          title={online ? undefined : OFFLINE_SUBMIT_TITLE}
          className="px-4 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl disabled:opacity-50">
          {saving ? 'در حال ثبت...' : 'ثبت پرداخت با سند حسابداری'}
        </button>
      </div>
    </div>
  );

  return (
    <Modal isOpen onClose={onClose} title={text.button} subtitle={`فهرست ${monthLabel}، حساب «${options?.accountName || text.account}»`}
      icon={<Landmark className="w-5 h-5 text-emerald-600" />} size="2xl" footer={footer}
      closeOnEscape={!saving} closeOnBackdropClick={false} layerClassName="z-[60]">
      <form id={`${id}-form`} ref={formRef} onSubmit={submit} className="space-y-3" noValidate>
        {loadError && <p role="alert" className="text-xs font-bold text-rose-600">{loadError}</p>}
        {!options && !loadError && <p className="text-xs text-slate-500">در حال خواندن فهرست...</p>}
        {nothing && <p className="text-xs font-bold text-slate-600 dark:text-slate-300">{STATUTORY_REMITTANCE_NOTHING}</p>}
        {lines.length > 0 && options && unassigned && (
          <StatutoryUnassignedNotice accountName={options.accountName} payments={options.unassignedPayments} rial={rial}
            acknowledged={acknowledged} disabled={saving} onAcknowledge={v => { setAcknowledged(v); setFormError(''); }} />
        )}
        {lines.length > 0 && <StatutoryRemittanceLines lines={lines} rial={rial} disabled={saving} onChange={changeLine} />}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${id}-bank`} className={labelClass}>حساب بانکی یا صندوق *</label>
            <select id={`${id}-bank`} value={bankAccountId} onChange={e => { setBankAccountId(e.target.value); setFormError(''); }} className={field}>
              <option value="">انتخاب کنید</option>
              {banks.map(b => <option key={b.id} value={b.id}>{b.title}{b.bankName ? ` (${b.bankName})` : ''}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-date`} className={labelClass}>تاریخ پرداخت</label>
            <JalaliDateInput id={`${id}-date`} value={date} onChange={setDate} calendarPosition="bottom-right" className={`${field} text-center`} containerClassName="w-full" />
          </div>
          <div>
            <label htmlFor={`${id}-method`} className={labelClass}>روش پرداخت</label>
            <select id={`${id}-method`} value={method} onChange={e => setMethod(e.target.value as StatutoryRemittanceMethod)} className={field}>
              {STATUTORY_REMITTANCE_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-tracking`} className={labelClass}>شماره پیگیری (اختیاری)</label>
            <input id={`${id}-tracking`} value={trackingNumber} maxLength={100} onChange={e => setTrackingNumber(e.target.value)} className={field} />
          </div>
          <div>
            <label htmlFor={`${id}-penalty`} className={labelClass}>جریمه دیرکرد به ریال (اختیاری)</label>
            <DecimalInput id={`${id}-penalty`} value={penaltyAmount} min={0} onValueChange={t => { setPenaltyAmount(t); setFormError(''); }} className={`${field} font-mono`} />
          </div>
          <div>
            <label htmlFor={`${id}-penalty-account`} className={labelClass}>سرفصل جریمه دیرکرد</label>
            <select id={`${id}-penalty-account`} value={penaltyAccountId} onChange={e => { setPenaltyAccountId(e.target.value); setFormError(''); }} className={field}>
              <option value="">انتخاب کنید</option>
              {penaltyAccounts.map(a => <option key={a.id} value={a.id}>{`${toPersianDigits(a.code)} ${a.name}`}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor={`${id}-description`} className={labelClass}>شرح</label>
          <input id={`${id}-description`} value={description} maxLength={500} onChange={e => setDescription(e.target.value)} className={field}
            placeholder={statutoryRemittanceDescription(kind, jalaliYear, jalaliMonth)} />
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-6">
          یک پرداخت از حساب بانک ثبت می‌شود و سند پیش‌نویس آن هر نفر را به نام خودش بدهکار می‌کند. مبلغ هر نفر از مانده او بیشتر نمی‌شود؛ ابطال این پرداخت از جدول خزانه است.
        </p>
        {formError && <p role="alert" className="text-[11px] font-bold text-rose-600 dark:text-rose-400">{formError}</p>}
      </form>
    </Modal>
  );
}
