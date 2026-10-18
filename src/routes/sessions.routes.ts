import { Router } from 'express';
import { z } from 'zod';
import { authenticateToken, shouldExposeTokenInBody } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate, numericIdString } from '../middleware/validate.js';
import { closeOtherOwnSessions, closeOwnSession, currentSessionId, listUserSessions } from '../services/auth/userSessions.service.js';

/**
 * 10.2 package 8 (D-07, TD-1295): the devices the signed-in user is signed in on, from the profile. Login only: each
 * route reads and closes the user's own sessions; another user's devices are closed from `/users/:id/sessions`
 * (`users.manage`).
 */
const router = Router();
router.use(authenticateToken);

const sessionParamsSchema = z.object({ params: z.object({ id: numericIdString }) });
const noBodySchema = z.object({ body: z.object({}).strict() });

router.get('/auth/sessions', asyncHandler(async (req, res) => {
  res.json({ sessions: await listUserSessions(Number(req.user?.id), currentSessionId(req)) });
}));

router.delete('/auth/sessions/:id', validate(sessionParamsSchema), asyncHandler(async (req, res) => {
  await closeOwnSession(req, Number(req.params.id));
  res.json({ success: true });
}));

router.post('/auth/sessions/close-others', validate(noBodySchema), asyncHandler(async (req, res) => {
  const { closedCount, csrfToken, token } = await closeOtherOwnSessions(req, res);
  res.json({ success: true, closedCount, csrfToken, ...(shouldExposeTokenInBody() ? { token } : {}) });
}));

export default router;
