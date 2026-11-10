// v11 phase 8.2: the cart, the checkout, an order's page with the card-to-card receipt, «پیگیری سفارش» and «حساب من», as a
// browser without JavaScript uses them (plain forms posted to the server), against the mock Storefront API with
// ordering on. Run `npm run build` first (`npm test` does).
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequestHandler, type ServerBuild } from 'react-router';

const PORT = 3913;
const KEY = 'test-key-not-a-secret';
let mock: ChildProcess;
let handle: (request: Request) => Promise<Response>;

beforeAll(async () => {
  mock = spawn(process.execPath, [path.join(import.meta.dirname, '../mock/mockApi.mjs')], {
    env: { ...process.env, MOCK_PORT: String(PORT), MOCK_API_KEY: KEY, MOCK_ORDERING: '1', MOCK_SMS_LOGIN: '0' },
    stdio: 'pipe',
  });
  await new Promise<void>((resolve, reject) => {
    mock.stdout?.on('data', () => resolve());
    mock.on('error', reject);
  });
  process.env.STOREFRONT_API_URL = `http://127.0.0.1:${PORT}/api/storefront/v1`;
  process.env.STOREFRONT_API_KEY = KEY;
  process.env.STOREFRONT_SITE_URL = 'https://shop.example';
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

const cookieValue = (cookies: string[], name: string) => (cookies.find(c => c.startsWith(`${name}=`)) ?? '').split(';')[0];
const lastPost = async () => (await (await fetch(`http://127.0.0.1:${PORT}/__mock/last`)).json() as { post: { route: string; orderKey: string; session: string; body: Record<string, unknown> } }).post;

const address = { recipientName: 'گیرندهٔ آزمون', phone: '۰۹۱۲۱۲۳۴۵۶۷', province: 'تهران', city: 'تهران', address: 'خیابان آزمون، کوچهٔ نمونه، پلاک ۱', postalCode: '1234567890', note: '' };

describe('cart and checkout', () => {
  it('offers «افزودن به سبد» on a product while the site takes orders, and none on a sold-out one', async () => {
    const product = await page('/p/tile-necklace-sample');
    expect(product.html).toContain('افزودن به سبد');
    expect(product.html).toContain('action="/cart"');
    expect((await page('/p/gift-set-sample')).html).toMatch(/disabled=""[^>]*>.*فعلاً ناموجود/s);
  });

  it('keeps the cart in an httpOnly cookie, merges the same product and refuses a post from another site', async () => {
    const added = await post('/cart', { intent: 'add', slug: 'tile-necklace-sample', quantity: '۲' });
    expect(added.status).toBe(302);
    expect(added.location).toBe('/cart');
    const cart = added.cookies.find(c => c.startsWith('sf_cart='))!;
    expect(cart).toMatch(/HttpOnly/);
    expect(cart).toMatch(/SameSite=Lax/);
    const again = await post('/cart', { intent: 'add', slug: 'tile-necklace-sample', quantity: '1' }, cookieValue(added.cookies, 'sf_cart'));
    const view = await page('/cart', cookieValue(again.cookies, 'sf_cart'));
    expect(view.html).toContain('تعداد ۳');
    expect(view.html).toContain('۴٬۳۵۰٬۰۰۰ تومان');
    expect((await post('/cart', { intent: 'add', slug: 'no-such-product', quantity: '1' })).html).toContain('دیگر روی سایت نیست');
    expect((await post('/cart', { intent: 'add', slug: 'tile-necklace-sample', quantity: '1' }, '', { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    expect((await page('/cart', 'sf_cart=%E0%A4%A')).status).toBe(200);
    const removed = await post('/cart', { intent: 'remove', slug: 'tile-necklace-sample' }, cookieValue(again.cookies, 'sf_cart'));
    expect(removed.cookies.some(c => c.startsWith('sf_cart=;') && c.includes('Max-Age=0'))).toBe(true);
  });

  it('quotes the shipping, places the order once for a repeated request key, keeps its key and empties the cart', async () => {
    const added = await post('/cart', { intent: 'add', slug: 'tile-earrings-sample', quantity: '1' });
    const cart = cookieValue(added.cookies, 'sf_cart');
    expect((await page('/checkout')).location).toBe('/cart');
    const form = await page('/checkout', cart);
    const requestKey = /name="requestKey" value="([^"]+)"/.exec(form.html)?.[1] ?? '';
    expect(requestKey).toMatch(/^[0-9a-f-]{36}$/);

    const quoted = await post('/checkout', { intent: 'quote', requestKey, ...address }, cart);
    expect(quoted.html).toContain('پست پیشتاز');
    expect(quoted.html).toContain('اسنپ باکس');
    expect(quoted.html).toContain('ثبت سفارش');

    const refused = await post('/checkout', { intent: 'place', requestKey, ...address, postalCode: '123', shippingMethod: 'post' }, cart);
    expect(refused.html).toContain('کد پستی باید ۱۰ رقم باشد');
    expect(refused.html).toMatch(/id="field-postalCode"[^>]*aria-invalid="true"/);
    expect(refused.html).not.toContain(`value="${requestKey}"`);

    const placed = await post('/checkout', { intent: 'place', requestKey, ...address, shippingMethod: 'post' }, cart);
    expect(placed.status).toBe(302);
    expect(placed.location).toBe('/orders/100001?placed=1');
    const sent = await lastPost();
    expect(sent.body).toMatchObject({ requestKey, phone: '۰۹۱۲۱۲۳۴۵۶۷', shippingMethod: 'post', lines: [{ slug: 'tile-earrings-sample', quantity: 1 }] });
    expect(sent.body).not.toHaveProperty('paymentMethod');
    const kept = placed.cookies.find(c => c.startsWith('sf_orders='))!;
    expect(kept).toMatch(/HttpOnly/);
    expect(kept).toMatch(/Path=\/orders/);
    expect(placed.cookies.some(c => c.startsWith('sf_cart=;'))).toBe(true);
  });

  it('takes a discount code: its amount in the quote, a refused one under its field with the methods still shown, and the order', async () => {
    const cart = cookieValue((await post('/cart', { intent: 'add', slug: 'tile-earrings-sample', quantity: '1' })).cookies, 'sf_cart');
    const refused = await post('/checkout', { intent: 'quote', requestKey: 'rk-discount-check-0001', ...address, discountCode: 'NOPE' }, cart);
    expect(refused.html).toContain('این کد تخفیف شناخته نیست');
    expect(refused.html).toMatch(/id="field-discountCode"[^>]*aria-invalid="true"/);
    expect(refused.html).toContain('پست پیشتاز');

    const quoted = await post('/checkout', { intent: 'quote', requestKey: 'rk-discount-check-0001', ...address, discountCode: ' yalda ' }, cart);
    expect(quoted.html).toContain('پس از تخفیف');
    expect(quoted.html).toContain('YALDA');
    expect((await lastPost()).body).toMatchObject({ discountCode: 'yalda' });

    const placed = await post('/checkout', { intent: 'place', requestKey: 'rk-discount-check-0001', ...address, shippingMethod: 'post', discountCode: 'yalda' }, cart);
    expect(placed.status).toBe(302);
    expect((await lastPost()).body).toMatchObject({ discountCode: 'yalda', shippingMethod: 'post' });
    const kept = cookieValue(placed.cookies, 'sf_orders');
    const shown = await page(placed.location.split('?')[0], kept);
    expect(shown.html).toContain('تخفیف');
    expect(shown.html).toContain('YALDA');
  });
});

describe('an order page', () => {
  let orders = '';
  let number = '';

  beforeAll(async () => {
    const cart = cookieValue((await post('/cart', { intent: 'add', slug: 'tile-necklace-sample', quantity: '1' })).cookies, 'sf_cart');
    const placed = await post('/checkout', { intent: 'place', requestKey: 'rk-order-page-0001', ...address, phone: '09121234567', shippingMethod: 'post' }, cart);
    orders = cookieValue(placed.cookies, 'sf_orders');
    number = placed.location.replace(/^\/orders\/(\d+).*$/, '$1');
  });

  it('opens only with the kept key, never with the key in the address', async () => {
    expect((await page(`/orders/${number}`)).location).toBe(`/orders/track?number=${number}`);
    const view = await page(`/orders/${number}`, orders);
    expect(view.status).toBe(200);
    expect(view.html).toContain('در انتظار پرداخت');
    expect(view.html).toContain('6037 9900 0000 0000');
    expect(view.html).toContain('فرستادن رسید');
    expect(view.html).toContain('name="robots" content="noindex"');
  });

  it('sends the receipt with the key in a header, the toman amount in rial and the time on Tehran\'s clock', async () => {
    const form = new FormData();
    form.set('intent', 'receipt');
    form.set('reference', 'ABC12345');
    form.set('cardLast4', '۱۲۳۴');
    form.set('amount', '۱٬۴۵۵٬۰۰۰');
    form.set('day', '1');
    form.set('time', '۱۴:۳۰');
    form.set('image', new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'r.jpg', { type: 'image/jpeg' }));
    const sent = await post(`/orders/${number}`, form, orders);
    expect(sent.status).toBe(200);
    expect(sent.html).toContain('رسید شما رسید');
    const write = await lastPost();
    expect(write.route).toBe(`/orders/${number}/receipts`);
    expect(write.orderKey).toMatch(/^ok_mock/);
    expect(write.body).toMatchObject({ reference: 'ABC12345', amount: '14550000' });
    expect(String(write.body.image)).toMatch(/^data:image\/jpeg;base64,/);
    expect(new Date(String(write.body.paidAt)).getUTCMinutes()).toBe(0);
    expect(new Date(String(write.body.paidAt)).getUTCHours()).toBe(11);
  });

  it('refuses a photo that is not an image and a wrong time without calling the ERP', async () => {
    const form = new FormData();
    form.set('intent', 'receipt');
    form.set('time', '25:00');
    form.set('day', '0');
    expect((await post(`/orders/${number}`, form, orders)).html).toContain('ساعت واریز را مانند');
    form.set('time', '10:00');
    form.set('image', new File(['<svg/>'], 'r.svg', { type: 'image/svg+xml' }));
    expect((await post(`/orders/${number}`, form, orders)).html).toContain('JPEG، PNG یا WEBP');
  });

  it('opens on another phone after «پیگیری سفارش» with the number and key', async () => {
    const key = decodeURIComponent(orders.split('=')[1]).split('|')[0].split('.')[1];
    expect((await post('/orders/track', { number, key: 'ok_wrong-key-0000000000000000000000' })).html).toContain('پیدا نشد');
    const found = await post('/orders/track', { number: number.replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]), key });
    expect(found.status).toBe(302);
    expect(found.location).toBe(`/orders/${number}`);
    expect(cookieValue(found.cookies, 'sf_orders')).toContain(number);
  });
});

describe('«حساب من»', () => {
  it('sends a signed-out visitor to the sign-in and back', async () => {
    const res = await page('/account');
    expect(res.status).toBe(302);
    expect(res.location).toBe('/account/sign-in?next=%2Faccount');
  });

  it('lists the account\'s orders, adds a guest order with its key, and sends a receipt through the account', async () => {
    const made = await post('/account/sign-up', { intent: 'register', phone: '09129998877', name: 'خریدار حساب', password: 'رمز-آزمون-1405', next: '/' });
    const session = cookieValue(made.cookies, 'sf_session');
    expect(session).toMatch(/^sf_session=bs_/);
    expect((await page('/account', session)).html).toContain('هنوز سفارشی در این حساب نیست');

    // a guest order on this phone, then the buyer signs in and adds it from its page
    const cart = cookieValue((await post('/cart', { intent: 'add', slug: 'tile-necklace-sample', quantity: '1' })).cookies, 'sf_cart');
    const placed = await post('/checkout', { intent: 'place', requestKey: 'rk-account-claim-0001', ...address, shippingMethod: 'post' }, cart);
    const number = placed.location.replace(/^\/orders\/(\d+).*$/, '$1');
    const both = `${session}; ${cookieValue(placed.cookies, 'sf_orders')}`;
    expect((await page(`/orders/${number}`, both)).html).toContain('افزودن این سفارش به حساب من');
    const claimed = await post(`/orders/${number}`, { intent: 'claim' }, both);
    expect(claimed.html).toContain('سفارش به حساب شما افزوده شد');
    const account = await page('/account', session);
    expect(account.html).toContain(`href="/orders/${number}"`);

    // without the kept key the account still reads it and takes the receipt
    const form = new FormData();
    form.set('intent', 'receipt');
    form.set('reference', 'ACC12345');
    form.set('cardLast4', '4321');
    form.set('amount', '1455000');
    form.set('day', '0');
    form.set('time', '00:01');
    const sent = await post(`/orders/${number}`, form, session);
    expect(sent.html).toContain('رسید شما رسید');
    const write = await lastPost();
    expect(write.route).toBe(`/account/orders/${number}/receipts`);
    expect(write.orderKey).toBe('');
    expect(write.session).toMatch(/^bs_/);
  });
});

describe('«هدیهٔ سازمانی»', () => {
  it('sends the form with the budget in rial, says a refused field, and answers the request number', async () => {
    const form = await page('/corporate-gift');
    expect(form.status).toBe(200);
    expect(form.html).toContain('نام سازمان یا شرکت');
    const refused = await post('/corporate-gift', { organization: 'شرکت نمونه', contactName: 'رابط نمونه', phone: '12', quantity: '', budget: '', neededBy: '', note: '' });
    expect(refused.html).toContain('شمارهٔ تماس را با پیش‌شماره بنویسید');
    expect(refused.html).toMatch(/id="field-phone"[^>]*aria-invalid="true"/);
    const sent = await post('/corporate-gift', { organization: 'شرکت نمونه', contactName: 'رابط نمونه', phone: '۰۲۱-۸۸۷۷۶۶۵۵', quantity: '۱۲۰', budget: '۲۰۰٬۰۰۰٬۰۰۰', neededBy: '۱۴۰۵/۱۰/۱۵', note: '' });
    expect(sent.html).toContain('درخواست شما رسید');
    expect((await lastPost()).body).toMatchObject({ organization: 'شرکت نمونه', phone: '۰۲۱-۸۸۷۷۶۶۵۵', quantity: 120, budget: '2000000000', neededBy: '۱۴۰۵/۱۰/۱۵' });
    expect((await post('/corporate-gift', { organization: 'x' }, '', { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
  });
});

// v12 phase 7 (site review 1.3, 2.10): a retail buyer orders at most five of an item, and while the ERP signs in by SMS a
// guest proves the phone at «ثبت سفارش» (the code on the same form; the proof waits in a cookie of the checkout page only)
describe('the retail cap and the guest phone proof', () => {
  const smsLogin = (on: boolean) => fetch(`http://127.0.0.1:${PORT}/__mock/sms-login?on=${on ? 1 : 0}`);
  afterAll(async () => { await smsLogin(false); });

  it('stops «یکی بیشتر» at five, says why a row above it cannot be ordered and holds the checkout back', async () => {
    const atCap = cookieValue((await post('/cart', { intent: 'add', slug: 'tile-earrings-sample', quantity: '5' })).cookies, 'sf_cart');
    const capped = await page('/cart', atCap);
    expect(capped.html).toMatch(/disabled=""[^>]*aria-label="یکی بیشتر"/);
    expect(capped.html).toContain('ادامهٔ خرید و ثبت نشانی');
    const over = cookieValue((await post('/cart', { intent: 'add', slug: 'tile-earrings-sample', quantity: '6' })).cookies, 'sf_cart');
    const view = await page('/cart', over);
    expect(view.html).toContain('در خرید تکی از هر کالا حداکثر ۵ عدد');
    expect(view.html).not.toContain('ادامهٔ خرید و ثبت نشانی');
    // a cart edited by hand reaches the checkout: the ERP refuses the quote and the page links back to the cart
    const quote = await post('/checkout', { intent: 'quote', requestKey: 'rk-retail-cap-check-01', ...address }, over);
    expect(quote.html).toContain('حداکثر ۵ عدد');
    expect(quote.html).toContain('بازگشت به سبد خرید');
  });

  it('sends a code at the first «ثبت سفارش» of a guest, places the order with the proof and clears it', async () => {
    await smsLogin(true);
    const cart = cookieValue((await post('/cart', { intent: 'add', slug: 'tile-earrings-sample', quantity: '1' })).cookies, 'sf_cart');
    const requestKey = 'rk-guest-proof-check-0001';
    const asked = await post('/checkout', { intent: 'place', requestKey, ...address, shippingMethod: 'post' }, cart);
    expect(asked.status).toBe(200);
    expect(asked.html).toContain('کد تأیید به');
    expect(asked.html).toContain('name="code"');
    expect(asked.html).toContain('name="codeFor" value="09121234567"');

    const wrong = await post('/checkout', { intent: 'place', requestKey, ...address, shippingMethod: 'post', codeFor: '09121234567', code: '000000' }, cart);
    expect(wrong.html).toContain('کد درست نیست');
    expect(wrong.html).toContain('name="code"');

    // a refusal after the code (here the postal code): the order rolled back, so the proof waits for the next tap
    const refused = await post('/checkout', { intent: 'place', requestKey, ...address, postalCode: '123', shippingMethod: 'post', codeFor: '09121234567', code: '123456' }, cart);
    expect(refused.html).toContain('کد پستی باید ۱۰ رقم باشد');
    const proof = refused.cookies.find(c => c.startsWith('sf_checkout_proof='))!;
    expect(proof).toMatch(/HttpOnly/);
    expect(proof).toMatch(/Path=\/checkout/);

    const nextKey = /name="requestKey" value="([^"]+)"/.exec(refused.html)?.[1] ?? '';
    const placed = await post('/checkout', { intent: 'place', requestKey: nextKey, ...address, shippingMethod: 'post' }, `${cart}; ${cookieValue(refused.cookies, 'sf_checkout_proof')}`);
    expect(placed.status).toBe(302);
    expect((await lastPost()).body).toMatchObject({ phoneProof: 'pp_mock09121234567' });
    expect(placed.cookies.some(c => c.startsWith('sf_checkout_proof=;') && c.includes('Max-Age=0'))).toBe(true);
  });

  it('asks a signed-in buyer for no code', async () => {
    await smsLogin(true);
    const proven = await post('/account/sign-up', { intent: 'verify-code', phone: '09127654321', code: '123456' });
    const made = await post('/account/sign-up', { intent: 'register', phone: '09127654321', name: 'خریدار حساب‌دار', password: 'رمز-آزمون-1405' }, cookieValue(proven.cookies, 'sf_proof'));
    const session = cookieValue(made.cookies, 'sf_session');
    expect(session).toMatch(/^sf_session=/);
    const cart = cookieValue((await post('/cart', { intent: 'add', slug: 'tile-earrings-sample', quantity: '1' }, session)).cookies, 'sf_cart');
    const placed = await post('/checkout', { intent: 'place', requestKey: 'rk-signed-in-proof-0001', ...address, phone: '09127654321', shippingMethod: 'post' }, `${cart}; ${session}`);
    expect(placed.status).toBe(302);
    expect((await lastPost()).body).not.toHaveProperty('phoneProof');
  });
});
