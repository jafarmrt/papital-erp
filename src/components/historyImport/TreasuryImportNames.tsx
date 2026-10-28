import React from 'react';
import type { BankAccount, Customer, Personnel } from '../../types';
import type { ContraAccountOption } from '../../hooks/accounting/useTreasuryQueries';
import type { BankTarget, ExpenseTarget, PartyTarget, TreasuryImportMapping } from '../../lib/historyImport/treasurySheet';
import { formatPersianCode } from '../../utils';

/**
 * v11 history import, tool 1: the names of the Excel file, each mapped once to something in the app. A select's value is
 * `kind:id` («skip» leaves the name's rows out).
 */
export interface TreasuryImportLists {
  banks: BankAccount[];
  customers: Customer[];
  personnel: Personnel[];
  accounts: ContraAccountOption[];
}

interface Props {
  names: { banks: string[]; parties: string[]; expenses: string[] };
  mapping: TreasuryImportMapping;
  lists: TreasuryImportLists;
  onChange: (mapping: TreasuryImportMapping) => void;
}

const partyTypeOf = (c: Customer) => c.partyType ?? c.party_type ?? 'customer';
const accountLabel = (a: ContraAccountOption) => `${formatPersianCode(a.code)} — ${a.name}`;
const SELECT_CLASS = 'w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs';

const encodeBank = (t?: BankTarget) => (!t ? '' : t.kind === 'skip' ? 'skip' : `bank:${t.bankAccountId}`);
const encodeParty = (t?: PartyTarget) => {
  if (!t) return '';
  switch (t.kind) {
    case 'skip': return 'skip';
    case 'bank': return `bank:${t.bankAccountId}`;
    case 'account': return `account:${t.accountId}`;
    case 'personnel': return `personnel:${t.personnelId}`;
    default: return `${t.kind}:${t.partyId}`;
  }
};
const encodeExpense = (t?: ExpenseTarget) => (!t ? '' : t.kind === 'account' ? `account:${t.accountId}` : t.kind);

export function TreasuryImportNames({ names, mapping, lists, onChange }: Props) {
  const banks = Array.isArray(lists.banks) ? lists.banks : [];
  const customers = (Array.isArray(lists.customers) ? lists.customers : []).filter(c => partyTypeOf(c) !== 'supplier');
  const suppliers = (Array.isArray(lists.customers) ? lists.customers : []).filter(c => partyTypeOf(c) !== 'customer');
  const personnel = Array.isArray(lists.personnel) ? lists.personnel : [];
  const accounts = Array.isArray(lists.accounts) ? lists.accounts : [];
  const nameOf = (id: number) => lists.customers.find(c => c.id === id)?.name ?? '';
  const personOf = (id: number) => personnel.find(p => p.id === id)?.fullName ?? '';

  const setBank = (name: string, value: string) => {
    const banksMap = { ...mapping.banks };
    if (!value) delete banksMap[name];
    else banksMap[name] = value === 'skip' ? { kind: 'skip' } : { kind: 'bank', bankAccountId: Number(value.split(':')[1]) };
    onChange({ ...mapping, banks: banksMap });
  };
  const setParty = (name: string, value: string) => {
    const parties = { ...mapping.parties };
    const [kind, raw] = value.split(':');
    const id = Number(raw);
    if (!value) delete parties[name];
    else if (kind === 'skip') parties[name] = { kind: 'skip' };
    else if (kind === 'bank') parties[name] = { kind: 'bank', bankAccountId: id };
    else if (kind === 'account') parties[name] = { kind: 'account', accountId: id };
    else if (kind === 'personnel') parties[name] = { kind: 'personnel', personnelId: id, name: personOf(id) };
    else parties[name] = { kind: kind as 'customer' | 'supplier', partyId: id, name: nameOf(id) };
    onChange({ ...mapping, parties });
  };
  const setExpense = (name: string, value: string) => {
    const expenses = { ...mapping.expenses };
    if (!value) delete expenses[name];
    else if (value === 'skip' || value === 'supplier') expenses[name] = { kind: value };
    else expenses[name] = { kind: 'account', accountId: Number(value.split(':')[1]) };
    onChange({ ...mapping, expenses });
  };

  const bankOptions = banks.map(b => <option key={`b${b.id}`} value={`bank:${b.id}`}>{b.title}</option>);
  const accountOptions = accounts.map(a => <option key={`a${a.id}`} value={`account:${a.id}`}>{accountLabel(a)}</option>);
  const section = (title: string, hint: string, items: string[], render: (name: string) => React.ReactNode) => items.length === 0 ? null : (
    <section className="space-y-2">
      <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200">{title}</h4>
      <p className="text-[11px] text-slate-500">{hint}</p>
      <div className="grid gap-2">
        {items.map(name => (
          <label key={name} className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-center rounded-lg bg-slate-50 dark:bg-slate-800/60 p-2">
            <span className="text-xs font-medium text-slate-800 dark:text-slate-100 break-words">{name}</span>
            {render(name)}
          </label>
        ))}
      </div>
    </section>
  );

  return (
    <div className="space-y-5">
      {section('حساب نقد و بانک', 'هر نام ستون «حساب نقد و بانک» به یک حساب بانکی یا صندوق برنامه وصل شود. ردیف دوم مساعده (پرداخت از «مساعده - …») را کنار بگذارید تا مساعده یک بار ثبت شود.', names.banks, name => (
        <select aria-label={`حساب ${name}`} className={SELECT_CLASS} value={encodeBank(mapping.banks[name])} onChange={e => setBank(name, e.target.value)}>
          <option value="">انتخاب کنید</option>
          <option value="skip">کنار گذاشته شود</option>
          {bankOptions}
        </select>
      ))}
      {section('طرف حساب', 'مشتری، تأمین‌کننده، همکار، یکی از حساب‌های بانکی خودمان (انتقال) یا یک حساب (مانند کارمزد بانکی و سود بانکی).', names.parties, name => (
        <select aria-label={`طرف حساب ${name}`} className={SELECT_CLASS} value={encodeParty(mapping.parties[name])} onChange={e => setParty(name, e.target.value)}>
          <option value="">انتخاب کنید</option>
          <option value="skip">کنار گذاشته شود</option>
          <optgroup label="مشتری">{customers.map(c => <option key={`c${c.id}`} value={`customer:${c.id}`}>{c.name}</option>)}</optgroup>
          <optgroup label="تأمین‌کننده">{suppliers.map(c => <option key={`s${c.id}`} value={`supplier:${c.id}`}>{c.name}</option>)}</optgroup>
          <optgroup label="همکار">{personnel.map(p => <option key={`p${p.id}`} value={`personnel:${p.id}`}>{p.fullName}</option>)}</optgroup>
          <optgroup label="انتقال به حساب خودمان">{bankOptions}</optgroup>
          <optgroup label="حساب">{accountOptions}</optgroup>
        </select>
      ))}
      {section('نوع هزینه', 'هر نوع هزینه به حساب هزینه‌اش وصل شود. خرید مواد اولیه را «پرداخت به تأمین‌کننده» بگذارید: کالا با رسید انبار ثبت شده و اینجا فقط پول به تأمین‌کننده داده می‌شود. حقوقی که در هزینه‌ها دوباره آمده را کنار بگذارید.', names.expenses, name => (
        <select aria-label={`نوع هزینه ${name}`} className={SELECT_CLASS} value={encodeExpense(mapping.expenses[name])} onChange={e => setExpense(name, e.target.value)}>
          <option value="">انتخاب کنید</option>
          <option value="skip">کنار گذاشته شود</option>
          <option value="supplier">پرداخت به تأمین‌کننده (خرید مواد)</option>
          <optgroup label="حساب هزینه">{accountOptions}</optgroup>
        </select>
      ))}
      <label className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-center">
        <span className="text-xs text-slate-700 dark:text-slate-200">حساب مقابل برای پرداخت‌های دیگر به همکاران (نه حقوق و نه مساعده؛ مثلاً پس دادن خرج‌کرد)</span>
        <select aria-label="حساب مقابل پرداخت‌های دیگر همکاران" className={SELECT_CLASS} value={mapping.personnelOtherAccountId ? String(mapping.personnelOtherAccountId) : ''}
          onChange={e => onChange({ ...mapping, personnelOtherAccountId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">انتخاب کنید</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
        </select>
      </label>
    </div>
  );
}
