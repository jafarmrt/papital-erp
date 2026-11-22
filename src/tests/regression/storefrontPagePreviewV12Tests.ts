import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { and, desc, eq, inArray, like } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, appSettings, mediaAssets, mediaSections, storefrontContentAssets, storefrontPages } from '../../db/schema.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { readPricingStrategies } from '../../lib/items/pricingStrategies.js';
import { mediaFilePath } from '../../lib/media/mediaPaths.js';
import { STOREFRONT_SITE_ORIGIN } from '../../lib/storefront/storefrontBuyerRules.js';

/**
 * v12 phase 10c («پیش‌نمایش», migration 0031; docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2, `AGENTS.md` §1.9c): the
 * one-hour link to a page's draft, on real Express routes, PostgreSQL and files on disk. The key of the link is only
 * in the answer that makes it: the database keeps its SHA-256, and no audit row has either. Under the key the site
 * gets the saved draft in the shape of a published page (always `noindex`, no id of the library or of a row) and the
 * images that draft names (the site sends the key in `X-Preview-Key`, so no log of the ERP has it); without the key,
 * after the hour, after a newer link, or for a removed page, nothing: the
 * draft stays off the site's own page and image routes. Making a link needs `site_content.manage` and leaves the page's
 * version as it is.
 */
interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;

export async function runStorefrontPagePreviewV12Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_page_preview_v12_p10c';
  if (!shouldRun(id, 'v12', 'phase10', 'storefront', 'pages', 'preview', 'migration', 'security')) return results;

  const name = 'v12 phase 10c: a preview link shows a page\'s saved draft and its images only under its key and for an hour, keeps only the key\'s hash, and leaves the site\'s own routes closed to the draft';
  const tStart = Date.now();
  const pageIds: number[] = [];
  const assetIds: number[] = [];
  const files: string[] = [];
  let sectionId = 0;
  const savedSettings = await orm.select().from(appSettings).where(like(appSettings.key, 'sf\\_%'));
  const savedStrategies = await orm.select().from(appSettings).where(eq(appSettings.key, 'pricing_strategies'));
  const aboutBefore = (await orm.select().from(storefrontPages).where(and(eq(storefrontPages.slug, 'about'), eq(storefrontPages.isDeleted, 0))))[0];
  try {
    const { getTestApp, getAdminSession, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestRole, createTestUser } = await import('../fixtures/factories.js');
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
    const keys = (value: unknown) => Object.keys((value ?? {}) as Body).sort().join(',');

    const retailList = `تکی پیش‌نمایش ${tag}`;
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
    // the preview's key goes in a header, never in the address
    const preview = (key: string) => site('/page-preview').set('X-Preview-Key', key);
    const previewImage = (key: string, file: string) => site(`/page-preview/media/${file}`).set('X-Preview-Key', key);

    // two images of the library with files on the disk (one without a small version) and a third the draft does not name
    const [section] = await orm.insert(mediaSections).values({ kind: 'custom', title: `عکس‌های پیش‌نمایش ${tag}` }).returning({ id: mediaSections.id });
    sectionId = section.id;
    const image = async (n: number) => {
      const sha256 = `${String(n).repeat(8)}${tag}`.padEnd(64, 'd').slice(0, 64);
      const [asset] = await orm.insert(mediaAssets).values({
        sectionId, kind: 'image', title: `عکس پیش‌نمایش ${n} ${tag}`, originalName: `preview-${n}.jpg`, mimeType: 'image/jpeg', sizeBytes: 1000,
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
    const [inHero, inText, unnamed] = [await image(1), await image(2), await image(3)];

    const slug = `preview-story-${tag}`;
    const title = `پیش‌نویس دیدنی ${tag}`;
    const created = await erp.post('/api/storefront/pages', { title, slug, template: null });
    if (created.status !== 201) throw new Error(`a new page: ${created.status} ${JSON.stringify(created.body)}`);
    const pageId = Number(created.body.data.id);
    pageIds.push(pageId);
    const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    const sections = (words: string) => [
      { kind: 'hero', background: 'brand', title: 'به‌زودی', text: words, imageAssetId: inHero.id, buttonLabel: '', buttonHref: '' },
      { kind: 'text', background: 'white', doc: { type: 'doc', content: [p('متن پیش‌نویس'), { type: 'libraryImage', attrs: { assetId: inText.id, alt: 'میز کار' } }] } },
    ];
    const form = (version: number, words: string) => ({ title, slug, seoTitle: '', seoDescription: '', noindex: false, shareImageAssetId: null, sections: sections(words), version });
    const saved = await erp.put(`/api/storefront/pages/${pageId}`, form(1, 'نخستین متن'));
    if (saved.status !== 200) throw new Error(`saving the draft: ${saved.status} ${JSON.stringify(saved.body)}`);

    // 1) who may make a link, and what the answer and the database hold
    const viewer = as(await loginTestUserWithSession(app, (await createTestUser({ role: (await createTestRole({ permissions: ['site_content.view'] })).code })).username));
    const byViewer = await viewer.post(`/api/storefront/pages/${pageId}/preview`);
    const unknownPage = await erp.post('/api/storefront/pages/2000000000/preview');
    // a body is not read: a link is asked for with an empty one (asked of a page that is not there, so a wrong answer makes no link)
    const withBody = await erp.post('/api/storefront/pages/2000000000/preview', { title: 'x' });
    if (byViewer.status !== 403 || unknownPage.status !== 404 || withBody.status !== 400) wrong.push(`the view key, an unknown page, and a link asked for with a body: ${byViewer.status}/${unknownPage.status}/${withBody.status}`);
    const before = Date.now();
    const made = await erp.post(`/api/storefront/pages/${pageId}/preview`);
    const link = (made.body.data ?? {}) as { path?: string; url?: string; expiresAt?: string };
    const token = String(link.path ?? '').slice('/preview/'.length);
    const lasts = Date.parse(String(link.expiresAt)) - before;
    if (made.status !== 201 || keys(link) !== 'addressSet,expiresAt,path,url' || (link as Body).addressSet !== false || !/^\/preview\/[A-Za-z0-9_-]{43}$/.test(String(link.path)) || link.url !== `${STOREFRONT_SITE_ORIGIN}${link.path}`
      || !(lasts > 58 * 60_000 && lasts < 62 * 60_000)) {
      wrong.push(`the link: ${made.status} ${JSON.stringify({ ...link, path: String(link.path).length, url: String(link.url).slice(0, 30) })} lasts ${Math.round(lasts / 60_000)} min`);
    }
    const [row] = await orm.select().from(storefrontPages).where(eq(storefrontPages.id, pageId));
    const hash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
    if (row.previewHash !== hash || JSON.stringify(row).includes(token) || row.version !== 2) wrong.push(`the stored link: hash ${row.previewHash === hash}, key in the row ${JSON.stringify(row).includes(token)}, version ${row.version}`);
    const [audit] = await orm.select().from(activityLogs).where(eq(activityLogs.entityId, `page-${pageId}`)).orderBy(desc(activityLogs.id)).limit(1);
    const auditText = JSON.stringify(audit);
    if (!String(audit?.description).includes('پیش‌نمایش') || auditText.includes(token) || auditText.includes(hash)) wrong.push(`the audit row of the link: ${auditText.slice(0, 300)}`);

    // 2) under the key: the draft in the shape of a page of the site, never to be listed, with no id anywhere
    const read = await preview(token);
    const page = (read.body.data ?? {}) as { sections?: Array<Record<string, unknown>> } & Body;
    if (read.status !== 200 || keys(page) !== 'expiresAt,kind,noindex,sections,seoDescription,seoTitle,shareImage,slug,title,updatedAt' || read.headers['cache-control'] !== 'no-store') {
      wrong.push(`the preview's fields: ${read.status} ${keys(page)} cache «${read.headers['cache-control']}»`);
    }
    const got = page.sections ?? [];
    const doc = got[1]?.doc as { content?: Array<{ type: string; attrs?: Body }> } | undefined;
    if (page.title !== title || page.noindex !== true || page.expiresAt !== link.expiresAt || got.map(s => s.kind).join(',') !== 'hero,text' || got[0]?.text !== 'نخستین متن'
      || (got[0]?.image as Body)?.sha256 !== inHero.sha256 || doc?.content?.[1]?.attrs?.sha256 !== inText.sha256) {
      wrong.push(`the preview's values: ${JSON.stringify(page).slice(0, 500)}`);
    }
    const text = JSON.stringify(read.body);
    for (const leak of ['assetId', 'imageAssetId', '"id"', 'version', 'updatedBy', 'createdBy', 'previewHash', hash, token]) {
      if (text.includes(leak)) wrong.push(`the preview carries «${leak}»`);
    }

    // 3) the draft is still not on the site: its page and its images are 404 on the site's own routes, and its images are
    // read only under the key (the small version only where there is one; an image the draft does not name never)
    const publicPage = await site(`/pages/${slug}`);
    const publicImage = await site(`/media/${inHero.sha256}.webp`);
    const light = await previewImage(token, `${inHero.sha256}.webp`);
    const thumb = await previewImage(token, `${inHero.sha256}-thumb.webp`);
    const inTextLight = await previewImage(token, `${inText.sha256}.webp`);
    const inTextThumb = await previewImage(token, `${inText.sha256}-thumb.webp`);
    const notNamed = await previewImage(token, `${unnamed.sha256}.webp`);
    const badName = await previewImage(token, `..%2F..%2Fpackage.json`);

    if (publicPage.status !== 404 || publicImage.status !== 404) wrong.push(`the draft on the site's own routes: page ${publicPage.status}, image ${publicImage.status}`);
    if (light.status !== 200 || light.headers['content-type'] !== 'image/webp' || light.headers['cache-control'] !== 'no-store' || String(light.body) !== 'webp-light-1') {
      wrong.push(`a preview image: ${light.status} ${light.headers['content-type']} cache «${light.headers['cache-control']}»`);
    }
    if (thumb.status !== 200 || inTextLight.status !== 200 || inTextThumb.status !== 404 || notNamed.status !== 404 || badName.status !== 404) {
      wrong.push(`the preview's other images: ${thumb.status}/${inTextLight.status}/${inTextThumb.status}/${notNamed.status}/${badName.status}`);
    }

    // 4) the door: the site's key is needed too; a key in another shape, an unknown one and one letter off are the same 404
    const noSiteKey = await request(app).get('/api/storefront/v1/page-preview').set('X-Preview-Key', token);
    const offByOne = `${token.slice(0, 42)}${token.endsWith('A') ? 'B' : 'A'}`;
    const refusals = await Promise.all([offByOne, 'short', `${token}x`, hash, ''].map(t => preview(t)));
    // the key in the address, as it once was, opens nothing: no route reads it there
    const inAddress = await site(`/page-previews/${token}`);
    const noHeader = await site('/page-preview');
    const unknownImage = await previewImage(offByOne, `${inHero.sha256}.webp`);
    if (noSiteKey.status !== 401 || refusals.some(r => r.status !== 404) || unknownImage.status !== 404 || ![401, 404].includes(inAddress.status) || noHeader.status !== 404) {
      wrong.push(`the door: ${noSiteKey.status} / ${refusals.map(r => r.status).join(',')} / ${unknownImage.status} / ${inAddress.status} / ${noHeader.status}`);
    }
    if (refusals.some(r => r.body.code !== 'STOREFRONT_PAGE_PREVIEW_NOT_FOUND' || r.body.error !== refusals[0].body.error)) {
      wrong.push(`the refusal's words: ${JSON.stringify(refusals[0].body)} / ${JSON.stringify(refusals[1].body)}`);
    }

    // 5) a draft saved later shows at once, under the same link; publishing changes nothing about the link, which shows the draft
    const later = await erp.put(`/api/storefront/pages/${pageId}`, form(2, 'متن تازه'));
    const afterSave = (await preview(token)).body.data as { sections: Array<Record<string, unknown>> };
    if (later.status !== 200 || afterSave.sections[0].text !== 'متن تازه') wrong.push(`a later draft in the same preview: ${later.status} ${JSON.stringify(afterSave.sections[0]).slice(0, 120)}`);
    const publishedNow = await erp.post(`/api/storefront/pages/${pageId}/publish`, { version: 3 });
    const draftAfter = await erp.put(`/api/storefront/pages/${pageId}`, form(4, 'پیش‌نویس پس از انتشار'));
    const [onSiteNow, inPreview] = [(await site(`/pages/${slug}`)).body.data, (await preview(token)).body.data] as Array<{ sections: Array<Record<string, unknown>>; noindex: boolean }>;
    // once published, the page's image is an image of the site: kept for a long time there, never under the preview's key
    const [siteImage, keyImage] = [await site(`/media/${inHero.sha256}.webp`), await previewImage(token, `${inHero.sha256}.webp`)];
    if (siteImage.status !== 200 || siteImage.headers['cache-control'] !== 'private, max-age=31536000, immutable' || siteImage.headers['x-content-type-options'] !== 'nosniff' || keyImage.headers['cache-control'] !== 'no-store') {
      wrong.push(`a published page's image: ${siteImage.status} cache «${siteImage.headers['cache-control']}», under the key «${keyImage.headers['cache-control']}»`);
    }
    if (publishedNow.status !== 200 || draftAfter.status !== 200 || onSiteNow.sections[0].text !== 'متن تازه' || inPreview.sections[0].text !== 'پیش‌نویس پس از انتشار' || onSiteNow.noindex !== false || inPreview.noindex !== true) {
      wrong.push(`the site and the preview after publishing: «${onSiteNow?.sections?.[0]?.text}» / «${inPreview?.sections?.[0]?.text}»`);
    }

    // 6) a new link ends the old one, and starts with the site's address written in the search settings
    const seo = (await erp.get('/api/storefront/seo')).body.data as Body;
    const seoSaved = await erp.put('/api/storefront/seo', { ...seo, siteUrl: ' https://test-site.example/ ' });
    const second = await erp.post(`/api/storefront/pages/${pageId}/preview`);
    const secondLink = second.body.data as { path: string; url: string; addressSet: boolean };
    const secondToken = secondLink.path.slice('/preview/'.length);
    const [oldNow, oldImage, newNow] = [await preview(token), await previewImage(token, `${inHero.sha256}.webp`), await preview(secondToken)];
    if (seoSaved.status !== 200 || seoSaved.body.data.siteUrl !== 'https://test-site.example' || second.status !== 201 || secondToken === token || secondLink.addressSet !== true || secondLink.url !== `https://test-site.example/preview/${secondToken}`) {
      wrong.push(`the second link: seo ${seoSaved.status} «${seoSaved.body.data?.siteUrl}», ${second.status} ${String(secondLink?.url).slice(0, 40)}`);
    }
    if (oldNow.status !== 404 || oldImage.status !== 404 || newNow.status !== 200) wrong.push(`the old and the new link: ${oldNow.status}/${oldImage.status}/${newNow.status}`);
    // a search settings form opened before this field existed sends no address: the saved one stays; one with a path is refused
    const { siteUrl: _left, ...olderForm } = seoSaved.body.data as Body;
    const [keptAddress, withPath] = [await erp.put('/api/storefront/seo', { ...olderForm, googleVerification: 'kept_1' }), await erp.put('/api/storefront/seo', { ...seoSaved.body.data, siteUrl: 'https://test-site.example/shop' })];
    if (keptAddress.status !== 200 || keptAddress.body.data.siteUrl !== 'https://test-site.example' || withPath.status !== 422) {
      wrong.push(`the address after an older form, and one with a path: ${keptAddress.status} «${keptAddress.body.data?.siteUrl}» / ${withPath.status}`);
    }
    // an image removed from the library is no longer read, though the draft still names it
    await orm.update(mediaAssets).set({ isDeleted: 1 }).where(eq(mediaAssets.id, inText.id));
    const removedImage = await previewImage(secondToken, `${inText.sha256}.webp`);
    await orm.update(mediaAssets).set({ isDeleted: 0 }).where(eq(mediaAssets.id, inText.id));
    if (removedImage.status !== 404) wrong.push(`an image removed from the library, under the key: ${removedImage.status}`);
    // the site's address is the ERP's own business: the site is not sent it
    const publicSeo = await site('/seo');
    if (JSON.stringify(publicSeo.body).includes('test-site.example') || keys(publicSeo.body.data) !== 'alternateSiteUrl,analytics,verification') wrong.push(`the site's address went out: ${JSON.stringify(publicSeo.body)}`);

    // 7) a base page has a preview too, though it is not published
    if (aboutBefore) {
      const aboutLink = await erp.post(`/api/storefront/pages/${aboutBefore.id}/preview`);
      const aboutRead = await preview(String(aboutLink.body.data?.path).slice('/preview/'.length));
      if (aboutLink.status !== 201 || aboutRead.status !== 200 || aboutRead.body.data.kind !== 'base' || aboutRead.body.data.slug !== 'about') wrong.push(`a base page's preview: ${aboutLink.status}/${aboutRead.status}`);
    }

    // 8) after its hour the link opens nothing, the page and the images alike; and a removed page has no preview
    await orm.update(storefrontPages).set({ previewExpiresAt: new Date(Date.now() - 1000).toISOString() }).where(eq(storefrontPages.id, pageId));
    const [ended, endedImage] = [await preview(secondToken), await previewImage(secondToken, `${inHero.sha256}.webp`)];
    if (ended.status !== 404 || endedImage.status !== 404 || ended.body.code !== 'STOREFRONT_PAGE_PREVIEW_NOT_FOUND') wrong.push(`an ended link: ${ended.status}/${endedImage.status} ${ended.body.code}`);
    const third = await erp.post(`/api/storefront/pages/${pageId}/preview`);
    const thirdToken = String(third.body.data?.path).slice('/preview/'.length);
    const detail = await erp.get(`/api/storefront/pages/${pageId}`);
    if (/previewHash|previewExpiresAt|preview_hash/.test(JSON.stringify(detail.body)) || JSON.stringify(detail.body).includes(thirdToken)) wrong.push('the page\'s detail in the ERP carries the preview\'s hash or time');
    const removed = await erp.del(`/api/storefront/pages/${pageId}?version=${Number(detail.body.data.version)}`);
    const afterRemoval = await preview(thirdToken);
    const linkOfRemoved = await erp.post(`/api/storefront/pages/${pageId}/preview`);
    if (third.status !== 201 || ![200, 204].includes(removed.status) || afterRemoval.status !== 404 || linkOfRemoved.status !== 404) {
      wrong.push(`a removed page's preview: ${third.status}/${removed.status}/${afterRemoval.status}, a new link for it ${linkOfRemoved.status}`);
    }
    // a copy of the data carries neither the hash of a link nor its end
    const { DATA_EXPORT_TABLE_SOURCES } = await import('../../services/system/dataExportSources.js');
    const exported = Object.keys((DATA_EXPORT_TABLE_SOURCES as Record<string, { columns?: Record<string, unknown> }>).storefront_pages?.columns ?? {});
    if (exported.length === 0 || exported.some(c => /preview/i.test(c)) || !exported.includes('sections')) wrong.push(`the exported columns of a page: ${exported.join(',')}`);

    // 9) the constraints of migration 0031, against a direct write
    const direct = async (values: Partial<typeof storefrontPages.$inferInsert>) => orm.update(storefrontPages).set(values).where(eq(storefrontPages.id, pageId)).then(() => 'written', () => 'refused');
    const soon = new Date(Date.now() + 60_000).toISOString();
    const checks: Array<[string, string, string]> = [
      ['a hash without a time', await direct({ previewHash: 'a'.repeat(64), previewExpiresAt: null }), 'refused'],
      ['a time without a hash', await direct({ previewHash: null, previewExpiresAt: soon }), 'refused'],
      ['a key in place of its hash', await direct({ previewHash: thirdToken, previewExpiresAt: soon }), 'refused'],
      ['both empty', await direct({ previewHash: null, previewExpiresAt: null }), 'written'],
      // the constraint of 0029 that 0031 replaced: a time of publishing without a published copy
      ['a time of publishing without a copy', await direct({ published: null, publishedAt: soon }), 'refused'],
      ['a hash and a time', await direct({ previewHash: 'b'.repeat(64), previewExpiresAt: soon }), 'written'],
    ];
    for (const [what, got2, want] of checks) if (got2 !== want) wrong.push(`constraint, ${what}: ${got2}`);
    if (aboutBefore) {
      const twice = await orm.update(storefrontPages).set({ previewHash: 'b'.repeat(64), previewExpiresAt: soon }).where(eq(storefrontPages.id, aboutBefore.id)).then(() => 'written', () => 'refused');
      if (twice !== 'refused') wrong.push('one hash on two pages was written');
    }

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'the view key could not make a link; the link was a 43-character key under /preview with the site\'s address and an hour to live, the row kept only its SHA-256 and no audit row had either, and the page\'s version stayed; under the key the site got the saved draft as a page marked noindex with no id, and its images (the small version only where there is one), never an image the draft does not name; the draft stayed 404 on the site\'s own page and image routes; a missing site key, a key one letter off and other shapes opened nothing; a later save showed at once and after publishing the link still showed the draft; a new link ended the old one and began with the address of the search settings, which the site is not sent; a base page had a preview; an ended link and a removed page opened nothing; the constraints refused four wrong direct writes (a time of publishing without a copy among them) and one hash on two pages',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    for (const file of files) {
      await fs.rm(file, { force: true }).catch(() => undefined);
      await fs.rmdir(path.dirname(file)).catch(() => undefined);
    }
    if (aboutBefore) await orm.update(storefrontPages).set(aboutBefore).where(eq(storefrontPages.id, aboutBefore.id)).catch(() => undefined);
    if (pageIds.length > 0) {
      await orm.delete(storefrontContentAssets).where(and(eq(storefrontContentAssets.contentKind, 'page'), inArray(storefrontContentAssets.contentId, pageIds))).catch(() => undefined);
      await orm.delete(storefrontPages).where(inArray(storefrontPages.id, pageIds)).catch(() => undefined);
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
