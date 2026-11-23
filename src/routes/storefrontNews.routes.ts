import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePermission } from '../middleware/authorize.js';
import { numericIdString, validate } from '../middleware/validate.js';
import { orm } from '../db/drizzle.js';
import { NEWS_SUMMARY_MAX } from '../lib/storefront/storefrontNewsRules.js';
import { PAGE_SECTIONS_MAX, PAGE_SEO_DESCRIPTION_MAX, PAGE_SEO_TITLE_MAX, PAGE_SLUG_MAX, PAGE_TITLE_MAX } from '../lib/storefront/storefrontPageRules.js';
import {
  createNews, deleteNews, listNews, newsDetail, publishNews, revertNewsDraft, saveNewsDraft, unpublishNews,
} from '../services/storefront/storefrontNews.service.js';
import { setNewsOnSite } from '../services/storefront/storefrontNewsPublic.js';

/**
 * v12 phase 10d (V12_SITE_NEXT_START_PLAN.md §7.2): «خبرهای سایت» in the ERP (`/api/storefront/news`), under the keys
 * of the site's content: `site_content.view` reads the items and their drafts, `site_content.manage` makes, saves,
 * publishes and removes them. The images of an item are picked from the same list as a page's
 * (`GET /api/storefront/pages/image-options`). The schemas here only bound what a request may carry; the service
 * rebuilds every part from its known fields and refuses anything else with its message (`checkedNews`).
 */
const router = Router();
const VIEW = 'site_content.view';
const MANAGE = 'site_content.manage';

const version = z.number().int().min(1).max(2_147_483_647);
const idParams = z.object({ id: numericIdString }).passthrough();
const text = (max: number) => z.string().max(max);
const SECTIONS_CHARS_MAX = 2_000_000;
function withinSize(list: unknown): boolean {
  try {
    return JSON.stringify(list).length <= SECTIONS_CHARS_MAX;
  } catch {
    return false;
  }
}
const sections = z.array(z.record(z.string().max(40), z.unknown())).max(PAGE_SECTIONS_MAX * 2).refine(withinSize, 'بخش‌های خبر بیش از اندازه بزرگ یا تودرتو هستند.');

const listSchema = z.object({ query: z.object({ page: z.string().regex(/^[1-9]\d{0,5}$/).transform(Number).optional() }).passthrough() });
const detailSchema = z.object({ params: idParams });
const createSchema = z.object({ body: z.object({ title: text(PAGE_TITLE_MAX * 2), slug: text(PAGE_SLUG_MAX * 2) }).strict() });
const saveSchema = z.object({
  params: idParams,
  body: z.object({
    title: text(PAGE_TITLE_MAX * 2), slug: text(PAGE_SLUG_MAX * 2), summary: text(NEWS_SUMMARY_MAX * 4), coverAssetId: z.number().int().min(1).max(2_147_483_647).nullable(),
    newsDate: text(20), seoTitle: text(PAGE_SEO_TITLE_MAX * 2), seoDescription: text(PAGE_SEO_DESCRIPTION_MAX * 2), sections, version,
  }).strict(),
});
const versionSchema = z.object({ params: idParams, body: z.object({ version }).strict() });
const siteSchema = z.object({ body: z.object({ enabled: z.boolean() }).strict() });
const deleteSchema = z.object({
  params: idParams,
  query: z.object({ version: z.string().regex(/^[1-9]\d{0,9}$/).transform(Number) }).passthrough(),
});

router.use(authenticateToken);

router.get('/', requirePermission(VIEW), validate(listSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json(await listNews(orm, (req.query as { page?: number }).page ?? 1));
}));

router.get('/:id', requirePermission(VIEW), validate(detailSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await newsDetail(orm, Number(req.params.id)) });
}));

router.post('/', requirePermission(MANAGE), validate(createSchema), asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json({ success: true, data: await createNews(req, req.body) });
}));

// «خبرها روی سایت بیایند»: the switch is sent its target state (before `/:id`, which is a number)
router.put('/site', requirePermission(MANAGE), validate(siteSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await setNewsOnSite(req, req.body.enabled) });
}));

router.put('/:id', requirePermission(MANAGE), validate(saveSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await saveNewsDraft(req, Number(req.params.id), req.body) });
}));

router.post('/:id/publish', requirePermission(MANAGE), validate(versionSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await publishNews(req, Number(req.params.id), req.body.version) });
}));

router.post('/:id/revert', requirePermission(MANAGE), validate(versionSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await revertNewsDraft(req, Number(req.params.id), req.body.version) });
}));

router.post('/:id/unpublish', requirePermission(MANAGE), validate(versionSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await unpublishNews(req, Number(req.params.id), req.body.version) });
}));

router.delete('/:id', requirePermission(MANAGE), validate(deleteSchema), asyncHandler(async (req: Request, res: Response) => {
  await deleteNews(req, Number(req.params.id), (req.query as unknown as { version: number }).version);
  res.json({ success: true });
}));

export default router;
