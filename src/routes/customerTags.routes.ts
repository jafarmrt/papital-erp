import { Router } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { authorizePermission } from '../middleware/authorize.js';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { READ_PERMISSIONS } from '../lib/recordReadPermissions.js';
import { createCustomerTag, deleteCustomerTag, listCustomerTags, updateCustomerTag } from '../services/customers/customerTags.service.js';
import { CUSTOMER_TAG_COLORS, CUSTOMER_TAG_NAME_MAX } from '../lib/customers/customerTags.js';

const router = Router();
router.use(authenticateToken);

const customerTagBody = z.object({
  name: z.string().max(CUSTOMER_TAG_NAME_MAX * 2, 'نام برچسب بیش از اندازه بلند است'),
  color: z.enum(CUSTOMER_TAG_COLORS, { message: 'رنگ برچسب از فهرست رنگ‌ها نیست' }).optional(),
}).strict();
const createCustomerTagValidation = z.object({ body: customerTagBody });
const updateCustomerTagValidation = z.object({
  body: customerTagBody.extend({ version: z.coerce.number().int().positive('نسخه برچسب باید مثبت باشد') }).strict(),
  params: z.object({ id: numericIdString }),
});

// v10.1.23 (N-02 بخش ۳، ت۱۳): برچسب‌های طرف حساب؛ تعریف و ویرایش با customers.manage، هر کدام با ردیف ممیزی در تراکنش خود
router.get('/customers/tags', authorizePermission(...READ_PERMISSIONS.customerTags), asyncHandler(async (_req, res) => {
  res.json({ data: await listCustomerTags() });
}));

router.post('/customers/tags', authorizePermission('customers.manage'), validate(createCustomerTagValidation), asyncHandler(async (req, res) => {
  res.status(201).json(await createCustomerTag(req, req.body));
}));

router.put('/customers/tags/:id', authorizePermission('customers.manage'), validate(updateCustomerTagValidation), asyncHandler(async (req, res) => {
  res.json(await updateCustomerTag(req, Number(req.params.id), req.body));
}));

router.delete('/customers/tags/:id', authorizePermission('customers.manage'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  await deleteCustomerTag(req, Number(req.params.id));
  res.json({ success: true });
}));

export default router;
