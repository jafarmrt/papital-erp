/**
 * v11 history import (1405 replay): posting past rows from Excel at once, after a preview that keeps nothing.
 * Mounted by the composition root (app.ts); every route needs a session.
 */
import { Router, type Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { authorizePermission, can } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { idempotency } from '../middleware/idempotency.js';
import { ConflictError } from '../errors/customErrors.js';
import { importTreasuryHistory } from '../services/historyImport/treasuryHistoryImport.service.js';
import { importStockHistory } from '../services/historyImport/stockHistoryImport.service.js';
import { permissionToCreateDocument } from '../services/documents/documentRecordRule.js';
import { stockHistoryImportSchema, treasuryHistoryImportSchema } from './historyImport.schemas.js';

const router = Router();

/**
 * A post takes an Idempotency-Key (a resend after a timeout gets the first answer, a second post at once 409); a preview
 * writes nothing and takes none. A post that recorded nothing answers 409 with its rows, so the key is released and the
 * same file can be posted again once fixed.
 */
const importIdempotency = idempotency({ scope: 'history-import', onlyWhen: req => req.body?.commit === true });

function sendImportResult(res: Response, result: { committed: boolean }, commit: boolean): void {
  if (commit && !result.committed) {
    throw new ConflictError('هیچ ردیفی ثبت نشد؛ ردیف‌های دارای ایراد را درست کنید و دوباره بفرستید.', result, 'HISTORY_IMPORT_NOT_POSTED');
  }
  res.json(result);
}
router.use(authenticateToken);

// tool 1: receipts, payments, transfers and payslip payments; `commit: false` is the preview
// a resend of the same file (a timeout, a double click) gets the first answer; a second post of it waits for the first and
// then finds every row already recorded
router.post('/accounting/treasury/history-import', authorizePermission('accounting.history_import'), importIdempotency, validate(treasuryHistoryImportSchema), asyncHandler(async (req, res) => {
  const result = await importTreasuryHistory(req.body.rows, {
    commit: req.body.commit === true,
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
    audit: { req, userFullName: req.user?.fullName },
    canPayPayslips: await can(req.user, 'piecework.pay'),
  });
  sendImportResult(res, result, req.body.commit === true);
}));

// tools 2 and 3: opening stock, purchase and production receipts, consumption, waste, transfers, past sales invoices and
// their returns; `commit: false` is the preview
router.post('/inventory/history-import', authorizePermission('warehouse.history_import'), importIdempotency, validate(stockHistoryImportSchema), asyncHandler(async (req, res) => {
  const result = await importStockHistory(req.body.rows, {
    commit: req.body.commit === true,
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
    audit: { req, userId: req.user?.id, username: req.user?.username, userFullName: req.user?.fullName },
    // tool 3: a past sales invoice or return needs what the invoice form asks to record it final
    canRecordSales: await can(req.user, permissionToCreateDocument({ docType: 'invoice', status: 'final' })),
    canRecordReturns: await can(req.user, permissionToCreateDocument({ docType: 'return', status: 'final' })),
  });
  sendImportResult(res, result, req.body.commit === true);
}));

export default router;
