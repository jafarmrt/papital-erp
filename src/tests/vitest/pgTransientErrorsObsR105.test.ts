import { describe, expect, it } from 'vitest';
import { DB_RETRY_MESSAGE, DB_TIMEOUT_MESSAGE, normalizeError } from '../../errors/customErrors';

// OBS-R1-05: deadlock, serialization failure, lock timeout and statement timeout reach the user as
// "try again" with a stable code, never as an internal server error; Drizzle wraps the pg error in `cause`.
function drizzleWrapped(code: string): Error {
  const err = new Error('Failed query: update ...') as Error & { cause?: unknown };
  err.cause = Object.assign(new Error('pg error'), { code });
  return err;
}

describe('pg_transient_errors_obs_r1_05', () => {
  it.each([
    ['40P01', 409, 'DB_DEADLOCK_RETRY', DB_RETRY_MESSAGE],
    ['40001', 409, 'DB_SERIALIZATION_RETRY', DB_RETRY_MESSAGE],
    ['55P03', 409, 'DB_LOCK_NOT_AVAILABLE', DB_RETRY_MESSAGE],
    ['57014', 503, 'DB_STATEMENT_TIMEOUT', DB_TIMEOUT_MESSAGE],
  ])('maps pg code %s to status %i and code %s', (pgCode, status, code, message) => {
    for (const err of [drizzleWrapped(pgCode), Object.assign(new Error('raw'), { code: pgCode })]) {
      const normalized = normalizeError(err);
      expect(normalized.statusCode).toBe(status);
      expect(normalized.code).toBe(code);
      expect(normalized.message).toBe(message);
    }
  });

  it('leaves an unknown pg code as an internal error', () => {
    expect(normalizeError(drizzleWrapped('XX000')).statusCode).toBe(500);
  });
});
