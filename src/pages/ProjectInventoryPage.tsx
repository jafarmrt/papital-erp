import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { 
  ShoppingCart, ArrowRight, Layers, RefreshCw,
  Box,
  BarChart2
} from 'lucide-react';
import { User } from '../types';
import { errorMessageOf, formatPersianNumber, formatPersianDate, formatPersianCode } from '../utils';
import toast from 'react-hot-toast';
import ProjectInventoryTab from '../components/project/ProjectInventoryTab';
import type { ProjectPick } from '../lib/permissions/pickLists';
import { projectStatusLabel } from '../lib/projects/projectStatus';
import { projectIdFromParam } from '../lib/projects/projectWorkspaceTabs';
import { QUERY_KEYS } from '../lib/queryKeys';
import { invalidateProjectChange, useProjectPickQuery } from '../hooks/queries/useProjectQueries';
import { useProjectItemOptions, useWorkspaceProject } from '../hooks/queries/useProjectWorkspaceQueries';
import { SearchableSelect } from '../components/SearchableSelect';

/**
 * «برنامه‌ریزی کنترل موجودی» of one project on a page of its own, with a project picker.
 * 10.3 (ARCH review finding 3, part 11): the project list, the project and the item list come from the shared cache
 * (`useProjectPickQuery`, `useWorkspaceProject`, `useProjectItemOptions`), so a save elsewhere refreshes the open page.
 * The materials tab takes a newer project only while it holds no unsaved change and no save is under way, as on the
 * project page; each project picked is its own visit (`key`), read again and never shown from an earlier visit.
 */
export default function ProjectInventoryPage(_props: { user?: User }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedProjectId = projectIdFromParam(searchParams.get('projectId') ?? undefined);
  const projectsQuery = useProjectPickQuery();
  const projects: ProjectPick[] = projectsQuery.data ?? [];
  const loadingProjects = projectsQuery.isPending;

  // If no project selected yet, select the first active or recent project
  useEffect(() => {
    if (selectedProjectId || projects.length === 0) return;
    const firstActive = projects.find(p => p.status !== 'completed') || projects[0];
    // the page's own pick replaces the address, so Back leaves the page instead of landing on it again
    setSearchParams({ projectId: String(firstActive.id) }, { replace: true });
  }, [projects, selectedProjectId, setSearchParams]);

  const sayProjectsFailed = useEffectEvent(() => { toast.error('خطا در بارگذاری لیست پروژه‌ها'); });
  useEffect(() => {
    if (projectsQuery.isError) sayProjectsFailed();
  }, [projectsQuery.isError]);

  const handleSelectProject = (id: number) => {
    setSearchParams({ projectId: String(id) });
  };

  // v9.0.423 (TD-767): انتخاب پروژه با فهرست جست‌وجوپذیر؛ برچسب وضعیت از فهرست بسته وضعیت‌ها
  const projectOptions = projects.map(p => ({
    value: p.id,
    label: `[${formatPersianCode(p.project_code)}] ${p.title} - مشتری: ${p.customer_name || 'عمومی'} (${projectStatusLabel(p.status)})`,
  }));

  return (
    <div className="space-y-6 pb-12">
      {/* Header & Navigation Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center shrink-0 shadow-2xs">
              <ShoppingCart size={22} />
            </div>
            <div>
              <h1 className="text-base font-black text-slate-900 flex items-center gap-2">
                برنامه‌ریزی کنترل موجودی، فهرست مواد و خرید پروژه
                <span className="bg-amber-100 text-amber-900 text-[10px] px-2 py-0.5 rounded-full font-bold">صفحه اختصاصی</span>
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                مدیریت کامل و یکپارچه نیازمندی‌های مواد اولیه، لیست خرید تجميعی، تبدیل واحدهای انبارداری و رزرو کالا بدون محدودیت پنجره
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/projects"
              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-colors flex items-center gap-1.5"
            >
              <ArrowRight size={16} />
              بازگشت به لیست پروژه‌ها
            </Link>
          </div>
        </div>

        {/* Project Switcher */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center bg-slate-50/80 p-3 rounded-xl border border-slate-200/80">
          <div className="md:col-span-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <label className="text-xs font-bold text-slate-700 shrink-0 flex items-center gap-1.5">
              <Layers size={16} className="text-blue-600" />
              انتخاب پروژه فعال:
            </label>

            {loadingProjects ? (
              <div className="flex items-center gap-2 text-xs text-slate-500 py-1">
                <RefreshCw className="w-4 h-4 animate-spin text-amber-600" />
                در حال بارگذاری لیست پروژه‌ها...
              </div>
            ) : (
              <SearchableSelect
                className="flex-1"
                value={selectedProjectId || ''}
                onChange={value => { if (value) handleSelectProject(Number(value)); }}
                options={projectOptions}
                placeholder="انتخاب پروژه"
              />
            )}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {selectedProjectId === null
        ? <NoProjectChosen />
        : <ProjectInventoryWorkspace key={selectedProjectId} projectId={selectedProjectId} />}
    </div>
  );
}

function NoProjectChosen() {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500 space-y-3">
      <Box className="w-12 h-12 text-slate-300 mx-auto" />
      <p className="font-bold text-slate-700">هیچ پروژه‌ای انتخاب نشده است.</p>
      <p className="text-xs text-slate-500">لطفاً از منوی بالای صفحه یک پروژه تولیدی انتخاب کنید.</p>
    </div>
  );
}

/** one project's materials planning: its banner and the materials tab, which holds the project while it has an unsaved change */
function ProjectInventoryWorkspace({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const workspace = useWorkspaceProject(projectId, !dirty && !busy);
  const { project, latest } = workspace;
  const itemsQuery = useProjectItemOptions(true);

  /** after a save: the project, the list and every project read refreshed; it ends when this project is read again */
  const refresh = useCallback(async () => {
    invalidateProjectChange(queryClient);
    await queryClient.refetchQueries({ queryKey: QUERY_KEYS.projects.detail(projectId), exact: true }, { cancelRefetch: false });
  }, [projectId, queryClient]);

  // a read that finds no project, or fails, is said once; a failed refresh keeps the project on screen
  const sayMissing = useEffectEvent(() => { toast.error('اطلاعات پروژه یافت نشد'); });
  useEffect(() => {
    if (workspace.missing) sayMissing();
  }, [workspace.missing]);
  const sayReadFailed = useEffectEvent(() => {
    toast.error(project ? errorMessageOf(workspace.error) || 'اطلاعات تازهٔ پروژه دریافت نشد' : 'خطا در دریافت اطلاعات پروژه');
  });
  useEffect(() => {
    if (workspace.failedAt) sayReadFailed();
  }, [workspace.failedAt]);

  if (!project || !latest) {
    if (workspace.missing || workspace.error) return <NoProjectChosen />;
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500 flex flex-col items-center justify-center gap-3">
        <RefreshCw className="w-8 h-8 animate-spin text-amber-600" />
        <span className="font-bold text-sm">در حال بارگذاری فهرست مواد و کنترل موجودی پروژه...</span>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
      {/* Active Project Banner */}
      <div className="mb-6 p-4 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 rounded-2xl text-white flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-md">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="bg-amber-400 text-slate-950 font-black text-[11px] px-2.5 py-0.5 rounded-md font-mono">
              کد: {formatPersianCode(latest.project_code)}
            </span>
            <h2 className="text-base font-bold text-white">{latest.title}</h2>
          </div>
          <p className="text-xs text-slate-300">
            مشتری: <span className="text-amber-300 font-bold">{latest.customer_name || 'ثبت‌نشده'}</span> | 
            تاریخ تحویل: <span className="font-mono text-slate-200">{latest.end_date ? formatPersianDate(latest.end_date) : 'تعیین نشده'}</span> | 
            تیراژ کل سفارش: <span className="font-mono font-bold text-emerald-400">{formatPersianNumber(latest.quantity || 1)} {latest.unit || 'عدد'}</span>
          </p>
        </div>

        <div className="flex items-center gap-3 border-t md:border-t-0 border-slate-700 pt-3 md:pt-0">
          <div className="text-right">
            <span className="text-[10px] text-slate-400 font-semibold block">پیشرفت کل پروژه:</span>
            <span className="font-mono font-bold text-amber-400 text-sm">{formatPersianNumber(latest.progress_percent || 0)}٪</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-amber-400">
            <BarChart2 size={20} />
          </div>
        </div>
      </div>

      {/* Render Full Project Inventory Tab */}
      <ProjectInventoryTab
        project={project}
        itemsList={itemsQuery.data ?? []}
        onUpdate={refresh}
        onDirtyChange={setDirty}
        onBusyChange={setBusy}
      />
    </div>
  );
}
