import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { orm } from '../db/drizzle.js';
import {
  MENU_CHILDREN_MAX, MENU_LABEL_MAX, MENU_LINK_KINDS, MENU_LOCATIONS, MENU_TOP_MAX, MENU_URL_MAX, type MenuLocation,
} from '../lib/storefront/storefrontMenuRules.js';
import { listMenus, menuLinkOptions, saveMenu } from '../services/storefront/storefrontMenus.service.js';

/**
 * v12 phase 9b (V12_SITE_NEXT_START_PLAN.md §6): «منوهای سایت» in the ERP (`/api/storefront/menus`). `site_content.view`
 * reads the four places and what a link may name; `site_content.manage` saves a place whole, under its version. Kept
 * apart from `storefront.manage`, so a colleague who edits menus and content never reaches the card, the prices or the
 * site's key.
 */
const router = Router();
const VIEW = 'site_content.view';
const MANAGE = 'site_content.manage';

const id = z.number().int().min(1).max(2_147_483_647);
// the service checks every rule with its message; these only bound what a request may carry
const leaf = z.object({
  id: id.nullable().optional(), label: z.string().max(MENU_LABEL_MAX * 2), kind: z.enum(MENU_LINK_KINDS),
  target: z.string().max(MENU_URL_MAX), itemId: id.nullable(), campaignId: id.nullable(), pageId: id.nullable().optional(), icon: z.string().max(20), isActive: z.boolean(),
}).strict();
const item = leaf.extend({ children: z.array(leaf).max(MENU_CHILDREN_MAX * 2) }).strict();
const saveSchema = z.object({
  params: z.object({ location: z.enum(MENU_LOCATIONS) }).passthrough(),
  body: z.object({
    enabled: z.boolean(), version: z.number().int().min(1).max(2_147_483_647),
    items: z.array(item).max(Math.max(...Object.values(MENU_TOP_MAX)) * 2),
  }).strict(),
});

router.use(authenticateToken);

router.get('/', requirePermission(VIEW), asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: await listMenus(orm) });
}));

router.get('/link-options', requirePermission(VIEW), asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: await menuLinkOptions(orm) });
}));

router.put('/:location', requirePermission(MANAGE), validate(saveSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await saveMenu(req, req.params.location as MenuLocation, req.body) });
}));

export default router;
