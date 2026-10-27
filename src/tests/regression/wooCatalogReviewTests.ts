import type { Harness } from '../security/workflowTestHarness.js';
import type { MockProduct } from '../fixtures/mockWooCatalogStore.js';
import { brief, linksOf, newItem, withShop } from './wooCatalogTestKit.js';

/**
 * 10.2 package 6 (D-04 part A): the cases of the review rounds of the catalog refresh and the stock push (deadlines, the
 * product cap, removed products, an empty or unordered catalog), registered in `wooCatalogSyncTests.ts`
 */
export async function emptyOrUnorderedCase(h: Harness, wrong: string[]): Promise<string> {
  const { refreshCatalogLocked, applyCatalogLinks, readSiteCatalog, EMPTY_CATALOG_MESSAGE } = await import('../../services/woocommerce/wcCatalog.service.js');
  const { requireWcConnection } = await import('../../services/woocommerce/wcClient.js');
  const one = await newItem(h, 'ONE');
  const two = await newItem(h, 'TWO');
  const products: MockProduct[] = [{ id: 10, sku: one.code }, { id: 20, sku: two.code }, { id: 30, sku: `NOITEM_${h.tag}` }];
  return withShop(h, products, async (store) => {
    await refreshCatalogLocked({});
    const linked = await h.q(`SELECT id, item_id, wc_product_id FROM wc_product_links WHERE is_deleted = 0 ORDER BY id`);
    if (linked.length !== 2) wrong.push(`first refresh linked ${linked.length} products, expected 2`);

    // M-B: the shop answers an empty list (200); nothing changes and the run is failed
    await h.q(`DELETE FROM wc_sync_runs`);
    const saved = products.splice(0, products.length);
    const empty = await h.post('/api/woocommerce/refresh-products', {});
    if (empty.status !== 422 || !JSON.stringify(empty.body).includes(EMPTY_CATALOG_MESSAGE)) wrong.push(`an empty catalog answered ${brief(empty)}`);
    const afterEmpty = await h.q(`SELECT id, item_id, wc_product_id FROM wc_product_links WHERE is_deleted = 0 ORDER BY id`);
    if (JSON.stringify(afterEmpty) !== JSON.stringify(linked)) wrong.push('an empty catalog changed the links');
    const runs = await h.q(`SELECT status, error_message FROM wc_sync_runs WHERE kind = 'refresh'`);
    if (runs.length !== 1 || runs[0].status !== 'failed' || runs[0].error_message !== EMPTY_CATALOG_MESSAGE) {
      wrong.push(`runs after an empty catalog: ${JSON.stringify(runs)}`);
    }

    // M-C: the shop ignores the id order (newest first); the reading notices it
    products.push(saved[0], saved[2]);
    store.newestFirst = true;
    const seen = await readSiteCatalog(await requireWcConnection());
    if (!seen.unordered || seen.truncated) wrong.push(`a reading newest first was not marked unordered: ${JSON.stringify({ unordered: seen.unordered, truncated: seen.truncated })}`);

    // N-1: a complete reading out of id order still lists every product, so product 20's link closes as normal
    const complete = await refreshCatalogLocked({});
    const links = await linksOf(h, [one.id, two.id]);
    if (links.has(two.id)) wrong.push('a complete reading out of id order kept the link of a product the shop no longer lists');
    if (links.get(one.id)?.product !== 10) wrong.push('a reading out of id order lost the link of a product it read');
    if (complete.catalogUnordered || complete.closedCount !== 1) wrong.push(`complete unordered summary ${JSON.stringify(complete).slice(0, 200)}`);
    const catalog = (await h.get('/api/woocommerce/catalog')).body as { catalogUnordered?: boolean };
    if (catalog.catalogUnordered !== false) wrong.push('the tab warns about the order of a complete reading');
    store.newestFirst = false;

    // a reading cut at the cap and out of id order keeps every link it did not read, even below the largest id read, and says so
    await h.q(`INSERT INTO wc_product_links (item_id, wc_product_id, wc_variation_id, site_sku) VALUES ($1, 40, 41, $2)`, [two.id, two.code]);
    const read10 = [{ productId: 10, variationId: 0, name: 'o', sku: one.code, stock: null, manageStock: false, type: 'simple', regularPrice: null }];
    const cut = await applyCatalogLinks({ site: read10, skipped: [], truncated: true, maxProductId: 90, unordered: true, repeated: false, shifted: false, missing: 0, gapVariationProducts: [], missingVariations: 0, partialVariationProducts: [] }, {});
    if ((await linksOf(h, [two.id])).get(two.id)?.variation !== 41 || cut.closedCount !== 0 || !cut.catalogUnordered) {
      wrong.push(`a truncated unordered reading closed an unread variation link: ${JSON.stringify(cut).slice(0, 200)}`);
    }
    if (((await h.get('/api/woocommerce/catalog')).body as { catalogUnordered?: boolean }).catalogUnordered !== true) wrong.push('the tab does not say the last cut reading was out of id order');

    // the same reading read to the end closes it
    const whole = await applyCatalogLinks({ site: read10, skipped: [], truncated: false, maxProductId: 90, unordered: true, repeated: false, shifted: false, missing: 0, gapVariationProducts: [], missingVariations: 0, partialVariationProducts: [] }, {});
    if ((await linksOf(h, [two.id])).has(two.id) || whole.closedCount !== 1 || whole.catalogUnordered) {
      wrong.push(`a complete unordered reading kept an unread variation link: ${JSON.stringify(whole).slice(0, 200)}`);
    }

    // M-R: a complete reading out of id order that shows a row twice (a date order without a tie-breaker) also left a row
    // out; the link of the product it left out is kept and the reading says so
    const dropped = await newItem(h, 'DROP');
    // newest first, product 1049 is the first row of page 2, swapped behind the last row of page 1 and never shown
    products.splice(0, products.length, ...Array.from({ length: 150 }, (_, i) => ({ id: 1000 + i, sku: i === 49 ? dropped.code : `MR_${h.tag}_${i}` })));
    await refreshCatalogLocked({});
    if ((await linksOf(h, [dropped.id])).get(dropped.id)?.product !== 1049) wrong.push('the product of the tie case was not linked first');
    // PR #420 review finding 5: without a count, only the repeated row can keep the link
    store.omitTotalHeader = true;
    store.newestFirst = true;
    store.unstableOrder = 'swap_ties';
    const shaky = await refreshCatalogLocked({});
    store.newestFirst = false;
    store.unstableOrder = undefined;
    store.omitTotalHeader = false;
    if ((await linksOf(h, [dropped.id])).get(dropped.id)?.product !== 1049) wrong.push('a reading that showed a row twice and left one out closed its link');
    if (!shaky.catalogUnordered || shaky.closedCount !== 0 || shaky.catalogTruncated) wrong.push(`repeated unordered summary ${JSON.stringify(shaky).slice(0, 200)}`);
    if (((await h.get('/api/woocommerce/catalog')).body as { catalogUnordered?: boolean }).catalogUnordered !== true) {
      wrong.push('the tab does not say the reading with a repeated row may have missed a product');
    }

    // M-S: the same ties in an ascending order whose ids look ascending (date or menu order): page 2 starts with 1099 again
    // and 1100, still on the shop, is never shown; its link is kept too
    const later = await newItem(h, 'LATE');
    products[100] = { id: 1100, sku: later.code };
    await refreshCatalogLocked({});
    if ((await linksOf(h, [later.id])).get(later.id)?.product !== 1100) wrong.push('the product of the ascending tie case was not linked first');
    store.omitTotalHeader = true;
    store.unstableOrder = 'swap_ties';
    const ascending = await refreshCatalogLocked({});
    store.unstableOrder = undefined;
    store.omitTotalHeader = false;
    if ((await linksOf(h, [later.id])).get(later.id)?.product !== 1100) wrong.push('an ascending reading that showed a row twice and left one out closed its link');
    if (!ascending.catalogUnordered || ascending.closedCount !== 0) wrong.push(`repeated ascending summary ${JSON.stringify(ascending).slice(0, 200)}`);
    // PR #420 review nit 6: with the count sent, ties are not reported as a count that moved or as a gap
    store.unstableOrder = 'swap_ties';
    const counted = await refreshCatalogLocked({});
    store.unstableOrder = undefined;
    if (!counted.catalogUnordered || counted.catalogShifted || counted.catalogMissing !== 0) wrong.push(`ties with a count ${JSON.stringify(counted).slice(0, 240)}`);
    return 'empty and unordered catalogs';
  });
}

export async function deadlineAndCapCase(h: Harness, wrong: string[]): Promise<string> {
  const { refreshCatalogLocked, applyCatalogLinks } = await import('../../services/woocommerce/wcCatalog.service.js');
  const far = await newItem(h, 'FAR');
  const near = await newItem(h, 'NEAR');
  return withShop(h, [{ id: 1, sku: near.code }], async (store) => {
    // a link of a product past the cap (id 999) and a reading that stopped at the cap
    await h.q(`INSERT INTO wc_product_links (item_id, wc_product_id, wc_variation_id, site_sku) VALUES ($1, 999, 0, $2)`, [far.id, far.code]);
    const capped = await applyCatalogLinks({
      site: [
        { productId: 1, variationId: 0, name: 'n', sku: near.code, stock: null, manageStock: false, type: 'simple', regularPrice: null },
        { productId: 2, variationId: 0, name: 'f', sku: far.code, stock: null, manageStock: false, type: 'simple', regularPrice: null },
      ],
      skipped: [], truncated: true, maxProductId: 2, unordered: false, repeated: false, shifted: false, missing: 0, gapVariationProducts: [], missingVariations: 0, partialVariationProducts: [],
    }, {});
    const links = await linksOf(h, [far.id, near.id]);
    if (links.get(far.id)?.product !== 999) wrong.push(`the link past the cap was changed: ${JSON.stringify(links.get(far.id) ?? null)}`);
    if (links.get(near.id)?.product !== 1) wrong.push('the product read before the cap was not linked');
    if (!capped.catalogTruncated || capped.closedCount !== 0) wrong.push(`capped summary ${JSON.stringify(capped).slice(0, 200)}`);
    if (capped.unmatched.find(u => u.productId === 2)?.reason !== 'item_taken') wrong.push('a product of an item linked past the cap was not listed as taken');

    // a refresh past its deadline aborts, records a failed run and changes no link
    await h.q(`DELETE FROM wc_sync_runs`);
    store.delayMs = 400;
    const before = await h.q(`SELECT id FROM wc_product_links WHERE is_deleted = 0 ORDER BY id`);
    const late = await refreshCatalogLocked({}, undefined, { deadlineMs: 150 }).then(() => null, (err: unknown) => err as { code?: string });
    if (late?.code !== 'WC_SHOP_REQUEST_FAILED') wrong.push(`a refresh past its deadline ended with ${JSON.stringify(late)}`);
    const after = await h.q(`SELECT id FROM wc_product_links WHERE is_deleted = 0 ORDER BY id`);
    if (JSON.stringify(before) !== JSON.stringify(after)) wrong.push('a refresh past its deadline changed the links');
    const runs = await h.q(`SELECT status FROM wc_sync_runs WHERE kind = 'refresh'`);
    if (runs.length !== 1 || runs[0].status !== 'failed') wrong.push(`runs after the deadline: ${JSON.stringify(runs)}`);

    // the address guard refusing the shop is a failed run too
    store.delayMs = 0;
    await h.q(`DELETE FROM wc_sync_runs`);
    await h.q(`UPDATE app_settings SET value = 'http://shop-d04.invalid' WHERE key = 'wc_store_url'`);
    const refused = await h.post('/api/woocommerce/refresh-products', {});
    if (refused.status !== 422) wrong.push(`a shop the address guard refuses answered ${brief(refused)}, expected 422`);
    const guardRuns = await h.q(`SELECT status FROM wc_sync_runs WHERE kind = 'refresh'`);
    if (guardRuns.length !== 1 || guardRuns[0].status !== 'failed') wrong.push(`runs after the guard refused: ${JSON.stringify(guardRuns)}`);
    return 'cap, deadline and guard';
  });
}

/** the words of the refresh deadline message (a refresh that ran out of time, not one that failed on the shop's answer) */
const DEADLINE_WORDS = 'ثانیه تمام نشد';

export async function removedProductAndDeadlinesCase(h: Harness, wrong: string[]): Promise<string> {
  const { refreshCatalogLocked, applyCatalogLinks, WC_VARIATION_READ_CONCURRENCY } = await import('../../services/woocommerce/wcCatalog.service.js');
  const { pushStocksLocked } = await import('../../services/woocommerce/wcStockPush.service.js');
  const kept = await newItem(h, 'KEEP', { MAIN: 3 });
  const gone = await newItem(h, 'GONE', { MAIN: 2 });
  const products: MockProduct[] = [{ id: 10, sku: kept.code }, { id: 20, sku: gone.code }];
  return withShop(h, products, async (store) => {
    await refreshCatalogLocked({});
    // H-A: the product is deleted on the shop; the next full reading closes its link and keeps the other one
    products.splice(1, 1);
    const removed = await refreshCatalogLocked({});
    let links = await linksOf(h, [kept.id, gone.id]);
    if (links.has(gone.id)) wrong.push(`the link of a product removed from the shop stayed: ${JSON.stringify(links.get(gone.id))}`);
    if (links.get(kept.id)?.product !== 10) wrong.push('the link of a product still on the shop was closed');
    if (removed.closedCount !== 1 || removed.linkedCount !== 1) wrong.push(`summary after a removal ${JSON.stringify(removed).slice(0, 200)}`);
    // the product made again on the shop links again
    products.push({ id: 21, sku: gone.code });
    await refreshCatalogLocked({});
    links = await linksOf(h, [gone.id]);
    if (links.get(gone.id)?.product !== 21) wrong.push('a product made again on the shop was not linked');

    // H-A: a truncated reading keeps only links above the largest id it read; a missing product below it is closed
    await h.q(`UPDATE wc_product_links SET is_deleted = 1 WHERE item_id = $1 AND wc_product_id = 21`, [gone.id]);
    await h.q(`INSERT INTO wc_product_links (item_id, wc_product_id, wc_variation_id, site_sku) VALUES ($1, 5, 0, 'X5')`, [gone.id]);
    const capped = await applyCatalogLinks({
      site: [{ productId: 10, variationId: 0, name: 'k', sku: kept.code, stock: null, manageStock: false, type: 'simple', regularPrice: null }],
      skipped: [], truncated: true, maxProductId: 10, unordered: false, repeated: false, shifted: false, missing: 0, gapVariationProducts: [], missingVariations: 0, partialVariationProducts: [],
    }, {});
    if ((await linksOf(h, [gone.id])).has(gone.id)) wrong.push('a truncated reading kept the link of a missing product below the largest id read');
    if (capped.closedCount !== 1) wrong.push(`truncated summary ${JSON.stringify(capped).slice(0, 200)}`);

    // M-A / N-G: one variation list fails while the others are held unanswered; the refresh fails at once (the held reads are
    // aborted, never awaited), and no reader starts another list, even after the held ones are let go. M-D: the list that
    // fails is not the first one, and the refresh reports the shop's own error, not the abort of the first list's reader
    const variableIds = Array.from({ length: 12 }, (_, i) => 100 + i);
    products.splice(0, products.length, ...variableIds.map(id => ({ id, sku: `VAR${id}_${h.tag}`, variations: [{ id: id * 10, sku: `V${id}_${h.tag}` }] })));
    store.failPaths.add('products/102/variations');
    let release = (): void => undefined;
    store.hold = { pattern: /^products\/(?!102\/)\d+\/variations$/, until: new Promise<void>(resolve => { release = resolve; }) };
    const before = store.arrivals.length;
    const startedAt = Date.now();
    const failed = await refreshCatalogLocked({}, undefined, { deadlineMs: 20_000 })
      .then(() => null, (err: unknown) => err as { code?: string; message?: string; details?: { status?: number } });
    // the held reads answer only after the refresh returns, so a refresh that awaited them ran into a request timeout
    // (`WC_REQUEST_TIMEOUT_MS`, 15 s) or its deadline; aborted at the first failure it returns in a few milliseconds
    const tookMs = Date.now() - startedAt;
    release();
    store.hold = undefined;
    await new Promise(resolve => setTimeout(resolve, 200));
    const variationReads = store.arrivals.slice(before).filter(r => /variations/.test(r)).length;
    if (failed?.code !== 'WC_SHOP_REQUEST_FAILED') wrong.push(`a refresh with a failed variation read ended with ${JSON.stringify(failed)}`);
    if (String(failed?.message ?? '').includes(DEADLINE_WORDS) || tookMs >= 10_000) wrong.push(`the refresh waited ${tookMs} ms for the held variation reads`);
    if (variationReads > WC_VARIATION_READ_CONCURRENCY) wrong.push(`${variationReads} variation lists were read after one failed`);
    if (failed?.details?.status !== 500) wrong.push(`the refresh reported ${JSON.stringify(failed)} instead of the shop's error on a later list`);
    store.failPaths.clear();

    // N-A: a push past its deadline aborts the open batch and sends nothing more
    await h.q(`DELETE FROM wc_product_links`);
    await h.q(`DELETE FROM wc_sync_runs`);
    await h.q(`INSERT INTO wc_product_links (item_id, wc_product_id, wc_variation_id, site_sku) VALUES ($1, 10, 0, $2), ($3, 30, 31, $4)`,
      [kept.id, kept.code, gone.id, gone.code]);
    // part B: the open orders are read first and answer at once; only the batch requests are held past the deadline
    store.hold = { pattern: /\/batch$/, until: new Promise<void>(resolve => { setTimeout(resolve, 300); }) };
    const postsBefore = store.requests.filter(r => r.startsWith('POST')).length;
    const late = await pushStocksLocked({}, { trigger: 'all', deadlineMs: 100 });
    await new Promise(resolve => setTimeout(resolve, 500));
    const posts = store.requests.filter(r => r.startsWith('POST')).length - postsBefore;
    if (late.failedCount !== 2 || late.syncedCount !== 0) wrong.push(`a push past its deadline answered ${JSON.stringify(late).slice(0, 200)}`);
    if (posts > 1) wrong.push(`${posts} batches were sent after the push deadline`);
    const runs = await h.q(`SELECT status FROM wc_sync_runs WHERE kind = 'stock_push'`);
    if (runs.length !== 1 || runs[0].status !== 'failed') wrong.push(`runs after the push deadline: ${JSON.stringify(runs)}`);
    store.hold = undefined;
    return 'removal, failed reader and push deadline';
  });
}
