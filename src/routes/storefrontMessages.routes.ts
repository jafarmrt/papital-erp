import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePermission } from '../middleware/authorize.js';
import { numericIdString, validate } from '../middleware/validate.js';
import { orm } from '../db/drizzle.js';
import { MESSAGE_STATUSES, type MessageStatus } from '../lib/storefront/storefrontMessageRules.js';
import { deleteMessage, listMessages, messageDetail, setMessageStatus } from '../services/storefront/storefrontMessages.service.js';

/**
 * v12 phase 10f (V12_SITE_NEXT_START_PLAN.md §7.2 «۱۰و»): «پیام‌های سایت» in the ERP (`/api/storefront/messages`), under
 * keys of their own (a message holds a person's name and number): `site_messages.view` reads the messages,
 * `site_messages.manage` sets a message's status and removes it. The keys of the site's content open none of it.
 */
const router = Router();
const VIEW = 'site_messages.view';
const MANAGE = 'site_messages.manage';

const version = z.number().int().min(1).max(2_147_483_647);
const idParams = z.object({ id: numericIdString }).passthrough();
const listSchema = z.object({
  query: z.object({ page: z.string().regex(/^[1-9]\d{0,5}$/).transform(Number).optional(), status: z.enum(MESSAGE_STATUSES).optional() }).passthrough(),
});
const detailSchema = z.object({ params: idParams });
const statusSchema = z.object({ params: idParams, body: z.object({ status: z.enum(MESSAGE_STATUSES), version }).strict() });
const deleteSchema = z.object({
  params: idParams,
  query: z.object({ version: z.string().regex(/^[1-9]\d{0,9}$/).transform(Number) }).passthrough(),
});

router.use(authenticateToken);

router.get('/', requirePermission(VIEW), validate(listSchema), asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as { page?: number; status?: MessageStatus };
  res.json(await listMessages(orm, { page: query.page ?? 1, status: query.status ?? null }));
}));

router.get('/:id', requirePermission(VIEW), validate(detailSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await messageDetail(orm, Number(req.params.id)) });
}));

// the status is sent as the state to take
router.put('/:id/status', requirePermission(MANAGE), validate(statusSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await setMessageStatus(req, Number(req.params.id), req.body.status, req.body.version) });
}));

router.delete('/:id', requirePermission(MANAGE), validate(deleteSchema), asyncHandler(async (req: Request, res: Response) => {
  await deleteMessage(req, Number(req.params.id), (req.query as unknown as { version: number }).version);
  res.json({ success: true });
}));

export default router;
