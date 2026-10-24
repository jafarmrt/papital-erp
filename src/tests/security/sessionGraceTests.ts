import { TEST_PASSWORD } from '../fixtures/factories.js';
import { loginTestUserWithSession } from '../fixtures/httpTestHelper.js';
import { invalidateUserAuthCache } from '../../middleware/auth.js';
import { clearTokenVersionGraceForTests } from '../../services/auth/tokenVersionGrace.js';
import { TestCaseResult } from '../types.js';
import { runCase, type Harness, type Session, type ShouldRun } from './workflowTestHarness.js';

/**
 * 10.3 package 5 (10.2 backlog, review of #324): «بستن دستگاه‌های دیگر» and a password change raise the token version
 * and reissue this device's cookie, but a request the same device sent a moment before still carried the previous
 * token and got 401, which signed out the very device that made the change. The previous token of that one device is
 * now accepted for a minute; every other device stays refused at once, and once the minute is over (here: the grace
 * cleared) the previous token is refused too. Red on v10.3.19, where the previous token got 401 at once.
 */

function cookieOf(setCookie: unknown, fallbackCsrf: string): Session | null {
  const all = Array.isArray(setCookie) ? setCookie.map(String) : setCookie ? [String(setCookie)] : [];
  const raw = all.find(c => c.startsWith('auth_token='));
  return raw ? { cookie: raw.split(';')[0], csrfToken: fallbackCsrf } : null;
}

async function signedIn(h: Harness, s: Session): Promise<boolean> {
  const me = await h.get('/api/auth/me', s);
  return me.status === 200 && me.body?.authenticated === true;
}

async function usernameOf(h: Harness, userId: number): Promise<string> {
  return String((await h.q('SELECT username FROM users WHERE id = $1', [userId]))[0]?.username);
}

export async function runSessionGraceTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_close_others_keeps_this_device_10_3_package5', 'security', 'sessions', 'grace', 'package5')) {
    await runCase(results, {
      id: 'sec_close_others_keeps_this_device_10_3_package5',
      name: 'v10.3.20: after close-other-devices a request this device sent with its previous token still passes, other devices are refused (10.3 package 5)',
      details: 'POST /auth/sessions/close-others reissues this device\'s cookie; a GET and a write with the previous cookie of the same device answer 200 inside the grace, another device of the user gets 401, and after the grace the previous cookie gets 401 while the reissued one stays signed in',
    }, async (h, wrong) => {
      clearTokenVersionGraceForTests();
      const user = await h.sessionWith(['daily_logs.view']);
      const desk = await loginTestUserWithSession(h.app as Parameters<typeof loginTestUserWithSession>[0], await usernameOf(h, user.userId));
      const closed = await h.post('/api/auth/sessions/close-others', {}, desk);
      if (closed.status !== 200) throw new Error(`close-others returned ${closed.status}`);
      const reissued = cookieOf(closed.headers['set-cookie'], String(closed.body?.csrfToken ?? desk.csrfToken));
      if (!reissued) throw new Error('close-others set no new cookie');

      if (!(await signedIn(h, desk))) wrong.push('a request with this device\'s previous token got 401 right after close-others');
      const write = await h.put('/api/users/profile', { full_name: `grace ${h.tag}` }, desk);
      if (write.status !== 200) wrong.push(`a write with this device's previous token returned ${write.status}, not 200`);
      if (await signedIn(h, user)) wrong.push('another device of the user stayed signed in after close-others');
      if (!(await signedIn(h, reissued))) wrong.push('the reissued cookie is not signed in');

      clearTokenVersionGraceForTests();
      if (await signedIn(h, desk)) wrong.push('the previous token still passes after the grace');
      if (!(await signedIn(h, reissued))) wrong.push('the reissued cookie lost its session after the grace');
    });
  }

  if (shouldRun('sec_password_change_keeps_this_device_10_3_package5', 'security', 'sessions', 'grace', 'password', 'package5')) {
    await runCase(results, {
      id: 'sec_password_change_keeps_this_device_10_3_package5',
      name: 'v10.3.20: after one\'s own password change a request this device sent with its previous token still passes, other devices are refused (10.3 package 5)',
      details: 'PUT /users/profile with a new password reissues this device\'s cookie; the previous cookie of the same device answers 200 inside the grace, another login of the user gets 401 at once, a later raise of the token version (a role change) ends the grace, and without a raise the grace ends after its minute',
    }, async (h, wrong) => {
      clearTokenVersionGraceForTests();
      const member = await h.sessionWith(['documents.view']);
      const username = await usernameOf(h, member.userId);
      const other = await loginTestUserWithSession(h.app as Parameters<typeof loginTestUserWithSession>[0], username);
      const changed = await h.put('/api/users/profile', { current_password: TEST_PASSWORD, new_password: 'N3w-passw0rd' }, member);
      if (changed.status !== 200) throw new Error(`changing the password returned ${changed.status}`);
      const fresh = cookieOf(changed.headers['set-cookie'], String(changed.body?.csrfToken ?? member.csrfToken));
      if (!fresh) throw new Error('the password change set no new cookie');

      if (!(await signedIn(h, member))) wrong.push('a request with this device\'s previous token got 401 right after the password change');
      if (await signedIn(h, other)) wrong.push('another login of the user stayed signed in after the password change');
      if (!(await signedIn(h, fresh))) wrong.push('the new cookie is not signed in');

      clearTokenVersionGraceForTests();
      if (await signedIn(h, member)) wrong.push('the previous token still passes after the grace');

      // a later raise ends the grace at once (a role change raises the version and leaves the session row open)
      const again = await h.put('/api/users/profile', { current_password: 'N3w-passw0rd', new_password: 'N3w-passw0rd-2' }, fresh);
      if (again.status !== 200) throw new Error(`the second password change returned ${again.status}`);
      if (!(await signedIn(h, fresh))) wrong.push('the previous token was refused right after the second change');
      await h.q('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [member.userId]);
      invalidateUserAuthCache(member.userId);
      if (await signedIn(h, fresh)) wrong.push('the previous token still passes after a later raise of the token version');
    });
  }

  return results;
}
