/**
 * v9.0.77 (TD-528, B02-13): login, logout and setup accept only the application's own origin.
 */
import { describe, expect, it } from 'vitest';
import { browserSourceOrigin, sessionOriginAllowed } from '../../middleware/sessionOrigin';

const prod = { nodeEnv: 'production', allowedOrigins: 'https://erp.example.ir', appUrl: '' };
const dev = { nodeEnv: 'development', allowedOrigins: '', appUrl: '' };

describe('TD-528 session endpoint origin', () => {
  it('reads Origin first, then the Referer origin, and treats null as opaque', () => {
    expect(browserSourceOrigin({ origin: 'https://a.ir', referer: 'https://b.ir/x' })).toEqual({ kind: 'origin', origin: 'https://a.ir' });
    expect(browserSourceOrigin({ referer: 'https://b.ir/page?q=1' })).toEqual({ kind: 'origin', origin: 'https://b.ir' });
    expect(browserSourceOrigin({ origin: 'null' })).toEqual({ kind: 'opaque' });
    expect(browserSourceOrigin({})).toEqual({ kind: 'none' });
  });

  it('accepts the request host itself, the allow list and APP_URL in production, and nothing else', () => {
    expect(sessionOriginAllowed('http://185.10.10.10:3000', '185.10.10.10:3000', prod)).toBe(true);
    expect(sessionOriginAllowed('https://erp.example.ir', 'internal:3000', prod)).toBe(true);
    expect(sessionOriginAllowed('https://app.example.ir', 'internal:3000', { ...prod, appUrl: 'https://app.example.ir/login' })).toBe(true);
    expect(sessionOriginAllowed('https://evil.example', 'erp.example.ir', prod)).toBe(false);
    expect(sessionOriginAllowed('http://localhost:5173', 'erp.example.ir', prod)).toBe(false);
    expect(sessionOriginAllowed('https://x.run.app', 'erp.example.ir', prod)).toBe(false);
    expect(sessionOriginAllowed('https://evil.example', 'erp.example.ir', { ...prod, allowedOrigins: '*' })).toBe(false);
  });

  it('outside production also accepts localhost and Google preview hosts, never an arbitrary site', () => {
    expect(sessionOriginAllowed('http://localhost:5173', 'localhost:3000', dev)).toBe(true);
    expect(sessionOriginAllowed('https://ais-dev-abc.run.app', 'other', dev)).toBe(true);
    expect(sessionOriginAllowed('https://evil.example', 'localhost:3000', dev)).toBe(false);
  });
});
