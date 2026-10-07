/**
 * v9.0.213 (TD-530, B02-15, owner decision t7 A): the audit sanitizer recognises secret keys by "contains", in any
 * spelling (camelCase, snake_case, kebab-case, any case), and masks card, account and Sheba numbers down to their last
 * four digits. It used to match only whole snake_case names: cardNumber, shebaNumber, csrfToken, consumerSecret,
 * webhookSecret, nobitexPassword and setupToken stayed in clear.
 */
import { describe, expect, it } from 'vitest';
import { isBankNumberAuditKey, isSecretAuditKey, maskBankNumber, sanitizeAuditValue, sanitizeSensitiveData } from '../../lib/audit/auditSanitizer';

describe('audit sanitizer (TD-530)', () => {
  it('protects the secrets of R08 in any spelling and keeps flags', () => {
    const out = sanitizeSensitiveData({
      csrfToken: 'a1b2c3', consumerSecret: 'cs_live_123', webhookSecret: 'whsec', nobitexPassword: 'p@ss', setupToken: 'st-1',
      'x-api-key': 'k', API_KEY: 'k2', 'Set-Cookie': 'auth_token=1', jwtSecret: 'j', refresh_token: 'r', Authorization: 'Basic x',
      password: '', nested: { userPassword: 'p', list: [{ privateKey: 'pk' }] },
      nobitexPasswordChanged: true, tokenVersion: 3, mustResetPassword: 1, username: 'ali',
    }) as Record<string, unknown>;
    for (const key of ['csrfToken', 'consumerSecret', 'webhookSecret', 'nobitexPassword', 'setupToken', 'x-api-key', 'API_KEY',
      'Set-Cookie', 'jwtSecret', 'refresh_token', 'Authorization', 'password']) {
      expect(out[key], key).toBe('[PROTECTED]');
    }
    expect(out.nested).toEqual({ userPassword: '[PROTECTED]', list: [{ privateKey: '[PROTECTED]' }] });
    expect(out).toMatchObject({ nobitexPasswordChanged: true, tokenVersion: 3, mustResetPassword: 1, username: 'ali' });
  });

  it('masks card, account and Sheba numbers to their last four digits and keeps the bank name', () => {
    const out = sanitizeSensitiveData({
      after: {
        bankInfo: { bankName: 'ملت', accountNumber: '1234567890', shaba: 'IR820540102680020817909002', cardNumber: '6104-3378-1234-5678' },
        shebaNumber: 'IR06 0120 0000 0000 1234 5678 90', card_number: '۶۰۳۷۹۹۱۸۱۲۳۴۵۶۷۸', iban: 'IR12', cards: ['6037991899991111'],
      },
    }) as { after: Record<string, unknown> };
    expect(out.after.bankInfo).toEqual({ bankName: 'ملت', accountNumber: '****7890', shaba: '****9002', cardNumber: '****5678' });
    expect(out.after).toMatchObject({ shebaNumber: '****7890', card_number: '****5678', iban: '****', cards: ['****1111'] });
  });

  it('masks a field-by-field change by its own key, so a Sheba change stays visible', () => {
    expect(sanitizeAuditValue('shaba', 'IR820540102680020817905678')).toBe('****5678');
    expect(sanitizeAuditValue('nobitexPassword', 'new-secret')).toBe('[PROTECTED]');
    expect(sanitizeAuditValue('name', 'ali')).toBe('ali');
    // logActivity sanitizes the details again after computeAuditDiff: a masked value stays as it is
    expect(sanitizeSensitiveData({ changes: { shaba: { before: '****9002', after: '****5678' } } }))
      .toEqual({ changes: { shaba: { before: '****9002', after: '****5678' } } });
    expect(maskBankNumber('6104-****-****-5678')).toBe('****5678');
  });

  it('does not take ordinary keys for secrets or bank numbers', () => {
    for (const key of ['description', 'wildcard', 'accountId', 'accountCode', 'discount', 'bankName', 'code']) {
      expect(isSecretAuditKey(key) || isBankNumberAuditKey(key), key).toBe(false);
    }
    expect(maskBankNumber('—')).toBe('—');
  });
});
