import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { FormDraftService } from '../services/drafts/formDraft.service.js';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { DRAFT_DEFAULT_KEY, DRAFT_EXPIRY_DAYS, DRAFT_ENTITY_TYPE_PATTERN, DRAFT_KEY_PATTERN } from '../lib/drafts/draftRules.js';

const router = Router();
router.use(authenticateToken);

// v9.0.294 (TD-677، B16-13): نوع و کلید پیش‌نویس با الگو و سقف طول؛ خطای پایگاه‌داده به errorHandler می‌رسد و متن SQL
// را به مرورگر نمی‌دهد (پیش‌تر هر خطا با پیام خامش و وضعیت ۴۰۰ برمی‌گشت)
const entityTypeField = z.string().regex(DRAFT_ENTITY_TYPE_PATTERN, 'نوع پیش‌نویس فقط حروف کوچک لاتین، رقم، «_» و «-» تا ۴۰ نویسه است');
const draftKeyField = z.string().regex(DRAFT_KEY_PATTERN, 'کلید پیش‌نویس فقط حروف لاتین، رقم، «_» و «-» تا ۶۴ نویسه است');

const saveDraftSchema = z.object({
  body: z.object({
    entityType: entityTypeField,
    draftKey: draftKeyField.optional().default(DRAFT_DEFAULT_KEY),
    payload: z.record(z.string(), z.unknown()),
    summary: z.string().max(500, 'خلاصه پیش‌نویس حداکثر ۵۰۰ نویسه است').optional().default(''),
    expiresInDays: z.number().int('ماندگاری پیش‌نویس باید عدد صحیح باشد')
      .min(DRAFT_EXPIRY_DAYS.min, 'ماندگاری پیش‌نویس دست‌کم ۱ روز است')
      .max(DRAFT_EXPIRY_DAYS.max, 'ماندگاری پیش‌نویس حداکثر ۹۰ روز است')
      .optional().default(DRAFT_EXPIRY_DAYS.default)
  })
});

const entityTypeParamSchema = z.object({
  params: z.object({ entityType: entityTypeField }),
  query: z.object({ draftKey: draftKeyField.optional() }).passthrough(),
});

const listDraftsSchema = z.object({
  query: z.object({ entityType: entityTypeField.optional() }).passthrough(),
});

const draftIdParamSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive('شناسه پیش‌نویس نامعتبر است') }),
});

const sessionIdOf = (header: unknown): string => (typeof header === 'string' ? header.slice(0, 128) : '');
const draftKeyOf = (value: unknown): string => (typeof value === 'string' && value ? value : DRAFT_DEFAULT_KEY);

// Save or update a server-backed draft
router.post('/drafts', validate(saveDraftSchema), asyncHandler(async (req, res) => {
  const result = await FormDraftService.saveDraft({
    userId: req.user?.id || null,
    username: req.user?.username || '',
    sessionId: sessionIdOf(req.headers['x-session-id']),
    entityType: req.body.entityType,
    draftKey: req.body.draftKey || DRAFT_DEFAULT_KEY,
    payload: req.body.payload,
    summary: req.body.summary,
    expiresInDays: req.body.expiresInDays
  });
  res.status(200).json(result);
}));

// Get a specific draft by entityType and draftKey
router.get('/drafts/:entityType', validate(entityTypeParamSchema), asyncHandler(async (req, res) => {
  const draft = await FormDraftService.getDraft(
    req.params.entityType, draftKeyOf(req.query.draftKey), req.user?.id || null, sessionIdOf(req.headers['x-session-id']),
  );
  res.json({ draft });
}));

// List all drafts for current user
router.get('/drafts', validate(listDraftsSchema), asyncHandler(async (req, res) => {
  const entityType = typeof req.query.entityType === 'string' ? req.query.entityType : undefined;
  const drafts = await FormDraftService.listUserDrafts(req.user?.id || null, sessionIdOf(req.headers['x-session-id']), entityType);
  res.json({ drafts, data: drafts });
}));

// Delete / discard a specific draft by entityType and optional draftKey
router.delete('/drafts/:entityType', validate(entityTypeParamSchema), asyncHandler(async (req, res) => {
  const result = await FormDraftService.deleteDraft(
    req.params.entityType, draftKeyOf(req.query.draftKey), req.user?.id || null, sessionIdOf(req.headers['x-session-id']),
  );
  res.json(result);
}));

// Delete a draft by specific numeric ID
router.delete('/drafts/id/:id', validate(draftIdParamSchema), asyncHandler(async (req, res) => {
  const result = await FormDraftService.deleteDraftById(Number(req.params.id), req.user?.id || null);
  res.json(result);
}));

export default router;
