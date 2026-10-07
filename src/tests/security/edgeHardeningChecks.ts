import { spawnSync } from 'child_process';
import crypto from 'crypto';
import path from 'path';
import request from 'supertest';
import promClient from 'prom-client';
import { eq } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { users } from '../../db/schema.js';
import { generateToken, invalidateUserAuthCache } from '../../middleware/auth.js';
import { getTestApp, ensureAdminTestUser } from '../fixtures/httpTestHelper.js';

/**
 * Package 1, PR «ب» (lane 4): the HTTP edge of the real Express app (metrics labels and guard, global rate
 * limit key, CSP in production, client trace ids). Test names and failure messages are English (terminal output).
 */

type ShouldRun = (id: string, ...extra: string[]) => boolean;

const randomTag = () => crypto.randomBytes(6).toString('hex');

/** Number of `http_requests_total` series currently held by prom-client */
async function requestSeriesCount(): Promise<number> {
  const metric = promClient.register.getSingleMetric('http_requests_total');
  return metric ? (await metric.get()).values.length : 0;
}

async function requestSeriesLabels(): Promise<string[]> {
  const metric = promClient.register.getSingleMetric('http_requests_total');
  return metric ? (await metric.get()).values.map(v => `${v.labels.method} ${v.labels.route} ${v.labels.status}`) : [];
}

// ---------- TD-582 ----------
async function checkMetricsLabelsBounded(): Promise<string[]> {
  const v: string[] = [];
  const app = await getTestApp();
  await request(app).get(`/api/zz-${randomTag()}`);
  await request(app).get(`/zz-${randomTag()}.js`);
  const before = await requestSeriesCount();
  for (let i = 0; i < 100; i++) {
    await request(app).get(`/api/zz-${randomTag()}`);
    await request(app).get(`/zz-${randomTag()}.js`);
  }
  const grown = (await requestSeriesCount()) - before;
  if (grown > 0) v.push(`200 requests to random unknown paths added ${grown} metric series (expected 0)`);

  // a matched route carries its mount prefix: /api + /me, not the bare router path
  const admin = await ensureAdminTestUser();
  const [row] = await orm.select({ tokenVersion: users.tokenVersion }).from(users).where(eq(users.id, admin.id));
  const token = generateToken({ id: admin.id, username: admin.username, role: 'admin', tokenVersion: row?.tokenVersion ?? 0 });
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
  if (me.status !== 200) v.push(`GET /api/auth/me answered ${me.status}`);
  const labels = await requestSeriesLabels();
  if (!labels.includes('GET /api/auth/me 200')) v.push(`no series labelled "GET /api/auth/me 200"; labels with /me: ${labels.filter(l => l.includes('/me')).join(', ') || 'none'}`);
  return v;
}

// ---------- TD-595 ----------
async function checkRateLimitKeyIgnoresCookie(): Promise<string[]> {
  const app = await getTestApp();
  const remaining = async (cookie?: string): Promise<number> => {
    const req = request(app).get(`/api/zz-ratelimit-${randomTag()}`);
    const r = cookie ? await req.set('Cookie', `auth_token=${cookie}`) : await req;
    return Number(r.headers['ratelimit-remaining']);
  };
  const plain = await remaining();
  const forgedA1 = await remaining(`forged-${randomTag()}-aaaaaaaaaaaaaaaa`);
  const forgedA2 = await remaining(`forged-${randomTag()}-aaaaaaaaaaaaaaaa`);
  const forgedB = await remaining(`forged-${randomTag()}-bbbbbbbbbbbbbbbb`);
  const seq = [plain, forgedA1, forgedA2, forgedB];
  if (seq.some(n => !Number.isFinite(n))) return [`no RateLimit-Remaining header: ${seq.join(', ')}`];
  for (let i = 1; i < seq.length; i++) {
    if (!(seq[i] < seq[i - 1])) {
      return [`a forged cookie got its own bucket: remaining without cookie, then three forged cookies = ${seq.join(', ')} (expected strictly decreasing)`];
    }
  }
  return [];
}

// ---------- TD-597 ----------
function probeProductionCsp(extra: Record<string, string>): { csp: string; error?: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production', JWT_SECRET: crypto.randomBytes(32).toString('hex') };
  delete env.FRAME_ANCESTORS;
  delete env.EXTERNAL_API_ORIGINS;
  Object.assign(env, extra);
  const r = spawnSync(path.resolve('node_modules/.bin/tsx'), ['src/tests/security/productionHeadersProbe.ts'], { env, encoding: 'utf8', timeout: 120_000 });
  const line = `${r.stdout}`.split('\n').find(l => l.startsWith('PROBE '));
  if (!line) return { csp: '', error: `probe failed (exit ${r.status}): ${`${r.stderr}${r.stdout}`.slice(-300)}` };
  return { csp: String((JSON.parse(line.slice(6)) as { csp?: string }).csp ?? '') };
}

function directive(csp: string, name: string): string {
  return csp.split(';').map(s => s.trim()).find(s => s.startsWith(`${name} `)) ?? '';
}

async function checkProductionCsp(): Promise<string[]> {
  const v: string[] = [];
  const plain = probeProductionCsp({});
  if (plain.error) return [plain.error];
  if (directive(plain.csp, 'frame-ancestors') !== "frame-ancestors 'self'") v.push(`production ${directive(plain.csp, 'frame-ancestors') || 'frame-ancestors missing'} (expected 'self' only)`);
  if (directive(plain.csp, 'connect-src') !== "connect-src 'self'") v.push(`production ${directive(plain.csp, 'connect-src') || 'connect-src missing'} (expected 'self' only)`);
  const explicit = probeProductionCsp({ FRAME_ANCESTORS: 'https://preview.example.com', EXTERNAL_API_ORIGINS: 'https://api.example.com' });
  if (explicit.error) return [...v, explicit.error];
  if (directive(explicit.csp, 'frame-ancestors') !== "frame-ancestors 'self' https://preview.example.com") v.push(`FRAME_ANCESTORS not applied: ${directive(explicit.csp, 'frame-ancestors')}`);
  if (directive(explicit.csp, 'connect-src') !== "connect-src 'self' https://api.example.com") v.push(`EXTERNAL_API_ORIGINS not applied: ${directive(explicit.csp, 'connect-src')}`);
  return v;
}

// ---------- TD-599 ----------
async function checkMetricsLiveSession(): Promise<string[]> {
  const v: string[] = [];
  const app = await getTestApp();
  const admin = await ensureAdminTestUser(`p01_metrics_${randomTag()}`);
  const tokenFor = async () => {
    const [row] = await orm.select({ tokenVersion: users.tokenVersion }).from(users).where(eq(users.id, admin.id));
    return generateToken({ id: admin.id, username: admin.username, role: 'admin', tokenVersion: row?.tokenVersion ?? 0 });
  };
  const scrape = (token: string) => request(app).get('/metrics').set('Authorization', `Bearer ${token}`);
  try {
    const token = await tokenFor();
    const live = await scrape(token);
    if (live.status !== 200) v.push(`live admin: /metrics answered ${live.status} (expected 200)`);

    await orm.update(users).set({ role: 'p01_metrics_viewer' }).where(eq(users.id, admin.id));
    invalidateUserAuthCache(admin.id);
    const demotedSameVersion = await scrape(token);
    if (demotedSameVersion.status !== 403) v.push(`admin demoted in the database (token still says admin): /metrics answered ${demotedSameVersion.status} (expected 403)`);

    const [row] = await orm.select({ tokenVersion: users.tokenVersion }).from(users).where(eq(users.id, admin.id));
    await orm.update(users).set({ tokenVersion: (row?.tokenVersion ?? 0) + 1 }).where(eq(users.id, admin.id));
    invalidateUserAuthCache(admin.id);
    const staleVersion = await scrape(token);
    if (staleVersion.status !== 401) v.push(`token of an older tokenVersion: /metrics answered ${staleVersion.status} (expected 401)`);

    await orm.update(users).set({ role: 'admin' }).where(eq(users.id, admin.id));
    const fresh = await tokenFor();
    await orm.update(users).set({ isDeleted: 1 }).where(eq(users.id, admin.id));
    invalidateUserAuthCache(admin.id);
    const deleted = await scrape(fresh);
    if (deleted.status !== 401) v.push(`deleted admin: /metrics answered ${deleted.status} (expected 401)`);
  } finally {
    await orm.update(users).set({ isDeleted: 1, role: 'admin' }).where(eq(users.id, admin.id));
    invalidateUserAuthCache(admin.id);
  }
  return v;
}

// ---------- TD-602 ----------
async function checkClientRequestIdValidated(): Promise<string[]> {
  const v: string[] = [];
  const app = await getTestApp();
  const long = 'x'.repeat(4000);
  const r1 = await request(app).get('/health/live').set('X-Request-ID', long);
  const id1 = String(r1.headers['x-request-id'] ?? '');
  if (id1 === long || id1.length > 64) v.push(`a 4000-character X-Request-ID was used as the trace id (${id1.length} characters)`);
  const r2 = await request(app).get('/health/live').set('X-Request-ID', 'bad id with spaces');
  if (r2.headers['x-request-id'] === 'bad id with spaces') v.push('an X-Request-ID with spaces was used as the trace id');
  const good = `trace_${randomTag()}`;
  const r3 = await request(app).get('/health/live').set('X-Request-ID', good);
  if (r3.headers['x-request-id'] !== good) v.push(`a well-formed X-Request-ID was not kept: sent ${good}, got ${String(r3.headers['x-request-id'])}`);
  return v;
}

const CASES: Array<[string, string, () => Promise<string[]>, string]> = [
  ['sec_td_582_metrics_labels_bounded',
    'HTTP metrics label a request by mount prefix and route pattern; unknown paths share one label and add no series (TD-582)',
    checkMetricsLabelsBounded, '200 random unknown paths added no series; GET /api/auth/me is labelled with its mount prefix'],
  ['sec_td_595_rate_limit_key_ignores_cookie',
    'the global rate limit counts per client address; a forged session cookie does not open a new bucket (TD-595)',
    checkRateLimitKeyIgnoresCookie, 'requests with and without forged cookies drew from one bucket'],
  ['sec_td_597_production_csp_self_only',
    'in production the app may be framed and may connect only to itself, plus FRAME_ANCESTORS and EXTERNAL_API_ORIGINS (TD-597)',
    checkProductionCsp, "production frame-ancestors and connect-src are 'self'; explicit origins are added"],
  ['sec_td_599_metrics_live_session',
    '/metrics checks the admin session live: a deleted, demoted or re-versioned admin is refused (TD-599)',
    checkMetricsLiveSession, 'live admin 200; demoted 403; stale tokenVersion 401; deleted 401'],
  ['sec_td_602_client_request_id_validated',
    'a client X-Request-ID becomes the trace id only when it matches [A-Za-z0-9_-]{8,64} (TD-602)',
    checkClientRequestIdValidated, 'a 4000-character id and an id with spaces were replaced; a well-formed id was kept'],
];

export async function runEdgeHardeningTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  for (const [id, name, fn, info] of CASES) {
    if (!shouldRun(id, name)) continue;
    const start = Date.now();
    let violations: string[];
    try {
      violations = await fn();
    } catch (err: unknown) {
      violations = [err instanceof Error ? err.message : String(err)];
    }
    results.push(makeTestCase({
      id, name, layer: 'security', executionType: 'real_code', passed: violations.length === 0, durationMs: Date.now() - start,
      ...(violations.length === 0 ? { details: info } : { error: violations.join(' | ') }),
    }));
  }
  return results;
}
