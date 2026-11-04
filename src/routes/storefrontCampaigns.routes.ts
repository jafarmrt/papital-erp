import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePermission } from '../middleware/authorize.js';
import { idempotency } from '../middleware/idempotency.js';
import { numericIdString, validate } from '../middleware/validate.js';
import { orm } from '../db/drizzle.js';
import {
  CAMPAIGN_BODY_MAX, CAMPAIGN_COLLECTION_MAX, CAMPAIGN_PRODUCTS_MAX, CAMPAIGN_SLUG_MAX, CAMPAIGN_SOURCES, CAMPAIGN_SUMMARY_MAX,
  CAMPAIGN_TITLE_MAX,
} from '../lib/storefront/storefrontCampaignRules.js';
import {
  HERO_OPTIONS_PAGE_MAX, campaignHeroOptions, createCampaign, deleteCampaign, listCampaigns, updateCampaign,
} from '../services/storefront/storefrontCampaigns.service.js';

/**
 * v11 phase 8.5b: the ERP side of «صفحه‌های ویژه» (`/api/storefront/campaigns`), a section of the «فروشگاه سایت» tab.
 * `storefront.view` reads the pages, and with `media.view` the images a page may take; `storefront.manage` makes, edits and
 * removes a page (choosing a new hero image needs `media.view` too).
 */
const router = Router();
const VIEW = 'storefront.view';
const MANAGE = 'storefront.manage';
const MEDIA_VIEW = 'media.view';

const text = (max: number) => z.string().max(max);
const version = z.number().int().min(0).max(2_147_483_647);
// the lengths are checked again, with their messages, by the service; these only bound what a request may carry
const body = z.object({
  slug: text(CAMPAIGN_SLUG_MAX * 2), title: text(CAMPAIGN_TITLE_MAX * 2), summary: text(CAMPAIGN_SUMMARY_MAX * 2), body: text(CAMPAIGN_BODY_MAX * 2),
  heroAssetId: z.number().int().min(1).max(2_147_483_647).nullable(), source: z.enum(CAMPAIGN_SOURCES), collection: text(CAMPAIGN_COLLECTION_MAX * 2),
  itemIds: z.array(z.number().int().min(1).max(2_147_483_647)).max(CAMPAIGN_PRODUCTS_MAX * 2), discountCode: text(60),
  startsOn: text(10), endsOn: text(10), homeBanner: z.boolean(), isActive: z.boolean(),
});
const createSchema = z.object({ body: body.strict() });
const updateSchema = z.object({ params: z.object({ id: numericIdString }).passthrough(), body: body.extend({ version: version.min(1) }).strict() });
const deleteSchema = z.object({
  params: z.object({ id: numericIdString }).passthrough(),
  query: z.object({ version: z.string().regex(/^[1-9]\d{0,9}$/).transform(Number) }).passthrough(),
});
const heroSchema = z.object({
  query: z.object({
    q: text(100).optional(),
    page: z.string().regex(/^[1-9]\d{0,5}$/).transform(Number).optional(),
    limit: z.string().regex(/^[1-9]\d{0,2}$/).transform(Number).optional(),
  }).passthrough(),
});

router.use(authenticateToken);

router.get('/', requirePermission(VIEW), asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: await listCampaigns(orm) });
}));

// the media library's own key too: the picker lists the library's images, their titles and item codes
router.get('/hero-images', requirePermission(VIEW), requirePermission(MEDIA_VIEW), validate(heroSchema), asyncHandler(async (req: Request, res: Response) => {
  const q = req.query as { q?: string; page?: number; limit?: number };
  res.json(await campaignHeroOptions({ q: q.q ?? '', page: q.page ?? 1, limit: Math.min(q.limit ?? 24, HERO_OPTIONS_PAGE_MAX) }));
}));

router.post('/', requirePermission(MANAGE), idempotency({ scope: 'storefront' }), validate(createSchema), asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json({ success: true, data: await createCampaign(req, req.body) });
}));

router.put('/:id', requirePermission(MANAGE), validate(updateSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await updateCampaign(req, Number(req.params.id), req.body) });
}));

router.delete('/:id', requirePermission(MANAGE), validate(deleteSchema), asyncHandler(async (req: Request, res: Response) => {
  await deleteCampaign(req, Number(req.params.id), Number((req.query as { version?: number }).version));
  res.json({ success: true });
}));

export default router;
