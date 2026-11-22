import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePermission } from '../middleware/authorize.js';
import { numericIdString, validate } from '../middleware/validate.js';
import { orm } from '../db/drizzle.js';
import { PAGE_SECTIONS_MAX, PAGE_SEO_DESCRIPTION_MAX, PAGE_SEO_TITLE_MAX, PAGE_SLUG_MAX, PAGE_TEMPLATES, PAGE_TITLE_MAX } from '../lib/storefront/storefrontPageRules.js';
import { HERO_OPTIONS_PAGE_MAX, campaignHeroOptions } from '../services/storefront/storefrontCampaigns.service.js';
import { movePage } from '../services/storefront/storefrontPageMove.service.js';
import {
  createPage, deletePage, listPages, pageDetail, publishPage, revertDraft, saveDraft, unpublishPage,
} from '../services/storefront/storefrontPages.service.js';

/**
 * v12 phase 10b (V12_SITE_NEXT_START_PLAN.md §7.2): «صفحه‌های سایت» in the ERP (`/api/storefront/pages`).
 * `site_content.view` reads the pages and their drafts; `site_content.manage` makes, saves, publishes and removes them,
 * so a colleague who edits content never needs `storefront.manage` (the card, the prices, the site's key). Listing the
 * images of the media library needs «مشاهده کتابخانه تصاویر» (`media.view`) too, as for a campaign page's hero.
 * The schemas here only bound what a request may carry; the service rebuilds every section from its known fields and
 * refuses anything else with its message (`checkedPage`).
 */
const router = Router();
const VIEW = 'site_content.view';
const MANAGE = 'site_content.manage';
const MEDIA_VIEW = 'media.view';

const version = z.number().int().min(1).max(2_147_483_647);
const idParams = z.object({ id: numericIdString }).passthrough();
const text = (max: number) => z.string().max(max);
/** a section is checked field by field in the service; here it is only an object of a bounded size */
const section = z.record(z.string().max(40), z.unknown());
/**
 * The most characters the sections of one request may be as JSON: thirty sections of the longest text the rules take,
 * with the editor's own structure around every run. Nesting too deep to write out as JSON is refused the same way (10b
 * review: it was a 500).
 */
const SECTIONS_CHARS_MAX = 2_000_000;
function withinSize(list: unknown): boolean {
  try {
    return JSON.stringify(list).length <= SECTIONS_CHARS_MAX;
  } catch {
    return false;
  }
}
const sections = z.array(section).max(PAGE_SECTIONS_MAX * 2).refine(withinSize, 'بخش‌های صفحه بیش از اندازه بزرگ یا تودرتو هستند.');

const detailSchema = z.object({ params: idParams });
const createSchema = z.object({
  body: z.object({
    title: text(PAGE_TITLE_MAX * 2), slug: text(PAGE_SLUG_MAX * 2), template: z.enum(PAGE_TEMPLATES.map(t => t.key) as [string, ...string[]]).nullable(),
  }).strict(),
});
const saveSchema = z.object({
  params: idParams,
  body: z.object({
    title: text(PAGE_TITLE_MAX * 2), slug: text(PAGE_SLUG_MAX * 2), seoTitle: text(PAGE_SEO_TITLE_MAX * 2), seoDescription: text(PAGE_SEO_DESCRIPTION_MAX * 2),
    noindex: z.boolean(), shareImageAssetId: z.number().int().min(1).max(2_147_483_647).nullable(), sections, version,
  }).strict(),
});
const versionSchema = z.object({ params: idParams, body: z.object({ version }).strict() });
const moveSchema = z.object({ params: idParams, body: z.object({ slug: z.string().max(PAGE_SLUG_MAX * 2), version }).strict() });
const deleteSchema = z.object({
  params: idParams,
  query: z.object({ version: z.string().regex(/^[1-9]\d{0,9}$/).transform(Number) }).passthrough(),
});
const imageSchema = z.object({
  query: z.object({
    page: z.string().regex(/^[1-9]\d{0,5}$/).transform(Number).optional(),
    limit: z.string().regex(/^[1-9]\d{0,2}$/).transform(Number).optional(),
    q: text(100).optional(),
  }).passthrough(),
});

router.use(authenticateToken);

router.get('/', requirePermission(VIEW), asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: await listPages(orm) });
}));

// the images a page may name: live images of the media library with a light version (the list of a campaign page's hero)
router.get('/image-options', requirePermission(VIEW), requirePermission(MEDIA_VIEW), validate(imageSchema), asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as { page?: number; limit?: number; q?: string };
  res.json(await campaignHeroOptions({ q: query.q ?? '', page: query.page ?? 1, limit: Math.min(query.limit ?? 24, HERO_OPTIONS_PAGE_MAX) }));
}));

router.get('/:id', requirePermission(VIEW), validate(detailSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await pageDetail(orm, Number(req.params.id)) });
}));

router.post('/', requirePermission(MANAGE), validate(createSchema), asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json({ success: true, data: await createPage(req, req.body) });
}));

router.put('/:id', requirePermission(MANAGE), validate(saveSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await saveDraft(req, Number(req.params.id), req.body) });
}));

router.post('/:id/publish', requirePermission(MANAGE), validate(versionSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await publishPage(req, Number(req.params.id), req.body.version) });
}));

router.post('/:id/revert', requirePermission(MANAGE), validate(versionSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await revertDraft(req, Number(req.params.id), req.body.version) });
}));

router.post('/:id/unpublish', requirePermission(MANAGE), validate(versionSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await unpublishPage(req, Number(req.params.id), req.body.version) });
}));

// v12 phase 10c: «تغییر نشانی»: a page the shop made takes a new address; while it is on the site its old address is redirected
router.post('/:id/move', requirePermission(MANAGE), validate(moveSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await movePage(req, Number(req.params.id), String(req.body.slug), req.body.version) });
}));

router.delete('/:id', requirePermission(MANAGE), validate(deleteSchema), asyncHandler(async (req: Request, res: Response) => {
  await deletePage(req, Number(req.params.id), (req.query as unknown as { version: number }).version);
  res.json({ success: true });
}));

export default router;
