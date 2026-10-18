import { AlertTriangle, Calendar, CheckSquare, ChevronLeft, Layers, User } from 'lucide-react';
import type { ProductionProject } from '../../../types';
import { formatPersianDate, formatPersianNumber, getTodayIsoDate } from '../../../utils';
import { stageStatusLabel } from '../../../lib/projects/projectStatus';
import { hasMatrixProducts } from '../../../lib/projects/progressMatrix';
import { pendingProjectSteps, projectDueNote } from '../../../lib/projects/projectPhoneSummary';
import type { ProjectStep } from '../../../lib/projects/projectSteps';
import type { ProjectWorkspaceTab } from '../../../lib/projects/projectWorkspaceTabs';
import { PHONE_TAP_TARGET } from '../../../lib/pwa/phoneLayout';
import { currentStepIndex } from '../workspace/ProjectStepsBar';

interface ProjectPhoneSummaryProps {
  project: ProductionProject;
  steps: readonly ProjectStep[];
  /** a paused or cancelled project's note; then no step is the current one */
  inactiveNote: string | null;
  onOpenTab: (tab: ProjectWorkspaceTab) => void;
  /** the desktop overview (products, stage editing, timeline, attachments) below this summary */
  onShowFull: () => void;
}

const CARD = 'bg-white rounded-2xl border border-slate-200 p-4 space-y-3';

/**
 * v10.2.7 (10.2 package 10, production projects review «ث»): the first tab of a project page on a phone. It carries
 * what the desktop header, step bar and summary tab say in one column: the progress, the customer, the delivery date
 * and how far it is, the step the project waits on and every step still open, and each stage with its status. A step
 * opens its tab; «تیک جدول پیشرفت» opens the matrix list, and «نمای کامل» shows the desktop tab for what this card
 * leaves out.
 */
export function ProjectPhoneSummary({ project, steps, inactiveNote, onOpenTab, onShowFull }: ProjectPhoneSummaryProps) {
  const progress = Math.min(100, Math.max(0, Math.round(Number(project.progress_percent) || 0)));
  const due = projectDueNote(project.end_date, getTodayIsoDate(), project.status);
  const current = inactiveNote ? null : steps[currentStepIndex(steps)] ?? null;
  const pending = pendingProjectSteps(steps);
  const stages = Array.isArray(project.stages) ? project.stages : [];
  const hasMatrix = hasMatrixProducts({ products: project.products, itemId: project.item_id });

  return (
    <div className="space-y-3 text-xs">
      <section className={CARD} aria-label="خلاصه پروژه">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-bold text-slate-700">پیشرفت کل</span>
            <strong className="text-amber-700 text-base">{formatPersianNumber(progress)}٪</strong>
          </div>
          <div className="h-2.5 bg-slate-200 rounded-full overflow-hidden" aria-hidden="true">
            <div className="h-full bg-amber-500 rounded-full" style={{ width: `${progress}%` }} />
          </div>
        </div>
        <dl className="space-y-2">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-amber-600 shrink-0" aria-hidden="true" />
            <dt className="text-slate-500">مشتری:</dt>
            <dd className="font-bold text-slate-900 truncate">{project.customer_name || 'ثبت نشده'}</dd>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Calendar className="w-4 h-4 text-blue-600 shrink-0" aria-hidden="true" />
            <dt className="text-slate-500">موعد تحویل:</dt>
            <dd className="font-bold text-slate-900">{project.end_date ? formatPersianDate(project.end_date) : 'ثبت نشده'}</dd>
            {due && (
              <dd className={`px-2 py-0.5 rounded-lg font-bold ${due.late ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-blue-50 text-blue-700 border border-blue-100'}`}>{due.text}</dd>
            )}
          </div>
        </dl>
        {inactiveNote && <p className="font-bold text-slate-600 bg-slate-50 rounded-xl p-2.5">{inactiveNote}</p>}
        {current && (
          <p className="text-slate-700">
            گام کنونی: <strong className="text-slate-900">{current.label}</strong> <span className="text-slate-500">({current.note})</span>
          </p>
        )}
        {hasMatrix && (
          <button type="button" onClick={() => onOpenTab('progress')} className={`w-full ${PHONE_TAP_TARGET} rounded-xl bg-blue-600 text-white font-bold flex items-center justify-center gap-2 cursor-pointer`}>
            <CheckSquare className="w-4 h-4" aria-hidden="true" />
            تیک جدول پیشرفت
          </button>
        )}
      </section>

      <section className={CARD} aria-labelledby={`phone-pending-${project.id}`}>
        <h2 id={`phone-pending-${project.id}`} className="font-bold text-slate-800">کارهای مانده</h2>
        {pending.length === 0 ? (
          <p className="text-emerald-700 font-bold">همه گام‌ها انجام شده است.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {pending.map(step => (
              <li key={step.key}>
                <button type="button" onClick={() => onOpenTab(step.tab)} className={`w-full ${PHONE_TAP_TARGET} flex items-center gap-2 text-right py-2 cursor-pointer`}>
                  {step.state === 'attention'
                    ? <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" aria-hidden="true" />
                    : <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${step.state === 'active' ? 'bg-blue-600' : 'bg-slate-300'}`} aria-hidden="true" />}
                  <span className="font-bold text-slate-900">{step.label}</span>
                  <span className={`flex-1 truncate ${step.state === 'attention' ? 'text-amber-700' : 'text-slate-500'}`}>{step.note}</span>
                  <ChevronLeft className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={CARD} aria-labelledby={`phone-stages-${project.id}`}>
        <h2 id={`phone-stages-${project.id}`} className="font-bold text-slate-800 flex items-center gap-1.5">
          <Layers className="w-4 h-4 text-blue-600" aria-hidden="true" />
          مراحل کارگاه ({formatPersianNumber(stages.length)} مرحله)
        </h2>
        {stages.length === 0 ? (
          <p className="text-slate-500">مرحله‌ای برای این پروژه ثبت نشده است.</p>
        ) : (
          <ul className="space-y-2.5">
            {stages.map(stage => {
              const pct = Math.min(100, Math.max(0, Math.round(Number(stage.progress_percent) || 0)));
              return (
                <li key={stage.id}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-900 truncate">{stage.title}</span>
                    <span className="text-slate-500 shrink-0">{stageStatusLabel(stage.status)} · {formatPersianNumber(pct)}٪</span>
                  </div>
                  <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden mt-1" aria-hidden="true">
                    <div className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-amber-500' : 'bg-slate-300'}`} style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <button type="button" onClick={onShowFull} className={`w-full ${PHONE_TAP_TARGET} rounded-xl border border-slate-300 bg-white text-slate-700 font-bold cursor-pointer`}>
        نمای کامل مشخصات و مراحل
      </button>
    </div>
  );
}
