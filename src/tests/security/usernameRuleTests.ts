import request from 'supertest';
import bcrypt from 'bcryptjs';
import { TestCaseResult } from '../types.js';
import { runCase, type ShouldRun } from './workflowTestHarness.js';
import { TEST_PASSWORD } from '../fixtures/factories.js';
import { USERNAME_FORMAT_INVALID } from '../../lib/users/usernameRules.js';
import { USERNAME_OF_DELETED_USER } from '../../lib/users/userRestore.js';

/**
 * OBS-R1-30 (product-owner decision ت۴۰ item 8): a new username is 3 to 50 Latin letters, digits, «.», «_» or «-» and is
 * unique regardless of letter case; old usernames still log in. Red on the previous code, which took «Ali» beside «ali»
 * and any text of three characters.
 */

const PERSIAN_USERNAME = 'علی_رضایی';

export async function runUsernameRuleTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  if (!shouldRun('sec_username_case_and_format_obs_r1_30', 'security', 'obs_r1_30', 'username', 'users')) return results;

  await runCase(results, {
    id: 'sec_username_case_and_format_obs_r1_30',
    name: 'OBS-R1-30: a new username is unique regardless of letter case and takes only Latin letters, digits, . _ -',
    details: 'POST /users refuses a username that differs from another (live or deleted) only in letter case or spaces, and one that breaks the format with 422 USERNAME_FORMAT_INVALID; the database index uq_users_username_key refuses a direct duplicate; a legacy username outside the format still logs in',
  }, async (h, wrong) => {
    const member = await h.sessionWith(['documents.view']);
    const base = `Obs130_${h.tag}`;
    const legacy = `legacy user ${h.tag}`;
    const made: string[] = [];
    const create = (username: string) => h.post('/api/users', { username, password: 'Passw0rd!x', full_name: 'obs130', role: member.role });
    try {
      const first = await create(base);
      if (first.status !== 200) throw new Error(`creating ${base} returned ${first.status} ${JSON.stringify(first.body)}`);
      made.push(base);

      for (const variant of [base.toLowerCase(), base.toUpperCase(), ` ${base.toLowerCase()} `]) {
        const res = await create(variant);
        if (res.status === 200) made.push(variant.trim());
        if (res.status !== 400) wrong.push(`«${variant}» beside «${base}» returned ${res.status}, not 400 taken`);
      }

      for (const bad of [PERSIAN_USERNAME, 'ali rezaei', 'ali@shop', 'a'.repeat(51)]) {
        const res = await create(bad);
        if (res.status === 200) made.push(bad);
        if (res.status !== 422 || res.body?.code !== USERNAME_FORMAT_INVALID) {
          wrong.push(`«${bad.slice(0, 20)}» returned ${res.status} ${res.body?.code ?? ''}, not 422 ${USERNAME_FORMAT_INVALID}`);
        }
      }
      const good = `a.b-c_${h.tag}`;
      const goodRes = await create(good);
      if (goodRes.status === 200) made.push(good); else wrong.push(`«${good}» returned ${goodRes.status}`);

      // a deleted user's username in another letter case is still that deleted user's (TD-519)
      const [{ id }] = await h.q('SELECT id FROM users WHERE username = $1', [base]);
      const removed = await h.del(`/api/users/${id}`);
      if (removed.status !== 200) throw new Error(`deleting ${base} returned ${removed.status}`);
      const reuse = await create(base.toLowerCase());
      if (reuse.status === 200) made.push(base.toLowerCase());
      if (reuse.status !== 409 || reuse.body?.code !== USERNAME_OF_DELETED_USER) {
        wrong.push(`«${base.toLowerCase()}» beside the deleted «${base}» returned ${reuse.status} ${reuse.body?.code ?? ''}, not 409 ${USERNAME_OF_DELETED_USER}`);
      }

      // the database refuses a direct case duplicate
      const direct = await h.q('INSERT INTO users (username, password, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id',
        [base.toUpperCase(), 'x', 'obs130', member.role]).then(() => 'inserted', (err: unknown) => String((err as { code?: string }).code ?? err));
      if (direct === 'inserted') { made.push(base.toUpperCase()); wrong.push('a direct insert of a case duplicate was accepted'); }
      else if (direct !== '23505') wrong.push(`a direct insert of a case duplicate failed with ${direct}, not 23505`);

      // an old username outside the format keeps logging in
      await h.q('INSERT INTO users (username, password, full_name, role) VALUES ($1, $2, $3, $4)',
        [legacy, await bcrypt.hash(TEST_PASSWORD, 4), 'obs130 legacy', member.role]);
      made.push(legacy);
      const { resetLoginRateLimiter } = await import('../../app.js');
      resetLoginRateLimiter();
      const login = await request(h.app as Parameters<typeof request>[0]).post('/api/auth/login')
        .set('X-Forwarded-For', '198.51.100.130').send({ username: legacy, password: TEST_PASSWORD });
      if (login.status !== 200) wrong.push(`the legacy username «${legacy}» could not log in: ${login.status}`);
    } finally {
      if (made.length) await h.q('DELETE FROM users WHERE username = ANY($1::text[])', [made]).catch(() => undefined);
    }
  });
  return results;
}
