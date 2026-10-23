import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import type {
  PieceworkTask, ProductStageSchedule, ProductionProject, ProjectProductItem, ProjectStage, ProjectStageSchedulesMap, TaskAssignmentItem,
} from '../../../types';
import type { StageTaskTemplate, WorkflowPreset } from '../../../constants/presets';
import { fetchJson } from '../../../api';
import { errorMessageOf, toPersianDigits } from '../../../utils';
import { withPieceworkTask } from '../../../lib/projects/scheduleWorkLog';
import type { useProjectVersion } from '../../../hooks/useProjectVersion';
import { personNameOf, type SchedulePerson } from './useScheduleReferenceData';

/** one product's plan in one stage, as the tab keeps it in `stage_schedules` */
export interface ProductPlan extends ProductStageSchedule {
  productId: string;
  productCode: string;
  productName: string;
  customerCode: string;
  startDate: string;
  endDate: string;
  assignedPersonnel: unknown[];
  tasks: TaskAssignmentItem[];
}

/** the fields of a plan row a control changes */
export type PlanRowField = 'taskId' | 'taskTitle' | 'quantity' | 'assignedPersonnelId';

const emptyPlan = (productId: string): ProductPlan => ({
  productId, productCode: '', productName: '', customerCode: '', startDate: '', endDate: '', assignedPersonnel: [], tasks: [],
});

const planOf = (map: ProjectStageSchedulesMap, stageId: number, productId: string): ProductPlan | undefined =>
  (map[stageId] as Record<string, ProductPlan> | undefined)?.[productId];

const newRowId = (suffix = '') => `task-${Date.now()}${suffix}-${Math.random().toString(36).slice(2, 6)}`;

/** V3.1.0: no made-up stages or products; the project's own product stands in for an empty product list */
export function scheduleProductsOf(project: ProductionProject): ProjectProductItem[] {
  if (Array.isArray(project.products) && project.products.length > 0) return project.products;
  return project.item_id ? [{
    id: 'prod-main',
    item_id: project.item_id,
    item_code: project.item_code || '',
    item_name: project.item_name || '',
    customer_code: '',
    quantity: project.quantity || 100,
    unit: project.unit || 'عدد',
    needs_assembly: true,
  }] : [];
}

const isAssemblyStage = (title: string) => title.includes('مونتاژ');

/**
 * The workshop plan of a project: the rows of each product in each stage, as edited and as last read or saved. The tab
 * holds unsaved changes while the two differ. A newer project (after a save, or read while nothing is unsaved) starts the
 * plan again from what the server holds.
 */
export function useSchedulePlan({ project, workflowPresets, pieceworkTasksList, personnelList, projectVersion, onUpdate, onDirtyChange }: {
  project: ProductionProject;
  workflowPresets: WorkflowPreset[];
  pieceworkTasksList: PieceworkTask[];
  personnelList: SchedulePerson[];
  projectVersion: ReturnType<typeof useProjectVersion>;
  onUpdate: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const stages: ProjectStage[] = Array.isArray(project.stages) ? project.stages : [];
  const products = scheduleProductsOf(project);
  const [saving, setSaving] = useState(false);
  const [schedulesMap, setSchedulesMap] = useState<ProjectStageSchedulesMap>({});
  // the plan as last read or saved; the tab holds unsaved changes while the two differ
  const [savedSchedulesMap, setSavedSchedulesMap] = useState<ProjectStageSchedulesMap>({});
  const hasUnsavedSchedules = useMemo(() => JSON.stringify(schedulesMap) !== JSON.stringify(savedSchedulesMap), [schedulesMap, savedSchedulesMap]);
  useEffect(() => { onDirtyChange?.(hasUnsavedSchedules && !saving); }, [hasUnsavedSchedules, saving, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  useEffect(() => {
    if (project.stage_schedules) {
      setSchedulesMap(project.stage_schedules);
      setSavedSchedulesMap(project.stage_schedules);
      return;
    }
    const initialMap: ProjectStageSchedulesMap = {};
    for (const stage of Array.isArray(project.stages) ? project.stages : []) {
      const byProduct: Record<string, ProductPlan> = {};
      for (const p of scheduleProductsOf(project)) {
        byProduct[p.id] = {
          ...emptyPlan(p.id),
          productCode: p.item_code || '',
          productName: p.item_name || '',
          customerCode: p.customer_code || '',
          startDate: project.start_date || '',
          endDate: project.end_date || '',
        };
      }
      initialMap[stage.id] = byProduct;
    }
    setSchedulesMap(initialMap);
    setSavedSchedulesMap(initialMap);
  }, [project]);

  const getProductSchedule = (stageId: number, productId: string): ProductPlan => planOf(schedulesMap, stageId, productId) ?? emptyPlan(productId);

  const updateProductSchedule = (stageId: number, productId: string, updater: (prev: ProductPlan) => ProductPlan) => {
    setSchedulesMap(prevMap => {
      const stageObj = { ...((prevMap[stageId] as Record<string, ProductPlan> | undefined) ?? {}) };
      stageObj[productId] = updater(stageObj[productId] ?? emptyPlan(productId));
      return { ...prevMap, [stageId]: stageObj };
    });
  };

  /** the default rows of a stage, from the workflow preset that names a stage of this title */
  const findStageDefaultTasks = (stageTitle: string): StageTaskTemplate[] => {
    for (const preset of workflowPresets) {
      for (const stageItem of Array.isArray(preset.stages) ? preset.stages : []) {
        if (typeof stageItem === 'object' && stageItem !== null && stageItem.title.trim() === stageTitle.trim() && Array.isArray(stageItem.defaultTasks)) {
          return stageItem.defaultTasks;
        }
      }
    }
    return [];
  };

  /** the preset's default rows added to every product of the stage (not to a product that skips the assembly stage) */
  const handleApplyStagePreset = (stageId: number, stageTitle: string) => {
    const defaultTasks = findStageDefaultTasks(stageTitle);
    if (defaultTasks.length === 0) {
      toast.error(`الگوی عناوین کاری پیش‌فرضی برای مرحله «${stageTitle}» در تنظیمات تعریف نشده است.`);
      return;
    }
    let addedCount = 0;
    for (const p of products) {
      if (isAssemblyStage(stageTitle) && p.needs_assembly === false) continue;
      const newTasksToAdd: TaskAssignmentItem[] = defaultTasks.map((dt, idx) => ({
        id: newRowId(`-${idx}`),
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
        status: 'pending',
      }));
      updateProductSchedule(stageId, p.id, prev => ({ ...prev, tasks: [...(prev.tasks || []), ...newTasksToAdd] }));
      addedCount += newTasksToAdd.length;
    }
    toast.success(`الگوی «${stageTitle}» با موفقیت اعمال شد (${toPersianDigits(addedCount)} عنوان کاری جدید اضافه شد).`);
  };

  const handleAddTask = (stageId: number, productId: string) => {
    const prod = products.find(p => p.id === productId);
    updateProductSchedule(stageId, productId, prev => ({
      ...prev,
      tasks: [...(prev.tasks || []), {
        id: newRowId(),
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
        status: 'pending',
      }],
    }));
  };

  const handleUpdateTask = (stageId: number, productId: string, taskIdx: number, field: PlanRowField, val: string | number | null) => {
    updateProductSchedule(stageId, productId, prev => {
      const taskList = [...(prev.tasks || [])];
      let t = { ...taskList[taskIdx], [field]: val } as TaskAssignmentItem;
      if (field === 'taskId') {
        const found = pieceworkTasksList.find(pt => pt.id === Number(val));
        // v9.0.281 (TD-735): نرخ پایه از `defaultRate` سرور (پیش‌تر `default_rate` که سرور نمی‌فرستد، پس نرخ ۰ می‌شد)
        if (found) t = withPieceworkTask(t, found);
      }
      if (field === 'assignedPersonnelId') {
        const person = personnelList.find(p => p.id === Number(val));
        t.assignedPersonnelId = person ? person.id : null;
        t.assignedPersonnelName = person ? personNameOf(person) : '';
      }
      if (field === 'quantity') t.estimatedCost = (Number(t.quantity) || 0) * (Number(t.defaultRate) || 0);
      taskList[taskIdx] = t;
      return { ...prev, tasks: taskList };
    });
  };

  const handleRemoveTask = (stageId: number, productId: string, taskIdx: number) => {
    updateProductSchedule(stageId, productId, prev => ({ ...prev, tasks: (prev.tasks || []).filter((_, i) => i !== taskIdx) }));
  };

  // the estimated labor cost of all stages and products
  let totalLaborBudget = 0;
  for (const byProduct of Object.values(schedulesMap) as Array<Record<string, ProductPlan>>) {
    for (const plan of Object.values(byProduct ?? {})) {
      for (const t of plan?.tasks || []) totalLaborBudget += Number(t.estimatedCost) || 0;
    }
  }

  const handleSaveSchedules = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetchJson<{ id?: number; error?: string } | null>(`/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage_schedules: schedulesMap, ...projectVersion.writeBase }),
      });
      if (res?.id) {
        projectVersion.remember(res, ['schedule']);
        setSavedSchedulesMap(schedulesMap);
        toast.success('برنامه‌ریزی کارگاه و تخصیص پرسنل با موفقیت ذخیره شد');
        onUpdate();
      } else {
        toast.error(res?.error || 'خطا در ذخیره‌سازی برنامه‌ریزی');
      }
    } catch (err) {
      toast.error(errorMessageOf(err) || 'خطا در ارتباط با سامانه');
    } finally {
      setSaving(false);
    }
  };

  return {
    stages, products, saving, schedulesMap, setSchedulesMap, setSavedSchedulesMap, totalLaborBudget,
    getProductSchedule, updateProductSchedule, findStageDefaultTasks,
    handleApplyStagePreset, handleAddTask, handleUpdateTask, handleRemoveTask, handleSaveSchedules,
  };
}

export type SchedulePlan = ReturnType<typeof useSchedulePlan>;
export { isAssemblyStage };
