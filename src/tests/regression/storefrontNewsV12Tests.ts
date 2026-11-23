import request from 'supertest';
import { and, desc, eq, inArray, like } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, mediaAssets, mediaSections, storefrontContentAssets, storefrontNews } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';

/**
 * v12 phase 10d (migration 0033; docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): «خبرهای سایت» on real Express routes
 * and PostgreSQL. A news item is made as a draft, saved under its version (a stale one is 409), published, reverted,
 * taken off the site and removed softly, each with its audit row. Published without a day it is dated today (Tehran);
 * with a day to come it waits for that day. Its body takes only text and gallery parts; its images must be live images
 * of the library, and the rows that name a published item's images are kept under content kind 'news'. Reading needs
 * `site_content.view`, changing `site_content.manage`. The Storefront API has no news yet, so nothing reaches the site.
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
    const wrong: string[] = [];
    const refusedCode = (res: { status: number; body: { code?: string } }) => `${res.status} ${res.body.code ?? ''}`;

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
    const stale = await erp.put(`/api/storefront/news/${newsId}`, form(7));
    const saved = await erp.put(`/api/storefront/news/${newsId}`, form(1));
    if (stale.status !== 409 || saved.status !== 200 || saved.body.data.version !== 2 || saved.body.data?.status !== 'draft' || saved.body.data?.assets.length !== 3) {
      wrong.push(`a stale and a good save: ${stale.status}/${saved.status} v${saved.body.data?.version} ${saved.body.data?.status}`);
    }
    if ((await orm.select().from(storefrontContentAssets).where(and(eq(storefrontContentAssets.contentKind, 'news'), eq(storefrontContentAssets.contentId, newsId)))).length !== 0) {
      wrong.push('a draft wrote the rows of a published item\'s images');
    }

    // 4) «انتشار» without a day: dated today (Tehran), on the site's side at once, its images named under kind 'news'
    const today = await businessTodayIsoDate();
    const published = await erp.post(`/api/storefront/news/${newsId}/publish`, { version: 2 });
    const [row] = await orm.select().from(storefrontNews).where(eq(storefrontNews.id, newsId));
    const named = await orm.select().from(storefrontContentAssets).where(and(eq(storefrontContentAssets.contentKind, 'news'), eq(storefrontContentAssets.contentId, newsId), eq(storefrontContentAssets.isDeleted, 0)));
    if (published.status !== 200 || published.body.data?.status !== 'published' || published.body.data?.publishedDate !== today || published.body.data?.newsDate !== today || published.body.data?.scheduled !== false
      || row.publishedDate !== today || row.published?.newsDate !== today || named.map(r => r.assetId).sort().join(',') !== [cover, inGallery, second].sort().join(',')) {
      wrong.push(`publishing without a day: ${published.status} ${published.body.data?.status} «${published.body.data?.publishedDate}» (today ${today}), images ${named.length}`);
    }
    const [audit] = await orm.select().from(activityLogs).where(eq(activityLogs.entityId, `news-${newsId}`)).orderBy(desc(activityLogs.id)).limit(1);
    if (audit?.entity !== 'خبر سایت' || !String(audit.description).includes('منتشر')) wrong.push(`the audit row of publishing: ${audit?.entity} ${String(audit?.description)}`);
    let version = Number(published.body.data?.version);
    // publishing the same copy again changes nothing
    const again = await erp.post(`/api/storefront/news/${newsId}/publish`, { version });
    if (again.status !== 200 || again.body.data.version !== version) wrong.push(`publishing the same copy twice: ${again.status} v${again.body.data?.version}`);

    // 5) a changed draft leaves the site as it is; an address cannot change while the item is on the site; «برگرداندن» throws the change away
    const changed = await erp.put(`/api/storefront/news/${newsId}`, form(version, { sections: body('متن تازه', [second]), coverAssetId: null, newsDate: today }));
    const moved = await erp.put(`/api/storefront/news/${newsId}`, form(Number(changed.body.data?.version), { slug: `moved-${tag}`, newsDate: today }));
    const [afterChange] = await orm.select().from(storefrontNews).where(eq(storefrontNews.id, newsId));
    if (changed.status !== 200 || changed.body.data?.status !== 'changed' || moved.status !== 422 || moved.body.code !== 'STOREFRONT_NEWS_SLUG_ON_SITE'
      || JSON.stringify(afterChange.published).includes('متن تازه') || afterChange.published?.coverAssetId !== cover) {
      wrong.push(`a changed draft and a move on the site: ${changed.status} ${changed.body.data?.status} / ${refusedCode(moved)}`);
    }
    const reverted = await erp.post(`/api/storefront/news/${newsId}/revert`, { version: Number(changed.body.data?.version) });
    if (reverted.status !== 200 || reverted.body.data?.status !== 'published' || reverted.body.data?.draft.coverAssetId !== cover || JSON.stringify(reverted.body.data?.draft).includes('متن تازه')) {
      wrong.push(`reverting the draft: ${reverted.status} ${reverted.body.data?.status}`);
    }
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
    // published again with its day emptied, the item keeps the day it has on the site
    const undated = await erp.put(`/api/storefront/news/${newsId}`, form(version, { newsDate: '', sections: body('متن سوم') }));
    const keptDay = await erp.post(`/api/storefront/news/${newsId}/publish`, { version: Number(undated.body.data?.version) });
    if (keptDay.status !== 200 || keptDay.body.data?.publishedDate !== future || keptDay.body.data?.newsDate !== future || keptDay.body.data?.status !== 'published') {
      wrong.push(`publishing again without a day: ${keptDay.status} «${keptDay.body.data?.publishedDate}» ${keptDay.body.data?.status}`);
    }
    version = Number(keptDay.body.data?.version);

    // 7) the Storefront API has no news yet: nothing of this reaches the site
    const apiKey = String((await erp.post('/api/storefront/api-key')).body.data?.apiKey ?? '');
    const onSite = await request(app).get('/api/storefront/v1/news').set('Authorization', `Bearer ${apiKey}`);
    const sitePages = await request(app).get('/api/storefront/v1/pages').set('Authorization', `Bearer ${apiKey}`);
    if (onSite.status === 200 || JSON.stringify(sitePages.body).includes(slug)) wrong.push(`news on the Storefront API before its part: ${onSite.status}`);

    // 8) taken off the site and removed, each under its version; the image rows are switched off, never removed
    const off = await erp.post(`/api/storefront/news/${newsId}/unpublish`, { version });
    const afterOff = await orm.select().from(storefrontContentAssets).where(and(eq(storefrontContentAssets.contentKind, 'news'), eq(storefrontContentAssets.contentId, newsId)));
    if (off.status !== 200 || off.body.data?.status !== 'draft' || off.body.data?.publishedDate !== '' || afterOff.length !== 3 || afterOff.some(r => r.isDeleted !== 1)) {
      wrong.push(`taking the item off the site: ${off.status} ${off.body.data?.status}, image rows ${afterOff.map(r => r.isDeleted).join(',')}`);
    }
    version = Number(off.body.data?.version);
    const [removalStale, removal] = [await erp.del(`/api/storefront/news/${newsId}?version=${version + 5}`), await erp.del(`/api/storefront/news/${newsId}?version=${version}`)];
    const [removed] = await orm.select().from(storefrontNews).where(eq(storefrontNews.id, newsId));
    const afterRemoval = await erp.get(`/api/storefront/news/${newsId}`);
    // the address of a removed item is free again
    const reuse = await erp.post('/api/storefront/news', { title: `خبر دوم ${tag}`, slug });
    if (removalStale.status !== 409 || removal.status !== 200 || removed.isDeleted !== 1 || afterRemoval.status !== 404 || reuse.status !== 201) {
      wrong.push(`removing the item: ${removalStale.status}/${removal.status} deleted ${removed.isDeleted}, read ${afterRemoval.status}, address again ${reuse.status}`);
    }

    // 9) the constraints of migration 0033, against a direct write
    const direct = async (values: Partial<typeof storefrontNews.$inferInsert>) => orm.update(storefrontNews).set(values).where(eq(storefrontNews.id, newsId)).then(() => 'written', () => 'refused');
    const copy = { title: 'x', summary: '', coverAssetId: null, newsDate: '2026-11-23', seoTitle: '', seoDescription: '', sections: [] };
    const at = new Date().toISOString();
    const checks: Array<[string, string, string]> = [
      ['a copy without its time', await direct({ published: copy, publishedAt: null, publishedDate: '2026-11-23' }), 'refused'],
      ['a copy without its day', await direct({ published: copy, publishedAt: at, publishedDate: null }), 'refused'],
      ['a day without a copy', await direct({ published: null, publishedAt: null, publishedDate: '2026-11-23' }), 'refused'],
      ['a summary past the limit', await direct({ summary: 'ب'.repeat(301) }), 'refused'],
      ['an address in another shape', await direct({ slug: 'Bad Address' }), 'refused'],
      ['a whole copy', await direct({ published: copy, publishedAt: at, publishedDate: '2026-11-23' }), 'written'],
    ];
    for (const [what, got, want] of checks) if (got !== want) wrong.push(`constraint, ${what}: ${got}`);
    const otherKind = await orm.insert(storefrontContentAssets).values({ contentKind: 'other', contentId: newsId, assetId: cover }).then(() => 'written', () => 'refused');
    if (otherKind !== 'refused') wrong.push('an image row of an unknown content kind was written');

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'the view key read and could not change, another key could do neither; a new item was an empty draft, a bad address, a taken one and an unknown field were refused; six unsafe or wrong drafts were refused and a stale save was 409; a draft wrote no image row; published without a day the item was dated today with its three images named under kind news and an audit row; a changed draft left the site as it was, the address could not change on the site and reverting threw the change away; under a day to come the item was marked as waiting, and published again without a day it kept that day; the Storefront API had no news; taking it off switched its image rows off and removing it was soft, under its version, and freed its address; the constraints refused five wrong direct writes and an unknown content kind',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    const mine = await orm.select({ id: storefrontNews.id }).from(storefrontNews).where(like(storefrontNews.slug, `%${tag}`)).catch(() => []);
    if (mine.length > 0) {
      await orm.delete(storefrontContentAssets).where(and(eq(storefrontContentAssets.contentKind, 'news'), inArray(storefrontContentAssets.contentId, mine.map(r => r.id)))).catch(() => undefined);
      await orm.delete(storefrontNews).where(inArray(storefrontNews.id, mine.map(r => r.id))).catch(() => undefined);
    }
    if (assetIds.length > 0) await orm.delete(mediaAssets).where(inArray(mediaAssets.id, assetIds)).catch(() => undefined);
    if (sectionId) await orm.delete(mediaSections).where(eq(mediaSections.id, sectionId)).catch(() => undefined);
  }
  return results;
}
