import { ArrowRight, Edit3 } from 'lucide-react';
import type { ProductionProject } from '../../../types';
import { projectStatusLabel } from '../../../lib/projects/projectStatus';
import { PHONE_TAP_TARGET } from '../../../lib/pwa/phoneLayout';
import { ProjectStatusActions } from '../ProjectStatusActions';
import { PROJECT_STATUS_STYLES } from '../workspace/ProjectWorkspaceHeader';

interface ProjectPhoneHeaderProps {
  project: ProductionProject;
  version: number | undefined;
  canEdit: boolean;
  editingSpecs: boolean;
  onBack: () => void;
  onEditSpecs: () => void;
  onStatusSaved: (response: unknown) => void;
}

/**
 * v10.2.7 (10.2 package 10): the top of a project page on a phone: back to the list, the title, the code and the
 * status, and the same edit and status buttons as the desktop header. The customer, the delivery date and the
 * progress are in the phone summary below it.
 */
export function ProjectPhoneHeader({ project, version, canEdit, editingSpecs, onBack, onEditSpecs, onStatusSaved }: ProjectPhoneHeaderProps) {
  const status = project.status || 'planned';
  return (
    <header className="bg-white rounded-2xl border border-slate-200 p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} aria-label="بازگشت به فهرست پروژه‌ها" title="بازگشت به فهرست پروژه‌ها" className={`${PHONE_TAP_TARGET} w-11 shrink-0 rounded-xl border border-slate-300 flex items-center justify-center text-slate-700 cursor-pointer`}>
          <ArrowRight className="w-5 h-5" aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-bold text-slate-900 truncate">{project.title}</h1>
          <div className="flex items-center gap-1.5 mt-0.5">
            {project.project_code && <span className="text-xs text-slate-500">{project.project_code}</span>}
            <span className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border ${PROJECT_STATUS_STYLES[status] ?? PROJECT_STATUS_STYLES.planned}`}>{projectStatusLabel(status)}</span>
          </div>
        </div>
      </div>
      {canEdit && !editingSpecs && (
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={onEditSpecs} className={`${PHONE_TAP_TARGET} px-3 bg-blue-600 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer`}>
            <Edit3 className="w-4 h-4" aria-hidden="true" />
            ویرایش مشخصات
          </button>
          <ProjectStatusActions projectId={project.id} status={project.status} version={version} onSaved={onStatusSaved} />
        </div>
      )}
    </header>
  );
}
