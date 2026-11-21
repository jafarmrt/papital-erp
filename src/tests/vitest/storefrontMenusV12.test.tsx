import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MenusView } from '../../lib/storefront/storefrontMenuContracts';

/**
 * v12 phase 9b (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §6, owner's decision 3): the rules of the site's menu builder,
 * shared by the screen and the server, and the screen «منوهای سایت». The server side runs on PostgreSQL in
 * `reg_storefront_menus_v12_p9b`.
 */
const permissions = vi.hoisted(() => ({ current: [] as string[] }));
vi.mock('../../contexts/AuthContext', async () => {
  const actual = await vi.importActual<typeof import('../../contexts/AuthContext')>('../../contexts/AuthContext');
  return { ...actual, useHasPermission: (key: string) => permissions.current.includes(key) };
});
const calls = vi.hoisted(() => ({ list: [] as Array<{ url: string; init?: { method?: string; body?: string } }> }));
const menus = vi.hoisted((): { current: unknown } => ({ current: null }));
/** after a save, the list's next read never answers (a network break) */
const stall = vi.hoisted(() => ({ afterPut: false, put: false }));
/** the list of what a link may name: read, never answered, or failed */
const optionsMode = vi.hoisted((): { current: 'ok' | 'never' | 'fail' } => ({ current: 'ok' }));
vi.mock('../../api', () => ({
  API_URL: '/api',
  isAbortError: () => false,
  fetchJson: (url: string, init?: { method?: string; body?: string }) => {
    calls.list.push({ url, init });
    if (url === '/storefront/menus') return stall.afterPut && stall.put ? new Promise(() => undefined) : Promise.resolve({ data: menus.current });
    if (url === '/storefront/menus/link-options' && optionsMode.current !== 'ok') return optionsMode.current === 'never' ? new Promise(() => undefined) : Promise.reject(new Error('read failed'));
    if (url === '/storefront/menus/link-options') return Promise.resolve({ data: { categories: ['انگشتر', 'دستبند'], collections: ['یلدا'], campaigns: [], pages: [{ id: 8, title: 'راهنمای اندازه', live: true }, { id: 9, title: 'داستان ما', live: false }], products: [] } });
    if (init?.method === 'PUT') {
      stall.put = true;
      const body = JSON.parse(String(init.body));
      const items = body.items.map((i: Record<string, unknown>, n: number) => ({ ...i, id: n + 1, live: true, targetTitle: '', children: [] }));
      return Promise.resolve({ data: { location: url.split('/').pop(), enabled: body.enabled, version: body.version + 1, updatedBy: 'u', updatedAt: '', items } });
    }
    return Promise.resolve({ data: null });
  },
}));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});

const rules = await import('../../lib/storefront/storefrontMenuRules');
const StorefrontMenusPage = (await import('../../pages/StorefrontMenusPage')).default;
const toast = (await import('react-hot-toast')).default;

const item = (label: string, kind: string, extra: Record<string, unknown> = {}) =>
  rules.normalizedMenuItem('header', { label, kind, ...extra });

const emptyMenus = (): MenusView => ({
  menus: rules.MENU_LOCATIONS.map(location => ({ location, enabled: false, version: 1, updatedBy: '', updatedAt: '', items: [] })),
});

afterEach(() => {
  cleanup();
  calls.list = [];
  permissions.current = [];
  stall.afterPut = false;
  stall.put = false;
  optionsMode.current = 'ok';
  vi.mocked(toast.error).mockClear();
});

describe('menu rules (v12 phase 9b)', () => {
  it('accepts a header with a page, a category and a heading with children', () => {
    const list = [item('همه', 'page', { target: 'products' }), item('انگشتر', 'category', { target: 'انگشتر' }),
      { ...item('بیشتر', 'none'), children: [item('یلدا', 'collection', { target: 'یلدا' })] }];
    expect(rules.menuProblem('header', list, true)).toBeNull();
  });

  it('refuses an unsafe address or path, a heading without children and a second level', () => {
    const code = (list: ReturnType<typeof item>[], location: 'header' | 'footer' | 'bottom' = 'header', enabled = false) => rules.menuProblem(location, list, enabled)?.code;
    expect(code([item('بد', 'url', { target: 'javascript:alert(1)' })])).toBe('STOREFRONT_MENU_URL_INVALID');
    expect(code([item('بد', 'url', { target: 'http://papitalgallery.com' })])).toBe('STOREFRONT_MENU_URL_INVALID');
    expect(code([item('بد', 'url', { target: 'https://user:pass@papitalgallery.com' })])).toBe('STOREFRONT_MENU_URL_INVALID');
    expect(code([item('بد', 'path', { target: '//evil.example' })])).toBe('STOREFRONT_MENU_PATH_INVALID');
    expect(code([item('بد', 'path', { target: '/a b' })])).toBe('STOREFRONT_MENU_PATH_INVALID');
    expect(code([item('عنوان', 'none')])).toBe('STOREFRONT_MENU_HEADING_EMPTY');
    const deep = { ...item('بالا', 'none'), children: [{ ...item('میانه', 'page', { target: 'home' }), children: [item('ته', 'page', { target: 'home' })] }] };
    expect(code([deep])).toBe('STOREFRONT_MENU_TOO_DEEP');
    expect(code([item('ستون', 'page', { target: 'home' })], 'footer')).toBe('STOREFRONT_MENU_FOOTER_HEADING');
  });

  it('keeps the bottom bar to three to five buttons, each with an icon, and one cart and one account', () => {
    const button = (target: string, icon = 'home') => rules.normalizedMenuItem('bottom', { label: 'دکمه', kind: 'page', target, icon });
    expect(rules.menuProblem('bottom', [button('home'), button('cart')], true)?.code).toBe('STOREFRONT_MENU_BOTTOM_FEW');
    expect(rules.menuProblem('bottom', [button('home'), button('cart'), button('cart')], false)?.code).toBe('STOREFRONT_MENU_BOTTOM_TWICE');
    expect(rules.menuProblem('bottom', [button('home', ''), button('cart'), button('search')], false)?.code).toBe('STOREFRONT_MENU_ICON_REQUIRED');
    expect(rules.menuProblem('bottom', rules.currentSiteMenu('bottom', { categories: [], collections: [] }), true)).toBeNull();
    // a bottom button never keeps children
    expect(rules.normalizedMenuItem('bottom', { label: 'x', kind: 'page', target: 'home', children: [{ label: 'y', kind: 'page' }] }).children).toEqual([]);
  });

  it('builds today\'s site menu for every place, and each passes the rules', () => {
    const site = { categories: ['انگشتر', 'دستبند'], collections: ['یلدا'] };
    for (const location of rules.MENU_LOCATIONS) expect(rules.menuProblem(location, rules.currentSiteMenu(location, site), true), location).toBeNull();
    expect(rules.currentSiteMenu('header', site).map(i => i.label)).toEqual(['همهٔ محصولات', 'انگشتر', 'دستبند']);
    expect(rules.currentSiteMenu('footer', site).map(i => i.label)).toEqual(['خرید', 'کالکشن‌ها', 'پاپیتال']);
  });

  it('writes the site address of a page, a category, a collection, a path and an https address', () => {
    expect(rules.menuRuleHref('page', 'track')).toBe('/orders/track');
    expect(rules.menuRuleHref('category', 'انگشتر')).toBe(`/products?category=${encodeURIComponent('انگشتر')}`);
    expect(rules.menuRuleHref('collection', 'یلدا')).toBe(`/collections/${encodeURIComponent('یلدا')}`);
    expect(rules.menuRuleHref('path', '//evil.example')).toBeNull();
    expect(rules.menuRuleHref('url', 'javascript:alert(1)')).toBeNull();
  });
});

const page = (at = '/site-menus') => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[at]}><StorefrontMenusPage /></MemoryRouter>
  </QueryClientProvider>,
);

describe('the site menus screen', () => {
  it('opens the place named in the address, read-only without site_content.manage', async () => {
    menus.current = emptyMenus();
    permissions.current = ['site_content.view'];
    page('/site-menus?place=bottom');
    expect(await screen.findByText(/نوار پایین صفحه در گوشی/)).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'نوار پایین گوشی' }).getAttribute('aria-selected')).toBe('true');
    expect(within(screen.getByRole('tabpanel')).getByRole('checkbox', { name: 'این منو روی سایت بیاید' }).matches(':disabled')).toBe(true);
    expect(screen.getByText(/شما فقط می‌توانید ببینید/)).toBeTruthy();
  });

  it('starts from the site\'s menu, refuses a broken save on the screen and sends a good one whole with its version', async () => {
    menus.current = emptyMenus();
    permissions.current = ['site_content.view', 'site_content.manage'];
    page('/site-menus?place=header');
    await screen.findByText(/سرصفحهٔ سایت در پهنای کامپیوتر/);
    await waitFor(() => expect(calls.list.some(c => c.url === '/storefront/menus/link-options')).toBe(true));
    const panel = within(screen.getByRole('tabpanel'));
    fireEvent.click(panel.getByRole('button', { name: /شروع از منوی کنونی سایت/ }));
    expect((panel.getAllByLabelText('عنوان') as HTMLInputElement[]).map(i => i.value)).toEqual(['همهٔ محصولات', 'انگشتر', 'دستبند']);

    fireEvent.change(panel.getAllByLabelText('عنوان')[0], { target: { value: '' } });
    fireEvent.click(panel.getByRole('button', { name: /^ذخیره/ }));
    expect(vi.mocked(toast.error)).toHaveBeenCalled();
    expect(calls.list.some(c => c.init?.method === 'PUT')).toBe(false);

    fireEvent.change(panel.getAllByLabelText('عنوان')[0], { target: { value: 'همه' } });
    fireEvent.click(panel.getByRole('checkbox', { name: 'این منو روی سایت بیاید' }));
    fireEvent.click(panel.getByRole('button', { name: /^ذخیره/ }));
    await waitFor(() => expect(calls.list.some(c => c.init?.method === 'PUT')).toBe(true));
    const sent = calls.list.find(c => c.init?.method === 'PUT');
    expect(sent?.url).toBe('/storefront/menus/header');
    const body = JSON.parse(String(sent?.init?.body));
    expect(body.enabled).toBe(true);
    expect(body.version).toBe(1);
    expect(body.items.map((i: { label: string }) => i.label)).toEqual(['همه', 'انگشتر', 'دستبند']);
    expect(body.items[0]).not.toHaveProperty('key');
  });

  it('marks a saved link the site does not show now', async () => {
    const view = emptyMenus();
    view.menus[0].items = [{
      id: 7, label: 'خالی', kind: 'category', target: 'خالی', itemId: null, campaignId: null, pageId: null, icon: '', isActive: true,
      targetTitle: '', live: false, children: [],
    }];
    menus.current = view;
    permissions.current = ['site_content.view', 'site_content.manage'];
    page();
    expect(await screen.findByText('این پیوند اکنون روی سایت نیست و نشان داده نمی‌شود.')).toBeTruthy();
  });

  it('sends a footer column\'s links without a children key, as the server\'s strict schema takes them, and keeps a draft across tabs', async () => {
    menus.current = emptyMenus();
    permissions.current = ['site_content.view', 'site_content.manage'];
    page('/site-menus?place=footer');
    await waitFor(() => expect(calls.list.some(c => c.url === '/storefront/menus/link-options')).toBe(true));
    const panel = within(await screen.findByRole('tabpanel'));
    fireEvent.click(panel.getByRole('button', { name: /شروع از منوی کنونی سایت/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'منوی بالا' }));
    fireEvent.click(screen.getByRole('tab', { name: 'پاورقی' }));
    const again = within(screen.getByRole('tabpanel'));
    expect((again.getAllByLabelText('عنوان') as HTMLInputElement[])[0].value).toBe('خرید');
    fireEvent.click(again.getByRole('button', { name: /^ذخیره/ }));
    await waitFor(() => expect(calls.list.some(c => c.init?.method === 'PUT')).toBe(true));
    const body = JSON.parse(String(calls.list.find(c => c.init?.method === 'PUT')?.init?.body));
    expect(body.items[0].children.length).toBeGreaterThan(0);
    for (const column of body.items) for (const child of column.children) expect(child).not.toHaveProperty('children');
  });

  it('clears the target when the link kind changes', async () => {
    menus.current = emptyMenus();
    permissions.current = ['site_content.view', 'site_content.manage'];
    page('/site-menus?place=header');
    await waitFor(() => expect(calls.list.some(c => c.url === '/storefront/menus/link-options')).toBe(true));
    const panel = within(await screen.findByRole('tabpanel'));
    fireEvent.click(panel.getByRole('button', { name: /افزودن گزینه/ }));
    fireEvent.change(panel.getByLabelText('پیوند به'), { target: { value: 'path' } });
    fireEvent.change(panel.getByLabelText('مقصد'), { target: { value: '/about' } });
    fireEvent.change(panel.getByLabelText('پیوند به'), { target: { value: 'url' } });
    expect((panel.getByLabelText('مقصد') as HTMLInputElement).value).toBe('');
  });

  it('links to a page of the page builder by its row, marks one not on the site, and drops the page when the kind changes (v12 phase 10c)', async () => {
    menus.current = emptyMenus();
    permissions.current = ['site_content.view', 'site_content.manage'];
    page('/site-menus?place=header');
    await waitFor(() => expect(calls.list.some(c => c.url === '/storefront/menus/link-options')).toBe(true));
    const panel = within(await screen.findByRole('tabpanel'));
    fireEvent.click(panel.getByRole('button', { name: /افزودن گزینه/ }));
    fireEvent.change(panel.getByLabelText('عنوان'), { target: { value: 'داستان ما' } });
    fireEvent.change(panel.getByLabelText('پیوند به'), { target: { value: 'content' } });
    const target = panel.getByLabelText('مقصد') as HTMLSelectElement;
    expect([...target.options].map(o => o.textContent)).toEqual(['برگزینید', 'راهنمای اندازه', 'داستان ما (اکنون روی سایت نیست)']);
    // no page chosen yet: the save is refused on the screen
    fireEvent.click(panel.getByRole('button', { name: /^ذخیره/ }));
    expect(vi.mocked(toast.error)).toHaveBeenCalled();
    expect(calls.list.some(c => c.init?.method === 'PUT')).toBe(false);
    fireEvent.change(target, { target: { value: '9' } });
    fireEvent.click(panel.getByRole('button', { name: /^ذخیره/ }));
    await waitFor(() => expect(calls.list.some(c => c.init?.method === 'PUT')).toBe(true));
    const body = JSON.parse(String(calls.list.find(c => c.init?.method === 'PUT')?.init?.body));
    expect(body.items[0]).toMatchObject({ label: 'داستان ما', kind: 'content', pageId: 9, target: '', itemId: null, campaignId: null });
    // another kind never carries the page along: back on this kind, no page is chosen any more
    fireEvent.change(panel.getByLabelText('پیوند به'), { target: { value: 'path' } });
    fireEvent.change(panel.getByLabelText('پیوند به'), { target: { value: 'content' } });
    expect((panel.getByLabelText('مقصد') as HTMLSelectElement).value).toBe('');
    fireEvent.change(panel.getByLabelText('پیوند به'), { target: { value: 'path' } });
    fireEvent.change(panel.getByLabelText('مقصد'), { target: { value: '/products' } });
    calls.list = [];
    fireEvent.click(panel.getByRole('button', { name: /^ذخیره/ }));
    await waitFor(() => expect(calls.list.some(c => c.init?.method === 'PUT')).toBe(true));
    expect(JSON.parse(String(calls.list.find(c => c.init?.method === 'PUT')?.init?.body)).items[0]).toMatchObject({ kind: 'path', target: '/products', pageId: null });
  });

  const withSavedPageLink = (): MenusView => ({
    menus: rules.MENU_LOCATIONS.map(location => ({
      location, enabled: true, version: 2, updatedBy: '', updatedAt: '',
      items: location === 'header' ? [{ id: 4, label: 'صفحهٔ قدیمی', kind: 'content', target: '', itemId: null, campaignId: null, pageId: 77, icon: '', isActive: true, targetTitle: 'راهنمای خرید', live: true, children: [] }] : [],
    })),
  } as MenusView);

  it('calls a saved link\'s page removed only once the list of pages has been read and does not have it', async () => {
    menus.current = withSavedPageLink();
    permissions.current = ['site_content.view', 'site_content.manage'];
    page('/site-menus?place=header');
    const panel = within(await screen.findByRole('tabpanel'));
    await waitFor(() => expect([...(panel.getByLabelText('مقصد') as HTMLSelectElement).options].map(o => o.textContent)).toContain('صفحه‌ای که حذف شده است'));
    expect((panel.getByLabelText('مقصد') as HTMLSelectElement).value).toBe('77');
  });

  it.each(['never', 'fail'] as const)('keeps the saved name of a link\'s page while the list of pages is not read (%s)', async (mode) => {
    optionsMode.current = mode;
    menus.current = withSavedPageLink();
    permissions.current = ['site_content.view', 'site_content.manage'];
    page('/site-menus?place=header');
    const panel = within(await screen.findByRole('tabpanel'));
    await waitFor(() => expect((panel.getByLabelText('مقصد') as HTMLSelectElement).value).toBe('77'));
    if (mode === 'fail') await screen.findByText(/فهرست دسته‌ها، صفحه‌ها و محصولات خوانده نشد/);
    const shown = [...(panel.getByLabelText('مقصد') as HTMLSelectElement).options].map(o => o.textContent);
    expect(shown).toContain('راهنمای خرید');
    expect(shown).not.toContain('صفحه‌ای که حذف شده است');
  });

  it('keeps the saved menu on the screen while the list is still being read again after a save', async () => {
    menus.current = emptyMenus();
    stall.afterPut = true;
    permissions.current = ['site_content.view', 'site_content.manage'];
    page('/site-menus?place=header');
    await waitFor(() => expect(calls.list.some(c => c.url === '/storefront/menus/link-options')).toBe(true));
    const panel = within(await screen.findByRole('tabpanel'));
    fireEvent.click(panel.getByRole('button', { name: /شروع از منوی کنونی سایت/ }));
    fireEvent.click(panel.getByRole('button', { name: /^ذخیره/ }));
    await waitFor(() => expect(calls.list.some(c => c.init?.method === 'PUT')).toBe(true));
    await waitFor(() => expect((panel.getAllByLabelText('عنوان') as HTMLInputElement[]).map(i => i.value)).toEqual(['همهٔ محصولات', 'انگشتر', 'دستبند']));
    expect(panel.queryByRole('alert')).toBeNull();
  });
});
