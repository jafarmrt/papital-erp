import { Router } from 'express';
import { eq, desc, and, isNull, sql } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { notifications } from '../db/schema.js';
import { authenticateToken } from '../middleware/auth.js';
import { z } from 'zod';
import { validate, numericIdString } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { UnauthorizedError } from '../errors/customErrors.js';
import { logger } from '../middleware/logger.js';
import { generateCrmDueReminders } from '../services/notifications/crmDueReminders.js';

const router = Router();
router.use(authenticateToken);

const notifParamSchema = z.object({
  params: z.object({
    id: numericIdString
  })
});

// v9.0.388 (TD-709): only the user's own due follow-ups (linked personnel id, else the exact trimmed name), never «contains»
async function checkAndGenerateCrmTaskDueNotifications(userId: number) {
  try {
    await generateCrmDueReminders(userId);
  } catch (err) {
    logger.error({ message: 'Error checking due CRM tasks notifications', error: err });
  }
}

// Get my notifications
router.get('/notifications', asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) throw new UnauthorizedError('احراز هویت انجام نشده است');

  await checkAndGenerateCrmTaskDueNotifications(userId);

  // v9.0.389 (TD-717): a dismissed notification is kept but never listed
  const userNotifs = await orm
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.dismissedAt)))
    .orderBy(desc(notifications.createdAt))
    .limit(50);

  const mapped = userNotifs.map(n => ({
    id: n.id,
    user_id: n.userId,
    sender_id: n.senderId,
    sender_name: n.senderName,
    type: n.type,
    title: n.title,
    message: n.message,
    link: n.link,
    is_read: n.isRead,
    created_at: n.createdAt
  }));

  res.json(mapped);
}));

// Get unread notification count
router.get('/notifications/unread-count', asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) throw new UnauthorizedError('احراز هویت انجام نشده است');

  await checkAndGenerateCrmTaskDueNotifications(userId);

  // v9.0.389 (TD-717): counted in SQL, without dismissed notifications
  const [unread] = await orm
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, 0), isNull(notifications.dismissedAt)));

  res.json({ count: Number(unread?.count ?? 0) });
}));

// Mark one notification as read
router.put('/notifications/:id/read', validate(notifParamSchema), asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) throw new UnauthorizedError('احراز هویت انجام نشده است');
  const notifId = Number(req.params.id);

  await orm
    .update(notifications)
    .set({ isRead: 1 })
    .where(and(eq(notifications.id, notifId), eq(notifications.userId, userId)));

  res.json({ success: true });
}));

// Mark all notifications as read
router.put('/notifications/read-all', asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) throw new UnauthorizedError('احراز هویت انجام نشده است');

  await orm
    .update(notifications)
    .set({ isRead: 1 })
    .where(eq(notifications.userId, userId));

  res.json({ success: true });
}));

// Dismiss a notification
// v9.0.389 (TD-717, decision t8 a): the row is kept with dismissed_at, so a dismissed due reminder never comes back
router.delete('/notifications/:id', validate(notifParamSchema), asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) throw new UnauthorizedError('احراز هویت انجام نشده است');
  const notifId = Number(req.params.id);

  await orm
    .update(notifications)
    .set({ dismissedAt: sql`now()` })
    .where(and(eq(notifications.id, notifId), eq(notifications.userId, userId), isNull(notifications.dismissedAt)));

  res.json({ success: true });
}));

export default router;
