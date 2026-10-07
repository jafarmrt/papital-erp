/**
 * کارکردی که زبانه «برنامه‌ریزی کارگاه» پروژه برای یک ردیف برنامه ثبت می‌کند (بسته ۱۱، B11-01 / B11-02 / B11-13).
 *
 * v9.0.281 (TD-735، تصمیم ت۴ الف): نرخ این کارکرد را همیشه سرور می‌دهد (نرخ اختصاصی پرسنل، وگرنه نرخ پایه عنوان کار)؛
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

/**
 * v9.0.282 (TD-736، تصمیم ت۵ الف بسته ۱۱): کارکرد هر ردیف برنامه یک بار ثبت می‌شود. شناسه کارکرد ساخته‌شده را سرور در همان
 * ردیف `stage_schedules` می‌نویسد (`pieceworkLogId`)، کارکرد دوم همان ردیف را با ۴۰۹ رد می‌کند و دکمه «ثبت کارمزد» وضعیت را از
 * همین فیلد می‌خواند. پیش‌تر پرچم «ثبت‌شده» فقط در حافظه مرورگر بود و با بستن و باز کردن زبانه همان کار دو بار به حقوق رفت.
 * `pieceworkLogId` و پرچم قدیمی `isLoggedToPiecework` را فقط سرور می‌نویسد؛ ذخیره برنامه از مرورگر آن‌ها را نمی‌تواند عوض کند.
 */
type JsonObject = Record<string, unknown>;
const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
const LINK_FIELDS = ['pieceworkLogId', 'isLoggedToPiecework'] as const;

/** ردیف برنامه با کلید مرحله، کلید محصول و شناسه ردیف؛ نبود هر کدام null */
export function findScheduleRow(schedules: unknown, stageKey: string | number, productId: string, rowId: string): JsonObject | null {
  if (!isObject(schedules)) return null;
  const stage = schedules[String(stageKey)];
  if (!isObject(stage)) return null;
  const product = stage[productId];
  if (!isObject(product) || !Array.isArray(product.tasks)) return null;
  const row = product.tasks.find(t => isObject(t) && t.id === rowId);
  return isObject(row) ? row : null;
}

/** ردیف برنامه پیش‌تر به کارکرد رفته است (شناسه کارکرد سرور، یا پرچم نسخه‌های پیش از v9.0.282) */
export function isScheduleRowLogged(row: { pieceworkLogId?: unknown; isLoggedToPiecework?: unknown } | null | undefined): boolean {
  if (!row) return false;
  const id = Number(row.pieceworkLogId);
  return (Number.isInteger(id) && id > 0) || row.isLoggedToPiecework === true;
}

/** هر ردیف هر محصول هر مرحله، با کلیدهایش */
function mapRows(schedules: JsonObject, fn: (row: JsonObject, stageKey: string, productId: string) => JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const [stageKey, stage] of Object.entries(schedules)) {
    if (!isObject(stage)) {
      out[stageKey] = stage;
      continue;
    }
    const stageOut: JsonObject = {};
    for (const [productId, product] of Object.entries(stage)) {
      stageOut[productId] = isObject(product) && Array.isArray(product.tasks)
        ? { ...product, tasks: product.tasks.map(t => (isObject(t) ? fn(t, stageKey, productId) : t)) }
        : product;
    }
    out[stageKey] = stageOut;
  }
  return out;
}

/** برنامه‌ای که مرورگر ذخیره می‌کند: فیلدهای پیوند کارکرد هر ردیف همان مقدار ذخیره‌شده سرور است، نه مقدار ارسالی */
export function keepScheduleLogLinks(incoming: unknown, saved: unknown): unknown {
  if (!isObject(incoming)) return incoming;
  return mapRows(incoming, (row, stageKey, productId) => {
    const next: JsonObject = Object.fromEntries(Object.entries(row).filter(([key]) => !(LINK_FIELDS as readonly string[]).includes(key)));
    const savedRow = typeof row.id === 'string' ? findScheduleRow(saved, stageKey, productId, row.id) : null;
    for (const key of LINK_FIELDS) {
      if (savedRow && savedRow[key] !== undefined) next[key] = savedRow[key];
    }
    return next;
  });
}

/** شناسه کارکرد را در ردیف برنامه می‌نویسد (نسخه تازه برنامه) */
export function withScheduleLogLink<T>(schedules: T, ref: ScheduleRowRef, logId: number): T {
  const base = isObject(schedules) ? schedules : {};
  return mapRows(base, (row, stageKey, productId) => (
    stageKey === String(ref.stageId) && productId === ref.productId && row.id === ref.rowId ? { ...row, pieceworkLogId: logId } : row
  )) as T;
}

/** پیوند ردیف‌هایی که به این کارکرد اشاره دارند برداشته می‌شود (کارکرد حذف شد)؛ changed یعنی ردیفی عوض شد */
export function withoutScheduleLogLink(schedules: unknown, logId: number): { changed: boolean; schedules: unknown } {
  if (!isObject(schedules)) return { changed: false, schedules };
  let changed = false;
  const next = mapRows(schedules, row => {
    if (Number(row.pieceworkLogId) !== logId) return row;
    changed = true;
    return Object.fromEntries(Object.entries(row).filter(([key]) => !(LINK_FIELDS as readonly string[]).includes(key)));
  });
  return { changed, schedules: next };
}

/** ردیف بی شناسه (برنامه‌های قدیمی) پیش از ثبت کارکرد شناسه می‌گیرد تا سرور ردیف را پیدا کند و پیوند را در آن بنویسد */
export function withScheduleRowIds<T>(schedules: T, makeId: () => string): T {
  if (!isObject(schedules)) return schedules;
  return mapRows(schedules, row => (typeof row.id === 'string' && row.id ? row : { ...row, id: makeId() })) as T;
}
