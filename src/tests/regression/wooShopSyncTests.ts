import type { Harness } from '../security/workflowTestHarness.js';
import type { MockProduct } from '../fixtures/mockWooCatalogStore.js';
import { brief, newItem, withShop } from './wooCatalogTestKit.js';
import { WC_AUTO_MAX_LINK_FAILURES } from '../../lib/woocommerce/wcAutoPush.js';

/**
 * 10.2 package 6 (D-04 part C): the price push, the SKU rename and the nightly re-read. Every case runs against the stand-in
 * shop on 127.0.0.1, never a real one, and calls one run directly (`runPricePushOnce`, `runSkuRenameOnce`, `runNightlyOnce`)
 * instead of waiting for the worker's minute. Red on v10.2.12: no price or SKU ever went to the shop, the routes
 * `POST /woocommerce/price-list` and `/sku-rename` did not exist and the shop was never read again on its own.
 */
const SETTING_KEYS = ['wc_price_list', 'wc_sku_rename', 'wc_auto_push', 'pricing_strategies'];
const PRICE_LIST = 'فروشگاه';
/** past any wait the earlier failed runs set */
const later = (hours: number) => new Date(Date.now() + hours * 3_600_000);

async function withSendSettings<T>(h: Harness, fn: () => Promise<T>): Promise<T> {
  const previous = await h.q(`SELECT key, value FROM app_settings WHERE key = ANY($1)`, [SETTING_KEYS]);
  const { forgetSiteCurrency } = await import('../../services/woocommerce/wcSiteCurrency.js');
  try {
    forgetSiteCurrency();
    await h.q(`DELETE FROM app_settings WHERE key = ANY($1)`, [SETTING_KEYS]);
    await h.q(`INSERT INTO app_settings (key, value) VALUES ('pricing_strategies', $1)`, [JSON.stringify([PRICE_LIST, 'عمده'])]);
    return await fn();
  } finally {
    forgetSiteCurrency();
    await h.q(`DELETE FROM app_settings WHERE key = ANY($1)`, [SETTING_KEYS]).catch(() => undefined);
    for (const row of previous) await h.q(`INSERT INTO app_settings (key, value) VALUES ($1, $2)`, [row.key, row.value]).catch(() => undefined);
  }
}

async function setPrice(h: Harness, itemId: number, price: number, currency = 'IRR'): Promise<void> {
  const updated = await h.q(`UPDATE item_prices SET price = $3, currency = $4 WHERE item_id = $1 AND title = $2 AND is_deleted = 0 RETURNING id`, [itemId, PRICE_LIST, price, currency]);
  if (updated.length === 0) await h.q(`INSERT INTO item_prices (item_id, title, price, currency) VALUES ($1, $2, $3, $4)`, [itemId, PRICE_LIST, price, currency]);
}

async function fields() {
  return import('../../services/woocommerce/wcFieldPush.service.js');
}

async function linkFields(h: Harness, itemId: number) {
  const [row] = await h.q(
    `SELECT site_sku, site_type, site_regular_price, price_error, price_failure_count, sku_error, sku_failure_count, site_stock
       FROM wc_product_links WHERE is_deleted = 0 AND item_id = $1`, [itemId]);
  return row as Record<string, unknown> | undefined;
}

interface ShopSyncBody {
  shopSync?: {
    priceList?: string; siteCurrency?: string | null;
    price?: { enabled?: boolean; skipped?: Array<{ itemId: number; reason: string }>; stopped?: Array<{ itemId: number }>; lastRun?: { summary?: { trigger?: string } } | null };
    sku?: { enabled?: boolean; pending?: number; stopped?: Array<{ itemId: number }> };
    lastNightly?: { status?: string } | null;
    differences?: Array<{ itemId: number; kind: string; site: string | null; program: string | null }>;
  };
}

/**
 * Off by default; only `woocommerce.manage` chooses a configured price list; the regular price goes to the shop in its unit
 * (a rial price ÷ 10 for a toman shop), only where it differs, never for a variable parent, a link never read or a price in
 * another currency; a refused product stops after five refusals and a failing shop waits and is audited once
 */
export async function pricePushCase(h: Harness, wrong: string[]): Promise<string> {
  const a = await newItem(h, 'PA');
  const rounded = await newItem(h, 'PR');
  const same = await newItem(h, 'PS');
  const dollar = await newItem(h, 'PD');
  const parent = await newItem(h, 'PP');
  const variation = await newItem(h, 'PV');
  const none = await newItem(h, 'PN');
  const products: MockProduct[] = [
    { id: 1, sku: a.code, regularPrice: '' },
    { id: 2, sku: rounded.code },
    { id: 3, sku: same.code, regularPrice: '90000' },
    { id: 4, sku: dollar.code },
    { id: 5, sku: parent.code, variations: [{ id: 51, sku: `PVX_${h.tag}` }] },
    { id: 6, sku: `PVPAR_${h.tag}`, variations: [{ id: 61, sku: variation.code }] },
    { id: 7, sku: none.code },
  ];
  return withSendSettings(h, () => withShop(h, products, async (store) => {
    store.currency = 'IRT';
    const { runPricePushOnce } = await fields();
    const off = await runPricePushOnce();
    if (off.state !== 'off' || store.requests.length > 0) wrong.push(`with the setting absent the run was ${off.state} after ${store.requests.join(', ')}`);

    const refresh = await h.post('/api/woocommerce/refresh-products', {});
    if (refresh.status !== 200) return `refresh ${brief(refresh)}`;
    await setPrice(h, a.id, 1_250_000);
    await setPrice(h, rounded.id, 1_234_567);
    await setPrice(h, same.id, 900_000);
    await setPrice(h, dollar.id, 10, 'USD');
    await setPrice(h, parent.id, 3_000_000);
    await setPrice(h, variation.id, 2_000_000);

    const reader = await h.sessionWith(['woocommerce.view']);
    const denied = await h.post('/api/woocommerce/price-list', { priceList: PRICE_LIST }, reader);
    if (denied.status !== 403) wrong.push(`a woocommerce.view reader chose the price list: ${brief(denied)}`);
    const empty = await h.post('/api/woocommerce/price-list', {});
    if (empty.status !== 400) wrong.push(`a body without the price list answered ${brief(empty)}, expected 400`);
    const unknown = await h.post('/api/woocommerce/price-list', { priceList: 'فهرست ناشناخته' });
    if (unknown.status !== 422 || (unknown.body as { code?: string }).code !== 'WC_PRICE_LIST_NOT_CONFIGURED') wrong.push(`an unconfigured price list answered ${brief(unknown)}`);
    const chosen = await h.post('/api/woocommerce/price-list', { priceList: PRICE_LIST });
    if (chosen.status !== 200 || (chosen.body as { priceList?: string }).priceList !== PRICE_LIST) wrong.push(`choosing the price list answered ${brief(chosen)}`);
    const audits = await h.q(`SELECT details FROM activity_logs WHERE entity = 'فروشگاه اینترنتی' AND entity_id = 'wc_price_list' ORDER BY id DESC LIMIT 1`);
    if ((audits[0]?.details as { after?: { priceList?: string } } | undefined)?.after?.priceList !== PRICE_LIST) wrong.push(`audit of the choice ${JSON.stringify(audits)}`);

    store.requests.length = 0;
    const first = await runPricePushOnce();
    if (first.state !== 'pushed' || first.result?.syncedCount !== 3) wrong.push(`first run ${JSON.stringify(first)}, expected three prices sent`);
    const sent = Object.fromEntries(store.pricesSent);
    if (sent[1] !== '125000' || sent[2] !== '123457' || sent[61] !== '200000') wrong.push(`prices sent ${JSON.stringify(sent)}, expected 125000, 123457 and 200000 in toman`);
    for (const [id, what] of [[3, 'an equal price'], [4, 'a dollar price for a toman shop'], [5, 'a variable parent'], [7, 'an item without a price']] as const) {
      if (store.pricesSent.has(id)) wrong.push(`${what} was sent`);
    }
    if (store.pushed.size > 0 || store.manageStockSent.size > 0) wrong.push('the price push sent stock fields');
    if (!store.requests.some(r => r.startsWith('POST products/6/variations/batch'))) wrong.push(`the variation price did not go through its parent's batch: ${store.requests.join(', ')}`);
    if (!store.requests.includes('GET data/currencies/current')) wrong.push('the shop currency was not read');
    if ((await linkFields(h, a.id))?.site_regular_price !== '125000') wrong.push(`the link kept ${JSON.stringify(await linkFields(h, a.id))}`);

    const batches = store.batchSizes.length;
    const idle = await runPricePushOnce();
    if (idle.state !== 'nothing' || store.batchSizes.length !== batches) wrong.push(`a run with no price changed was ${idle.state}`);

    // a failing shop: the run fails, the next one waits, one audit row for the streak and no product counts it
    const [{ mark }] = await h.q(`SELECT coalesce(max(id), 0) AS mark FROM activity_logs`);
    await setPrice(h, a.id, 1_300_000);
    store.failStatus = 500;
    const down = await runPricePushOnce();
    if (down.state !== 'failed') wrong.push(`a failing shop run was ${down.state}`);
    const waiting = await runPricePushOnce();
    if (waiting.state !== 'waiting') wrong.push(`the run after a failure was ${waiting.state}, expected waiting`);
    const downAgain = await runPricePushOnce(later(1));
    if (downAgain.state !== 'failed') wrong.push(`the second failing run was ${downAgain.state}`);
    const failAudits = await h.q(`SELECT id FROM activity_logs WHERE action = 'WC_PRICE_PUSH' AND id > $1`, [mark]);
    if (failAudits.length !== 1) wrong.push(`${failAudits.length} audit rows for one failure streak, expected 1`);
    if (Number((await linkFields(h, a.id))?.price_failure_count) !== 0) wrong.push('a failing shop counted against the product');
    store.failStatus = undefined;

    // a product the shop refuses is counted and stops after five refusals in a row
    store.rowErrors.add(1);
    for (let i = 0; i < WC_AUTO_MAX_LINK_FAILURES; i++) await runPricePushOnce(later(2));
    const refused = await linkFields(h, a.id);
    if (Number(refused?.price_failure_count) !== WC_AUTO_MAX_LINK_FAILURES || !String(refused?.price_error)) wrong.push(`after five refusals the link holds ${JSON.stringify(refused)}`);
    const stopped = await runPricePushOnce(later(2));
    if (stopped.state !== 'nothing') wrong.push(`a stopped product was sent again: ${JSON.stringify(stopped)}`);

    await h.q(`UPDATE wc_product_links SET site_type = '' WHERE item_id = $1 AND is_deleted = 0`, [rounded.id]);
    const catalog = await h.get('/api/woocommerce/catalog');
    const view = (catalog.body as ShopSyncBody).shopSync;
    const reasons = new Map((view?.price?.skipped ?? []).map(s => [s.itemId, s.reason]));
    const expected: Array<[number, string]> = [[dollar.id, 'currency_mismatch'], [parent.id, 'variable_parent'], [none.id, 'no_price'], [rounded.id, 'not_read']];
    for (const [id, reason] of expected) if (reasons.get(id) !== reason) wrong.push(`the tab lists item ${id} as ${reasons.get(id)}, expected ${reason}`);
    if (!view?.price?.stopped?.some(s => s.itemId === a.id)) wrong.push(`the tab's stopped prices ${JSON.stringify(view?.price?.stopped)}`);
    if (view?.priceList !== PRICE_LIST || view?.siteCurrency !== 'IRT' || view?.price?.lastRun?.summary?.trigger !== 'auto') wrong.push(`the tab's price view ${JSON.stringify(view?.price?.lastRun)} ${view?.priceList} ${view?.siteCurrency}`);

    const offAgain = await h.post('/api/woocommerce/price-list', { priceList: '' });
    if (offAgain.status !== 200 || (await runPricePushOnce(later(3))).state !== 'off') wrong.push(`turning the price push off answered ${brief(offAgain)}`);
    return `${store.batchSizes.length} batch requests`;
  }));
}

/** Off by default; after an item's code changes the linked product's SKU becomes the new code; a SKU the shop refuses stops after five */
export async function skuRenameCase(h: Harness, wrong: string[]): Promise<string> {
  const x = await newItem(h, 'SX');
  const y = await newItem(h, 'SY');
  const taken = `TAKEN_${h.tag}_${Math.floor(Math.random() * 1e6)}`;
  const products: MockProduct[] = [{ id: 1, sku: x.code }, { id: 2, sku: y.code }, { id: 3, sku: taken }];
  return withSendSettings(h, () => withShop(h, products, async (store) => {
    const refresh = await h.post('/api/woocommerce/refresh-products', {});
    if (refresh.status !== 200) return `refresh ${brief(refresh)}`;
    const newCode = `${x.code}N`;
    await h.q(`UPDATE items SET code = $2 WHERE id = $1`, [x.id, newCode]);
    await h.q(`UPDATE items SET code = $2 WHERE id = $1`, [y.id, taken]);

    const { runSkuRenameOnce } = await fields();
    const off = await runSkuRenameOnce();
    if (off.state !== 'off' || store.skusSent.size > 0) wrong.push(`with the setting absent the run was ${off.state}`);

    const reader = await h.sessionWith(['woocommerce.view']);
    const denied = await h.post('/api/woocommerce/sku-rename', { enabled: true }, reader);
    if (denied.status !== 403) wrong.push(`a woocommerce.view reader turned the SKU rename on: ${brief(denied)}`);
    const toggle = await h.post('/api/woocommerce/sku-rename', {});
    if (toggle.status !== 400) wrong.push(`a body without the target state answered ${brief(toggle)}, expected 400`);
    const on = await h.post('/api/woocommerce/sku-rename', { enabled: true });
    if (on.status !== 200 || (on.body as { enabled?: boolean }).enabled !== true) wrong.push(`turning it on answered ${brief(on)}`);
    const catalog = await h.get('/api/woocommerce/catalog');
    if ((catalog.body as ShopSyncBody).shopSync?.sku?.pending !== 2) wrong.push(`the tab's pending renames ${JSON.stringify((catalog.body as ShopSyncBody).shopSync?.sku)}`);

    const first = await runSkuRenameOnce();
    if (store.skusSent.get(1) !== newCode || products[0].sku !== newCode) wrong.push(`the shop got SKU ${store.skusSent.get(1)}, expected ${newCode}`);
    if ((await linkFields(h, x.id))?.site_sku !== newCode) wrong.push(`the link kept ${JSON.stringify(await linkFields(h, x.id))}`);
    const [run] = await h.q(`SELECT summary FROM wc_sync_runs WHERE kind = 'sku_push' ORDER BY id DESC LIMIT 1`);
    const renamed = (run?.summary as { trigger?: string; renamed?: Array<{ from: string; to: string }> } | undefined);
    if (renamed?.trigger !== 'auto' || !renamed.renamed?.some(r => r.from === x.code && r.to === newCode)) wrong.push(`run summary ${JSON.stringify(run?.summary)}`);
    if (first.result?.failedCount !== 1) wrong.push(`first run ${JSON.stringify(first)}, expected the taken SKU refused`);

    for (let i = 1; i < WC_AUTO_MAX_LINK_FAILURES; i++) await runSkuRenameOnce(later(1));
    const refused = await linkFields(h, y.id);
    if (Number(refused?.sku_failure_count) !== WC_AUTO_MAX_LINK_FAILURES || !String(refused?.sku_error)) wrong.push(`after five refusals the link holds ${JSON.stringify(refused)}`);
    if (store.skusSent.has(2)) wrong.push('the shop recorded a refused SKU');
    const stopped = await runSkuRenameOnce(later(1));
    if (stopped.state !== 'nothing') wrong.push(`a stopped rename was sent again: ${JSON.stringify(stopped)}`);
    const view = (await h.get('/api/woocommerce/catalog')).body as ShopSyncBody;
    if (!view.shopSync?.sku?.stopped?.some(s => s.itemId === y.id)) wrong.push(`the tab's stopped renames ${JSON.stringify(view.shopSync?.sku?.stopped)}`);

    const offAgain = await h.post('/api/woocommerce/sku-rename', { enabled: false });
    if (offAgain.status !== 200 || (await runSkuRenameOnce(later(2))).state !== 'off') wrong.push(`turning it off answered ${brief(offAgain)}`);
    return `${store.batchSizes.length} batch requests`;
  }));
}

/** A fixed-offset time zone whose hour is `hour` now, so the case does not depend on the clock */
function zoneAtHour(hour: number): string {
  let offset = ((hour - new Date().getUTCHours()) % 24 + 24) % 24;
  if (offset > 14) offset -= 24;
  if (offset === 0) return 'UTC';
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

/**
 * From the nightly hour, once a business day while a send is on: the catalog is read again without an audit row, the stock
 * and price differences are listed, stopped products may try again; a failed reading is tried at most three times, 30
 * minutes apart
 */
export async function nightlyReReadCase(h: Harness, wrong: string[]): Promise<string> {
  const s = await newItem(h, 'NS', { '': 5 });
  const r = await newItem(h, 'NR');
  const products: MockProduct[] = [{ id: 1, sku: s.code, stock: 5 }, { id: 2, sku: r.code, regularPrice: '1000000' }];
  return withSendSettings(h, () => withShop(h, products, async (store) => {
    const refresh = await h.post('/api/woocommerce/refresh-products', {});
    if (refresh.status !== 200) return `refresh ${brief(refresh)}`;
    await setPrice(h, r.id, 1_000_000);
    const { runNightlyOnce } = await import('../../services/woocommerce/wcNightly.service.js');
    const day = zoneAtHour(10);
    const off = await runNightlyOnce(new Date(), day);
    if (off.state !== 'off') wrong.push(`with every send off the nightly check was ${off.state}`);

    const chosen = await h.post('/api/woocommerce/price-list', { priceList: PRICE_LIST });
    if (chosen.status !== 200) return `price list ${brief(chosen)}`;
    const early = await runNightlyOnce(new Date(), zoneAtHour(1));
    if (early.state !== 'not_due') wrong.push(`before the nightly hour the check was ${early.state}`);

    products[0].stock = 9;
    products[1].regularPrice = '950000';
    await h.q(`UPDATE wc_product_links SET price_failure_count = $2, sku_failure_count = $2 WHERE item_id = $1 AND is_deleted = 0`, [s.id, WC_AUTO_MAX_LINK_FAILURES]);
    const [{ mark }] = await h.q(`SELECT coalesce(max(id), 0) AS mark FROM activity_logs`);
    store.requests.length = 0;
    const read = await runNightlyOnce(new Date(), day);
    if (read.state !== 'read') wrong.push(`the nightly check was ${read.state}, expected read`);
    const differences = read.summary?.differences ?? [];
    const stock = differences.find(d => d.itemId === s.id && d.kind === 'stock');
    const price = differences.find(d => d.itemId === r.id && d.kind === 'price');
    if (stock?.site !== '9' || stock.program !== '5') wrong.push(`stock difference ${JSON.stringify(stock)}`);
    if (price?.site !== '950000' || price.program !== '1000000') wrong.push(`price difference ${JSON.stringify(price)}`);
    if (store.requests.some(q => q.startsWith('POST'))) wrong.push(`the nightly reading sent something: ${store.requests.join(', ')}`);
    const link = await linkFields(h, s.id);
    if (Number(link?.site_stock) !== 9 || Number(link?.price_failure_count) !== 0 || Number(link?.sku_failure_count) !== 0) wrong.push(`after the reading the link holds ${JSON.stringify(link)}`);
    const audits = await h.q(`SELECT action FROM activity_logs WHERE entity = 'فروشگاه اینترنتی' AND id > $1`, [mark]);
    if (audits.length > 0) wrong.push(`the nightly reading wrote audit rows ${JSON.stringify(audits)}`);
    const runs = await h.q(`SELECT status, summary FROM wc_sync_runs WHERE kind = 'refresh' AND summary->>'trigger' = 'nightly'`);
    if (runs.length !== 1 || !(runs[0].summary as { businessDay?: string }).businessDay) wrong.push(`nightly run rows ${JSON.stringify(runs)}`);
    const again = await runNightlyOnce(new Date(), day);
    if (again.state !== 'not_due') wrong.push(`a second check the same day was ${again.state}`);
    const view = ((await h.get('/api/woocommerce/catalog')).body as ShopSyncBody).shopSync;
    if (!view?.lastNightly || (view.differences ?? []).length !== 2) wrong.push(`the tab's nightly view ${JSON.stringify(view?.lastNightly)} ${JSON.stringify(view?.differences)}`);

    // a failing shop: three attempts that day, at least 30 minutes apart
    await h.q(`DELETE FROM wc_sync_runs WHERE kind = 'refresh' AND summary->>'trigger' = 'nightly'`);
    store.failStatus = 500;
    const minutes = (m: number) => new Date(Date.now() + m * 60_000);
    const states = [
      (await runNightlyOnce(minutes(0), day)).state, (await runNightlyOnce(minutes(5), day)).state,
      (await runNightlyOnce(minutes(31), day)).state, (await runNightlyOnce(minutes(62), day)).state,
      (await runNightlyOnce(minutes(100), day)).state,
    ];
    store.failStatus = undefined;
    if (states.join(',') !== 'failed,not_due,failed,failed,not_due') wrong.push(`failed readings went ${states.join(',')}, expected failed,not_due,failed,failed,not_due`);
    return `differences ${differences.length}; failures ${states.join(',')}`;
  }));
}
