import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authorizePermission } from '../middleware/authorize.js';
import { warehouseBiStats, warehouseStatsSummary } from '../services/inventory/warehouseDashboard.service.js';

const router = Router();
router.use(authenticateToken);

// v7.0.53 (audit P2-10) and v7.0.55: the warehouse dashboard for holders of reports.view or warehouse.view
router.get('/stats', authorizePermission('reports.view', 'warehouse.view'), asyncHandler(async (_req, res) => {
  res.json(await warehouseStatsSummary());
}));

router.get('/dashboard-bi-stats', authorizePermission('reports.view', 'warehouse.view'), asyncHandler(async (_req, res) => {
  res.json(await warehouseBiStats());
}));

export default router;
