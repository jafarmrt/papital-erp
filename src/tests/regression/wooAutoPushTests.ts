import type { Harness } from '../security/workflowTestHarness.js';
import { brief, linksOf, newItem, withShop } from './wooCatalogTestKit.js';
import { WC_AUTO_MAX_LINK_FAILURES } from '../../lib/woocommerce/wcAutoPush.js';

/**
 * 10.2 package 6 (D-04 part B): the automatic stock push. Every case runs against the stand-in shop on 127.0.0.1, never a
 * real one, and calls one automatic run directly (`runAutoPushOnce`) instead of waiting for the worker's minute. Red on
 * v10.2.6: there was no automatic push, no `POST /woocommerce/auto-push` and no open order was ever kept off the stock sent.
 */
const AUTO_KEY = 'wc_auto_push';
/** an hour ahead: past any wait the earlier failed runs set */
const later = (hours: number) => new Date(Date.now() + hours * 3_600_000);

async function auto() {
  const mod = await import('../../services/woocommerce/wcAutoPush.service.js');
  mod.forgetSettledLinks();
  return mod;
}

async function setStock(h: Harness, itemId: number, quantity: number): Promise<void> {
  await h.q(`UPDATE item_warehouse_stocks SET current_stock = $2 WHERE item_id = $1`, [itemId, quantity]);
}

async function withAutoSetting<T>(h: Harness, fn: () => Promise<T>): Promise<T> {
  const previous = await h.q(`SELECT value FROM app_settings WHERE key = $1`, [AUTO_KEY]);
  try {
    await h.q(`DELETE FROM app_settings WHERE key = $1`, [AUTO_KEY]);
    return await fn();
  } finally {
    await h.q(`DELETE FROM app_settings WHERE key = $1`, [AUTO_KEY]).catch(() => undefined);
    if (previous[0]) await h.q(`INSERT INTO app_settings (key, value) VALUES ($1, $2)`, [AUTO_KEY, previous[0].value]).catch(() => undefined);
  }
}

/** Off by default; only `woocommerce.manage` turns it on, with the target state, an audit row and a complete connection */
export async function autoPushSwitchCase(h: Harness, wrong: string[]): Promise<string> {
  const a = await newItem(h, 'SA', { '': 4 });
  return withAutoSetting(h, () => withShop(h, [{ id: 1, sku: a.code, stock: 1 }], async (store) => {
    const { runAutoPushOnce } = await auto();
    const off = await runAutoPushOnce();
    if (off.state !== 'off' || store.requests.length > 0) wrong.push(`with the setting absent the run was ${off.state} after ${store.requests.join(', ')}`);

    const reader = await h.sessionWith(['woocommerce.view']);
    const denied = await h.post('/api/woocommerce/auto-push', { enabled: true }, reader);
    if (denied.status !== 403) wrong.push(`a woocommerce.view reader turned the automatic push on: ${brief(denied)}`);
    const toggle = await h.post('/api/woocommerce/auto-push', {});
    if (toggle.status !== 400) wrong.push(`a body without the target state answered ${brief(toggle)}, expected 400`);
    const extra = await h.post('/api/woocommerce/auto-push', { enabled: true, interval: 1 });
    if (extra.status !== 400) wrong.push(`an unknown key answered ${brief(extra)}, expected 400`);

    const url = await h.q(`SELECT value FROM app_settings WHERE key = 'wc_store_url'`);
    await h.q(`DELETE FROM app_settings WHERE key = 'wc_store_url'`);
    const incomplete = await h.post('/api/woocommerce/auto-push', { enabled: true });
    if (incomplete.status !== 422) wrong.push(`turning it on without a shop address answered ${brief(incomplete)}, expected 422`);
    await h.q(`INSERT INTO app_settings (key, value) VALUES ('wc_store_url', $1)`, [url[0]?.value]);

    const on = await h.post('/api/woocommerce/auto-push', { enabled: true });
    if (on.status !== 200 || (on.body as { enabled?: boolean }).enabled !== true) wrong.push(`turning it on answered ${brief(on)}`);
    const again = await h.post('/api/woocommerce/auto-push', { enabled: true });
    if ((again.body as { changed?: boolean }).changed !== false) wrong.push(`a repeat changed it again: ${brief(again)}`);
    const audits = await h.q(`SELECT details FROM activity_logs WHERE entity = 'فروشگاه اینترنتی' AND entity_id = $1 ORDER BY id DESC LIMIT 2`, [AUTO_KEY]);
    const after = (audits[0]?.details as { after?: { enabled?: boolean } } | undefined)?.after;
    if (audits.length < 1 || after?.enabled !== true) wrong.push(`audit of the switch ${JSON.stringify(audits.map(r => r.details))}`);
    const catalog = await h.get('/api/woocommerce/catalog');
    if ((catalog.body as { autoPush?: { enabled?: boolean } }).autoPush?.enabled !== true) wrong.push(`the tab does not show it on: ${brief(catalog)}`);

    const offAgain = await h.post('/api/woocommerce/auto-push', { enabled: false });
    if (offAgain.status !== 200 || (offAgain.body as { enabled?: boolean }).enabled !== false) wrong.push(`turning it off answered ${brief(offAgain)}`);
    const stopped = await runAutoPushOnce();
    if (stopped.state !== 'off') wrong.push(`after turning it off the run was ${stopped.state}`);
    return 'switch checked';
  }));
}

/** Only links whose sellable stock moved, only products already tracking stock, never `manage_stock`, nothing when nothing moved */
export async function autoPushChangedTrackedCase(h: Harness, wrong: string[]): Promise<string> {
  const same = await newItem(h, 'AS', { '': 5 });
  const moved = await newItem(h, 'AM', { '': 3 });
  const untracked = await newItem(h, 'AU', { '': 4 });
  const products = [{ id: 1, sku: same.code, stock: 5 }, { id: 2, sku: moved.code, stock: 1 }, { id: 3, sku: untracked.code }];
  return withAutoSetting(h, () => withShop(h, products, async (store) => {
    const refresh = await h.post('/api/woocommerce/refresh-products', {});
    if (refresh.status !== 200) return `refresh ${brief(refresh)}`;
    await h.q(`INSERT INTO app_settings (key, value) VALUES ($1, '1')`, [AUTO_KEY]);
    const { runAutoPushOnce } = await auto();
    store.requests.length = 0;
    const [{ mark: auditMark }] = await h.q(`SELECT coalesce(max(id), 0) AS mark FROM activity_logs`);

    const first = await runAutoPushOnce();
    if (first.state !== 'pushed' || first.result?.syncedCount !== 1) wrong.push(`first run ${JSON.stringify(first)}, expected one product pushed`);
    if (store.pushed.get(2) !== 3) wrong.push(`the moved product got ${store.pushed.get(2)}, expected 3`);
    if (store.pushed.has(1)) wrong.push('a product whose stock did not move was pushed');
    if (store.pushed.has(3)) wrong.push('a product with stock tracking off was pushed automatically');
    if (store.manageStockSent.has(2)) wrong.push(`the automatic push sent manage_stock ${String(store.manageStockSent.get(2))}`);
    if (!store.requests.includes('GET orders?page=1')) wrong.push(`the open orders were not read before the push: ${store.requests.join(', ')}`);

    store.requests.length = 0;
    const idle = await runAutoPushOnce();
    if (idle.state !== 'nothing' || store.requests.length > 0) wrong.push(`a run with nothing moved was ${idle.state} and asked ${store.requests.join(', ')}`);

    await setStock(h, same.id, 7);
    const next = await runAutoPushOnce();
    if (next.state !== 'pushed' || store.pushed.get(1) !== 7) wrong.push(`after a stock change the run was ${next.state} and the shop got ${store.pushed.get(1)}, expected 7`);

    const catalog = await h.get('/api/woocommerce/catalog');
    const view = (catalog.body as { autoPush?: { untracked?: Array<{ itemId: number }>; untrackedTotal?: number; lastRun?: { summary?: { trigger?: string } } } }).autoPush;
    if (!view?.untracked?.some(r => r.itemId === untracked.id) || view.untrackedTotal !== 1) wrong.push(`the tab's untracked list ${JSON.stringify(view?.untracked)}`);
    if (view?.lastRun?.summary?.trigger !== 'auto') wrong.push(`the tab's last automatic run ${JSON.stringify(view?.lastRun)}`);
    const lastPush = (catalog.body as { lastPush?: unknown }).lastPush;
    if (lastPush !== null) wrong.push(`an automatic run showed as the last manual push: ${JSON.stringify(lastPush)}`);
    // review (c): a successful automatic run writes no audit row (its run row is the record)
    const audits = await h.q(`SELECT id FROM activity_logs WHERE action = 'WC_STOCK_PUSH' AND details->>'trigger' = 'auto' AND id > $1`, [auditMark]);
    if (audits.length > 0) wrong.push(`successful automatic runs wrote ${audits.length} audit row(s)`);
    return `${store.batchSizes.length} batch requests`;
  }));
}

/**
 * On-hold and processing orders without a live invoice, and completed orders whose invoice failed, are kept off the stock the
 * automatic and the manual push send; pending orders (review M-1) and invoiced orders of any status (review M-2) are not
 */
export async function autoPushOpenOrdersCase(h: Harness, wrong: string[]): Promise<string> {
  const a = await newItem(h, 'OA', { '': 10 });
  const v = await newItem(h, 'OV', { '': 6 });
  // product ids of this case only, so an order log another case left never matches them
  const pid = Number(`88${h.tag}`);
  const parent = pid + 1;
  const variation = pid + 2;
  const products = [{ id: pid, sku: a.code, stock: 10 }, { id: parent, sku: `OPAR_${h.tag}`, variations: [{ id: variation, sku: v.code, stock: 6 }] }];
  return withAutoSetting(h, () => withShop(h, products, async (store) => {
    const refresh = await h.post('/api/woocommerce/refresh-products', {});
    if (refresh.status !== 200) return `refresh ${brief(refresh)}`;
    const { createTestDocument } = await import('../fixtures/factories.js');
    const invoice = await createTestDocument({ type: 'invoice', status: 'final' });
    const onHoldInvoice = await createTestDocument({ type: 'invoice', status: 'final' });
    const voided = await createTestDocument({ type: 'invoice', status: 'final', isDeleted: 1 });
    const ids = [1, 2, 3, 4, 5, 6, 7, 8].map(n => Number(`7${h.tag}${n}`));
    store.orders.push(
      { id: ids[0], status: 'pending', lines: [{ productId: pid, quantity: 2 }, { productId: parent, variationId: variation, quantity: 1 }] },
      { id: ids[1], status: 'on-hold', lines: [{ productId: pid, quantity: 1 }] },
      { id: ids[2], status: 'processing', lines: [{ productId: pid, quantity: 3 }] },
      { id: ids[3], status: 'processing', lines: [{ productId: pid, quantity: 4 }] },
      { id: ids[4], status: 'processing', lines: [{ productId: pid, quantity: 1 }] },
      { id: ids[5], status: 'completed', lines: [{ productId: pid, quantity: 5 }] },
      { id: ids[6], status: 'on-hold', lines: [{ productId: pid, quantity: 2 }] },
    );
    const failedPayload = { id: ids[7], status: 'completed', line_items: [{ product_id: pid, variation_id: 0, quantity: 2 }] };
    await h.q(
      `INSERT INTO woocommerce_order_logs (wc_order_id, erp_document_id, status, payload) VALUES
       ($1, $2, 'processed', NULL), ($3, $4, 'processed', NULL), ($5, $6, 'processed', NULL), ($7, NULL, 'failed', $8::jsonb)`,
      [String(ids[3]), invoice.document.id, String(ids[4]), voided.document.id, String(ids[6]), onHoldInvoice.document.id,
        String(ids[7]), JSON.stringify(failedPayload)],
    );
    try {
      await h.q(`INSERT INTO app_settings (key, value) VALUES ($1, '1')`, [AUTO_KEY]);
      const { runAutoPushOnce } = await auto();
      await setStock(h, a.id, 12);
      await setStock(h, v.id, 6);
      const run = await runAutoPushOnce();
      // 12 less on-hold 1, processing without invoice 3, processing whose invoice was voided 1 and the completed order whose
      // invoice failed 2 = 5; the pending order, the invoiced processing and on-hold orders and the completed one are not kept off
      if (store.pushed.get(pid) !== 5) wrong.push(`the shop got ${store.pushed.get(pid)} for the product, expected 5 (run ${JSON.stringify(run)})`);
      // the variation's stock did not move in the program, and its only order is pending: nothing to correct
      if (store.pushed.has(variation)) wrong.push(`a variation whose stock did not move got ${store.pushed.get(variation)}`);
      const query = store.queries.find((_, i) => store.requests[i] === 'GET orders?page=1');
      if (query?.get('status') !== 'on-hold,processing') wrong.push(`orders asked with status ${query?.get('status')}`);

      await setStock(h, v.id, 9);
      store.pushed.delete(pid);
      await runAutoPushOnce();
      if (store.pushed.get(variation) !== 9) wrong.push(`the variation got ${store.pushed.get(variation)}, expected 9 (its pending order holds no shop stock)`);
      if (store.pushed.has(pid)) wrong.push('a product already brought in line was sent again');

      // the manual push keeps the same orders off
      store.pushed.clear();
      const manual = await h.post('/api/woocommerce/sync-item', { itemId: a.id });
      if (manual.status !== 200 || store.pushed.get(pid) !== 5) wrong.push(`the manual push sent ${store.pushed.get(pid)} (${brief(manual)}), expected 5`);

      // an order that cannot be read stops the push: nothing is sent with a number too high
      store.failPaths.add('orders');
      store.pushed.clear();
      await setStock(h, a.id, 20);
      const failed = await runAutoPushOnce(later(1));
      if (failed.state !== 'failed' || store.pushed.size > 0) wrong.push(`with the orders unreadable the run was ${failed.state} and sent ${JSON.stringify([...store.pushed])}`);
      const manualDown = await h.post('/api/woocommerce/sync-all-stocks', {});
      if (manualDown.status !== 422 || store.pushed.size > 0) wrong.push(`a manual push with the orders unreadable answered ${brief(manualDown)}`);
      return 'open orders kept off';
    } finally {
      await h.q(`DELETE FROM woocommerce_order_logs WHERE wc_order_id = ANY($1)`, [ids.map(String)]);
    }
  }));
}

/** A shop that is down waits longer each time and never stops a product; a product the shop keeps refusing stops; a busy lock skips */
export async function autoPushBoundedFailuresCase(h: Harness, wrong: string[]): Promise<string> {
  const ok = await newItem(h, 'FO', { '': 2 });
  const bad = await newItem(h, 'FB', { '': 3 });
  return withAutoSetting(h, () => withShop(h, [{ id: 1, sku: ok.code, stock: 0 }, { id: 2, sku: bad.code, stock: 0 }], async (store) => {
    const refresh = await h.post('/api/woocommerce/refresh-products', {});
    if (refresh.status !== 200) return `refresh ${brief(refresh)}`;
    await h.q(`INSERT INTO app_settings (key, value) VALUES ($1, '1')`, [AUTO_KEY]);
    const { runAutoPushOnce } = await auto();

    const [{ mark: auditMark }] = await h.q(`SELECT coalesce(max(id), 0) AS mark FROM activity_logs`);
    // the shop refuses every batch request: the run fails, the links keep their failure count, the next run waits
    store.failPaths.add('products/batch');
    const down = await runAutoPushOnce();
    if (down.state !== 'failed') wrong.push(`a refused batch request made the run ${down.state}`);
    const afterDown = await linksOf(h, [ok.id, bad.id]);
    if (afterDown.get(ok.id)?.failures !== 0 || afterDown.get(ok.id)?.error === '') wrong.push(`a request failure counted against the link: ${JSON.stringify(afterDown.get(ok.id))}`);
    const waiting = await runAutoPushOnce();
    if (waiting.state !== 'waiting') wrong.push(`right after a failed run the next was ${waiting.state}, expected waiting`);
    const auditsOf = async () => (await h.q(
      `SELECT id FROM activity_logs WHERE action = 'WC_STOCK_PUSH' AND details->>'trigger' = 'auto' AND (details->>'failed')::boolean AND id > $1`,
      [auditMark],
    )).length;
    const second = await runAutoPushOnce(later(1));
    const stillWaiting = await runAutoPushOnce(new Date(Date.now() + 90_000));
    if (second.state !== 'failed' || stillWaiting.state !== 'waiting') wrong.push(`two failures in a row: ${second.state} then ${stillWaiting.state}, expected failed then waiting (2 minutes)`);
    const catalog = await h.get('/api/woocommerce/catalog');
    const view = (catalog.body as { autoPush?: { failedRuns?: number; nextAttemptAt?: string | null } }).autoPush;
    if (view?.failedRuns !== 2 || !view.nextAttemptAt) wrong.push(`the tab shows ${JSON.stringify(view)}, expected two failed runs and the next attempt`);
    // review (c): the first failure of a streak is audited, not every attempt
    const failureAudits = await auditsOf();
    if (failureAudits !== 1) wrong.push(`two failed runs in a row wrote ${failureAudits} audit row(s), expected 1`);

    // the shop answers again but keeps refusing one product: it stops after the limit, the other one is never held back
    store.failPaths.delete('products/batch');
    store.rowErrors.add(2);
    for (let i = 0; i < WC_AUTO_MAX_LINK_FAILURES; i++) await runAutoPushOnce(later(2 + i));
    if (store.pushed.get(1) !== 2) wrong.push(`the product the shop accepts got ${store.pushed.get(1)}, expected 2`);
    const links = await linksOf(h, [bad.id]);
    if (links.get(bad.id)?.failures !== WC_AUTO_MAX_LINK_FAILURES) wrong.push(`the refused product failed ${links.get(bad.id)?.failures} times, expected ${WC_AUTO_MAX_LINK_FAILURES}`);
    store.requests.length = 0;
    const stopped = await runAutoPushOnce(later(10));
    if (stopped.state !== 'nothing' || store.requests.some(r => r.startsWith('POST'))) wrong.push(`a stopped product was still sent: ${stopped.state} ${store.requests.join(', ')}`);
    const stoppedView = (await h.get('/api/woocommerce/catalog')).body as { autoPush?: { stopped?: Array<{ itemId: number }> } };
    if (!stoppedView.autoPush?.stopped?.some(r => r.itemId === bad.id)) wrong.push('the tab does not list the stopped product');

    // another exchange with the shop holds the lock: the run skips its turn without asking the shop
    await setStock(h, ok.id, 9);
    const { ADVISORY_LOCK_KEYS, withAdvisoryLock } = await import('../../lib/advisoryLock.js');
    store.requests.length = 0;
    const held = await withAdvisoryLock(ADVISORY_LOCK_KEYS.WOOCOMMERCE_SYNC, () => runAutoPushOnce(later(11)));
    if (!held.acquired || held.result.state !== 'busy' || store.requests.length > 0) wrong.push(`with the lock taken the run was ${held.acquired ? held.result.state : 'not tried'}`);
    return 'failures bounded';
  }));
}
