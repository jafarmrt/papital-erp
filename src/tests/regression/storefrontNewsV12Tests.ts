import request from 'supertest';
import { and, desc, eq, inArray, like, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, mediaAssets, mediaSections, storefrontContentAssets, storefrontNews, storefrontPages } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';

/**
 * v12 phase 10d (migration 0033; docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): «خبرهای سایت» on real Express routes
 * and PostgreSQL. A news item is made as a draft, saved under its version (a stale one is 409), published, reverted,
 * taken off the site and removed softly, each with its audit row. Published without a day it is dated today (Tehran);
 * with a day to come it waits for that day. Its body takes only text and gallery parts; its images must be live images
 * of the library, and the rows that name a published item's images are kept under content kind 'news'. Reading needs
 * `site_content.view`, changing `site_content.manage`, and a new image `media.view` too. The image reader of the site's
 * pages gives no image of a news item, even beside a page on the site with the item's own id (what the site reads of the
 * news is `storefrontNewsSiteV12Tests.ts`).
 */
interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;

export async function runStorefrontNewsV12Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_news_v12_p10d';
  if (!shouldRun(id, 'v12', 'phase10', 'storefront', 'news', 'migration', 'security')) return results;

  const name = 'v12 phase 10d: a news item of the site is drafted, published under a day, reverted, taken off and removed under its version, with its images and its audit rows';
  const tStart = Date.now();
  const assetIds: number[] = [];
  let sectionId = 0;
  let twinId = 0;
  let twinBefore: typeof storefrontPages.$inferSelect | null = null;
  // what was found wrong so far is told also when a later step throws
  const wrong: string[] = [];
  const tag = String(Date.now()).slice(-7);
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
    const refusedCode = (res: { status: number; body: { code?: string } }) => `${res.status} ${res.body.code ?? ''}`;
    /** the newest audit row of an item is the one of the change just made: its action, a word of its sentence, and the sides it keeps */
    const audited = async (itemId: number, what: string, action: string, word: string, sides: string[]) => {
      const [row] = await orm.select().from(activityLogs).where(eq(activityLogs.entityId, `news-${itemId}`)).orderBy(desc(activityLogs.id)).limit(1);
      const details = (row?.details ?? {}) as Record<string, unknown>;
      if (row?.entity !== 'خبر سایت' || row.action !== action || !String(row.description).includes(word) || sides.some(side => !(side in details))) {
        wrong.push(`the audit row of ${what}: ${row?.entity} ${row?.action} «${String(row?.description)}» [${Object.keys(details).join(',')}]`);
      }
    };

    // three live images of the library and one removed from it
    const [section] = await orm.insert(mediaSections).values({ kind: 'custom', title: `عکس‌های خبر ${tag}` }).returning({ id: mediaSections.id });
    sectionId = section.id;
    const image = async (n: number, isDeleted = 0) => {
      const [asset] = await orm.insert(mediaAssets).values({
        sectionId, kind: 'image', title: `عکس خبر ${n} ${tag}`, originalName: `news-${n}.jpg`, mimeType: 'image/jpeg', sizeBytes: 1000,
        sha256: `${String(n).repeat(8)}${tag}`.padEnd(64, 'f').slice(0, 64), width: 1600, height: 900, lightBytes: 12, thumbBytes: 12, isDeleted,
      }).returning({ id: mediaAssets.id });
      assetIds.push(asset.id);
      return asset.id;
    };
    const [cover, inGallery, second, gone] = [await image(1), await image(2), await image(4), await image(3, 1)];

    // 1) who may read and who may change
    const viewer = as(await loginTestUserWithSession(app, (await createTestUser({ role: (await createTestRole({ permissions: ['site_content.view'] })).code })).username));
    const stranger = as(await loginTestUserWithSession(app, (await createTestUser({ role: (await createTestRole({ permissions: ['storefront.view'] })).code })).username));
    const editor = as(await loginTestUserWithSession(app, (await createTestUser({ role: (await createTestRole({ permissions: ['site_content.view', 'site_content.manage'] })).code })).username));
    const slug = `news-${tag}`;
    const [byViewer, byStranger, strangerList, viewerList] = [
      await viewer.post('/api/storefront/news', { title: 'خبر', slug: `v-${tag}` }), await stranger.post('/api/storefront/news', { title: 'خبر', slug: `s-${tag}` }),
      await stranger.get('/api/storefront/news'), await viewer.get('/api/storefront/news'),
    ];
    if (byViewer.status !== 403 || byStranger.status !== 403 || strangerList.status !== 403 || viewerList.status !== 200) {
      wrong.push(`the keys: ${byViewer.status}/${byStranger.status}/${strangerList.status}/${viewerList.status}`);
    }

    // 2) a new item is an empty draft; a bad or a taken address is refused
    const made = await erp.post('/api/storefront/news', { title: `کالکشن تازه ${tag}`, slug });
    if (made.status !== 201) throw new Error(`a new item: ${made.status} ${JSON.stringify(made.body)}`);
    const newsId = Number(made.body.data.id);
    await audited(newsId, 'making', 'CREATE', 'ساخته شد', ['after']);
    const [badSlug, taken, extraField] = [
      await erp.post('/api/storefront/news', { title: 'خبر', slug: 'Bad Address' }), await erp.post('/api/storefront/news', { title: 'خبر دیگر', slug }),
      await erp.post('/api/storefront/news', { title: 'خبر', slug: `x-${tag}`, published: {} }),
    ];
    if (made.body.data?.status !== 'draft' || made.body.data.version !== 1 || made.body.data?.draft.sections.length !== 0 || badSlug.status !== 422 || taken.status !== 409
      || taken.body.code !== 'STOREFRONT_NEWS_SLUG_TAKEN' || extraField.status !== 400) {
      wrong.push(`a new item, a bad address, a taken one and an unknown field: ${made.body.data?.status} v${made.body.data.version} / ${refusedCode(badSlug)} / ${refusedCode(taken)} / ${extraField.status}`);
    }

    // 3) saving a draft: under its version, with only the parts and images a news item may have
    const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    const body = (words: string, galleryIds: number[] = [inGallery, second]) => [
      { kind: 'text', background: 'white', doc: { type: 'doc', content: [p(words)] } },
      { kind: 'gallery', background: 'white', title: 'عکس‌ها', images: galleryIds.map(assetId => ({ assetId, alt: 'عکس رونمایی' })) },
    ];
    const form = (version: number, over: Body = {}) => ({
      title: `کالکشن تازه ${tag}`, slug, summary: 'چند خط دربارهٔ کالکشن', coverAssetId: cover, newsDate: '', seoTitle: '', seoDescription: '', sections: body('متن نخست'), version, ...over,
    });
    const refusals: Array<[string, Body, number]> = [
      ['a button part', { sections: [...body('x'), { kind: 'button', background: 'white', label: 'خرید', href: '/products' }] }, 422],
      ['an image that left the library', { sections: body('x', [gone]) }, 422],
      ['an image that is not there', { coverAssetId: 2_000_000_000 }, 422],
      ['a day that is no day', { newsDate: '2026-02-30' }, 422],
      ['a summary that is too long', { summary: 'ب'.repeat(301) }, 422],
      ['a script in the text', { sections: [{ kind: 'text', background: 'white', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] } }] }, 422],
    ];
    for (const [what, over, want] of refusals) {
      const res = await erp.put(`/api/storefront/news/${newsId}`, form(1, over));
      if (res.status !== want) wrong.push(`a draft with ${what}: ${refusedCode(res)}`);
    }
    // an image the item does not have yet needs the key of the library too
    const withoutLibrary = await editor.put(`/api/storefront/news/${newsId}`, form(1));
    if (withoutLibrary.status !== 403 || withoutLibrary.body.code !== 'STOREFRONT_PAGE_IMAGE_FORBIDDEN') wrong.push(`a new image without media.view: ${refusedCode(withoutLibrary)}`);
    const stale = await erp.put(`/api/storefront/news/${newsId}`, form(7));
    const saved = await erp.put(`/api/storefront/news/${newsId}`, form(1));
    if (stale.status !== 409 || saved.status !== 200 || saved.body.data.version !== 2 || saved.body.data?.status !== 'draft' || saved.body.data?.assets.length !== 3) {
      wrong.push(`a stale and a good save: ${stale.status}/${saved.status} v${saved.body.data?.version} ${saved.body.data?.status}`);
    }
    if ((await orm.select().from(storefrontContentAssets).where(and(eq(storefrontContentAssets.contentKind, 'news'), eq(storefrontContentAssets.contentId, newsId)))).length !== 0) {
      wrong.push('a draft wrote the rows of a published item\'s images');
    }
    await audited(newsId, 'saving a draft', 'UPDATE', 'ذخیره شد', ['before', 'after']);
    // the holder of the content keys alone saves what names no new image
    const editorSaves = await editor.put(`/api/storefront/news/${newsId}`, form(2, { summary: 'چند خط دیگر' }));
    if (editorSaves.status !== 200 || editorSaves.body.data?.version !== 3) wrong.push(`a save without a new image by the content keys alone: ${refusedCode(editorSaves)}`);
    // an image that left the library after the save stops «انتشار»
    await orm.update(mediaAssets).set({ isDeleted: 1 }).where(eq(mediaAssets.id, second));
    const lostImage = await erp.post(`/api/storefront/news/${newsId}/publish`, { version: 3 });
    await orm.update(mediaAssets).set({ isDeleted: 0 }).where(eq(mediaAssets.id, second));
    if (lostImage.status !== 422) wrong.push(`publishing with an image that left the library: ${refusedCode(lostImage)}`);

    // 4) «انتشار» without a day: dated today (Tehran), on the site's side at once, its images named under kind 'news'
    const today = await businessTodayIsoDate();
    const published = await erp.post(`/api/storefront/news/${newsId}/publish`, { version: 3 });
    const [row] = await orm.select().from(storefrontNews).where(eq(storefrontNews.id, newsId));
    const named = await orm.select().from(storefrontContentAssets).where(and(eq(storefrontContentAssets.contentKind, 'news'), eq(storefrontContentAssets.contentId, newsId), eq(storefrontContentAssets.isDeleted, 0)));
    if (published.status !== 200 || published.body.data?.status !== 'published' || published.body.data?.publishedDate !== today || published.body.data?.newsDate !== today || published.body.data?.scheduled !== false
      || row.publishedDate !== today || row.published?.newsDate !== today || named.map(r => r.assetId).sort().join(',') !== [cover, inGallery, second].sort().join(',')) {
      wrong.push(`publishing without a day: ${published.status} ${published.body.data?.status} «${published.body.data?.publishedDate}» (today ${today}), images ${named.length}`);
    }
    await audited(newsId, 'publishing', 'UPDATE', 'روی سایت منتشر شد', ['before', 'after']);
    let version = Number(published.body.data?.version);
    // publishing the same copy again changes nothing
    const again = await erp.post(`/api/storefront/news/${newsId}/publish`, { version });
    if (again.status !== 200 || again.body.data?.version !== version) wrong.push(`publishing the same copy twice: ${again.status} v${again.body.data?.version}`);
    // the day alone emptied is no change: the item keeps the day it has on the site, and is not left «changed» for good
    const dayOnly = await erp.put(`/api/storefront/news/${newsId}`, form(version, { summary: 'چند خط دیگر', newsDate: '' }));
    const dayOnlyAgain = await erp.post(`/api/storefront/news/${newsId}/publish`, { version: Number(dayOnly.body.data?.version) });
    if (dayOnly.status !== 200 || dayOnly.body.data?.status !== 'published' || dayOnlyAgain.status !== 200 || dayOnlyAgain.body.data?.status !== 'published'
      || dayOnlyAgain.body.data?.publishedDate !== today || dayOnlyAgain.body.data?.version !== dayOnly.body.data?.version) {
      wrong.push(`the day alone emptied: ${dayOnly.status} ${dayOnly.body.data?.status} / ${dayOnlyAgain.status} ${dayOnlyAgain.body.data?.status} v${dayOnlyAgain.body.data?.version}`);
    }
    const dayOnlyBack = await erp.post(`/api/storefront/news/${newsId}/revert`, { version: Number(dayOnlyAgain.body.data?.version) });
    if (dayOnlyBack.status !== 200 || dayOnlyBack.body.data?.version !== dayOnlyAgain.body.data?.version) wrong.push(`reverting the day alone emptied: ${dayOnlyBack.status} v${dayOnlyBack.body.data?.version}`);
    version = Number(dayOnlyAgain.body.data?.version);

    // 5) a changed draft leaves the site as it is; an address cannot change while the item is on the site; «برگرداندن» throws the change away
    const changed = await erp.put(`/api/storefront/news/${newsId}`, form(version, { sections: body('متن تازه', [second]), coverAssetId: null, newsDate: '2020-01-01', summary: 'خلاصهٔ تازه' }));
    const moved = await erp.put(`/api/storefront/news/${newsId}`, form(Number(changed.body.data?.version), { slug: `moved-${tag}` }));
    const [afterChange] = await orm.select().from(storefrontNews).where(eq(storefrontNews.id, newsId));
    if (changed.status !== 200 || changed.body.data?.status !== 'changed' || moved.status !== 422 || moved.body.code !== 'STOREFRONT_NEWS_SLUG_ON_SITE'
      || JSON.stringify(afterChange.published).includes('متن تازه') || afterChange.published?.coverAssetId !== cover) {
      wrong.push(`a changed draft and a move on the site: ${changed.status} ${changed.body.data?.status} / ${refusedCode(moved)}`);
    }
    const reverted = await erp.post(`/api/storefront/news/${newsId}/revert`, { version: Number(changed.body.data?.version) });
    const back = reverted.body.data?.draft as { coverAssetId?: number; summary?: string; newsDate?: string } | undefined;
    if (reverted.status !== 200 || reverted.body.data?.status !== 'published' || back?.coverAssetId !== cover || back.summary !== 'چند خط دیگر' || back.newsDate !== today
      || JSON.stringify(back).includes('متن تازه')) {
      wrong.push(`reverting the draft: ${reverted.status} ${reverted.body.data?.status} «${back?.summary}» ${back?.newsDate}`);
    }
    await audited(newsId, 'reverting', 'UPDATE', 'برگشت', ['before', 'after']);
    // with nothing to throw away it changes nothing
    const revertedAgain = await erp.post(`/api/storefront/news/${newsId}/revert`, { version: Number(reverted.body.data?.version) });
    if (revertedAgain.status !== 200 || revertedAgain.body.data?.version !== reverted.body.data?.version) wrong.push(`reverting twice: ${revertedAgain.status} v${revertedAgain.body.data?.version}`);
    version = Number(reverted.body.data?.version);

    // 6) a day to come: published, the item waits for its day
    const future = '2099-01-01';
    const dated = await erp.put(`/api/storefront/news/${newsId}`, form(version, { newsDate: future }));
    const scheduled = await erp.post(`/api/storefront/news/${newsId}/publish`, { version: Number(dated.body.data?.version) });
    const listed = ((await erp.get('/api/storefront/news')).body.data as Array<{ id: number; scheduled: boolean; publishedDate: string }>).find(r => r.id === newsId);
    if (scheduled.status !== 200 || scheduled.body.data?.publishedDate !== future || scheduled.body.data?.scheduled !== true || listed?.scheduled !== true || listed.publishedDate !== future) {
      wrong.push(`publishing under a day to come: ${scheduled.status} «${scheduled.body.data?.publishedDate}» scheduled ${scheduled.body.data?.scheduled}`);
    }
    version = Number(scheduled.body.data?.version);
    await audited(newsId, 'publishing under a day to come', 'UPDATE', 'در نوبت انتشار', ['before', 'after']);
    // published again with its day emptied, the item keeps the day it has on the site
    const undated = await erp.put(`/api/storefront/news/${newsId}`, form(version, { newsDate: '', sections: body('متن سوم') }));
    const keptDay = await erp.post(`/api/storefront/news/${newsId}/publish`, { version: Number(undated.body.data?.version) });
    if (keptDay.status !== 200 || keptDay.body.data?.publishedDate !== future || keptDay.body.data?.newsDate !== future || keptDay.body.data?.status !== 'published') {
      wrong.push(`publishing again without a day: ${keptDay.status} «${keptDay.body.data?.publishedDate}» ${keptDay.body.data?.status}`);
    }
    version = Number(keptDay.body.data?.version);

    // 7) nothing of an item reaches the site in this part: the site's image route gives the images of a page on the
    // site and no other, so not those of this published item, even while a page with the item's own id is on the site
    const { contentImageFile } = await import('../../services/storefront/storefrontPagePublic.js');
    const pageCopy = { title: 'x', seoTitle: '', seoDescription: '', noindex: false, shareImageAssetId: null, sections: [] };
    [twinBefore] = await orm.select().from(storefrontPages).where(eq(storefrontPages.id, newsId));
    twinBefore ??= null;
    twinId = newsId;
    if (twinBefore) await orm.update(storefrontPages).set({ published: pageCopy, publishedAt: new Date().toISOString() }).where(eq(storefrontPages.id, newsId));
    else await orm.insert(storefrontPages).values({ id: newsId, slug: `twin-${tag}`, title: 'x', published: pageCopy, publishedAt: new Date().toISOString() });
    const shaOf = async (assetId: number) => (await orm.select({ sha256: mediaAssets.sha256 }).from(mediaAssets).where(eq(mediaAssets.id, assetId)))[0].sha256;
    for (const assetId of [cover, inGallery, second]) {
      for (const file of [`${await shaOf(assetId)}.webp`, `${await shaOf(assetId)}-thumb.webp`]) {
        const given = await contentImageFile(file).then(() => 'given', () => 'refused');
        if (given !== 'refused') wrong.push(`the site's image route gave an image of a news item: ${file.slice(0, 12)}`);
      }
    }

    // 8) taken off the site and removed, each under its version; the image rows are switched off, never removed
    const off = await erp.post(`/api/storefront/news/${newsId}/unpublish`, { version });
    const afterOff = await orm.select().from(storefrontContentAssets).where(and(eq(storefrontContentAssets.contentKind, 'news'), eq(storefrontContentAssets.contentId, newsId)));
    if (off.status !== 200 || off.body.data?.status !== 'draft' || off.body.data?.publishedDate !== '' || afterOff.length !== 3 || afterOff.some(r => r.isDeleted !== 1)) {
      wrong.push(`taking the item off the site: ${off.status} ${off.body.data?.status}, image rows ${afterOff.map(r => r.isDeleted).join(',')}`);
    }
    version = Number(off.body.data?.version);
    await audited(newsId, 'taking off the site', 'UPDATE', 'برداشته شد', ['before', 'after']);
    const offAgain = await erp.post(`/api/storefront/news/${newsId}/unpublish`, { version });
    if (offAgain.status !== 200 || offAgain.body.data?.version !== version) wrong.push(`taking off an item that is not on the site: ${offAgain.status} v${offAgain.body.data?.version}`);
    const [removalStale, removal] = [await erp.del(`/api/storefront/news/${newsId}?version=${version + 5}`), await erp.del(`/api/storefront/news/${newsId}?version=${version}`)];
    const [removed] = await orm.select().from(storefrontNews).where(eq(storefrontNews.id, newsId));
    const afterRemoval = await erp.get(`/api/storefront/news/${newsId}`);
    // the address of a removed item is free again
    const reuse = await erp.post('/api/storefront/news', { title: `خبر دوم ${tag}`, slug });
    if (removalStale.status !== 409 || removal.status !== 200 || removed.isDeleted !== 1 || afterRemoval.status !== 404 || reuse.status !== 201) {
      wrong.push(`removing the item: ${removalStale.status}/${removal.status} deleted ${removed.isDeleted}, read ${afterRemoval.status}, address again ${reuse.status}`);
    }

    await audited(newsId, 'removing', 'DELETE', 'حذف شد', ['before', 'wasOnSite']);
    const [savedGone, publishedGone] = [await erp.put(`/api/storefront/news/${newsId}`, form(version + 1)), await erp.post(`/api/storefront/news/${newsId}/publish`, { version: version + 1 })];
    if (savedGone.status !== 404 || publishedGone.status !== 404) wrong.push(`a change to a removed item: ${savedGone.status}/${publishedGone.status}`);
    // an item removed while it is on the site leaves the site with it: no copy, no day, its image rows switched off
    if (reuse.status !== 201) throw new Error(`the address of a removed item: ${refusedCode(reuse)}`);
    const secondId = Number(reuse.body.data?.id);
    const secondSaved = await erp.put(`/api/storefront/news/${secondId}`, form(1));
    const secondOn = await erp.post(`/api/storefront/news/${secondId}/publish`, { version: Number(secondSaved.body.data?.version) });
    const secondGone = await erp.del(`/api/storefront/news/${secondId}?version=${Number(secondOn.body.data?.version)}`);
    const [secondRow] = await orm.select().from(storefrontNews).where(eq(storefrontNews.id, secondId));
    const secondImages = await orm.select().from(storefrontContentAssets).where(and(eq(storefrontContentAssets.contentKind, 'news'), eq(storefrontContentAssets.contentId, secondId)));
    if (secondOn.body.data?.status !== 'published' || secondGone.status !== 200 || secondRow.isDeleted !== 1 || secondRow.published !== null || secondRow.publishedAt !== null
      || secondRow.publishedDate !== null || secondImages.length !== 3 || secondImages.some(r => r.isDeleted !== 1)) {
      wrong.push(`removing an item on the site: ${secondOn.body.data?.status}/${secondGone.status} deleted ${secondRow.isDeleted}, copy ${secondRow.published === null ? 'gone' : 'kept'}, image rows ${secondImages.map(r => r.isDeleted).join(',')}`);
    }

    const copy0 = { title: 'x', summary: '', coverAssetId: null, newsDate: '2097-03-22', seoTitle: '', seoDescription: '', sections: [] };
    const copy = { ...copy0, newsDate: '2026-11-23' };
    // 9) the list: the newest day first, then the newest made, a page at a time, and never a removed item
    await orm.insert(storefrontNews).values(Array.from({ length: 51 }, (_, i) => ({ slug: `bulk-${i}-${tag}`, title: `خبر ${i}`, newsDate: i === 7 ? '2098-06-01' : null })));
    const [{ live }] = await orm.select({ live: sql<number>`count(*)::int` }).from(storefrontNews).where(eq(storefrontNews.isDeleted, 0));
    type ListRow = { id: number; slug: string };
    const [first, next] = [(await erp.get('/api/storefront/news')).body, (await erp.get('/api/storefront/news?page=2')).body] as Array<{ data: ListRow[]; total: number; page: number }>;
    const firstIds = first.data.map(r => r.id);
    const descending = firstIds.slice(1).every((rowId, i, rest) => i === 0 || rest[i - 1] > rowId);
    if (first.total !== live || first.data.length !== 50 || first.data[0]?.slug !== `bulk-7-${tag}` || next.page !== 2 || next.data.length !== Math.min(50, live - 50)
      || next.data.some(r => firstIds.includes(r.id)) || [...first.data, ...next.data].some(r => r.id === newsId || r.id === secondId) || (live === 51 && !descending)) {
      wrong.push(`the list: total ${first.total} of ${live}, page one ${first.data.length} from «${first.data[0]?.slug}», page two ${next.data.length}, in order ${descending}`);
    }

    // an item without a day is placed by its day on the site, else by the day it was made as that day was in Tehran:
    // 20:35 UTC on the 20th is already the 21st there
    await orm.insert(storefrontNews).values([
      { slug: `day-a-${tag}`, title: 'الف', newsDate: '2097-03-21' }, { slug: `day-b-${tag}`, title: 'ب', newsDate: '2097-03-20' },
      { slug: `day-c-${tag}`, title: 'پ', newsDate: null, createdAt: '2097-03-20T20:35:00Z' }, { slug: `day-d-${tag}`, title: 'ت', newsDate: null, createdAt: '2097-03-20T20:25:00Z' },
      { slug: `day-e-${tag}`, title: 'ث', newsDate: null, published: copy0, publishedAt: new Date().toISOString(), publishedDate: '2097-03-22', createdAt: '2020-01-01T00:00:00Z' },
    ]);
    const dayOrder = ((await erp.get('/api/storefront/news')).body.data as ListRow[]).map(r => r.slug).filter(name => name.startsWith('day-')).map(name => name.slice(4, 5)).join('');
    // e (on the site the 22nd), then the 21st: c (made 00:05 of the 21st in Tehran) above a by its newer id, then the 20th: d above b
    if (dayOrder !== 'ecadb') wrong.push(`the order of undated items: ${dayOrder}`);

    // two requests that take one address at the same moment: one makes it, each of the others is told it is taken
    const race = await Promise.all(Array.from({ length: 6 }, () => erp.post('/api/storefront/news', { title: 'هم‌زمان', slug: `race-${tag}` })));
    const raced = race.map(r => (r.status === 201 ? 'made' : refusedCode(r))).sort();
    if (raced.filter(r => r === 'made').length !== 1 || raced.filter(r => r === '409 STOREFRONT_NEWS_SLUG_TAKEN').length !== 5) wrong.push(`six requests for one address: ${raced.join(', ')}`);

    // 10) the constraints of migration 0033, against a direct write
    const direct = async (values: Partial<typeof storefrontNews.$inferInsert>) => orm.update(storefrontNews).set(values).where(eq(storefrontNews.id, newsId)).then(() => 'written', () => 'refused');
    const at = new Date().toISOString();
    const checks: Array<[string, string, string]> = [
      ['a copy without its time', await direct({ published: copy, publishedAt: null, publishedDate: '2026-11-23' }), 'refused'],
      ['a copy without its day', await direct({ published: copy, publishedAt: at, publishedDate: null }), 'refused'],
      ['a day without a copy', await direct({ published: null, publishedAt: null, publishedDate: '2026-11-23' }), 'refused'],
      ['a summary past the limit', await direct({ summary: 'ب'.repeat(301) }), 'refused'],
      ['a day that is no day', await direct({ newsDate: 'infinity' }), 'refused'],
      ['a day written empty', await direct({ newsDate: '' }), 'refused'],
      ['a day of the site that is no day', await direct({ published: copy, publishedAt: at, publishedDate: '23-11-2026' }), 'refused'],
      ['an address in another shape', await direct({ slug: 'Bad Address' }), 'refused'],
      ['a whole copy', await direct({ published: copy, publishedAt: at, publishedDate: '2026-11-23' }), 'written'],
    ];
    for (const [what, got, want] of checks) if (got !== want) wrong.push(`constraint, ${what}: ${got}`);
    const otherKind = await orm.insert(storefrontContentAssets).values({ contentKind: 'other', contentId: newsId, assetId: cover }).then(() => 'written', () => 'refused');
    if (otherKind !== 'refused') wrong.push('an image row of an unknown content kind was written');

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'the view key read and could not change, another key could do neither; a new item was an empty draft, a bad address, a taken one and an unknown field were refused; six unsafe or wrong drafts were refused and a stale save was 409; a draft wrote no image row; published without a day the item was dated today with its three images named under kind news and an audit row; a changed draft left the site as it was, the address could not change on the site and reverting threw the change away; under a day to come the item was marked as waiting, and published again without a day it kept that day; the image route of the site gave no image of the item beside a page on the site with its id; taking it off switched its image rows off and removing it was soft, under its version, and freed its address; an item removed on the site left it; the list was in order, paged and without removed items, an undated item placed by its day on the site or the day it was made in Tehran; of six requests for one address one made it and five were told it is taken; the constraints refused eight wrong direct writes and an unknown content kind; every change wrote its audit row',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: ((told: string) => (wrong.length > 0 && told !== wrong.join('; ') ? `${wrong.join('; ')}; ${told}` : told))(err instanceof Error ? err.message : String(err)),
    }));
  } finally {
    const mine = await orm.select({ id: storefrontNews.id }).from(storefrontNews).where(like(storefrontNews.slug, `%${tag}`)).catch(() => []);
    if (mine.length > 0) {
      await orm.delete(storefrontContentAssets).where(and(eq(storefrontContentAssets.contentKind, 'news'), inArray(storefrontContentAssets.contentId, mine.map(r => r.id)))).catch(() => undefined);
      await orm.delete(storefrontNews).where(inArray(storefrontNews.id, mine.map(r => r.id))).catch(() => undefined);
    }
    if (twinId && twinBefore) await orm.update(storefrontPages).set({ published: twinBefore.published, publishedAt: twinBefore.publishedAt }).where(eq(storefrontPages.id, twinId)).catch(() => undefined);
    if (twinId && !twinBefore) await orm.delete(storefrontPages).where(and(eq(storefrontPages.id, twinId), eq(storefrontPages.slug, `twin-${tag}`))).catch(() => undefined);
    if (assetIds.length > 0) await orm.delete(mediaAssets).where(inArray(mediaAssets.id, assetIds)).catch(() => undefined);
    if (sectionId) await orm.delete(mediaSections).where(eq(mediaSections.id, sectionId)).catch(() => undefined);
  }
  return results;
}
