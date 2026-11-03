// A stand-in for the ERP Storefront API (`/api/storefront/v1`, phase 8.1) for development, tests and the preview.
// It answers the same five routes with the same contract (`src/lib/storefront/storefrontContracts.ts`) from a fixture
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

const brand = await readFile(path.join(dir, 'brand.json'), 'utf8').then(JSON.parse).catch(() => ({ logo: '', favicon: '' }));

const fold = s => String(s).toLowerCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[‌\s]+/g, ' ');
const card = ({ slug, sku, name, category, collections, retailPrice, stock, cover }) => ({ slug, sku, name, category, collections, retailPrice, stock, cover });
const detail = ({ itemId: _id, ...rest }) => rest;
const cmp = (a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
const facet = values => {
  const counts = new Map();
  for (const v of values) if (v && v.trim()) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, 'fa'));
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://mock');
  const route = url.pathname.replace(/^\/api\/storefront\/v1/, '');
  if (req.headers.authorization !== `Bearer ${key}`) return send(res, 401, { error: 'کلید برنامه سایت پذیرفته نشد.' });
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
    if (!SORTS.includes(sort) || !(page >= 1) || !(limit >= 1)) return send(res, 400, { error: 'درخواست نادرست' });
    let list = products.filter(p => (!collection || p.collections.includes(collection)) && (!category || p.category === category)
      && (!q || fold(`${p.name} ${p.sku} ${p.collections.join(' ')}`).includes(q)));
    if (sort === 'newest') list = [...list].sort((a, b) => b.itemId - a.itemId);
    if (sort === 'price_asc') list = [...list].sort((a, b) => cmp(a.retailPrice, b.retailPrice) || a.itemId - b.itemId);
    if (sort === 'price_desc') list = [...list].sort((a, b) => cmp(b.retailPrice, a.retailPrice) || a.itemId - b.itemId);
    return send(res, 200, { data: list.slice((page - 1) * limit, page * limit).map(card), total: list.length, page, limit });
  }
  const slug = /^\/products\/([^/]+)$/.exec(route);
  if (slug) {
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
