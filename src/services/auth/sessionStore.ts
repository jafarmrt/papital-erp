import crypto from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { userSessions } from '../../db/schema.js';
import { serverTimestampToUtcIso } from '../../lib/serverTimestamp.js';
import { SESSION_USER_AGENT_MAX } from '../../lib/auth/deviceLabel.js';

/**
 * 10.2 package 8 (D-07): the session rows behind the login tokens. A token carries `sid`, the key of its
 * `user_sessions` row; `checkSession` refuses a token whose row is closed, expired or of another user. A token issued
 * before this release has no `sid`: its row key is derived from its CSRF value, else its issue time (`legacySessionId`), and its first
 * request adopts it, so nobody signs in again and the device shows in the list from then on. Like the user check, the
 * answer is cached 30 seconds in this single server process, and closing a row drops its cache entry at once, so the
 * closed device's very next request is refused.
 */

export interface SessionTokenClaims {
  id: number;
  sid?: string;
  csrfToken?: string;
  iat?: number;
  exp?: number;
}

export interface SessionRequestInfo {
  userAgent?: string;
  ipAddress?: string;
}

interface CachedSession {
  id: number;
  userId: number;
  revoked: boolean;
  expiresAtMs: number;
  lastSeenAtMs: number;
  cachedAt: number;
}

const SESSION_CACHE_TTL_MS = 30_000;
const MAX_SESSION_CACHE_SIZE = 2000;
/** «آخرین استفاده» is written at most this often per device */
export const SESSION_TOUCH_INTERVAL_MS = 5 * 60_000;

const sessionCache = new Map<string, CachedSession>();

export function invalidateSessionCache(sid?: string): void {
  if (sid === undefined) sessionCache.clear();
  else sessionCache.delete(sid);
}

export function newSessionId(): string {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * The row key of a token issued before sessions were recorded: from its CSRF value, else (a token with none) from its
 * user and issue and expiry times, which tell one such token apart from another of the same user.
 */
export function legacySessionId(claims: Pick<SessionTokenClaims, 'id' | 'csrfToken' | 'iat' | 'exp'>): string | null {
  const basis = claims.csrfToken || (Number(claims.iat) > 0 ? `${Number(claims.id)}:${Number(claims.iat)}:${Number(claims.exp) || 0}` : '');
  if (!basis) return null;
  return `legacy:${crypto.createHash('sha256').update(basis).digest('hex').slice(0, 48)}`;
}

/** the row key a token stands for: its own `sid`, else the legacy one */
export function sessionIdOfClaims(claims: Pick<SessionTokenClaims, 'id' | 'sid' | 'csrfToken' | 'iat' | 'exp'>): string | null {
  return claims.sid || legacySessionId(claims);
}

function utcMs(value: string | null | undefined): number {
  const iso = serverTimestampToUtcIso(value);
  return iso ? Date.parse(iso) : 0;
}

function cut(value: string | undefined, max: number): string {
  return String(value ?? '').slice(0, max);
}

/** a new session row for a fresh login (or a token issued again), valid `lifetimeSeconds` from now */
export async function insertSession(
  db: DbExecutor,
  input: { userId: number; sid: string; tokenVersion: number; lifetimeSeconds: number } & SessionRequestInfo,
): Promise<void> {
  await db.insert(userSessions).values({
    userId: input.userId,
    sid: input.sid,
    tokenVersion: input.tokenVersion,
    userAgent: cut(input.userAgent, SESSION_USER_AGENT_MAX),
    ipAddress: cut(input.ipAddress, 100),
    expiresAt: sql`(now() AT TIME ZONE 'UTC') + make_interval(secs => ${input.lifetimeSeconds})` as unknown as string,
  });
}

async function adoptLegacySession(claims: SessionTokenClaims, sid: string, tokenVersion: number, info: SessionRequestInfo): Promise<void> {
  const expSeconds = Number(claims.exp) > 0 ? Number(claims.exp) : Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  await orm.insert(userSessions).values({
    userId: claims.id,
    sid,
    tokenVersion,
    userAgent: cut(info.userAgent, SESSION_USER_AGENT_MAX),
    ipAddress: cut(info.ipAddress, 100),
    expiresAt: sql`to_timestamp(${expSeconds}) AT TIME ZONE 'UTC'` as unknown as string,
  }).onConflictDoNothing({ target: userSessions.sid });
}

async function readSession(sid: string): Promise<CachedSession | null> {
  const [row] = await orm.select({
    id: userSessions.id, userId: userSessions.userId, revokedAt: userSessions.revokedAt,
    expiresAt: userSessions.expiresAt, lastSeenAt: userSessions.lastSeenAt,
  }).from(userSessions).where(eq(userSessions.sid, sid)).limit(1);
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    revoked: row.revokedAt !== null,
    expiresAtMs: utcMs(row.expiresAt),
    lastSeenAtMs: utcMs(row.lastSeenAt),
    cachedAt: Date.now(),
  };
}

export type SessionCheck = { ok: true; sid: string; sessionId: number } | { ok: false; reason: 'no_session' | 'closed' | 'expired' };

/**
 * Whether the device behind a verified token is still signed in. `tokenVersion` is the user's current version (the
 * caller has already refused a stale one); it is stored on an adopted legacy row.
 */
export async function checkSession(claims: SessionTokenClaims, tokenVersion: number, info: SessionRequestInfo = {}): Promise<SessionCheck> {
  const sid = sessionIdOfClaims(claims);
  if (!sid) return { ok: false, reason: 'no_session' };
  const now = Date.now();
  let session = sessionCache.get(sid);
  if (!session || now - session.cachedAt >= SESSION_CACHE_TTL_MS) {
    session = (await readSession(sid)) ?? undefined;
    if (!session && !claims.sid) {
      await adoptLegacySession(claims, sid, tokenVersion, info);
      session = (await readSession(sid)) ?? undefined;
    }
    if (session) {
      if (sessionCache.size >= MAX_SESSION_CACHE_SIZE) {
        const firstKey = sessionCache.keys().next().value;
        if (firstKey !== undefined) sessionCache.delete(firstKey);
      }
      sessionCache.set(sid, session);
    }
  }
  if (!session || session.userId !== Number(claims.id)) return { ok: false, reason: 'no_session' };
  if (session.revoked) return { ok: false, reason: 'closed' };
  if (session.expiresAtMs > 0 && session.expiresAtMs <= now) return { ok: false, reason: 'expired' };
  if (now - session.lastSeenAtMs >= SESSION_TOUCH_INTERVAL_MS) {
    session.lastSeenAtMs = now;
    await orm.update(userSessions).set({ lastSeenAt: sql`now() AT TIME ZONE 'UTC'` as unknown as string })
      .where(and(eq(userSessions.id, session.id), sql`${userSessions.revokedAt} IS NULL`));
  }
  return { ok: true, sid, sessionId: session.id };
}
