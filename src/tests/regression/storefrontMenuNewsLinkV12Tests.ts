import request from 'supertest';
import { and, desc, eq, gt, inArray, like, max } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, appSettings, items as itemsTable, storefrontCampaigns, storefrontContentAssets, storefrontMenuItems, storefrontMenus, storefrontNews, storefrontPages } from '../../db/schema.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { readPricingStrategies } from '../../lib/items/pricingStrategies.js';

/**
 * v12 phase 10d, part 3 (migration 0034, docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): the news in the site's menus,
 * on real Express routes and PostgreSQL. A link of kind «خبر» names a news item by its row, so the address the site gets
 * is the item's own, and only while the item is on the site (the switch of the news on, the item published, its day
 * come). «خبرها», the list of news, is one of the site's own pages a menu may name, and goes to the site only while the
 * site has news. A removed or unknown item is refused when a menu is saved; an item's detail names the menus that link
 * to it, and removing it records them. The site's answer carries no row id. The two CHECK constraints of migration 0034
 * hold against a direct write, and the kinds of 0028 and 0030 still pass them.
 */
interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;

const leaf = (label: string, kind: string, extra: Body = {}): Body => ({
  id: null, label, kind, target: '', itemId: null, campaignId: null, pageId: null, newsId: null, icon: '', isActive: true, children: [], ...extra,
});

export async function runStorefrontMenuNewsLinkV12Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_menu_news_link_v12_p10d';
  if (!shouldRun(id, 'v12', 'phase10', 'storefront', 'menus', 'news', 'migration', 'security')) return results;

  const name = 'v12 phase 10d: a menu links to a news item by its row and to the list of news, the site gets each only while it is on the site, and the constraints of migration 0034 hold';
  const tStart = Date.now();
  const wrong: string[] = [];
  const tag = String(Date.now()).slice(-7);
  const made = { itemId: 0, campaignId: 0 };
  const savedSettings = await orm.select().from(appSettings).where(like(appSettings.key, 'sf\\_%'));
  const savedStrategies = await orm.select().from(appSettings).where(eq(appSettings.key, 'pricing_strategies'));
  const savedMenus = await orm.select().from(storefrontMenus);
  const [{ lastItem }] = await orm.select({ lastItem: max(storefrontMenuItems.id) }).from(storefrontMenuItems);
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

    const retailList = `تکی پیوند خبر ${tag}`;
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
    const siteHeader = async () => ((await request(app).get('/api/storefront/v1/menus').set('Authorization', `Bearer ${apiKey}`)).body.data?.header ?? null) as Body[] | null;
    const hrefs = async () => ((await siteHeader()) ?? []).map(i => `${String(i.label)}→${String(i.href)}`).join('|');

    // three items: one published under a past day, one published under a day to come, one a draft
    const text = (words: string) => ({ kind: 'text', background: 'white', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: words }] }] } });
    const make = async (slug: string, title: string, newsDate: string, publish: boolean) => {
      const made = await erp.post('/api/storefront/news', { title, slug: `${slug}-${tag}` });
      if (made.status !== 201) throw new Error(`making ${slug}: ${made.status} ${JSON.stringify(made.body)}`);
      const newsId = Number(made.body.data.id);
      const saved = await erp.put(`/api/storefront/news/${newsId}`, {
        title, slug: `${slug}-${tag}`, summary: '', coverAssetId: null, newsDate, seoTitle: '', seoDescription: '', sections: [text(`متن ${title}`)], version: 1,
      });
      const after = publish ? await erp.post(`/api/storefront/news/${newsId}/publish`, { version: 2 }) : saved;
      if (saved.status !== 200 || after.status !== 200) throw new Error(`saving or publishing ${slug}: ${saved.status}/${after.status}`);
      return { id: newsId, slug: `${slug}-${tag}`, title, version: Number(after.body.data.version) };
    };
    const shown = await make('shown', `خبر منو ${tag}`, '2020-03-01', true);
    const later = await make('later', `خبر در نوبت منو ${tag}`, '2099-01-01', true);
    const draft = await make('draft', `پیش‌نویس منو ${tag}`, '', false);

    // 1) what a link may name: the items of «خبرهای سایت», none on the site while the switch of the news is off
    const optionsAnswer = (await erp.get('/api/storefront/menus/link-options')).body.data as Record<string, unknown>;
    const options = (optionsAnswer?.news ?? []) as Array<{ id: number; title: string; live: boolean }>;
    const optionOf = (wanted: number) => options.find(n => n.id === wanted);
    if (Object.keys(optionsAnswer ?? {}).sort().join(',') !== 'campaigns,categories,collections,news,pages,products' || options.some(o => Object.keys(o).sort().join(',') !== 'id,live,title')
      || optionOf(shown.id)?.title !== shown.title || [shown, later, draft].some(item => optionOf(item.id)?.live !== false)) {
      wrong.push(`the link options: ${JSON.stringify([optionOf(shown.id), optionOf(later.id), optionOf(draft.id)])}`);
    }

    // 2) a menu with the list of news, the three items and a plain link: what is wrong is refused, the rest is saved
    const views = (await erp.get('/api/storefront/menus')).body.data.menus as Body[];
    let version = Number(views.find(m => m.location === 'header')?.version);
    const items = [
      leaf('خبرها', 'page', { target: 'news' }), leaf('خبر روز', 'news', { newsId: shown.id }), leaf('به‌زودی', 'news', { newsId: later.id }),
      leaf('در دست نوشتن', 'news', { newsId: draft.id }), leaf('محصولات', 'path', { target: '/products' }),
    ];
    const refusals: Array<[string, Body[], number, string]> = [
      ['an item not chosen', [leaf('خبر', 'news')], 422, 'STOREFRONT_MENU_TARGET_REQUIRED'],
      ['an item that is not there', [leaf('خبر', 'news', { newsId: 2_000_000_000 })], 422, 'STOREFRONT_MENU_NEWS_UNKNOWN'],
      ['an id that is no number', [leaf('خبر', 'news', { newsId: 'seven' })], 400, 'VALIDATION_ERROR'],
      ['an id that is no whole number', [leaf('خبر', 'news', { newsId: 1.5 })], 400, 'VALIDATION_ERROR'],
      ['an id past the largest', [leaf('خبر', 'news', { newsId: 2_147_483_648 })], 400, 'VALIDATION_ERROR'],
    ];
    for (const [what, list, status, code] of refusals) {
      const res = await erp.put('/api/storefront/menus/header', { enabled: true, version, items: list });
      if (res.status !== status || res.body.code !== code) wrong.push(`a menu with ${what}: ${res.status} ${res.body.code}`);
    }
    const saved = await erp.put('/api/storefront/menus/header', { enabled: true, version, items });
    if (saved.status !== 200) throw new Error(`saving the menu: ${saved.status} ${JSON.stringify(saved.body)}`);
    version = Number(saved.body.data.version);
    const rowsOf = (body: Body) => ((body.data as Body).items as Array<Body>).map(i => `${String(i.label)}:${String(i.kind)}:${String(i.newsId)}:${String(i.targetTitle)}:${String(i.live)}`).join('|');
    const expected = (live: { list: boolean; shown: boolean }) => [
      `خبرها:page:null:خبرها:${live.list}`, `خبر روز:news:${shown.id}:${shown.title}:${live.shown}`, `به‌زودی:news:${later.id}:${later.title}:false`,
      `در دست نوشتن:news:${draft.id}:${draft.title}:false`, 'محصولات:path:null::true',
    ].join('|');
    if (rowsOf(saved.body) !== expected({ list: false, shown: false })) wrong.push(`the saved menu with the switch off: ${rowsOf(saved.body)}`);
    const stored = await orm.select().from(storefrontMenuItems).where(gt(storefrontMenuItems.id, lastItem ?? 0));
    const storedLink = stored.find(r => r.targetNewsId === shown.id);
    const storedList = stored.find(r => r.linkKind === 'page' && r.target === 'news');
    if (!storedLink || storedLink.linkKind !== 'news' || storedLink.target !== '' || storedLink.targetItemId !== null || storedLink.targetCampaignId !== null || storedLink.targetPageId !== null
      || !storedList || storedList.targetNewsId !== null) {
      wrong.push(`the stored rows: ${JSON.stringify([storedLink, storedList])}`);
    }
    // a kind that is not «خبر» never keeps an item along
    const stray = await erp.put('/api/storefront/menus/header', { enabled: true, version, items: [...items, leaf('نشانی', 'path', { target: '/about', newsId: shown.id })] });
    version = Number(stray.body.data?.version);
    const strayRow = (await orm.select().from(storefrontMenuItems).where(and(gt(storefrontMenuItems.id, lastItem ?? 0), eq(storefrontMenuItems.isDeleted, 0), eq(storefrontMenuItems.target, '/about'))))[0];
    if (stray.status !== 200 || !strayRow || strayRow.targetNewsId !== null) wrong.push(`an item sent beside another kind: ${stray.status} ${JSON.stringify(strayRow?.targetNewsId)}`);
    const [menuAudit] = await orm.select().from(activityLogs).where(and(eq(activityLogs.entityId, 'header'), eq(activityLogs.action, 'UPDATE'))).orderBy(desc(activityLogs.id)).limit(1);
    if (!JSON.stringify(menuAudit?.details ?? '').includes(`خبر روز ← news: خبر ${shown.id}`)) wrong.push(`the menu's audit row: ${String(JSON.stringify(menuAudit?.details)).slice(0, 300)}`);

    // 3) while the switch of the news is off, the site gets none of the news links
    const off = await hrefs();
    if (off !== 'محصولات→/products|نشانی→/about') wrong.push(`the site with the switch off: ${off}`);

    // 4) with the switch on: the list of news and the item on the site, each by its address; not the one waiting or the draft
    const turnedOn = await erp.put('/api/storefront/news/site', { enabled: true });
    if (turnedOn.status !== 200) throw new Error(`turning the news on: ${turnedOn.status}`);
    const header = await siteHeader();
    const lines = (header ?? []).map(i => `${String(i.label)}→${String(i.href)}`).join('|');
    if (lines !== `خبرها→/news|خبر روز→/news/${shown.slug}|محصولات→/products|نشانی→/about`) wrong.push(`the site with the switch on: ${lines}`);
    if ((header ?? []).some(i => Object.keys(i).sort().join(',') !== 'children,external,href,icon,label,role') || JSON.stringify(header).includes(later.slug) || JSON.stringify(header).includes(draft.slug)
      || /"(id|newsId|targetNewsId)"/.test(JSON.stringify(header))) {
      wrong.push(`the fields of the site's menu: ${JSON.stringify(header).slice(0, 400)}`);
    }
    const viewNow = ((await erp.get('/api/storefront/menus')).body.data.menus as Body[]).find(m => m.location === 'header');
    if (rowsOf({ data: viewNow }).replace('|نشانی:path:null::true', '') !== expected({ list: true, shown: true })) wrong.push(`the menu in the ERP with the switch on: ${rowsOf({ data: viewNow })}`);
    if (((await erp.get('/api/storefront/menus/link-options')).body.data.news as Array<{ id: number; live: boolean }>).filter(n => n.live).map(n => n.id).join(',') !== String(shown.id)) {
      wrong.push('the link options with the switch on: not only the item on the site is marked as on it');
    }

    // 5) an item's detail names the menus that link to it; taken off the site, its link and (with no item left) the list's are gone
    const detail = await erp.get(`/api/storefront/news/${shown.id}`);
    if (JSON.stringify(detail.body.data?.menuPlaces) !== '["header"]' || JSON.stringify((await erp.get(`/api/storefront/news/${later.id}`)).body.data?.menuPlaces) !== '["header"]') {
      wrong.push(`the menus an item is linked from: ${JSON.stringify(detail.body.data?.menuPlaces)}`);
    }
    const offSite = await erp.post(`/api/storefront/news/${shown.id}/unpublish`, { version: shown.version });
    const afterOff = await hrefs();
    if (offSite.status !== 200 || afterOff !== 'محصولات→/products|نشانی→/about') wrong.push(`the site after the item left it: ${offSite.status} ${afterOff}`);
    // taking it off records the menus that linked to it, as its removal would
    const [offAudit] = await orm.select().from(activityLogs).where(eq(activityLogs.entityId, `news-${shown.id}`)).orderBy(desc(activityLogs.id)).limit(1);
    if (JSON.stringify((offAudit?.details as Body | null)?.linkedFromMenus) !== '["header"]') wrong.push(`the audit row of taking a linked item off: ${JSON.stringify(offAudit?.details).slice(0, 200)}`);
    // the day of the waiting item comes: it and the list are on the site
    const [waiting] = await orm.select().from(storefrontNews).where(eq(storefrontNews.id, later.id));
    await orm.update(storefrontNews).set({ publishedDate: '2020-01-01', published: { ...waiting.published!, newsDate: '2020-01-01' } }).where(eq(storefrontNews.id, later.id));
    const came = await hrefs();
    if (came !== `خبرها→/news|به‌زودی→/news/${later.slug}|محصولات→/products|نشانی→/about`) wrong.push(`the site once the waiting item's day has come: ${came}`);

    // 6) a removed item: its removal records the menus that linked to it, its link leads nowhere, and a menu naming it is not saved again
    const removed = await erp.del(`/api/storefront/news/${draft.id}?version=${draft.version}`);
    const [removal] = await orm.select().from(activityLogs).where(eq(activityLogs.entityId, `news-${draft.id}`)).orderBy(desc(activityLogs.id)).limit(1);
    if (removed.status !== 200 || JSON.stringify((removal?.details as Body | null)?.linkedFromMenus) !== '["header"]') wrong.push(`removing a linked item: ${removed.status} ${JSON.stringify((removal?.details as Body | null)?.linkedFromMenus)}`);
    const viewAfter = ((await erp.get('/api/storefront/menus')).body.data.menus as Body[]).find(m => m.location === 'header') as Body;
    const goneRow = (viewAfter.items as Body[]).find(i => i.newsId === draft.id);
    if (goneRow?.targetTitle !== '' || goneRow.live !== false) wrong.push(`the link to a removed item: ${JSON.stringify(goneRow)}`);
    const asSent = (viewAfter.items as Body[]).map(({ targetTitle: _title, live: _live, ...item }) => ({ ...item, children: [] }));
    const resave = await erp.put('/api/storefront/menus/header', { enabled: true, version: Number(viewAfter.version), items: asSent });
    if (resave.status !== 422 || resave.body.code !== 'STOREFRONT_MENU_NEWS_UNKNOWN') wrong.push(`saving a menu that names a removed item: ${resave.status} ${resave.body.code}`);

    // a menu option that is removed is no link any more: the item is then linked from no menu
    const lastView = ((await erp.get('/api/storefront/menus')).body.data.menus as Body[]).find(m => m.location === 'header') as Body;
    const dropped = await erp.put('/api/storefront/menus/header', { enabled: true, version: Number(lastView.version), items: [leaf('محصولات', 'path', { target: '/products' })] });
    const placesAfter = (await erp.get(`/api/storefront/news/${later.id}`)).body.data?.menuPlaces;
    if (dropped.status !== 200 || JSON.stringify(placesAfter) !== '[]') wrong.push(`the menus an item is linked from once the option is removed: ${dropped.status} ${JSON.stringify(placesAfter)}`);

    // 7) the constraints of migration 0034, against a direct write; the kinds of 0028 and 0030 still pass
    const product = await createTestItem({ name: `کالای پیوند خبر ${tag}`, code: `NL-${tag}` });
    made.itemId = product.id;
    const [campaign] = await orm.insert(storefrontCampaigns).values({ slug: `news-link-${tag}`, title: `صفحهٔ ویژهٔ پیوند ${tag}`, source: 'collection', collection: `کالکشن پیوند ${tag}` }).returning({ id: storefrontCampaigns.id });
    made.campaignId = campaign.id;
    const [aPage] = await orm.select({ id: storefrontPages.id }).from(storefrontPages).where(eq(storefrontPages.slug, 'about'));
    const direct = async (values: Partial<typeof storefrontMenuItems.$inferInsert>) => orm.insert(storefrontMenuItems).values({ location: 'drawer', label: `آزمون ${tag}`, linkKind: 'none', ...values })
      .then(() => 'written', () => 'refused');
    const checks: Array<[string, string, string]> = [
      ['a news link without its item', await direct({ linkKind: 'news' }), 'refused'],
      ['a news link with a target text', await direct({ linkKind: 'news', target: 'x', targetNewsId: later.id }), 'refused'],
      ['a news link with a page too', await direct({ linkKind: 'news', targetNewsId: later.id, targetPageId: 1 }), 'refused'],
      ['a path with a news item', await direct({ linkKind: 'path', target: '/about', targetNewsId: later.id }), 'refused'],
      ['a page of the site with a news item', await direct({ linkKind: 'page', target: 'news', targetNewsId: later.id }), 'refused'],
      ['a heading with a news item', await direct({ linkKind: 'none', targetNewsId: later.id }), 'refused'],
      ['an outside address with a news item', await direct({ linkKind: 'url', target: 'https://example.com/', targetNewsId: later.id }), 'refused'],
      ['a page link with a news item', await direct({ linkKind: 'content', targetPageId: aPage.id, targetNewsId: later.id }), 'refused'],
      ['a product with a news item', await direct({ linkKind: 'product', targetItemId: product.id, targetNewsId: later.id }), 'refused'],
      ['a campaign page with a news item', await direct({ linkKind: 'campaign', targetCampaignId: campaign.id, targetNewsId: later.id }), 'refused'],
      ['a news link with a product too', await direct({ linkKind: 'news', targetNewsId: later.id, targetItemId: product.id }), 'refused'],
      ['a news link with a campaign page too', await direct({ linkKind: 'news', targetNewsId: later.id, targetCampaignId: campaign.id }), 'refused'],
      ['a news item that is no row', await direct({ linkKind: 'news', targetNewsId: 2_000_000_000 }), 'refused'],
      ['an unknown kind', await direct({ linkKind: 'article', target: 'x' }), 'refused'],
      ['a news link', await direct({ linkKind: 'news', targetNewsId: later.id }), 'written'],
      ['a path', await direct({ linkKind: 'path', target: '/about' }), 'written'],
      ['a page of the site', await direct({ linkKind: 'page', target: 'news' }), 'written'],
      ['a heading', await direct({ linkKind: 'none' }), 'written'],
      // each of the kinds refused above is written without the news item, so it was the item that was refused
      ['an outside address', await direct({ linkKind: 'url', target: 'https://example.com/' }), 'written'],
      ['a page link', await direct({ linkKind: 'content', targetPageId: aPage.id }), 'written'],
      ['a product', await direct({ linkKind: 'product', targetItemId: product.id }), 'written'],
      ['a campaign page', await direct({ linkKind: 'campaign', targetCampaignId: campaign.id }), 'written'],
    ];
    for (const [what, got, want] of checks) if (got !== want) wrong.push(`constraint, ${what}: ${got}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'the link options named the news items, none on the site with the switch off; a link with no item, with an unknown one or with a wrong id was refused; the menu was saved with the item by its row and the list as a page of the site, and another kind kept no item; with the switch off the site got no news link; with it on it got the list and the item on the site by their addresses, with the reviewed fields only, and not the item waiting or the draft; an item\'s detail named the menu; taken off, its link and the list\'s were gone, and the waiting item came on its day; removing a linked item recorded the menu, left its link leading nowhere and stopped a menu naming it from being saved; a removed option was no link any more; the constraints refused fourteen wrong direct writes and passed eight right ones',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: ((told: string) => (wrong.length > 0 && told !== wrong.join('; ') ? `${wrong.join('; ')}; ${told}` : told))(err instanceof Error ? err.message : String(err)),
    }));
  } finally {
    await orm.delete(storefrontMenuItems).where(gt(storefrontMenuItems.id, lastItem ?? 0)).catch(() => undefined);
    for (const menu of savedMenus) await orm.update(storefrontMenus).set(menu).where(eq(storefrontMenus.location, menu.location)).catch(() => undefined);
    if (made.campaignId) await orm.delete(storefrontCampaigns).where(eq(storefrontCampaigns.id, made.campaignId)).catch(() => undefined);
    if (made.itemId) await orm.update(itemsTable).set({ isDeleted: 1 }).where(eq(itemsTable.id, made.itemId)).catch(() => undefined);
    const mine = await orm.select({ id: storefrontNews.id }).from(storefrontNews).where(like(storefrontNews.slug, `%${tag}`)).catch(() => []);
    if (mine.length > 0) {
      await orm.delete(storefrontContentAssets).where(and(eq(storefrontContentAssets.contentKind, 'news'), inArray(storefrontContentAssets.contentId, mine.map(r => r.id)))).catch(() => undefined);
      await orm.delete(storefrontNews).where(inArray(storefrontNews.id, mine.map(r => r.id))).catch(() => undefined);
    }
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
