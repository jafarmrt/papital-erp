import http from 'http';

/**
 * 10.2 package 6 (D-04): a stand-in WooCommerce shop on 127.0.0.1 for tests. It answers the catalog pages
 * (`GET products`, `GET products/<id>/variations`) and the batch updates (`POST products/batch`,
 * `POST products/<id>/variations/batch`), records every request and every stock it was sent, and answers a row error for
 * the ids in `rowErrors`. No real shop is ever called.
 */
export interface MockVariation {
  id: number; sku: string; stock?: number | null; manageStock?: boolean | 'parent'; regularPrice?: string;
  /** v11 phase 6.5 (part D): the variation's own image id (none by default) */
  imageId?: number;
}
export interface MockProduct {
  id: number; sku: string; name?: string; stock?: number | null; variations?: MockVariation[];
  /** WooCommerce product type; `variable` when the product has variations, else `simple` */
  type?: string;
  /** part C: the regular price as the shop holds it ('' by default) */
  regularPrice?: string;
  /** v11 phase 6.5 (part D): the product's image ids, the first being the featured image, and its tag ids */
  images?: number[];
  tags?: number[];
}

/** part D: a product tag of the shop */
export interface MockTag { id: number; name: string }

/** part B: an order the shop holds; `GET orders?status=a,b` answers those of the listed statuses, in id order (newest first
 * with `order=desc`) */
export interface MockOrder {
  id: number; status: string; lines: Array<{ productId: number; variationId?: number; quantity: number }>;
  /** `date_completed_gmt` of a completed order, as the shop sends it (no zone) */
  dateCompletedGmt?: string;
}

export interface MockWooCatalogStore {
  url: string;
  /** product or variation id → the last stock_quantity sent to it */
  pushed: Map<number, number>;
  /** every request, as `METHOD path?page=N` */
  requests: string[];
  /** the number of rows in each batch request, in order */
  batchSizes: number[];
  /** ids whose batch row answers an error */
  rowErrors: Set<number>;
  /** when set, every request answers this status (a shop that is down or refuses the keys) */
  failStatus?: number;
  /** request paths (without the API prefix) that answer 500, so one read of a refresh fails */
  failPaths: Set<string>;
  /** request paths that answer their own status (review M-4: 404 for the variations of a parent removed in the shop) */
  statusPaths: Map<string, number>;
  /** called before an orders page is answered, with its page number (review M-5: the list moves between two pages) */
  beforeOrdersPage?: (page: number) => void;
  /** the orders list sends no `X-WP-Total` (a shop or a cache that strips it); the product and variation lists neither */
  omitTotalHeader?: boolean;
  /**
   * PR #420 review finding 1: product ids the shop counts in `X-WP-Total` but leaves out of its pages (WooCommerce drops a
   * row the key may not read after the query, so its page comes short)
   */
  hiddenFromLists?: Set<number>;
  /** PR #420 delta review S1: the most rows a catalog page holds whatever `per_page` asks (a shop or plugin that caps it) */
  perPageCap?: number;
  /** v11 phase 6.5: called before a product or variation list page is answered, with its path and page number (a product
   * removed from the shop between two pages) */
  beforeCatalogPage?: (path: string, page: number) => void;
  /** orders the list sends without their `id` (delta review 4, item E: a shop or a plugin that drops the field) */
  ordersWithoutId?: Set<number>;
  /** catalog pages after the first start one row early, so their first row repeats the last row of the page before (a date
   * order without a tie-breaker): only for a request without `orderby=id&order=asc`, or for every request with `always`;
   * `swap_ties` (review M-R / M-S) swaps the rows on each side of a page edge for every page after the first, so the last row of
   * a page shows again first on the next one and the row that followed it is never shown */
  unstableOrder?: 'without_id_order' | 'always' | 'swap_ties';
  /** the product list ignores `orderby=id` and answers the newest product first (review M-C) */
  newestFirst?: boolean;
  /** requests whose path matches `pattern` are answered only once `until` settles (review N-G: no timing in the test) */
  hold?: { pattern: RegExp; until: Promise<void> };
  /** every request as it arrives, before any wait, as `METHOD path?page=N` */
  arrivals: string[];
  /** the most requests the shop was answering at the same time */
  maxInFlight: number;
  /** each answer waits this long (a slow shop) */
  delayMs?: number;
  /** the query of every request, in order */
  queries: URLSearchParams[];
  /** the shop's orders (part B); empty by default */
  orders: MockOrder[];
  /** product or variation id → the `manage_stock` value of its last batch row (absent when the row sent none) */
  manageStockSent: Map<number, unknown>;
  /** part C: product or variation id → the last `regular_price` / `sku` a batch row sent it (applied to the products too) */
  pricesSent: Map<number, string>;
  skusSent: Map<number, string>;
  /** part C: the shop currency `GET data/currencies/current` answers (IRR by default) */
  currency: string;
  /** review M-A: the price decimals `GET settings/general/woocommerce_price_num_decimals` answers (2, WooCommerce's default) */
  decimals: number | string;
  /** part D: the shop's product tags, and every image `src` and tag list a batch row sent (product or variation id) */
  tags: MockTag[];
  /** tags the shop holds but leaves out of its lists (one made by someone else meanwhile): creating one answers `term_exists` */
  hiddenTags: MockTag[];
  imageSrcSent: Map<number, string>;
  tagsSent: Map<number, number[]>;
  /** part D: the next image id the shop gives a downloaded image */
  nextImageId: number;
  /** PR #421 review: each downloaded image's address, named after the file as WordPress does (with a `-1` suffix) */
  imageSrc: Map<number, string>;
  /** PR #421 review: batch paths the shop applies and then answers 500 (an answer lost to a slow shop) */
  applyThenFail?: Set<string>;
  /** review nit N-1: the settings and currency reads answer this status (a key of a user who does not manage the shop gets 403) */
  settingsStatus?: number;
  close(): Promise<void>;
}

const PREFIX = '/wp-json/wc/v3/';

function page<T>(rows: T[], url: URL, store: MockWooCatalogStore): T[] {
  const perPage = Math.min(Number(url.searchParams.get('per_page') || 10), store.perPageCap ?? Infinity);
  const n = Number(url.searchParams.get('page') || 1);
  // part B (delta review N-A): an `offset` starts the page at that row, as WordPress does, and ignores `page`
  if (url.searchParams.has('offset')) {
    const offset = Number(url.searchParams.get('offset'));
    return rows.slice(offset, offset + perPage);
  }
  const stable = url.searchParams.get('orderby') === 'id' && url.searchParams.get('order') === 'asc';
  const shifted = store.unstableOrder === 'always' || (store.unstableOrder === 'without_id_order' && !stable);
  const start = (n - 1) * perPage - (shifted && n > 1 ? 1 : 0);
  if (store.unstableOrder === 'swap_ties' && n > 1 && start < rows.length) {
    const swapped = [...rows];
    [swapped[start - 1], swapped[start]] = [swapped[start], swapped[start - 1]];
    return swapped.slice(start, start + perPage);
  }
  return rows.slice(start, start + perPage);
}

function productPage(products: MockProduct[], url: URL, store: MockWooCatalogStore): MockProduct[] {
  const rows = page(store.newestFirst ? [...products].sort((a, b) => b.id - a.id) : products, url, store);
  return store.hiddenFromLists ? rows.filter(p => !store.hiddenFromLists?.has(p.id)) : rows;
}

/** `X-WP-Total` and `X-WP-TotalPages` of a catalog list, as WooCommerce sends them */
function setListHeaders(res: http.ServerResponse, total: number, url: URL, store: MockWooCatalogStore): void {
  if (store.omitTotalHeader) return;
  const perPage = Math.min(Number(url.searchParams.get('per_page') || 10), store.perPageCap ?? Infinity);
  res.setHeader('X-WP-Total', String(total));
  res.setHeader('X-WP-TotalPages', String(Math.ceil(total / perPage)));
}

type BatchRow = {
  id: number; stock_quantity?: number; manage_stock?: unknown; regular_price?: unknown; sku?: unknown;
  images?: Array<{ id?: number; src?: string }>; image?: { src?: string }; tags?: Array<{ id?: number }>;
};

/** every product and variation of the shop, to apply a batch row to (ids are unique across both in the tests) */
function shopRows(products: MockProduct[]): Array<MockProduct | MockVariation> {
  return products.flatMap(p => [p, ...(p.variations ?? [])]);
}

/** A downloaded image: a new id, its address named after the file */
function downloaded(store: MockWooCatalogStore, src: string): number {
  const id = store.nextImageId++;
  const name = new URL(src).pathname.split('/').pop() ?? 'image.webp';
  store.imageSrc.set(id, `https://shop.test/uploads/${name.replace(/\.webp$/, '-1.webp')}`);
  return id;
}

const imageOf = (store: MockWooCatalogStore, id: number) => ({ id, src: store.imageSrc.get(id) ?? `https://shop.test/img/${id}.jpg` });

function batchAnswer(store: MockWooCatalogStore, body: string, products: MockProduct[]): unknown {
  const parsed = JSON.parse(body || '{}') as { update?: BatchRow[] };
  const rows = parsed.update ?? [];
  store.batchSizes.push(rows.length);
  return {
    update: rows.map(row => {
      if (store.rowErrors.has(row.id)) return { id: row.id, error: { code: 'woocommerce_rest_invalid_id', message: 'شناسه نامعتبر است.' } };
      const target = shopRows(products).find(r => r.id === row.id);
      if ('sku' in row) {
        // WooCommerce refuses a SKU another product or variation holds
        const sku = String(row.sku);
        // WooCommerce compares SKUs without letter case (review N-5)
        if (shopRows(products).some(r => r.id !== row.id && r.sku.toLowerCase() === sku.toLowerCase())) {
          return { id: row.id, error: { code: 'product_invalid_sku', message: 'شناسه محصول (SKU) تکراری است.' } };
        }
        store.skusSent.set(row.id, sku);
        if (target) target.sku = sku;
      }
      if ('regular_price' in row) {
        store.pricesSent.set(row.id, String(row.regular_price));
        if (target) target.regularPrice = String(row.regular_price);
      }
      // part D: an image `src` becomes a new image of the shop (WooCommerce downloads it inside the request)
      const extra: Record<string, unknown> = {};
      if (row.images && target) {
        const p = target as MockProduct;
        p.images = row.images.map((img) => {
          if (img.src) {
            store.imageSrcSent.set(row.id, img.src);
            return downloaded(store, img.src);
          }
          return Number(img.id);
        });
        extra.images = p.images.map(id => ({ id }));
      }
      if (row.image?.src && target) {
        store.imageSrcSent.set(row.id, row.image.src);
        (target as MockVariation).imageId = downloaded(store, row.image.src);
        extra.image = { id: (target as MockVariation).imageId };
      }
      if (row.tags && target) {
        const ids = row.tags.map(t => Number(t.id));
        store.tagsSent.set(row.id, ids);
        (target as MockProduct).tags = ids;
        extra.tags = ids.map(id => ({ id }));
      }
      if ('stock_quantity' in row) {
        store.pushed.set(row.id, Number(row.stock_quantity));
        if ('manage_stock' in row) store.manageStockSent.set(row.id, row.manage_stock);
        else store.manageStockSent.delete(row.id);
      }
      return { id: row.id, stock_quantity: row.stock_quantity, sku: target?.sku, regular_price: target?.regularPrice ?? '', ...extra };
    }),
  };
}

export async function mockWooCatalogStore(products: MockProduct[]): Promise<MockWooCatalogStore> {
  const store = {
    pushed: new Map(), requests: [], arrivals: [], batchSizes: [], rowErrors: new Set(), failPaths: new Set(), statusPaths: new Map(),
    queries: [], maxInFlight: 0,
    orders: [], manageStockSent: new Map(), pricesSent: new Map(), skusSent: new Map(), currency: 'IRR', decimals: 2,
    tags: [], hiddenTags: [], imageSrcSent: new Map(), tagsSent: new Map(), nextImageId: 9000, imageSrc: new Map(),
  } as unknown as MockWooCatalogStore;
  let inFlight = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const path = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) : url.pathname;
    let body = '';
    req.on('data', chunk => { body += String(chunk); });
    req.on('end', () => void (async () => {
      const label = `${req.method} ${path}${url.searchParams.get('page') ? `?page=${url.searchParams.get('page')}` : ''}${url.searchParams.has('offset') ? `?offset=${url.searchParams.get('offset')}` : ''}`;
      store.arrivals.push(label);
      if (store.hold?.pattern.test(path)) await store.hold.until;
      inFlight++;
      store.maxInFlight = Math.max(store.maxInFlight, inFlight);
      if (store.delayMs) await new Promise(resolve => setTimeout(resolve, store.delayMs));
      inFlight--;
      store.queries.push(url.searchParams);
      store.requests.push(label);
      res.setHeader('Content-Type', 'application/json');
      const send = (data: unknown) => res.end(JSON.stringify(data));
      if (store.failStatus || store.failPaths.has(path)) {
        res.statusCode = store.failStatus ?? 500;
        send({ code: 'internal_error', message: 'خطای میزبان سایت' });
        return;
      }
      if (store.statusPaths.has(path)) {
        res.statusCode = store.statusPaths.get(path) ?? 500;
        send({ code: 'woocommerce_rest_product_invalid_id', message: 'شناسه نامعتبر است.' });
        return;
      }
      if (req.method === 'GET' && (path === 'products' || /^products\/\d+\/variations$/.test(path))) {
        store.beforeCatalogPage?.(path, Number(url.searchParams.get('page') || 1));
      }
      if (req.method === 'GET' && path === 'products') {
        const shape = (p: MockProduct) => ({
          id: p.id, name: p.name ?? `محصول ${p.id}`, sku: p.sku, type: p.type ?? (p.variations ? 'variable' : 'simple'),
          stock_quantity: p.stock ?? null, manage_stock: p.stock !== undefined && p.stock !== null, regular_price: p.regularPrice ?? '',
          images: (p.images ?? []).map(id => imageOf(store, id)), tags: (p.tags ?? []).map(id => ({ id })),
        });
        // part D: `include` reads the named products again (the image and tag sends keep the gallery and the other tags)
        if (url.searchParams.has('include')) {
          const ids = new Set(String(url.searchParams.get('include')).split(',').map(Number));
          send(products.filter(p => ids.has(p.id)).map(shape));
          return;
        }
        setListHeaders(res, products.length, url, store);
        send(productPage(products, url, store).map(shape));
        return;
      }
      if (req.method === 'GET' && path === 'products/tags') {
        const search = url.searchParams.get('search');
        const rows = search ? store.tags.filter(t => t.name.toLowerCase().includes(search.toLowerCase())) : store.tags;
        send(page([...rows].sort((a, b) => a.id - b.id), url, store).map(t => ({ id: t.id, name: t.name.replace(/&/g, '&amp;') })));
        return;
      }
      if (req.method === 'POST' && path === 'products/tags/batch') {
        const create = (JSON.parse(body || '{}') as { create?: Array<{ name: string }> }).create ?? [];
        send({ create: create.map(({ name }) => {
          // WordPress cleans a name of its tags and refuses one left empty
          if (name.replace(/<[^>]*>|[<>]/g, '').trim() === '') return { id: 0, error: { code: 'empty_term_name', message: 'نام برچسب خالی است.', data: { status: 400 } } };
          // delta review: a name the shop fails to write for another reason (a database error)
          if (name === 'FAILTAG') return { id: 0, error: { code: 'db_insert_error', message: 'خطای پایگاه داده', data: { status: 500 } } };
          const taken = [...store.tags, ...store.hiddenTags].find(t => t.name.toLowerCase() === name.toLowerCase());
          if (taken) return { id: 0, error: { code: 'term_exists', message: 'برچسب هست.', data: { status: 400, resource_id: taken.id } } };
          const tag = { id: 7000 + store.tags.length, name };
          store.tags.push(tag);
          return tag;
        }) });
        return;
      }
      const variations = path.match(/^products\/(\d+)\/variations$/);
      if (req.method === 'GET' && variations) {
        // read live, so a test may change the shop's products between two readings
        const parent = products.find(p => p.id === Number(variations[1]));
        const listed = parent?.variations ?? [];
        // PR #421 review: `include` reads the named variations again (the image send looks for an image that landed)
        const included = url.searchParams.has('include') ? new Set(String(url.searchParams.get('include')).split(',').map(Number)) : null;
        const rows = included ? listed.filter(v => included.has(v.id)) : listed;
        setListHeaders(res, rows.length, url, store);
        send(page(rows, url, store).filter(v => !store.hiddenFromLists?.has(v.id)).map(v => ({
          id: v.id, sku: v.sku, stock_quantity: v.stock ?? null,
          manage_stock: v.manageStock ?? (v.stock !== undefined && v.stock !== null), regular_price: v.regularPrice ?? '',
          // WooCommerce answers a variation without its own image with its parent's featured image
          image: v.imageId ? imageOf(store, v.imageId) : parent?.images?.[0] ? imageOf(store, parent.images[0]) : null,
        })));
        return;
      }
      if (req.method === 'GET' && path === 'orders') {
        // the reading's number: page n, or for an overlapping reading (offset 0, 99, 198 … of 100 rows) its order
        const perPage = Number(url.searchParams.get('per_page') || 10);
        const offset = Number(url.searchParams.get('offset') || 0);
        store.beforeOrdersPage?.(url.searchParams.has('offset') ? Math.round(offset / Math.max(1, perPage - 1)) + 1 : Number(url.searchParams.get('page') || 1));
        const statuses = new Set((url.searchParams.get('status') || 'any').split(','));
        const newestFirst = url.searchParams.get('order') === 'desc';
        const rows = [...store.orders].sort((a, b) => (newestFirst ? b.id - a.id : a.id - b.id))
          .filter(o => statuses.has('any') || statuses.has(o.status));
        if (!store.omitTotalHeader) res.setHeader('X-WP-Total', String(rows.length));
        send(page(rows, url, store).map(o => ({
          ...(store.ordersWithoutId?.has(o.id) ? {} : { id: o.id }), status: o.status,
          line_items: o.lines.map(l => ({ product_id: l.productId, variation_id: l.variationId ?? 0, quantity: l.quantity })),
        })));
        return;
      }
      // review nit N-1 / PR #420 review finding 4: WooCommerce guards its currency data like its settings
      if (req.method === 'GET' && (path === 'data/currencies/current' || path === 'settings/general/woocommerce_price_num_decimals') && store.settingsStatus) {
        res.statusCode = store.settingsStatus;
        send({ code: 'woocommerce_rest_cannot_view', message: 'Sorry, you cannot list resources.' });
        return;
      }
      if (req.method === 'GET' && path === 'data/currencies/current') {
        send({ code: store.currency, name: store.currency, symbol: store.currency });
        return;
      }
      if (req.method === 'GET' && path === 'settings/general/woocommerce_price_num_decimals') {
        send({ id: 'woocommerce_price_num_decimals', type: 'number', value: String(store.decimals) });
        return;
      }
      const oneOrder = path.match(/^orders\/(\d+)$/);
      if (req.method === 'GET' && oneOrder) {
        const o = store.orders.find(row => row.id === Number(oneOrder[1]));
        if (!o) {
          res.statusCode = 404;
          send({ code: 'woocommerce_rest_shop_order_invalid_id', message: 'شناسه نامعتبر است.' });
          return;
        }
        send({
          id: o.id, status: o.status, date_completed_gmt: o.dateCompletedGmt ?? null, billing: { first_name: 'خریدار', last_name: 'آزمایشی' },
          line_items: o.lines.map(l => ({ product_id: l.productId, variation_id: l.variationId ?? 0, quantity: l.quantity })),
        });
        return;
      }
      if (req.method === 'POST' && (path === 'products/batch' || /^products\/\d+\/variations\/batch$/.test(path))) {
        const answer = batchAnswer(store, body, products);
        if (store.applyThenFail?.has(path)) {
          res.statusCode = 500;
          send({ code: 'internal_error', message: 'خطای میزبان سایت' });
          return;
        }
        send(answer);
        return;
      }
      res.statusCode = 404;
      send({ code: 'rest_no_route', message: 'مسیر پیدا نشد' });
    })());
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  store.url = `http://127.0.0.1:${port}`;
  // OBS-R2-82: every shop request passes the SSRF guard; only this stand-in's exact origin is let through, in tests only
  const { allowTestLoopbackOrigin } = await import('../../lib/ssrfGuard.js');
  const disallow = allowTestLoopbackOrigin(store.url);
  store.close = () => new Promise<void>(resolve => { disallow(); server.close(() => resolve()); });
  return store;
}
