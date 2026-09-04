import React, { useState, useEffect } from 'react';
import { 
  X, Check, Plus, Trash2, Calendar, User, Package, Users, ShieldAlert,
  Layers, ArrowUp, ArrowDown, Clock, CheckCircle2, AlertCircle, PlayCircle,
  Edit3, RefreshCw, ChevronRight, UserPlus, Wrench, MessageSquare, Tag,
  ShoppingCart, BarChart2, CheckSquare, FileText
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
import { ProjectCostSummaryWidget } from './project/ProjectCostSummaryWidget';
import { WorkflowStepperWidget } from './workflow/WorkflowStepperWidget';

interface ProjectDetailModalProps {
  projectId: number | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: () => void;
  onEditProject?: (project: ProductionProject) => void;
  initialTab?: 'overview' | 'inventory' | 'schedule' | 'gantt' | 'stock';
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
  const [activeTab, setActiveTab] = useState<'overview' | 'inventory' | 'schedule' | 'gantt' | 'stock'>(initialTab);

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
      setActiveTab('overview');
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

  const productsList = project && Array.isArray(project.products) && project.products.length > 0
    ? project.products
    : project ? [{
        id: 'prod-1',
        item_id: project.item_id || null,
        item_code: project.item_code || '',
        item_name: project.item_name || 'محصول اصلی',
        customer_code: '',
        quantity: project.quantity || 100,
        unit: project.unit || 'عدد',
        needs_assembly: true
      }] : [];

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 animate-fadeIn overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-5xl w-full overflow-hidden shadow-2xl border border-slate-200 my-4 flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="bg-slate-900 text-white p-5 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-400 text-slate-950 font-bold flex items-center justify-center shadow-md">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">
                  {project?.title || 'در حال بارگذاری پروژه...'}
                </h2>
                {project?.project_code && (
                  <span className="px-2.5 py-0.5 bg-slate-800 text-amber-400 rounded-lg font-mono text-xs font-bold border border-slate-700">
                    {project.project_code}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                سیستم جامع کنترل پروژه تولید، کنترل موجودی، تقسیم کار پرسنل و تحویل به انبار
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onEditProject && project && (
              <button
                type="button"
                onClick={() => onEditProject(project)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-300 hover:text-amber-200 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-colors border border-slate-700 cursor-pointer"
                title="ویرایش مشخصات اصلی پروژه"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>ویرایش پروژه</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="bg-slate-100 border-b border-slate-200 px-4 pt-2 flex items-center gap-1 overflow-x-auto shrink-0 custom-scrollbar">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2.5 rounded-t-2xl font-bold text-xs transition-all flex items-center gap-2 border-t border-x shrink-0 ${
              activeTab === 'overview'
                ? 'bg-white text-slate-900 border-slate-200 shadow-2xs'
                : 'bg-transparent text-slate-600 hover:text-slate-900 border-transparent'
            }`}
          >
            <FileText className="w-4 h-4 text-amber-500" />
            ۱. خلاصه و مشخصات
          </button>

          <button
            onClick={() => setActiveTab('inventory')}
            className={`px-4 py-2.5 rounded-t-2xl font-bold text-xs transition-all flex items-center gap-2 border-t border-x shrink-0 ${
              activeTab === 'inventory'
                ? 'bg-white text-slate-900 border-slate-200 shadow-2xs'
                : 'bg-transparent text-slate-600 hover:text-slate-900 border-transparent'
            }`}
          >
            <ShoppingCart className="w-4 h-4 text-emerald-600" />
            ۲. کنترل موجودی و لیست خرید
          </button>

          <button
            onClick={() => setActiveTab('schedule')}
            className={`px-4 py-2.5 rounded-t-2xl font-bold text-xs transition-all flex items-center gap-2 border-t border-x shrink-0 ${
              activeTab === 'schedule'
                ? 'bg-white text-slate-900 border-slate-200 shadow-2xs'
                : 'bg-transparent text-slate-600 hover:text-slate-900 border-transparent'
            }`}
          >
            <Users className="w-4 h-4 text-blue-600" />
            ۳. تقسیم کار و دستمزد پرسنل
          </button>

          <button
            onClick={() => setActiveTab('gantt')}
            className={`px-4 py-2.5 rounded-t-2xl font-bold text-xs transition-all flex items-center gap-2 border-t border-x shrink-0 ${
              activeTab === 'gantt'
                ? 'bg-white text-slate-900 border-slate-200 shadow-2xs'
                : 'bg-transparent text-slate-600 hover:text-slate-900 border-transparent'
            }`}
          >
            <BarChart2 className="w-4 h-4 text-purple-600" />
            ۴. زمان‌بندی (Gantt)
          </button>

          <button
            onClick={() => setActiveTab('stock')}
            className={`px-4 py-2.5 rounded-t-2xl font-bold text-xs transition-all flex items-center gap-2 border-t border-x shrink-0 ${
              activeTab === 'stock'
                ? 'bg-white text-slate-900 border-slate-200 shadow-2xs'
                : 'bg-transparent text-slate-600 hover:text-slate-900 border-transparent'
            }`}
          >
            <CheckSquare className="w-4 h-4 text-teal-600" />
            ۵. ورود به انبار
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

                  {/* Live Cost & Profitability Summary Widget */}
                  <ProjectCostSummaryWidget
                    project={project}
                    itemsList={itemsList}
                    pricesMap={pricesMap}
                    pieceworkLogs={pieceworkLogs}
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
                    <h3 className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-blue-600" />
                      مراحل فرآیند کنترل پروژه و کارگاه ({toPersianDigits(project.stages?.length || 0)} مرحله)
                    </h3>

                    <div className="space-y-2">
                      {(project.stages || []).map((stg) => (
                        <div key={stg.id} className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-lg bg-slate-900 text-amber-400 font-bold flex items-center justify-center text-xs">
                              {stg.stage_order || stg.id}
                            </span>
                            <span className="font-bold text-slate-900">{stg.title}</span>
                          </div>

                          <div className="flex items-center gap-3">
                            <span className="font-mono font-bold text-amber-800">{stg.progress_percent || 0}٪</span>
                            <button
                              onClick={() => handleStartEditStage(stg)}
                              className="px-2.5 py-1 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-slate-700 font-bold text-[11px] flex items-center gap-1"
                            >
                              <Edit3 className="w-3.5 h-3.5 text-blue-600" />
                              ویرایش وضعیت
                            </button>
                          </div>
                        </div>
                      ))}
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
