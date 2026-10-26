// v8.0.52 (TD-314): نخستین ایمپورت — منطقه زمانی فرایند پیش از هر ماژول دیگری UTC می‌شود
import './src/lib/processTimezone.js';
// v11 (O16): files the server creates are private to its user and group (src/lib/processFileMode.ts)
import './src/lib/processFileMode.js';
import express from 'express';
import path from 'path';
import fs from 'fs';
import 'dotenv/config';

import { logger } from './src/middleware/logger.js';
import { createApp, beginStartup, markStartupComplete } from './src/app.js';
import { bootDataSteps } from './src/services/system/bootData.js';
import { runBootSequence } from './src/services/system/bootSequence.js';
import { registerWorkflowDomainActions } from './src/services/system/workflowDomainActions.js';
import { registerDomainEventHandlers } from './src/services/events/domainEventHandlers.js';
import { OutboxService } from './src/services/events/outboxService.js';
import { IntegrationDeliveryService } from './src/services/events/integrationDelivery.service.js';
import { WorkflowSlaReminderService } from './src/services/workflow/workflowSlaReminderService.js';
import { MessengerUpdatePoller } from './src/services/messenger/messengerUpdatePoller.js';
import { FormDraftService } from './src/services/drafts/formDraft.service.js';
import { OperationalPurgeService } from './src/services/events/operationalPurge.service.js';
import { WcShopSyncWorker } from './src/services/woocommerce/wcSyncWorker.service.js';
import { purgeOldAutoRuns } from './src/services/woocommerce/wcSyncRunPurge.js';
import { purgeEndedSessions } from './src/services/auth/sessionPurge.js';
import { pool, getDatabaseMode } from './src/db/drizzle.js';
import { decideProcessErrorAction, processErrorMessage } from './src/lib/processErrorPolicy.js';
import { REQUEST_TIMEOUT_MS } from './src/lib/media/mediaRules.js';
import { listenCallback } from './src/lib/serverListen.js';

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

  // v9.0.428 (TD-616, decision t4 «الف»): without DATABASE_URL (or SQL_HOST) the server does not start in any environment
  const databaseMode = getDatabaseMode();
  if (databaseMode.kind === 'refused') {
    logger.error(`FATAL: ${databaseMode.reason}`);
    process.exit(1);
  }

  // Initialize dev JWT_SECRET in non-production if not explicitly provided
  if (!process.env.JWT_SECRET && process.env.NODE_ENV !== 'production') {
    process.env.JWT_SECRET = 'papital_workshop_erp_default_secure_jwt_secret_dev_key_32_chars_long';
  }

  const PORT = parseInt(process.env.PORT || '3000', 10);
  // v10.2.24 (OBS-R1-16): setup-domain.sh writes ERP_LISTEN_HOST=127.0.0.1 so only Nginx reaches the app port; empty = every address
  const LISTEN_HOST = process.env.ERP_LISTEN_HOST?.trim() || '0.0.0.0';

  // v9.0.164 (TD-584, decision ت۲): /api answers 503 until the background startup below finishes
  beginStartup();
  // Build the shared Express application (security middleware + API routes)
  const app = await createApp();

  // Run database migrations, seed, and plain password migration in background with retry so port binds immediately
  (async () => {
    registerWorkflowDomainActions();
    registerDomainEventHandlers();
    // v10.0.180 (TD-958): only the migrations are essential; a non-essential step that keeps failing is left out and
    // listed by /health/ready instead of stopping the whole process
    const report = await runBootSequence(bootDataSteps());
    // v7.0.40 (audit P2-11): in every environment the server never answers without its schema
    if (report.fatal) {
      logger.error(report.fatal.step === 'migrations'
        ? 'FATAL: Database migrations failed after 5 attempts. Aborting process.'
        : `FATAL: startup step "${report.fatal.step}" failed after 5 attempts. Aborting process.`);
      process.exit(1);
    }
    logger.info(report.ok
      ? 'Database schema verified, migrated, seeded and workflow/event action engines initialized successfully'
      : `Server started without: ${report.degraded.map(d => d.step).join(', ')}`);
    // v7.0.31 (TD-193 / audit P1-8): no bulk voucher sync or Kardex backfill at boot; run them by hand with their
    // advisory locks: POST /api/accounting/quick-fix/sync-all-vouchers and POST /api/inventory/kardex-initial-backfill
    OutboxService.startOutboxWorker(3000);
    // v9.0.378 (TD-705): retries of failed webhook and rule action deliveries, then the dead letter queue
    IntegrationDeliveryService.startWorker(5000);
    // v7.0.101 (TD-085): one reminder per overdue approval task to its assignee
    WorkflowSlaReminderService.start(60_000);
    // v9.0.306 (TD-676): daily soft cleanup of expired form drafts
    FormDraftService.startCleanup();
    // OBS-R2-10: daily purge of expired idempotency keys and completed outbox events older than 90 days; 10.2 package 6:
    // and of the automatic WooCommerce stock push runs older than 30 days
    OperationalPurgeService.register('wcAutoPushRuns', () => purgeOldAutoRuns());
    // 10.3 package 5 (ت۴۷ item 4): and of the closed or expired sign-in sessions that ended more than 90 days ago
    OperationalPurgeService.register('endedUserSessions', () => purgeEndedSessions());
    OperationalPurgeService.start();
    // 10.2 package 6 (D-04 part B): the automatic stock push to the online shop, a run a minute while its setting is on
    WcShopSyncWorker.start();
    // v10.1.38 (messenger plan part 1): link codes and «/stop» sent to the staff bots
    MessengerUpdatePoller.start(5000);
    markStartupComplete();
  })().catch(err => {
    logger.error('Unhandled error in background migration/seed runner:', err);
    process.exit(1);
  });

  // Public static assets are served by createApp, behind the /uploads guard (OBS-R2-60)

  // ======== Vite Middleware ========
  // v4.0.30: import استاتیک vite حذف شد — باندل پروداکشن (--packages=external)
  // هنگام بوت require('vite') می‌کند که در image بدون devDependencies کرش می‌دهد.
  // حالا فقط در حالت توسعه به‌صورت dynamic import بارگذاری می‌شود.
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
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
      app.get('/{*splat}', (req, res) => {
        // send 1.x refuses an absolute path under a dot-directory (404), so the file is named relative to its root
        res.sendFile('index.html', { root: distPath });
      });
    } else {
      app.get('/{*splat}', (req, res) => {
        res.status(404).send('Not built yet');
      });
    }
  }

  const server = app.listen(PORT, LISTEN_HOST, listenCallback(PORT, logger));
  // v10.0.21 (N-05): a media library upload of up to 50 MB on a slow line outlasts Node's 5-minute request timeout
  server.requestTimeout = REQUEST_TIMEOUT_MS;

  let isShuttingDown = false;
  function gracefulShutdown(exitCode: number = 0): void {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`[Shutdown] Initiating graceful shutdown (exit code ${exitCode})`);

    server.close(() => {
      logger.info('[Shutdown] HTTP server closed');

      OutboxService.stopOutboxWorker();
      IntegrationDeliveryService.stopWorker();
      WorkflowSlaReminderService.stop();
      FormDraftService.stopCleanup();
      OperationalPurgeService.stop();
      WcShopSyncWorker.stop();
      MessengerUpdatePoller.stop();

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

  // v7.0.40 (audit P2-11): پس از خطای پیش‌بینی‌نشده وضعیت پردازه نامعلوم است؛ در همه محیط‌ها خاموشی کنترل‌شده،
  // به‌جز قطع اتصال‌های PostgreSQL که استخر خودش بازیابی می‌کند (src/lib/processErrorPolicy.ts)
  process.on('uncaughtException', (err: unknown) => {
    if (decideProcessErrorAction(err) === 'ignore') {
      logger.warn(`[UncaughtException Handled] PostgreSQL connection drop: ${processErrorMessage(err)}`);
      return;
    }
    logger.error('[Uncaught Exception — shutting down]', err);
    gracefulShutdown(1);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    if (decideProcessErrorAction(reason) === 'ignore') {
      logger.warn(`[UnhandledRejection Handled] PostgreSQL connection drop: ${processErrorMessage(reason)}`);
      return;
    }
    logger.error('[Unhandled Rejection — shutting down]', reason);
    gracefulShutdown(1);
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

startServer().catch((err: unknown) => {
  logger.error('[Startup] startServer failed', err);
  process.exit(1);
});
