import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import {
  SMS_HOURLY_CAP_MAX, SMS_API_KEY_MAX, SMS_KINDS, SMS_MESSAGE_STATUSES, SMS_PROVIDERS, SMS_TEMPLATE_MAX, type SmsKind, type SmsMessageStatus,
} from '../lib/storefront/storefrontSmsRules.js';
import { readSmsSettings, saveSmsSettings } from '../services/storefront/storefrontSmsSettings.service.js';
import { SMS_LOG_PAGE_MAX, listSmsMessages, sendTestSms } from '../services/storefront/storefrontSms.service.js';
import { orm } from '../db/drizzle.js';

/**
 * v11 phase 8.4a: the ERP side of the site's text messages (`/api/storefront/sms`), the «پیامک» section of the
 * «فروشگاه سایت» tab. `storefront.view` reads the settings and the log (phones with their middle digits hidden);
 * `storefront.manage` saves the settings and sends a test. The provider's key is write-only: no answer carries it.
 */
const router = Router();
const VIEW = 'storefront.view';
const MANAGE = 'storefront.manage';

const templates = z.object(Object.fromEntries(SMS_KINDS.map(kind => [kind, z.string().max(SMS_TEMPLATE_MAX).optional()]))).strict();
const settingsSchema = z.object({
  body: z.object({
    enabled: z.boolean(), provider: z.enum(SMS_PROVIDERS), apiKey: z.string().max(SMS_API_KEY_MAX), clearApiKey: z.boolean(),
    templates, hourlyCap: z.number().int().min(1).max(SMS_HOURLY_CAP_MAX),
    orderHourlyCap: z.number().int().min(1).max(SMS_HOURLY_CAP_MAX).optional(), version: z.number().int().min(0).max(2_147_483_647),
  }).strict(),
});
const testSchema = z.object({ body: z.object({ phone: z.string().max(40), kind: z.enum(SMS_KINDS) }).strict() });
const logSchema = z.object({
  query: z.object({
    page: z.string().regex(/^[1-9]\d{0,5}$/).transform(Number).optional(),
    limit: z.string().regex(/^[1-9]\d{0,2}$/).transform(Number).optional(),
    status: z.enum(SMS_MESSAGE_STATUSES).optional(),
    order: z.string().regex(/^\d{6,12}$/).optional(),
  }).passthrough(),
});

router.use(authenticateToken);

router.get('/settings', requirePermission(VIEW), asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: await readSmsSettings(orm) });
}));

router.put('/settings', requirePermission(MANAGE), validate(settingsSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await saveSmsSettings(req, req.body) });
}));

// a real text to the number typed (each press sends one)
router.post('/test', requirePermission(MANAGE), validate(testSchema), asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as { phone: string; kind: SmsKind };
  res.json({ success: true, data: await sendTestSms(req, body) });
}));

router.get('/messages', requirePermission(VIEW), validate(logSchema), asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as { page?: number; limit?: number; status?: SmsMessageStatus; order?: string };
  res.json(await listSmsMessages({
    page: query.page ?? 1, limit: Math.min(query.limit ?? 20, SMS_LOG_PAGE_MAX), status: query.status ?? '', orderNumber: query.order ?? '',
  }));
}));

export default router;
