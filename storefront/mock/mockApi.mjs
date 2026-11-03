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

const brand = await readFile(path.join(dir, 'brand.json'), 'utf8').then(JSON.parse).catch(() => ({ logo: '', favicon: '' }));

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
const readBody = req => new Promise(resolve => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
});
const proofOk = (phone, proof) => typeof proof === 'string' && proof === `pp_mock${phone}`;
const view = a => ({ name: a.name, phone: a.phone, city: '', kind: 'retail', application: 'none', companyName: '', phoneVerified: a.verified, group: null });
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

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://mock');
  const route = url.pathname.replace(/^\/api\/storefront\/v1/, '');
  if (url.pathname === '/__mock/last') return send(res, 200, last);
  if (req.headers.authorization !== `Bearer ${key}`) return send(res, 401, { error: 'کلید برنامه سایت پذیرفته نشد.' });
  last = { clientIp: String(req.headers['x-storefront-client-ip'] ?? ''), session: String(req.headers['x-buyer-session'] ?? '') };
  if (req.method === 'POST' && route.startsWith('/auth/')) return auth(req, res, route);
  if (route === '/account') {
    const phone = sessions.get(String(req.headers['x-buyer-session'] ?? ''));
    return phone ? send(res, 200, { data: view(accounts.get(phone)) }) : send(res, 401, { error: 'برای این کار وارد حساب خود شوید.', code: 'STOREFRONT_SESSION_REQUIRED' });
  }
  if (route === '/settings') return send(res, 200, { data: settings });
  if (route === '/brand') return send(res, 200, { data: brand });
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
