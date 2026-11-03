import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { NotFoundError, UnauthorizedError } from '../errors/customErrors.js';
import { isStorefrontApiKey, isStorefrontEnabled } from '../services/storefront/storefrontSettings.service.js';
import {
  CATALOG_PAGE_MAX, CATALOG_SORTS, catalogFacets, catalogPage, productBySlug, publicSettings, storefrontMediaFile, type CatalogSort,
} from '../services/storefront/storefrontCatalog.service.js';
import { STOREFRONT_SLUG_MAX } from '../lib/storefront/storefrontRules.js';

/**
 * v11 phase 8.1 (package 18, start plan §3): the Storefront API, read only, `GET /api/storefront/v1/...`. Only the site
 * app's server calls it, with `Authorization: Bearer <key>` (the key made in the «فروشگاه سایت» tab; the database keeps
 * its SHA-256). No route here takes a session: these are in `PUBLIC_ROUTES` of the route access policy because the key,
 * not a user, is the guard. A missing or wrong key is the same 401; the rate limit is per address, and generous because
 * one app server makes every call. While the owner has not turned the site on (`sf_enabled`, default off) every route is
 * 404, key or not. The answers name no cost, no other price list, no warehouse, no customer and no accounting data.
 */
const router = Router();
export const STOREFRONT_API_REQUESTS_PER_MINUTE = 1200;

const limiter = rateLimit({
  windowMs: 60_000,
  max: STOREFRONT_API_REQUESTS_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `storefront:${ipKeyGenerator(req.ip || req.socket?.remoteAddress || '127.0.0.1')}`,
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
});

const requireStorefrontKey = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  // off by default (shared repository rule: a new storefront feature merges switched off): every route is the same 404
  if (!(await isStorefrontEnabled())) throw new NotFoundError('پیدا نشد');
  const header = String(req.headers.authorization ?? '');
  const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!(await isStorefrontApiKey(presented))) throw new UnauthorizedError('کلید برنامه سایت پذیرفته نشد.');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

router.use(limiter, requireStorefrontKey);

const catalogSchema = z.object({
  query: z.object({
    page: z.string().regex(/^[1-9]\d{0,5}$/).transform(Number).optional(),
    limit: z.string().regex(/^[1-9]\d{0,2}$/).transform(Number).optional(),
    q: z.string().max(100).optional(),
    collection: z.string().max(100).optional(),
    category: z.string().max(100).optional(),
    sort: z.enum(CATALOG_SORTS).optional(),
  }).passthrough(),
});
const slugSchema = z.object({ params: z.object({ slug: z.string().min(1).max(STOREFRONT_SLUG_MAX) }).passthrough() });
const mediaSchema = z.object({ params: z.object({ file: z.string().min(1).max(80) }).passthrough() });

router.get('/settings', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: await publicSettings() });
}));

router.get('/products', validate(catalogSchema), asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as { page?: number; limit?: number; q?: string; collection?: string; category?: string; sort?: CatalogSort };
  res.json(await catalogPage({
    page: query.page ?? 1, limit: Math.min(query.limit ?? 24, CATALOG_PAGE_MAX), q: query.q ?? '',
    collection: query.collection ?? '', category: query.category ?? '', sort: query.sort ?? 'default',
  }));
}));

router.get('/products/:slug', validate(slugSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await productBySlug(String(req.params.slug)) });
}));

router.get('/facets', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: await catalogFacets() });
}));

router.get('/media/:file', validate(mediaSchema), asyncHandler(async (req: Request, res: Response) => {
  const filePath = await storefrontMediaFile(String(req.params.file));
  await new Promise<void>((resolve, reject) => {
    res.sendFile(filePath, {
      // a file is named by its content, so the app may keep it for a long time
      headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' },
      dotfiles: 'deny',
    }, (err) => (err && !res.headersSent ? reject(new NotFoundError('پیدا نشد')) : resolve()));
  });
}));

export default router;
