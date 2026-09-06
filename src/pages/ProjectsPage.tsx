import React, { useState, useEffect } from 'react';
import { confirmAction } from '../components/ConfirmDialogHost';
import { Link } from 'react-router-dom';
import { 
  Plus, Search, Filter, Layers, LayoutGrid, List, Calendar, CheckCircle2, 
  Clock, AlertCircle, PlayCircle, ShieldAlert, Edit3, Trash2, Eye,
  ArrowRight, Users, Wrench, ChevronLeft, ChevronRight, RefreshCw, Sparkles, Building, ShoppingCart, Calculator
} from 'lucide-react';
import { ProductionProject, Customer, Item } from '../types';
import { fetchJson } from '../api';
import ProjectModal from '../components/ProjectModal';
import ProjectDetailModal from '../components/ProjectDetailModal';
import toast from 'react-hot-toast';
import { useSearch } from '../SearchContext';

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProductionProject[]>([]);
  const [customersList, setCustomersList] = useState<Customer[]>([]);
  const [itemsList, setItemsList] = useState<Item[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Filters
  const { searchQuery, setSearchQuery } = useSearch();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'kanban' | 'list' | 'gantt'>('kanban');

  // Modals
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [projectToEdit, setProjectToEdit] = useState<ProductionProject | null>(null);

  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState<boolean>(false);
  const [detailInitialTab, setDetailInitialTab] = useState<'overview' | 'inventory' | 'schedule' | 'gantt' | 'stock' | 'product_progress'>('overview');

  const loadInitialData = async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const [projRes, custRes, itemRes] = await Promise.all([
        fetchJson('/projects', { signal }),
        fetchJson('/customers', { signal }),
        fetchJson('/items', { signal })
      ]);

      if (Array.isArray(projRes)) setProjects(projRes);
      
      const rawCust = Array.isArray(custRes) ? custRes : (custRes?.data && Array.isArray(custRes.data) ? custRes.data : []);
      setCustomersList(rawCust);

      const rawItems = Array.isArray(itemRes) ? itemRes : (itemRes?.data && Array.isArray(itemRes.data) ? itemRes.data : []);
      setItemsList(rawItems);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      toast.error('خطا در دریافت اطلاعات پروژه‌ها');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    loadInitialData(controller.signal);
    return () => controller.abort();
  }, []);

  const handleOpenCreateModal = () => {
    setProjectToEdit(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (proj: ProductionProject) => {
    setProjectToEdit(proj);
    setIsModalOpen(true);
  };

  const handleOpenDetailModal = (projId: number, tab: 'overview' | 'inventory' | 'schedule' | 'gantt' | 'stock' | 'product_progress' = 'overview') => {
    setSelectedProjectId(projId);
    setDetailInitialTab(tab);
    setIsDetailOpen(true);
  };

  const handleDeleteProject = async (id: number, code: string) => {
    if (!(await confirmAction({ title: 'حذف پروژه تولید', message: `آیا از حذف پروژه تولید با کد ${code} مطمئن هستید؟` }))) return;

    try {
      const res = await fetchJson(`/projects/${id}`, { method: 'DELETE' });
      if (res && res.success) {
        toast.success('پروژه با موفقیت حذف شد');
        loadInitialData();
      } else {
        toast.error(res?.error || 'خطا در حذف پروژه');
      }
    } catch (err: any) {
      toast.error(err.message || 'خطا در ارتباط با سرور');
    }
  };

  // Filter calculation
  const filteredProjects = projects.filter(p => {
    const matchesSearch = 
      p.project_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.customer_name && p.customer_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (p.item_name && p.item_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (p.item_code && p.item_code.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    const matchesPriority = priorityFilter === 'all' || p.priority === priorityFilter;

    return matchesSearch && matchesStatus && matchesPriority;
  });

  // Summary Statistics
  const totalCount = projects.length;
  const inProgressCount = projects.filter(p => p.status === 'in_progress').length;
  const plannedCount = projects.filter(p => p.status === 'planned').length;
  const completedCount = projects.filter(p => p.status === 'completed').length;

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold text-[10px]">فوری</span>;
      case 'high':
        return <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold text-[10px]">مهم</span>;
      case 'medium':
        return <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-bold text-[10px]">متوسط</span>;
      default:
        return <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-bold text-[10px]">عادی</span>;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[11px] flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> تکمیل شده</span>;
      case 'in_progress':
        return <span className="px-2.5 py-1 rounded-full bg-blue-100 text-blue-800 font-bold text-[11px] flex items-center gap-1"><PlayCircle className="w-3.5 h-3.5" /> در حال انجام</span>;
      case 'paused':
        return <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 font-bold text-[11px] flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> متوقف شده</span>;
      default:
        return <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 font-bold text-[11px] flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> برنامه‌ریزی‌شده</span>;
    }
  };

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

        <button
          onClick={handleOpenCreateModal}
          className="px-5 py-2.5 bg-amber-400 hover:bg-amber-500 text-slate-950 font-bold rounded-2xl transition-all shadow-sm hover:shadow-md flex items-center justify-center gap-2 text-xs"
        >
          <Plus className="w-4 h-4" />
          تعریف پروژه جدید
        </button>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-slate-500 font-bold text-[11px]">کل پروژه‌ها</p>
            <p className="text-xl font-black text-slate-900 font-mono mt-1">{totalCount}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 font-bold flex items-center justify-center">
            <Layers className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-slate-500 font-bold text-[11px]">در حال اجرای تولید</p>
            <p className="text-xl font-black text-blue-600 font-mono mt-1">{inProgressCount}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 font-bold flex items-center justify-center">
            <PlayCircle className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-slate-500 font-bold text-[11px]">برنامه‌ریزی اولیه</p>
            <p className="text-xl font-black text-slate-700 font-mono mt-1">{plannedCount}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 font-bold flex items-center justify-center">
            <Clock className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-slate-500 font-bold text-[11px]">تکمیل شده</p>
            <p className="text-xl font-black text-emerald-600 font-mono mt-1">{completedCount}</p>
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
            <option value="planned">برنامه‌ریزی‌شده</option>
            <option value="in_progress">در حال انجام</option>
            <option value="completed">تکمیل شده</option>
            <option value="paused">متوقف شده</option>
          </select>

          {/* Priority Filter */}
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-xl bg-slate-50/50 font-bold text-slate-700 text-xs focus:outline-none"
          >
            <option value="all">همه اولویت‌ها</option>
            <option value="urgent">فوری (Urgent)</option>
            <option value="high">مهم (High)</option>
            <option value="medium">متوسط (Medium)</option>
            <option value="low">عادی (Low)</option>
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
            زمان‌بندی و گانت
          </button>
        </div>
      </div>

      {/* Main Content Area Based on View Mode */}
      {loading ? (
        <div className="bg-white p-12 rounded-3xl border border-slate-200 text-center text-slate-500 flex flex-col items-center gap-2">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
          <span>در حال دریافت اطلاعات پروژه‌های تولید...</span>
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="bg-white p-12 rounded-3xl border border-slate-200 text-center space-y-3">
          <Layers className="w-12 h-12 text-slate-300 mx-auto" />
          <h3 className="text-sm font-bold text-slate-800">هیچ پروژه تولیدی یافت نشد</h3>
          <p className="text-slate-500 text-xs">برای شروع می‌توانید یک پروژه جدید تعریف کنید.</p>
          <button
            onClick={handleOpenCreateModal}
            className="px-4 py-2 bg-amber-400 hover:bg-amber-500 text-slate-950 font-bold rounded-xl text-xs transition-colors inline-flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            تعریف پروژه جدید
          </button>
        </div>
      ) : viewMode === 'kanban' ? (
        /* KANBAN BOARD VIEW */
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Planned Column */}
          <div className="bg-slate-100/80 p-4 rounded-3xl border border-slate-200 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200/80">
              <span className="font-bold text-slate-800 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-slate-500" />
                برنامه‌ریزی‌شده
              </span>
              <span className="w-5 h-5 rounded-full bg-slate-200 font-bold text-slate-700 flex items-center justify-center text-[10px]">
                {filteredProjects.filter(p => p.status === 'planned').length}
              </span>
            </div>

            <div className="space-y-3">
              {filteredProjects.filter(p => p.status === 'planned').map(p => (
                <ProjectKanbanCard 
                  key={p.id} 
                  project={p} 
                  onDetail={() => handleOpenDetailModal(p.id, 'overview')}
                  onInventory={() => handleOpenDetailModal(p.id, 'inventory')}
                  onProductProgress={() => handleOpenDetailModal(p.id, 'product_progress')}
                  onEdit={() => handleOpenEditModal(p)}
                  onDelete={() => handleDeleteProject(p.id, p.project_code)}
                  priorityBadge={getPriorityBadge(p.priority)}
                />
              ))}
            </div>
          </div>

          {/* In Progress Column */}
          <div className="bg-blue-50/60 p-4 rounded-3xl border border-blue-200/70 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-blue-200">
              <span className="font-bold text-blue-900 flex items-center gap-1.5">
                <PlayCircle className="w-4 h-4 text-blue-600" />
                در حال انجام تولید
              </span>
              <span className="w-5 h-5 rounded-full bg-blue-200 font-bold text-blue-900 flex items-center justify-center text-[10px]">
                {filteredProjects.filter(p => p.status === 'in_progress').length}
              </span>
            </div>

            <div className="space-y-3">
              {filteredProjects.filter(p => p.status === 'in_progress').map(p => (
                <ProjectKanbanCard 
                  key={p.id} 
                  project={p} 
                  onDetail={() => handleOpenDetailModal(p.id, 'overview')}
                  onInventory={() => handleOpenDetailModal(p.id, 'inventory')}
                  onProductProgress={() => handleOpenDetailModal(p.id, 'product_progress')}
                  onEdit={() => handleOpenEditModal(p)}
                  onDelete={() => handleDeleteProject(p.id, p.project_code)}
                  priorityBadge={getPriorityBadge(p.priority)}
                />
              ))}
            </div>
          </div>

          {/* Completed Column */}
          <div className="bg-emerald-50/60 p-4 rounded-3xl border border-emerald-200/70 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-emerald-200">
              <span className="font-bold text-emerald-900 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                تکمیل شده
              </span>
              <span className="w-5 h-5 rounded-full bg-emerald-200 font-bold text-emerald-900 flex items-center justify-center text-[10px]">
                {filteredProjects.filter(p => p.status === 'completed').length}
              </span>
            </div>

            <div className="space-y-3">
              {filteredProjects.filter(p => p.status === 'completed').map(p => (
                <ProjectKanbanCard 
                  key={p.id} 
                  project={p} 
                  onDetail={() => handleOpenDetailModal(p.id, 'overview')}
                  onInventory={() => handleOpenDetailModal(p.id, 'inventory')}
                  onProductProgress={() => handleOpenDetailModal(p.id, 'product_progress')}
                  onEdit={() => handleOpenEditModal(p)}
                  onDelete={() => handleDeleteProject(p.id, p.project_code)}
                  priorityBadge={getPriorityBadge(p.priority)}
                />
              ))}
            </div>
          </div>
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
                    <td className="p-3.5 font-bold text-slate-900">{p.title}</td>
                    <td className="p-3.5 text-slate-700 font-medium">{p.customer_name || '-'}</td>
                    <td className="p-3.5 font-mono font-bold text-slate-800">{p.quantity} {p.unit}</td>
                    <td className="p-3.5 min-w-[140px]">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                          <div 
                            className="h-full bg-blue-600 rounded-full"
                            style={{ width: `${p.progress_percent || 0}%` }}
                          />
                        </div>
                        <span className="font-mono text-[11px] font-bold text-slate-600">{p.progress_percent || 0}%</span>
                      </div>
                    </td>
                    <td className="p-3.5">{getStatusBadge(p.status)}</td>
                    <td className="p-3.5">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => handleOpenDetailModal(p.id, 'overview')}
                          className="px-2.5 py-1 rounded-xl bg-blue-50 text-blue-700 hover:bg-blue-100 font-bold transition-colors cursor-pointer"
                        >
                          مدیریت مراحل
                        </button>
                        <button
                          onClick={() => handleOpenDetailModal(p.id, 'overview')}
                          className="px-2.5 py-1 rounded-xl bg-slate-900 text-amber-300 hover:bg-slate-800 font-bold transition-colors flex items-center gap-1 cursor-pointer"
                          title="مشاهده زنده بهای تمام‌شده و سودآوری"
                        >
                          <Calculator className="w-3.5 h-3.5 text-amber-400" />
                          بهای تمام‌شده
                        </button>
                        <button
                          onClick={() => handleOpenDetailModal(p.id, 'inventory')}
                          className="px-2.5 py-1 rounded-xl bg-amber-50 text-amber-900 hover:bg-amber-100 font-bold transition-colors border border-amber-200/80 flex items-center gap-1 cursor-pointer"
                          title="کنترل موجودی و لیست خرید BOM"
                        >
                          <ShoppingCart className="w-3.5 h-3.5 text-amber-600" />
                          انبار و خرید BOM
                        </button>
                        <button
                          onClick={() => handleOpenDetailModal(p.id, 'product_progress')}
                          className="px-2.5 py-1 rounded-xl bg-emerald-50 text-emerald-900 hover:bg-emerald-100 font-bold transition-colors border border-emerald-200/80 flex items-center gap-1 cursor-pointer"
                          title="پیشرفت به تفکیک هر کد کالا (SKU × مرحله)"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          پیشرفت کدها
                        </button>
                        <button
                          onClick={() => handleOpenEditModal(p)}
                          className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 cursor-pointer"
                          title="ویرایش پروژه"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteProject(p.id, p.project_code)}
                          className="p-1.5 text-rose-500 hover:text-rose-700 rounded-lg hover:bg-rose-50"
                          title="حذف پروژه"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
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
              زمان‌بندی و گانت چارت پروژه‌های تولید
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
                          <span>{stg.progress_percent || 0}%</span>
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

      {/* Project Create/Edit Modal */}
      <ProjectModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        projectToEdit={projectToEdit}
        customersList={customersList}
        itemsList={itemsList}
        onSuccess={loadInitialData}
      />

      {/* Project Detail & Stage Manager Drawer */}
      <ProjectDetailModal
        projectId={selectedProjectId}
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        onUpdate={loadInitialData}
        onEditProject={(p) => {
          setIsDetailOpen(false);
          handleOpenEditModal(p);
        }}
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
  key?: any;
  project: ProductionProject;
  onDetail: () => void;
  onInventory?: () => void;
  onProductProgress?: () => void;
  onEdit: () => void;
  onDelete: () => void;
  priorityBadge: React.ReactNode;
}) {
  return (
    <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs hover:shadow-md transition-all space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-mono font-bold text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200/60">
          {project.project_code}
        </span>
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
        <span className="font-mono font-bold text-slate-900">{project.quantity} {project.unit}</span>
      </div>

      {/* Progress */}
      <div>
        <div className="flex items-center justify-between text-[11px] font-bold mb-1">
          <span className="text-slate-600">پیشرفت کل ({project.completed_stages || 0}/{project.total_stages || 0} مرحله)</span>
          <span className="font-mono text-blue-600">{project.progress_percent || 0}%</span>
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
            onClick={onDetail}
            className="text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2 py-0.5 rounded-lg font-bold text-[10px] flex items-center gap-1 border border-slate-300 cursor-pointer"
            title="بهای تمام‌شده و سودآوری"
          >
            <Calculator className="w-3 h-3 text-amber-600" />
            بهای تمام‌شده
          </button>
          <button
            onClick={onInventory || onDetail}
            className="text-amber-800 hover:text-amber-950 bg-amber-50 hover:bg-amber-100 px-2 py-0.5 rounded-lg font-bold text-[10px] flex items-center gap-1 border border-amber-200 cursor-pointer"
            title="کنترل موجودی و لیست خرید BOM"
          >
            <ShoppingCart className="w-3 h-3 text-amber-600" />
            خرید BOM
          </button>
          {onProductProgress && (
            <button
              onClick={onProductProgress}
              className="text-emerald-800 hover:text-emerald-950 bg-emerald-50 hover:bg-emerald-100 px-2 py-0.5 rounded-lg font-bold text-[10px] flex items-center gap-1 border border-emerald-200 cursor-pointer"
              title="پیشرفت به تفکیک هر کد کالا (SKU × مرحله)"
            >
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              پیشرفت کدها
            </button>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onEdit}
            className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
            title="ویرایش"
          >
            <Edit3 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="p-1 text-rose-400 hover:text-rose-600 rounded-lg"
            title="حذف"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
