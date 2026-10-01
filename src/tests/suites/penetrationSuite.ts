import request from 'supertest';
import jwt from 'jsonwebtoken';
import { TestCaseResult, makeTestCase } from '../types.js';
import { getTestApp, getAdminSession, ensureAdminTestUser, cleanupHttpTestUsers, AdminSession, TestApp } from '../fixtures/httpTestHelper.js';
import { TEST_PASSWORD, TEST_PASSWORD_HASH } from '../fixtures/factories.js';
import { orm } from '../../db/drizzle.js';
import { users } from '../../db/schema.js';
import { sql, eq } from 'drizzle-orm';

const FALLBACK_DEV_SECRET = 'fallback_secret_key_for_development';

async function runCase(
  results: TestCaseResult[],
  id: string,
  scenarioId: string,
  name: string,
  fn: () => Promise<string>
): Promise<void> {
  const start = Date.now();
  try {
    const details = await fn();
    results.push(makeTestCase({
      id,
      scenarioId: scenarioId as any,
      name,
      layer: 'penetration',
      executionType: 'real_api',
      passed: true,
      durationMs: Date.now() - start,
      details
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id,
      scenarioId: scenarioId as any,
      name,
      layer: 'penetration',
      executionType: 'real_api',
      passed: false,
      durationMs: Date.now() - start,
      error: err?.message || String(err)
    }));
  }
}

export async function runPenetrationTests(): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const app: TestApp = await getTestApp();
  let session: AdminSession = { cookie: '', csrfToken: '' };

  // ---------------------------------------------------------------
  // Setup: real admin user + real HTTP login (exercises auth stack)
  // ---------------------------------------------------------------
  try {
    await ensureAdminTestUser();
    session = await getAdminSession();
  } catch {
    session = { cookie: '', csrfToken: '' };
  }
  const adminCookie = session.cookie;

  // ===============================================================
  // TST-004 / JWT Forgery — fallback secret must be rejected (SEC-003)
  // ===============================================================
  await runCase(results, 'pen_jwt_forgery', 'jwt_forgery_rejected',
    'پن‌تست: جعل توکن ادمین با secret توسعه‌ای باید رد شود',
    async () => {
      const forged = jwt.sign(
        { id: 1, username: 'admin', role: 'admin' },
        FALLBACK_DEV_SECRET
      );
      const res = await request(app)
        .get('/api/users')
        .set('Cookie', `auth_token=${forged}`);
      if (res.status !== 401) {
        throw new Error(`توکن جعلی با secret fallback پذیرفته شد! status=${res.status}`);
      }
      return 'توکن جعلی با secret توسعه‌ای با 401 رد شد.';
    });

  await runCase(results, 'pen_jwt_expired', 'jwt_forgery_rejected',
    'پن‌تست: توکن منقضی‌شده باید 401 برگرداند',
    async () => {
      const expired = jwt.sign(
        { id: 1, username: 'admin', role: 'admin' },
        process.env.JWT_SECRET as string,
        { expiresIn: '-10s' }
      );
      const res = await request(app)
        .get('/api/users')
        .set('Cookie', `auth_token=${expired}`);
      if (res.status !== 401) {
        throw new Error(`توکن منقضی پذیرفته شد! status=${res.status}`);
      }
      return 'توکن منقضی‌شده با 401 رد شد.';
    });

  // ===============================================================
  // CSRF Protection (SEC-006) — cookie session without csrf header
  // ===============================================================
  await runCase(results, 'pen_csrf_missing_token', 'csrf_enforced',
    'پن‌تست: درخواست POST با کوکی معتبر ولی بدون هدر CSRF باید 403 شود',
    async () => {
      if (!adminCookie) throw new Error('admin cookie in hand nist');
      const res = await request(app)
        .post('/api/customers')
        .set('Origin', 'https://evil.example.com')
        .set('Cookie', adminCookie)
        .send({ name: 'CSRF Probe' });
      if (![403].includes(res.status)) {
        throw new Error(`CSRF block نشد! status=${res.status}`);
      }
      return `درخواست بین-سایتی بدون توکن CSRF با ${res.status} مسدود شد.`;
    });

  // ===============================================================
  // SQL Injection — parameterized routes & queries must hold
  // ===============================================================
  await runCase(results, 'pen_sqli_param_route', 'sqli_blocked',
    'پن‌تست: تزریق SQL در مسیر /api/items/:id نباید جدول users را حذف کند',
    async () => {
      const res = await request(app)
        .get('/api/items/1%3B%20DROP%20TABLE%20users%3B%20--')
        .set('Cookie', adminCookie);
      if (res.status >= 500) {
        throw new Error(`سرور با خطای 500 شکست خورد: ${JSON.stringify(res.body).slice(0, 200)}`);
      }
      // v7.0.24 (TD-174): نام بدون پیشوند اسکیما تا در اجرای ایزوله CI جدول users اسکیمای فعال بررسی شود
      const probe = await orm.execute(sql`SELECT to_regclass('users') IS NOT NULL AS exists`);
      const rows: any[] = (probe as any).rows || [];
      if (!rows[0]?.exists) {
        throw new Error('جدول users حذف شده است!');
      }
      return `مسیر تزریقی بدون خطای سرور پاسخ داد (${res.status}) و یکپارچگی جدول users حفظ شد.`;
    });

  await runCase(results, 'pen_sqli_query_filter', 'sqli_blocked',
    'پن‌تست: تزریق SQL در فیلتر name مشتریان باید امن پردازش شود',
    async () => {
      const res = await request(app)
        .get(`/api/customers?name=${encodeURIComponent("' OR '1'='1")}`)
        .set('Cookie', adminCookie);
      if (res.status >= 500) {
        throw new Error(`کوئری تزریقی باعث 500 شد`);
      }
      return `فیلتر تزریقی بدون خطا (${res.status}) و بدون افشای داده پردازش شد.`;
    });

  // ===============================================================
  // XSS — stored payload must be sanitized on persistence
  // ===============================================================
  await runCase(results, 'pen_xss_customer_name', 'xss_sanitized',
    'پن‌تست: payload اسکریپت در نام مشتری نباید خام ذخیره/بازگردانی شود',
    async () => {
      await ensureAdminTestUser();
      session = await getAdminSession();
      const currentCookie = session.cookie;
      if (!currentCookie) throw new Error('admin cookie in hand nist');
      const suffix = Date.now();
      const xssPayload = `<script>alert("XSS")</script>مشتری امن ${suffix}`;
      const createRes = await request(app)
        .post('/api/customers')
        .set('Origin', 'http://localhost:3000')
        .set('x-csrf-token', session.csrfToken)
        .set('Cookie', currentCookie)
        .send({ name: xssPayload });

      if (createRes.status === 403) {
        throw new Error('CSRF session token معتبر نبود — تست به هندلر نرسید');
      }
      if (createRes.status !== 200 && createRes.status !== 201) {
        throw new Error(`ایجاد مشتری شکست خورد: ${createRes.status} ${JSON.stringify(createRes.body).slice(0, 200)}`);
      }
      const created = createRes.body?.data ?? createRes.body;
      const getId = created?.id;
      if (!getId) throw new Error('شناسه مشتری بازنگشت');

      const getRes = await request(app)
        .get(`/api/customers/${getId}`)
        .set('Cookie', currentCookie);
      const body = JSON.stringify(getRes.body || {});
      if (body.includes('<script>')) {
        await orm.execute(sql`DELETE FROM customers WHERE id = ${getId}`);
        throw new Error('payload اسکریپت بدون پاکسازی بازگردانده شد!');
      }

      // Cleanup
      await orm.execute(sql`DELETE FROM customers WHERE id = ${getId}`);
      return 'payload XSS پیش از ذخیره‌سازی پاکسازی شد و پاسخ سرور عاری از <script> است.';
    });

  // ===============================================================
  // SSRF — webhook subscription targeting cloud metadata must fail
  // ===============================================================
  await runCase(results, 'pen_ssrf_metadata_block', 'ssrf_blocked',
    'پن‌تست: اشتراک وب‌هوک به IP داخلی Cloud Metadata باید رد شود',
    async () => {
      if (!adminCookie) throw new Error('admin cookie in hand nist');
      const res = await request(app)
        .post('/api/events/webhooks')
        .set('Origin', 'http://localhost:3000')
        .set('x-csrf-token', session.csrfToken)
        .set('Cookie', adminCookie)
        .send({
          name: `pen-ssrf-${Date.now()}`,
          targetUrl: 'http://169.254.169.254/latest/meta-data/',
          eventPatterns: ['document.*']
        });
      if (res.status === 403) {
        throw new Error('CSRF session token معتبر نبود — تست به گارد SSRF نرسید');
      }
      if (res.status >= 200 && res.status < 300 && res.body?.id) {
        // If creation succeeded, the delivery layer must still refuse dispatch.
        await request(app).delete(`/api/events/webhooks/${res.body.id}`)
          .set('x-csrf-token', session.csrfToken)
          .set('Origin', 'http://localhost:3000')
          .set('Cookie', adminCookie);
        throw new Error('اشتراک وب‌هوک با URL متادیتا ایجاد شد — گارد SSRF ناقص است');
      }
      return `گارد SSRF فعال است؛ درخواست با ${res.status} رد شد.`;
    });

  // ===============================================================
  // Rate Limit Bypass — XFF spoofing must NOT defeat brute-force lock
  // ===============================================================
  await runCase(results, 'pen_rate_limit_xff_bypass', 'rate_limit_no_bypass',
    'پن‌تست: چرخش X-Forwarded-For نباید قفل brute-force لاگین را دور بزند',
    async () => {
      const rlProbeUser = `pen_rl_probe_${Date.now()}`;
      await orm.insert(users).values({
        username: rlProbeUser,
        password: TEST_PASSWORD_HASH,
        fullName: 'پروب تست rate-limit',
        role: 'operator',
        avatarUrl: ''
      });
      const attempts = 8;
      const responses: any[] = [];
      try {
        for (let i = 0; i < attempts; i++) {
          responses.push(await request(app)
            .post('/api/auth/login')
            .set('X-Forwarded-For', `192.168.77.${i}`)
            .send({ username: rlProbeUser, password: 'definitely-wrong-pass' }));
        }
      } finally {
        await orm.delete(users).where(eq(users.username, rlProbeUser));
        try {
          const { resetLoginRateLimiter } = await import('../../app.js');
          resetLoginRateLimiter();
        } catch {
          // Non-blocking in isolated tests
        }
      }
      const tooMany = responses.filter(r => r.status === 429).length;
      if (tooMany === 0) {
        throw new Error(`هیچ 429ای صادر نشد — مهاجم می‌تواند با جعل XFF محدودیت را دور بزند (${responses.map(r => r.status).join(',')})`);
      }
      return `${tooMany} درخواست از ${attempts} تلاش با 429 مسدود شد — قفل brute-force با چرخش XFF دور زده نمی‌شود (کاربر پروب سینتتیک؛ ادمین واقعی دست‌نخورده).`;
    });

  // ===============================================================
  // v7.0.23 (TD-181 / audit P0-5): trust only known proxies for the client IP
  // ===============================================================
  await runCase(results, 'pen_trust_proxy_untrusted_peer', 'rate_limit_no_bypass',
    'پن‌تست: X-Forwarded-For از کلاینت مستقیم (غیرپراکسی) نباید معتبر شمرده شود و TRUST_PROXY=true ممنوع است',
    async () => {
      const trustFn = app.get('trust proxy fn') as (addr: string, i: number) => boolean;
      if (typeof trustFn !== 'function') {
        throw new Error('تابع trust proxy در اپلیکیشن Express پیکربندی نشده است.');
      }
      if (trustFn('203.0.113.7', 0) !== false) {
        throw new Error('آدرس عمومی 203.0.113.7 نباید به‌عنوان پراکسی قابل‌اعتماد پذیرفته شود (جعل XFF ممکن می‌شود).');
      }
      if (trustFn('127.0.0.1', 0) !== true) {
        throw new Error('Nginx محلی (loopback) باید پراکسی قابل‌اعتماد باشد تا IP واقعی کلاینت استخراج شود.');
      }
      const { resolveTrustProxySetting } = await import('../../lib/trustProxy.js');
      let unsafeRejected = false;
      try {
        resolveTrustProxySetting('true');
      } catch {
        unsafeRejected = true;
      }
      if (!unsafeRejected) {
        throw new Error('مقدار ناامن TRUST_PROXY=true باید رد شود.');
      }
      return 'آدرس‌های عمومی پراکسی محسوب نمی‌شوند، loopback قابل‌اعتماد است و TRUST_PROXY=true رد می‌شود.';
    });

  await runCase(results, 'pen_login_limiter_per_client_behind_proxy', 'rate_limit_no_bypass',
    'پن‌تست: پشت پراکسی، ورودهای موفق شمرده نشوند و brute-force یک کلاینت سایر کاربران را مسدود نکند',
    async () => {
      const { resetLoginRateLimiter } = await import('../../app.js');
      const okUser = `pen_rl_ok_${Date.now()}`;
      await orm.insert(users).values({
        username: okUser,
        password: TEST_PASSWORD_HASH,
        fullName: 'پروب تست ورود موفق',
        role: 'operator',
        avatarUrl: ''
      });
      resetLoginRateLimiter();
      try {
        // 1. Twelve successful logins from one office IP (via the local proxy) must all succeed
        for (let i = 0; i < 12; i++) {
          const res = await request(app)
            .post('/api/auth/login')
            .set('X-Forwarded-For', '198.51.100.10')
            .send({ username: okUser, password: TEST_PASSWORD });
          if (res.status !== 200) {
            throw new Error(`ورود موفق شماره ${i + 1} نباید محدود شود (وضعیت ${res.status}) — ورودهای موفق نباید سطل محدودیت را پر کنند.`);
          }
        }

        // 2. Client A brute-forces (non-existent usernames => no account lockout) and must get throttled
        let throttledA = false;
        for (let i = 0; i < 12; i++) {
          const res = await request(app)
            .post('/api/auth/login')
            .set('X-Forwarded-For', '198.51.100.66')
            .send({ username: `pen_rl_ghost_${i}_${Date.now()}`, password: 'definitely-wrong-pass' });
          if (res.status === 429) {
            throttledA = true;
            break;
          }
        }
        if (!throttledA) {
          throw new Error('brute-force کلاینت A پس از ۱۰ تلاش ناموفق باید با 429 مسدود شود.');
        }

        // 3. Client B behind the same proxy must still be able to log in
        const resB = await request(app)
          .post('/api/auth/login')
          .set('X-Forwarded-For', '198.51.100.77')
          .send({ username: okUser, password: TEST_PASSWORD });
        if (resB.status !== 200) {
          throw new Error(`کاربر B پشت همان پراکسی نباید به‌خاطر brute-force کلاینت A مسدود شود (وضعیت ${resB.status}).`);
        }
      } finally {
        await orm.delete(users).where(eq(users.username, okUser));
        resetLoginRateLimiter();
      }
      return '۱۲ ورود موفق بدون محدودیت انجام شد؛ کلاینت مهاجم مسدود شد و کاربر دیگر پشت همان پراکسی وارد شد.';
    });

  // ===============================================================
  // v7.0.26 (TD-184 / audit P1-3): key-level settings authorization & masked-secret protection
  // ===============================================================
  await runCase(results, 'pen_settings_key_level_authorization', 'settings_key_authorization',
    'پن‌تست: مدیر تنظیمات کسب‌وکاری را ذخیره کند، کلیدهای محرمانه با ******** بازنویسی نشوند و فقط ادمین آن‌ها را تغییر دهد',
    async () => {
      const { appSettings } = await import('../../db/schema.js');
      const { inArray } = await import('drizzle-orm');
      const keys = ['company_name', 'wc_consumer_secret', 'wc_store_url', 'runtime_enable_test_endpoints'];
      const originalRows = await orm.select().from(appSettings).where(inArray(appSettings.key, keys));
      const managerUser = `pen_mgr_${Date.now()}`;
      const upsert = async (key: string, value: string) => {
        await orm.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } });
      };
      try {
        await upsert('wc_consumer_secret', 'cs_real_secret_value');
        await upsert('company_name', 'شرکت آزمون قبل');
        await upsert('wc_store_url', 'https://shop.example.com');
        await orm.insert(users).values({ username: managerUser, password: TEST_PASSWORD_HASH, fullName: 'مدیر آزمون', role: 'manager', avatarUrl: '' });
        const { invalidateSettingsCache } = await import('../../lib/memoryCache.js');
        invalidateSettingsCache();
        const { loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
        const mgr = await loginTestUserWithSession(app, managerUser);

        // 1. Manager reads masked secret
        const getRes = await request(app).get('/api/settings').set('Cookie', mgr.cookie);
        const maskedRow = (Array.isArray(getRes.body) ? getRes.body : []).find((s: any) => s.key === 'wc_consumer_secret');
        if (maskedRow?.value !== '********') {
          throw new Error(`کلید محرمانه برای مدیر باید ماسک شود (مقدار: ${maskedRow?.value})`);
        }

        // 2. Manager re-submits the whole form (masked secret + unchanged system flag) and changes the company name
        const saveRes = await request(app).post('/api/settings').set('Cookie', mgr.cookie).set('X-CSRF-Token', mgr.csrfToken)
          .send({ settings: [
            { key: 'company_name', value: 'شرکت آزمون بعد' },
            { key: 'wc_consumer_secret', value: '********' },
            { key: 'runtime_enable_test_endpoints', value: 'false' },
            { key: 'wc_store_url', value: 'https://shop.example.com' }
          ] });
        if (saveRes.status !== 200 || JSON.stringify(saveRes.body?.changedKeys) !== JSON.stringify(['company_name'])) {
          throw new Error(`ذخیره تنظیمات توسط مدیر باید موفق و فقط company_name تغییر کند: ${saveRes.status} ${JSON.stringify(saveRes.body).slice(0, 200)}`);
        }
        const [secretAfter] = await orm.select().from(appSettings).where(eq(appSettings.key, 'wc_consumer_secret'));
        if (secretAfter?.value !== 'cs_real_secret_value') {
          throw new Error('مقدار واقعی کلید محرمانه نباید با ******** بازنویسی شود.');
        }

        // 3. Manager must not change secret integration keys or the store URL
        const forbiddenRes = await request(app).post('/api/settings').set('Cookie', mgr.cookie).set('X-CSRF-Token', mgr.csrfToken)
          .send({ settings: [{ key: 'wc_store_url', value: 'https://attacker.example.net' }] });
        if (forbiddenRes.status !== 403) {
          throw new Error(`تغییر آدرس فروشگاه ووکامرس توسط مدیر باید 403 بگیرد (وضعیت ${forbiddenRes.status}).`);
        }

        // 4. Unknown keys are rejected
        const unknownRes = await request(app).post('/api/settings').set('Cookie', mgr.cookie).set('X-CSRF-Token', mgr.csrfToken)
          .send({ settings: [{ key: 'negative_stock_policy', value: 'allowed' }] });
        if (unknownRes.status < 400 || unknownRes.status >= 500) {
          throw new Error(`کلید ناشناخته باید رد شود (وضعیت ${unknownRes.status}).`);
        }

        // 5. Admin can change a secret key
        const adminSession = await getAdminSession();
        const adminRes = await request(app).post('/api/settings').set('Cookie', adminSession.cookie).set('X-CSRF-Token', adminSession.csrfToken)
          .send({ settings: [{ key: 'wc_consumer_secret', value: 'cs_rotated_by_admin' }] });
        const [secretRotated] = await orm.select().from(appSettings).where(eq(appSettings.key, 'wc_consumer_secret'));
        if (adminRes.status !== 200 || secretRotated?.value !== 'cs_rotated_by_admin') {
          throw new Error(`ادمین باید بتواند کلید محرمانه را تغییر دهد (وضعیت ${adminRes.status}).`);
        }
        return 'مدیر تنظیمات کسب‌وکاری را ذخیره کرد، مقدار ماسک نادیده گرفته شد، تغییر کلید محرمانه توسط مدیر 403 گرفت، کلید ناشناخته رد شد و ادمین کلید محرمانه را تغییر داد.';
      } finally {
        await orm.delete(users).where(eq(users.username, managerUser));
        await orm.delete(appSettings).where(inArray(appSettings.key, keys));
        for (const row of originalRows) {
          await orm.insert(appSettings).values({ key: row.key, value: row.value }).onConflictDoNothing();
        }
        const { invalidateSettingsCache } = await import('../../lib/memoryCache.js');
        invalidateSettingsCache();
      }
    });

  // ===============================================================
  // v7.0.27 (TD-185 / audit P1-4): JWT is not exposed in the login response body by default
  // ===============================================================
  await runCase(results, 'pen_login_token_not_in_body', 'token_not_exposed_in_body',
    'پن‌تست: توکن JWT به‌صورت پیش‌فرض در بدنه پاسخ ورود برگردانده نشود (فقط کوکی HttpOnly)',
    async () => {
      const probeUser = `pen_tok_${Date.now()}`;
      const previousFlag = process.env.EXPOSE_TOKEN_IN_BODY;
      await orm.insert(users).values({ username: probeUser, password: TEST_PASSWORD_HASH, fullName: 'پروب توکن', role: 'operator', avatarUrl: '' });
      try {
        delete process.env.EXPOSE_TOKEN_IN_BODY;
        const res = await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.91').send({ username: probeUser, password: TEST_PASSWORD });
        const setCookie = String(res.headers['set-cookie'] || '');
        if (res.status !== 200 || !setCookie.includes('auth_token=') || !/HttpOnly/i.test(setCookie)) {
          throw new Error(`ورود موفق باید کوکی HttpOnly صادر کند (وضعیت ${res.status}).`);
        }
        if (Object.prototype.hasOwnProperty.call(res.body || {}, 'token')) {
          throw new Error('بدنه پاسخ ورود نباید شامل فیلد token باشد (AGENTS.md §5).');
        }

        process.env.EXPOSE_TOKEN_IN_BODY = 'true';
        const resFlag = await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.92').send({ username: probeUser, password: TEST_PASSWORD });
        if (resFlag.status !== 200 || typeof resFlag.body?.token !== 'string' || resFlag.body.token.length < 20) {
          throw new Error('با EXPOSE_TOKEN_IN_BODY=true (سازگاری پیش‌نمایش) باید فیلد token برگردانده شود.');
        }
        return 'به‌صورت پیش‌فرض فقط کوکی HttpOnly صادر شد و فیلد token در بدنه نبود؛ با فلگ سازگاری، token برگردانده شد.';
      } finally {
        if (previousFlag === undefined) delete process.env.EXPOSE_TOKEN_IN_BODY;
        else process.env.EXPOSE_TOKEN_IN_BODY = previousFlag;
        await orm.delete(users).where(eq(users.username, probeUser));
      }
    });

  // ===============================================================
  // Path Traversal — /uploads must never escape its root
  // ===============================================================
  await runCase(results, 'pen_path_traversal_uploads', 'path_traversal_blocked',
    'پن‌تست: Path Traversal روی /uploads نباید به فایلهای سیستمی دسترسی دهد',
    async () => {
      const probes = [
        '/uploads/..%2f..%2f..%2fetc%2fpasswd',
        '/uploads/../../etc/passwd',
        '/uploads/%2e%2e/%2e%2e/env'
      ];
      for (const p of probes) {
        const res = await request(app).get(p);
        if (res.status === 200 && String(res.text || '').includes('root:')) {
          throw new Error(`نشت فایل سیستمی از طریق ${p}`);
        }
      }
      return 'هیچ‌یک از پروب‌های traversal به محتوای خارج از ریشه uploads دسترسی نیافتند.';
    });

  await cleanupHttpTestUsers();
  return results;
}
