import { describe, expect, it } from 'vitest';
import { scrubExportRow } from '../../lib/system/exportSecretScrub';

// TD-1251: every exported row is masked before it is written (export review of 2026-10-12)
describe('scrubExportRow (TD-1251)', () => {
  it('masks a webhook rule token and header values and keeps the address', () => {
    const row = { id: 7, actionConfigJson: { url: 'https://partner.invalid/hook', secretToken: 'abc', headers: { 'X-Partner': 'k1' } } };
    expect(scrubExportRow(row)).toEqual({
      id: 7, actionConfigJson: { url: 'https://partner.invalid/hook', secretToken: '********', headers: { 'X-Partner': '********' } },
    });
  });

  it('masks secret-like keys at any depth and in arrays, in any spelling', () => {
    const row = { meta: [{ api_key: 'x', nested: { clientSecret: 'y', 'auth-token': 'z', password: '' } }], customHeaders: { A: 'b' } };
    expect(scrubExportRow(row)).toEqual({
      meta: [{ api_key: '********', nested: { clientSecret: '********', 'auth-token': '********', password: '' } }],
      customHeaders: { A: '********' },
    });
  });

  it('leaves numbers, flags and ordinary text unchanged', () => {
    const row = { tokenVersion: 3, mustResetPassword: 0, name: 'قانون', notes: 'secret meeting', hasSecret: true };
    expect(scrubExportRow(row)).toEqual(row);
  });
});
