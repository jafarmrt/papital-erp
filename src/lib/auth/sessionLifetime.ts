import { SYSTEM_ADMIN_ROLE } from '../permissions/permissionCatalog';
import { WORKSHOP_LONG_SESSION_PERMISSION } from '../permissions/workshopPermissions';

/**
 * v10.1.36 (N-01, TD-1283, decision ت۱۱ الف of the mobile workshop plan): a login lasts 24 hours, and seven days for a
 * role that holds `workshop.long_session` (the «کارکن کارگاه» template), so a worker on the shop floor is not asked for
 * the password every morning. The key is read from the role's own stored permissions: the system admin, who passes
 * every check, never gets the long session.
 */
export const DEFAULT_SESSION_SECONDS = 24 * 60 * 60;
export const LONG_SESSION_SECONDS = 7 * 24 * 60 * 60;

export function sessionLifetimeSeconds(roleCode: string | null | undefined, rolePermissions: unknown): number {
  if (!roleCode || roleCode === SYSTEM_ADMIN_ROLE) return DEFAULT_SESSION_SECONDS;
  const keys = Array.isArray(rolePermissions) ? rolePermissions : [];
  return keys.includes(WORKSHOP_LONG_SESSION_PERMISSION) ? LONG_SESSION_SECONDS : DEFAULT_SESSION_SECONDS;
}
