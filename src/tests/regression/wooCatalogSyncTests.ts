import { TestCaseResult } from '../types.js';
import type { Harness, ShouldRun } from '../security/workflowTestHarness.js';
import { runReservationCases } from './stockReservationTests.js';
import type { MockProduct } from '../fixtures/mockWooCatalogStore.js';
import { brief, linksOf, newItem, withShop } from './wooCatalogTestKit.js';
import { deadlineAndCapCase, emptyOrUnorderedCase, removedProductAndDeadlinesCase } from './wooCatalogReviewTests.js';
import { autoPushBoundedFailuresCase, autoPushChangedTrackedCase, autoPushOpenOrdersCase, autoPushSwitchCase } from './wooAutoPushTests.js';
import {
  autoPushCapCase, autoPushOrderListMovedCase, autoPushOrderPageEdgeCase, autoPushRefusedBatchCase, autoPushRunPurgeCase, autoPushWebhookAndHourlyCase,
} from './wooAutoPushReviewTests.js';
import { autoPushFailedHoldCase, autoPushOrderOverlapCase } from './wooAutoPushHoldTests.js';
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
    ['reg_wc_catalog_stable_order_d04',
      'D-04 review H-1 / M-6: the catalog is read in id order, a product read on two pages is one product, and variation lists are read a few at a time',
      ['d04', 'woocommerce', 'catalog', 'review'], stableOrderCase],
    ['reg_wc_catalog_skips_stock_mode_d04',
      'D-04 review M-1 / M-2 / N-3 / N-4 / N-5: a variation whose stock the parent holds and an external or grouped product are listed, never linked; an item two earlier codes reach is ambiguous; a deleted item is never pushed; a failed refresh keeps the lists',
      ['d04', 'woocommerce', 'catalog', 'review'], skippedProductsCase],
    ['reg_wc_catalog_deadline_cap_d04',
      'D-04 review M-6 / N-1 / N-2: a refresh past its deadline and one stopped by the address guard are failed runs that change no link, and a reading cut at the product cap leaves the links of products it did not reach',
      ['d04', 'woocommerce', 'catalog', 'review'], deadlineAndCapCase],
    ['reg_wc_catalog_removed_product_closes_link_d04',
      'D-04 delta review H-A / M-A / M-D / N-A: a product removed from the shop closes its link (only a product past the cap keeps one), a failed variation read stops the other readers and its own error is reported, and a push past its deadline sends nothing more',
      ['d04', 'woocommerce', 'catalog', 'review'], removedProductAndDeadlinesCase],
    ['reg_wc_catalog_empty_or_unordered_d04',
      'D-04 delta review M-B / M-C / N-1 / M-R / M-S: an empty catalog while items are linked is a failed run that closes no link, and only a reading that showed a row twice, or was out of id order and cut at the cap, keeps the links of products it did not read and says so',
      ['d04', 'woocommerce', 'catalog', 'review'], emptyOrUnorderedCase],
    ['reg_wc_auto_push_switch_d04',
      'D-04 part B: the automatic push is off by default, only woocommerce.manage turns it on or off with the target state, with an audit row and a complete connection',
      ['d04', 'woocommerce', 'auto'], autoPushSwitchCase],
    ['reg_wc_auto_push_changed_tracked_d04',
      'D-04 part B: an automatic run sends only products whose sellable stock moved and whose stock tracking is already on, never manage_stock, and asks the shop nothing when nothing moved',
      ['d04', 'woocommerce', 'auto'], autoPushChangedTrackedCase],
    ['reg_wc_auto_push_open_orders_d04',
      'D-04 part B: on-hold and processing orders without a live invoice and completed orders whose invoice failed in the last 30 days are kept off the stock the automatic and the manual push send, pending and invoiced orders and older failures are not, and unreadable orders stop the push',
      ['d04', 'woocommerce', 'auto'], autoPushOpenOrdersCase],
    ['reg_wc_auto_push_bounded_failures_d04',
      'D-04 part B: a shop that is down makes each automatic run wait longer without counting against a product, a product the shop keeps refusing stops after the limit, and a run skips while the lock is taken',
      ['d04', 'woocommerce', 'auto'], autoPushBoundedFailuresCase],
    ['reg_wc_auto_push_order_list_moved_d04',
      'D-04 part B review M-5 / M-6: an open order list that changes between two pages, or holds more orders than the cap, stops the push with nothing sent',
      ['d04', 'woocommerce', 'auto'], autoPushOrderListMovedCase],
    ['reg_wc_auto_push_order_page_edge_d04',
      'D-04 part B delta review M-2 / N-2: an order leaving a read page while another joins, keeping the count, fails the push closed through page 1 read again; a reading slower than its budget fails',
      ['d04', 'woocommerce', 'auto'], autoPushOrderPageEdgeCase],
    ['reg_wc_auto_push_failed_hold_d04',
      'D-04 part B delta review M-A: a failed completed order is kept off for 30 days from its completion in the shop, never restarted by touching its log, and a hand invoice tagged with the order is linked by a manual sync without a second invoice',
      ['d04', 'woocommerce', 'auto'], autoPushFailedHoldCase],
    ['reg_wc_auto_push_order_overlap_d04',
      'D-04 part B delta review N-A: open orders are read with overlapping pages, so an order leaving a later read page while an older one joins fails the push closed',
      ['d04', 'woocommerce', 'auto'], autoPushOrderOverlapCase],
    ['reg_wc_auto_push_webhook_hourly_d04',
      'D-04 part B review M-3 / delta N-4: an order webhook (order.deleted too, through the order log) makes its products due on the next run and the hourly pass corrects an order that came without one',
      ['d04', 'woocommerce', 'auto'], autoPushWebhookAndHourlyCase],
    ['reg_wc_auto_push_refused_batch_d04',
      'D-04 part B review M-4: a batch refused for its products (404) counts against each product and stops it after the limit without making the runs wait',
      ['d04', 'woocommerce', 'auto'], autoPushRefusedBatchCase],
    ['reg_wc_auto_push_cap_d04',
      'D-04 part B review d: one automatic run sends at most its cap of products and the rest go on the next run',
      ['d04', 'woocommerce', 'auto'], autoPushCapCase],
    ['reg_wc_auto_push_run_purge_d04',
      'D-04 part B review c / delta N-6: the daily operational purge removes automatic run rows older than 30 days and keeps manual and recent runs, and one failing purge never skips the others',
      ['d04', 'woocommerce', 'auto'], autoPushRunPurgeCase],
    ['reg_wc_synced_orders_by_log_obs_r2_83',
      'OBS-R2-83: the synced-orders list shows the invoices the order log names, not invoices whose notes mention an online order',
      ['obs_r2_83', 'woocommerce', 'orders'], syncedOrdersCase],
  ]);
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
    const body = res.body as { totalItems?: number; syncedCount?: number; failedCount?: number; trackingEnabledCount?: number; refreshed?: unknown };
    if (body.totalItems !== 3 || body.syncedCount !== 2 || body.failedCount !== 1 || !body.refreshed) {
      wrong.push(`bulk push counts ${JSON.stringify(body).slice(0, 200)}, expected 3 / 2 / 1 after a first refresh`);
    }
    // variation 61 had stock tracking off on the site and the push turned it on; product 1 already tracked, product 2 failed
    if (body.trackingEnabledCount !== 1) wrong.push(`tracking enabled count ${body.trackingEnabledCount}, expected 1`);
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
    if (details.syncedCount !== 2 || details.failedCount !== 1 || details.trackingEnabledCount !== 1 || JSON.stringify(details).includes('price')) {
      wrong.push(`push audit details ${JSON.stringify(details)}, expected counts only`);
    }

    // one item: through its link, one batch of one
    store.batchSizes.length = 0;
    const one = await h.post('/api/woocommerce/sync-item', { itemId: a.id });
    if (one.status !== 200 || store.batchSizes.join(',') !== '1') wrong.push(`sync of one item answered ${brief(one)} with batches ${store.batchSizes.join(',')}`);
    if ((one.body as { trackingEnabledCount?: number }).trackingEnabledCount !== 0) wrong.push(`a product already tracked counted as turned on: ${brief(one)}`);
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

type CatalogBody = {
  unmatched?: Array<{ productId: number; variationId: number; reason: string }>;
  unmatchedTotal?: number;
  linkedCount?: number;
  lastRefresh?: { status?: string };
};

async function stableOrderCase(h: Harness, wrong: string[]): Promise<string> {
  const edge = await newItem(h, 'EDGE');
  const fillers: MockProduct[] = Array.from({ length: 149 }, (_, i) => ({ id: 1000 + i, sku: `ORD_${h.tag}_${i}` }));
  // product 1099 is the last row of page 1; a date order without a tie-breaker shows it again first on page 2
  fillers[99] = { id: 1099, sku: edge.code };
  const variable: MockProduct[] = Array.from({ length: 10 }, (_, i) => ({
    id: 3000 + i, sku: `VAR_${h.tag}_${i}`, variations: [{ id: 30000 + i, sku: `VARV_${h.tag}_${i}` }],
  }));
  return withShop(h, [...fillers, ...variable], async (store) => {
    store.unstableOrder = 'without_id_order';
    store.delayMs = 20;
    const res = await h.post('/api/woocommerce/refresh-products', {});
    if (res.status !== 200) {
      wrong.push(`refresh answered ${brief(res)}, expected 200`);
      return 'refresh refused';
    }
    const pageQueries = store.queries.filter(q => q.has('page'));
    if (pageQueries.some(q => q.get('orderby') !== 'id' || q.get('order') !== 'asc')) wrong.push('a catalog page was asked without orderby=id&order=asc');
    const links = await linksOf(h, [edge.id]);
    if (links.get(edge.id)?.product !== 1099) wrong.push(`the product on the page edge was not linked: ${JSON.stringify(links.get(edge.id) ?? null)}`);
    const body = res.body as { unmatched?: Array<{ productId: number; reason: string }> };
    if (body.unmatched?.some(u => u.reason === 'duplicate_sku')) wrong.push('a product read on two pages was reported as a duplicate of itself');
    if (store.maxInFlight < 2 || store.maxInFlight > 4) wrong.push(`variation lists were read ${store.maxInFlight} at a time, expected 2 to 4`);

    // a shop that repeats a row whatever the order: still one product
    store.unstableOrder = 'always';
    const again = await h.post('/api/woocommerce/refresh-products', {});
    const againBody = again.body as { unmatched?: Array<{ reason: string }>; closedCount?: number };
    if (again.status !== 200 || againBody.unmatched?.some(u => u.reason === 'duplicate_sku') || againBody.closedCount !== 0) {
      wrong.push(`a repeated row was not read once: ${brief(again)}`);
    }
    return `${store.requests.length} shop requests, at most ${store.maxInFlight} at once`;
  });
}

async function skippedProductsCase(h: Harness, wrong: string[]): Promise<string> {
  const parentStock = await newItem(h, 'PS', { '': 2 });
  const external = await newItem(h, 'EX', { '': 2 });
  const ambiguous = await newItem(h, 'AM', { '': 2 });
  const deleted = await newItem(h, 'DL', { '': 5 });
  const kept = await newItem(h, 'KP', { '': 3 });
  const old1 = `OLD1_${h.tag}`;
  const old2 = `OLD2_${h.tag}`;
  await h.q(`INSERT INTO item_code_history (item_id, old_code, new_code, reason) VALUES ($1, $2, $3, 'آزمون'), ($1, $4, $3, 'آزمون')`,
    [ambiguous.id, old1, ambiguous.code, old2]);
  const products: MockProduct[] = [
    { id: 10, sku: `PAR_${h.tag}`, variations: [{ id: 101, sku: parentStock.code, manageStock: 'parent' }] },
    { id: 11, sku: external.code, type: 'external' },
    { id: 12, sku: '', type: 'grouped' },
    { id: 13, sku: old1 }, { id: 14, sku: old2 },
    { id: 15, sku: deleted.code, stock: 5 },
    { id: 16, sku: kept.code, stock: 3 },
  ];
  return withShop(h, products, async (store) => {
    const res = await h.post('/api/woocommerce/refresh-products', {});
    if (res.status !== 200) {
      wrong.push(`refresh answered ${brief(res)}, expected 200`);
      return 'refresh refused';
    }
    const body = res.body as CatalogBody;
    const reasonOf = (productId: number, variationId = 0) => body.unmatched?.find(u => u.productId === productId && u.variationId === variationId)?.reason;
    if (reasonOf(10, 101) !== 'parent_stock') wrong.push(`a variation whose stock the parent holds: ${reasonOf(10, 101)}`);
    if (reasonOf(11) !== 'no_stock_type' || reasonOf(12) !== 'no_stock_type') wrong.push(`external / grouped: ${reasonOf(11)} / ${reasonOf(12)}`);
    if (reasonOf(13) !== 'item_ambiguous' || reasonOf(14) !== 'item_ambiguous') wrong.push(`two earlier codes of one item: ${reasonOf(13)} / ${reasonOf(14)}`);
    const links = await linksOf(h, [parentStock.id, external.id, ambiguous.id, deleted.id, kept.id]);
    for (const [label, id] of [['parent stock', parentStock.id], ['external', external.id], ['ambiguous', ambiguous.id]] as const) {
      if (links.has(id)) wrong.push(`the ${label} item got a link`);
    }
    if (!links.has(deleted.id) || !links.has(kept.id)) wrong.push('the two ordinary products were not linked');

    const [audit] = await h.q(`SELECT description FROM activity_logs WHERE action = 'WC_CATALOG_REFRESH' ORDER BY id DESC LIMIT 1`);
    if (/[0-9]/.test(String(audit?.description ?? ''))) wrong.push(`the refresh audit row prints Latin digits: ${audit?.description}`);

    // an item deleted in the program is never pushed and no longer counts as linked
    await h.q(`UPDATE items SET is_deleted = 1 WHERE id = $1`, [deleted.id]);
    const push = await h.post('/api/woocommerce/sync-all-stocks', {});
    if (push.status !== 200 || store.pushed.has(15) || store.pushed.get(16) !== 3) {
      wrong.push(`push after a delete answered ${brief(push)}, pushed ${JSON.stringify([...store.pushed])}`);
    }
    if ((push.body as { totalItems?: number }).totalItems !== 1) wrong.push(`push counted ${(push.body as { totalItems?: number }).totalItems} items, expected 1`);
    if (store.requests.some(r => r.startsWith('POST') && r.includes('variations'))) wrong.push('a variation whose stock the parent holds was pushed');

    // a failed refresh keeps the lists of the last reading
    store.failStatus = 500;
    await h.post('/api/woocommerce/refresh-products', {});
    const catalog = (await h.get('/api/woocommerce/catalog')).body as CatalogBody;
    if (catalog.lastRefresh?.status !== 'failed') wrong.push(`last refresh ${catalog.lastRefresh?.status}, expected failed`);
    if (!catalog.unmatched?.some(u => u.productId === 11) || (catalog.unmatchedTotal ?? 0) < 5) wrong.push('a failed refresh emptied the unmatched list');
    if (catalog.linkedCount !== 1) wrong.push(`linked count ${catalog.linkedCount}, expected 1 without the deleted item`);
    return `${store.requests.length} shop requests`;
  });
}
