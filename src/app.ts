import express from 'express';
import { ATTACHMENT_BODY_LIMIT, DEFAULT_BODY_LIMIT, acceptsAttachmentBody } from './lib/attachments/attachmentBodyLimit.js';
import 'express-async-errors';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

import { logger, morganMiddleware, errorHandler } from './middleware/logger.js';
import { metricsMiddleware, updateDbPoolMetrics, updateOutboxMetrics, dbPoolStats } from './middleware/metrics.js';
import { metricsAuthMiddleware, metricsReaderStatus } from './middleware/metricsAuth.js';
import { asyncHandler } from './middleware/asyncHandler.js';
import { buildCspDirectives } from './lib/cspDirectives.js';
import promClient from 'prom-client';
import { requestContextMiddleware } from './lib/requestContext.js';
import { validateCorsOrigin } from './lib/corsValidator.js';
import authRoutes from './routes/auth.routes.js';
import usersRoutes from './routes/users.routes.js';
import systemRoutes from './routes/system.routes.js';
import itemsRoutes from './routes/items.routes.js';
import customersRoutes from './routes/customers.routes.js';
import categoriesRoutes from './routes/categories.routes.js';
import warehousesRoutes from './routes/warehouses.routes.js';
import transactionsRoutes from './routes/transactions.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import documentsRoutes from './routes/documents.routes.js';
import projectsRoutes from './routes/projects.routes.js';
import transfersRoutes from './routes/transfers.routes.js';
import dailyLogsRoutes from './routes/dailyLogs.routes.js';
import notificationsRoutes from './routes/notifications.routes.js';
import crmRoutes from './routes/crm.routes.js';
import woocommerceRoutes from './routes/woocommerce.routes.js';
import personnelRoutes from './routes/personnel.routes.js';
import pieceworkRoutes from './routes/piecework.routes.js';
import pendingMaterialsRoutes from './routes/pendingMaterials.routes.js';
import accountingRoutes from './routes/accounting.routes.js';
import workflowRoutes from './routes/workflow.routes.js';
import inventoryRoutes from './routes/inventory.routes.js';
import eventsRoutes from './routes/events.routes.js';
import draftsRoutes from './routes/drafts.routes.js';
import procurementRoutes from './routes/procurement.routes.js';
import attachmentsRoutes from './routes/attachments.routes.js';
import { authenticateToken, getJwtSecret, csrfProtection, shouldExposeTokenInBody } from './middleware/auth.js';
import { sessionEndpointOriginGuard } from './middleware/sessionOrigin.js';
import { startupGate, isStarting, isStartupComplete } from './middleware/startupGate.js';
import { orm, isMockDatabase } from './db/drizzle.js';
import { sql } from 'drizzle-orm';
import { BUILD_INFO } from './lib/version.js';
import { resolveTrustProxySetting } from './lib/trustProxy.js';
import { addressLockoutMessage, minutesUntil } from './lib/auth/loginLockout.js';

let activeLoginLimiter: any = null;

/**
 * Resets the in-memory login rate limiter store.
 * Useful in automated test suites (e.g. penetration vs critical path) so probes
 * do not exhaust the throttle bucket for legitimate admin logins.
 */
export function resetLoginRateLimiter(): void {
  try {
    if (activeLoginLimiter) {
      if (typeof activeLoginLimiter.resetAll === 'function') {
        activeLoginLimiter.resetAll();
      } else if (activeLoginLimiter.store && typeof activeLoginLimiter.store.resetAll === 'function') {
        activeLoginLimiter.store.resetAll();
      }
    }
  } catch {
    // safe ignore in tests
  }
}

// v9.0.164 (TD-584): startup state lives in the startup gate; server.ts opens and closes it
export { beginStartup, markStartupComplete } from './middleware/startupGate.js';

/**
 * TST-004/005 enabler: builds the fully-configured Express application
 * (security middleware, rate limiting, CSRF, all API routes) WITHOUT
 * binding a port or launching background workers — allowing supertest
 * driven penetration & integration suites to exercise real HTTP flows
 * against ephemeral listeners.
 */
export async function createApp(): Promise<express.Express> {
  // Enforce valid JWT_SECRET (>=32 chars) on app construction
  getJwtSecret();
  // v7.0.27 (TD-185): هشدار صریح هنگام فعال بودن تحویل توکن در بدنه پاسخ (فقط برای پیش‌نمایش‌های iframe)
  if (shouldExposeTokenInBody()) {
    logger.warn('[Auth] EXPOSE_TOKEN_IN_BODY=true — the JWT is returned in login/setup response bodies (preview-only compatibility; AGENTS.md §5).');
  }

  const app = express();
  // v7.0.23 (TD-181 / audit P0-5): فقط پراکسی‌های شناخته‌شده (TRUST_PROXY) قابل‌اعتمادند؛ req.ip آدرس واقعی کلاینت
  // پشت Nginx/Ingress است و X-Forwarded-For ارسالی از کلاینت مستقیم نادیده گرفته می‌شود (قبلاً trust proxy = 1).
  app.set('trust proxy', resolveTrustProxySetting());

  // Use Helmet middleware for security headers (SEC-007)
  // V1.3.7: upgrade-insecure-requests / HSTS فقط روی اتصال HTTPS فعال می‌شوند —
  // در دسترسی HTTP (مثل http://SERVER_IP:3000 قبل از تنظیم دامنه) این هدرها باعث
  // ارتقای مرورگر به HTTPS و صفحه سفید می‌شدند.
  // v9.0.145 (TD-597): production frames and connects only to itself plus explicit origins (src/lib/cspDirectives.ts)
  const secureCspDirectives = buildCspDirectives();

  const helmetForHttps = helmet({
    contentSecurityPolicy: {
      directives: {
        ...secureCspDirectives,
        // فقط روی HTTPS ارتقای امنیتی اعمال شود
        upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: 'no-referrer' },
  });

  const helmetForHttp = helmet({
    contentSecurityPolicy: {
      directives: {
        ...secureCspDirectives,
        upgradeInsecureRequests: null, // هرگز روی HTTP
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: false, // HSTS فقط روی HTTPS معنا دارد
    referrerPolicy: { policy: 'no-referrer' },
  });

  app.use((req, res, next) => {
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    return (isSecure ? helmetForHttps : helmetForHttp)(req, res, next);
  });

  // Ensure public/uploads directory exists
  const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  // Restrict CORS origins dynamically based on request origin / environment (SEC-005 / S-1 / TD-088)
  app.use(cors({
    origin: (origin, callback) => {
      const result = validateCorsOrigin(origin);
      if (result.allowed) {
        if (result.devMode && result.reason) {
          logger.warn(`[DEV CORS] ${result.reason}`);
        }
        return callback(null, true);
      }

      logger.warn(`[CORS] Rejected unauthorized origin in production: ${origin} (Reason: ${result.reason})`);
      return callback(null, false);
    },
    credentials: true
  }));
  app.use(cookieParser());
  app.use(requestContextMiddleware);
  // v9.0.255 (TD-641, decision ت۴): the save routes of records with attachments take 14 MB, every other route 5 MB
  const jsonBody = (limit: string) => express.json({
    limit,
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    }
  });
  const defaultJson = jsonBody(DEFAULT_BODY_LIMIT);
  const attachmentJson = jsonBody(ATTACHMENT_BODY_LIMIT);
  app.use((req, res, next) => (acceptsAttachmentBody(req.method, req.originalUrl) ? attachmentJson : defaultJson)(req, res, next));
  app.use(express.urlencoded({
    extended: true,
    limit: DEFAULT_BODY_LIMIT,
    verify: (req: any, _res, buf) => {
      if (!req.rawBody) req.rawBody = buf;
    }
  }));
  app.use(morganMiddleware);
  app.use(metricsMiddleware);
  // v9.0.164 (TD-584, decision ت۲): /api answers 503 SYSTEM_STARTING until migrations and seed finish
  app.use('/api', startupGate);

  // Rate Limiting (SEC-009): generous limits for ERP operations and distinct user/session buckets
  const generalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: process.env.NODE_ENV === 'production' ? 10000 : 50000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'تعداد درخواست‌های شما بیش از حد مجاز است. لطفاً چند لحظه صبر کنید.' },
    skip: (req) => {
      const p = req.path || req.url || '';
      return p.includes('/health') || p.includes('/metrics');
    },
    // v9.0.144 (TD-595): the key is the client address only. This limiter runs before authentication, so
    // req.user is always empty here, and a cookie value is unverified: every forged cookie was a new bucket.
    keyGenerator: (req: express.Request) => {
      // v7.0.41 (TD-182): req.ip بر پایه TRUST_PROXY؛ X-Forwarded-For خام قابل جعل است
      const rawIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';
      return `ip:${ipKeyGenerator(rawIp)}`;
    },
    validate: {
      xForwardedForHeader: false,
      keyGeneratorIpFallback: false
    }
  });

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    // v9.0.220 (TD-539): the answer carries locked and the minutes left of this address's window, so the login page
    // counts down the real time (it used to read the minutes out of the text and fall back to a made-up 15)
    handler: (req, res) => {
      logger.warn(`[Login Brute Force] IP ${req.ip} blocked after failed attempts`);
      const remainingMinutes = minutesUntil((req as express.Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime);
      res.status(429).json({ error: addressLockoutMessage(remainingMinutes), locked: true, remainingMinutes });
    },
    // v7.0.23 (TD-181 / audit P0-5): فقط تلاش‌های ناموفق شمرده می‌شوند — قبلاً ورودهای موفق هم
    // سطل را پر می‌کردند و پشت پراکسی، کل سازمان پس از ۱۰ ورود به مدت ۱۵ دقیقه مسدود می‌شد.
    skipSuccessfulRequests: true,
    // TST-005 Hardening (بازطراحی v7.0.23): کلید محدودیت، آدرس واقعی کلاینت (req.ip) است که Express فقط
    // از پراکسی‌های قابل‌اعتماد TRUST_PROXY استخراج می‌کند؛ X-Forwarded-For جعلی از کلاینت مستقیم اثری ندارد.
    keyGenerator: (req: any) => {
      const raw = req.ip || req.socket?.remoteAddress || 'unknown';
      const v4 = typeof raw === 'string' && raw.startsWith('::ffff:') ? raw.slice('::ffff:'.length) : raw;
      if (typeof v4 === 'string' && v4.includes(':')) {
        // Genuine IPv6 client — delegate to library-safe IPv6 bucketing
        return `v6:${ipKeyGenerator(v4)}`;
      }
      return String(v4 || 'unknown');
    },
    validate: {
      xForwardedForHeader: process.env.NODE_ENV === 'production'
    }
  });
  activeLoginLimiter = loginLimiter;

  app.use('/api', generalLimiter);
  // v9.0.77 (TD-528): ورود، خروج و راه‌اندازی فقط از مبدأ خود سامانه (این سه از CSRF معاف‌اند)
  app.use('/api', sessionEndpointOriginGuard);
  app.use('/api', csrfProtection);
  app.post(['/api/login', '/api/auth/login'], loginLimiter);

  // Prometheus Metrics Endpoint (V9-2.2 & V4 Subphase 2.3 / S-3: محافظت قطعی با METRICS_TOKEN یا احراز هویت ادمین)
  app.get(['/metrics', '/api/metrics'], metricsAuthMiddleware, asyncHandler(async (_req, res) => {
    updateDbPoolMetrics();
    await updateOutboxMetrics();
    res.set('Content-Type', promClient.register.contentType);
    res.send(await promClient.register.metrics());
  }));

  // ======== API Routes ========
  // 1. Liveness probe (Always 200 if process is running)
  app.get(['/api/health/live', '/health/live'], (_req, res) => {
    res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
  });

  // 2. Readiness probe (200 if DB reachable and connection pool not saturated)
  app.get(['/api/health/ready', '/health/ready'], asyncHandler(async (_req, res) => {
    // v9.0.164 (TD-584): not ready while a gated server is still migrating
    if (isStarting()) {
      return res.status(503).json({ status: 'not_ready', reason: 'Starting', timestamp: new Date().toISOString() });
    }
    try {
      await orm.execute(sql`SELECT 1`);

      // v9.0.165 (TD-596): the real pool (drizzle.ts), not an orm property that does not exist
      const { total, idle, waiting } = dbPoolStats();

      if (waiting > 5) {
        return res.status(503).json({
          status: 'not_ready',
          reason: 'Pool saturated',
          pool: { total, idle, waiting },
          timestamp: new Date().toISOString(),
        });
      }

      res.status(200).json({
        status: 'ready',
        // v9.0.397 (TD-616): the in-memory demo database says so, so a probe never mistakes it for PostgreSQL
        database: isMockDatabase() ? 'in_memory_demo' : 'postgresql',
        pool: { total, idle, waiting },
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(503).json({
        status: 'not_ready',
        reason: 'Database unreachable',
        error: err?.message,
        timestamp: new Date().toISOString(),
      });
    }
  }));

  // 3. Startup probe (200 if background migrations/seeds completed)
  app.get(['/api/health/startup', '/health/startup'], (_req, res) => {
    if (isStartupComplete()) {
      res.status(200).json({ status: 'started', timestamp: new Date().toISOString() });
    } else {
      res.status(503).json({ status: 'starting', timestamp: new Date().toISOString() });
    }
  });

  // 4. Diagnostic Health Probe
  app.get(['/api/health', '/health'], asyncHandler(async (req, res) => {
    try {
      await orm.execute(sql`SELECT 1`);
      // v9.0.168 (TD-601): the version stays public (verify-startup.sh reads it); commit, build time, Node
      // version and environment only for the metrics token or a live system-admin session
      const reader = await metricsReaderStatus(req);
      res.json({
        status: 'ok',
        version: BUILD_INFO.version,
        ...(reader.ok ? { buildInfo: BUILD_INFO } : {}),
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
      });
    } catch (err: any) {
      res.status(503).json({
        status: 'error',
        message: 'Database connection check failed',
        error: err.message,
        timestamp: new Date().toISOString()
      });
    }
  }));

  app.use('/api/woocommerce', woocommerceRoutes);
  app.use('/api', authRoutes);
  app.use('/api', usersRoutes);
  app.use('/api', systemRoutes);
  app.use('/api', itemsRoutes);
  app.use('/api', customersRoutes);
  app.use('/api', categoriesRoutes);
  app.use('/api', warehousesRoutes);
  app.use('/api', transactionsRoutes);
  app.use('/api', dashboardRoutes);
  app.use('/api', documentsRoutes);
  app.use('/api', projectsRoutes);
  app.use('/api', transfersRoutes);
  app.use('/api', dailyLogsRoutes);
  app.use('/api', notificationsRoutes);
  app.use('/api', crmRoutes);
  app.use('/api', personnelRoutes);
  app.use('/api', pieceworkRoutes);
  app.use('/api', pendingMaterialsRoutes);
  app.use('/api', accountingRoutes);
  app.use('/api/workflow', workflowRoutes);
  app.use('/api/inventory', inventoryRoutes);
  app.use('/api/events', eventsRoutes);
  app.use('/api', draftsRoutes);
  app.use('/api/procurement', procurementRoutes);
  app.use('/api', attachmentsRoutes);

  const uploadsStatic = express.static(path.join(process.cwd(), 'public', 'uploads'));
  app.use('/uploads', (req, res, next) => {
    const p = (req.path || '').toLowerCase();
    // v7.0.56 (audit P2-9): فایل پیوست‌ها فقط از GET /api/attachments/:id با بررسی مجوز رکورد مالک سرو می‌شوند
    let decodedPath = p;
    try { decodedPath = decodeURIComponent(p); } catch { /* keep raw */ }
    if (p.startsWith('/.attachments') || decodedPath.startsWith('/.attachments')) {
      return res.status(404).end();
    }
    // Public assets and media images (catalog items, transfers, logos, product photos)
    const isImageFile = /\.(jpg|jpeg|png|webp|gif|svg|ico)$/i.test(p);
    if (
      isImageFile ||
      p.endsWith('.ico') ||
      p.includes('logo') ||
      p.includes('favicon') ||
      p.startsWith('/public/') ||
      p.startsWith('/branding/')
    ) {
      return uploadsStatic(req, res, next);
    }
    // All other uploads (e.g. documents, invoices, attachments) require authentication
    authenticateToken(req, res, (err?: any) => {
      if (err) return next(err);
      uploadsStatic(req, res, next);
    });
  });

  // v7.0.43 (audit P3-11): مسیر API ناموجود پاسخ 404 JSON می‌گیرد؛ پیش‌تر در پروداکشن به catch-all برنامه
  // تک‌صفحه‌ای (server.ts) می‌رسید و index.html با کد 200 برمی‌گشت که کلاینت آن را پاسخ موفق تلقی می‌کرد.
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'مسیر درخواستی در API وجود ندارد', path: (req.originalUrl || '').split('?')[0] });
  });

  app.use(errorHandler);

  return app;
}
