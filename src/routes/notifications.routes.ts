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
import { generateWorkshopDueRemindersThrottled } from '../services/notifications/workshopDueReminders.js';
import { can } from '../middleware/authorize.js';
import { WORKSHOP_SELF_PERMISSION } from '../lib/permissions/workshopPermissions.js';
import { dismissNotification, markAllNotificationsRead, markNotificationRead } from '../services/notifications/notificationInbox.service.js';
import { withUtcTimestampKeys } from '../lib/serverTimestamp.js';
import { NOTIFICATION_TIMESTAMP_KEYS } from '../services/events/eventTimestamps.js';

const router = Router();
router.use(authenticateToken);

const notifParamSchema = z.object({
  params: z.object({
    id: numericIdString
  })
});

// v9.0.433 (TD-709): only the user's own due follow-ups (linked personnel id, else the exact trimmed name), never «contains»
async function checkAndGenerateCrmTaskDueNotifications(userId: number) {
  try {
    await generateCrmDueReminders(userId);
  } catch (err) {
    logger.error({ message: 'Error checking due CRM tasks notifications', error: err });
  }
}

// v10.1.38 (N-01, decision t8 A): a workshop worker's deadline reminders, once before and once after each deadline;
// the scan runs at most once an hour per user, outside any transaction
async function checkWorkshopDueReminders(user: Express.Request['user']) {
  try {
    if (user?.id && await can(user, WORKSHOP_SELF_PERMISSION)) await generateWorkshopDueRemindersThrottled(user.id);
  } catch (err) {
    logger.error({ message: 'Error checking workshop deadline reminders', error: err });
  }
}

// Get my notifications
router.get('/notifications', asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) throw new UnauthorizedError('احراز هویت انجام نشده است');

  await checkAndGenerateCrmTaskDueNotifications(userId);
  await checkWorkshopDueReminders(req.user);

  // v9.0.434 (TD-717): a dismissed notification is kept but never listed
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

  // v9.0.436 (TD-725): the creation time goes to the bell with a Z, so a new notification is «همین الان»
  res.json(withUtcTimestampKeys(mapped, NOTIFICATION_TIMESTAMP_KEYS));
}));

// Get unread notification count
router.get('/notifications/unread-count', asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) throw new UnauthorizedError('احراز هویت انجام نشده است');

  await checkAndGenerateCrmTaskDueNotifications(userId);

  // v9.0.434 (TD-717): counted in SQL, without dismissed notifications
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

  await markNotificationRead(userId, notifId);

  res.json({ success: true });
}));

// Mark all notifications as read
router.put('/notifications/read-all', asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) throw new UnauthorizedError('احراز هویت انجام نشده است');

  await markAllNotificationsRead(userId);

  res.json({ success: true });
}));

// Dismiss a notification
// v9.0.434 (TD-717, decision t8 a): the row is kept with dismissed_at, so a dismissed due reminder never comes back
router.delete('/notifications/:id', validate(notifParamSchema), asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) throw new UnauthorizedError('احراز هویت انجام نشده است');
  const notifId = Number(req.params.id);

  await dismissNotification(userId, notifId);

  res.json({ success: true });
}));

export default router;
