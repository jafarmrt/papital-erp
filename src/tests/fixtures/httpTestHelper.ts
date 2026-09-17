import request from 'supertest';
import jwt from 'jsonwebtoken';
import { orm } from '../../db/drizzle.js';
import { users } from '../../db/schema.js';
import { eq, and, like } from 'drizzle-orm';
import { createApp } from '../../app.js';
import { TEST_PASSWORD, TEST_PASSWORD_HASH } from './factories.js';
import { invalidateUserAuthCache } from '../../middleware/auth.js';

export type TestApp = any;

let cachedApp: TestApp | null = null;

/**
 * Builds (once per process) the real Express application for supertest flows.
 * No port binding happens — supertest manages ephemeral listeners.
 */
export async function getTestApp(): Promise<TestApp> {
  if (!cachedApp) {
    cachedApp = await createApp();
  }
  return cachedApp;
}

/**
 * Creates (or reuses) a dedicated admin test user whose password is known,
 * enabling genuine end-to-end authentication through /api/auth/login.
 */
export async function ensureAdminTestUser(username = 'pen_admin'): Promise<{ id: number; username: string }> {
  const [existing] = await orm
    .select()
    .from(users)
    .where(and(eq(users.username, username), eq(users.role, 'admin')));

  if (existing) {
    // Keep password deterministic for the current run and ensure active
    await orm.update(users).set({ password: TEST_PASSWORD_HASH, isDeleted: 0 }).where(eq(users.id, existing.id));
    invalidateUserAuthCache(existing.id);
    return { id: existing.id, username: existing.username };
  }

  const [created] = await orm
    .insert(users)
    .values({
      username,
      password: TEST_PASSWORD_HASH,
      fullName: 'کاربر تست نفوذ',
      role: 'admin',
      avatarUrl: '',
    })
    .returning();

  invalidateUserAuthCache(created.id);
  return { id: created.id, username: created.username };
}

/**
 * Performs a REAL login through the HTTP API and returns the auth cookie
 * header value plus the CSRF token embedded in the session JWT, so that
 * state-changing supertest calls can pass the x-csrf-token guard.
 */
export interface AdminSession {
  cookie: string;
  csrfToken: string;
}

export async function loginTestUser(
  app: TestApp,
  username: string,
  password: string = TEST_PASSWORD
): Promise<string> {
  const { cookie } = await loginTestUserWithSession(app, username, password);
  return cookie;
}

export async function loginTestUserWithSession(
  app: TestApp,
  username: string,
  password: string = TEST_PASSWORD
): Promise<AdminSession> {
  // The login endpoint is exposed at /api/login (with an /api/auth/login alias
  // in some deployments) — probe both to stay resilient.
  let res = await request(app).post('/api/login').send({ username, password });
  if (res.status === 404) {
    res = await request(app).post('/api/auth/login').send({ username, password });
  }

  if (res.status !== 200) {
    throw new Error(`Test login failed (${res.status}): ${JSON.stringify(res.body).slice(0, 300)}`);
  }

  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) {
    throw new Error('Test login succeeded but no Set-Cookie header was returned');
  }

  const cookie = raw.split(';')[0];
  let csrfToken = '';
  try {
    const jwtRaw = cookie.replace(/^auth_token=/, '');
    const payload = jwt.decode(jwtRaw) as any;
    csrfToken = payload?.csrfToken || '';
  } catch {
    // token decode failure will surface later on guarded routes
  }

  return { cookie, csrfToken };
}

/**
 * Convenience: ensures admin user + performs HTTP login once and caches session.
 */
let cachedAdminSession: AdminSession | null = null;
export async function getAdminCookie(): Promise<string> {
  return (await getAdminSession()).cookie;
}

export async function getAdminSession(): Promise<AdminSession> {
  if (cachedAdminSession) {
    let cachedId: number | undefined;
    try {
      const jwtRaw = cachedAdminSession.cookie.replace(/^auth_token=/, '').split(';')[0];
      const decoded = jwt.decode(jwtRaw) as any;
      cachedId = Number(decoded?.id);
    } catch {
      // ignore decode failure
    }

    const [live] = await orm
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.username, 'pen_admin'), eq(users.isDeleted, 0)));
    if (live && cachedId && live.id === cachedId) {
      return cachedAdminSession;
    }
    cachedAdminSession = null;
  }
  const app = await getTestApp();
  await ensureAdminTestUser();
  cachedAdminSession = await loginTestUserWithSession(app, 'pen_admin');
  return cachedAdminSession;
}

/** Removes all users created by the penetration/critical suites */
export async function cleanupHttpTestUsers(): Promise<void> {
  cachedAdminSession = null;
  invalidateUserAuthCache();
  try {
    await orm.delete(users).where(like(users.username, 'pen_admin%'));
  } catch {
    // ignore
  }
}
