import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { users } from '../../db/schema.js';
import { logger } from '../../middleware/logger.js';

/**
 * v7.0.28 (TD-186 / audit P1-5) — Login hardening
 * =================================================
 * - Progressive lockout (product-owner decision): after LOCKOUT_THRESHOLD consecutive failures the
 *   account is locked for 1 minute, then 2, 4, 8, 16 and at most 30 minutes for each further failure
 *   (previously a fixed 30-minute lock after 5 failures, trivially abusable to lock out the admin).
 * - Atomic failure counter: read-calculate-update under a row lock (AGENTS.md §1.2/§1.3) instead of an
 *   unlocked read-then-write that under-counted parallel attempts.
 * - Uniform responses: unknown usernames go through the same bcrypt work (dummy hash) and the same
 *   in-memory progressive lock, so neither the message, the 429 lock nor the timing reveals whether a
 *   username exists.
 * - Asynchronous bcrypt so a login never blocks the event loop.
 * - v7.0.70 (TD-187, product-owner decision): the progressive lock applies to the (username + client IP)
 *   pair, so an attacker cannot keep a known account (e.g. admin) locked for its owner from another address;
 *   the whole account is locked only after ACCOUNT_LOCKOUT_THRESHOLD failures from all addresses.
 */

export const LOCKOUT_THRESHOLD = 5;
export const MAX_LOCK_MINUTES = 30;
/**
 * v7.0.70 (TD-187, product-owner decision): failures from all addresses lock the whole account only after
 * this many consecutive failures; below it only the attacking (username + IP) pair is locked.
 */
export const ACCOUNT_LOCKOUT_THRESHOLD = 50;
/** After this quiet period since the last failure, a failure streak starts again from zero */
const STREAK_RESET_AFTER_MS = 24 * 60 * 60 * 1000;

export const GENERIC_LOGIN_FAILURE_MESSAGE = 'نام کاربری یا رمز عبور اشتباه است';

export function lockMinutesForFailureCount(failureCount: number, threshold: number = LOCKOUT_THRESHOLD): number {
  if (failureCount < threshold) return 0;
  return Math.min(MAX_LOCK_MINUTES, Math.pow(2, failureCount - threshold));
}

/** Hash of a random secret, computed once — equalizes bcrypt cost for unknown/deleted usernames */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

export function isBcryptHash(value: string | null | undefined): boolean {
  return Boolean(value && (value.startsWith('$2a$') || value.startsWith('$2b$') || value.startsWith('$2y$')));
}

/**
 * Compares a password against the stored hash (or a dummy hash when there is no usable account),
 * always spending the same bcrypt work.
 */
export async function verifyPasswordConstantWork(password: string, storedHash: string | null | undefined): Promise<boolean> {
  const usable = isBcryptHash(storedHash);
  const matches = await bcrypt.compare(password, usable ? String(storedHash) : DUMMY_PASSWORD_HASH);
  return usable && matches;
}

// --- v7.0.70 (TD-187): lock state per (username + IP), and the account state of unknown usernames -------
// In memory: the system runs as a single process (AGENTS.md §22, v7.0.44). Bounded, oldest entry evicted first.
interface FailureState { count: number; lockedUntil: number; lastFailureAt: number; }
const MAX_TRACKED_ENTRIES = 10000;
const pairFailures = new Map<string, FailureState>();
const phantomAccountFailures = new Map<string, FailureState>();

function usernameKey(username: string): string {
  return username.trim().toLowerCase();
}

function pairKey(username: string, ip: string): string {
  return `${usernameKey(username)}|${String(ip || 'unknown').trim()}`;
}

function remainingMinutes(untilMs: number): number {
  return Math.max(1, Math.ceil((untilMs - Date.now()) / 60000));
}

/** Records one failure in an in-memory progressive counter and returns the lock it causes (0 = none). */
function bumpMemoryCounter(map: Map<string, FailureState>, key: string, threshold: number): { count: number; lockMinutes: number } {
  const now = Date.now();
  const prev = map.get(key);
  const streak = prev && now - prev.lastFailureAt <= STREAK_RESET_AFTER_MS ? prev.count : 0;
  const count = streak + 1;
  const lockMinutes = lockMinutesForFailureCount(count, threshold);
  map.delete(key);
  map.set(key, { count, lastFailureAt: now, lockedUntil: lockMinutes > 0 ? now + lockMinutes * 60 * 1000 : (prev?.lockedUntil ?? 0) });
  if (map.size > MAX_TRACKED_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  return { count, lockMinutes };
}

function activeMemoryLock(map: Map<string, FailureState>, key: string): number {
  const state = map.get(key);
  return state && state.lockedUntil > Date.now() ? state.lockedUntil : 0;
}

/** Test helper: clears the in-memory (username + IP) and unknown-username lock state. */
export function resetPhantomLockouts(): void {
  pairFailures.clear();
  phantomAccountFailures.clear();
}

/**
 * Login is refused while the (username + IP) pair is locked, or while the whole account is locked after
 * ACCOUNT_LOCKOUT_THRESHOLD failures. An unknown username behaves exactly like an existing one.
 */
export async function checkAccountLockout(username: string, ip: string): Promise<{ isLocked: boolean; remainingMinutes?: number }> {
  try {
    let until = activeMemoryLock(pairFailures, pairKey(username, ip));
    const [u] = await orm.select({ lockedUntil: users.lockedUntil }).from(users).where(eq(users.username, username)).limit(1);
    const accountUntil = u
      ? (u.lockedUntil ? new Date(u.lockedUntil).getTime() : 0)
      : activeMemoryLock(phantomAccountFailures, usernameKey(username));
    if (accountUntil > Date.now()) until = Math.max(until, accountUntil);
    return until > Date.now() ? { isLocked: true, remainingMinutes: remainingMinutes(until) } : { isLocked: false };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(`[Account Lockout Check Error] ${errMsg}`);
    return { isLocked: false };
  }
}

export async function recordFailedAttempt(username: string, ip: string): Promise<{ locked: boolean; remainingAttempts: number; remainingMinutes?: number }> {
  try {
    const pair = bumpMemoryCounter(pairFailures, pairKey(username, ip), LOCKOUT_THRESHOLD);

    const account = await orm.transaction(async (tx) => {
      const [u] = await tx
        .select({ id: users.id, failedLoginCount: users.failedLoginCount, lockedUntil: users.lockedUntil, lastFailedLoginAt: users.lastFailedLoginAt })
        .from(users)
        .where(eq(users.username, username))
        .for('update');
      if (!u) return null;

      const now = Date.now();
      const lastFailure = u.lastFailedLoginAt ? new Date(u.lastFailedLoginAt).getTime() : 0;
      const streak = lastFailure && now - lastFailure <= STREAK_RESET_AFTER_MS ? (u.failedLoginCount || 0) : 0;
      const newCount = streak + 1;
      const lockMinutes = lockMinutesForFailureCount(newCount, ACCOUNT_LOCKOUT_THRESHOLD);
      const lockedUntil = lockMinutes > 0 ? new Date(now + lockMinutes * 60 * 1000).toISOString() : u.lockedUntil;

      await tx.update(users).set({ failedLoginCount: newCount, lockedUntil, lastFailedLoginAt: new Date(now).toISOString() }).where(eq(users.id, u.id));
      return { id: u.id, count: newCount, lockMinutes };
    }) ?? { id: null, ...bumpMemoryCounter(phantomAccountFailures, usernameKey(username), ACCOUNT_LOCKOUT_THRESHOLD) };

    if (account.lockMinutes > 0 && account.id !== null) {
      logger.warn(`[Account Lockout] User ${username} (ID ${account.id}) locked for ${account.lockMinutes} minute(s) after ${account.count} failed attempts from any address`);
    } else if (pair.lockMinutes > 0) {
      logger.warn(`[Login Lockout] ${username} from ${ip} locked for ${pair.lockMinutes} minute(s) after ${pair.count} failed attempts`);
    }
    const lockMinutes = Math.max(pair.lockMinutes, account.lockMinutes);
    return lockMinutes > 0
      ? { locked: true, remainingAttempts: 0, remainingMinutes: lockMinutes }
      : { locked: false, remainingAttempts: Math.max(0, LOCKOUT_THRESHOLD - pair.count) };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(`[Record Failed Attempt Error] ${errMsg}`);
    return { locked: false, remainingAttempts: 0 };
  }
}

/**
 * Successful login (or an administrative unlock): clears the account counter and, when given, the
 * (username + IP) pair of the successful login. Locks of other addresses stay in place.
 */
export async function resetFailedAttempts(userIdOrUsername: number | string, pair?: { username: string; ip: string }): Promise<void> {
  try {
    const cleared = { failedLoginCount: 0, lockedUntil: null, lastFailedLoginAt: null };
    if (typeof userIdOrUsername === 'number') {
      await orm.update(users).set(cleared).where(eq(users.id, userIdOrUsername));
    } else {
      const username = String(userIdOrUsername).trim();
      await orm.update(users).set(cleared).where(eq(users.username, username));
      phantomAccountFailures.delete(usernameKey(username));
    }
    if (pair) pairFailures.delete(pairKey(pair.username, pair.ip));
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(`[Reset Failed Attempts Error] ${errMsg}`);
  }
}

/** Lockout response message — identical for existing and unknown usernames */
export function lockoutMessage(minutes: number): string {
  return `به دلیل تلاش‌های ناموفق مکرر، ورود با این نام کاربری به‌طور موقت مسدود شده است. لطفاً ${minutes} دقیقه دیگر تلاش فرمایید.`;
}
