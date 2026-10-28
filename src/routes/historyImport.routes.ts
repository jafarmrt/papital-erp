/**
 * v11 history import (1405 replay): posting past rows from Excel at once, after a preview that keeps nothing.
 * Mounted by the composition root (app.ts); every route needs a session.
 */
import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { authorizePermission, can } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { idempotency } from '../middleware/idempotency.js';
import { importTreasuryHistory } from '../services/historyImport/treasuryHistoryImport.service.js';
import { treasuryHistoryImportSchema } from './historyImport.schemas.js';

const router = Router();
router.use(authenticateToken);

// tool 1: receipts, payments, transfers and payslip payments; `commit: false` is the preview
// a resend of the same file (a timeout, a double click) gets the first answer; a second post of it waits for the first and
// then finds every row already recorded
router.post('/accounting/treasury/history-import', authorizePermission('accounting.history_import'), idempotency({ scope: 'history-import' }), validate(treasuryHistoryImportSchema), asyncHandler(async (req, res) => {
  const result = await importTreasuryHistory(req.body.rows, {
    commit: req.body.commit === true,
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
    audit: { req, userFullName: req.user?.fullName },
    canPayPayslips: await can(req.user, 'piecework.pay'),
  });
  res.json(result);
}));

export default router;
