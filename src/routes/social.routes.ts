import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticateToken } from '../middleware/auth.js';
import { numericIdString, validate } from '../middleware/validate.js';
import { UnauthorizedError } from '../errors/customErrors.js';
import { BIRTHDAY_REACTIONS, GREETING_MESSAGE_MAX, greetingMessageLength, type BirthdayReaction } from '../lib/social/birthdays.js';
import { deleteMyGreeting, listBirthdays, saveMyGreeting } from '../services/social/birthdays.service.js';
import { dismissWhatsNew, getSocialPreferences, getWhatsNew, listPresence, setSocialPreferences } from '../services/social/socialDashboard.service.js';

/**
 * v10.2 package 9 (group dashboard, social dashboard proposal parts A to E): every route is open to any signed-in user
 * (`LOGIN_ONLY_ROUTES`) and reads or writes only what the proposal allows: a birthday's day and month (never the year or
 * age), presence without the page, the user's own greeting and choices. No amount is ever read or sent.
 */
const router = Router();
// review N-4: only this router's own paths need the login; other /api requests never pass through it
router.use('/social', authenticateToken);

function currentUserId(req: { user?: { id?: number } }): number {
  const id = Number(req.user?.id);
  if (!id) throw new UnauthorizedError('احراز هویت انجام نشده است');
  return id;
}

const birthdayParam = z.object({ params: z.object({ personnelId: numericIdString }) });

const greetingSchema = birthdayParam.extend({
  body: z.object({
    reaction: z.enum(BIRTHDAY_REACTIONS as unknown as [BirthdayReaction, ...BirthdayReaction[]], { message: 'واکنش شناخته نیست' }).nullable().optional(),
    message: z.string().refine(m => greetingMessageLength(m) <= GREETING_MESSAGE_MAX, `پیام تبریک حداکثر ${GREETING_MESSAGE_MAX.toLocaleString('fa-IR')} نویسه است`).optional(),
  }).strict(),
});

const preferencesSchema = z.object({
  body: z.object({
    showBirthday: z.boolean({ message: 'روشن یا خاموش بودن را بفرستید' }).optional(),
    showPresence: z.boolean({ message: 'روشن یا خاموش بودن را بفرستید' }).optional(),
  }).strict(),
});

const dismissSchema = z.object({
  body: z.object({ version: z.string().min(1, 'نسخه را بفرستید').max(40) }).strict(),
});

router.get('/social/birthdays', asyncHandler(async (req, res) => {
  res.json(await listBirthdays(currentUserId(req)));
}));

router.put('/social/birthdays/:personnelId/greeting', validate(greetingSchema), asyncHandler(async (req, res) => {
  const body = req.body as { reaction?: BirthdayReaction | null; message?: string };
  res.json(await saveMyGreeting(currentUserId(req), Number(req.params.personnelId), { reaction: body.reaction ?? null, message: body.message ?? '' }, req));
}));

router.delete('/social/birthdays/:personnelId/greeting', validate(birthdayParam), asyncHandler(async (req, res) => {
  res.json(await deleteMyGreeting(currentUserId(req), Number(req.params.personnelId), req));
}));

router.get('/social/presence', asyncHandler(async (req, res) => {
  res.json({ data: await listPresence(currentUserId(req)) });
}));

router.get('/social/preferences', asyncHandler(async (req, res) => {
  res.json(await getSocialPreferences(currentUserId(req)));
}));

router.put('/social/preferences', validate(preferencesSchema), asyncHandler(async (req, res) => {
  res.json(await setSocialPreferences(currentUserId(req), req.body as { showBirthday?: boolean; showPresence?: boolean }, req));
}));

router.get('/social/whats-new', asyncHandler(async (req, res) => {
  res.json({ data: await getWhatsNew(currentUserId(req)) });
}));

router.post('/social/whats-new/dismiss', validate(dismissSchema), asyncHandler(async (req, res) => {
  res.json({ data: await dismissWhatsNew(currentUserId(req), String((req.body as { version: string }).version)) });
}));

export default router;
