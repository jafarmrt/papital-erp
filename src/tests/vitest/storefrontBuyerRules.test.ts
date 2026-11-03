import { describe, expect, it } from 'vitest';
import {
  groupCodeError, normalizeEconomicCode, normalizeNationalId, passwordError, setPasswordLinkOf,
} from '../../lib/storefront/storefrontBuyerRules';
import { PASSWORD_TOKEN_PREFIX, SESSION_TOKEN_PREFIX, hashPassword, newToken, presentedToken, tokenHash, verifyPassword } from '../../services/storefront/storefrontBuyerSecrets';

/** v11 phase 8.2b: the pure rules of site buyer accounts and the secrets they keep */
describe('storefront buyer rules', () => {
  it('refuses short, repeated and phone passwords', () => {
    expect(passwordError('کوتاه', '09121234567')).toMatch(/دست‌کم/);
    expect(passwordError('aaaaaaaaaa', '09121234567')).toMatch(/تکراری/);
    expect(passwordError('09121234567', '09121234567')).toMatch(/شمارهٔ همراه/);
    expect(passwordError('۹۱۲۱۲۳۴۵۶۷', '09121234567')).toMatch(/شمارهٔ همراه/);
    expect(passwordError('گالری-پاپیتال-۱۴۰۵', '09121234567')).toBeNull();
  });

  it('reads optional ids with any digits', () => {
    expect(normalizeNationalId('')).toBe('');
    expect(normalizeNationalId('۱۰۱۰۰۵۴۳۲۱۰')).toBe('10100543210');
    expect(normalizeNationalId('123')).toBeNull();
    expect(normalizeEconomicCode('4111-1111-1111')).toBe('411111111111');
    expect(normalizeEconomicCode('41111')).toBeNull();
  });

  it('takes only lower-case Latin group codes', () => {
    expect(groupCodeError('wholesale')).toBeNull();
    expect(groupCodeError('Wholesale')).not.toBeNull();
    expect(groupCodeError('عمده')).not.toBeNull();
  });

  it('keeps the set-password token after #, out of server logs', () => {
    expect(setPasswordLinkOf('pw_abc')).toMatch(/\/account\/set-password#pw_abc$/);
  });
});

describe('storefront buyer secrets', () => {
  it('hashes a password with scrypt and checks it', async () => {
    const hash = await hashPassword('رمز-آزمون-1405');
    expect(hash.startsWith('scrypt$16384$8$1$')).toBe(true);
    expect(await verifyPassword('رمز-آزمون-1405', hash)).toBe(true);
    expect(await verifyPassword('رمز-دیگر-1405', hash)).toBe(false);
    expect(await verifyPassword('anything', '')).toBe(false);
    expect(await verifyPassword('anything', 'bcrypt$x')).toBe(false);
  });

  it('makes 256-bit tokens and accepts only their shape', () => {
    const token = newToken(SESSION_TOKEN_PREFIX);
    expect(token).toMatch(/^bs_[A-Za-z0-9_-]{43}$/);
    expect(tokenHash(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(presentedToken(token, SESSION_TOKEN_PREFIX)).toBe(token);
    expect(presentedToken(token, PASSWORD_TOKEN_PREFIX)).toBe('');
    expect(presentedToken(`${token}' OR 1=1`, SESSION_TOKEN_PREFIX)).toBe('');
  });
});
