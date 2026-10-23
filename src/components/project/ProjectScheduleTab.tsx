import { useEffect, useState } from 'react';
import { Users, Calendar, Check, RefreshCw, Calculator } from 'lucide-react';
import type { ProductionProject } from '../../types';
import { getTodayIsoDate } from '../../utils';
import { JalaliDateInput } from '../common/JalaliDateInput';
import { useRialDisplay } from '../../hooks/useAppCurrency';
import { usePieceworkPermissions } from '../../hooks/usePieceworkPermissions';
import { useProjectVersion } from '../../hooks/useProjectVersion';
import { useProjectPermissions } from '../../hooks/useProjectPermissions';
import { ProjectWorkshopPanel } from '../workshop/ProjectWorkshopPanel';
import { useScheduleReferenceData } from './schedule/useScheduleReferenceData';
import { useSchedulePlan } from './schedule/useSchedulePlan';
import { useScheduleLogging } from './schedule/useScheduleLogging';
import { ScheduleStageCard } from './schedule/ScheduleStageCard';
import { ScheduleRecordedLogs } from './schedule/ScheduleRecordedLogs';
import { SchedulePersonnelPicker } from './schedule/SchedulePersonnelPicker';

interface ProjectScheduleTabProps {
  project: ProductionProject;
  onUpdate: () => void;
  /** v10.2.1 (review U2): the page asks before a tab change or leaving while the plan is not saved */
  onDirtyChange?: (dirty: boolean) => void;
  /** 10.3 (part 9 review): an unsaved change or a save under way, so the page holds the project back until both are over */
  onBusyChange?: (busy: boolean) => void;
}

/**
 * The workshop tab of a project: the plan rows of each product in each stage, their personnel and estimated labor cost,
 * «ثبت کارمزد», and the work logs recorded for the project. 10.3 (ARCH review finding 3): the presets, personnel,
 * piecework titles and work logs come from the shared cache (`./schedule/useScheduleReferenceData`), so a change saved
 * elsewhere refreshes them while the tab is open; the plan and the logging live in `./schedule`.
 */
export default function ProjectScheduleTab({ project, onUpdate, onDirtyChange, onBusyChange }: ProjectScheduleTabProps) {
  const rial = useRialDisplay();
  const projectVersion = useProjectVersion(project);
  const { workflowPresets, personnelList, pieceworkTasksList, recordedLogs, loadingLogs, reloadLogs } = useScheduleReferenceData(project.id);
  const plan = useSchedulePlan({ project, workflowPresets, pieceworkTasksList, personnelList, projectVersion, onUpdate, onDirtyChange });
  const logging = useScheduleLogging({ project, plan, projectVersion, onUpdate });
  // busy until a save or a work log is over: a work log marks the plan saved before its own refresh, at its end
  const busy = plan.hasUnsavedSchedules || plan.saving || logging.busy;
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  const [pickingTarget, setPickingTarget] = useState<{ stageId: number; productId: string; taskIdx: number } | null>(null);
  // v9.0.320 (TD-805): «ثبت کارمزد» همان کلید API ثبت کارکرد را می‌پرسد
  const { canLog: holdsPieceworkLog } = usePieceworkPermissions();
  // v9.0.417 (TD-752): برنامه با `PUT /projects/:id` (`projects.edit`) ذخیره می‌شود و «ثبت کارمزد» پیش از ثبت کارکرد برنامه را ذخیره می‌کند
  const { canEdit } = useProjectPermissions();
  const canLog = holdsPieceworkLog && canEdit;

  return (
    <div className="space-y-6 text-xs animate-fadeIn font-farsi">
      {/* Top Budget Summary Banner */}
      <div className="bg-slate-900 text-white p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg border border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-amber-400 text-slate-950 font-bold flex items-center justify-center shrink-0">
            <Calculator className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-amber-300">تقسیم کار، الگوهای کارگاهی و دستمزد پرسنل</h3>
            <p className="text-slate-400 text-[11px] mt-0.5">
              تعریف پویای وظایف، اعمال الگوهای پیش‌فرض، انتخاب پرسنل مجری و زمان‌بندی تقویمی
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 border-t sm:border-t-0 sm:border-r border-slate-800 pt-2 sm:pt-0 sm:pr-4">
          <div>
            <span className="text-[10px] text-slate-400 block">برآورد کل دستمزد:</span>
            <span className="text-base font-bold font-mono text-emerald-400">
              {rial.amount(plan.totalLaborBudget)}
            </span>
          </div>

          {canEdit ? (
            <button
              onClick={() => void plan.handleSaveSchedules()}
              disabled={plan.saving}
              className="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-all shadow-md disabled:opacity-50 shrink-0 cursor-pointer"
            >
              {plan.saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              ذخیره برنامه‌ریزی
            </button>
          ) : (
            <span className="text-[11px] font-bold text-amber-300 shrink-0">فقط مشاهده: ویرایش برنامه مجوز «ویرایش پروژه و مراحل تولید» می‌خواهد.</span>
          )}
        </div>
      </div>

      {/* v9.0.283 (TD-747): تاریخ کارکردهایی که این زبانه به حقوق می‌فرستد */}
      {canLog && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex flex-wrap items-center gap-2">
          <Calendar className="w-4 h-4 text-emerald-700 shrink-0" />
          <span className="font-bold text-emerald-900 text-[11px]">تاریخ کارکرد برای «ثبت کارمزد»:</span>
          <JalaliDateInput
            value={logging.logDate}
            onChange={iso => logging.setLogDate(iso || getTodayIsoDate())}
            containerClassName="w-36"
            className="w-full px-2 py-1 text-xs border border-emerald-300 rounded-lg bg-white text-center"
          />
          <span className="text-[10px] text-emerald-800">کارکرد با همین تاریخ در حقوق ماه آن حساب می‌شود؛ پیش‌فرض امروز است.</span>
        </div>
      )}

      {/* v10.1.40 (N-01): گزارش‌های پایان کار کارگاه و پیشرفت تأییدشده هر مرحله */}
      {project.id ? <ProjectWorkshopPanel projectId={project.id} stages={plan.stages} /> : null}

      {/* Breakdown per Stage */}
      <div className="space-y-5">
        {plan.stages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-slate-400 gap-1.5 text-center">
            <Users className="w-7 h-7 text-slate-300" />
            <p className="font-bold text-slate-600">هیچ مرحله‌ای برای تقسیم کار وجود ندارد</p>
            <p className="text-[11px]">ابتدا مراحل پروژه را تعریف کنید (از مراحل پیش‌فرض پروژه‌ها در تنظیمات یا با «افزودن مرحله» در زبانه «مشخصات و مراحل»).</p>
          </div>
        ) : plan.stages.map((stg) => (
          <ScheduleStageCard
            key={stg.id}
            stage={stg}
            plan={plan}
            logging={logging}
            pieceworkTasksList={pieceworkTasksList}
            canEdit={canEdit}
            canLog={canLog}
            onPickPersonnel={setPickingTarget}
          />
        ))}
      </div>

      <ScheduleRecordedLogs recordedLogs={recordedLogs} loadingLogs={loadingLogs} onReload={reloadLogs} totalLaborBudget={plan.totalLaborBudget} />

      {pickingTarget && (
        <SchedulePersonnelPicker
          personnelList={personnelList}
          onClose={() => setPickingTarget(null)}
          onPick={(person) => {
            plan.handleUpdateTask(pickingTarget.stageId, pickingTarget.productId, pickingTarget.taskIdx, 'assignedPersonnelId', person ? person.id : null);
            setPickingTarget(null);
          }}
        />
      )}
    </div>
  );
}
