/**
 * v10.2 package 11 (TD-1323): the health check of workflow actions asking a removed permission said only the system
 * admin signs them. Since v10.2.0 the holders of the removed key's replacement sign a running instance too
 * (`REPLACED_PERMISSION_KEYS`), so the row now names that permission; a removed key without a replacement still says
 * only the system admin signs.
 */
import { describe, expect, it } from 'vitest';
import { buildUnknownPermissionActionHealthTest } from '../../services/accounting/workflowUnknownPermissionHealth';

const REPLACEMENT_TITLE = 'اعمال و تسویه مغایرت';
const ONLY_ADMIN = 'جز مدیر سامانه کسی این اقدام را امضا نمی‌کند';
const removedKey = ['audit', 'create'].join('.');
const row = (requiredPermission: string) => ({ definitionId: 1, code: 'wf', title: 'wf', transitionId: 1, transitionTitle: 'start', requiredPermission });

describe('TD-1323 the unknown permission health row says who signs', () => {
  it('a removed key with a replacement names the replacement permission', () => {
    const [item] = buildUnknownPermissionActionHealthTest([row(removedKey)]).items ?? [];
    expect(String(item?.details)).toContain(REPLACEMENT_TITLE);
    expect(String(item?.details)).not.toContain(ONLY_ADMIN);
  });

  it('a key without a replacement is signed only by the system admin', () => {
    const [item] = buildUnknownPermissionActionHealthTest([row(['legacy', 'gone'].join('.'))]).items ?? [];
    expect(String(item?.details)).toContain(ONLY_ADMIN);
  });
});
