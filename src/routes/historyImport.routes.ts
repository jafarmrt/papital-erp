/**
 * v11 history import (1405 replay): posting past rows from Excel at once, after a preview that keeps nothing.
 * Mounted by the composition root (app.ts); every route needs a session.
 */
import { Router, type Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { authorizePermission, can, requireSystemAdmin } from '../middleware/authorize.js';
import { CRM_LEAD_LINK_PERMISSION } from '../lib/permissions/documentPermissions.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { idempotency } from '../middleware/idempotency.js';
import { ConflictError } from '../errors/customErrors.js';
import { importTreasuryHistory } from '../services/historyImport/treasuryHistoryImport.service.js';
import { STOCK_IMPORT_KIND_PERMISSIONS, importStockHistory, oldOpeningsBeforeReplay, withdrawOpeningsBeforeReplay } from '../services/historyImport/stockHistoryImport.service.js';
import { closeHistoryImport, historyImportStatus } from '../services/historyImport/historyImportClose.service.js';
import { OPENING_STOCK_PERMISSION } from '../lib/permissions/stockActionPermissions.js';
import type { StockImportKind } from '../lib/historyImport/stockHistoryImport.js';
import type { AuthUserPayload } from '../types/auth.types.js';
import { historyImportCloseSchema, oldOpeningWithdrawSchema, stockHistoryImportSchema, treasuryHistoryImportSchema } from './historyImport.schemas.js';

const router = Router();

/** The kinds of warehouse row a user may import: each needs what its hand form asks (the transfer form, a production receipt). */
async function allowedStockKinds(user: AuthUserPayload | undefined): Promise<Set<StockImportKind>> {
  const kinds = new Set<StockImportKind>();
  for (const [kind, permission] of STOCK_IMPORT_KIND_PERMISSIONS) if (permission === null || await can(user, permission)) kinds.add(kind);
  return kinds;
}

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
    allowedKinds: await allowedStockKinds(req.user),
    mayLinkLeads: await can(req.user, CRM_LEAD_LINK_PERMISSION),
  });
  sendImportResult(res, result, req.body.commit === true);
}));

// tool 8: the openings entered before the replay (the item form's opening, with a draft voucher), taken back first; taking
// back needs the opening stock permission, as entering it does
router.get('/inventory/history-import/old-openings', authorizePermission('warehouse.history_import'), asyncHandler(async (_req, res) => {
  res.json(await oldOpeningsBeforeReplay());
}));

router.post('/inventory/history-import/old-openings/withdraw', authorizePermission('warehouse.history_import'), authorizePermission(OPENING_STOCK_PERMISSION),
  idempotency({ scope: 'history-import' }), validate(oldOpeningWithdrawSchema), asyncHandler(async (req, res) => {
    res.json(await withdrawOpeningsBeforeReplay(req.body.itemIds, {
      userId: req.user?.id,
      username: req.user?.username,
      userFullName: req.user?.fullName,
      req,
    }));
  }));

// tool 9: «پایان ورود سابقه». Every user's menus read whether the imports are closed (a flag, no data); only the system
// admin closes them, for good, after confirming
router.get('/history-import/status', asyncHandler(async (_req, res) => {
  res.json(await historyImportStatus());
}));

router.post('/history-import/close', requireSystemAdmin, idempotency({ scope: 'history-import' }), validate(historyImportCloseSchema),
  asyncHandler(async (req, res) => {
    res.json(await closeHistoryImport({ userId: req.user?.id, username: req.user?.username, userFullName: req.user?.fullName, req }));
  }));

export default router;
