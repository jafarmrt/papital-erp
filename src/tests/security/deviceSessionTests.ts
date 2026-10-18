import { TestCaseResult } from '../types.js';
import { runCase, type Harness, type Row, type Session, type ShouldRun } from './workflowTestHarness.js';

/**
 * 10.2 package 8 (D-07, TD-1295): each login is a device row; a user sees their devices and closes one (a lost phone)
 * without signing out the others, «خروج» closes only this device, and a holder of `users.manage` closes another
 * user's devices under the account rules of TD-299 / TD-520, each close audited and refused on the device's very next
 * request.
 */

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const IPHONE_LABEL = 'آیفون، سافاری';
const WINDOWS_LABEL = 'رایانه ویندوز، کروم';
const AUTH_ENTITY = 'احراز هویت';
const USER_ENTITY = 'کاربران سیستم';

interface DeviceSession extends Session { userAgent?: string }

async function loginAs(h: Harness, username: string, userAgent: string): Promise<DeviceSession> {
  const request = (await import('supertest')).default;
  const jwt = (await import('jsonwebtoken')).default;
  const { TEST_PASSWORD } = await import('../fixtures/factories.js');
  const res = await request(h.app as Parameters<typeof request>[0]).post('/api/login').set('User-Agent', userAgent).send({ username, password: TEST_PASSWORD });
  if (res.status !== 200) throw new Error(`login returned ${res.status}`);
  return withCookie(res.headers['set-cookie'], userAgent, jwt);
}

function withCookie(setCookie: unknown, userAgent: string, jwt: { decode(token: string): unknown }): DeviceSession {
  const raw = Array.isArray(setCookie) ? String(setCookie[0]) : String(setCookie ?? '');
  const cookie = raw.split(';')[0];
  if (!cookie.startsWith('auth_token=')) throw new Error('no session cookie was set');
  const claims = jwt.decode(cookie.replace(/^auth_token=/, '')) as { csrfToken?: string } | null;
  return { cookie, csrfToken: claims?.csrfToken ?? '', userAgent };
}

async function call(h: Harness, method: 'get' | 'post' | 'delete', url: string, s: DeviceSession) {
  const request = (await import('supertest')).default;
  const agent = request(h.app as Parameters<typeof request>[0]);
  const req = (method === 'get' ? agent.get(url) : method === 'post' ? agent.post(url) : agent.delete(url))
    .set('Cookie', s.cookie).set('User-Agent', s.userAgent ?? 'erp-test');
  return method === 'get' ? req : req.set('x-csrf-token', s.csrfToken).send({});
}

async function signedIn(h: Harness, s: DeviceSession): Promise<boolean> {
  return (await call(h, 'get', '/api/auth/me', s)).body?.authenticated === true;
}

async function usernameOf(h: Harness, userId: number): Promise<string> {
  return String((await h.q('SELECT username FROM users WHERE id = $1', [userId]))[0]?.username);
}

async function auditRows(h: Harness, entity: string, entityId: number): Promise<Row[]> {
  return h.q(`SELECT details FROM activity_logs WHERE action = 'LOGOUT' AND entity = $1 AND entity_id = $2 ORDER BY id`, [entity, String(entityId)]);
}

export async function runDeviceSessionTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_own_device_sessions_d07_td_1295', 'security', 'td1295', 'd07', 'sessions', 'logout', 'package8')) {
    await runCase(results, {
      id: 'sec_own_device_sessions_d07_td_1295',
      name: 'v10.2.7: a user lists their signed-in devices and closes one lost phone; the other devices stay signed in (D-07, TD-1295)',
      details: 'GET /api/auth/sessions lists the phone and the desktop with a Persian device name and marks the current one; DELETE of the current device is 422 SESSION_IS_CURRENT and of another user\'s device 404; closing the phone refuses its very next request with 401 while the desktop stays; close-others ends every other device and reissues this one; each close writes a LOGOUT audit row',
    }, async (h, wrong) => {
      const user = await h.sessionWith(['daily_logs.view']);
      const other = await h.sessionWith(['daily_logs.view']);
      const username = await usernameOf(h, user.userId);
      const phone = await loginAs(h, username, IPHONE_UA);
      const desk = await loginAs(h, username, WINDOWS_UA);
      if (!(await signedIn(h, phone))) wrong.push('the phone was not signed in before the close');

      const listed = await call(h, 'get', '/api/auth/sessions', desk);
      const sessions = (listed.body?.sessions ?? []) as Array<{ id: number; deviceLabel: string; isCurrent: boolean }>;
      const phoneRow = sessions.find(s => s.deviceLabel === IPHONE_LABEL);
      const deskRow = sessions.find(s => s.deviceLabel === WINDOWS_LABEL);
      if (listed.status !== 200 || !phoneRow || !deskRow) {
        throw new Error(`the device list returned ${listed.status} without the phone and the desktop: ${JSON.stringify(sessions)}`);
      }
      if (!deskRow.isCurrent || phoneRow.isCurrent) wrong.push('the device list did not mark only the current device');

      const self = await call(h, 'delete', `/api/auth/sessions/${deskRow.id}`, desk);
      if (self.status !== 422 || self.body?.code !== 'SESSION_IS_CURRENT') wrong.push(`closing the current device returned ${self.status} ${self.body?.code}, not 422 SESSION_IS_CURRENT`);
      const otherList = await call(h, 'get', '/api/auth/sessions', { ...other, userAgent: WINDOWS_UA });
      const otherRow = ((otherList.body?.sessions ?? []) as Array<{ id: number }>)[0];
      if (otherRow) {
        const foreign = await call(h, 'delete', `/api/auth/sessions/${otherRow.id}`, desk);
        if (foreign.status !== 404) wrong.push(`closing another user's device from the profile returned ${foreign.status}, not 404`);
        if (!(await signedIn(h, { ...other, userAgent: WINDOWS_UA }))) wrong.push('another user\'s device was closed from someone else\'s profile');
      } else {
        wrong.push('the other user had no listed device');
      }

      const closed = await call(h, 'delete', `/api/auth/sessions/${phoneRow.id}`, desk);
      if (closed.status !== 200) wrong.push(`closing the phone returned ${closed.status}, not 200`);
      const phoneAfter = await call(h, 'get', '/api/daily-logs', phone);
      if (phoneAfter.status !== 401) wrong.push(`the closed phone's next request returned ${phoneAfter.status}, not 401`);
      if (!(await signedIn(h, desk))) wrong.push('closing the phone also signed out the desktop');
      const audits = await auditRows(h, AUTH_ENTITY, user.userId);
      if (!audits.some(a => Number((a.details as Row | null)?.sessionId) === phoneRow.id)) wrong.push('closing the phone wrote no LOGOUT audit row naming its session');

      const third = await loginAs(h, username, ANDROID_UA);
      const others = await call(h, 'post', '/api/auth/sessions/close-others', desk);
      if (others.status !== 200 || Number(others.body?.closedCount) < 2) wrong.push(`close-others returned ${others.status} closing ${others.body?.closedCount}, not 200 closing the other devices`);
      if (await signedIn(h, third)) wrong.push('close-others left another device signed in');
      if (await signedIn(h, user)) wrong.push('close-others left the first login signed in');
      const jwt = (await import('jsonwebtoken')).default;
      const reissued = withCookie(others.headers['set-cookie'], WINDOWS_UA, jwt);
      if (!(await signedIn(h, reissued))) wrong.push('close-others did not keep this device signed in with its reissued token');
      const after = await call(h, 'get', '/api/auth/sessions', reissued);
      const left = (after.body?.sessions ?? []) as Array<{ isCurrent: boolean }>;
      if (left.length !== 1 || !left[0].isCurrent) wrong.push(`after close-others the list holds ${left.length} devices, not only the current one`);
    });
  }

  if (shouldRun('sec_admin_device_sessions_d07_td_1295', 'security', 'td1295', 'd07', 'sessions', 'users', 'package8')) {
    await runCase(results, {
      id: 'sec_admin_device_sessions_d07_td_1295',
      name: 'v10.2.7: a users.manage holder closes a worker\'s lost phone or every device, only for accounts they may manage, audited (D-07, TD-1295)',
      details: 'GET/DELETE/POST /api/users/:id/sessions need users.manage (403 without), refuse an account whose role holds a key the manager lacks and an admin account for a non-admin (403); a closed device is refused on its next request, the worker\'s other device stays, close-all ends every device; each close writes a LOGOUT audit row under the user entity',
    }, async (h, wrong) => {
      const manager = await h.sessionWith(['users.manage', 'daily_logs.view']);
      const worker = await h.sessionWith(['daily_logs.view']);
      const senior = await h.sessionWith(['documents.view']);
      const plain = await h.sessionWith(['daily_logs.view']);
      const managerDevice = { ...manager, userAgent: WINDOWS_UA };
      const workerName = await usernameOf(h, worker.userId);
      const phone = await loginAs(h, workerName, IPHONE_UA);
      const desk = await loginAs(h, workerName, WINDOWS_UA);

      const denied = await call(h, 'get', `/api/users/${worker.userId}/sessions`, { ...plain, userAgent: WINDOWS_UA });
      if (denied.status !== 403) wrong.push(`listing another user's devices without users.manage returned ${denied.status}, not 403`);
      for (const [label, target] of [['a senior account', senior.userId], ['the admin account', Number((await h.q(`SELECT id FROM users WHERE username = 'pen_admin' AND is_deleted = 0`))[0]?.id)]] as const) {
        const read = await call(h, 'get', `/api/users/${target}/sessions`, managerDevice);
        const closeAll = await call(h, 'post', `/api/users/${target}/sessions/close-all`, managerDevice);
        if (read.status !== 403 || closeAll.status !== 403) wrong.push(`the manager reached the devices of ${label}: list ${read.status}, close-all ${closeAll.status}`);
      }
      if (!(await signedIn(h, { ...senior, userAgent: WINDOWS_UA }))) wrong.push('a refused close-all still signed the senior account out');

      const listed = await call(h, 'get', `/api/users/${worker.userId}/sessions`, managerDevice);
      const rows = (listed.body?.sessions ?? []) as Array<{ id: number; deviceLabel: string; isCurrent: boolean }>;
      const phoneRow = rows.find(r => r.deviceLabel === IPHONE_LABEL);
      if (listed.status !== 200 || !phoneRow) throw new Error(`the manager's list returned ${listed.status} without the worker's phone`);
      if (rows.some(r => r.isCurrent)) wrong.push('another user\'s device list marked a current device');

      const closed = await call(h, 'delete', `/api/users/${worker.userId}/sessions/${phoneRow.id}`, managerDevice);
      if (closed.status !== 200) wrong.push(`closing the worker's phone returned ${closed.status}, not 200`);
      if ((await call(h, 'get', '/api/daily-logs', phone)).status !== 401) wrong.push('the worker\'s closed phone was not refused on its next request');
      if (!(await signedIn(h, desk))) wrong.push('closing the worker\'s phone also signed out their desktop');
      const again = await call(h, 'delete', `/api/users/${worker.userId}/sessions/${phoneRow.id}`, managerDevice);
      if (again.status !== 404) wrong.push(`closing the already closed phone returned ${again.status}, not 404`);

      const all = await call(h, 'post', `/api/users/${worker.userId}/sessions/close-all`, managerDevice);
      if (all.status !== 200) wrong.push(`close-all returned ${all.status}, not 200`);
      if (await signedIn(h, desk) || await signedIn(h, worker)) wrong.push('close-all left a worker device signed in');
      const audits = await auditRows(h, USER_ENTITY, worker.userId);
      if (!audits.some(a => Number((a.details as Row | null)?.sessionId) === phoneRow.id)) wrong.push('closing the worker\'s phone wrote no audit row naming its session');
      if (!audits.some(a => (a.details as Row | null)?.closedCount !== undefined)) wrong.push('close-all wrote no audit row');
    });
  }

  if (shouldRun('sec_legacy_token_session_d07_td_1295', 'security', 'td1295', 'd07', 'sessions', 'package8')) {
    await runCase(results, {
      id: 'sec_legacy_token_session_d07_td_1295',
      name: 'v10.2.7: a token issued before device sessions keeps working, shows in the device list and can be closed (D-07, TD-1295)',
      details: 'a token without sid is adopted as a session row on its first request (no new sign-in), appears in the user\'s list, and once closed from another device is refused with 401; a token whose sid has no row is refused',
    }, async (h, wrong) => {
      const { generateToken } = await import('../../middleware/auth.js');
      const user = await h.sessionWith(['daily_logs.view']);
      const [row] = await h.q('SELECT username, role, token_version FROM users WHERE id = $1', [user.userId]);
      const legacyToken = generateToken({ id: user.userId, username: String(row.username), role: String(row.role), csrfToken: `legacy-${h.tag}`, tokenVersion: Number(row.token_version ?? 0) });
      const legacy: DeviceSession = { cookie: `auth_token=${legacyToken}`, csrfToken: `legacy-${h.tag}`, userAgent: ANDROID_UA };
      if (!(await signedIn(h, legacy))) throw new Error('a token without sid was refused instead of adopted');
      const desk = await loginAs(h, String(row.username), WINDOWS_UA);
      const listed = await call(h, 'get', '/api/auth/sessions', desk);
      const legacyRow = ((listed.body?.sessions ?? []) as Array<{ id: number; deviceLabel: string }>).find(s => s.deviceLabel === 'گوشی اندروید، کروم');
      if (!legacyRow) throw new Error('the adopted old token is not in the device list');
      const closed = await call(h, 'delete', `/api/auth/sessions/${legacyRow.id}`, desk);
      if (closed.status !== 200) wrong.push(`closing the old token's device returned ${closed.status}`);
      if (await signedIn(h, legacy)) wrong.push('the closed old token still signs in');

      const forged = generateToken({ id: user.userId, username: String(row.username), role: String(row.role), csrfToken: 'x', tokenVersion: Number(row.token_version ?? 0), sid: `missing-${h.tag}` });
      if (await signedIn(h, { cookie: `auth_token=${forged}`, csrfToken: 'x', userAgent: WINDOWS_UA })) wrong.push('a token whose sid has no session row signed in');
    });
  }

  return results;
}
