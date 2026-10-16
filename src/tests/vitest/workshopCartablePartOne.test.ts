import { describe, expect, it } from 'vitest';
import { DEFAULT_SESSION_SECONDS, LONG_SESSION_SECONDS, sessionLifetimeSeconds } from '../../lib/auth/sessionLifetime';
import { managerUserIdsOf } from '../../lib/projects/projectManagers';
import { parseRecipientPersonnelId } from '../../lib/workshop/recipient';
import { PERMISSION_CATALOG } from '../../lib/permissions/permissionCatalog';

/** v10.1.37 (N-01 part 1, TD-1283): the shared rules of the workshop cartable data. */
describe('workshop cartable part 1 (N-01, TD-1283)', () => {
  it('gives seven days only to a non-admin role holding workshop.long_session', () => {
    expect(sessionLifetimeSeconds('worker', ['workshop.self', 'workshop.long_session'])).toBe(LONG_SESSION_SECONDS);
    expect(LONG_SESSION_SECONDS).toBe(7 * 24 * 60 * 60);
    expect(sessionLifetimeSeconds('keeper', ['warehouse.view'])).toBe(DEFAULT_SESSION_SECONDS);
    expect(sessionLifetimeSeconds('admin', ['workshop.long_session'])).toBe(DEFAULT_SESSION_SECONDS);
    expect(sessionLifetimeSeconds(null, ['workshop.long_session'])).toBe(DEFAULT_SESSION_SECONDS);
    expect(sessionLifetimeSeconds('worker', null)).toBe(DEFAULT_SESSION_SECONDS);
  });

  it('declares the three workshop keys with their requirements', () => {
    const keys = new Map(PERMISSION_CATALOG.flatMap(g => g.permissions).map(p => [p.key, p]));
    expect(keys.get('workshop.self')).toBeDefined();
    expect(keys.get('workshop.review')?.requires).toEqual(['projects.view']);
    expect(keys.get('workshop.long_session')?.requires).toEqual(['workshop.self']);
  });

  it('sends each manager once and drops invalid ids', () => {
    expect(managerUserIdsOf([{ userId: 3 }, { userId: 3 }, { userId: 0 }, { userId: 7 }])).toEqual([3, 7]);
    expect(managerUserIdsOf(undefined)).toEqual([]);
  });

  it('reads a recipient id as not sent, cleared, an id or invalid', () => {
    expect(parseRecipientPersonnelId(undefined)).toBeUndefined();
    expect(parseRecipientPersonnelId(null)).toBeNull();
    expect(parseRecipientPersonnelId('')).toBeNull();
    expect(parseRecipientPersonnelId('12')).toBe(12);
    expect(parseRecipientPersonnelId(-1)).toBeNaN();
    expect(parseRecipientPersonnelId('x')).toBeNaN();
  });
});
