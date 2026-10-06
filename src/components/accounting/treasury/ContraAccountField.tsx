import React, { useMemo } from 'react';
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
 * (حساب‌های معین فعال، به‌جز دریافتنی و پرداختنی تجاری، حقوق، چک‌ها، موجودی کالا و سرفصل حساب‌های خزانه) و هنگام ثبت همان را می‌سنجد.
 */
export const ContraAccountField: React.FC<ContraAccountFieldProps> = ({ value, onChange }) => {
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
      <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
        <span>سرفصل طرف مقابل *</span>
        <HelpBadge text="حساب معینی که این وجه به آن تعلق دارد؛ مثلاً هزینه اجاره، وام دریافتی یا سایر بدهکاران. دریافتنی و پرداختنی تجاری و حقوق از کارت طرف حساب و فیش حقوق ثبت می‌شوند." />
      </label>
      <AccountSearchSelect
        accounts={options}
        value={value ?? ''}
        onChange={id => onChange(id === '' ? null : Number(id))}
        placeholder={isLoading ? 'در حال بارگذاری سرفصل‌ها...' : 'جستجو و انتخاب سرفصل معین...'}
      />
    </div>
  );
};
