import React, { useState, useEffect } from 'react';
import { 
  X, Check, Plus, Trash2, Calendar, User, Package, Users, ShieldAlert,
  Layers, ArrowUp, ArrowDown, Clock, CheckCircle2, AlertCircle, PlayCircle,
  Edit3, RefreshCw, ChevronRight, UserPlus, Wrench, MessageSquare, Tag,
  ShoppingCart, BarChart2, CheckSquare, FileText, Maximize2, Minimize2, Sparkles
} from 'lucide-react';
import { ProductionProject, ProjectStage, Item } from '../types';
import { fetchJson } from '../api';
import toast from 'react-hot-toast';
import { toPersianDigits } from '../utils';

// Tab Components
import ProjectInventoryTab from './project/ProjectInventoryTab';
import ProjectScheduleTab from './project/ProjectScheduleTab';
import ProjectGanttTab from './project/ProjectGanttTab';
import ProjectStockEntryTab from './project/ProjectStockEntryTab';
import ProjectProductProgressTab from './project/ProjectProductProgressTab';
import { WorkflowStepperWidget } from './workflow/WorkflowStepperWidget';

interface ProjectDetailModalProps {
  projectId: number | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: () => void;
  onEditProject?: (project: ProductionProject) => void;
  initialTab?: 'overview' | 'inventory' | 'schedule' | 'gantt' | 'stock' | 'product_progress';
}

export default function ProjectDetailModal({
  projectId,
  isOpen,
  onClose,
  onUpdate,
  onEditProject,
  initialTab = 'overview'
}: ProjectDetailModalProps) {
  const [project, setProject] = useState<ProductionProject | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  // Fullscreen state with local storage persistence
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('project_modal_fullscreen');
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });

  const toggleFullscreen = () => {
    setIsFullscreen(prev => {
      const next = !prev;
      try {
        localStorage.setItem('project_modal_fullscreen', String(next));
      } catch {}
      return next;
    });
  };

  // V3.1.0: initialTab صریح پیش‌فرض است — باگ ریست تب حذف شد (useEffect دوم
  // قبلاً به اجبار تب را به overview برمی‌گرداند و درخواست کاربر نادیده گرفته می‌شد)
  const [activeTab, setActiveTab] = useState<'overview' | 'inventory' | 'schedule' | 'gantt' | 'stock' | 'product_progress'>(initialTab);

  useEffect(() => {
    if (initialTab && isOpen) {
      setActiveTab(initialTab);
    }
  }, [initialTab, isOpen]);

  // Backend metadata state
  const [itemsList, setItemsList] = useState<Item[]>([]);
  const [personnelList, setPersonnelList] = useState<any[]>([]);
  const [pieceworkTasksList, setPieceworkTasksList] = useState<any[]>([]);
  const [pricesMap, setPricesMap] = useState<Record<number, any[]>>({});
  const [pieceworkLogs, setPieceworkLogs] = useState<any[]>([]);

  // Stage editing inline state
  const [editingStageId, setEditingStageId] = useState<number | null>(null);
  const [stageTitle, setStageTitle] = useState<string>('');
  const [stageStatus, setStageStatus] = useState<string>('pending');
  const [stageProgress, setStageProgress] = useState<number>(0);
  const [stageStartDate, setStageStartDate] = useState<string>('');
  const [stageEndDate, setStageEndDate] = useState<string>('');
  const [personnelInput, setPersonnelInput] = useState<string>('');
  const [resourcesInput, setResourcesInput] = useState<string>('');
  const [stageNotes, setStageNotes] = useState<string>('');

  const [savingStage, setSavingStage] = useState<boolean>(false);

  const loadProjectData = async (signal?: AbortSignal) => {
    if (!projectId) return;
    setLoading(true);
    try {
      const data = await fetchJson(`/projects/${projectId}`, { signal });
      if (data && data.id) {
        setProject(data);
      } else {
        toast.error('پروژه یافت نشد');
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Failed to load project details:', err);
      toast.error('خطا در دریافت اطلاعات پروژه');
    } finally {
      setLoading(false);
    }
  };

  const loadAuxiliaryData = async (signal?: AbortSignal) => {
    try {
      const [items, personnel, tasks, prices, logs] = await Promise.all([
        fetchJson('/items', { signal }).catch((err) => {
          if (err?.name === 'AbortError') throw err;
          console.error('Failed to load items in project detail modal:', err);
          toast.error('خطا در دریافت لیست کالاها و مواد اولیه');
          return [];
        }),
        fetchJson('/personnel', { signal }).catch((err) => {
          if (err?.name === 'AbortError') throw err;
          console.error('Failed to load personnel in project detail modal:', err);
          toast.error('خطا در دریافت لیست پرسنل');
          return [];
        }),
        fetchJson('/piecework/tasks', { signal }).catch((err) => {
          if (err?.name === 'AbortError') throw err;
          console.error('Failed to load piecework tasks in project detail modal:', err);
          toast.error('خطا در دریافت لیست عناوین کارمزدی');
          return [];
        }),
        fetchJson('/items/prices/all', { signal }).catch(() => ({})),
        fetchJson(`/piecework/logs?projectId=${projectId}`, { signal }).catch(() => [])
      ]);
      const rawItems = Array.isArray(items) ? items : (items?.data && Array.isArray(items.data) ? items.data : []);
      setItemsList(rawItems);
      setPersonnelList(Array.isArray(personnel) ? personnel : []);
      setPieceworkTasksList(Array.isArray(tasks) ? tasks : []);
      setPricesMap(prices && typeof prices === 'object' ? prices : {});
      setPieceworkLogs(Array.isArray(logs) ? logs : []);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Error fetching auxiliary project data:', err);
    }
  };

  useEffect(() => {
    if (isOpen && projectId) {
      const controller = new AbortController();
      loadProjectData(controller.signal);
      loadAuxiliaryData(controller.signal);
      setEditingStageId(null);
      // V3.1.0: دیگر تب به‌اجبار reset نمی‌شود — initialTab از فراخواننده محترم شمرده می‌شود
      return () => controller.abort();
    }
  }, [isOpen, projectId]);

  if (!isOpen || !projectId) return null;

  const handleStartEditStage = (stg: ProjectStage) => {
    setEditingStageId(stg.id);
    setStageTitle(stg.title);
    setStageStatus(stg.status);
    setStageProgress(stg.progress_percent || 0);
    setStageStartDate(stg.start_date || '');
    setStageEndDate(stg.end_date || '');
    setPersonnelInput(Array.isArray(stg.assigned_personnel) ? stg.assigned_personnel.join(', ') : '');
    setResourcesInput(Array.isArray(stg.required_resources) ? stg.required_resources.join(', ') : '');
    setStageNotes(stg.notes || '');
  };

  const handleSaveStage = async (stageId: number) => {
    if (savingStage) return;

    setSavingStage(true);
    try {
      const personnelArray = personnelInput
        .split(',')
        .map(p => p.trim())
        .filter(Boolean);

      const resourcesArray = resourcesInput
        .split(',')
        .map(r => r.trim())
        .filter(Boolean);

      const res = await fetchJson(`/projects/${projectId}/stages/${stageId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: stageTitle,
          status: stageStatus,
          progress_percent: stageProgress,
          start_date: stageStartDate,
          end_date: stageEndDate,
          assigned_personnel: personnelArray,
          required_resources: resourcesArray,
          notes: stageNotes
        })
      });

      if (res && res.id) {
        toast.success('مرحله با موفقیت بروزرسانی گردید');
        setEditingStageId(null);
        await loadProjectData();
        onUpdate();
      } else {
        toast.error(res?.error || 'خطا در ویرایش مرحله');
      }
    } catch (err) {
      toast.error(err.message || 'خطا در ذخیره مرحله');
    } finally {
      setSavingStage(false);
    }
  };

  // V3.1.0: fallback محصولات صادقانه — فقط وقتی کالای اصلی پروژه واقعاً مشخص است؛
  // در غیر این صورت لیست خالی (Empty State) نمایش داده می‌شود نه محصول جعلی.
  const productsList = project && Array.isArray(project.products) && project.products.length > 0
    ? project.products
    : project && project.item_id ? [{
        id: 'prod-main',
        item_id: project.item_id,
        item_code: project.item_code || '',
        item_name: project.item_name || '',
        customer_code: '',
        quantity: project.quantity || 100,
        unit: project.unit || 'عدد',
        needs_assembly: true
      }] : [];

  // Dynamic status styling
  const statusConfig: Record<string, { label: string; bg: string; text: string; border: string }> = {
    planned: { label: 'برنامه‌ریزی‌شده', bg: 'bg-slate-800', text: 'text-slate-200', border: 'border-slate-700' },
    in_progress: { label: 'در حال انجام', bg: 'bg-amber-950/70', text: 'text-amber-300', border: 'border-amber-700/60' },
    completed: { label: 'تکمیل‌شده', bg: 'bg-emerald-950/70', text: 'text-emerald-300', border: 'border-emerald-700/60' },
    paused: { label: 'متوقف‌شده', bg: 'bg-orange-950/70', text: 'text-orange-300', border: 'border-orange-700/60' },
    cancelled: { label: 'لغوشده', bg: 'bg-rose-950/70', text: 'text-rose-300', border: 'border-rose-700/60' }
  };
  const currStatus = project?.status ? statusConfig[project.status] || { label: project.status, bg: 'bg-slate-800', text: 'text-slate-200', border: 'border-slate-700' } : null;

  // Dynamic indicators for tab badges
  const reservedCount = project?.inventory_control?.reservedItems?.length || 0;
  const purchaseCount = project?.inventory_control?.purchaseOrderItems?.length || 0;
  const stagesCount = project?.stages?.length || 0;
  const completedStagesCount = project?.stages?.filter(s => s.status === 'completed').length || project?.completed_stages || 0;
  const productsCount = productsList.length;
  const totalQty = project?.quantity || 0;
  const unit = project?.unit || 'عدد';

  return (
    <div className={
      isFullscreen
        ? "fixed inset-0 z-50 flex flex-col bg-slate-900/90 backdrop-blur-xs w-screen h-screen overflow-hidden animate-fadeIn"
        : "fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 z-50 animate-fadeIn overflow-y-auto"
    }>
      <div className={
        isFullscreen
          ? "w-full h-full flex flex-col overflow-hidden bg-white shadow-none border-none rounded-none"
          : "bg-white rounded-3xl max-w-7xl w-full overflow-hidden shadow-2xl border border-slate-200 my-2 flex flex-col max-h-[96vh]"
      }>
        {/* Modal Header */}
        <div className="bg-slate-900 text-white px-4 py-3 sm:px-6 sm:py-3.5 shrink-0 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-amber-400 text-slate-950 font-bold flex items-center justify-center shadow-md shrink-0">
              <Layers className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-bold text-white truncate">
                  {project?.title || 'در حال بارگذاری پروژه...'}
                </h2>
                {project?.project_code && (
                  <span className="px-2.5 py-0.5 bg-slate-800 text-amber-400 rounded-lg font-mono text-xs font-bold border border-slate-700 shrink-0">
                    {project.project_code}
                  </span>
                )}
                {currStatus && (
                  <span 
                    className={`px-2.5 py-0.5 rounded-lg text-xs font-bold border shrink-0 ${currStatus.bg} ${currStatus.text} ${currStatus.border}`}
                    title={project?.status === 'planned' 
                      ? 'پروژه در وضعیت برنامه‌ریزی است. به محض شروع هر مرحله یا تغییر درصد پیشرفت مراحل کارگاهی، وضعیت پروژه به طور خودکار به «در حال انجام» تغییر می‌یابد.'
                      : project?.status === 'in_progress'
                      ? 'پروژه فعال است و عملیات تولید کارگاهی در حال پیشرفت است.'
                      : undefined
                    }
                  >
                    {currStatus.label}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3 text-xs text-slate-400 mt-1 flex-wrap">
                {project?.customer_name && (
                  <span className="flex items-center gap-1 text-slate-300">
                    <User className="w-3.5 h-3.5 text-amber-400" />
                    <span>مشتری: <strong className="text-white font-medium">{project.customer_name}</strong></span>
                  </span>
                )}
                {project?.end_date && (
                  <span className="flex items-center gap-1 text-slate-300">
                    <Calendar className="w-3.5 h-3.5 text-blue-400" />
                    <span>موعد تحویل: <strong className="text-white font-mono">{toPersianDigits(project.end_date)}</strong></span>
                  </span>
                )}
                {project?.quantity && (
                  <span className="flex items-center gap-1 text-slate-300">
                    <Package className="w-3.5 h-3.5 text-emerald-400" />
                    <span>تیراژ: <strong className="text-white font-mono">{toPersianDigits(project.quantity)} {project.unit || 'عدد'}</strong></span>
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Miniature Physical Progress Bar */}
            {project && (
              <div className="hidden xl:flex items-center gap-2.5 bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700/70">
                <span className="text-xs text-slate-300 font-medium">پیشرفت کل:</span>
                <div className="w-24 bg-slate-700 h-2 rounded-full overflow-hidden">
                  <div 
                    className="bg-amber-400 h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.max(0, project.progress_percent || 0))}%` }}
                  />
                </div>
                <span className="font-mono text-xs font-bold text-amber-400">
                  {toPersianDigits(project.progress_percent || 0)}٪
                </span>
              </div>
            )}

            {/* Fullscreen Workspace Toggle */}
            <button
              type="button"
              onClick={toggleFullscreen}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-bold rounded-xl flex items-center gap-1.5 transition-colors border border-slate-700 cursor-pointer"
              title={isFullscreen ? 'خروج از حالت تمام‌صفحه (نمای پنجره‌ای)' : 'تغییر به فضای کار تمام‌صفحه'}
            >
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5 text-amber-400" /> : <Maximize2 className="w-3.5 h-3.5 text-amber-400" />}
              <span className="hidden sm:inline">{isFullscreen ? 'پنجره‌ای' : 'تمام‌صفحه'}</span>
            </button>

            {onEditProject && project && (
              <button
                type="button"
                onClick={() => onEditProject(project)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-300 hover:text-amber-200 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-colors border border-slate-700 cursor-pointer"
                title="ویرایش مشخصات اصلی پروژه"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">ویرایش پروژه</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-800 hover:bg-rose-900/60 text-slate-300 hover:text-rose-200 flex items-center justify-center transition-colors border border-slate-700"
              title="بستن (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="bg-slate-100 border-b border-slate-200 px-4 pt-2.5 flex items-center gap-1.5 overflow-x-auto shrink-0 custom-scrollbar">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-3.5 py-2.5 rounded-t-2xl font-bold text-xs transition-all flex items-center gap-2 border-t border-x shrink-0 ${
              activeTab === 'overview'
                ? 'bg-white text-slate-900 border-slate-200 shadow-2xs'
                : 'bg-transparent text-slate-600 hover:text-slate-900 border-transparent'
            }`}
          >
            <FileText className="w-4 h-4 text-amber-500 shrink-0" />
            <span>۱. خلاصه و مشخصات</span>
            {stagesCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold bg-slate-200 text-slate-700">
                {toPersianDigits(completedStagesCount)}/{toPersianDigits(stagesCount)}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('inventory')}
            className={`px-3.5 py-2.5 rounded-t-2xl font-bold text-xs transition-all flex items-center gap-2 border-t border-x shrink-0 ${
              activeTab === 'inventory'
                ? 'bg-white text-slate-900 border-slate-200 shadow-2xs'
                : 'bg-transparent text-slate-600 hover:text-slate-900 border-transparent'
            }`}
          >
            <ShoppingCart className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>۲. کنترل موجودی و لیست خرید</span>
            {purchaseCount > 0 ? (
              <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-200 animate-pulse">
                {toPersianDigits(purchaseCount)} قلم کسری
              </span>
            ) : reservedCount > 0 ? (
              <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
                {toPersianDigits(reservedCount)} رزرو شده
              </span>
            ) : null}
          </button>

          <button
            onClick={() => setActiveTab('product_progress')}
            className={`px-3.5 py-2.5 rounded-t-2xl font-bold text-xs transition-all flex items-center gap-2 border-t border-x shrink-0 ${
              activeTab === 'product_progress'
                ? 'bg-white text-slate-900 border-slate-200 shadow-2xs'
                : 'bg-transparent text-slate-600 hover:text-slate-900 border-transparent'
            }`}
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>۳. پیشرفت به تفکیک کد کالا</span>
            {productsCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold bg-slate-200 text-slate-700">
                {toPersianDigits(productsCount)} محصول
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('schedule')}
            className={`px-3.5 py-2.5 rounded-t-2xl font-bold text-xs transition-all flex items-center gap-2 border-t border-x shrink-0 ${
              activeTab === 'schedule'
                ? 'bg-white text-slate-900 border-slate-200 shadow-2xs'
                : 'bg-transparent text-slate-600 hover:text-slate-900 border-transparent'
            }`}
          >
            <Users className="w-4 h-4 text-blue-600 shrink-0" />
            <span>۴. تقسیم کار و دستمزد پرسنل</span>
            {stagesCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold bg-blue-50 text-blue-700 border border-blue-100">
                {toPersianDigits(stagesCount)} مرحله
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('gantt')}
            className={`px-3.5 py-2.5 rounded-t-2xl font-bold text-xs transition-all flex items-center gap-2 border-t border-x shrink-0 ${
              activeTab === 'gantt'
                ? 'bg-white text-slate-900 border-slate-200 shadow-2xs'
                : 'bg-transparent text-slate-600 hover:text-slate-900 border-transparent'
            }`}
          >
            <BarChart2 className="w-4 h-4 text-purple-600 shrink-0" />
            <span>۵. زمان‌بندی (Gantt)</span>
          </button>

          <button
            onClick={() => setActiveTab('stock')}
            className={`px-3.5 py-2.5 rounded-t-2xl font-bold text-xs transition-all flex items-center gap-2 border-t border-x shrink-0 ${
              activeTab === 'stock'
                ? 'bg-white text-slate-900 border-slate-200 shadow-2xs'
                : 'bg-transparent text-slate-600 hover:text-slate-900 border-transparent'
            }`}
          >
            <CheckSquare className="w-4 h-4 text-teal-600 shrink-0" />
            <span>۶. ورود به انبار</span>
            {totalQty > 0 && (
              <span className="px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold bg-teal-50 text-teal-700 border border-teal-100">
                {toPersianDigits(totalQty)} {unit}
              </span>
            )}
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto flex-1 custom-scrollbar">
          {loading || !project ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-amber-500" />
              <span>در حال بارگذاری اطلاعات پروژه...</span>
            </div>
          ) : (
            <>
              {/* Tab 1: Overview */}
              {activeTab === 'overview' && (
                <div className="space-y-6 text-xs animate-fadeIn">
                  {/* Workflow Engine Stepper Widget */}
                  <WorkflowStepperWidget
                    entityType="project"
                    entityId={project.id}
                    workflowCode="PROJECT_WORKFLOW"
                    title={`چرخه و تاییدات پروژه شماره ${project.project_code || project.id}`}
                    onStateChange={loadProjectData}
                  />

                  {/* Top Stats Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 space-y-1">
                      <span className="text-[10px] text-slate-500 font-semibold block">طرف حساب / مشتری:</span>
                      <p className="font-bold text-slate-900">{project.customer_name || 'ثبت‌نشده (عمومی)'}</p>
                    </div>

                    <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 space-y-1">
                      <span className="text-[10px] text-slate-500 font-semibold block">پیشرفت کل پروژه:</span>
                      <p className="font-bold font-mono text-amber-700 text-sm">{project.progress_percent || 0}٪</p>
                    </div>

                    <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 space-y-1">
                      <span className="text-[10px] text-slate-500 font-semibold block">تاریخ شروع و تحویل:</span>
                      <p className="font-bold font-mono text-slate-800">
                        {project.start_date || '؟'} تا {project.end_date || '؟'}
                      </p>
                    </div>

                    <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 space-y-1">
                      <span className="text-[10px] text-slate-500 font-semibold block">تعداد کدهای محصول:</span>
                      <p className="font-bold text-blue-700">{productsList.length} کد محصول</p>
                    </div>
                  </div>

                  {/* Products Table */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-2xs">
                    <h3 className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                      <Package className="w-4 h-4 text-amber-600" />
                      لیست محصولات و کدهای مشتری در این پروژه
                    </h3>

                    <div className="overflow-x-auto">
                      <table className="w-full text-right text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                            <th className="p-2.5">#</th>
                            <th className="p-2.5">کالای انبار (سیستم)</th>
                            <th className="p-2.5">کد اختصاصی مشتری</th>
                            <th className="p-2.5 text-center">تیراژ هدف</th>
                            <th className="p-2.5 text-center">مرحله مونتاژ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {productsList.map((p, idx) => (
                            <tr key={p.id || idx} className="hover:bg-slate-50">
                              <td className="p-2.5 font-bold text-slate-400">{idx + 1}</td>
                              <td className="p-2.5 font-bold text-slate-900">
                                {p.item_name} {p.item_code && <span className="font-mono text-slate-500 text-[11px]">[{p.item_code}]</span>}
                              </td>
                              <td className="p-2.5 font-mono font-bold text-amber-800">
                                {p.customer_code || 'ثبت‌نشده'}
                              </td>
                              <td className="p-2.5 text-center font-mono font-bold text-slate-800">
                                {p.quantity} {p.unit}
                              </td>
                              <td className="p-2.5 text-center">
                                {p.needs_assembly !== false ? (
                                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold text-[10px]">دارد</span>
                                ) : (
                                  <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded font-semibold text-[10px]">ندارد (رد شده)</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Stages List */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-2xs">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <h3 className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                        <Layers className="w-4 h-4 text-blue-600" />
                        مراحل فرآیند کنترل پروژه و کارگاه ({toPersianDigits(project.stages?.length || 0)} مرحله)
                      </h3>
                      <span className="text-[11px] text-blue-700 font-medium bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-100 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                        پیشرفت و وضعیت مراحل به‌طور خودکار بر اساس ماتریس «پیشرفت به تفکیک کد کالا» محاسبه می‌شود
                      </span>
                    </div>

                    <div className="space-y-3">
                      {(project.stages || []).map((stg) => {
                        const isEditing = editingStageId === stg.id;
                        const statusColors: Record<string, { label: string; bg: string; text: string }> = {
                          pending: { label: 'در انتظار شروع', bg: 'bg-slate-100', text: 'text-slate-700' },
                          in_progress: { label: 'در حال انجام', bg: 'bg-amber-100', text: 'text-amber-800' },
                          completed: { label: 'تکمیل‌شده', bg: 'bg-emerald-100', text: 'text-emerald-800' },
                          blocked: { label: 'متوقف / مانع', bg: 'bg-rose-100', text: 'text-rose-800' }
                        };
                        const stageStatusInfo = statusColors[stg.status] || { label: stg.status, bg: 'bg-slate-100', text: 'text-slate-700' };
                        const compSkus = stg.completed_skus_count ?? stg.completedSkusCount;
                        const appSkus = stg.applicable_skus_count ?? stg.applicableSkusCount;

                        return (
                          <div key={stg.id} className={`rounded-xl border transition-all ${isEditing ? 'border-blue-400 bg-blue-50/40 p-4 ring-2 ring-blue-100' : 'border-slate-200 bg-slate-50 p-3'}`}>
                            {/* Normal summary view */}
                            {!isEditing ? (
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <span className="w-7 h-7 rounded-lg bg-slate-900 text-amber-400 font-bold flex items-center justify-center text-xs shrink-0 shadow-xs">
                                    {toPersianDigits(stg.stage_order || stg.id)}
                                  </span>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-bold text-slate-900 text-xs">{stg.title}</span>
                                      <span className={`px-2 py-0.5 rounded-md font-bold text-[10px] ${stageStatusInfo.bg} ${stageStatusInfo.text}`}>
                                        {stageStatusInfo.label}
                                      </span>
                                      {appSkus !== undefined && appSkus > 0 && (
                                        <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-100 font-semibold text-[10px] flex items-center gap-1">
                                          <span>تکمیل‌شده:</span>
                                          <strong className="font-mono">{toPersianDigits(compSkus || 0)}</strong>
                                          <span>از</span>
                                          <strong className="font-mono">{toPersianDigits(appSkus)} SKU</strong>
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5 flex-wrap">
                                      {stg.assigned_personnel && stg.assigned_personnel.length > 0 && (
                                        <span>پرسنل: {stg.assigned_personnel.join('، ')}</span>
                                      )}
                                      {stg.start_date && (
                                        <span>• شروع: {toPersianDigits(stg.start_date)}</span>
                                      )}
                                      {stg.end_date && (
                                        <span>• پایان: {toPersianDigits(stg.end_date)}</span>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                                  <div className="flex items-center gap-1.5 min-w-[70px]">
                                    <div className="w-16 bg-slate-200 rounded-full h-2 overflow-hidden">
                                      <div 
                                        className={`h-full transition-all ${stg.progress_percent >= 100 ? 'bg-emerald-500' : stg.progress_percent > 0 ? 'bg-amber-500' : 'bg-slate-300'}`} 
                                        style={{ width: `${Math.min(100, Math.max(0, stg.progress_percent || 0))}%` }} 
                                      />
                                    </div>
                                    <span className="font-mono font-bold text-slate-700 text-xs">{toPersianDigits(stg.progress_percent || 0)}٪</span>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => handleStartEditStage(stg)}
                                    className="px-3 py-1.5 bg-white border border-slate-300 hover:border-blue-500 hover:bg-blue-50 text-blue-700 font-bold text-xs rounded-lg transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
                                  >
                                    <Edit3 className="w-3.5 h-3.5 text-blue-600" />
                                    <span>ویرایش زمان‌بندی و پرسنل</span>
                                  </button>
                                </div>
                              </div>
                            ) : (
                              /* Inline editing form */
                              <div className="space-y-3">
                                <div className="flex items-center justify-between border-b border-blue-200 pb-2">
                                  <div className="flex items-center gap-2">
                                    <span className="w-6 h-6 rounded-md bg-blue-600 text-white font-bold flex items-center justify-center text-xs">
                                      {toPersianDigits(stg.stage_order || stg.id)}
                                    </span>
                                    <span className="font-bold text-slate-900 text-xs">ویرایش اطلاعات مرحله: {stg.title}</span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setEditingStageId(null)}
                                    className="text-slate-400 hover:text-slate-600 p-1"
                                    title="انصراف"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                                  <div>
                                    <label className="block text-[11px] font-bold text-slate-700 mb-1">عنوان مرحله</label>
                                    <input
                                      type="text"
                                      value={stageTitle}
                                      onChange={(e) => setStageTitle(e.target.value)}
                                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-bold text-slate-900 bg-white"
                                    />
                                  </div>

                                  <div className="bg-slate-100 border border-slate-200 rounded-xl p-2.5 space-y-1 sm:col-span-2">
                                    <div className="flex items-center justify-between">
                                      <label className="text-[11px] font-bold text-slate-700">وضعیت و درصد پیشرفت مرحله</label>
                                      <span className="text-[10px] bg-blue-100 text-blue-800 px-2 py-0.5 rounded-md font-bold flex items-center gap-1">
                                        <Sparkles className="w-3 h-3 text-blue-600" />
                                        محاسبه خودکار از پیشرفت SKUها
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between pt-1">
                                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${stageStatusInfo.bg} ${stageStatusInfo.text}`}>
                                        {stageStatusInfo.label}
                                      </span>
                                      <span className="font-mono font-bold text-slate-900 text-xs">{toPersianDigits(stageProgress)}٪</span>
                                    </div>
                                    <p className="text-[10px] text-slate-500 pt-0.5">
                                      * درصد پیشرفت و وضعیت بر اساس تکمیل کد کالاها در بخش «پیشرفت به تفکیک کد کالا» خودکار تنظیم می‌شود.
                                    </p>
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                                  <div>
                                    <label className="block text-[11px] font-bold text-slate-700 mb-1">پرسنل مسئول (با ویرگول)</label>
                                    <input
                                      type="text"
                                      value={personnelInput}
                                      onChange={(e) => setPersonnelInput(e.target.value)}
                                      placeholder="مثال: علی احمدی، مریم رضایی"
                                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900 bg-white"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-[11px] font-bold text-slate-700 mb-1">تاریخ شروع</label>
                                    <input
                                      type="text"
                                      value={stageStartDate}
                                      onChange={(e) => setStageStartDate(e.target.value)}
                                      placeholder="۱۴۰۳/۰۶/۱۵"
                                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-mono text-slate-900 bg-white"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-[11px] font-bold text-slate-700 mb-1">تاریخ پایان / تحویل</label>
                                    <input
                                      type="text"
                                      value={stageEndDate}
                                      onChange={(e) => setStageEndDate(e.target.value)}
                                      placeholder="۱۴۰۳/۰۶/۲۰"
                                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-mono text-slate-900 bg-white"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-[11px] font-bold text-slate-700 mb-1">یادداشت و نکات مرحله</label>
                                    <input
                                      type="text"
                                      value={stageNotes}
                                      onChange={(e) => setStageNotes(e.target.value)}
                                      placeholder="توضیحات تکمیلی..."
                                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900 bg-white"
                                    />
                                  </div>
                                </div>

                                <div className="flex items-center justify-end gap-2 pt-2 border-t border-blue-200">
                                  <button
                                    type="button"
                                    onClick={() => setEditingStageId(null)}
                                    disabled={savingStage}
                                    className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg font-bold text-xs"
                                  >
                                    انصراف
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleSaveStage(stg.id)}
                                    disabled={savingStage}
                                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-sm"
                                  >
                                    {savingStage ? (
                                      <>
                                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                        <span>در حال ذخیره...</span>
                                      </>
                                    ) : (
                                      <>
                                        <Check className="w-3.5 h-3.5" />
                                        <span>ذخیره تغییرات مرحله</span>
                                      </>
                                    )}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 2: Inventory Control */}
              {activeTab === 'inventory' && (
                <ProjectInventoryTab 
                  project={project} 
                  itemsList={itemsList} 
                  onUpdate={loadProjectData} 
                />
              )}

              {/* Tab 2.5: SKU×Stage Progress Matrix (V3.1.0) */}
              {activeTab === 'product_progress' && (
                <ProjectProductProgressTab
                  projectId={project.id}
                  onUpdate={loadProjectData}
                />
              )}

              {/* Tab 3: Personnel Schedule & Division */}
              {activeTab === 'schedule' && (
                <ProjectScheduleTab 
                  project={project} 
                  personnelList={personnelList} 
                  pieceworkTasksList={pieceworkTasksList} 
                  onUpdate={loadProjectData} 
                />
              )}

              {/* Tab 4: Gantt Chart */}
              {activeTab === 'gantt' && (
                <ProjectGanttTab project={project} />
              )}

              {/* Tab 5: Warehouse Stock Entry */}
              {activeTab === 'stock' && (
                <ProjectStockEntryTab 
                  project={project} 
                  itemsList={itemsList}
                  onUpdate={loadProjectData} 
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
