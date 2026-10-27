import type { Harness } from '../security/workflowTestHarness.js';
import type { MockProduct } from '../fixtures/mockWooCatalogStore.js';
import { brief, linksOf, newItem, withShop } from './wooCatalogTestKit.js';

/**
 * v11 phase 6.5 (the four low-risk notes of the #322 review): a product removed from the shop while its catalog is read
 * page by page moves the next pages up, so the shop's count (`X-WP-Total`) is compared and a reading whose count moved keeps
 * every link it did not read (notes 1 and 4); a reading that would close most links at once asks first (note 2); a
 * variation list read in part keeps the links of its own unread variations, never the whole catalog's (note 3). Red on
 * 8c6ebfe: the link of the skipped product was closed, six links closed without a question, and a cut variation list
 * closed its unread variations.
 */

/** 250 shop products with SKUs no item holds, ids 1000 … 1249 */
const filler = (tag: string): MockProduct[] => Array.from({ length: 250 }, (_, i) => ({ id: 1000 + i, sku: `RE_${tag}_${i}` }));

export async function shiftedCatalogCase(h: Harness, wrong: string[]): Promise<string> {
  const { refreshCatalogLocked } = await import('../../services/woocommerce/wcCatalog.service.js');
  const skipped = await newItem(h, 'SKIP');
  const removed = await newItem(h, 'REMOVED');
  const products = filler(h.tag);
  products[100] = { id: 1100, sku: skipped.code };
  products[50] = { id: 1050, sku: removed.code };
  return withShop(h, products, async (store) => {
    await refreshCatalogLocked({});
    const first = await linksOf(h, [skipped.id, removed.id]);
    if (first.get(skipped.id)?.product !== 1100 || first.get(removed.id)?.product !== 1050) wrong.push('the products were not linked first');

    // product 1050 (page 1, already read) is removed before page 2 is answered: page 2 starts at 1101 and 1100 is never shown
    store.beforeCatalogPage = (path, page) => {
      if (path === 'products' && page === 2 && products[50]?.id === 1050) products.splice(50, 1);
    };
    const shifted = await refreshCatalogLocked({});
    store.beforeCatalogPage = undefined;
    const kept = await linksOf(h, [skipped.id, removed.id]);
    if (kept.get(skipped.id)?.product !== 1100) wrong.push('a product skipped because the pages moved lost its link');
    if (kept.get(removed.id)?.product !== 1050) wrong.push('the product read on page 1 lost its link in the same reading');
    if (!shifted.catalogShifted || shifted.closedCount !== 0) wrong.push(`shifted summary ${JSON.stringify(shifted).slice(0, 240)}`);
    const tab = (await h.get('/api/woocommerce/catalog')).body as { catalogShifted?: boolean };
    if (tab.catalogShifted !== true) wrong.push('the tab does not say the last reading moved');

    // the next reading is steady: the removed product's link closes, the skipped one stays, the tab is quiet
    const steady = await refreshCatalogLocked({});
    const after = await linksOf(h, [skipped.id, removed.id]);
    if (after.has(removed.id) || after.get(skipped.id)?.product !== 1100) wrong.push(`a steady reading kept ${JSON.stringify([...after])}`);
    if (steady.catalogShifted || steady.closedCount !== 1) wrong.push(`steady summary ${JSON.stringify(steady).slice(0, 240)}`);

    // note 4: a product added while the pages are read changes the count too, and a shop that sends no count is never marked
    store.beforeCatalogPage = (path, page) => {
      if (path === 'products' && page === 3 && !products.some(p => p.id === 5000)) products.push({ id: 5000, sku: `RE_${h.tag}_new` });
    };
    const grown = await refreshCatalogLocked({});
    store.beforeCatalogPage = undefined;
    if (!grown.catalogShifted) wrong.push('a count that grew during the reading was not noticed');
    store.omitTotalHeader = true;
    const silent = await refreshCatalogLocked({});
    store.omitTotalHeader = false;
    if (silent.catalogShifted) wrong.push('a shop without a count was marked as moved');
    return 'a count that moved keeps the unread links';
  });
}

export async function massCloseCase(h: Harness, wrong: string[]): Promise<string> {
  const { refreshCatalogLocked, WC_MASS_CLOSE_CONFIRM } = await import('../../services/woocommerce/wcCatalog.service.js');
  const linked = await Promise.all(Array.from({ length: 7 }, (_, i) => newItem(h, `MASS${i}`)));
  const products: MockProduct[] = linked.map((item, i) => ({ id: 10 + i, sku: item.code }));
  return withShop(h, products, async (store) => {
    await refreshCatalogLocked({});
    const before = await h.q(`SELECT id FROM wc_product_links WHERE is_deleted = 0 ORDER BY id`);
    if (before.length !== 7) wrong.push(`first refresh linked ${before.length} products, expected 7`);

    // a plugin hides all but two products: closing five of seven links waits for the user
    await h.q(`DELETE FROM wc_sync_runs`);
    store.beforeCatalogPage = undefined;
    const hidden = products.splice(2);
    const asked = await h.post('/api/woocommerce/refresh-products', {});
    const body = asked.body as { code?: string; details?: { closedCount?: number; liveCount?: number } };
    if (asked.status !== 409 || body.code !== WC_MASS_CLOSE_CONFIRM || body.details?.closedCount !== 5 || body.details?.liveCount !== 7) {
      wrong.push(`a reading closing five of seven links answered ${brief(asked)}`);
    }
    const unchanged = await h.q(`SELECT id FROM wc_product_links WHERE is_deleted = 0 ORDER BY id`);
    if (JSON.stringify(unchanged) !== JSON.stringify(before)) wrong.push('a reading waiting for the question changed the links');
    const runs = await h.q(`SELECT status FROM wc_sync_runs WHERE kind = 'refresh'`);
    if (runs.length !== 1 || runs[0].status !== 'failed') wrong.push(`runs after the question: ${JSON.stringify(runs)}`);
    // the nightly re-read and the stock push never confirm
    const quiet = await refreshCatalogLocked({}).then(() => null, (err: unknown) => (err as { code?: string }).code);
    if (quiet !== WC_MASS_CLOSE_CONFIRM) wrong.push(`a refresh without the user's word ended with ${quiet}`);

    // a strict body, then the confirmation closes them
    const odd = await h.post('/api/woocommerce/refresh-products', { confirmClose: 5, all: true });
    if (odd.status !== 400) wrong.push(`an unknown body field answered ${brief(odd)}`);
    for (const bad of [true, '5', -1, 1.5]) {
      const res = await h.post('/api/woocommerce/refresh-products', { confirmClose: bad });
      if (res.status !== 400) wrong.push(`confirmClose ${JSON.stringify(bad)} answered ${brief(res)}`);
    }
    // PR #420 review nit 8: a confirmation of fewer closings than the reading makes asks again
    const fewer = await h.post('/api/woocommerce/refresh-products', { confirmClose: 4 });
    if (fewer.status !== 409 || (fewer.body as { code?: string }).code !== WC_MASS_CLOSE_CONFIRM) wrong.push(`confirming four of five closings answered ${brief(fewer)}`);
    const confirmed = await h.post('/api/woocommerce/refresh-products', { confirmClose: 5 });
    if (confirmed.status !== 200 || (confirmed.body as { closedCount?: number }).closedCount !== 5) wrong.push(`the confirmed refresh answered ${brief(confirmed)}`);
    const audit = await h.q(`SELECT details FROM activity_logs WHERE action = 'WC_CATALOG_REFRESH' ORDER BY id DESC LIMIT 1`);
    if (JSON.stringify(audit[0]?.details ?? {}).indexOf('confirmClose') < 0) wrong.push('the audit row does not say the closing was confirmed');

    // four closings are below the bar and need no question
    products.push(...hidden);
    await refreshCatalogLocked({});
    products.splice(3);
    const few = await refreshCatalogLocked({});
    if (few.closedCount !== 4) wrong.push(`four closings answered ${JSON.stringify(few).slice(0, 200)}`);

    // PR #420 review finding 3: another shop with the same product ids and other SKUs reads every product and still asks
    await h.q(`DELETE FROM wc_product_links`);
    products.splice(0, products.length, ...linked.map((item, i) => ({ id: 10 + i, sku: item.code })));
    await refreshCatalogLocked({});
    products.forEach((p, i) => { p.sku = `OTHER_${h.tag}_${i}`; });
    const other = await h.post('/api/woocommerce/refresh-products', {});
    if (other.status !== 409 || (other.body as { details?: { closedCount?: number } }).details?.closedCount !== 7) {
      wrong.push(`a shop whose products all hold other SKUs answered ${brief(other)}`);
    }
    if ((await h.q(`SELECT id FROM wc_product_links WHERE is_deleted = 0`)).length !== 7) wrong.push('the other shop closed links without a question');
    return 'most links closed at once only after a question';
  });
}

export async function partialVariationsCase(h: Harness, wrong: string[]): Promise<string> {
  const { refreshCatalogLocked } = await import('../../services/woocommerce/wcCatalog.service.js');
  const skippedVariation = await newItem(h, 'PVSKIP');
  const goneSimple = await newItem(h, 'PVGONE');
  const variations = Array.from({ length: 150 }, (_, i) => ({ id: 60_000 + i, sku: i === 100 ? skippedVariation.code : `PV_${h.tag}_${i}` }));
  const products: MockProduct[] = [{ id: 500, sku: `PVPARENT_${h.tag}`, variations }, { id: 600, sku: goneSimple.code }];
  return withShop(h, products, async (store) => {
    await refreshCatalogLocked({});
    const first = await linksOf(h, [skippedVariation.id, goneSimple.id]);
    if (first.get(skippedVariation.id)?.variation !== 60_100 || first.get(goneSimple.id)?.product !== 600) wrong.push('the variation and the product were not linked first');

    // variation 60010 is removed before the second variation page: 60100 is never shown. Product 600 is removed from the
    // shop at the same time; the product list itself is whole, so only the cut list's variations keep their links
    store.beforeCatalogPage = (path, page) => {
      if (path === 'products/500/variations' && page === 2 && variations[10]?.id === 60_010) variations.splice(10, 1);
    };
    products.splice(1, 1);
    const cut = await refreshCatalogLocked({});
    store.beforeCatalogPage = undefined;
    const links = await linksOf(h, [skippedVariation.id, goneSimple.id]);
    if (links.get(skippedVariation.id)?.variation !== 60_100) wrong.push('a variation skipped because its list moved lost its link');
    if (links.has(goneSimple.id)) wrong.push('a variation list read in part kept the link of a product removed from the shop');
    if (cut.partialVariationProducts !== 1 || cut.catalogShifted || cut.catalogUnordered || cut.closedCount !== 1) {
      wrong.push(`partial summary ${JSON.stringify(cut).slice(0, 240)}`);
    }
    const tab = (await h.get('/api/woocommerce/catalog')).body as { partialVariationProducts?: number };
    if (tab.partialVariationProducts !== 1) wrong.push(`the tab says ${tab.partialVariationProducts} cut variation lists`);

    // a variation list that shows a row twice is read in part too (it was the whole catalog's flag before)
    store.unstableOrder = 'swap_ties';
    products.push({ id: 700, sku: `PVOTHER_${h.tag}` });
    const ties = await refreshCatalogLocked({});
    store.unstableOrder = undefined;
    if (ties.partialVariationProducts !== 1 || ties.catalogUnordered) wrong.push(`variation ties summary ${JSON.stringify(ties).slice(0, 240)}`);
    return 'a variation list read in part keeps only its own unread links';
  });
}

/**
 * PR #420 review findings 1 and 2: a shop that counts a product it never lists (a row the key may not read) sends a short
 * page in the middle; the reading goes on to the count, the nightly re-read keeps the unread links and says so, and a
 * refresh by hand asks before closing them, so a product really removed can still be closed
 */
export async function catalogGapCase(h: Harness, wrong: string[]): Promise<string> {
  const { refreshCatalogLocked } = await import('../../services/woocommerce/wcCatalog.service.js');
  const hiddenItem = await newItem(h, 'GAPHIDDEN');
  const lateItem = await newItem(h, 'GAPLATE');
  const pageItem = await newItem(h, 'GAPPAGE');
  const variationItem = await newItem(h, 'GAPVAR');
  const removedItem = await newItem(h, 'GAPGONE');
  const products = filler(h.tag);
  products[20] = { id: 1020, sku: hiddenItem.code };
  products[150] = { id: 1150, sku: pageItem.code };
  products[230] = { id: 1230, sku: lateItem.code };
  return withShop(h, products, async (store) => {
    await refreshCatalogLocked({});
    const first = await linksOf(h, [hiddenItem.id, lateItem.id, pageItem.id]);
    if (first.get(hiddenItem.id)?.product !== 1020 || first.get(lateItem.id)?.product !== 1230 || first.get(pageItem.id)?.product !== 1150) {
      wrong.push('the products were not linked first');
    }

    // product 1020 is counted but never listed: page 1 comes with 99 rows, and page 3 is still read
    store.hiddenFromLists = new Set([1020]);
    const kept = await refreshCatalogLocked({});
    const links = await linksOf(h, [hiddenItem.id, lateItem.id]);
    if (links.get(lateItem.id)?.product !== 1230) wrong.push('a short page in the middle ended the reading before page 3');
    if (kept.siteProductCount !== 249) wrong.push(`the reading read ${kept.siteProductCount} products, expected 249`);
    if (links.get(hiddenItem.id)?.product !== 1020 || kept.closedCount !== 0) wrong.push('a reading with a gap closed the link of a product it did not read');
    if (kept.catalogMissing !== 1 || kept.catalogShifted) wrong.push(`gap summary ${JSON.stringify(kept).slice(0, 240)}`);
    if (((await h.get('/api/woocommerce/catalog')).body as { catalogMissing?: number }).catalogMissing !== 1) wrong.push('the tab does not say the shop listed fewer products than it counted');

    // by hand: the question, then the confirmed closing
    const asked = await h.post('/api/woocommerce/refresh-products', {});
    const details = (asked.body as { details?: { closedCount?: number; missingCount?: number } }).details;
    if (asked.status !== 409 || details?.closedCount !== 1 || details?.missingCount !== 1) wrong.push(`a refresh by hand with a gap answered ${brief(asked)}`);
    if (!(await linksOf(h, [hiddenItem.id])).has(hiddenItem.id)) wrong.push('the question closed the link');
    const confirmed = await h.post('/api/woocommerce/refresh-products', { confirmClose: 1 });
    if (confirmed.status !== 200 || (confirmed.body as { closedCount?: number }).closedCount !== 1) wrong.push(`the confirmed refresh answered ${brief(confirmed)}`);
    if ((await linksOf(h, [hiddenItem.id])).has(hiddenItem.id)) wrong.push('the confirmed refresh kept the link');

    // a gap with nothing to close asks nothing, and the nightly reading no longer reports it (delta review S2)
    const quiet = await h.post('/api/woocommerce/refresh-products', {});
    if (quiet.status !== 200) wrong.push(`a gap with no link to close answered ${brief(quiet)}`);
    const night = await refreshCatalogLocked({});
    if (night.catalogMissing !== 0) wrong.push(`a gap that kept no link is still reported: ${night.catalogMissing}`);

    // delta review S1: a whole hidden page in the middle comes empty; the reading goes on to page 3 and only the hidden
    // product's link is asked about and closed
    store.hiddenFromLists = new Set(Array.from({ length: 100 }, (_, i) => 1100 + i));
    const page = await h.post('/api/woocommerce/refresh-products', {});
    if (page.status !== 409 || (page.body as { details?: { closedCount?: number } }).details?.closedCount !== 1) wrong.push(`a hidden page answered ${brief(page)}`);
    const pageConfirmed = await h.post('/api/woocommerce/refresh-products', { confirmClose: 1 });
    const afterPage = await linksOf(h, [pageItem.id, lateItem.id]);
    if (pageConfirmed.status !== 200 || afterPage.has(pageItem.id) || afterPage.get(lateItem.id)?.product !== 1230) {
      wrong.push(`after a hidden page: ${brief(pageConfirmed)}, links ${JSON.stringify([...afterPage])}`);
    }

    // a shop that caps per_page sends more pages (X-WP-TotalPages): every product is read and no gap is seen
    store.hiddenFromLists = undefined;
    store.perPageCap = 30;
    const capped = await refreshCatalogLocked({});
    store.perPageCap = undefined;
    if (capped.siteProductCount !== 250 || capped.catalogMissing !== 0 || capped.closedCount !== 0) wrong.push(`a capped page size ${JSON.stringify(capped).slice(0, 240)}`);

    // delta review N1: a gap in one variation list keeps only that product's unread variations at night; a product
    // removed from the shop still closes
    products.push({ id: 2000, sku: `GAPPARENT_${h.tag}`, variations: [{ id: 2001, sku: variationItem.code }, { id: 2002, sku: `GAPV_${h.tag}` }] });
    products.push({ id: 2100, sku: removedItem.code });
    await refreshCatalogLocked({});
    store.hiddenFromLists = new Set([2001]);
    products.splice(products.findIndex(p => p.id === 2100), 1);
    const varGap = await refreshCatalogLocked({});
    const afterVar = await linksOf(h, [variationItem.id, removedItem.id]);
    if (afterVar.get(variationItem.id)?.variation !== 2001 || afterVar.has(removedItem.id) || varGap.catalogMissing !== 1) {
      wrong.push(`a variation gap: links ${JSON.stringify([...afterVar])}, summary ${JSON.stringify(varGap).slice(0, 240)}`);
    }
    const varAsked = await h.post('/api/woocommerce/refresh-products', {});
    if (varAsked.status !== 409) wrong.push(`a refresh by hand with a variation gap answered ${brief(varAsked)}`);
    store.hiddenFromLists = undefined;
    return 'a lasting gap keeps the links until the user confirms';
  });
}
