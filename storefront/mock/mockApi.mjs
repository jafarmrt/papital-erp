// A stand-in for the ERP Storefront API (`/api/storefront/v1`, phase 8.1) for development, tests and the preview.
// It answers the same read routes (and, since 8.4b, the account routes) with the same contract (`src/lib/storefront/storefrontContracts.ts`) from a fixture
// folder: `catalog.json` ({ products: StorefrontProductDetail[] with itemId }), optional `settings.json` and
// `brand.json` ({ logo, favicon } data URLs), and `media/`.
// Fixtures with real photos stay outside the repository; `mock/sample` is a small synthetic one.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const dir = path.resolve(process.env.FIXTURE_DIR ?? path.join(import.meta.dirname, 'sample'));
const port = Number(process.env.MOCK_PORT ?? 3901);
const key = process.env.MOCK_API_KEY ?? 'preview-key';
const PAGE_MAX = 60;
const SORTS = ['default', 'newest', 'price_asc', 'price_desc'];

/** STOREFRONT_QUERY_TEXT_MAX and STOREFRONT_SLUG_MAX of src/lib/storefront/storefrontRules.ts */
const TEXT_MAX = 100;
const SLUG_MAX = 120;
const { products } = JSON.parse(await readFile(path.join(dir, 'catalog.json'), 'utf8'));
const settings = await readFile(path.join(dir, 'settings.json'), 'utf8').then(JSON.parse).catch(() => ({
  currency: 'IRR',
  payment: { cardNumber: '', cardHolder: '', bankName: '', iban: '' },
  freeShippingThreshold: '',
  reservationHours: 24,
  stockDisplay: 'status',
  whatsapp: '',
  shippingMethods: [],
}));

// v11 phase 8.4b: the SMS sign-in, on unless MOCK_SMS_LOGIN=0
settings.smsLogin = process.env.MOCK_SMS_LOGIN !== '0';
// v11 phase 8.2: ordering (the cart and checkout), on only with MOCK_ORDERING=1; the card to pay to is a made-up one
settings.ordering = process.env.MOCK_ORDERING === '1';
if (settings.ordering && !settings.payment.cardNumber) settings.payment = { cardNumber: '6037990000000000', cardHolder: 'فروشگاه نمونه', bankName: 'بانک نمونه', iban: 'IR000000000000000000000000' };

const brand = await readFile(path.join(dir, 'brand.json'), 'utf8').then(JSON.parse).catch(() => ({ logo: '', favicon: '' }));
// phase 8.5: the old-address redirects (`redirects.json`, a list of { from, kind, target }) and the search and statistics
// settings (`seo.json`, or MOCK_SEO as JSON for a test); both optional
const redirectList = await readFile(path.join(dir, 'redirects.json'), 'utf8').then(JSON.parse).catch(() => []);
const seo = process.env.MOCK_SEO ? JSON.parse(process.env.MOCK_SEO) : await readFile(path.join(dir, 'seo.json'), 'utf8').then(JSON.parse).catch(() => ({
  verification: { google: '', bing: '' }, analytics: { provider: 'none', id: '', url: '' }, alternateSiteUrl: '',
}));

// phase 8.5b: «صفحه‌های ویژه» on the site now (`campaigns.json`, a list of pages whose `products` are slugs of the catalog;
// MOCK_CAMPAIGNS=0 for none)
const campaignList = process.env.MOCK_CAMPAIGNS === '0' ? [] : await readFile(path.join(dir, 'campaigns.json'), 'utf8').then(JSON.parse).catch(() => []);
const campaignSummary = ({ slug, title, summary, hero, homeBanner, endsOn }) => ({ slug, title, summary, hero, homeBanner, endsOn });

const fold = s => String(s).toLowerCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[‌\s]+/g, ' ');
const card = ({ slug, sku, name, category, collections, retailPrice, stock, cover }) => ({ slug, sku, name, category, collections, retailPrice, stock, cover });
// like the ERP: the transfer code links items of one design («هم‌طرح») and is never sent
const detail = ({ itemId: _id, transferCode, ...rest }) => ({
  ...rest,
  sameDesign: transferCode ? products.filter(p => p.transferCode === transferCode && p.slug !== rest.slug).slice(0, 12).map(card) : [],
});
const cmp = (a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
const facet = values => {
  const counts = new Map();
  for (const v of values) if (v && v.trim()) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, 'fa'));
};

// v11 phase 8.4b: buyer accounts in memory. The SMS code is always 123456; a proof is `pp_mock` + the phone; the one
// set-password link is pw_mocklink0001. `GET /__mock/last` (without the key) tells the tests what the site sent last.
const accounts = new Map();
const sessions = new Map();
let last = { clientIp: '', session: '' };
/** the last order write (route, key header and body), kept apart since the page's own reads follow it */
let lastPost = null;
const readBody = req => new Promise(resolve => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
});
const proofOk = (phone, proof) => typeof proof === 'string' && proof === `pp_mock${phone}`;
const view = a => ({ name: a.name, phone: a.phone, city: '', kind: 'retail', application: a.application ?? 'none', companyName: a.companyName ?? '', phoneVerified: a.verified, group: null });
const session = a => {
  const token = `bs_mock${sessions.size + 1}x${a.phone}`;
  sessions.set(token, a.phone);
  return { sessionToken: token, expiresAt: new Date(Date.now() + 30 * 864e5).toISOString(), account: view(a) };
};

async function auth(req, res, route) {
  const body = await readBody(req);
  const phone = String(body.phone ?? '');
  const refuse = (status, code, error) => send(res, status, { error, code });
  if (route === '/auth/otp/request') return /^09\d{9}$/.test(phone) ? send(res, 202, { data: { resendAfter: 60, expiresIn: 180 } }) : refuse(422, 'STOREFRONT_OTP_PHONE_INVALID', 'شمارهٔ همراه را درست بنویسید.');
  if (route === '/auth/otp/verify') return body.code === '123456' ? send(res, 200, { data: { phoneProof: `pp_mock${phone}`, expiresIn: 600 } }) : refuse(422, 'STOREFRONT_OTP_INVALID', 'کد درست نیست یا مهلتش گذشته است؛ کد را دوباره بخواهید.');
  if (route === '/auth/sms-login') {
    if (!proofOk(phone, body.phoneProof)) return refuse(422, 'STOREFRONT_PHONE_PROOF_REQUIRED', 'شمارهٔ همراه را با کد پیامکی تأیید کنید.');
    const account = accounts.get(phone);
    if (!account) return refuse(404, 'STOREFRONT_ACCOUNT_NOT_FOUND', 'حسابی با این شمارهٔ همراه نیست؛ حساب تازه بسازید.');
    account.verified = true;
    return send(res, 200, { data: session(account) });
  }
  if (route === '/auth/register') {
    if (accounts.has(phone)) return refuse(409, 'STOREFRONT_ACCOUNT_EXISTS', 'برای این شمارهٔ همراه حساب ساخته شده است؛ وارد شوید.');
    if ((settings.smsLogin || body.phoneProof) && !proofOk(phone, body.phoneProof)) return refuse(422, 'STOREFRONT_PHONE_PROOF_REQUIRED', 'شمارهٔ همراه را با کد پیامکی تأیید کنید.');
    if (String(body.password ?? '').length < 8) return refuse(422, 'STOREFRONT_ACCOUNT_FIELD_INVALID', 'رمز دست‌کم ۸ نویسه است.');
    const account = { name: String(body.name ?? ''), phone, password: String(body.password), verified: Boolean(body.phoneProof) };
    accounts.set(phone, account);
    return send(res, 201, { data: session(account) });
  }
  if (route === '/auth/login') {
    const account = accounts.get(phone);
    return account && account.password === body.password ? send(res, 200, { data: session(account) }) : refuse(401, 'STOREFRONT_SIGN_IN_FAILED', 'شمارهٔ همراه یا رمز درست نیست.');
  }
  if (route === '/auth/set-password') {
    if (body.token !== 'pw_mocklink0001') return refuse(404, 'STOREFRONT_PASSWORD_LINK_INVALID', 'این پیوند تعیین رمز دیگر کار نمی‌کند.');
    const account = { name: 'خریدار عمدهٔ نمونه', phone: '09120000001', password: String(body.password ?? ''), verified: false };
    accounts.set(account.phone, account);
    return send(res, 200, { data: session(account) });
  }
  if (route === '/auth/logout') {
    sessions.delete(String(req.headers['x-buyer-session'] ?? ''));
    return send(res, 200, { success: true });
  }
  return refuse(404, 'NOT_FOUND', 'پیدا نشد');
}

// v11 phase 8.2: orders in memory. Prices are the retail ones; the post costs 500000 rial (free over the threshold),
// the courier is paid on delivery and only in Tehran. A key is `ok_mock` + the number, padded to the ERP's length.
const orders = new Map();
const byRequestKey = new Map();
let nextNumber = 100001;
let nextLead = 501;
const keyOf = number => `ok_mock${number}`.padEnd(46, 'x');
const STATUS_TITLES = { awaiting_payment: 'در انتظار پرداخت', payment_submitted: 'در انتظار تأیید پرداخت', awaiting_approval: 'در انتظار تأیید فروشگاه' };
const priced = lines => {
  const out = [];
  for (const l of Array.isArray(lines) ? lines : []) {
    const p = products.find(x => x.slug === l.slug);
    if (!p || !Number.isInteger(l.quantity) || l.quantity < 1) return null;
    out.push({ slug: p.slug, sku: p.sku, name: p.name, quantity: l.quantity, unitPrice: p.retailPrice, lineAmount: (BigInt(p.retailPrice) * BigInt(l.quantity)).toString() });
  }
  return out.length ? out : null;
};
// v11 phase 8.2c: one mock code, YALDA (10% in whole tomans); any other code is refused on its field
const discountOf = (raw, items) => {
  const code = latin(raw).replace(/\s+/g, '').toUpperCase();
  if (!code) return null;
  if (code !== 'YALDA') return 'bad';
  const amount = (items / 10n / 10n) * 10n;
  return { code, title: 'تخفیف یلدا', amount: amount.toString(), amountToman: (amount / 10n).toString() };
};
const discountRefused = res => send(res, 422, { error: 'این کد تخفیف شناخته نیست یا دیگر کار نمی‌کند.', code: 'STOREFRONT_DISCOUNT_NOT_APPLICABLE', details: { field: 'discountCode' } });
const quoteOf = (province, lines, discount = null) => {
  const items = lines.reduce((sum, l) => sum + BigInt(l.lineAmount), 0n);
  const free = settings.freeShippingThreshold && items - BigInt(discount?.amount ?? 0) >= BigInt(settings.freeShippingThreshold);
  const options = [{ code: 'post', title: 'پست پیشتاز', description: '', kind: 'cost', amount: free ? '0' : '500000', amountToman: free ? '0' : '50000', free: Boolean(free) }];
  if (province === 'تهران') options.push({ code: 'snapp', title: 'اسنپ باکس', description: 'فقط در تهران، همان روز.', kind: 'on_delivery', amount: '0', amountToman: '0', free: false });
  return { itemsAmount: items.toString(), discount, options };
};
const orderView = o => {
  const waiting = o.status === 'awaiting_payment';
  return {
    number: o.number, status: o.status, statusTitle: STATUS_TITLES[o.status], createdAt: o.createdAt, payBefore: waiting ? new Date(Date.parse(o.createdAt) + 24 * 3600e3).toISOString() : null,
    recipient: o.recipient, note: o.note, shipping: o.shipping, lines: o.lines, itemsAmount: o.itemsAmount, payableAmount: o.payableAmount,
    payableToman: (BigInt(o.payableAmount) / 10n).toString(), payment: waiting ? settings.payment : null, canSendReceipt: waiting, receipts: o.receipts,
    trackingCode: '', cancelReason: null, cancelReasonTitle: '', paymentMethod: 'card', paymentMethodTitle: 'کارت‌به‌کارت', wholesale: false,
    discount: o.discount ?? null,
  };
};
// the ERP takes Persian and Arabic digits in every field a buyer types (start plan §9الف)
const latin = v => String(v ?? '').replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const accountOf = req => sessions.get(String(req.headers['x-buyer-session'] ?? ''));
const fieldError = (res, field, error) => send(res, 422, { error, code: 'STOREFRONT_ORDER_FIELD_INVALID', details: { field } });
// v12 phase 7 (the ERP's rules): a retail buyer orders at most 5 of an item (the mock has no buyer groups), and while the
// site signs in by SMS a guest's order presents the phone proof of its phone
const RETAIL_LINE_QUANTITY_MAX = 5;
const overRetailCap = (res, lines) => {
  const over = lines.find(l => l.quantity > RETAIL_LINE_QUANTITY_MAX);
  if (!over) return false;
  send(res, 422, { error: 'در خرید تکی از هر کالا حداکثر ۵ عدد سفارش داده می‌شود؛ برای تعداد بیشتر با فروشگاه تماس بگیرید.', code: 'STOREFRONT_RETAIL_LINE_CAP', details: { field: 'lines', slug: over.slug } });
  return true;
};

async function ordering(req, res, route) {
  if (!settings.ordering) return send(res, 404, { error: 'پیدا نشد' });
  const body = req.method === 'POST' ? await readBody(req) : {};
  if (req.method === 'POST') lastPost = { route, orderKey: String(req.headers['x-order-key'] ?? ''), session: String(req.headers['x-buyer-session'] ?? ''), body };
  const presentedKey = String(req.headers['x-order-key'] ?? '');
  if (route === '/shipping/quote') {
    if (!body.province) return fieldError(res, 'province', 'استان را از فهرست انتخاب کنید.');
    const lines = priced(body.lines);
    if (!lines) return fieldError(res, 'lines', 'این کالا روی سایت فروخته نمی‌شود.');
    if (overRetailCap(res, lines)) return undefined;
    const discount = discountOf(body.discountCode, lines.reduce((sum, l) => sum + BigInt(l.lineAmount), 0n));
    return discount === 'bad' ? discountRefused(res) : send(res, 200, { data: quoteOf(body.province, lines, discount) });
  }
  if (route === '/orders' && req.method === 'POST') {
    const again = byRequestKey.get(body.requestKey);
    if (again) return send(res, 201, { data: { order: orderView(again), accessKey: keyOf(again.number) } });
    if (String(body.recipientName ?? '').trim().length < 2) return fieldError(res, 'recipientName', 'نام و نام خانوادگی گیرنده را بنویسید.');
    if (!/^09\d{9}$/.test(latin(body.phone))) return fieldError(res, 'phone', 'شمارهٔ همراه باید ۱۱ رقم و با ۰۹ آغاز شود.');
    if (!/^\d{10}$/.test(latin(body.postalCode))) return fieldError(res, 'postalCode', 'کد پستی باید ۱۰ رقم باشد.');
    if (body.paymentMethod === 'on_account') return fieldError(res, 'paymentMethod', 'پرداخت «به حساب» برای این حساب باز نیست.');
    const lines = priced(body.lines);
    if (!lines) return fieldError(res, 'lines', 'این کالا روی سایت فروخته نمی‌شود.');
    if (overRetailCap(res, lines)) return undefined;
    if (settings.smsLogin && !accountOf(req) && !proofOk(latin(body.phone), body.phoneProof)) {
      return send(res, 422, { error: 'شمارهٔ همراه را با کد پیامکی تأیید کنید؛ اگر کد گرفته‌اید و مهلتش گذشته، کد تازه بخواهید.', code: 'STOREFRONT_PHONE_PROOF_REQUIRED', details: { field: 'phoneProof' } });
    }
    const discount = discountOf(body.discountCode, lines.reduce((sum, l) => sum + BigInt(l.lineAmount), 0n));
    if (discount === 'bad') return discountRefused(res);
    const quote = quoteOf(body.province, lines, discount);
    const option = quote.options.find(o => o.code === body.shippingMethod);
    if (!option) return fieldError(res, 'shippingMethod', 'این روش ارسال برای این سبد و استان در دسترس نیست؛ روش دیگری انتخاب کنید.');
    const number = String(nextNumber++);
    const order = {
      number, status: 'awaiting_payment', createdAt: new Date().toISOString(), account: accountOf(req) ?? null,
      recipient: { name: body.recipientName, phone: body.phone, province: body.province, city: body.city, address: body.address, postalCode: body.postalCode },
      note: body.note ?? '', shipping: { code: option.code, title: option.title, kind: option.kind, amount: option.amount }, lines,
      itemsAmount: quote.itemsAmount, payableAmount: (BigInt(quote.itemsAmount) - BigInt(discount?.amount ?? 0) + BigInt(option.amount)).toString(), receipts: [], discount,
    };
    orders.set(number, order);
    byRequestKey.set(body.requestKey, order);
    return send(res, 201, { data: { order: orderView(order), accessKey: keyOf(number) } });
  }
  const receipt = (order) => {
    if (order.status !== 'awaiting_payment') return send(res, 409, { error: 'برای این سفارش اکنون رسید پذیرفته نمی‌شود.', code: 'STOREFRONT_RECEIPT_NOT_EXPECTED' });
    if (!/^[A-Za-z0-9]{4,40}$/.test(String(body.reference ?? ''))) return send(res, 422, { error: 'شمارهٔ پیگیری یا ارجاع واریز را درست بنویسید (۴ تا ۴۰ رقم یا حرف لاتین).', code: 'STOREFRONT_RECEIPT_FIELD_INVALID', details: { field: 'reference' } });
    order.status = 'payment_submitted';
    order.receipts.push({ reference: body.reference, paidAt: body.paidAt, cardLast4: String(body.cardLast4).slice(-4), amount: body.amount, status: 'pending', statusTitle: 'در انتظار بررسی', rejectReason: '', createdAt: new Date().toISOString() });
    return send(res, 201, { data: orderView(order) });
  };
  const keyed = /^\/orders\/(\d+)(\/receipts)?$/.exec(route);
  if (keyed) {
    const order = orders.get(keyed[1]);
    if (!order || presentedKey !== keyOf(order.number)) return send(res, 404, { error: 'سفارش پیدا نشد.', code: 'STOREFRONT_ORDER_NOT_FOUND' });
    return keyed[2] ? receipt(order) : send(res, 200, { data: orderView(order) });
  }
  const phone = accountOf(req);
  if (!phone) return send(res, 401, { error: 'برای این کار وارد حساب خود شوید.', code: 'STOREFRONT_SESSION_REQUIRED' });
  if (route === '/account/orders/claim') {
    const order = orders.get(String(body.number ?? ''));
    if (!order || body.accessKey !== keyOf(order.number)) return send(res, 404, { error: 'سفارش پیدا نشد.', code: 'STOREFRONT_ORDER_NOT_FOUND' });
    if (order.account && order.account !== phone) return send(res, 409, { error: 'این سفارش به حساب دیگری وصل است.', code: 'STOREFRONT_ORDER_CLAIMED' });
    order.account = phone;
    return send(res, 200, { data: orderView(order) });
  }
  if (route === '/account/orders') {
    const mine = [...orders.values()].filter(o => o.account === phone).reverse();
    const data = mine.map(o => ({ number: o.number, createdAt: o.createdAt, status: o.status, statusTitle: STATUS_TITLES[o.status], payableAmount: o.payableAmount, payableToman: (BigInt(o.payableAmount) / 10n).toString(), paymentMethod: 'card', itemCount: o.lines.length }));
    return send(res, 200, { data: { data, total: data.length, page: 1, limit: 20 } });
  }
  const own = /^\/account\/orders\/(\d+)(\/receipts)?$/.exec(route);
  if (own) {
    const order = orders.get(own[1]);
    if (!order || order.account !== phone) return send(res, 404, { error: 'سفارش پیدا نشد.', code: 'STOREFRONT_ORDER_NOT_FOUND' });
    return own[2] ? receipt(order) : send(res, 200, { data: orderView(order) });
  }
  return send(res, 404, { error: 'پیدا نشد' });
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://mock');
  const route = url.pathname.replace(/^\/api\/storefront\/v1/, '');
  if (url.pathname === '/__mock/last') return send(res, 200, { ...last, post: lastPost });
  // v12 phase 7: the tests turn the SMS sign-in on and off while the mock runs (the guest's phone proof at the checkout)
  if (url.pathname === '/__mock/sms-login') {
    settings.smsLogin = url.searchParams.get('on') === '1';
    return send(res, 200, { smsLogin: settings.smsLogin });
  }
  if (req.headers.authorization !== `Bearer ${key}`) return send(res, 401, { error: 'کلید برنامه سایت پذیرفته نشد.' });
  last = { clientIp: String(req.headers['x-storefront-client-ip'] ?? ''), session: String(req.headers['x-buyer-session'] ?? '') };
  if (req.method === 'POST' && route.startsWith('/auth/')) return auth(req, res, route);
  if (route === '/shipping/quote' || route.startsWith('/orders') || route.startsWith('/account/orders')) return ordering(req, res, route);
  // v11 phase 8.2c: the corporate gift form makes a CRM lead in the ERP; here a number, or a refusal on the phone field
  if (route === '/inquiries/corporate-gift' && req.method === 'POST') {
    const body = await readBody(req);
    lastPost = { route, orderKey: '', session: '', body };
    if (String(body.organization ?? '').trim().length < 2) return fieldError(res, 'organization', 'نام سازمان یا شرکت را بنویسید.');
    if (!/^\+?\d{8,15}$/.test(latin(body.phone).replace(/[\s()-]/g, ''))) return fieldError(res, 'phone', 'شمارهٔ تماس را با پیش‌شماره بنویسید (۸ تا ۱۵ رقم).');
    return send(res, 201, { data: { reference: String(nextLead++) } });
  }
  // v12 phase 8a: the wholesale request (the ERP's rules in storefrontWholesaleApply.service.ts): a guest's request makes a
  // pending account for its phone, so it needs the phone's proof while SMS is on and refuses a phone with an account
  if (route === '/wholesale/apply' && req.method === 'POST') {
    const body = await readBody(req);
    lastPost = { route, orderKey: '', session: String(req.headers['x-buyer-session'] ?? ''), body };
    const signed = accountOf(req);
    const phone = signed ?? latin(body.phone);
    if (String(body.companyName ?? '').trim().length < 2) return send(res, 422, { error: 'نام فروشگاه یا شرکت را بنویسید.', code: 'STOREFRONT_ACCOUNT_FIELD_INVALID', details: { field: 'companyName' } });
    if (!signed && settings.smsLogin && !proofOk(phone, body.phoneProof)) return send(res, 422, { error: 'شمارهٔ همراه را با کد پیامکی تأیید کنید.', code: 'STOREFRONT_PHONE_PROOF_REQUIRED' });
    const existing = accounts.get(phone);
    if (!signed && existing) return send(res, 409, { error: 'برای این شمارهٔ همراه حساب ساخته شده است؛ وارد شوید.', code: 'STOREFRONT_ACCOUNT_EXISTS' });
    const account = existing ?? { name: String(body.name ?? ''), phone, password: '', verified: Boolean(body.phoneProof) };
    Object.assign(account, { application: 'pending', companyName: String(body.companyName) });
    accounts.set(phone, account);
    return send(res, 201, { data: view(account) });
  }
  if (route === '/account/prices') return send(res, 200, { data: { group: '', prices: [] } });
  if (route === '/account') {
    const phone = sessions.get(String(req.headers['x-buyer-session'] ?? ''));
    return phone ? send(res, 200, { data: view(accounts.get(phone)) }) : send(res, 401, { error: 'برای این کار وارد حساب خود شوید.', code: 'STOREFRONT_SESSION_REQUIRED' });
  }
  if (route === '/settings') return send(res, 200, { data: settings });
  if (route === '/brand') return send(res, 200, { data: brand });
  if (route === '/seo') return send(res, 200, { data: seo });
  if (route === '/redirects') return send(res, 200, { data: redirectList });
  // phase 8.5b: the product feed, the same fields as the ERP's (storefrontFeed.service.ts)
  if (route === '/feed') {
    return send(res, 200, {
      data: products.map(p => ({
        slug: p.slug, sku: p.sku, name: p.name, category: p.category, collections: p.collections, retailPrice: p.retailPrice,
        description: (p.seoDescription || p.description || '').slice(0, 5000), material: p.material ?? '', color: p.color ?? '',
        inStock: p.stock.status !== 'out', images: (p.images.length ? p.images : p.cover ? [p.cover] : []).slice(0, 10),
      })),
    });
  }
  if (route === '/campaigns') return send(res, 200, { data: campaignList.map(campaignSummary) });
  const campaignSlug = /^\/campaigns\/([^/]+)$/.exec(route);
  if (campaignSlug) {
    let wanted = '';
    try { wanted = decodeURIComponent(campaignSlug[1]); } catch { return send(res, 400, { error: 'درخواست نادرست' }); }
    const page = campaignList.find(c => c.slug === wanted);
    if (!page) return send(res, 404, { error: 'این صفحه پیدا نشد.', code: 'STOREFRONT_CAMPAIGN_NOT_FOUND' });
    const items = page.products.map(slug => products.find(p => p.slug === slug)).filter(Boolean).map(card);
    return send(res, 200, { data: { ...campaignSummary(page), body: page.body, discountCode: page.discountCode, products: items } });
  }
  if (route === '/facets') {
    return send(res, 200, { data: { collections: facet(products.flatMap(p => p.collections)), categories: facet(products.map(p => p.category)) } });
  }
  if (route === '/products') {
    const q = fold(url.searchParams.get('q') ?? '');
    const collection = url.searchParams.get('collection') ?? '';
    const category = url.searchParams.get('category') ?? '';
    const sort = url.searchParams.get('sort') ?? 'default';
    const page = Number(url.searchParams.get('page') ?? 1);
    const limit = Math.min(PAGE_MAX, Number(url.searchParams.get('limit') ?? 24));
    // the ERP's own limits (src/routes/storefrontApi.routes.ts): a longer text is a 400 there too
    const tooLong = [url.searchParams.get('q'), collection, category].some(t => (t ?? '').length > TEXT_MAX);
    if (tooLong || !SORTS.includes(sort) || !(page >= 1) || !(limit >= 1)) return send(res, 400, { error: 'درخواست نادرست' });
    let list = products.filter(p => (!collection || p.collections.includes(collection)) && (!category || p.category === category)
      && (!q || fold(`${p.name} ${p.sku} ${p.collections.join(' ')}`).includes(q)));
    if (sort === 'newest') list = [...list].sort((a, b) => b.itemId - a.itemId);
    if (sort === 'price_asc') list = [...list].sort((a, b) => cmp(a.retailPrice, b.retailPrice) || a.itemId - b.itemId);
    if (sort === 'price_desc') list = [...list].sort((a, b) => cmp(b.retailPrice, a.retailPrice) || a.itemId - b.itemId);
    return send(res, 200, { data: list.slice((page - 1) * limit, page * limit).map(card), total: list.length, page, limit });
  }
  const slug = /^\/products\/([^/]+)$/.exec(route);
  if (slug) {
    if (decodeURIComponent(slug[1]).length > SLUG_MAX) return send(res, 400, { error: 'درخواست نادرست' });
    const found = products.find(p => p.slug === decodeURIComponent(slug[1]));
    return found ? send(res, 200, { data: detail(found) }) : send(res, 404, { error: 'محصول پیدا نشد.' });
  }
  const media = /^\/media\/([0-9a-f]{64}(-thumb)?\.webp)$/.exec(route);
  if (media) {
    try {
      const file = await readFile(path.join(dir, 'media', media[1]));
      return send(res, 200, file, { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=31536000, immutable' });
    } catch {
      return send(res, 404, { error: 'پیدا نشد' });
    }
  }
  return send(res, 404, { error: 'پیدا نشد' });
}).listen(port, '127.0.0.1', () => console.log(`mock storefront api on http://127.0.0.1:${port}/api/storefront/v1 (fixture ${dir})`));
