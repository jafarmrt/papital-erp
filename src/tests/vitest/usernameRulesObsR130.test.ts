import { describe, expect, it } from 'vitest';
import { USERNAME_FORMAT_MESSAGE, usernameFormatError, usernameKey } from '../../lib/users/usernameRules';
import { buildUsernameUniquenessHealthTest } from '../../services/users/usernameUniqueness';

const PERSIAN_NAME = 'علی';
const LIVE_USER = 'کاربر فعال';

describe('OBS-R1-30: the rule of a new username', () => {
  it('takes 3 to 50 Latin letters, digits, dot, underscore or hyphen', () => {
    for (const ok of ['ali', 'Ali.Rezaei', 'ali_rezaei-2', 'a'.repeat(50), ' admin ']) expect(usernameFormatError(ok)).toBeNull();
    for (const bad of ['ab', 'a'.repeat(51), 'ali rezaei', 'ali@shop', PERSIAN_NAME, '']) expect(usernameFormatError(bad)).toBe(USERNAME_FORMAT_MESSAGE);
  });

  it('compares usernames regardless of letter case and surrounding spaces', () => {
    expect(usernameKey(' Ali ')).toBe(usernameKey('aLI'));
  });
});

describe('OBS-R1-30: the health check lists usernames that differ only in letter case', () => {
  it('warns while duplicates or the missing index remain and names each pair', () => {
    const report = buildUsernameUniquenessHealthTest([
      { id: 4, username: 'Ali', fullName: 'A' },
      { id: 9, username: 'ali', fullName: 'B' },
    ], false);
    expect(report.status).toBe('warning');
    expect(report.count).toBe(1);
    expect(report.items?.[1]?.subtitle).toBe(LIVE_USER);
    expect(report.items?.[0]?.details).toContain('#۴');
    expect(report.items?.[0]?.details).toContain('#۹');
    expect(buildUsernameUniquenessHealthTest([], true).status).toBe('healthy');
    expect(buildUsernameUniquenessHealthTest([], false).status).toBe('warning');
  });
});
