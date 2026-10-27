import React, { useId, useMemo } from 'react';
import { AccountSearchSelect } from '../AccountSearchSelect';
import { HelpBadge } from '../../common/HelpBadge';
import { useContraAccountsQuery } from '../../../hooks/accounting/useTreasuryQueries';
import type { Account, AccountType } from '../../../types';

interface ContraAccountFieldProps {
  value: number | null;
  onChange: (accountId: number | null) => void;
}

/**
 * v9.0.82 (TD-507، تصمیم مالک محصول ت۴ الف): سرفصل طرف مقابل «متفرقه» و پرداخت «سایر» پرسنل. فهرست را سرور می‌سازد
 * (حساب‌های معین فعال، به‌جز حساب‌های کنترلی و بستن سال) و هنگام ثبت همان را می‌سنجد. v11 phase 6.1b (M6): the insurance
 * and payroll tax payables are control accounts now and are not listed, so the warning of v10.1.36 (TD-1243) is gone.
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

  return (
    <div>
      <label htmlFor={`${fieldId}-account`} className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
        <span>سرفصل طرف مقابل *</span>
        <HelpBadge text="حساب معینی که این وجه به آن تعلق دارد؛ مثلاً هزینه اجاره، وام دریافتی یا سایر بدهکاران. حساب‌های کنترلی (بانک، طرف حساب‌ها، حقوق، بیمه و مالیات، عیدی، مساعده، چک و موجودی کالا) از دفتر خودشان ثبت می‌شوند و این‌جا نیستند." />
      </label>
      <AccountSearchSelect
        id={`${fieldId}-account`}
        accounts={options}
        value={value ?? ''}
        onChange={id => onChange(id === '' ? null : Number(id))}
        placeholder={isLoading ? 'در حال بارگذاری سرفصل‌ها...' : 'جست‌وجو و انتخاب سرفصل معین...'}
      />
    </div>
  );
};
