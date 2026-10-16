import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireSystemAdmin } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { UnauthorizedError } from '../errors/customErrors.js';
import { MESSENGERS, type Messenger } from '../lib/messenger/messengerLinks.js';
import { listBotViews, saveBotToken } from '../services/messenger/messengerBots.service.js';
import { issueLinkCode, listActiveLinksForAdmin, listMyLinks, sendTestMessage, unlinkMine } from '../services/messenger/messengerLinks.service.js';

/**
 * v10.1.38 (messenger notifications plan part 1): the staff messenger bots. A user reads, makes and ends only their own
 * links (login only: `/messenger/links/mine` and `/messenger/links/:messenger/*`); the bots' tokens and the list of
 * linked users are for the system admin, and no answer ever carries a token or a chat id.
 */
const router = Router();
router.use(authenticateToken);

const messengerParam = z.object({ params: z.object({ messenger: z.enum(MESSENGERS, { message: 'پیام‌رسان باید «بله» یا «تلگرام» باشد' }) }) });

// a code request and a test message carry no body (TD-979: every writer route reads its input through Zod)
const messengerNoBody = messengerParam.extend({ body: z.object({}).strict() });

const botTokenSchema = messengerParam.extend({
  body: z.object({ token: z.string().max(200, 'نشانه ربات بیش از اندازه بلند است') }).strict(),
});

function currentUserId(req: { user?: { id?: number } }): number {
  const id = Number(req.user?.id);
  if (!id) throw new UnauthorizedError('احراز هویت انجام نشده است');
  return id;
}

router.get('/messenger/links/mine', asyncHandler(async (req, res) => {
  res.json({ data: await listMyLinks(currentUserId(req)) });
}));

router.post('/messenger/links/:messenger/code', validate(messengerNoBody), asyncHandler(async (req, res) => {
  res.status(201).json(await issueLinkCode(currentUserId(req), req.params.messenger as Messenger));
}));

router.post('/messenger/links/:messenger/test', validate(messengerNoBody), asyncHandler(async (req, res) => {
  await sendTestMessage(currentUserId(req), req.params.messenger as Messenger);
  res.json({ success: true });
}));

router.delete('/messenger/links/:messenger', validate(messengerParam), asyncHandler(async (req, res) => {
  await unlinkMine(currentUserId(req), req.params.messenger as Messenger, req);
  res.json({ success: true });
}));

router.get('/messenger/bots', requireSystemAdmin, asyncHandler(async (_req, res) => {
  res.json({ data: await listBotViews() });
}));

router.put('/messenger/bots/:messenger', requireSystemAdmin, validate(botTokenSchema), asyncHandler(async (req, res) => {
  res.json(await saveBotToken({ messenger: req.params.messenger as Messenger, token: String(req.body.token ?? ''), req }));
}));

router.get('/messenger/links', requireSystemAdmin, asyncHandler(async (_req, res) => {
  res.json({ data: await listActiveLinksForAdmin() });
}));

export default router;
