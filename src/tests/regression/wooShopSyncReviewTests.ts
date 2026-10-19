import type { Harness } from '../security/workflowTestHarness.js';
import type { MockProduct } from '../fixtures/mockWooCatalogStore.js';
import { brief, newItem, withShop } from './wooCatalogTestKit.js';
import { later, linkFields, PRICE_LIST, setPrice, withSendSettings, zoneAtHour, type ShopSyncBody } from './wooShopSyncTests.js';

/**
 * 10.2 package 6 (D-04 part C), the review of #332. Every case runs against the stand-in shop on 127.0.0.1, never a real
 * one. Red on b03542f8: a thousand-toman shop got 15,000 rials as 2 and 4,000 rials as nothing, a shop switched from
 * thousand toman to toman within the six-hour currency cache got the old unit, the price run row named no changed price,
 * `woocommerce.manage` alone chose the price list and turned the SKU rename on, a `variable-subscription` product was sent
 * a price and its variations were never linked, and nightly run rows were never purged.
 */
interface PriceRunSummary {
  siteCurrency?: string;
  changed?: Array<{ productId: number; variationId: number; from: string | null; to: string | null }>;
  changedTotal?: number;
}

/** H-1, M-1, M-2, M-3 (price list) and N-4 */
export async function priceReviewCase(h: Harness, wrong: string[]): Promise<string> {
  const a = await newItem(h, 'HA');
  const b = await newItem(h, 'HB');
  const c = await newItem(h, 'HC');
  const inexact = await newItem(h, 'HI');
  const subParent = await newItem(h, 'HP');
  const subVariation = await newItem(h, 'HV');
  const products: MockProduct[] = [
    { id: 1, sku: a.code }, { id: 2, sku: b.code }, { id: 3, sku: c.code }, { id: 4, sku: inexact.code },
    { id: 5, sku: subParent.code, type: 'variable-subscription', variations: [{ id: 51, sku: subVariation.code }] },
  ];
  return withSendSettings(h, () => withShop(h, products, async (store) => {
    store.currency = 'IRHT';
    const refresh = await h.post('/api/woocommerce/refresh-products', {});
    if (refresh.status !== 200) return `refresh ${brief(refresh)}`;
    await setPrice(h, a.id, 15_000);
    await setPrice(h, b.id, 125_000);
    await setPrice(h, c.id, 4_000);
    await setPrice(h, inexact.id, 12_345.67);
    await setPrice(h, subParent.id, 3_000_000);
    await setPrice(h, subVariation.id, 2_000_000);

    // M-3: the shop key alone does not choose the price list
    const shopOnly = await h.sessionWith(['woocommerce.manage']);
    const denied = await h.post('/api/woocommerce/price-list', { priceList: PRICE_LIST }, shopOnly);
    if (denied.status !== 403) wrong.push(`woocommerce.manage alone chose the price list: ${brief(denied)}`);
    const pricer = await h.sessionWith(['woocommerce.manage', 'products.edit_price']);
    const chosen = await h.post('/api/woocommerce/price-list', { priceList: PRICE_LIST }, pricer);
    if (chosen.status !== 200) return `price list ${brief(chosen)}`;

    const { runPricePushOnce } = await import('../../services/woocommerce/wcFieldPush.service.js');
    const first = await runPricePushOnce();
    const sent = Object.fromEntries(store.pricesSent);
    // H-1: exact thousand-toman prices, never a whole thousand
    if (sent[1] !== '1.5' || sent[2] !== '12.5' || sent[3] !== '0.4') wrong.push(`thousand-toman prices sent ${JSON.stringify(sent)}, expected 1.5, 12.5 and 0.4`);
    if (store.pricesSent.has(4)) wrong.push(`a price that cannot be written exactly was sent as ${sent[4]}`);
    // N-4: a variable-subscription parent gets no price, its variation is linked and does
    if (store.pricesSent.has(5)) wrong.push('a variable-subscription parent was sent a price');
    if (sent[51] !== '200') wrong.push(`the subscription variation got ${sent[51]}, expected 200`);
    if (first.result?.syncedCount !== 4) wrong.push(`first run ${JSON.stringify(first)}, expected four prices sent`);

    // M-2: the run row names the prices it changed, ids and numbers only
    const [run] = await h.q(`SELECT summary FROM wc_sync_runs WHERE kind = 'price_push' ORDER BY id DESC LIMIT 1`);
    const summary = run?.summary as PriceRunSummary | undefined;
    const one = summary?.changed?.find(x => x.productId === 1);
    if (!one || one.variationId !== 0 || one.from !== null || one.to !== '1.5' || summary?.changedTotal !== 4) wrong.push(`run row changes ${JSON.stringify(summary)}`);
    const variationChange = summary?.changed?.find(x => x.variationId === 51);
    if (!variationChange || variationChange.productId !== 5) wrong.push(`the variation's change ${JSON.stringify(variationChange)}`);
    if (JSON.stringify(summary?.changed ?? []).includes(a.code)) wrong.push('the run row carries an item code');

    // the products left out are listed after a restart too, from the currency the last run recorded
    const { forgetSiteCurrency } = await import('../../services/woocommerce/wcSiteCurrency.js');
    forgetSiteCurrency();
    const view = ((await h.get('/api/woocommerce/catalog')).body as ShopSyncBody).shopSync;
    const reasons = new Map((view?.price?.skipped ?? []).map(s => [s.itemId, s.reason]));
    if (view?.siteCurrency !== 'IRHT' || reasons.get(inexact.id) !== 'inexact_unit' || reasons.get(subParent.id) !== 'variable_parent') {
      wrong.push(`after a restart the tab shows ${view?.siteCurrency} and ${JSON.stringify(view?.price?.skipped)}`);
    }

    // M-1: a run with nothing to send asks the shop nothing; one with a price reads the currency again before sending
    const currencyReads = () => store.requests.filter(r => r === 'GET data/currencies/current').length;
    await runPricePushOnce();
    const readsBefore = currencyReads();
    const idle = await runPricePushOnce();
    if (idle.state !== 'nothing' || currencyReads() !== readsBefore) wrong.push(`an idle run was ${idle.state} and read the currency ${currencyReads() - readsBefore} time(s)`);
    store.currency = 'IRT';
    await setPrice(h, a.id, 16_000);
    const switched = await runPricePushOnce(later(1));
    if (store.pricesSent.get(1) !== '1600') wrong.push(`after the shop switched to toman the price went as ${store.pricesSent.get(1)}, expected 1600 (switched ${switched.state})`);
    return `sent ${JSON.stringify(sent)}`;
  }));
}

/** M-3 (SKU rename), N-5 and N-6 */
export async function skuAndPurgeReviewCase(h: Harness, wrong: string[]): Promise<string> {
  const w = await newItem(h, 'HW');
  const other = `CASE_${h.tag}_${Math.floor(Math.random() * 1e6)}`;
  const products: MockProduct[] = [{ id: 1, sku: w.code }, { id: 2, sku: other }];
  return withSendSettings(h, () => withShop(h, products, async (store) => {
    const refresh = await h.post('/api/woocommerce/refresh-products', {});
    if (refresh.status !== 200) return `refresh ${brief(refresh)}`;
    const shopOnly = await h.sessionWith(['woocommerce.manage']);
    const denied = await h.post('/api/woocommerce/sku-rename', { enabled: true }, shopOnly);
    if (denied.status !== 403) wrong.push(`woocommerce.manage alone turned the SKU rename on: ${brief(denied)}`);
    const renamer = await h.sessionWith(['woocommerce.manage', 'products.change_code']);
    const on = await h.post('/api/woocommerce/sku-rename', { enabled: true }, renamer);
    if (on.status !== 200) return `sku rename ${brief(on)}`;

    // N-5: the shop refuses a SKU another product holds in another letter case
    await h.q(`UPDATE items SET code = $2 WHERE id = $1`, [w.id, other.toLowerCase()]);
    const { runSkuRenameOnce } = await import('../../services/woocommerce/wcFieldPush.service.js');
    const run = await runSkuRenameOnce();
    if (run.result?.failedCount !== 1 || store.skusSent.has(1)) wrong.push(`a SKU differing only in case was accepted: ${JSON.stringify(run)}`);
    if (!String((await linkFields(h, w.id))?.sku_error)) wrong.push('the refused SKU left no error on the link');

    // N-6: nightly re-read rows older than 30 days go with the automatic runs; a refresh pressed by hand stays
    const rows = await h.q(
      `INSERT INTO wc_sync_runs (kind, status, finished_at, summary) VALUES
       ('refresh', 'ok', now() - interval '40 days', '{"trigger":"nightly","businessDay":"2026-09-01"}'),
       ('refresh', 'ok', now() - interval '40 days', '{}'),
       ('refresh', 'ok', now() - interval '2 days', '{"trigger":"nightly","businessDay":"2026-10-10"}')
       RETURNING id`,
    );
    const { purgeOldAutoRuns } = await import('../../services/woocommerce/wcSyncRunPurge.js');
    await purgeOldAutoRuns();
    const kept = (await h.q(`SELECT id FROM wc_sync_runs WHERE id = ANY($1)`, [rows.map(r => r.id)])).map(r => Number(r.id));
    if (kept.includes(Number(rows[0].id)) || !kept.includes(Number(rows[1].id)) || !kept.includes(Number(rows[2].id))) {
      wrong.push(`the purge kept ${JSON.stringify(kept)} of ${JSON.stringify(rows.map(r => Number(r.id)))}`);
    }
    await h.q(`DELETE FROM wc_sync_runs WHERE id = ANY($1)`, [rows.map(r => r.id)]);
    return 'case-insensitive SKU refused; old nightly rows purged';
  }));
}

interface MoneyView { siteCurrency?: string | null; siteDecimals?: number | null; differencesCurrency?: string | null; price?: { skipped?: Array<{ itemId: number; reason: string }> } }

/**
 * Second review of #332, M-A / N-3 / N-4 / N-7. Red on afc5444f: the shop's price decimals were never read, so a
 * thousand-toman shop without decimals got 25,000 rials as 2.5 and charged 3 thousand tomans; turning the price push or
 * the SKU rename off needed the price or code-change key; the nightly row named no shop currency.
 */
export async function decimalsReviewCase(h: Harness, wrong: string[]): Promise<string> {
  const a = await newItem(h, 'DA');
  const b = await newItem(h, 'DB');
  const products: MockProduct[] = [{ id: 1, sku: a.code }, { id: 2, sku: b.code }];
  return withSendSettings(h, () => withShop(h, products, async (store) => {
    store.currency = 'IRHT';
    store.decimals = 2;
    const refresh = await h.post('/api/woocommerce/refresh-products', {});
    if (refresh.status !== 200) return `refresh ${brief(refresh)}`;
    await setPrice(h, a.id, 15_000);
    await setPrice(h, b.id, 20_000);
    const chosen = await h.post('/api/woocommerce/price-list', { priceList: PRICE_LIST });
    if (chosen.status !== 200) return `price list ${brief(chosen)}`;
    const { runPricePushOnce } = await import('../../services/woocommerce/wcFieldPush.service.js');
    await runPricePushOnce();
    if (store.pricesSent.get(1) !== '1.5' || store.pricesSent.get(2) !== '2') wrong.push(`with two decimals ${JSON.stringify(Object.fromEntries(store.pricesSent))}`);

    // M-A: the shop dropped its decimals within the cache window; read again before sending, 2.5 is not sent, 3 is
    store.decimals = 0;
    await setPrice(h, a.id, 25_000);
    await setPrice(h, b.id, 30_000);
    const run = await runPricePushOnce();
    if (store.pricesSent.get(1) !== '1.5') wrong.push(`a shop without decimals got ${store.pricesSent.get(1)} for 25,000 rials (run ${run.state})`);
    if (store.pricesSent.get(2) !== '3') wrong.push(`30,000 rials went as ${store.pricesSent.get(2)}, expected 3`);
    const [row] = await h.q(`SELECT summary FROM wc_sync_runs WHERE kind = 'price_push' ORDER BY id DESC LIMIT 1`);
    if ((row?.summary as { siteDecimals?: number } | undefined)?.siteDecimals !== 0) wrong.push(`the run row ${JSON.stringify(row?.summary)}`);
    const view = ((await h.get('/api/woocommerce/catalog')).body as { shopSync?: MoneyView }).shopSync;
    const reasons = new Map((view?.price?.skipped ?? []).map(x => [x.itemId, x.reason]));
    if (view?.siteDecimals !== 0 || reasons.get(a.id) !== 'inexact_unit') wrong.push(`the tab shows decimals ${view?.siteDecimals} and ${JSON.stringify(view?.price?.skipped)}`);

    // a shop whose decimals cannot be read gets no price
    const { forgetSiteCurrency } = await import('../../services/woocommerce/wcSiteCurrency.js');
    forgetSiteCurrency();
    store.decimals = 'abc';
    await setPrice(h, b.id, 40_000);
    const unreadable = await runPricePushOnce(later(1));
    const [failed] = await h.q(`SELECT status, error_message FROM wc_sync_runs WHERE kind = 'price_push' ORDER BY id DESC LIMIT 1`);
    if (unreadable.state !== 'failed' || store.pricesSent.get(2) !== '3' || !String(failed?.error_message).includes('اعشار')) {
      wrong.push(`unreadable decimals: run ${unreadable.state}, sent ${store.pricesSent.get(2)}, row ${JSON.stringify(failed)}`);
    }
    store.decimals = 2;

    // N-3: the shop key alone turns both sends off, never on
    const shopOnly = await h.sessionWith(['woocommerce.manage']);
    const skuOn = await h.post('/api/woocommerce/sku-rename', { enabled: true }, shopOnly);
    if (skuOn.status !== 403) wrong.push(`woocommerce.manage alone turned the SKU rename on: ${brief(skuOn)}`);
    const skuOff = await h.post('/api/woocommerce/sku-rename', { enabled: false }, shopOnly);
    if (skuOff.status !== 200) wrong.push(`woocommerce.manage could not turn the SKU rename off: ${brief(skuOff)}`);

    // N-4 / N-7: the nightly reading reads the currency and decimals again and records them for the tab's labels
    store.requests.length = 0;
    const { runNightlyOnce } = await import('../../services/woocommerce/wcNightly.service.js');
    const nightly = await runNightlyOnce(new Date(), zoneAtHour(10));
    if (nightly.state !== 'read') wrong.push(`the nightly check was ${nightly.state}`);
    for (const path of ['GET data/currencies/current', 'GET settings/general/woocommerce_price_num_decimals']) {
      if (!store.requests.includes(path)) wrong.push(`the nightly reading did not ask ${path}`);
    }
    if (nightly.summary?.siteCurrency !== 'IRHT' || nightly.summary?.siteDecimals !== 2) wrong.push(`the nightly row ${JSON.stringify(nightly.summary)}`);
    const nightView = ((await h.get('/api/woocommerce/catalog')).body as { shopSync?: MoneyView }).shopSync;
    if (nightView?.differencesCurrency !== 'IRHT') wrong.push(`the tab labels nightly prices in ${nightView?.differencesCurrency}`);

    const priceOff = await h.post('/api/woocommerce/price-list', { priceList: '' }, shopOnly);
    if (priceOff.status !== 200) wrong.push(`woocommerce.manage could not turn the price push off: ${brief(priceOff)}`);
    await h.q(`DELETE FROM wc_sync_runs WHERE kind = 'refresh' AND summary->>'trigger' = 'nightly'`);
    return `sent ${JSON.stringify(Object.fromEntries(store.pricesSent))}`;
  }));
}
