import { sessionIdOfClaims, type SessionTokenClaims } from './sessionStore.js';

/**
 * 10.3 package 5 (10.2 backlog, review of #324): «بستن دستگاه‌های دیگر» and a password change raise the user's token
 * version and issue this device's token again. A request this same device sent a moment before (another tab, a list
 * still loading) still carries the previous token; it was refused with 401 and the browser signed out the very device
 * that made the change. For `TOKEN_VERSION_GRACE_MS` after the change the previous version is accepted from that one
 * device only (its session row, which `checkSession` still requires to be open), and only while the user's version is
 * the one the change set, so any later raise (a role change, «خروج از همهٔ دستگاه‌ها») ends it. Every other device
 * and an old token of another row stay refused at once. Like the session cache, this lives in the single server process
 * (AGENTS.md §22): a restart inside the window only brings back the old refusal.
 */
export const TOKEN_VERSION_GRACE_MS = 60_000;
const MAX_GRACE_ENTRIES = 2000;

interface Grace { userId: number; previous: number; current: number; until: number }

const graceBySid = new Map<string, Grace>();

/** the device behind `claims` may still send its previous token version for a minute; called in the change's transaction */
export function allowPreviousTokenVersion(claims: SessionTokenClaims | undefined, previous: number, current: number): void {
  const sid = claims ? sessionIdOfClaims(claims) : null;
  if (!sid || !claims) return;
  const now = Date.now();
  if (graceBySid.size >= MAX_GRACE_ENTRIES) {
    for (const [key, grace] of graceBySid) if (grace.until <= now) graceBySid.delete(key);
    const oldest = graceBySid.keys().next().value;
    if (graceBySid.size >= MAX_GRACE_ENTRIES && oldest !== undefined) graceBySid.delete(oldest);
  }
  graceBySid.set(sid, { userId: Number(claims.id), previous, current, until: now + TOKEN_VERSION_GRACE_MS });
}

/** whether a token of `claimVersion` is the previous token of a device inside its grace while the user is at `dbVersion` */
export function previousTokenVersionAccepted(claims: SessionTokenClaims, claimVersion: number, dbVersion: number): boolean {
  const sid = sessionIdOfClaims(claims);
  const grace = sid ? graceBySid.get(sid) : undefined;
  if (!sid || !grace) return false;
  if (grace.until <= Date.now()) {
    graceBySid.delete(sid);
    return false;
  }
  return grace.userId === Number(claims.id) && grace.previous === claimVersion && grace.current === dbVersion;
}

/** test hook: forgets every grace; does nothing in production */
export function clearTokenVersionGraceForTests(): void {
  if (process.env.NODE_ENV !== 'production') graceBySid.clear();
}
