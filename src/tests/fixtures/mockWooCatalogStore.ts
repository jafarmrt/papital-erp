import http from 'http';

/**
 * 10.2 package 6 (D-04): a stand-in WooCommerce shop on 127.0.0.1 for tests. It answers the catalog pages
 * (`GET products`, `GET products/<id>/variations`) and the batch updates (`POST products/batch`,
 * `POST products/<id>/variations/batch`), records every request and every stock it was sent, and answers a row error for
 * the ids in `rowErrors`. No real shop is ever called.
 */
export interface MockVariation { id: number; sku: string; stock?: number | null }
export interface MockProduct { id: number; sku: string; name?: string; stock?: number | null; variations?: MockVariation[] }

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
  close(): Promise<void>;
}

const PREFIX = '/wp-json/wc/v3/';

function page<T>(rows: T[], url: URL): T[] {
  const perPage = Number(url.searchParams.get('per_page') || 10);
  const n = Number(url.searchParams.get('page') || 1);
  return rows.slice((n - 1) * perPage, n * perPage);
}

function batchAnswer(store: MockWooCatalogStore, body: string): unknown {
  const parsed = JSON.parse(body || '{}') as { update?: Array<{ id: number; stock_quantity?: number }> };
  const rows = parsed.update ?? [];
  store.batchSizes.push(rows.length);
  return {
    update: rows.map(row => {
      if (store.rowErrors.has(row.id)) return { id: row.id, error: { code: 'woocommerce_rest_invalid_id', message: 'شناسه نامعتبر است.' } };
      store.pushed.set(row.id, Number(row.stock_quantity));
      return { id: row.id, stock_quantity: row.stock_quantity };
    }),
  };
}

export async function mockWooCatalogStore(products: MockProduct[]): Promise<MockWooCatalogStore> {
  const store = { pushed: new Map(), requests: [], batchSizes: [], rowErrors: new Set() } as unknown as MockWooCatalogStore;
  const byId = new Map(products.map(p => [p.id, p]));
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const path = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) : url.pathname;
    let body = '';
    req.on('data', chunk => { body += String(chunk); });
    req.on('end', () => {
      store.requests.push(`${req.method} ${path}${url.searchParams.get('page') ? `?page=${url.searchParams.get('page')}` : ''}`);
      res.setHeader('Content-Type', 'application/json');
      const send = (data: unknown) => res.end(JSON.stringify(data));
      if (store.failStatus) {
        res.statusCode = store.failStatus;
        send({ code: 'internal_error', message: 'خطای میزبان سایت' });
        return;
      }
      if (req.method === 'GET' && path === 'products') {
        send(page(products, url).map(p => ({
          id: p.id, name: p.name ?? `محصول ${p.id}`, sku: p.sku, type: p.variations ? 'variable' : 'simple',
          stock_quantity: p.stock ?? null, manage_stock: p.stock !== undefined && p.stock !== null,
        })));
        return;
      }
      const variations = path.match(/^products\/(\d+)\/variations$/);
      if (req.method === 'GET' && variations) {
        const rows = byId.get(Number(variations[1]))?.variations ?? [];
        send(page(rows, url).map(v => ({ id: v.id, sku: v.sku, stock_quantity: v.stock ?? null, manage_stock: v.stock !== undefined && v.stock !== null })));
        return;
      }
      if (req.method === 'POST' && (path === 'products/batch' || /^products\/\d+\/variations\/batch$/.test(path))) {
        send(batchAnswer(store, body));
        return;
      }
      res.statusCode = 404;
      send({ code: 'rest_no_route', message: 'مسیر پیدا نشد' });
    });
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
