import request from 'supertest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { and, desc, eq, inArray, like } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import {
  activityLogs, appSettings, itemPrices, items, mediaAssets, mediaSections, storefrontCollections, storefrontContentAssets, storefrontNews, storefrontPages,
  storefrontProducts,
} from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { readPricingStrategies } from '../../lib/items/pricingStrategies.js';
import { mediaFilePath } from '../../lib/media/mediaPaths.js';
import { money } from '../../lib/money.js';
import { HOME_PAGE_SLUG, emptyHomeSection, todayHomeSections } from '../../lib/storefront/storefrontPageRules.js';

/**
 * v12 phase 10e, part 2 (migration 0036, docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): «صفحهٔ اصلی» on real Express
 * routes and PostgreSQL. The migration's one home row is there, unpublished, and until it is published the site's
 * `GET /v1/home` is 404 (and the row is never among `/v1/pages`). It is saved and published by the page builder's own
 * routes, takes the parts of the home page (no other page does), a part switched off and links chosen as in the menus;
 * unsafe or unknown content is refused by name and an unfinished part only at «انتشار» (never a part switched off).
 * The site gets the published copy built for today: no part switched off, no slide outside its days or without its
 * image, a button without its address while its target is off the site, the words of «کالکشن‌های سایت», the newest
 * news, and no id, draft or editor. The row is never removed, moved or doubled.
 */
interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;

export async function runStorefrontHomeV12Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_home_v12_p10e';
  if (!shouldRun(id, 'v12', 'phase10', 'storefront', 'home', 'migration', 'security')) return results;

  const name = 'v12 phase 10e: the home page is built and published like a page, takes its own parts and links, reaches the site only as it shows today, and its draft is previewed under a link\'s key alone';
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
  const [savedHome] = await orm.select().from(storefrontPages).where(eq(storefrontPages.slug, HOME_PAGE_SLUG));
  try {
    if (!savedHome || savedHome.kind !== 'home' || savedHome.published !== null) throw new Error(`the home row of migration 0036: ${JSON.stringify(savedHome && { kind: savedHome.kind, published: savedHome.published !== null })}`);
    const homeId = savedHome.id;
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

    const retailList = `تکی خانه ${tag}`;
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
    const home = async () => (await site('/home')).body.data as { sections?: Body[] } & Body | undefined;
    const kindsOnSite = async () => ((await home())?.sections ?? []).map(section => String(section.kind)).join(',');

    // a collection with four items on the site (with words of its own), and a product that will leave the site
    const collection = `کاشی‌های خانه ${tag}`;
    const versions = new Map<number, number>();
    const publishItem = async (itemId: number, published: boolean, slug: string) => {
      const res = await erp.put(`/api/storefront/products/${itemId}`, { published, slug, seoTitle: '', seoDescription: '', sortOrder: 1, version: versions.get(itemId) ?? 0 });
      if (res.status !== 200) throw new Error(`putting item ${itemId} ${published ? 'on' : 'off'} the site: ${res.status} ${JSON.stringify(res.body)}`);
      versions.set(itemId, Number(res.body.data?.version ?? (versions.get(itemId) ?? 0) + 1));
    };
    const slugs: string[] = [];
    for (const n of [1, 2, 3, 4, 5]) {
      const item = await createTestItem({ name: `گردنبند خانه ${n} ${tag}`, code: `SF-HM${n}-${tag}`, collections: n <= 4 ? [collection] : [] });
      itemIds.push(item.id);
      await orm.insert(itemPrices).values({ itemId: item.id, title: retailList, price: money('4000000'), currency: 'IRR' });
      slugs.push(`home-item-${n}-${tag}`);
      await publishItem(item.id, true, slugs[n - 1]);
    }
    const leaving = { id: itemIds[4], slug: slugs[4] };

    const [section] = await orm.insert(mediaSections).values({ kind: 'custom', title: `عکس‌های خانه ${tag}` }).returning({ id: mediaSections.id });
    sectionId = section.id;
    const image = async (n: number, isDeleted = 0) => {
      const sha256 = `${String(n).repeat(8)}${tag}`.padEnd(64, 'd').slice(0, 64);
      const [asset] = await orm.insert(mediaAssets).values({
        sectionId, kind: 'image', title: `عکس خانه ${n} ${tag}`, originalName: `home-${n}.jpg`, mimeType: 'image/jpeg', sizeBytes: 1000,
        sha256, width: 1600, height: 600, lightBytes: 12, thumbBytes: 12, isDeleted,
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
    const [wide, tall, bannerImage, collectionImage, lost, offImage] = [await image(1), await image(2), await image(3), await image(4), await image(5), await image(6)];
    const words = await erp.put('/api/storefront/collections', { name: collection, intro: 'نقش این کالکشن از کاشی هفت‌رنگ است.', imageAssetId: collectionImage.id, imageAlt: 'کاشی', morePageId: null, version: 0 });
    if (words.status !== 200) throw new Error(`the words of the collection: ${words.status} ${JSON.stringify(words.body)}`);

    // a page of the shop and a news item, to link to
    const pageSlug = `home-story-${tag}`;
    const page = await erp.post('/api/storefront/pages', { title: `داستان خانه ${tag}`, slug: pageSlug, template: null });
    const pageId = Number(page.body.data?.id);
    pageIds.push(pageId);
    const button = { kind: 'button', background: 'white', label: 'محصولات', href: '/products' };
    await erp.put(`/api/storefront/pages/${pageId}`, { title: `داستان خانه ${tag}`, slug: pageSlug, seoTitle: '', seoDescription: '', noindex: false, shareImageAssetId: null, sections: [button], version: 1 });
    const text = (line: string) => ({ kind: 'text', background: 'white', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: line }] }] } });
    const today = await businessTodayIsoDate();
    const news = await erp.post('/api/storefront/news', { title: `خبر خانه ${tag}`, slug: `home-news-${tag}` });
    const newsId = Number(news.body.data?.id);
    await erp.put(`/api/storefront/news/${newsId}`, { title: `خبر خانه ${tag}`, slug: `home-news-${tag}`, summary: '', coverAssetId: null, newsDate: '2020-01-01', seoTitle: '', seoDescription: '', sections: [text('متن خبر')], version: 1 });
    const newsOut = await erp.post(`/api/storefront/news/${newsId}/publish`, { version: 2 });
    if (page.status !== 201 || news.status !== 201 || newsOut.status !== 200) throw new Error(`a page and a news item to link to: ${page.status}/${news.status}/${newsOut.status}`);

    // 1) the row of the migration: first in the list, a draft, and not on the site in any way
    const list = ((await erp.get('/api/storefront/pages')).body.data ?? []) as Body[];
    const first = list[0];
    if (first?.id !== homeId || first.kind !== 'home' || first.slug !== HOME_PAGE_SLUG || first.status !== 'draft' || list.filter(row => row.kind === 'home').length !== 1) wrong.push(`the home row in the list: ${JSON.stringify(first)}`);
    const before = await site('/home');
    const listed = ((await site('/pages')).body.data ?? []) as Body[];
    if (before.status !== 404 || before.body.code !== 'STOREFRONT_HOME_NOT_PUBLISHED' || listed.some(row => row.slug === HOME_PAGE_SLUG) || (await site(`/pages/${HOME_PAGE_SLUG}`)).status !== 404
      || (await request(app).get('/api/storefront/v1/home')).status !== 401) {
      wrong.push(`the site before the home page is published: ${before.status} ${before.body.code}, listed ${listed.some(row => row.slug === HOME_PAGE_SLUG)}`);
    }

    // 2) what a save refuses, by name; nothing of it is kept
    let version = Number(savedHome.version);
    const form = (sections: unknown[], over: Body = {}): Body => ({ title: 'صفحهٔ اصلی', slug: HOME_PAGE_SLUG, seoTitle: '', seoDescription: '', noindex: false, shareImageAssetId: null, sections, version, ...over });
    const slide = (over: Body = {}): Body => ({ imageAssetId: wide.id, mobileImageAssetId: null, imageAlt: 'کاشی آبی', title: 'تیتر', text: '', buttonLabel: '', link: null, startsOn: '', endsOn: '', ...over });
    const slider = (...slides: Body[]): Body => ({ kind: 'slider', background: 'white', slides });
    const linkTo = (kind: string, over: Body = {}): Body => ({ kind, target: '', itemId: null, campaignId: null, pageId: null, newsId: null, ...over });
    const refusals: Array<[string, Body, string]> = [
      ['another address', form([], { slug: 'home' }), 'STOREFRONT_PAGE_SLUG_INVALID'],
      ['hiding from search engines', form([], { noindex: true }), 'STOREFRONT_PAGE_FIELD_INVALID'],
      ['the delivery table', form([{ kind: 'shippingMethods', background: 'white', title: 'ارسال' }]), 'STOREFRONT_PAGE_SECTION_INVALID'],
      ['a part of the home page twice', form([emptyHomeSection('homeWhy'), emptyHomeSection('homeWhy')]), 'STOREFRONT_PAGE_SECTION_INVALID'],
      ['six slides', form([slider(slide(), slide(), slide(), slide(), slide(), slide())]), 'STOREFRONT_PAGE_TOO_MANY'],
      ['an unknown field of a slide', form([slider(slide({ html: '<b>x</b>' }))]), 'STOREFRONT_PAGE_FIELD_UNKNOWN'],
      ['a day that is no day', form([slider(slide({ startsOn: '2026-02-31' }))]), 'STOREFRONT_PAGE_FIELD_INVALID'],
      ['an end before the start', form([slider(slide({ startsOn: '2026-05-02', endsOn: '2026-05-01' }))]), 'STOREFRONT_PAGE_FIELD_INVALID'],
      ['a link of no kind', form([slider(slide({ link: linkTo('none') }))]), 'STOREFRONT_PAGE_LINK_INVALID'],
      ['a link with a script address', form([slider(slide({ link: linkTo('path', { target: 'javascript:alert(1)' }) }))]), 'STOREFRONT_PAGE_LINK_INVALID'],
      ['an outside link that is not https', form([slider(slide({ link: linkTo('url', { target: 'http://example.com' }) }))]), 'STOREFRONT_PAGE_LINK_INVALID'],
      ['a link with a field of its own', form([{ kind: 'banner', background: 'white', imageAssetId: bannerImage.id, mobileImageAssetId: null, imageAlt: 'بنر', link: { ...linkTo('path', { target: '/products' }), onclick: 'x' } }]), 'STOREFRONT_PAGE_LINK_INVALID'],
      ['a product link with no product', form([slider(slide({ link: linkTo('product') }))]), 'STOREFRONT_PAGE_LINK_INVALID'],
      ['a link to a product that is not there', form([slider(slide({ link: linkTo('product', { itemId: 2_000_000_000 }) }))]), 'STOREFRONT_PAGE_LINK_UNKNOWN'],
      ['a link to a page that is not there', form([slider(slide({ link: linkTo('content', { pageId: 2_000_000_000 }) }))]), 'STOREFRONT_PAGE_LINK_UNKNOWN'],
      ['a link to a news item that is not there', form([slider(slide({ link: linkTo('news', { newsId: 2_000_000_000 }) }))]), 'STOREFRONT_PAGE_LINK_UNKNOWN'],
      ['a slide image that is not in the library', form([slider(slide({ mobileImageAssetId: 2_000_000_000 }))]), 'STOREFRONT_PAGE_IMAGE_UNKNOWN'],
      ['an unknown icon of a point', form([{ kind: 'homeWhy', background: 'white', points: [{ icon: 'skull', text: 'x' }, { icon: 'leaf', text: 'y' }] }]), 'STOREFRONT_PAGE_FIELD_INVALID'],
      ['a switch that is not on or off', form([{ ...emptyHomeSection('homeCategories'), hidden: 'yes' }]), 'STOREFRONT_PAGE_FIELD_INVALID'],
      ['a second slider', form([slider(slide()), slider(slide())]), 'STOREFRONT_PAGE_SECTION_INVALID'],
      ['four collection intros', form(['a', 'b', 'c', 'd'].map(c => ({ kind: 'collectionIntro', background: 'white', title: '', collection: c }))), 'STOREFRONT_PAGE_SECTION_INVALID'],
      // half of a surrogate pair is no text for the database: it is refused by name, not by a failed write
      ['a link target the database cannot keep', form([slider(slide({ link: linkTo('collection', { target: `a${String.fromCharCode(0xd83d)}` }) }))]), 'STOREFRONT_PAGE_LINK_INVALID'],
      ['markup in a path', form([slider(slide({ link: linkTo('path', { target: '/a"><x' }) }))]), 'STOREFRONT_PAGE_LINK_INVALID'],
    ];
    for (const [what, body, code] of refusals) {
      const res = await erp.put(`/api/storefront/pages/${homeId}`, body);
      if (res.status !== 422 || res.body.code !== code) wrong.push(`${what}: ${res.status} ${res.body.code} ${String(res.body.message ?? '').slice(0, 80)}`);
    }
    // the parts of the home page and the switch belong to the home page alone
    for (const [what, part] of [['a slider', slider(slide())], ['a part of the home page', emptyHomeSection('homeFeatured')], ['a part switched off', { ...button, hidden: true }]] as const) {
      const res = await erp.put(`/api/storefront/pages/${pageId}`, { title: `داستان خانه ${tag}`, slug: pageSlug, seoTitle: '', seoDescription: '', noindex: false, shareImageAssetId: null, sections: [part], version: 2 });
      if (res.status !== 422 || res.body.code !== 'STOREFRONT_PAGE_SECTION_INVALID') wrong.push(`${what} in another page: ${res.status} ${res.body.code}`);
    }
    const untouched = await orm.select().from(storefrontPages).where(eq(storefrontPages.id, homeId));
    if (untouched[0]?.version !== version || JSON.stringify(untouched[0]?.sections) !== '[]') wrong.push('a refused save changed the home row');
    const viewer = as(await loginTestUserWithSession(app, (await createTestUser({ role: (await createTestRole({ permissions: ['site_content.view'] })).code })).username));
    if ((await viewer.get(`/api/storefront/pages/${homeId}`)).status !== 200 || (await viewer.put(`/api/storefront/pages/${homeId}`, form([]))).status !== 403) wrong.push('the view key alone reads the home page and does not write it');

    // 3) a draft: today's home page, a slider, a banner, the collection, the news and two parts switched off
    const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const slides = [
      slide({ mobileImageAssetId: tall.id, title: 'اسلاید امروز', text: 'متن اسلاید', buttonLabel: 'دیدن محصول', link: linkTo('product', { itemId: leaving.id }), startsOn: today, endsOn: today }),
      slide({ title: 'اسلاید فردا', startsOn: tomorrow }),
      slide({ title: 'اسلاید دیروز', endsOn: yesterday }),
      slide({ imageAssetId: lost.id, title: 'اسلاید بی‌عکس' }),
      slide({ title: 'اسلاید بیرونی', buttonLabel: 'اینستاگرام', link: linkTo('url', { target: 'https://example.com/papital' }) }),
    ];
    const bannerOf = (imageAssetId: number, imageAlt: string, link: Body | null): Body => ({ kind: 'banner', background: 'white', imageAssetId, mobileImageAssetId: null, imageAlt, link });
    const draftSections: unknown[] = [
      slider(...slides),
      { kind: 'banner', background: 'white', imageAssetId: bannerImage.id, mobileImageAssetId: null, imageAlt: 'بنر کالکشن', link: linkTo('collection', { target: collection }) },
      ...todayHomeSections(),
      { kind: 'collectionIntro', background: 'cream', title: '', collection },
      { kind: 'collectionIntro', background: 'white', title: 'بی‌کالا', collection: `ناموجود ${tag}` },
      emptyHomeSection('latestNews'),
      // switched off: unfinished, and with a secret that must never reach the site
      { kind: 'banner', background: 'white', imageAssetId: null, mobileImageAssetId: null, imageAlt: '', link: null, hidden: true },
      { ...text(`راز خاموش ${tag}`), hidden: true },
      { ...text(`متن خاموش‌نشده ${tag}`) },
      bannerOf(bannerImage.id, 'به صفحه', linkTo('content', { pageId })),
      bannerOf(bannerImage.id, 'به خبر', linkTo('news', { newsId })),
      bannerOf(lost.id, 'بنر بی‌عکس', null),
      // switched off, with an image of its own
      { ...bannerOf(offImage.id, 'بنر خاموش', null), hidden: true },
    ];
    // the name of the home page is the rules' own, whatever a request carries
    const saved = await erp.put(`/api/storefront/pages/${homeId}`, form(draftSections, { title: 'خانهٔ من', seoTitle: `عنوان خانه ${tag}`, seoDescription: 'توضیح خانه' }));
    if (saved.status !== 200 || saved.body.data?.status !== 'draft' || saved.body.data?.draft?.sections?.length !== draftSections.length || saved.body.data.draft.sections[13]?.hidden !== true || saved.body.data.draft.sections[14]?.hidden !== undefined) {
      throw new Error(`saving the draft: ${saved.status} ${JSON.stringify(saved.body).slice(0, 400)}`);
    }
    version = Number(saved.body.data.version);
    if ((await site('/home')).status !== 404) wrong.push('a saved draft reached the site');
    // a link in the draft alone is already told to the page it leads to
    if (saved.body.data.title !== 'صفحهٔ اصلی' || (await erp.get(`/api/storefront/pages/${pageId}`)).body.data?.linkedFromHome !== true) wrong.push(`the saved draft: named «${String(saved.body.data.title)}», its link told to the page ${String((await erp.get(`/api/storefront/pages/${pageId}`)).body.data?.linkedFromHome)}`);

    // 4) «انتشار» asks every part that is on to be finished, never one that is off
    await orm.update(mediaAssets).set({ isDeleted: 1 }).where(eq(mediaAssets.id, lost.id));
    const early = await erp.post(`/api/storefront/pages/${homeId}/publish`, { version });
    if (early.status !== 422 || early.body.code !== 'STOREFRONT_PAGE_IMAGE_UNKNOWN') wrong.push(`publishing with an image that left the library: ${early.status} ${early.body.code}`);
    await orm.update(mediaAssets).set({ isDeleted: 0 }).where(eq(mediaAssets.id, lost.id));
    const noAlt = await erp.put(`/api/storefront/pages/${homeId}`, form([slider(slide({ imageAlt: '' })), ...draftSections.slice(1)]));
    const unfinished = await erp.post(`/api/storefront/pages/${homeId}/publish`, { version: Number(noAlt.body.data?.version) });
    if (noAlt.status !== 200 || unfinished.status !== 422 || unfinished.body.code !== 'STOREFRONT_PAGE_UNFINISHED') wrong.push(`publishing a slide with no alternative text: ${noAlt.status}/${unfinished.status} ${unfinished.body.code}`);
    version = Number(noAlt.body.data?.version);
    const again = await erp.put(`/api/storefront/pages/${homeId}`, form(draftSections, { seoTitle: `عنوان خانه ${tag}`, seoDescription: 'توضیح خانه' }));
    const out = await erp.post(`/api/storefront/pages/${homeId}/publish`, { version: Number(again.body.data?.version) });
    if (out.status !== 200 || out.body.data?.status !== 'published') throw new Error(`publishing the home page: ${out.status} ${JSON.stringify(out.body).slice(0, 400)}`);
    version = Number(out.body.data.version);
    const [published] = await orm.select().from(activityLogs).where(and(eq(activityLogs.entity, 'صفحهٔ سایت'), eq(activityLogs.entityId, `page-${homeId}`))).orderBy(desc(activityLogs.id)).limit(1);
    const auditParts = ((published?.details ?? {}) as { after?: { sections?: Body[] } }).after?.sections ?? [];
    if (auditParts.filter(part => part.hidden === true).length !== 3 || auditParts.some(part => part.hidden === false)) wrong.push(`the parts switched off, in the audit row: ${JSON.stringify(auditParts.map(part => part.hidden ?? null))}`);
    if (!JSON.stringify(published?.details ?? '').includes('اسلاید امروز') || !JSON.stringify(published?.details ?? '').includes(`کالا ${leaving.id}`)) wrong.push(`the audit row of «انتشار»: ${String(JSON.stringify(published?.details)).slice(0, 300)}`);

    // 5) the site: the copy built for today
    await orm.update(mediaAssets).set({ isDeleted: 1 }).where(eq(mediaAssets.id, lost.id));
    const answer = await site('/home');
    const data = (answer.body.data ?? {}) as Body & { sections: Body[] };
    const keys = (value: unknown) => Object.keys((value ?? {}) as Body).sort().join(',');
    if (answer.status !== 200 || keys(data) !== 'sections,seoDescription,seoTitle,shareImage,updatedAt' || data.seoTitle !== `عنوان خانه ${tag}` || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(String(data.updatedAt))) {
      wrong.push(`the answer of the site: ${answer.status} ${keys(data)} ${String(data.seoTitle)}`);
    }
    // no news yet (the switch is off), no collection without items, nothing switched off
    const expected = 'slider,banner,homeIntro,homeCategories,homeWhy,homeFeatured,homeCollections,homeNewest,homeWholesale,collectionIntro,text,banner,banner';
    if (await kindsOnSite() !== expected) wrong.push(`the parts on the site: ${await kindsOnSite()}`);
    const top = data.sections[0] as { slides: Body[] };
    const shown = (top.slides ?? []).map(s => String(s.title)).join('|');
    if (shown !== 'اسلاید امروز|اسلاید بیرونی') wrong.push(`the slides on the site today: ${shown}`);
    const [todaySlide, outside] = top.slides ?? [];
    if (keys(todaySlide) !== 'buttonLabel,external,href,image,mobileImage,text,title' || keys(todaySlide?.image) !== 'alt,height,sha256,thumb,width' || (todaySlide.image as Body).sha256 !== wide.sha256
      || (todaySlide.mobileImage as Body)?.sha256 !== tall.sha256 || todaySlide.href !== `/p/${leaving.slug}` || todaySlide.external !== false || todaySlide.buttonLabel !== 'دیدن محصول'
      || outside?.href !== 'https://example.com/papital' || outside.external !== true || outside.mobileImage !== null) {
      wrong.push(`the slides as the site gets them: ${JSON.stringify(top.slides)}`);
    }
    const banner = data.sections[1];
    if (keys(banner) !== 'external,href,image,kind,mobileImage' || banner.href !== `/collections/${encodeURIComponent(collection)}` || (banner.image as Body)?.alt !== 'بنر کالکشن') wrong.push(`the banner: ${JSON.stringify(banner)}`);
    const intro = data.sections.find(s => s.kind === 'collectionIntro') as Body & { products: Body[] };
    if (keys(intro) !== 'background,collection,image,intro,kind,moreHref,products,title' || intro.intro !== 'نقش این کالکشن از کاشی هفت‌رنگ است.' || (intro.image as Body)?.sha256 !== collectionImage.sha256
      || intro.products.length !== 3 || intro.products.some(p => !String(p.slug).startsWith('home-item-')) || intro.moreHref !== '') {
      wrong.push(`«معرفی کالکشن»: ${JSON.stringify(intro).slice(0, 400)}`);
    }
    const why = data.sections.find(s => s.kind === 'homeWhy') as { points: Body[] };
    if (keys(why) !== 'kind,points' || why.points.length !== 4 || why.points[2].icon !== 'truck' || why.points[2].text !== '') wrong.push(`«چرا پاپیتال»: ${JSON.stringify(why)}`);
    const linked = data.sections.slice(-2);
    // the page is still a draft and the news waits for its switch: each banner stays, without an address
    if (linked.map(s => `${String((s.image as Body)?.alt)}:${String(s.href)}`).join('|') !== 'به صفحه:|به خبر:') wrong.push(`links to a draft page and to news while the switch is off: ${JSON.stringify(linked)}`);
    // the home row is not a page of the site by any other road, now that it is published
    const listedNow = ((await site('/pages')).body.data ?? []) as Body[];
    if (listedNow.some(row => row.slug === HOME_PAGE_SLUG || row.kind === 'home') || (await site(`/pages/${HOME_PAGE_SLUG}`)).status !== 404) wrong.push('the published home row is among the pages of the site');
    // the ERP tells the page and the news item that the home page leads to them
    const tells = [(await erp.get(`/api/storefront/pages/${pageId}`)).body.data?.linkedFromHome, (await erp.get(`/api/storefront/news/${newsId}`)).body.data?.linkedFromHome, (await erp.get(`/api/storefront/pages/${homeId}`)).body.data?.linkedFromHome].join(',');
    if (tells !== 'true,true,false') wrong.push(`what the home page links to, as the ERP tells it: ${tells}`);
    const whole = JSON.stringify(answer.body);
    for (const leak of [`راز خاموش ${tag}`, 'اسلاید فردا', 'اسلاید دیروز', 'اسلاید بی‌عکس', 'بنر بی‌عکس', 'بنر خاموش', offImage.sha256, 'imageAssetId', 'itemId', 'pageId', 'newsId', '"hidden"', '"id"', 'updatedBy', '"version"', 'startsOn', lost.sha256]) {
      if (whole.includes(leak)) wrong.push(`the answer of the site carries «${leak}»`);
    }
    const mediaOf = async (sha256: string) => (await site(`/media/${sha256}.webp`)).status;
    if (await mediaOf(wide.sha256) !== 200 || await mediaOf(tall.sha256) !== 200 || await mediaOf(bannerImage.sha256) !== 200 || await mediaOf(lost.sha256) !== 404 || await mediaOf(offImage.sha256) !== 404) {
      wrong.push(`the image files: ${await mediaOf(wide.sha256)}/${await mediaOf(tall.sha256)}/${await mediaOf(bannerImage.sha256)}, the one that left the library ${await mediaOf(lost.sha256)}, the one of a part switched off ${await mediaOf(offImage.sha256)}`);
    }

    // 6) the site follows what its links lead to: a published page, news switched on, a product that leaves the site
    await erp.post(`/api/storefront/pages/${pageId}/publish`, { version: 2 });
    await erp.put('/api/storefront/news/site', { enabled: true });
    await publishItem(leaving.id, false, leaving.slug);
    const followed = ((await home())?.sections ?? []) as Array<Body & { slides?: Body[]; items?: Body[] }>;
    const lastNow = followed.filter(s => s.kind === 'banner').slice(-2);
    if (lastNow.map(s => String(s.href)).join('|') !== `/pages/${pageSlug}|/news/home-news-${tag}`) wrong.push(`the links once their targets are on the site: ${JSON.stringify(lastNow)}`);
    const firstNow = (followed[0].slides ?? [])[0];
    if (firstNow?.title !== 'اسلاید امروز' || firstNow.href !== '' || firstNow.buttonLabel !== '') wrong.push(`a slide whose product left the site: ${JSON.stringify(firstNow)}`);
    const newsPart = followed.find(s => s.kind === 'latestNews');
    if (!newsPart || keys(newsPart) !== 'background,items,kind,title' || !(newsPart.items ?? []).some(item => item.slug === `home-news-${tag}`) || (newsPart.items ?? []).length > 3) wrong.push(`«تازه‌ترین خبرها»: ${JSON.stringify(newsPart).slice(0, 300)}`);

    // «تازه‌ترین خبرها» is the three newest, however many there are
    for (const n of [2, 3, 4]) {
      const more = await erp.post('/api/storefront/news', { title: `خبر خانه ${n} ${tag}`, slug: `home-news-${n}-${tag}` });
      const moreId = Number(more.body.data?.id);
      await erp.put(`/api/storefront/news/${moreId}`, { title: `خبر خانه ${n} ${tag}`, slug: `home-news-${n}-${tag}`, summary: '', coverAssetId: null, newsDate: `2021-01-0${n}`, seoTitle: '', seoDescription: '', sections: [text('متن خبر')], version: 1 });
      await erp.post(`/api/storefront/news/${moreId}/publish`, { version: 2 });
    }
    const newest = (((await home())?.sections ?? []).find(s => s.kind === 'latestNews') as { items?: Body[] } | undefined)?.items ?? [];
    if (newest.length !== 3) wrong.push(`«تازه‌ترین خبرها» with more than three items on the site: ${newest.length}`);
    // a copy changed by hand in the database: a part of another shape is left out and the rest of the page goes on
    const [live] = await orm.select().from(storefrontPages).where(eq(storefrontPages.id, homeId));
    const brokenParts = [null, { kind: 'slider', background: 'white' }, { kind: 'banner', background: 'white', imageAssetId: bannerImage.id, mobileImageAssetId: null, imageAlt: 'x', link: { kind: 'content', target: '', itemId: null, campaignId: null, pageId: 'one', newsId: null } }, { kind: 'homeWhy', background: 'white', points: [{ icon: 'skull', text: 'x' }, { icon: 'leaf', text: 'y' }] }, { kind: 'homeIntro', background: 'white', kicker: '', title: 'دست‌کاری', text: '', buttonLabel: 'برو', buttonHref: 'javascript:alert(1)' }, { ...emptyHomeSection('homeCategories') }];
    await orm.update(storefrontPages).set({ published: { ...live.published!, sections: brokenParts as never } }).where(eq(storefrontPages.id, homeId));
    const mended = await site('/home');
    if (mended.status !== 200 || ((mended.body.data?.sections ?? []) as Body[]).map(s => String(s.kind)).join(',') !== 'homeCategories' || JSON.stringify(mended.body).includes('javascript')) wrong.push(`a copy changed by hand: ${mended.status} ${JSON.stringify(mended.body).slice(0, 300)}`);
    // a copy with nothing to show today is the same as none: the site keeps its own home page
    await orm.update(storefrontPages).set({ published: { ...live.published!, sections: [slider(slide({ endsOn: yesterday }))] as never } }).where(eq(storefrontPages.id, homeId));
    const nothing = await site('/home');
    if (nothing.status !== 404 || nothing.body.code !== 'STOREFRONT_HOME_NOT_PUBLISHED') wrong.push(`a home page with nothing to show today: ${nothing.status} ${nothing.body.code}`);
    await orm.update(storefrontPages).set({ published: live.published }).where(eq(storefrontPages.id, homeId));
    // taking the linked page off the site records that the home page led to it
    const pageNow = Number((await erp.get(`/api/storefront/pages/${pageId}`)).body.data?.version);
    await erp.post(`/api/storefront/pages/${pageId}/unpublish`, { version: pageNow });
    const [pageOff] = await orm.select().from(activityLogs).where(and(eq(activityLogs.entity, 'صفحهٔ سایت'), eq(activityLogs.entityId, `page-${pageId}`))).orderBy(desc(activityLogs.id)).limit(1);
    if ((pageOff?.details as { linkedFromHome?: boolean } | null)?.linkedFromHome !== true) wrong.push(`the audit row of a page the home page led to: ${String(JSON.stringify(pageOff?.details)).slice(0, 200)}`);

    // 7) a later draft does not change the site; «برداشتن» gives the site its own home page back; the row stays
    const later = await erp.put(`/api/storefront/pages/${homeId}`, form([emptyHomeSection('homeIntro')], { seoTitle: 'پیش‌نویس تازه' }));
    version = Number(later.body.data?.version);
    if (later.status !== 200 || later.body.data?.status !== 'changed' || (await home())?.seoTitle !== `عنوان خانه ${tag}`) wrong.push(`a draft saved after «انتشار»: ${later.status} ${String(later.body.data?.status)}, on the site «${String((await home())?.seoTitle)}»`);
    // the copy on the site still leads to the page and the news item, though the draft no longer does: both are told so,
    // and removing the page or taking the item off the site records it
    const newsNow = Number((await erp.get(`/api/storefront/news/${newsId}`)).body.data?.version);
    const stillTold = `${String((await erp.get(`/api/storefront/pages/${pageId}`)).body.data?.linkedFromHome)},${String((await erp.get(`/api/storefront/news/${newsId}`)).body.data?.linkedFromHome)}`;
    await erp.post(`/api/storefront/news/${newsId}/unpublish`, { version: newsNow });
    await erp.del(`/api/storefront/pages/${pageId}?version=${Number((await erp.get(`/api/storefront/pages/${pageId}`)).body.data?.version)}`);
    const lastOf = async (entity: string, entityId: string) => ((await orm.select().from(activityLogs).where(and(eq(activityLogs.entity, entity), eq(activityLogs.entityId, entityId))).orderBy(desc(activityLogs.id)).limit(1))[0]?.details ?? {}) as { linkedFromHome?: boolean };
    const recorded = `${String((await lastOf('صفحهٔ سایت', `page-${pageId}`)).linkedFromHome)},${String((await lastOf('خبر سایت', `news-${newsId}`)).linkedFromHome)}`;
    if (stillTold !== 'true,true' || recorded !== 'true,true') wrong.push(`a link of the copy on the site alone: told ${stillTold}, recorded ${recorded}`);
    const kept = [
      (await erp.del(`/api/storefront/pages/${homeId}?version=${version}`)).body.code, (await erp.post(`/api/storefront/pages/${homeId}/move`, { slug: `home-${tag}`, version })).body.code,
    ].join(',');
    if (kept !== 'STOREFRONT_PAGE_BASE_KEPT,STOREFRONT_PAGE_BASE_KEPT') wrong.push(`removing and moving the home page: ${kept}`);
    const off = await erp.post(`/api/storefront/pages/${homeId}/unpublish`, { version });
    if (off.status !== 200 || (await site('/home')).status !== 404 || await mediaOf(wide.sha256) !== 404) wrong.push(`taking the home page off the site: ${off.status}, the site ${(await site('/home')).status}, its image ${await mediaOf(wide.sha256)}`);

    const HIDDEN_WORDS = `نوشتهٔ بخش خاموش ${tag}`;
    // 7b) «پیش‌نمایش»: the draft as the home page it would be today, under the link's key alone, while the site still has none
    const draft = await erp.put(`/api/storefront/pages/${homeId}`, { ...form([
      slider(slide({ title: 'اسلاید پیش‌نویس', mobileImageAssetId: tall.id }), slide({ title: 'اسلاید فردا', startsOn: tomorrow })),
      { ...emptyHomeSection('homeCategories'), hidden: true }, emptyHomeSection('homeWholesale'), text('متن دیده‌شدنی پیش‌نویس'),
      // parts of every page that are switched off, and the image of one: none of it leaves under the key either
      { ...text(HIDDEN_WORDS), hidden: true }, { kind: 'hero', background: 'white', title: HIDDEN_WORDS, text: '', imageAssetId: bannerImage.id, buttonLabel: '', buttonHref: '', hidden: true },
    ], { seoTitle: 'عنوان پیش‌نویس خانه' }), version: Number(off.body.data?.version) });
    const draftLink = await erp.post(`/api/storefront/pages/${homeId}/preview`);
    const previewKey = String(draftLink.body.data?.path ?? '').slice('/preview/'.length);
    const underKey = (url: string) => site(url).set('X-Preview-Key', previewKey);
    const draftRead = await underKey('/page-preview');
    const draftSeen = (draftRead.body.data ?? {}) as Body & { home?: { seoTitle?: string; sections?: Array<Body & { slides?: Body[] }> } };
    const draftParts = draftSeen.home?.sections ?? [];
    if (draft.status !== 200 || draftLink.status !== 201 || draftRead.status !== 200 || draftSeen.slug !== HOME_PAGE_SLUG || draftSeen.noindex !== true || typeof draftSeen.expiresAt !== 'string'
      || draftSeen.home?.seoTitle !== 'عنوان پیش‌نویس خانه' || draftParts.map(s => String(s.kind)).join(',') !== 'slider,homeWholesale,text'
      || (draftParts[0]?.slides ?? []).map(s => String(s.title)).join(',') !== 'اسلاید پیش‌نویس' || JSON.stringify(draftSeen.sections) !== '[]') {
      wrong.push(`the preview of the home page's draft: ${draft.status}/${draftLink.status}/${draftRead.status} ${JSON.stringify(draftSeen).slice(0, 500)}`);
    }
    // nothing more goes out than publishing would send: no id, no day of a slide, no part switched off
    const draftText = JSON.stringify(draftRead.body);
    for (const inside of ['AssetId', '"id"', 'startsOn', 'hidden', 'اسلاید فردا', 'itemId', 'version', HIDDEN_WORDS]) if (draftText.includes(inside)) wrong.push(`the preview of the home page's draft carries ${inside}`);
    const draftImages = [
      (await underKey(`/page-preview/media/${wide.sha256}.webp`)).status, (await underKey(`/page-preview/media/${tall.sha256}.webp`)).status,
      (await underKey(`/page-preview/media/${offImage.sha256}.webp`)).status, (await underKey(`/page-preview/media/${bannerImage.sha256}.webp`)).status, await mediaOf(wide.sha256), (await site('/home')).status, (await site(`/pages/${HOME_PAGE_SLUG}`)).status,
    ].join('/');
    if (draftImages !== '200/200/404/404/404/404/404') wrong.push(`the draft's images under the key, an image it does not name, the image of a part switched off, the same image and the home page on the site: ${draftImages}`);

    // 8) the rules of migration 0036 hold against a direct write
    const direct: Array<[string, () => Promise<unknown>]> = [
      ['a second home row', () => orm.insert(storefrontPages).values({ kind: 'home', slug: `second-home-${tag}`, title: 'خانهٔ دوم' })],
      ['a kind nobody knows', () => orm.insert(storefrontPages).values({ kind: 'landing', slug: `landing-${tag}`, title: 'فرود' })],
      ['removing the home row', () => orm.update(storefrontPages).set({ isDeleted: 1 }).where(eq(storefrontPages.id, homeId))],
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
    if (savedHome) {
      // the home row as the test found it
      await orm.delete(storefrontContentAssets).where(and(eq(storefrontContentAssets.contentKind, 'page'), eq(storefrontContentAssets.contentId, savedHome.id))).catch(() => undefined);
      await orm.update(storefrontPages).set({
        title: savedHome.title, seoTitle: savedHome.seoTitle, seoDescription: savedHome.seoDescription, noindex: savedHome.noindex, shareImageAssetId: savedHome.shareImageAssetId,
        sections: savedHome.sections, published: savedHome.published, publishedAt: savedHome.publishedAt, publishedBy: savedHome.publishedBy, version: savedHome.version,
        updatedBy: savedHome.updatedBy, updatedAt: savedHome.updatedAt,
      }).where(eq(storefrontPages.id, savedHome.id)).catch(() => undefined);
    }
    await orm.delete(storefrontPages).where(like(storefrontPages.slug, `%-${tag}`)).catch(() => undefined);
    await orm.delete(storefrontCollections).where(like(storefrontCollections.name, `%${tag}`)).catch(() => undefined);
    if (pageIds.length > 0) {
      await orm.delete(storefrontContentAssets).where(and(eq(storefrontContentAssets.contentKind, 'page'), inArray(storefrontContentAssets.contentId, pageIds))).catch(() => undefined);
      await orm.delete(storefrontPages).where(inArray(storefrontPages.id, pageIds)).catch(() => undefined);
    }
    const mine = await orm.select({ id: storefrontNews.id }).from(storefrontNews).where(like(storefrontNews.slug, `%${tag}`)).catch(() => []);
    if (mine.length > 0) {
      await orm.delete(storefrontContentAssets).where(and(eq(storefrontContentAssets.contentKind, 'news'), inArray(storefrontContentAssets.contentId, mine.map(r => r.id)))).catch(() => undefined);
      await orm.delete(storefrontNews).where(inArray(storefrontNews.id, mine.map(r => r.id))).catch(() => undefined);
    }
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
