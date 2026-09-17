import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { 
  ShoppingCart, ArrowRight, Layers, RefreshCw,
  Search, Box,
  BarChart2
} from 'lucide-react';
import { ProductionProject, Item, User } from '../types';
import { fetchJson } from '../api';
import { formatPersianNumber } from '../utils';
import toast from 'react-hot-toast';
import ProjectInventoryTab from '../components/project/ProjectInventoryTab';

export default function ProjectInventoryPage({ user }: { user?: User }) {
  const [searchParams, setSearchParams] = useSearchParams();
  
  const queryProjectId = searchParams.get('projectId');
  const [projects, setProjects] = useState<ProductionProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    queryProjectId ? Number(queryProjectId) : null
  );
  
  const [project, setProject] = useState<ProductionProject | null>(null);
  const [itemsList, setItemsList] = useState<Item[]>([]);
  const [loadingProjects, setLoadingProjects] = useState<boolean>(true);
  const [loadingProjectDetail, setLoadingProjectDetail] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Load list of all production projects
  const loadProjects = async (signal?: AbortSignal) => {
    setLoadingProjects(true);
    try {
      const data = await fetchJson('/projects', { signal });
      const rawList = Array.isArray(data) ? data : (data?.data && Array.isArray(data.data) ? data.data : []);
      setProjects(rawList);

      // If no project selected yet, select the first active or recent project
      if (!selectedProjectId && rawList.length > 0) {
        const firstActive = rawList.find((p: ProductionProject) => p.status !== 'completed') || rawList[0];
        setSelectedProjectId(firstActive.id);
        setSearchParams({ projectId: String(firstActive.id) });
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Error fetching projects:', err);
      toast.error('خطا در بارگذاری لیست پروژه‌ها');
    } finally {
      setLoadingProjects(false);
    }
  };

  // Load full project detail and items list
  const loadProjectDetail = async (id: number, signal?: AbortSignal) => {
    setLoadingProjectDetail(true);
    try {
      const [projData, itemsData] = await Promise.all([
        fetchJson(`/projects/${id}`, { signal }),
        fetchJson('/items', { signal }).catch((err) => {
          if (err?.name === 'AbortError') throw err;
          console.error('Failed to load items in project inventory:', err);
          toast.error('خطا در دریافت لیست اقلام کالا');
          return [];
        })
      ]);

      if (projData && projData.id) {
        setProject(projData);
      } else {
        toast.error('اطلاعات پروژه یافت نشد');
      }

      const rawItems = Array.isArray(itemsData) ? itemsData : (itemsData?.data && Array.isArray(itemsData.data) ? itemsData.data : []);
      setItemsList(rawItems);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Error fetching project detail:', err);
      toast.error('خطا در دریافت اطلاعات پروژه');
    } finally {
      setLoadingProjectDetail(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    loadProjects(controller.signal);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (selectedProjectId) {
      const controller = new AbortController();
      loadProjectDetail(selectedProjectId, controller.signal);
      return () => controller.abort();
    }
  }, [selectedProjectId]);

  const handleSelectProject = (id: number) => {
    setSelectedProjectId(id);
    setSearchParams({ projectId: String(id) });
  };

  // Filter projects for selector dropdown
  const filteredProjects = projects.filter(p => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.title?.toLowerCase().includes(q) ||
      p.project_code?.toLowerCase().includes(q) ||
      p.customer_name?.toLowerCase().includes(q)
    );
  });

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
                برنامه‌ریزی کنترل موجودی، BOM و لیست خرید پروژه
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

        {/* Project Switcher & Search Bar */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center bg-slate-50/80 p-3 rounded-xl border border-slate-200/80">
          <div className="md:col-span-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
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
              <select
                value={selectedProjectId || ''}
                onChange={e => handleSelectProject(Number(e.target.value))}
                className="flex-1 bg-white border border-slate-300 font-bold text-xs text-slate-900 rounded-xl px-3 py-2 focus:ring-2 focus:ring-amber-500 focus:outline-none cursor-pointer shadow-2xs"
              >
                {filteredProjects.map(p => (
                  <option key={p.id} value={p.id}>
                    [{p.project_code}] {p.title} - مشتری: {p.customer_name || 'عمومی'} ({p.status === 'completed' ? 'تکمیل‌شده' : 'در حال انجام'})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Quick Search inside selector */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="فیلتر منوی پروژه‌ها..."
              className="w-full pl-3 pr-9 py-1.5 bg-white border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {loadingProjectDetail ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500 flex flex-col items-center justify-center gap-3">
          <RefreshCw className="w-8 h-8 animate-spin text-amber-600" />
          <span className="font-bold text-sm">در حال بارگذاری ماتریس BOM و اطلاعات کنترل موجودی پروژه...</span>
        </div>
      ) : !project ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500 space-y-3">
          <Box className="w-12 h-12 text-slate-300 mx-auto" />
          <p className="font-bold text-slate-700">هیچ پروژه‌ای انتخاب نشده است.</p>
          <p className="text-xs text-slate-500">لطفاً از منوی بالای صفحه یک پروژه تولیدی انتخاب نمایید.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          {/* Active Project Banner */}
          <div className="mb-6 p-4 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 rounded-2xl text-white flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-md">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="bg-amber-400 text-slate-950 font-black text-[11px] px-2.5 py-0.5 rounded-md font-mono">
                  کد: {project.project_code}
                </span>
                <h2 className="text-base font-bold text-white">{project.title}</h2>
              </div>
              <p className="text-xs text-slate-300">
                مشتری: <span className="text-amber-300 font-bold">{project.customer_name || 'ثبت‌نشده'}</span> | 
                تاریخ تحویل: <span className="font-mono text-slate-200">{project.end_date || 'تعیین نشده'}</span> | 
                تیراژ کل سفارش: <span className="font-mono font-bold text-emerald-400">{formatPersianNumber(project.quantity || 1)} {project.unit || 'عدد'}</span>
              </p>
            </div>

            <div className="flex items-center gap-3 border-t md:border-t-0 border-slate-700 pt-3 md:pt-0">
              <div className="text-right">
                <span className="text-[10px] text-slate-400 font-semibold block">پیشرفت کل پروژه:</span>
                <span className="font-mono font-bold text-amber-400 text-sm">{formatPersianNumber(project.progress_percent || 0)}٪</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-amber-400">
                <BarChart2 size={20} />
              </div>
            </div>
          </div>

          {/* Render Full Project Inventory Tab */}
          <ProjectInventoryTab
            project={project}
            itemsList={itemsList}
            onUpdate={() => selectedProjectId && loadProjectDetail(selectedProjectId)}
          />
        </div>
      )}
    </div>
  );
}
