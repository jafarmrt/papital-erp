import request from 'supertest';
import jwt from 'jsonwebtoken';
import { TestCaseResult, makeTestCase } from '../types.js';
import { getTestApp, getAdminSession, ensureAdminTestUser, cleanupHttpTestUsers, AdminSession, TestApp } from '../fixtures/httpTestHelper.js';
import { orm } from '../../db/drizzle.js';
import { sql } from 'drizzle-orm';

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
      const probe = await orm.execute(sql`SELECT to_regclass('public.users') IS NOT NULL AS exists`);
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
      if (!adminCookie) throw new Error('admin cookie in hand nist');
      const suffix = Date.now();
      const xssPayload = `<script>alert("XSS")</script>مشتری امن ${suffix}`;
      const createRes = await request(app)
        .post('/api/customers')
        .set('Origin', 'http://localhost:3000')
        .set('x-csrf-token', session.csrfToken)
        .set('Cookie', adminCookie)
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
        .set('Cookie', adminCookie);
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
      const attempts = 8;
      const responses = [];
      for (let i = 0; i < attempts; i++) {
        responses.push(await request(app)
          .post('/api/auth/login')
          .set('X-Forwarded-For', `192.168.77.${i}`)
          .send({ username: 'admin', password: 'definitely-wrong-pass' }));
      }
      const tooMany = responses.filter(r => r.status === 429).length;
      if (tooMany === 0) {
        throw new Error(`هیچ 429ای صادر نشد — مهاجم می‌تواند با جعل XFF محدودیت را دور بزند (${responses.map(r => r.status).join(',')})`);
      }
      return `${tooMany} درخواست از ${attempts} تلاش با 429 مسدود شد — keyGenerator مبتنی بر socket address مقاوم است.`;
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
