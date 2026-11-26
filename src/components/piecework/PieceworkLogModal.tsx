import React, { FormEvent, useId } from 'react';
import { Calculator, X, FolderKanban } from 'lucide-react';
import { PieceworkTask } from '../../types';
import { SearchableSelect } from '../SearchableSelect';
import { BatchLogRow } from '../../hooks/usePiecework';
import { formatQuantityOrTime, parseQuantityOrTime, formatCurrencyLabel, isoToJalaliDate } from '../../utils';
import { JalaliDateInput } from '../common/JalaliDateInput';
import { FinancialAmountInput } from '../common/FinancialAmountInput';
import { useOnlineStatus } from '../../lib/pwa/useOnlineStatus';
import { OFFLINE_SUBMIT_TITLE, PHONE_SHEET_FOOTER_SAFE_AREA, PHONE_SHEET_OVERLAY, PHONE_SHEET_PANEL, PHONE_TAP_TARGET } from '../../lib/pwa/phoneLayout';
import { DialogLayer } from '../common/DialogLayer';
import { PieceworkBatchLogRows } from './PieceworkBatchLogRows';
import type { EditingWorkLog } from '../../hooks/usePiecework';

interface PieceworkLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
  editingLog: EditingWorkLog | null;
  setEditingLog: React.Dispatch<React.SetStateAction<EditingWorkLog | null>>;
  selectedPersonnelForLog: number | '';
  setSelectedPersonnelForLog: (id: number | '') => void;
  defaultBatchProjectId: number | '';
  setDefaultBatchProjectId: (id: number | '') => void;
  logDate: string;
  setLogDate: (d: string) => void;
  batchLogRows: BatchLogRow[];
  setBatchLogRows: React.Dispatch<React.SetStateAction<BatchLogRow[]>>;
  tasksList: PieceworkTask[];
  personnelSelectOptions: { value: string; label: string }[];
  projectSelectOptions: { value: string; label: string }[];
  taskSelectOptions: { value: string; label: string }[];
  onTaskChangeInRow: (idx: number, taskId: number | '') => void;
  onAddLogRow: () => void;
  onRemoveLogRow: (idx: number) => void;
  isSaving?: boolean;
  /** حوزه H (TD-300): بی مجوز مدیر پرسنل/تعرفه، نرخ از سرور است و فیلد فقط نمایش */
  canSetRate?: boolean;
}

/** v12 (part B): what the edit form says when the task title changed and the rate was not typed */
export const EDIT_TASK_RATE_NOTE = 'نرخ عنوان تازه را برنامه می‌گذارد (نرخ اختصاصی همین همکار، وگرنه نرخ پایهٔ عنوان)؛ برای نرخ دیگر آن را بنویسید.';

export function PieceworkLogModal({
  isOpen,
  onClose,
  onSubmit,
  editingLog,
  setEditingLog,
  selectedPersonnelForLog,
  setSelectedPersonnelForLog,
  defaultBatchProjectId,
  setDefaultBatchProjectId,
  logDate,
  setLogDate,
  batchLogRows,
  setBatchLogRows,
  tasksList,
  personnelSelectOptions,
  projectSelectOptions,
  taskSelectOptions,
  onTaskChangeInRow,
  onAddLogRow,
  onRemoveLogRow,
  isSaving = false,
  canSetRate = true
}: PieceworkLogModalProps) {
  const fieldId = useId();
  // ورودی نرخ همیشه به ریال است (مبلغ ذخیره‌شده)
  const inputCurLbl = formatCurrencyLabel('IRR');
  // v10.0.20 (D-11): بی اتصال کارکرد ذخیره نمی‌شود (ت۱۰ الف)
  const online = useOnlineStatus();
  if (!isOpen) return null;
  const title = editingLog ? 'ویرایش ردیف کارکرد' : 'ثبت گروهی کارکرد روزانه پرسنل';

  return (
    <div className={PHONE_SHEET_OVERLAY}>
      {/* v10.0.20 (D-11): روی گوشی تمام‌صفحه؛ سرصفحه و دکمه‌ها ثابت و میانه پنجره پیمایش می‌شود */}
      <div role="dialog" aria-modal="true" aria-label={title} className={`${PHONE_SHEET_PANEL} bg-white sm:border border-slate-200 shadow-2xl sm:max-w-6xl overflow-hidden animate-in fade-in zoom-in duration-200`}>
        <DialogLayer onClose={onClose} disabled={isSaving} />
        {/* Header */}
        <div className="shrink-0 p-4 sm:p-5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
            <Calculator className="w-4 h-4 text-blue-600" />
            <span>{title}</span>
          </h2>
          <button type="button" onClick={onClose} aria-label="بستن" className="p-2.5 sm:p-1.5 hover:bg-slate-200 text-slate-500 rounded-full cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={onSubmit} className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-5">
            {editingLog ? (
              // Single Edit Mode
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor={`${fieldId}-personnel-name`} className="block text-xs font-bold text-slate-700 mb-1">پرسنل</label>
                    <input
                      id={`${fieldId}-personnel-name`}
                      type="text"
                      disabled
                      value={editingLog.personnelName || ''}
                      className="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-600"
                    />
                  </div>
                  <div>
                    <label htmlFor={`${fieldId}-date`} className="block text-xs font-bold text-slate-700 mb-1">تاریخ</label>
                    <JalaliDateInput
                      id={`${fieldId}-date`}
                      value={editingLog.date}
                      onChange={iso => setEditingLog(prev => prev ? { ...prev, date: isoToJalaliDate(iso) } : null)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor={`${fieldId}-project-id`} className="block text-xs font-bold text-slate-700 mb-1">پروژه تولیدی مربوطه</label>
                  <SearchableSelect
                    id={`${fieldId}-project-id`}
                    options={projectSelectOptions}
                    value={editingLog.projectId ? String(editingLog.projectId) : ''}
                    onChange={(val) => setEditingLog(prev => prev ? { ...prev, projectId: val ? Number(val) : null } : null)}
                    placeholder="جست‌وجو و انتخاب پروژه تولیدی (اختیاری)..."
                    maxResults={50}
                    className="w-full text-xs font-bold"
                  />
                </div>

                <div>
                  <label htmlFor={`${fieldId}-edit-task-id`} className="block text-xs font-bold text-slate-700 mb-1">عنوان کاری</label>
                  <SearchableSelect
                    id={`${fieldId}-edit-task-id`}
                    options={taskSelectOptions}
                    value={editingLog.taskId ? String(editingLog.taskId) : ''}
                    onChange={(val) => {
                      // v12 (part B): another task title; its rate is the program's for it (the server decides) unless typed
                      const task = tasksList.find(t => t.id === Number(val));
                      if (!task) return;
                      setEditingLog(prev => prev ? { ...prev, taskId: task.id, taskTitle: task.title, unit: task.unit, unitRate: Number(task.defaultRate) || 0, rateEdited: false } : null);
                    }}
                    placeholder="جست‌وجو و انتخاب عنوان کاری..."
                    maxResults={100}
                    className="w-full text-xs font-bold"
                  />
                  {editingLog.originalTaskId !== undefined && editingLog.taskId !== editingLog.originalTaskId && !editingLog.rateEdited && (
                    <p className="text-[11px] text-blue-700 font-bold mt-1">{EDIT_TASK_RATE_NOTE}</p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="piecework-edit-quantity" className="block text-xs font-bold text-slate-700 mb-1">
                      تعداد / کارکرد ({editingLog.unit || 'عدد'})
                    </label>
                    <input
                      id="piecework-edit-quantity"
                      type="text"
                      inputMode={editingLog.unit === 'ساعت' ? 'text' : 'decimal'}
                      placeholder={editingLog.unit === 'ساعت' ? 'مثال: 28:23 یا 28.5' : 'مقدار...'}
                      value={editingLog.quantity}
                      onChange={(e) => setEditingLog(prev => prev ? { ...prev, quantity: e.target.value as any } : null)}
                      className={`w-full ${PHONE_TAP_TARGET} px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-base sm:text-xs font-bold text-slate-800 font-mono`}
                    />
                    {editingLog.unit === 'ساعت' && (
                      <p className="text-[11px] text-blue-700 font-bold mt-1">
                        محاسبه: {formatQuantityOrTime(parseQuantityOrTime(editingLog.quantity), 'ساعت')}
                      </p>
                    )}
                  </div>
                  <div>
                    <label htmlFor={`${fieldId}-unit-rate`} className="block text-xs font-bold text-slate-700 mb-1">{`نرخ واحد (${inputCurLbl})`}</label>
                    <FinancialAmountInput
                      id={`${fieldId}-unit-rate`}
                      value={editingLog.unitRate}
                      onChange={(val) => setEditingLog(prev => prev ? { ...prev, unitRate: val, rateEdited: true } : null)}
                      currency="IRR"
                      variant="compact"
                      showWordsBadge={false}
                      className="w-full"
                      containerClassName="w-full bg-slate-50 border border-slate-200 rounded-xl"
                      inputClassName="px-3 py-2 text-xs font-bold text-slate-800 font-mono"
                    />
                  </div>
                </div>
              </div>
            ) : (
              // Batch Create Mode
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor={`${fieldId}-selected-personnel-for-log`} className="block text-xs font-bold text-slate-700 mb-1">انتخاب پرسنل *</label>
                    <SearchableSelect
                      id={`${fieldId}-selected-personnel-for-log`}
                      options={personnelSelectOptions}
                      value={selectedPersonnelForLog ? String(selectedPersonnelForLog) : ''}
                      onChange={(val) => setSelectedPersonnelForLog(val ? Number(val) : '')}
                      placeholder="جست‌وجو و انتخاب پرسنل..."
                      maxResults={50}
                      className="w-full text-xs font-bold"
                    />
                  </div>

                  <div>
                    <label htmlFor={`${fieldId}-log-date`} className="block text-xs font-bold text-slate-700 mb-1">تاریخ کارکرد *</label>
                    <JalaliDateInput
                      id={`${fieldId}-log-date`}
                      value={logDate}
                      onChange={iso => setLogDate(isoToJalaliDate(iso))}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 font-mono outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                {/* Preset Project Selector */}
                <div className="bg-indigo-50/60 p-3 rounded-xl border border-indigo-100 flex flex-col sm:flex-row items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-900">
                    <FolderKanban className="w-4 h-4 text-indigo-600 shrink-0" />
                    <span>پروژه کارگاهی پیش‌فرض (اعمال به تمام ردیف‌ها):</span>
                  </div>
                  <div className="w-full sm:w-80">
                    <SearchableSelect
                      options={projectSelectOptions}
                      value={defaultBatchProjectId ? String(defaultBatchProjectId) : ''}
                      onChange={(val) => {
                        const pId = val ? Number(val) : '';
                        setDefaultBatchProjectId(pId);
                        setBatchLogRows(prev => prev.map(r => ({ ...r, projectId: pId })));
                      }}
                      placeholder="تعیین پروژه برای تمام ردیف‌ها..."
                      maxResults={50}
                      className="w-full text-xs font-bold"
                    />
                  </div>
                </div>

                {/* v12 (part B): one line per row on a wide screen, Alt+N or Insert for a new row, the total under the rows */}
                <PieceworkBatchLogRows
                  fieldId={fieldId} rows={batchLogRows} setRows={setBatchLogRows} tasksList={tasksList}
                  projectSelectOptions={projectSelectOptions} taskSelectOptions={taskSelectOptions}
                  onTaskChangeInRow={onTaskChangeInRow} onAddLogRow={onAddLogRow} onRemoveLogRow={onRemoveLogRow}
                  canSetRate={canSetRate} active={!isSaving}
                />
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className={`shrink-0 flex items-center justify-end gap-2 p-4 sm:px-6 border-t border-slate-200 ${PHONE_SHEET_FOOTER_SAFE_AREA}`}>
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="min-h-11 sm:min-h-0 px-4 py-2 bg-slate-100 text-slate-600 rounded-xl font-bold text-xs hover:bg-slate-200 cursor-pointer disabled:opacity-50"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={isSaving || !online}
              title={online ? undefined : OFFLINE_SUBMIT_TITLE}
              className="flex-1 sm:flex-none justify-center min-h-11 px-5 py-2 bg-blue-600 text-white rounded-xl font-bold text-xs hover:bg-blue-700 cursor-pointer shadow-md shadow-blue-600/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {isSaving ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  <span>در حال ذخیره...</span>
                </>
              ) : (
                <span>ذخیره کارکرد</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
