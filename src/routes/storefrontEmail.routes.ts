import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import {
  EMAIL_ADDRESS_MAX, EMAIL_FROM_NAME_MAX, EMAIL_HOST_MAX, EMAIL_PASSWORD_MAX, EMAIL_SECURITY_MODES, EMAIL_USERNAME_MAX,
} from '../lib/storefront/storefrontEmailRules.js';
import { readEmailSettings, saveEmailSettings, sendTestEmail } from '../services/storefront/storefrontEmailSettings.service.js';
import { orm } from '../db/drizzle.js';

/**
 * v12 phase 8e (owner's decision 7): the ERP side of the site's email (`/api/storefront/email`), the «ایمیل» section of the
 * «فروشگاه سایت» tab. `storefront.view` reads the settings; `storefront.manage` saves them and sends a test mail. The mail
 * server's password is write-only: no answer carries it.
 */
const router = Router();
const VIEW = 'storefront.view';
const MANAGE = 'storefront.manage';

const settingsSchema = z.object({
  body: z.object({
    enabled: z.boolean(), host: z.string().max(EMAIL_HOST_MAX), port: z.number().int().min(1).max(65535), security: z.enum(EMAIL_SECURITY_MODES),
    username: z.string().max(EMAIL_USERNAME_MAX), password: z.string().max(EMAIL_PASSWORD_MAX), clearPassword: z.boolean(),
    fromAddress: z.string().max(EMAIL_ADDRESS_MAX), fromName: z.string().max(EMAIL_FROM_NAME_MAX), version: z.number().int().min(0).max(2_147_483_647),
  }).strict(),
});
const testSchema = z.object({ body: z.object({ to: z.string().max(EMAIL_ADDRESS_MAX) }).strict() });
// each press is a real connection to the mail server: a few a minute for each colleague
const testLimiter = rateLimit({
  windowMs: 60_000, max: 5, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `storefront-email-test:${String((req as Request & { user?: { id?: unknown } }).user?.id ?? 'none')}`,
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
  message: { error: 'ایمیل‌های آزمایشی زیاد بود؛ یک دقیقه صبر کنید.', code: 'STOREFRONT_EMAIL_TEST_LIMIT' },
});

router.use(authenticateToken);

router.get('/settings', requirePermission(VIEW), asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: await readEmailSettings(orm) });
}));

router.put('/settings', requirePermission(MANAGE), validate(settingsSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await saveEmailSettings(req, req.body) });
}));

router.post('/test', requirePermission(MANAGE), testLimiter, validate(testSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await sendTestEmail(req, req.body as { to: string }) });
}));

export default router;
