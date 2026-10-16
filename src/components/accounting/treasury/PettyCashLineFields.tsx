import React from 'react';
import { Trash2 } from 'lucide-react';
import { AccountSearchSelect } from '../AccountSearchSelect';
import { DecimalInput } from '../../common/DecimalInput';
import { formatPersianNumber } from '../../../utils';
import type { PettyCashLineDraft } from '../../../lib/treasury/pettyCash';
import type { Account } from '../../../types';

interface PettyCashLineFieldsProps {
  line: PettyCashLineDraft;
  lineNo: number;
  accounts: Account[];
  accountsLoading: boolean;
  canRemove: boolean;
  onChange: (change: Partial<PettyCashLineDraft>) => void;
  onRemove: () => void;
}

const fieldClass = 'w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl';

/**
 * v10.1.32 (D-16): یک ردیف صورت‌هزینه تنخواه. حساب هزینه و مبلغ پرداخت‌شده لازم‌اند؛ مالیات بر ارزش افزوده، شرح، فروشنده و
 * شماره فاکتور اختیاری‌اند. مالیات نوشته‌شده بخشی از همان مبلغ است و به حساب مالیات خرید می‌رود.
 */
export const PettyCashLineFields: React.FC<PettyCashLineFieldsProps> = ({
  line, lineNo, accounts, accountsLoading, canRemove, onChange, onRemove,
}) => (
  <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2" data-testid="petty-cash-line">
    <div className="flex items-center justify-between">
      <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">ردیف {formatPersianNumber(lineNo)}</span>
      {canRemove && (
        <button
          type="button"
          aria-label="حذف ردیف"
          title="حذف ردیف"
          onClick={onRemove}
          className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <div>
        <label htmlFor={`petty-account-${line.key}`} className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">حساب هزینه *</label>
        <AccountSearchSelect
          id={`petty-account-${line.key}`}
          accounts={accounts}
          value={line.accountId ?? ''}
          onChange={id => onChange({ accountId: id === '' ? null : Number(id) })}
          placeholder={accountsLoading ? 'در حال بارگذاری حساب‌ها...' : 'جست‌وجو و انتخاب حساب هزینه...'}
        />
      </div>
      <div>
        <label htmlFor={`petty-amount-${line.key}`} className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">مبلغ پرداخت‌شده (ریال) *</label>
        <DecimalInput
          id={`petty-amount-${line.key}`}
          value={line.amount}
          min={0}
          onValueChange={text => onChange({ amount: text })}
          className={fieldClass}
          placeholder="مثلاً ۲٬۵۰۰٬۰۰۰"
        />
      </div>
    </div>
    <input
      type="text"
      aria-label={`شرح ردیف ${formatPersianNumber(lineNo)}`}
      value={line.description}
      onChange={e => onChange({ description: e.target.value })}
      className={fieldClass}
      placeholder="شرح هزینه (اختیاری)"
    />
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      <DecimalInput
        aria-label={`مالیات بر ارزش افزوده ردیف ${formatPersianNumber(lineNo)}`}
        value={line.vatAmount}
        min={0}
        onValueChange={text => onChange({ vatAmount: text })}
        className={fieldClass}
        placeholder="مالیات بر ارزش افزوده (اختیاری)"
      />
      <input
        type="text"
        aria-label={`فروشنده ردیف ${formatPersianNumber(lineNo)}`}
        value={line.sellerName}
        onChange={e => onChange({ sellerName: e.target.value })}
        className={fieldClass}
        placeholder="فروشنده (اختیاری)"
      />
      <input
        type="text"
        aria-label={`شماره فاکتور ردیف ${formatPersianNumber(lineNo)}`}
        value={line.invoiceNumber}
        onChange={e => onChange({ invoiceNumber: e.target.value })}
        className={fieldClass}
        placeholder="شماره فاکتور (اختیاری)"
      />
    </div>
  </div>
);
