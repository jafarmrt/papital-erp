import { TestCaseResult } from '../types.js';
import { runCase, type ShouldRun } from './workflowTestHarness.js';

/**
 * v10.0.52 (series 10 phase 3, L5 E6; TD-962, OBS-R1-31, Jafar 10-09 18:43 item 7): `users.role` had no foreign key,
 * so a user row could hold a role code that no role has, and deleting a role left its soft-deleted users pointing to
 * a missing role. Now the column references `roles.code` (ON UPDATE CASCADE), only a soft-deleted user may hold no
 * role, and a role delete clears the role of its soft-deleted users in the delete transaction.
 * On v10.0.51 the orphan insert succeeds and the deleted user keeps the deleted role's code.
 */
export async function runRoleForeignKeyTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_user_role_foreign_key_td_962', 'security', 'td962', 'roles', 'package2')) {
    await runCase(results, {
      id: 'sec_user_role_foreign_key_td_962',
      name: 'v10.0.52: users.role references roles.code; a role delete clears its deleted users (TD-962)',
      details: 'a user row with a missing role code or an active user without a role is refused; deleting a role whose only user is soft-deleted leaves that user without a role',
    }, async (h, wrong) => {
      const code = `td962r${h.tag}`;
      const orphanCode = `td962missing${h.tag}`;
      const insertUser = (username: string, role: string | null, isDeleted: number) => h.q(
        `INSERT INTO users (username, password, full_name, role, is_deleted) VALUES ($1, 'x', $1, $2, $3) RETURNING id`,
        [username, role, isDeleted],
      );
      try {
        try {
          await insertUser(`td962orphan${h.tag}`, orphanCode, 0);
          wrong.push('a user row with a role code no role has was stored');
        } catch (err) {
          if ((err as { code?: string }).code !== '23503') wrong.push(`orphan role insert failed with ${String((err as { code?: string }).code)}, expected 23503`);
        }
        try {
          await insertUser(`td962norole${h.tag}`, null, 0);
          wrong.push('an active user without a role was stored');
        } catch (err) {
          const c = (err as { code?: string }).code;
          if (c !== '23514' && c !== '23502') wrong.push(`active user without a role failed with ${String(c)}`);
        }

        const created = await h.post('/api/roles', { name: `نقش ${code}`, code, permissions: ['products.view'] });
        if (created.status !== 200) throw new Error(`creating the role answered ${created.status}`);
        const roleId = (created.body as { id: number }).id;
        const [gone] = await insertUser(`td962gone${h.tag}`, code, 1);

        const deleted = await h.del(`/api/roles/${roleId}`);
        if (deleted.status !== 200) wrong.push(`deleting a role whose only user is soft-deleted answered ${deleted.status}`);
        const [after] = await h.q('SELECT role FROM users WHERE id = $1', [gone?.id]);
        if (after?.role !== null) wrong.push(`the soft-deleted user still holds role «${String(after?.role)}» after its role was deleted`);
        const [audit] = await h.q(
          `SELECT details FROM activity_logs WHERE action = 'DELETE' AND entity_id = $1 ORDER BY id DESC LIMIT 1`, [String(roleId)],
        );
        const cleared = (audit?.details as { clearedDeletedUserIds?: number[] } | undefined)?.clearedDeletedUserIds ?? [];
        if (!cleared.includes(Number(gone?.id))) wrong.push('the role delete audit row does not name the soft-deleted user whose role was cleared');
      } finally {
        await h.q(`DELETE FROM users WHERE username LIKE $1`, [`td962%${h.tag}`]);
        await h.q('DELETE FROM roles WHERE code = $1', [code]);
      }
    });
  }

  return results;
}
