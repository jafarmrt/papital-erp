import { Router } from 'express';
import { z } from 'zod';
import { orm } from '../db/drizzle.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticateToken } from '../middleware/auth.js';
import { authorizePermission, can } from '../middleware/authorize.js';
import { numericIdString, validate } from '../middleware/validate.js';
import { READ_PERMISSIONS } from '../lib/recordReadPermissions.js';
import { ITEM_COST_READ_PERMISSIONS } from '../lib/inventory/reservedItemsReport.js';
import { MATERIAL_AVAILABILITY_MAX_ITEMS } from '../lib/projects/materialAvailability.js';
import { projectMaterialAvailability } from '../services/projects/serverInventoryControl.js';
import { projectDeliveryCost } from '../services/projects/projectDeliveryCost.js';
import { projectIssuedMaterials } from '../services/projects/projectIssuedMaterials.js';

/**
 * v10.2.2 (TD-1290، بستهٔ ۳ نسخهٔ ۱۰.۲): سه مسیر فقط‌خواندنی کنترل مواد و ورود به انبار پروژه، با مجوز خواندن پرونده پروژه
 * (`READ_PERMISSIONS.projectRecord`، همان زبانهٔ مواد و صفحهٔ کنترل موجودی): موجودی آزاد هر کالا برای این پروژه (مقدار، بی بها)،
 * ورودی‌های بهای پیشنهادی رسید تولید و فهرست مواد گرفته‌شده از انبار. بها و ماندهٔ ۱۴۰۲ فقط به خوانندهٔ بهای کالا
 * (`ITEM_COST_READ_PERMISSIONS`) می‌رسد. هیچ‌کدام چیزی نمی‌نویسد.
 */
const router = Router();
router.use(authenticateToken);

/** v10.2.2 (TD-1290): ids are PostgreSQL integers; a larger one is 400, never a database error */
const PG_INT_MAX = 2_147_483_647;
const withinPgInt = (v: string) => v.length <= 10 && Number(v) <= PG_INT_MAX;

const projectParams = z.object({ id: numericIdString.refine(withinPgInt, 'شناسهٔ پروژه نامعتبر است') });

const availabilitySchema = z.object({
  params: projectParams,
  query: z.object({
    itemIds: z.string()
      .regex(/^\d+(,\d+)*$/, 'فهرست شناسهٔ کالاها نامعتبر است')
      .refine(v => v.split(',').length <= MATERIAL_AVAILABILITY_MAX_ITEMS, `حداکثر ${MATERIAL_AVAILABILITY_MAX_ITEMS} کالا در یک درخواست`)
      .refine(v => v.split(',').every(withinPgInt), 'فهرست شناسهٔ کالاها نامعتبر است')
      .optional(),
  }),
});
const projectOnlySchema = z.object({ params: projectParams });

const itemIdsOf = (raw: unknown): number[] =>
  typeof raw === 'string' && raw.length > 0 ? raw.split(',').map(Number).filter(n => Number.isInteger(n) && n > 0) : [];

router.get('/projects/:id/material-availability', authorizePermission(...READ_PERMISSIONS.projectRecord), validate(availabilitySchema), asyncHandler(async (req, res) => {
  res.json(await projectMaterialAvailability(orm, Number(req.params.id), itemIdsOf(req.query.itemIds)));
}));

router.get('/projects/:id/delivery-cost', authorizePermission(...READ_PERMISSIONS.projectRecord), validate(projectOnlySchema), asyncHandler(async (req, res) => {
  const costVisible = await can(req.user, ...ITEM_COST_READ_PERMISSIONS);
  res.json(await projectDeliveryCost(orm, Number(req.params.id), costVisible));
}));

router.get('/projects/:id/issued-materials', authorizePermission(...READ_PERMISSIONS.projectRecord), validate(projectOnlySchema), asyncHandler(async (req, res) => {
  const costVisible = await can(req.user, ...ITEM_COST_READ_PERMISSIONS);
  res.json(await projectIssuedMaterials(orm, Number(req.params.id), costVisible));
}));

export default router;
