// v11 phase 8.4b: the sign-in, sign-up and set-password pages as a browser without JavaScript uses them: plain forms
// posted to the server, against the mock Storefront API (code 123456, proof pp_mock<phone>). Run `npm run build` first.
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequestHandler, type ServerBuild } from 'react-router';

const PORT = 3912;
const KEY = 'test-key-not-a-secret';
let mock: ChildProcess;
let handle: (request: Request) => Promise<Response>;

beforeAll(async () => {
  mock = spawn(process.execPath, [path.join(import.meta.dirname, '../mock/mockApi.mjs')], {
    env: { ...process.env, MOCK_PORT: String(PORT), MOCK_API_KEY: KEY },
    stdio: 'pipe',
  });
  await new Promise<void>((resolve, reject) => {
    mock.stdout?.on('data', () => resolve());
    mock.on('error', reject);
  });
  process.env.STOREFRONT_API_URL = `http://127.0.0.1:${PORT}/api/storefront/v1`;
  process.env.STOREFRONT_API_KEY = KEY;
  process.env.STOREFRONT_SITE_URL = 'https://shop.example';
  process.env.STOREFRONT_TRUST_PROXY = '1';
  const build = await import(path.join(import.meta.dirname, '../build/server/index.js')) as ServerBuild;
  // as server.mjs does: the site's own host is an allowed origin of a form post
  handle = createRequestHandler({ ...build, allowedActionOrigins: ['shop.example'] }, 'production');
});

afterAll(() => {
  mock?.kill();
});

const page = async (pathname: string, cookie = '') => {
  const res = await handle(new Request(`http://localhost${pathname}`, { headers: cookie ? { cookie } : {} }));
  return { status: res.status, html: await res.text() };
};

const post = async (pathname: string, fields: Record<string, string>, headers: Record<string, string> = {}) => {
  const res = await handle(new Request(`http://localhost${pathname}`, {
    method: 'POST', body: new URLSearchParams(fields), headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'http://localhost', ...headers },
  }));
  return { status: res.status, location: res.headers.get('location') ?? '', cookies: res.headers.getSetCookie(), html: res.status === 200 ? await res.text() : '' };
};

const cookieValue = (cookies: string[], name: string) => (cookies.find(c => c.startsWith(`${name}=`)) ?? '').split(';')[0];
const last = async () => (await fetch(`http://127.0.0.1:${PORT}/__mock/last`)).json() as Promise<{ clientIp: string; session: string }>;

describe('account pages', () => {
  it('shows the SMS sign-in form and the password form, never indexed', async () => {
    const { status, html } = await page('/account/sign-in');
    expect(status).toBe(200);
    expect(html).toContain('فرستادن کد ورود');
    expect(html).toMatch(/autocomplete="tel"/i);
    expect(html).toContain('ورود با رمز');
    expect(html).toContain('name="robots" content="noindex"');
  });

  it('sends a code, then signs a new phone on to the sign-up with its proof kept in an httpOnly cookie', async () => {
    const sent = await post('/account/sign-in', { intent: 'send-code', phone: '۰۹۱۲ ۳۴۵ ۶۷۸۹', next: '/' }, { 'X-Real-IP': '203.0.113.7' });
    expect(sent.status).toBe(200);
    expect(sent.html).toContain('one-time-code');
    expect(sent.html).toContain('09123456789');
    expect((await last()).clientIp).toBe('203.0.113.7');

    const wrongCode = await post('/account/sign-in', { intent: 'verify-code', phone: '09123456789', code: '000000', next: '/' });
    expect(wrongCode.html).toContain('کد درست نیست');

    const verified = await post('/account/sign-in', { intent: 'verify-code', phone: '09123456789', code: '123456', next: '/p/tile-necklace-sample' });
    expect(verified.status).toBe(302);
    expect(verified.location).toBe('/account/sign-up?next=%2Fp%2Ftile-necklace-sample');
    const proof = verified.cookies.find(c => c.startsWith('sf_proof='));
    expect(proof).toMatch(/HttpOnly/);
    expect(proof).toMatch(/SameSite=Lax/);
    expect(proof).toMatch(/Secure/);
    expect(proof).toMatch(/Path=\/account/);

    const details = await page('/account/sign-up?next=%2Fp%2Ftile-necklace-sample', cookieValue(verified.cookies, 'sf_proof'));
    expect(details.html).toContain('تأیید شد');
    expect(details.html).toMatch(/autocomplete="new-password"/i);

    const made = await post('/account/sign-up', { intent: 'register', phone: '09123456789', name: 'خریدار آزمون', password: 'رمز-آزمون-1405', next: '/p/tile-necklace-sample' },
      { cookie: cookieValue(verified.cookies, 'sf_proof') });
    expect(made.status).toBe(302);
    expect(made.location).toBe('/p/tile-necklace-sample');
    const session = made.cookies.find(c => c.startsWith('sf_session='));
    expect(session).toMatch(/^sf_session=bs_/);
    expect(session).toMatch(/HttpOnly/);
    expect(session).toMatch(/Max-Age=2592000/);
    expect(made.cookies.some(c => c.startsWith('sf_proof=;') && c.includes('Max-Age=0'))).toBe(true);
  });

  it('signs an existing phone in by SMS, and by password', async () => {
    const sms = await post('/account/sign-in', { intent: 'verify-code', phone: '09123456789', code: '123456', next: '/' });
    expect(sms.status).toBe(302);
    expect(sms.location).toBe('/');
    expect(cookieValue(sms.cookies, 'sf_session')).toMatch(/^sf_session=bs_/);

    const bad = await post('/account/sign-in', { intent: 'password', phone: '09123456789', password: 'not-the-password' });
    expect(bad.status).toBe(200);
    expect(bad.html).toContain('شمارهٔ همراه یا رمز درست نیست');
    const good = await post('/account/sign-in', { intent: 'password', phone: '09123456789', password: 'رمز-آزمون-1405' });
    expect(good.status).toBe(302);
    expect(cookieValue(good.cookies, 'sf_session')).toMatch(/^sf_session=bs_/);
  });

  it('never sends a buyer to another site after signing in', async () => {
    const away = await post('/account/sign-in', { intent: 'password', phone: '09123456789', password: 'رمز-آزمون-1405', next: '//evil.example/x' });
    expect(away.location).toBe('/');
    for (const next of ['/\t/evil.example', '/%09/evil.example', '/\\evil.example', '/\n/evil.example', 'https://evil.example', '/a\\b']) {
      const tricked = await post('/account/sign-in', { intent: 'password', phone: '09123456789', password: 'رمز-آزمون-1405', next });
      expect(tricked.location, next).toBe(next === '/%09/evil.example' ? next : '/');
    }
    const kept = await post('/account/sign-in', { intent: 'password', phone: '09123456789', password: 'رمز-آزمون-1405', next: '/p/tile-necklace-sample?x=1#top' });
    expect(kept.location).toBe('/p/tile-necklace-sample?x=1#top');
  });

  it('refuses account forms posted from another site', async () => {
    for (const pathname of ['/account/sign-in', '/account/sign-up', '/account/set-password', '/account/sign-out']) {
      const fromAway = await post(pathname, { intent: 'password', phone: '09123456789', password: 'رمز-آزمون-1405' }, { Origin: 'https://evil.example' });
      expect([400, 403], pathname).toContain(fromAway.status); // React Router's own guard answers 400 first
      expect(fromAway.cookies, pathname).toEqual([]);
      const fetchSite = await post(pathname, { intent: 'password', phone: '09123456789', password: 'رمز-آزمون-1405' }, { 'Sec-Fetch-Site': 'cross-site' });
      expect(fetchSite.status, pathname).toBe(403);
    }
    const ownSite = await post('/account/sign-in', { intent: 'password', phone: '09123456789', password: 'رمز-آزمون-1405' }, { Origin: 'https://shop.example', 'Sec-Fetch-Site': 'same-origin' });
    expect(ownSite.status).toBe(302);
  });

  it('refuses a sign-up without a proven phone while SMS sign-in is on', async () => {
    const made = await post('/account/sign-up', { intent: 'register', phone: '09129998877', name: 'بی کد', password: 'رمز-آزمون-1405' });
    expect(made.status).toBe(200);
    expect(made.html).toContain('با کد پیامکی تأیید کنید');
  });

  it('sets a password from the link key the page reads after #, and signs out with a POST', async () => {
    const view = await page('/account/set-password');
    expect(view.status).toBe(200);
    expect(view.html).toContain('گذاشتن رمز حساب');
    const wrong = await post('/account/set-password', { token: 'pw_notalink0000', password: 'رمز-آزمون-1405' });
    expect(wrong.html).toContain('دیگر کار نمی‌کند');
    const set = await post('/account/set-password', { token: 'pw_mocklink0001', password: 'رمز-آزمون-1405' });
    expect(set.status).toBe(302);
    const session = cookieValue(set.cookies, 'sf_session');
    expect(session).toMatch(/^sf_session=bs_/);

    const out = await post('/account/sign-out', {}, { cookie: session });
    expect(out.status).toBe(302);
    expect((await last()).session).toBe(session.replace('sf_session=', ''));
    expect(out.cookies.some(c => c.startsWith('sf_session=;') && c.includes('Max-Age=0'))).toBe(true);
    expect((await page('/account/sign-out')).status).toBe(302);
  });
});

// v12 phase 7 (site review 1.4): a search is limited per visitor, names the visitor to the ERP, and only that visitor
// gets the «too many searches» page
describe('the per-visitor search limit', () => {
  const search = async (q: string, ip: string) => {
    const res = await handle(new Request(`http://localhost/products?q=${encodeURIComponent(q)}`, { headers: { 'X-Real-IP': ip } }));
    return { status: res.status, html: await res.text(), retryAfter: res.headers.get('retry-after') };
  };

  it('passes the visitor to the ERP and answers 429 past thirty searches a minute, for that visitor only', async () => {
    const first = await search('انگشتر ۰', '203.0.113.50');
    expect(first.status).toBe(200);
    expect((await last()).clientIp).toBe('203.0.113.50');
    for (let i = 1; i < 30; i++) expect((await search(`انگشتر ${i}`, '203.0.113.50')).status).toBe(200);
    const over = await search('انگشتر ۳۱', '203.0.113.50');
    expect(over.status).toBe(429);
    expect(over.html).toContain('جست‌وجوی زیادی در یک دقیقه');
    expect(Number(over.retryAfter)).toBeGreaterThan(0);
    expect((await search('انگشتر ۳۱', '198.51.100.20')).status).toBe(200);
    // browsing without a search is never limited
    expect((await page('/products')).status).toBe(200);
  });
});
