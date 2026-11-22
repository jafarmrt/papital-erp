import request from 'supertest';
import { and, eq, inArray, like } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { appSettings, itemPrices, items, mediaAssets, mediaSections, storefrontProducts } from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { readPricingStrategies } from '../../lib/items/pricingStrategies.js';
import { forgetOnSale } from '../../services/storefront/storefrontOnSaleCache.js';

/**
 * v12 phase 10c (the sitemap's `lastmod`; docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2, `AGENTS.md` §1.9c): the feed
 * gives each item the instant its page on the site last changed, on real Express routes and PostgreSQL. It is the
 * latest of three recorded times: the item's row of the site, its images in the library (a removed one too) and its
 * price in the site's price list. Another item's image and a price of another list do not move it. Nothing else is
 * added to the feed, and no card or product page carries the time.
 */
interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;

export async function runStorefrontProductLastmodV12Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_product_lastmod_v12_p10c';
  if (!shouldRun(id, 'v12', 'phase10', 'storefront', 'feed', 'sitemap', 'security')) return results;

  const name = 'v12 phase 10c: the feed gives each item the latest recorded change of its site row, its images and its site price, and nothing else new';
  const tStart = Date.now();
  const itemIds: number[] = [];
  const assetIds: number[] = [];
  let sectionId = 0;
  const savedSettings = await orm.select().from(appSettings).where(like(appSettings.key, 'sf\\_%'));
  const savedStrategies = await orm.select().from(appSettings).where(eq(appSettings.key, 'pricing_strategies'));
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestItem } = await import('../fixtures/factories.js');
    const app = await getTestApp();
    const admin: Session = await getAdminSession();
    const erp = {
      get: (url: string) => request(app).get(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken),
      put: (url: string, body: Body) => request(app).put(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body),
      post: (url: string, body: Body = {}) => request(app).post(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body),
    };
    const tag = String(Date.now()).slice(-7);
    const wrong: string[] = [];
    const keys = (value: unknown) => Object.keys((value ?? {}) as Body).sort().join(',');

    const retailList = `تکی تاریخ ${tag}`;
    const otherList = `همکار تاریخ ${tag}`;
    const current = readPricingStrategies(savedStrategies[0]?.value);
    const strategies = 'titles' in current ? current.titles : [];
    await orm.insert(appSettings).values({ key: 'pricing_strategies', value: JSON.stringify([...strategies, retailList, otherList]) })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify([...strategies, retailList, otherList]) } });
    invalidateSettingsCache();
    const base = (await erp.get('/api/storefront/settings')).body.data;
    const on = await erp.put('/api/storefront/settings', {
      cardNumber: '', cardHolder: '', bankName: '', iban: '', freeShippingThreshold: '', reservationHours: 24, retailPriceList: retailList,
      wholesalePriceList: '', lowStockThreshold: 3, stockDisplay: 'status', warehouseCode: '', whatsappNumber: '', whatsappEnabled: false,
      enabled: true, ordersEnabled: false, treasuryAccountId: 0, openOrdersPerPhone: 3, version: base.version,
    });
    if (on.status !== 200) throw new Error(`turning the site on: ${on.status} ${JSON.stringify(on.body)}`);
    const apiKey = String((await erp.post('/api/storefront/api-key')).body.data?.apiKey ?? '');
    const site = (url: string) => request(app).get(`/api/storefront/v1${url}`).set('Authorization', `Bearer ${apiKey}`);

    const ring = await createTestItem({ name: `انگشتر تاریخ ${tag}`, code: `LM-1-${tag}` });
    const other = await createTestItem({ name: `گوشواره تاریخ ${tag}`, code: `LM-2-${tag}` });
    itemIds.push(ring.id, other.id);
    // every recorded time is set by hand, so each source is seen alone. A price row's `updated_at` is written by a
    // trigger on every UPDATE, so a price's times are given when its row is inserted.
    const day = (n: number) => `2026-0${n}-15T10:00:00.000Z`;
    const priceRow = async (itemId: number, title: string, amount: string, at: string) => (
      await orm.insert(itemPrices).values({ itemId, title, price: money(amount), currency: 'IRR', createdAt: at, updatedAt: at }).returning({ id: itemPrices.id })
    )[0].id;
    const ringPrice = await priceRow(ring.id, retailList, '3100000', day(1));
    await priceRow(ring.id, otherList, '2000000', day(1));
    await priceRow(other.id, retailList, '1500000', day(1));
    const [section] = await orm.insert(mediaSections).values({ kind: 'custom', title: `عکس‌های تاریخ ${tag}` }).returning({ id: mediaSections.id });
    sectionId = section.id;
    const image = async (n: number, itemId: number) => {
      const [asset] = await orm.insert(mediaAssets).values({
        sectionId, itemId, kind: 'image', title: `عکس تاریخ ${n} ${tag}`, originalName: `lastmod-${n}.jpg`, mimeType: 'image/jpeg', sizeBytes: 1000,
        sha256: `${String(n).repeat(8)}${tag}`.padEnd(64, 'e').slice(0, 64), width: 1200, height: 1200, lightBytes: 12, thumbBytes: 12,
      }).returning({ id: mediaAssets.id });
      assetIds.push(asset.id);
      return asset.id;
    };
    const [ringImage, ringRemoved, otherImage] = [await image(1, ring.id), await image(2, ring.id), await image(3, other.id)];
    const slugs = [`lastmod-ring-${tag}`, `lastmod-other-${tag}`];
    for (const [index, item] of [ring, other].entries()) {
      const pub = await erp.put(`/api/storefront/products/${item.id}`, { published: true, slug: slugs[index], seoTitle: '', seoDescription: '', sortOrder: index + 1, version: 0 });
      if (pub.status !== 200) throw new Error(`putting an item on the site: ${pub.status} ${JSON.stringify(pub.body)}`);
    }

    const stamp = {
      row: (at: string, itemId = ring.id) => orm.update(storefrontProducts).set({ updatedAt: at }).where(eq(storefrontProducts.itemId, itemId)),
      image: (assetId: number, at: string) => orm.update(mediaAssets).set({ updatedAt: at }).where(eq(mediaAssets.id, assetId)),
    };
    const fed = async () => {
      forgetOnSale();
      const feed = await site('/feed');
      if (feed.status !== 200) throw new Error(`the feed: ${feed.status} ${JSON.stringify(feed.body).slice(0, 200)}`);
      const mine = (feed.body.data as Body[]).filter(item => slugs.includes(String(item.slug)));
      return { ring: mine.find(item => item.slug === slugs[0]), other: mine.find(item => item.slug === slugs[1]) };
    };
    const expectDay = async (what: string, want: string) => {
      const got = (await fed()).ring?.updatedAt;
      if (got !== want) wrong.push(`${what}: «${String(got)}», not «${want}»`);
    };

    await stamp.row(day(1));
    await stamp.row(day(1), other.id);
    for (const assetId of [ringImage, ringRemoved, otherImage]) await stamp.image(assetId, day(1));

    // 1) the fields: the reviewed ones and the time, an instant in UTC
    const first = await fed();
    if (keys(first.ring) !== 'category,collections,color,description,images,inStock,material,name,retailPrice,sku,slug,updatedAt') wrong.push(`the feed's fields: ${keys(first.ring)}`);
    if (first.ring?.updatedAt !== day(1)) wrong.push(`the time with every source at one day: «${String(first.ring?.updatedAt)}»`);

    // 2) each source moves it, and the latest one wins
    await stamp.row(day(2));
    await expectDay('after the row of the site changed', day(2));
    await stamp.image(ringImage, day(3));
    await expectDay('after an image changed', day(3));
    // a new price of the site's list: the earlier row is retired and a new one written
    await orm.update(itemPrices).set({ isDeleted: 1 }).where(eq(itemPrices.id, ringPrice));
    const newPrice = await priceRow(ring.id, retailList, '3300000', day(4));
    await expectDay('after a new price of the site list', day(4));
    // an image removed from the library is a change of the page too
    await orm.update(mediaAssets).set({ isDeleted: 1, updatedAt: day(6) }).where(eq(mediaAssets.id, ringRemoved));
    await expectDay('after an image was removed', day(6));
    // an older time never moves it back
    await stamp.row(day(3));
    await expectDay('after an older change of the row', day(6));

    // an edit of the price row itself is timed by the database (its trigger), so the time is this moment
    await orm.update(itemPrices).set({ price: money('3400000') }).where(eq(itemPrices.id, newPrice));
    const edited = String((await fed()).ring?.updatedAt);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(edited) || Math.abs(Date.parse(edited) - Date.now()) > 120_000) wrong.push(`after the price row was edited: «${edited}»`);

    // 3) what does not move it: another item's image, a price of another list (a new row, written now), the item card itself
    await stamp.image(otherImage, day(8));
    await new Promise(resolve => setTimeout(resolve, 20));
    await priceRow(ring.id, `${otherList} ۲`, '2100000', new Date().toISOString());
    await orm.update(items).set({ productDescription: `متن تازه ${tag}` }).where(eq(items.id, ring.id));
    const after = await fed();
    if (after.ring?.updatedAt !== edited) wrong.push(`moved by something of another item or list: «${String(after.ring?.updatedAt)}», not «${edited}»`);
    if (after.other?.updatedAt !== day(8)) wrong.push(`the other item's own time: «${String(after.other?.updatedAt)}»`);

    // 4) the time is the feed's alone: a card and a product page are as they were
    const [list, one] = [await site(`/products?q=${encodeURIComponent(`LM-1-${tag}`)}`), await site(`/products/${slugs[0]}`)];
    const card = ((list.body.data ?? []) as Body[]).find(c => c.slug === slugs[0]);
    if (list.status !== 200 || keys(card) !== 'category,collections,cover,name,retailPrice,sku,slug,stock') wrong.push(`a card's fields: ${list.status} ${keys(card)}`);
    if (one.status !== 200 || keys(one.body.data).includes('updatedAt') || JSON.stringify(one.body).includes(edited)) wrong.push(`a product page's fields: ${one.status} ${keys(one.body.data)}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'a feed item had the reviewed fields and `updatedAt`, an instant in UTC; a later change of the item\'s row of the site, of an image, a new price in the site list, the removal of an image and an edit of the price row each moved it, and an older change never moved it back; another item\'s image, a price of another list and an edit of the item card did not; a card and a product page had no time',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (itemIds.length > 0) {
      await orm.delete(storefrontProducts).where(inArray(storefrontProducts.itemId, itemIds)).catch(() => undefined);
      await orm.update(itemPrices).set({ isDeleted: 1 }).where(inArray(itemPrices.itemId, itemIds)).catch(() => undefined);
      await orm.update(items).set({ isDeleted: 1 }).where(inArray(items.id, itemIds)).catch(() => undefined);
    }
    if (assetIds.length > 0) await orm.delete(mediaAssets).where(and(inArray(mediaAssets.id, assetIds))).catch(() => undefined);
    if (sectionId) await orm.delete(mediaSections).where(eq(mediaSections.id, sectionId)).catch(() => undefined);
    await orm.delete(appSettings).where(like(appSettings.key, 'sf\\_%')).catch(() => undefined);
    if (savedSettings.length > 0) await orm.insert(appSettings).values(savedSettings).catch(() => undefined);
    if (savedStrategies.length > 0) {
      await orm.update(appSettings).set({ value: savedStrategies[0].value }).where(eq(appSettings.key, 'pricing_strategies')).catch(() => undefined);
    } else {
      await orm.delete(appSettings).where(eq(appSettings.key, 'pricing_strategies')).catch(() => undefined);
    }
    invalidateSettingsCache();
    forgetOnSale();
  }
  return results;
}
