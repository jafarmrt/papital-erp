import React, { FormEvent } from 'react';
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import { Calculator, X, FolderKanban, Plus, Trash2 } from 'lucide-react';
import { PieceworkLog, PieceworkTask } from '../../types';
import { SearchableSelect } from '../SearchableSelect';
import { BatchLogRow } from '../../hooks/usePiecework';
import { formatPersianPrice, formatQuantityOrTime, parseQuantityOrTime, toEnglishDigits, extractDateString, formatCurrencyLabel } from '../../utils';
import { useAppCurrency } from '../../hooks/useAppCurrency';

interface PieceworkLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
  editingLog: PieceworkLog | null;
  setEditingLog: React.Dispatch<React.SetStateAction<PieceworkLog | null>>;
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
}

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
  isSaving = false
}: PieceworkLogModalProps) {
  const appCurrency = useAppCurrency();
  const curLbl = formatCurrencyLabel(appCurrency);
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-3xl overflow-hidden animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="p-5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
            <Calculator className="w-4 h-4 text-blue-600" />
            <span>{editingLog ? 'ویرایش ردیف کارکرد' : 'ثبت گروهی کارکرد روزانه پرسنل'}</span>
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-200 text-slate-500 rounded-full cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={onSubmit} className="p-6 space-y-5">
          {editingLog ? (
            // Single Edit Mode
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">پرسنل</label>
                  <input
                    type="text"
                    disabled
                    value={editingLog.personnelName || ''}
                    className="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">تاریخ</label>
                  <DatePicker
                    value={editingLog.date}
                    onChange={(dateObj: any) => {
                      setEditingLog(prev => prev ? { ...prev, date: extractDateString(dateObj) } : null);
                    }}
                    calendar={persian}
                    locale={persian_fa}
                    inputClass="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 font-mono"
                    containerClassName="w-full"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">پروژه تولیدی مربوطه</label>
                <SearchableSelect
                  options={projectSelectOptions}
                  value={editingLog.projectId ? String(editingLog.projectId) : ''}
                  onChange={(val) => setEditingLog(prev => prev ? { ...prev, projectId: val ? Number(val) : null } : null)}
                  placeholder="جستجو و انتخاب پروژه تولیدی (اختیاری)..."
                  maxResults={50}
                  className="w-full text-xs font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    تعداد / کارکرد ({editingLog.unit || 'عدد'})
                  </label>
                  <input
                    type="text"
                    placeholder={editingLog.unit === 'ساعت' ? 'مثال: 28:23 یا 28.5' : 'مقدار...'}
                    value={editingLog.quantity}
                    onChange={(e) => setEditingLog(prev => prev ? { ...prev, quantity: e.target.value as any } : null)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 font-mono"
                  />
                  {editingLog.unit === 'ساعت' && (
                    <p className="text-[11px] text-blue-700 font-bold mt-1">
                      محاسبه: {formatQuantityOrTime(parseQuantityOrTime(editingLog.quantity), 'ساعت')}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">{`نرخ واحد (${curLbl})`}</label>
                  <input
                    type="number"
                    value={editingLog.unitRate}
                    onChange={(e) => setEditingLog(prev => prev ? { ...prev, unitRate: Number(e.target.value) } : null)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 font-mono"
                  />
                </div>
              </div>
            </div>
          ) : (
            // Batch Create Mode
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">انتخاب پرسنل *</label>
                  <SearchableSelect
                    options={personnelSelectOptions}
                    value={selectedPersonnelForLog ? String(selectedPersonnelForLog) : ''}
                    onChange={(val) => setSelectedPersonnelForLog(val ? Number(val) : '')}
                    placeholder="جستجو و انتخاب پرسنل..."
                    maxResults={50}
                    className="w-full text-xs font-bold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">تاریخ کارکرد *</label>
                  <DatePicker
                    value={logDate}
                    onChange={(dateObj: any) => {
                      setLogDate(extractDateString(dateObj));
                    }}
                    calendar={persian}
                    locale={persian_fa}
                    inputClass="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 font-mono outline-none focus:border-blue-500"
                    containerClassName="w-full"
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

              {/* Dynamic Rows */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden">
                <div className="p-3 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-700 flex items-center justify-between">
                  <span>عناوین و مقادیر کارهای انجام شده</span>
                  <button
                    type="button"
                    onClick={onAddLogRow}
                    className="flex items-center gap-1 text-blue-600 hover:text-blue-700 text-xs font-bold cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>افزودن ردیف کاری</span>
                  </button>
                </div>

                <div className="p-3 space-y-3 max-h-80 overflow-y-auto">
                  {batchLogRows.map((row, idx) => {
                    const taskObj = tasksList.find(t => t.id === Number(row.taskId));
                    const isHour = taskObj?.unit === 'ساعت';
                    const parsedQty = parseQuantityOrTime(row.quantity);
                    const rowTotal = parsedQty * (Number(row.unitRate) || 0);

                    return (
                      <div key={idx} className="flex flex-col sm:flex-row items-center gap-2 bg-slate-50/60 p-3 rounded-xl border border-slate-200/60">
                        <div className="flex-1 w-full sm:w-5/12">
                          <label className="block text-[10px] font-bold text-slate-500 mb-1">عنوان کاری *</label>
                          <SearchableSelect
                            options={taskSelectOptions}
                            value={row.taskId ? String(row.taskId) : ''}
                            onChange={(val) => onTaskChangeInRow(idx, val ? Number(val) : '')}
                            placeholder="جستجو و انتخاب عنوان کاری..."
                            maxResults={100}
                            className="w-full text-xs font-bold"
                          />
                        </div>

                        <div className="flex-1 w-full sm:w-4/12">
                          <label className="block text-[10px] font-bold text-slate-500 mb-1">پروژه مربوطه</label>
                          <SearchableSelect
                            options={projectSelectOptions}
                            value={row.projectId ? String(row.projectId) : ''}
                            onChange={(val) => {
                              const newRows = [...batchLogRows];
                              newRows[idx].projectId = val ? Number(val) : '';
                              setBatchLogRows(newRows);
                            }}
                            placeholder="بدون پروژه / انتخاب..."
                            maxResults={50}
                            className="w-full text-xs font-bold"
                          />
                        </div>

                        <div className="w-full sm:w-28">
                          <label className="block text-[10px] font-bold text-slate-500 mb-1">
                            {isHour ? 'کارکرد (28:23 یا اعشار)' : `تعداد / مقدار (${taskObj?.unit || 'عدد'})`}
                          </label>
                          <input
                            type="text"
                            placeholder={isHour ? "28:23 یا 28.5" : "1"}
                            value={row.quantity}
                            onChange={(e) => {
                              const newRows = [...batchLogRows];
                              newRows[idx].quantity = e.target.value;
                              setBatchLogRows(newRows);
                            }}
                            className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800 text-center font-mono"
                          />
                          {isHour && row.quantity && (
                            <span className="block text-[9px] text-blue-700 font-bold mt-0.5 text-center">
                              {formatQuantityOrTime(parsedQty, 'ساعت')}
                            </span>
                          )}
                        </div>

                        <div className="w-full sm:w-28">
                          <label className="block text-[10px] font-bold text-slate-500 mb-1">{`نرخ واحد (${curLbl})`}</label>
                          <input
                            type="number"
                            value={row.unitRate}
                            onChange={(e) => {
                              const newRows = [...batchLogRows];
                              newRows[idx].unitRate = Number(e.target.value);
                              setBatchLogRows(newRows);
                            }}
                            className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800 text-center font-mono"
                          />
                        </div>

                        {rowTotal > 0 && (
                          <div className="text-left font-mono font-bold text-xs text-blue-700 whitespace-nowrap shrink-0">
                            {formatPersianPrice(rowTotal)}
                          </div>
                        )}

                        {batchLogRows.length > 1 && (
                          <button
                            type="button"
                            onClick={() => onRemoveLogRow(idx)}
                            className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg shrink-0 mt-3 sm:mt-0 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl font-bold text-xs hover:bg-slate-200 cursor-pointer disabled:opacity-50"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 bg-blue-600 text-white rounded-xl font-bold text-xs hover:bg-blue-700 cursor-pointer shadow-md shadow-blue-600/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
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
