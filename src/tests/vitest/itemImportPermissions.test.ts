import { describe, expect, it } from 'vitest';
import { itemImportPermissionNotices, itemImportPermissionsFromKeys, ALL_ITEM_IMPORT_PERMISSIONS } from '../../lib/items/itemImportPermissions';
import { isCatalogPermission } from '../../lib/permissions/permissionCatalog';
import { ITEM_IMPORT_PERMISSION_KEYS } from '../../lib/items/itemImportPermissions';

describe('item Excel import permissions (TD-648)', () => {
  it('maps each import part to a catalog permission key', () => {
    for (const key of Object.values(ITEM_IMPORT_PERMISSION_KEYS)) expect(isCatalogPermission(key)).toBe(true);
  });

  it('derives the parts from the role keys; the system admin holds all', () => {
    expect(itemImportPermissionsFromKeys(true, [])).toEqual(ALL_ITEM_IMPORT_PERMISSIONS);
    expect(itemImportPermissionsFromKeys(false, ['products.view', 'products.edit'])).toEqual({
      createItems: false, editItems: true, editPrices: false, stockIn: false, stockOut: false,
    });
  });

  it('tells a products.edit-only user that prices, stock and new items are not imported', () => {
    const notices = itemImportPermissionNotices(itemImportPermissionsFromKeys(false, ['products.edit']));
    expect(notices).toHaveLength(4);
    expect(notices.join(' ')).toContain('ویرایش قیمت‌ها');
    expect(itemImportPermissionNotices(ALL_ITEM_IMPORT_PERMISSIONS)).toEqual([]);
  });
});
