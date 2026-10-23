import { Calendar, Plus, RefreshCw, Wrench, Tag, Sparkles, Coins } from 'lucide-react';
import type { PieceworkTask, ProjectStage } from '../../../types';
import { formatPersianCode, formatPersianNumber, toPersianDigits, toStorageDate } from '../../../utils';
import { JalaliDateInput } from '../../common/JalaliDateInput';
import { isAssemblyStage, type SchedulePlan } from './useSchedulePlan';
import type { ScheduleLogging } from './useScheduleLogging';
import { ScheduleTaskRow } from './ScheduleTaskRow';

interface ScheduleStageCardProps {
  stage: ProjectStage;
  plan: SchedulePlan;
  logging: ScheduleLogging;
  pieceworkTasksList: PieceworkTask[];
  canEdit: boolean;
  canLog: boolean;
  onPickPersonnel: (target: { stageId: number; productId: string; taskIdx: number }) => void;
}

/** one stage of the workshop plan: its batch log and preset buttons, and each product's dates and rows */
export function ScheduleStageCard({ stage: stg, plan, logging, pieceworkTasksList, canEdit, canLog, onPickPersonnel }: ScheduleStageCardProps) {
  const assembly = isAssemblyStage(stg.title);
  const defaultTasksForStage = plan.findStageDefaultTasks(stg.title);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
      {/* Stage Header */}
      <div className="p-3 bg-slate-100 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-slate-900 text-amber-400 font-bold flex items-center justify-center text-xs">
            {formatPersianCode(stg.stage_order || stg.id)}
          </div>
          <h4 className="font-bold text-slate-900 text-xs">{stg.title}</h4>
          <span className="text-[11px] text-slate-500 font-semibold bg-white px-2 py-0.5 rounded-md border border-slate-200">
            {toPersianDigits(plan.products.length)} محصول
          </span>
        </div>

        <div className="flex items-center gap-2">
          {canLog && (
            <button
              type="button"
              onClick={() => void logging.handleBatchLogStageTasks(stg.id, stg.title)}
              disabled={logging.batchLoggingStageId === stg.id}
              className="px-2.5 py-1 text-[11px] font-bold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-lg flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
              title="ثبت یکباره تمامی وظایف پرسنل‌دار این مرحله به عنوان کارکرد کارمزدی"
            >
              {logging.batchLoggingStageId === stg.id ? (
                <RefreshCw className="w-3 h-3 text-emerald-600 animate-spin" />
              ) : (
                <Coins className="w-3 h-3 text-emerald-600" />
              )}
              <span>ثبت گروهی کارکرد مرحله</span>
            </button>
          )}

          {canEdit && (
            <button
              type="button"
              onClick={() => plan.handleApplyStagePreset(stg.id, stg.title)}
              className="px-2.5 py-1 text-[11px] font-bold text-indigo-900 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
              title="اعمال الگو و عناوین کاری تعریف‌شده در تنظیمات برای این مرحله"
            >
              <Sparkles className="w-3 h-3 text-indigo-600" />
              بارگذاری الگوی عناوین کاری {defaultTasksForStage.length > 0 ? `(${toPersianDigits(defaultTasksForStage.length)} کار)` : ''}
            </button>
          )}
        </div>
      </div>

      {/* Products in this stage */}
      <div className="p-4 space-y-4 divide-y divide-slate-100">
        {plan.products.map((p) => {
          if (assembly && p.needs_assembly === false) {
            return (
              <div key={p.id} className="pt-2 text-slate-400 italic text-[11px] flex items-center gap-2">
                <Tag className="w-3.5 h-3.5 text-slate-300" />
                محصول <strong>{p.item_name}</strong> (کد: {p.customer_code || p.item_code}) نیاز به مرحله مونتاژ ندارد (رد شده).
              </div>
            );
          }
          const sched = plan.getProductSchedule(stg.id, p.id);

          return (
            <div key={p.id} className="pt-3 first:pt-0 space-y-3">
              {/* Product Banner */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-800 text-xs">{p.item_name}</span>
                  {p.customer_code && (
                    <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-mono text-[10px] font-bold">
                      کد مشتری: {p.customer_code}
                    </span>
                  )}
                  <span className="text-[11px] text-slate-500 font-mono">
                    ({formatPersianNumber(p.quantity)} {p.unit})
                  </span>
                </div>

                {/* Date Pickers for product in stage */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1 text-[11px] text-slate-600">
                    <Calendar className="w-3.5 h-3.5 text-blue-600" />
                    <span>از:</span>
                    <JalaliDateInput
                      value={toStorageDate(sched.startDate || '') || ''}
                      onChange={iso => plan.updateProductSchedule(stg.id, p.id, prev => ({ ...prev, startDate: iso }))}
                      disabled={!canEdit}
                      placeholder="شروع..."
                      className="w-26 px-2 py-0.5 border border-slate-300 rounded-lg font-mono text-center text-xs bg-white cursor-pointer focus:ring-1 focus:ring-amber-500"
                      containerClassName="inline-block"
                    />
                  </div>

                  <div className="flex items-center gap-1 text-[11px] text-slate-600">
                    <span>تا:</span>
                    <JalaliDateInput
                      value={toStorageDate(sched.endDate || '') || ''}
                      onChange={iso => plan.updateProductSchedule(stg.id, p.id, prev => ({ ...prev, endDate: iso }))}
                      disabled={!canEdit}
                      placeholder="تحویل..."
                      className="w-26 px-2 py-0.5 border border-slate-300 rounded-lg font-mono text-center text-xs bg-white cursor-pointer focus:ring-1 focus:ring-amber-500"
                      containerClassName="inline-block"
                    />
                  </div>
                </div>
              </div>

              {/* Tasks List */}
              <div className="space-y-2 pr-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-700 text-[11px] flex items-center gap-1">
                    <Wrench className="w-3.5 h-3.5 text-amber-600" />
                    عناوین کاری و پرسنل مجری ({toPersianDigits(sched.tasks?.length || 0)} مورد)
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => plan.handleAddTask(stg.id, p.id)}
                      className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold text-[10px] rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      افزودن کار دستی
                    </button>
                  )}
                </div>

                {sched.tasks && sched.tasks.length > 0 ? (
                  <div className="space-y-2">
                    {sched.tasks.map((task, tIdx) => (
                      <ScheduleTaskRow
                        key={task.id || tIdx}
                        stageId={stg.id}
                        productId={p.id}
                        taskIdx={tIdx}
                        task={task}
                        plan={plan}
                        logging={logging}
                        pieceworkTasksList={pieceworkTasksList}
                        canEdit={canEdit}
                        canLog={canLog}
                        onPickPersonnel={() => onPickPersonnel({ stageId: stg.id, productId: p.id, taskIdx: tIdx })}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400 italic py-1">
                    هنوز کارمزدی برای این محصول در این مرحله تعریف نشده است. جهت بارگذاری سریع می‌توانید از دکمه «بارگذاری الگوی عناوین کاری» استفاده کنید.
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
