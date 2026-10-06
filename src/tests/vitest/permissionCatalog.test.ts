/**
 * v9.0.86 (TD-880, permission model §4.2): the shared permission catalog and its dependency helpers, used by the
 * server when a role is saved and by the role form when a box is ticked.
 */
import { describe, expect, it } from 'vitest';
import {
  PERMISSION_CATALOG,
  PERMISSION_KEYS,
  dependentPermissionsOf,
  isCatalogPermission,
  missingRequiredPermissions,
  requiredPermissionsOf,
  withRequiredPermissions,
  withoutPermission,
} from '../../lib/permissions/permissionCatalog';
import { ROLE_PRESETS } from '../../components/users/RoleFormModal';

describe('permission catalog (TD-880)', () => {
  it('has unique dotted keys whose requirements are catalog keys without cycles', () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
    for (const key of PERMISSION_KEYS) {
      expect(key).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(requiredPermissionsOf(key)).not.toContain(key);
    }
    for (const group of PERMISSION_CATALOG) {
      for (const p of group.permissions) for (const r of p.requires ?? []) expect(isCatalogPermission(r), `${p.key} requires ${r}`).toBe(true);
    }
  });

  it('makes every action of a group with one view key require that view, and no view require anything', () => {
    for (const group of PERMISSION_CATALOG) {
      const views = group.permissions.filter(p => p.key.endsWith('.view'));
      for (const v of views) expect(v.requires ?? [], v.key).toEqual([]);
      if (views.length !== 1) continue;
      for (const p of group.permissions) {
        if (p.key !== views[0].key) expect(requiredPermissionsOf(p.key), p.key).toContain(views[0].key);
      }
    }
  });

  it('adds requirements in catalog order after the given keys, keeps legacy keys and is idempotent', () => {
    const closed = withRequiredPermissions(['accounting.treasury_no_voucher', 'legacy.key', 'documents.edit']);
    expect(closed).toEqual(['accounting.treasury_no_voucher', 'legacy.key', 'documents.edit', 'documents.view', 'accounting.view', 'accounting.treasury']);
    expect(withRequiredPermissions(closed)).toEqual(closed);
    expect(missingRequiredPermissions(['customers.manage', 'customers.manage'])).toEqual(['customers.view']);
  });

  it('removes a permission with everything that depends on it', () => {
    expect(dependentPermissionsOf('accounting.treasury')).toEqual(['accounting.treasury_no_voucher']);
    const keys = withRequiredPermissions(['accounting.treasury_no_voucher', 'accounting.reports', 'crm.view']);
    expect(withoutPermission(keys, 'accounting.view')).toEqual(['crm.view']);
    expect(withoutPermission(keys, 'accounting.treasury_no_voucher')).toEqual(['accounting.reports', 'crm.view', 'accounting.view', 'accounting.treasury']);
  });

  it('keeps the role form templates closed under the dependencies', () => {
    for (const preset of ROLE_PRESETS) expect(missingRequiredPermissions(preset.permissions), preset.code).toEqual([]);
  });
});
