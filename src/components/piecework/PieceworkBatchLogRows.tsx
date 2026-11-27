import React, { useEffect, useEffectEvent, useRef } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { PieceworkTask } from '../../types';
import type { BatchLogRow } from '../../hooks/usePiecework';
import { SearchableSelect } from '../SearchableSelect';
import { FinancialAmountInput } from '../common/FinancialAmountInput';
import { useRialDisplay } from '../../hooks/useAppCurrency';
import { formatCurrencyLabel, formatPersianNumber, formatQuantityOrTime, parseQuantityOrTime } from '../../utils';
import { PHONE_TAP_TARGET } from '../../lib/pwa/phoneLayout';
import { rowKeyOf } from '../../lib/rowKey';
import { ADD_ROW_SHORTCUT_TITLE, isAddRowShortcut } from '../../lib/addRowShortcut';

/** Texts the tests read */
export const BATCH_LOG_TEXT = {
  addRow: 'افزودن ردیف کاری',
  shortcut: ADD_ROW_SHORTCUT_TITLE,
  total: 'جمع این کارکردها',
} as const;

/**
 * The rows' total while they are typed: the amount, and the quantity of each unit (hours as hours and minutes), over the
 * rows with a task and a quantity above zero (the rows the form sends). A display only; the server sums the logs.
 */
export function batchLogTotals(rows: readonly BatchLogRow[], tasks: readonly Pick<PieceworkTask, 'id' | 'unit'>[]) {
  const quantities = new Map<string, number>();
  let amount = 0;
  let count = 0;
  for (const row of rows) {
    const quantity = parseQuantityOrTime(row.quantity);
    if (!row.taskId || !(quantity > 0)) continue;
    const unit = tasks.find(t => t.id === Number(row.taskId))?.unit || 'عدد';
    quantities.set(unit, (quantities.get(unit) ?? 0) + quantity);
    amount += quantity * (Number(row.unitRate) || 0);
    count += 1;
  }
  return { count, amount, quantities: [...quantities.entries()].map(([unit, quantity]) => ({ unit, quantity })) };
}

interface Props {
  fieldId: string;
  rows: BatchLogRow[];
  setRows: React.Dispatch<React.SetStateAction<BatchLogRow[]>>;
  tasksList: PieceworkTask[];
  projectSelectOptions: { value: string; label: string }[];
  taskSelectOptions: { value: string; label: string }[];
  onTaskChangeInRow: (idx: number, taskId: number | '') => void;
  onAddLogRow: () => void;
  onRemoveLogRow: (idx: number) => void;
  canSetRate: boolean;
  /** shortcuts listen only while the window is open and nothing is being saved */
  active: boolean;
}

/**
 * v12 (start plan V12_WORKLOG_IMPORT_START_PLAN.md part B): the rows of «ثبت گروهی کارکرد روزانه پرسنل». One line per row on a
 * wide screen (task, project, quantity, rate, amount) so nothing scrolls sideways, Alt+N or Insert for a new row with the
 * focus on its task, and the total under the rows while they are typed.
 */
export function PieceworkBatchLogRows({ fieldId, rows, setRows, tasksList, projectSelectOptions, taskSelectOptions, onTaskChangeInRow, onAddLogRow, onRemoveLogRow, canSetRate, active }: Props) {
  const rial = useRialDisplay();
  const inputCurLbl = formatCurrencyLabel('IRR');
  const focusRow = useRef<number | null>(null);
  const addRow = () => {
    focusRow.current = rows.length;
    onAddLogRow();
  };
  useEffect(() => {
    if (focusRow.current === null || focusRow.current >= rows.length) return;
    document.getElementById(`${fieldId}-task-id-${focusRow.current}`)?.focus();
    focusRow.current = null;
  }, [rows.length, fieldId]);
  const onShortcutKey = useEffectEvent((e: KeyboardEvent) => {
    if (!isAddRowShortcut(e)) return;
    e.preventDefault();
    addRow();
  });
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => onShortcutKey(e);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active]);

  const setRow = (idx: number, patch: Partial<BatchLogRow>) => setRows(prev => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const totals = batchLogTotals(rows, tasksList);
  // one line per row from a laptop width up; a phone or a tablet keeps the fields one under another
  const ROW_GRID = 'flex flex-col gap-2 lg:grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1.3fr)_8rem_9rem_8rem_2.5rem] lg:items-end';

  return (
    <div className="border border-slate-200 rounded-2xl overflow-hidden">
      <div className="p-3 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-700 flex items-center justify-between">
        <span>عناوین و مقادیر کارهای انجام شده</span>
        <button type="button" onClick={addRow} title={BATCH_LOG_TEXT.shortcut}
          className="min-h-11 sm:min-h-0 flex items-center gap-1 text-blue-600 hover:text-blue-700 text-xs font-bold cursor-pointer">
          <Plus className="w-4 h-4" />
          <span>{BATCH_LOG_TEXT.addRow}</span>
          <span className="hidden sm:inline text-[10px] font-bold text-slate-400" dir="ltr">(Alt+N)</span>
        </button>
      </div>

      <div className="p-3 space-y-2 sm:max-h-[55vh] sm:overflow-y-auto">
        {rows.map((row, idx) => {
          const taskObj = tasksList.find(t => t.id === Number(row.taskId));
          const isHour = taskObj?.unit === 'ساعت';
          const parsedQty = parseQuantityOrTime(row.quantity);
          const rowTotal = parsedQty * (Number(row.unitRate) || 0);
          return (
            <div key={rowKeyOf(row, idx)} className={`${ROW_GRID} bg-slate-50/60 p-3 rounded-xl border border-slate-200/60`}>
              <div className="min-w-0">
                <label htmlFor={`${fieldId}-task-id-${idx}`} className="block text-[10px] font-bold text-slate-500 mb-1">عنوان کاری *</label>
                <SearchableSelect id={`${fieldId}-task-id-${idx}`} options={taskSelectOptions} value={row.taskId ? String(row.taskId) : ''}
                  onChange={(val) => onTaskChangeInRow(idx, val ? Number(val) : '')} placeholder="جست‌وجو و انتخاب عنوان کاری..." maxResults={100} className="w-full text-xs font-bold" />
              </div>
              <div className="min-w-0">
                <label htmlFor={`${fieldId}-project-id-2-${idx}`} className="block text-[10px] font-bold text-slate-500 mb-1">پروژه مربوطه</label>
                <SearchableSelect id={`${fieldId}-project-id-2-${idx}`} options={projectSelectOptions} value={row.projectId ? String(row.projectId) : ''}
                  onChange={(val) => setRow(idx, { projectId: val ? Number(val) : '' })} placeholder="بدون پروژه / انتخاب..." maxResults={50} className="w-full text-xs font-bold" />
              </div>
              <div>
                <label htmlFor={`piecework-row-quantity-${idx}`} className="block text-[10px] font-bold text-slate-500 mb-1">
                  {isHour ? 'کارکرد (28:23 یا اعشار)' : `تعداد / مقدار (${taskObj?.unit || 'عدد'})`}
                </label>
                <input id={`piecework-row-quantity-${idx}`} type="text" inputMode={isHour ? 'text' : 'decimal'} placeholder={isHour ? '28:23 یا 28.5' : '1'}
                  value={row.quantity} onChange={(e) => setRow(idx, { quantity: e.target.value })}
                  className={`w-full ${PHONE_TAP_TARGET} sm:min-h-0 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-base sm:text-xs font-bold text-slate-800 text-center font-mono`} />
                {isHour && row.quantity && (
                  <span className="block text-[9px] text-blue-700 font-bold mt-0.5 text-center">{formatQuantityOrTime(parsedQty, 'ساعت')}</span>
                )}
              </div>
              <div>
                <label htmlFor={`${fieldId}-unit-rate-2-${idx}`} className="block text-[10px] font-bold text-slate-500 mb-1">{`نرخ واحد (${inputCurLbl})`}</label>
                <FinancialAmountInput id={`${fieldId}-unit-rate-2-${idx}`} value={row.unitRate}
                  onChange={(val) => setRow(idx, { unitRate: val, rateEdited: true })} readOnly={!canSetRate} currency="IRR" variant="table" placeholder="۰"
                  className="w-full" containerClassName="w-full bg-white border border-slate-200 rounded-lg" inputClassName="px-2.5 py-1.5 text-xs font-bold text-slate-800 text-center font-mono" />
              </div>
              <div className="text-left font-mono font-bold text-xs text-blue-700 whitespace-nowrap lg:pb-2">
                {rowTotal > 0 ? rial.amount(rowTotal) : ''}
              </div>
              <div className="flex justify-end">
                {rows.length > 1 && (
                  <button type="button" onClick={() => onRemoveLogRow(idx)} aria-label="حذف ردیف" className="p-2.5 sm:p-1.5 text-red-500 hover:bg-red-50 rounded-lg shrink-0 cursor-pointer">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div role="status" aria-label={BATCH_LOG_TEXT.total} className="px-3 py-2.5 bg-blue-50/70 border-t border-blue-100 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-700">
        <span>{BATCH_LOG_TEXT.total}: {formatPersianNumber(totals.count)} ردیف
          {totals.quantities.map(q => <span key={q.unit} className="mr-2 text-slate-500">{q.unit === 'ساعت' ? formatQuantityOrTime(q.quantity, 'ساعت') : `${formatPersianNumber(q.quantity, 4)} ${q.unit}`}</span>)}
        </span>
        <span className="font-mono text-blue-800 text-sm">{rial.amount(totals.amount)}</span>
      </div>
    </div>
  );
}
