import { and, eq, inArray } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { appSettings, items } from '../../db/schema.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { chunked } from '../../lib/woocommerce/wcCatalog.js';
import { WC_AUTO_MAX_LINK_FAILURES } from '../../lib/woocommerce/wcAutoPush.js';
import {
  collectionsKey, isMediaSendOn, WC_COLLECTION_MAX_PRODUCTS, WC_COLLECTION_PUSH_SETTING_KEY,
} from '../../lib/woocommerce/wcMediaPush.js';
import { ValidationError } from '../../errors/customErrors.js';
import { requireWcConnection, wcListRequest, wcRequest, WC_SHOP_REQUEST_FAILED, type WcConnection } from './wcClient.js';
import { liveLinks, type WcActor } from './wcCatalog.service.js';
import {
  outcomeOf, runField, sendAndRecord, writeSetting, type FieldRunOptions, type FieldRunOutcome, type Planned,
} from './wcFieldPush.service.js';
import { updateLinkRows } from './wcLinkUpdates.js';

/**
 * v11 phase 6.5 (D-04 part D, decision ت۴۴): «ارسال کالکشن‌ها». An item's collections (`items.collections`) go to its
 * simple or parent product as product tags, never to a variation. Each link keeps the tag ids the program added
 * (`sent_tag_ids`) and the collections it sent them for (`sent_collections`, `collectionsKey`; null until compared): a send
 * reads the product's tags again first and writes them back with the program's own tags brought in line, so a tag the shop
 * had before, or added by hand, is never removed. A name the shop has no tag for gets a new tag. An item without
 * collections whose product never got a tag from the program is only recorded.
 */
type Link = Awaited<ReturnType<typeof liveLinks>>[number];

/** tag pages read at most (2,000 tags); a name not found among them is searched on its own */
const WC_TAG_MAX_PAGES = 20;

export async function isCollectionPushEnabled(): Promise<boolean> {
  const [row] = await orm.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, WC_COLLECTION_PUSH_SETTING_KEY));
  return isMediaSendOn(row?.value);
}

/** The ids a link's `sent_tag_ids` holds */
export function sentTagIds(value: unknown): number[] {
  return (Array.isArray(value) ? value : []).map(Number).filter(id => Number.isInteger(id) && id > 0);
}

/**
 * The product's tags after the send and the tags the program then holds: the program's tags no longer wanted leave, the
 * wanted ones join; a wanted tag the product already had before the program added it is not the program's
 */
export function nextTags(current: number[], previous: number[], wanted: number[]): { tags: number[]; added: number[] } {
  const want = new Set(wanted);
  const had = new Set(current);
  const mine = new Set(previous);
  const tags = [...new Set([...current.filter(id => !mine.has(id) || want.has(id)), ...wanted])];
  const added = wanted.filter(id => mine.has(id) || !had.has(id));
  return { tags, added: [...new Set(added)] };
}

/** The simple and parent links whose item's collections differ from what was sent, with the item's collection names */
export async function collectionSteps(): Promise<Array<{ link: Link; names: string[]; key: string }>> {
  const links = (await liveLinks()).filter(l => l.wcVariationId === 0 && l.collectionFailureCount < WC_AUTO_MAX_LINK_FAILURES);
  const names = new Map<number, string[]>();
  for (const part of chunked([...new Set(links.map(l => l.itemId))], 5000)) {
    const rows = await orm.select({ id: items.id, collections: items.collections }).from(items)
      .where(and(inArray(items.id, part), eq(items.isDeleted, 0)));
    for (const r of rows) names.set(r.id, Array.isArray(r.collections) ? r.collections : []);
  }
  return links.flatMap((link) => {
    const list = names.get(link.itemId) ?? [];
    const key = collectionsKey(list);
    return link.sentCollections === key ? [] : [{ link, names: list, key }];
  });
}

/** WordPress sends a term name with its HTML entities; compared without them and without letter case */
export function tagNameKey(name: unknown): string {
  return String(name ?? '').replace(/&amp;/g, '&').replace(/&#0?39;|&#8217;/g, '\'').replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim().toLowerCase();
}

interface ShopTag { id?: unknown; name?: unknown }

/** The shop's tag id for each name, making the tags it does not have; a name WordPress cleans to nothing is left out */
async function tagIdsFor(conn: WcConnection, names: string[], signal: AbortSignal): Promise<Map<string, number>> {
  const byName = new Map<string, number>();
  const refused = new Set<string>();
  const keep = (rows: ShopTag[]) => rows.forEach((t) => {
    const id = Number(t.id);
    if (Number.isInteger(id) && id > 0 && !byName.has(tagNameKey(t.name))) byName.set(tagNameKey(t.name), id);
  });
  let complete = false;
  for (let page = 1; page <= WC_TAG_MAX_PAGES && !complete; page++) {
    const answer = await wcListRequest(conn, 'products/tags', { per_page: 100, page, orderby: 'id', order: 'asc', hide_empty: false, _fields: 'id,name' }, { signal });
    const rows = Array.isArray(answer.data) ? answer.data as ShopTag[] : [];
    keep(rows);
    complete = rows.length < 100;
  }
  const wanted = [...new Map(names.map(n => [tagNameKey(n), n])).entries()];
  for (const [, name] of wanted.filter(([k]) => !byName.has(k) && !complete)) {
    const found = await wcRequest(conn, 'GET', 'products/tags', null, { search: name, per_page: 100, hide_empty: false, _fields: 'id,name' }, { signal });
    keep(Array.isArray(found) ? found as ShopTag[] : []);
  }
  const missing = wanted.filter(([k]) => !byName.has(k)).map(([, n]) => n);
  for (const part of chunked(missing, 100)) {
    const answer = await wcRequest(conn, 'POST', 'products/tags/batch', { create: part.map(name => ({ name })) }, {}, { signal });
    const rows = (answer as { create?: unknown } | null)?.create;
    (Array.isArray(rows) ? rows as Array<ShopTag & { error?: { code?: unknown; data?: { resource_id?: unknown } } }> : []).forEach((row, i) => {
      // a tag made meanwhile (or differing only in letters WordPress folds) answers `term_exists` with its id
      const id = Number(row.error ? row.error.data?.resource_id : row.id);
      if (Number.isInteger(id) && id > 0 && part[i] !== undefined) byName.set(tagNameKey(part[i]), id);
      else if (part[i] !== undefined && row.error?.code === 'empty_term_name') refused.add(tagNameKey(part[i]));
    });
  }
  // delta review N-2: only a name WordPress cleans to nothing refuses its products; any other failure fails the run
  const unknown = wanted.filter(([k]) => !byName.has(k) && !refused.has(k));
  if (unknown.length > 0) {
    throw new ValidationError(`سایت برچسب «${unknown[0][1]}» را نساخت و برچسبی فرستاده نشد.`, undefined, WC_SHOP_REQUEST_FAILED);
  }
  return byName;
}

/** The tag ids each of these shop products holds now */
async function currentTags(conn: WcConnection, productIds: number[], signal: AbortSignal): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>();
  for (const part of chunked(productIds, 100)) {
    const answer = await wcRequest(conn, 'GET', 'products', null, {
      include: part.join(','), per_page: part.length, status: 'any', _fields: 'id,tags',
    }, { signal });
    for (const row of Array.isArray(answer) ? answer as Array<{ id?: unknown; tags?: unknown }> : []) {
      out.set(Number(row.id), sentTagIds((Array.isArray(row.tags) ? row.tags as ShopTag[] : []).map(t => t.id)));
    }
  }
  return out;
}

const GONE = 'محصول در سایت پیدا نشد؛ «بازخوانی محصولات سایت» را بزنید.';

/** One automatic collection run */
export function runCollectionPushOnce(now: Date = new Date(), options: FieldRunOptions = {}): Promise<FieldRunOutcome> {
  return runField('collection_push', isCollectionPushEnabled, now, async (signal) => {
    const steps = await collectionSteps();
    // an item without collections whose product holds none of the program's tags is only recorded
    const quiet = steps.filter(s => s.key === '' && sentTagIds(s.link.sentTagIds).length === 0);
    if (quiet.length > 0) {
      await orm.transaction(tx => updateLinkRows(tx, quiet.map(s => ({ id: s.link.id, values: { sentCollections: '' } })), systemNowUtcIso()));
    }
    const due = steps.filter(s => !quiet.includes(s)).slice(0, options.maxProducts ?? WC_COLLECTION_MAX_PRODUCTS);
    if (due.length === 0) return { state: 'nothing' };
    const conn = await requireWcConnection();
    const ids = await tagIdsFor(conn, due.flatMap(d => d.names), signal);
    const current = await currentTags(conn, due.map(d => d.link.wcProductId), signal);
    const plan: Planned[] = [];
    const gone: Array<{ link: Link; error: string }> = [];
    const claims: Array<{ id: number; values: Planned['values'] }> = [];
    for (const { link, names, key } of due) {
      const tags = current.get(link.wcProductId);
      if (!tags) {
        gone.push({ link, error: GONE });
        continue;
      }
      // PR #421 review: a name WordPress cleans to nothing refuses only this product
      const refusedName = names.find(n => !ids.has(tagNameKey(n)));
      if (refusedName !== undefined) {
        gone.push({ link, error: `سایت برچسب «${refusedName.slice(0, 100)}» را نساخت؛ نام کالکشن را اصلاح کنید.` });
        continue;
      }
      const wanted = [...new Set(names.map(n => ids.get(tagNameKey(n))).filter((id): id is number => id !== undefined))];
      const next = nextTags(tags, sentTagIds(link.sentTagIds), wanted);
      const claimed = [...new Set([...sentTagIds(link.sentTagIds), ...wanted.filter(id => !tags.includes(id))])];
      // with the collections compared again (null), so the link stays due until a send brings it in line
      if (claimed.length > sentTagIds(link.sentTagIds).length) claims.push({ id: link.id, values: { sentTagIds: JSON.stringify(claimed), sentCollections: null } });
      plan.push({
        link, fields: { tags: next.tags.map(id => ({ id })) },
        values: { sentTagIds: JSON.stringify(next.added), sentCollections: key, collectionError: '', collectionFailureCount: 0 },
      });
    }
    // PR #421 review: the tags about to be added are the program's before the send, so a send whose answer never came back
    // (the shop added them anyway) cannot leave them looking like the shop's own; these ids were not on the product
    if (claims.length > 0) await orm.transaction(tx => updateLinkRows(tx, claims, systemNowUtcIso()));
    // a row the shop refused was surely not applied, so the program's tags go back to what they were before the claim
    return outcomeOf(await sendAndRecord('collection_push', plan, steps.length, {}, signal, {
      refused: gone, onRefused: link => ({ sentTagIds: JSON.stringify(sentTagIds(link.sentTagIds)) }),
    }));
  });
}

/** «ارسال کالکشن‌ها» (`POST /woocommerce/collection-push` with the target state) */
export async function setCollectionPush(actor: WcActor, enabled: boolean): Promise<{ enabled: boolean; changed: boolean }> {
  const changed = await writeSetting(actor, WC_COLLECTION_PUSH_SETTING_KEY, enabled ? '1' : '0', before => ({
    text: enabled ? 'ارسال کالکشن‌ها به برچسب‌های سایت روشن شد' : 'ارسال کالکشن‌ها به برچسب‌های سایت خاموش شد',
    before: { enabled: isMediaSendOn(before) }, after: { enabled },
  }));
  return { enabled, changed };
}
