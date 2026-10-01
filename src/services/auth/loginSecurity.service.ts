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
 */

export const LOCKOUT_THRESHOLD = 5;
export const MAX_LOCK_MINUTES = 30;
/** After this quiet period since the last lock expired, the failure streak starts again from zero */
const STREAK_RESET_AFTER_MS = 24 * 60 * 60 * 1000;

export const GENERIC_LOGIN_FAILURE_MESSAGE = 'نام کاربری یا رمز عبور اشتباه است';

export function lockMinutesForFailureCount(failureCount: number): number {
  if (failureCount < LOCKOUT_THRESHOLD) return 0;
  return Math.min(MAX_LOCK_MINUTES, Math.pow(2, failureCount - LOCKOUT_THRESHOLD));
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

// --- Phantom lockout for usernames that do not exist (per process, bounded) -----------------------
interface PhantomState { count: number; lockedUntil: number; }
const MAX_PHANTOM_ENTRIES = 5000;
const phantomFailures = new Map<string, PhantomState>();

function phantomKey(username: string): string {
  return username.trim().toLowerCase();
}

function remainingMinutes(untilMs: number): number {
  return Math.max(1, Math.ceil((untilMs - Date.now()) / 60000));
}

export function resetPhantomLockouts(): void {
  phantomFailures.clear();
}

export async function checkAccountLockout(username: string): Promise<{ isLocked: boolean; remainingMinutes?: number }> {
  try {
    const [u] = await orm.select({ lockedUntil: users.lockedUntil }).from(users).where(eq(users.username, username)).limit(1);
    if (!u) {
      const phantom = phantomFailures.get(phantomKey(username));
      if (phantom && phantom.lockedUntil > Date.now()) {
        return { isLocked: true, remainingMinutes: remainingMinutes(phantom.lockedUntil) };
      }
      return { isLocked: false };
    }
    if (u.lockedUntil) {
      const lockMs = new Date(u.lockedUntil).getTime();
      if (lockMs > Date.now()) {
        return { isLocked: true, remainingMinutes: remainingMinutes(lockMs) };
      }
    }
    return { isLocked: false };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(`[Account Lockout Check Error] ${errMsg}`);
    return { isLocked: false };
  }
}

export async function recordFailedAttempt(username: string): Promise<{ locked: boolean; remainingAttempts: number; remainingMinutes?: number }> {
  try {
    const result = await orm.transaction(async (tx) => {
      const [u] = await tx
        .select({ id: users.id, failedLoginCount: users.failedLoginCount, lockedUntil: users.lockedUntil })
        .from(users)
        .where(eq(users.username, username))
        .for('update');
      if (!u) return null;

      let streak = u.failedLoginCount || 0;
      if (u.lockedUntil && Date.now() - new Date(u.lockedUntil).getTime() > STREAK_RESET_AFTER_MS) {
        streak = 0;
      }
      const newCount = streak + 1;
      const lockMinutes = lockMinutesForFailureCount(newCount);
      const lockedUntil = lockMinutes > 0 ? new Date(Date.now() + lockMinutes * 60 * 1000).toISOString() : u.lockedUntil;

      await tx.update(users).set({ failedLoginCount: newCount, lockedUntil }).where(eq(users.id, u.id));
      return { id: u.id, newCount, lockMinutes };
    });

    if (!result) {
      // Unknown username: same progression, kept in memory so it does not reveal account existence
      const key = phantomKey(username);
      const prev = phantomFailures.get(key) || { count: 0, lockedUntil: 0 };
      const count = prev.count + 1;
      const lockMinutes = lockMinutesForFailureCount(count);
      const next: PhantomState = { count, lockedUntil: lockMinutes > 0 ? Date.now() + lockMinutes * 60 * 1000 : prev.lockedUntil };
      phantomFailures.delete(key);
      phantomFailures.set(key, next);
      if (phantomFailures.size > MAX_PHANTOM_ENTRIES) {
        const oldest = phantomFailures.keys().next().value;
        if (oldest !== undefined) phantomFailures.delete(oldest);
      }
      return lockMinutes > 0
        ? { locked: true, remainingAttempts: 0, remainingMinutes: lockMinutes }
        : { locked: false, remainingAttempts: LOCKOUT_THRESHOLD - count };
    }

    if (result.lockMinutes > 0) {
      logger.warn(`[Account Lockout] User ${username} (ID ${result.id}) locked for ${result.lockMinutes} minute(s) after ${result.newCount} consecutive failed attempts`);
      return { locked: true, remainingAttempts: 0, remainingMinutes: result.lockMinutes };
    }
    return { locked: false, remainingAttempts: Math.max(0, LOCKOUT_THRESHOLD - result.newCount) };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(`[Record Failed Attempt Error] ${errMsg}`);
    return { locked: false, remainingAttempts: 0 };
  }
}

export async function resetFailedAttempts(userIdOrUsername: number | string): Promise<void> {
  try {
    if (typeof userIdOrUsername === 'number') {
      await orm.update(users).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, userIdOrUsername));
    } else {
      const username = String(userIdOrUsername).trim();
      await orm.update(users).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(users.username, username));
      phantomFailures.delete(phantomKey(username));
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(`[Reset Failed Attempts Error] ${errMsg}`);
  }
}

/** Lockout response message — identical for existing and unknown usernames */
export function lockoutMessage(minutes: number): string {
  return `به دلیل تلاش‌های ناموفق مکرر، ورود با این نام کاربری به‌طور موقت مسدود شده است. لطفاً ${minutes} دقیقه دیگر تلاش فرمایید.`;
}
