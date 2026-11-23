import request from 'supertest';
import { and, desc, eq, gt, inArray, like, max } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, appSettings, storefrontMenuItems, storefrontMenus, storefrontPages } from '../../db/schema.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { readPricingStrategies } from '../../lib/items/pricingStrategies.js';

/**
 * v12 phase 10c (migration 0030, docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): a menu link to a page of «صفحه‌های
 * سایت», on real Express routes and PostgreSQL. The link names the page by its row, so the address the site gets is
 * the page's address of now and follows a change of it. Only a page the shop made is linked this way, and only while it
 * is published; the five base pages keep their own link kind (their addresses never change). A removed, unknown or
 * base page is refused when a menu is saved; removing a page records the menus that linked to it. The site's answer carries no row id. The two CHECK constraints of migration 0030 hold
 * against a direct write, and the kinds of 0028 still pass them.
 */
interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;

const leaf = (label: string, kind: string, extra: Body = {}): Body => ({
  id: null, label, kind, target: '', itemId: null, campaignId: null, pageId: null, icon: '', isActive: true, children: [], ...extra,
});

export async function runStorefrontMenuPageLinkV12Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_menu_page_link_v12_p10c';
  if (!shouldRun(id, 'v12', 'phase10', 'storefront', 'menus', 'pages', 'migration', 'security')) return results;

  const name = 'v12 phase 10c: a menu links to a page by its row, the site gets the page\'s address of now only while the page is on the site, and the constraints of migration 0030 hold';
  const tStart = Date.now();
  const pageIds: number[] = [];
  const savedSettings = await orm.select().from(appSettings).where(like(appSettings.key, 'sf\\_%'));
  const savedStrategies = await orm.select().from(appSettings).where(eq(appSettings.key, 'pricing_strategies'));
  const savedMenus = await orm.select().from(storefrontMenus);
  const [{ lastItem }] = await orm.select({ lastItem: max(storefrontMenuItems.id) }).from(storefrontMenuItems);
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
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

    const retailList = `تکی پیوند صفحه ${tag}`;
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
    const siteHeader = async () => ((await request(app).get('/api/storefront/v1/menus').set('Authorization', `Bearer ${apiKey}`)).body.data?.header ?? null) as Body[] | null;

    // a page the shop made (a draft for now) and the base page «about» (unpublished in a test database)
    const slug = `menu-story-${tag}`;
    const created = await erp.post('/api/storefront/pages', { title: `داستان منو ${tag}`, slug, template: null });
    if (created.status !== 201) throw new Error(`a new page: ${created.status} ${JSON.stringify(created.body)}`);
    const pageId = Number(created.body.data.id);
    pageIds.push(pageId);
    const [about] = await orm.select().from(storefrontPages).where(eq(storefrontPages.slug, 'about'));
    if (!about || about.kind !== 'base') throw new Error('the base page «about» is missing');
    const button = { kind: 'button', background: 'white', label: 'محصولات', href: '/products' };
    const form = (version: number, over: Body = {}) => ({
      title: `داستان منو ${tag}`, slug, seoTitle: '', seoDescription: '', noindex: false, shareImageAssetId: null, sections: [button], version, ...over,
    });
    const draft = await erp.put(`/api/storefront/pages/${pageId}`, form(1));
    if (draft.status !== 200) throw new Error(`saving the draft: ${draft.status} ${JSON.stringify(draft.body)}`);

    // 1) the pages a link may name: the page the shop made (not yet on the site), under the title its list shows; no base page
    const options = (await erp.get('/api/storefront/menus/link-options')).body.data?.pages as Array<{ id: number; title: string; live: boolean }> | undefined;
    const optionOf = (wanted: number) => (options ?? []).find(p => p.id === wanted);
    if (optionOf(about.id) !== undefined || (options ?? []).some(p => p.id <= 5 && p.title === about.title) || optionOf(pageId)?.live !== false || optionOf(pageId)?.title !== `داستان منو ${tag}`) {
      wrong.push(`the link options: ${JSON.stringify([optionOf(about.id), optionOf(pageId)])}`);
    }

    // 2) a menu with it and a base page by its own kind: saved; the ERP marks the draft's link as not on the site, which gets only the others
    const views = (await erp.get('/api/storefront/menus')).body.data.menus as Body[];
    let version = Number(views.find(m => m.location === 'header')?.version);
    const { children: _none, ...childLink } = leaf('داستان (زیرگزینه)', 'content', { pageId });
    const items = [
      leaf('داستان ما', 'content', { pageId }), leaf('درباره ما', 'page', { target: 'about' }), leaf('محصولات', 'path', { target: '/products' }),
      { ...leaf('بیشتر', 'none'), children: [childLink] },
    ];
    const saved = await erp.put('/api/storefront/menus/header', { enabled: true, version, items });
    if (saved.status !== 200) throw new Error(`saving the menu: ${saved.status} ${JSON.stringify(saved.body)}`);
    version = Number(saved.body.data.version);
    const rowsOf = (body: Body) => ((body.data as Body).items as Array<Body>).map(i => `${i.label}:${i.kind}:${i.pageId}:${i.targetTitle}:${i.live}`).join('|');
    if (rowsOf(saved.body) !== `داستان ما:content:${pageId}:داستان منو ${tag}:false|درباره ما:page:null:دربارهٔ پاپیتال:true|محصولات:path:null::true|بیشتر:none:null::false`) {
      wrong.push(`the saved menu: ${rowsOf(saved.body)}`);
    }
    const stored = await orm.select().from(storefrontMenuItems).where(gt(storefrontMenuItems.id, lastItem ?? 0));
    const storedLink = stored.find(r => r.targetPageId === pageId);
    if (!storedLink || storedLink.linkKind !== 'content' || storedLink.target !== '' || storedLink.targetItemId !== null || storedLink.targetCampaignId !== null) {
      wrong.push(`the stored row: ${JSON.stringify(storedLink)}`);
    }
    const hrefs = async () => ((await siteHeader()) ?? []).map(i => `${i.label}→${i.href}`).join('|');
    const before = await hrefs();
    if (before !== 'درباره ما→/about|محصولات→/products') wrong.push(`the site before the page is published: ${before}`);

    // the audit row of the save names the page the link points to
    const [menuAudit] = await orm.select().from(activityLogs).where(and(eq(activityLogs.entityId, 'header'), eq(activityLogs.action, 'UPDATE'))).orderBy(desc(activityLogs.id)).limit(1);
    if (!JSON.stringify(menuAudit?.details ?? '').includes(`داستان ما ← content: صفحهٔ متنی ${pageId}`)) wrong.push(`the menu's audit row: ${String(JSON.stringify(menuAudit?.details)).slice(0, 300)}`);

    // 3) published: the link appears with the page's address; every item has the reviewed fields only (no row id)
    const published = await erp.post(`/api/storefront/pages/${pageId}/publish`, { version: 2 });
    if (published.status !== 200) throw new Error(`publishing: ${published.status} ${JSON.stringify(published.body)}`);
    const header = await siteHeader();
    const first = (header ?? [])[0] ?? {};
    const child = (((header ?? [])[3] ?? {}).children as Body[] | undefined)?.[0];
    if (first.href !== `/pages/${slug}` || first.external !== false || Object.keys(first).sort().join(',') !== 'children,external,href,icon,label,role' || child?.href !== `/pages/${slug}`) {
      wrong.push(`the site's link: ${JSON.stringify(first)}`);
    }
    const everyItem = (header ?? []).flatMap(i => [i, ...((i.children ?? []) as Body[])]);
    if (everyItem.some(i => Object.keys(i).sort().join(',') !== 'children,external,href,icon,label,role') || /pageId|targetTitle|"id"/.test(JSON.stringify(header))) {
      wrong.push(`the site's answer names a row: ${JSON.stringify(header)}`);
    }
    // the page's detail in the ERP names the menu that links to it
    const linked = (await erp.get(`/api/storefront/pages/${pageId}`)).body.data?.menuPlaces;
    if (JSON.stringify(linked) !== '["header"]') wrong.push(`the page's menus: ${JSON.stringify(linked)}`);
    // a second place links to it too: the places come in the builder's own order, each once
    const footerVersion = Number(((await erp.get('/api/storefront/menus')).body.data.menus as Body[]).find(m => m.location === 'footer')?.version);
    const footer = await erp.put('/api/storefront/menus/footer', { enabled: false, version: footerVersion, items: [{ ...leaf('ستون', 'none'), children: [childLink, { ...childLink, label: 'دوباره', isActive: false }] }] });
    const twoPlaces = (await erp.get(`/api/storefront/pages/${pageId}`)).body.data?.menuPlaces;
    if (footer.status !== 200 || JSON.stringify(twoPlaces) !== '["header","footer"]') wrong.push(`two places: ${footer.status} ${JSON.stringify(footer.body).slice(0, 200)} ${JSON.stringify(twoPlaces)}`);
    // the item leaves the footer: that place is no longer named (a removed menu item is not a link to mend)
    const footerEmptied = await erp.put('/api/storefront/menus/footer', { enabled: false, version: Number(footer.body.data?.version), items: [] });
    const onePlace = (await erp.get(`/api/storefront/pages/${pageId}`)).body.data?.menuPlaces;
    if (footerEmptied.status !== 200 || JSON.stringify(onePlace) !== '["header"]') wrong.push(`after the footer's item was removed: ${footerEmptied.status} ${JSON.stringify(onePlace)}`);

    // 4) off the site: the link leaves; its address changes there; published again: the link has the new address
    const off = await erp.post(`/api/storefront/pages/${pageId}/unpublish`, { version: 3 });
    const whileOff = await hrefs();
    const [offAudit] = await orm.select().from(activityLogs).where(and(eq(activityLogs.entityId, `page-${pageId}`), eq(activityLogs.action, 'UPDATE'))).orderBy(desc(activityLogs.id)).limit(1);
    if (JSON.stringify((offAudit?.details as Body | undefined)?.linkedFromMenus) !== '["header"]') wrong.push(`the audit row of taking the page off the site: ${String(JSON.stringify(offAudit?.details)).slice(0, 300)}`);
    const moved = await erp.put(`/api/storefront/pages/${pageId}`, form(4, { slug: `${slug}-moved` }));
    const again = await erp.post(`/api/storefront/pages/${pageId}/publish`, { version: 5 });
    const after = await hrefs();
    if (off.status !== 200 || moved.status !== 200 || again.status !== 200) wrong.push(`moving the page: ${off.status}/${moved.status}/${again.status}`);
    if (whileOff !== before || after !== `داستان ما→/pages/${slug}-moved|درباره ما→/about|محصولات→/products|بیشتر→`) wrong.push(`the link through a move: «${whileOff}» then «${after}»`);

    // 5) refused when a menu is saved: an unknown page, a base page (it has its own kind), a 'content' link without a page
    const unknown = await erp.put('/api/storefront/menus/header', { enabled: true, version, items: [leaf('ناشناخته', 'content', { pageId: 2_000_000_000 })] });
    const empty = await erp.put('/api/storefront/menus/header', { enabled: true, version, items: [leaf('بی صفحه', 'content')] });
    const basePage = await erp.put('/api/storefront/menus/header', { enabled: true, version, items: [leaf('پایه', 'content', { pageId: about.id })] });
    if (unknown.status !== 422 || unknown.body.code !== 'STOREFRONT_MENU_PAGE_UNKNOWN' || empty.status !== 422 || empty.body.code !== 'STOREFRONT_MENU_TARGET_REQUIRED'
      || basePage.status !== 422 || basePage.body.code !== 'STOREFRONT_MENU_PAGE_UNKNOWN') {
      wrong.push(`refusals: ${unknown.status} ${unknown.body.code} / ${empty.status} ${empty.body.code} / ${basePage.status} ${basePage.body.code}`);
    }
    // another kind never carries a page: the server empties it
    const stray = await erp.put('/api/storefront/menus/header', { enabled: true, version, items: [...items, leaf('مسیر', 'path', { target: '/cart', pageId })] });
    if (stray.status !== 200 || (stray.body.data.items as Body[])[4]?.pageId !== null) wrong.push(`a page on another kind: ${stray.status} ${JSON.stringify((stray.body.data?.items as Body[] | undefined)?.[4])}`);
    version = Number(stray.body.data?.version ?? version);

    // 6) the page removed: the site drops the link, the ERP shows it as gone, and the menu cannot be saved with it again
    const detail = await erp.get(`/api/storefront/pages/${pageId}`);
    const removed = await erp.del(`/api/storefront/pages/${pageId}?version=${Number(detail.body.data.version)}`);
    const afterRemoval = await hrefs();
    const view = ((await erp.get('/api/storefront/menus')).body.data.menus as Body[]).find(m => m.location === 'header') as Body;
    const gone = (view.items as Body[])[0];
    const resave = await erp.put('/api/storefront/menus/header', { enabled: true, version: Number(view.version), items });
    if (![200, 204].includes(removed.status) || afterRemoval !== 'درباره ما→/about|محصولات→/products|مسیر→/cart') {
      wrong.push(`after the page was removed: ${removed.status} «${afterRemoval}»`);
    }
    const [pageAudit] = await orm.select().from(activityLogs).where(and(eq(activityLogs.entityId, `page-${pageId}`), eq(activityLogs.action, 'DELETE'))).orderBy(desc(activityLogs.id)).limit(1);
    if (JSON.stringify((pageAudit?.details as Body | undefined)?.linkedFromMenus) !== '["header"]') wrong.push(`the removal's audit row: ${String(JSON.stringify(pageAudit?.details)).slice(0, 300)}`);
    if (gone.live !== false || gone.targetTitle !== '' || resave.status !== 422 || resave.body.code !== 'STOREFRONT_MENU_PAGE_UNKNOWN') {
      wrong.push(`the removed page in the ERP: ${JSON.stringify(gone)} resave ${resave.status} ${resave.body.code}`);
    }

    // 7) the constraints of migration 0030, against a direct write
    const direct = async (values: Partial<typeof storefrontMenuItems.$inferInsert>) => orm.insert(storefrontMenuItems)
      .values({ location: 'header', label: `مستقیم ${tag}`, linkKind: 'content', ...values }).then(() => 'written', () => 'refused');
    const checks: Array<[string, Promise<string>, string]> = [
      ['a content link without a page', direct({}), 'refused'],
      ['a content link with a target text', direct({ targetPageId: about.id, target: 'about' }), 'refused'],
      ['a path with a page', direct({ linkKind: 'path', target: '/x', targetPageId: about.id }), 'refused'],
      ['a heading with a page', direct({ linkKind: 'none', targetPageId: about.id }), 'refused'],
      ['an unknown kind', direct({ linkKind: 'article', targetPageId: about.id }), 'refused'],
      ['a page that does not exist', direct({ targetPageId: 2_000_000_000 }), 'refused'],
      ['a content link with a page', direct({ targetPageId: about.id }), 'written'],
      ['a kind of 0028', direct({ linkKind: 'page', target: 'about' }), 'written'],
    ];
    for (const [what, attempt, want] of checks) {
      const got = await attempt;
      if (got !== want) wrong.push(`constraint, ${what}: ${got}`);
    }

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'the link options listed the page the shop made (a draft, marked) and no base page; a menu naming it was stored by row with no text target and its audit row named the page; the site got the page\'s address only once it was published, every item with the reviewed fields and no row id, and the page\'s detail named the menu; the link left with the page, and came back with its new address after a move; an unknown page, a base page and a link without a page were refused (422) and another kind never kept a page; a removed page left the site\'s menu, its audit row named the menu, it showed as gone in the ERP and could not be saved again; six wrong direct writes were refused by the constraints and two right ones written',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    await orm.delete(storefrontMenuItems).where(gt(storefrontMenuItems.id, lastItem ?? 0)).catch(() => undefined);
    for (const menu of savedMenus) await orm.update(storefrontMenus).set(menu).where(eq(storefrontMenus.location, menu.location)).catch(() => undefined);
    if (pageIds.length > 0) await orm.delete(storefrontPages).where(inArray(storefrontPages.id, pageIds)).catch(() => undefined);
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
