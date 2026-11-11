import { describe, expect, it } from 'vitest';
import { checkedAddress, isTestMailServer } from '../../services/storefront/storefrontEmailClient.js';
import { maskedUsername } from '../../lib/storefront/storefrontEmailRules.js';

/**
 * v12 phase 8e: the mail server's address is checked like any outgoing address (AGENTS.md §5.7) before a connection,
 * also for a name: every address it answers must be outside, and the connection goes to a checked one.
 */
const production = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;
const answers = (...addresses: string[]) => async () => addresses.map(address => ({ address }));

describe('the mail server address check', () => {
  it('refuses inside, loopback and reserved literals in every form', async () => {
    for (const host of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::ffff:127.0.0.1', 'fe80::1', 'fd00::1']) {
      expect(await checkedAddress(host, 587, production, answers())).toHaveProperty('error');
    }
  });

  it('refuses a name with any inside answer, in any order, and keeps a public one', async () => {
    expect(await checkedAddress('mail.example.com', 587, production, answers('93.184.216.34', '10.0.0.5'))).toHaveProperty('error');
    expect(await checkedAddress('mail.example.com', 587, production, answers('::1', '93.184.216.34'))).toHaveProperty('error');
    expect(await checkedAddress('mail.example.com', 587, production, answers())).toHaveProperty('error');
    expect(await checkedAddress('mail.example.com', 587, production, answers('93.184.216.34'))).toEqual({ address: '93.184.216.34' });
  });

  it('reaches this machine only for the database tests own server', () => {
    const testEnv = { NODE_ENV: 'test', ERP_EMAIL_TEST_SMTP: '127.0.0.1:2525' } as NodeJS.ProcessEnv;
    expect(isTestMailServer('127.0.0.1', 2525, testEnv)).toBe(true);
    expect(isTestMailServer('127.0.0.1', 2526, testEnv)).toBe(false);
    expect(isTestMailServer('127.0.0.1', 2525, { ...testEnv, NODE_ENV: 'production' })).toBe(false);
    expect(isTestMailServer('localhost', 2525, testEnv)).toBe(false);
  });

  it('masks a user name in the audit row', () => {
    expect(maskedUsername('shop@papital.example')).toBe('s…@papital.example');
    expect(maskedUsername('mailer')).toBe('m…');
    expect(maskedUsername('')).toBe('');
  });
});
