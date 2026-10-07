import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { personnel, pieceworkTasks, productionProjects } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { parsePieceworkRate } from '../../lib/piecework/pieceworkRate.js';
import { parseWorkQuantity } from '../../lib/piecework/workQuantity.js';
import { requireStorageDate } from '../../lib/storageDate.js';
import type { ScheduleRowRef } from '../../lib/projects/scheduleWorkLog.js';
import { toPersianDigits } from '../../utils/persianNumber.js';

/**
 * v9.0.280 (TD-812، B12P-09): ردیف کارکرد پیش از هر نوشتن سنجیده می‌شود. پیش‌تر مقدار «-5» با مبلغ منفی و «abc» صفر ذخیره
 * می‌شد، کارکرد پرسنل حذف‌شده یا ناموجود پذیرفته می‌شد (piecework_logs کلید خارجی واقعی ندارد) و ردیف ناقص بی‌صدا رد می‌شد.
 * اکنون شناسه‌ها عدد صحیح مثبت، مقدار بزرگ‌تر از صفر (یا «ساعت:دقیقه»)، نرخ دستی نامنفی و تاریخ معتبرند (۴۲۲)، و پرسنل، عنوان
 * کار و پروژه باید زنده باشند؛ ردیف‌های آن‌ها `FOR SHARE` قفل می‌شوند تا حذف هم‌زمان پرسنل (که کارکرد آزاد را کار باز می‌داند،
 * TD-441) پس از این ثبت سنجیده شود.
 */

export interface WorkLogEntryInput {
  personnelId: number | string;
  taskId: number | string;
  projectId?: number | string | null;
  date: string;
  quantity: number | string;
  unitRate?: number | string;
  notes?: string;
  /** ردیف برنامه کارگاه پروژه که این کارکرد از آن ثبت می‌شود */
  scheduleRef?: ScheduleRowRef | null;
}

export interface NormalizedWorkLogEntry {
  personnelId: number;
  taskId: number;
  projectId: number | null;
  isoDate: string;
  quantity: number;
  /** نرخ دستی (رشته اعشاری لاتین)؛ undefined یعنی نرخ را سرور برمی‌گزیند */
  unitRate: string | undefined;
  notes: string;
  scheduleRef: ScheduleRowRef | null;
}

const INVALID = 'PIECEWORK_LOG_INVALID';

function rowPrefix(index: number, total: number): string {
  return total > 1 ? `ردیف ${toPersianDigits(index + 1)}: ` : '';
}

/** شناسه عدد صحیح مثبت؛ خالی برای شناسه اختیاری null است */
export function workLogId(raw: unknown, label: string, prefix: string, optional = false): number | null {
  if (optional && (raw === undefined || raw === null || raw === '' || raw === 0)) return null;
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  if (!/^[1-9]\d*$/.test(text)) throw new ValidationError(`${prefix}${label} باید عدد صحیح مثبت باشد`, { [label]: raw }, INVALID);
  return Number(text);
}

export function workLogQuantity(raw: unknown, prefix: string): number {
  const parsed = parseWorkQuantity(raw);
  if (!parsed.ok) throw new ValidationError(`${prefix}${parsed.message}`, { quantity: raw }, INVALID);
  return parsed.value;
}

export function workLogManualRate(raw: unknown, prefix: string): string | undefined {
  const parsed = parsePieceworkRate(raw, 'نرخ کارکرد');
  if (!parsed.ok) throw new ValidationError(`${prefix}${parsed.message}`, { unitRate: raw }, INVALID);
  return parsed.value;
}

/** همه ردیف‌ها پیش از تراکنش سنجیده می‌شوند؛ یک ردیف نامعتبر کل دسته را رد می‌کند */
export function normalizeWorkLogEntries(items: readonly WorkLogEntryInput[]): NormalizedWorkLogEntry[] {
  if (items.length === 0) throw new ValidationError('حداقل یک ردیف کارکرد الزامی است', undefined, INVALID);
  return items.map((item, index) => {
    const prefix = rowPrefix(index, items.length);
    return {
      personnelId: workLogId(item.personnelId, 'شناسه پرسنل', prefix) as number,
      taskId: workLogId(item.taskId, 'شناسه عنوان کار', prefix) as number,
      projectId: workLogId(item.projectId, 'شناسه پروژه', prefix, true),
      isoDate: requireStorageDate(item.date, items.length > 1 ? `تاریخ کارکرد ردیف ${toPersianDigits(index + 1)}` : 'تاریخ کارکرد'),
      quantity: workLogQuantity(item.quantity, prefix),
      // v9.0.281 (TD-735، تصمیم ت۴ الف): کارکرد ردیف برنامه کارگاه نرخ را همیشه از سرور می‌گیرد؛ نرخ ارسالی آن نادیده گرفته می‌شود
      unitRate: item.scheduleRef ? undefined : workLogManualRate(item.unitRate, prefix),
      notes: item.notes ? String(item.notes).trim() : '',
      scheduleRef: item.scheduleRef ?? null,
    };
  });
}

const sortedUnique = (ids: Array<number | null>) => [...new Set(ids.filter((id): id is number => id !== null))].sort((a, b) => a - b);
const idList = (ids: number[]) => ids.map(id => toPersianDigits(id)).join('، ');

/** نام پرسنل و عنوان کار زنده‌ها (برای متن ردیف ممیزی، TD-810) */
export interface WorkLogParentNames {
  personnel: Map<number, string>;
  tasks: Map<number, string>;
}

/** پرسنل، عنوان کار و پروژه ردیف‌ها زنده‌اند (۴۲۲ با شناسه‌های نادرست)؛ ردیف‌هایشان تا پایان تراکنش `FOR SHARE` قفل است */
export async function assertWorkLogParentsLive(tx: DbExecutor, entries: readonly Pick<NormalizedWorkLogEntry, 'personnelId' | 'taskId' | 'projectId'>[]): Promise<WorkLogParentNames> {
  const names: WorkLogParentNames = { personnel: new Map(), tasks: new Map() };
  const personnelIds = sortedUnique(entries.map(e => e.personnelId));
  if (personnelIds.length > 0) {
    const live = await tx.select({ id: personnel.id, fullName: personnel.fullName }).from(personnel)
      .where(and(inArray(personnel.id, personnelIds), eq(personnel.isDeleted, 0))).orderBy(asc(personnel.id)).for('share');
    const missing = personnelIds.filter(id => !live.some(r => r.id === id));
    if (missing.length > 0) {
      throw new ValidationError(`پرسنل با شناسه ${idList(missing)} وجود ندارد یا حذف شده است؛ کارکردی ثبت نشد.`, { personnelIds: missing }, 'PIECEWORK_LOG_PERSONNEL_INVALID');
    }
    for (const r of live) names.personnel.set(r.id, r.fullName ?? '');
  }
  const taskIds = sortedUnique(entries.map(e => e.taskId));
  if (taskIds.length > 0) {
    const live = await tx.select({ id: pieceworkTasks.id, title: pieceworkTasks.title }).from(pieceworkTasks)
      .where(and(inArray(pieceworkTasks.id, taskIds), eq(pieceworkTasks.isDeleted, 0))).orderBy(asc(pieceworkTasks.id)).for('share');
    const missing = taskIds.filter(id => !live.some(r => r.id === id));
    if (missing.length > 0) {
      throw new ValidationError(`عنوان کاری با شناسه ${idList(missing)} وجود ندارد یا حذف شده است؛ کارکردی ثبت نشد.`, { taskIds: missing }, 'PIECEWORK_LOG_TASK_INVALID');
    }
    for (const r of live) names.tasks.set(r.id, r.title);
  }
  const projectIds = sortedUnique(entries.map(e => e.projectId));
  if (projectIds.length > 0) {
    const live = await tx.select({ id: productionProjects.id }).from(productionProjects)
      .where(and(inArray(productionProjects.id, projectIds), eq(productionProjects.isDeleted, 0))).orderBy(asc(productionProjects.id)).for('share');
    const missing = projectIds.filter(id => !live.some(r => r.id === id));
    if (missing.length > 0) {
      throw new ValidationError(`پروژه با شناسه ${idList(missing)} وجود ندارد یا حذف شده است؛ کارکردی ثبت نشد.`, { projectIds: missing }, 'PIECEWORK_LOG_PROJECT_INVALID');
    }
  }
  return names;
}
