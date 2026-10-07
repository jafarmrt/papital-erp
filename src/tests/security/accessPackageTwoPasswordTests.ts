import { TestCaseResult } from '../types.js';
import { runCase, type ShouldRun } from './workflowTestHarness.js';
import { TEST_PASSWORD } from '../fixtures/factories.js';
import { PASSWORD_TOO_SHORT_MESSAGE } from '../../lib/auth/passwordPolicy.js';

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
      name: 'v9.0.159: every route that sets a password asks the same eight characters (TD-532)',
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

  return results;
}
