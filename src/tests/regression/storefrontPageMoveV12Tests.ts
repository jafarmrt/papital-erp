import request from 'supertest';
import { and, desc, eq, gt, inArray, like, max } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, appSettings, storefrontPages, storefrontRedirects } from '../../db/schema.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { readPricingStrategies } from '../../lib/items/pricingStrategies.js';

/**
 * v12 phase 10c (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): «تغییر نشانی» of a page, on real Express routes and
 * PostgreSQL. A page on the site takes its new address under its version, and in the same transaction its old address
 * goes to the new one in «نشانی‌های سایت قبلی»: every earlier address leads to the page's address of now in one hop,
 * a move back leaves no circle, a redirect the owner had on the old address is pointed anew, and each row changed has
 * its audit row. A page off the site moves with no redirect. A stale version, a taken or wrong address, a base page and
 * a holder of the view key are refused, and a draft save still never moves a page that is on the site.
 */
interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;

export async function runStorefrontPageMoveV12Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_page_move_v12_p10c';
  if (!shouldRun(id, 'v12', 'phase10', 'storefront', 'pages', 'redirects', 'occ', 'security')) return results;

  const name = 'v12 phase 10c: a published page moves to a new address under its version and every earlier address is redirected to it in one hop, with audit rows, refusals and no circle';
  const tStart = Date.now();
  const pageIds: number[] = [];
  const savedSettings = await orm.select().from(appSettings).where(like(appSettings.key, 'sf\\_%'));
  const savedStrategies = await orm.select().from(appSettings).where(eq(appSettings.key, 'pricing_strategies'));
  const [{ lastRedirect }] = await orm.select({ lastRedirect: max(storefrontRedirects.id) }).from(storefrontRedirects);
  try {
    const { getTestApp, getAdminSession, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestRole, createTestUser } = await import('../fixtures/factories.js');
    const app = await getTestApp();
    const admin: Session = await getAdminSession();
    const as = (s: Session) => ({
      get: (url: string) => request(app).get(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken),
      put: (url: string, body: Body) => request(app).put(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
      post: (url: string, body: Body = {}) => request(app).post(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
    });
    const erp = as(admin);
    const tag = String(Date.now()).slice(-7);
    const wrong: string[] = [];

    const retailList = `تکی تغییر نشانی ${tag}`;
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
    /** the redirects the site gets for this run's addresses, as «from→target» */
    const siteRedirects = async () => (((await site('/redirects')).body.data ?? []) as Array<{ from: string; kind: string; target: string }>)
      .filter(r => r.from.includes(tag)).map(r => `${r.from}→${r.kind}:${r.target}`).sort().join(' | ');
    const liveRows = async () => (await orm.select().from(storefrontRedirects).where(and(gt(storefrontRedirects.id, lastRedirect ?? 0), eq(storefrontRedirects.isDeleted, 0))))
      .filter(r => r.fromPath.includes(tag));

    const [a, b, c] = [`move-a-${tag}`, `move-b-${tag}`, `move-c-${tag}`];
    const title = `صفحهٔ جابه‌جا ${tag}`;
    const created = await erp.post('/api/storefront/pages', { title, slug: a, template: null });
    if (created.status !== 201) throw new Error(`a new page: ${created.status} ${JSON.stringify(created.body)}`);
    const pageId = Number(created.body.data.id);
    pageIds.push(pageId);
    const form = (version: number, slug: string) => ({
      title, slug, seoTitle: '', seoDescription: '', noindex: false, shareImageAssetId: null, sections: [{ kind: 'button', background: 'white', label: 'محصولات', href: '/products' }], version,
    });
    const versionNow = async () => Number((await erp.get(`/api/storefront/pages/${pageId}`)).body.data.version);
    const move = (slug: unknown, version: number, by = erp) => by.post(`/api/storefront/pages/${pageId}/move`, { slug, version } as Body);

    // 1) off the site (a draft): the page takes the new address and nothing is written to the redirects
    const draft = await erp.put(`/api/storefront/pages/${pageId}`, form(1, a));
    const offMove = await move(b, 2);
    if (draft.status !== 200 || offMove.status !== 200 || offMove.body.data.slug !== b || offMove.body.data.version !== 3 || (await liveRows()).length !== 0) {
      wrong.push(`moving a draft: ${draft.status}/${offMove.status} ${offMove.body.data?.slug} v${offMove.body.data?.version}, ${(await liveRows()).length} redirects`);
    }
    const backToA = await move(a, 3);
    if (backToA.status !== 200) throw new Error(`moving the draft back: ${backToA.status} ${JSON.stringify(backToA.body)}`);

    // 2) on the site: refused first, each with its code, and nothing changes
    const published = await erp.post(`/api/storefront/pages/${pageId}/publish`, { version: 4 });
    if (published.status !== 200) throw new Error(`publishing: ${published.status} ${JSON.stringify(published.body)}`);
    const other = await erp.post('/api/storefront/pages', { title: `دیگری ${tag}`, slug: `move-taken-${tag}`, template: null });
    pageIds.push(Number(other.body.data?.id));
    const [about] = await orm.select().from(storefrontPages).where(eq(storefrontPages.slug, 'about'));
    const viewer = as(await loginTestUserWithSession(app, (await createTestUser({ role: (await createTestRole({ permissions: ['site_content.view'] })).code })).username));
    const refusals: Array<[string, { status: number; body: Body }, number, string]> = [
      ['a stale version', await move(b, 4), 409, 'OCC_CONFLICT'],
      ['an address another page has', await move(`move-taken-${tag}`, 5), 409, 'STOREFRONT_PAGE_SLUG_TAKEN'],
      ['an address in capitals', await move('Our Story', 5), 422, 'STOREFRONT_PAGE_SLUG_INVALID'],
      ['an address with a slash', await move(`a/${b}`, 5), 422, 'STOREFRONT_PAGE_SLUG_INVALID'],
      ['an empty address', await move('  ', 5), 422, 'STOREFRONT_PAGE_SLUG_INVALID'],
      ['a base page', await erp.post(`/api/storefront/pages/${about.id}/move`, { slug: `about-${tag}`, version: about.version }), 422, 'STOREFRONT_PAGE_BASE_KEPT'],
      ['a draft save of a page on the site', await erp.put(`/api/storefront/pages/${pageId}`, form(5, b)), 422, 'STOREFRONT_PAGE_SLUG_ON_SITE'],
    ];
    for (const [what, res, status, code] of refusals) {
      if (res.status !== status || res.body.code !== code) wrong.push(`${what}: ${res.status} ${res.body.code}`);
    }
    const viewerMove = await move(b, 5, viewer);
    const notText = await move(7, 5);
    if (viewerMove.status !== 403 || notText.status !== 400) wrong.push(`the view key and a number for an address: ${viewerMove.status}/${notText.status}`);
    const untouched = (await orm.select().from(storefrontPages).where(eq(storefrontPages.id, pageId)))[0];
    if (untouched.slug !== a || untouched.version !== 5 || (await liveRows()).length !== 0) wrong.push(`a refused move wrote something: ${untouched.slug} v${untouched.version}`);
    // the same address again changes nothing
    const same = await move(a, 5);
    if (same.status !== 200 || (await versionNow()) !== 5) wrong.push(`the same address: ${same.status} v${await versionNow()}`);

    // 3) a → b: the page answers at b and not at a; the old address goes to the new one; the audit rows are there
    const first = await move(` ${b} `, 5);
    if (first.status !== 200 || first.body.data.slug !== b || first.body.data.version !== 6 || first.body.data.status !== 'published') {
      throw new Error(`the first move: ${first.status} ${JSON.stringify(first.body).slice(0, 300)}`);
    }
    const [atNew, atOld, after1] = [await site(`/pages/${b}`), await site(`/pages/${a}`), await siteRedirects()];
    if (atNew.status !== 200 || atOld.status !== 404 || after1 !== `/pages/${a}→path:/pages/${b}`) wrong.push(`after a→b: ${atNew.status}/${atOld.status} «${after1}»`);
    const [row1] = await liveRows();
    if (!row1 || row1.source !== 'manual' || row1.isActive !== 1 || row1.targetItemId !== null || !row1.note.includes(title)) wrong.push(`the redirect row: ${JSON.stringify(row1)}`);
    const [pageAudit] = await orm.select().from(activityLogs).where(and(eq(activityLogs.entityId, `page-${pageId}`), eq(activityLogs.action, 'UPDATE'))).orderBy(desc(activityLogs.id)).limit(1);
    const [redirectAudit] = await orm.select().from(activityLogs).where(and(eq(activityLogs.entityId, `redirect-${row1?.id}`), eq(activityLogs.action, 'CREATE'))).limit(1);
    const pageDetails = (pageAudit?.details ?? {}) as { before?: Body; after?: Body; oldAddressRedirected?: boolean };
    if (pageDetails.before?.slug !== a || pageDetails.after?.slug !== b || pageDetails.oldAddressRedirected !== true || !redirectAudit) {
      wrong.push(`the audit rows: ${String(JSON.stringify(pageAudit?.details)).slice(0, 200)} / ${redirectAudit ? 'redirect row' : 'no redirect row'}`);
    }

    // 4) b → c: both earlier addresses lead straight to c (no chain through b)
    const second = await move(c, 6);
    const after2 = await siteRedirects();
    if (second.status !== 200 || after2 !== `/pages/${a}→path:/pages/${c} | /pages/${b}→path:/pages/${c}`) wrong.push(`after b→c: ${second.status} «${after2}»`);

    // 5) c → a (back to an earlier address): the redirect away from a is removed, so no address points in a circle
    const third = await move(a, 7);
    const after3 = await siteRedirects();
    if (third.status !== 200 || after3 !== `/pages/${b}→path:/pages/${a} | /pages/${c}→path:/pages/${a}`) wrong.push(`after c→a: ${third.status} «${after3}»`);
    const removed = (await orm.select().from(storefrontRedirects).where(and(gt(storefrontRedirects.id, lastRedirect ?? 0), eq(storefrontRedirects.isDeleted, 1)))).filter(r => r.fromPath === `/pages/${a}`);
    if (removed.length !== 1) wrong.push(`the redirect away from the address the page came back to: ${removed.length} removed rows`);
    if ((await site(`/pages/${a}`)).status !== 200) wrong.push('the page does not answer at the address it came back to');

    // 6) moving onto an address that has a redirect of the owner's: that redirect is removed (a page lives there now)
    const d = `move-d-${tag}`;
    const ownOnTarget = await erp.post('/api/storefront/redirects', { fromPath: `/pages/${d}`, targetKind: 'path', targetItemId: null, target: '/products', note: 'دستی', isActive: true });
    const toD = await move(d, 8);
    const afterD = await siteRedirects();
    if (ownOnTarget.status !== 201 || toD.status !== 200 || afterD.includes(`/pages/${d}→`)) wrong.push(`moving onto an address that had a redirect: ${ownOnTarget.status}/${toD.status} «${afterD}»`);

    // 7) the redirects list refuses a row from the address of a page that is on the site (it would carry off the page's
    // earlier addresses), by a new row and by an edit; a draft's address is free
    const onPage = await erp.post('/api/storefront/redirects', { fromPath: `/pages/${d}`, targetKind: 'path', targetItemId: null, target: '/products', note: '', isActive: true });
    const elsewhere = await erp.post('/api/storefront/redirects', { fromPath: `/pages/move-free-${tag}`, targetKind: 'path', targetItemId: null, target: '/products', note: '', isActive: false });
    const editedOnto = await erp.put(`/api/storefront/redirects/${Number(elsewhere.body.data?.id)}`, { fromPath: `/pages/${d}`, targetKind: 'path', targetItemId: null, target: '/products', note: '', isActive: false, version: Number(elsewhere.body.data?.version) });
    if (onPage.status !== 409 || onPage.body.code !== 'STOREFRONT_REDIRECT_FROM_IS_PAGE' || elsewhere.status !== 201 || editedOnto.status !== 409 || editedOnto.body.code !== 'STOREFRONT_REDIRECT_FROM_IS_PAGE') {
      wrong.push(`a redirect from a published page's address: ${onPage.status} ${onPage.body.code} / ${elsewhere.status} / ${editedOnto.status} ${editedOnto.body.code}`);
    }
    await orm.delete(storefrontRedirects).where(eq(storefrontRedirects.id, Number(elsewhere.body.data?.id)));
    // such a row written straight into the table (switched off, to elsewhere), and an owner's row that names the page's
    // address with a last slash: when the page leaves, the first is pointed at the new address and switched on, the same
    // row and not a second one, and the other follows the page
    const [ownOnSource] = await orm.insert(storefrontRedirects).values({ fromPath: `/pages/${d}`, targetKind: 'path', target: '/products', source: 'manual', note: 'دستی', isActive: 0 }).returning({ id: storefrontRedirects.id });
    const slashed = await erp.post('/api/storefront/redirects', { fromPath: `/old-${tag}`, targetKind: 'path', targetItemId: null, target: `/pages/${d}/`, note: '', isActive: true });
    const leftD = await move(b, 9);
    const rowsOfD = (await liveRows()).filter(r => r.fromPath === `/pages/${d}`);
    if (leftD.status !== 200 || rowsOfD.length !== 1 || rowsOfD[0].id !== ownOnSource.id || rowsOfD[0].isActive !== 1 || rowsOfD[0].target !== `/pages/${b}`) {
      wrong.push(`a row on the address the page left: ${leftD.status} ${JSON.stringify(rowsOfD.map(r => [r.id, r.isActive, r.target]))}`);
    }
    const [slashedNow] = await orm.select().from(storefrontRedirects).where(eq(storefrontRedirects.id, Number(slashed.body.data?.id)));
    if (slashed.status !== 201 || slashedNow?.target !== `/pages/${b}`) wrong.push(`a target written with a last slash: ${slashed.status} ${slashedNow?.target}`);
    await orm.delete(storefrontRedirects).where(eq(storefrontRedirects.id, Number(slashed.body.data?.id)));
    const afterLeft = await siteRedirects();
    // every address the page ever had leads to where it is now, each in one hop, and none leads away from it
    const hops = afterLeft.split(' | ');
    if (hops.length !== 3 || hops.some(r => !r.endsWith(`→path:/pages/${b}`)) || afterLeft.includes(`/pages/${b}→`)) wrong.push(`one hop from every earlier address: «${afterLeft}»`);

    // 9) 10c review: the address changes while the page is off the site (by a draft save, and by the move route): redirects
    // that led to the address it leaves follow it, so after it is published again no earlier address ends at a 404
    const e = `move-e-${tag}`;
    const off = await erp.post(`/api/storefront/pages/${pageId}/unpublish`, { version: await versionNow() });
    const offSave = await erp.put(`/api/storefront/pages/${pageId}`, form(await versionNow(), e));
    const midway = await siteRedirects();
    const offRoute = await move(a, await versionNow());
    const [offRouteAudit] = await orm.select().from(activityLogs).where(and(eq(activityLogs.entityId, `page-${pageId}`), eq(activityLogs.action, 'UPDATE'))).orderBy(desc(activityLogs.id)).limit(1);
    if ((offRouteAudit?.details as { oldAddressRedirected?: boolean } | undefined)?.oldAddressRedirected !== false) wrong.push(`the audit row of a move off the site says a redirect was written: ${String(JSON.stringify(offRouteAudit?.details)).slice(0, 200)}`);
    // before it is published again: the row from a, which would lead from the page's address to itself, is already gone
    const beforeAgain = (await liveRows()).map(r => r.fromPath);
    if (beforeAgain.includes(`/pages/${a}`)) wrong.push(`a row from the page's own address was kept until publishing: ${beforeAgain.join(', ')}`);
    const again = await erp.post(`/api/storefront/pages/${pageId}/publish`, { version: await versionNow() });
    const afterOff = await siteRedirects();
    if (off.status !== 200 || offSave.status !== 200 || offRoute.status !== 200 || again.status !== 200) wrong.push(`moving off the site: ${off.status}/${offSave.status}/${offRoute.status}/${again.status}`);
    // by the draft save b→e: the three rows that led to b lead to e, and b itself (left off the site) has no row
    if (midway.split(' | ').length !== 3 || midway.split(' | ').some(r => !r.endsWith(`→path:/pages/${e}`)) || midway.includes(`/pages/${b}→`)) wrong.push(`after a draft save moved the page: «${midway}»`);
    // by the route e→a: the row from a (it would lead from the page's address to itself) is removed, the others lead to a
    if (afterOff.split(' | ').length !== 2 || afterOff.split(' | ').some(r => !r.endsWith(`→path:/pages/${a}`)) || afterOff.includes(`/pages/${a}→`)) wrong.push(`after the route moved the page off the site: «${afterOff}»`);
    for (const row of (afterOff ? afterOff.split(' | ') : [])) {
      const target = row.split('→path:')[1];
      if ((await site(target.replace('/pages/', '/pages/'))).status !== 200) wrong.push(`a redirect ends at an address with no page: ${row}`);
    }

    // 10) 10c review: another page is published at an address that still redirects elsewhere: that redirect is removed
    const f = `move-f-${tag}`;
    const leaveA = await move(f, await versionNow());
    const secondPage = await erp.post('/api/storefront/pages', { title: `صفحهٔ دوم ${tag}`, slug: a, template: null });
    const secondId = Number(secondPage.body.data?.id);
    pageIds.push(secondId);
    const secondDraft = await erp.put(`/api/storefront/pages/${secondId}`, { ...form(1, a), title: `صفحهٔ دوم ${tag}` });
    const beforeSecond = await siteRedirects();
    const secondOn = await erp.post(`/api/storefront/pages/${secondId}/publish`, { version: 2 });
    const afterSecond = await siteRedirects();
    if (leaveA.status !== 200 || secondPage.status !== 201 || secondDraft.status !== 200 || secondOn.status !== 200) wrong.push(`a second page at the address: ${leaveA.status}/${secondPage.status}/${secondDraft.status}/${secondOn.status}`);
    // while the second page is a draft the address still leads to the first page; once it is published the address is its own
    if (!beforeSecond.includes(`/pages/${a}→path:/pages/${f}`) || afterSecond.includes(`/pages/${a}→`)) wrong.push(`the redirect away from a newly published page's address: before «${beforeSecond}» after «${afterSecond}»`);

    // 11) three addresses the old-address keys cannot tell apart are refused everywhere
    for (const reserved of ['feed', 'amp', 'embed']) {
      const byMove = await move(reserved, await versionNow());
      const byCreate = await erp.post('/api/storefront/pages', { title: 'x', slug: reserved, template: null });
      if (byMove.status !== 422 || byMove.body.code !== 'STOREFRONT_PAGE_SLUG_INVALID' || byCreate.status !== 422 || byCreate.body.code !== 'STOREFRONT_PAGE_SLUG_INVALID') {
        wrong.push(`the address «${reserved}»: move ${byMove.status} ${byMove.body.code}, create ${byCreate.status} ${byCreate.body.code}`);
        if (byCreate.status === 201) pageIds.push(Number(byCreate.body.data?.id));
      }
    }

    // 12) every redirect row this run's moves, saves and publishings changed has its own audit row: made, pointed anew, removed
    const touched = await orm.select().from(storefrontRedirects).where(gt(storefrontRedirects.id, lastRedirect ?? 0));
    const auditOf = async (rowId: number, action: string) => (await orm.select({ id: activityLogs.id }).from(activityLogs)
      .where(and(eq(activityLogs.entityId, `redirect-${rowId}`), eq(activityLogs.action, action)))).length;
    for (const row of touched.filter(r => r.fromPath.includes(tag))) {
      const [made, changed, gone] = [await auditOf(row.id, 'CREATE'), await auditOf(row.id, 'UPDATE'), await auditOf(row.id, 'DELETE')];
      // a row is made once; one whose version rose was changed; one that is removed has the row of its removal
      // (the one row this test wrote straight into the table has no row of its making)
      if (made !== (row.id === ownOnSource.id ? 0 : 1) || (row.isDeleted === 1 ? gone !== 1 : gone !== 0) || changed + gone !== row.version - 1) {
        wrong.push(`audit rows of the redirect ${row.fromPath}→${row.target} (v${row.version}, removed ${row.isDeleted}): ${made} made, ${changed} changed, ${gone} removed`);
      }
    }


    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'a draft moved with no redirect; on the site seven wrong moves were refused with their codes (a stale version, a taken address, three wrong shapes, a base page, a draft save), the view key was 403, and nothing was written; the same address changed nothing; a→b answered at b only and sent a to b with the page\'s and the redirect\'s audit rows; b→c sent both earlier addresses straight to c; c→a removed the redirect away from a, with no circle; a move onto an address that had a redirect removed that redirect; the redirects list refused a row from a published page\'s address (new and edited); a switched-off row on the address the page left was pointed at the new address and switched on, the same row, and a target written with a last slash followed; and after the last move every earlier address led to the page in one hop; every redirect row changed had its own audit rows; an address changed while the page was off the site (by a draft save and by the route) took the redirects along and left none that led from the page\'s address to itself; a second page published at an address that still redirected removed that redirect; feed, amp and embed were refused as addresses',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    await orm.delete(storefrontRedirects).where(gt(storefrontRedirects.id, lastRedirect ?? 0)).catch(() => undefined);
    const ids = pageIds.filter(Number.isFinite);
    if (ids.length > 0) await orm.delete(storefrontPages).where(inArray(storefrontPages.id, ids)).catch(() => undefined);
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
