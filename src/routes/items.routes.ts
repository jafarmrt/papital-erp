import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import itemsCrudRouter from './items.crud.routes.js';
import itemsPricesRouter from './items.prices.routes.js';
import itemsImportRouter from './items.import.routes.js';

const router = Router();

// Ensure all items routes require authentication
router.use(authenticateToken);

// Mount modular item routes
router.use(itemsCrudRouter);
router.use(itemsPricesRouter);
router.use(itemsImportRouter);

export default router;
