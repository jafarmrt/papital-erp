import { ArrowRight, Calendar, Edit3, Layers, Package, User } from 'lucide-react';
import type { ProductionProject } from '../../../types';
import { formatPersianDate, formatPersianNumber } from '../../../utils';
import { PROJECT_STATUS_LABELS } from '../../../lib/projects/projectStatus';
import { PROJECT_WORKSPACE_TABS, PROJECT_WORKSPACE_TAB_LABELS, type ProjectWorkspaceTab } from '../../../lib/projects/projectWorkspaceTabs';
import { ProjectStatusActions } from '../ProjectStatusActions';

const STATUS_STYLES: Record<string, string> = {
  planned: 'bg-slate-100 text-slate-700 border-slate-200',
  in_progress: 'bg-amber-50 text-amber-800 border-amber-200',
  completed: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  paused: 'bg-orange-50 text-orange-800 border-orange-200',
  cancelled: 'bg-rose-50 text-rose-800 border-rose-200',
};

interface ProjectWorkspaceHeaderProps {
  project: ProductionProject;
  version: number | undefined;
  canEdit: boolean;
  editingSpecs: boolean;
  onBack: () => void;
  onEditSpecs: () => void;
  onStatusSaved: (response: unknown) => void;
}

export function ProjectWorkspaceHeader({ project, version, canEdit, editingSpecs, onBack, onEditSpecs, onStatusSaved }: ProjectWorkspaceHeaderProps) {
  const status = project.status || 'planned';
  const statusLabel = (PROJECT_STATUS_LABELS as Record<string, string>)[status] ?? status;
  const progress = Math.min(100, Math.max(0, project.progress_percent || 0));
  return (
    <header className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3 min-w-0">
        <button type="button" onClick={onBack} aria-label="بازگشت به فهرست پروژه‌ها" title="بازگشت به فهرست پروژه‌ها" className="w-9 h-9 shrink-0 rounded-xl border border-slate-300 hover:bg-slate-50 flex items-center justify-center text-slate-700 cursor-pointer">
          <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </button>
        <div className="w-9 h-9 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center shrink-0" aria-hidden="true">
          <Layers className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-base sm:text-lg font-bold text-slate-900">{project.title}</h1>
            {project.project_code && <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold border border-slate-200">{project.project_code}</span>}
            <span className={`px-2 py-0.5 rounded-lg text-xs font-bold border ${STATUS_STYLES[status] ?? STATUS_STYLES.planned}`}>{statusLabel}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-600 mt-1.5 flex-wrap">
            {project.customer_name && (
              <span className="flex items-center gap-1"><User className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />مشتری: <strong className="text-slate-900">{project.customer_name}</strong></span>
            )}
            {project.end_date && (
              <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />موعد تحویل: <strong className="text-slate-900">{formatPersianDate(project.end_date)}</strong></span>
            )}
            {project.quantity ? (
              <span className="flex items-center gap-1"><Package className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />تعداد: <strong className="text-slate-900">{formatPersianNumber(project.quantity)} {project.unit || 'عدد'}</strong></span>
            ) : null}
            <span className="flex items-center gap-1.5">
              پیشرفت:
              <span className="w-20 bg-slate-200 h-2 rounded-full overflow-hidden inline-block" aria-hidden="true">
                <span className="bg-amber-500 h-full block rounded-full" style={{ width: `${progress}%` }} />
              </span>
              <strong className="text-amber-700">{formatPersianNumber(project.progress_percent || 0)}٪</strong>
            </span>
          </div>
        </div>
      </div>
      {canEdit && (
        <div className="flex items-center gap-2 flex-wrap">
          {!editingSpecs && (
            <>
            <button type="button" onClick={onEditSpecs} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer">
              <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
              ویرایش مشخصات
            </button>
            {/* a status change saves and reloads the project, which would interrupt the specs form */}
            <ProjectStatusActions projectId={project.id} status={project.status} version={version} onSaved={onStatusSaved} />
            </>
          )}
        </div>
      )}
    </header>
  );
}

interface ProjectWorkspaceTabBarProps {
  active: ProjectWorkspaceTab;
  dirty: ReadonlySet<ProjectWorkspaceTab>;
  badges: Partial<Record<ProjectWorkspaceTab, string>>;
  onSelect: (tab: ProjectWorkspaceTab) => void;
}

/** the five tabs of a project page; a tab holding an unsaved change says so */
export function ProjectWorkspaceTabBar({ active, dirty, badges, onSelect }: ProjectWorkspaceTabBarProps) {
  return (
    <div role="tablist" aria-label="بخش‌های پروژه" className="flex items-center gap-1.5 overflow-x-auto border-b border-slate-200">
      {PROJECT_WORKSPACE_TABS.map(tab => (
        <button
          key={tab}
          type="button"
          role="tab"
          id={`project-tab-${tab}`}
          aria-selected={tab === active}
          aria-controls="project-tab-panel"
          onClick={() => onSelect(tab)}
          className={`px-3.5 py-2.5 rounded-t-xl font-bold text-xs flex items-center gap-2 border-t border-x shrink-0 cursor-pointer ${tab === active ? 'bg-white text-slate-900 border-slate-200 -mb-px' : 'text-slate-600 hover:text-slate-900 border-transparent'}`}
        >
          <span>{PROJECT_WORKSPACE_TAB_LABELS[tab]}</span>
          {badges[tab] && <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-700">{badges[tab]}</span>}
          {dirty.has(tab) && <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-800">ذخیره‌نشده</span>}
        </button>
      ))}
    </div>
  );
}
