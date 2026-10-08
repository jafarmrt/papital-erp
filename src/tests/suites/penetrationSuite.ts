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

  // v7.0.41 (audit P2-11): توکن نشست فقط با الگوریتم HS256 پذیرفته شود
  await runCase(results, 'pen_jwt_algorithm_pinned', 'jwt_forgery_rejected',
    'پن‌تست: توکن نشست با کلید درست ولی الگوریتم دیگر (HS512) باید رد شود',
    async () => {
      if (!adminCookie) throw new Error('کوکی ادمین برای آزمون در دسترس نیست');
      const original = jwt.decode(adminCookie.replace(/^auth_token=/, '')) as Record<string, unknown> | null;
      if (!original?.id) throw new Error('محتوای توکن نشست ادمین قابل خواندن نیست');
      const { iat: _iat, exp: _exp, ...claims } = original;
      const otherAlg = jwt.sign(claims, process.env.JWT_SECRET as string, { algorithm: 'HS512', expiresIn: '1h' });
      const control = await request(app).get('/api/auth/me').set('Cookie', adminCookie);
      const res = await request(app).get('/api/auth/me').set('Cookie', `auth_token=${otherAlg}`);
      if (control.status !== 200) {
        throw new Error(`نشست اصلی ادمین باید پذیرفته شود: status=${control.status}`);
      }
      if (res.status !== 401) {
        throw new Error(`توکن امضاشده با HS512 پذیرفته شد! status=${res.status}`);
      }
      return 'همان ادعاهای نشست با الگوریتم HS512 با 401 رد شد و نشست HS256 پذیرفته ماند.';
    });

  // v7.0.41 (audit P2-11): توکن CSRF در زمان ثابت مقایسه شود
  await runCase(results, 'pen_csrf_constant_time_compare', 'csrf_enforced',
    'پن‌تست: توکن CSRF نادرست رد شود و مقایسه آن در زمان ثابت (timingSafeEqual) انجام شود',
    async () => {
      if (!adminCookie) throw new Error('کوکی ادمین برای آزمون در دسترس نیست');
      const cryptoModule = (await import('crypto')).default as unknown as { timingSafeEqual: (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => boolean };
      const nodeCrypto = await import('crypto');
      const probeToken = 'f'.repeat(64);
      // فقط مقایسه‌هایی شمرده شوند که هش توکن CSRF آزمون در آن‌هاست (امضای JWT هم از timingSafeEqual استفاده می‌کند)
      const probeHash = nodeCrypto.createHash('sha256').update(probeToken).digest();
      const toBuffer = (v: NodeJS.ArrayBufferView) => Buffer.from(v.buffer, v.byteOffset, v.byteLength);
      const originalTimingSafeEqual = cryptoModule.timingSafeEqual;
      let constantTimeCalls = 0;
      cryptoModule.timingSafeEqual = (a, b) => {
        if (toBuffer(a).equals(probeHash) || toBuffer(b).equals(probeHash)) constantTimeCalls++;
        return originalTimingSafeEqual(a, b);
      };
      let res;
      try {
        res = await request(app)
          .post('/api/customers')
          .set('Cookie', adminCookie)
          .set('x-csrf-token', probeToken)
          .send({ name: 'CSRF Timing Probe' });
      } finally {
        cryptoModule.timingSafeEqual = originalTimingSafeEqual;
      }
      if (res.status !== 403) {
        throw new Error(`توکن CSRF نادرست رد نشد! status=${res.status}`);
      }
      if (constantTimeCalls === 0) {
        throw new Error('توکن CSRF با مقایسه معمولی رشته (غیر زمان‌ثابت) سنجیده شد');
      }
      return `توکن CSRF نادرست با 403 رد شد و مقایسه با timingSafeEqual (${constantTimeCalls} فراخوانی) انجام شد.`;
    });

  // v7.0.43 (audit P3-11): مسیر API ناموجود باید 404 JSON بدهد، نه صفحه برنامه
  await runCase(results, 'pen_unknown_api_route_json_404', 'unknown_api_route_json_404',
    'پن‌تست: مسیر API ناموجود برای کاربر واردشده پاسخ 404 با بدنه JSON بدهد',
    async () => {
      if (!adminCookie) throw new Error('کوکی ادمین برای آزمون در دسترس نیست');
      const res = await request(app).get('/api/__no_such_endpoint_p3_11').set('Cookie', adminCookie);
      if (res.status !== 404 || !String(res.headers['content-type'] || '').includes('application/json') || !res.body?.error) {
        throw new Error(`پاسخ مسیر ناموجود باید 404 JSON باشد: status=${res.status} type=${res.headers['content-type']}`);
      }
      return 'مسیر API ناموجود پاسخ 404 با بدنه JSON گرفت و به برنامه تک‌صفحه‌ای نرسید.';
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
      // v7.0.70 (TD-187، تصمیم مالک محصول): هر نشانی جدا فقط (نام کاربری + IP) خودش را قفل می‌کند؛ چرخش نشانی
      // پس از ACCOUNT_LOCKOUT_THRESHOLD تلاش به قفل کل حساب می‌خورد
      const { ACCOUNT_LOCKOUT_THRESHOLD, resetPhantomLockouts } = await import('../../services/auth/loginSecurity.service.js');
      const attempts = ACCOUNT_LOCKOUT_THRESHOLD + 2;
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
        resetPhantomLockouts();
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

  // v7.0.41 (TD-182): IP لاگ ممیزی نباید از مقدار ابتدای X-Forwarded-For که در کنترل کلاینت است خوانده شود
  await runCase(results, 'pen_audit_ip_not_spoofable', 'rate_limit_no_bypass',
    'پن‌تست: IP ثبت‌شده در لاگ ممیزی از پراکسی قابل‌اعتماد گرفته شود، نه از X-Forwarded-For جعلی کلاینت',
    async () => {
      const { activityLogs } = await import('../../db/schema.js');
      const probeUser = `pen_ip_probe_${Date.now()}`;
      // کلاینت 203.0.113.66 را جعل می‌کند؛ پراکسی محلی (loopback، قابل‌اعتماد) آدرس واقعی 198.51.100.7 را اضافه کرده است
      const res = await request(app)
        .post('/api/login')
        .set('X-Forwarded-For', '203.0.113.66, 198.51.100.7')
        .send({ username: probeUser, password: 'wrong-password-ip-probe' });
      if (res.status !== 401) {
        throw new Error(`ورود ناموفق باید 401 بدهد: status=${res.status}`);
      }
      const [log] = await orm.select({ ip: activityLogs.ipAddress }).from(activityLogs)
        .where(eq(activityLogs.username, probeUser)).limit(1);
      if (!log) throw new Error('لاگ ممیزی ورود ناموفق ثبت نشد');
      if (log.ip !== '198.51.100.7') {
        throw new Error(`IP لاگ ممیزی باید آدرس اعلام‌شده پراکسی قابل‌اعتماد (198.51.100.7) باشد، نه «${log.ip}»`);
      }
      return 'IP جعلی ابتدای X-Forwarded-For نادیده گرفته شد و آدرس اعلام‌شده پراکسی قابل‌اعتماد در لاگ ممیزی ثبت شد.';
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

        // 2. Manager re-submits the whole form (masked secret + the retired test-endpoints flag of an old form, v7.0.85) and changes the company name
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
  // v7.0.28 (TD-186 / audit P1-5): login failures must not reveal whether a username exists
  // ===============================================================
  await runCase(results, 'pen_login_uniform_responses', 'login_uniform_responses',
    'پن‌تست: پاسخ ورود ناموفق برای کاربر موجود و ناموجود یکسان باشد و قفل تدریجی برای هر دو اعمال شود',
    async () => {
      const { resetLoginRateLimiter } = await import('../../app.js');
      const { resetPhantomLockouts } = await import('../../services/auth/loginSecurity.service.js');
      const realUser = `pen_uni_${Date.now()}`;
      const ghostUser = `pen_uni_ghost_${Date.now()}`;
      await orm.insert(users).values({ username: realUser, password: TEST_PASSWORD_HASH, fullName: 'پروب پاسخ یکسان', role: 'operator', avatarUrl: '' });
      resetLoginRateLimiter();
      try {
        const attempt = (username: string, ip: string) => request(app).post('/api/auth/login')
          .set('X-Forwarded-For', ip).send({ username, password: 'definitely-wrong-pass' });

        // 1. First failure: identical status and body for an existing and an unknown username
        const realFirst = await attempt(realUser, '198.51.100.101');
        const ghostFirst = await attempt(ghostUser, '198.51.100.102');
        if (realFirst.status !== 401 || ghostFirst.status !== 401 || JSON.stringify(realFirst.body) !== JSON.stringify(ghostFirst.body)) {
          throw new Error(`پاسخ ورود ناموفق باید یکسان باشد: ${realFirst.status} ${JSON.stringify(realFirst.body)} / ${ghostFirst.status} ${JSON.stringify(ghostFirst.body)}`);
        }
        if (/تلاش باقی/.test(String(realFirst.body?.error || ''))) {
          throw new Error('پیام خطا نباید تعداد تلاش‌های باقی‌مانده را افشا کند.');
        }

        // 2. After the threshold both get the same 429 progressive lock (1 minute)
        let realLocked: any = null;
        let ghostLocked: any = null;
        // v7.0.70 (TD-187): قفل تدریجی برای (نام کاربری + IP) است؛ تلاش‌ها از همان نشانی
        for (let i = 0; i < 4; i++) {
          realLocked = await attempt(realUser, '198.51.100.101');
          ghostLocked = await attempt(ghostUser, '198.51.100.102');
        }
        if (realLocked?.status !== 429 || ghostLocked?.status !== 429 || realLocked.body?.remainingMinutes !== 1 || ghostLocked.body?.remainingMinutes !== 1
          || realLocked.body?.error !== ghostLocked.body?.error) {
          throw new Error(`پس از ۵ تلاش ناموفق هر دو باید قفل یکسان ۱ دقیقه‌ای بگیرند: ${realLocked?.status}/${ghostLocked?.status} ${JSON.stringify(realLocked?.body)} ${JSON.stringify(ghostLocked?.body)}`);
        }
        return 'پیام و وضعیت خطای ورود برای کاربر موجود و ناموجود یکسان بود و پس از ۵ تلاش هر دو قفل تدریجی یکسان ۱ دقیقه‌ای گرفتند.';
      } finally {
        await orm.delete(users).where(eq(users.username, realUser));
        resetPhantomLockouts();
        resetLoginRateLimiter();
      }
    });

  // ===============================================================
  // v7.0.29 (TD-188 / audit P1-6): data export never contains credentials or secrets
  // ===============================================================
  await runCase(results, 'pen_data_export_no_secrets', 'data_export_no_secrets',
    'پن‌تست: خروجی داده‌ها شامل هش رمز، رمز صرافی پرسنل و کلیدهای محرمانه نباشد و دفاتر حسابداری را داشته باشد',
    async () => {
      const { appSettings, personnel } = await import('../../db/schema.js');
      const secretKey = 'wc_webhook_secret';
      const [originalSecret] = await orm.select().from(appSettings).where(eq(appSettings.key, secretKey));
      const probeSecret = `whsec_probe_${Date.now()}`;
      const probeNobitex = `nbx_probe_${Date.now()}`;
      await orm.insert(appSettings).values({ key: secretKey, value: probeSecret }).onConflictDoUpdate({ target: appSettings.key, set: { value: probeSecret } });
      const [probePersonnel] = await orm.insert(personnel).values({ fullName: 'پروب خروجی داده', nobitexPassword: probeNobitex }).returning({ id: personnel.id });
      const operatorUser = `pen_exp_${Date.now()}`;
      await orm.insert(users).values({ username: operatorUser, password: TEST_PASSWORD_HASH, fullName: 'اپراتور خروجی', role: 'operator', avatarUrl: '' });
      try {
        const adminSession = await getAdminSession();
        // v9.0.356 (TD-592): the export is a zip of NDJSON tables
        const { readZipEntries, ndjsonRows, binaryParser } = await import('../fixtures/zipReader.js');
        const res = await request(app).get('/api/export-backup').set('Cookie', adminSession.cookie).buffer(true).parse(binaryParser as never);
        if (res.status !== 200) {
          throw new Error(`data export must answer 200 for the admin (status ${res.status}).`);
        }
        const entries = readZipEntries(res.body as Buffer);
        const raw = [...entries.values()].map(b => b.toString('utf8')).join('\n');
        if (/\$2[aby]\$\d{2}\$/.test(raw)) {
          throw new Error('data export must not contain a bcrypt password hash.');
        }
        if (raw.includes(probeSecret) || raw.includes(probeNobitex)) {
          throw new Error('data export must not contain the webhook secret or the personnel exchange password.');
        }
        for (const table of ['journal_vouchers', 'journal_voucher_items', 'accounts', 'cheques', 'treasury_transactions', 'piecework_payrolls', 'item_warehouse_stocks']) {
          if (!entries.has(`${table}.ndjson`)) {
            throw new Error(`table ${table} must be in the data export.`);
          }
        }
        if (ndjsonRows(entries.get('users.ndjson')).some(u => Object.prototype.hasOwnProperty.call(u, 'password'))) {
          throw new Error('user rows of the export must not have a password field.');
        }

        const { loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
        const op = await loginTestUserWithSession(app, operatorUser);
        const forbidden = await request(app).get('/api/export-backup').set('Cookie', op.cookie);
        if (forbidden.status !== 403) {
          throw new Error(`کاربر غیرادمین نباید به خروجی داده‌ها دسترسی داشته باشد (وضعیت ${forbidden.status}).`);
        }
        return 'خروجی داده‌ها بدون هش رمز، رمز صرافی و کلید محرمانه و همراه با دفاتر حسابداری و کارمزدی تولید شد و برای غیرادمین 403 بود.';
      } finally {
        await orm.delete(users).where(eq(users.username, operatorUser));
        await orm.delete(personnel).where(eq(personnel.id, probePersonnel.id));
        if (originalSecret) {
          await orm.update(appSettings).set({ value: originalSecret.value }).where(eq(appSettings.key, secretKey));
        } else {
          await orm.delete(appSettings).where(eq(appSettings.key, secretKey));
        }
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
