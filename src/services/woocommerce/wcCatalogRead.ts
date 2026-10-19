import { ValidationError } from '../../errors/customErrors.js';
import { WC_BATCH_SIZE, WC_MAX_CATALOG_PAGES, type WcUnmatchedProduct } from '../../lib/woocommerce/wcCatalog.js';
import { wcRequest, WC_SHOP_REQUEST_FAILED, type WcConnection } from './wcClient.js';

/**
 * 10.2 package 6 (D-04 parts A and C): one reading of the shop's catalog, page by page in id order: the products, then the
 * variations of each variable product (at most `WC_VARIATION_READ_CONCURRENCY` lists at a time), with each product's stock,
 * stock tracking, type and regular price. «بازخوانی محصولات سایت» and the nightly re-read (`wcCatalog.service.ts`) link
 * what it reads; nothing here writes.
 */
export interface SiteProduct {
  productId: number;
  variationId: number;
  name: string;
  sku: string;
  stock: number | null;
  manageStock: boolean;
  /** part C: the product's type (`variation` for a variation) and its regular price as the shop sent it ('' for none) */
  type: string;
  regularPrice: string | null;
}

interface RawProduct {
  id?: unknown;
  name?: unknown;
  sku?: unknown;
  type?: unknown;
  stock_quantity?: unknown;
  manage_stock?: unknown;
  regular_price?: unknown;
}

/** One reading of the shop's catalog */
export interface SiteCatalog {
  /** products and variations that hold their own stock */
  site: SiteProduct[];
  /** products read but never linked, with the reason (a variation whose stock the parent holds, an external product) */
  skipped: WcUnmatchedProduct[];
  /** the shop had more products than one refresh reads (`WC_MAX_CATALOG_PRODUCTS`) */
  truncated: boolean;
  /** the largest product id read; when the reading was truncated, a link of a product above it is left as it is */
  maxProductId: number;
  /**
   * review M-C: a list came in another order than the id order asked for (a shop or plugin that ignores `orderby`), so a
   * product may have been missed between two pages
   */
  unordered: boolean;
  /**
   * review M-R / M-S: a list showed one row on two pages, an order with ties (date, menu order) that may also leave a row
   * out, so every link of a product not read is then left as it is
   */
  repeated: boolean;
}

/** review M-6: one refresh never holds the lock longer than this (under the 60 s of a reverse proxy) */
export const WC_CATALOG_DEADLINE_MS = 50_000;
/** variation lists read at the same time */
export const WC_VARIATION_READ_CONCURRENCY = 4;
/** product types that hold no stock of their own in WooCommerce */
const NO_STOCK_TYPES = new Set(['external', 'grouped']);

function asRows(answer: unknown): RawProduct[] {
  if (!Array.isArray(answer)) {
    throw new ValidationError('پاسخ سایت فهرست محصولات نبود؛ نشانی سایت و افزونه ووکامرس را بررسی کنید.', undefined, WC_SHOP_REQUEST_FAILED);
  }
  return answer as RawProduct[];
}

function regularPriceOf(raw: RawProduct): string | null {
  return raw.regular_price === undefined || raw.regular_price === null ? null : String(raw.regular_price).trim().slice(0, 50);
}

function stockOf(raw: RawProduct): number | null {
  const n = Number(raw.stock_quantity);
  return raw.stock_quantity === null || raw.stock_quantity === undefined || !Number.isFinite(n) ? null : Math.trunc(n);
}

interface PagedRows { rows: RawProduct[]; truncated: boolean; unordered: boolean; repeated: boolean }

/**
 * Every page of a list in id order (review H-1: the default date order has no tie-breaker, so a product could be read on
 * two pages and be reported as a duplicate of itself); a row read twice is kept once and marks the list `repeated`
 * (review M-R), and a new id not above every id read before marks it `unordered` (review M-C)
 */
async function readPages(conn: WcConnection, path: string, fields: string, signal?: AbortSignal): Promise<PagedRows> {
  const rows: RawProduct[] = [];
  const seen = new Set<number>();
  let lastId = 0;
  let unordered = false;
  let repeated = false;
  for (let page = 1; page <= WC_MAX_CATALOG_PAGES; page++) {
    const batch = asRows(await wcRequest(conn, 'GET', path, null, {
      per_page: WC_BATCH_SIZE, page, status: 'any', orderby: 'id', order: 'asc', _fields: fields,
    }, { signal }));
    for (const row of batch) {
      const id = Number(row.id);
      if (seen.has(id)) {
        repeated = true;
        continue;
      }
      seen.add(id);
      if (id <= lastId) unordered = true;
      lastId = Math.max(lastId, id);
      rows.push(row);
    }
    if (batch.length < WC_BATCH_SIZE) return { rows, truncated: false, unordered, repeated };
  }
  return { rows, truncated: true, unordered, repeated };
}

/**
 * `fn` over `inputs`, at most `limit` at a time, results in input order; after the first failure no worker starts another
 * input (review M-A: the other workers kept calling the shop after the refresh had answered and released the lock) and
 * `onFailure` runs once, so the caller can abort what is still in flight; the error thrown is the first one that happened
 */
export async function mapLimited<T, R>(
  inputs: T[], limit: number, fn: (input: T) => Promise<R>, onFailure?: () => void,
): Promise<R[]> {
  const out: R[] = new Array(inputs.length);
  let next = 0;
  let failed = false;
  let firstError: unknown;
  const worker = async () => {
    while (!failed && next < inputs.length) {
      const i = next++;
      try {
        out[i] = await fn(inputs[i]);
      } catch (err) {
        if (failed) return;
        failed = true;
        firstError = err;
        onFailure?.();
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, inputs.length) }, worker));
  // review M-D: the error that came first, never the abort message of a reader stopped because of it
  if (failed) throw firstError;
  return out;
}

/**
 * Every product of the shop, and every variation with its own SKU (one that inherits its parent's SKU is the parent). A
 * variation whose stock the parent holds (`manage_stock: "parent"`) and an external or grouped product are listed, never
 * linked, so a push never changes how the shop keeps their stock (review M-1 / N-4).
 */
export async function readSiteCatalog(conn: WcConnection, signal?: AbortSignal): Promise<SiteCatalog> {
  const { rows: products, truncated, unordered: productsUnordered, repeated: productsRepeated } =
    await readPages(conn, 'products', 'id,name,sku,type,stock_quantity,manage_stock,regular_price', signal);
  const site: SiteProduct[] = [];
  const skipped: WcUnmatchedProduct[] = [];
  let maxProductId = 0;
  const variable: Array<{ productId: number; name: string; sku: string }> = [];
  for (const p of products) {
    const productId = Number(p.id);
    if (!Number.isInteger(productId) || productId <= 0) continue;
    maxProductId = Math.max(maxProductId, productId);
    const name = String(p.name ?? '');
    const sku = String(p.sku ?? '').trim();
    if (NO_STOCK_TYPES.has(String(p.type))) {
      skipped.push({ productId, variationId: 0, name, sku, reason: 'no_stock_type' });
      continue;
    }
    site.push({
      productId, variationId: 0, name, sku, stock: stockOf(p), manageStock: p.manage_stock === true,
      type: String(p.type ?? '').slice(0, 50), regularPrice: regularPriceOf(p),
    });
    if (p.type === 'variable') variable.push({ productId, name, sku });
  }
  // review N-G: the first failed variation read aborts the reads still in flight; the deadline aborts them all too
  const readers = new AbortController();
  const stopReaders = () => readers.abort();
  if (signal?.aborted) readers.abort();
  signal?.addEventListener('abort', stopReaders, { once: true });
  let variationLists: PagedRows[];
  try {
    variationLists = await mapLimited(variable, WC_VARIATION_READ_CONCURRENCY,
      v => readPages(conn, `products/${v.productId}/variations`, 'id,sku,stock_quantity,manage_stock,regular_price', readers.signal),
      stopReaders);
  } finally {
    signal?.removeEventListener('abort', stopReaders);
  }
  variable.forEach(({ productId, name, sku }, i) => {
    for (const v of variationLists[i].rows) {
      const variationId = Number(v.id);
      const vSku = String(v.sku ?? '').trim();
      if (!Number.isInteger(variationId) || variationId <= 0 || (vSku !== '' && vSku === sku)) continue;
      if (v.manage_stock === 'parent') {
        skipped.push({ productId, variationId, name, sku: vSku, reason: 'parent_stock' });
        continue;
      }
      site.push({
        productId, variationId, name, sku: vSku, stock: stockOf(v), manageStock: v.manage_stock === true,
        type: 'variation', regularPrice: regularPriceOf(v),
      });
    }
  });
  return {
    site, skipped, truncated, maxProductId,
    unordered: productsUnordered || variationLists.some(l => l.unordered),
    repeated: productsRepeated || variationLists.some(l => l.repeated),
  };
}
