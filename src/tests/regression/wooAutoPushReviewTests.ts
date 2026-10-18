import fs from 'fs';
import path from 'path';
import type { Harness } from '../security/workflowTestHarness.js';
import { brief, linksOf, newItem, withShop } from './wooCatalogTestKit.js';
import { WC_AUTO_MAX_LINK_FAILURES, WC_MAX_ORDER_PAGES } from '../../lib/woocommerce/wcAutoPush.js';
import type { MockOrder } from '../fixtures/mockWooCatalogStore.js';

/**
 * 10.2 package 6 (D-04 part B), the review of PR #327: an order list that moves while it is read, the hourly pass and the
 * orders the webhook names, a batch the shop keeps refusing for its products, the per-run cap and the purge of old
 * automatic runs. Every case runs against the stand-in shop on 127.0.0.1, never a real one.
 */
const AUTO_KEY = 'wc_auto_push';
const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);

async function auto() {
  const mod = await import('../../services/woocommerce/wcAutoPush.service.js');
  mod.forgetSettledLinks();
  return mod;
}

async function setStock(h: Harness, itemId: number, quantity: number): Promise<void> {
  await h.q(`UPDATE item_warehouse_stocks SET current_stock = $2 WHERE item_id = $1`, [itemId, quantity]);
}

async function withAutoOn<T>(h: Harness, fn: () => Promise<T>): Promise<T> {
  const previous = await h.q(`SELECT value FROM app_settings WHERE key = $1`, [AUTO_KEY]);
  try {
    await h.q(`DELETE FROM app_settings WHERE key = $1`, [AUTO_KEY]);
    await h.q(`INSERT INTO app_settings (key, value) VALUES ($1, '1')`, [AUTO_KEY]);
    return await fn();
  } finally {
    await h.q(`DELETE FROM app_settings WHERE key = $1`, [AUTO_KEY]).catch(() => undefined);
    if (previous[0]) await h.q(`INSERT INTO app_settings (key, value) VALUES ($1, $2)`, [AUTO_KEY, previous[0].value]).catch(() => undefined);
  }
}

const onHold = (id: number, productId: number, quantity = 1): MockOrder => ({ id, status: 'on-hold', lines: [{ productId, quantity }] });

/**
 * Review M-5 / M-6: an order that leaves the open list between two pages (the shop's count changes) stops the run with
 * nothing sent; a first page that counts more open orders than the cap stops it after that one request
 */
export async function autoPushOrderListMovedCase(h: Harness, wrong: string[]): Promise<string> {
  const a = await newItem(h, 'LM', { '': 8 });
  return withAutoOn(h, () => withShop(h, [{ id: 1, sku: a.code, stock: 2 }], async (store) => {
    const refresh = await h.post('/api/woocommerce/refresh-products', {});
    if (refresh.status !== 200) return `refresh ${brief(refresh)}`;
    const { runAutoPushOnce } = await auto();
    // 101 open orders of another product: two pages; the first order leaves the list before page 2 is read
    for (let i = 1; i <= 101; i++) store.orders.push(onHold(1000 + i, 999));
    store.beforeOrdersPage = (page) => { if (page === 2) store.orders.shift(); };
    const moved = await runAutoPushOnce();
    if (moved.state !== 'failed' || store.pushed.size > 0) wrong.push(`an order list that moved while read made the run ${moved.state} and sent ${JSON.stringify([...store.pushed])}`);
    const [run] = await h.q(`SELECT error_message FROM wc_sync_runs WHERE kind = 'stock_push' ORDER BY id DESC LIMIT 1`);
    if (!/تغییر کرد/.test(String(run?.error_message ?? ''))) wrong.push(`the failed run says ${String(run?.error_message)}`);

    // the list is stable again: the run sends
    store.beforeOrdersPage = undefined;
    const stable = await runAutoPushOnce(later(2));
    if (stable.state !== 'pushed' || store.pushed.get(1) !== 8) wrong.push(`with a stable list the run was ${stable.state} and sent ${store.pushed.get(1)}, expected 8`);

    // more open orders than the cap: one request, nothing sent, the manual push says why in Persian
    store.orders.length = 0;
    for (let i = 1; i <= WC_MAX_ORDER_PAGES * 100 + 1; i++) store.orders.push(onHold(5000 + i, 999));
    store.pushed.clear();
    store.requests.length = 0;
    await setStock(h, a.id, 6);
    const tooMany = await runAutoPushOnce(later(4));
    const orderReads = store.requests.filter(r => r.startsWith('GET orders')).length;
    if (tooMany.state !== 'failed' || store.pushed.size > 0 || orderReads !== 1) wrong.push(`with too many open orders the run was ${tooMany.state}, read ${orderReads} page(s), sent ${store.pushed.size}`);
    const manual = await h.post('/api/woocommerce/sync-all-stocks', {});
    if (manual.status !== 422 || !/سفارش باز دارد/.test(JSON.stringify(manual.body))) wrong.push(`the manual push with too many orders answered ${brief(manual)}`);
    return `${orderReads} order page read`;
  }));
}

/**
 * Review M-3: an order the program does not invoice (on hold) brings the shop in line on the next run once its webhook
 * arrives, and an order that came without one is put right by the hourly pass, though nothing moved in the program
 */
export async function autoPushWebhookAndHourlyCase(h: Harness, wrong: string[]): Promise<string> {
  const a = await newItem(h, 'WH', { '': 10 });
  const pid = Number(`86${h.tag}`);
  const orderIds = [1, 2].map(n => String(Number(`6${h.tag}${n}`)));
  return withAutoOn(h, () => withShop(h, [{ id: pid, sku: a.code, stock: 10 }], async (store) => {
    const refresh = await h.post('/api/woocommerce/refresh-products', {});
    if (refresh.status !== 200) return `refresh ${brief(refresh)}`;
    const { runAutoPushOnce } = await auto();
    try {
      // the first run after a start is the hourly pass: everything is already in line
      const first = await runAutoPushOnce();
      if (first.state !== 'nothing' || store.pushed.size > 0) wrong.push(`the first pass was ${first.state} and sent ${JSON.stringify([...store.pushed])}`);

      // an on-hold order arrives; the program's stock does not move, so without its webhook nothing would be sent
      store.orders.push(onHold(Number(orderIds[0]), pid, 3));
      store.requests.length = 0;
      const quiet = await runAutoPushOnce();
      if (quiet.state !== 'nothing' || store.requests.length > 0) wrong.push(`with nothing moved and nothing marked the run was ${quiet.state} and asked ${store.requests.join(', ')}`);
      const { WooOrderSyncService } = await import('../../services/woocommerce/wooOrderSync.service.js');
      await WooOrderSyncService.handleOrder({
        id: orderIds[0], status: 'on-hold', line_items: [{ product_id: pid, variation_id: 0, quantity: 3, sku: a.code }],
      } as Parameters<typeof WooOrderSyncService.handleOrder>[0]);
      const marked = await runAutoPushOnce();
      if (marked.state !== 'pushed' || store.pushed.get(pid) !== 7) wrong.push(`after the order webhook the run was ${marked.state} and sent ${store.pushed.get(pid)}, expected 7`);

      // another on-hold order arrives without a webhook: the next minute ignores it, the hourly pass puts it right
      store.orders.push(onHold(Number(orderIds[1]), pid, 1));
      store.pushed.clear();
      const minute = await runAutoPushOnce();
      if (minute.state !== 'nothing' || store.pushed.size > 0) wrong.push(`within the hour the run was ${minute.state}`);
      const hourly = await runAutoPushOnce(later(61));
      if (hourly.state !== 'pushed' || store.pushed.get(pid) !== 6) wrong.push(`the hourly pass was ${hourly.state} and sent ${store.pushed.get(pid)}, expected 6`);
      return 'webhook and hourly pass';
    } finally {
      await h.q(`DELETE FROM woocommerce_order_logs WHERE wc_order_id = ANY($1)`, [orderIds]);
    }
  }));
}

/**
 * Review M-4: a batch the shop refuses for its products (404: the variations of a parent removed in the shop) counts
 * against each of them and stops them after the limit; it never makes later runs wait as a shop that is down does
 */
export async function autoPushRefusedBatchCase(h: Harness, wrong: string[]): Promise<string> {
  const v = await newItem(h, 'RB', { '': 4 });
  return withAutoOn(h, () => withShop(h, [{ id: 7, sku: `RBPAR_${h.tag}`, variations: [{ id: 71, sku: v.code, stock: 1 }] }], async (store) => {
    const refresh = await h.post('/api/woocommerce/refresh-products', {});
    if (refresh.status !== 200) return `refresh ${brief(refresh)}`;
    const { runAutoPushOnce } = await auto();
    store.statusPaths.set('products/7/variations/batch', 404);
    const states: string[] = [];
    // each run right after the other: a run refused for its products never sets a wait
    for (let i = 0; i < WC_AUTO_MAX_LINK_FAILURES; i++) states.push((await runAutoPushOnce()).state);
    if (states.includes('waiting') || states.includes('failed')) wrong.push(`a batch refused for its products made the runs ${states.join(', ')}`);
    const link = (await linksOf(h, [v.id])).get(v.id);
    if (link?.failures !== WC_AUTO_MAX_LINK_FAILURES) wrong.push(`the refused variation failed ${link?.failures} times, expected ${WC_AUTO_MAX_LINK_FAILURES}`);
    store.requests.length = 0;
    const stopped = await runAutoPushOnce();
    if (stopped.state !== 'nothing' || store.requests.some(r => r.startsWith('POST'))) wrong.push(`a stopped variation was still sent: ${stopped.state}`);
    const runs = await h.q(`SELECT status FROM wc_sync_runs WHERE kind = 'stock_push' ORDER BY id`);
    if (runs.some(r => r.status === 'failed')) wrong.push(`runs recorded as failed: ${runs.map(r => r.status).join(', ')}`);
    return `${runs.length} partial runs`;
  }));
}

/** Review (d): one run sends at most its cap; the rest go on the next run */
export async function autoPushCapCase(h: Harness, wrong: string[]): Promise<string> {
  const items = [await newItem(h, 'C1', { '': 5 }), await newItem(h, 'C2', { '': 6 }), await newItem(h, 'C3', { '': 7 })];
  return withAutoOn(h, () => withShop(h, items.map((it, i) => ({ id: i + 1, sku: it.code, stock: 0 })), async (store) => {
    const refresh = await h.post('/api/woocommerce/refresh-products', {});
    if (refresh.status !== 200) return `refresh ${brief(refresh)}`;
    const { runAutoPushOnce } = await auto();
    const first = await runAutoPushOnce(new Date(), { maxProducts: 2 });
    if (first.result?.syncedCount !== 2 || store.pushed.size !== 2) wrong.push(`with a cap of 2 the first run sent ${store.pushed.size}`);
    const second = await runAutoPushOnce(new Date(), { maxProducts: 2 });
    if (second.result?.syncedCount !== 1 || store.pushed.size !== 3) wrong.push(`the second run sent ${second.result?.syncedCount}, total ${store.pushed.size}, expected the third product`);
    return 'cap kept';
  }));
}

/** Review (c): the daily purge removes automatic run rows older than 30 days, never a manual run or a recent one */
export async function autoPushRunPurgeCase(h: Harness, wrong: string[]): Promise<string> {
  return withShop(h, [], async () => {
    const rows = await h.q(
      `INSERT INTO wc_sync_runs (kind, status, finished_at, summary) VALUES
       ('stock_push', 'ok', now() - interval '40 days', '{"trigger":"auto"}'),
       ('stock_push', 'ok', now() - interval '40 days', '{"trigger":"all"}'),
       ('stock_push', 'ok', now() - interval '2 days', '{"trigger":"auto"}'),
       ('refresh', 'ok', now() - interval '40 days', '{}')
       RETURNING id`,
    );
    const { purgeOldAutoRuns } = await import('../../services/woocommerce/wcSyncRunPurge.js');
    const deleted = await purgeOldAutoRuns();
    const kept = (await h.q(`SELECT id FROM wc_sync_runs WHERE id = ANY($1)`, [rows.map(r => r.id)])).map(r => Number(r.id));
    if (deleted !== 1 || kept.includes(Number(rows[0].id)) || kept.length !== 3) wrong.push(`the purge deleted ${deleted} and kept ${JSON.stringify(kept)}`);
    const server = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
    if (!/OperationalPurgeService\.register\('wcAutoPushRuns', \(\) => purgeOldAutoRuns\(\)\)/.test(server)) wrong.push('server.ts does not register the purge with the daily operational purge');
    return 'old automatic runs purged';
  });
}
