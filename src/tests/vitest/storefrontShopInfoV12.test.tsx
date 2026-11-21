import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { StorefrontShopInfoView } from '../../lib/storefront/storefrontShopInfoContracts';

/**
 * v12 phase 10a (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2, owner's decisions 18 and 23): the rules of «اطلاعات
 * فروشگاه» (what a field takes, what is kept, what the site may write into a page) and its section of «کالاها و تنظیمات
 * سایت».
 */
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ API_URL: '/api', fetchJson: (...args: unknown[]) => fetchJson(...(args as [])), isAbortError: () => false }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});

const {
  SHOP_INFO_DEFAULTS, SHOP_LINK_MAX, defaultCopyright, enamadUrl, httpsLink, isPlainHost, normalizedShopInfo, safeShopText, shippingLines, shopEmail,
  shopInfoError, shopPhone, shopPostalCode,
} = await import('../../lib/storefront/storefrontShopInfoRules');
const { STOREFRONT_SHOP_INFO_SETTING_KEYS } = await import('../../lib/storefront/storefrontShopInfoContracts');
const { StorefrontShopInfoSection } = await import('../../components/storefront/StorefrontShopInfoForm');
const { STOREFRONT_SECTION_IDS, isStorefrontSection } = await import('../../components/storefront/StorefrontSettingsSections');

type Values = Parameters<typeof shopInfoError>[0];
const EMPTY: Values = {
  brandName: '', brandFullName: '', brandTagline: '', footerNote: '', address: '', postalCode: '', phone: '', mobile: '', email: '', hours: '',
  instagram: '', telegram: '', youtube: '', aparat: '', linkedin: '', copyright: '', shippingTitle: '', shippingText: '', alternateSiteLabel: '',
  enamadLinkUrl: '', enamadImageUrl: '', whatsappFloat: false,
};
const view = (over: Partial<StorefrontShopInfoView> = {}): StorefrontShopInfoView => ({ ...EMPTY, version: 4, whatsappNumberSet: true, ...over });

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

describe('the rules of the shop details', () => {
  it('takes an empty form: every field is optional and the site then keeps its own words', () => {
    expect(shopInfoError(EMPTY)).toBeNull();
    expect(normalizedShopInfo(EMPTY)).toEqual(EMPTY);
    expect(SHOP_INFO_DEFAULTS.brandFullName).toBe('گالری پاپیتال');
    expect(defaultCopyright('گالری نمونه')).toBe('همهٔ حقوق برای گالری نمونه محفوظ است.');
  });

  it('keeps one setting key per field, all under the group\'s own prefix', () => {
    const keys = Object.values(STOREFRONT_SHOP_INFO_SETTING_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every(key => key.startsWith('sf_info_'))).toBe(true);
    expect(Object.keys(STOREFRONT_SHOP_INFO_SETTING_KEYS).sort()).toEqual([...Object.keys(EMPTY), 'version'].sort());
  });

  it('takes only an https address outside the site, with no user, port or fragment', () => {
    expect(httpsLink('')).toBe('');
    expect(httpsLink('  https://t.me/sample  ')).toBe('https://t.me/sample');
    expect(httpsLink('https://www.instagram.com/sample/?hl=fa')).toBe('https://www.instagram.com/sample/?hl=fa');
    for (const bad of ['http://t.me/sample', 'javascript:alert(1)', '//t.me/sample', 't.me/sample', 'https://user:pw@t.me/x', 'https://t.me:8443/x',
      'https://t.me/x#top', 'https://localhost/x', 'https://t.me/a b', `https://t.me/${'x'.repeat(SHOP_LINK_MAX)}`]) {
      expect(httpsLink(bad), bad).toBeNull();
    }
  });

  it('takes the seal\'s addresses only on enamad.ir, so the site opens its policy to no other host', () => {
    expect(enamadUrl('')).toBe('');
    expect(enamadUrl('https://trustseal.enamad.ir/logo.aspx?id=1&Code=abc')).toBe('https://trustseal.enamad.ir/logo.aspx?id=1&Code=abc');
    expect(enamadUrl('https://enamad.ir/x')).toBe('https://enamad.ir/x');
    for (const bad of ['https://evil.example/logo.png', 'https://enamad.ir.evil.example/x', 'https://notenamad.ir/x', 'http://trustseal.enamad.ir/x']) {
      expect(enamadUrl(bad), bad).toBeNull();
    }
  });

  it('takes a host only of letters, digits and hyphens, so nothing of it can end or widen the site\'s policy header (10a review)', () => {
    // red before the review's fix: each of these passed as «on enamad.ir» and its origin went into img-src as written,
    // where «;» ends the directive, «,» ends the policy and «*» is every host
    const hostile = [
      'https://evil.example;x.enamad.ir/logo.png', 'https://*;x.enamad.ir/x.png', 'https://a;sandbox;x.enamad.ir/x.png', 'https://a;script-src;x.enamad.ir/',
      'https://a,b.enamad.ir/x.png', 'https://*.enamad.ir/x.png', 'https://a%3Bb.enamad.ir/x', "https://a'b.enamad.ir/x", 'https://a=b.enamad.ir/x',
      'https://enamad.ir./x', 'https://-a.enamad.ir/x',
    ];
    for (const bad of hostile) {
      expect(enamadUrl(bad), bad).toBeNull();
      expect(httpsLink(bad), bad).toBeNull();
    }
    expect(httpsLink('https://t.me;x.example/y')).toBeNull();
    expect(isPlainHost('trustseal.enamad.ir')).toBe(true);
    expect(isPlainHost('xn--mgbh0fb.example')).toBe(true);
    expect(isPlainHost('localhost')).toBe(false);
    expect(isPlainHost(`${'a'.repeat(64)}.example`)).toBe(false);
    // a host in capitals is the same host, kept in lower case
    expect(enamadUrl('https://TrustSeal.Enamad.IR/logo.aspx?id=1')).toBe('https://trustseal.enamad.ir/logo.aspx?id=1');
    expect(shopInfoError({ ...EMPTY, enamadLinkUrl: 'https://trustseal.enamad.ir/?id=1', enamadImageUrl: 'https://evil.example;x.enamad.ir/logo.png' }))
      .toMatchObject({ field: 'enamadImageUrl' });
  });

  it('takes the shop\'s email only as an address a mail link can carry whole (10a review)', () => {
    expect(shopEmail('')).toBe('');
    expect(shopEmail(' Info@Shop.Example ')).toBe('Info@shop.example');
    expect(shopEmail('first.last+shop_1-x@shop.example')).toBe('first.last+shop_1-x@shop.example');
    // red before: an address whose first part held «?subject=…» became a mail link with a written subject and body
    for (const bad of ['a?subject=x&body=y@shop.example', 'a%0Ab@shop.example', 'a#b@shop.example', 'not-an-email']) expect(shopEmail(bad), bad).toBeNull();
    expect(shopEmail(['a@shop.example'])).toBeNull();
    expect(shopInfoError({ ...EMPTY, email: 'a?subject=x@shop.example' })).toMatchObject({ field: 'email' });
  });

  it('reads a phone and a postal code typed with Persian digits, spaces and dashes, and keeps Latin digits', () => {
    expect(shopPhone('۰۲۱-۱۲۳۴ ۵۶۷۸')).toBe('02112345678');
    expect(shopPhone('+98 (912) 000 0000')).toBe('+989120000000');
    expect(shopPhone('')).toBe('');
    expect(shopPhone('021-abc')).toBeNull();
    expect(shopPhone('1234')).toBeNull();
    expect(shopPostalCode('۱۲۳۴۵-۶۷۸۹۰')).toBe('1234567890');
    expect(shopPostalCode('12345')).toBeNull();
  });

  it('names the field of the first problem, in the user\'s words', () => {
    expect(shopInfoError({ ...EMPTY, brandName: 'x'.repeat(41) })).toMatchObject({ field: 'brandName' });
    expect(shopInfoError({ ...EMPTY, address: 'خط یک\nخط دو' })).toMatchObject({ field: 'address' });
    expect(shopInfoError({ ...EMPTY, postalCode: '123' })).toMatchObject({ field: 'postalCode' });
    expect(shopInfoError({ ...EMPTY, phone: 'abc' })).toMatchObject({ field: 'phone' });
    expect(shopInfoError({ ...EMPTY, mobile: '12' })).toMatchObject({ field: 'mobile' });
    expect(shopInfoError({ ...EMPTY, email: 'not-an-email' })).toMatchObject({ field: 'email' });
    expect(shopInfoError({ ...EMPTY, telegram: 'http://t.me/x' })).toMatchObject({ field: 'telegram' });
    expect(shopInfoError({ ...EMPTY, shippingText: Array.from({ length: 7 }, (_, n) => `خط ${n}`).join('\n') })).toMatchObject({ field: 'shippingText' });
    expect(shopInfoError({ ...EMPTY, shippingText: 'x'.repeat(121) })).toMatchObject({ field: 'shippingText' });
    expect(shopInfoError({ ...EMPTY, shippingText: 'خط\u0007' })).toMatchObject({ field: 'shippingText' });
    // a direction override could turn a name around in a browser tab; the non-joiner of Persian words is fine
    expect(shopInfoError({ ...EMPTY, brandFullName: 'گالری\u202Eنمونه' })).toMatchObject({ field: 'brandFullName' });
    expect(shopInfoError({ ...EMPTY, brandTagline: 'زیور دست\u200cساز' })).toBeNull();
    // lines pasted from Windows end in CR LF, and a tab is only a space (10a review: both were refused)
    expect(shopInfoError({ ...EMPTY, shippingText: 'خط یک\r\nخط دو', address: 'تهران،\tخیابان نمونه' })).toBeNull();
    expect(shopInfoError({ ...EMPTY, enamadLinkUrl: 'https://evil.example/x' })).toMatchObject({ field: 'enamadLinkUrl' });
    expect(shopInfoError({ ...EMPTY, enamadImageUrl: 'https://evil.example/x.png' })).toMatchObject({ field: 'enamadImageUrl' });
    // the seal needs both addresses, or neither
    expect(shopInfoError({ ...EMPTY, enamadLinkUrl: 'https://trustseal.enamad.ir/?id=1' })).toMatchObject({ field: 'enamadImageUrl' });
    expect(shopInfoError({ ...EMPTY, enamadImageUrl: 'https://trustseal.enamad.ir/logo.aspx?id=1' })).toMatchObject({ field: 'enamadLinkUrl' });
  });

  it('saves the values trimmed, in Latin digits, with the empty lines of the footer column dropped', () => {
    const saved = normalizedShopInfo({
      ...EMPTY, brandName: '  نگارین  ', address: 'تهران،   خیابان نمونه', postalCode: '۱۲۳۴۵۶۷۸۹۰', phone: '۰۲۱ ۱۲۳۴ ۵۶۷۸', email: ' Info@Shop.Example ',
      instagram: ' https://www.instagram.com/sample ', shippingText: '  خط یک \n\n خط دو\r\n', enamadLinkUrl: 'https://trustseal.enamad.ir/?id=1',
      enamadImageUrl: 'https://trustseal.enamad.ir/logo.aspx?id=1', whatsappFloat: true,
    });
    expect(saved).toMatchObject({
      brandName: 'نگارین', address: 'تهران، خیابان نمونه', postalCode: '1234567890', phone: '02112345678', email: 'Info@shop.example',
      instagram: 'https://www.instagram.com/sample', shippingText: 'خط یک\nخط دو', whatsappFloat: true,
    });
    expect(shippingLines(saved.shippingText)).toEqual(['خط یک', 'خط دو']);
  });

  it('gives the site a text only as one line within its length', () => {
    expect(safeShopText('  نام   برند ', 40)).toBe('نام برند');
    expect(safeShopText('x'.repeat(41), 40)).toBe('');
    expect(safeShopText('دو\nخط', 40)).toBe('');
    expect(safeShopText(7, 40)).toBe('');
    expect(safeShopText(null, 40)).toBe('');
  });
});

describe('the shop details section', () => {
  const wrap = (ui: ReactNode) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  };

  it('is a section of the site settings page, opened by its address', () => {
    expect(STOREFRONT_SECTION_IDS).toContain('info');
    expect(isStorefrontSection('info')).toBe(true);
  });

  it('shows what the site says today as the hint of an empty field, and saves the form under its version', async () => {
    fetchJson.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
      if (url === '/storefront/shop-info' && !init) return { data: view() };
      if (url === '/storefront/shop-info' && init?.method === 'PUT') return { data: view({ ...JSON.parse(init.body ?? '{}'), version: 5 }) };
      throw new Error(`unexpected call ${url}`);
    });
    wrap(<StorefrontShopInfoSection canManage />);
    const name = await screen.findByLabelText('نام کامل') as HTMLInputElement;
    expect(name.value).toBe('');
    expect(name.placeholder).toBe('گالری پاپیتال');
    expect((screen.getByLabelText('متن حق نشر') as HTMLInputElement).placeholder).toBe('همهٔ حقوق برای گالری پاپیتال محفوظ است.');
    fireEvent.change(name, { target: { value: 'گالری نگارین' } });
    // the last line's hint follows the name being typed
    expect((screen.getByLabelText('متن حق نشر') as HTMLInputElement).placeholder).toBe('همهٔ حقوق برای گالری نگارین محفوظ است.');
    fireEvent.change(screen.getByLabelText('کد پستی'), { target: { value: '۱۲۳۴۵۶۷۸۹۰' } });
    fireEvent.click(screen.getByLabelText('دکمهٔ واتس‌اپ گوشهٔ همهٔ صفحه‌های سایت بماند'));
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره' }));
    await waitFor(() => expect(fetchJson.mock.calls.some(([, init]) => (init as { method?: string } | undefined)?.method === 'PUT')).toBe(true));
    const put = fetchJson.mock.calls.find(([, init]) => (init as { method?: string } | undefined)?.method === 'PUT')!;
    const body = JSON.parse((put[1] as { body: string }).body);
    expect(body).toMatchObject({ brandFullName: 'گالری نگارین', postalCode: '۱۲۳۴۵۶۷۸۹۰', whatsappFloat: true, version: 4 });
    // the view's own extra field is never sent back
    expect(body).not.toHaveProperty('whatsappNumberSet');
  });

  it('names a field\'s problem and keeps the save button off until it is fixed', async () => {
    fetchJson.mockResolvedValue({ data: view() });
    wrap(<StorefrontShopInfoSection canManage />);
    const seal = await screen.findByLabelText('نشانی تصویر نماد');
    fireEvent.change(seal, { target: { value: 'https://evil.example/logo.png' } });
    expect(screen.getByRole('alert').textContent).toContain('enamad.ir');
    expect(seal.getAttribute('aria-invalid')).toBe('true');
    expect((screen.getByRole('button', { name: 'ذخیره' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(seal, { target: { value: '' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('is read-only for a holder of the view key, and says when the floating button has no number to use', async () => {
    fetchJson.mockResolvedValue({ data: view({ whatsappNumberSet: false, brandName: 'نگارین' }) });
    wrap(<StorefrontShopInfoSection canManage={false} />);
    const name = await screen.findByLabelText('نام کوتاه') as HTMLInputElement;
    expect(name.value).toBe('نگارین');
    // the whole form is one disabled fieldset
    expect(name.matches(':disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: 'ذخیره' })).toBeNull();
    expect(screen.getByText(/هنوز شماره‌ای نوشته نشده است/)).toBeTruthy();
  });
});
