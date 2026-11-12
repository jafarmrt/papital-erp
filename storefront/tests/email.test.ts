// v12 phase 8e: the site's pages with email («حالت بی پیامک»: the texts off, the email on), as a browser without
// JavaScript uses them, against the mock Storefront API (the right email code is 654321). Run `npm run build` first.
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequestHandler, type ServerBuild } from 'react-router';

const PORT = 3917;
const KEY = 'test-key-not-a-secret';
let mock: ChildProcess;
let handle: (request: Request) => Promise<Response>;

beforeAll(async () => {
  mock = spawn(process.execPath, [path.join(import.meta.dirname, '../mock/mockApi.mjs')], {
    env: { ...process.env, MOCK_PORT: String(PORT), MOCK_API_KEY: KEY, MOCK_ORDERING: '1', MOCK_SMS_LOGIN: '0', MOCK_EMAIL_LOGIN: '1' },
    stdio: 'pipe',
  });
  await new Promise<void>((resolve, reject) => {
    mock.stdout?.on('data', () => resolve());
    mock.on('error', reject);
  });
  process.env.STOREFRONT_API_URL = `http://127.0.0.1:${PORT}/api/storefront/v1`;
  process.env.STOREFRONT_API_KEY = KEY;
  process.env.STOREFRONT_SITE_URL = 'https://shop.example';
  process.env.STOREFRONT_FORM_MIN_SECONDS = '0';
  const build = await import(path.join(import.meta.dirname, '../build/server/index.js')) as ServerBuild;
  handle = createRequestHandler({ ...build, allowedActionOrigins: ['shop.example'] }, 'production');
});

afterAll(() => {
  mock?.kill();
});

const page = async (pathname: string, cookie = '') => {
  const res = await handle(new Request(`http://localhost${pathname}`, { headers: cookie ? { cookie } : {} }));
  return { status: res.status, location: res.headers.get('location') ?? '', html: res.status === 200 ? await res.text() : '' };
};

const post = async (pathname: string, body: Record<string, string> | FormData, cookie = '', headers: Record<string, string> = {}) => {
  const isForm = body instanceof FormData;
  const res = await handle(new Request(`http://localhost${pathname}`, {
    method: 'POST', body: isForm ? body : new URLSearchParams(body),
    headers: { ...(isForm ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }), Origin: 'http://localhost', ...(cookie ? { cookie } : {}), ...headers },
  }));
  return { status: res.status, location: res.headers.get('location') ?? '', cookies: res.headers.getSetCookie(), html: res.status === 200 ? await res.text() : '' };
};

// v12 phase 8a: the robot-trap stamp a form page carries (any page's stamp is good, and the minimum time is 0 here)
const stamp = async () => /name="formAt" value="([^"]+)"/.exec((await page('/corporate-gift')).html)?.[1] ?? '';

const cookieValue = (cookies: string[], name: string) => (cookies.find(c => c.startsWith(`${name}=`)) ?? '').split(';')[0];
const lastPost = async () => (await (await fetch(`http://127.0.0.1:${PORT}/__mock/last`)).json() as { post: { route: string; orderKey: string; session: string; body: Record<string, unknown> } }).post;

const address = { recipientName: 'گیرندهٔ آزمون', phone: '۰۹۱۲۱۲۳۴۵۶۷', province: 'تهران', city: 'تهران', address: 'خیابان آزمون، کوچهٔ نمونه، پلاک ۱', postalCode: '1234567890', note: '' };

const EMAIL = 'buyer.mail@example.com';

describe('email accounts and orders', () => {
  it('makes an account with an email: the code, the proof in an httpOnly cookie, then the details', async () => {
    const signUpPage = await page('/account/sign-up');
    expect(signUpPage.html).toContain('name="contact"');
    expect(signUpPage.html).toContain('ایمیل');
    const sent = await post('/account/sign-up', { intent: 'send-code', contact: EMAIL });
    expect(sent.html).toContain('کد تأیید به ایمیل');
    const wrong = await post('/account/sign-up', { intent: 'verify-code', contact: EMAIL, code: '000000' });
    expect(wrong.html).toContain('کد درست نیست');
    const proven = await post('/account/sign-up', { intent: 'verify-code', contact: EMAIL, code: '654321' });
    const kept = cookieValue(proven.cookies, 'sf_email_proof');
    expect(proven.cookies.find(c => c.startsWith('sf_email_proof='))).toMatch(/HttpOnly/);
    const details = await page('/account/sign-up', kept);
    expect(details.html).toContain(`ایمیل `);
    expect(details.html).toContain(EMAIL);
    const made = await post('/account/sign-up', { intent: 'register', name: 'خریدار ایمیلی', password: 'رمز-آزمون-1405', phone: '', formAt: await stamp() }, kept);
    expect(made.status).toBe(302);
    expect(cookieValue(made.cookies, 'sf_session')).toMatch(/^sf_session=/);
    expect((await lastPost()).body).toMatchObject({ email: EMAIL, emailProof: expect.stringMatching(/^ep_mock/) });
  });

  it('signs in by an email code and by the email and password, and sets a forgotten password by an email code', async () => {
    const asked = await post('/account/sign-in', { intent: 'send-code', contact: EMAIL, next: '/' });
    expect(asked.html).toContain('کد ورود به ایمیل');
    const byCode = await post('/account/sign-in', { intent: 'verify-code', contact: EMAIL, code: '654321', next: '/' });
    expect(byCode.status).toBe(302);
    expect(cookieValue(byCode.cookies, 'sf_session')).toMatch(/^sf_session=/);
    const byPassword = await post('/account/sign-in', { intent: 'password', contact: EMAIL, password: 'رمز-آزمون-1405', next: '/' });
    expect(byPassword.status).toBe(302);
    expect((await page('/account/sign-in')).html).toContain('/account/forgot-password');
    const forgot = await post('/account/forgot-password', { intent: 'send-code', contact: EMAIL });
    expect(forgot.html).toContain('name="code"');
    const reset = await post('/account/forgot-password', { intent: 'reset', contact: EMAIL, code: '654321', password: 'رمز-تازهٔ-1405' });
    expect(reset.status).toBe(302);
    expect((await post('/account/sign-in', { intent: 'password', contact: EMAIL, password: 'رمز-تازهٔ-1405', next: '/' })).status).toBe(302);
    const session = cookieValue(byPassword.cookies, 'sf_session');
    expect((await page('/account', session)).status).toBe(302);
  });

  it('asks a guest for an email and its code at «ثبت سفارش», and opens the order elsewhere by the email', async () => {
    const cart = cookieValue((await post('/cart', { intent: 'add', slug: 'tile-earrings-sample', quantity: '1' })).cookies, 'sf_cart');
    const form = await page('/checkout', cart);
    expect(form.html).toContain('name="email"');
    const first = await post('/checkout', { intent: 'place', requestKey: 'rk-email-guest-0001', ...address, email: 'guest.mail@example.com', shippingMethod: 'post' }, cart);
    expect(first.html).toContain('کد تأیید به ایمیل');
    expect(first.html).toContain('name="codeVia" value="email"');
    const placed = await post('/checkout', { intent: 'place', requestKey: 'rk-email-guest-0001', ...address, email: 'guest.mail@example.com', codeVia: 'email', codeFor: 'guest.mail@example.com', code: '654321', shippingMethod: 'post' }, cart);
    expect(placed.status).toBe(302);
    expect((await lastPost()).body).toMatchObject({ email: 'guest.mail@example.com', emailProof: expect.stringMatching(/^ep_mock/) });
    const number = /\/orders\/(\d+)/.exec(placed.location)?.[1] ?? '';
    const sent = await post('/orders/track', { intent: 'send-code', number, contact: 'guest.mail@example.com' });
    expect(sent.html).toContain('کد تأیید به ایمیل');
    const opened = await post('/orders/track', { intent: 'verify-code', number, contact: 'guest.mail@example.com', code: '654321' });
    expect(opened.status).toBe(302);
    expect(opened.location).toBe(`/orders/${number}`);
    const other = await post('/orders/track', { intent: 'verify-code', number, contact: 'someone.else@example.com', code: '654321' });
    expect(other.html).toContain('سفارشی با این شماره برای این شمارهٔ همراه یا ایمیل پیدا نشد');
  });

  it('adds a phone to an email-only account from «ایمیل و شمارهٔ حساب»', async () => {
    const signed = await post('/account/sign-in', { intent: 'password', contact: EMAIL, password: 'رمز-تازهٔ-1405', next: '/' });
    const session = cookieValue(signed.cookies, 'sf_session');
    const account = await page('/account', session);
    expect(account.html).toContain('/account/contact');
    expect(account.html).toContain('افزودن شمارهٔ همراه');
    const contactPage = await page('/account/contact', session);
    expect(contactPage.html).toContain('شمارهٔ همراه ندارد.');
  });
});
