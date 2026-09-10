import express from 'express';
import 'express-async-errors';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

import { logger, morganMiddleware, errorHandler } from './middleware/logger.js';
import { metricsMiddleware, updateDbPoolMetrics, updateOutboxMetrics } from './middleware/metrics.js';
import promClient from 'prom-client';
import { requestContextMiddleware } from './lib/requestContext.js';
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
import { authenticateToken, getJwtSecret, csrfProtection } from './middleware/auth.js';
import { orm } from './db/drizzle.js';
import { sql } from 'drizzle-orm';
import { BUILD_INFO } from './lib/version.js';

let isStartupComplete = false;

/**
 * Called by server.ts once background migrations/seeding finish so that
 * the /health/startup probe can report readiness.
 */
export function markStartupComplete(): void {
  isStartupComplete = true;
}

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

  const app = express();
  app.set('trust proxy', 1);

  // Use Helmet middleware for security headers (SEC-007)
  // V1.3.7: upgrade-insecure-requests / HSTS فقط روی اتصال HTTPS فعال می‌شوند —
  // در دسترسی HTTP (مثل http://SERVER_IP:3000 قبل از تنظیم دامنه) این هدرها باعث
  // ارتقای مرورگر به HTTPS و صفحه سفید می‌شدند.
  const secureCspDirectives = {
    defaultSrc: ["'self'"],
    scriptSrc: [
      "'self'",
      // Support Vite dev server and dynamic inline scripts
      ...(process.env.NODE_ENV !== 'production' ? ["'unsafe-inline'", "'unsafe-eval'"] : [])
    ],
    styleSrc: ["'self'", "'unsafe-inline'"],  // Tailwind / inline style tags
    imgSrc: ["'self'", "data:", "blob:", "https:"],
    connectSrc: [
      "'self'",
      "https:",
      "wss:",
      ...(process.env.EXTERNAL_API_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean) || [])
    ],
    fontSrc: ["'self'", "data:", "https:"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: [
      "'self'",
      "https://*.google.com",
      "https://*.run.app",
      "https://*.googleusercontent.com",
      "https://*.aistudio.google.com"
    ],
  };

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

  // Restrict CORS origins dynamically based on request origin / environment (SEC-005)
  app.use(cors({
    origin: (origin, callback) => {
      // Allow same-origin requests (no Origin header)
      if (!origin) return callback(null, true);

      const allowedOrigins = process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
        : [];

      // In Production, check against explicit allowlist, APP_URL, and verified Cloud Run / AI Studio preview domains
      const isCloudRunOrAiStudio = /^https:\/\/([a-zA-Z0-9-]+\.)*(run\.app|google\.com|aistudio\.google\.com|googleusercontent\.com)$/.test(origin);
      const isLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

      let isAppUrl = false;
      if (process.env.APP_URL) {
        try {
          const appOrigin = new URL(process.env.APP_URL).origin;
          if (origin === appOrigin) isAppUrl = true;
        } catch {
          // ignore invalid APP_URL
        }
      }

      // Check explicit allowed list or wildcard
      if (allowedOrigins.includes(origin) || allowedOrigins.includes('*') || isAppUrl) {
        return callback(null, true);
      }

      // Allow AI Studio preview and dev domains
      if (isCloudRunOrAiStudio || isLocalhost) {
        return callback(null, true);
      }

      // Non-production fallback
      if (process.env.NODE_ENV !== 'production') {
        logger.warn(`[DEV CORS] Allowed non-listed origin in development: ${origin}`);
        return callback(null, true);
      }

      // In production, reject unauthorized origin
      logger.warn(`[CORS] Rejected origin in production: ${origin}`);
      return callback(null, false);
    },
    credentials: true
  }));
  app.use(cookieParser());
  app.use(requestContextMiddleware);
  app.use(express.json({
    limit: '5mb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    }
  }));
  app.use(express.urlencoded({
    extended: true,
    limit: '5mb',
    verify: (req: any, _res, buf) => {
      if (!req.rawBody) req.rawBody = buf;
    }
  }));
  app.use(morganMiddleware);
  app.use(metricsMiddleware);

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
    keyGenerator: (req: any) => {
      if (req.user?.id) return `user:${req.user.id}`;
      const token = req.cookies?.auth_token || req.cookies?.token || (req.headers?.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
      if (token && typeof token === 'string' && token.length >= 10) {
        return `session:${token.slice(-16)}`;
      }
      const rawIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress || req.ip || '127.0.0.1';
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
    message: { error: 'تلاش‌های ورود بیش از حد مجاز. لطفاً ۱۵ دقیقه صبر کنید.' },
    handler: (req, res) => {
      logger.warn(`[Login Brute Force] IP ${req.ip} blocked after failed attempts`);
      res.status(429).json({ error: 'تلاش‌های ورود بیش از حد مجاز. لطفاً ۱۵ دقیقه صبر کنید.' });
    },
    // TST-005 Hardening: authentication throttling MUST be keyed on the actual
    // socket peer address. Spoofable X-Forwarded-For values must never allow a
    // brute-force attacker to rotate throttle buckets.
    keyGenerator: (req: any) => {
      const raw = req.socket?.remoteAddress || req.ip || 'unknown';
      const v4 = typeof raw === 'string' && raw.startsWith('::ffff:') ? raw.slice('::ffff:'.length) : raw;
      if (typeof v4 === 'string' && v4.includes(':')) {
        // Genuine IPv6 peer — delegate to library-safe IPv6 bucketing
        return `v6:${ipKeyGenerator(v4)}`;
      }
      return String(v4 || 'unknown');
    },
    validate: {
      xForwardedForHeader: process.env.NODE_ENV === 'production'
    }
  });

  app.use('/api', generalLimiter);
  app.use('/api', csrfProtection);
  app.post(['/api/login', '/api/auth/login'], loginLimiter);

  // Prometheus Metrics Endpoint (V9-2.2: محافظت با METRICS_TOKEN یا احراز هویت ادمین)
  app.get(['/metrics', '/api/metrics'], async (req, res) => {
    const metricsToken = process.env.METRICS_TOKEN;
    if (metricsToken) {
      const authHeader = req.headers['authorization'] || '';
      if (authHeader !== `Bearer ${metricsToken}`) {
        return res.status(401).json({ error: 'دسترسی به متریک‌ها نیازمند توکن معتبر (METRICS_TOKEN) یا احراز هویت مدیر است.' });
      }
    } else {
      // بدون توکن اختصاصی، تنها کاربران احراز‌هویت‌شده دسترسی دارند
      const cookieToken = (req as any).cookies?.['auth_token'] || (req as any).cookies?.['token'];
      const authHeader = req.headers['authorization'];
      if (!cookieToken && !(authHeader && String(authHeader).startsWith('Bearer '))) {
        return res.status(401).json({ error: 'دسترسی به متریک‌ها نیازمند احراز هویت است. برای اسکرپ عمومی Prometheus متغیر METRICS_TOKEN را تنظیم کنید.' });
      }
    }

    updateDbPoolMetrics();
    await updateOutboxMetrics();
    res.set('Content-Type', promClient.register.contentType);
    res.send(await promClient.register.metrics());
  });

  // ======== API Routes ========
  // 1. Liveness probe (Always 200 if process is running)
  app.get(['/api/health/live', '/health/live'], (_req, res) => {
    res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
  });

  // 2. Readiness probe (200 if DB reachable and connection pool not saturated)
  app.get(['/api/health/ready', '/health/ready'], async (_req, res) => {
    try {
      await orm.execute(sql`SELECT 1`);

      const pool = (orm as any).pool || (orm as any).client?.pool;
      const total = pool?.totalCount || 0;
      const idle = pool?.idleCount || 0;
      const waiting = pool?.waitingCount || 0;

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
  });

  // 3. Startup probe (200 if background migrations/seeds completed)
  app.get(['/api/health/startup', '/health/startup'], (_req, res) => {
    if (isStartupComplete) {
      res.status(200).json({ status: 'started', timestamp: new Date().toISOString() });
    } else {
      res.status(503).json({ status: 'starting', timestamp: new Date().toISOString() });
    }
  });

  // 4. Diagnostic Health Probe
  app.get(['/api/health', '/health'], async (_req, res) => {
    try {
      await orm.execute(sql`SELECT 1`);
      res.json({
        status: 'ok',
        version: BUILD_INFO.version,
        buildInfo: BUILD_INFO,
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
  });

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
  app.use('/api/inventory-integrity', inventoryRoutes);
  app.use('/api/events', eventsRoutes);
  app.use('/api/system', eventsRoutes);
  app.use('/api', draftsRoutes);
  app.use('/api/procurement', procurementRoutes);
  app.use('/api', procurementRoutes);

  const uploadsStatic = express.static(path.join(process.cwd(), 'public', 'uploads'));
  app.use('/uploads', (req, res, next) => {
    const p = (req.path || '').toLowerCase();
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

  app.use(errorHandler);

  return app;
}
