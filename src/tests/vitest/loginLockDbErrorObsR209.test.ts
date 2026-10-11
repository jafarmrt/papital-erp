// @vitest-environment node
/**
 * v10.0.211 (OBS-R2-09): when the database failed, the login lock check answered «not locked» and dropped the
 * in-memory (username + IP) lock it had already read, and a failed attempt answered «not locked» too. The check now
 * fails closed: the pair lock still answers, otherwise a 503; a failed attempt still counts toward the pair lock.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/drizzle.js', () => {
  const failing = () => Promise.reject(new Error('connection refused'));
  const chain = { from: () => chain, where: () => chain, limit: failing };
  return { orm: { select: () => chain, transaction: failing } };
});

import {
  checkAccountLockout, recordFailedAttempt, resetPhantomLockouts, LOCKOUT_THRESHOLD,
} from '../../services/auth/loginSecurity.service';
import { LOGIN_STATE_UNREADABLE_MESSAGE } from '../../lib/auth/loginLockout';

const USER = 'clerk';
const IP = '10.0.0.7';

describe('login_lock_db_error_obs_r2_09', () => {
  beforeEach(() => resetPhantomLockouts());

  it('the lock check refuses with a 503 instead of answering not locked', async () => {
    await expect(checkAccountLockout(USER, IP)).rejects.toMatchObject({
      statusCode: 503, code: 'LOGIN_STATE_UNREADABLE', message: LOGIN_STATE_UNREADABLE_MESSAGE,
    });
  });

  it('failed attempts still lock the username and address pair while the database fails', async () => {
    let last = await recordFailedAttempt(USER, IP);
    expect(last).toMatchObject({ locked: false, remainingAttempts: LOCKOUT_THRESHOLD - 1 });
    for (let i = 1; i < LOCKOUT_THRESHOLD; i++) last = await recordFailedAttempt(USER, IP);
    expect(last.locked).toBe(true);
    expect(last.remainingMinutes).toBeGreaterThan(0);
    await expect(checkAccountLockout(USER, IP)).resolves.toMatchObject({ isLocked: true });
  });
});
