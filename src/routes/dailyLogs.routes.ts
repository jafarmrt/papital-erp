import { Router } from 'express';
import { eq, desc, and } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { dailyWorkLogs, users } from '../db/schema.js';
import { authenticateToken } from '../middleware/auth.js';
import { authorizePermission, requirePermission } from '../middleware/authorize.js';
import { isoToJalaliDate, toEnglishDigits } from '../utils.js';
import { requireStorageDate } from '../lib/storageDate.js';
import { businessTodayIsoDate } from '../lib/businessClock.js';
import { validate, paramsIdSchema } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { NotFoundError, UnauthorizedError, ValidationError } from '../errors/customErrors.js';
import { DEFAULT_DAILY_LOG_VISIBILITY, canSeeDailyLog, idList } from '../lib/dailyLogs/dailyLogVisibility.js';
import { canManageAllDailyLogs } from '../services/dailyLogs/dailyLogAccess.js';
import { createDailyLog, deleteDailyLog, reviewDailyLog, updateDailyLog } from '../services/dailyLogs/dailyLogWrite.service.js';
import { createDailyLogSchema, reviewDailyLogSchema, updateDailyLogSchema } from './dailyLogs.schemas.js';

const router = Router();
router.use(authenticateToken);

function formatDailyLog(l: (Partial<typeof dailyWorkLogs.$inferSelect> & Record<string, unknown>)) {
  const mentionsArr = idList(l.mentions);
  const allowedArr = idList(l.allowedUsers);
  const tagsArr = Array.isArray(l.tags) ? l.tags : [];
  // v7.0.134 (TD-232): ستون اصلی میلادی ISO است و date_iso همان مقدار را دارد
  const computedDateIso = String(l.date || '');

  return {
    ...l,
    id: l.id,
    user_id: l.userId,
    userId: l.userId,
    username: l.username,
    user_full_name: l.userFullName || l.username,
    userFullName: l.userFullName || l.username,
    date: l.date,
    date_iso: computedDateIso,
    dateIso: computedDateIso,
    start_time: l.startTime,
    startTime: l.startTime,
    end_time: l.endTime,
    endTime: l.endTime,
    work_hours: l.workHours,
    workHours: l.workHours,
    work_mode: l.workMode,
    workMode: l.workMode,
    title: l.title,
    content: l.content,
    project_id: l.projectId,
    projectId: l.projectId,
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
    created_at: l.createdAt,
    createdAt: l.createdAt
  };
}

// GET all accessible daily work logs
router.get('/daily-logs', authorizePermission('daily_logs.view'), asyncHandler(async (req, res) => {
  const currentUserId = req.user?.id;
    if (!currentUserId) throw new UnauthorizedError('احراز هویت انجام نشده است');

  const canManageAll = await canManageAllDailyLogs(req.user);

  const { date, user_id, work_mode, search, filter_type } = req.query;

  const logs = await orm
    .select()
    .from(dailyWorkLogs)
    .where(eq(dailyWorkLogs.isDeleted, 0))
    .orderBy(desc(dailyWorkLogs.id));

  // Filter by confidentiality & permissions
  const filtered = logs.filter(l => {
    // Manage all override
    if (canManageAll) {
      if (filter_type === 'mine') return l.userId === currentUserId;
      if (filter_type === 'mentioned') {
        const mList = idList(l.mentions);
        return mList.includes(currentUserId);
      }
      return true;
    }

    // Filter by special requested tab
    if (filter_type === 'mine') {
      if (l.userId !== currentUserId) return false;
    }

    if (filter_type === 'mentioned') {
      const mList = idList(l.mentions);
      if (!mList.includes(currentUserId)) return false;
    }

    return canSeeDailyLog(l, currentUserId, canManageAll);
  });

  // Secondary filters (search, date, work_mode, user_id)
  let result = filtered;

  if (date) {
    const targetDateIso = requireStorageDate(date, 'تاریخ');
    result = result.filter(l => l.date === targetDateIso);
  }

  if (user_id) {
    result = result.filter(l => l.userId === Number(user_id));
  }

  if (work_mode) {
    result = result.filter(l => l.workMode === String(work_mode));
  }

  if (search) {
    const q = String(search).toLowerCase();
    result = result.filter(l => 
      l.title.toLowerCase().includes(q) ||
      l.content.toLowerCase().includes(q) ||
      (l.userFullName && l.userFullName.toLowerCase().includes(q)) ||
      (l.projectName && l.projectName.toLowerCase().includes(q)) ||
      (Array.isArray(l.tags) && l.tags.some((t: string) => t.toLowerCase().includes(q)))
    );
  }

  const safeLimit = Math.min(Number(req.query.limit) || 200, 500);
  const mapped = result.slice(0, safeLimit).map(formatDailyLog);
  res.json(mapped);
}));

// GET stats for daily logs
router.get('/daily-logs/stats', authorizePermission('daily_logs.view'), asyncHandler(async (req, res) => {
  const currentUserId = req.user?.id;
  if (!currentUserId) throw new UnauthorizedError('احراز هویت انجام نشده است');
  const canManageAll = await canManageAllDailyLogs(req.user);

  // v8.0.125 (TD-406): آمار فقط گزارش‌هایی را می‌شمارد که همین کاربر در فهرست می‌بیند (قاعده محرمانگی TD-301)؛ پیش‌تر
  // شمار کل، حضوری/دورکاری و «اشاره به من» گزارش‌های محرمانه دیگران را هم می‌شمرد.
  const allLogs = (await orm
    .select()
    .from(dailyWorkLogs)
    .where(eq(dailyWorkLogs.isDeleted, 0)))
    .filter(l => canSeeDailyLog(l, currentUserId, canManageAll));

  const myLogs = allLogs.filter(l => l.userId === currentUserId);
  
  // Calculate total hours today for current user
  const todayStr = await businessTodayIsoDate();
  const myTodayLogs = myLogs.filter(l => l.date === todayStr || l.createdAt?.startsWith(todayStr));
  const todayHours = myTodayLogs.reduce((acc, curr) => acc + (curr.workHours || 0), 0);

  // Calculate total hours this month / overall
  const myTotalHours = myLogs.reduce((acc, curr) => acc + (curr.workHours || 0), 0);

  // Onsite vs Remote count
  const onsiteCount = allLogs.filter(l => l.workMode === 'onsite').length;
  const remoteCount = allLogs.filter(l => l.workMode === 'remote').length;

  // Mentioned logs count
  const myMentions = allLogs.filter(l => {
    const m = idList(l.mentions);
    return m.includes(currentUserId);
  }).length;

  res.json({
    today_hours: Math.round(todayHours * 10) / 10,
    my_total_logs: myLogs.length,
    my_total_hours: Math.round(myTotalHours * 10) / 10,
    total_logs: allLogs.length,
    onsite_count: onsiteCount,
    remote_count: remoteCount,
    my_mentions_count: myMentions
  });
}));

// GET aggregated management summary report (Daily & Monthly performance of all staff)
// گارد دسترسی: فقط ادمین یا نقش دارای مجوز daily_logs.manage_all (قابل تخصیص از مدیریت نقش‌ها)
router.get('/daily-logs/summary-report', authorizePermission('daily_logs.manage_all'), asyncHandler(async (req, res) => {
  const { report_type = 'daily', date, year_month, user_id } = req.query;

  const allLogs = await orm
    .select()
    .from(dailyWorkLogs)
    .where(eq(dailyWorkLogs.isDeleted, 0))
    .orderBy(desc(dailyWorkLogs.id));

  // همه کاربران سامانه برای نام نویسنده گزارش (v9.0.76، TD-521: کاربر با پیشوند آزمون دیگر کنار گذاشته نمی‌شود)
  const allUsersList = await orm.select({
    id: users.id,
    username: users.username,
    fullName: users.fullName,
    role: users.role,
    avatarUrl: users.avatarUrl
  })
  .from(users);

  let filtered = allLogs;

  // Filter by single user if requested
  if (user_id && Number(user_id) > 0) {
    filtered = filtered.filter(l => l.userId === Number(user_id));
  }

  if (report_type === 'daily' && date) {
    const targetDateIso = requireStorageDate(date, 'تاریخ گزارش');
    filtered = filtered.filter(l => l.date === targetDateIso);
  } else if (report_type === 'monthly' && year_month) {
    // v7.0.134 (TD-232): ماه گزارش شمسی است (۱۴۰۵/۰۷) و با ماه شمسی تاریخ کارکرد مقایسه می‌شود؛ ماه میلادی (2026-10) هم پذیرفته است.
    // پیش‌تر ماه شمسی به ماه میلادیِ روز اول آن تبدیل می‌شد و کارکردهای نیمه دوم ماه جا می‌افتاد.
    const ym = toEnglishDigits(String(year_month)).trim().match(/^(\d{4})[-/](\d{1,2})$/);
    if (!ym) throw new ValidationError(`ماه گزارش «${String(year_month)}» معتبر نیست؛ مانند ۱۴۰۵/۰۷ وارد کنید`);
    const y = Number(ym[1]);
    const m = ym[2].padStart(2, '0');
    filtered = y < 1900
      ? filtered.filter(l => isoToJalaliDate(l.date).slice(0, 7) === `${y}/${m}`)
      : filtered.filter(l => l.date.slice(0, 7) === `${y}-${m}`);
  }

  // Grouping by user
  const userSummaryMap: Record<number, {
    userId: number;
    username: string;
    userFullName: string;
    role: string;
    avatarUrl?: string;
    totalHours: number;
    logsCount: number;
    onsiteCount: number;
    remoteCount: number;
    datesSet: Set<string>;
    logs: Array<Record<string, unknown>>;
  }> = {};

  // Initialize map with all users (or filtered user)
  const usersToInclude = (user_id && Number(user_id) > 0) 
    ? allUsersList.filter(u => u.id === Number(user_id))
    : allUsersList;

  usersToInclude.forEach(u => {
    userSummaryMap[u.id] = {
      userId: u.id,
      username: u.username,
      userFullName: u.fullName || u.username,
      role: u.role,
      avatarUrl: u.avatarUrl || undefined,
      totalHours: 0,
      logsCount: 0,
      onsiteCount: 0,
      remoteCount: 0,
      datesSet: new Set(),
      logs: []
    };
  });

  filtered.forEach(l => {
    if (!userSummaryMap[l.userId]) {
      userSummaryMap[l.userId] = {
        userId: l.userId,
        username: l.username,
        userFullName: l.userFullName || l.username,
        role: 'کاربر',
        avatarUrl: undefined,
        totalHours: 0,
        logsCount: 0,
        onsiteCount: 0,
        remoteCount: 0,
        datesSet: new Set(),
        logs: []
      };
    }

    const uStat = userSummaryMap[l.userId];
    uStat.totalHours += (l.workHours || 0);
    uStat.logsCount += 1;
    if (l.workMode === 'remote') uStat.remoteCount += 1;
    else uStat.onsiteCount += 1;
    if (l.date) uStat.datesSet.add(l.date);

    uStat.logs.push(formatDailyLog(l));
  });

  const userSummaries = Object.values(userSummaryMap).map(u => ({
    userId: u.userId,
    username: u.username,
    userFullName: u.userFullName,
    role: u.role,
    avatarUrl: u.avatarUrl,
    totalHours: Math.round(u.totalHours * 10) / 10,
    logsCount: u.logsCount,
    onsiteCount: u.onsiteCount,
    remoteCount: u.remoteCount,
    daysWorked: u.datesSet.size,
    avgDailyHours: u.datesSet.size > 0 ? Math.round((u.totalHours / u.datesSet.size) * 10) / 10 : 0,
    logs: u.logs
  })).sort((a, b) => b.totalHours - a.totalHours);

  const totalTeamHours = filtered.reduce((sum, l) => sum + (l.workHours || 0), 0);
  const activePersonnel = userSummaries.filter(u => u.logsCount > 0).length;
  const totalDaysCount = new Set(filtered.map(l => l.date)).size;

  res.json({
    report_type: report_type || 'daily',
    date: date || '',
    year_month: year_month || '',
    total_team_hours: Math.round(totalTeamHours * 10) / 10,
    active_personnel_count: activePersonnel,
    total_personnel_count: usersToInclude.length,
    total_logs_count: filtered.length,
    total_days_count: totalDaysCount,
    avg_hours_per_person: activePersonnel > 0 ? Math.round((totalTeamHours / activePersonnel) * 10) / 10 : 0,
    user_summaries: userSummaries
  });
}));

// GET single daily log by ID
router.get('/daily-logs/:id', authorizePermission('daily_logs.view'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const logId = Number(req.params.id);
  const [l] = await orm.select().from(dailyWorkLogs).where(and(eq(dailyWorkLogs.id, logId), eq(dailyWorkLogs.isDeleted, 0)));
  // حوزه H (TD-301): همان قاعده محرمانگی فهرست؛ گزارشی که کاربر نمی‌بیند «یافت نشد» است
  if (!l || !canSeeDailyLog(l, req.user?.id, await canManageAllDailyLogs(req.user))) {
    throw new NotFoundError('گزارش کار یافت نشد');
  }

  res.json(formatDailyLog(l));
}));

// POST create new daily work log (v9.0.231+: one transaction with its notifications and audit row)
router.post('/daily-logs', authorizePermission('daily_logs.create'), validate(createDailyLogSchema), asyncHandler(async (req, res) => {
  if (!req.user?.id) throw new UnauthorizedError('احراز هویت انجام نشده است');
  const log = await createDailyLog(req.user, req.body);
  res.json(formatDailyLog(log));
}));

// PUT edit daily work log: the author, or a holder of daily_logs.manage_all (v9.0.231, TD-626)
router.put('/daily-logs/:id', authorizePermission('daily_logs.create'), validate(updateDailyLogSchema), asyncHandler(async (req, res) => {
  if (!req.user?.id) throw new UnauthorizedError('احراز هویت انجام نشده است');
  const updated = await updateDailyLog(req.user, Number(req.params.id), req.body);
  res.json(formatDailyLog(updated));
}));

// PUT manager review / feedback: only holders of daily_logs.manage_all (v9.0.231, TD-626)
router.put('/daily-logs/:id/review', requirePermission('daily_logs.manage_all'), validate(reviewDailyLogSchema), asyncHandler(async (req, res) => {
  if (!req.user?.id) throw new UnauthorizedError('احراز هویت انجام نشده است');
  const updated = await reviewDailyLog(req.user, Number(req.params.id), req.body.manager_notes);
  res.json(formatDailyLog(updated));
}));

// DELETE soft delete daily log: the author, or a holder of daily_logs.manage_all (v9.0.231, TD-626)
router.delete('/daily-logs/:id', authorizePermission('daily_logs.create'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  if (!req.user?.id) throw new UnauthorizedError('احراز هویت انجام نشده است');
  await deleteDailyLog(req.user, Number(req.params.id));
  res.json({ success: true });
}));

export default router;
