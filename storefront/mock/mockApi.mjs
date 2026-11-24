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
// v12 phase 8e: the email codes, off unless MOCK_EMAIL_LOGIN=1 (or /__mock/email-login?on=1); the right code is 654321
settings.emailLogin = process.env.MOCK_EMAIL_LOGIN === '1';
// v11 phase 8.2: ordering (the cart and checkout), on only with MOCK_ORDERING=1; the card to pay to is a made-up one
settings.ordering = process.env.MOCK_ORDERING === '1';
if (settings.ordering && !settings.payment.cardNumber) settings.payment = { cardNumber: '6037990000000000', cardHolder: 'فروشگاه نمونه', bankName: 'بانک نمونه', iban: 'IR000000000000000000000000' };

const brand = await readFile(path.join(dir, 'brand.json'), 'utf8').then(JSON.parse).catch(() => ({ logo: '', favicon: '' }));
// phase 8.5: the old-address redirects (`redirects.json`, a list of { from, kind, target }) and the search and statistics
// settings (`seo.json`, or MOCK_SEO as JSON for a test); both optional
// MOCK_REDIRECTS (JSON) takes the file's place, so a test brings its own list
const redirectList = process.env.MOCK_REDIRECTS ? JSON.parse(process.env.MOCK_REDIRECTS) : await readFile(path.join(dir, 'redirects.json'), 'utf8').then(JSON.parse).catch(() => []);
const seo = process.env.MOCK_SEO ? JSON.parse(process.env.MOCK_SEO) : await readFile(path.join(dir, 'seo.json'), 'utf8').then(JSON.parse).catch(() => ({
  verification: { google: '', bing: '' }, analytics: { provider: 'none', id: '', url: '' }, alternateSiteUrl: '',
}));

// phase 8.5b: «صفحه‌های ویژه» on the site now (`campaigns.json`, a list of pages whose `products` are slugs of the catalog;
// MOCK_CAMPAIGNS=0 for none)
const campaignList = process.env.MOCK_CAMPAIGNS === '0' ? [] : await readFile(path.join(dir, 'campaigns.json'), 'utf8').then(JSON.parse).catch(() => []);
const campaignSummary = ({ slug, title, summary, hero, homeBanner, endsOn }) => ({ slug, title, summary, hero, homeBanner, endsOn });
// v12 phase 10a: «اطلاعات فروشگاه»; every field empty (the site keeps its own words) unless MOCK_SHOP_INFO gives the answer
// as JSON (MOCK_SHOP_INFO=fail answers 500 and MOCK_SHOP_INFO=missing 404, as an ERP not yet updated does)
const shopInfoMode = process.env.MOCK_SHOP_INFO ?? '';
let pagesMode = process.env.MOCK_PAGES ?? '';
// v12 phase 10d: «خبرهای سایت». By default the switch «خبرها روی سایت بیایند» is off (no item, as an updated ERP whose shop
// has not turned it on). MOCK_NEWS as JSON gives `{ enabled, pageSize, items }`, the items as the ERP answers one, the
// newest first; MOCK_NEWS=fail answers 500 and MOCK_NEWS=missing 404 for all three addresses (an ERP not yet updated).
const newsMode = process.env.MOCK_NEWS ?? '';
const news = newsMode.startsWith('{') ? JSON.parse(newsMode) : { enabled: false, items: [] };
/** how many times each page of the list of news was asked for (`/__mock/news-reads`), so a test can see what the site kept to itself */
const newsReads = {};
// v12 phase 10e: «کالکشن‌های سایت». MOCK_COLLECTIONS as JSON gives the list as the ERP answers it (`[{ name, intro, image,
// moreHref }]`); none by default. MOCK_COLLECTIONS=fail answers 500 and MOCK_COLLECTIONS=missing 404 (an ERP not yet updated).
const collectionsMode = process.env.MOCK_COLLECTIONS ?? '';
const collectionTexts = collectionsMode.startsWith('[') ? JSON.parse(collectionsMode) : [];
// v12 phase 10e: «صفحهٔ اصلی». Not published (404) unless MOCK_HOME gives the answer as JSON (`{ seoTitle, seoDescription,
// shareImage, updatedAt, sections }`, a «معرفی کالکشن» naming catalog slugs for its products); MOCK_HOME=fail answers 500.
// `GET /__mock/home?mode=fail|ok|none` changes it while a test runs (the site must keep the copy it read last).
let homeMode = process.env.MOCK_HOME ?? '';
const homeAnswer = homeMode.startsWith('{') ? JSON.parse(homeMode) : null;
if (homeAnswer) homeMode = 'ok';
const previews = process.env.MOCK_PREVIEWS ? JSON.parse(process.env.MOCK_PREVIEWS) : {};
const previewMedia = (process.env.MOCK_PREVIEW_MEDIA ?? '').split(',').filter(Boolean);
let previewReads = 0;
let previewKeysInAddress = 0;
/** A page of MOCK_PAGES or MOCK_PREVIEWS as the ERP answers it: a «ردیف محصولات» names catalog slugs, sent as their cards */
const withCards = page => ({
  ...page,
  sections: (page.sections ?? []).map(section => (section.kind === 'products'
    // a slug is a product of the catalog; an object is sent as it is (a test's own card, in whatever shape)
    ? { ...section, products: (section.products ?? []).map(entry => (typeof entry === 'string' ? products.find(p => p.slug === entry) && card(products.find(p => p.slug === entry)) : entry)).filter(Boolean) }
    : section)),
});
/** A home page as the ERP answers it: the products of a «معرفی کالکشن» and of a «ردیف محصولات» named by slug are sent as their cards */
const homeWithCards = home => ({
  ...home,
  sections: (home.sections ?? []).map(section => (section && (section.kind === 'collectionIntro' || section.kind === 'products')
    ? { ...section, products: (section.products ?? []).map(entry => (typeof entry === 'string' ? products.find(p => p.slug === entry) && card(products.find(p => p.slug === entry)) : entry)).filter(Boolean) }
    : section)),
});
const pageList = pagesMode.startsWith('[') ? JSON.parse(pagesMode) : [];
const shopInfo = shopInfoMode && shopInfoMode !== 'fail' && shopInfoMode !== 'missing' ? JSON.parse(shopInfoMode) : {
  brand: { name: '', fullName: '', tagline: '' }, footerNote: '',
  contact: { address: '', postalCode: '', phone: '', mobile: '', email: '', hours: '' },
  social: { instagram: '', telegram: '', youtube: '', aparat: '', linkedin: '' },
  copyright: '', shipping: { title: '', lines: [] }, alternateSiteLabel: '', enamad: { linkUrl: '', imageUrl: '' }, whatsappFloat: '',
};
// v12 phase 9c: the menus of «فهرست‌های سایت»; every place off (null) unless MOCK_MENUS names them as JSON
// (MOCK_MENUS=fail answers 500, to test the site's fallback)
const menusFail = process.env.MOCK_MENUS === 'fail';
const menuPlaces = { header: null, drawer: null, footer: null, bottom: null, ...(process.env.MOCK_MENUS && !menusFail ? JSON.parse(process.env.MOCK_MENUS) : {}) };

const fold = s => String(s).toLowerCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[‌\s]+/g, ' ');
const card = ({ slug, sku, name, category, collections, retailPrice, stock, cover }) => ({ slug, sku, name, category, collections, retailPrice, stock, cover });
// like the ERP: the transfer code links items of one design («هم‌طرح») and is never sent
// (nor is the day of the last change, which only the feed carries)
const detail = ({ itemId: _id, transferCode, updatedAt: _changed, ...rest }) => ({
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
const emailKey = email => String(email ?? '').trim().toLowerCase();
const emailProofOk = (email, proof) => typeof proof === 'string' && proof === `ep_mock${Buffer.from(emailKey(email)).toString('hex')}`;
const view = a => ({
  name: a.name, phone: a.phone, email: a.email ?? '', city: '', kind: 'retail', application: a.application ?? 'none', companyName: a.companyName ?? '',
  phoneVerified: a.verified, emailVerified: Boolean(a.email), group: null,
});
// an account is found by its phone or its email (v12 phase 8e); the session names the key it was made by
const accountKey = a => a.phone || emailKey(a.email);
const findAccount = ({ phone, email }) => (phone ? accounts.get(phone) : [...accounts.values()].find(a => emailKey(a.email) === emailKey(email)));
const session = a => {
  const token = `bs_mock${sessions.size + 1}x${Buffer.from(accountKey(a)).toString('hex').slice(0, 40)}`;
  sessions.set(token, accountKey(a));
  return { sessionToken: token, expiresAt: new Date(Date.now() + 30 * 864e5).toISOString(), account: view(a) };
};

async function auth(req, res, route) {
  const body = await readBody(req);
  // v12 phase 8e: what a sign-up or a reset sent, for the tests (codes and proofs are made-up mock values)
  if (route === '/auth/register' || route === '/auth/reset-password') lastPost = { route, orderKey: '', session: '', body };
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
  const email = String(body.email ?? '');
  // v12 phase 8e: the email codes and the email sign-in
  if (route === '/auth/email-code/request') {
    if (!settings.emailLogin) return refuse(404, 'NOT_FOUND', 'پیدا نشد');
    return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email) ? send(res, 200, { data: { resendAfter: 60, expiresIn: 600 } }) : refuse(422, 'STOREFRONT_EMAIL_INVALID', 'نشانی ایمیل را درست بنویسید.');
  }
  if (route === '/auth/email-code/verify') {
    return body.code === '654321' ? send(res, 200, { data: { emailProof: `ep_mock${Buffer.from(emailKey(email)).toString('hex')}`, expiresIn: 600 } })
      : refuse(422, 'STOREFRONT_EMAIL_CODE_INVALID', 'کد درست نیست یا مهلتش گذشته است؛ کد را دوباره بخواهید.');
  }
  if (route === '/auth/email-login') {
    if (!emailProofOk(email, body.emailProof)) return refuse(422, 'STOREFRONT_EMAIL_PROOF_REQUIRED', 'ایمیل را با کد ایمیلی تأیید کنید.');
    const account = findAccount({ email });
    if (!account) return refuse(404, 'STOREFRONT_ACCOUNT_NOT_FOUND', 'حسابی با این نشانی نیست؛ حساب تازه بسازید.');
    return send(res, 200, { data: session(account) });
  }
  if (route === '/auth/reset-password') {
    const byPhone = Boolean(body.phone);
    if (byPhone ? !proofOk(phone, body.phoneProof) : !emailProofOk(email, body.emailProof)) return refuse(422, byPhone ? 'STOREFRONT_PHONE_PROOF_REQUIRED' : 'STOREFRONT_EMAIL_PROOF_REQUIRED', 'کد را دوباره بخواهید.');
    const account = findAccount(byPhone ? { phone } : { email });
    if (!account) return refuse(404, 'STOREFRONT_ACCOUNT_NOT_FOUND', 'حسابی با این نشانی نیست؛ حساب تازه بسازید.');
    if (String(body.password ?? '').length < 8) return refuse(422, 'STOREFRONT_ACCOUNT_FIELD_INVALID', 'رمز دست‌کم ۸ نویسه است.');
    account.password = String(body.password);
    for (const [token, owner] of sessions) if (owner === accountKey(account)) sessions.delete(token);
    return send(res, 200, { data: session(account) });
  }
  if (route === '/auth/register') {
    if (phone && accounts.has(phone)) return refuse(409, 'STOREFRONT_ACCOUNT_EXISTS', 'برای این شمارهٔ همراه حساب ساخته شده است؛ وارد شوید.');
    if (email && findAccount({ email })) return refuse(409, 'STOREFRONT_EMAIL_TAKEN', 'این ایمیل حساب دیگری است؛ وارد شوید.');
    if (!phone && !email) return refuse(422, 'STOREFRONT_ACCOUNT_FIELD_INVALID', 'شمارهٔ همراه یا ایمیل را بنویسید.');
    if (phone && (settings.smsLogin || body.phoneProof) && !proofOk(phone, body.phoneProof)) return refuse(422, 'STOREFRONT_PHONE_PROOF_REQUIRED', 'شمارهٔ همراه را با کد پیامکی تأیید کنید.');
    if (email && !emailProofOk(email, body.emailProof)) return refuse(422, 'STOREFRONT_EMAIL_PROOF_REQUIRED', 'ایمیل را با کد ایمیلی تأیید کنید.');
    if (String(body.password ?? '').length < 8) return refuse(422, 'STOREFRONT_ACCOUNT_FIELD_INVALID', 'رمز دست‌کم ۸ نویسه است.');
    const account = { name: String(body.name ?? ''), phone, email, password: String(body.password), verified: Boolean(body.phoneProof) };
    accounts.set(accountKey(account), account);
    return send(res, 201, { data: session(account) });
  }
  if (route === '/auth/login') {
    const account = findAccount({ phone, email });
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
// v12 phase 8c: each account's address book, by its phone
const books = new Map();
let nextAddress = 1;
const BUYER_ADDRESSES_MAX = 10;
const bookOf = phone => books.get(phone) ?? [];
const bookView = phone => ({ data: [...bookOf(phone)].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.id - a.id), max: BUYER_ADDRESSES_MAX });
const keepAddress = (phone, to, recipientPhone) => {
  const book = bookOf(phone);
  const fields = { recipientName: to.name, recipientPhone, province: to.province, city: to.city, address: to.address, postalCode: to.postalCode };
  let row = book.find(a => Object.entries(fields).every(([k, v]) => a[k] === v));
  if (!row) {
    if (book.length >= BUYER_ADDRESSES_MAX) return;
    row = { id: nextAddress++, ...fields, isDefault: false };
    book.push(row);
  }
  for (const a of book) a.isDefault = a === row;
  books.set(phone, book);
};
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
  return { itemsAmount: items.toString(), lines: lines.map(l => ({ slug: l.slug, quantity: l.quantity, amount: l.lineAmount })), discount, options };
};
const orderView = o => {
  const waiting = o.status === 'awaiting_payment';
  return {
    number: o.number, status: o.status, statusTitle: STATUS_TITLES[o.status], createdAt: o.createdAt, payBefore: waiting ? new Date(Date.parse(o.createdAt) + 24 * 3600e3).toISOString() : null,
    recipient: { ...o.recipient, phone: o.recipientPhone || o.recipient.phone }, orderedBy: { name: o.buyerName || o.recipient.name, phone: o.recipient.phone },
    gift: o.gift ? { message: o.giftMessage ?? '' } : null, note: o.note, shipping: o.shipping, lines: o.lines, itemsAmount: o.itemsAmount, payableAmount: o.payableAmount,
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
    // v12 phase 8e: a guest's email proof while the texts cannot prove a phone, and an account with nothing proven
    const signedAccount = accountOf(req) && accounts.get(accountOf(req));
    const unproven = !signedAccount || (!signedAccount.verified && !signedAccount.email);
    if (unproven && !settings.smsLogin && settings.emailLogin && !emailProofOk(body.email, body.emailProof)) {
      return send(res, 422, { error: 'نشانی ایمیل را با کدی که به آن فرستاده می‌شود تأیید کنید.', code: 'STOREFRONT_EMAIL_PROOF_REQUIRED', details: { field: 'email' } });
    }
    if (settings.smsLogin && !accountOf(req) && !body.emailProof && !proofOk(latin(body.phone), body.phoneProof)) {
      return send(res, 422, { error: 'شمارهٔ همراه را با کد پیامکی تأیید کنید؛ اگر کد گرفته‌اید و مهلتش گذشته، کد تازه بخواهید.', code: 'STOREFRONT_PHONE_PROOF_REQUIRED', details: { field: 'phoneProof' } });
    }
    const discount = discountOf(body.discountCode, lines.reduce((sum, l) => sum + BigInt(l.lineAmount), 0n));
    if (discount === 'bad') return discountRefused(res);
    const quote = quoteOf(body.province, lines, discount);
    const option = quote.options.find(o => o.code === body.shippingMethod);
    if (!option) return fieldError(res, 'shippingMethod', 'این روش ارسال برای این سبد و استان در دسترس نیست؛ روش دیگری انتخاب کنید.');
    const number = String(nextNumber++);
    const order = {
      number, status: 'awaiting_payment', createdAt: new Date().toISOString(), account: accountOf(req) ?? null, email: body.emailProof ? emailKey(body.email) : '',
      recipient: { name: body.recipientName, phone: body.phone, province: body.province, city: body.city, address: body.address, postalCode: body.postalCode },
      note: body.note ?? '', shipping: { code: option.code, title: option.title, kind: option.kind, amount: option.amount }, lines,
      // v12 phase 8c: the buyer apart from the recipient, and a gift
      buyerName: String(body.buyerName ?? ''), recipientPhone: String(body.recipientPhone ?? ''), gift: body.gift === true, giftMessage: body.gift === true ? String(body.giftMessage ?? '') : '',
      itemsAmount: quote.itemsAmount, payableAmount: (BigInt(quote.itemsAmount) - BigInt(discount?.amount ?? 0) + BigInt(option.amount)).toString(), receipts: [], discount,
    };
    orders.set(number, order);
    byRequestKey.set(body.requestKey, order);
    // v12 phase 8c: a signed-in buyer keeps the address as the default (the same one again is only made the default)
    if (body.saveAddress === true && accountOf(req)) keepAddress(accountOf(req), order.recipient, String(body.recipientPhone ?? ''));
    return send(res, 201, { data: { order: orderView(order), accessKey: keyOf(number) } });
  }
  const receipt = (order) => {
    if (order.status !== 'awaiting_payment') return send(res, 409, { error: 'برای این سفارش اکنون رسید پذیرفته نمی‌شود.', code: 'STOREFRONT_RECEIPT_NOT_EXPECTED' });
    if (!/^[A-Za-z0-9]{4,40}$/.test(String(body.reference ?? ''))) return send(res, 422, { error: 'شمارهٔ پیگیری یا ارجاع واریز را درست بنویسید (۴ تا ۴۰ رقم یا حرف لاتین).', code: 'STOREFRONT_RECEIPT_FIELD_INVALID', details: { field: 'reference' } });
    order.status = 'payment_submitted';
    order.receipts.push({ reference: body.reference, paidAt: body.paidAt, cardLast4: String(body.cardLast4).slice(-4), amount: body.amount, status: 'pending', statusTitle: 'در انتظار بررسی', rejectReason: '', createdAt: new Date().toISOString() });
    return send(res, 201, { data: orderView(order) });
  };
  // v12 phase 8d: a guest order opened with its buyer's phone and that phone's proof; any wrong pair is the same 404
  const access = /^\/orders\/(\d+)\/access$/.exec(route);
  if (access && req.method === 'POST') {
    const order = orders.get(access[1]);
    const phone = latin(body.phone ?? '').replace(/\s+/g, '');
    const byEmail = body.email !== undefined;
    const right = byEmail ? order && order.email && order.email === emailKey(body.email) && emailProofOk(body.email, body.emailProof)
      : order && latin(order.recipient.phone) === phone && proofOk(phone, body.phoneProof);
    if (!right) {
      return send(res, 404, { error: 'سفارشی با این شماره برای این شمارهٔ همراه پیدا نشد.', code: 'STOREFRONT_ORDER_NOT_FOUND' });
    }
    return send(res, 200, { data: { accessKey: keyOf(order.number) } });
  }
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
  if (url.pathname === '/__mock/email-login') {
    settings.emailLogin = url.searchParams.get('on') === '1';
    return send(res, 200, { emailLogin: settings.emailLogin });
  }
  // v12 phase 10c: the tests make the page routes fail (`fail`), vanish (`missing`), answer something that is no page
  // (`html`, `empty`, `null`) or answer again (`ok`) while the mock runs
  // how many requests came under a preview key, pages and images (the site must read each time, keep none, and send no key of another shape)
  if (url.pathname === '/__mock/news-reads') return send(res, 200, newsReads);
  if (url.pathname === '/__mock/home') {
    homeMode = url.searchParams.get('mode') ?? '';
    return send(res, 200, { mode: homeMode });
  }
  if (url.pathname === '/__mock/preview-reads') return send(res, 200, { reads: previewReads, keysInAddress: previewKeysInAddress });
  if (url.pathname === '/__mock/pages') {
    pagesMode = url.searchParams.get('mode') ?? 'ok';
    return send(res, 200, { pages: pagesMode });
  }
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
  if (route === '/account/addresses' || route.startsWith('/account/addresses/')) {
    const phone = accountOf(req);
    if (!phone) return send(res, 401, { error: 'برای این کار وارد حساب خود شوید.', code: 'STOREFRONT_SESSION_REQUIRED' });
    if (route === '/account/addresses' && req.method === 'GET') return send(res, 200, { data: bookView(phone) });
    const one = /^\/account\/addresses\/(\d+)(\/default)?$/.exec(route);
    const book = bookOf(phone);
    const row = one ? book.find(a => a.id === Number(one[1])) : null;
    if (!row) return send(res, 404, { error: 'این نشانی پیدا نشد.', code: 'STOREFRONT_ADDRESS_NOT_FOUND' });
    lastPost = { route, orderKey: '', session: String(req.headers['x-buyer-session'] ?? ''), body: { method: req.method } };
    if (one[2] && req.method === 'POST') { for (const a of book) a.isDefault = a === row; return send(res, 200, { data: bookView(phone) }); }
    if (!one[2] && req.method === 'DELETE') {
      book.splice(book.indexOf(row), 1);
      if (row.isDefault && book.length) [...book].sort((a, b) => b.id - a.id)[0].isDefault = true;
      return send(res, 200, { data: bookView(phone) });
    }
    return send(res, 404, { error: 'پیدا نشد' });
  }
  if (route === '/account/prices') return send(res, 200, { data: { group: '', prices: [] } });
  // v12 phase 8e: a proven email or phone on the signed-in account; replacing one needs the password
  if ((route === '/account/email' || route === '/account/phone') && req.method === 'POST') {
    const body = await readBody(req);
    lastPost = { route, orderKey: '', session: String(req.headers['x-buyer-session'] ?? ''), body };
    const owner = sessions.get(String(req.headers['x-buyer-session'] ?? ''));
    const account = owner && accounts.get(owner);
    if (!account) return send(res, 401, { error: 'برای این کار وارد حساب خود شوید.', code: 'STOREFRONT_SESSION_REQUIRED' });
    const byEmail = route === '/account/email';
    if (byEmail ? !emailProofOk(body.email, body.emailProof) : !proofOk(latin(body.phone), body.phoneProof)) return send(res, 422, { error: 'کد را دوباره بخواهید.', code: 'STOREFRONT_EMAIL_PROOF_REQUIRED' });
    const replacing = byEmail ? Boolean(account.email) && emailKey(account.email) !== emailKey(body.email) : Boolean(account.phone) && account.phone !== latin(body.phone);
    if (replacing && body.password !== account.password) return send(res, 422, { error: 'رمز حساب درست نیست.', code: 'STOREFRONT_ACCOUNT_FIELD_INVALID', details: { field: 'password' } });
    if (byEmail) account.email = String(body.email); else { account.phone = latin(body.phone); account.verified = true; }
    return send(res, 200, { data: view(account) });
  }
  if (route === '/account') {
    const owner = sessions.get(String(req.headers['x-buyer-session'] ?? ''));
    return owner ? send(res, 200, { data: view(accounts.get(owner)) }) : send(res, 401, { error: 'برای این کار وارد حساب خود شوید.', code: 'STOREFRONT_SESSION_REQUIRED' });
  }
  if (route === '/settings') return send(res, 200, { data: settings });
  if (route === '/brand') return send(res, 200, { data: brand });
  if (route === '/menus') return menusFail ? send(res, 500, { error: 'down' }) : send(res, 200, { data: menuPlaces });
  if (route === '/seo') return send(res, 200, { data: seo });
  if (route === '/shop-info') {
    if (shopInfoMode === 'fail') return send(res, 500, { error: 'down' });
    if (shopInfoMode === 'missing') return send(res, 404, { error: 'not found' });
    return send(res, 200, { data: shopInfo });
  }
  if (route === '/redirects') return send(res, 200, { data: redirectList });
  // phase 8.5b: the product feed, the same fields as the ERP's (storefrontFeed.service.ts)
  if (route === '/feed') {
    return send(res, 200, {
      data: products.map(p => ({
        slug: p.slug, sku: p.sku, name: p.name, category: p.category, collections: p.collections, retailPrice: p.retailPrice,
        description: (p.seoDescription || p.description || '').slice(0, 5000), material: p.material ?? '', color: p.color ?? '',
        inStock: p.stock.status !== 'out', images: (p.images.length ? p.images : p.cover ? [p.cover] : []).slice(0, 10),
        // v12 phase 10c: the day the product's page last changed; a product of the sample without one has none ('')
        updatedAt: p.updatedAt ?? '',
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
  // v12 phase 10c: «صفحه‌های سایت»: the published pages MOCK_PAGES gives as JSON (a list of pages as the ERP answers them,
  // where a «ردیف محصولات» section names catalog slugs in `products`); none by default, as an ERP with nothing published.
  // MOCK_PAGES=fail answers 500 and MOCK_PAGES=missing 404 for the list too, as an ERP not yet updated does.
  if (route === '/pages' || route.startsWith('/pages/')) {
    if (pagesMode === 'fail') return send(res, 500, { error: 'mock failure' });
    if (pagesMode === 'missing') return send(res, 404, { error: 'not found' });
    // a 200 that is no page: a proxy's own page (`html`), an empty answer (`empty`) and a bare `null` (`null`)
    if (pagesMode === 'html') return send(res, 200, Buffer.from('<html><body>gateway</body></html>'), { 'Content-Type': 'text/html' });
    if (pagesMode === 'empty') return send(res, 200, {});
    if (pagesMode === 'null') return send(res, 200, null);
    if (route === '/pages') {
      // as the ERP: the words of a fixed page (kind 'fixed') are read by name and are not in the list of pages
      return send(res, 200, { data: pageList.filter(p => p.kind !== 'fixed').map(({ slug, kind, title, noindex, updatedAt }) => ({ slug, kind, title, noindex, updatedAt })) });
    }
    const found = pageList.find(p => p.slug === route.slice('/pages/'.length));
    if (!found) return send(res, 404, { error: 'صفحه پیدا نشد.', code: 'STOREFRONT_PAGE_NOT_FOUND' });
    return send(res, 200, { data: withCards(found) });
  }
  // a look at the site with real pictures: MOCK_MEDIA_DIR names a folder of `<sha256>.webp` files to answer `/media/<file>` from
  // (nothing is answered without it, as before)
  if (route.startsWith('/media/') && process.env.MOCK_MEDIA_DIR && /^\/media\/[0-9a-f]{64}(-thumb)?\.webp$/.test(route)) {
    const bytes = await readFile(path.join(process.env.MOCK_MEDIA_DIR, route.slice('/media/'.length))).catch(() => null);
    if (bytes) return send(res, 200, bytes, { 'Content-Type': 'image/webp' });
  }
  if (route === '/home') {
    if (homeMode === 'fail') return send(res, 500, { error: 'mock failure' });
    // a 200 that is no home page (an empty answer, one with nothing to draw) is a failed read for the site, not «not published»
    if (homeMode === 'empty') return send(res, 200, {});
    if (homeMode === 'nothing') return send(res, 200, { data: { ...homeAnswer, sections: [{ kind: 'unknown-part' }] } });
    if (homeMode !== 'ok' || !homeAnswer) return send(res, 404, { error: 'صفحهٔ اصلی هنوز منتشر نشده است.', code: 'STOREFRONT_HOME_NOT_PUBLISHED' });
    return send(res, 200, { data: homeWithCards(homeAnswer) });
  }
  if (route === '/collections') {
    if (collectionsMode === 'fail') return send(res, 500, { error: 'mock failure' });
    if (collectionsMode === 'missing') return send(res, 404, { error: 'not found' });
    return send(res, 200, { data: collectionTexts });
  }
  if (route === '/news' || route === '/news-index' || route.startsWith('/news/')) {
    if (newsMode === 'fail') return send(res, 500, { error: 'mock failure' });
    if (newsMode === 'missing') return send(res, 404, { error: 'not found' });
    const items = news.enabled ? (news.items ?? []) : [];
    if (route === '/news-index') return send(res, 200, { data: items.map(({ slug, date, updatedAt }) => ({ slug, date, updatedAt })) });
    if (route === '/news') {
      const pageSize = news.pageSize ?? 12;
      const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
      newsReads[page] = (newsReads[page] ?? 0) + 1;
      // as the ERP: a page past 9999 is refused
      if (page > 9999) return send(res, 400, { error: 'validation', code: 'VALIDATION_ERROR' });
      const data = items.slice((page - 1) * pageSize, page * pageSize).map(({ slug, title, summary, date, cover }) => ({ slug, title, summary, date, cover: cover ?? null }));
      return send(res, 200, { enabled: Boolean(news.enabled), data, total: items.length, page: news.enabled ? page : 1, pageSize });
    }
    const found = items.find(item => item.slug === route.slice('/news/'.length));
    if (!found) return send(res, 404, { error: 'خبر پیدا نشد.', code: 'STOREFRONT_NEWS_NOT_FOUND' });
    return send(res, 200, { data: found });
  }
  // v12 phase 10c: «پیش‌نمایش»: MOCK_PREVIEWS (JSON) maps a key (sent in `X-Preview-Key`) to a page as the ERP answers it (with
  // `expiresAt`); any other key is 404, as an unknown or ended link is. An image under a key answers a few bytes for a file named in MOCK_PREVIEW_MEDIA.
  if (route === '/page-preview' || route.startsWith('/page-preview/media/')) {
    // every request counts, whatever its key: a test then sees that a key in another shape was never sent here
    previewReads += 1;
    const presented = String(req.headers['x-preview-key'] ?? '');
    // the key belongs in the header alone: an address (or its query) that carries it would put it in the ERP's log
    if (url.search !== '' || (presented !== '' && String(req.url).includes(presented))) previewKeysInAddress += 1;
    const found = previews[presented];
    // a key given as "fail" answers 500, as an ERP in trouble does for a link that is still good
    if (found === 'fail') return send(res, 500, { error: 'خطای سرور' });
    if (!found) return send(res, 404, { error: 'پیش‌نمایش پیدا نشد یا زمانش گذشته است.', code: 'STOREFRONT_PAGE_PREVIEW_NOT_FOUND' });
    if (route === '/page-preview') return send(res, 200, { data: found.home ? { ...withCards(found), home: homeWithCards(found.home) } : withCards(found) });
    const file = route.slice('/page-preview/media/'.length);
    if (previewMedia.includes(file)) return send(res, 200, Buffer.from(`preview-image-${file}`), { 'Content-Type': 'image/webp' });
    return send(res, 404, { error: 'not found' });
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
