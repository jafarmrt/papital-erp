import { useCallback, useEffect, useEffectEvent, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { errorMessageOf, formatPersianNumber } from '../utils';
import { QUERY_KEYS } from '../lib/queryKeys';
import { useProjectVersion } from '../hooks/useProjectVersion';
import { invalidateProjectChange } from '../hooks/queries/useProjectQueries';
import { useProjectPermissions } from '../hooks/useProjectPermissions';
import { usePersonnelListQuery } from '../hooks/queries/usePersonnelQueries';
import { useProjectItemOptions, useProjectStepCounts, useWorkspaceProject } from '../hooks/queries/useProjectWorkspaceQueries';
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
import { ProjectPhoneHeader } from '../components/project/phone/ProjectPhoneHeader';
import { ProjectPhoneSummary } from '../components/project/phone/ProjectPhoneSummary';
import { ProjectPhoneProgress } from '../components/project/phone/ProjectPhoneProgress';
import { usePhoneWidth } from '../lib/pwa/usePhoneWidth';

type TabFlagSetter = (on: boolean) => void;
type TabSet = ReadonlySet<ProjectWorkspaceTab>;

/** one setter per tab that adds the tab to a set or takes it out, the same function for the page's whole life */
function tabFlagSetters(setTabs: Dispatch<SetStateAction<TabSet>>): Record<ProjectWorkspaceTab, TabFlagSetter> {
  const setters = {} as Record<ProjectWorkspaceTab, TabFlagSetter>;
  for (const key of PROJECT_WORKSPACE_TABS) {
    setters[key] = (on: boolean) => setTabs(prev => {
      if (prev.has(key) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(key); else next.delete(key);
      return next;
    });
  }
  return setters;
}

/** a tab that starts edits from the project holds one; the progress tab reads its own matrix */
const holdsProject = (tabs: TabSet) => [...tabs].some(t => t !== 'progress');

/**
 * v10.2.1 (10.2 package 2, production projects review U1–U6): a production project is a page, `/projects/<id>/<tab>`,
 * instead of a window over the project list. The address names the tab, so a reload or a copied link opens the same
 * tab and a later notification can link to one; a caller still naming a tab of the window before 10.2 lands on the right one.
 * The step bar says where the project stands; a tab with an unsaved change is marked, and leaving it (another tab, the
 * list, a menu link, the browser's back button, the search or a notification, closing the browser tab) asks first. Only the tab on screen is mounted, so each one starts from the
 * project as the server last saved it.
 * v10.2.9 (10.2 package 10, review «ث»): narrower than 768 px the page has a phone layout: a short header, the
 * summary of the project instead of the first tab and a list per product instead of the progress matrix, both
 * reading the same project and the same tick hook as the desktop; «نمای کامل» shows the desktop layout. Only one
 * layout is built at a time (`usePhoneWidth`).
 * 10.3 (ARCH review finding 3): the project comes from the shared cache (`useWorkspaceProject`), so a save elsewhere
 * (a stock document, the workshop, another tab) refreshes the open page; the tabs take it only while none of them holds
 * an unsaved change and no save is under way (part 9 review), while the header and the step bar show the newest read at
 * once. Each project is its own visit: the page starts again (closed specs, its own read) for another one.
 */
export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  return <ProjectWorkspacePage key={projectId ?? ''} />;
}

function ProjectWorkspacePage() {
  const params = useParams<{ projectId: string; tab?: string }>();
  const projectId = projectIdFromParam(params.projectId);
  const tab = parseProjectWorkspaceTab(params.tab);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canEdit } = useProjectPermissions();
  const [dirtyTabs, setDirtyTabs] = useState<TabSet>(new Set());
  // a tab with an unsaved change or a save under way; the progress tab's also keeps the layout (review M1)
  const [busyTabs, setBusyTabs] = useState<TabSet>(new Set());
  const workspace = useWorkspaceProject(projectId, !holdsProject(dirtyTabs) && !holdsProject(busyTabs));
  const project = workspace.project;
  const latest = workspace.latest;
  const loadError = workspace.missing ? 'پروژه یافت نشد' : (workspace.error ? errorMessageOf(workspace.error) || 'اطلاعات پروژه دریافت نشد' : null);
  const projectVersion = useProjectVersion(project);
  // the header's status change starts from the newest status, and its tokens are those of the project it shows
  const headerVersion = useProjectVersion(latest);
  const [specsOpen, setSpecsOpen] = useState(false);
  const phone = usePhoneWidth();
  const [fullView, setFullView] = useState(false);
  const wantPhoneLayout = phone && !fullView;
  // a phone turned sideways (wider than 768 px) keeps its layout while a tab holds unsaved ticks or edits
  const [phoneLayout, setPhoneLayout] = useState(wantPhoneLayout);
  // the progress tab's ticks not saved or a save under way (review M1): the tab's list exists in one layout only
  const progressBusy = busyTabs.has('progress');
  // read from the address too, so the render before `specsOpen` is set already counts the editor as open (review N1)
  const editingSpecs = canEdit && tab === 'overview' && (specsOpen || searchParams.get('edit') === '1');

  const personnelQuery = usePersonnelListQuery();
  const itemsQuery = useProjectItemOptions(tab === 'materials' || tab === 'delivery');
  const stepCounts = useProjectStepCounts(projectId);

  // an old tab name or an unknown one is replaced by the tab's own address
  useEffect(() => {
    if (projectId === null || params.tab === undefined || params.tab === tab) return;
    void navigate({ pathname: projectWorkspacePath(projectId, tab), search: tab === 'overview' ? searchParams.toString() : '' }, { replace: true });
  }, [navigate, params.tab, projectId, searchParams, tab]);

  /*
   * `?edit=1` (the list's edit button, the header from another tab) only opens the specs editor; the address then drops
   * it at once, before anything is unsaved (review M-A). Kept in the address, a save or a cancel replaced the guard's
   * extra history entry and left the `?edit=1` entry under it, so «back» opened the editor again and then asked about
   * changes nobody made.
   */
  useEffect(() => {
    if (searchParams.get('edit') !== '1') return;
    setSpecsOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('edit');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (tab !== 'overview') setSpecsOpen(false);
  }, [tab]);

  /**
   * after any save: the project, the list, the step bar and every project read refreshed, and the reserved items, since a
   * project's reservations are part of that report (10.3); it ends when this page's project is read again
   */
  const refresh = useCallback(async () => {
    invalidateProjectChange(queryClient);
    if (projectId === null) return;
    await queryClient.refetchQueries({ queryKey: QUERY_KEYS.projects.detail(projectId), exact: true }, { cancelRefetch: false });
  }, [projectId, queryClient]);

  const dirtySetters = useMemo(() => tabFlagSetters(setDirtyTabs), []);
  const busySetters = useMemo(() => tabFlagSetters(setBusyTabs), []);

  // a refresh that fails while the project is on screen is said once; the page keeps what it shows
  const sayRefreshFailed = useEffectEvent(() => {
    if (workspace.project) toast.error(errorMessageOf(workspace.error) || 'اطلاعات تازهٔ پروژه دریافت نشد');
  });
  useEffect(() => {
    if (workspace.failedAt) sayRefreshFailed();
  }, [workspace.failedAt]);

  useUnsavedChangesGuard(dirtyTabs.size > 0);

  /*
   * the layout follows the screen width only once nothing would be lost (review M1): a tab with an unsaved change, or the
   * progress list while its ticks wait or its save runs, keeps the layout it is in; the other layout then mounts its own
   * list after the save, so it reads the matrix as saved
   */
  useEffect(() => {
    if (dirtyTabs.size === 0 && !progressBusy) setPhoneLayout(wantPhoneLayout);
  }, [dirtyTabs.size, progressBusy, wantPhoneLayout]);

  /*
   * «نمای کامل» and back on a phone. The two layouts build the progress tab differently, and the overview tab too unless
   * the specs form is open (the phone shows its summary there), so an unsaved change of either asks first (review nit,
   * delta D1); while the progress save runs the switch waits.
   */
  const progressSaving = tab === 'progress' && progressBusy && !dirtyTabs.has('progress');
  const layoutRebuildsTab = tab === 'progress' || (tab === 'overview' && !editingSpecs);
  const showFullView = async (full: boolean) => {
    if (progressSaving) return;
    if (layoutRebuildsTab && dirtyTabs.has(tab) && !(await confirmLeaveUnsaved())) return;
    setFullView(full);
    setPhoneLayout(phone && !full);
  };

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
    // no history entry of its own: while the form is open «back» is the unsaved-changes question, not a silent close
    setSpecsOpen(true);
  };

  const closeSpecs = useCallback(() => setSpecsOpen(false), []);

  const steps = useMemo(
    () => (latest ? projectSteps(latest, stepCounts.data ?? null, stepCounts.isError) : []),
    [latest, stepCounts.data, stepCounts.isError],
  );

  if (projectId === null || (loadError && !project)) {
    return (
      <div className="p-6 max-w-xl mx-auto text-center space-y-3" role="alert">
        <p className="font-bold text-slate-800">{projectId === null ? 'نشانی پروژه درست نیست.' : loadError}</p>
        <Link to="/projects" className="inline-block px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold">بازگشت به فهرست پروژه‌ها</Link>
      </div>
    );
  }

  if (!project || !latest) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-slate-500" role="status">
        <RefreshCw className="w-5 h-5 animate-spin text-amber-500" aria-hidden="true" />
        <span>در حال بارگذاری پروژه</span>
      </div>
    );
  }

  const shortages = storedReservationShortages(latest.inventory_control).length;
  const badges: Partial<Record<ProjectWorkspaceTab, string>> = {
    overview: latest.stages?.length ? `${formatPersianNumber(latest.stages.filter(s => s.status === 'completed').length)} از ${formatPersianNumber(latest.stages.length)} مرحله` : undefined,
    materials: shortages > 0 ? `${formatPersianNumber(shortages)} کمبود` : undefined,
  };
  const items = itemsQuery.data ?? [];
  const personnel = personnelQuery.data ?? [];

  const onStatusSaved = (res: unknown) => {
    headerVersion.remember(res, ['status']);
    projectVersion.remember(res, ['status']);
    void refresh();
  };
  const inactiveNote = projectInactiveNote(latest.status);

  return (
    <div className="p-3 sm:p-5 space-y-4 font-farsi" dir="rtl">
      {phoneLayout ? (
        <ProjectPhoneHeader
          project={latest}
          writeBase={headerVersion.writeBase}
          canEdit={canEdit}
          editingSpecs={editingSpecs}
          onBack={() => void goBack()}
          onEditSpecs={() => void openSpecs()}
          onStatusSaved={onStatusSaved}
        />
      ) : (
        <>
          {phone && (
            <button type="button" onClick={() => void showFullView(false)} disabled={progressSaving} className="w-full min-h-11 disabled:opacity-60 rounded-xl border border-blue-200 bg-blue-50 text-blue-800 text-xs font-bold cursor-pointer">
              بازگشت به نمای گوشی
            </button>
          )}
          <ProjectWorkspaceHeader
            project={latest}
            writeBase={headerVersion.writeBase}
            canEdit={canEdit}
            editingSpecs={editingSpecs}
            onBack={() => void goBack()}
            onEditSpecs={() => void openSpecs()}
            onStatusSaved={onStatusSaved}
          />
          <ProjectStepsBar steps={steps} onOpenTab={(next) => void goToTab(next)} inactiveNote={inactiveNote} />
        </>
      )}
      <ProjectWorkspaceTabBar active={tab} dirty={dirtyTabs} badges={badges} onSelect={(next) => void goToTab(next)} />
      <div id="project-tab-panel" role="tabpanel" aria-labelledby={`project-tab-${tab}`}>
        {tab === 'overview' && phoneLayout && !editingSpecs && (
          <ProjectPhoneSummary
            project={latest}
            steps={steps}
            inactiveNote={inactiveNote}
            onOpenTab={(next) => void goToTab(next)}
            onShowFull={() => void showFullView(true)}
          />
        )}
        {tab === 'overview' && !(phoneLayout && !editingSpecs) && (
          <ProjectOverviewTab
            project={project}
            writeBase={projectVersion.writeBase}
            rememberVersion={projectVersion.remember}
            personnel={personnel}
            canEdit={canEdit}
            editingSpecs={editingSpecs}
            onCloseSpecs={closeSpecs}
            onChanged={() => void refresh()}
            onDirtyChange={dirtySetters.overview}
          />
        )}
        {tab === 'materials' && <ProjectInventoryTab project={project} itemsList={items} onUpdate={refresh} onDirtyChange={dirtySetters.materials} onBusyChange={busySetters.materials} />}
        {tab === 'progress' && (phoneLayout
          ? <ProjectPhoneProgress projectId={project.id} canEdit={canEdit} onUpdate={refresh} onDirtyChange={dirtySetters.progress} onBusyChange={busySetters.progress} />
          : <ProjectProductProgressTab projectId={project.id} onUpdate={refresh} onDirtyChange={dirtySetters.progress} onBusyChange={busySetters.progress} />)}
        {tab === 'workshop' && <ProjectScheduleTab project={project} onUpdate={refresh} onDirtyChange={dirtySetters.workshop} onBusyChange={busySetters.workshop} />}
        {tab === 'delivery' && <ProjectStockEntryTab project={project} itemsList={items} onUpdate={refresh} />}
      </div>
    </div>
  );
}
