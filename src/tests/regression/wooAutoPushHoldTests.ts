import type { Harness } from '../security/workflowTestHarness.js';
import { brief, newItem, withShop } from './wooCatalogTestKit.js';
import type { MockOrder } from '../fixtures/mockWooCatalogStore.js';

/**
 * 10.2 package 6 (D-04 part B), the second delta review of PR #327: a completed order the program failed to invoice is kept
 * off for 30 days from its completion in the shop, never from the order log's last change; a sale entered by hand is linked
 * by the order's tag in the invoice notes and a manual order sync, without a second invoice; and the open orders are read
 * with overlapping pages, so an order that leaves an earlier page while an older one joins is never skipped. Every case runs
 * against the stand-in shop on 127.0.0.1, never a real one.
 */
const AUTO_KEY = 'wc_auto_push';

async function setStock(h: Harness, itemId: number, quantity: number): Promise<void> {
  await h.q(`UPDATE item_warehouse_stocks SET current_stock = $2 WHERE item_id = $1`, [itemId, quantity]);
}

/** a shop date `days` ago, as WooCommerce writes `date_completed_gmt` (UTC, no zone) */
const shopDaysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 19);

/**
 * Delta review M-A: the 30 days of a failed completed order count from `date_completed_gmt`, else from when its order log was
 * made; touching the log (a failed sync, a webhook, a no-op update) never starts them again. A sale entered by hand with
 * «سفارش ووکامرس #<id>» in its invoice notes is linked by a manual order sync, which issues no second invoice.
 */
export async function autoPushFailedHoldCase(h: Harness, wrong: string[]): Promise<string> {
  const a = await newItem(h, 'FH', { '': 10 });
  const pid = Number(`86${h.tag}`);
  const ids = [1, 2, 3, 4].map(n => Number(`6${h.tag}${n}`));
  const [oldDone, recentDone, noDate, oldNoDate] = ids;
  const completed = (id: number, quantity: number, days: number | null): MockOrder => ({
    id, status: 'completed', lines: [{ productId: pid, quantity }], ...(days === null ? {} : { dateCompletedGmt: shopDaysAgo(days) }),
  });
  const orders = [completed(oldDone, 4, 40), completed(recentDone, 2, 5), completed(noDate, 1, null), completed(oldNoDate, 3, null)];
  return withShop(h, [{ id: pid, sku: a.code, stock: 10 }], async (store) => {
    store.orders.push(...orders);
    const refresh = await h.post('/api/woocommerce/refresh-products', {});
    if (refresh.status !== 200) return `refresh ${brief(refresh)}`;
    const payload = (o: MockOrder) => JSON.stringify({
      id: o.id, status: 'completed', date_completed_gmt: o.dateCompletedGmt ?? null,
      line_items: o.lines.map(l => ({ product_id: l.productId, variation_id: 0, quantity: l.quantity })),
    });
    // [order, days since the log was made, days since its last change]
    const logs: Array<[MockOrder, number, number]> = [[orders[0], 45, 0], [orders[1], 60, 60], [orders[2], 3, 0], [orders[3], 50, 0]];
    for (const [o, made, changed] of logs) {
      await h.q(
        `INSERT INTO woocommerce_order_logs (wc_order_id, erp_document_id, status, payload, error_message, created_at, updated_at)
         VALUES ($1, NULL, 'failed', $2::jsonb, 'خطای آزمایشی', now() - make_interval(days => $3), now() - make_interval(days => $4))`,
        [String(o.id), payload(o), made, changed],
      );
    }
    const handInvoice = { id: 0 };
    try {
      await h.q(`DELETE FROM app_settings WHERE key = $1`, [AUTO_KEY]);
      await setStock(h, a.id, 10);
      const pushed = async (label: string, expected: number) => {
        store.pushed.clear();
        const res = await h.post('/api/woocommerce/sync-item', { itemId: a.id });
        if (res.status !== 200 || store.pushed.get(pid) !== expected) wrong.push(`${label}: the shop got ${store.pushed.get(pid)} (${brief(res)}), expected ${expected}`);
      };
      // 10 less the order completed 5 days ago (2) and the one without a date whose log was made 3 days ago (1); the order
      // completed 40 days ago and the dateless one logged 50 days ago are not kept off, though both logs changed today
      await pushed('first push', 7);

      // a no-op update of the old order's log (its trigger moves updated_at) starts nothing again
      await h.q(`UPDATE woocommerce_order_logs SET error_message = error_message WHERE wc_order_id = $1`, [String(oldDone)]);
      await pushed('after the old log was touched', 7);

      // the sale of the recent order was entered by hand with its tag: a manual order sync links that invoice
      const { createTestDocument } = await import('../fixtures/factories.js');
      const hand = await createTestDocument({ type: 'invoice', status: 'final', notes: `فروش دستی؛ سفارش ووکامرس #${recentDone}` });
      handInvoice.id = hand.document.id;
      const [before] = await h.q(`SELECT count(*)::int AS n FROM documents`);
      const sync = await h.post('/api/woocommerce/sync-order-by-id', { orderId: recentDone });
      const [after] = await h.q(`SELECT count(*)::int AS n FROM documents`);
      const [log] = await h.q(`SELECT status, erp_document_id FROM woocommerce_order_logs WHERE wc_order_id = $1`, [String(recentDone)]);
      if (sync.status !== 200 || Number(log?.erp_document_id) !== hand.document.id || log?.status !== 'processed') {
        wrong.push(`the manual sync of a hand-invoiced order answered ${brief(sync)} with log ${JSON.stringify(log)}, expected a link to invoice ${hand.document.id}`);
      }
      if (Number(after?.n) !== Number(before?.n)) wrong.push(`the manual sync of a hand-invoiced order made ${Number(after?.n) - Number(before?.n)} document(s)`);
      await pushed('after the hand invoice was linked', 9);
      return 'failed completed orders held from their completion';
    } finally {
      await h.q(`DELETE FROM woocommerce_order_logs WHERE wc_order_id = ANY($1)`, [ids.map(String)]);
      if (handInvoice.id) await h.q(`UPDATE documents SET is_deleted = 1 WHERE id = $1`, [handInvoice.id]);
    }
  });
}

const onHold = (id: number, productId: number, quantity = 1): MockOrder => ({ id, status: 'on-hold', lines: [{ productId, quantity }] });

/**
 * Delta review N-A: with more than two pages, an order that leaves a page already read (not the first) while an older one
 * joins keeps the shop's count and the first page, and used to shift the order at the next page edge out of every reading.
 * Each reading now starts on the last order of the one before, so the move shows and the push fails with nothing sent.
 */
export async function autoPushOrderOverlapCase(h: Harness, wrong: string[]): Promise<string> {
  const a = await newItem(h, 'OL', { '': 10 });
  const pid = Number(`85${h.tag}`);
  return withShop(h, [{ id: pid, sku: a.code, stock: 2 }], async (store) => {
    const refresh = await h.post('/api/woocommerce/refresh-products', {});
    if (refresh.status !== 200) return `refresh ${brief(refresh)}`;
    await h.q(`DELETE FROM app_settings WHERE key = $1`, [AUTO_KEY]);
    // 250 open orders, newest first; order 1050 (the 201st) holds 4 of this item, the others another product
    for (let i = 1001; i <= 1250; i++) store.orders.push(onHold(i, i === 1050 ? pid : 999, i === 1050 ? 4 : 1));
    let done = false;
    store.beforeOrdersPage = (reading) => {
      if (reading !== 3 || done) return;
      done = true;
      store.orders.splice(store.orders.findIndex(o => o.id === 1150), 1);
      store.orders.push(onHold(900, 999));
    };
    store.pushed.clear();
    const moved = await h.post('/api/woocommerce/sync-item', { itemId: a.id });
    if (moved.status !== 422 || store.pushed.size > 0 || !/تغییر کرد/.test(JSON.stringify(moved.body))) {
      wrong.push(`a leave from page 2 with an older order joining answered ${brief(moved)} and sent ${JSON.stringify([...store.pushed])}`);
    }
    if (!/«ارسال موجودی» را بزنید/.test(JSON.stringify(moved.body))) wrong.push(`the manual push failure says ${JSON.stringify(moved.body)}, not to press the button again`);

    // a stable list: readings at rows 0, 99 and 198, then the first page again; 10 less the 4 order 1050 holds
    store.beforeOrdersPage = undefined;
    store.requests.length = 0;
    store.queries.length = 0;
    const stable = await h.post('/api/woocommerce/sync-item', { itemId: a.id });
    const reads = store.requests.filter(r => r.startsWith('GET orders'));
    if (stable.status !== 200 || store.pushed.get(pid) !== 6) wrong.push(`with a stable list the push answered ${brief(stable)} and sent ${store.pushed.get(pid)}, expected 6`);
    const expected = ['GET orders?offset=0', 'GET orders?offset=99', 'GET orders?offset=198', 'GET orders?offset=0'];
    if (reads.join(' | ') !== expected.join(' | ')) wrong.push(`the list was read with ${reads.join(', ')}, expected ${expected.join(', ')}`);
    return `${reads.length} overlapping readings`;
  });
}
