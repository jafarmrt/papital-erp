import type { Harness } from '../security/workflowTestHarness.js';
import { mockWooCatalogStore, type MockProduct, type MockWooCatalogStore } from '../fixtures/mockWooCatalogStore.js';

/** 10.2 package 6 (D-04): what the WooCommerce catalog cases share (a stand-in shop, a fresh item, the live links) */
const CONNECTION_KEYS = ['wc_store_url', 'wc_consumer_key', 'wc_consumer_secret', 'wc_shop_warehouse'];

/** Points the settings at a stand-in shop with no links or runs left from another case, and puts everything back after */
export async function withShop<T>(h: Harness, products: MockProduct[], fn: (store: MockWooCatalogStore) => Promise<T>): Promise<T> {
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

export const brief = (res: { status: number; body: unknown }) => `${res.status} ${JSON.stringify(res.body).slice(0, 200)}`;

export async function newItem(h: Harness, label: string, stocks?: Record<string, number>): Promise<{ id: number; code: string }> {
  const { createTestItem } = await import('../fixtures/factories.js');
  const code = `WC${label}_${h.tag}_${Math.floor(Math.random() * 1e6)}`;
  const item = await createTestItem({ code, ...(stocks ? { stocks } : {}) });
  return { id: item.id, code };
}

export async function linksOf(h: Harness, itemIds: number[]): Promise<Map<number, { product: number; variation: number; stock: number | null; error: string; failures: number }>> {
  const rows = await h.q(
    `SELECT item_id, wc_product_id, wc_variation_id, site_stock, last_error, failure_count FROM wc_product_links WHERE is_deleted = 0 AND item_id = ANY($1)`,
    [itemIds],
  );
  return new Map(rows.map(r => [Number(r.item_id), {
    product: Number(r.wc_product_id), variation: Number(r.wc_variation_id), stock: r.site_stock === null ? null : Number(r.site_stock),
    error: String(r.last_error ?? ''), failures: Number(r.failure_count),
  }]));
}
