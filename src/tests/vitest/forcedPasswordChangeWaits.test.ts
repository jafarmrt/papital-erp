import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * TD-1250: the forced password change test went red in CI when one of its waits kept `waitFor`'s default 1 s
 * (the wait for the password change request, after TD-1189 had lengthened the later ones). Every wait in that
 * file goes through its own step limit, so a bare `waitFor(` call is refused here.
 */
const TEST_FILE = resolve(__dirname, 'forcedPasswordChange.test.tsx');

const bareWaits = (source: string) =>
  source.split('\n')
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => /\bwaitFor\(/.test(line) && !/\bwaitFor\(check, \{ timeout: APP_OPEN_TIMEOUT_MS \}\)/.test(line));

describe('forced password change test waits (TD-1250)', () => {
  it('every wait of the forced password change test has its own step limit', () => {
    expect(bareWaits(readFileSync(TEST_FILE, 'utf8'))).toEqual([]);
  });
});
