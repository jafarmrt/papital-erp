import request from 'supertest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { and, desc, eq, inArray, like, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, appSettings, itemPrices, items, mediaAssets, mediaSections, storefrontCollections, storefrontPages, storefrontProducts } from '../../db/schema.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { readPricingStrategies } from '../../lib/items/pricingStrategies.js';
import { mediaFilePath } from '../../lib/media/mediaPaths.js';
import { money } from '../../lib/money.js';

/**
 * v12 phase 10e, part 1 (migration 0035, docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): «متن و تصویر کالکشن‌ها» on real
 * Express routes and PostgreSQL. `site_content.view` reads the collections of the site with their words,
 * `site_content.manage` saves the words of one under its version (0 = nothing saved yet), a new image needs
 * `media.view` too; a name no item of the site carries gets no row; every save that changes something writes one audit
 * row. The site reads the words of a collection only while the collection has an item on the site and something to
 * show, only what a visitor sees (no row id, no library id, no editor), the link «آشنایی بیشتر» only while its page is
 * published, and the image's file only then. The CHECK constraints and the unique name of migration 0035 hold against
 * a direct write.
 */
interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;

export async function runStorefrontCollectionTextsV12Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_collection_texts_v12_p10e';
  if (!shouldRun(id, 'v12', 'phase10', 'storefront', 'collections', 'migration', 'security')) return results;

  const name = 'v12 phase 10e: the words of a collection are saved under a version by who may, audited, and reach the site only for a collection with an item there';
  const tStart = Date.now();
  const wrong: string[] = [];
  const tag = String(Date.now()).slice(-7);
  const itemIds: number[] = [];
  const assetIds: number[] = [];
  const pageIds: number[] = [];
  const files: string[] = [];
  let sectionId = 0;
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
    });
    const erp = as(admin);

    const retailList = `تکی کالکشن ${tag}`;
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
    const apiKey = String((await erp.post('/api/storefront/api-key')).body.data?.apiKey ?? '');
    const site = (url: string) => request(app).get(`/api/storefront/v1${url}`).set('Authorization', `Bearer ${apiKey}`);
    const media = async (sha256: string) => `${(await site(`/media/${sha256}.webp`)).status}/${(await site(`/media/${sha256}-thumb.webp`)).status}`;
    const siteTexts = async () => ((await site('/collections')).body.data ?? []) as Body[];
    const mine = async () => (await siteTexts()).filter(row => String(row.name).endsWith(tag));

    // two collections with items on the site (the first with two), and one whose only item is not on the site
    const [onSite, second, offSite] = [`کاشی‌های آزمون ${tag}`, `فیروزه آزمون ${tag}`, `بیرون از سایت ${tag}`];
    const versions = new Map<number, number>();
    const publish = async (itemId: number, published: boolean, slug: string) => {
      const res = await erp.put(`/api/storefront/products/${itemId}`, { published, slug, seoTitle: '', seoDescription: '', sortOrder: 1, version: versions.get(itemId) ?? 0 });
      if (res.status !== 200) throw new Error(`putting item ${itemId} ${published ? 'on' : 'off'} the site: ${res.status} ${JSON.stringify(res.body)}`);
      versions.set(itemId, Number(res.body.data?.version ?? (versions.get(itemId) ?? 0) + 1));
    };
    const made: Array<{ id: number; slug: string; collection: string }> = [];
    for (const [n, collection, live] of [[1, onSite, true], [2, onSite, true], [3, second, true], [4, offSite, false]] as const) {
      const item = await createTestItem({ name: `گردنبند کالکشن ${n} ${tag}`, code: `SF-CT${n}-${tag}`, collections: [collection] });
      itemIds.push(item.id);
      await orm.insert(itemPrices).values({ itemId: item.id, title: retailList, price: money('4000000'), currency: 'IRR' });
      const slug = `collection-text-${n}-${tag}`;
      made.push({ id: item.id, slug, collection });
      if (live) await publish(item.id, true, slug);
    }

    // images of the library whose files are on the disk (the third has left the library), and a page the shop made
    const [section] = await orm.insert(mediaSections).values({ kind: 'custom', title: `عکس‌های کالکشن ${tag}` }).returning({ id: mediaSections.id });
    sectionId = section.id;
    const image = async (n: number, isDeleted = 0) => {
      const sha256 = `${String(n).repeat(8)}${tag}`.padEnd(64, 'c').slice(0, 64);
      const [asset] = await orm.insert(mediaAssets).values({
        sectionId, kind: 'image', title: `عکس کالکشن ${n} ${tag}`, originalName: `collection-${n}.jpg`, mimeType: 'image/jpeg', sizeBytes: 1000,
        sha256, width: 1600, height: 900, lightBytes: 12, thumbBytes: 12, isDeleted,
      }).returning({ id: mediaAssets.id });
      assetIds.push(asset.id);
      for (const variant of ['light', 'thumb'] as const) {
        const file = mediaFilePath(sha256, variant, 'webp');
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, `webp-${variant}-${n}`);
        files.push(file);
      }
      return { id: asset.id, sha256 };
    };
    const [cover, other, gone] = [await image(1), await image(2), await image(3, 1)];
    const pageSlug = `collection-story-${tag}`;
    const page = await erp.post('/api/storefront/pages', { title: `داستان کاشی ${tag}`, slug: pageSlug, template: null });
    if (page.status !== 201) throw new Error(`a new page: ${page.status} ${JSON.stringify(page.body)}`);
    const pageId = Number(page.body.data.id);
    pageIds.push(pageId);
    const pageDraft = await erp.put(`/api/storefront/pages/${pageId}`, {
      title: `داستان کاشی ${tag}`, slug: pageSlug, seoTitle: '', seoDescription: '', noindex: false, shareImageAssetId: null,
      sections: [{ kind: 'button', background: 'white', label: 'محصولات', href: '/products' }], version: 1,
    });
    if (pageDraft.status !== 200) throw new Error(`saving the page: ${pageDraft.status} ${JSON.stringify(pageDraft.body)}`);
    const [aboutPage] = await orm.select({ id: storefrontPages.id }).from(storefrontPages).where(eq(storefrontPages.slug, 'about'));

    // 1) who may read and who may change
    const viewer = as(await loginTestUserWithSession(app, (await createTestUser({ role: (await createTestRole({ permissions: ['site_content.view'] })).code })).username));
    const stranger = as(await loginTestUserWithSession(app, (await createTestUser({ role: (await createTestRole({ permissions: ['storefront.view'] })).code })).username));
    const editor = as(await loginTestUserWithSession(app, (await createTestUser({ role: (await createTestRole({ permissions: ['site_content.view', 'site_content.manage'] })).code })).username));
    const words = (over: Body = {}): Body => ({ name: onSite, intro: '', imageAssetId: null, imageAlt: '', morePageId: null, version: 0, ...over });
    const doors = [
      (await stranger.get('/api/storefront/collections')).status, (await stranger.put('/api/storefront/collections', words({ intro: 'x' }))).status,
      (await viewer.get('/api/storefront/collections')).status, (await viewer.put('/api/storefront/collections', words({ intro: 'x' }))).status,
      (await request(app).get('/api/storefront/collections')).status, (await request(app).get('/api/storefront/v1/collections')).status,
    ].join(',');
    if (doors !== '403,403,200,403,401,401') wrong.push(`the doors: ${doors}`);

    // 2) the list: the collections with an item on the site, none saved yet; the one whose item is not on the site is not there
    const rowsOf = async (who = erp) => (((await who.get('/api/storefront/collections')).body.data ?? []) as Body[]).filter(row => String(row.name).endsWith(tag));
    const first = await rowsOf(viewer);
    const told = first.map(r => `${String(r.name)}:${String(r.count)}:${String(r.version)}:${String(r.intro)}:${String(r.imageAssetId)}:${String(r.morePageId)}`).join('|');
    if (told !== `${second}:1:0::null:null|${onSite}:2:0::null:null`) wrong.push(`the first list: ${told}`);
    const listed = (await erp.get('/api/storefront/collections')).body as { pages?: Array<Body> };
    const pageOption = (listed.pages ?? []).find(p => p.id === pageId);
    if (!pageOption || pageOption.title !== `داستان کاشی ${tag}` || pageOption.live !== false || Object.keys(pageOption).sort().join(',') !== 'id,live,title' || (listed.pages ?? []).some(p => p.id === aboutPage?.id)) {
      wrong.push(`the pages «آشنایی بیشتر» may name: ${JSON.stringify(pageOption)}`);
    }
    if ((await mine()).length !== 0) wrong.push('the site has words before any were written');

    // 3) what is refused, and nothing is written for it
    const control = String.fromCharCode(7);
    const refusals: Array<[string, Body, number, string]> = [
      ['a collection no item of the site carries', words({ name: offSite, intro: 'متن' }), 404, 'STOREFRONT_COLLECTION_NOT_FOUND'],
      ['a name nobody has', words({ name: `ناشناس ${tag}`, intro: 'متن' }), 404, 'STOREFRONT_COLLECTION_NOT_FOUND'],
      ['a field the form does not have', words({ intro: 'متن', isDeleted: 1 }), 400, 'VALIDATION_ERROR'],
      ['an introduction past its length', words({ intro: 'ب'.repeat(1501) }), 422, 'STOREFRONT_COLLECTION_FIELD_INVALID'],
      ['an introduction with a control character', words({ intro: `متن${control}پنهان` }), 422, 'STOREFRONT_COLLECTION_FIELD_INVALID'],
      ['an image that is not a whole number', words({ imageAssetId: 1.5 }), 400, 'VALIDATION_ERROR'],
      ['an image that is not in the library', words({ imageAssetId: 2_000_000_000 }), 422, 'STOREFRONT_COLLECTION_IMAGE_UNKNOWN'],
      ['an image that has left the library', words({ imageAssetId: gone.id }), 422, 'STOREFRONT_COLLECTION_IMAGE_UNKNOWN'],
      ['a page that is not there', words({ intro: 'متن', morePageId: 2_000_000_000 }), 422, 'STOREFRONT_COLLECTION_PAGE_UNKNOWN'],
      ['a base page', words({ intro: 'متن', morePageId: aboutPage?.id ?? 0 }), 422, 'STOREFRONT_COLLECTION_PAGE_UNKNOWN'],
      ['a version for words never saved', words({ intro: 'متن', version: 1 }), 409, 'OCC_CONFLICT'],
    ];
    for (const [what, body, status, code] of refusals) {
      const res = await erp.put('/api/storefront/collections', body);
      if (res.status !== status || res.body.code !== code || (status === 422 && code.includes('IMAGE') && res.body.details?.field !== 'imageAssetId')) wrong.push(`${what}: ${res.status} ${res.body.code} ${JSON.stringify(res.body.details)}`);
    }
    const noImage = await editor.put('/api/storefront/collections', words({ intro: 'متن', imageAssetId: cover.id }));
    if (noImage.status !== 403 || noImage.body.code !== 'STOREFRONT_COLLECTION_IMAGE_FORBIDDEN') wrong.push(`a new image without media.view: ${noImage.status} ${noImage.body.code}`);
    const stored = () => orm.select().from(storefrontCollections).where(like(storefrontCollections.name, `%${tag}`));
    // a save with nothing in it is taken and keeps nothing
    const empty = await erp.put('/api/storefront/collections', words());
    if (empty.status !== 200 || empty.body.data?.version !== 0) wrong.push(`an empty first save: ${empty.status} version ${empty.body.data?.version}`);
    if ((await stored()).length !== 0) wrong.push(`rows after the refusals: ${(await stored()).length}`);

    // 4) the first save makes the row (version 1), keeps the text as the rules shape it, and writes one audit row
    const intro = '  نقش این کالکشن از کاشی هفت‌رنگ است.  \r\n\r\n\r\n\r\nهر قطعه با دست ساخته می‌شود.\nبا <b>نشانه</b>  ';
    const kept = 'نقش این کالکشن از کاشی هفت‌رنگ است.\n\nهر قطعه با دست ساخته می‌شود.\nبا <b>نشانه</b>';
    // the same first save sent six times at once: one is taken, the others are told their copy is stale
    const firstBody = words({ intro, imageAssetId: cover.id, imageAlt: '  ', morePageId: pageId });
    const firsts = await Promise.all([1, 2, 3, 4, 5, 6].map(() => erp.put('/api/storefront/collections', firstBody)));
    const saved = firsts.find(res => res.status === 200) ?? firsts[0];
    if (firsts.map(res => res.status).sort().join(',') !== '200,409,409,409,409,409' || firsts.some(res => res.status === 409 && res.body.code !== 'OCC_CONFLICT')) {
      wrong.push(`six first saves at once: ${firsts.map(res => `${res.status} ${String(res.body.code ?? '')}`).join(', ')}`);
    }
    const data = (saved.body.data ?? {}) as Body;
    if (saved.status !== 200 || data.version !== 1 || data.intro !== kept || data.imageAssetId !== cover.id || data.imageAlt !== '' || data.morePageId !== pageId || data.count !== 2
      || data.imageTitle !== `عکس کالکشن 1 ${tag}` || data.imageUsable !== true || data.morePageTitle !== `داستان کاشی ${tag}` || data.morePageLive !== false
      || Object.keys(data).sort().join(',') !== 'count,imageAlt,imageAssetId,imageTitle,imageUsable,intro,morePageId,morePageLive,morePageTitle,name,version') {
      wrong.push(`the first save: ${saved.status} ${JSON.stringify(saved.body).slice(0, 500)}`);
    }
    const [row] = await orm.select().from(storefrontCollections).where(eq(storefrontCollections.name, onSite));
    const auditOf = (action: string) => orm.select().from(activityLogs).where(and(eq(activityLogs.entity, 'کالکشن سایت'), eq(activityLogs.entityId, `collection-${row?.id}`), eq(activityLogs.action, action))).orderBy(desc(activityLogs.id));
    const created = await auditOf('CREATE');
    if (!row || row.version !== 1 || created.length !== 1 || !JSON.stringify(created[0].details).includes('هفت‌رنگ') || !String(created[0].description).includes(onSite)) {
      wrong.push(`the row and its audit: version ${row?.version}, ${created.length} rows, ${String(JSON.stringify(created[0]?.details)).slice(0, 200)}`);
    }

    // 5) the site: only what a visitor sees; the image under its file's key and served; no link while the page is a draft
    const publicKeys = (value: unknown) => Object.keys((value ?? {}) as Body).sort().join(',');
    const [shown] = await mine();
    if ((await mine()).length !== 1 || publicKeys(shown) !== 'image,intro,moreHref,name' || shown.name !== onSite || shown.intro !== kept || shown.moreHref !== ''
      || publicKeys(shown.image) !== 'alt,height,sha256,thumb,width' || (shown.image as Body).sha256 !== cover.sha256 || (shown.image as Body).alt !== `کالکشن ${onSite}` || (shown.image as Body).thumb !== true) {
      wrong.push(`the site's answer: ${JSON.stringify(await mine())}`);
    }
    const whole = JSON.stringify((await site('/collections')).body);
    if (whole.includes('updatedBy') || whole.includes('imageAssetId') || whole.includes('morePageId') || whole.includes('"id"') || whole.includes('version')) wrong.push(`the site's answer carries a field of the ERP: ${whole.slice(0, 300)}`);
    if (await media(cover.sha256) !== '200/200' || await media(other.sha256) !== '404/404') wrong.push(`the image files: chosen ${await media(cover.sha256)}, another of the library ${await media(other.sha256)}`);
    const published = await erp.post(`/api/storefront/pages/${pageId}/publish`, { version: 2 });
    if (published.status !== 200 || (await mine())[0]?.moreHref !== `/pages/${pageSlug}`) wrong.push(`the link once the page is published: ${published.status} ${String((await mine())[0]?.moreHref)}`);
    if ((await rowsOf()).find(r => r.name === onSite)?.morePageLive !== true) wrong.push('the ERP does not say the page is on the site now');
    // the page's own editor is told which collections lead to it, to say so before the page is removed or taken off the site
    const linked = (await erp.get(`/api/storefront/pages/${pageId}`)).body.data?.linkedCollections;
    if (JSON.stringify(linked) !== JSON.stringify([onSite])) wrong.push(`the collections that link to the page: ${JSON.stringify(linked)}`);

    // 6) saving the same words changes nothing; a stale version is refused; a change raises the version and is audited with both sides
    const same = await erp.put('/api/storefront/collections', words({ intro: kept, imageAssetId: cover.id, morePageId: pageId, version: 1 }));
    if (same.status !== 200 || same.body.data?.version !== 1 || (await auditOf('UPDATE')).length !== 0) wrong.push(`the same words saved again: ${same.status} version ${same.body.data?.version}, ${(await auditOf('UPDATE')).length} audit rows`);
    // the editor keeps the image the collection has (no media.view needed) and writes its alternative text
    const change = words({ intro: 'متن تازه', imageAssetId: cover.id, imageAlt: 'کاشی آبی', morePageId: pageId, version: 1 });
    const changes = await Promise.all([1, 2, 3, 4].map(() => editor.put('/api/storefront/collections', change)));
    const changed = changes.find(res => res.status === 200) ?? changes[0];
    const updates = await auditOf('UPDATE');
    if (changes.map(res => res.status).sort().join(',') !== '200,409,409,409') wrong.push(`four changes at once: ${changes.map(res => res.status).join(',')}`);
    if (changed.status !== 200 || changed.body.data?.version !== 2 || updates.length !== 1 || !JSON.stringify(updates[0].details).includes('هفت‌رنگ') || !JSON.stringify(updates[0].details).includes('متن تازه')) {
      wrong.push(`a change by the editor: ${changed.status} version ${changed.body.data?.version}, ${updates.length} audit rows`);
    }
    const stale = await erp.put('/api/storefront/collections', words({ intro: 'متن کهنه', imageAssetId: cover.id, morePageId: pageId, version: 1 }));
    if (stale.status !== 409 || stale.body.code !== 'OCC_CONFLICT' || (await stored())[0]?.intro !== 'متن تازه') wrong.push(`a stale save: ${stale.status}, kept «${String((await stored())[0]?.intro)}»`);
    if ((await mine())[0]?.intro !== 'متن تازه' || ((await mine())[0]?.image as Body)?.alt !== 'کاشی آبی') wrong.push(`the site after the change: ${JSON.stringify((await mine())[0])}`);

    // 7) an image alone shows; a link alone shows nothing; an image that left the library is not sent, and its file is not served
    const imageOnly = await erp.put('/api/storefront/collections', words({ name: second, imageAssetId: other.id, imageAlt: 'فیروزه' }));
    const afterSecond = (await mine()).find(r => r.name === second);
    if (imageOnly.status !== 200 || !afterSecond || afterSecond.intro !== '' || (afterSecond.image as Body)?.sha256 !== other.sha256 || await media(other.sha256) !== '200/200') wrong.push(`an image alone: ${imageOnly.status} ${JSON.stringify(afterSecond)}`);
    // the same row while its image has left the library: nothing is left to show, so the site gets nothing of it; and
    // a small version the library does not have is not served
    await orm.update(mediaAssets).set({ isDeleted: 1 }).where(eq(mediaAssets.id, other.id));
    const lostImage = (await mine()).some(r => r.name === second);
    const lostChip = (await rowsOf()).find(r => r.name === second)?.imageUsable;
    await orm.update(mediaAssets).set({ isDeleted: 0, thumbBytes: null }).where(eq(mediaAssets.id, other.id));
    const noThumb = { files: await media(other.sha256), flag: ((await mine()).find(r => r.name === second)?.image as Body | undefined)?.thumb };
    await orm.update(mediaAssets).set({ thumbBytes: 12 }).where(eq(mediaAssets.id, other.id));
    if (lostImage || lostChip !== false || noThumb.files !== '200/404' || noThumb.flag !== false) wrong.push(`an image alone that left the library: on the site ${lostImage}, usable ${String(lostChip)}; with no small version: ${JSON.stringify(noThumb)}`);
    const linkOnly = await erp.put('/api/storefront/collections', words({ name: second, morePageId: pageId, version: 1 }));
    if (linkOnly.status !== 200 || linkOnly.body.data?.version !== 2 || (await mine()).some(r => r.name === second) || await media(other.sha256) !== '404/404') {
      wrong.push(`a link alone: ${linkOnly.status}, on the site ${(await mine()).some(r => r.name === second)}, the old image ${await media(other.sha256)}`);
    }
    await orm.update(mediaAssets).set({ isDeleted: 1 }).where(eq(mediaAssets.id, cover.id));
    const afterGone = (await mine()).find(r => r.name === onSite);
    const goneRow = (await rowsOf()).find(r => r.name === onSite);
    if (!afterGone || afterGone.image !== null || afterGone.intro !== 'متن تازه' || await media(cover.sha256) !== '404/404' || goneRow?.imageUsable !== false) {
      wrong.push(`an image that left the library: ${JSON.stringify(afterGone)}, file ${await media(cover.sha256)}, usable ${String(goneRow?.imageUsable)}`);
    }
    await orm.update(mediaAssets).set({ isDeleted: 0 }).where(eq(mediaAssets.id, cover.id));

    // 8) a collection whose items have left the site: nothing of it on the site, its words kept and still editable in the ERP
    for (const item of made.filter(m => m.collection === onSite)) await publish(item.id, false, item.slug);
    const left = (await rowsOf()).find(r => r.name === onSite);
    if ((await mine()).some(r => r.name === onSite) || await media(cover.sha256) !== '404/404' || !left || left.count !== 0 || left.intro !== 'متن تازه') {
      wrong.push(`a collection whose items left the site: on the site ${(await mine()).some(r => r.name === onSite)}, file ${await media(cover.sha256)}, in the ERP ${JSON.stringify(left)}`);
    }
    const stillEdits = await erp.put('/api/storefront/collections', words({ intro: 'متن برای بازگشت', imageAssetId: cover.id, version: 2 }));
    if (stillEdits.status !== 200 || stillEdits.body.data?.version !== 3 || stillEdits.body.data?.morePageId !== null) wrong.push(`editing it meanwhile: ${stillEdits.status} ${JSON.stringify(stillEdits.body.data)}`);
    await publish(made[0].id, true, made[0].slug);
    const back = (await mine()).find(r => r.name === onSite);
    if (!back || back.intro !== 'متن برای بازگشت' || back.moreHref !== '' || await media(cover.sha256) !== '200/200') wrong.push(`the collection back on the site: ${JSON.stringify(back)}`);

    // taking the page off the site records the collection whose link leaves with it, and the site gets no link
    await erp.put('/api/storefront/collections', words({ intro: 'متن برای بازگشت', imageAssetId: cover.id, morePageId: pageId, version: 3 }));
    const pageVersion = Number((await erp.get(`/api/storefront/pages/${pageId}`)).body.data?.version);
    const taken = await erp.post(`/api/storefront/pages/${pageId}/unpublish`, { version: pageVersion });
    const [pageAudit] = await orm.select().from(activityLogs).where(and(eq(activityLogs.entity, 'صفحهٔ سایت'), eq(activityLogs.entityId, `page-${pageId}`))).orderBy(desc(activityLogs.id)).limit(1);
    // both collections name the page by now (the second since its link-only save)
    const recorded = ((pageAudit?.details ?? {}) as { linkedFromCollections?: string[] }).linkedFromCollections ?? [];
    if (taken.status !== 200 || [...recorded].sort().join('|') !== [onSite, second].sort().join('|') || (await mine()).find(r => r.name === onSite)?.moreHref !== '') {
      wrong.push(`taking the linked page off the site: ${taken.status}, audit ${String(JSON.stringify(pageAudit?.details)).slice(0, 200)}, link «${String((await mine()).find(r => r.name === onSite)?.moreHref)}»`);
    }

    // 9) the rules of migration 0035 hold against a direct write
    const direct: Array<[string, () => Promise<unknown>]> = [
      ['a second row for one name', () => orm.insert(storefrontCollections).values({ name: onSite })],
      ['an empty name', () => orm.insert(storefrontCollections).values({ name: '' })],
      ['an introduction past its length', () => orm.insert(storefrontCollections).values({ name: `دراز ${tag}`, intro: 'ب'.repeat(1501) })],
      ['an alternative text past its length', () => orm.insert(storefrontCollections).values({ name: `جایگزین ${tag}`, imageAlt: 'ب'.repeat(121) })],
      ['a version of zero', () => orm.execute(sql`UPDATE storefront_collections SET version = 0 WHERE name = ${onSite}`)],
      ['an image that does not exist', () => orm.insert(storefrontCollections).values({ name: `بی‌عکس ${tag}`, imageAssetId: 2_000_000_000 })],
      ['a page that does not exist', () => orm.insert(storefrontCollections).values({ name: `بی‌صفحه ${tag}`, morePageId: 2_000_000_000 })],
    ];
    for (const [what, write] of direct) {
      const refused = await write().then(() => false, () => true);
      if (!refused) wrong.push(`a direct write of ${what} was taken`);
    }

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: ((told: string) => (wrong.length > 0 && told !== wrong.join('; ') ? `${wrong.join('; ')}; ${told}` : told))(err instanceof Error ? err.message : String(err)),
    }));
  } finally {
    for (const file of files) {
      await fs.rm(file, { force: true }).catch(() => undefined);
      await fs.rmdir(path.dirname(file)).catch(() => undefined);
    }
    await orm.delete(storefrontCollections).where(like(storefrontCollections.name, `%${tag}`)).catch(() => undefined);
    if (pageIds.length > 0) await orm.delete(storefrontPages).where(inArray(storefrontPages.id, pageIds)).catch(() => undefined);
    if (itemIds.length > 0) {
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
