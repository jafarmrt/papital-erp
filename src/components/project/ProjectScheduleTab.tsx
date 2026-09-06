import React, { useState, useEffect } from 'react';
import { 
  Users, Calendar, Clock, Plus, Trash2, Check, RefreshCw, 
  Wrench, Layers, Tag, DollarSign, Calculator, HelpCircle,
  Sparkles, Search, UserCheck, X, FileSpreadsheet, Shield,
  CheckCircle2, Coins, TrendingUp, Briefcase, ChevronDown, ChevronUp
} from 'lucide-react';
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import { 
  ProductionProject, ProjectStage, ProjectProductItem, 
  TaskAssignmentItem, ProductStageSchedule, ProjectStageSchedulesMap 
} from '../../types';
import { fetchJson } from '../../api';
import { DEFAULT_WORKFLOW_PRESETS, WorkflowPreset, StageTaskTemplate } from '../../constants/presets';
import { extractDateString, formatPersianPrice } from '../../utils';
import { useAppCurrency } from '../../hooks/useAppCurrency';
import toast from 'react-hot-toast';

interface ProjectScheduleTabProps {
  project: ProductionProject;
  personnelList: any[];
  pieceworkTasksList: any[];
  onUpdate: () => void;
}

export default function ProjectScheduleTab({
  project,
  personnelList: initialPersonnelList = [],
  pieceworkTasksList: initialPieceworkTasksList = [],
  onUpdate
}: ProjectScheduleTabProps) {
  const appCurrency = useAppCurrency();
  const [saving, setSaving] = useState<boolean>(false);
  const [personnelList, setPersonnelList] = useState<any[]>(initialPersonnelList);
  const [pieceworkTasksList, setPieceworkTasksList] = useState<any[]>(initialPieceworkTasksList);
  const [workflowPresets, setWorkflowPresets] = useState<WorkflowPreset[]>(DEFAULT_WORKFLOW_PRESETS);

  // State for Personnel Picker Modal
  const [pickingTarget, setPickingTarget] = useState<{
    stageId: number;
    productId: string;
    taskIdx: number;
  } | null>(null);
  const [personnelSearch, setPersonnelSearch] = useState<string>('');

  // State for Piecework Logs integration
  const [recordedLogs, setRecordedLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState<boolean>(false);
  const [loggingTaskId, setLoggingTaskId] = useState<string | null>(null);
  const [batchLoggingStageId, setBatchLoggingStageId] = useState<number | null>(null);

  // Load latest presets and personnel if missing
  useEffect(() => {
    const controller = new AbortController();
    const loadPresetsAndPersonnel = async () => {
      try {
        const [settingsRes, personnelRes, tasksRes] = await Promise.all([
          fetchJson('/settings', { signal: controller.signal }).catch((err) => {
            if (err?.name === 'AbortError') throw err;
            console.error('Failed to load settings in schedule tab:', err);
            return [];
          }),
          initialPersonnelList.length === 0
            ? fetchJson('/personnel', { signal: controller.signal }).catch((err) => {
                if (err?.name === 'AbortError') throw err;
                console.error('Failed to load personnel in schedule tab:', err);
                toast.error('خطا در دریافت لیست پرسنل');
                return [];
              })
            : Promise.resolve(initialPersonnelList),
          initialPieceworkTasksList.length === 0
            ? fetchJson('/piecework/tasks', { signal: controller.signal }).catch((err) => {
                if (err?.name === 'AbortError') throw err;
                console.error('Failed to load piecework tasks in schedule tab:', err);
                toast.error('خطا در دریافت لیست عناوین کارمزدی');
                return [];
              })
            : Promise.resolve(initialPieceworkTasksList)
        ]);

        if (Array.isArray(settingsRes)) {
          const presetsSetting = settingsRes.find((s: any) => s.key === 'project_workflow_presets');
          if (presetsSetting && presetsSetting.value) {
            try {
              const parsed = JSON.parse(presetsSetting.value);
              if (Array.isArray(parsed) && parsed.length > 0) {
                setWorkflowPresets(parsed);
              }
            } catch (e) {
              console.error('Error parsing workflow presets setting', e);
            }
          }
        }

        if (Array.isArray(personnelRes) && personnelRes.length > 0) {
          setPersonnelList(personnelRes);
        }
        if (Array.isArray(tasksRes) && tasksRes.length > 0) {
          setPieceworkTasksList(tasksRes);
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.error('Error loading schedule tab dependencies:', err);
        toast.error('خطا در دریافت وابستگی‌های زمان‌بندی پروژه');
      }
    };

    loadPresetsAndPersonnel();
    return () => controller.abort();
  }, []);

  // Update local personnel / tasks state when props change
  useEffect(() => {
    if (initialPersonnelList && initialPersonnelList.length > 0) {
      setPersonnelList(initialPersonnelList);
    }
  }, [initialPersonnelList]);

  useEffect(() => {
    if (initialPieceworkTasksList && initialPieceworkTasksList.length > 0) {
      setPieceworkTasksList(initialPieceworkTasksList);
    }
  }, [initialPieceworkTasksList]);

  // Stages list
  // V3.1.0: مراحل ساختگی حذف شد — Empty State صادقانه
  const stages: ProjectStage[] = (Array.isArray(project.stages) ? project.stages : []) as any;

  // Products list — V3.1.0: fallback فقط با کالای واقعی پروژه
  const products: ProjectProductItem[] = Array.isArray(project.products) && project.products.length > 0
    ? project.products
    : project.item_id ? [{
        id: 'prod-main',
        item_id: project.item_id,
        item_code: project.item_code || '',
        item_name: project.item_name || '',
        customer_code: '',
        quantity: project.quantity || 100,
        unit: project.unit || 'عدد',
        needs_assembly: true
      }] : [];

  // Map of schedules: stageId -> { productId -> ProductStageSchedule }
  const [schedulesMap, setSchedulesMap] = useState<ProjectStageSchedulesMap>({});

  useEffect(() => {
    if (project.stage_schedules) {
      setSchedulesMap(project.stage_schedules);
    } else {
      // Initialize map for each stage and product
      const initialMap: ProjectStageSchedulesMap = {};
      stages.forEach(stg => {
        initialMap[stg.id] = {};
        products.forEach(p => {
          initialMap[stg.id][p.id] = {
            productId: p.id,
            productCode: p.item_code || '',
            productName: p.item_name || '',
            customerCode: p.customer_code || '',
            startDate: project.start_date || '',
            endDate: project.end_date || '',
            assignedPersonnel: [],
            tasks: []
          };
        });
      });
      setSchedulesMap(initialMap);
    }
  }, [project]);

  const getProductSchedule = (stageId: number, productId: string): ProductStageSchedule => {
    return schedulesMap[stageId]?.[productId] || {
      productId,
      productCode: '',
      productName: '',
      customerCode: '',
      startDate: '',
      endDate: '',
      assignedPersonnel: [],
      tasks: []
    };
  };

  const updateProductSchedule = (
    stageId: number, 
    productId: string, 
    updater: (prev: ProductStageSchedule) => ProductStageSchedule
  ) => {
    setSchedulesMap(prevMap => {
      const stageObj = { ...(prevMap[stageId] || {}) };
      const current = stageObj[productId] || {
        productId,
        productCode: '',
        productName: '',
        customerCode: '',
        startDate: '',
        endDate: '',
        assignedPersonnel: [],
        tasks: []
      };
      stageObj[productId] = updater(current);
      return { ...prevMap, [stageId]: stageObj };
    });
  };

  // Find default tasks for a stage from workflow presets
  const findStageDefaultTasks = (stageTitle: string): StageTaskTemplate[] => {
    for (const preset of workflowPresets) {
      if (Array.isArray(preset.stages)) {
        for (const stgItem of preset.stages) {
          if (typeof stgItem === 'object' && stgItem !== null) {
            if (stgItem.title.trim() === stageTitle.trim() && Array.isArray(stgItem.defaultTasks)) {
              return stgItem.defaultTasks;
            }
          }
        }
      }
    }
    return [];
  };

  // Apply default tasks from preset to all eligible products in this stage
  const handleApplyStagePreset = (stageId: number, stageTitle: string) => {
    const defaultTasks = findStageDefaultTasks(stageTitle);
    
    if (defaultTasks.length === 0) {
      toast.error(`الگوی عناوین کاری پیش‌فرضی برای مرحله «${stageTitle}» در تنظیمات تعریف نشده است.`);
      return;
    }

    let addedCount = 0;

    products.forEach(p => {
      const isAssemblyStage = stageTitle.includes('مونتاژ');
      if (isAssemblyStage && p.needs_assembly === false) return;

      const newTasksToAdd: TaskAssignmentItem[] = defaultTasks.map((dt, idx) => ({
        id: `task-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 4)}`,
        taskId: dt.taskId || null,
        taskTitle: dt.taskTitle,
        assignedPersonnelId: null,
        assignedPersonnelName: '',
        quantity: p.quantity || 100,
        unit: dt.unit || p.unit || 'عدد',
        defaultRate: dt.defaultRate || 0,
        estimatedCost: (p.quantity || 100) * (dt.defaultRate || 0),
        startDate: project.start_date || '',
        endDate: project.end_date || '',
        status: 'pending'
      }));

      updateProductSchedule(stageId, p.id, prev => ({
        ...prev,
        tasks: [...(prev.tasks || []), ...newTasksToAdd]
      }));

      addedCount += newTasksToAdd.length;
    });

    toast.success(`الگوی «${stageTitle}» با موفقیت اعمال شد (${addedCount} عنوان کاری جدید اضافه شد).`);
  };

  // Add a task under a specific stage & product
  const handleAddTask = (stageId: number, productId: string) => {
    const prod = products.find(p => p.id === productId);
    updateProductSchedule(stageId, productId, prev => ({
      ...prev,
      tasks: [
        ...(prev.tasks || []),
        {
          id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          taskId: null,
          taskTitle: '',
          assignedPersonnelId: null,
          assignedPersonnelName: '',
          quantity: prod?.quantity || 100,
          unit: prod?.unit || 'عدد',
          defaultRate: 0,
          estimatedCost: 0,
          startDate: prev.startDate || project.start_date || '',
          endDate: prev.endDate || project.end_date || '',
          status: 'pending'
        }
      ]
    }));
  };

  const handleUpdateTask = (
    stageId: number, 
    productId: string, 
    taskIdx: number, 
    field: string, 
    val: any
  ) => {
    updateProductSchedule(stageId, productId, prev => {
      const taskList = [...(prev.tasks || [])];
      const t = { ...taskList[taskIdx], [field]: val };

      if (field === 'taskId') {
        const found = pieceworkTasksList.find(pt => pt.id === Number(val));
        if (found) {
          t.taskId = found.id;
          t.taskTitle = found.title;
          t.defaultRate = found.default_rate || 0;
          t.unit = found.unit || 'عدد';
          t.estimatedCost = (t.quantity || 0) * (t.defaultRate || 0);
        }
      }

      if (field === 'assignedPersonnelId') {
        const foundP = personnelList.find(p => p.id === Number(val));
        if (foundP) {
          t.assignedPersonnelId = foundP.id;
          const nameStr = foundP.fullName || `${foundP.firstName || foundP.first_name || ''} ${foundP.lastName || foundP.last_name || ''}`.trim() || foundP.name || '';
          t.assignedPersonnelName = nameStr;
        } else {
          t.assignedPersonnelId = null;
          t.assignedPersonnelName = '';
        }
      }

      if (field === 'quantity' || field === 'defaultRate') {
        t.estimatedCost = (Number(t.quantity) || 0) * (Number(t.defaultRate) || 0);
      }

      taskList[taskIdx] = t;
      return { ...prev, tasks: taskList };
    });
  };

  const handleRemoveTask = (stageId: number, productId: string, taskIdx: number) => {
    updateProductSchedule(stageId, productId, prev => ({
      ...prev,
      tasks: (prev.tasks || []).filter((_, i) => i !== taskIdx)
    }));
  };

  // Select personnel from picker modal
  const handleAssignPersonnel = (person: any | null) => {
    if (!pickingTarget) return;
    const { stageId, productId, taskIdx } = pickingTarget;

    if (!person) {
      handleUpdateTask(stageId, productId, taskIdx, 'assignedPersonnelId', null);
    } else {
      handleUpdateTask(stageId, productId, taskIdx, 'assignedPersonnelId', person.id);
    }

    setPickingTarget(null);
    setPersonnelSearch('');
  };

  // Fetch piecework logs recorded for this project
  const fetchProjectPieceworkLogs = async () => {
    if (!project.id) return;
    setLoadingLogs(true);
    try {
      const res = await fetchJson<any[]>(`/piecework/logs?projectId=${project.id}`);
      const list = Array.isArray(res) ? res : ((res as any)?.data || []);
      setRecordedLogs(list);
    } catch (err) {
      console.error('Failed to load project piecework logs:', err);
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    fetchProjectPieceworkLogs();
  }, [project.id]);

  // Log single task to Piecework Logs
  const handleLogSingleTaskToPiecework = async (
    stageId: number,
    productId: string,
    taskIdx: number,
    task: TaskAssignmentItem
  ) => {
    if (!task.assignedPersonnelId) {
      toast.error('لطفاً ابتدا پرسنل مجری را برای این وظیفه تعیین کنید.');
      return;
    }
    if (!task.taskId) {
      toast.error('لطفاً یک عنوان کارمزدی معتبر از لیست انتخاب کنید.');
      return;
    }
    if (!task.quantity || task.quantity <= 0) {
      toast.error('تعداد کارکرد باید بزرگتر از صفر باشد.');
      return;
    }

    const taskKey = task.id || `${stageId}-${productId}-${taskIdx}`;
    setLoggingTaskId(taskKey);

    try {
      const payload = {
        items: [
          {
            personnelId: task.assignedPersonnelId,
            taskId: task.taskId,
            projectId: project.id,
            date: task.startDate || new Date().toLocaleDateString('fa-IR'),
            quantity: Number(task.quantity),
            unitRate: Number(task.defaultRate) || 0,
            notes: `کارکرد پروژه ${project.project_code || project.title} - ${task.taskTitle}`
          }
        ]
      };

      const res = await fetchJson<{ status: string; insertedCount?: number }>('/piecework/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res?.status === 'ok' || (res as any)?.insertedCount) {
        toast.success(`کارکرد «${task.taskTitle}» برای ${task.assignedPersonnelName || 'پرسنل'} در ماژول کارمزدی ثبت شد.`);

        // Mark task as logged
        updateProductSchedule(stageId, productId, prev => {
          const tasks = [...(prev.tasks || [])];
          if (tasks[taskIdx]) {
            tasks[taskIdx] = { ...tasks[taskIdx], isLoggedToPiecework: true };
          }
          return { ...prev, tasks };
        });

        fetchProjectPieceworkLogs();
      }
    } catch (err: any) {
      toast.error(err.message || 'خطا در ثبت کارکرد کارمزدی');
    } finally {
      setLoggingTaskId(null);
    }
  };

  // Batch log all unlogged tasks in a stage
  const handleBatchLogStageTasks = async (stageId: number, stageTitle: string) => {
    const stageSchedules = schedulesMap[stageId] || {};
    const itemsToLog: any[] = [];
    const targetsToUpdate: { productId: string; taskIdx: number }[] = [];

    Object.entries(stageSchedules).forEach(([prodId, pSched]) => {
      const schedule = pSched as ProductStageSchedule;
      (schedule?.tasks || []).forEach((t, idx) => {
        if (t.assignedPersonnelId && t.taskId && Number(t.quantity) > 0 && !t.isLoggedToPiecework) {
          itemsToLog.push({
            personnelId: t.assignedPersonnelId,
            taskId: t.taskId,
            projectId: project.id,
            date: t.startDate || new Date().toLocaleDateString('fa-IR'),
            quantity: Number(t.quantity),
            unitRate: Number(t.defaultRate) || 0,
            notes: `کارکرد مرحله «${stageTitle}» پروژه ${project.project_code || project.title} - ${t.taskTitle}`
          });
          targetsToUpdate.push({ productId: prodId, taskIdx: idx });
        }
      });
    });

    if (itemsToLog.length === 0) {
      toast.error('هیچ وظیفه ثبت‌نشده‌ای با پرسنل و عنوان کارمزدی معتبر در این مرحله یافت نشد.');
      return;
    }

    setBatchLoggingStageId(stageId);
    try {
      const res = await fetchJson<{ status: string; insertedCount?: number }>('/piecework/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: itemsToLog })
      });

      if (res?.status === 'ok' || (res as any)?.insertedCount) {
        toast.success(`تعداد ${itemsToLog.length} رکورد کارکرد برای مرحله «${stageTitle}» با موفقیت ثبت شد.`);

        // Mark all these tasks as logged
        setSchedulesMap(prev => {
          const next = { ...prev };
          const stg = { ...(next[stageId] || {}) };
          targetsToUpdate.forEach(({ productId, taskIdx }) => {
            if (stg[productId]?.tasks?.[taskIdx]) {
              stg[productId] = {
                ...stg[productId],
                tasks: stg[productId].tasks!.map((tk, i) => i === taskIdx ? { ...tk, isLoggedToPiecework: true } : tk)
              };
            }
          });
          next[stageId] = stg;
          return next;
        });

        fetchProjectPieceworkLogs();
      }
    } catch (err: any) {
      toast.error(err.message || 'خطا در ثبت گروهی کارکردها');
    } finally {
      setBatchLoggingStageId(null);
    }
  };

  // Calculate total personnel costs across all stages and products
  let totalLaborBudget = 0;
  const personnelBudgetMap: Record<string, number> = {};

  Object.values(schedulesMap).forEach(prodMap => {
    Object.values(prodMap).forEach(sched => {
      (sched.tasks || []).forEach(t => {
        const cost = Number(t.estimatedCost) || 0;
        totalLaborBudget += cost;
        if (t.assignedPersonnelName) {
          personnelBudgetMap[t.assignedPersonnelName] = (personnelBudgetMap[t.assignedPersonnelName] || 0) + cost;
        }
      });
    });
  });

  const handleSaveSchedules = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetchJson(`/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage_schedules: schedulesMap
        })
      });

      if (res && res.id) {
        toast.success('برنامه‌ریزی کارگاه و تخصیص پرسنل با موفقیت ذخیره شد');
        onUpdate();
      } else {
        toast.error(res?.error || 'خطا در ذخیره‌سازی برنامه‌ریزی');
      }
    } catch (err) {
      toast.error(err.message || 'خطا در ارتباط با سرور');
    } finally {
      setSaving(false);
    }
  };

  // Filtered personnel list for modal search
  const filteredPersonnel = personnelList.filter(p => {
    const searchLower = personnelSearch.trim().toLowerCase();
    if (!searchLower) return true;
    const nameStr = (p.fullName || `${p.firstName || p.first_name || ''} ${p.lastName || p.last_name || ''} ${p.name || ''}`).toLowerCase();
    const jobStr = (p.jobTitle || p.job_title || p.role || '').toLowerCase();
    const codeStr = (p.personnelCode || p.personnel_code || '').toLowerCase();
    return nameStr.includes(searchLower) || jobStr.includes(searchLower) || codeStr.includes(searchLower);
  });

  return (
    <div className="space-y-6 text-xs animate-fadeIn font-farsi">
      {/* Top Budget Summary Banner */}
      <div className="bg-slate-900 text-white p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg border border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-amber-400 text-slate-950 font-bold flex items-center justify-center shrink-0">
            <Calculator className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-amber-300">تقسیم کار، الگوهای کارگاهی و دستمزد پرسنل</h3>
            <p className="text-slate-400 text-[11px] mt-0.5">
              تعریف پویای وظایف، اعمال الگوهای پیش‌فرض، انتخاب پرسنل مجری و زمان‌بندی تقویمی
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 border-t sm:border-t-0 sm:border-r border-slate-800 pt-2 sm:pt-0 sm:pr-4">
          <div>
            <span className="text-[10px] text-slate-400 block">برآورد کل دستمزد:</span>
            <span className="text-base font-bold font-mono text-emerald-400">
              {formatPersianPrice(totalLaborBudget, appCurrency)}
            </span>
          </div>

          <button
            onClick={handleSaveSchedules}
            disabled={saving}
            className="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-all shadow-md disabled:opacity-50 shrink-0 cursor-pointer"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            ذخیره برنامه‌ریزی
          </button>
        </div>
      </div>

      {/* Breakdown per Stage */}
      <div className="space-y-5">
        {stages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-slate-400 gap-1.5 text-center">
            <Users className="w-7 h-7 text-slate-300" />
            <p className="font-bold text-slate-600">هیچ مرحله‌ای برای تقسیم کار وجود ندارد</p>
            <p className="text-[11px]">ابتدا مراحل پروژه را تعریف کنید (از پریست گردش کار در تنظیمات یا افزودن مرحله در تب خلاصه).</p>
          </div>
        ) : stages.map((stg) => {
          const isAssemblyStage = stg.title.includes('مونتاژ');
          const defaultTasksForStage = findStageDefaultTasks(stg.title);

          return (
            <div key={stg.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
              {/* Stage Header */}
              <div className="p-3 bg-slate-100 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-slate-900 text-amber-400 font-bold flex items-center justify-center text-xs">
                    {stg.stage_order || stg.id}
                  </div>
                  <h4 className="font-bold text-slate-900 text-xs">{stg.title}</h4>
                  <span className="text-[11px] text-slate-500 font-semibold bg-white px-2 py-0.5 rounded-md border border-slate-200">
                    {products.length} محصول
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {/* Batch Register Piecework Button */}
                  <button
                    type="button"
                    onClick={() => handleBatchLogStageTasks(stg.id, stg.title)}
                    disabled={batchLoggingStageId === stg.id}
                    className="px-2.5 py-1 text-[11px] font-bold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-lg flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                    title="ثبت یکباره تمامی وظایف پرسنل‌دار این مرحله به عنوان کارکرد کارمزدی"
                  >
                    {batchLoggingStageId === stg.id ? (
                      <RefreshCw className="w-3 h-3 text-emerald-600 animate-spin" />
                    ) : (
                      <Coins className="w-3 h-3 text-emerald-600" />
                    )}
                    <span>ثبت گروهی کارکرد مرحله</span>
                  </button>

                  {/* Preset Template Apply Button */}
                  <button
                    type="button"
                    onClick={() => handleApplyStagePreset(stg.id, stg.title)}
                    className="px-2.5 py-1 text-[11px] font-bold text-indigo-900 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                    title="اعمال الگو و عناوین کاری تعریف‌شده در تنظیمات برای این مرحله"
                  >
                    <Sparkles className="w-3 h-3 text-indigo-600" />
                    بارگذاری الگوی عناوین کاری {defaultTasksForStage.length > 0 ? `(${defaultTasksForStage.length} کار)` : ''}
                  </button>
                </div>
              </div>

              {/* Products in this stage */}
              <div className="p-4 space-y-4 divide-y divide-slate-100">
                {products.map((p) => {
                  const isSkippedAssembly = isAssemblyStage && p.needs_assembly === false;
                  const sched = getProductSchedule(stg.id, p.id);

                  if (isSkippedAssembly) {
                    return (
                      <div key={p.id} className="pt-2 text-slate-400 italic text-[11px] flex items-center gap-2">
                        <Tag className="w-3.5 h-3.5 text-slate-300" />
                        محصول <strong>{p.item_name}</strong> (کد: {p.customer_code || p.item_code}) نیاز به مرحله مونتاژ ندارد (رد شده).
                      </div>
                    );
                  }

                  return (
                    <div key={p.id} className="pt-3 first:pt-0 space-y-3">
                      {/* Product Banner */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-800 text-xs">{p.item_name}</span>
                          {p.customer_code && (
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-mono text-[10px] font-bold">
                              کد مشتری: {p.customer_code}
                            </span>
                          )}
                          <span className="text-[11px] text-slate-500 font-mono">
                            ({p.quantity} {p.unit})
                          </span>
                        </div>

                        {/* Date Pickers for product in stage */}
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex items-center gap-1 text-[11px] text-slate-600">
                            <Calendar className="w-3.5 h-3.5 text-blue-600" />
                            <span>از:</span>
                            <DatePicker
                              value={sched.startDate || ''}
                              onChange={(val: any) => {
                                const formatted = extractDateString(val);
                                updateProductSchedule(stg.id, p.id, prev => ({ ...prev, startDate: formatted }));
                              }}
                              calendar={persian}
                              locale={persian_fa}
                              calendarPosition="bottom-right"
                              placeholder="شروع..."
                              inputClass="w-26 px-2 py-0.5 border border-slate-300 rounded-lg font-mono text-center text-xs bg-white cursor-pointer focus:ring-1 focus:ring-amber-500"
                              containerClassName="inline-block"
                            />
                          </div>

                          <div className="flex items-center gap-1 text-[11px] text-slate-600">
                            <span>تا:</span>
                            <DatePicker
                              value={sched.endDate || ''}
                              onChange={(val: any) => {
                                const formatted = extractDateString(val);
                                updateProductSchedule(stg.id, p.id, prev => ({ ...prev, endDate: formatted }));
                              }}
                              calendar={persian}
                              locale={persian_fa}
                              calendarPosition="bottom-right"
                              placeholder="تحویل..."
                              inputClass="w-26 px-2 py-0.5 border border-slate-300 rounded-lg font-mono text-center text-xs bg-white cursor-pointer focus:ring-1 focus:ring-amber-500"
                              containerClassName="inline-block"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Tasks List */}
                      <div className="space-y-2 pr-2">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-700 text-[11px] flex items-center gap-1">
                            <Wrench className="w-3.5 h-3.5 text-amber-600" />
                            عناوین کاری و پرسنل مجری ({sched.tasks?.length || 0} آیتم)
                          </span>
                          <button
                            type="button"
                            onClick={() => handleAddTask(stg.id, p.id)}
                            className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold text-[10px] rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                            افزودن کار دستی
                          </button>
                        </div>

                        {sched.tasks && sched.tasks.length > 0 ? (
                          <div className="space-y-2">
                            {sched.tasks.map((task, tIdx) => {
                              const assignedPerson = personnelList.find(pl => pl.id === task.assignedPersonnelId);

                              return (
                                <div key={task.id || tIdx} className="p-2.5 bg-white border border-slate-200 rounded-xl grid grid-cols-1 sm:grid-cols-12 gap-2 items-center shadow-2xs hover:border-slate-300 transition-colors">
                                  {/* Piecework Task Select / Custom Input */}
                                  <div className="sm:col-span-4 flex items-center gap-1">
                                    <select
                                      value={task.taskId ? String(task.taskId) : ''}
                                      onChange={(e) => handleUpdateTask(stg.id, p.id, tIdx, 'taskId', e.target.value)}
                                      className="w-full px-2 py-1 border border-slate-300 rounded-lg text-xs font-semibold focus:ring-1 focus:ring-amber-500 bg-white"
                                    >
                                      <option value="">-- انتخاب از عناوین کارمزدی --</option>
                                      {pieceworkTasksList.map((pt) => (
                                        <option key={pt.id} value={pt.id}>
                                          {pt.title} 
                                        </option>
                                      ))}
                                    </select>
                                    {!task.taskId && (
                                      <input
                                        type="text"
                                        value={task.taskTitle || ''}
                                        onChange={(e) => handleUpdateTask(stg.id, p.id, tIdx, 'taskTitle', e.target.value)}
                                        placeholder="یا عنوان دستی..."
                                        className="w-full px-2 py-1 border border-slate-300 rounded-lg text-xs"
                                      />
                                    )}
                                  </div>

                                  {/* Personnel Selection Button (Triggers Rich Personnel List Modal) */}
                                  <div className="sm:col-span-3">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setPickingTarget({ stageId: stg.id, productId: p.id, taskIdx: tIdx });
                                        setPersonnelSearch('');
                                      }}
                                      className={`w-full px-2.5 py-1.5 rounded-lg border text-xs font-semibold flex items-center justify-between transition-colors cursor-pointer ${
                                        task.assignedPersonnelId 
                                          ? 'bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100' 
                                          : 'bg-slate-50 border-slate-300 text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                                      }`}
                                    >
                                      <span className="truncate flex items-center gap-1.5">
                                        <Users size={13} className={task.assignedPersonnelId ? 'text-amber-600' : 'text-slate-400'} />
                                        {task.assignedPersonnelName || 'انتخاب مسئول / مجری...'}
                                      </span>
                                      <span className="text-[10px] bg-white px-1.5 py-0.5 rounded border border-slate-200 shrink-0">
                                        تغییر
                                      </span>
                                    </button>
                                  </div>

                                  {/* Qty & Rate */}
                                  <div className="sm:col-span-2 flex items-center gap-1">
                                    <input
                                      type="number"
                                      min="1"
                                      value={task.quantity}
                                      onChange={(e) => handleUpdateTask(stg.id, p.id, tIdx, 'quantity', Number(e.target.value) || 0)}
                                      placeholder="تعداد"
                                      className="w-full px-1.5 py-1 border border-slate-300 rounded text-center font-mono text-xs"
                                    />
                                    <span className="text-[10px] text-slate-500 shrink-0">{task.unit || 'عدد'}</span>
                                  </div>

                                  {/* Estimated Cost & Piecework Action */}
                                  <div className="sm:col-span-2 flex items-center justify-between gap-1">
                                    <span className="font-mono font-bold text-emerald-700 text-xs">
                                      {formatPersianPrice(task.estimatedCost || 0, appCurrency)}
                                    </span>
                                    
                                    {/* Action to log to piecework */}
                                    {task.isLoggedToPiecework ? (
                                      <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[10px] font-bold flex items-center gap-0.5" title="در کارکرد کارمزدی ثبت شده است">
                                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                        <span>ثبت‌شده</span>
                                      </span>
                                    ) : (
                                      <button
                                        type="button"
                                        disabled={!task.assignedPersonnelId || !task.taskId || loggingTaskId === (task.id || `${stg.id}-${p.id}-${tIdx}`)}
                                        onClick={() => handleLogSingleTaskToPiecework(stg.id, p.id, tIdx, task)}
                                        className="px-1.5 py-0.5 bg-amber-100 hover:bg-amber-200 text-amber-900 disabled:opacity-30 rounded text-[10px] font-bold flex items-center gap-0.5 transition-colors cursor-pointer"
                                        title={task.assignedPersonnelId ? "ثبت این قلم در کارتابل کارمزد پرسنل" : "ابتدا پرسنل را انتخاب کنید"}
                                      >
                                        {loggingTaskId === (task.id || `${stg.id}-${p.id}-${tIdx}`) ? (
                                          <RefreshCw className="w-3 h-3 animate-spin text-amber-700" />
                                        ) : (
                                          <Coins className="w-3 h-3 text-amber-700" />
                                        )}
                                        <span>ثبت کارمزد</span>
                                      </button>
                                    )}
                                  </div>

                                  {/* Delete */}
                                  <div className="sm:col-span-1 text-center">
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveTask(stg.id, p.id, tIdx)}
                                      className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg cursor-pointer transition-colors"
                                      title="حذف این وظیفه"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-[11px] text-slate-400 italic py-1">
                            هنوز کارمزدی برای این محصول در این مرحله تعریف نشده است. جهت بارگذاری سریع می‌توانید از دکمه «بارگذاری الگوی عناوین کاری» استفاده کنید.
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Recorded Piecework Logs Summary & Audit Panel */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4 shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-700 flex items-center justify-center font-bold">
              <Briefcase className="w-4 h-4" />
            </div>
            <div>
              <h4 className="font-bold text-slate-900 text-xs sm:text-sm flex items-center gap-2">
                کارمزدهای قطعی ثبت‌شده برای این پروژه در ماژول حقوق و دستمزد
                <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md text-[11px] font-mono font-bold">
                  {recordedLogs.length} رکورد
                </span>
              </h4>
              <p className="text-[11px] text-slate-500 mt-0.5">
                مقایسه برآورد اولیه بودجه با کارکردهای واقعی تایید و ثبت‌شده در سیستم
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={fetchProjectPieceworkLogs}
            disabled={loadingLogs}
            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            title="به‌روزرسانی کارمزدها"
          >
            <RefreshCw className={`w-4 h-4 ${loadingLogs ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Real-time Summary Badges */}
        {(() => {
          const totalActualRecordedCost = recordedLogs.reduce((sum, log) => {
            const qty = Number(log.quantity || 0);
            const rate = Number(log.unitRate || log.unit_rate || 0);
            return sum + (qty * rate);
          }, 0);

          return (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-slate-500 block text-[11px]">کل برآورد بودجه دستمزد:</span>
                <span className="font-bold font-mono text-slate-800 text-sm mt-0.5 block">
                  {formatPersianPrice(totalLaborBudget, appCurrency)}
                </span>
              </div>

              <div className="p-3 bg-emerald-50/70 rounded-xl border border-emerald-200">
                <span className="text-emerald-700 block text-[11px]">مجموع کارمزدهای قطعی ثبت‌شده:</span>
                <span className="font-bold font-mono text-emerald-900 text-sm mt-0.5 block">
                  {formatPersianPrice(totalActualRecordedCost, appCurrency)}
                </span>
              </div>

              <div className="p-3 bg-amber-50/70 rounded-xl border border-amber-200">
                <span className="text-amber-800 block text-[11px]">انحراف از برآورد اولیه:</span>
                <span className={`font-bold font-mono text-sm mt-0.5 block ${totalActualRecordedCost > totalLaborBudget ? 'text-rose-600' : 'text-slate-700'}`}>
                  {formatPersianPrice(Math.abs(totalActualRecordedCost - totalLaborBudget), appCurrency)}
                  <span className="text-[10px] font-sans mr-1">
                    {totalActualRecordedCost > totalLaborBudget ? '(مازاد بر بودجه)' : '(باقی‌مانده تا سقف بودجه)'}
                  </span>
                </span>
              </div>
            </div>
          );
        })()}

        {/* Logged Rows Mini Table */}
        {recordedLogs.length > 0 ? (
          <div className="overflow-x-auto border border-slate-200 rounded-xl max-h-48 overflow-y-auto">
            <table className="w-full text-right text-[11px]">
              <thead className="bg-slate-100 text-slate-700 font-bold sticky top-0">
                <tr>
                  <th className="p-2">تاریخ</th>
                  <th className="p-2">نام پرسنل</th>
                  <th className="p-2">عنوان وظیفه کارمزدی</th>
                  <th className="p-2 text-center">تعداد</th>
                  <th className="p-2 text-center">نرخ واحد</th>
                  <th className="p-2 text-center">مبلغ کل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {recordedLogs.map((log: any, lIdx: number) => {
                  const qty = Number(log.quantity || 0);
                  const rate = Number(log.unitRate || log.unit_rate || 0);
                  return (
                    <tr key={log.id || lIdx} className="hover:bg-slate-50">
                      <td className="p-2 font-mono text-slate-500">{log.date || '---'}</td>
                      <td className="p-2 font-bold text-slate-800">
                        {log.personnelName || log.personnel_name || `پرسنل #${log.personnelId || log.personnel_id}`}
                      </td>
                      <td className="p-2 text-slate-700">
                        {log.taskTitle || log.task_title || log.taskCode || log.notes || 'کارکرد کارمزدی'}
                      </td>
                      <td className="p-2 text-center font-mono font-bold text-slate-800">{qty}</td>
                      <td className="p-2 text-center font-mono text-slate-600">{formatPersianPrice(rate, appCurrency)}</td>
                      <td className="p-2 text-center font-mono font-bold text-emerald-700">
                        {formatPersianPrice(qty * rate, appCurrency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-center text-slate-400 text-xs">
            هنوز رکوردی در ماژول کارمزد برای این پروژه ثبت نشده است. می‌توانید از دکمه‌های «ثبت کارمزد» یا «ثبت گروهی کارکرد مرحله» برای ثبت فوری کارکردها استفاده کنید.
          </div>
        )}
      </div>

      {/* RICH PERSONNEL SELECTION MODAL */}
      {pickingTarget && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
            {/* Modal Header */}
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-amber-400" />
                <div>
                  <h3 className="font-bold text-sm text-white">انتخاب مسئول / مجری از لیست پرسنل</h3>
                  <p className="text-[11px] text-slate-400">پرسنل مورد نظر را جهت تخصیص کارمزد انتخاب نمایید</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPickingTarget(null)}
                className="p-1.5 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl cursor-pointer transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Search Input */}
            <div className="p-3 bg-slate-50 border-b border-slate-200">
              <div className="relative">
                <Search size={16} className="absolute right-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={personnelSearch}
                  onChange={(e) => setPersonnelSearch(e.target.value)}
                  placeholder="جستجوی نام پرسنل، سمبل کاری، کد پرسنلی یا سمت..."
                  className="w-full pr-9 pl-3 py-1.5 text-xs border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 font-semibold"
                  autoFocus
                />
              </div>
            </div>

            {/* Personnel List */}
            <div className="p-3 overflow-y-auto space-y-2 flex-1">
              {/* Option to clear selection */}
              <button
                type="button"
                onClick={() => handleAssignPersonnel(null)}
                className="w-full p-2.5 text-right border border-dashed border-slate-300 hover:border-rose-400 bg-slate-50 hover:bg-rose-50 rounded-xl text-xs font-semibold text-slate-600 hover:text-rose-700 flex items-center justify-between transition-colors cursor-pointer"
              >
                <span>عدم تخصیص (بدون مسئول)</span>
                <X size={14} className="text-slate-400" />
              </button>

              {filteredPersonnel.length > 0 ? (
                filteredPersonnel.map((person) => {
                  const fullName = person.fullName || `${person.firstName || person.first_name || ''} ${person.lastName || person.last_name || ''}`.trim() || person.name || 'پرسنل';
                  const jobTitle = person.jobTitle || person.job_title || person.role || 'کارگر کارگاه';
                  const code = person.personnelCode || person.personnel_code || person.id;

                  return (
                    <div
                      key={person.id}
                      onClick={() => handleAssignPersonnel(person)}
                      className="p-3 bg-white hover:bg-amber-50/80 border border-slate-200 hover:border-amber-300 rounded-xl flex items-center justify-between gap-3 transition-all cursor-pointer group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-slate-100 group-hover:bg-amber-200 text-slate-700 group-hover:text-amber-900 font-bold flex items-center justify-center shrink-0 text-xs transition-colors">
                          {fullName.charAt(0)}
                        </div>
                        <div>
                          <div className="font-bold text-slate-800 text-xs group-hover:text-amber-950 flex items-center gap-2">
                            <span>{fullName}</span>
                            <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.2 rounded">
                              کد: {code}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                            <span className="font-medium text-slate-600">{jobTitle}</span>
                            {person.phone && (
                              <span className="text-[10px] font-mono text-slate-400">| {person.phone}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="text-amber-600 opacity-0 group-hover:opacity-100 transition-opacity">
                        <UserCheck size={18} />
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-8 text-center text-slate-400 text-xs">
                  هیچ پرسنلی با عبارت جستجو شده پیدا نشد.
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3 bg-slate-100 border-t border-slate-200 flex items-center justify-between text-slate-500 text-[11px]">
              <span>مجموع پرسنل فعال: {personnelList.length} نفر</span>
              <button
                type="button"
                onClick={() => setPickingTarget(null)}
                className="px-3 py-1 bg-white border border-slate-300 rounded-lg font-bold hover:bg-slate-200 text-slate-700 cursor-pointer"
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
