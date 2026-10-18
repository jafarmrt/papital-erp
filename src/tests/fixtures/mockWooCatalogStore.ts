import http from 'http';

/**
 * 10.2 package 6 (D-04): a stand-in WooCommerce shop on 127.0.0.1 for tests. It answers the catalog pages
 * (`GET products`, `GET products/<id>/variations`) and the batch updates (`POST products/batch`,
 * `POST products/<id>/variations/batch`), records every request and every stock it was sent, and answers a row error for
 * the ids in `rowErrors`. No real shop is ever called.
 */
export interface MockVariation { id: number; sku: string; stock?: number | null; manageStock?: boolean | 'parent' }
export interface MockProduct {
  id: number; sku: string; name?: string; stock?: number | null; variations?: MockVariation[];
  /** WooCommerce product type; `variable` when the product has variations, else `simple` */
  type?: string;
}

/** part B: an order the shop holds; `GET orders?status=a,b` answers those of the listed statuses, in id order (newest first
 * with `order=desc`) */
export interface MockOrder {
  id: number; status: string; lines: Array<{ productId: number; variationId?: number; quantity: number }>;
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
  /** the orders list sends no `X-WP-Total` (a shop or a cache that strips it) */
  omitTotalHeader?: boolean;
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
  close(): Promise<void>;
}

const PREFIX = '/wp-json/wc/v3/';

function page<T>(rows: T[], url: URL, store: MockWooCatalogStore): T[] {
  const perPage = Number(url.searchParams.get('per_page') || 10);
  const n = Number(url.searchParams.get('page') || 1);
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
  return page(store.newestFirst ? [...products].sort((a, b) => b.id - a.id) : products, url, store);
}

function batchAnswer(store: MockWooCatalogStore, body: string): unknown {
  const parsed = JSON.parse(body || '{}') as { update?: Array<{ id: number; stock_quantity?: number; manage_stock?: unknown }> };
  const rows = parsed.update ?? [];
  store.batchSizes.push(rows.length);
  return {
    update: rows.map(row => {
      if (store.rowErrors.has(row.id)) return { id: row.id, error: { code: 'woocommerce_rest_invalid_id', message: 'شناسه نامعتبر است.' } };
      store.pushed.set(row.id, Number(row.stock_quantity));
      if ('manage_stock' in row) store.manageStockSent.set(row.id, row.manage_stock);
      else store.manageStockSent.delete(row.id);
      return { id: row.id, stock_quantity: row.stock_quantity };
    }),
  };
}

export async function mockWooCatalogStore(products: MockProduct[]): Promise<MockWooCatalogStore> {
  const store = {
    pushed: new Map(), requests: [], arrivals: [], batchSizes: [], rowErrors: new Set(), failPaths: new Set(), statusPaths: new Map(),
    queries: [], maxInFlight: 0,
    orders: [], manageStockSent: new Map(),
  } as unknown as MockWooCatalogStore;
  let inFlight = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const path = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) : url.pathname;
    let body = '';
    req.on('data', chunk => { body += String(chunk); });
    req.on('end', () => void (async () => {
      const label = `${req.method} ${path}${url.searchParams.get('page') ? `?page=${url.searchParams.get('page')}` : ''}`;
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
      if (req.method === 'GET' && path === 'products') {
        send(productPage(products, url, store).map(p => ({
          id: p.id, name: p.name ?? `محصول ${p.id}`, sku: p.sku, type: p.type ?? (p.variations ? 'variable' : 'simple'),
          stock_quantity: p.stock ?? null, manage_stock: p.stock !== undefined && p.stock !== null,
        })));
        return;
      }
      const variations = path.match(/^products\/(\d+)\/variations$/);
      if (req.method === 'GET' && variations) {
        // read live, so a test may change the shop's products between two readings
        const rows = products.find(p => p.id === Number(variations[1]))?.variations ?? [];
        send(page(rows, url, store).map(v => ({
          id: v.id, sku: v.sku, stock_quantity: v.stock ?? null,
          manage_stock: v.manageStock ?? (v.stock !== undefined && v.stock !== null),
        })));
        return;
      }
      if (req.method === 'GET' && path === 'orders') {
        store.beforeOrdersPage?.(Number(url.searchParams.get('page') || 1));
        const statuses = new Set((url.searchParams.get('status') || 'any').split(','));
        const newestFirst = url.searchParams.get('order') === 'desc';
        const rows = [...store.orders].sort((a, b) => (newestFirst ? b.id - a.id : a.id - b.id))
          .filter(o => statuses.has('any') || statuses.has(o.status));
        if (!store.omitTotalHeader) res.setHeader('X-WP-Total', String(rows.length));
        send(page(rows, url, store).map(o => ({
          id: o.id, status: o.status,
          line_items: o.lines.map(l => ({ product_id: l.productId, variation_id: l.variationId ?? 0, quantity: l.quantity })),
        })));
        return;
      }
      if (req.method === 'POST' && (path === 'products/batch' || /^products\/\d+\/variations\/batch$/.test(path))) {
        send(batchAnswer(store, body));
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
