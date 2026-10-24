import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { PICK_LIST_URLS } from '../../lib/permissions/pickLists';
import type { ProjectPick } from '../../lib/permissions/pickLists';
import { ACCOUNTING_LIST_QUERY_OPTIONS, fetchAccountingList } from '../../hooks/accounting/accountingQueryConfig';
import {
  VOUCHER_DETAILED_TYPES, VOUCHER_DETAILED_TYPE_LABELS, voucherPersonnelName, voucherProjectLabel, type VoucherDetailedType,
} from '../../lib/accounting/voucherDetailedTypes';
import type { BankAccountOption } from '../../types';
import { usePersonnelPickName } from '../../hooks/usePersonnelPickName';
import { formatPersianCode } from '../../utils/persianNumber';
import { personnelServerSearchUrl } from '../../lib/personnel/personnelList';
import { SearchableSelect } from '../SearchableSelect';

/**
 * v9.0.193 (TD-569، B03-27): انتخاب تفصیلی ردیف سند دستی و سند اصلاحی با همان فهرست نوع‌های سرور: مشتری، تأمین‌کننده،
 * پرسنل، پروژه (`/projects/options`)، حساب بانکی و صندوق (`/accounting/bank-accounts/options`) و «متفرقه» (`other`، عنوان آزاد).
 * فهرست پروژه و حساب بانکی فقط وقتی خوانده می‌شود که ردیفی آن نوع را برگزیند.
 */

export interface VoucherDetailedValue {
  detailedType: VoucherDetailedType;
  detailedId: number | null;
  detailedName: string;
}

interface Party { id: number; name: string; partyType?: string; party_type?: string; city?: string; supplierCategory?: string }
interface Person { id: number; fullName?: string; firstName?: string; lastName?: string; username?: string }

interface VoucherDetailedPickerProps {
  value: VoucherDetailedValue;
  onChange: (next: VoucherDetailedValue) => void;
  customers: readonly Party[];
  personnelList: readonly Person[];
  typeRef?: React.Ref<HTMLSelectElement>;
  /** فیلد دوم (فهرست یا عنوان آزاد؛ پرسنلِ فهرستِ بریده‌شده: دکمه انتخابگر جست‌وجوپذیر) */
  pickerRef?: React.RefObject<HTMLSelectElement | HTMLInputElement | HTMLButtonElement | null>;
  /** Enter در فیلد دوم */
  onAdvance?: () => void;
  /** Enter در نوع تفصیلی */
  onTypeEnter?: () => void;
  size?: 'normal' | 'compact';
}

// OBS-R1-55: فقط طرف‌حساب‌های همان نوع (یا «هر دو»)؛ پیش‌تر نبودِ طرف‌حساب این نوع همه طرف‌حساب‌ها را زیر آن نشان می‌داد
function partiesOf(customers: readonly Party[], type: 'customer' | 'supplier'): readonly Party[] {
  return customers.filter(c => {
    const pt = c.partyType || c.party_type || (type === 'customer' ? 'customer' : '');
    return pt === type || pt === 'both';
  });
}

export function VoucherDetailedPicker({
  value, onChange, customers, personnelList, typeRef, pickerRef, onAdvance, onTypeEnter, size = 'normal',
}: VoucherDetailedPickerProps) {
  const type = value.detailedType;
  const projectsQuery = useQuery<ProjectPick[]>({
    queryKey: QUERY_KEYS.projects.options(),
    queryFn: ({ signal }) => fetchAccountingList<ProjectPick>(PICK_LIST_URLS.projects, signal, 'project options'),
    ...ACCOUNTING_LIST_QUERY_OPTIONS,
    enabled: type === 'project',
  });
  const banksQuery = useQuery<BankAccountOption[]>({
    queryKey: QUERY_KEYS.accounting.bankAccountOptions(),
    queryFn: ({ signal }) => fetchAccountingList<BankAccountOption>('/accounting/bank-accounts/options', signal, 'bank account options'),
    ...ACCOUNTING_LIST_QUERY_OPTIONS,
    enabled: type === 'bank_account',
  });

  const cls = size === 'compact'
    ? 'text-[10px] bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded px-1.5 py-0.5'
    : 'px-2 py-1.5 text-[11px] bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-800 dark:text-slate-200';
  const enter = (handler?: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && handler) {
      e.preventDefault();
      handler();
    }
  };
  const pick = (id: number | null, name: string) => onChange({ detailedType: type, detailedId: id, detailedName: name });
  const selectRef = pickerRef as React.Ref<HTMLSelectElement> | undefined;
  const inputRef = pickerRef as React.Ref<HTMLInputElement> | undefined;
  const buttonRef = pickerRef as React.Ref<HTMLButtonElement> | undefined;
  // 10.3 package 6 (TD-1362): a personnel list cut at the cap is a searchable picker that also searches on the server, so
  // an older personnel is found by name; a list under the cap keeps the plain list and its Enter to the next field
  const personnelSearchUrl = type === 'personnel' ? personnelServerSearchUrl(personnelList) : undefined;

  const options: Array<{ id: number; label: string; name: string }> = (() => {
    if (type === 'customer' || type === 'supplier') {
      return partiesOf(customers, type).map(c => ({
        id: c.id, name: c.name,
        label: [c.name, type === 'supplier' && c.supplierCategory ? `[${c.supplierCategory}]` : '', c.city ? `(${c.city})` : ''].filter(Boolean).join(' '),
      }));
    }
    if (type === 'personnel') return personnelList.map(p => ({ id: p.id, name: voucherPersonnelName(p), label: voucherPersonnelName(p) }));
    if (type === 'project') return (projectsQuery.data ?? []).map(p => ({ id: p.id, name: voucherProjectLabel(p), label: voucherProjectLabel(p) }));
    if (type === 'bank_account') return (banksQuery.data ?? []).map(b => ({ id: b.id, name: b.title, label: b.bankName ? `${b.title} (${b.bankName})` : b.title }));
    return [];
  })();
  // TD-1321: a saved row whose record the list does not hold (beyond the personnel cap, or not offered) keeps it as its own
  // option with the stored name, else the personnel's name read by id, never the empty placeholder that drops it when touched
  const storedId = value.detailedId;
  const storedName = String(value.detailedName ?? '').trim();
  const storedMissing = typeof storedId === 'number' && storedId > 0 && !options.some(o => o.id === storedId);
  const fetchedName = usePersonnelPickName(storedId, storedMissing && type === 'personnel' && !storedName);
  if (storedMissing && storedId !== null && type !== 'none' && type !== 'other') {
    const name = storedName || fetchedName || `${VOUCHER_DETAILED_TYPE_LABELS[type]} شماره ${formatPersianCode(storedId)}`;
    options.unshift({ id: storedId, name: storedName || fetchedName, label: name });
  }

  return (
    <div className="flex items-center gap-1">
      <select
        ref={typeRef}
        aria-label="نوع تفصیلی"
        value={type}
        onKeyDown={enter(onTypeEnter)}
        onChange={e => onChange({ detailedType: e.target.value as VoucherDetailedType, detailedId: null, detailedName: '' })}
        className={`w-24 ${cls}`}
      >
        {VOUCHER_DETAILED_TYPES.map(t => <option key={t} value={t}>{VOUCHER_DETAILED_TYPE_LABELS[t]}</option>)}
      </select>

      {type === 'other' && (
        <input
          ref={inputRef}
          type="text"
          aria-label="عنوان تفصیلی"
          value={value.detailedName}
          onKeyDown={enter(onAdvance)}
          onChange={e => pick(null, e.target.value)}
          placeholder="عنوان تفصیلی..."
          className={`flex-1 ${cls}`}
        />
      )}

      {personnelSearchUrl && (
        <SearchableSelect
          buttonRef={buttonRef}
          className="flex-1"
          value={value.detailedId ?? ''}
          placeholder={`انتخاب ${VOUCHER_DETAILED_TYPE_LABELS[type]}...`}
          options={options.map(o => ({ value: String(o.id), label: o.label }))}
          serverSearchUrl={personnelSearchUrl}
          mapResultToOption={(p: Person) => ({ value: String(p.id), label: voucherPersonnelName(p) })}
          onChange={(val, raw?: Person) => {
            const chosen = options.find(o => String(o.id) === val);
            if (chosen) pick(chosen.id, chosen.name);
            else if (raw && String(raw.id) === val) pick(raw.id, voucherPersonnelName(raw));
            else pick(null, '');
          }}
        />
      )}

      {type !== 'none' && type !== 'other' && !personnelSearchUrl && (
        <select
          ref={selectRef}
          aria-label={`انتخاب ${VOUCHER_DETAILED_TYPE_LABELS[type]}`}
          value={value.detailedId ?? ''}
          onKeyDown={enter(onAdvance)}
          onChange={e => {
            const chosen = options.find(o => o.id === Number(e.target.value));
            pick(chosen ? chosen.id : null, chosen ? chosen.name : '');
          }}
          className={`flex-1 ${cls}`}
        >
          <option value="">انتخاب {VOUCHER_DETAILED_TYPE_LABELS[type]}...</option>
          {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      )}
    </div>
  );
}
