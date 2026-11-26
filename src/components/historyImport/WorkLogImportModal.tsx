import { useMemo, useRef, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, ModalFooterActions } from '../common/Modal';
import { ApiError, fetchJson } from '../../api';
import { useRialDisplay } from '../../hooks/useAppCurrency';
import { usePersonnelListQuery } from '../../hooks/queries/usePersonnelQueries';
import { useProjectPickQuery } from '../../hooks/queries/useProjectQueries';
import { usePieceworkTasksQuery } from '../../hooks/queries/usePieceworkQueries';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { WORK_LOG_IMPORT_MAX_ROWS, type WorkLogImportResult } from '../../lib/historyImport/workLogImport';
import {
  monthOfRow, resolveWorkLogRow, suggestWorkLogMapping, unmappedWorkLogNames,
  type ParsedWorkLogRow, type WorkLogImportMapping, type WorkLogLookups,
} from '../../lib/historyImport/workLogSheet';
import { errorMessageOf, formatPersianNumber, getTodayJalaliDate, toPersianDigits } from '../../utils';
import { toLatinDigits } from '../../lib/numericInput';
import { WorkLogImportNames } from './WorkLogImportNames';
import { WorkLogImportPreview, jalaliMonthLabelOf } from './WorkLogImportPreview';
import { loadSavedWorkLogMapping, readWorkLogWorkbook, saveWorkLogMapping } from './workLogImportWorkbook';

/**
 * v12 work-log import (start plan V12_WORKLOG_IMPORT_START_PLAN.md): the colleagues' work of the sheet «کارکرد و پروژه» at
 * once, for the 1405 history and then for any month. The user picks the file, the year and a month (or every month), maps
 * each name once, previews (the server tries every row through the hand entry and keeps nothing) and posts at once; one
 * refused row posts nothing. Each row becomes a free work log on the month's last day, taken by that month's payslip.
 */
interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type Step = 'file' | 'names' | 'preview';
const ALL_MONTHS = 'all';
const NO_ROWS: never[] = [];

export function WorkLogImportModal({ isOpen, onClose }: Props) {
  const rial = useRialDisplay();
  const queryClient = useQueryClient();
  const personnelQuery = usePersonnelListQuery();
  const tasksQuery = usePieceworkTasksQuery('active');
  const projectsQuery = useProjectPickQuery();
  const lookups: WorkLogLookups = useMemo(() => ({
    personnel: (Array.isArray(personnelQuery.data) ? personnelQuery.data : NO_ROWS).map(p => ({ id: p.id, fullName: p.fullName ?? '' })),
    tasks: (Array.isArray(tasksQuery.data) ? tasksQuery.data : NO_ROWS).map(t => ({ id: t.id, title: t.title, unit: t.unit })),
    projects: (Array.isArray(projectsQuery.data) ? projectsQuery.data : NO_ROWS).map(p => ({ id: p.id, title: p.title, projectCode: p.projectCode || p.project_code })),
  }), [personnelQuery.data, tasksQuery.data, projectsQuery.data]);

  const thisYear = Number(toLatinDigits(getTodayJalaliDate()).slice(0, 4));
  const [step, setStep] = useState<Step>('file');
  const [rows, setRows] = useState<ParsedWorkLogRow[]>([]);
  const [year, setYear] = useState(thisYear);
  const [month, setMonth] = useState(ALL_MONTHS);
  const [mapping, setMapping] = useState<WorkLogImportMapping>(loadSavedWorkLogMapping);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<WorkLogImportResult | null>(null);
  const [stale, setStale] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const busyRef = useRef(false);

  const months = useMemo(() => [...new Set(rows.map(r => monthOfRow(r.monthText, year)).filter(Boolean))].sort(), [rows, year]);
  const monthRows = useMemo(() => (month === ALL_MONTHS ? rows : rows.filter(r => monthOfRow(r.monthText, year) === month)), [rows, month, year]);
  const resolved = useMemo(
    () => monthRows.map(r => resolveWorkLogRow(r, mapping, { year, lookups, accepted })),
    [monthRows, mapping, year, lookups, accepted],
  );
  const names = useMemo(() => unmappedWorkLogNames(monthRows, mapping), [monthRows, mapping]);
  const ready = resolved.flatMap(r => (r.status === 'ready' ? [r.row] : []));
  const unresolved = resolved.filter(r => r.status === 'unresolved');
  const skippedCount = resolved.filter(r => r.status === 'skipped').length;

  const personName = (id: number) => lookups.personnel.find(p => p.id === id)?.fullName ?? `#${toPersianDigits(String(id))}`;
  const taskTitle = (id: number) => lookups.tasks.find(t => t.id === id)?.title ?? `#${toPersianDigits(String(id))}`;
  const projectTitle = (id: number | null) => (id === null ? 'بدون پروژه' : lookups.projects.find(p => p.id === id)?.title ?? `#${toPersianDigits(String(id))}`);

  const changed = () => { setResult(null); setStale(true); };
  const updateMapping = (m: WorkLogImportMapping) => { setMapping(m); saveWorkLogMapping(m); changed(); };
  const reset = () => {
    setStep('file'); setRows([]); setMonth(ALL_MONTHS); setAccepted(new Set()); setResult(null); setStale(true); setError('');
  };
  const close = () => { if (busyRef.current) return; reset(); onClose(); };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    try {
      const read = await readWorkLogWorkbook(file);
      if (read.rows.length === 0) {
        setError('در این پرونده برگه‌ای با سرستون‌های «ماه»، «همکار»، «شرح فعالیت»، «فی» و «پروژه» پیدا نشد.');
        return;
      }
      updateMapping(suggestWorkLogMapping(read.rows, mapping, lookups));
      setRows(read.rows);
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
      const res = await fetchJson<WorkLogImportResult>('/piecework/logs/history-import', { method: 'POST', body: JSON.stringify({ commit, rows: ready }) });
      setResult(res);
      setStale(false);
      setStep('preview');
      if (res.committed) void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.piecework.all });
    } catch (err) {
      // a post that recorded nothing comes back refused, with every row's outcome
      if (err instanceof ApiError && err.code === 'HISTORY_IMPORT_NOT_POSTED' && err.details?.rows) {
        setResult(err.details as WorkLogImportResult);
        setStale(false);
        setStep('preview');
      }
      setError(errorMessageOf(err) || 'سرور پاسخ نداد؛ دوباره تلاش کنید.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const canPreview = ready.length > 0 && unresolved.length === 0 && ready.length <= WORK_LOG_IMPORT_MAX_ROWS;
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
      title="ورود کارکرد پرسنل از اکسل"
      subtitle="برگهٔ «کارکرد و پروژه»؛ هر ردیف کارکرد آزادِ روز آخر ماه می‌شود و فیش همان ماه آن را می‌گیرد"
      icon={<FileSpreadsheet className="w-5 h-5 text-emerald-600" />}>
      <div className="space-y-4">
        {error && <p role="alert" className="text-xs font-bold text-rose-600">{error}</p>}
        {step === 'file' && (
          <div className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
            <p>پرونده اکسل را انتخاب کنید. هر ردیف از همان سنجش‌های فرم «ثبت کارکرد» می‌گذرد و با «فی» اکسل ثبت می‌شود. پیش از ثبت، پیش‌نمایش همه ردیف‌ها را امتحان می‌کند و چیزی نگه نمی‌دارد.</p>
            <p>ردیف‌های حقوق ثابت و عیدی کارکرد نیستند و کنار گذاشته می‌شوند. کارکرد ماهی که فیش حقوقش صادر شده رد می‌شود.</p>
            <input type="file" accept=".xlsx,.xls" aria-label="پرونده اکسل" onChange={e => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
        )}
        {step !== 'file' && (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-2">
              سال
              <select aria-label="سال" className="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1"
                value={year} onChange={e => { setYear(Number(e.target.value)); setMonth(ALL_MONTHS); changed(); }}>
                {[thisYear - 1, thisYear].map(y => <option key={y} value={y}>{toPersianDigits(String(y))}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2">
              ماه
              <select aria-label="ماه" className="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1"
                value={month} onChange={e => { setMonth(e.target.value); changed(); }}>
                <option value={ALL_MONTHS}>همه ماه‌ها</option>
                {months.map(m => <option key={m} value={m}>{jalaliMonthLabelOf(m)}</option>)}
              </select>
            </label>
            <span>{formatPersianNumber(ready.length)} ردیف آماده، {formatPersianNumber(unresolved.length)} ردیف بی نگاشت، {formatPersianNumber(skippedCount)} ردیف کنار گذاشته</span>
            {ready.length > WORK_LOG_IMPORT_MAX_ROWS && <span className="text-rose-600 font-bold">بیش از {formatPersianNumber(WORK_LOG_IMPORT_MAX_ROWS)} ردیف؛ یک ماه را انتخاب کنید.</span>}
            {result && !stale && !result.committed && (
              <span className="font-bold">{formatPersianNumber(result.okCount)} درست، {formatPersianNumber(result.errorCount)} خطا، {formatPersianNumber(result.duplicateCount)} شبیه ثبت‌های قبلی</span>
            )}
            {result?.committed && <span className="font-bold text-emerald-700">همه ردیف‌ها ثبت شد. کارکردها آزادند و فیش حقوق هر ماه آن‌ها را می‌گیرد.</span>}
          </div>
        )}
        {step === 'names' && <WorkLogImportNames names={names} mapping={mapping} lookups={lookups} onChange={updateMapping} />}
        {step === 'names' && unresolved.length > 0 && (
          <ul className="text-[11px] text-rose-600 list-disc pr-4">
            {unresolved.slice(0, 5).map(r => <li key={r.parsed.rowNo}>ردیف {formatPersianNumber(r.parsed.rowNo)}: {r.status === 'unresolved' ? r.reason : ''}</li>)}
          </ul>
        )}
        {step === 'preview' && (
          <WorkLogImportPreview resolved={resolved} result={stale ? null : result} accepted={accepted}
            personName={personName} taskTitle={taskTitle} projectTitle={projectTitle} amountText={a => rial.amount(a)}
            onAccept={(key, on) => { setAccepted(prev => { const next = new Set(prev); if (on) next.add(key); else next.delete(key); return next; }); setStale(true); }} />
        )}
      </div>
    </Modal>
  );
}
