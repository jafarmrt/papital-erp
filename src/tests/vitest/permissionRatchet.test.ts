/**
 * v9.0.83 (TD-881, permission model §4.5): two ratchets over production code in `src`, against
 * permission-ratchet-baseline.json. No file gains a role-code literal (only SYSTEM_ADMIN_ROLE in the catalog names a
 * role), every permission-shaped literal is a catalog key and every catalog key is checked by server code; the known
 * exceptions may only shrink.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  BASELINE_FILE,
  CATALOG_FILE,
  catalogUsage,
  compareWithBaseline,
  countRoleCodeLiterals,
  currentState,
  literalsOfSource,
  type PermissionBaseline,
} from '../../../scripts/permission-ratchet';

const empty: PermissionBaseline = { roleCodeLiteralsByFile: {}, uncataloguedPermissionKeys: [], uncheckedCatalogKeys: [] };

describe('role-code literal ratchet (TD-881)', () => {
  it('counts role codes in comparisons, arrays and JSX but not in comments, and allows only SYSTEM_ADMIN_ROLE in the catalog', () => {
    const route = literalsOfSource('src/routes/x.routes.ts', `
      // authorize('manager') in a comment does not count
      const ok = user.role === 'manager' || ['admin', 'viewer'].includes(user.role);
      const key = 'workflow.admin';
    `);
    const page = literalsOfSource('src/pages/X.tsx', 'export const X = () => <option value="accountant">حسابدار</option>;');
    const catalog = literalsOfSource(CATALOG_FILE, "export const SYSTEM_ADMIN_ROLE = 'admin';\nconst other = 'admin';");
    expect(countRoleCodeLiterals([...route, ...page, ...catalog])).toEqual({
      [CATALOG_FILE]: 1,
      'src/pages/X.tsx': 1,
      'src/routes/x.routes.ts': 3,
    });
  });

  it('rejects a new file or a grown count, and reports a shrunk count as a stale baseline', () => {
    const baseline = { ...empty, roleCodeLiteralsByFile: { 'src/a.ts': 2 } };
    expect(compareWithBaseline({ ...empty, roleCodeLiteralsByFile: { 'src/a.ts': 2, 'src/new.ts': 1 } }, baseline).errors).toHaveLength(1);
    expect(compareWithBaseline({ ...empty, roleCodeLiteralsByFile: { 'src/a.ts': 3 } }, baseline).errors).toHaveLength(1);
    const lower = compareWithBaseline({ ...empty, roleCodeLiteralsByFile: { 'src/a.ts': 1 } }, baseline);
    expect(lower.errors).toEqual([]);
    expect(lower.stale).toHaveLength(1);
  });
});

describe('permission catalog usage ratchet (TD-881)', () => {
  it('flags a mistyped key, ignores event names, and counts a key checked only by the UI or the seed as unchecked', () => {
    const literals = [
      ...literalsOfSource('src/routes/a.routes.ts', "authorizePermission('customers.view', 'customers.mange'); emit('inventory.stock_in');"),
      ...literalsOfSource('src/pages/A.tsx', "useHasPermission('customers.manage');"),
      ...literalsOfSource('src/db/seed.ts', "const perms = ['crm.view'];"),
    ];
    const usage = catalogUsage(literals, ['customers.view', 'customers.manage', 'crm.view']);
    expect(usage.uncatalogued).toEqual(['customers.mange']);
    expect(usage.unchecked).toEqual(['crm.view', 'customers.manage']);
  });

  it('rejects a new exception and reports a fixed one as a stale baseline', () => {
    const baseline = { ...empty, uncheckedCatalogKeys: ['audit.apply'] };
    expect(compareWithBaseline({ ...empty, uncheckedCatalogKeys: ['audit.apply', 'crm.view'] }, baseline).errors).toEqual([
      'crm.view is in the permission catalog but no server code checks it',
    ]);
    expect(compareWithBaseline(empty, baseline).stale).toHaveLength(1);
  });
});

describe('repository state (TD-881)', () => {
  it('matches permission-ratchet-baseline.json exactly: nothing grew and the baseline is not stale', () => {
    const baseline = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), BASELINE_FILE), 'utf8')) as PermissionBaseline;
    const { errors, stale } = compareWithBaseline(currentState(), baseline);
    expect(errors).toEqual([]);
    expect(stale, 'run `npm run ratchet:permissions -- --update` and commit the lower baseline').toEqual([]);
  });
});
