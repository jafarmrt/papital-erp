import { AlertTriangle, Check } from 'lucide-react';
import type { ProjectStep, ProjectStepState } from '../../../lib/projects/projectSteps';
import type { ProjectWorkspaceTab } from '../../../lib/projects/projectWorkspaceTabs';
import { formatPersianNumber } from '../../../utils';

interface ProjectStepsBarProps {
  steps: ProjectStep[];
  onOpenTab: (tab: ProjectWorkspaceTab) => void;
  /** a cancelled or paused project: the bar is shown muted with this note, and no step is the current one */
  inactiveNote?: string | null;
}

const CIRCLE: Record<ProjectStepState, string> = {
  done: 'bg-emerald-600 border-emerald-600 text-white',
  active: 'bg-white border-blue-600 text-blue-700 ring-4 ring-blue-100',
  attention: 'bg-white border-amber-500 text-amber-700 ring-4 ring-amber-100',
  todo: 'bg-white border-slate-300 text-slate-500',
};

const NOTE: Record<ProjectStepState, string> = {
  done: 'text-emerald-700',
  active: 'text-blue-700',
  attention: 'text-amber-700',
  todo: 'text-slate-500',
};

const STATE_LABEL: Record<ProjectStepState, string> = {
  done: 'انجام شد',
  active: 'در جریان',
  attention: 'نیاز به رسیدگی',
  todo: 'هنوز نه',
};

/** the first step not done: the one the project waits on */
export function currentStepIndex(steps: readonly ProjectStep[]): number {
  const index = steps.findIndex(step => step.state !== 'done');
  return index === -1 ? steps.length - 1 : index;
}

/**
 * v10.2.1 (10.2 package 2, review U4): where the project stands, from the material list to «ورود به انبار», in one row
 * at the top of its page. Each step says what is left and opens its tab. On a phone the row scrolls sideways.
 */
export function ProjectStepsBar({ steps, onOpenTab, inactiveNote }: ProjectStepsBarProps) {
  const current = inactiveNote ? -1 : currentStepIndex(steps);
  return (
    <nav aria-label="گام‌های پروژه" className={`rounded-2xl border px-3 py-3 overflow-x-auto ${inactiveNote ? 'bg-slate-50 border-slate-200' : 'bg-white border-slate-200'}`}>
      {inactiveNote && <p className="text-xs font-bold text-slate-600 mb-2">{inactiveNote}</p>}
      <ol className={`flex items-start min-w-max sm:min-w-0 ${inactiveNote ? 'opacity-60 grayscale' : ''}`}>
        {steps.map((step, index) => (
          <li key={step.key} className="flex-1 flex items-start min-w-[7.5rem]">
            <button
              type="button"
              onClick={() => onOpenTab(step.tab)}
              aria-current={index === current ? 'step' : undefined}
              className="flex flex-col items-center gap-1 px-1 w-full text-center cursor-pointer rounded-xl hover:bg-slate-50 py-1"
            >
              <span className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold ${CIRCLE[step.state]}`}>
                {step.state === 'done' ? <Check className="w-4 h-4" aria-hidden="true" />
                  : step.state === 'attention' ? <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                    : formatPersianNumber(index + 1)}
              </span>
              <span className="text-xs font-bold text-slate-900">{step.label}</span>
              <span className={`text-[11px] ${NOTE[step.state]}`}>{step.note}</span>
              <span className="sr-only">{STATE_LABEL[step.state]}</span>
            </button>
            {index < steps.length - 1 && (
              <span aria-hidden="true" className={`mt-5 h-0.5 w-4 sm:flex-1 shrink-0 ${step.state === 'done' ? 'bg-emerald-500' : 'bg-slate-200'}`} />
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
