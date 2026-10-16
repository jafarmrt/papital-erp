import { describe, expect, it } from 'vitest';
import { BOT_API_BASE, botApiBase, loopbackTestApiBase, MESSENGER_TEST_API_BASE_ENV } from '../../services/messenger/messengerClient';

/**
 * v10.1.43 (messenger notifications plan part 4): the end-to-end test's fake Bot API is reached only on this machine; any
 * other address in the variable is ignored, so a bot token is never sent elsewhere through it.
 */
describe('messenger test API base', () => {
  it('is read only as a plain http origin on a loopback host', () => {
    expect(loopbackTestApiBase('http://127.0.0.1:3199')).toBe('http://127.0.0.1:3199');
    expect(loopbackTestApiBase('http://localhost:3199/')).toBe('http://localhost:3199');
    expect(loopbackTestApiBase('http://[::1]:3199')).toBe('http://[::1]:3199');
  });

  it('ignores another host, https, a path, a query or credentials', () => {
    for (const raw of [
      'http://evil.example:3199', 'https://127.0.0.1:3199', 'http://127.0.0.1.evil.example', 'http://127.0.0.1:3199/x',
      'http://127.0.0.1:3199?a=1', 'http://u:p@127.0.0.1:3199', 'http://10.0.0.5', 'not a url', '',
    ]) expect(loopbackTestApiBase(raw)).toBeNull();
  });

  it('keeps the real APIs unless the variable holds a loopback origin', () => {
    expect(botApiBase('telegram', {})).toBe(BOT_API_BASE.telegram);
    expect(botApiBase('bale', { [MESSENGER_TEST_API_BASE_ENV]: 'http://attacker.example' })).toBe(BOT_API_BASE.bale);
    expect(botApiBase('bale', { [MESSENGER_TEST_API_BASE_ENV]: 'http://127.0.0.1:3199' })).toBe('http://127.0.0.1:3199/bale');
  });
});
