import { SYSTEM_ADMIN_ROLE } from '../permissions/permissionCatalog';
import { WORKSHOP_LONG_SESSION_PERMISSION, WORKSHOP_SELF_PERMISSION } from '../permissions/workshopPermissions';

/**
 * v10.1.37 (N-01, TD-1283, decision ت۱۱ الف of the mobile workshop plan): a login lasts 24 hours, and seven days for a
 * role that holds `workshop.long_session` (the «کارکن کارگاه» template), so a worker on the shop floor is not asked for
 * the password every morning. The key is read from the role's own stored permissions: the system admin, who passes
 * every check, never gets the long session. Only a workshop-only role gets it: a role holding any key outside
 * `LONG_SESSION_ROLE_KEYS` keeps 24 hours, so a role with wider powers never gets a seven-day login.
 */
export const DEFAULT_SESSION_SECONDS = 24 * 60 * 60;
export const LONG_SESSION_SECONDS = 7 * 24 * 60 * 60;

/** The only keys a role may hold to get the seven-day login. */
export const LONG_SESSION_ROLE_KEYS: readonly string[] = [WORKSHOP_SELF_PERMISSION, WORKSHOP_LONG_SESSION_PERMISSION];

/** Whether a role's stored keys give the seven-day login: it holds the key and nothing outside the workshop-only list. */
export function isLongSessionRole(rolePermissions: unknown): boolean {
  const keys = Array.isArray(rolePermissions) ? rolePermissions.map(String) : [];
  return keys.includes(WORKSHOP_LONG_SESSION_PERMISSION) && keys.every(key => LONG_SESSION_ROLE_KEYS.includes(key));
}

export function sessionLifetimeSeconds(roleCode: string | null | undefined, rolePermissions: unknown): number {
  if (!roleCode || roleCode === SYSTEM_ADMIN_ROLE) return DEFAULT_SESSION_SECONDS;
  return isLongSessionRole(rolePermissions) ? LONG_SESSION_SECONDS : DEFAULT_SESSION_SECONDS;
}
