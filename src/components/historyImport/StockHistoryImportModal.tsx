import { useMemo, useRef, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, ModalFooterActions } from '../common/Modal';
import { ApiError, fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import type { Customer } from '../../types';
import type { WarehouseItem } from '../../hooks/queries/useSettingsQueries';
import { STOCK_IMPORT_MAX_ROWS, type StockImportResult } from '../../lib/historyImport/stockHistoryImport';
import { remapItemCode, resolveStockRow, salesInvoiceKey, wholeSalesInvoices, unissuedSalesInvoices, unmappedStockNames, type ParsedStockRow, type StockImportMapping } from '../../lib/historyImport/stockSheet';
import { errorMessageOf, formatPersianCode, formatPersianNumber } from '../../utils';
import { StockImportNames } from './StockImportNames';
import { StockImportPreview } from './StockImportPreview';
import { OldOpeningsStep } from './OldOpeningsStep';
import { loadSavedStockMapping, readStockWorkbook, saveStockMapping, stockRowMonth } from './stockImportWorkbook';

/**
 * v11 history import, tool 2 (1405 replay): past warehouse movements from the cleaned sheets «ورود به انبار» and «خروج
 * دستی». The user picks the file and a month, maps each warehouse and supplier once, previews (the server tries every row
 * and keeps nothing; an unknown code is mapped right in the preview) and posts the month at once; one refused row posts
 * nothing.
 */
interface Props {
  isOpen: boolean;
  onClose: () => void;
  warehouses: WarehouseItem[];
  suppliers: Customer[];
  customers: Customer[];
}

type Step = 'file' | 'names' | 'preview';

const nameKey = (s: string) => s.replace(/[‌\s]+/g, ' ').replace(/ي/g, 'ی').replace(/ك/g, 'ک').trim().toLowerCase();

export function StockHistoryImportModal({ isOpen, onClose, warehouses, suppliers, customers }: Props) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('file');
  const [rows, setRows] = useState<ParsedStockRow[]>([]);
  const [month, setMonth] = useState('');
  const [mapping, setMapping] = useState<StockImportMapping>(loadSavedStockMapping);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<StockImportResult | null>(null);
  const [stale, setStale] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const busyRef = useRef(false);

  const lookups = useMemo(() => {
    const byName = new Map<string, string>();
    for (const w of warehouses) { byName.set(nameKey(w.name || ''), w.code); byName.set(nameKey(w.code), w.code); }
    return {
      warehouseCodeOf: (name: string) => byName.get(nameKey(name)) ?? null,
    };
  }, [warehouses]);
  const months = useMemo(() => [...new Set(rows.map(stockRowMonth))].sort(), [rows]);
  const monthRows = useMemo(() => rows.filter(r => stockRowMonth(r) === month), [rows, month]);
  const resolved = useMemo(() => wholeSalesInvoices(monthRows.map(r => resolveStockRow(r, mapping, lookups, accepted)), rows), [monthRows, rows, mapping, lookups, accepted]);
  const names = useMemo(() => unmappedStockNames(monthRows, { ...mapping, warehouses: {}, suppliers: {}, customers: {} }, lookups), [monthRows, mapping, lookups]);
  const unissued = useMemo(() => unissuedSalesInvoices(monthRows), [monthRows]);
  const ready = resolved.flatMap(r => (r.status === 'ready' ? [r.row] : []));
  const unresolved = resolved.filter(r => r.status === 'unresolved');
  const warehouseTitle = (code: string | null | undefined) => (code ? warehouses.find(w => w.code === code)?.name || code : 'انبار پیش‌فرض');

  const updateMapping = (m: StockImportMapping) => { setMapping(m); saveStockMapping(m); setStale(true); };
  const reset = () => { setStep('file'); setRows([]); setMonth(''); setAccepted(new Set()); setResult(null); setStale(true); setError(''); };
  const close = () => { if (busyRef.current) return; reset(); onClose(); };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    try {
      const read = await readStockWorkbook(file);
      if (read.rows.length === 0) {
        setError('در این پرونده برگه‌ای با سرستون‌های «تاریخ»، «کد کالا»، «تعداد» و «نوع ورود»، «نوع خروج» یا «شماره فاکتور» و «مشتری» پیدا نشد.');
        return;
      }
      // suppliers and customers whose name matches one of the app exactly are offered at once
      const byName = new Map(suppliers.map(s => [nameKey(s.name), s.id]));
      const customerByName = new Map(customers.map(c => [nameKey(c.name), c.id]));
      const supplierMap = { ...mapping.suppliers };
      const customerMap = { ...(mapping.customers ?? {}) };
      for (const r of read.rows) {
        const id = r.supplierName ? byName.get(nameKey(r.supplierName)) : undefined;
        if (id && !supplierMap[r.supplierName]) supplierMap[r.supplierName] = { kind: 'supplier', partyId: id };
        const cid = r.customerName ? customerByName.get(nameKey(r.customerName)) : undefined;
        if (cid && !customerMap[r.customerName]) customerMap[r.customerName] = { kind: 'customer', partyId: cid };
      }
      updateMapping({ ...mapping, suppliers: supplierMap, customers: customerMap });
      setRows(read.rows);
      setMonth([...new Set(read.rows.map(stockRowMonth))].sort()[0] ?? '');
      setStep('names');
    } catch (err) {
      setError(errorMessageOf(err) || 'پرونده خوانده نشد.');
    }
  };

  const send = async (commit: boolean) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const res = await fetchJson<StockImportResult>('/inventory/history-import', { method: 'POST', body: JSON.stringify({ commit, rows: ready }) });
      setResult(res);
      setStale(false);
      setStep('preview');
      if (res.committed) {
        for (const key of [QUERY_KEYS.items.all, QUERY_KEYS.inventory.all, QUERY_KEYS.documents.all, QUERY_KEYS.transactions.all]) {
          void queryClient.invalidateQueries({ queryKey: key });
        }
      }
    } catch (err) {
      // a post that recorded nothing comes back refused, with every row's outcome
      if (err instanceof ApiError && err.code === 'HISTORY_IMPORT_NOT_POSTED' && err.details?.rows) {
        setResult(err.details as StockImportResult);
        setStale(false);
        setStep('preview');
      }
      setError(errorMessageOf(err) || 'سرور پاسخ نداد؛ دوباره تلاش کنید.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const canPreview = ready.length > 0 && unresolved.length === 0 && ready.length <= STOCK_IMPORT_MAX_ROWS;
  const canPost = canPreview && !stale && !!result && !result.committed && result.okCount === ready.length;
  const footer = step === 'file' ? undefined : (
    <ModalFooterActions
      onCancel={close}
      cancelText={result?.committed ? 'بستن' : 'انصراف'}
      isLoading={busy}
      onConfirm={result?.committed ? undefined : () => { void send(canPost); }}
      isDisabled={!canPreview}
      confirmText={canPost ? `ثبت نهایی ${formatPersianNumber(ready.length)} ردیف` : 'پیش‌نمایش'}
      confirmVariant={canPost ? 'success' : 'primary'}
      extraActions={step === 'preview' && !result?.committed
        ? <button type="button" className="text-xs text-indigo-700 dark:text-indigo-300" onClick={() => setStep('names')}>بازگشت به نام‌ها</button>
        : undefined}
    />
  );

  return (
    <Modal isOpen={isOpen} onClose={close} closeDisabled={busy} size="5xl" footer={footer}
      title="ورود سابقهٔ گردش انبار و فروش از اکسل"
      subtitle="برگه‌های «ورود به انبار»، «خروج دستی» و «اقلام فاکتور»؛ ماه به ماه و روز به روز"
      icon={<FileSpreadsheet className="w-5 h-5 text-emerald-600" />}>
      <div className="space-y-4">
        {error && <p role="alert" className="text-xs font-bold text-rose-600">{error}</p>}
        {step === 'file' && <OldOpeningsStep />}
        {step === 'file' && (
          <div className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
            <p>پروندهٔ اکسل اصلاح‌شدهٔ انبار را انتخاب کنید. هر ردیف همان سندی می‌شود که با دست ثبت می‌شد و سند حسابداری آن پیش‌نویس می‌ماند. موجودی اولیه با تاریخ ۱ فروردین ۱۴۰۵ ثبت می‌شود. پیش از هر ثبت، پیش‌نمایش همهٔ ردیف‌ها را امتحان می‌کند و چیزی نگه نمی‌دارد.</p>
            <p>گردش انبار و فاکتورهای فروش هر ماه با هم و پیش از دریافت و پرداخت همان ماه وارد می‌شوند. هر فاکتور اکسل یک فاکتور فروش قطعی در تاریخ خودش می‌شود و شمارهٔ اکسلش نگه داشته می‌شود؛ برگشت از فروش («مرجوعی») با «شماره فاکتور مرجع» به همان فاکتور وصل می‌شود و دریافتی که شمارهٔ فاکتور اکسل را دارد اول همان فاکتور را تسویه می‌کند. در «شماره فاکتور مرجع» هر «خرید جدید» عدد ستون «شماره مرجع-فاکتور» ردیف پرداخت همان خرید در برگهٔ «هزینه‌ها» را بنویسید (همان عددی که در آن ستون است، نه شمارهٔ سطر برگه) تا پرداختش به همین رسید بنشیند؛ اگر در چند ردیف پرداخت شده (پیش‌پرداخت و باقی، یا از دو حساب)، همهٔ این عددها را با «،» جدا کنید. خریدی که ردیفی در «هزینه‌ها» ندارد (نسیه، با چک یا از «دریافت و پرداخت») را خالی بگذارید؛ پرداختش مثل قبل از قدیمی‌ترین بدهی آن تأمین‌کننده کم می‌شود.</p>
            <input type="file" accept=".xlsx,.xls" aria-label="پرونده اکسل" onChange={e => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
        )}
        {step !== 'file' && (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-2">
              ماه
              <select aria-label="ماه" className="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1"
                value={month} onChange={e => { setMonth(e.target.value); setResult(null); setStale(true); }}>
                {months.map(m => <option key={m || 'none'} value={m}>{m ? formatPersianCode(m) : 'بی تاریخ'}</option>)}
              </select>
            </label>
            <span>{formatPersianNumber(ready.length)} ردیف آماده، {formatPersianNumber(unresolved.length)} ردیف نیازمند اصلاح، {formatPersianNumber(resolved.length - ready.length - unresolved.length)} ردیف کنار گذاشته</span>
            {ready.length > STOCK_IMPORT_MAX_ROWS && <span className="text-rose-600 font-bold">بیش از {formatPersianNumber(STOCK_IMPORT_MAX_ROWS)} ردیف؛ ماه را به دو پرونده بر پایهٔ روز تقسیم کنید (همهٔ برگه‌های روزهای اول در یکی، بقیه در دیگری).</span>}
            {result && !stale && !result.committed && (
              <span className="font-bold">{formatPersianNumber(result.okCount)} درست، {formatPersianNumber(result.errorCount)} خطا، {formatPersianNumber(result.duplicateCount)} شبیه ثبت‌های قبلی</span>
            )}
            {result?.committed && <span className="font-bold text-emerald-700">همهٔ ردیف‌های این ماه ثبت شد. سندهای حسابداری پیش‌نویس‌اند و در «اسناد حسابداری» تأیید می‌شوند.</span>}
          </div>
        )}
        {step === 'names' && (
          <StockImportNames names={names} mapping={mapping} warehouses={warehouses} suppliers={suppliers} customers={customers} onChange={updateMapping}
            unissued={unissued} included={ref => accepted.has(salesInvoiceKey(ref))}
            onInclude={(ref, on) => { setAccepted(prev => { const next = new Set(prev); if (on) next.add(salesInvoiceKey(ref)); else next.delete(salesInvoiceKey(ref)); return next; }); setStale(true); }} />
        )}
        {step === 'names' && unresolved.length > 0 && (
          <ul className="text-[11px] text-rose-600 list-disc pr-4">
            {unresolved.slice(0, 8).map(r => <li key={`${r.parsed.sheet}#${r.parsed.rowNo}`}>{r.parsed.sheet} — ردیف {formatPersianNumber(r.parsed.rowNo)}: {r.reason}</li>)}
          </ul>
        )}
        {step === 'preview' && (
          <StockImportPreview resolved={resolved} result={stale ? null : result} accepted={accepted} warehouseTitle={warehouseTitle}
            onAccept={(key, on) => { setAccepted(prev => { const next = new Set(prev); if (on) next.add(key); else next.delete(key); return next; }); setStale(true); }}
            onMapCode={(code, target) => updateMapping(remapItemCode(mapping, resolved, code, target))} />
        )}
      </div>
    </Modal>
  );
}
