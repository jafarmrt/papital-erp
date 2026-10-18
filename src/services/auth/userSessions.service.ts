import type { Request, Response } from 'express';
import { and, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { users, userSessions } from '../../db/schema.js';
import { logActivity, extractClientIp } from '../../lib/auditLogger.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import {
  AUTH_COOKIE_NAME, generateCsrfToken, generateToken, getAuthCookieOptions, invalidateUserAuthCache, sessionLifetimeOfRole,
} from '../../middleware/auth.js';
import { serverTimestampToUtcIso } from '../../lib/serverTimestamp.js';
import { deviceLabelOf } from '../../lib/auth/deviceLabel.js';
import { isSystemAdminRole } from '../../lib/permissions/permissionCatalog.js';
import type { UserSessionView } from '../../lib/auth/userSessions.js';
import { assertManageableAccount, grantorPermissions } from '../users/grantBoundary.js';
import {
  insertSession, invalidateSessionCache, newSessionId, sessionIdOfClaims, type SessionTokenClaims,
} from './sessionStore.js';

/**
 * 10.2 package 8 (D-07, TD-1295): issuing, listing and closing the sessions of `user_sessions`. Every login writes a
 * row and its token carries the row's `sid`; «خروج» closes only this device's row; a user closes another of their own
 * devices from the profile, and a holder of `users.manage` closes another user's devices (the TD-299 / TD-520 account
 * rules apply). Every close writes an audit row with its transaction and drops the cache entry, so the closed device is
 * refused on its very next request. There are no refresh tokens: a session is its one login token.
 */

type SessionUser = { id: number; username: string; role: string | null; tokenVersion: number | null };

const AUTH_ENTITY = 'احراز هویت';
const USER_ENTITY = 'کاربران سیستم';
export const SESSION_NOT_FOUND = 'SESSION_NOT_FOUND';
export const SESSION_IS_CURRENT = 'SESSION_IS_CURRENT';
const SESSION_NOT_FOUND_MESSAGE = 'این دستگاه پیدا نشد یا پیش‌تر از حساب خارج شده است.';
const ONLY_ADMIN_CLOSES_ADMIN_SESSIONS = 'دستگاه‌های حساب مدیر سامانه را فقط مدیر سامانه می‌بیند و می‌بندد.';

function requestInfo(req: Request): { userAgent: string; ipAddress: string } {
  return { userAgent: String(req.headers['user-agent'] ?? ''), ipAddress: extractClientIp(req) };
}

/** the current device's row key, from the verified token of the request */
export function currentSessionId(req: Request): string | null {
  const claims = req.user as (SessionTokenClaims & { csrfToken?: string }) | undefined;
  return claims ? sessionIdOfClaims(claims) : null;
}

function signToken(user: SessionUser, sid: string, csrfToken: string, lifetime: number): string {
  return generateToken({
    id: user.id, username: user.username, role: user.role ?? '', csrfToken, tokenVersion: user.tokenVersion || 0, sid,
  }, lifetime);
}

/** a fresh login (or setup): a new session row, its token in the cookie */
export async function issueSessionCookie(
  req: Request, res: Response, user: SessionUser, lifetimeSeconds?: number,
): Promise<{ token: string; csrfToken: string }> {
  const lifetime = lifetimeSeconds ?? await sessionLifetimeOfRole(user.role);
  const sid = newSessionId();
  const csrfToken = generateCsrfToken();
  await insertSession(orm, { userId: user.id, sid, tokenVersion: user.tokenVersion || 0, lifetimeSeconds: lifetime, ...requestInfo(req) });
  const token = signToken(user, sid, csrfToken, lifetime);
  res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions(req, lifetime));
  return { token, csrfToken };
}

/**
 * The same device's token issued again (after its own password change, after «بستن دستگاه‌های دیگر», or an old token
 * without a CSRF value): the row keeps its key and takes the user's current token version and a new expiry.
 */
export async function renewSessionCookie(
  req: Request, res: Response, user: SessionUser, csrfToken: string = req.user?.csrfToken || generateCsrfToken(),
): Promise<{ token: string; csrfToken: string }> {
  const lifetime = await sessionLifetimeOfRole(user.role);
  const sid = currentSessionId(req);
  if (!sid) return issueSessionCookie(req, res, user, lifetime);
  const renewed = await orm.update(userSessions).set({
    tokenVersion: user.tokenVersion || 0,
    expiresAt: sql`(now() AT TIME ZONE 'UTC') + make_interval(secs => ${lifetime})`,
  }).where(and(eq(userSessions.sid, sid), eq(userSessions.userId, user.id), isNull(userSessions.revokedAt)))
    .returning({ id: userSessions.id });
  if (renewed.length === 0) return issueSessionCookie(req, res, user, lifetime);
  invalidateSessionCache(sid);
  const token = signToken(user, sid, csrfToken, lifetime);
  res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions(req, lifetime));
  return { token, csrfToken };
}

/** the signed-in devices of a user: open, not expired, of the user's current token version, newest use first */
export async function listUserSessions(userId: number, currentSid: string | null = null): Promise<UserSessionView[]> {
  const rows = await orm.select({
    id: userSessions.id, sid: userSessions.sid, userAgent: userSessions.userAgent, ipAddress: userSessions.ipAddress,
    createdAt: userSessions.createdAt, lastSeenAt: userSessions.lastSeenAt, expiresAt: userSessions.expiresAt,
  }).from(userSessions)
    .innerJoin(users, eq(users.id, userSessions.userId))
    .where(and(
      eq(userSessions.userId, userId),
      isNull(userSessions.revokedAt),
      gt(userSessions.expiresAt, sql`now() AT TIME ZONE 'UTC'`),
      eq(userSessions.tokenVersion, sql`COALESCE(${users.tokenVersion}, 0)`),
    ))
    .orderBy(desc(userSessions.lastSeenAt), desc(userSessions.id))
    .limit(100);
  return rows.map(row => ({
    id: row.id,
    deviceLabel: deviceLabelOf(row.userAgent),
    ipAddress: row.ipAddress,
    signedInAt: serverTimestampToUtcIso(row.createdAt),
    lastSeenAt: serverTimestampToUtcIso(row.lastSeenAt),
    expiresAt: serverTimestampToUtcIso(row.expiresAt),
    isCurrent: currentSid !== null && row.sid === currentSid,
  }));
}

async function lockOpenSession(tx: DbExecutor, userId: number, sessionId: number) {
  const [row] = await tx.select().from(userSessions)
    .where(and(eq(userSessions.id, sessionId), eq(userSessions.userId, userId))).for('update');
  if (!row || row.revokedAt !== null) throw new NotFoundError(SESSION_NOT_FOUND_MESSAGE, undefined, SESSION_NOT_FOUND);
  return row;
}

async function closeRow(tx: DbExecutor, id: number, reason: 'logout' | 'closed_by_user' | 'closed_by_admin'): Promise<void> {
  await tx.update(userSessions).set({ revokedAt: sql`now() AT TIME ZONE 'UTC'`, revokeReason: reason })
    .where(and(eq(userSessions.id, id), isNull(userSessions.revokedAt)));
}

/** «بستن» one of the user's own other devices; this device signs out with «خروج» */
export async function closeOwnSession(req: Request, sessionId: number): Promise<void> {
  const userId = Number(req.user?.id);
  const current = currentSessionId(req);
  const sid = await orm.transaction(async (tx) => {
    const row = await lockOpenSession(tx, userId, sessionId);
    if (row.sid === current) {
      throw new ValidationError('برای خروج از همین دستگاه دکمهٔ «خروج» را بزنید.', undefined, SESSION_IS_CURRENT);
    }
    await closeRow(tx, row.id, 'closed_by_user');
    await logActivity({
      req, tx, action: 'LOGOUT', entity: AUTH_ENTITY, entityId: userId,
      description: `بستن نشست دستگاه «${deviceLabelOf(row.userAgent)}» از نمایه`,
      details: { sessionId: row.id, device: deviceLabelOf(row.userAgent), ipAddress: row.ipAddress, method: 'بستن یک دستگاه از نمایه' },
    });
    return row.sid;
  });
  invalidateSessionCache(sid);
}

/**
 * «بستن دستگاه‌های دیگر»: every other device of the user, an old token never adopted as a row included (its token
 * version goes stale), while this device stays signed in with its token issued again.
 */
export async function closeOtherOwnSessions(req: Request, res: Response): Promise<{ closedCount: number; csrfToken: string; token: string }> {
  const userId = Number(req.user?.id);
  const current = currentSessionId(req);
  const { user, closedSids } = await orm.transaction(async (tx) => {
    const [row] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
    if (!row || row.isDeleted === 1) throw new NotFoundError('حساب کاربری یافت نشد');
    const tokenVersion = (row.tokenVersion || 0) + 1;
    await tx.update(users).set({ tokenVersion }).where(eq(users.id, userId));
    const closed = await tx.update(userSessions)
      .set({ revokedAt: sql`now() AT TIME ZONE 'UTC'`, revokeReason: 'others_closed' })
      .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt), current ? ne(userSessions.sid, current) : sql`true`))
      .returning({ sid: userSessions.sid });
    await logActivity({
      req, tx, action: 'LOGOUT', entity: AUTH_ENTITY, entityId: userId,
      description: `بستن همهٔ دستگاه‌های دیگر کاربر ${row.fullName || row.username} از نمایه (${closed.length} دستگاه)`,
      details: { closedCount: closed.length, method: 'بستن دستگاه‌های دیگر از نمایه' },
    });
    return { user: { ...row, tokenVersion }, closedSids: closed.map(c => c.sid) };
  });
  invalidateUserAuthCache(userId);
  for (const sid of closedSids) invalidateSessionCache(sid);
  const session = await renewSessionCookie(req, res, user);
  return { closedCount: closedSids.length, ...session };
}

/**
 * «خروج»: this device's row is closed (an old token's row is written closed), never the user's other devices. One
 * upsert closes it whether or not the row exists yet (review N-2): an old token's first request may adopt its row
 * between a read and an insert, and an insert that then gave way to that open row left the device signed in.
 */
export interface LoggedOutSession {
  sessionId: number | null;
  /** the account's stored names, for the logout audit row (review N-6) */
  username: string | null;
  fullName: string | null;
}

export async function closeSessionOnLogout(claims: SessionTokenClaims & { tokenVersion?: number }, req: Request): Promise<LoggedOutSession> {
  const [account] = await orm.select({ username: users.username, fullName: users.fullName }).from(users)
    .where(eq(users.id, Number(claims.id))).limit(1);
  const names = { username: account?.username ?? null, fullName: account?.fullName ?? null };
  const sid = sessionIdOfClaims(claims);
  if (!sid) return { sessionId: null, ...names };
  const expSeconds = Number(claims.exp) > 0 ? Number(claims.exp) : Math.floor(Date.now() / 1000);
  const [row] = await orm.insert(userSessions).values({
    userId: Number(claims.id), sid, tokenVersion: Number(claims.tokenVersion ?? 0), ...requestInfo(req),
    expiresAt: sql`to_timestamp(${expSeconds}) AT TIME ZONE 'UTC'`,
    revokedAt: sql`now() AT TIME ZONE 'UTC'`, revokeReason: 'logout',
  }).onConflictDoUpdate({
    target: userSessions.sid,
    set: {
      revokedAt: sql`COALESCE(${userSessions.revokedAt}, now() AT TIME ZONE 'UTC')`,
      revokeReason: sql`COALESCE(${userSessions.revokeReason}, 'logout')`,
    },
    setWhere: eq(userSessions.userId, Number(claims.id)),
  }).returning({ id: userSessions.id });
  invalidateSessionCache(sid);
  return { sessionId: row?.id ?? null, ...names };
}

async function lockManagedUser(tx: DbExecutor, req: Request, targetUserId: number) {
  const [target] = await tx.select().from(users).where(eq(users.id, targetUserId)).for('update');
  if (!target) throw new NotFoundError('کاربر یافت نشد');
  if (!isSystemAdminRole(req.user?.role) && isSystemAdminRole(target.role)) throw new ForbiddenError(ONLY_ADMIN_CLOSES_ADMIN_SESSIONS);
  await assertManageableAccount(tx, await grantorPermissions(req.user?.role, tx), target.role ?? '');
  return target;
}

/**
 * The devices of another user for a holder of `users.manage`, under the same account rules as closing them: an admin
 * account's devices (and their addresses) only for the system admin, and no account whose role holds a key the reader
 * lacks (TD-299 / TD-520). The reader's own list marks the current device.
 */
export async function listManagedUserSessions(req: Request, targetUserId: number): Promise<UserSessionView[]> {
  const [target] = await orm.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, targetUserId)).limit(1);
  if (!target) throw new NotFoundError('کاربر یافت نشد');
  const own = Number(req.user?.id) === targetUserId;
  if (!own) {
    if (!isSystemAdminRole(req.user?.role) && isSystemAdminRole(target.role)) throw new ForbiddenError(ONLY_ADMIN_CLOSES_ADMIN_SESSIONS);
    await assertManageableAccount(orm, await grantorPermissions(req.user?.role, orm), target.role ?? '');
  }
  return listUserSessions(targetUserId, own ? currentSessionId(req) : null);
}

/** a holder of `users.manage` closes one device of another user (a worker's lost phone) */
export async function closeUserSessionByAdmin(req: Request, targetUserId: number, sessionId: number): Promise<void> {
  const sid = await orm.transaction(async (tx) => {
    const target = await lockManagedUser(tx, req, targetUserId);
    const row = await lockOpenSession(tx, targetUserId, sessionId);
    await closeRow(tx, row.id, 'closed_by_admin');
    await logActivity({
      req, tx, action: 'LOGOUT', entity: USER_ENTITY, entityId: targetUserId,
      description: `بستن نشست دستگاه «${deviceLabelOf(row.userAgent)}» کاربر ${target.fullName || target.username}`,
      details: { sessionId: row.id, device: deviceLabelOf(row.userAgent), ipAddress: row.ipAddress, method: 'بستن یک دستگاه به دست مدیر' },
    });
    return row.sid;
  });
  invalidateSessionCache(sid);
}

/** a holder of `users.manage` signs another user out of every device (the token version goes up too) */
export async function closeAllUserSessionsByAdmin(req: Request, targetUserId: number): Promise<{ closedCount: number }> {
  const closedSids = await orm.transaction(async (tx) => {
    const target = await lockManagedUser(tx, req, targetUserId);
    await tx.update(users).set({ tokenVersion: (target.tokenVersion || 0) + 1 }).where(eq(users.id, targetUserId));
    const closed = await tx.update(userSessions)
      .set({ revokedAt: sql`now() AT TIME ZONE 'UTC'`, revokeReason: 'closed_by_admin' })
      .where(and(eq(userSessions.userId, targetUserId), isNull(userSessions.revokedAt)))
      .returning({ sid: userSessions.sid });
    await logActivity({
      req, tx, action: 'LOGOUT', entity: USER_ENTITY, entityId: targetUserId,
      description: `خروج کاربر ${target.fullName || target.username} از همهٔ دستگاه‌ها به دست مدیر (${closed.length} دستگاه)`,
      details: { closedCount: closed.length, method: 'بستن همهٔ دستگاه‌ها به دست مدیر' },
    });
    return closed.map(c => c.sid);
  });
  invalidateUserAuthCache(targetUserId);
  for (const sid of closedSids) invalidateSessionCache(sid);
  return { closedCount: closedSids.length };
}
