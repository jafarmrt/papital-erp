import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useProjectPickQuery } from '../../../hooks/queries/useProjectQueries';
import { Plus, Wallet } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Modal } from '../../common/Modal';
import { JalaliDateInput } from '../../common/JalaliDateInput';
import { refuseInvalidDecimalInputs } from '../../common/DecimalInput';
import { FinancialAttachmentUploader } from '../FinancialAttachmentUploader';
import { PettyCashLineFields } from './PettyCashLineFields';
import { rialDisplayOf } from '../../../lib/rialDisplay';
import { useOnlineStatus } from '../../../lib/pwa/useOnlineStatus';
import { OFFLINE_SUBMIT_TITLE } from '../../../lib/pwa/phoneLayout';
import { errorMessageOf, formatPersianDate, getTodayIsoDate } from '../../../utils';
import { formatPersianCode } from '../../../utils/persianNumber';
import {
  emptyPettyCashLine, pettyCashExpensePayload, pettyCashLinesTotal, pettyCashStatementError,
  PETTY_CASH_MAX_LINES, type PettyCashLineDraft,
} from '../../../lib/treasury/pettyCash';
import {
  useColleagueExpenseMutation, useColleagueExpensesQuery, usePettyCashExpenseAccountsQuery, useVoidColleagueExpenseMutation,
} from '../../../hooks/accounting/usePettyCashQueries';
import type { Account, AccountType, FinancialAttachment, Personnel } from '../../../types';

interface ColleagueExpenseModalProps {
  isOpen: boolean;
  personnel: Personnel[];
  appCurrency: string;
  onClose: () => void;
}

const fieldClass = 'w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl';

/**
 * v11 (the 1405 replay, tool 4; owner's decisions 7 Aban 1405): an expense a colleague paid for the company from their own
 * pocket. The lines are a petty cash statement's; the server records a draft voucher that debits each expense and credits
 * the colleague's running account («حساب جاری همکاران»). Petty cash given to a colleague, a payback, or money they hand back
 * are treasury payments and receipts of the personnel type «حساب جاری همکار». The list shows each colleague's running
 * account and the latest expenses, which are voided here (their voucher is not changed from the voucher page).
 */
export const ColleagueExpenseModal: React.FC<ColleagueExpenseModalProps> = ({ isOpen, personnel, appCurrency, onClose }) => {
  const rial = useMemo(() => rialDisplayOf(appCurrency), [appCurrency]);
  const online = useOnlineStatus();
  const nextKey = useRef(2);
  const formRef = useRef<HTMLFormElement>(null);
  const dateId = useId();
  const personId = useId();
  const [personnelId, setPersonnelId] = useState('');
  const [date, setDate] = useState('');
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<PettyCashLineDraft[]>([emptyPettyCashLine(1)]);
  const [attachments, setAttachments] = useState<FinancialAttachment[]>([]);
  const [formError, setFormError] = useState('');
  const [voiding, setVoiding] = useState<{ id: number; reason: string } | null>(null);
  const accountsQuery = usePettyCashExpenseAccountsQuery(isOpen);
  // v11 tool 5: a line may name the production project it was spent on
  const projectsQuery = useProjectPickQuery();
  const projects = Array.isArray(projectsQuery.data) ? projectsQuery.data : [];
  const listQuery = useColleagueExpensesQuery(isOpen);
  const mutation = useColleagueExpenseMutation();
  const voidMutation = useVoidColleagueExpenseMutation();
  const isSaving = mutation.isPending;

  useEffect(() => {
    if (!isOpen) return;
    nextKey.current = 2;
    setPersonnelId('');
    setDate(getTodayIsoDate());
    setDescription('');
    setLines([emptyPettyCashLine(1)]);
    setAttachments([]);
    setFormError('');
  }, [isOpen]);

  const accounts = useMemo<Account[]>(() => (Array.isArray(accountsQuery.data) ? accountsQuery.data : []).map(o => ({
    id: o.id, code: o.code, name: o.name, level: 'subsidiary', accountType: o.accountType as AccountType, nature: 'both',
  })), [accountsQuery.data]);

  if (!isOpen) return null;
  const total = pettyCashLinesTotal(lines).toNumber();
  const rows = listQuery.data?.rows ?? [];
  const balances = listQuery.data?.owed ?? [];

  const changeLine = (key: number, change: Partial<PettyCashLineDraft>) => {
    setLines(prev => prev.map(line => (line.key === key ? { ...line, ...change } : line)));
    setFormError('');
  };
  const removeLine = (key: number) => setLines(prev => prev.filter(line => line.key !== key));
  const addLine = () => {
    if (refuseInvalidDecimalInputs(formRef.current)) return;
    setLines(prev => [...prev, emptyPettyCashLine(nextKey.current++)]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const error = !personnelId ? 'همکاری را که هزینه را از جیب خود داده انتخاب کنید.' : pettyCashStatementError(lines);
    setFormError(error);
    if (error) return;
    try {
      await mutation.mutateAsync({ personnelId: Number(personnelId), ...pettyCashExpensePayload({ date, description, lines, attachments }) });
      toast.success('هزینهٔ پرداختی همکار با سند حسابداری ثبت شد.');
      nextKey.current = 2;
      setLines([emptyPettyCashLine(1)]);
      setDescription('');
      setAttachments([]);
    } catch (err) {
      setFormError(errorMessageOf(err));
    }
  };

  const handleVoid = async () => {
    const reason = voiding?.reason.trim();
    if (!voiding || !reason) { toast.error('دلیل ابطال را بنویسید.'); return; }
    try {
      await voidMutation.mutateAsync({ id: voiding.id, reason });
      setVoiding(null);
      toast.success('هزینهٔ پرداختی همکار ابطال شد.');
    } catch (err) {
      toast.error(errorMessageOf(err));
    }
  };

  const balanceText = (value: number) => (value > 0
    ? `شرکت ${rial.amount(value)} به او بدهکار است`
    : value < 0 ? `${rial.amount(-value)} از پول شرکت نزد اوست` : 'بی‌حساب');

  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-2 w-full">
      <div className="text-[11px] text-slate-600 dark:text-slate-300">جمع هزینه: <span className="font-bold">{rial.amount(total)}</span></div>
      <div className="flex gap-2">
        <button type="button" onClick={onClose} disabled={isSaving}
          className="px-4 py-2 text-xs font-bold border border-slate-200 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50">
          بستن
        </button>
        <button type="submit" form="colleague-expense-form" disabled={isSaving || !online}
          title={online ? undefined : OFFLINE_SUBMIT_TITLE}
          className="px-4 py-2 text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white rounded-xl disabled:opacity-50">
          {isSaving ? 'در حال ثبت...' : 'ثبت هزینه با سند حسابداری'}
        </button>
      </div>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="هزینهٔ پرداختی همکار"
      subtitle="هزینه‌ای که همکار از جیب خودش برای شرکت داده است"
      icon={<Wallet className="w-5 h-5 text-amber-600" />}
      size="2xl"
      footer={footer}
      closeOnEscape={!isSaving}
      closeOnBackdropClick={false}
    >
      <form id="colleague-expense-form" ref={formRef} onSubmit={handleSubmit} className="space-y-3" noValidate>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor={personId} className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">همکار *</label>
            <select id={personId} value={personnelId} onChange={e => { setPersonnelId(e.target.value); setFormError(''); }} className={`${fieldClass} font-bold`}>
              <option value="">انتخاب کنید...</option>
              {personnel.map(p => <option key={p.id} value={p.id}>{p.fullName}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={dateId} className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">تاریخ *</label>
            <JalaliDateInput
              id={dateId}
              value={date}
              onChange={iso => { setDate(iso); setFormError(''); }}
              calendarPosition="bottom-right"
              className={`${fieldClass} text-center`}
              containerClassName="w-full"
            />
          </div>
          <div>
            <label htmlFor="colleague-expense-description" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">شرح</label>
            <input id="colleague-expense-description" type="text" value={description} onChange={e => setDescription(e.target.value)}
              className={fieldClass} placeholder="پیش‌فرض: هزینهٔ پرداختی همکار از جیب خود" />
          </div>
        </div>

        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-6">
          سند این هزینه حساب هزینه را بدهکار و «حساب جاری همکاران» را با نام همین همکار بستانکار می‌کند و پیش‌نویس است. تنخواهی که به
          همکار داده می‌شود یا بازپرداخت این هزینه، در خزانه با «پرداخت» به پرسنل و نوع «حساب جاری همکار» ثبت می‌شود.
        </p>

        <div className="space-y-2">
          {lines.map((line, index) => (
            <PettyCashLineFields
              key={line.key}
              line={line}
              lineNo={index + 1}
              accounts={accounts}
              accountsLoading={accountsQuery.isLoading}
              canRemove={lines.length > 1}
              projects={projects}
              onChange={change => changeLine(line.key, change)}
              onRemove={() => removeLine(line.key)}
            />
          ))}
        </div>

        {lines.length < PETTY_CASH_MAX_LINES && (
          <button type="button" onClick={addLine}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-amber-700 dark:text-amber-300 border border-dashed border-amber-400 rounded-xl hover:bg-amber-50 dark:hover:bg-amber-900/20">
            <Plus size={14} />
            افزودن ردیف
          </button>
        )}

        <FinancialAttachmentUploader attachments={attachments} onChange={setAttachments} title="تصویر فاکتورها و رسیدها" />

        {formError && <p role="alert" className="text-[11px] font-bold text-rose-600 dark:text-rose-400">{formError}</p>}
      </form>

      <section className="mt-5 space-y-2" aria-label="حساب جاری همکاران">
        <h3 className="text-xs font-bold text-slate-700 dark:text-slate-200">حساب جاری همکاران</h3>
        {balances.length === 0 && !listQuery.isLoading && <p className="text-[11px] text-slate-500">هنوز هزینه‌ای ثبت نشده است.</p>}
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px]">
          {balances.map(b => (
            <li key={b.personnelId} className="flex justify-between gap-2 rounded-lg bg-slate-50 dark:bg-slate-800 px-2 py-1">
              <span className="font-bold">{b.personnelName}</span>
              <span>{balanceText(b.owed)}</span>
            </li>
          ))}
        </ul>
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-slate-500">
                  <th className="text-right p-1">تاریخ</th><th className="text-right p-1">همکار</th><th className="text-right p-1">مبلغ</th>
                  <th className="text-right p-1">سند</th><th className="p-1" />
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className={`border-t border-slate-100 dark:border-slate-700 ${r.status === 'voided' ? 'opacity-50 line-through' : ''}`}>
                    <td className="p-1">{formatPersianDate(r.date)}</td>
                    <td className="p-1">{r.personnelName}</td>
                    <td className="p-1">{rial.amount(r.total)}</td>
                    <td className="p-1">{r.voucherNumber ? formatPersianCode(String(r.voucherNumber)) : '—'}</td>
                    <td className="p-1 text-left">
                      {r.status === 'active' && voiding?.id !== r.id && (
                        <button type="button" onClick={() => setVoiding({ id: r.id, reason: '' })}
                          className="px-2 py-1 text-[11px] font-bold text-rose-700 border border-rose-200 rounded-lg hover:bg-rose-50">
                          ابطال
                        </button>
                      )}
                      {voiding?.id === r.id && (
                        <span className="flex items-center gap-1">
                          <input type="text" aria-label="دلیل ابطال" value={voiding.reason} placeholder="دلیل ابطال"
                            onChange={e => setVoiding({ id: r.id, reason: e.target.value })} className="px-2 py-1 text-[11px] border border-slate-300 rounded-lg" />
                          <button type="button" onClick={() => void handleVoid()} disabled={voidMutation.isPending}
                            className="px-2 py-1 text-[11px] font-bold text-white bg-rose-600 rounded-lg disabled:opacity-50">تأیید</button>
                          <button type="button" onClick={() => setVoiding(null)} className="px-2 py-1 text-[11px]">انصراف</button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Modal>
  );
};
