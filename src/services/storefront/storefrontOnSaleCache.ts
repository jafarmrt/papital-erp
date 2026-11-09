/**
 * v12 phase 7 (site review 1.4): the list of items on the site, kept a few seconds for the site's public reads (the
 * catalog, its search, the facets, campaign cards and «کارهای هم‌طرح»). Every search used to read every published item
 * and its price from the database, so a script sending fresh searches loaded the database the colleagues work on.
 *
 * - Only the public reads use it. An order, a cart quote, a buyer group's prices, the feed and a product's own page read
 *   the database as before, so a price or a publish is never decided from a kept list.
 * - The list is kept per retail price list (the setting it depends on); many reads at once make one database read.
 * - Publishing, unpublishing and saving the site settings forget it at once; anything else (a price changed in the ERP,
 *   an item deleted) shows on the site within `ON_SALE_KEEP_MS`.
 * - One server process (`AGENTS.md` §9.1), so a module-level value is the whole cache. Under `NODE_ENV=test` nothing is
 *   kept unless a test asks for it (`keepOnSaleFor`), so the suites that change a price directly read it at once; the
 *   cache itself is tested in `storefrontOnSaleCache.test.ts`.
 */
export const ON_SALE_KEEP_MS = 5_000;

let keepMs = process.env.NODE_ENV === 'test' ? 0 : ON_SALE_KEEP_MS;
interface Kept<T> { at: number; key: string; list: readonly T[] }
let kept: Kept<unknown> | null = null;
let pending: { key: string; promise: Promise<readonly unknown[]> } | null = null;
/** bumped by `forgetOnSale`, so a read that started before it never stores its older list */
let generation = 0;

/** The kept list for `key` (the retail price list), or the one `read` gives now (kept for the next reads) */
export async function keptOnSale<T>(key: string, read: () => Promise<T[]>): Promise<readonly T[]> {
  if (keepMs <= 0) return read();
  if (kept && kept.key === key && Date.now() - kept.at < keepMs) return kept.list as readonly T[];
  if (pending && pending.key === key) return pending.promise as Promise<readonly T[]>;
  const started = generation;
  const promise: Promise<readonly T[]> = read().then((list) => {
    const frozen = Object.freeze([...list]);
    if (started === generation) kept = { at: Date.now(), key, list: frozen };
    return frozen;
  }).finally(() => {
    if (pending?.promise === promise) pending = null;
  });
  pending = { key, promise };
  return promise;
}

/** After a publish, an unpublish or a settings save: the next public read reads the database */
export function forgetOnSale(): void {
  generation += 1;
  kept = null;
  pending = null;
}

/** For tests: keep the list this long (0 = never), starting empty */
export function keepOnSaleFor(ms: number): void {
  keepMs = ms;
  forgetOnSale();
}
