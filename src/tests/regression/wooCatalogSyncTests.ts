import { TestCaseResult } from '../types.js';
import type { Harness, ShouldRun } from '../security/workflowTestHarness.js';
import { runReservationCases } from './stockReservationTests.js';
import { mockWooCatalogStore, type MockProduct, type MockWooCatalogStore } from '../fixtures/mockWooCatalogStore.js';
import { WC_LIST_LIMIT } from '../../lib/woocommerce/wcCatalog.js';

/**
 * 10.2 package 6 (D-04 part A, OBS-R2-83): items are linked to the shop's products by «بازخوانی محصولات سایت» and stock goes
 * to the shop through those links in batches of one hundred, instead of one search and one update per item. Every case runs
 * against a stand-in shop on 127.0.0.1 (`mockWooCatalogStore`), never a real one. Red on v10.2.2: the refresh and catalog
 * routes did not exist, the stock push asked `GET products?sku=` and `PUT products/<id>` per item, a failing shop was a 500
 * and the synced-orders list searched the document notes.
 */
export async function runWooCatalogSyncTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_wc_catalog_refresh_links_d04',
      'D-04: the catalog refresh reads every page and variation and links each item to the one product its current or earlier code finds; duplicates, missing SKUs and a second product of one item are only listed',
      ['d04', 'woocommerce', 'catalog'], catalogRefreshCase],
    ['reg_wc_stock_push_batches_obs_r2_83',
      'OBS-R2-83: the bulk stock push sends the linked items in batch requests, records each row\'s failure on its link and writes one audit row of counts',
      ['obs_r2_83', 'd04', 'woocommerce', 'stock'], stockPushBatchCase],
    ['reg_wc_shop_errors_visible_d04',
      'D-04: an item the shop has no product for is 422 WC_ITEM_NOT_LINKED, a failing shop is 422 WC_SHOP_REQUEST_FAILED with a Persian message and a failed run in the tab, never a 500',
      ['d04', 'woocommerce', 'errors'], shopErrorsCase],
    ['reg_wc_synced_orders_by_log_obs_r2_83',
      'OBS-R2-83: the synced-orders list shows the invoices the order log names, not invoices whose notes mention an online order',
      ['obs_r2_83', 'woocommerce', 'orders'], syncedOrdersCase],
  ]);
}

const CONNECTION_KEYS = ['wc_store_url', 'wc_consumer_key', 'wc_consumer_secret', 'wc_shop_warehouse'];

/** Points the settings at a stand-in shop with no links or runs left from another case, and puts everything back after */
async function withShop<T>(h: Harness, products: MockProduct[], fn: (store: MockWooCatalogStore) => Promise<T>): Promise<T> {
  const previous = await h.q(`SELECT key, value FROM app_settings WHERE key = ANY($1)`, [CONNECTION_KEYS]);
  const store = await mockWooCatalogStore(products);
  const clear = async () => {
    await h.q(`DELETE FROM wc_product_links`);
    await h.q(`DELETE FROM wc_sync_runs`);
  };
  try {
    await clear();
    await h.q(`DELETE FROM app_settings WHERE key = ANY($1)`, [CONNECTION_KEYS]);
    await h.q(`INSERT INTO app_settings (key, value) VALUES ('wc_store_url', $1), ('wc_consumer_key', 'ck_d04'), ('wc_consumer_secret', 'cs_d04')`, [store.url]);
    return await fn(store);
  } finally {
    await store.close();
    await clear().catch(() => undefined);
    await h.q(`DELETE FROM app_settings WHERE key = ANY($1)`, [CONNECTION_KEYS]).catch(() => undefined);
    for (const row of previous) await h.q(`INSERT INTO app_settings (key, value) VALUES ($1, $2)`, [row.key, row.value]).catch(() => undefined);
  }
}

const brief = (res: { status: number; body: unknown }) => `${res.status} ${JSON.stringify(res.body).slice(0, 200)}`;

async function newItem(h: Harness, label: string, stocks?: Record<string, number>): Promise<{ id: number; code: string }> {
  const { createTestItem } = await import('../fixtures/factories.js');
  const code = `WC${label}_${h.tag}_${Math.floor(Math.random() * 1e6)}`;
  const item = await createTestItem({ code, ...(stocks ? { stocks } : {}) });
  return { id: item.id, code };
}

async function linksOf(h: Harness, itemIds: number[]): Promise<Map<number, { product: number; variation: number; stock: number | null; error: string; failures: number }>> {
  const rows = await h.q(
    `SELECT item_id, wc_product_id, wc_variation_id, site_stock, last_error, failure_count FROM wc_product_links WHERE is_deleted = 0 AND item_id = ANY($1)`,
    [itemIds],
  );
  return new Map(rows.map(r => [Number(r.item_id), {
    product: Number(r.wc_product_id), variation: Number(r.wc_variation_id), stock: r.site_stock === null ? null : Number(r.site_stock),
    error: String(r.last_error ?? ''), failures: Number(r.failure_count),
  }]));
}

async function catalogRefreshCase(h: Harness, wrong: string[]): Promise<string> {
  const a = await newItem(h, 'A');
  const renamed = await newItem(h, 'B');
  const viaVariation = await newItem(h, 'C');
  const twice = await newItem(h, 'D');
  const notOnSite = await newItem(h, 'E');
  const oldB = `OLD_B_${h.tag}`;
  const oldD = `OLD_D_${h.tag}`;
  await h.q(`INSERT INTO item_code_history (item_id, old_code, new_code, reason) VALUES ($1, $2, $3, 'آزمون'), ($4, $5, $6, 'آزمون')`,
    [renamed.id, oldB, renamed.code, twice.id, oldD, twice.code]);
  const fillers: MockProduct[] = Array.from({ length: 100 }, (_, i) => ({ id: 9000 + i, sku: `NO_SUCH_${h.tag}_${i}` }));
  const products: MockProduct[] = [
    { id: 1, sku: a.code },
    { id: 2, sku: oldB },
    { id: 3, sku: `DUP_${h.tag}` }, { id: 4, sku: `DUP_${h.tag}` },
    { id: 5, sku: '' },
    { id: 6, sku: `PARENT_${h.tag}`, variations: [{ id: 61, sku: viaVariation.code }, { id: 62, sku: `PARENT_${h.tag}` }] },
    { id: 7, sku: twice.code },
    { id: 8, sku: oldD },
    ...fillers,
  ];
  return withShop(h, products, async (store) => {
    const reader = await h.sessionWith(['woocommerce.view']);
    const denied = await h.post('/api/woocommerce/refresh-products', {}, reader);
    if (denied.status !== 403) wrong.push(`a woocommerce.view reader refreshed the catalog: ${brief(denied)}`);

    const res = await h.post('/api/woocommerce/refresh-products', {});
    if (res.status !== 200) {
      wrong.push(`refresh answered ${brief(res)}, expected 200`);
      return 'refresh refused';
    }
    for (const r of ['GET products?page=1', 'GET products?page=2', 'GET products/6/variations?page=1']) {
      if (!store.requests.includes(r)) wrong.push(`the refresh never asked "${r}" (asked: ${store.requests.slice(0, 6).join(', ')})`);
    }
    const links = await linksOf(h, [a.id, renamed.id, viaVariation.id, twice.id, notOnSite.id]);
    const expect = (label: string, id: number, product: number, variation: number) => {
      const l = links.get(id);
      if (!l || l.product !== product || l.variation !== variation) wrong.push(`${label}: link ${JSON.stringify(l ?? null)}, expected product ${product} variation ${variation}`);
    };
    expect('current code', a.id, 1, 0);
    expect('earlier code', renamed.id, 2, 0);
    expect('variation', viaVariation.id, 6, 61);
    expect('current code wins over an earlier one', twice.id, 7, 0);
    if (links.has(notOnSite.id)) wrong.push('an item without a product on the site got a link');

    const catalog = await h.get('/api/woocommerce/catalog', reader);
    if (catalog.status !== 200) wrong.push(`a woocommerce.view reader read the catalog: ${brief(catalog)}`);
    const body = catalog.body as { unmatched?: Array<{ productId: number; variationId: number; reason: string }>; unmatchedTotal?: number; itemsNotOnSite?: Array<{ itemId: number }>; itemsNotOnSiteTotal?: number };
    const reasonOf = (productId: number, variationId = 0) => body.unmatched?.find(u => u.productId === productId && u.variationId === variationId)?.reason;
    if (reasonOf(3) !== 'duplicate_sku' || reasonOf(4) !== 'duplicate_sku') wrong.push(`duplicate SKUs: ${reasonOf(3)} / ${reasonOf(4)}`);
    if (reasonOf(5) !== 'no_sku') wrong.push(`a product without SKU: ${reasonOf(5)}`);
    if (reasonOf(8) !== 'item_taken') wrong.push(`the earlier-code product of an item already linked: ${reasonOf(8)}`);
    if (reasonOf(6) !== 'unknown_sku') wrong.push(`an unknown SKU: ${reasonOf(6)}`);
    if (reasonOf(6, 62) !== undefined) wrong.push('a variation inheriting its parent\'s SKU was listed on its own');
    if (body.unmatchedTotal !== 105) wrong.push(`unmatched total ${body.unmatchedTotal}, expected 105`);
    // the list holds the first WC_LIST_LIMIT items by code; the shared test schema has many unlinked items, so the total is
    // compared with the database and the item is looked for only while the list is not full
    const [{ unlinked }] = await h.q(
      `SELECT count(*)::int AS unlinked FROM items i WHERE i.is_deleted = 0 AND i.type = 'product' AND btrim(coalesce(i.code, '')) <> ''
         AND NOT EXISTS (SELECT 1 FROM wc_product_links l WHERE l.item_id = i.id AND l.is_deleted = 0)`,
    );
    const listed = body.itemsNotOnSite ?? [];
    if (body.itemsNotOnSiteTotal !== Number(unlinked)) wrong.push(`items not on the site: total ${body.itemsNotOnSiteTotal}, expected ${unlinked}`);
    if (listed.length < WC_LIST_LIMIT && !listed.some(i => i.itemId === notOnSite.id)) wrong.push('the item without a site product is not listed');

    const audit = await h.q(`SELECT details FROM activity_logs WHERE action = 'WC_CATALOG_REFRESH' AND entity = 'فروشگاه اینترنتی' ORDER BY id DESC LIMIT 1`);
    if (audit.length !== 1) wrong.push('the refresh wrote no audit row');

    // a second refresh of the same catalog keeps the links (same rows, nothing new or closed)
    const before = await h.q(`SELECT id FROM wc_product_links WHERE is_deleted = 0 ORDER BY id`);
    const again = await h.post('/api/woocommerce/refresh-products', {});
    const after = await h.q(`SELECT id FROM wc_product_links WHERE is_deleted = 0 ORDER BY id`);
    const again2 = again.body as { newCount?: number; closedCount?: number };
    if (again.status !== 200 || again2.newCount !== 0 || again2.closedCount !== 0 || JSON.stringify(before) !== JSON.stringify(after)) {
      wrong.push(`a second refresh changed the links: ${brief(again)}`);
    }
    return `${store.requests.length} shop requests, ${links.size} links`;
  });
}

async function stockPushBatchCase(h: Harness, wrong: string[]): Promise<string> {
  const a = await newItem(h, 'PA', { '': 4 });
  const b = await newItem(h, 'PB', { '': 2.5 });
  const c = await newItem(h, 'PC', { '': 1 });
  return withShop(h, [{ id: 1, sku: a.code, stock: 9 }, { id: 2, sku: b.code }, { id: 6, sku: `P_${h.tag}`, variations: [{ id: 61, sku: c.code }] }], async (store) => {
    store.rowErrors.add(2);
    const res = await h.post('/api/woocommerce/sync-all-stocks', {});
    if (res.status !== 200) {
      wrong.push(`bulk push answered ${brief(res)}, expected 200`);
      return 'push refused';
    }
    const body = res.body as { totalItems?: number; syncedCount?: number; failedCount?: number; refreshed?: unknown };
    if (body.totalItems !== 3 || body.syncedCount !== 2 || body.failedCount !== 1 || !body.refreshed) {
      wrong.push(`bulk push counts ${JSON.stringify(body).slice(0, 200)}, expected 3 / 2 / 1 after a first refresh`);
    }
    const batches = store.requests.filter(r => r.startsWith('POST'));
    if (batches.join(',') !== 'POST products/batch,POST products/6/variations/batch' || store.batchSizes.join(',') !== '2,1') {
      wrong.push(`batch requests ${batches.join(', ')} sizes ${store.batchSizes.join(',')}, expected one products batch of 2 and one variations batch of 1`);
    }
    if (store.requests.some(r => r.startsWith('PUT') || r.includes('sku'))) wrong.push(`the push still asked per item: ${store.requests.join(', ')}`);
    if (store.pushed.get(1) !== 4 || store.pushed.get(61) !== 1) wrong.push(`pushed ${store.pushed.get(1)} / ${store.pushed.get(61)}, expected 4 / 1`);

    const links = await linksOf(h, [a.id, b.id, c.id]);
    if (links.get(a.id)?.stock !== 4 || links.get(a.id)?.error !== '') wrong.push(`link of the pushed item ${JSON.stringify(links.get(a.id))}`);
    const failed = links.get(b.id);
    if (!failed || failed.error === '' || failed.failures !== 1) wrong.push(`link of the refused row ${JSON.stringify(failed ?? null)}, expected its error and one failure`);

    const catalog = await h.get('/api/woocommerce/catalog');
    const report = catalog.body as { failing?: Array<{ itemId: number }>; lastPush?: { status?: string } };
    if (!report.failing?.some(f => f.itemId === b.id)) wrong.push('the tab does not list the item whose push failed');
    if (report.lastPush?.status !== 'partial') wrong.push(`last push status ${report.lastPush?.status}, expected partial`);

    const [audit] = await h.q(`SELECT details FROM activity_logs WHERE action = 'WC_STOCK_PUSH' AND entity = 'فروشگاه اینترنتی' ORDER BY id DESC LIMIT 1`);
    const details = (audit?.details ?? {}) as Record<string, unknown>;
    if (details.syncedCount !== 2 || details.failedCount !== 1 || JSON.stringify(details).includes('price')) {
      wrong.push(`push audit details ${JSON.stringify(details)}, expected counts only`);
    }

    // one item: through its link, one batch of one
    store.batchSizes.length = 0;
    const one = await h.post('/api/woocommerce/sync-item', { itemId: a.id });
    if (one.status !== 200 || store.batchSizes.join(',') !== '1') wrong.push(`sync of one item answered ${brief(one)} with batches ${store.batchSizes.join(',')}`);
    return `${store.requests.length} shop requests`;
  });
}

async function shopErrorsCase(h: Harness, wrong: string[]): Promise<string> {
  const listed = await newItem(h, 'L', { '': 3 });
  const missing = await newItem(h, 'M', { '': 3 });
  return withShop(h, [{ id: 1, sku: listed.code }], async (store) => {
    const res = await h.post('/api/woocommerce/sync-item', { itemId: missing.id });
    if (res.status !== 422 || (res.body as { code?: string }).code !== 'WC_ITEM_NOT_LINKED') wrong.push(`an item without a site product answered ${brief(res)}, expected 422 WC_ITEM_NOT_LINKED`);
    if (!store.requests.includes('GET products?page=1')) wrong.push('the catalog was not read once before refusing an unlinked item');

    store.failStatus = 500;
    const down = await h.post('/api/woocommerce/refresh-products', {});
    const downBody = down.body as { code?: string; message?: string; error?: string };
    if (down.status !== 422 || downBody.code !== 'WC_SHOP_REQUEST_FAILED') wrong.push(`a failing shop answered ${brief(down)}, expected 422 WC_SHOP_REQUEST_FAILED`);
    if (!/[؀-ۿ]/.test(String(downBody.message ?? downBody.error ?? ''))) wrong.push('the failing shop\'s answer has no Persian message');
    const catalog = await h.get('/api/woocommerce/catalog');
    const last = (catalog.body as { lastRefresh?: { status?: string; error?: string } }).lastRefresh;
    if (last?.status !== 'failed' || !last.error) wrong.push(`the tab's last refresh ${JSON.stringify(last ?? null)}, expected failed with its message`);
    return 'unlinked 422, failing shop 422';
  });
}

async function syncedOrdersCase(h: Harness, wrong: string[]): Promise<string> {
  const { createTestDocument } = await import('../fixtures/factories.js');
  const logged = await createTestDocument({ type: 'invoice', notes: 'فاکتور فروش برخط' });
  const mentioned = await createTestDocument({ type: 'invoice', notes: 'سفارش ووکامرس دستی، بی گزارش سفارش' });
  const orderId = `D04_${h.tag}_${Math.floor(Math.random() * 1e6)}`;
  await h.q(`INSERT INTO woocommerce_order_logs (wc_order_id, erp_document_id, status) VALUES ($1, $2, 'processed')`, [orderId, logged.document.id]);
  try {
    const res = await h.get('/api/woocommerce/synced-orders');
    const ids = Array.isArray(res.body) ? (res.body as Array<{ id: number }>).map(d => d.id) : [];
    if (res.status !== 200 || !ids.includes(logged.document.id)) wrong.push(`the invoice the order log names is missing: ${brief(res)}`);
    if (ids.includes(mentioned.document.id)) wrong.push('an invoice was listed only because its notes mention an online order');
    return `${ids.length} invoices`;
  } finally {
    await h.q(`DELETE FROM woocommerce_order_logs WHERE wc_order_id = $1`, [orderId]);
  }
}
