import fs from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { and, eq, inArray, like } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { appSettings, itemPrices, items, mediaAssets, mediaSections, storefrontContentAssets, storefrontPages, storefrontProducts } from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { readPricingStrategies } from '../../lib/items/pricingStrategies.js';
import { mediaFilePath } from '../../lib/media/mediaPaths.js';

/**
 * v12 phase 10c (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2, `AGENTS.md` §1.9c): what the site reads of «صفحه‌های
 * سایت», on real Express routes and PostgreSQL. `GET /api/storefront/v1/pages` and `/pages/:slug` answer only the
 * published copy of a live page, with exactly the reviewed fields: no draft, no editor's name, no row id and no id of the
 * media library or of an item. An image goes out by its file key only while the library still has it; a row of products
 * is the cards of the items on the site now. `/media/<file>` gives an image a published page names and is the same 404
 * for an image of a draft, of a page taken off the site and of a removed page. The routes need the site's key and the
 * site switched on.
 */
interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;

export async function runStorefrontSitePagesV12Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_site_pages_v12_p10c';
  if (!shouldRun(id, 'v12', 'phase10', 'storefront', 'pages', 'security')) return results;

  const name = 'v12 phase 10c: the site reads only the published copy of a page with the reviewed fields, images by file key, product rows as cards of items on the site, and only the images a published page names';
  const tStart = Date.now();
  const pageIds: number[] = [];
  const assetIds: number[] = [];
  const itemIds: number[] = [];
  const files: string[] = [];
  let sectionId = 0;
  const savedSettings = await orm.select().from(appSettings).where(like(appSettings.key, 'sf\\_%'));
  const savedStrategies = await orm.select().from(appSettings).where(eq(appSettings.key, 'pricing_strategies'));
  const aboutBefore = (await orm.select().from(storefrontPages).where(and(eq(storefrontPages.slug, 'about'), eq(storefrontPages.isDeleted, 0))))[0];
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestItem } = await import('../fixtures/factories.js');
    const app = await getTestApp();
    const admin: Session = await getAdminSession();
    const erp = {
      get: (url: string) => request(app).get(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken),
      put: (url: string, body: Body) => request(app).put(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body),
      post: (url: string, body: Body = {}) => request(app).post(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body),
      del: (url: string) => request(app).delete(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken),
    };
    const tag = String(Date.now()).slice(-7);
    const wrong: string[] = [];
    const keys = (value: unknown) => Object.keys((value ?? {}) as Body).sort().join(',');

    // the site on, with a key and a retail list
    const retailList = `تکی صفحه‌های سایت ${tag}`;
    const current = readPricingStrategies(savedStrategies[0]?.value);
    const strategies = 'titles' in current ? current.titles : [];
    await orm.insert(appSettings).values({ key: 'pricing_strategies', value: JSON.stringify([...strategies, retailList]) })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify([...strategies, retailList]) } });
    invalidateSettingsCache();
    const base = (await erp.get('/api/storefront/settings')).body.data;
    const settingsForm = {
      cardNumber: '', cardHolder: '', bankName: '', iban: '', freeShippingThreshold: '', reservationHours: 24, retailPriceList: retailList,
      wholesalePriceList: '', lowStockThreshold: 3, stockDisplay: 'status', warehouseCode: '', whatsappNumber: '', whatsappEnabled: false,
      enabled: true, ordersEnabled: false, treasuryAccountId: 0, openOrdersPerPhone: 3,
    };
    const on = await erp.put('/api/storefront/settings', { ...settingsForm, version: base.version });
    if (on.status !== 200) throw new Error(`turning the site on: ${on.status} ${JSON.stringify(on.body)}`);
    const apiKey = String((await erp.post('/api/storefront/api-key')).body.data?.apiKey ?? '');
    const site = (url: string) => request(app).get(`/api/storefront/v1${url}`).set('Authorization', `Bearer ${apiKey}`);

    // three images of the library whose files are on the disk, and one item on the site with one that is not
    const [section] = await orm.insert(mediaSections).values({ kind: 'custom', title: `عکس‌های سایت ${tag}` }).returning({ id: mediaSections.id });
    sectionId = section.id;
    const image = async (n: number) => {
      const sha256 = `${String(n).repeat(8)}${tag}`.padEnd(64, 'c').slice(0, 64);
      const [asset] = await orm.insert(mediaAssets).values({
        sectionId, kind: 'image', title: `عکس سایت ${n} ${tag}`, originalName: `site-${n}.jpg`, mimeType: 'image/jpeg', sizeBytes: 1000,
        sha256, width: 1600, height: 900, lightBytes: 12, thumbBytes: n === 2 ? null : 12,
      }).returning({ id: mediaAssets.id });
      assetIds.push(asset.id);
      for (const variant of n === 2 ? ['light'] as const : ['light', 'thumb'] as const) {
        const file = mediaFilePath(sha256, variant, 'webp');
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, `webp-${variant}-${n}`);
        files.push(file);
      }
      return { id: asset.id, sha256 };
    };
    const [onPage, inText, draftOnly] = [await image(1), await image(2), await image(3)];
    const collection = `کالکشن صفحه ${tag}`;
    const ring = await createTestItem({ name: `انگشتر صفحه ${tag}`, code: `SP-P1-${tag}` });
    const hidden = await createTestItem({ name: `پنهان صفحه ${tag}`, code: `SP-P2-${tag}` });
    itemIds.push(ring.id, hidden.id);
    await orm.update(items).set({ collections: [collection] }).where(inArray(items.id, itemIds));
    for (const item of [ring, hidden]) await orm.insert(itemPrices).values({ itemId: item.id, title: retailList, price: money('3100000'), currency: 'IRR' });
    const ringSlug = `page-ring-${tag}`;
    const pub = await erp.put(`/api/storefront/products/${ring.id}`, { published: true, slug: ringSlug, seoTitle: '', seoDescription: '', sortOrder: 1, version: 0 });
    if (pub.status !== 200) throw new Error(`publishing an item: ${pub.status} ${JSON.stringify(pub.body)}`);

    // 1) nothing of this run is on the site yet: the list has no page of ours, a draft and an unknown address are the same 404
    const slug = `site-story-${tag}`;
    const created = await erp.post('/api/storefront/pages', { title: `داستان سایت ${tag}`, slug, template: null });
    if (created.status !== 201) throw new Error(`a new page: ${created.status} ${JSON.stringify(created.body)}`);
    const pageId = Number(created.body.data.id);
    pageIds.push(pageId);
    const p = (text: string, marks?: unknown[]) => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] });
    const sections = [
      { kind: 'hero', background: 'brand', title: 'از کاشی تا زیور', text: 'کارگاهی کوچک', imageAssetId: onPage.id, buttonLabel: 'محصولات', buttonHref: '/products' },
      { kind: 'text', background: 'white', doc: { type: 'doc', content: [p('متن روی سایت', [{ type: 'link', attrs: { href: 'https://example.org/a' } }]), { type: 'libraryImage', attrs: { assetId: inText.id, alt: 'میز کار' } }] } },
      { kind: 'gallery', background: 'cream', title: 'گالری', images: [{ assetId: onPage.id, alt: 'یک' }, { assetId: inText.id, alt: 'دو' }] },
      { kind: 'products', background: 'white', title: 'برگزیده‌ها', source: 'items', itemIds: [hidden.id, ring.id], collection: '' },
      { kind: 'products', background: 'white', title: 'از کالکشن', source: 'collection', itemIds: [], collection },
    ];
    const form = (list: unknown[], version: number, over: Body = {}) => ({
      title: `داستان سایت ${tag}`, slug, seoTitle: 'عنوان جست‌وجو', seoDescription: 'توضیح جست‌وجو', noindex: true, shareImageAssetId: onPage.id, sections: list, version, ...over,
    });
    const saved = await erp.put(`/api/storefront/pages/${pageId}`, form(sections, 1));
    if (saved.status !== 200) throw new Error(`saving the draft: ${saved.status} ${JSON.stringify(saved.body)}`);
    const listBefore = await site('/pages');
    const draftRead = await site(`/pages/${slug}`);
    const unknownRead = await site(`/pages/no-such-page-${tag}`);
    if (listBefore.status !== 200 || (listBefore.body.data ?? []).some((row: Body) => row.slug === slug)) wrong.push(`a draft in the list: ${listBefore.status} ${JSON.stringify(listBefore.body.data)}`);
    if (draftRead.status !== 404 || unknownRead.status !== 404 || draftRead.body.error !== unknownRead.body.error || draftRead.body.code !== unknownRead.body.code) {
      wrong.push(`a draft read: ${draftRead.status} ${JSON.stringify(draftRead.body)} against an unknown address ${unknownRead.status} ${JSON.stringify(unknownRead.body)}`);
    }
    const draftImage = await site(`/media/${onPage.sha256}.webp`);
    if (draftImage.status !== 404) wrong.push(`an image of a draft was served: ${draftImage.status}`);

    // 2) published: exactly the reviewed fields, images by file key, products as cards of items on the site, no id anywhere
    const published = await erp.post(`/api/storefront/pages/${pageId}/publish`, { version: 2 });
    if (published.status !== 200) throw new Error(`publishing: ${published.status} ${JSON.stringify(published.body)}`);
    const read = await site(`/pages/${slug}`);
    const page = (read.body.data ?? {}) as { sections?: Array<Record<string, unknown>> } & Body;
    if (read.status !== 200 || keys(page) !== 'kind,noindex,sections,seoDescription,seoTitle,shareImage,slug,title,updatedAt') wrong.push(`the page's fields: ${read.status} ${keys(page)}`);
    const got = page.sections ?? [];
    const imageKeys = 'alt,height,sha256,thumb,width';
    if (page.slug !== slug || page.kind !== 'custom' || page.noindex !== true || page.seoTitle !== 'عنوان جست‌وجو' || Number.isNaN(Date.parse(String(page.updatedAt)))
      || keys(page.shareImage) !== imageKeys || (page.shareImage as Body).sha256 !== onPage.sha256) {
      wrong.push(`the page's values: ${JSON.stringify({ ...page, sections: undefined })}`);
    }
    if (got.map(s => s.kind).join(',') !== 'hero,text,gallery,products,products') wrong.push(`the sections: ${got.map(s => s.kind).join(',')}`);
    if (keys(got[0]) !== 'background,buttonHref,buttonLabel,image,kind,text,title' || (got[0]?.image as Body)?.sha256 !== onPage.sha256 || (got[0]?.image as Body)?.thumb !== true) {
      wrong.push(`the hero: ${JSON.stringify(got[0])}`);
    }
    const doc = got[1]?.doc as { content?: Array<{ type: string; attrs?: Body }> } | undefined;
    if (keys(got[1]) !== 'background,doc,kind' || doc?.content?.[1]?.type !== 'libraryImage' || keys(doc.content[1].attrs) !== imageKeys
      || doc.content[1].attrs?.sha256 !== inText.sha256 || doc.content[1].attrs?.alt !== 'میز کار' || doc.content[1].attrs?.thumb !== 0) {
      wrong.push(`the text: ${JSON.stringify(got[1])}`);
    }
    const gallery = (got[2]?.images ?? []) as Body[];
    if (keys(got[2]) !== 'background,images,kind,title' || gallery.length !== 2 || gallery.some(g => keys(g) !== imageKeys) || gallery[1].alt !== 'دو') wrong.push(`the gallery: ${JSON.stringify(got[2])}`);
    for (const [index, wantCollection] of [[3, ''], [4, collection]] as const) {
      const cards = (got[index]?.products ?? []) as Body[];
      if (keys(got[index]) !== 'background,collection,kind,products,title' || got[index]?.collection !== wantCollection || cards.length !== 1 || cards[0].slug !== ringSlug
        || keys(cards[0]) !== 'category,collections,cover,name,retailPrice,sku,slug,stock') {
        wrong.push(`the product row ${index}: ${JSON.stringify(got[index])}`);
      }
    }
    const text = JSON.stringify(read.body);
    for (const leak of ['assetId', 'imageAssetId', 'itemIds', 'shareImageAssetId', '"id"', 'version', 'publishedBy', 'updatedBy', 'createdBy', admin.cookie.slice(0, 12), `"source"`]) {
      if (text.includes(leak)) wrong.push(`the answer carries «${leak}»`);
    }
    const listed = ((await site('/pages')).body.data ?? []).find((row: Body) => row.slug === slug) as Body | undefined;
    if (!listed || keys(listed) !== 'kind,noindex,slug,title,updatedAt' || listed.noindex !== true) wrong.push(`the list's line: ${JSON.stringify(listed)}`);

    // 3) the images a published page names are served; the small version only where there is one; any other file is 404
    const light = await site(`/media/${onPage.sha256}.webp`);
    const thumb = await site(`/media/${onPage.sha256}-thumb.webp`);
    const inTextLight = await site(`/media/${inText.sha256}.webp`);
    const inTextThumb = await site(`/media/${inText.sha256}-thumb.webp`);
    if (light.status !== 200 || light.headers['content-type'] !== 'image/webp' || light.headers['x-content-type-options'] !== 'nosniff' || String(light.body) !== 'webp-light-1') {
      wrong.push(`a published image: ${light.status} ${light.headers['content-type']}`);
    }
    if (thumb.status !== 200 || inTextLight.status !== 200 || inTextThumb.status !== 404) wrong.push(`the versions of an image: ${thumb.status}/${inTextLight.status}/${inTextThumb.status}`);
    // a later draft adds an image: the site still shows the published copy and the new image is not served
    const laterDraft = await erp.put(`/api/storefront/pages/${pageId}`, form([{ kind: 'hero', background: 'white', title: 'پیش‌نویس تازه', text: '', imageAssetId: draftOnly.id, buttonLabel: '', buttonHref: '' }], 3, { title: `عنوان پیش‌نویس ${tag}` }));
    const afterDraft = await site(`/pages/${slug}`);
    const draftOnlyImage = await site(`/media/${draftOnly.sha256}.webp`);
    if (laterDraft.status !== 200 || JSON.stringify(afterDraft.body) !== text) wrong.push(`a draft changed the copy on the site: ${laterDraft.status}`);
    if (draftOnlyImage.status !== 404 || JSON.stringify(afterDraft.body).includes('پیش‌نویس')) wrong.push(`a draft's image or words reached the site: ${draftOnlyImage.status}`);
    // an image that left the library is no longer named or served; the row of the item taken off the site is empty
    await orm.update(mediaAssets).set({ isDeleted: 1 }).where(eq(mediaAssets.id, inText.id));
    const unpub = await erp.put(`/api/storefront/products/${ring.id}`, { published: false, slug: ringSlug, seoTitle: '', seoDescription: '', sortOrder: 1, version: Number(pub.body.data?.version ?? 1) });
    const afterLoss = (await site(`/pages/${slug}`)).body.data as { sections: Array<Record<string, unknown>> };
    const goneImage = await site(`/media/${inText.sha256}.webp`);
    const lossDoc = afterLoss.sections[1].doc as { content: unknown[] };
    if (goneImage.status !== 404 || lossDoc.content.length !== 1 || (afterLoss.sections[2].images as unknown[]).length !== 1) wrong.push(`an image that left the library: ${goneImage.status} ${JSON.stringify(afterLoss.sections.slice(1, 3))}`);
    // the catalog is kept a few seconds, so the row empties at the latest then; the page itself must still answer
    if (unpub.status !== 200 || !Array.isArray(afterLoss.sections[3].products)) wrong.push(`the product row after the item left: ${unpub.status} ${JSON.stringify(afterLoss.sections[3])}`);

    // 4) a base page: 404 until published, then at its own address with kind «base»
    if (aboutBefore && aboutBefore.published === null) {
      const aboutDraft = await site('/pages/about');
      const aboutSaved = await erp.put(`/api/storefront/pages/${aboutBefore.id}`, {
        title: aboutBefore.title, slug: 'about', seoTitle: '', seoDescription: '', noindex: false, shareImageAssetId: null,
        sections: [{ kind: 'text', background: 'white', doc: { type: 'doc', content: [p(`درباره ما ${tag}`)] } }], version: aboutBefore.version,
      });
      const aboutPub = await erp.post(`/api/storefront/pages/${aboutBefore.id}/publish`, { version: aboutBefore.version + 1 });
      const aboutRead = await site('/pages/about');
      if (aboutDraft.status !== 404 || aboutSaved.status !== 200 || aboutPub.status !== 200 || aboutRead.status !== 200 || aboutRead.body.data.kind !== 'base' || aboutRead.body.data.shareImage !== null) {
        wrong.push(`a base page: ${aboutDraft.status}/${aboutSaved.status}/${aboutPub.status}/${aboutRead.status} ${JSON.stringify(aboutRead.body).slice(0, 200)}`);
      }
    }

    // 5) the door: no key, a wrong key and an address past the limit
    const noKey = await request(app).get(`/api/storefront/v1/pages/${slug}`);
    const wrongKey = await request(app).get('/api/storefront/v1/pages').set('Authorization', 'Bearer sf_wrong_key_0000000000000000');
    const longSlug = await site(`/pages/${'a'.repeat(61)}`);
    if (noKey.status !== 401 || wrongKey.status !== 401 || longSlug.status !== 400) wrong.push(`the door: ${noKey.status}/${wrongKey.status}/${longSlug.status}`);

    // 6) off the site: the page and its images are the same 404 again; a removed page too
    const off = await erp.post(`/api/storefront/pages/${pageId}/unpublish`, { version: 4 });
    const offRead = await site(`/pages/${slug}`);
    const offImage = await site(`/media/${onPage.sha256}.webp`);
    if (off.status !== 200 || offRead.status !== 404 || offImage.status !== 404) wrong.push(`off the site: ${off.status}/${offRead.status}/${offImage.status}`);
    const back = await erp.get(`/api/storefront/pages/${pageId}`);
    const resaved = await erp.put(`/api/storefront/pages/${pageId}`, form([sections[0]], Number(back.body.data.version)));
    const republished = await erp.post(`/api/storefront/pages/${pageId}/publish`, { version: Number(resaved.body.data?.version) });
    const backImage = await site(`/media/${onPage.sha256}.webp`);
    const removed = await erp.del(`/api/storefront/pages/${pageId}?version=${Number(republished.body.data?.version)}`);
    const removedRead = await site(`/pages/${slug}`);
    const removedImage = await site(`/media/${onPage.sha256}.webp`);
    if (republished.status !== 200 || backImage.status !== 200 || ![200, 204].includes(removed.status) || removedRead.status !== 404 || removedImage.status !== 404) {
      wrong.push(`a removed page: ${resaved.status}/${republished.status}/${backImage.status}/${removed.status}/${removedRead.status}/${removedImage.status}`);
    }

    // 7) the site switched off: the routes are the same 404 as every other
    const nowSettings = (await erp.get('/api/storefront/settings')).body.data;
    const turnedOff = await erp.put('/api/storefront/settings', { ...settingsForm, enabled: false, version: nowSettings.version });
    const whileOff = await site('/pages');
    if (turnedOff.status !== 200 || whileOff.status !== 404) wrong.push(`the site off: ${turnedOff.status}, pages ${whileOff.status}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'a draft and an unknown address were the same 404 and a draft\'s image was not served; the published page answered exactly its reviewed fields with images by file key, a text image by file key, product rows as the card of the one item on the site, and no id, version or editor; its images were served (the small version only where there is one); a later draft changed nothing on the site and its image stayed 404; an image that left the library left the answer and the image route; a base page answered only once published; the routes refused a missing or wrong key and an over-long address; a page taken off the site or removed, and the site switched off, were 404 with their images',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    for (const file of files) await fs.rm(file, { force: true }).catch(() => undefined);
    if (aboutBefore) {
      await orm.delete(storefrontContentAssets).where(and(eq(storefrontContentAssets.contentKind, 'page'), eq(storefrontContentAssets.contentId, aboutBefore.id))).catch(() => undefined);
      await orm.update(storefrontPages).set(aboutBefore).where(eq(storefrontPages.id, aboutBefore.id)).catch(() => undefined);
    }
    if (pageIds.length > 0) {
      await orm.delete(storefrontContentAssets).where(and(eq(storefrontContentAssets.contentKind, 'page'), inArray(storefrontContentAssets.contentId, pageIds))).catch(() => undefined);
      await orm.delete(storefrontPages).where(inArray(storefrontPages.id, pageIds)).catch(() => undefined);
    }
    if (itemIds.length) {
      await orm.delete(storefrontProducts).where(inArray(storefrontProducts.itemId, itemIds)).catch(() => undefined);
      await orm.update(itemPrices).set({ isDeleted: 1 }).where(inArray(itemPrices.itemId, itemIds)).catch(() => undefined);
      await orm.update(items).set({ isDeleted: 1 }).where(inArray(items.id, itemIds)).catch(() => undefined);
    }
    if (assetIds.length > 0) await orm.delete(mediaAssets).where(inArray(mediaAssets.id, assetIds)).catch(() => undefined);
    if (sectionId) await orm.delete(mediaSections).where(eq(mediaSections.id, sectionId)).catch(() => undefined);
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
