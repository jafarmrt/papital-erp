import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticateToken } from '../middleware/auth.js';
import { authorizePermission } from '../middleware/authorize.js';
import { idempotency } from '../middleware/idempotency.js';
import { numericIdString, validate } from '../middleware/validate.js';
import { PROJECT_EDIT_PERMISSIONS } from '../lib/permissions/projectPermissions.js';
import { PROJECT_VERSION_REQUIRED_MESSAGE } from '../lib/projects/projectVersion.js';
import { applyReservationReconcile, previewReservationReconcile } from '../services/projects/projectReservationReconcile.js';
import { projectPartTokensSchema } from './projectPartTokens.schemas.js';

/**
 * TD-1341 (بستهٔ ۱۲ بند ۱، گزینهٔ ب کارت ت۴۲): «تکمیل رزرو» پروژهٔ ثبت نهایی‌شده با همان مجوز ثبت نهایی (`projects.edit`).
 * `GET` پیش‌نمایش تغییرها را می‌دهد و چیزی نمی‌نویسد؛ `POST` با نسخهٔ زبانه و نشانهٔ همان پیش‌نمایش ثبت می‌کند.
 */
const router = Router();
router.use(authenticateToken);

const projectParams = z.object({ id: numericIdString });

const previewSchema = z.object({ params: projectParams });
const applySchema = z.object({
  params: projectParams,
  body: z.object({
    version: z.number({ error: PROJECT_VERSION_REQUIRED_MESSAGE }).int(PROJECT_VERSION_REQUIRED_MESSAGE).positive(PROJECT_VERSION_REQUIRED_MESSAGE),
    // TD-1342: نشانهٔ بخش‌هایی که زبانه از آن‌ها ساخته شده؛ با آن، نسخهٔ کهنه فقط با تغییر فهرست مواد ۴۰۹ است
    partTokens: projectPartTokensSchema.optional(),
    planToken: z.string().regex(/^[0-9a-f]{64}$/, 'نشانهٔ پیش‌نمایش تکمیل رزرو نامعتبر است؛ پیش‌نمایش را دوباره باز کنید.'),
  }).strict(),
});

router.get('/projects/:id/reservation-reconcile', authorizePermission(...PROJECT_EDIT_PERMISSIONS), validate(previewSchema), asyncHandler(async (req, res) => {
  res.json(await previewReservationReconcile(Number(req.params.id)));
}));

router.post('/projects/:id/reservation-reconcile', authorizePermission(...PROJECT_EDIT_PERMISSIONS), idempotency({ scope: 'projects' }), validate(applySchema), asyncHandler(async (req, res) => {
  res.json(await applyReservationReconcile(Number(req.params.id), { version: req.body.version, partTokens: req.body.partTokens, planToken: req.body.planToken }, { req }));
}));

export default router;
