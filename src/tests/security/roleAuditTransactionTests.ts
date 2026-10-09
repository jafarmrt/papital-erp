import { TestCaseResult } from '../types.js';
import { runCase, type ShouldRun } from './workflowTestHarness.js';

/**
 * v10.0.28 (series 10 phase 3, L5 E7; part of TD-960): the role routes wrote the role on the pool and logged its audit
 * row afterwards outside the write, swallowing an audit error, so a role could be created or deleted with no record.
 * A trigger refuses the audit rows of this test's roles: the create and the delete must fail and change nothing.
 * On v10.0.26 the role is created (200) and deleted (200) with no audit row.
 */
export async function runRoleAuditTransactionTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_role_write_with_audit_in_tx_td_960', 'security', 'td960', 'roles', 'audit', 'package2')) {
    await runCase(results, {
      id: 'sec_role_write_with_audit_in_tx_td_960',
      name: 'v10.0.28: a role create, edit or delete whose audit row fails changes nothing (TD-960)',
      details: 'roles are written with their audit row in one transaction: a refused audit row rolls back the role create, edit and delete',
    }, async (h, wrong) => {
      const blocked = `td960blk${h.tag}`;
      const allowed = `td960ok${h.tag}`;
      const fn = `td960_refuse_role_audit_${h.tag}`;
      await h.q(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.details::text LIKE '%${blocked}%' THEN RAISE EXCEPTION 'td960 refused audit row'; END IF; RETURN NEW; END $$`);
      await h.q(`CREATE TRIGGER ${fn} BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
      try {
        const created = await h.post('/api/roles', { name: `نقش ${blocked}`, code: blocked, permissions: ['products.view'] });
        if (created.status < 400) wrong.push(`role create with a refused audit row answered ${created.status}`);
        const blockedRows = await h.q('SELECT id FROM roles WHERE code = $1', [blocked]);
        if (blockedRows.length !== 0) wrong.push('the role was created without its audit row');

        const ok = await h.post('/api/roles', { name: `نقش ${allowed}`, code: allowed, permissions: ['products.view'] });
        if (ok.status !== 200) throw new Error(`creating the control role answered ${ok.status}`);
        const roleId = (ok.body as { id: number }).id;

        const edited = await h.put(`/api/roles/${roleId}`, { name: `نقش ${blocked}` });
        if (edited.status < 400) wrong.push(`role edit with a refused audit row answered ${edited.status}`);
        const [afterEdit] = await h.q('SELECT name FROM roles WHERE id = $1', [roleId]);
        if (afterEdit?.name !== `نقش ${allowed}`) wrong.push(`the role name changed to «${String(afterEdit?.name)}» without its audit row`);

        await h.q(`UPDATE roles SET name = $1 WHERE id = $2`, [`نقش ${blocked}`, roleId]);
        const deleted = await h.del(`/api/roles/${roleId}`);
        if (deleted.status < 400) wrong.push(`role delete with a refused audit row answered ${deleted.status}`);
        const left = await h.q('SELECT id FROM roles WHERE id = $1', [roleId]);
        if (left.length !== 1) wrong.push('the role was deleted without its audit row');
      } finally {
        await h.q(`DROP TRIGGER IF EXISTS ${fn} ON activity_logs`);
        await h.q(`DROP FUNCTION IF EXISTS ${fn}()`);
        await h.q('DELETE FROM roles WHERE code IN ($1, $2)', [blocked, allowed]);
      }
    });
  }

  return results;
}
