import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePermission } from '../middleware/authorize.js';
import { numericIdString, validate } from '../middleware/validate.js';
import { orm } from '../db/drizzle.js';
import {
  FORM_FIELDS_MAX, FORM_INTRO_MAX, FORM_KEY_MAX, FORM_SUBMIT_LABEL_MAX, FORM_SUCCESS_MAX, FORM_TEMPLATES, FORM_TITLE_MAX,
} from '../lib/storefront/storefrontFormRules.js';
import { createForm, deleteForm, formDetail, listForms, saveForm, setFormEnabled, setFormMakesLead } from '../services/storefront/storefrontForms.service.js';

/**
 * v12 phase 10f (V12_SITE_NEXT_START_PLAN.md §7.2 «۱۰و»): «فرم‌های سایت» in the ERP (`/api/storefront/forms`), under the
 * keys of the site's content: `site_content.view` reads the forms, `site_content.manage` makes, saves, switches and
 * removes them. The schemas here only bound what a request may carry; the service rebuilds every field from its known
 * keys and refuses anything else with its message (`checkedForm`).
 */
const router = Router();
const VIEW = 'site_content.view';
const MANAGE = 'site_content.manage';

const version = z.number().int().min(1).max(2_147_483_647);
const idParams = z.object({ id: numericIdString }).passthrough();
const text = (max: number) => z.string().max(max);
const FIELDS_CHARS_MAX = 60_000;
function withinSize(list: unknown): boolean {
  try {
    return JSON.stringify(list).length <= FIELDS_CHARS_MAX;
  } catch {
    return false;
  }
}
const fields = z.array(z.record(z.string().max(40), z.unknown())).max(FORM_FIELDS_MAX * 2).refine(withinSize, 'فیلدهای فرم بیش از اندازه بزرگ هستند.');

const detailSchema = z.object({ params: idParams });
const createSchema = z.object({
  body: z.object({ title: text(FORM_TITLE_MAX * 2), key: text(FORM_KEY_MAX * 2), template: z.enum(FORM_TEMPLATES).nullable() }).strict(),
});
const saveSchema = z.object({
  params: idParams,
  body: z.object({
    key: text(FORM_KEY_MAX * 2), title: text(FORM_TITLE_MAX * 2), intro: text(FORM_INTRO_MAX * 4), fields,
    submitLabel: text(FORM_SUBMIT_LABEL_MAX * 2), successMessage: text(FORM_SUCCESS_MAX * 2), version,
  }).strict(),
});
const switchSchema = z.object({ params: idParams, body: z.object({ enabled: z.boolean(), version }).strict() });
const deleteSchema = z.object({
  params: idParams,
  query: z.object({ version: z.string().regex(/^[1-9]\d{0,9}$/).transform(Number) }).passthrough(),
});

router.use(authenticateToken);

router.get('/', requirePermission(VIEW), asyncHandler(async (_req: Request, res: Response) => {
  res.json(await listForms(orm));
}));

router.get('/:id', requirePermission(VIEW), validate(detailSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await formDetail(orm, Number(req.params.id)) });
}));

router.post('/', requirePermission(MANAGE), validate(createSchema), asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json({ success: true, data: await createForm(req, req.body) });
}));

router.put('/:id', requirePermission(MANAGE), validate(saveSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await saveForm(req, Number(req.params.id), req.body) });
}));

// «این فرم روی سایت باشد»: the switch is sent its target state
router.put('/:id/enabled', requirePermission(MANAGE), validate(switchSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await setFormEnabled(req, Number(req.params.id), req.body.enabled, req.body.version) });
}));

// «پروندهٔ فروش هم بساز»: the switch is sent its target state
router.put('/:id/makes-lead', requirePermission(MANAGE), validate(switchSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await setFormMakesLead(req, Number(req.params.id), req.body.enabled, req.body.version) });
}));

router.delete('/:id', requirePermission(MANAGE), validate(deleteSchema), asyncHandler(async (req: Request, res: Response) => {
  await deleteForm(req, Number(req.params.id), (req.query as unknown as { version: number }).version);
  res.json({ success: true });
}));

export default router;
