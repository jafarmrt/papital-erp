import { useMemo, useRef, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, ModalFooterActions } from '../common/Modal';
import { ApiError, fetchJson } from '../../api';
import { useRialDisplay } from '../../hooks/useAppCurrency';
import { useContraAccountsQuery } from '../../hooks/accounting/useTreasuryQueries';
import { useProjectPickQuery } from '../../hooks/queries/useProjectQueries';
import { invalidateAfterTreasuryChange } from '../../hooks/accounting/accountingInvalidation';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { TREASURY_IMPORT_MAX_ROWS, type TreasuryImportResult } from '../../lib/historyImport/treasuryHistoryImport';
import {
  resolveTreasuryRow, rowKey, suggestCostCentre, suggestPartyTarget, unmappedNames,
  type ParsedTreasuryRow, type PersonnelUse, type TreasuryImportMapping,
} from '../../lib/historyImport/treasurySheet';
import { errorMessageOf, formatPersianCode, formatPersianNumber } from '../../utils';
import { TreasuryImportNames, type TreasuryImportLists } from './TreasuryImportNames';
import { TreasuryImportPreview, USE_LABEL } from './TreasuryImportPreview';
import { loadSavedMapping, monthOf, readTreasuryWorkbook, saveMapping } from './treasuryImportWorkbook';

/**
 * v11 history import, tool 1 (1405 replay): past receipts, payments, transfers and wages from the old Excel. The user picks
 * the file and a month, maps each name once, previews (the server tries every row and keeps nothing) and posts the month at
 * once; one refused row posts nothing.
 */
interface Props {
  isOpen: boolean;
  onClose: () => void;
  lists: Omit<TreasuryImportLists, 'accounts' | 'projects'>;
}

type Step = 'file' | 'names' | 'preview';

export function TreasuryHistoryImportModal({ isOpen, onClose, lists }: Props) {
  const rial = useRialDisplay();
  const queryClient = useQueryClient();
  const accountsQuery = useContraAccountsQuery(isOpen);
  const accounts = useMemo(() => (Array.isArray(accountsQuery.data) ? accountsQuery.data : []), [accountsQuery.data]);
  // tool 5: the production projects a cost centre maps to
  const projectsQuery = useProjectPickQuery();
  const projects = useMemo(() => (Array.isArray(projectsQuery.data) ? projectsQuery.data : []), [projectsQuery.data]);
  const [step, setStep] = useState<Step>('file');
  const [rows, setRows] = useState<ParsedTreasuryRow[]>([]);
  const [month, setMonth] = useState('');
  const [mapping, setMapping] = useState<TreasuryImportMapping>(loadSavedMapping);
  const [uses, setUses] = useState<Record<string, PersonnelUse>>({});
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<TreasuryImportResult | null>(null);
  const [stale, setStale] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const busyRef = useRef(false);

  const months = useMemo(() => [...new Set(rows.map(r => monthOf(r.date)))].sort(), [rows]);
  const monthRows = useMemo(() => rows.filter(r => monthOf(r.date) === month), [rows, month]);
  const accountIdOfCode = useMemo(() => {
    const byCode = new Map(accounts.map(a => [a.code, a.id]));
    return (code: string) => byCode.get(code) ?? null;
  }, [accounts]);
  const resolved = useMemo(
    () => monthRows.map(r => resolveTreasuryRow(r, mapping, { uses, accountIdOfCode, accepted })),
    [monthRows, mapping, uses, accountIdOfCode, accepted],
  );
  const allNames = useMemo(() => unmappedNames(monthRows, { ...mapping, banks: {}, parties: {}, costCentres: {} }), [monthRows, mapping]);
  const ready = resolved.flatMap(r => (r.status === 'ready' ? [r.row] : []));
  const unresolved = resolved.filter(r => r.status === 'unresolved');
  const bankTitle = (id: number) => lists.banks.find(b => b.id === id)?.title ?? `#${id}`;

  const updateMapping = (m: TreasuryImportMapping) => { setMapping(m); saveMapping(m); setStale(true); };

  const reset = () => {
    setStep('file'); setRows([]); setMonth(''); setUses({}); setAccepted(new Set()); setResult(null); setStale(true); setError('');
  };
  const close = () => { if (busyRef.current) return; reset(); onClose(); };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    try {
      const read = await readTreasuryWorkbook(file);
      if (read.rows.length === 0) {
        setError('در این پرونده برگه‌ای با سرستون‌های «تاریخ»، «نوع» یا «نوع هزینه»، «حساب نقد و بانک»، «طرف حساب» و «مبلغ» پیدا نشد.');
        return;
      }
      // names that match a party, colleague or account of the app exactly are offered at once
      const parties = { ...mapping.parties };
      for (const r of read.rows) {
        if (!r.partyName || parties[r.partyName]) continue;
        const suggested = suggestPartyTarget(r.partyName, {
          parties: lists.customers.map(c => ({ id: c.id, name: c.name, type: c.partyType ?? c.party_type ?? 'customer' })),
          personnel: lists.personnel.map(p => ({ id: p.id, name: p.fullName })),
          banks: lists.banks.map(b => ({ id: b.id, title: b.title })),
        });
        if (suggested) parties[r.partyName] = suggested;
      }
      const banks = { ...mapping.banks };
      for (const r of read.rows) {
        const bank = lists.banks.find(b => b.title.trim() === r.bankName);
        if (r.bankName && !banks[r.bankName] && bank) banks[r.bankName] = { kind: 'bank', bankAccountId: bank.id };
      }
      // tool 5: a general cost centre is offered as «بدون پروژه», a project's code or title as that project
      const costCentres = { ...(mapping.costCentres ?? {}) };
      for (const r of read.rows) {
        const centre = r.costCenter.trim();
        if (!centre || costCentres[centre]) continue;
        const suggested = suggestCostCentre(centre, projects.map(p => ({ id: p.id, projectCode: p.projectCode || p.project_code, title: p.title })));
        if (suggested) costCentres[centre] = suggested;
      }
      updateMapping({ ...mapping, parties, banks, costCentres });
      setRows(read.rows);
      const first = [...new Set(read.rows.map(r => monthOf(r.date)))].sort()[0] ?? '';
      setMonth(first);
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
      const res = await fetchJson<TreasuryImportResult>('/accounting/treasury/history-import', { method: 'POST', body: JSON.stringify({ commit, rows: ready }) });
      setResult(res);
      setStale(false);
      setStep('preview');
      if (res.committed) {
        void invalidateAfterTreasuryChange(queryClient);
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.documents.all });
      }
    } catch (err) {
      // a post that recorded nothing comes back refused, with every row's outcome
      if (err instanceof ApiError && err.code === 'HISTORY_IMPORT_NOT_POSTED' && err.details?.rows) {
        setResult(err.details as TreasuryImportResult);
        setStale(false);
        setStep('preview');
      }
      setError(errorMessageOf(err) || 'سرور پاسخ نداد؛ دوباره تلاش کنید.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const canPreview = ready.length > 0 && unresolved.length === 0 && ready.length <= TREASURY_IMPORT_MAX_ROWS;
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
      title="ورود سابقهٔ دریافت و پرداخت از اکسل"
      subtitle="برگه‌های «دریافت و پرداخت» و «هزینه‌ها»؛ ماه به ماه و به ترتیب تاریخ"
      icon={<FileSpreadsheet className="w-5 h-5 text-emerald-600" />}>
      <div className="space-y-4">
        {error && <p role="alert" className="text-xs font-bold text-rose-600">{error}</p>}
        {step === 'file' && (
          <div className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
            <p>پرونده اکسل را انتخاب کنید. هر ردیف همان سندی می‌شود که با دست ثبت می‌شد و سند حسابداری آن پیش‌نویس می‌ماند. پیش از هر ثبت، پیش‌نمایش همه ردیف‌ها را امتحان می‌کند و چیزی نگه نمی‌دارد.</p>
            <p>دریافت و پرداخت هر ماه را پس از ورود انبار و فاکتورهای فروش همان ماه وارد کنید، و حقوق را پس از صدور و تأیید فیش‌های آن ماه.</p>
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
            <span>{formatPersianNumber(ready.length)} ردیف آماده، {formatPersianNumber(unresolved.length)} ردیف بی نگاشت، {formatPersianNumber(resolved.length - ready.length - unresolved.length)} ردیف کنار گذاشته</span>
            {ready.length > TREASURY_IMPORT_MAX_ROWS && <span className="text-rose-600 font-bold">بیش از {formatPersianNumber(TREASURY_IMPORT_MAX_ROWS)} ردیف؛ پرونده را کوچک‌تر کنید.</span>}
            {result && !stale && !result.committed && (
              <span className="font-bold">{formatPersianNumber(result.okCount)} درست، {formatPersianNumber(result.errorCount)} خطا، {formatPersianNumber(result.duplicateCount)} شبیه ثبت‌های قبلی</span>
            )}
            {result?.committed && <span className="font-bold text-emerald-700">همه ردیف‌های این ماه ثبت شد. سندهای حسابداری پیش‌نویس‌اند و در «اسناد حسابداری» تأیید می‌شوند.</span>}
          </div>
        )}
        {step === 'names' && (
          <TreasuryImportNames names={allNames} mapping={mapping} lists={{ ...lists, accounts, projects }} onChange={updateMapping} />
        )}
        {step === 'names' && unresolved.length > 0 && (
          <ul className="text-[11px] text-rose-600 list-disc pr-4">
            {unresolved.filter(r => r.status !== 'unresolved' || !r.personnel).slice(0, 5).map(r => <li key={`${r.parsed.sheet}#${r.parsed.rowNo}`}>{r.parsed.sheet} — ردیف {formatPersianNumber(r.parsed.rowNo)}: {r.reason}</li>)}
          </ul>
        )}
        {/* a colleague row held back for its use: its use is chosen here, since the preview opens only when no row waits */}
        {step === 'names' && unresolved.some(r => r.status === 'unresolved' && r.personnel) && (
          <div className="space-y-1">
            <p className="text-[11px] text-slate-600 dark:text-slate-300">ردیف‌های همکار با «پرداخت دیگر» حساب مقابل خودشان را می‌خواهند؛ کاربرد هر ردیف را انتخاب کنید یا «کد حساب مقابل» آن را در اکسل بنویسید:</p>
            {unresolved.filter(r => r.status === 'unresolved' && r.personnel).map(r => {
              const key = rowKey(r.parsed);
              return (
                <label key={key} className="flex flex-wrap items-center gap-2 text-[11px] text-slate-700 dark:text-slate-200">
                  <span>{r.parsed.sheet} — ردیف {formatPersianNumber(r.parsed.rowNo)} — {r.parsed.partyName} — {r.parsed.description}</span>
                  <select aria-label={`کاربرد ردیف ${formatPersianNumber(r.parsed.rowNo)}`} className="rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-[11px]"
                    value={uses[key] ?? 'other'} onChange={e => { setUses(u => ({ ...u, [key]: e.target.value as PersonnelUse })); setStale(true); }}>
                    {(Object.keys(USE_LABEL) as PersonnelUse[]).map(u => <option key={u} value={u}>{USE_LABEL[u]}</option>)}
                  </select>
                </label>
              );
            })}
          </div>
        )}
        {step === 'preview' && (
          <TreasuryImportPreview resolved={resolved} result={stale ? null : result} uses={uses} accepted={accepted}
            bankTitle={bankTitle} amountText={a => rial.amount(a)}
            onUse={(key, use) => { setUses(u => ({ ...u, [key]: use })); setStale(true); }}
            onAccept={(key, on) => { setAccepted(prev => { const next = new Set(prev); if (on) next.add(key); else next.delete(key); return next; }); setStale(true); }} />
        )}
      </div>
    </Modal>
  );
}

