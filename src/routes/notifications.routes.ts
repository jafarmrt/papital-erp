import { Router } from 'express';
import { eq, desc, and, sql } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { notifications, crmActivities, users } from '../db/schema.js';
import { authenticateToken } from '../middleware/auth.js';
import { getTodayJalaliDate } from '../utils.js';
import { businessTodayIsoDate } from '../lib/businessClock.js';
import { z } from 'zod';
import { validate, numericIdString } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { UnauthorizedError } from '../errors/customErrors.js';
import { logger } from '../middleware/logger.js';

const router = Router();
router.use(authenticateToken);

const notifParamSchema = z.object({
  params: z.object({
    id: numericIdString
  })
});

async function checkAndGenerateCrmTaskDueNotifications(userId: number) {
  try {
    const [u] = await orm.select().from(users).where(eq(users.id, userId));
    if (!u) return;

    const userFullName = (u.fullName || '').trim();
    const username = (u.username || '').trim();

    const todayJalali = getTodayJalaliDate();
    const todayGregorian = await businessTodayIsoDate();

    const pendingActs = await orm
      .select()
      .from(crmActivities)
      .where(
        and(
          eq(crmActivities.isDeleted, 0),
          eq(crmActivities.isFollowUpCompleted, 0),
          sql`length(COALESCE(${crmActivities.nextFollowUpDate}, '')) > 0`
        )
      );

    for (const act of pendingActs) {
      const assignee = (act.assignedTo || act.loggedBy || '').trim();
      const isMyTask =
        (userFullName && assignee.includes(userFullName)) ||
        (username && assignee.includes(username)) ||
        assignee === userFullName ||
        assignee === username;

      if (!isMyTask) continue;

      const dueDate = (act.nextFollowUpDate || '').trim();
      const isDue = dueDate <= todayJalali || dueDate <= todayGregorian;
      if (!isDue) continue;

      const notifLink = `/crm?activityId=${act.id}`;
      const [existingNotif] = await orm
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            eq(notifications.link, notifLink)
          )
        );

      if (!existingNotif) {
        await orm.insert(notifications).values({
          userId: userId,
          senderId: null,
          senderName: 'سیستم CRM',
          type: 'crm_due_task',
          title: '⏰ سررسید تسک پیگیری CRM',
          message: `سررسید تسک: "${act.nextFollowUpTask || act.title}" (تاریخ: ${dueDate})`,
          link: notifLink,
          isRead: 0
        });
      }
    }
  } catch (err) {
    logger.error({ message: 'Error checking due CRM tasks notifications', error: err });
  }
}

// Get my notifications
router.get('/notifications', asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) throw new UnauthorizedError('احراز هویت انجام نشده است');

  await checkAndGenerateCrmTaskDueNotifications(userId);

  const userNotifs = await orm
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
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

  const unread = await orm
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, 0)));

  res.json({ count: unread.length });
}));

// Mark one notification as read
router.put('/notifications/:id/read', validate(notifParamSchema), asyncHandler(async (req, res) => {
  const userId = req.user?.id;
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

  await orm
    .update(notifications)
    .set({ isRead: 1 })
    .where(eq(notifications.userId, userId));

  res.json({ success: true });
}));

// Delete a notification
router.delete('/notifications/:id', validate(notifParamSchema), asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  const notifId = Number(req.params.id);

  await orm
    .delete(notifications)
    .where(and(eq(notifications.id, notifId), eq(notifications.userId, userId)));

  res.json({ success: true });
}));

export default router;
