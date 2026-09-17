import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import 'dotenv/config';

import { logger } from './src/middleware/logger.js';
import { createApp, markStartupComplete } from './src/app.js';
import { runMigrations } from './src/db/migrator.js';
import { runSeedWithLock } from './src/db/seed.js';
import { migratePlainPasswords } from './src/db/migratePlainPasswords.js';
import { AccountingService } from './src/services/accounting.service.js';
import { registerWorkflowListeners } from './src/services/workflow/workflowEventBus.js';
import { registerDomainEventHandlers } from './src/services/events/domainEventHandlers.js';
import { OutboxService } from './src/services/events/outboxService.js';
import { EventActionEngineService } from './src/services/events/eventActionEngineService.js';
import { WebhookSubscriptionService } from './src/services/events/webhookSubscriptionService.js';
import { WorkflowEngineService } from './src/services/workflow/workflowEngineService.js';
import { KardexBackfillService } from './src/services/inventory/kardexBackfill.service.js';
import { pool } from './src/db/drizzle.js';

async function startServer() {
  // TST-001: production startup assertion — abort if test code leaked into bundle
  if (process.env.NODE_ENV === 'production') {
    try {
      const req = typeof require !== 'undefined' ? require : undefined;
      if (req?.resolve) {
        req.resolve('./src/tests/fixtures/dbTestHelper.js');
        logger.error('FATAL: Test code is in production bundle — aborting');
        process.exit(1);
      }
    } catch {
      // good — tests are not bundled
    }
  }

  const PORT = 3000;

  // Build the shared Express application (security middleware + API routes)
  const app = await createApp();

  // Run database migrations, seed, and plain password migration in background with retry so port 3000 binds immediately
  (async () => {
    registerWorkflowListeners();
    registerDomainEventHandlers();
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        await runMigrations();
        if (process.env.NODE_ENV !== 'production' || process.env.ALLOW_SEED_IN_PRODUCTION === 'true') {
          await runSeedWithLock();
        } else {
          logger.info('[Startup] Skipping seed in production (set ALLOW_SEED_IN_PRODUCTION=true to enable)');
        }
        await migratePlainPasswords();
        await WorkflowEngineService.seedDefaultWorkflows();
        await EventActionEngineService.seedDefaultRules();
        await WebhookSubscriptionService.seedDefaultSubscriptions();
        logger.info('Database schema verified, migrated, seeded, passwords checked and workflow/event action/webhook engines initialized successfully');
        await AccountingService.syncAllInvoiceVouchers().catch(err => logger.error('Error syncing invoice vouchers on start:', err));
        await KardexBackfillService.syncMissingInitialTransactions().catch(err => logger.error('Error backfilling missing kardex initial transactions on start:', err));
        OutboxService.startOutboxWorker(3000);
        markStartupComplete();
        break;
      } catch (error) {
        logger.error(`Error migrating/seeding database (attempt ${attempt}/5):`, error);
        if (attempt < 5) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }
    }
  })().catch(err => {
    logger.error('Unhandled error in background migration/seed runner:', err);
  });

  // Serve public static assets (fonts, icons, images) directly
  app.use(express.static(path.join(process.cwd(), 'public')));

  // ======== Vite Middleware ========
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production serving
    const distPath = path.join(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    } else {
      app.get('*', (req, res) => {
        res.status(404).send('Not built yet');
      });
    }
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Server running on port ${PORT}`);
  });

  const SAFE_PATTERNS = [
    'terminating connection',
    'Connection terminated',
    'connection terminated',
    'ECONNRESET',
    'idle-in-transaction',
    'socket closed',
  ];

  const FATAL_PATTERNS = [
    'heap out of memory',
    'assertion failed',
    'FATAL',
  ];

  let isShuttingDown = false;
  function gracefulShutdown(exitCode: number = 0): void {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`[Shutdown] Initiating graceful shutdown (exit code ${exitCode})`);

    server.close(() => {
      logger.info('[Shutdown] HTTP server closed');

      OutboxService.stopOutboxWorker();

      if (pool && typeof pool.end === 'function') {
        pool.end().then(() => {
          logger.info('[Shutdown] DB pool closed');
          process.exit(exitCode);
        }).catch((err: any) => {
          logger.error('[Shutdown] Error closing DB pool', err);
          process.exit(exitCode);
        });
      } else {
        process.exit(exitCode);
      }
    });

    setTimeout(() => {
      logger.error('[Shutdown] Force-exit after timeout');
      process.exit(exitCode);
    }, 10000).unref();
  }

  process.on('uncaughtException', (err: any) => {
    const msg = err?.message || String(err);

    if (SAFE_PATTERNS.some(p => msg.includes(p))) {
      logger.warn(`[UncaughtException Handled] PostgreSQL connection drop: ${msg}`);
      return;
    }

    if (FATAL_PATTERNS.some(p => msg.includes(p))) {
      logger.error('[Fatal Uncaught Exception — killing process]', err);
      gracefulShutdown(1);
      return;
    }

    logger.error('[Uncaught Exception — non-fatal]', err);
    if (process.env.NODE_ENV === 'production') {
      gracefulShutdown(1);
    }
  });

  process.on('unhandledRejection', (reason: any) => {
    const msg = reason?.message || String(reason);

    if (SAFE_PATTERNS.some(p => msg.includes(p))) {
      logger.warn(`[UnhandledRejection Handled] PostgreSQL connection drop: ${msg}`);
      return;
    }

    logger.error('[Unhandled Rejection]', reason);

    if (process.env.NODE_ENV === 'production') {
      gracefulShutdown(1);
    }
  });

  process.on('SIGTERM', () => {
    logger.info('[Shutdown] SIGTERM received');
    gracefulShutdown(0);
  });

  process.on('SIGINT', () => {
    logger.info('[Shutdown] SIGINT received');
    gracefulShutdown(0);
  });
}

startServer();
