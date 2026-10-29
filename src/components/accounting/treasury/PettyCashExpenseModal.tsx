import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useProjectPickQuery } from '../../../hooks/queries/useProjectQueries';
import { Plus, Receipt } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Modal } from '../../common/Modal';
import { JalaliDateInput } from '../../common/JalaliDateInput';
import { refuseInvalidDecimalInputs } from '../../common/DecimalInput';
import { FinancialAttachmentUploader } from '../FinancialAttachmentUploader';
import { PettyCashLineFields } from './PettyCashLineFields';
import { rialDisplayOf } from '../../../lib/rialDisplay';
import { useOnlineStatus } from '../../../lib/pwa/useOnlineStatus';
import { OFFLINE_SUBMIT_TITLE } from '../../../lib/pwa/phoneLayout';
import { errorMessageOf, getTodayIsoDate } from '../../../utils';
import {
  emptyPettyCashLine, pettyCashExpensePayload, pettyCashLinesTotal, pettyCashStatementError,
  PETTY_CASH_MAX_LINES, type PettyCashLineDraft,
} from '../../../lib/treasury/pettyCash';
import { usePettyCashExpenseAccountsQuery, usePettyCashExpenseMutation } from '../../../hooks/accounting/usePettyCashQueries';
import type { Account, AccountType, BankAccount, FinancialAttachment } from '../../../types';

interface PettyCashExpenseModalProps {
  fund: BankAccount | null;
  appCurrency: string;
  onClose: () => void;
}

/**
 * v10.1.32 (D-16، ت۳۰ «متغیر»): صورت‌هزینه تنخواه‌گردان. هر ردیف یک حساب هزینه و مبلغ دارد و بقیه اختیاری است؛ سرور یک
 * پرداخت از تنخواه با سند پیش‌نویس (بدهکار حساب‌های هزینه، بستانکار تنخواه) ثبت می‌کند و جمع از مانده تنخواه بیشتر نمی‌شود.
 */
export const PettyCashExpenseModal: React.FC<PettyCashExpenseModalProps> = ({ fund, appCurrency, onClose }) => {
  const isOpen = fund !== null;
  const fundId = fund?.id ?? null;
  const rial = useMemo(() => rialDisplayOf(appCurrency), [appCurrency]);
  const online = useOnlineStatus();
  const nextKey = useRef(2);
  const formRef = useRef<HTMLFormElement>(null);
  const dateId = useId();
  const [date, setDate] = useState('');
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<PettyCashLineDraft[]>([emptyPettyCashLine(1)]);
  const [attachments, setAttachments] = useState<FinancialAttachment[]>([]);
  const [formError, setFormError] = useState('');
  const accountsQuery = usePettyCashExpenseAccountsQuery(isOpen);
  // v11 tool 5: a line may name the production project it was spent on
  const projectsQuery = useProjectPickQuery();
  const projects = Array.isArray(projectsQuery.data) ? projectsQuery.data : [];
  const mutation = usePettyCashExpenseMutation();
  const isSaving = mutation.isPending;

  useEffect(() => {
    if (!isOpen) return;
    nextKey.current = 2;
    setDate(getTodayIsoDate());
    setDescription('');
    setLines([emptyPettyCashLine(1)]);
    setAttachments([]);
    setFormError('');
  }, [isOpen, fundId]);

  const accounts = useMemo<Account[]>(() => (Array.isArray(accountsQuery.data) ? accountsQuery.data : []).map(o => ({
    id: o.id, code: o.code, name: o.name, level: 'subsidiary', accountType: o.accountType as AccountType, nature: 'both',
  })), [accountsQuery.data]);

  if (!fund) return null;
  const balance = Number(fund.currentBalance) || 0;
  const total = pettyCashLinesTotal(lines).toNumber();

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
    const error = pettyCashStatementError(lines, balance);
    setFormError(error);
    if (error) return;
    try {
      await mutation.mutateAsync({ fundId: fund.id, payload: pettyCashExpensePayload({ date, description, lines, attachments }) });
      toast.success('صورت‌هزینه تنخواه با سند حسابداری ثبت شد.');
      onClose();
    } catch (err) {
      setFormError(errorMessageOf(err));
    }
  };

  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-2 w-full">
      <div className="text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5">
        <div>جمع صورت‌هزینه: <span className="font-bold">{rial.amount(total)}</span></div>
        <div>مانده پس از ثبت: <span className={`font-bold ${balance - total < 0 ? 'text-rose-600' : ''}`}>{rial.amount(balance - total)}</span></div>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onClose} disabled={isSaving}
          className="px-4 py-2 text-xs font-bold border border-slate-200 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50">
          انصراف
        </button>
        <button type="submit" form="petty-cash-expense-form" disabled={isSaving || !online}
          title={online ? undefined : OFFLINE_SUBMIT_TITLE}
          className="px-4 py-2 text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white rounded-xl disabled:opacity-50">
          {isSaving ? 'در حال ثبت...' : 'ثبت صورت‌هزینه با سند حسابداری'}
        </button>
      </div>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="صورت‌هزینه تنخواه"
      subtitle={`${fund.title} — مانده: ${rial.amount(balance)}`}
      icon={<Receipt className="w-5 h-5 text-amber-600" />}
      size="2xl"
      footer={footer}
      closeOnEscape={!isSaving}
      closeOnBackdropClick={false}
    >
      <form id="petty-cash-expense-form" ref={formRef} onSubmit={handleSubmit} className="space-y-3" noValidate>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor={dateId} className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">تاریخ *</label>
            <JalaliDateInput
              id={dateId}
              value={date}
              onChange={iso => { setDate(iso); setFormError(''); }}
              calendarPosition="bottom-right"
              className="w-full px-3 py-2 text-xs text-center bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
              containerClassName="w-full"
            />
          </div>
          <div>
            <label htmlFor="petty-cash-description" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">شرح صورت‌هزینه</label>
            <input
              id="petty-cash-description"
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
              placeholder={`پیش‌فرض: صورت‌هزینه تنخواه ${fund.title}`}
            />
          </div>
        </div>

        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-6">
          مالیات بر ارزش افزوده، فروشنده و شماره فاکتور لازم نیستند. سند این صورت‌هزینه پیش‌نویس است و در صفحه اسناد حسابداری تأیید می‌شود.
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

        <FinancialAttachmentUploader
          attachments={attachments}
          onChange={setAttachments}
          title="تصویر فاکتورها و رسیدها (اختیاری)"
        />

        {formError && (
          <p role="alert" className="text-[11px] font-bold text-rose-600 dark:text-rose-400">{formError}</p>
        )}
      </form>
    </Modal>
  );
};
