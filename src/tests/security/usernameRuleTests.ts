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
    details: 'POST /users refuses a username that differs from another (live or deleted) only in letter case or spaces, and one that breaks the format with 422 USERNAME_FORMAT_INVALID; the partial index uq_users_username_key refuses a direct live duplicate; a deleted user is not restored beside a live case duplicate; a legacy live duplicate is listed and the index is built once one account is deleted; a legacy username outside the format still logs in',
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

      // the database refuses a direct case duplicate of a live user
      const insertUser = (username: string) => h.q('INSERT INTO users (username, password, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id',
        [username, 'x', 'obs130', member.role]).then((rows) => { made.push(username); return Number(rows[0]?.id); }, (err: unknown) => String((err as { code?: string }).code ?? err));
      const direct = await insertUser(base.toUpperCase());
      if (typeof direct === 'number') wrong.push('a direct insert of a live case duplicate was accepted');
      else if (direct !== '23505') wrong.push(`a direct insert of a case duplicate failed with ${direct}, not 23505`);

      // a deleted user's username in another letter case is still that deleted user's (TD-519)
      const [{ id }] = await h.q('SELECT id FROM users WHERE username = $1', [base]);
      const removed = await h.del(`/api/users/${id}`);
      if (removed.status !== 200) throw new Error(`deleting ${base} returned ${removed.status}`);
      const reuse = await create(base.toLowerCase());
      if (reuse.status === 200) made.push(base.toLowerCase());
      if (reuse.status !== 409 || reuse.body?.code !== USERNAME_OF_DELETED_USER) {
        wrong.push(`«${base.toLowerCase()}» beside the deleted «${base}» returned ${reuse.status} ${reuse.body?.code ?? ''}, not 409 ${USERNAME_OF_DELETED_USER}`);
      }

      // a deleted user does not come back while a live user holds its username in another letter case
      const holder = await insertUser(base.toUpperCase());
      if (typeof holder !== 'number') wrong.push(`a live user beside the deleted «${base}» could not be inserted: ${holder}`);
      const restore = await h.post(`/api/users/${id}/restore`, { role: member.role, password: 'Passw0rd!x' });
      if (restore.status !== 409 || restore.body?.code !== 'USERNAME_HELD_BY_LIVE_USER') {
        wrong.push(`restoring «${base}» beside the live «${base.toUpperCase()}» returned ${restore.status} ${restore.body?.code ?? ''}`);
      }

      // a legacy live duplicate is listed, blocks the index, and deleting one account lets the system admin build it.
      // #305 review: the index is dropped only inside an isolated schema, so other tests on this database never run
      // without it
      const { inFiscalSandbox, sandboxAdminClient } = await import('../regression/fiscalClosingTests.js');
      await inFiscalSandbox(async () => {
        const { orm, pool } = await import('../../db/drizzle.js');
        const admin = await sandboxAdminClient();
        await pool.query(`DO $$ BEGIN EXECUTE format('DROP INDEX IF EXISTS %I.uq_users_username_key', current_schema()); END $$`);
        const roleCode = String((await pool.query<{ code: string }>('SELECT code FROM roles ORDER BY id LIMIT 1')).rows[0]?.code ?? '');
        const sandboxUser = async (username: string) => Number((await pool.query<{ id: number }>(
          'INSERT INTO users (username, password, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id', [username, 'x', 'obs130', roleCode])).rows[0]?.id);
        const dupA = `dup130_${h.tag}`;
        const idA = await sandboxUser(dupA);
        const idB = await sandboxUser(dupA.toUpperCase());
        const { findCaseDuplicateUsernames, hasUsernameKeyUniqueIndex } = await import('../../services/users/usernameUniqueness.js');
        const listed = (await findCaseDuplicateUsernames(orm)).map(r => r.id);
        if (!listed.includes(idA) || !listed.includes(idB)) wrong.push(`the health check lists ${JSON.stringify(listed)}, not both duplicates`);
        const blocked = await admin.post('/api/system/conditional-constraints/build', { apply: true });
        if (JSON.stringify(blocked.body?.built ?? []).includes('uq_users_username_key')) wrong.push('the index was built over a live duplicate');
        const removedDup = await admin.del(`/api/users/${idB}`);
        if (removedDup.status !== 200) wrong.push(`deleting the duplicate returned ${removedDup.status}`);
        const built = await admin.post('/api/system/conditional-constraints/build', { apply: true });
        if (!JSON.stringify(built.body?.built ?? []).includes('uq_users_username_key') || !(await hasUsernameKeyUniqueIndex(orm))) {
          wrong.push(`after deleting one account the build answered ${JSON.stringify(built.body).slice(0, 200)}`);
        }
      });

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
