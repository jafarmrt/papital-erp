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
  const ids = [1, 2, 3, 4, 5].map(n => Number(`6${h.tag}${n}`));
  const [oldDone, recentDone, noDate, oldNoDate, futureOld] = ids;
  const completed = (id: number, quantity: number, days: number | null): MockOrder => ({
    id, status: 'completed', lines: [{ productId: pid, quantity }], ...(days === null ? {} : { dateCompletedGmt: shopDaysAgo(days) }),
  });
  const orders = [
    completed(oldDone, 4, 40), completed(recentDone, 2, 5), completed(noDate, 1, null), completed(oldNoDate, 3, null),
    // delta review 4, item C: a completion dated 10 days ahead (a wrong shop clock) on an order logged 45 days ago
    completed(futureOld, 5, -10),
  ];
  return withShop(h, [{ id: pid, sku: a.code, stock: 10 }], async (store) => {
    store.orders.push(...orders);
    const refresh = await h.post('/api/woocommerce/refresh-products', {});
    if (refresh.status !== 200) return `refresh ${brief(refresh)}`;
    const payload = (o: MockOrder) => JSON.stringify({
      id: o.id, status: 'completed', date_completed_gmt: o.dateCompletedGmt ?? null,
      line_items: o.lines.map(l => ({ product_id: l.productId, variation_id: 0, quantity: l.quantity })),
    });
    // [order, days since the log was made, days since its last change]; the recent order's log was made when it was put on
    // hold 60 days ago and failed when it completed 5 days ago (a log says completed only after the failure was written)
    const logs: Array<[MockOrder, number, number]> = [
      [orders[0], 45, 0], [orders[1], 60, 5], [orders[2], 3, 0], [orders[3], 50, 0], [orders[4], 45, 0],
    ];
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
      // completed 40 days ago and the dateless one logged 50 days ago are not kept off, though both logs changed today; nor is
      // the order whose completion is dated in the future, since its log was made 45 days ago (delta review 4, item C)
      await pushed('first push', 7);

      // a completion dated in the future (a wrong shop clock) is treated as missing: the hold counts from the log's creation
      const { failedOrderHeldSince } = await import('../../services/woocommerce/wcOpenOrders.js');
      const madeAt = Date.parse('2026-10-01T08:00:00Z');
      const at = failedOrderHeldSince({ date_completed_gmt: '2099-01-01T00:00:00' }, '2026-10-01 08:00:00', madeAt + 1_000);
      if (at !== madeAt) wrong.push(`a completion in 2099 starts the hold at ${at}, expected the log's creation ${madeAt}`);

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

const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC = '٠١٢٣٤٥٦٧٨٩';
const digitsIn = (n: number, set: string) => String(n).replace(/\d/g, d => set[Number(d)]);

/**
 * Delta review 3, M-1: the tag of a hand invoice is read as typed. Persian and Arabic-Indic digits link the order; a number
 * that only starts with the order's (a Persian digit typed after it, or a longer Latin number) never links it.
 */
export async function autoPushHandTagDigitsCase(h: Harness, wrong: string[]): Promise<string> {
  const base = Number(`5${h.tag}`) * 10;
  const [persian, arabic, prefix] = [base + 1, base + 2, base + 3];
  // delta review 4, item A: a no-break space, a zero-width non-joiner and the direction marks a keyboard or a copy may add
  const [nbsp, zwnj, lrm, rlm, alm, split] = [base + 4, base + 5, base + 6, base + 7, base + 8, base + 9];
  const marked = [nbsp, zwnj, lrm, rlm, alm];
  // lines of a product no item is linked to: an order that finds no invoice fails, it never makes one
  const completed = (id: number): MockOrder => ({ id, status: 'completed', lines: [{ productId: 999, quantity: 1 }] });
  return withShop(h, [], async (store) => {
    store.orders.push(...[persian, arabic, prefix, ...marked, split].map(completed));
    const { createTestDocument } = await import('../fixtures/factories.js');
    const notes = [
      `فروش دستی؛ سفارش ووکامرس #${digitsIn(persian, PERSIAN)}`,
      `فروش دستی؛ سفارش ووكامرس # ${digitsIn(arabic, ARABIC)}`,
      `فروش دستی؛ سفارش ووکامرس #${prefix}${PERSIAN[4]}`,
      `فروش دستی؛ سفارش ووکامرس #${prefix}7`,
      `فروش دستی؛ سفارش\u00a0ووکامرس\u00a0#\u00a0${nbsp}`,
      `فروش دستی؛ سفارش\u200cووکامرس #${zwnj}`,
      `فروش دستی؛ سفارش ووکامرس #\u200e${lrm}`,
      `فروش دستی؛ سفارش ووکامرس\u200f #${rlm}`,
      `فروش دستی؛ سفارش ووکامرس #\u061c${alm}`,
      // an RLM inside the number is dropped, so «#<order>‏5» is a longer number and never links the order
      `فروش دستی؛ سفارش ووکامرس #${split}\u200f5`,
    ];
    const docs: number[] = [];
    try {
      for (const note of notes) docs.push((await createTestDocument({ type: 'invoice', status: 'final', notes: note })).document.id);
      const linkOf = async (orderId: number) => {
        const sync = await h.post('/api/woocommerce/sync-order-by-id', { orderId });
        const [log] = await h.q(`SELECT status, erp_document_id FROM woocommerce_order_logs WHERE wc_order_id = $1`, [String(orderId)]);
        return { sync, docId: log?.erp_document_id === null || log?.erp_document_id === undefined ? null : Number(log.erp_document_id) };
      };
      const p = await linkOf(persian);
      if (p.docId !== docs[0]) wrong.push(`a tag in Persian digits linked ${p.docId} (${brief(p.sync)}), expected invoice ${docs[0]}`);
      const a = await linkOf(arabic);
      if (a.docId !== docs[1]) wrong.push(`a tag in Arabic-Indic digits with the Arabic kaf linked ${a.docId} (${brief(a.sync)}), expected invoice ${docs[1]}`);
      const x = await linkOf(prefix);
      if (x.docId !== null) wrong.push(`a longer number (a Persian digit or a Latin digit typed after the order's) linked invoice ${x.docId}`);
      const markNames = ['a no-break space', 'a zero-width non-joiner', 'an LRM', 'an RLM', 'an ALM'];
      for (const [i, orderId] of marked.entries()) {
        const m = await linkOf(orderId);
        if (m.docId !== docs[4 + i]) wrong.push(`a tag with ${markNames[i]} linked ${m.docId} (${brief(m.sync)}), expected invoice ${docs[4 + i]}`);
      }
      const r = await linkOf(split);
      if (r.docId !== null) wrong.push(`a tag with an RLM inside the number linked invoice ${r.docId}`);
      return 'hand invoice tags read as typed';
    } finally {
      await h.q(`DELETE FROM woocommerce_order_logs WHERE wc_order_id = ANY($1)`, [[persian, arabic, prefix, ...marked, split].map(String)]);
      if (docs.length) await h.q(`UPDATE documents SET is_deleted = 1 WHERE id = ANY($1)`, [docs]);
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
    // each failing push: an order of the second reading leaves and an older one joins before the third reading
    const moves: Array<[number, number]> = [[1150, 900], [1140, 899]];
    let done = false;
    store.beforeOrdersPage = (reading) => {
      if (reading !== 3 || done) return;
      done = true;
      const [leaves, joins] = moves.shift() ?? [0, 0];
      store.orders.splice(store.orders.findIndex(o => o.id === leaves), 1);
      store.orders.push(onHold(joins, 999));
    };
    store.pushed.clear();
    const moved = await h.post('/api/woocommerce/sync-item', { itemId: a.id });
    if (moved.status !== 422 || store.pushed.size > 0 || !/تغییر کرد/.test(JSON.stringify(moved.body))) {
      wrong.push(`a leave from page 2 with an older order joining answered ${brief(moved)} and sent ${JSON.stringify([...store.pushed])}`);
    }
    // delta review 4, item D: the failure names only the button that was pressed
    const movedText = JSON.stringify(moved.body);
    if (!/«همگام‌سازی ووکامرس» همان کالا/.test(movedText) || /همگام‌سازی موجودی کل کالاها/.test(movedText)) {
      wrong.push(`the failure of one item's push says ${movedText}, expected only the item's button`);
    }
    done = false;
    const movedAll = await h.post('/api/woocommerce/sync-all-stocks', {});
    const allText = JSON.stringify(movedAll.body);
    if (movedAll.status !== 422 || !/«همگام‌سازی موجودی کل کالاها با سایت»/.test(allText) || /همان کالا/.test(allText)) {
      wrong.push(`the failure of the push of all items answered ${brief(movedAll)}, expected only the bulk button`);
    }

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

/**
 * Delta review 4, item E: an open order the shop lists without its id cannot be counted, so the reading is unreadable and
 * nothing is sent. Without the shop's count it used to be left out silently and the shop got the stock that order holds.
 */
export async function autoPushOrderWithoutIdCase(h: Harness, wrong: string[]): Promise<string> {
  const a = await newItem(h, 'OI', { '': 10 });
  const pid = Number(`87${h.tag}`);
  return withShop(h, [{ id: pid, sku: a.code, stock: 2 }], async (store) => {
    const refresh = await h.post('/api/woocommerce/refresh-products', {});
    if (refresh.status !== 200) return `refresh ${brief(refresh)}`;
    await h.q(`DELETE FROM app_settings WHERE key = $1`, [AUTO_KEY]);
    store.orders.push(onHold(7001, pid, 3), onHold(7002, 999));
    store.ordersWithoutId = new Set([7001]);
    for (const omitTotal of [true, false]) {
      store.omitTotalHeader = omitTotal;
      store.pushed.clear();
      const res = await h.post('/api/woocommerce/sync-item', { itemId: a.id });
      if (res.status !== 422 || store.pushed.size > 0 || !/خوانده نشد/.test(JSON.stringify(res.body))) {
        wrong.push(`an open order without its id (${omitTotal ? 'no' : 'with the'} shop count) answered ${brief(res)} and sent ${JSON.stringify([...store.pushed])}`);
      }
    }
    // with its id the order is counted: 10 less the 3 it holds
    store.ordersWithoutId = undefined;
    store.omitTotalHeader = undefined;
    store.pushed.clear();
    const ok = await h.post('/api/woocommerce/sync-item', { itemId: a.id });
    if (ok.status !== 200 || store.pushed.get(pid) !== 7) wrong.push(`with every id the push answered ${brief(ok)} and sent ${store.pushed.get(pid)}, expected 7`);
    return 'an order without its id stops the push';
  });
}
