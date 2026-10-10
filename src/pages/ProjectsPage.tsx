import React, { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { confirmAction } from '../components/ConfirmDialogHost';
import { 
  Plus, Search, Layers, LayoutGrid, List, Calendar, CheckCircle2,
  Clock, PlayCircle, Edit3, Trash2,
  ChevronLeft, RefreshCw, Building, ShoppingCart,
  Paperclip, Ban
} from 'lucide-react';
import { ProductionProject } from '../types';
import { errorMessageOf, formatPersianNumber } from '../utils';
import { toast } from 'react-hot-toast';
import ProjectModal from '../components/ProjectModal';
import ProjectDetailModal from '../components/ProjectDetailModal';
import { SectionErrorBoundary } from '../components/common';
import { useSearch } from '../SearchContext';
import {
  fetchProjectRecord,
  useProjectListQuery,
  useCustomerOptionsQuery,
  useAllItemsQuery,
  useDeleteProjectMutation,
} from '../hooks/queries';
import { QUERY_KEYS } from '../lib/queryKeys';
import { PROJECT_LIST_PAGE_SIZE, projectStatusCountTotal, type ProjectListFilters, type ProjectListRow } from '../lib/projects/projectList';
import { ProjectListPager } from '../components/project/ProjectListPager';
import { PillBadge, type PillBadgeVariant, type PillBadgeVariants } from '../components/common/PillBadge';
import { useProjectPermissions } from '../hooks/useProjectPermissions';
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, groupProjectsForKanban } from '../lib/projects/projectStatus';

// v7.0.86 (TD-108): نشان اولویت و وضعیت پروژه
const PROJECT_PRIORITY_BASE = 'px-2 py-0.5 rounded font-bold text-[10px]';
const PROJECT_PRIORITY_BADGES: PillBadgeVariants = {
  urgent: { label: 'فوری', className: `${PROJECT_PRIORITY_BASE} bg-rose-100 text-rose-800` },
  high: { label: 'مهم', className: `${PROJECT_PRIORITY_BASE} bg-amber-100 text-amber-800` },
  medium: { label: 'متوسط', className: `${PROJECT_PRIORITY_BASE} bg-blue-100 text-blue-800` },
};
const PROJECT_PRIORITY_FALLBACK: PillBadgeVariant = { label: 'عادی', className: `${PROJECT_PRIORITY_BASE} bg-slate-100 text-slate-700` };
const PROJECT_STATUS_BASE = 'px-2.5 py-1 rounded-full font-bold text-[11px] flex items-center gap-1';
const PROJECT_STATUS_BADGES: PillBadgeVariants = {
  completed: { label: 'تکمیل شده', icon: CheckCircle2, iconClassName: 'w-3.5 h-3.5', className: `${PROJECT_STATUS_BASE} bg-emerald-100 text-emerald-800` },
  in_progress: { label: 'در حال انجام', icon: PlayCircle, iconClassName: 'w-3.5 h-3.5', className: `${PROJECT_STATUS_BASE} bg-blue-100 text-blue-800` },
  paused: { label: 'متوقف شده', icon: Clock, iconClassName: 'w-3.5 h-3.5', className: `${PROJECT_STATUS_BASE} bg-amber-100 text-amber-800` },
  cancelled: { label: 'لغوشده', icon: Ban, iconClassName: 'w-3.5 h-3.5', className: `${PROJECT_STATUS_BASE} bg-rose-100 text-rose-800` },
};
const PROJECT_STATUS_FALLBACK: PillBadgeVariant = { label: 'برنامه‌ریزی‌شده', icon: Clock, iconClassName: 'w-3.5 h-3.5', className: `${PROJECT_STATUS_BASE} bg-slate-100 text-slate-700` };

// v7.0.140: سه ستون کانبان از یک پیکربندی ساخته می‌شوند (پیش‌تر سه بار تکرار شده بود)
const KANBAN_COLUMNS = [
  { status: 'planned', title: 'برنامه‌ریزی‌شده', icon: Clock, iconClassName: 'text-slate-500',
    columnClassName: 'bg-slate-100/80 border-slate-200', headerBorderClassName: 'border-slate-200/80',
    titleClassName: 'text-slate-800', countClassName: 'bg-slate-200 text-slate-700' },
  { status: 'in_progress', title: 'در حال انجام تولید', icon: PlayCircle, iconClassName: 'text-blue-600',
    columnClassName: 'bg-blue-50/60 border-blue-200/70', headerBorderClassName: 'border-blue-200',
    titleClassName: 'text-blue-900', countClassName: 'bg-blue-200 text-blue-900' },
  { status: 'completed', title: 'تکمیل شده', icon: CheckCircle2, iconClassName: 'text-emerald-600',
    columnClassName: 'bg-emerald-50/60 border-emerald-200/70', headerBorderClassName: 'border-emerald-200',
    titleClassName: 'text-emerald-900', countClassName: 'bg-emerald-200 text-emerald-900' },
  // v9.0.418 (TD-761): پروژه متوقف‌شده یا لغوشده در نمای پیش‌فرض دیده می‌شود
  { status: 'stopped', title: 'متوقف / لغوشده', icon: Ban, iconClassName: 'text-rose-600',
    columnClassName: 'bg-rose-50/50 border-rose-200/70', headerBorderClassName: 'border-rose-200',
    titleClassName: 'text-rose-900', countClassName: 'bg-rose-200 text-rose-900' },
] as const;

export default function ProjectsPage() {
  const queryClient = useQueryClient();

  // Filters
  const { searchQuery, debouncedSearchQuery, setSearchQuery } = useSearch();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'kanban' | 'list' | 'gantt'>('kanban');
  const [page, setPage] = useState(1);

  // v9.0.412 (TD-743): صافی‌ها و صفحه‌بندی در سرور؛ صافی تازه از صفحه نخست
  const filters = useMemo<ProjectListFilters>(
    () => ({ search: debouncedSearchQuery, status: statusFilter, priority: priorityFilter }),
    [debouncedSearchQuery, statusFilter, priorityFilter],
  );
  useEffect(() => { setPage(1); }, [filters]);

  const projectsQuery = useProjectListQuery(filters, page, PROJECT_LIST_PAGE_SIZE);
  const customersQuery = useCustomerOptionsQuery();
  const itemsQuery = useAllItemsQuery();
  const deleteProjectMutation = useDeleteProjectMutation();
  // v9.0.417 (TD-752): تعریف، ویرایش و حذف فقط با کلید API خودشان
  const { canCreate, canEdit, canDelete } = useProjectPermissions();

  const projects = useMemo(() => projectsQuery.data?.data ?? [], [projectsQuery.data]);
  const projectTotal = projectsQuery.data?.total ?? 0;
  const statusCounts = projectsQuery.data?.statusCounts ?? {};
  const customersList = customersQuery.data ?? [];
  const itemsList = itemsQuery.data ?? [];
  const loading = projectsQuery.isPending || customersQuery.isPending || itemsQuery.isPending;

  // صفحه‌ای که پس از حذف یا صافی دیگر پروژه‌ای ندارد به صفحه آخر برمی‌گردد
  const lastPage = Math.max(1, Math.ceil(projectTotal / PROJECT_LIST_PAGE_SIZE));
  useEffect(() => {
    if (!projectsQuery.isFetching && page > lastPage) setPage(lastPage);
  }, [projectsQuery.isFetching, page, lastPage]);

  // Modals
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [projectToEdit, setProjectToEdit] = useState<ProductionProject | null>(null);

  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState<boolean>(false);
  const [detailInitialTab, setDetailInitialTab] = useState<'overview' | 'inventory' | 'schedule' | 'gantt' | 'stock' | 'product_progress'>('overview');

  const loadInitialData = () => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.projects.all });
  };

  const handleOpenCreateModal = () => {
    setProjectToEdit(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (proj: ProductionProject) => {
    setProjectToEdit(proj);
    setIsModalOpen(true);
  };

  // v9.0.412 (TD-743): فهرست خلاصه است؛ فرم ویرایش با پرونده کامل و تازه پروژه باز می‌شود
  const handleEditFromList = async (projectId: number) => {
    try {
      handleOpenEditModal(await fetchProjectRecord(queryClient, projectId));
    } catch (err) {
      toast.error(errorMessageOf(err) || 'پرونده پروژه خوانده نشد');
    }
  };

  const handleOpenDetailModal = (projId: number, tab: 'overview' | 'inventory' | 'schedule' | 'gantt' | 'stock' | 'product_progress' = 'overview') => {
    setSelectedProjectId(projId);
    setDetailInitialTab(tab);
    setIsDetailOpen(true);
  };

  const handleDeleteProject = async (id: number, code: string) => {
    if (!(await confirmAction({ title: 'حذف پروژه تولید', message: `آیا از حذف پروژه تولید با کد ${code} مطمئن هستید؟` }))) return;
    // v10.0.92 (TD-1216): the mutation's onError shows a refusal (422); the rejection is not passed on to the click handler
    deleteProjectMutation.mutate(id);
  };

  // Summary Statistics (v9.0.412, TD-743): شمار هر وضعیت از سرور، با صافی‌های جستجو و اولویت
  const totalCount = projectStatusCountTotal(statusCounts);
  const inProgressCount = statusCounts.in_progress ?? 0;
  const plannedCount = statusCounts.planned ?? 0;
  const completedCount = statusCounts.completed ?? 0;
  const filteredProjects = projects;
  const filteredByStatus = useMemo(() => groupProjectsForKanban(projects), [projects]);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6 text-xs animate-fadeIn">
      {/* Top Title Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-slate-900 text-amber-400 font-bold flex items-center justify-center shadow-md shrink-0">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">کنترل پروژه‌های تولید</h1>
            <p className="text-slate-500 text-xs mt-0.5">
              مدیریت سفارشات، تخصیص منابع، زمان‌بندی و پایش پیشرفت مراحل تولید (کاشی، ترنسفر، مونتاژ)
            </p>
          </div>
        </div>

        {canCreate && (
          <button
            onClick={handleOpenCreateModal}
            className="px-5 py-2.5 bg-amber-400 hover:bg-amber-500 text-slate-950 font-bold rounded-2xl transition-all shadow-sm hover:shadow-md flex items-center justify-center gap-2 text-xs"
          >
            <Plus className="w-4 h-4" />
            تعریف پروژه جدید
          </button>
        )}
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-slate-500 font-bold text-[11px]">کل پروژه‌ها</p>
            <p className="text-xl font-black text-slate-900 font-mono mt-1">{formatPersianNumber(totalCount)}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 font-bold flex items-center justify-center">
            <Layers className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-slate-500 font-bold text-[11px]">در حال اجرای تولید</p>
            <p className="text-xl font-black text-blue-600 font-mono mt-1">{formatPersianNumber(inProgressCount)}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 font-bold flex items-center justify-center">
            <PlayCircle className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-slate-500 font-bold text-[11px]">برنامه‌ریزی اولیه</p>
            <p className="text-xl font-black text-slate-700 font-mono mt-1">{formatPersianNumber(plannedCount)}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 font-bold flex items-center justify-center">
            <Clock className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-slate-500 font-bold text-[11px]">تکمیل شده</p>
            <p className="text-xl font-black text-emerald-600 font-mono mt-1">{formatPersianNumber(completedCount)}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 font-bold flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Filter and View Switcher Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Search Box */}
          <div className="relative flex-1 md:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="جستجو (کد پروژه، مشتری، کالا)..."
              className="w-full pl-3 pr-9 py-2 border border-slate-200 rounded-xl bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none text-xs"
            />
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-xl bg-slate-50/50 font-bold text-slate-700 text-xs focus:outline-none"
          >
            <option value="all">همه وضعیت‌ها</option>
            {/* v9.0.418 (TD-761): همه وضعیت‌های فهرست بسته، «لغوشده» هم */}
            {PROJECT_STATUSES.map(s => <option key={s} value={s}>{PROJECT_STATUS_LABELS[s]}</option>)}
          </select>

          {/* Priority Filter */}
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-xl bg-slate-50/50 font-bold text-slate-700 text-xs focus:outline-none"
          >
            <option value="all">همه اولویت‌ها</option>
            <option value="urgent">فوری و اضطراری</option>
            <option value="high">اولویت بالا</option>
            <option value="medium">اولویت متوسط</option>
            <option value="low">عادی و استاندارد</option>
          </select>
        </div>

        {/* View Modes Switcher */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl w-full md:w-auto justify-center">
          <button
            onClick={() => setViewMode('kanban')}
            className={`px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-all ${
              viewMode === 'kanban' 
                ? 'bg-white text-slate-900 shadow-2xs' 
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            تخته کانبان
          </button>

          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-all ${
              viewMode === 'list' 
                ? 'bg-white text-slate-900 shadow-2xs' 
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <List className="w-3.5 h-3.5" />
            جدول لیست
          </button>

          <button
            onClick={() => setViewMode('gantt')}
            className={`px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-all ${
              viewMode === 'gantt' 
                ? 'bg-white text-slate-900 shadow-2xs' 
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            نمودار زمان‌بندی
          </button>
        </div>
      </div>

      {/* Main Content Area Based on View Mode */}
      <SectionErrorBoundary
        resetKeys={[viewMode]}
        onReset={() => loadInitialData()}
        title="خطا در نمایش نمای پروژه‌های تولید"
        description="در پردازش و ترسیم کارت‌ها یا نمودار زمان‌بندی پروژه‌ها مشکلی رخ داده است. می‌توانید دوباره تلاش کنید."
      >
        {loading ? (
        <div className="bg-white p-12 rounded-3xl border border-slate-200 text-center text-slate-500 flex flex-col items-center gap-2">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
          <span>در حال دریافت اطلاعات پروژه‌های تولید...</span>
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="bg-white p-12 rounded-3xl border border-slate-200 text-center space-y-3">
          <Layers className="w-12 h-12 text-slate-300 mx-auto" />
          <h3 className="text-sm font-bold text-slate-800">هیچ پروژه تولیدی یافت نشد</h3>
          {canCreate && (
            <>
              <p className="text-slate-500 text-xs">برای شروع می‌توانید یک پروژه جدید تعریف کنید.</p>
              <button
                onClick={handleOpenCreateModal}
                className="px-4 py-2 bg-amber-400 hover:bg-amber-500 text-slate-950 font-bold rounded-xl text-xs transition-colors inline-flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                تعریف پروژه جدید
              </button>
            </>
          )}
        </div>
      ) : viewMode === 'kanban' ? (
        /* KANBAN BOARD VIEW */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {KANBAN_COLUMNS.map((col) => (
            <div key={col.status} className={`${col.columnClassName} p-4 rounded-3xl border space-y-3`}>
              <div className={`flex items-center justify-between pb-2 border-b ${col.headerBorderClassName}`}>
                <span className={`font-bold ${col.titleClassName} flex items-center gap-1.5`}>
                  <col.icon className={`w-4 h-4 ${col.iconClassName}`} />
                  {col.title}
                </span>
                <span className={`w-5 h-5 rounded-full ${col.countClassName} font-bold flex items-center justify-center text-[10px]`}>
                  {formatPersianNumber(filteredByStatus[col.status].length)}
                </span>
              </div>

              <div className="space-y-3">
                {filteredByStatus[col.status].map(p => (
                  <ProjectKanbanCard
                    key={p.id}
                    project={p}
                    onDetail={() => handleOpenDetailModal(p.id, 'overview')}
                    onInventory={() => handleOpenDetailModal(p.id, 'inventory')}
                    onProductProgress={() => handleOpenDetailModal(p.id, 'product_progress')}
                    onEdit={canEdit ? () => { void handleEditFromList(p.id); } : undefined}
                    onDelete={canDelete ? () => handleDeleteProject(p.id, p.project_code) : undefined}
                    priorityBadge={<PillBadge variants={PROJECT_PRIORITY_BADGES} value={p.priority} fallback={PROJECT_PRIORITY_FALLBACK} />}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : viewMode === 'list' ? (
        /* TABLE LIST VIEW */
        <div className="bg-white rounded-3xl border border-slate-200/80 overflow-hidden shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3.5">کد پروژه</th>
                  <th className="p-3.5">عنوان پروژه</th>
                  <th className="p-3.5">مشتری</th>
                  <th className="p-3.5">تعداد سفارش</th>
                  <th className="p-3.5">پیشرفت مراحل</th>
                  <th className="p-3.5">وضعیت</th>
                  <th className="p-3.5 text-center">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredProjects.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-3.5 font-mono font-bold text-blue-700 ltr text-right">{p.project_code}</td>
                    <td className="p-3.5 font-bold text-slate-900">
                      <div className="flex items-center gap-1.5">
                        <span>{p.title}</span>
                        {p.attachments_count > 0 && (
                          <span 
                            className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold flex items-center gap-0.5 shrink-0"
                            title={`${formatPersianNumber(p.attachments_count)} فایل ضمیمه`}
                          >
                            <Paperclip className="w-2.5 h-2.5" />
                            <span>{formatPersianNumber(p.attachments_count)}</span>
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3.5 text-slate-700 font-medium">{p.customer_name || '-'}</td>
                    <td className="p-3.5 font-mono font-bold text-slate-800">{formatPersianNumber(p.quantity)} {p.unit}</td>
                    <td className="p-3.5 min-w-[140px]">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                          <div 
                            className="h-full bg-blue-600 rounded-full"
                            style={{ width: `${p.progress_percent || 0}%` }}
                          />
                        </div>
                        <span className="font-mono text-[11px] font-bold text-slate-600">{formatPersianNumber(p.progress_percent || 0)}٪</span>
                      </div>
                    </td>
                    <td className="p-3.5"><PillBadge variants={PROJECT_STATUS_BADGES} value={p.status} fallback={PROJECT_STATUS_FALLBACK} /></td>
                    <td className="p-3.5">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => handleOpenDetailModal(p.id, 'overview')}
                          className="px-2.5 py-1 rounded-xl bg-blue-50 text-blue-700 hover:bg-blue-100 font-bold transition-colors cursor-pointer"
                        >
                          مدیریت مراحل
                        </button>
                        <button
                          onClick={() => handleOpenDetailModal(p.id, 'inventory')}
                          className="px-2.5 py-1 rounded-xl bg-amber-50 text-amber-900 hover:bg-amber-100 font-bold transition-colors border border-amber-200/80 flex items-center gap-1 cursor-pointer"
                          title="کنترل موجودی و خرید فهرست مواد"
                        >
                          <ShoppingCart className="w-3.5 h-3.5 text-amber-600" />
                          انبار و خرید فهرست مواد
                        </button>
                        <button
                          onClick={() => handleOpenDetailModal(p.id, 'product_progress')}
                          className="px-2.5 py-1 rounded-xl bg-emerald-50 text-emerald-900 hover:bg-emerald-100 font-bold transition-colors border border-emerald-200/80 flex items-center gap-1 cursor-pointer"
                          title="پیشرفت به تفکیک هر کد کالا (مرحله × محصول)"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          پیشرفت کدها
                        </button>
                        {canEdit && (
                          <button
                            onClick={() => { void handleEditFromList(p.id); }}
                            className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 cursor-pointer"
                            title="ویرایش پروژه"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={() => handleDeleteProject(p.id, p.project_code)}
                            className="p-1.5 text-rose-500 hover:text-rose-700 rounded-lg hover:bg-rose-50"
                            title="حذف پروژه"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* GANTT TIMELINE VIEW */
        <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-2xs space-y-6">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <Calendar className="w-4 h-4 text-amber-500" />
              نمودار زمان‌بندی پروژه‌های تولید
            </h3>
            <span className="text-slate-500 text-xs">نمایش روند زمان‌بندی و مراحل هر پروژه</span>
          </div>

          <div className="space-y-4">
            {filteredProjects.map(p => (
              <div key={p.id} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-blue-700 px-2 py-0.5 bg-blue-100 rounded">
                      {p.project_code}
                    </span>
                    <h4 className="font-bold text-slate-900 text-xs">{p.title}</h4>
                    <span className="text-slate-500 text-[11px]">({p.customer_name})</span>
                  </div>

                  <button
                    onClick={() => handleOpenDetailModal(p.id)}
                    className="text-blue-600 font-bold hover:underline flex items-center gap-1 text-[11px]"
                  >
                    جزئیات فرآیند <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Stages Gantt Bar */}
                {p.stages && p.stages.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2 pt-2 border-t border-slate-200/80">
                    {p.stages.map((stg, idx) => (
                      <div 
                        key={stg.id}
                        className={`p-2.5 rounded-xl border text-right transition-all ${
                          stg.status === 'completed'
                            ? 'bg-emerald-100/70 border-emerald-300 text-emerald-950'
                            : stg.status === 'in_progress'
                            ? 'bg-blue-100/70 border-blue-300 text-blue-950'
                            : 'bg-white border-slate-200 text-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[11px] font-bold">
                          <span>{idx + 1}. {stg.title}</span>
                          <span>{formatPersianNumber(stg.progress_percent || 0)}٪</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden mt-1.5">
                          <div 
                            className={`h-full rounded-full ${stg.status === 'completed' ? 'bg-emerald-600' : 'bg-blue-600'}`}
                            style={{ width: `${stg.progress_percent || 0}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-400 italic text-[11px]">مراحل تعیین نشده است.</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      </SectionErrorBoundary>

      {!loading && projectTotal > 0 && (
        <ProjectListPager page={page} limit={PROJECT_LIST_PAGE_SIZE} total={projectTotal} onPageChange={setPage} />
      )}

      {/* Project Create/Edit Modal */}
      <ProjectModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        projectToEdit={projectToEdit}
        customersList={customersList}
        itemsList={itemsList}
        onSuccess={loadInitialData}
        onOpenStages={(p) => {
          setIsModalOpen(false);
          handleOpenDetailModal(p.id, 'overview');
        }}
      />

      {/* Project Detail & Stage Manager Drawer */}
      <ProjectDetailModal
        projectId={selectedProjectId}
        isOpen={isDetailOpen}
        onClose={() => {
          setIsDetailOpen(false);
          // v9.0.385 (TD-742): زبانه‌های جزئیات نسخه پروژه را بالا برده‌اند؛ فرم ویرایش از فهرست تازه باز می‌شود
          loadInitialData();
        }}
        onUpdate={loadInitialData}
        onEditProject={canEdit ? (p) => {
          setIsDetailOpen(false);
          handleOpenEditModal(p);
        } : undefined}
        initialTab={detailInitialTab}
      />
    </div>
  );
}

function ProjectKanbanCard({
  project,
  onDetail,
  onInventory,
  onProductProgress,
  onEdit,
  onDelete,
  priorityBadge
}: {
  key?: React.Key;
  project: ProjectListRow;
  onDetail: () => void;
  onInventory?: () => void;
  onProductProgress?: () => void;
  /** بی ویرایش یا حذف (نبود مجوز)، دکمه‌اش نشان داده نمی‌شود (TD-752) */
  onEdit?: () => void;
  onDelete?: () => void;
  priorityBadge: React.ReactNode;
}) {
  return (
    <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs hover:shadow-md transition-all space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="font-mono font-bold text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200/60">
            {project.project_code}
          </span>
          {project.attachments_count > 0 && (
            <span 
              className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold flex items-center gap-1"
              title={`${formatPersianNumber(project.attachments_count)} فایل ضمیمه`}
            >
              <Paperclip className="w-2.5 h-2.5" />
              <span>{formatPersianNumber(project.attachments_count)}</span>
            </span>
          )}
        </div>
        {priorityBadge}
      </div>

      <div>
        <h4 className="font-bold text-slate-900 text-xs hover:text-blue-600 cursor-pointer" onClick={onDetail}>
          {project.title}
        </h4>
        <p className="text-slate-500 text-[11px] mt-0.5 flex items-center gap-1">
          <Building className="w-3 h-3 text-slate-400" />
          {project.customer_name || 'بدون مشتری'}
        </p>
      </div>

      <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-center justify-between text-[11px]">
        <span className="text-slate-500 font-bold">میزان سفارش:</span>
        <span className="font-mono font-bold text-slate-900">{formatPersianNumber(project.quantity)} {project.unit}</span>
      </div>

      {/* Progress */}
      <div>
        <div className="flex items-center justify-between text-[11px] font-bold mb-1">
          <span className="text-slate-600">پیشرفت کل ({formatPersianNumber(project.completed_stages || 0)}/{formatPersianNumber(project.total_stages || 0)} مرحله)</span>
          <span className="font-mono text-blue-600">{formatPersianNumber(project.progress_percent || 0)}٪</span>
        </div>
        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
          <div 
            className="h-full bg-blue-600 rounded-full transition-all"
            style={{ width: `${project.progress_percent || 0}%` }}
          />
        </div>
      </div>

      {/* Card Actions */}
      <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5">
          <button
            onClick={onDetail}
            className="text-blue-600 hover:text-blue-800 font-bold text-[11px] flex items-center gap-0.5 cursor-pointer"
          >
            مراحل <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onInventory || onDetail}
            className="text-amber-800 hover:text-amber-950 bg-amber-50 hover:bg-amber-100 px-2 py-0.5 rounded-lg font-bold text-[10px] flex items-center gap-1 border border-amber-200 cursor-pointer"
            title="کنترل موجودی و خرید فهرست مواد"
          >
            <ShoppingCart className="w-3 h-3 text-amber-600" />
            خرید فهرست مواد
          </button>
          {onProductProgress && (
            <button
              onClick={onProductProgress}
              className="text-emerald-800 hover:text-emerald-950 bg-emerald-50 hover:bg-emerald-100 px-2 py-0.5 rounded-lg font-bold text-[10px] flex items-center gap-1 border border-emerald-200 cursor-pointer"
              title="پیشرفت به تفکیک هر کد کالا (مرحله × محصول)"
            >
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              پیشرفت کدها
            </button>
          )}
        </div>

        <div className="flex items-center gap-1">
          {onEdit && (
            <button
              onClick={onEdit}
              className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
              title="ویرایش"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={onDelete}
              className="p-1 text-rose-400 hover:text-rose-600 rounded-lg"
              title="حذف"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
