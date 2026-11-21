import request from 'supertest';
import { eq, like } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, appSettings } from '../../db/schema.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { readPricingStrategies } from '../../lib/items/pricingStrategies.js';

/**
 * v12 phase 10a (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2, `AGENTS.md` §1.9c): «اطلاعات فروشگاه» on real Express
 * routes and PostgreSQL. Empty by default (so the site keeps its own words), saved under its own version (a stale form is
 * 409, a wrong field 422 with its name) with one audit row per save, and the site reads exactly the reviewed fields: the
 * seal only on enamad.ir, an address only as https, the floating button's number only while its own switch is on. A
 * holder of `storefront.view` reads but cannot write; the public route needs the site's key and is 404 while the site is
 * off, like every route of the Storefront API.
 */

interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;

export async function runStorefrontShopInfoV12Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_shop_info_v12_p10a';
  if (!shouldRun(id, 'v12', 'phase10', 'storefront', 'shop-info', 'occ', 'security')) return results;

  const name = 'v12 phase 10a: the shop\'s details are empty by default, saved under their own version with an audit row, refused field by field, and reach the site with exactly the reviewed fields, the seal only on enamad.ir and the floating button\'s number only while it is on';
  const tStart = Date.now();
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
    });
    const erp = as(admin);
    const tag = String(Date.now()).slice(-7);
    const wrong: string[] = [];
    const keys = (value: Body) => Object.keys(value).sort().join(',');

    // a clean start for this group, whatever an earlier run left
    await orm.delete(appSettings).where(like(appSettings.key, 'sf\\_info\\_%'));
    invalidateSettingsCache();

    // the site on, with a key, a retail list and a WhatsApp number whose own «سفارش در واتس‌اپ» switch is off
    const retailList = `تکی اطلاعات ${tag}`;
    const current = readPricingStrategies(savedStrategies[0]?.value);
    const strategies = 'titles' in current ? current.titles : [];
    await orm.insert(appSettings).values({ key: 'pricing_strategies', value: JSON.stringify([...strategies, retailList]) })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify([...strategies, retailList]) } });
    invalidateSettingsCache();
    const base = (await erp.get('/api/storefront/settings')).body.data;
    const settingsForm = {
      cardNumber: '', cardHolder: '', bankName: '', iban: '', freeShippingThreshold: '', reservationHours: 24, retailPriceList: retailList,
      wholesalePriceList: '', lowStockThreshold: 3, stockDisplay: 'status', warehouseCode: '', whatsappNumber: '989120000000', whatsappEnabled: false,
      enabled: true, ordersEnabled: false, treasuryAccountId: 0, openOrdersPerPhone: 3, version: base.version,
    };
    const on = await erp.put('/api/storefront/settings', settingsForm);
    if (on.status !== 200) throw new Error(`turning the site on: ${on.status} ${JSON.stringify(on.body)}`);
    const made = await erp.post('/api/storefront/api-key');
    const apiKey = String(made.body.data?.apiKey ?? '');
    const site = (url: string) => request(app).get(url).set('Authorization', `Bearer ${apiKey}`);

    // 1) empty by default: every text '', the button off, version 0; the site gets the same emptiness
    const empty = {
      brandName: '', brandFullName: '', brandTagline: '', footerNote: '', address: '', postalCode: '', phone: '', mobile: '', email: '', hours: '',
      instagram: '', telegram: '', youtube: '', aparat: '', linkedin: '', copyright: '', shippingTitle: '', shippingText: '', alternateSiteLabel: '',
      enamadLinkUrl: '', enamadImageUrl: '', whatsappFloat: false,
    };
    const first = await erp.get('/api/storefront/shop-info');
    if (first.status !== 200 || JSON.stringify(first.body.data) !== JSON.stringify({ ...empty, version: 0, whatsappNumberSet: true })) {
      wrong.push(`defaults: ${first.status} ${JSON.stringify(first.body.data)}`);
    }
    const pubEmpty = await site('/api/storefront/v1/shop-info');
    const emptyPublic = {
      brand: { name: '', fullName: '', tagline: '' }, footerNote: '',
      contact: { address: '', postalCode: '', phone: '', mobile: '', email: '', hours: '' },
      social: { instagram: '', telegram: '', youtube: '', aparat: '', linkedin: '' },
      copyright: '', shipping: { title: '', lines: [] }, alternateSiteLabel: '', enamad: { linkUrl: '', imageUrl: '' }, whatsappFloat: '',
    };
    if (pubEmpty.status !== 200 || JSON.stringify(pubEmpty.body.data) !== JSON.stringify(emptyPublic)) wrong.push(`public defaults: ${pubEmpty.status} ${JSON.stringify(pubEmpty.body)}`);

    // 2) refused field by field (422 with the field's name), and nothing is written
    const form = {
      ...empty, brandName: '  نگارین ', brandFullName: `گالری نگارین ${tag}`, brandTagline: 'زیور دست‌ساز نمونه', footerNote: 'ساخت کارگاه نمونه.',
      address: 'تهران،   خیابان نمونه، پلاک ۱', postalCode: '۱۲۳۴۵-۶۷۸۹۰', phone: '۰۲۱ ۱۲۳۴ ۵۶۷۸', mobile: '0912-000-0000', email: ' Info@Shop.Example ',
      hours: 'شنبه تا چهارشنبه، ۹ تا ۱۷', instagram: 'https://www.instagram.com/negarin.sample/', telegram: 'https://t.me/negarin_sample',
      copyright: 'حق نشر برای کارگاه نمونه است.', shippingTitle: 'ارسال و خرید', shippingText: ' پرداخت هنگام ثبت سفارش \n\nبسته‌بندی هدیه رایگان\n',
      alternateSiteLabel: 'سایت انگلیسی ما', enamadLinkUrl: 'https://trustseal.enamad.ir/?id=1&Code=abc',
      enamadImageUrl: 'https://trustseal.enamad.ir/logo.aspx?id=1&Code=abc', whatsappFloat: true, version: 0,
    };
    const refusals: Array<[string, Body, string]> = [
      ['a seal on another host', { enamadImageUrl: 'https://evil.example/logo.png' }, 'enamadImageUrl'],
      ['a seal with one address', { enamadImageUrl: '' }, 'enamadImageUrl'],
      ['a social page that is not https', { telegram: 'javascript:alert(1)' }, 'telegram'],
      ['a postal code of five digits', { postalCode: '12345' }, 'postalCode'],
      ['a phone with letters', { phone: '021-abc' }, 'phone'],
      ['a wrong email', { email: 'not-an-email' }, 'email'],
      ['a name of two lines', { brandName: 'نام\nدو خط' }, 'brandName'],
      ['seven lines of the footer column', { shippingText: Array.from({ length: 7 }, (_, n) => `خط ${n}`).join('\n') }, 'shippingText'],
    ];
    for (const [what, change, field] of refusals) {
      const res = await erp.put('/api/storefront/shop-info', { ...form, ...change });
      if (res.status !== 422 || res.body.code !== 'STOREFRONT_SHOP_INFO_INVALID' || res.body.details?.field !== field) {
        wrong.push(`${what}: ${res.status} ${res.body.code} ${JSON.stringify(res.body.details)}`);
      }
    }
    const unknownField = await erp.put('/api/storefront/shop-info', { ...form, html: '<script>alert(1)</script>' });
    if (unknownField.status !== 400 && unknownField.status !== 422) wrong.push(`an unknown field: ${unknownField.status}`);
    const stillEmpty = await erp.get('/api/storefront/shop-info');
    if (stillEmpty.body.data?.version !== 0 || stillEmpty.body.data?.brandName !== '') wrong.push(`a refused save wrote something: ${JSON.stringify(stillEmpty.body.data)}`);

    // 3) a save: kept trimmed and in Latin digits, version 1, one audit row; the same form again is 409
    const auditsBefore = (await orm.select({ id: activityLogs.id }).from(activityLogs).where(eq(activityLogs.entityId, 'shop-info'))).length;
    const saved = await erp.put('/api/storefront/shop-info', form);
    const kept = saved.body.data ?? {};
    if (saved.status !== 200 || kept.version !== 1 || kept.brandName !== 'نگارین' || kept.address !== 'تهران، خیابان نمونه، پلاک ۱'
      || kept.postalCode !== '1234567890' || kept.phone !== '02112345678' || kept.mobile !== '09120000000' || kept.email !== 'Info@shop.example'
      || kept.shippingText !== 'پرداخت هنگام ثبت سفارش\nبسته‌بندی هدیه رایگان' || kept.whatsappFloat !== true || kept.whatsappNumberSet !== true) {
      wrong.push(`save: ${saved.status} ${JSON.stringify(saved.body)}`);
    }
    const stale = await erp.put('/api/storefront/shop-info', form);
    if (stale.status !== 409) wrong.push(`a stale save: ${stale.status}, not 409`);
    const audits = await orm.select({ details: activityLogs.details }).from(activityLogs).where(eq(activityLogs.entityId, 'shop-info'));
    if (audits.length !== auditsBefore + 1) wrong.push(`audit rows after one save and one stale save: ${audits.length - auditsBefore}, not 1`);
    // the same values under the new version change nothing: no new version, no audit row
    const same = await erp.put('/api/storefront/shop-info', { ...form, version: 1 });
    const auditsAfterSame = (await orm.select({ id: activityLogs.id }).from(activityLogs).where(eq(activityLogs.entityId, 'shop-info'))).length;
    if (same.status !== 200 || same.body.data?.version !== 1 || auditsAfterSame !== auditsBefore + 1) {
      wrong.push(`an unchanged save: ${same.status}, version ${same.body.data?.version}, audit rows ${auditsAfterSame - auditsBefore}`);
    }

    // 4) the security review's contract: exactly these fields reach the site, and the button's number only while it is on
    const pub = await site('/api/storefront/v1/shop-info');
    const data = pub.body.data ?? {};
    if (pub.status !== 200 || keys(data) !== 'alternateSiteLabel,brand,contact,copyright,enamad,footerNote,shipping,social,whatsappFloat'
      || keys(data.brand ?? {}) !== 'fullName,name,tagline' || keys(data.contact ?? {}) !== 'address,email,hours,mobile,phone,postalCode'
      || keys(data.social ?? {}) !== 'aparat,instagram,linkedin,telegram,youtube' || keys(data.shipping ?? {}) !== 'lines,title'
      || keys(data.enamad ?? {}) !== 'imageUrl,linkUrl') {
      wrong.push(`public fields: ${pub.status} ${JSON.stringify(data)}`);
    } else if (data.brand.fullName !== `گالری نگارین ${tag}` || data.contact.phone !== '02112345678' || data.social.telegram !== 'https://t.me/negarin_sample'
      || JSON.stringify(data.shipping.lines) !== JSON.stringify(['پرداخت هنگام ثبت سفارش', 'بسته‌بندی هدیه رایگان'])
      || data.enamad.imageUrl !== 'https://trustseal.enamad.ir/logo.aspx?id=1&Code=abc' || data.whatsappFloat !== '989120000000') {
      wrong.push(`public values: ${JSON.stringify(data)}`);
    }
    // «سفارش در واتس‌اپ» is off, so the settings answer still names no number: the floating button has its own switch
    const pubSettings = await site('/api/storefront/v1/settings');
    if (pubSettings.body.data?.whatsapp !== '') wrong.push(`the settings answer named the number while «سفارش در واتس‌اپ» is off: ${pubSettings.body.data?.whatsapp}`);
    const off = await erp.put('/api/storefront/shop-info', { ...form, whatsappFloat: false, version: 1 });
    const pubOff = await site('/api/storefront/v1/shop-info');
    if (off.status !== 200 || off.body.data?.version !== 2 || pubOff.body.data?.whatsappFloat !== '') {
      wrong.push(`the button off: ${off.status} ${JSON.stringify(pubOff.body.data?.whatsappFloat)}`);
    }

    // 5) the public route is the Storefront API's: no key or a wrong key is 401, and it is 404 while the site is off
    const noKey = await request(app).get('/api/storefront/v1/shop-info');
    const wrongKey = await request(app).get('/api/storefront/v1/shop-info').set('Authorization', 'Bearer sf_wrong_key_0000000000000000');
    if (noKey.status !== 401 || wrongKey.status !== 401) wrong.push(`without the site's key: ${noKey.status}, ${wrongKey.status}`);

    // 6) a holder of `storefront.view` reads but cannot write
    const role = await createTestRole({ permissions: ['storefront.view'] });
    const user = await createTestUser({ role: role.code });
    const viewer = as(await loginTestUserWithSession(app, user.username));
    const viewerRead = await viewer.get('/api/storefront/shop-info');
    const viewerWrite = await viewer.put('/api/storefront/shop-info', { ...form, version: 2 });
    if (viewerRead.status !== 200 || viewerWrite.status !== 403) wrong.push(`view only: read ${viewerRead.status}, write ${viewerWrite.status}`);
    const stranger = as(await loginTestUserWithSession(app, (await createTestUser({ role: (await createTestRole({ permissions: ['site_content.manage'] })).code })).username));
    const strangerRead = await stranger.get('/api/storefront/shop-info');
    if (strangerRead.status !== 403) wrong.push(`a holder of site_content.manage alone read the shop's details: ${strangerRead.status}`);

    // the site off: the public route is the same 404 as every other
    const nowSettings = (await erp.get('/api/storefront/settings')).body.data;
    const turnedOff = await erp.put('/api/storefront/settings', { ...settingsForm, enabled: false, version: nowSettings.version });
    const pubWhileOff = await site('/api/storefront/v1/shop-info');
    if (turnedOff.status !== 200 || pubWhileOff.status !== 404) wrong.push(`the site off: ${turnedOff.status}, public ${pubWhileOff.status}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'the shop\'s details started empty for the ERP and the site; eight wrong fields were each refused (422) with the field\'s name and wrote nothing; a save kept the values trimmed and in Latin digits under version 1 with one audit row, the same form again was 409 and an unchanged save wrote no row; the site got exactly the reviewed fields, with the floating button\'s number only while its own switch was on and never through the settings answer; no key was 401, the site off 404; a view-only holder could not write and a holder of site_content.manage alone could not read',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
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
