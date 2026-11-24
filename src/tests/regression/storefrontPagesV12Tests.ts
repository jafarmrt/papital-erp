import request from 'supertest';
import { and, eq, inArray, like } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, mediaAssets, mediaSections, storefrontContentAssets, storefrontPages } from '../../db/schema.js';
import { publishedContentAssetIds } from '../../services/storefront/storefrontPages.service.js';

/**
 * v12 phase 10b (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): the site's pages on real Express routes and PostgreSQL.
 * The migration's five base pages are there, unpublished; a draft is saved under its version (a stale one is 409) and
 * never changes the copy on the site; a script, a frame, an event attribute, a `javascript:` link, an unknown node and a
 * text past its length are each refused (422) with the section they are in, and write nothing; «انتشار» refuses an
 * unfinished page and an image that is not a live image of the library with a light version, copies the draft onto the
 * site and names its images in `storefront_content_assets`; taking a page off the site switches those rows off; a base
 * page is never removed; a holder of `site_content.view`, or of `storefront.manage` without `site_content.manage`,
 * cannot write, and a new image needs `media.view` too; the CHECK constraints hold against a direct write.
 */

interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;

export async function runStorefrontPagesV12Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_pages_v12_p10b';
  if (!shouldRun(id, 'v12', 'phase10', 'storefront', 'pages', 'occ', 'security')) return results;

  const name = 'v12 phase 10b: site pages keep a draft apart from the copy on the site, refuse unsafe content by name, publish only finished pages with usable library images, record those images, and hold their permissions and constraints';
  const tStart = Date.now();
  const pageIds: number[] = [];
  let sectionId = 0;
  const assetIds: number[] = [];
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

    // two images of the library with a light version, and one without
    const [section] = await orm.insert(mediaSections).values({ kind: 'custom', title: `عکس‌های صفحه ${tag}` }).returning({ id: mediaSections.id });
    sectionId = section.id;
    const image = async (n: number, light: number | null) => {
      const [asset] = await orm.insert(mediaAssets).values({
        sectionId, kind: 'image', title: `عکس صفحه ${n} ${tag}`, originalName: `page-${n}.jpg`, mimeType: 'image/jpeg', sizeBytes: 1000,
        sha256: `${String(n).repeat(8)}${tag}`.padEnd(64, 'a').slice(0, 64), width: 1600, height: 900, lightBytes: light, thumbBytes: light,
      }).returning({ id: mediaAssets.id });
      assetIds.push(asset.id);
      return asset.id;
    };
    const [imageA, imageB, imageNoLight] = [await image(1, 500), await image(2, 500), await image(3, null)];

    // 1) the five base pages of the migration, unpublished, first in the list
    const list = await erp.get('/api/storefront/pages');
    const base = (list.body.data ?? []).filter((row: Body) => row.kind === 'base');
    if (list.status !== 200 || base.map((row: Body) => row.slug).join(',') !== 'about,contact,shipping,terms,privacy'
      // v12 phase 10e: the one home row comes before them
      || (list.body.data ?? []).filter((row: Body) => row.kind !== 'home').slice(0, 5).some((row: Body) => row.kind !== 'base') || (list.body.data ?? [])[0]?.kind !== 'home') {
      wrong.push(`base pages: ${list.status} ${JSON.stringify(base.map((row: Body) => [row.slug, row.status]))}`);
    }
    const about = base.find((row: Body) => row.slug === 'about') as { id: number; version: number } | undefined;
    if (!about) throw new Error('the base page «about» is missing');
    const aboutBefore = (await orm.select().from(storefrontPages).where(eq(storefrontPages.id, about.id)))[0];

    // 2) a new page: an address in capitals 422, made as a draft from a template, the same address again 409
    const slug = `our-story-${tag}`;
    const badSlug = await erp.post('/api/storefront/pages', { title: 'داستان ما', slug: 'Our Story', template: null });
    if (badSlug.status !== 422 || badSlug.body.code !== 'STOREFRONT_PAGE_SLUG_INVALID') wrong.push(`a wrong address: ${badSlug.status} ${badSlug.body.code}`);
    const created = await erp.post('/api/storefront/pages', { title: `داستان ما ${tag}`, slug, template: 'about' });
    if (created.status !== 201 || created.body.data.status !== 'draft' || created.body.data.kind !== 'custom' || created.body.data.draft.sections.length !== 7) {
      throw new Error(`create from a template: ${created.status} ${JSON.stringify(created.body).slice(0, 300)}`);
    }
    const pageId = Number(created.body.data.id);
    pageIds.push(pageId);
    const twin = await erp.post('/api/storefront/pages', { title: 'دیگری', slug, template: null });
    if (twin.status !== 409 || twin.body.code !== 'STOREFRONT_PAGE_SLUG_TAKEN') wrong.push(`the same address: ${twin.status} ${twin.body.code}`);

    // 3) unsafe content is refused with its section, and nothing is written
    const p = (text: string, marks?: unknown[]) => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] });
    const textOf = (...content: unknown[]) => ({ kind: 'text', background: 'white', doc: { type: 'doc', content } });
    const good = textOf(p('متن خوب'));
    const form = (sections: unknown[], version: number, over: Body = {}) => ({
      title: `داستان ما ${tag}`, slug, seoTitle: '', seoDescription: '', noindex: false, shareImageAssetId: null, sections, version, ...over,
    });
    const unsafe: Array<[string, unknown, string]> = [
      ['a script node', textOf({ type: 'script', content: [{ type: 'text', text: 'alert(1)' }] }), 'STOREFRONT_PAGE_NODE_UNKNOWN'],
      ['a frame', textOf({ type: 'iframe', attrs: { src: 'https://evil.example' } }), 'STOREFRONT_PAGE_NODE_UNKNOWN'],
      ['a javascript link', textOf(p('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }])), 'STOREFRONT_PAGE_LINK_INVALID'],
      ['an unknown mark', textOf(p('x', [{ type: 'code' }])), 'STOREFRONT_PAGE_MARK_UNKNOWN'],
      ['a text past its length', textOf(p('x'.repeat(20_001))), 'STOREFRONT_PAGE_TEXT_TOO_LONG'],
      ['a free HTML section', { kind: 'html', html: '<img src=x onerror=alert(1)>' }, 'STOREFRONT_PAGE_FIELD_INVALID'],
      ['an event attribute on a section', { kind: 'button', background: 'white', label: 'x', href: '/x', onclick: 'alert(1)' }, 'STOREFRONT_PAGE_FIELD_UNKNOWN'],
      ['a button to another scheme', { kind: 'button', background: 'white', label: 'x', href: 'data:text/html,x' }, 'STOREFRONT_PAGE_LINK_INVALID'],
    ];
    for (const [what, bad, code] of unsafe) {
      const res = await erp.put(`/api/storefront/pages/${pageId}`, form([good, bad], 1));
      if (res.status !== 422 || res.body.code !== code || res.body.details?.section !== 1) wrong.push(`${what}: ${res.status} ${res.body.code} section ${res.body.details?.section}`);
    }
    // an event attribute inside the editor's text is not refused but never kept (the editor adds attributes of its own)
    const rowAfterRefusals = (await orm.select().from(storefrontPages).where(eq(storefrontPages.id, pageId)))[0];
    if (rowAfterRefusals.version !== 1 || rowAfterRefusals.sections.length !== 7) wrong.push(`a refused save wrote something: version ${rowAfterRefusals.version}`);

    // 4) a draft: saved under its version, a stale one 409, the copy on the site untouched (there is none yet)
    const finished = [
      { kind: 'hero', background: 'brand', title: 'داستان ما', text: '', imageAssetId: null, buttonLabel: '', buttonHref: '' },
      textOf({ type: 'heading', attrs: { level: 2, onclick: 'alert(1)' }, content: [{ type: 'text', text: 'کارگاه' }] }, p('متن', [{ type: 'link', attrs: { href: '/about', target: '_blank', onclick: 'alert(1)' } }])),
      { kind: 'gallery', background: 'white', title: '', images: [{ assetId: imageA, alt: 'عکس یک' }, { assetId: imageB, alt: 'عکس دو' }] },
    ];
    const saved = await erp.put(`/api/storefront/pages/${pageId}`, form(finished, 1));
    if (saved.status !== 200 || saved.body.data.version !== 2 || saved.body.data.status !== 'draft' || saved.body.data.assets.length !== 2
      || saved.body.data.assets.some((asset: Body) => asset.usable !== true)) {
      throw new Error(`save a draft: ${saved.status} ${JSON.stringify(saved.body).slice(0, 400)}`);
    }
    if (/onclick|target/.test(JSON.stringify(saved.body.data.draft))) wrong.push('an attribute the checker does not know was kept in the draft');
    const stale = await erp.put(`/api/storefront/pages/${pageId}`, form(finished, 1));
    if (stale.status !== 409) wrong.push(`a stale draft: ${stale.status}, not 409`);
    const afterDraft = (await orm.select().from(storefrontPages).where(eq(storefrontPages.id, pageId)))[0];
    if (afterDraft.published !== null || afterDraft.publishedAt !== null) wrong.push('saving a draft put the page on the site');
    if ((await publishedContentAssetIds(orm)).some(assetId => assetIds.includes(assetId))) wrong.push('an image of a draft is named as published');

    // 5) publish: a new image without a light version is refused at once; one the draft already has that then loses its
    //    light version still saves (so it can be replaced) but cannot go onto the site; an unfinished page cannot either
    const withBadImage = await erp.put(`/api/storefront/pages/${pageId}`, form([...finished, { kind: 'hero', background: 'dark', title: 'x', text: '', imageAssetId: imageNoLight, buttonLabel: '', buttonHref: '' }], 2));
    if (withBadImage.status !== 422 || withBadImage.body.code !== 'STOREFRONT_PAGE_IMAGE_UNKNOWN') wrong.push(`a new image without a light version: ${withBadImage.status} ${withBadImage.body.code}`);
    await orm.update(mediaAssets).set({ lightBytes: null }).where(eq(mediaAssets.id, imageB));
    const publishBroken = await erp.post(`/api/storefront/pages/${pageId}/publish`, { version: 2 });
    const keepBroken = await erp.put(`/api/storefront/pages/${pageId}`, form(finished, 2, { seoDescription: 'توضیح' }));
    await orm.update(mediaAssets).set({ lightBytes: 500 }).where(eq(mediaAssets.id, imageB));
    if (publishBroken.status !== 422 || publishBroken.body.code !== 'STOREFRONT_PAGE_IMAGE_UNKNOWN' || keepBroken.status !== 200
      || keepBroken.body.data.assets.find((asset: Body) => asset.assetId === imageB)?.usable !== false) {
      wrong.push(`an image that lost its light version: publish ${publishBroken.status} ${publishBroken.body.code}, keep in the draft ${keepBroken.status}`);
    }
    const unknownImage = await erp.put(`/api/storefront/pages/${pageId}`, form([{ kind: 'hero', background: 'dark', title: 'x', text: '', imageAssetId: 2_000_000_000, buttonLabel: '', buttonHref: '' }], 3));
    if (unknownImage.status !== 422 || unknownImage.body.code !== 'STOREFRONT_PAGE_IMAGE_UNKNOWN') wrong.push(`an image that is not in the library: ${unknownImage.status} ${unknownImage.body.code}`);
    const halfDone = await erp.put(`/api/storefront/pages/${pageId}`, form([...finished, { kind: 'gallery', background: 'white', title: '', images: [] }], 3));
    const publishHalfDone = await erp.post(`/api/storefront/pages/${pageId}/publish`, { version: 4 });
    if (halfDone.status !== 200 || publishHalfDone.status !== 422 || publishHalfDone.body.code !== 'STOREFRONT_PAGE_UNFINISHED' || publishHalfDone.body.details?.section !== 3) {
      wrong.push(`publishing an unfinished page: ${publishHalfDone.status} ${publishHalfDone.body.code} section ${publishHalfDone.body.details?.section}`);
    }
    const ready = await erp.put(`/api/storefront/pages/${pageId}`, form(finished, 4, { shareImageAssetId: imageA }));
    const published = await erp.post(`/api/storefront/pages/${pageId}/publish`, { version: 5 });
    if (ready.status !== 200 || published.status !== 200 || published.body.data.status !== 'published' || published.body.data.version !== 6 || !published.body.data.publishedAt) {
      throw new Error(`publish: ${published.status} ${JSON.stringify(published.body).slice(0, 400)}`);
    }
    const onSite = (await publishedContentAssetIds(orm)).filter(assetId => assetIds.includes(assetId)).sort((a, b) => a - b);
    if (JSON.stringify(onSite) !== JSON.stringify([imageA, imageB].sort((a, b) => a - b))) wrong.push(`the published page's images: ${JSON.stringify(onSite)}`);
    const again = await erp.post(`/api/storefront/pages/${pageId}/publish`, { version: 6 });
    if (again.status !== 200 || again.body.data.version !== 6) wrong.push(`publishing an unchanged page: ${again.status} version ${again.body.data?.version}`);

    // 6) a later draft does not touch the copy on the site; «برگرداندن» throws it away
    const edited = await erp.put(`/api/storefront/pages/${pageId}`, form([finished[0], finished[1]], 6, { title: `عنوان تازه ${tag}` }));
    const rowEdited = (await orm.select().from(storefrontPages).where(eq(storefrontPages.id, pageId)))[0];
    if (edited.status !== 200 || edited.body.data.status !== 'changed' || rowEdited.published?.title !== `داستان ما ${tag}` || rowEdited.published.sections.length !== 3) {
      wrong.push(`a draft after publishing: ${edited.status} ${edited.body.data?.status}, on the site «${rowEdited.published?.title}» with ${rowEdited.published?.sections.length} sections`);
    }
    const stillOnSite = (await publishedContentAssetIds(orm)).filter(assetId => assetIds.includes(assetId));
    if (stillOnSite.length !== 2) wrong.push(`a draft without the gallery changed the published images: ${JSON.stringify(stillOnSite)}`);
    const reverted = await erp.post(`/api/storefront/pages/${pageId}/revert`, { version: 7 });
    if (reverted.status !== 200 || reverted.body.data.status !== 'published' || reverted.body.data.title !== `داستان ما ${tag}` || reverted.body.data.draft.sections.length !== 3) {
      wrong.push(`revert: ${reverted.status} ${JSON.stringify(reverted.body.data).slice(0, 200)}`);
    }

    // 7) permissions: view-only and storefront.manage alone cannot write; a new image needs media.view too
    const roleOf = async (permissions: string[]) => as(await loginTestUserWithSession(app, (await createTestUser({ role: (await createTestRole({ permissions })).code })).username));
    const viewer = await roleOf(['site_content.view']);
    const version = Number(reverted.body.data.version);
    const viewerRead = await viewer.get(`/api/storefront/pages/${pageId}`);
    const viewerSave = await viewer.put(`/api/storefront/pages/${pageId}`, form(finished, version, { shareImageAssetId: imageA }));
    const viewerPublish = await viewer.post(`/api/storefront/pages/${pageId}/publish`, { version });
    const viewerImages = await viewer.get('/api/storefront/pages/image-options');
    if (viewerRead.status !== 200 || viewerSave.status !== 403 || viewerPublish.status !== 403 || viewerImages.status !== 403) {
      wrong.push(`view only: read ${viewerRead.status}, save ${viewerSave.status}, publish ${viewerPublish.status}, image list ${viewerImages.status}`);
    }
    const shopManager = await roleOf(['storefront.view', 'storefront.manage']);
    const managerList = await shopManager.get('/api/storefront/pages');
    const managerSave = await shopManager.put(`/api/storefront/pages/${pageId}`, form(finished, version, { shareImageAssetId: imageA }));
    if (managerList.status !== 403 || managerSave.status !== 403) wrong.push(`storefront.manage without site_content: list ${managerList.status}, save ${managerSave.status}`);
    const editor = await roleOf(['site_content.view', 'site_content.manage']);
    const editorKeeps = await editor.put(`/api/storefront/pages/${pageId}`, form(finished, version, { shareImageAssetId: imageA, seoTitle: 'عنوان جست‌وجو' }));
    if (editorKeeps.status !== 200) wrong.push(`an editor keeping the page's own images: ${editorKeeps.status} ${editorKeeps.body.code}`);
    const [imageC] = [await image(4, 500)];
    const editorAdds = await editor.put(`/api/storefront/pages/${pageId}`, form([...finished, { kind: 'hero', background: 'dark', title: 'x', text: '', imageAssetId: imageC, buttonLabel: '', buttonHref: '' }], version + 1, { shareImageAssetId: imageA }));
    if (editorAdds.status !== 403 || editorAdds.body.code !== 'STOREFRONT_PAGE_IMAGE_FORBIDDEN') wrong.push(`a new image without media.view: ${editorAdds.status} ${editorAdds.body.code}`);
    const noSession = await request(app).get('/api/storefront/pages');
    if (noSession.status !== 401) wrong.push(`no session: ${noSession.status}`);

    // 8) off the site: the published copy is emptied, its images are switched off (the rows stay)
    const off = await erp.post(`/api/storefront/pages/${pageId}/unpublish`, { version: version + 1 });
    const rowOff = (await orm.select().from(storefrontPages).where(eq(storefrontPages.id, pageId)))[0];
    const links = await orm.select().from(storefrontContentAssets).where(and(eq(storefrontContentAssets.contentKind, 'page'), eq(storefrontContentAssets.contentId, pageId)));
    if (off.status !== 200 || off.body.data.status !== 'draft' || rowOff.published !== null || links.length !== 2 || links.some(link => link.isDeleted !== 1)
      || (await publishedContentAssetIds(orm)).some(assetId => assetIds.includes(assetId))) {
      wrong.push(`off the site: ${off.status} ${off.body.data?.status}, image rows ${JSON.stringify(links.map(link => link.isDeleted))}`);
    }
    const revertUnpublished = await erp.post(`/api/storefront/pages/${pageId}/revert`, { version: Number(off.body.data?.version) });
    if (revertUnpublished.status !== 422 || revertUnpublished.body.code !== 'STOREFRONT_PAGE_NOT_PUBLISHED') wrong.push(`reverting a page that is not on the site: ${revertUnpublished.status}`);

    // 9) a base page is never removed, keeps its address, and was not touched; a custom page is removed softly
    const baseDelete = await erp.del(`/api/storefront/pages/${about.id}?version=${about.version}`);
    if (baseDelete.status !== 422 || baseDelete.body.code !== 'STOREFRONT_PAGE_BASE_KEPT') wrong.push(`removing a base page: ${baseDelete.status} ${baseDelete.body.code}`);
    const baseSlug = await erp.put(`/api/storefront/pages/${about.id}`, { title: 'درباره ما', slug: 'about-us', seoTitle: '', seoDescription: '', noindex: false, shareImageAssetId: null, sections: [], version: about.version });
    if (baseSlug.status !== 422 || baseSlug.body.code !== 'STOREFRONT_PAGE_SLUG_INVALID') wrong.push(`a base page's address: ${baseSlug.status} ${baseSlug.body.code}`);
    const aboutAfter = (await orm.select().from(storefrontPages).where(eq(storefrontPages.id, about.id)))[0];
    if (aboutAfter.version !== aboutBefore.version || aboutAfter.slug !== 'about') wrong.push('a refused change wrote to the base page');
    const removed = await erp.del(`/api/storefront/pages/${pageId}?version=${Number(off.body.data?.version)}`);
    const rowRemoved = (await orm.select().from(storefrontPages).where(eq(storefrontPages.id, pageId)))[0];
    const gone = await erp.get(`/api/storefront/pages/${pageId}`);
    if (removed.status !== 200 || rowRemoved.isDeleted !== 1 || gone.status !== 404) wrong.push(`soft delete: ${removed.status}, is_deleted ${rowRemoved.isDeleted}, read ${gone.status}`);
    const reuse = await erp.post('/api/storefront/pages', { title: `دوباره ${tag}`, slug, template: null });
    if (reuse.status !== 201) wrong.push(`the address of a removed page: ${reuse.status}`);
    else pageIds.push(Number(reuse.body.data.id));

    // 10) one audit row per change that wrote
    const audits = await orm.select({ id: activityLogs.id }).from(activityLogs).where(eq(activityLogs.entityId, `page-${pageId}`));
    // create, 3 draft saves before publishing + the ready one, publish, the edit, revert, the editor's save, unpublish, delete
    if (audits.length !== 11) wrong.push(`audit rows of the page: ${audits.length}, not 11`);

    // 11) the constraints hold against a direct write
    const direct = async (what: string, values: Partial<typeof storefrontPages.$inferInsert>) => {
      const refused = await orm.insert(storefrontPages).values({ kind: 'custom', slug: `direct-${tag}`, title: 'مستقیم', ...values }).then(() => false, () => true);
      if (!refused) wrong.push(`a direct write was accepted: ${what}`);
    };
    await direct('an unknown kind', { kind: 'html' });
    await direct('an address in capitals', { slug: 'Direct' });
    await direct('a noindex flag of 2', { noindex: 2 });
    await direct('a second live page with a base address', { slug: 'about' });
    await direct('a published copy without its time', { published: { title: 'x', seoTitle: '', seoDescription: '', noindex: false, shareImageAssetId: null, sections: [] } });
    const baseGone = await orm.update(storefrontPages).set({ isDeleted: 1 }).where(eq(storefrontPages.id, about.id)).then(() => false, () => true);
    if (!baseGone) wrong.push('a base page was soft-deleted by a direct write');

    // 12) the review of 10b, on a second page
    const slug2 = `review-${tag}`;
    const made2 = await erp.post('/api/storefront/pages', { title: `بازبینی ${tag}`, slug: slug2, template: null });
    if (made2.status !== 201) throw new Error(`a second page: ${made2.status}`);
    const page2 = Number(made2.body.data.id);
    pageIds.push(page2);
    const form2 = (sections: unknown[], version: number, over: Body = {}) => ({
      title: `بازبینی ${tag}`, slug: slug2, seoTitle: '', seoDescription: '', noindex: false, shareImageAssetId: null, sections, version, ...over,
    });
    const buttonTo = (href: string) => ({ kind: 'button', background: 'white', label: 'خرید', href });
    const gallery = { kind: 'gallery', background: 'white', title: '', images: [{ assetId: imageA, alt: 'یک' }, { assetId: imageB, alt: 'دو' }] };
    // a hostile request is answered with a refusal, never a failure of the server
    const loneInTitle = await erp.put(`/api/storefront/pages/${page2}`, form2([], 1, { title: 'a\ud800b' }));
    const loneInText = await erp.put(`/api/storefront/pages/${page2}`, form2([textOf(p('a\udc00b'))], 1));
    if (loneInTitle.status !== 422 || loneInText.status !== 422) wrong.push(`half of a surrogate pair: title ${loneInTitle.status}, text ${loneInText.status} (not 422)`);
    // nesting too deep to be written out again: sent as text, as only a forged request can
    const depth = 20_000;
    const deepDoc = `${'{"type":"bulletList","content":[{"type":"listItem","content":['.repeat(depth)}{"type":"paragraph"}${']}]}'.repeat(depth)}`;
    const deepBody = JSON.stringify(form2(['DEEP'], 1)).replace('"DEEP"', `{"kind":"text","background":"white","doc":{"type":"doc","content":[${deepDoc}]}}`);
    const tooDeep = await request(app).put(`/api/storefront/pages/${page2}`).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken)
      .set('Content-Type', 'application/json').send(deepBody);
    if (tooDeep.status < 400 || tooDeep.status >= 500) wrong.push(`a text nested twenty thousand deep: ${tooDeep.status} (not a refusal)`);
    const emptyList = await erp.put(`/api/storefront/pages/${page2}`, form2([textOf({ type: 'bulletList' })], 1));
    if (emptyList.status !== 422 || emptyList.body.code !== 'STOREFRONT_PAGE_NODE_EMPTY') wrong.push(`an empty list: ${emptyList.status} ${emptyList.body.code}`);
    const listInCell = await erp.put(`/api/storefront/pages/${page2}`, form2([textOf({ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [p('x')] }] }] }] }] })], 1));
    if (listInCell.status !== 422 || listInCell.body.code !== 'STOREFRONT_PAGE_NODE_MISPLACED' || /[A-Za-z]/.test(String(listInCell.body.message ?? listInCell.body.error ?? ''))) {
      wrong.push(`a list inside a table cell: ${listInCell.status} ${listInCell.body.code} «${listInCell.body.message ?? listInCell.body.error}»`);
    }
    if ((await orm.select().from(storefrontPages).where(eq(storefrontPages.id, page2)))[0].version !== 1) wrong.push('a refused request wrote to the second page');
    // a numbered list keeps where it starts; the page goes onto the site with a button and two images
    const numbered = textOf({ type: 'orderedList', attrs: { start: 5, type: 'a' }, content: [{ type: 'listItem', content: [p('پنجم')] }] });
    const saved2 = await erp.put(`/api/storefront/pages/${page2}`, form2([buttonTo('/products'), numbered, gallery], 1));
    if (saved2.status !== 200 || JSON.stringify(saved2.body.data.draft.sections[1].doc.content[0].attrs) !== '{"start":5}') {
      wrong.push(`a list starting at five: ${saved2.status} ${JSON.stringify(saved2.body.data?.draft?.sections?.[1]?.doc?.content?.[0]?.attrs)}`);
    }
    const published2 = await erp.post(`/api/storefront/pages/${page2}/publish`, { version: 2 });
    if (published2.status !== 200) throw new Error(`publish the second page: ${published2.status} ${JSON.stringify(published2.body).slice(0, 300)}`);
    // the address of a page on the site is not a draft's to move
    const moved = await erp.put(`/api/storefront/pages/${page2}`, form2([buttonTo('/products'), numbered, gallery], 3, { slug: `${slug2}-moved` }));
    const rowMoved = (await orm.select().from(storefrontPages).where(eq(storefrontPages.id, page2)))[0];
    if (moved.status !== 422 || moved.body.code !== 'STOREFRONT_PAGE_SLUG_ON_SITE' || rowMoved.slug !== slug2 || rowMoved.version !== 3) {
      wrong.push(`moving the address of a page on the site by a draft: ${moved.status} ${moved.body.code}, slug ${rowMoved.slug}`);
    }
    // the audit rows show what a change puts on the public site: here a button sent to another address
    const relinked = await erp.put(`/api/storefront/pages/${page2}`, form2([buttonTo('https://phishing.example/login'), numbered], 3));
    const republished = await erp.post(`/api/storefront/pages/${page2}/publish`, { version: 4 });
    const trail = await orm.select({ description: activityLogs.description, details: activityLogs.details }).from(activityLogs).where(eq(activityLogs.entityId, `page-${page2}`));
    const trailText = JSON.stringify(trail.map(r => r.details));
    const publishRows = trail.filter(r => String(r.description).includes('منتشر شد'));
    if (relinked.status !== 200 || republished.status !== 200 || publishRows.length !== 2 || !trailText.includes('https://phishing.example/login') || !trailText.includes('/products')
      || !trailText.includes('پنجم')) {
      wrong.push(`the audit rows of a changed link: ${relinked.status}/${republished.status}, ${publishRows.length} publish rows, phishing ${trailText.includes('https://phishing.example/login')}, products ${trailText.includes('/products')}`);
    }
    // republished with fewer images: only what the copy on the site names is still named
    if ((await publishedContentAssetIds(orm)).some(assetId => assetIds.includes(assetId))) wrong.push('images the republished page no longer names are still named as published');
    // an image the page still has on the site may come back into the draft without the library's key ...
    const backOnSite = await erp.put(`/api/storefront/pages/${page2}`, form2([buttonTo('/products'), gallery], 5));
    const backPublished = await erp.post(`/api/storefront/pages/${page2}/publish`, { version: 6 });
    const withoutGallery = await erp.put(`/api/storefront/pages/${page2}`, form2([buttonTo('/products')], 7));
    const editorBringsBack = await editor.put(`/api/storefront/pages/${page2}`, form2([buttonTo('/products'), gallery], 8));
    if (backOnSite.status !== 200 || backPublished.status !== 200 || withoutGallery.status !== 200 || editorBringsBack.status !== 200) {
      wrong.push(`an editor bringing back an image the published copy still has: ${backOnSite.status}/${backPublished.status}/${withoutGallery.status}/${editorBringsBack.status}`);
    }
    // ... but an image that left the library is never taken as a new image, whoever asks
    await orm.update(mediaAssets).set({ isDeleted: 1 }).where(eq(mediaAssets.id, imageC));
    const removedImage = await erp.put(`/api/storefront/pages/${page2}`, form2([buttonTo('/products'), gallery, { kind: 'hero', background: 'dark', title: 'x', text: '', imageAssetId: imageC, buttonLabel: '', buttonHref: '' }], 9));
    if (removedImage.status !== 422 || removedImage.body.code !== 'STOREFRONT_PAGE_IMAGE_UNKNOWN') wrong.push(`a removed image as a new image: ${removedImage.status} ${removedImage.body.code}`);
    // off the site, the address may change
    const off2 = await erp.post(`/api/storefront/pages/${page2}/unpublish`, { version: 9 });
    const movedOff = await erp.put(`/api/storefront/pages/${page2}`, form2([buttonTo('/products')], 10, { slug: `${slug2}-moved` }));
    if (off2.status !== 200 || movedOff.status !== 200 || movedOff.body.data.slug !== `${slug2}-moved`) wrong.push(`moving the address off the site: ${off2.status}/${movedOff.status} ${movedOff.body.data?.slug}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'the five base pages were there unpublished; a page from a template was a draft, its address unique; eight kinds of unsafe content were refused with their section and wrote nothing, and unknown attributes were never kept; a draft saved under its version (stale 409) left the site untouched; publishing refused an image without a light version, an image not in the library and an unfinished section, then put the draft on the site and named its two images; a later draft and a revert left the published copy alone; view-only and storefront.manage alone could not write, a new image needed media.view; off the site switched the image rows off; a base page was neither removed nor renamed, a custom page was removed softly and its address freed; eleven audit rows; six direct writes were refused by the constraints; and, from the review: half a surrogate pair, a text nested twenty thousand deep, an empty list and a list in a table cell were refusals (not failures), a numbered list kept its start, a draft could not move the address of a page on the site, the audit rows showed the old and the new address of a button, a republish with fewer images dropped the others, an editor could bring back an image the published copy still had, and a removed image was never taken as new',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (pageIds.length > 0) {
      await orm.delete(storefrontContentAssets).where(and(eq(storefrontContentAssets.contentKind, 'page'), inArray(storefrontContentAssets.contentId, pageIds))).catch(() => undefined);
      await orm.delete(storefrontPages).where(inArray(storefrontPages.id, pageIds)).catch(() => undefined);
    }
    await orm.delete(storefrontPages).where(like(storefrontPages.slug, 'direct-%')).catch(() => undefined);
    if (assetIds.length > 0) await orm.delete(mediaAssets).where(inArray(mediaAssets.id, assetIds)).catch(() => undefined);
    if (sectionId) await orm.delete(mediaSections).where(eq(mediaSections.id, sectionId)).catch(() => undefined);
  }
  return results;
}
