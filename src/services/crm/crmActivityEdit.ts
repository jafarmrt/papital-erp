import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { crmActivities, crmLeads } from '../../db/schema.js';
import { ConflictError, NotFoundError } from '../../errors/customErrors.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { optionalStorageDate } from '../../lib/storageDate.js';
import { resolveAssignee } from './crmAssignee.js';
import { notifyActivityMentions, resolveActivityMentions } from './crmActivityMentions.js';

type Tx = Parameters<typeof notifyActivityMentions>[0];
type Activity = typeof crmActivities.$inferSelect;

/**
 * v10.1.18 (N-02 بخش ۲، تصمیم ت۱ و ت۲ طرح ارتباط با مشتری): ویرایش و حذف نرم یک اقدام یا پیگیری. هر دو در تراکنش فراخواننده،
 * زیر قفل ردیف اقدام (`FOR UPDATE`) و فقط برای اقدام زنده‌ای که پرونده‌اش حذف نشده (وگرنه ۴۰۴). ویرایش نسخه رکورد را می‌خواهد
 * و نسخه کهنه ۴۰۹ `OCC_CONFLICT` است؛ فیلد نفرستاده بی تغییر می‌ماند؛ پرونده و طرف حساب اقدام عوض نمی‌شوند. اشاره تازه فقط به
 * کاربر تازه اعلان می‌دهد (قاعده گزارش روزانه، TD-633). «انجام شد / باز» همان دو عمل جدای TD-430 می‌ماند. ممیزی را مسیر با
 * همین `tx` و پیش و پس برگشتی می‌نویسد.
 */
export interface ActivityEditInput {
  version: number;
  type?: string;
  title?: string;
  description?: string;
  result?: string;
  activityDate?: string;
  assignedTo?: string;
  assignedPersonnelId?: number | string | null;
  nextFollowUpDate?: string;
  nextFollowUpTask?: string;
  mentions?: number[];
}

export interface ActivityActor {
  id?: number;
  name: string;
}

/** فیلدهای اقدام که در ممیزی ویرایش و حذف می‌آیند */
const AUDITED_ACTIVITY_FIELDS = [
  'type', 'title', 'description', 'result', 'activityDate', 'assignedTo', 'assignedPersonnelId', 'mentions',
  'nextFollowUpDate', 'nextFollowUpTask', 'isFollowUpCompleted', 'leadId', 'customerId', 'version',
] as const satisfies readonly (keyof Activity)[];

export function activityAuditSnapshot(row: Activity): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of AUDITED_ACTIVITY_FIELDS) out[field] = row[field] ?? null;
  return out;
}

export function activityAuditDetails(before: Activity, after: Activity) {
  const b = activityAuditSnapshot(before);
  const a = activityAuditSnapshot(after);
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const field of AUDITED_ACTIVITY_FIELDS) {
    if (field === 'version') continue;
    if (JSON.stringify(b[field]) !== JSON.stringify(a[field])) changes[field] = { before: b[field], after: a[field] };
  }
  return { before: b, after: a, changes };
}

async function lockLiveActivity(tx: DbExecutor, id: number): Promise<Activity> {
  const [row] = await tx.select().from(crmActivities)
    .where(and(eq(crmActivities.id, id), eq(crmActivities.isDeleted, 0)))
    .for('update');
  if (!row) throw new NotFoundError('اقدام یا پیگیری یافت نشد', { id }, 'CRM_ACTIVITY_NOT_FOUND');
  if (row.leadId) {
    const [lead] = await tx.select({ isDeleted: crmLeads.isDeleted }).from(crmLeads).where(eq(crmLeads.id, row.leadId));
    if (!lead || lead.isDeleted === 1) throw new NotFoundError('پرونده فروش این اقدام حذف شده است', { id }, 'CRM_ACTIVITY_NOT_FOUND');
  }
  return row;
}

function numericMentions(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number).filter(n => Number.isInteger(n) && n > 0) : [];
}

export async function updateActivity(tx: Tx, id: number, input: ActivityEditInput, actor: ActivityActor) {
  const before = await lockLiveActivity(tx, id);
  if (Number(before.version) !== Number(input.version)) {
    throw new ConflictError('این اقدام را کاربر دیگری تغییر داده؛ دوباره باز کنید.', { currentVersion: before.version }, 'OCC_CONFLICT');
  }
  const set: Partial<typeof crmActivities.$inferInsert> = {};
  if (input.type !== undefined) set.type = input.type.trim() || before.type;
  if (input.title !== undefined) set.title = input.title.trim();
  if (input.description !== undefined) set.description = input.description;
  if (input.result !== undefined) set.result = input.result;
  if (input.activityDate !== undefined) {
    const iso = optionalStorageDate(input.activityDate, 'تاریخ اقدام');
    if (iso) { set.activityDate = iso; set.activityDateIso = iso; }
  }
  if (input.nextFollowUpDate !== undefined) {
    const iso = optionalStorageDate(input.nextFollowUpDate, 'تاریخ پیگیری بعدی') ?? '';
    set.nextFollowUpDate = iso;
    set.nextFollowUpDateIso = iso;
  }
  if (input.nextFollowUpTask !== undefined) set.nextFollowUpTask = input.nextFollowUpTask;
  if (input.assignedTo !== undefined || input.assignedPersonnelId !== undefined) {
    const assignee = await resolveAssignee({
      name: input.assignedTo !== undefined ? input.assignedTo : before.assignedTo,
      personnelId: input.assignedPersonnelId !== undefined ? input.assignedPersonnelId : null,
    }, tx);
    set.assignedTo = assignee.name;
    set.assignedPersonnelId = assignee.id;
  }
  const beforeMentions = numericMentions(before.mentions);
  let newMentions: number[] = [];
  if (input.mentions !== undefined) {
    const mentionIds = await resolveActivityMentions(tx, input.mentions);
    set.mentions = mentionIds;
    newMentions = mentionIds.filter(m => !beforeMentions.includes(m));
  }

  const nowIso = systemNowUtcIso();
  const [after] = await tx.update(crmActivities)
    .set({ ...set, version: Number(before.version) + 1, updatedAt: nowIso, updatedBy: actor.name })
    .where(and(eq(crmActivities.id, id), eq(crmActivities.version, before.version)))
    .returning();
  if (!after) throw new ConflictError('این اقدام را کاربر دیگری تغییر داده؛ دوباره باز کنید.', undefined, 'OCC_CONFLICT');

  const notified = newMentions.length > 0
    ? await notifyActivityMentions(tx, { id: after.id, title: after.title, mentions: newMentions }, actor)
    : [];
  if (after.leadId) await tx.update(crmLeads).set({ updatedAt: nowIso }).where(eq(crmLeads.id, after.leadId));
  return { before, after, notified };
}

export async function softDeleteActivity(tx: Tx, id: number, actor: ActivityActor) {
  const before = await lockLiveActivity(tx, id);
  const nowIso = systemNowUtcIso();
  const [after] = await tx.update(crmActivities)
    .set({ isDeleted: 1, version: Number(before.version) + 1, updatedAt: nowIso, updatedBy: actor.name })
    .where(eq(crmActivities.id, id))
    .returning();
  return { before, after };
}
