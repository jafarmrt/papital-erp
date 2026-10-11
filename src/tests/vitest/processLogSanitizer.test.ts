import { describe, expect, it } from 'vitest';
import { sanitizeObject } from '../../middleware/logger';

/**
 * OBS-R1-03 (TD-983), v10.0.264: the process log scrubber recognises a secret key like the audit scrubber does
 * (`isSecretAuditKey`), so «author» or «authority» are no longer hidden, and it also scrubs secrets written as plain
 * text (`password=…`, `token: …`), which only the JSON form `"password": "…"` used to be.
 */
describe('process log sanitizer (OBS-R1-03)', () => {
  it('keeps keys that merely contain "auth"', () => {
    expect(sanitizeObject({ author: 'Sara', authority: 'tax office', authorName: 'Ali' })).toEqual({
      author: 'Sara', authority: 'tax office', authorName: 'Ali',
    });
  });

  it('still hides secret keys in any spelling', () => {
    const out = sanitizeObject({ password: 'p1', apiKey: 'k1', 'x-api-key': 'k2', authorization: 'Basic abc', auth: 'abc', consumer_secret: 's', csrfToken: 't' });
    for (const value of Object.values(out)) expect(value).toBe('[REDACTED]');
  });

  it('scrubs secrets written as plain text', () => {
    const lines = [
      'login failed for user=ali password=hunter2 from 10.0.0.1',
      'GET /setup?token=s3cr3t-value&step=1',
      'connect with api_key: AKIA12345 and consumer_secret=cs_live_999',
      "retry with Password='abc 123'",
    ];
    const out = lines.map(line => sanitizeObject(line) as string);
    for (const secret of ['hunter2', 's3cr3t-value', 'AKIA12345', 'cs_live_999', 'abc 123']) {
      expect(out.join('\n')).not.toContain(secret);
    }
    expect(out[0]).toContain('user=ali');
    expect(out[1]).toContain('step=1');
  });

  it('still scrubs the JSON form and bearer tokens', () => {
    const out = sanitizeObject('body {"newPassword":"n1","password":"p1"} header Bearer aaa.bbb.ccc') as string;
    expect(out).not.toMatch(/n1|p1|aaa\.bbb/);
  });
});
