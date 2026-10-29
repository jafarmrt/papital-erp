import type { ReactNode } from 'react';
import type { Customer } from '../../types';
import type { WarehouseItem } from '../../hooks/queries/useSettingsQueries';
import type { CustomerTarget, StockImportMapping, SupplierTarget, WarehouseTarget } from '../../lib/historyImport/stockSheet';
import { formatPersianCode, formatPersianNumber } from '../../utils';

/**
 * v11 history import, tool 2: the warehouse and supplier names of the Excel file, each mapped once to the app, and the
 * warehouse «انتقال به نمایش» moves to; for the sales sheet (tool 3) each customer name, and which invoices whose Excel status
 * is not «ثبت نهایی» were sold all the same. Item codes are checked by the preview, which offers a code for each unknown one.
 */
interface Props {
  names: { warehouses: string[]; suppliers: string[]; customers: string[] };
  mapping: StockImportMapping;
  warehouses: WarehouseItem[];
  suppliers: Customer[];
  customers: Customer[];
  onChange: (mapping: StockImportMapping) => void;
  unissued: Array<{ invoiceRef: string; customerName: string; lines: number }>;
  included: (invoiceRef: string) => boolean;
  onInclude: (invoiceRef: string, include: boolean) => void;
}

const SELECT_CLASS = 'w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs';

const encodeWarehouse = (t?: WarehouseTarget) => (!t ? '' : t.kind === 'skip' ? 'skip' : `wh:${t.code}`);
const encodeSupplier = (t?: SupplierTarget) => (!t ? '' : t.kind === 'skip' ? 'skip' : `s:${t.partyId}`);
const encodeCustomer = (t?: CustomerTarget) => (!t ? '' : t.kind === 'skip' ? 'skip' : `c:${t.partyId}`);

export function StockImportNames({ names, mapping, warehouses, suppliers, customers, onChange, unissued, included, onInclude }: Props) {
  const setCustomer = (name: string, value: string) => {
    const next = { ...(mapping.customers ?? {}) };
    if (!value) delete next[name];
    else next[name] = value === 'skip' ? { kind: 'skip' } : { kind: 'customer', partyId: Number(value.slice(2)) };
    onChange({ ...mapping, customers: next });
  };
  const setWarehouse = (name: string, value: string) => {
    const next = { ...mapping.warehouses };
    if (!value) delete next[name];
    else next[name] = value === 'skip' ? { kind: 'skip' } : { kind: 'warehouse', code: value.slice(3) };
    onChange({ ...mapping, warehouses: next });
  };
  const setSupplier = (name: string, value: string) => {
    const next = { ...mapping.suppliers };
    if (!value) delete next[name];
    else next[name] = value === 'skip' ? { kind: 'skip' } : { kind: 'supplier', partyId: Number(value.slice(2)) };
    onChange({ ...mapping, suppliers: next });
  };
  const warehouseOptions = warehouses.map(w => <option key={w.code} value={`wh:${w.code}`}>{w.name || formatPersianCode(w.code)}</option>);

  const section = (title: string, hint: string, items: string[], render: (name: string) => ReactNode) => items.length === 0 ? null : (
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
      {section('انبار', 'هر نام ستون «انبار» به یک انبار برنامه وصل شود؛ خانهٔ خالی یعنی انبار پیش‌فرض.', names.warehouses, name => (
        <select aria-label={`انبار ${name}`} className={SELECT_CLASS} value={encodeWarehouse(mapping.warehouses[name])} onChange={e => setWarehouse(name, e.target.value)}>
          <option value="">انتخاب کنید</option>
          <option value="skip">کنار گذاشته شود</option>
          {warehouseOptions}
        </select>
      ))}
      {section('تأمین‌کننده', 'تأمین‌کنندهٔ هر خرید؛ همان نامی که در برگهٔ «هزینه‌ها» آمده تا پرداخت‌ها روی همین رسیدها بنشیند.', names.suppliers, name => (
        <select aria-label={`تأمین‌کننده ${name}`} className={SELECT_CLASS} value={encodeSupplier(mapping.suppliers[name])} onChange={e => setSupplier(name, e.target.value)}>
          <option value="">انتخاب کنید</option>
          <option value="skip">کنار گذاشته شود</option>
          {suppliers.map(s => <option key={s.id} value={`s:${s.id}`}>{s.name}</option>)}
        </select>
      ))}
      {section('مشتری', 'مشتری هر فاکتور فروش؛ اگر یک مشتری با چند نوشتار آمده، همه را به همان مشتری وصل کنید تا دریافت‌ها روی فاکتورهایش بنشیند.', names.customers, name => (
        <select aria-label={`مشتری ${name}`} className={SELECT_CLASS} value={encodeCustomer(mapping.customers?.[name])} onChange={e => setCustomer(name, e.target.value)}>
          <option value="">انتخاب کنید</option>
          <option value="skip">کنار گذاشته شود</option>
          {customers.map(c => <option key={c.id} value={`c:${c.id}`}>{c.name}</option>)}
        </select>
      ))}
      {unissued.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200">فاکتورهای بدون «ثبت نهایی»</h4>
          <p className="text-[11px] text-slate-500">وضعیت این فاکتورها در اکسل «ثبت نهایی» نیست و کنار گذاشته می‌شوند؛ هر کدام که واقعاً فروخته شده را تیک بزنید.</p>
          {unissued.map(u => (
            <label key={u.invoiceRef} className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={included(u.invoiceRef)} onChange={e => onInclude(u.invoiceRef, e.target.checked)} />
              فاکتور {formatPersianCode(u.invoiceRef)} — {u.customerName || 'بی مشتری'} ({formatPersianNumber(u.lines)} ردیف)
            </label>
          ))}
        </section>
      )}
      {names.customers.length + unissued.length > 0 || Object.keys(mapping.customers ?? {}).length > 0 ? (
        <label className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-center">
          <span className="text-xs text-slate-700 dark:text-slate-200">انبار فروش (کالای فاکتورهای فروش از این انبار خارج می‌شود و مرجوعیِ بی انبار به آن برمی‌گردد)</span>
          <select aria-label="انبار فروش" className={SELECT_CLASS} value={mapping.salesWarehouse ?? ''}
            onChange={e => onChange({ ...mapping, salesWarehouse: e.target.value || null })}>
            <option value="">انبار پیش‌فرض</option>
            {warehouses.map(w => <option key={w.code} value={w.code}>{w.name || formatPersianCode(w.code)}</option>)}
          </select>
        </label>
      ) : null}
      <label className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-center">
        <span className="text-xs text-slate-700 dark:text-slate-200">انبار «نمایش» (مقصد ردیف‌های «انتقال به نمایش»)</span>
        <select aria-label="انبار نمایش" className={SELECT_CLASS} value={mapping.displayWarehouse ?? ''}
          onChange={e => onChange({ ...mapping, displayWarehouse: e.target.value || null })}>
          <option value="">انتخاب کنید</option>
          {warehouses.map(w => <option key={w.code} value={w.code}>{w.name || formatPersianCode(w.code)}</option>)}
        </select>
      </label>
    </div>
  );
}
