import request from 'supertest';
import { TestCaseResult } from '../types.js';
import { runCase, type ShouldRun } from './workflowTestHarness.js';
import { TEST_PASSWORD } from '../fixtures/factories.js';
import { loginTestUserWithSession } from '../fixtures/httpTestHelper.js';
import { PASSWORD_TOO_SHORT_MESSAGE } from '../../lib/auth/passwordPolicy.js';
import { PASSWORD_RESET_REQUIRED } from '../../lib/auth/passwordReset.js';
import { SYSTEM_ADMIN_ROLE } from '../../lib/permissions/permissionCatalog.js';
import { addressLockoutMessage, usernameLockoutMessage } from '../../lib/auth/loginLockout.js';

/**
 * بسته ۲ (مدل مجوز)، گروه رمز (تصمیم ت۵ الف): سیاست رمز از مسیرهای واقعی Express با ورود واقعی. هر آزمون روی کد پیشین
 * قرمز است.
 */

const messageOf = (res: { body?: { message?: unknown; error?: unknown } }): string => String(res.body?.message ?? res.body?.error ?? '');

export async function runAccessPackageTwoPasswordTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_password_min_length_td_532', 'security', 'td532', 'password', 'package2')) {
    await runCase(results, {
      id: 'sec_password_min_length_td_532',
      name: 'v9.0.217: every route that sets a password asks the same eight characters (TD-532)',
      details: 'B02-17: creating, editing and restoring a user took 6 characters while the profile and setup took 8; now a 7-character password is refused with one Persian message by POST /users, PUT /users/:id, POST /users/:id/restore and PUT /users/profile, and 8 characters pass',
    }, async (h, wrong) => {
      const seven = 'abc1234';
      const eight = 'abcd1234';
      const member = await h.sessionWith(['documents.view']);
      const username = `td532_${h.tag}`;
      let id = 0;
      const refused = (label: string, res: { status: number; body?: { message?: unknown; error?: unknown } }) => {
        if (res.status !== 400 || !messageOf(res).includes(PASSWORD_TOO_SHORT_MESSAGE)) {
          wrong.push(`${label} with a 7-character password returned ${res.status} «${messageOf(res)}», not 400 with the shared message`);
        }
      };
      try {
        refused('POST /users', await h.post('/api/users', { username: `${username}_short`, password: seven, full_name: 'td532', role: member.role }));
        const created = await h.post('/api/users', { username, password: eight, full_name: 'td532', role: member.role });
        if (created.status !== 200) throw new Error(`creating the user with 8 characters returned ${created.status}`);
        id = Number(created.body?.id ?? (await h.q('SELECT id FROM users WHERE username = $1', [username]))[0]?.id);
        refused('PUT /users/:id', await h.put(`/api/users/${id}`, { password: seven, full_name: 'td532', role: member.role }));
        const edited = await h.put(`/api/users/${id}`, { password: eight, full_name: 'td532', role: member.role });
        if (edited.status !== 200) wrong.push(`PUT /users/:id with 8 characters returned ${edited.status}`);

        const removed = await h.del(`/api/users/${id}`);
        if (removed.status !== 200) throw new Error(`deleting the user returned ${removed.status}`);
        refused('POST /users/:id/restore', await h.post(`/api/users/${id}/restore`, { role: member.role, password: seven }));
        const restored = await h.post(`/api/users/${id}/restore`, { role: member.role, password: eight });
        if (restored.status !== 200) wrong.push(`POST /users/:id/restore with 8 characters returned ${restored.status}`);

        refused('PUT /users/profile', await h.put('/api/users/profile', { current_password: TEST_PASSWORD, new_password: seven }, member));
      } finally {
        await h.q('DELETE FROM users WHERE username IN ($1, $2)', [username, `${username}_short`]).catch(() => undefined);
      }
    });
  }

  if (shouldRun('sec_own_password_change_keeps_session_td_531', 'security', 'td531', 'password', 'package2')) {
    await runCase(results, {
      id: 'sec_own_password_change_keeps_session_td_531',
      name: 'v9.0.218: changing one\'s own password keeps this session and ends the others (TD-531)',
      details: 'B02-16 (R11): PUT /users/profile raised the token version without a new cookie, so after the success message the same session got 401; now the response sets a cookie with the new version, GET /auth/me answers 200 with it, and another session of the same user and the old cookie get 401',
    }, async (h, wrong) => {
      const member = await h.sessionWith(['documents.view']);
      const [row] = await h.q('SELECT username FROM users WHERE id = $1', [member.userId]);
      const other = await loginTestUserWithSession(h.app as Parameters<typeof loginTestUserWithSession>[0], String(row?.username));

      const changed = await h.put('/api/users/profile', { current_password: TEST_PASSWORD, new_password: 'N3w-passw0rd' }, member);
      if (changed.status !== 200) throw new Error(`changing the password returned ${changed.status}`);
      const setCookie = changed.headers['set-cookie'] as unknown as string[] | string | undefined;
      const raw = Array.isArray(setCookie) ? setCookie.find(c => c.startsWith('auth_token=')) : setCookie;
      if (!raw) {
        wrong.push('the password change set no new session cookie');
      } else {
        const fresh = { cookie: raw.split(';')[0], csrfToken: String(changed.body?.csrfToken ?? member.csrfToken) };
        const me = await h.get('/api/auth/me', fresh);
        if (me.status !== 200) wrong.push(`GET /auth/me with the new cookie returned ${me.status}`);
        const write = await h.put('/api/users/profile', { full_name: 'td531' }, fresh);
        if (write.status !== 200) wrong.push(`a write with the new cookie returned ${write.status}`);
      }
      if ((await h.get('/api/auth/me', member)).status !== 401) wrong.push('the old cookie of this session still works');
      if ((await h.get('/api/auth/me', other)).status !== 401) wrong.push('another session of the user still works after the password change');
    });
  }

  if (shouldRun('sec_temporary_password_must_change_td_523', 'security', 'td523', 'password', 'package2')) {
    await runCase(results, {
      id: 'sec_temporary_password_must_change_td_523',
      name: 'v9.0.219: a password an administrator set must be changed before anything else (TD-523)',
      details: 'B02-08: the server never read must_reset_password and a password set by an administrator cleared it; now creating a user or resetting another user\'s password sets it, every request except /auth/me, /users/profile, /users/my-permissions, /csrf and /logout gets 403 PASSWORD_RESET_REQUIRED until the user changes the password, and a password set for one\'s own account is not temporary',
    }, async (h, wrong) => {
      const member = await h.sessionWith(['documents.view']);
      const username = `td523_${h.tag}`;
      const adminUsername = `td523a_${h.tag}`;
      const temporary = 'Tempor4ry!';
      const flagOf = async (userId: number) => Number((await h.q('SELECT must_reset_password FROM users WHERE id = $1', [userId]))[0]?.must_reset_password);
      try {
        const created = await h.post('/api/users', { username, password: temporary, full_name: 'td523', role: member.role });
        if (created.status !== 200) throw new Error(`creating the user returned ${created.status}`);
        const id = Number(created.body?.id);
        if (await flagOf(id) !== 1) wrong.push('a user created by an administrator does not have to change the password');

        const session = await loginTestUserWithSession(h.app as Parameters<typeof loginTestUserWithSession>[0], username, temporary);
        for (const url of ['/api/documents', '/api/users/list-simple']) {
          const res = await h.get(url, session);
          if (res.status !== 403 || res.body?.code !== PASSWORD_RESET_REQUIRED) {
            wrong.push(`GET ${url} with a temporary password returned ${res.status} ${String(res.body?.code ?? '')}, not 403 ${PASSWORD_RESET_REQUIRED}`);
          }
        }
        for (const url of ['/api/auth/me', '/api/users/my-permissions', '/api/csrf', '/api/users/profile']) {
          const res = await h.get(url, session);
          if (res.status !== 200) wrong.push(`GET ${url} with a temporary password returned ${res.status}, not 200`);
        }

        const changed = await h.put('/api/users/profile', { current_password: temporary, new_password: 'N3w-passw0rd' }, session);
        if (changed.status !== 200) throw new Error(`changing the temporary password returned ${changed.status}`);
        if (await flagOf(id) !== 0) wrong.push('changing the password left it temporary');
        const setCookie = changed.headers['set-cookie'] as unknown as string[] | string | undefined;
        const raw = Array.isArray(setCookie) ? setCookie.find(c => c.startsWith('auth_token=')) : setCookie;
        const fresh = raw ? { cookie: raw.split(';')[0], csrfToken: String(changed.body?.csrfToken ?? session.csrfToken) } : session;
        const opened = await h.get('/api/documents', fresh);
        if (opened.status !== 200) wrong.push(`GET /api/documents after the password change returned ${opened.status}`);

        const reset = await h.put(`/api/users/${id}`, { password: 'Reset-pass1', full_name: 'td523', role: member.role });
        if (reset.status !== 200) throw new Error(`resetting the password returned ${reset.status}`);
        if (await flagOf(id) !== 1) wrong.push('a password an administrator reset is not temporary');

        const manager = await h.sessionWith(['users.manage']);
        const own = await h.put(`/api/users/${manager.userId}`, { password: 'Own-pass12', full_name: 'td523 manager', role: manager.role }, manager);
        if (own.status !== 200) wrong.push(`setting one's own password through the user form returned ${own.status}`);
        else if (await flagOf(manager.userId) !== 0) wrong.push('a password set for one\'s own account became temporary');

        // the metrics guard and the build details of /health read the session themselves: a system admin with a
        // temporary password gets neither until the password is changed
        const adminCreated = await h.post('/api/users', { username: adminUsername, password: temporary, full_name: 'td523 admin', role: SYSTEM_ADMIN_ROLE });
        if (adminCreated.status !== 200) throw new Error(`creating the admin user returned ${adminCreated.status}`);
        const adminSession = await loginTestUserWithSession(h.app as Parameters<typeof loginTestUserWithSession>[0], adminUsername, temporary);
        const metrics = await h.get('/api/metrics', adminSession);
        if (metrics.status !== 403 || metrics.body?.code !== PASSWORD_RESET_REQUIRED) {
          wrong.push(`GET /api/metrics for an admin with a temporary password returned ${metrics.status} ${String(metrics.body?.code ?? '')}, not 403 ${PASSWORD_RESET_REQUIRED}`);
        }
        const health = await h.get('/api/health', adminSession);
        if (health.body?.buildInfo) wrong.push('GET /api/health showed the build details to an admin with a temporary password');
      } finally {
        await h.q('DELETE FROM users WHERE username = ANY($1::text[])', [[username, adminUsername]]).catch(() => undefined);
      }
    });
  }

  if (shouldRun('sec_login_lockout_answer_td_539', 'security', 'td539', 'password', 'package2')) {
    await runCase(results, {
      id: 'sec_login_lockout_answer_td_539',
      name: 'v9.0.220: every login lock answers locked and its minutes, with a Persian message (TD-539)',
      details: 'B02-24: the username lock said "1 minute" in Latin digits and the login limiter answered only a text with a fixed "15 minutes", so the login page read the minutes out of the text; now both 429 answers carry locked: true and remainingMinutes, and their messages name this user name or this device in Persian digits',
    }, async (h, wrong) => {
      const { resetLoginRateLimiter } = await import('../../app.js');
      const { resetPhantomLockouts } = await import('../../services/auth/loginSecurity.service.js');
      const attempt = (username: string, ip: string) => request(h.app as Parameters<typeof request>[0]).post('/api/auth/login')
        .set('X-Forwarded-For', ip).send({ username, password: 'definitely-wrong-pass' });
      resetLoginRateLimiter();
      resetPhantomLockouts();
      try {
        let pairLock: request.Response | null = null;
        for (let i = 0; i < 5; i++) pairLock = await attempt(`td539_ghost_${h.tag}`, '198.51.100.139');
        if (pairLock?.status !== 429 || pairLock.body?.locked !== true || pairLock.body?.remainingMinutes !== 1) {
          wrong.push(`the fifth failure for one user name answered ${pairLock?.status} ${JSON.stringify(pairLock?.body)}, not 429 locked for 1 minute`);
        } else if (pairLock.body?.error !== usernameLockoutMessage(1)) {
          wrong.push(`the user name lock says «${pairLock.body?.error}», not «${usernameLockoutMessage(1)}»`);
        }

        let addressLock: request.Response | null = null;
        for (let i = 0; i < 12 && addressLock === null; i++) {
          const res = await attempt(`td539_spray_${i}_${h.tag}`, '198.51.100.140');
          if (res.status === 429) addressLock = res;
        }
        const minutes = Number(addressLock?.body?.remainingMinutes);
        if (!addressLock || addressLock.body?.locked !== true || !(minutes >= 1 && minutes <= 15)) {
          wrong.push(`the login limiter answered ${addressLock?.status} ${JSON.stringify(addressLock?.body)}, not 429 locked with the minutes left`);
        } else if (addressLock.body?.error !== addressLockoutMessage(minutes)) {
          wrong.push(`the login limiter says «${addressLock.body?.error}», not «${addressLockoutMessage(minutes)}»`);
        }
      } finally {
        resetPhantomLockouts();
        resetLoginRateLimiter();
      }
    });
  }

  if (shouldRun('sec_profile_password_change_locked_td_961', 'security', 'td961', 'password', 'package2')) {
    await runCase(results, {
      id: 'sec_profile_password_change_locked_td_961',
      name: 'v10.0.21: wrong current passwords lock the profile password change progressively (TD-961)',
      details: 'OBS-R1-29: PUT /users/profile compared the current password without any attempt limit (only the general limiter of 10,000 requests a minute); now the fifth wrong current password locks the change for one minute with 429 PASSWORD_CHANGE_LOCKED, the right password is refused while locked, and another user is not affected',
    }, async (h, wrong) => {
      const { resetPhantomLockouts } = await import('../../services/auth/loginSecurity.service.js');
      const member = await h.sessionWith(['documents.view']);
      const other = await h.sessionWith(['documents.view']);
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 5; i++) {
          statuses.push((await h.put('/api/users/profile', { current_password: `wrong-${i}-pass`, new_password: 'N3w-passw0rd' }, member)).status);
        }
        if (statuses.slice(0, 4).some(s => s !== 400)) wrong.push(`the first four wrong current passwords returned ${statuses.slice(0, 4).join(', ')}, not 400`);
        if (statuses[4] !== 429) wrong.push(`the fifth wrong current password returned ${statuses[4]}, not 429`);
        const right = await h.put('/api/users/profile', { current_password: TEST_PASSWORD, new_password: 'N3w-passw0rd' }, member);
        const details = (right.body as { code?: unknown; details?: { locked?: unknown; remainingMinutes?: unknown } } | undefined);
        if (right.status !== 429 || details?.code !== 'PASSWORD_CHANGE_LOCKED') {
          wrong.push(`the right current password while locked returned ${right.status} ${String(details?.code ?? '')}, not 429 PASSWORD_CHANGE_LOCKED`);
        } else if (details?.details?.locked !== true || Number(details?.details?.remainingMinutes) < 1) {
          wrong.push('the lock answer does not carry locked and remainingMinutes');
        }
        const otherChange = await h.put('/api/users/profile', { current_password: TEST_PASSWORD, new_password: 'N3w-passw0rd' }, other);
        if (otherChange.status !== 200) wrong.push(`another user's password change returned ${otherChange.status}`);
      } finally {
        resetPhantomLockouts();
      }
    });
  }

  return results;
}
