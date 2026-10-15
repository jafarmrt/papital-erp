import { and, asc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { crmActivities, crmLeads, customers, personnel, users } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { containsLikePattern } from '../../lib/sqlLike.js';

/**
 * v9.0.14 (TD-428، تصمیم مالک محصول ت۵ الف): پیگیری‌های باز از سرور، بی بازه تاریخ اقدام و با صفحه‌بندی. پیش‌تر فهرست
 * «پیگیری‌ها»، ویجت پیشخوان و نشان زبانه از فهرست اقدام‌های ۳۰ روز اخیر (سقف ۲۰۰ ردیف) ساخته می‌شدند: پیگیری معوقِ اقدام
 * قدیمی در شمارنده آمار بود و در هیچ فهرستی نه. شمارنده آمار (`countDueFollowups`) و این فهرست یک شرط دارند.
 */

export type FollowupStatus = 'pending' | 'completed' | 'all';

export interface FollowupFilter {
  status?: FollowupStatus;
  /** فقط سررسید امروز و معوق */
  dueOnly?: boolean;
  assignedPersonnelId?: number;
  /** v10.1.18 (N-02 بخش ۲، ت۳): فقط پیگیری‌های این کاربر (`ownFollowupCondition`)؛ شمارنده‌ها هم همین دامنه را دارند */
  ownerUserId?: number;
  search?: string;
  page: number;
  limit: number;
}

const hasFollowup = sql`COALESCE(${crmActivities.nextFollowUpDate}, '') <> ''`;

function statusCondition(status: FollowupStatus): SQL | undefined {
  if (status === 'pending') return eq(crmActivities.isFollowUpCompleted, 0);
  if (status === 'completed') return eq(crmActivities.isFollowUpCompleted, 1);
  return undefined;
}

/**
 * v9.0.16 (TD-425): اقدام بی پرونده، یا اقدامِ پرونده‌ای که هست و حذف نشده. اقدام‌های پرونده حذف‌شده (یا شناسه پرونده ناموجود)
 * در آمار، فهرست اقدام‌ها و پیگیری‌ها و یادآور سررسید نمی‌آیند؛ ردیف‌ها دست نمی‌خورند و تاریخچه می‌ماند.
 */
export function liveLeadActivityCondition(): SQL {
  return sql`(${crmActivities.leadId} IS NULL OR EXISTS (SELECT 1 FROM crm_leads live_lead WHERE live_lead.id = ${crmActivities.leadId} AND live_lead.is_deleted = 0))`;
}

/** پیگیری باز: حذف‌نشده، انجام‌نشده، با تاریخ سررسید، از پرونده‌ای که حذف نشده */
export function openFollowupCondition(): SQL {
  return and(eq(crmActivities.isDeleted, 0), eq(crmActivities.isFollowUpCompleted, 0), hasFollowup, liveLeadActivityCondition()) as SQL;
}

/** پیگیری باز با سررسید امروز یا گذشته (سررسید میلادی ISO، v7.0.132) */
export function dueFollowupCondition(todayIso: string): SQL {
  return and(openFollowupCondition(), sql`${crmActivities.nextFollowUpDate} <= ${todayIso}::text`) as SQL;
}

async function countWhere(where: SQL): Promise<number> {
  const [row] = await orm.select({ n: sql<string>`count(*)::text` }).from(crmActivities).where(where);
  return Number(row?.n ?? 0);
}

export async function countDueFollowups(): Promise<number> {
  return countWhere(dueFollowupCondition(await businessTodayIsoDate()));
}

export async function countOpenFollowups(): Promise<number> {
  return countWhere(openFollowupCondition());
}

/**
 * v9.0.433 (TD-709) و v10.1.18 (N-02 بخش ۲، ت۳): پیگیری «مال» یک کاربر: مسئولی که شناسه پرسنلش به همین کاربر پیوند دارد، و
 * برای ردیف قدیمی بی شناسه، نام مسئول (یا ثبت‌کننده) بریده‌شده که دقیقاً نام کامل یا نام کاربری اوست؛ هرگز «شامل». کاربری
 * که نیست هیچ پیگیری‌ای ندارد. یادآور سررسید و زبانه «پیگیری‌های من» همین شرط را دارند.
 */
export async function ownFollowupCondition(userId: number): Promise<SQL> {
  const [user] = await orm.select({ fullName: users.fullName, username: users.username }).from(users).where(eq(users.id, userId));
  if (!user) return sql`false`;
  const names = [...new Set([(user.fullName ?? '').trim(), (user.username ?? '').trim()].filter(Boolean))];
  const linkedPersonnel = orm.select({ id: personnel.id }).from(personnel).where(and(eq(personnel.userId, userId), eq(personnel.isDeleted, 0)));
  const byPersonnel = inArray(crmActivities.assignedPersonnelId, linkedPersonnel);
  const legacyAssignee = sql<string>`btrim(COALESCE(NULLIF(btrim(${crmActivities.assignedTo}), ''), ${crmActivities.loggedBy}, ''))`;
  const byExactName = names.length > 0 ? and(isNull(crmActivities.assignedPersonnelId), inArray(legacyAssignee, names)) : undefined;
  return (byExactName ? or(byPersonnel, byExactName) : byPersonnel) as SQL;
}

async function assigneeCondition(personnelId: number): Promise<SQL> {
  const [person] = await orm.select({ fullName: personnel.fullName }).from(personnel).where(eq(personnel.id, personnelId));
  const byId = eq(crmActivities.assignedPersonnelId, personnelId);
  // ردیف‌های پیش از V10-4.1 فقط نام متنی مسئول را دارند
  return (person?.fullName ? or(byId, and(isNull(crmActivities.assignedPersonnelId), eq(crmActivities.assignedTo, person.fullName))) : byId) as SQL;
}

export async function listFollowups(filter: FollowupFilter) {
  const todayIso = await businessTodayIsoDate();
  const conditions: Array<SQL | undefined> = [eq(crmActivities.isDeleted, 0), hasFollowup, liveLeadActivityCondition(), statusCondition(filter.status ?? 'pending')];
  if (filter.dueOnly) conditions.push(sql`${crmActivities.nextFollowUpDate} <= ${todayIso}::text`);
  const scope: Array<SQL | undefined> = [];
  if (filter.assignedPersonnelId) scope.push(await assigneeCondition(filter.assignedPersonnelId));
  if (filter.ownerUserId) scope.push(await ownFollowupCondition(filter.ownerUserId));
  conditions.push(...scope);
  const q = filter.search?.trim();
  if (q) {
    const pattern = containsLikePattern(q);
    conditions.push(or(
      ilike(crmActivities.nextFollowUpTask, pattern), ilike(crmActivities.title, pattern), ilike(crmActivities.description, pattern),
      ilike(crmActivities.loggedBy, pattern), ilike(crmActivities.assignedTo, pattern), ilike(crmLeads.title, pattern), ilike(customers.name, pattern),
    ));
  }
  const where = and(...conditions);

  const [totalRow] = await orm.select({ n: sql<string>`count(*)::text` })
    .from(crmActivities)
    .leftJoin(crmLeads, eq(crmActivities.leadId, crmLeads.id))
    .leftJoin(customers, eq(crmActivities.customerId, customers.id))
    .where(where);
  const total = Number(totalRow?.n ?? 0);

  const rows = await orm.select({
    id: crmActivities.id,
    leadId: crmActivities.leadId,
    customerId: crmActivities.customerId,
    type: crmActivities.type,
    title: crmActivities.title,
    description: crmActivities.description,
    result: crmActivities.result,
    loggedBy: crmActivities.loggedBy,
    assignedTo: crmActivities.assignedTo,
    assignedPersonnelId: crmActivities.assignedPersonnelId,
    mentions: crmActivities.mentions,
    activityDate: crmActivities.activityDate,
    activityDateIso: crmActivities.activityDateIso,
    nextFollowUpDate: crmActivities.nextFollowUpDate,
    nextFollowUpDateIso: crmActivities.nextFollowUpDateIso,
    nextFollowUpTask: crmActivities.nextFollowUpTask,
    isFollowUpCompleted: crmActivities.isFollowUpCompleted,
    createdAt: crmActivities.createdAt,
    version: crmActivities.version,
    updatedAt: crmActivities.updatedAt,
    updatedBy: crmActivities.updatedBy,
    isDeleted: crmActivities.isDeleted,
    leadTitle: crmLeads.title,
    leadCustomerName: crmLeads.customerName,
    customerName: customers.name,
  })
    .from(crmActivities)
    .leftJoin(crmLeads, eq(crmActivities.leadId, crmLeads.id))
    .leftJoin(customers, eq(crmActivities.customerId, customers.id))
    .where(where)
    .orderBy(asc(crmActivities.nextFollowUpDate), asc(crmActivities.id))
    .limit(filter.limit)
    .offset((filter.page - 1) * filter.limit);

  return {
    rows,
    total,
    page: filter.page,
    limit: filter.limit,
    totalPages: Math.max(1, Math.ceil(total / filter.limit)),
    dueCount: await countWhere(and(dueFollowupCondition(todayIso), ...scope) as SQL),
    openCount: await countWhere(and(openFollowupCondition(), ...scope) as SQL),
  };
}

/**
 * v10.1.22 (N-02 بخش ۳): نزدیک‌ترین سررسید پیگیری باز هر پرونده (`openFollowupCondition`)، برای کارت قیف فروش. یک پرس‌وجو
 * برای پرونده‌های همان صفحه؛ پرونده بی پیگیری باز در نتیجه نیست.
 */
export async function nextFollowupDatesByLead(leadIds: ReadonlyArray<number>): Promise<Map<number, string>> {
  if (leadIds.length === 0) return new Map();
  const rows = await orm
    .select({ leadId: crmActivities.leadId, next: sql<string>`min(${crmActivities.nextFollowUpDate})` })
    .from(crmActivities)
    .where(and(openFollowupCondition(), inArray(crmActivities.leadId, [...leadIds])))
    .groupBy(crmActivities.leadId);
  return new Map(rows.filter((r) => r.leadId !== null && r.next).map((r) => [Number(r.leadId), String(r.next)]));
}
