import React, { useId, useMemo } from 'react';
import { AccountSearchSelect } from '../AccountSearchSelect';
import { HelpBadge } from '../../common/HelpBadge';
import { useContraAccountsQuery } from '../../../hooks/accounting/useTreasuryQueries';
import { statutoryContraWarning } from '../../../lib/treasury/statutoryRemittance';
import type { Account, AccountType } from '../../../types';

interface ContraAccountFieldProps {
  value: number | null;
  onChange: (accountId: number | null) => void;
}

/**
 * v9.0.82 (TD-507، تصمیم مالک محصول ت۴ الف): سرفصل طرف مقابل «متفرقه» و پرداخت «سایر» پرسنل. فهرست را سرور می‌سازد
 * (حساب‌های معین فعال، به‌جز دریافتنی و پرداختنی تجاری، حقوق، چک‌ها، موجودی کالا و سرفصل حساب‌های خزانه) و هنگام ثبت همان را می‌سنجد.
 */
export const ContraAccountField: React.FC<ContraAccountFieldProps> = ({ value, onChange }) => {
  const fieldId = useId();
  const { data, isLoading } = useContraAccountsQuery(true);
  const options = useMemo<Account[]>(() => (Array.isArray(data) ? data : []).map(o => ({
    id: o.id,
    code: o.code,
    name: o.name,
    level: 'subsidiary',
    accountType: o.accountType as AccountType,
    nature: 'both',
  })), [data]);
  // v10.1.36 (TD-1243): پرداخت بیمه یا مالیات حقوق از این فرم بی نام پرسنل است؛ هشدار، نه رد
  const statutoryKind = (Array.isArray(data) ? data : []).find(o => o.id === value)?.statutoryKind;

  return (
    <div>
      <label htmlFor={`${fieldId}-account`} className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
        <span>سرفصل طرف مقابل *</span>
        <HelpBadge text="حساب معینی که این وجه به آن تعلق دارد؛ مثلاً هزینه اجاره، وام دریافتی یا سایر بدهکاران. دریافتنی و پرداختنی تجاری و حقوق از کارت طرف حساب و فیش حقوق ثبت می‌شوند." />
      </label>
      <AccountSearchSelect
        id={`${fieldId}-account`}
        accounts={options}
        value={value ?? ''}
        onChange={id => onChange(id === '' ? null : Number(id))}
        placeholder={isLoading ? 'در حال بارگذاری سرفصل‌ها...' : 'جست‌وجو و انتخاب سرفصل معین...'}
      />
      {statutoryKind && (
        <p role="status" className="mt-1.5 text-[11px] leading-5 font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-2 py-1.5">
          {statutoryContraWarning(statutoryKind)}
        </p>
      )}
    </div>
  );
};
