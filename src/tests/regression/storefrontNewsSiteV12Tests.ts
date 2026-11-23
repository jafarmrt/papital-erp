import fs from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { and, desc, eq, inArray, like } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, appSettings, mediaAssets, mediaSections, storefrontContentAssets, storefrontNews } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { readPricingStrategies } from '../../lib/items/pricingStrategies.js';
import { mediaFilePath } from '../../lib/media/mediaPaths.js';

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * v12 phase 10d, part 2 (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2, `AGENTS.md` §1.9b and §1.9c): what the site reads
 * of «خبرهای سایت», on real Express routes and PostgreSQL. While «خبرها روی سایت بیایند» is off (the default) the three
 * addresses give no item and no image of one. Once it is on, `GET /api/storefront/v1/news`, `/news-index` and
 * `/news/:slug` answer only the copy on the site of an item whose day has come, with exactly the reviewed fields: no
 * draft, no item waiting for its day, taken off or removed, no editor's name, no row id and no id of the media library.
 * `/media/<file>` gives an image such an item names and is the same 404 for any other. The switch is sent its target
 * state by a holder of `site_content.manage`, and a repeat writes no second audit row.
 */
interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;

export async function runStorefrontNewsSiteV12Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_news_site_v12_p10d';
  if (!shouldRun(id, 'v12', 'phase10', 'storefront', 'news', 'security')) return results;

  const name = 'v12 phase 10d: the site reads the news only while its switch is on, only the copy on the site of an item whose day has come, with the reviewed fields and only the images such an item names';
  const tStart = Date.now();
  const assetIds: number[] = [];
  const files: string[] = [];
  const wrong: string[] = [];
  let sectionId = 0;
  const tag = String(Date.now()).slice(-7);
  const savedSettings = await orm.select().from(appSettings).where(like(appSettings.key, 'sf\\_%'));
  const savedStrategies = await orm.select().from(appSettings).where(eq(appSettings.key, 'pricing_strategies'));
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
    const keys = (value: unknown) => Object.keys((value ?? {}) as Body).sort().join(',');

    // the site on, with a key and a retail list; the switch of the news is not touched (off, as on a new install)
    const retailList = `تکی خبرهای سایت ${tag}`;
    const current = readPricingStrategies(savedStrategies[0]?.value);
    const strategies = 'titles' in current ? current.titles : [];
    await orm.insert(appSettings).values({ key: 'pricing_strategies', value: JSON.stringify([...strategies, retailList]) })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify([...strategies, retailList]) } });
    await orm.delete(appSettings).where(eq(appSettings.key, 'sf_news_enabled'));
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

    // five images of the library whose files are on the disk
    const [section] = await orm.insert(mediaSections).values({ kind: 'custom', title: `عکس‌های خبر سایت ${tag}` }).returning({ id: mediaSections.id });
    sectionId = section.id;
    const image = async (n: number) => {
      const sha256 = `${String(n).repeat(8)}${tag}`.padEnd(64, 'd').slice(0, 64);
      const [asset] = await orm.insert(mediaAssets).values({
        sectionId, kind: 'image', title: `عکس خبر سایت ${n} ${tag}`, originalName: `news-site-${n}.jpg`, mimeType: 'image/jpeg', sizeBytes: 1000,
        sha256, width: 1600, height: 900, lightBytes: 12, thumbBytes: 12,
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
    const [cover, first, second, draftOnly, waiting] = [await image(1), await image(2), await image(3), await image(4), await image(5)];

    // the items: each made, saved and (but for the draft) published through the ERP's own routes
    const today = await businessTodayIsoDate();
    const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    const text = (words: string) => ({ kind: 'text', background: 'white', doc: { type: 'doc', content: [p(words)] } });
    const gallery = (ids: number[]) => ({ kind: 'gallery', background: 'white', title: 'عکس‌ها', images: ids.map(assetId => ({ assetId, alt: 'عکس خبر' })) });
    const make = async (slug: string, title: string, over: Body, publish = true) => {
      const made = await erp.post('/api/storefront/news', { title, slug: `${slug}-${tag}` });
      if (made.status !== 201) throw new Error(`making ${slug}: ${made.status} ${JSON.stringify(made.body)}`);
      const newsId = Number(made.body.data.id);
      const form = { title, slug: `${slug}-${tag}`, summary: '', coverAssetId: null, newsDate: '', seoTitle: '', seoDescription: '', sections: [text(`متن ${title}`)], ...over };
      const saved = await erp.put(`/api/storefront/news/${newsId}`, { ...form, version: 1 });
      if (saved.status !== 200) throw new Error(`saving ${slug}: ${saved.status} ${JSON.stringify(saved.body)}`);
      const after = publish ? await erp.post(`/api/storefront/news/${newsId}/publish`, { version: 2 }) : saved;
      if (after.status !== 200) throw new Error(`publishing ${slug}: ${after.status} ${JSON.stringify(after.body)}`);
      return { id: newsId, slug: `${slug}-${tag}`, form, version: Number(after.body.data.version) };
    };
    const shown = await make('shown', `خبر روی سایت ${tag}`, {
      newsDate: '2020-03-01', coverAssetId: cover.id, seoTitle: 'عنوان جست‌وجوی خبر', seoDescription: 'توضیح جست‌وجوی خبر',
      sections: [text('نخستین جملهٔ خبر که خلاصه‌اش می‌شود.'), gallery([first.id, second.id])],
    });
    // its draft goes on changing after «انتشار», every field of it: none of this is on the site
    const secret = `پیش‌نویس محرمانه ${tag}`;
    const redraft = await erp.put(`/api/storefront/news/${shown.id}`, {
      ...shown.form, title: secret, summary: `${secret} در خلاصه`, coverAssetId: draftOnly.id, newsDate: '2021-07-07', seoTitle: `${secret} در جست‌وجو`, seoDescription: `${secret} در توضیح`,
      sections: [text(`${secret} در متن`), gallery([first.id, draftOnly.id])], version: shown.version,
    });
    if (redraft.status !== 200) throw new Error(`changing the draft: ${redraft.status} ${JSON.stringify(redraft.body)}`);
    const todays = await make('today', `خبر امروز ${tag}`, { summary: 'خلاصهٔ خبر امروز' });
    const later = await make('later', `خبر در نوبت ${tag}`, { newsDate: '2099-01-01', coverAssetId: waiting.id });
    const draft = await make('draft', `خبر پیش‌نویس ${tag}`, {}, false);
    const taken = await make('taken', `خبر برداشته ${tag}`, { newsDate: '2020-01-01' });
    const gone = await make('gone', `خبر حذف‌شده ${tag}`, { newsDate: '2020-02-01' });
    const [off, removed] = [
      await erp.post(`/api/storefront/news/${taken.id}/unpublish`, { version: taken.version }), await erp.del(`/api/storefront/news/${gone.id}?version=${gone.version}`),
    ];
    if (off.status !== 200 || removed.status !== 200) throw new Error(`taking off and removing: ${off.status}/${removed.status}`);
    const hidden = [later, draft, taken, gone];
    const media = async (sha256: string) => `${(await site(`/media/${sha256}.webp`)).status}/${(await site(`/media/${sha256}-thumb.webp`)).status}`;

    // 1) the switch is off by default: the site has no news at all, whatever is published
    const [offList, offIndex, offItem, erpList] = [await site('/news'), await site('/news-index'), await site(`/news/${shown.slug}`), await erp.get('/api/storefront/news')];
    if (offList.status !== 200 || offList.body.enabled !== false || offList.body.data?.length !== 0 || offList.body.total !== 0 || offIndex.body.data?.length !== 0
      || offItem.status !== 404 || offItem.body.code !== 'STOREFRONT_NEWS_NOT_FOUND' || await media(cover.sha256) !== '404/404' || erpList.body.siteEnabled !== false) {
      wrong.push(`with the switch off: list ${offList.status} enabled ${offList.body.enabled} ${offList.body.data?.length}/${offList.body.total}, index ${offIndex.body.data?.length}, item ${offItem.status}, image ${await media(cover.sha256)}, in the ERP ${erpList.body.siteEnabled}`);
    }

    // 2) the switch: the manage key alone, sent its target state; a repeat writes no second audit row
    const viewer = as(await loginTestUserWithSession(app, (await createTestUser({ role: (await createTestRole({ permissions: ['site_content.view'] })).code })).username));
    const stranger = as(await loginTestUserWithSession(app, (await createTestUser({ role: (await createTestRole({ permissions: ['storefront.view', 'storefront.manage'] })).code })).username));
    const auditRows = async () => (await orm.select().from(activityLogs).where(and(eq(activityLogs.entity, 'فروشگاه سایت'), eq(activityLogs.entityId, 'news')))).length;
    const auditBefore = await auditRows();
    const [byViewer, byStranger, noBody, extra, notBoolean] = [
      await viewer.put('/api/storefront/news/site', { enabled: true }), await stranger.put('/api/storefront/news/site', { enabled: true }),
      await erp.put('/api/storefront/news/site', {}), await erp.put('/api/storefront/news/site', { enabled: true, version: 1 }), await erp.put('/api/storefront/news/site', { enabled: 'yes' }),
    ];
    if (byViewer.status !== 403 || byStranger.status !== 403 || noBody.status !== 400 || extra.status !== 400 || notBoolean.status !== 400 || (await site('/news')).body.enabled !== false) {
      wrong.push(`who may turn the switch and with what: ${byViewer.status}/${byStranger.status}/${noBody.status}/${extra.status}/${notBoolean.status}`);
    }
    const [turnedOn, again] = [await erp.put('/api/storefront/news/site', { enabled: true }), await erp.put('/api/storefront/news/site', { enabled: true })];
    const afterOn = await auditRows();
    if (turnedOn.status !== 200 || turnedOn.body.data?.enabled !== true || again.status !== 200 || again.body.data?.enabled !== true || afterOn !== auditBefore + 1
      || (await erp.get('/api/storefront/news')).body.siteEnabled !== true) {
      wrong.push(`turning the switch on, twice: ${turnedOn.status}/${again.status}, audit rows ${afterOn - auditBefore}`);
    }

    // 3) the list: the items on the site now, the newest day first, with the reviewed fields and nothing else
    const list = await site('/news');
    const cards = (list.body.data ?? []) as Array<Record<string, unknown>>;
    const [newest, older] = cards;
    // the last audit row of the switch keeps both sides of the change
    const [switched] = await orm.select().from(activityLogs).where(and(eq(activityLogs.entity, 'فروشگاه سایت'), eq(activityLogs.entityId, 'news'))).orderBy(desc(activityLogs.id)).limit(1);
    const sides = (switched?.details ?? {}) as { before?: { enabled?: boolean }; after?: { enabled?: boolean } };
    if (switched?.action !== 'SETTING_CHANGE' || sides.before?.enabled !== false || sides.after?.enabled !== true) wrong.push(`the audit row of the switch: ${switched?.action} ${JSON.stringify(sides)}`);
    if (list.status !== 200 || keys(list.body) !== 'data,enabled,page,pageSize,total' || list.body.enabled !== true || list.body.total !== 2 || list.body.page !== 1 || list.body.pageSize !== 12
      || cards.map(c => c.slug).join(',') !== `${todays.slug},${shown.slug}` || cards.some(c => keys(c) !== 'cover,date,slug,summary,title')) {
      wrong.push(`the list: ${list.status} [${keys(list.body)}] total ${list.body.total}: ${cards.map(c => `${String(c.slug)} [${keys(c)}]`).join(' | ')}`);
    }
    if (newest?.date !== today || newest.summary !== 'خلاصهٔ خبر امروز' || newest.cover !== null || older?.date !== '2020-03-01' || older.title !== `خبر روی سایت ${tag}`
      || older.summary !== 'نخستین جملهٔ خبر که خلاصه‌اش می‌شود.' || keys(older.cover) !== 'alt,height,sha256,thumb,width' || (older.cover as Body).sha256 !== cover.sha256) {
      wrong.push(`the cards of the list: ${JSON.stringify(cards)}`);
    }
    const [pageTwo, pageZero, pageWord] = [await site('/news?page=2'), await site('/news?page=0'), await site('/news?page=two')];
    if (pageTwo.status !== 200 || pageTwo.body.data?.length !== 0 || pageTwo.body.page !== 2 || pageTwo.body.total !== 2 || pageZero.status !== 400 || pageWord.status !== 400) {
      wrong.push(`the pages of the list: ${pageTwo.status} ${pageTwo.body.data?.length} / ${pageZero.status} / ${pageWord.status}`);
    }
    const index = await site('/news-index');
    const lines = (index.body.data ?? []) as Array<Record<string, unknown>>;
    if (index.status !== 200 || lines.map(l => l.slug).join(',') !== `${todays.slug},${shown.slug}` || lines.some(l => keys(l) !== 'date,slug,updatedAt' || !ISO_UTC.test(String(l.updatedAt)))) {
      wrong.push(`the index: ${index.status} ${JSON.stringify(lines)}`);
    }

    // 4) one item: the copy on the site, its images by file key, its text checked on the way out
    const item = await site(`/news/${shown.slug}`);
    const data = (item.body.data ?? {}) as Record<string, unknown>;
    const parts = (Array.isArray(data.sections) ? data.sections : []) as Array<Record<string, unknown>>;
    const galleryImages = (parts[1]?.images ?? []) as Array<Record<string, unknown>>;
    if (item.status !== 200 || keys(data) !== 'cover,date,sections,seoDescription,seoTitle,slug,summary,title,updatedAt' || data.title !== `خبر روی سایت ${tag}` || data.date !== '2020-03-01'
      || data.seoTitle !== 'عنوان جست‌وجوی خبر' || data.seoDescription !== 'توضیح جست‌وجوی خبر' || !ISO_UTC.test(String(data.updatedAt)) || (data.cover as Body)?.sha256 !== cover.sha256
      || parts.map(s => s.kind).join(',') !== 'text,gallery' || keys(parts[0]) !== 'background,doc,kind' || keys(parts[1]) !== 'background,images,kind,title'
      || galleryImages.map(i => i.sha256).join(',') !== `${first.sha256},${second.sha256}` || galleryImages.some(i => keys(i) !== 'alt,height,sha256,thumb,width')) {
      wrong.push(`one item: ${item.status} [${keys(data)}] parts ${parts.map(s => `${String(s.kind)} [${keys(s)}]`).join(' | ')}`);
    }
    // nothing of the draft, of another item's state or of the ERP's own ids in any answer
    const everything = JSON.stringify([list.body, index.body, item.body, (await site(`/news/${todays.slug}`)).body]);
    for (const [what, leak] of [
      ['the draft', secret], ['the draft\'s day', '2021-07-07'], ['a library id', '"assetId"'], ['a row id', '"id"'], ['an editor', '"updatedBy"'], ['an editor', '"publishedBy"'], ['a version', '"version"'],
      ['the draft\'s image', draftOnly.sha256], ['the image of an item waiting for its day', waiting.sha256], ...hidden.map(h => ['an item that is not on the site', h.slug]),
    ]) if (everything.includes(leak)) wrong.push(`an answer carries ${what}: ${leak.slice(0, 24)}`);
    for (const one of hidden) {
      const res = await site(`/news/${one.slug}`);
      if (res.status !== 404 || res.body.code !== 'STOREFRONT_NEWS_NOT_FOUND') wrong.push(`an item that is not on the site (${one.slug.split('-')[0]}): ${res.status} ${res.body.code}`);
    }
    const [noKey, badSlug] = [await request(app).get('/api/storefront/v1/news'), await site('/news/Bad%20Address')];
    if (noKey.status !== 401 || badSlug.status !== 400) wrong.push(`without the key, and a bad address: ${noKey.status}/${badSlug.status}`);

    // 5) the images: those an item on the site names, light and small, and no other
    const given = { cover: await media(cover.sha256), first: await media(first.sha256), second: await media(second.sha256), draft: await media(draftOnly.sha256), waiting: await media(waiting.sha256) };
    if (given.cover !== '200/200' || given.first !== '200/200' || given.second !== '200/200' || given.draft !== '404/404' || given.waiting !== '404/404') {
      wrong.push(`the images: ${JSON.stringify(given)}`);
    }

    // 6) a row changed by hand cannot send a part a news item does not have
    const [row] = await orm.select().from(storefrontNews).where(eq(storefrontNews.id, shown.id));
    await orm.update(storefrontNews).set({
      published: { ...row.published!, sections: [...row.published!.sections, { kind: 'button', background: 'white', label: 'خرید', href: '/products' }, { kind: 'products', background: 'white', title: '', source: 'items', collection: '', itemIds: [1] }] },
    }).where(eq(storefrontNews.id, shown.id));
    const forged = ((await site(`/news/${shown.slug}`)).body.data?.sections ?? []) as Array<{ kind: string }>;
    if (forged.map(s => s.kind).join(',') !== 'text,gallery') wrong.push(`a part written by hand into the copy: ${forged.map(s => s.kind).join(',')}`);

    // a copy that cannot be read (a row changed by hand) does not take the list or the item down: what is no part is
    // passed over, a summary that is no text is not sent, and the words of a node the site would not draw are not taken
    await orm.update(storefrontNews).set({
      published: {
        ...row.published!, summary: { a: 1 } as unknown as string, coverAssetId: 1.5,
        sections: [null, { kind: 'text', background: 'white' }, { kind: 'gallery', background: 'white', title: 'x', images: 'no' },
          { kind: 'text', background: 'white', doc: { type: 'doc', content: [null] } }, { kind: 'text', background: 'white', doc: { type: 'doc', content: 'no' } },
          { kind: 'gallery', background: 5, title: 7, images: [{ assetId: 'x' }, { assetId: 1.5 }, { assetId: 99_999_999_999 }, null, { assetId: first.id, alt: { a: 1 } }] },
          { kind: 'text', background: 'white', doc: { type: 'doc', content: [{ type: 'iframe', content: [p('متن گره ناشناخته')] }] } }, text('متن درست')] as never,
      },
    }).where(eq(storefrontNews.id, shown.id));
    const [bentList, bentItem] = [await site('/news'), await site(`/news/${shown.slug}`)];
    const bentCard = ((bentList.body.data ?? []) as Array<Record<string, unknown>>).find(c => c.slug === shown.slug);
    const bentParts = ((bentItem.body.data?.sections ?? []) as Array<Record<string, unknown>>).map(part => (
      part.kind === 'gallery' ? `gallery «${String(part.title)}» ${String(part.background)} ${JSON.stringify((part.images as Array<Record<string, unknown>>).map(i => [i.sha256 === first.sha256, i.alt]))}` : String(part.kind)
    )).join(' | ');
    // of the parts, the two galleries (the first with no image, the second with its one real image and no words of its own) and the good text are left
    if (bentList.status !== 200 || bentItem.status !== 200 || bentCard?.summary !== 'متن درست' || bentCard.cover !== null || bentItem.body.data?.summary !== 'متن درست'
      || bentItem.body.data?.cover !== null || JSON.stringify(bentItem.body).includes('گره ناشناخته') || bentParts !== 'gallery «x» white [] | gallery «» white [[true,""]] | text') {
      wrong.push(`a copy that cannot be read: list ${bentList.status}, item ${bentItem.status}, summary ${JSON.stringify(bentCard?.summary)}, parts ${bentParts}`);
    }
    await orm.update(storefrontNews).set({ published: row.published }).where(eq(storefrontNews.id, shown.id));
    // a removed row whose copy was left by hand is not on the site either
    await orm.update(storefrontNews).set({ isDeleted: 1 }).where(eq(storefrontNews.id, shown.id));
    const [removedItem, removedList, removedImage] = [await site(`/news/${shown.slug}`), await site('/news'), await media(cover.sha256)];
    if (removedItem.status !== 404 || removedList.body.total !== 1 || removedImage !== '404/404') wrong.push(`a removed row with its copy left: ${removedItem.status} total ${removedList.body.total} image ${removedImage}`);
    await orm.update(storefrontNews).set({ isDeleted: 0 }).where(eq(storefrontNews.id, shown.id));

    // 7) an item comes on the day it is dated, not before: the waiting item with its day set to today is on the site
    const [waitingRow] = await orm.select().from(storefrontNews).where(eq(storefrontNews.id, later.id));
    await orm.update(storefrontNews).set({ publishedDate: today, published: { ...waitingRow.published!, newsDate: today } }).where(eq(storefrontNews.id, later.id));
    const [came, cameImage, cameList] = [await site(`/news/${later.slug}`), await media(waiting.sha256), await site('/news')];
    if (came.status !== 200 || came.body.data?.date !== today || cameImage !== '200/200' || cameList.body.total !== 3) wrong.push(`an item whose day has come: ${came.status} image ${cameImage} total ${cameList.body.total}`);

    // 8) taken off the site, an item and its images are gone from it; with the switch off again, so is everything
    const offNow = await erp.post(`/api/storefront/news/${shown.id}/unpublish`, { version: Number(redraft.body.data.version) });
    const [afterOff, coverAfter] = [await site(`/news/${shown.slug}`), await media(cover.sha256)];
    if (offNow.status !== 200 || afterOff.status !== 404 || coverAfter !== '404/404' || (await site('/news')).body.total !== 2) wrong.push(`an item taken off the site: ${offNow.status}/${afterOff.status} image ${coverAfter}`);
    const turnedOff = await erp.put('/api/storefront/news/site', { enabled: false });
    const [lastList, lastItem, lastImage] = [await site('/news'), await site(`/news/${todays.slug}`), await media(waiting.sha256)];
    if (turnedOff.status !== 200 || turnedOff.body.data?.enabled !== false || lastList.body.enabled !== false || lastList.body.total !== 0 || (await site('/news-index')).body.data?.length !== 0
      || lastItem.status !== 404 || lastImage !== '404/404' || await auditRows() !== auditBefore + 2) {
      wrong.push(`with the switch off again: ${turnedOff.status} list ${lastList.body.total} item ${lastItem.status} image ${lastImage} audit rows ${await auditRows() - auditBefore}`);
    }

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'with the switch off (the default) the list was empty, an item 404 and its image 404; only the manage key turned the switch, a wrong body was 400 and a repeat wrote no second audit row; the list held the two items on the site, the newest first, each with exactly five fields, and was paged; the index named them with their time; one item had exactly its nine fields, its images by file key and only text and gallery parts; no answer carried the draft, a row or library id, an editor or an item waiting, taken off, removed or never published; each of those was 404; the images of items on the site were given, light and small, and no other; a part written by hand was not sent, a copy that cannot be read took neither the list nor the item down, and a removed row with its copy left was not on the site; an item came on its day; taken off, an item and its image were gone; with the switch off again everything was',
    }));
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
    const mine = await orm.select({ id: storefrontNews.id }).from(storefrontNews).where(like(storefrontNews.slug, `%${tag}`)).catch(() => []);
    if (mine.length > 0) {
      await orm.delete(storefrontContentAssets).where(and(eq(storefrontContentAssets.contentKind, 'news'), inArray(storefrontContentAssets.contentId, mine.map(r => r.id)))).catch(() => undefined);
      await orm.delete(storefrontNews).where(inArray(storefrontNews.id, mine.map(r => r.id))).catch(() => undefined);
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
