import { and, asc, desc, eq, gte, ilike, lt, or, sql, type SQL } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { dailyWorkLogs, users } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { containsLikePattern } from '../../lib/sqlLike.js';
import { serverTimestampToUtcIso } from '../../lib/serverTimestamp.js';
import { DEFAULT_DAILY_LOG_VISIBILITY, idList } from '../../lib/dailyLogs/dailyLogVisibility.js';
import { isoToJalaliDate, jalaliMonthStart, toStorageDate } from '../../utils/calendarDate.js';
import { ValidationError } from '../../errors/customErrors.js';
import { countsAsWorkHours } from '../../lib/dailyLogs/workMode.js';

type DailyLogRow = typeof dailyWorkLogs.$inferSelect;

/**
 * Package 13: reading daily work logs (list, statistics, management summary).
 *
 * v9.0.249 (TD-630, finding B13-05): the visibility rule, the filters and the paging run in SQL; the list answers
 * `{ data, total, page, limit }` instead of the first 200 rows of the whole table read into memory, the statistics are
 * `COUNT` / `SUM` and the summary reads only its day or month.
 * v9.0.250 (TD-631): «today's hours» are the hours of logs whose work date is the business today, never logs of other
 * days created today.
 * v9.0.252 (TD-636): `created_at` goes to the browser as UTC with a `Z`.
 */

/** A JSONB id list (mentions, allowed users) that holds `userId` as a number or as a legacy digit string */
function holdsUser(column: typeof dailyWorkLogs.mentions | typeof dailyWorkLogs.allowedUsers, userId: number): SQL {
  return sql`(${column} @> jsonb_build_array(${userId}::int) OR ${column} @> jsonb_build_array(${String(userId)}::text))`;
}

/**
 * SQL twin of `canSeeDailyLog` (`src/lib/dailyLogs/dailyLogVisibility.ts`): the author, a mentioned user of a
 * mentioned-only log (an unknown value counts as mentioned-only), an allowed or mentioned user of a custom log; a
 * holder of `daily_logs.manage_all` sees every log (no condition).
 */
export function visibleLogsCondition(userId: number, canManageAll: boolean): SQL | undefined {
  if (canManageAll) return undefined;
  const visibility = sql`coalesce(${dailyWorkLogs.visibility}, ${DEFAULT_DAILY_LOG_VISIBILITY})`;
  return or(
    eq(dailyWorkLogs.userId, userId),
    and(sql`${visibility} NOT IN ('private', 'managers', 'custom')`, holdsUser(dailyWorkLogs.mentions, userId)),
    and(sql`${visibility} = 'custom'`, or(holdsUser(dailyWorkLogs.allowedUsers, userId), holdsUser(dailyWorkLogs.mentions, userId))),
  );
}

export function formatDailyLog(l: DailyLogRow) {
  const mentionsArr = idList(l.mentions);
  const allowedArr = idList(l.allowedUsers);
  const tagsArr = Array.isArray(l.tags) ? l.tags : [];
  // v7.0.134 (TD-232): ستون اصلی میلادی ISO است و date_iso همان مقدار را دارد
  const computedDateIso = String(l.date || '');
  // v9.0.252 (TD-636): server timestamp (UTC, no zone) with a Z, so the browser shows Tehran time
  const createdAt = serverTimestampToUtcIso(l.createdAt);

  return {
    ...l,
    user_id: l.userId,
    user_full_name: l.userFullName || l.username,
    userFullName: l.userFullName || l.username,
    date_iso: computedDateIso,
    dateIso: computedDateIso,
    start_time: l.startTime,
    end_time: l.endTime,
    work_hours: l.workHours,
    work_mode: l.workMode,
    project_id: l.projectId,
    project_name: l.projectName || '',
    projectName: l.projectName || '',
    tags: tagsArr,
    mentions: mentionsArr,
    // v9.0.236 (TD-900): there is no public visibility; an empty value reads as mentioned_only
    visibility: l.visibility || DEFAULT_DAILY_LOG_VISIBILITY,
    allowed_users: allowedArr,
    allowedUsers: allowedArr,
    status: l.status || 'submitted',
    manager_notes: l.managerNotes || '',
    managerNotes: l.managerNotes || '',
    created_at: createdAt,
    createdAt,
  };
}

export interface DailyLogListQuery {
  filter_type?: 'all' | 'mine' | 'mentioned' | 'summary';
  date?: string;
  user_id?: number;
  work_mode?: string;
  search?: string;
  page: number;
  limit: number;
}

export async function listDailyLogs(userId: number, canManageAll: boolean, q: DailyLogListQuery) {
  const conditions: Array<SQL | undefined> = [eq(dailyWorkLogs.isDeleted, 0), visibleLogsCondition(userId, canManageAll)];
  if (q.filter_type === 'mine') conditions.push(eq(dailyWorkLogs.userId, userId));
  if (q.filter_type === 'mentioned') conditions.push(holdsUser(dailyWorkLogs.mentions, userId));
  if (q.date) conditions.push(eq(dailyWorkLogs.date, q.date));
  if (q.user_id) conditions.push(eq(dailyWorkLogs.userId, q.user_id));
  if (q.work_mode) conditions.push(eq(dailyWorkLogs.workMode, q.work_mode));
  if (q.search) {
    const pattern = containsLikePattern(q.search);
    conditions.push(or(
      ilike(dailyWorkLogs.title, pattern),
      ilike(dailyWorkLogs.content, pattern),
      ilike(dailyWorkLogs.userFullName, pattern),
      ilike(dailyWorkLogs.projectName, pattern),
      sql`${dailyWorkLogs.tags}::text ILIKE ${pattern}`,
    ));
  }
  const where = and(...conditions);
  const [{ total }] = await orm.select({ total: sql<number>`count(*)::int` }).from(dailyWorkLogs).where(where);
  const rows = await orm.select().from(dailyWorkLogs).where(where)
    .orderBy(desc(dailyWorkLogs.date), desc(dailyWorkLogs.id))
    .limit(q.limit).offset((q.page - 1) * q.limit);
  return { data: rows.map(formatDailyLog), total: Number(total), page: q.page, limit: q.limit };
}

const round1 = (n: unknown) => Math.round(Number(n || 0) * 10) / 10;

/** Statistics over exactly the logs the user sees in the list (TD-406), counted in SQL */
export async function dailyLogStats(userId: number, canManageAll: boolean) {
  const today = await businessTodayIsoDate();
  const mine = eq(dailyWorkLogs.userId, userId);
  // v9.0.260 (TD-635): the hours of a legacy leave log are not work hours
  const worked = sql`${dailyWorkLogs.workMode} is distinct from 'leave'`;
  const [row] = await orm.select({
    total: sql<number>`count(*)::int`,
    onsite: sql<number>`count(*) filter (where ${dailyWorkLogs.workMode} = 'onsite')::int`,
    remote: sql<number>`count(*) filter (where ${dailyWorkLogs.workMode} = 'remote')::int`,
    myMentions: sql<number>`count(*) filter (where ${holdsUser(dailyWorkLogs.mentions, userId)})::int`,
    myLogs: sql<number>`count(*) filter (where ${mine})::int`,
    myHours: sql<string>`coalesce(sum(${dailyWorkLogs.workHours}) filter (where ${mine} and ${worked}), 0)::text`,
    todayHours: sql<string>`coalesce(sum(${dailyWorkLogs.workHours}) filter (where ${mine} and ${worked} and ${dailyWorkLogs.date} = ${today}::text), 0)::text`,
  }).from(dailyWorkLogs).where(and(eq(dailyWorkLogs.isDeleted, 0), visibleLogsCondition(userId, canManageAll)));
  return {
    today_hours: round1(row.todayHours),
    my_total_logs: Number(row.myLogs),
    my_total_hours: round1(row.myHours),
    total_logs: Number(row.total),
    onsite_count: Number(row.onsite),
    remote_count: Number(row.remote),
    my_mentions_count: Number(row.myMentions),
  };
}

/** `[from, before)` of a Jalali (`1405/07`) or Gregorian (`2026-10`) month, as storage dates */
export function monthRange(yearMonth: string): { from: string; before: string } {
  const ym = yearMonth.trim().match(/^(\d{4})[-/](\d{1,2})$/);
  const month = ym ? Number(ym[2]) : 0;
  if (!ym || month < 1 || month > 12) {
    throw new ValidationError(`ماه گزارش «${yearMonth}» معتبر نیست؛ مانند ۱۴۰۵/۰۷ وارد کنید`);
  }
  const y = Number(ym[1]);
  const m = String(month).padStart(2, '0');
  if (y < 1900) {
    const from = toStorageDate(`${y}/${m}/01`);
    const before = from ? jalaliMonthStart(from, -1) : null;
    if (!from || !before) throw new ValidationError(`ماه گزارش «${yearMonth}» معتبر نیست؛ مانند ۱۴۰۵/۰۷ وارد کنید`);
    return { from, before };
  }
  const nextY = month === 12 ? y + 1 : y;
  const nextM = String(month === 12 ? 1 : month + 1).padStart(2, '0');
  return { from: `${y}-${m}-01`, before: `${nextY}-${nextM}-01` };
}

export interface SummaryQuery {
  report_type: 'daily' | 'monthly';
  date?: string;
  year_month?: string;
  user_id?: number;
}

/** Management summary (route guard `daily_logs.manage_all`): one day or one month, never the whole table */
export async function dailyLogSummary(q: SummaryQuery) {
  const conditions: Array<SQL | undefined> = [eq(dailyWorkLogs.isDeleted, 0)];
  let date = '';
  let yearMonth = '';
  if (q.report_type === 'monthly') {
    yearMonth = q.year_month || isoToJalaliDate(await businessTodayIsoDate()).slice(0, 7);
    const range = monthRange(yearMonth);
    conditions.push(gte(dailyWorkLogs.date, range.from), lt(dailyWorkLogs.date, range.before));
  } else {
    date = q.date || await businessTodayIsoDate();
    conditions.push(eq(dailyWorkLogs.date, date));
  }
  if (q.user_id) conditions.push(eq(dailyWorkLogs.userId, q.user_id));

  const logs = await orm.select().from(dailyWorkLogs).where(and(...conditions)).orderBy(desc(dailyWorkLogs.id));
  // همه کاربران سامانه برای نام نویسنده گزارش (v9.0.76، TD-521: کاربر با پیشوند آزمون دیگر کنار گذاشته نمی‌شود)
  const userRows = await orm.select({
    id: users.id, username: users.username, fullName: users.fullName, role: users.role, avatarUrl: users.avatarUrl,
  }).from(users).where(q.user_id ? eq(users.id, q.user_id) : undefined).orderBy(asc(users.id));

  type UserSummary = {
    userId: number; username: string; userFullName: string; role: string; avatarUrl?: string;
    totalHours: number; logsCount: number; onsiteCount: number; remoteCount: number; otherCount: number; dates: Set<string>;
    logs: Array<ReturnType<typeof formatDailyLog>>;
  };
  const byUser = new Map<number, UserSummary>();
  const entry = (id: number, username: string, fullName: string, role: string, avatarUrl?: string): UserSummary => ({
    userId: id, username, userFullName: fullName || username, role, avatarUrl,
    totalHours: 0, logsCount: 0, onsiteCount: 0, remoteCount: 0, otherCount: 0, dates: new Set(), logs: [],
  });
  for (const u of userRows) byUser.set(u.id, entry(u.id, u.username, u.fullName || '', u.role, u.avatarUrl || undefined));

  let totalTeamHours = 0;
  const allDates = new Set<string>();
  for (const l of logs) {
    let s = byUser.get(l.userId);
    if (!s) {
      s = entry(l.userId, l.username, l.userFullName || '', 'کاربر');
      byUser.set(l.userId, s);
    }
    // v9.0.260 (TD-635): only onsite and remote logs are counted as such; a legacy leave, mission or hybrid log is
    // «other», and a leave's hours are not work hours
    const hours = countsAsWorkHours(l.workMode) ? Number(l.workHours || 0) : 0;
    s.totalHours += hours;
    totalTeamHours += hours;
    s.logsCount += 1;
    if (l.workMode === 'remote') s.remoteCount += 1;
    else if (l.workMode === 'onsite') s.onsiteCount += 1;
    else s.otherCount += 1;
    if (l.date && countsAsWorkHours(l.workMode)) { s.dates.add(l.date); allDates.add(l.date); }
    s.logs.push(formatDailyLog(l));
  }

  const userSummaries = [...byUser.values()].map(u => ({
    userId: u.userId,
    username: u.username,
    userFullName: u.userFullName,
    role: u.role,
    avatarUrl: u.avatarUrl,
    totalHours: round1(u.totalHours),
    logsCount: u.logsCount,
    onsiteCount: u.onsiteCount,
    remoteCount: u.remoteCount,
    otherCount: u.otherCount,
    daysWorked: u.dates.size,
    avgDailyHours: u.dates.size > 0 ? round1(u.totalHours / u.dates.size) : 0,
    logs: u.logs,
  })).sort((a, b) => b.totalHours - a.totalHours);
  const activePersonnel = userSummaries.filter(u => u.logsCount > 0).length;

  return {
    report_type: q.report_type,
    date,
    year_month: yearMonth,
    total_team_hours: round1(totalTeamHours),
    active_personnel_count: activePersonnel,
    total_personnel_count: userRows.length,
    total_logs_count: logs.length,
    total_days_count: allDates.size,
    avg_hours_per_person: activePersonnel > 0 ? round1(totalTeamHours / activePersonnel) : 0,
    user_summaries: userSummaries,
  };
}
