import { Router } from 'express';
import { eq, desc, and } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { dailyWorkLogs, notifications, users, roles } from '../db/schema.js';
import { authenticateToken } from '../middleware/auth.js';
import { authorizePermission } from '../middleware/authorize.js';
import { logActivity } from '../lib/auditLogger.js';
import { isoToJalaliDate, toEnglishDigits } from '../utils.js';
import { requireStorageDate } from '../lib/storageDate.js';
import { businessTodayIsoDate } from '../lib/businessClock.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { NotFoundError, UnauthorizedError, ForbiddenError, ValidationError } from '../errors/customErrors.js';

const router = Router();
router.use(authenticateToken);

const createDailyLogSchema = z.object({
  body: z.object({
    date: z.string().optional(),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
    work_mode: z.enum(['onsite', 'remote', 'hybrid', 'mission', 'leave']).optional(),
    title: z.string().min(1, 'عنوان گزارش کار الزامی است'),
    content: z.string().min(1, 'شرح گزارش کار الزامی است'),
    project_id: z.union([z.number(), z.string(), z.null()]).optional(),
    project_name: z.string().optional(),
    tags: z.array(z.string()).optional(),
    mentions: z.array(z.union([z.number(), z.string()])).optional(),
    visibility: z.enum(['public', 'managers', 'mentioned_only', 'custom', 'private', 'all']).optional(),
    allowed_users: z.array(z.union([z.number(), z.string()])).optional(),
  })
});

const updateDailyLogSchema = z.object({
  body: z.object({
    date: z.string().optional(),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
    work_mode: z.enum(['onsite', 'remote', 'hybrid', 'mission', 'leave']).optional(),
    title: z.string().min(1, 'عنوان گزارش کار الزامی است').optional(),
    content: z.string().min(1, 'شرح گزارش کار الزامی است').optional(),
    project_id: z.union([z.number(), z.string(), z.null()]).optional(),
    project_name: z.string().optional(),
    tags: z.array(z.string()).optional(),
    mentions: z.array(z.union([z.number(), z.string()])).optional(),
    visibility: z.enum(['public', 'managers', 'mentioned_only', 'custom', 'private', 'all']).optional(),
    allowed_users: z.array(z.union([z.number(), z.string()])).optional(),
  }),
  params: z.object({
    id: numericIdString
  })
});

const reviewDailyLogSchema = z.object({
  body: z.object({
    manager_notes: z.string().optional()
  }),
  params: z.object({
    id: numericIdString
  })
});

function calculateWorkHours(startTime: string, endTime: string): number {
  try {
    if (!startTime || !endTime) return 8;
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    if (isNaN(startH) || isNaN(startM) || isNaN(endH) || isNaN(endM)) return 8;

    let startTotal = startH * 60 + startM;
    let endTotal = endH * 60 + endM;

    if (endTotal < startTotal) {
      endTotal += 24 * 60; // Overnight shift
    }

    const diffMinutes = endTotal - startTotal;
    return Math.max(0, Math.round((diffMinutes / 60) * 100) / 100);
  } catch (e) {
    return 8;
  }
}

function formatDailyLog(l: (Partial<typeof dailyWorkLogs.$inferSelect> & Record<string, unknown>)) {
  const mentionsArr = Array.isArray(l.mentions) ? l.mentions : [];
  const allowedArr = Array.isArray(l.allowedUsers) ? l.allowedUsers : [];
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
    visibility: l.visibility || 'public',
    allowed_users: allowedArr,
    allowedUsers: allowedArr,
    status: l.status || 'submitted',
    manager_notes: l.managerNotes || '',
    managerNotes: l.managerNotes || '',
    created_at: l.createdAt,
    createdAt: l.createdAt
  };
}

/** مدیر سیستم، مدیر، یا نقش دارای daily_logs.manage_all همه گزارش‌ها (محرمانه هم) را می‌بیند */
async function canManageAllDailyLogs(role: string | undefined): Promise<boolean> {
  if (role === 'admin' || role === 'manager') return true;
  const [roleRecord] = await orm.select().from(roles).where(eq(roles.code, role || ''));
  const perms = roleRecord && Array.isArray(roleRecord.permissions) ? (roleRecord.permissions as string[]) : [];
  return perms.includes('daily_logs.manage_all') || perms.includes('*');
}

/** قاعده محرمانگی یک گزارش کار برای کاربر (فهرست و دریافت تکی، حوزه H / TD-301) */
function canSeeDailyLog(l: typeof dailyWorkLogs.$inferSelect, userId: number | undefined, canManageAll: boolean): boolean {
  if (canManageAll) return true;
  if (userId === undefined) return false;
  if (l.userId === userId) return true; // Author can always see their own log

  const visibility = l.visibility || 'public';
  if (visibility === 'public' || visibility === 'all') return true;

  const mentionsArr = Array.isArray(l.mentions) ? l.mentions : [];
  if (visibility === 'mentioned_only') return mentionsArr.includes(userId);

  const allowedArr = Array.isArray(l.allowedUsers) ? l.allowedUsers : [];
  if (visibility === 'custom') return allowedArr.includes(userId) || mentionsArr.includes(userId);

  // 'managers' و 'private' فقط برای مدیران
  return false;
}

// GET all accessible daily work logs
router.get('/daily-logs', authorizePermission('daily_logs.view'), asyncHandler(async (req, res) => {
  const currentUserId = req.user?.id;
  const currentUserRole = req.user?.role;
  if (!currentUserId) throw new UnauthorizedError('احراز هویت انجام نشده است');

  const canManageAll = await canManageAllDailyLogs(currentUserRole);

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
        const mList = Array.isArray(l.mentions) ? l.mentions : [];
        return mList.includes(currentUserId);
      }
      return true;
    }

    // Filter by special requested tab
    if (filter_type === 'mine') {
      if (l.userId !== currentUserId) return false;
    }

    if (filter_type === 'mentioned') {
      const mList = Array.isArray(l.mentions) ? l.mentions : [];
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
  const canManageAll = await canManageAllDailyLogs(req.user?.role);

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
    const m = Array.isArray(l.mentions) ? l.mentions : [];
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

  // همه کاربران سامانه برای نام نویسنده گزارش (v9.0.70، TD-521: کاربر با پیشوند آزمون دیگر کنار گذاشته نمی‌شود)
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
  if (!l || !canSeeDailyLog(l, req.user?.id, await canManageAllDailyLogs(req.user?.role))) {
    throw new NotFoundError('گزارش کار یافت نشد');
  }

  res.json(formatDailyLog(l));
}));

// POST create new daily work log
router.post('/daily-logs', authorizePermission('daily_logs.create'), validate(createDailyLogSchema), asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  const username = req.user?.username;
  const userFullName = req.user?.full_name || username;

  if (!userId) throw new UnauthorizedError('احراز هویت انجام نشده است');

  const {
    date,
    start_time,
    end_time,
    work_mode,
    title,
    content,
    project_id,
    project_name,
    tags,
    mentions,
    visibility,
    allowed_users
  } = req.body;

  const startTime = start_time || '08:00';
  const endTime = end_time || '17:00';
  const computedHours = calculateWorkHours(startTime, endTime);

  const mentionsList = Array.isArray(mentions) ? mentions.map(Number) : [];
  const allowedList = Array.isArray(allowed_users) ? allowed_users.map(Number) : [];
  const tagsList = Array.isArray(tags) ? tags : [];

  // v7.0.134 (TD-232): تاریخ کارکرد میلادی ISO در هر دو ستون؛ ورودی شمسی تبدیل و نامعتبر 422
  const computedDateIso = requireStorageDate(date, 'تاریخ کارکرد') || await businessTodayIsoDate();

  const [newLog] = await orm
    .insert(dailyWorkLogs)
    .values({
      userId,
      username: username || 'user',
      userFullName: userFullName || 'کاربر سیستم',
      date: computedDateIso,
      dateIso: computedDateIso,
      startTime,
      endTime,
      workHours: computedHours,
      workMode: work_mode || 'onsite',
      title,
      content,
      projectId: project_id ? Number(project_id) : null,
      projectName: project_name || '',
      tags: tagsList,
      mentions: mentionsList,
      visibility: visibility || 'public',
      allowedUsers: allowedList,
      status: 'submitted'
    })
    .returning();

  // Send notifications to mentioned users
  if (mentionsList.length > 0) {
    for (const mUserId of mentionsList) {
      if (mUserId !== userId) {
        await orm.insert(notifications).values({
          userId: mUserId,
          senderId: userId,
          senderName: userFullName,
          type: 'mention',
          title: 'منشن در گزارش کار روزانه',
          message: `${userFullName} شما را در گزارش کار روزانه ("${title}") منشن کرد.`,
          link: `/daily-logs?id=${newLog.id}`,
          isRead: 0
        });
      }
    }
  }

  await logActivity({
    userId,
    username,
    userFullName,
    action: 'CREATE',
    entity: 'گزارش کار روزانه',
    entityId: newLog.id,
    description: `ثبت گزارش کار روزانه "${title}" (${work_mode === 'remote' ? 'دورکاری' : 'حضوری'}) - کارکرد: ${computedHours} ساعت`
  });

  res.json(formatDailyLog(newLog));
}));

// PUT edit daily work log
router.put('/daily-logs/:id', authorizePermission('daily_logs.create'), validate(updateDailyLogSchema), asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  const userRole = req.user?.role;
  const logId = Number(req.params.id);

  const [existing] = await orm
    .select()
    .from(dailyWorkLogs)
    .where(and(eq(dailyWorkLogs.id, logId), eq(dailyWorkLogs.isDeleted, 0)));

  if (!existing) throw new NotFoundError('گزارش کار یافت نشد');

  // Only author or admin/manager can edit
  if (existing.userId !== userId && userRole !== 'admin' && userRole !== 'manager') {
    throw new ForbiddenError('شما فقط مجاز به ویرایش گزارش کار خود هستید');
  }

  const {
    date,
    start_time,
    end_time,
    work_mode,
    title,
    content,
    project_id,
    project_name,
    tags,
    mentions,
    visibility,
    allowed_users
  } = req.body;

  const startTime = start_time !== undefined ? start_time : existing.startTime;
  const endTime = end_time !== undefined ? end_time : existing.endTime;
  const computedHours = calculateWorkHours(startTime, endTime);

  const mentionsList = Array.isArray(mentions) ? mentions.map(Number) : existing.mentions;
  const allowedList = Array.isArray(allowed_users) ? allowed_users.map(Number) : existing.allowedUsers;
  const tagsList = Array.isArray(tags) ? tags : existing.tags;

  const updatedDateIso = (date ? requireStorageDate(date, 'تاریخ کارکرد') : '') || existing.date;

  await orm
    .update(dailyWorkLogs)
    .set({
      date: updatedDateIso,
      dateIso: updatedDateIso,
      startTime,
      endTime,
      workHours: computedHours,
      workMode: work_mode || existing.workMode,
      title: title || existing.title,
      content: content || existing.content,
      projectId: project_id !== undefined ? (project_id ? Number(project_id) : null) : existing.projectId,
      projectName: project_name !== undefined ? project_name : existing.projectName,
      tags: tagsList,
      mentions: mentionsList,
      visibility: visibility || existing.visibility,
      allowedUsers: allowedList
    })
    .where(eq(dailyWorkLogs.id, logId));

  const [updated] = await orm.select().from(dailyWorkLogs).where(eq(dailyWorkLogs.id, logId));

  res.json(formatDailyLog(updated));
}));

// PUT Manager review / feedback
router.put('/daily-logs/:id/review', validate(reviewDailyLogSchema), asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  const userRole = req.user?.role;
  const userFullName = req.user?.full_name || req.user?.username;
  const logId = Number(req.params.id);

  if (userRole !== 'admin' && userRole !== 'manager') {
    throw new ForbiddenError('ثبت بازخورد مدیریتی صرفاً برای مدیران ارشد مجاز است');
  }

  const { manager_notes } = req.body;

  const [existing] = await orm
    .select()
    .from(dailyWorkLogs)
    .where(and(eq(dailyWorkLogs.id, logId), eq(dailyWorkLogs.isDeleted, 0)));

  if (!existing) throw new NotFoundError('گزارش کار یافت نشد');

  await orm
    .update(dailyWorkLogs)
    .set({
      status: 'reviewed',
      managerNotes: manager_notes || ''
    })
    .where(eq(dailyWorkLogs.id, logId));

  // Notify author
  if (existing.userId !== userId) {
    await orm.insert(notifications).values({
      userId: existing.userId,
      senderId: userId,
      senderName: userFullName,
      type: 'work_log_review',
      title: 'بازخورد مدیریتی بر گزارش کار',
      message: `${userFullName} برای گزارش کار "${existing.title}" یادداشت و بازخورد ثبت کرد.`,
      link: `/daily-logs?id=${logId}`,
      isRead: 0
    });
  }

  const [updated] = await orm.select().from(dailyWorkLogs).where(eq(dailyWorkLogs.id, logId));
  res.json(formatDailyLog(updated));
}));

// DELETE soft delete daily log
router.delete('/daily-logs/:id', authorizePermission('daily_logs.create'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  const userRole = req.user?.role;
  const logId = Number(req.params.id);

  const [existing] = await orm
    .select()
    .from(dailyWorkLogs)
    .where(and(eq(dailyWorkLogs.id, logId), eq(dailyWorkLogs.isDeleted, 0)));

  if (!existing) throw new NotFoundError('گزارش کار یافت نشد');

  if (existing.userId !== userId && userRole !== 'admin' && userRole !== 'manager') {
    throw new ForbiddenError('شما فقط مجاز به حذف گزارش کار خود هستید');
  }

  await orm
    .update(dailyWorkLogs)
    .set({ isDeleted: 1 })
    .where(eq(dailyWorkLogs.id, logId));

  res.json({ success: true });
}));

export default router;
