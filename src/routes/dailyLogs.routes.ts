import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { dailyWorkLogs } from '../db/schema.js';
import { authenticateToken } from '../middleware/auth.js';
import { authorizePermission, requirePermission } from '../middleware/authorize.js';
import { validate, paramsIdSchema } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { NotFoundError, UnauthorizedError } from '../errors/customErrors.js';
import { canSeeDailyLog } from '../lib/dailyLogs/dailyLogVisibility.js';
import { canManageAllDailyLogs } from '../services/dailyLogs/dailyLogAccess.js';
import { createDailyLog, deleteDailyLog, reviewDailyLog, updateDailyLog } from '../services/dailyLogs/dailyLogWrite.service.js';
import { dailyLogStats, dailyLogSummary, formatDailyLog, listDailyLogs } from '../services/dailyLogs/dailyLogRead.service.js';
import {
  createDailyLogSchema, dailyLogListQuerySchema, dailyLogSummaryQuerySchema, reviewDailyLogSchema, updateDailyLogSchema,
  type DailyLogListQueryParsed, type DailyLogSummaryQueryParsed,
} from './dailyLogs.schemas.js';

const router = Router();
router.use(authenticateToken);

// GET the daily work logs the user may see, one page (v9.0.237, TD-630: visibility, filters and paging in SQL)
router.get('/daily-logs', authorizePermission('daily_logs.view'), validate(dailyLogListQuerySchema), asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) throw new UnauthorizedError('احراز هویت انجام نشده است');
  const query = req.query as unknown as DailyLogListQueryParsed;
  res.json(await listDailyLogs(userId, await canManageAllDailyLogs(req.user), query));
}));

// GET statistics over the logs the user sees in the list (TD-406), counted in SQL (v9.0.237 / v9.0.238)
router.get('/daily-logs/stats', authorizePermission('daily_logs.view'), asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) throw new UnauthorizedError('احراز هویت انجام نشده است');
  res.json(await dailyLogStats(userId, await canManageAllDailyLogs(req.user)));
}));

// GET management summary of one day or one month; only daily_logs.manage_all (system admin included)
router.get('/daily-logs/summary-report', authorizePermission('daily_logs.manage_all'), validate(dailyLogSummaryQuerySchema), asyncHandler(async (req, res) => {
  res.json(await dailyLogSummary(req.query as unknown as DailyLogSummaryQueryParsed));
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
