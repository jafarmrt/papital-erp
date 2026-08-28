import React from 'react';
import { Layers, RotateCcw, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { DEFAULT_WORKFLOW_PRESETS, WorkflowPreset } from '../../constants/presets';

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
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-xs p-6 max-w-4xl mx-auto space-y-6 text-right font-farsi">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">
            <Layers size={18} className="text-amber-500" /> مدیریت و ویرایش الگوهای مراحل تولید (Workflow Presets)
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            الگوهای آماده زیر هنگام ساخت پروژه جدید برای انتخاب سریع فرآیند کارگاهی در اختیار کاربران قرار می‌گیرند.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWorkflowPresets(DEFAULT_WORKFLOW_PRESETS)}
            className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
            title="بازنشانی الگوها به وضعیت اولیه کارخانه"
          >
            <RotateCcw size={14} /> بازنشانی اولیه
          </button>
          <button
            type="button"
            onClick={() =>
              setWorkflowPresets([
                ...workflowPresets,
                {
                  id: `preset_${Date.now()}`,
                  title: `الگوی جدید ${workflowPresets.length + 1}`,
                  description: 'توضیحات الگوی فرآیند جدید...',
                  stages: ['مرحله اول']
                }
              ])
            }
            className="px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
          >
            <Plus size={14} /> الگوی جدید
          </button>
        </div>
      </div>

      <div className="space-y-6">
        {workflowPresets.map((p, pIdx) => (
          <div key={p.id || pIdx} className="border border-slate-200 bg-slate-50/50 p-5 rounded-2xl space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 grid md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">عنوان الگو:</label>
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
                    className="w-full border border-slate-300 rounded-xl px-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => setWorkflowPresets(workflowPresets.filter((_, idx) => idx !== pIdx))}
                className="p-2 text-rose-500 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-xl transition-colors shrink-0 mt-5 cursor-pointer"
                title="حذف این الگو"
              >
                <Trash2 size={16} />
              </button>
            </div>

            {/* Stages List inside this preset */}
            <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-700">مراحل فرآیند ({p.stages.length} مرحله):</span>
                <button
                  type="button"
                  onClick={() => {
                    const copy = [...workflowPresets];
                    copy[pIdx].stages.push(`مرحله جدید ${copy[pIdx].stages.length + 1}`);
                    setWorkflowPresets(copy);
                  }}
                  className="text-[11px] font-bold text-blue-600 hover:text-blue-800 bg-blue-50 px-2 py-1 rounded-lg flex items-center gap-1 cursor-pointer"
                >
                  <Plus size={12} /> افزودن مرحله
                </button>
              </div>

              <div className="space-y-2">
                {p.stages.map((stg, sIdx) => {
                  const stgTitle = typeof stg === 'string' ? stg : stg.title;
                  const stgIsOptional = typeof stg === 'object' && stg !== null ? !!stg.isOptionalPerProduct : stgTitle.includes('مونتاژ');

                  return (
                    <div key={sIdx} className="p-2 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
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
                              copy[pIdx].stages[sIdx] = { title: e.target.value, isOptionalPerProduct: stgIsOptional };
                            } else {
                              copy[pIdx].stages[sIdx] = { ...current, title: e.target.value };
                            }
                            setWorkflowPresets(copy);
                          }}
                          placeholder="نام مرحله تولید..."
                          className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-blue-500 bg-white font-semibold text-slate-800"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (sIdx === 0) return;
                            const copy = [...workflowPresets];
                            const temp = copy[pIdx].stages[sIdx];
                            copy[pIdx].stages[sIdx] = copy[pIdx].stages[sIdx - 1];
                            copy[pIdx].stages[sIdx - 1] = temp;
                            setWorkflowPresets(copy);
                          }}
                          disabled={sIdx === 0}
                          className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20 cursor-pointer"
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (sIdx === p.stages.length - 1) return;
                            const copy = [...workflowPresets];
                            const temp = copy[pIdx].stages[sIdx];
                            copy[pIdx].stages[sIdx] = copy[pIdx].stages[sIdx + 1];
                            copy[pIdx].stages[sIdx + 1] = temp;
                            setWorkflowPresets(copy);
                          }}
                          disabled={sIdx === p.stages.length - 1}
                          className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20 cursor-pointer"
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
                        >
                          <Trash2 size={14} />
                        </button>
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
                                copy[pIdx].stages[sIdx] = { title: current, isOptionalPerProduct: e.target.checked, defaultTasks: [] };
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
                          (امکان فعال/غیرفعال‌سازی مجزا برای هر کالا)
                        </span>
                      </div>

                      {/* Default Task Templates for this Stage */}
                      <div className="mr-8 p-2.5 bg-amber-50/60 border border-amber-200 rounded-xl space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-800 text-[11px] flex items-center gap-1">
                            عناوین کاری / کارمزدهای الگوی این مرحله ({typeof stg === 'object' && stg.defaultTasks ? stg.defaultTasks.length : 0} مورد)
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const copy = [...workflowPresets];
                              const current = copy[pIdx].stages[sIdx];
                              const currentTasks = typeof current === 'object' && current.defaultTasks ? [...current.defaultTasks] : [];
                              currentTasks.push({
                                taskTitle: 'عنوان کاری جدید',
                                unit: 'عدد',
                                defaultRate: 10000
                              });

                              if (typeof current === 'string') {
                                copy[pIdx].stages[sIdx] = { title: current, defaultTasks: currentTasks };
                              } else {
                                copy[pIdx].stages[sIdx] = { ...current, defaultTasks: currentTasks };
                              }
                              setWorkflowPresets(copy);
                            }}
                            className="text-[10px] font-bold text-amber-900 bg-amber-200 hover:bg-amber-300 px-2 py-0.5 rounded-md flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <Plus size={11} /> افزودن عنوان کاری به الگو
                          </button>
                        </div>

                        {typeof stg === 'object' && stg.defaultTasks && stg.defaultTasks.length > 0 ? (
                          <div className="space-y-1.5">
                            {stg.defaultTasks.map((dt, dtIdx) => (
                              <div key={dtIdx} className="flex items-center gap-2 bg-white p-1.5 rounded-lg border border-amber-200 text-xs">
                                <input
                                  type="text"
                                  value={dt.taskTitle}
                                  onChange={(e) => {
                                    const copy = [...workflowPresets];
                                    const current = copy[pIdx].stages[sIdx];
                                    if (typeof current === 'object' && current.defaultTasks) {
                                      current.defaultTasks[dtIdx].taskTitle = e.target.value;
                                      setWorkflowPresets(copy);
                                    }
                                  }}
                                  placeholder="عنوان کارمزدی..."
                                  className="flex-1 px-2 py-0.5 border border-slate-200 rounded text-xs font-semibold"
                                />
                                <div className="flex items-center gap-1">
                                  <input
                                    type="text"
                                    value={dt.unit || 'عدد'}
                                    onChange={(e) => {
                                      const copy = [...workflowPresets];
                                      const current = copy[pIdx].stages[sIdx];
                                      if (typeof current === 'object' && current.defaultTasks) {
                                        current.defaultTasks[dtIdx].unit = e.target.value;
                                        setWorkflowPresets(copy);
                                      }
                                    }}
                                    placeholder="واحد"
                                    className="w-16 px-1.5 py-0.5 border border-slate-200 rounded text-center text-xs"
                                  />
                                </div>
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    value={dt.defaultRate || 0}
                                    onChange={(e) => {
                                      const copy = [...workflowPresets];
                                      const current = copy[pIdx].stages[sIdx];
                                      if (typeof current === 'object' && current.defaultTasks) {
                                        current.defaultTasks[dtIdx].defaultRate = Number(e.target.value) || 0;
                                        setWorkflowPresets(copy);
                                      }
                                    }}
                                    placeholder="نرخ ریالی"
                                    className="w-24 px-1.5 py-0.5 border border-slate-200 rounded font-mono text-center text-xs"
                                  />
                                  <span className="text-[10px] text-slate-400">ریال</span>
                                </div>
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
                                  className="p-1 text-rose-500 hover:text-rose-700 cursor-pointer"
                                  title="حذف این عنوان از الگو"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-[10px] text-slate-500 italic">
                            هنوز عنوان کاری پیش‌فرضی برای این مرحله در الگو ثبت نشده است.
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end pt-4 border-t border-slate-200">
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-2 rounded-xl font-bold text-xs shadow-xs transition-colors cursor-pointer"
        >
          {isSaving ? 'در حال ذخیره...' : 'ذخیره الگوهای مراحل تولید'}
        </button>
      </div>
    </div>
  );
}
