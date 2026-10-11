import { describe, expect, it } from 'vitest';
import { normalizeError } from '../../errors/customErrors';
import { errorLogEntry } from '../../middleware/logger';

// OBS-R1-02: the error log entry (written to the JSON log files) carries the path without its query string,
// like the access log, so a token or search text in the address never reaches the log files.
describe('error_log_url_obs_r1_02', () => {
  it('drops the query string from the logged url', () => {
    const entry = errorLogEntry(normalizeError(new Error('boom')), {
      method: 'GET',
      url: '/setup?token=secret-setup-token',
      originalUrl: '/api/auth/setup?token=secret-setup-token&q=search-text',
    });
    expect(entry.url).toBe('/api/auth/setup');
    expect(JSON.stringify(entry)).not.toContain('secret-setup-token');
    expect(JSON.stringify(entry)).not.toContain('search-text');
  });

  it('keeps a url without a query string', () => {
    expect(errorLogEntry(normalizeError(new Error('boom')), { method: 'GET', url: '/api/items' }).url).toBe('/api/items');
  });
});
