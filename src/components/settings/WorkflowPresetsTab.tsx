import React, { useState, useEffect } from 'react';
import { Layers, Plus, Trash2, ArrowUp, ArrowDown, Archive, ArchiveRestore, Check, AlertCircle } from 'lucide-react';
import { WorkflowPreset } from '../../constants/presets';
import { fetchJson } from '../../api';
import { formatPersianPrice, formatPersianNumber, formatCurrencyLabel } from '../../utils';
import { useAppCurrency } from '../../hooks/useAppCurrency';
import { toast } from 'react-hot-toast';

interface PieceworkTask {
  id: number;
  code: string;
  title: string;
  category: string;
  defaultRate: number;
  unit: string;
  description?: string;
}

interface WorkflowPresetsTabProps {
  workflowPresets: WorkflowPreset[];
  setWorkflowPresets: React.Dispatch<React.SetStateAction<WorkflowPreset[]>>;
  isSaving: boolean;
  onSave: () => void;
}

export function WorkflowPresetsTab({
  workflowPresets,
  setWorkflowPresets,
  isSaving,
  onSave
}: WorkflowPresetsTabProps) {
  const appCurrency = useAppCurrency();
  const curLbl = formatCurrencyLabel(appCurrency);

  const [availableTasks, setAvailableTasks] = useState<PieceworkTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState<boolean>(true);
  const [showArchived, setShowArchived] = useState<boolean>(false);

  // Load piecework tasks from payroll/piecework section
  useEffect(() => {
    let isMounted = true;
    const loadTasks = async () => {
      setLoadingTasks(true);
      try {
        const res = await fetchJson('/piecework/tasks');
        const data = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
        if (isMounted) {
          setAvailableTasks(data);
        }
      } catch (err) {
        console.error('Failed to load piecework tasks:', err);
      } finally {
        if (isMounted) setLoadingTasks(false);
      }
    };
    loadTasks();
    return () => {
      isMounted = false;
    };
  }, []);

  // Safe preset list with legacy defaults filtered out
  const cleanPresets = (Array.isArray(workflowPresets) ? workflowPresets : []).filter(
    (p) => p.id !== 'tile_transfer' && p.id !== 'general_assembly'
  );

  const activeCount = cleanPresets.filter((p) => !p.isArchived).length;
  const archivedCount = cleanPresets.filter((p) => p.isArchived).length;

  const handleAddNewPreset = () => {
    const newId = `preset_${Date.now()}`;
    const newNum = cleanPresets.length + 1;
    const newPreset: WorkflowPreset = {
      id: newId,
      title: `الگوی مراحل تولید ${newNum}`,
      description: 'شرح مختصر فرآیند تولید...',
      isArchived: false,
      stages: [
        {
          title: 'مرحله اول تولید',
          isOptionalPerProduct: false,
          defaultTasks: []
        }
      ]
    };
    setWorkflowPresets((prev) => {
      const current = Array.isArray(prev) ? prev.filter(p => p.id !== 'tile_transfer' && p.id !== 'general_assembly') : [];
      return [...current, newPreset];
    });
    toast.success('الگوی جدید اضافه شد. می‌توانید مراحل و کارمزدهای آن را مشخص کنید.');
  };

  const handleToggleArchive = (presetId: string) => {
    setWorkflowPresets((prev) => {
      const current = Array.isArray(prev) ? prev : [];
      return current.map((p) => {
        if (p.id === presetId) {
          const nextArchived = !p.isArchived;
          toast.success(nextArchived ? `الگوی "${p.title}" آرشیو شد (در کنترل پروژه نمایش داده نمی‌شود).` : `الگوی "${p.title}" فعال شد.`);
          return { ...p, isArchived: nextArchived };
        }
        return p;
      });
    });
  };

  const handleDeletePreset = (presetId: string) => {
    setWorkflowPresets((prev) => {
      const current = Array.isArray(prev) ? prev : [];
      return current.filter((p) => p.id !== presetId);
    });
    toast.success('الگو حذف شد');
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-xs p-6 max-w-4xl mx-auto space-y-6 text-right font-farsi">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">
            <Layers size={18} className="text-amber-500" /> مدیریت و ویرایش الگوهای مراحل تولید
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            تعریف الگوهای مراحل تولید کارگاهی. عناوین کاری و نرخ‌های پایه مستقیماً از بخش حقوق و دستمزد خوانده می‌شوند.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {archivedCount > 0 && (
            <button
              type="button"
              onClick={() => setShowArchived(!showArchived)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer ${
                showArchived
                  ? 'bg-amber-100 text-amber-800 border border-amber-300'
                  : 'bg-slate-100 text-slate-600 hover:text-slate-800 hover:bg-slate-200'
              }`}
            >
              <Archive size={14} />
              {showArchived ? 'پنهان‌سازی آرشیوشده‌ها' : `مشاهده آرشیو (${archivedCount})`}
            </button>
          )}
          <button
            type="button"
            onClick={handleAddNewPreset}
            className="px-3.5 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
          >
            <Plus size={15} /> الگوی جدید
          </button>
        </div>
      </div>

      {cleanPresets.length === 0 ? (
        <div className="text-center py-12 px-4 border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/50 space-y-3">
          <Layers size={36} className="mx-auto text-slate-400" />
          <h4 className="text-sm font-bold text-slate-700">هیچ الگوی تولیدی تعریف نشده است</h4>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            برای تسریع در تعریف پروژه‌ها در ماژول کنترل پروژه، می‌توانید یک یا چند الگوی اختصاصی فرآیند کارگاه خود را بسازید.
          </p>
          <button
            type="button"
            onClick={handleAddNewPreset}
            className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-xs"
          >
            <Plus size={15} /> ایجاد اولین الگوی تولید
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {cleanPresets
            .filter((p) => (showArchived ? true : !p.isArchived))
            .map((p) => {
              const pIdx = workflowPresets.findIndex((item) => item.id === p.id);
              if (pIdx === -1) return null;
              const isArchived = !!p.isArchived;

              return (
                <div
                  key={p.id}
                  className={`border rounded-2xl p-5 space-y-4 transition-all ${
                    isArchived
                      ? 'border-amber-200 bg-amber-50/30 opacity-80'
                      : 'border-slate-200 bg-slate-50/50'
                  }`}
                >
                  {/* Preset Header */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 grid md:grid-cols-2 gap-3">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="block text-xs font-bold text-slate-700">عنوان الگو:</label>
                          {isArchived && (
                            <span className="text-[10px] font-bold text-amber-700 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                              <Archive size={11} /> بایگانی شده (غیرفعال در کنترل پروژه)
                            </span>
                          )}
                        </div>
                        <input
                          type="text"
                          value={p.title}
                          onChange={(e) => {
                            const copy = [...workflowPresets];
                            copy[pIdx].title = e.target.value;
                            setWorkflowPresets(copy);
                          }}
                          className="w-full border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-bold bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">توضیحات خلاصه:</label>
                        <input
                          type="text"
                          value={p.description}
                          onChange={(e) => {
                            const copy = [...workflowPresets];
                            copy[pIdx].description = e.target.value;
                            setWorkflowPresets(copy);
                          }}
                          placeholder="توضیح کوتاه درباره این فرآیند..."
                          className="w-full border border-slate-300 rounded-xl px-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 mt-5">
                      <button
                        type="button"
                        onClick={() => handleToggleArchive(p.id)}
                        className={`p-2 rounded-xl border transition-colors cursor-pointer flex items-center gap-1 text-xs font-bold ${
                          isArchived
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                            : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                        }`}
                        title={isArchived ? 'خروج از آرشیو و فعال‌سازی در کنترل پروژه' : 'انتقال به آرشیو (عدم نمایش در کنترل پروژه)'}
                      >
                        {isArchived ? (
                          <>
                            <ArchiveRestore size={15} />
                            <span className="text-[11px] hidden sm:inline">فعال‌سازی</span>
                          </>
                        ) : (
                          <>
                            <Archive size={15} />
                            <span className="text-[11px] hidden sm:inline">آرشیو</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeletePreset(p.id)}
                        className="p-2 text-rose-500 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-xl border border-rose-200 transition-colors cursor-pointer"
                        title="حذف کامل این الگو"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  {/* Stages List inside this preset */}
                  <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-slate-700">مراحل فرآیند ({p.stages.length} مرحله):</span>
                      <button
                        type="button"
                        onClick={() => {
                          const copy = [...workflowPresets];
                          copy[pIdx].stages.push({
                            title: `مرحله ${copy[pIdx].stages.length + 1}`,
                            isOptionalPerProduct: false,
                            defaultTasks: []
                          });
                          setWorkflowPresets(copy);
                        }}
                        className="text-[11px] font-bold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <Plus size={13} /> افزودن مرحله
                      </button>
                    </div>

                    <div className="space-y-3">
                      {p.stages.map((stg, sIdx) => {
                        const stgTitle = typeof stg === 'string' ? stg : stg.title;
                        const stgIsOptional = typeof stg === 'object' && stg !== null ? !!stg.isOptionalPerProduct : false;
                        const stgTasks = typeof stg === 'object' && stg !== null && Array.isArray(stg.defaultTasks) ? stg.defaultTasks : [];

                        return (
                          <div key={sIdx} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                            <div className="flex items-center gap-2 text-xs">
                              <span className="w-6 h-6 rounded-lg bg-slate-900 text-amber-400 font-bold flex items-center justify-center shrink-0 text-[11px]">
                                {sIdx + 1}
                              </span>
                              <input
                                type="text"
                                value={stgTitle}
                                onChange={(e) => {
                                  const copy = [...workflowPresets];
                                  const current = copy[pIdx].stages[sIdx];
                                  if (typeof current === 'string') {
                                    copy[pIdx].stages[sIdx] = { title: e.target.value, isOptionalPerProduct: stgIsOptional, defaultTasks: stgTasks };
                                  } else {
                                    copy[pIdx].stages[sIdx] = { ...current, title: e.target.value };
                                  }
                                  setWorkflowPresets(copy);
                                }}
                                placeholder="عنوان مرحله..."
                                className="flex-1 border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />

                              {/* Stage position reorder */}
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  disabled={sIdx === 0}
                                  onClick={() => {
                                    if (sIdx === 0) return;
                                    const copy = [...workflowPresets];
                                    const temp = copy[pIdx].stages[sIdx];
                                    copy[pIdx].stages[sIdx] = copy[pIdx].stages[sIdx - 1];
                                    copy[pIdx].stages[sIdx - 1] = temp;
                                    setWorkflowPresets(copy);
                                  }}
                                  className="p-1 text-slate-500 hover:text-slate-800 disabled:opacity-30 cursor-pointer"
                                  title="انتقال به بالا"
                                >
                                  <ArrowUp size={14} />
                                </button>
                                <button
                                  type="button"
                                  disabled={sIdx === p.stages.length - 1}
                                  onClick={() => {
                                    if (sIdx === p.stages.length - 1) return;
                                    const copy = [...workflowPresets];
                                    const temp = copy[pIdx].stages[sIdx];
                                    copy[pIdx].stages[sIdx] = copy[pIdx].stages[sIdx + 1];
                                    copy[pIdx].stages[sIdx + 1] = temp;
                                    setWorkflowPresets(copy);
                                  }}
                                  className="p-1 text-slate-500 hover:text-slate-800 disabled:opacity-30 cursor-pointer"
                                  title="انتقال به پایین"
                                >
                                  <ArrowDown size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const copy = [...workflowPresets];
                                    copy[pIdx].stages = copy[pIdx].stages.filter((_, idx) => idx !== sIdx);
                                    setWorkflowPresets(copy);
                                  }}
                                  className="p-1 text-rose-500 hover:text-rose-700 cursor-pointer"
                                  title="حذف این مرحله"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 pr-8 text-[11px] text-slate-600">
                              <label className="flex items-center gap-1.5 cursor-pointer select-none bg-white px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-100">
                                <input
                                  type="checkbox"
                                  checked={stgIsOptional}
                                  onChange={(e) => {
                                    const copy = [...workflowPresets];
                                    const current = copy[pIdx].stages[sIdx];
                                    if (typeof current === 'string') {
                                      copy[pIdx].stages[sIdx] = { title: current, isOptionalPerProduct: e.target.checked, defaultTasks: stgTasks };
                                    } else {
                                      copy[pIdx].stages[sIdx] = { ...current, isOptionalPerProduct: e.target.checked };
                                    }
                                    setWorkflowPresets(copy);
                                  }}
                                  className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                                />
                                <span className="font-semibold text-slate-700">مرحله انتخابی برای هر کالا</span>
                              </label>
                              <span className="text-slate-400 text-[10px]">
                                (امکان فعال/غیرفعال‌سازی مجزا برای هر کالا در پروژه)
                              </span>
                            </div>

                            {/* Read-Only Task Titles / Rates from Piecework / Payroll */}
                            <div className="mr-8 p-3 bg-amber-50/50 border border-amber-200 rounded-xl space-y-2.5">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-bold text-slate-800 text-[11px]">
                                    عناوین کاری / کارمزدهای الگوی این مرحله ({stgTasks.length} مورد)
                                  </span>
                                  <span className="text-[10px] text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded border border-amber-200">
                                    خوانده‌شده از ماژول حقوق و دستمزد
                                  </span>
                                </div>
                              </div>

                              {/* Task Selector from Piecework Tasks */}
                              <div className="flex items-center gap-2 bg-white p-2 rounded-lg border border-amber-200">
                                <span className="text-xs font-semibold text-slate-600 shrink-0">افزودن عنوان کاری:</span>
                                <select
                                  defaultValue=""
                                  onChange={(e) => {
                                    const selectedId = Number(e.target.value);
                                    if (!selectedId) return;
                                    const selectedTask = availableTasks.find((t) => t.id === selectedId);
                                    if (!selectedTask) return;

                                    const copy = [...workflowPresets];
                                    const current = copy[pIdx].stages[sIdx];
                                    const currentTasks = typeof current === 'object' && current.defaultTasks ? [...current.defaultTasks] : [];

                                    // Check if already added
                                    if (currentTasks.some((t) => t.taskId === selectedTask.id || t.taskTitle === selectedTask.title)) {
                                      toast.error('این عنوان کاری قبلاً به این مرحله اضافه شده است');
                                      e.target.value = '';
                                      return;
                                    }

                                    currentTasks.push({
                                      taskId: selectedTask.id,
                                      taskTitle: selectedTask.title,
                                      unit: selectedTask.unit || 'عدد',
                                      defaultRate: selectedTask.defaultRate || 0
                                    });

                                    if (typeof current === 'string') {
                                      copy[pIdx].stages[sIdx] = { title: current, isOptionalPerProduct: stgIsOptional, defaultTasks: currentTasks };
                                    } else {
                                      copy[pIdx].stages[sIdx] = { ...current, defaultTasks: currentTasks };
                                    }

                                    setWorkflowPresets(copy);
                                    e.target.value = '';
                                  }}
                                  className="flex-1 text-xs border border-slate-300 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                                >
                                  <option value="">-- انتخاب از عناوین کاری تعریف‌شده در حقوق و دستمزد --</option>
                                  {availableTasks.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.title} ({t.category} - واحد: {t.unit || 'عدد'} - نرخ پایه: {formatPersianPrice(t.defaultRate)} {curLbl})
                                    </option>
                                  ))}
                                </select>
                              </div>

                              {stgTasks.length > 0 ? (
                                <div className="space-y-1.5">
                                  {stgTasks.map((dt, dtIdx) => {
                                    // Match with master task to show live rate from payroll if available
                                    const masterTask = dt.taskId ? availableTasks.find((t) => t.id === dt.taskId) : availableTasks.find((t) => t.title === dt.taskTitle);
                                    const effectiveRate = masterTask ? masterTask.defaultRate : (dt.defaultRate || 0);
                                    const effectiveUnit = masterTask ? masterTask.unit : (dt.unit || 'عدد');

                                    return (
                                      <div
                                        key={dtIdx}
                                        className="flex items-center justify-between gap-3 bg-white p-2 rounded-lg border border-amber-200 text-xs shadow-2xs"
                                      >
                                        <div className="flex items-center gap-2 flex-1 min-w-0">
                                          <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-800 font-bold flex items-center justify-center shrink-0 text-[10px]">
                                            {dtIdx + 1}
                                          </span>
                                          <div className="min-w-0">
                                            <div className="font-bold text-slate-800 truncate">{dt.taskTitle}</div>
                                            {masterTask?.category && (
                                              <div className="text-[10px] text-slate-400">دسته‌بندی: {masterTask.category}</div>
                                            )}
                                          </div>
                                        </div>

                                        <div className="flex items-center gap-3 shrink-0">
                                          <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-[11px]">
                                            واحد: <strong className="font-bold">{effectiveUnit}</strong>
                                          </span>
                                          <span className="px-2.5 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded font-mono font-bold text-[11px]">
                                            نرخ پایه: {formatPersianPrice(effectiveRate)} {curLbl}
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const copy = [...workflowPresets];
                                              const current = copy[pIdx].stages[sIdx];
                                              if (typeof current === 'object' && current.defaultTasks) {
                                                current.defaultTasks = current.defaultTasks.filter((_, idx) => idx !== dtIdx);
                                                setWorkflowPresets(copy);
                                              }
                                            }}
                                            className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded cursor-pointer transition-colors"
                                            title="حذف این عنوان از الگوی مرحله"
                                          >
                                            <Trash2 size={14} />
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="text-[11px] text-slate-500 italic py-1 px-2 bg-amber-50/30 rounded border border-dashed border-amber-200">
                                  عنوان کاری برای این مرحله انتخاب نشده است. برای تخصیص کارمزد اتوماتیک در پروژه، از منوی بالا عنوان کاری مورد نظر را انتخاب کنید.
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      )}

      <div className="flex justify-between items-center pt-4 border-t border-slate-200">
        <div className="text-xs text-slate-500">
          تعداد الگوهای فعال: <strong className="text-slate-800 font-bold">{formatPersianNumber(activeCount)}</strong>
          {archivedCount > 0 && (
            <span className="mr-3">
              (آرشیوشده: <strong className="text-amber-700 font-bold">{formatPersianNumber(archivedCount)}</strong>)
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 text-white px-6 py-2 rounded-xl font-bold text-xs shadow-xs transition-colors cursor-pointer"
        >
          {isSaving ? 'در حال ذخیره...' : 'ذخیره الگوهای مراحل تولید'}
        </button>
      </div>
    </div>
  );
}
