/**
 * کارکردی که زبانه «برنامه‌ریزی کارگاه» پروژه برای یک ردیف برنامه ثبت می‌کند (بسته ۱۱، B11-01 / B11-02 / B11-13).
 *
 * v9.0.237 (TD-735، تصمیم ت۴ الف): نرخ این کارکرد را همیشه سرور می‌دهد (نرخ اختصاصی پرسنل، وگرنه نرخ پایه عنوان کار)؛
 * ردیف نرخی نمی‌فرستد و سرور `unitRate` کارکردی را که `scheduleRef` دارد نادیده می‌گیرد. پیش‌تر زبانه نرخ را از کلید
 * `default_rate` می‌خواند که سرور نمی‌فرستد (`defaultRate` می‌فرستد)، پس کارکرد ۱۰ عددی با نرخ ۵۰٬۰۰۰ با مبلغ ۰ ثبت شد.
 */

/** نشانی ردیف برنامه: کلید مرحله و محصول در `stage_schedules` و شناسه ردیف کار */
export interface ScheduleRowRef {
  stageId: number;
  productId: string;
  rowId: string;
}

export interface SchedulePieceworkTask {
  id: number;
  title: string;
  defaultRate?: number | string | null;
  unit?: string | null;
}

export interface ScheduleRow {
  taskId: number | null;
  taskTitle: string;
  assignedPersonnelId: number | null;
  quantity: number;
  unit?: string;
  defaultRate?: number;
  estimatedCost?: number;
}

/** انتخاب عنوان کار در ردیف برنامه: نرخ پایه از `defaultRate` سرور و هزینه برآوردی = مقدار × نرخ پایه */
export function withPieceworkTask<T extends ScheduleRow>(row: T, task: SchedulePieceworkTask): T {
  const rate = Number(task.defaultRate ?? 0);
  const defaultRate = Number.isFinite(rate) ? rate : 0;
  return {
    ...row,
    taskId: task.id,
    taskTitle: task.title,
    defaultRate,
    unit: task.unit || 'عدد',
    estimatedCost: (Number(row.quantity) || 0) * defaultRate,
  };
}

export interface ScheduleLogItem {
  personnelId: number;
  taskId: number;
  projectId: number;
  date: string;
  quantity: number;
  notes: string;
  scheduleRef: ScheduleRowRef;
}

/** ردیف ارسالی «ثبت کارمزد»: بی نرخ (نرخ از سرور) و با نشانی ردیف برنامه */
export function scheduleLogItem(input: {
  projectId: number;
  ref: ScheduleRowRef;
  row: ScheduleRow;
  date: string;
  notes: string;
}): ScheduleLogItem {
  return {
    personnelId: Number(input.row.assignedPersonnelId),
    taskId: Number(input.row.taskId),
    projectId: input.projectId,
    date: input.date,
    quantity: Number(input.row.quantity),
    notes: input.notes,
    scheduleRef: input.ref,
  };
}
