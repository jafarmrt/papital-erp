import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import type { ProductionProject } from '../types';
import { fetchJson } from '../api';
import { errorMessageOf, formatPersianNumber } from '../utils';
import { QUERY_KEYS } from '../lib/queryKeys';
import { useProjectVersion } from '../hooks/useProjectVersion';
import { useProjectPermissions } from '../hooks/useProjectPermissions';
import { usePersonnelListQuery } from '../hooks/queries/usePersonnelQueries';
import { useProjectItemOptions, useProjectStepCounts } from '../hooks/queries/useProjectWorkspaceQueries';
import { confirmLeaveUnsaved, leaveNavigateOptions, useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { parseProjectWorkspaceTab, projectIdFromParam, projectListPath, projectWorkspacePath, PROJECT_WORKSPACE_TABS, type ProjectWorkspaceTab } from '../lib/projects/projectWorkspaceTabs';
import { projectInactiveNote, projectSteps } from '../lib/projects/projectSteps';
import { storedReservationShortages } from '../lib/projects/projectReservationState';
import { ProjectStepsBar } from '../components/project/workspace/ProjectStepsBar';
import { ProjectWorkspaceHeader, ProjectWorkspaceTabBar } from '../components/project/workspace/ProjectWorkspaceHeader';
import { ProjectOverviewTab } from '../components/project/workspace/ProjectOverviewTab';
import ProjectInventoryTab from '../components/project/ProjectInventoryTab';
import ProjectProductProgressTab from '../components/project/ProjectProductProgressTab';
import ProjectScheduleTab from '../components/project/ProjectScheduleTab';
import ProjectStockEntryTab from '../components/project/ProjectStockEntryTab';

type DirtySetter = (dirty: boolean) => void;

/**
 * v10.2.x (10.2 package 2, production projects review U1–U6): a production project is a page, `/projects/<id>/<tab>`,
 * instead of a window over the project list. The address names the tab, so a reload or a copied link opens the same
 * tab and a later notification can link to one; an earlier link with the old tab names still lands on the right one.
 * The step bar says where the project stands; a tab with an unsaved change is marked, and leaving it (another tab, the
 * list, a menu link, the browser's back button, the search or a notification, closing the browser tab) asks first. Only the tab on screen is mounted, so each one starts from the
 * project as the server last saved it.
 */
export default function ProjectDetailPage() {
  const params = useParams<{ projectId: string; tab?: string }>();
  const projectId = projectIdFromParam(params.projectId);
  const tab = parseProjectWorkspaceTab(params.tab);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canEdit } = useProjectPermissions();
  const [project, setProject] = useState<ProductionProject | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const projectVersion = useProjectVersion(project);
  const [dirtyTabs, setDirtyTabs] = useState<ReadonlySet<ProjectWorkspaceTab>>(new Set());
  const editingSpecs = canEdit && tab === 'overview' && searchParams.get('edit') === '1';

  const personnelQuery = usePersonnelListQuery();
  const itemsQuery = useProjectItemOptions(tab === 'materials' || tab === 'delivery');
  const stepCounts = useProjectStepCounts(projectId);

  // an old tab name or an unknown one is replaced by the tab's own address
  useEffect(() => {
    if (projectId === null || params.tab === undefined || params.tab === tab) return;
    void navigate({ pathname: projectWorkspacePath(projectId, tab), search: tab === 'overview' ? searchParams.toString() : '' }, { replace: true });
  }, [navigate, params.tab, projectId, searchParams, tab]);

  const loadProject = useCallback(async (signal?: AbortSignal) => {
    if (projectId === null) return;
    try {
      const data = await fetchJson<ProductionProject>(`/projects/${projectId}`, { signal });
      setProject(data && data.id ? data : null);
      setLoadError(data && data.id ? null : 'پروژه یافت نشد');
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'AbortError') return;
      setLoadError(errorMessageOf(err) || 'اطلاعات پروژه دریافت نشد');
    }
  }, [projectId]);

  useEffect(() => {
    setProject(null);
    setLoadError(null);
    const controller = new AbortController();
    void loadProject(controller.signal);
    return () => controller.abort();
  }, [loadProject]);

  /** after any save: the project again, and the list, the step bar and every project read refreshed */
  const refresh = useCallback(async (signal?: AbortSignal) => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.projects.all });
    await loadProject(signal);
  }, [loadProject, queryClient]);

  const dirtySetters = useMemo(() => {
    const setters = {} as Record<ProjectWorkspaceTab, DirtySetter>;
    for (const key of PROJECT_WORKSPACE_TABS) {
      setters[key] = (dirty: boolean) => setDirtyTabs(prev => {
        if (prev.has(key) === dirty) return prev;
        const next = new Set(prev);
        if (dirty) next.add(key); else next.delete(key);
        return next;
      });
    }
    return setters;
  }, []);

  useUnsavedChangesGuard(dirtyTabs.size > 0);

  const goToTab = async (next: ProjectWorkspaceTab) => {
    if (projectId === null || next === tab) return;
    if (dirtyTabs.has(tab) && !(await confirmLeaveUnsaved())) return;
    void navigate(projectWorkspacePath(projectId, next), leaveNavigateOptions());
  };

  const goBack = async () => {
    if (dirtyTabs.size > 0 && !(await confirmLeaveUnsaved())) return;
    void navigate(projectListPath(), leaveNavigateOptions());
  };

  const openSpecs = async () => {
    if (projectId === null) return;
    if (tab !== 'overview') {
      if (dirtyTabs.has(tab) && !(await confirmLeaveUnsaved())) return;
      void navigate(`${projectWorkspacePath(projectId, 'overview')}?edit=1`, leaveNavigateOptions());
      return;
    }
    // replaced, not pushed: while the form is open «back» is the unsaved-changes question, not a silent close
    setSearchParams({ edit: '1' }, { replace: true });
  };

  const closeSpecs = useCallback(() => setSearchParams({}, { replace: true }), [setSearchParams]);

  const steps = useMemo(
    () => (project ? projectSteps(project, stepCounts.data ?? null, stepCounts.isError) : []),
    [project, stepCounts.data, stepCounts.isError],
  );

  if (projectId === null || (loadError && !project)) {
    return (
      <div className="p-6 max-w-xl mx-auto text-center space-y-3" role="alert">
        <p className="font-bold text-slate-800">{projectId === null ? 'نشانی پروژه درست نیست.' : loadError}</p>
        <Link to="/projects" className="inline-block px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold">بازگشت به فهرست پروژه‌ها</Link>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-slate-500" role="status">
        <RefreshCw className="w-5 h-5 animate-spin text-amber-500" aria-hidden="true" />
        <span>در حال بارگذاری پروژه</span>
      </div>
    );
  }

  const shortages = storedReservationShortages(project.inventory_control).length;
  const badges: Partial<Record<ProjectWorkspaceTab, string>> = {
    overview: project.stages?.length ? `${formatPersianNumber(project.stages.filter(s => s.status === 'completed').length)} از ${formatPersianNumber(project.stages.length)} مرحله` : undefined,
    materials: shortages > 0 ? `${formatPersianNumber(shortages)} کمبود` : undefined,
  };
  const items = itemsQuery.data ?? [];
  const personnel = personnelQuery.data ?? [];

  return (
    <div className="p-3 sm:p-5 space-y-4 font-farsi" dir="rtl">
      <ProjectWorkspaceHeader
        project={project}
        version={projectVersion.version}
        canEdit={canEdit}
        editingSpecs={editingSpecs}
        onBack={() => void goBack()}
        onEditSpecs={() => void openSpecs()}
        onStatusSaved={(res) => { projectVersion.remember(res); void refresh(); }}
      />
      <ProjectStepsBar steps={steps} onOpenTab={(next) => void goToTab(next)} inactiveNote={projectInactiveNote(project.status)} />
      <ProjectWorkspaceTabBar active={tab} dirty={dirtyTabs} badges={badges} onSelect={(next) => void goToTab(next)} />
      <div id="project-tab-panel" role="tabpanel" aria-labelledby={`project-tab-${tab}`}>
        {tab === 'overview' && (
          <ProjectOverviewTab
            project={project}
            version={projectVersion.version}
            rememberVersion={projectVersion.remember}
            personnel={personnel}
            canEdit={canEdit}
            editingSpecs={editingSpecs}
            onCloseSpecs={closeSpecs}
            onChanged={() => void refresh()}
            onDirtyChange={dirtySetters.overview}
          />
        )}
        {tab === 'materials' && <ProjectInventoryTab project={project} itemsList={items} onUpdate={refresh} onDirtyChange={dirtySetters.materials} />}
        {tab === 'progress' && <ProjectProductProgressTab projectId={project.id} onUpdate={refresh} onDirtyChange={dirtySetters.progress} />}
        {tab === 'workshop' && <ProjectScheduleTab project={project} personnelList={personnel} pieceworkTasksList={[]} onUpdate={refresh} onDirtyChange={dirtySetters.workshop} />}
        {tab === 'delivery' && <ProjectStockEntryTab project={project} itemsList={items} onUpdate={refresh} />}
      </div>
    </div>
  );
}
