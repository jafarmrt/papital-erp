import request from 'supertest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { eq, inArray, like } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import {
  activityLogs, appSettings, itemPrices, items, mediaAssets, mediaSections, storefrontCampaigns, storefrontDiscountCodes, storefrontProducts,
} from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { readPricingStrategies } from '../../lib/items/pricingStrategies.js';
import { mediaFilePath } from '../../lib/media/mediaPaths.js';
import { tehranDayOf } from '../../lib/storefront/storefrontCampaignRules.js';

/**
 * v11 phase 8.5b (docs/roadmap/V11_STOREFRONT_8_5_START_PLAN.md §5): «صفحه‌های ویژه», the campaign pages, on real Express
 * routes and PostgreSQL. A page is checked before it is kept (its address, its collection, its items, its hero image and
 * its discount code must exist: 422), its address is its own (409), a save runs under its version (a stale form is 409)
 * and each change writes its audit row. The site sees a page only while it is on and inside its days, with exactly the
 * reviewed fields: its items on the site now, its hero image file only while the page is live, and its code only while
 * that code could be used. A holder of `storefront.view` reads but cannot write.
 */

interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;

export async function runStorefrontCampaignsV11Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_campaigns_v11_8_5b';
  if (!shouldRun(id, 'v11', 'phase8', 'storefront', 'campaigns', 'occ')) return results;

  const name = 'v11 phase 8.5b: campaign pages checked before they are kept, under their own address and version, audited, shown to the site only while on and inside their days with the reviewed fields, their hero file and discount code only while usable, and view-only holders refused';
  const tStart = Date.now();
  const itemIds: number[] = [];
  const codeIds: number[] = [];
  const campaignIds: number[] = [];
  let sectionId = 0;
  let assetId = 0;
  let heroFile = '';
  const savedSettings = await orm.select().from(appSettings).where(like(appSettings.key, 'sf\\_%'));
  const savedStrategies = await orm.select().from(appSettings).where(eq(appSettings.key, 'pricing_strategies'));
  try {
    const { getTestApp, getAdminSession, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestItem, createTestRole, createTestUser } = await import('../fixtures/factories.js');
    const app = await getTestApp();
    const admin: Session = await getAdminSession();
    const as = (s: Session) => ({
      get: (url: string) => request(app).get(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken),
      put: (url: string, body: Body) => request(app).put(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
      post: (url: string, body: Body = {}) => request(app).post(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
      del: (url: string) => request(app).delete(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken),
    });
    const erp = as(admin);
    const tag = String(Date.now()).slice(-7);
    const wrong: string[] = [];
    const keys = (value: Body) => Object.keys(value).sort().join(',');

    // the site on, with a key and a retail list, so the public routes answer
    const retailList = `تکی کمپین ${tag}`;
    const current = readPricingStrategies(savedStrategies[0]?.value);
    const strategies = 'titles' in current ? current.titles : [];
    await orm.insert(appSettings).values({ key: 'pricing_strategies', value: JSON.stringify([...strategies, retailList]) })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify([...strategies, retailList]) } });
    invalidateSettingsCache();
    const base = (await erp.get('/api/storefront/settings')).body.data;
    const on = await erp.put('/api/storefront/settings', {
      cardNumber: '', cardHolder: '', bankName: '', iban: '', freeShippingThreshold: '', reservationHours: 24, retailPriceList: retailList,
      wholesalePriceList: '', lowStockThreshold: 3, stockDisplay: 'status', warehouseCode: '', whatsappNumber: '', whatsappEnabled: false,
      enabled: true, ordersEnabled: false, treasuryAccountId: 0, openOrdersPerPhone: 3, version: base.version,
    });
    if (on.status !== 200) throw new Error(`turning the site on: ${on.status} ${JSON.stringify(on.body)}`);
    const made = await erp.post('/api/storefront/api-key');
    const apiKey = String(made.body.data?.apiKey ?? '');
    const site = (url: string) => request(app).get(url).set('Authorization', `Bearer ${apiKey}`);

    // two published items of one collection, and a third that is not on the site
    const collection = `یلدا آزمون ${tag}`;
    const slugs: string[] = [];
    for (const n of [1, 2, 3]) {
      const item = await createTestItem({ name: `گردنبند یلدا ${n} ${tag}`, code: `SF-C${n}-${tag}`, collections: [collection] });
      itemIds.push(item.id);
      await orm.insert(itemPrices).values({ itemId: item.id, title: retailList, price: money('4000000'), currency: 'IRR' });
      if (n === 3) continue;
      const slug = `yalda-necklace-${n}-${tag}`;
      slugs.push(slug);
      const pub = await erp.put(`/api/storefront/products/${item.id}`, { published: true, slug, seoTitle: '', seoDescription: '', sortOrder: n, version: 0 });
      if (pub.status !== 200) throw new Error(`publish: ${pub.status} ${JSON.stringify(pub.body)}`);
    }

    // a banner in a section of its own, with its light version on disk
    const [section] = await orm.insert(mediaSections).values({ kind: 'custom', title: `بنرهای آزمون ${tag}` }).returning({ id: mediaSections.id });
    sectionId = section.id;
    const sha256 = createHash('sha256').update(`campaign-hero-${tag}`).digest('hex');
    const [asset] = await orm.insert(mediaAssets).values({
      sectionId, kind: 'image', title: 'بنر یلدا', mimeType: 'image/jpeg', sizeBytes: 100, sha256, width: 1600, height: 900, lightBytes: 4, thumbBytes: 4,
    }).returning({ id: mediaAssets.id });
    assetId = asset.id;
    heroFile = mediaFilePath(sha256, 'light', 'webp');
    await mkdir(path.dirname(heroFile), { recursive: true });
    await writeFile(heroFile, Buffer.from('RIFF'));
    const heroUrl = `/api/storefront/v1/media/${sha256}.webp`;
    if ((await site(heroUrl)).status !== 404) wrong.push('a banner no live page uses reached the site');

    // a code open to retail buyers
    const codeText = `YALDA${tag}`;
    const code = await erp.post('/api/storefront/discounts', {
      code: codeText, title: 'یلدا', kind: 'percent', percent: 10, amount: '0', maxDiscount: '0', minOrderAmount: '0', startsOn: '', endsOn: '',
      usageLimit: 0, perBuyerLimit: 0, forRetail: true, groupIds: [], accountsOnly: false, firstOrderOnly: false, isActive: true,
    });
    if (code.status !== 201) throw new Error(`create code: ${code.status} ${JSON.stringify(code.body)}`);
    codeIds.push(Number(code.body.data.id));

    // 1) the checks before a page is kept
    const slug = `yalda-${tag}`;
    const page: Body = {
      slug, title: 'یلدا با پاپیتال', summary: 'هدیه‌های یلدا', body: 'بند یکم\n\nبند دوم', heroAssetId: assetId, source: 'products', collection: '',
      itemIds: [itemIds[1], itemIds[2], itemIds[0]], discountCode: codeText.toLowerCase(), startsOn: '', endsOn: '', homeBanner: true, isActive: true,
    };
    const refusals: Array<[string, Body, number, string]> = [
      ['an address in Persian letters', { slug: 'یلدا' }, 422, 'STOREFRONT_CAMPAIGN_SLUG_INVALID'],
      ['an unknown collection', { source: 'collection', collection: `نیست ${tag}`, itemIds: [] }, 422, 'STOREFRONT_CAMPAIGN_COLLECTION_UNKNOWN'],
      ['no items', { itemIds: [] }, 422, 'STOREFRONT_CAMPAIGN_PRODUCTS_REQUIRED'],
      ['an unknown code', { discountCode: `NONE${tag}` }, 422, 'STOREFRONT_CAMPAIGN_CODE_UNKNOWN'],
      ['an unknown image', { heroAssetId: 2_000_000_000 }, 422, 'STOREFRONT_CAMPAIGN_HERO_INVALID'],
      ['an end before the start', { startsOn: '2026-12-21', endsOn: '2026-12-01' }, 422, 'STOREFRONT_CAMPAIGN_DATE_INVALID'],
    ];
    for (const [what, change, status, errorCode] of refusals) {
      const res = await erp.post('/api/storefront/campaigns', { ...page, ...change });
      if (res.status !== status || res.body.code !== errorCode) wrong.push(`${what}: ${res.status} ${res.body.code}`);
    }
    const created = await erp.post('/api/storefront/campaigns', page);
    if (created.status !== 201) throw new Error(`create page: ${created.status} ${JSON.stringify(created.body)}`);
    const pageId = Number(created.body.data.id);
    campaignIds.push(pageId);
    if (created.body.data.discountCode !== codeText || created.body.data.status !== 'live' || created.body.data.version !== 1
      || created.body.data.hero?.onSite !== true || created.body.data.products.filter((p: Body) => p.onSite).length !== 2) {
      wrong.push(`the created page: ${JSON.stringify(created.body.data)}`);
    }
    const taken = await erp.post('/api/storefront/campaigns', page);
    if (taken.status !== 409 || taken.body.code !== 'STOREFRONT_CAMPAIGN_SLUG_TAKEN') wrong.push(`a taken address: ${taken.status} ${taken.body.code}`);
    const byCollection = await erp.post('/api/storefront/campaigns', { ...page, slug: `${slug}-all`, source: 'collection', collection, itemIds: [], heroAssetId: null, discountCode: '', homeBanner: false });
    if (byCollection.status !== 201) wrong.push(`a page of a collection: ${byCollection.status} ${JSON.stringify(byCollection.body)}`);
    const collectionPageId = Number(byCollection.body.data?.id ?? 0);
    if (collectionPageId) campaignIds.push(collectionPageId);

    // 2) the site: exactly the reviewed fields, the items on the site in the page's order, the code, the banner file
    const list = await site('/api/storefront/v1/campaigns');
    const listed = (list.body.data ?? []).find((c: Body) => c.slug === slug);
    if (list.status !== 200 || !listed || keys(listed) !== 'endsOn,hero,homeBanner,slug,summary,title' || listed.homeBanner !== true
      || keys(listed.hero ?? {}) !== 'alt,height,isCover,sha256,width' || listed.hero.sha256 !== sha256 || listed.hero.alt !== 'یلدا با پاپیتال') {
      wrong.push(`the public list: ${list.status} ${JSON.stringify(listed)}`);
    }
    const one = await site(`/api/storefront/v1/campaigns/${slug}`);
    if (one.status !== 200 || keys(one.body.data) !== 'body,discountCode,endsOn,hero,homeBanner,products,slug,summary,title') {
      wrong.push(`the public page fields: ${one.status} ${JSON.stringify(one.body)}`);
    } else {
      if (one.body.data.products.map((p: Body) => p.slug).join(',') !== [slugs[1], slugs[0]].join(',')) wrong.push(`the page's items: ${JSON.stringify(one.body.data.products.map((p: Body) => p.slug))}`);
      if (one.body.data.discountCode !== codeText) wrong.push(`the open code was not shown: ${one.body.data.discountCode}`);
    }
    const all = await site(`/api/storefront/v1/campaigns/${slug}-all`);
    if (all.status !== 200 || all.body.data.products.length !== 2) wrong.push(`the collection page: ${all.status} ${JSON.stringify(all.body.data?.products?.length)}`);
    if ((await site(heroUrl)).status !== 200) wrong.push('the live page\'s banner did not reach the site');
    // the product feed (phase 8.5b too): exactly the reviewed fields, only the items on the site
    const feed = await site('/api/storefront/v1/feed');
    const fed = (feed.body.data ?? []).filter((f: Body) => String(f.sku).endsWith(tag));
    if (feed.status !== 200 || fed.length !== 2
      || keys(fed[0] ?? {}) !== 'category,collections,color,description,images,inStock,material,name,retailPrice,sku,slug') {
      wrong.push(`the feed: ${feed.status} ${JSON.stringify(fed)}`);
    }
    if ((await site('/api/storefront/v1/campaigns/Yalda')).status !== 404) wrong.push('an address no page has was not a 404');

    // 3) a code that is off is not shown
    await orm.update(storefrontDiscountCodes).set({ isActive: 0 }).where(eq(storefrontDiscountCodes.id, codeIds[0]));
    const codeOff = await site(`/api/storefront/v1/campaigns/${slug}`);
    if (codeOff.body.data?.discountCode !== '') wrong.push(`a switched-off code was shown: ${codeOff.body.data?.discountCode}`);
    await orm.update(storefrontDiscountCodes).set({ isActive: 1, accountsOnly: 1 }).where(eq(storefrontDiscountCodes.id, codeIds[0]));
    const codeMembers = await site(`/api/storefront/v1/campaigns/${slug}`);
    if (codeMembers.body.data?.discountCode !== '') wrong.push(`a code for accounts only was shown: ${codeMembers.body.data?.discountCode}`);

    // 4) moved to start tomorrow: scheduled, gone from the site with its banner; a stale save is 409
    const tomorrow = tehranDayOf(new Date(Date.now() + 86_400_000));
    const later = await erp.put(`/api/storefront/campaigns/${pageId}`, { ...page, startsOn: tomorrow, version: 1 });
    if (later.status !== 200 || later.body.data.status !== 'scheduled' || later.body.data.startsOn !== tomorrow || later.body.data.version !== 2) {
      wrong.push(`move to tomorrow: ${later.status} ${JSON.stringify(later.body.data ?? later.body)}`);
    }
    const stale = await erp.put(`/api/storefront/campaigns/${pageId}`, { ...page, version: 1 });
    if (stale.status !== 409) wrong.push(`a stale save: ${stale.status}, not 409`);
    if ((await site(`/api/storefront/v1/campaigns/${slug}`)).status !== 404) wrong.push('a scheduled page reached the site');
    if (((await site('/api/storefront/v1/campaigns')).body.data ?? []).some((c: Body) => c.slug === slug)) wrong.push('a scheduled page was listed');
    if ((await site(heroUrl)).status !== 404) wrong.push('a scheduled page\'s banner reached the site');

    // 5) a holder of storefront.view reads but cannot write
    const role = await createTestRole({ permissions: ['storefront.view'] });
    const viewer = as(await loginTestUserWithSession(app, (await createTestUser({ role: role.code })).username));
    const viewerList = await viewer.get('/api/storefront/campaigns');
    const viewerHeroes = await viewer.get('/api/storefront/campaigns/hero-images');
    const viewerCreate = await viewer.post('/api/storefront/campaigns', { ...page, slug: `${slug}-v` });
    const viewerDelete = await viewer.del(`/api/storefront/campaigns/${pageId}?version=2`);
    // the image picker lists the media library, so it needs the library's own key as well
    if (viewerList.status !== 200 || viewerHeroes.status !== 403 || viewerCreate.status !== 403 || viewerDelete.status !== 403) {
      wrong.push(`view only: list ${viewerList.status}, images ${viewerHeroes.status}, create ${viewerCreate.status}, delete ${viewerDelete.status}`);
    }
    const heroes = await erp.get('/api/storefront/campaigns/hero-images');
    if (heroes.status !== 200 || !(heroes.body.data ?? []).some((o: Body) => o.id === assetId)) wrong.push(`the banner was not among the images a page may take: ${heroes.status}`);
    // a manager without the media library may keep a page's image but not choose one
    const managerRole = await createTestRole({ permissions: ['storefront.view', 'storefront.manage'] });
    const manager = as(await loginTestUserWithSession(app, (await createTestUser({ role: managerRole.code })).username));
    const managerHero = await manager.post('/api/storefront/campaigns', { ...page, slug: `${slug}-m` });
    if (managerHero.status !== 403 || managerHero.body.code !== 'STOREFRONT_CAMPAIGN_HERO_FORBIDDEN') wrong.push(`a hero chosen without the media library: ${managerHero.status} ${managerHero.body.code}`);
    const managerKeeps = await manager.put(`/api/storefront/campaigns/${pageId}`, { ...page, startsOn: tomorrow, title: 'یلدای پاپیتال', version: 2 });
    if (managerKeeps.status !== 200) wrong.push(`an edit that keeps the image, without the media library: ${managerKeeps.status} ${JSON.stringify(managerKeeps.body)}`);

    // 6) a soft delete frees the address; four audit rows
    const removed = await erp.del(`/api/storefront/campaigns/${pageId}?version=3`);
    if (removed.status !== 200) wrong.push(`delete: ${removed.status}`);
    const [kept] = await orm.select({ isDeleted: storefrontCampaigns.isDeleted }).from(storefrontCampaigns).where(eq(storefrontCampaigns.id, pageId));
    if (kept?.isDeleted !== 1) wrong.push('the deleted page was not kept as a soft delete');
    const audits = await orm.select({ id: activityLogs.id }).from(activityLogs).where(eq(activityLogs.entityId, `campaign-${pageId}`));
    if (audits.length !== 4) wrong.push(`audit rows of the page: ${audits.length}, not 4 (create, two edits, delete)`);
    if (collectionPageId) {
      const freed = await erp.put(`/api/storefront/campaigns/${collectionPageId}`, {
        ...page, source: 'collection', collection, itemIds: [], heroAssetId: null, discountCode: '', homeBanner: false, version: 1,
      });
      if (freed.status !== 200 || freed.body.data.slug !== slug) wrong.push(`the address free again after a delete: ${freed.status} ${JSON.stringify(freed.body)}`);
    }

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'a page was refused (422) for an address in Persian letters, an unknown collection, no items, an unknown code, an unknown image and an end before its start; a taken address was 409; the site got exactly the reviewed fields, the page\'s items on the site in its order, the open code (not once switched off or for accounts only) and the banner file only while the page was live; the feed held exactly its reviewed fields for the two items on the site; a move to tomorrow made it scheduled and gone from the site, a stale save 409; a view-only holder read but could not write or list the library images, and a manager without the library could keep the image of a page but not choose one; a soft delete freed the address, with four audit rows',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (campaignIds.length > 0) await orm.delete(storefrontCampaigns).where(inArray(storefrontCampaigns.id, campaignIds)).catch(() => undefined);
    if (itemIds.length > 0) {
      await orm.delete(storefrontProducts).where(inArray(storefrontProducts.itemId, itemIds)).catch(() => undefined);
      await orm.update(itemPrices).set({ isDeleted: 1 }).where(inArray(itemPrices.itemId, itemIds)).catch(() => undefined);
      await orm.update(items).set({ isDeleted: 1 }).where(inArray(items.id, itemIds)).catch(() => undefined);
    }
    if (codeIds.length > 0) await orm.delete(storefrontDiscountCodes).where(inArray(storefrontDiscountCodes.id, codeIds)).catch(() => undefined);
    if (assetId) await orm.delete(mediaAssets).where(eq(mediaAssets.id, assetId)).catch(() => undefined);
    if (sectionId) await orm.delete(mediaSections).where(eq(mediaSections.id, sectionId)).catch(() => undefined);
    if (heroFile) await rm(heroFile, { force: true }).catch(() => undefined);
    await orm.delete(appSettings).where(like(appSettings.key, 'sf\\_%')).catch(() => undefined);
    if (savedSettings.length > 0) await orm.insert(appSettings).values(savedSettings).catch(() => undefined);
    if (savedStrategies.length > 0) {
      await orm.update(appSettings).set({ value: savedStrategies[0].value }).where(eq(appSettings.key, 'pricing_strategies')).catch(() => undefined);
    } else {
      await orm.delete(appSettings).where(eq(appSettings.key, 'pricing_strategies')).catch(() => undefined);
    }
    invalidateSettingsCache();
  }
  return results;
}
