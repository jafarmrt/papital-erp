import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { orm } from '../db/drizzle.js';
import { COLLECTION_INTRO_MAX } from '../lib/storefront/storefrontCollectionRules.js';
import { COLLECTION_NAME_MAX, IMAGE_ALT_MAX } from '../lib/storefront/storefrontPageParts.js';
import { listCollectionTexts, saveCollectionText } from '../services/storefront/storefrontCollections.service.js';

/**
 * v12 phase 10e (V12_SITE_NEXT_START_PLAN.md §7.2): «متن و تصویر کالکشن‌ها» in the ERP (`/api/storefront/collections`),
 * under the keys of the site's content: `site_content.view` reads the collections with their words,
 * `site_content.manage` saves the words of one. The collection is named in the body (a name may hold any character).
 * The schema only bounds what a request may carry; the service checks every field with its message (`checkedCollectionText`).
 */
const router = Router();
const id = z.number().int().min(1).max(2_147_483_647);
const saveSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(COLLECTION_NAME_MAX * 2), intro: z.string().max(COLLECTION_INTRO_MAX * 4), imageAssetId: id.nullable(),
    imageAlt: z.string().max(IMAGE_ALT_MAX * 2), morePageId: id.nullable(), version: z.number().int().min(0).max(2_147_483_647),
  }).strict(),
});

router.use(authenticateToken);

router.get('/', requirePermission('site_content.view'), asyncHandler(async (_req: Request, res: Response) => {
  res.json(await listCollectionTexts(orm));
}));

router.put('/', requirePermission('site_content.manage'), validate(saveSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await saveCollectionText(req, req.body) });
}));

export default router;
