import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { FormDraftService } from '../services/drafts/formDraft.service.js';
import { z } from 'zod';
import { validate, paramsIdSchema } from '../middleware/validate.js';
import { logger } from '../middleware/logger.js';

const router = Router();
router.use(authenticateToken);

const saveDraftSchema = z.object({
  body: z.object({
    entityType: z.string().min(1, 'نوع موجودیت (entityType) الزامی است'),
    draftKey: z.string().optional().default('default'),
    payload: z.record(z.string(), z.any()),
    summary: z.string().optional().default(''),
    expiresInDays: z.number().optional().default(30)
  })
});

const entityTypeParamSchema = z.object({
  params: z.object({
    entityType: z.string().min(1, 'نوع موجودیت الزامی است')
  })
});

// Save or update a server-backed draft
router.post('/drafts', validate(saveDraftSchema), async (req: any, res: any) => {
  try {
    const userId = req.user?.id || null;
    const username = req.user?.username || '';
    const sessionId = (req.headers['x-session-id'] as string) || '';

    const result = await FormDraftService.saveDraft({
      userId,
      username,
      sessionId,
      entityType: req.body.entityType,
      draftKey: req.body.draftKey || 'default',
      payload: req.body.payload,
      summary: req.body.summary,
      expiresInDays: req.body.expiresInDays
    });

    res.status(200).json(result);
  } catch (error: any) {
    logger.error('Error saving form draft:', error);
    res.status(400).json({ error: error.message || 'خطا در ذخیره پیش‌نویس سرور' });
  }
});

// Get a specific draft by entityType and draftKey
router.get('/drafts/:entityType', validate(entityTypeParamSchema), async (req: any, res: any) => {
  try {
    const userId = req.user?.id || null;
    const sessionId = (req.headers['x-session-id'] as string) || '';
    const entityType = req.params.entityType;
    const draftKey = (req.query.draftKey as string) || 'default';

    const draft = await FormDraftService.getDraft(entityType, draftKey, userId, sessionId);
    res.json({ draft });
  } catch (error: any) {
    logger.error('Error fetching form draft:', error);
    throw error;
  }
});

// List all drafts for current user
router.get('/drafts', async (req: any, res: any) => {
  try {
    const userId = req.user?.id || null;
    const sessionId = (req.headers['x-session-id'] as string) || '';
    const entityType = req.query.entityType as string | undefined;

    const drafts = await FormDraftService.listUserDrafts(userId, sessionId, entityType);
    res.json({ drafts, data: drafts });
  } catch (error: any) {
    logger.error('Error listing form drafts:', error);
    throw error;
  }
});

// Discard / Delete a draft by entityType and draftKey
router.delete('/drafts/:entityType', validate(entityTypeParamSchema), async (req: any, res: any) => {
  try {
    const userId = req.user?.id || null;
    const sessionId = (req.headers['x-session-id'] as string) || '';
    const entityType = req.params.entityType;
    const draftKey = (req.query.draftKey as string) || 'default';

    const result = await FormDraftService.deleteDraft(entityType, draftKey, userId, sessionId);
    res.json(result);
  } catch (error: any) {
    logger.error('Error deleting form draft:', error);
    throw error;
  }
});

// Discard a draft by ID
router.delete('/drafts/id/:id', validate(paramsIdSchema), async (req: any, res: any) => {
  try {
    const userId = req.user?.id || null;
    const draftId = parseInt(req.params.id, 10);
    if (isNaN(draftId)) {
      return res.status(400).json({ error: 'شناسه پیش‌نویس نامعتبر است' });
    }

    const result = await FormDraftService.deleteDraftById(draftId, userId);
    res.json(result);
  } catch (error: any) {
    logger.error('Error deleting form draft by ID:', error);
    throw error;
  }
});

export default router;
