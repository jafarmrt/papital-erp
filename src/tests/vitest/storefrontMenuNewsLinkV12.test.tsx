import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MenusView } from '../../lib/storefront/storefrontMenuContracts';

/**
 * v12 phase 10d, part 3 (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): the news in the menu builder «فهرست‌های سایت»:
 * the link kind «خبر», which names a news item by its row, and «خبرها», the list of news, among the site's own pages.
 * The server side runs on PostgreSQL in `reg_storefront_menu_news_link_v12_p10d`.
 */
const calls = vi.hoisted(() => ({ list: [] as Array<{ url: string; init?: { method?: string; body?: string } }> }));
const menus = vi.hoisted((): { current: unknown } => ({ current: null }));
vi.mock('../../contexts/AuthContext', async () => {
  const actual = await vi.importActual<typeof import('../../contexts/AuthContext')>('../../contexts/AuthContext');
  return { ...actual, useHasPermission: () => true };
});
vi.mock('../../api', () => ({
  API_URL: '/api',
  isAbortError: () => false,
  fetchJson: (url: string, init?: { method?: string; body?: string }) => {
    calls.list.push({ url, init });
    if (url === '/storefront/menus') return Promise.resolve({ data: menus.current });
    if (url === '/storefront/menus/link-options') {
      return Promise.resolve({ data: { categories: [], collections: [], campaigns: [], pages: [], news: [{ id: 21, title: 'شب یلدا در گالری', live: true }, { id: 22, title: 'خبر در نوبت', live: false }], products: [] } });
    }
    if (init?.method === 'PUT') {
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

const emptyMenus = (): MenusView => ({
  menus: rules.MENU_LOCATIONS.map(location => ({ location, enabled: false, version: 1, updatedBy: '', updatedAt: '', items: [] })),
});
/** a saved link to a news item; `targetTitle` '' is what the server sends for an item that is gone */
const withSavedNewsLink = (newsId: number, targetTitle: string): MenusView => ({
  menus: rules.MENU_LOCATIONS.map(location => ({
    location, enabled: true, version: 2, updatedBy: '', updatedAt: '',
    items: location === 'header'
      ? [{ id: 4, label: 'خبر قدیمی', kind: 'news', target: '', itemId: null, campaignId: null, pageId: null, newsId, icon: '', isActive: true, targetTitle, live: targetTitle !== '', children: [] }]
      : [],
  })),
} as MenusView);

afterEach(() => {
  cleanup();
  calls.list = [];
});

const page = (at = '/site-menus') => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[at]}><StorefrontMenusPage /></MemoryRouter>
  </QueryClientProvider>,
);
const sent = () => JSON.parse(String(calls.list.find(c => c.init?.method === 'PUT')?.init?.body)) as { items: Array<Record<string, unknown>> };

describe('the news in the site menus screen', () => {
  it('links to a news item by its row and to the list of news as a page of the site, and drops the item when the kind changes (v12 phase 10d)', async () => {
    menus.current = emptyMenus();
    page('/site-menus?place=header');
    await waitFor(() => expect(calls.list.some(c => c.url === '/storefront/menus/link-options')).toBe(true));
    const panel = within(await screen.findByRole('tabpanel'));
    fireEvent.click(panel.getByRole('button', { name: /افزودن گزینه/ }));
    fireEvent.change(panel.getByLabelText('عنوان'), { target: { value: 'یلدا' } });
    // «خبر» is one of the kinds, and the list of news one of the site's own pages
    expect([...(panel.getByLabelText('پیوند به') as HTMLSelectElement).options].map(o => o.textContent)).toContain('خبر');
    fireEvent.change(panel.getByLabelText('پیوند به'), { target: { value: 'page' } });
    expect([...(panel.getByLabelText('مقصد') as HTMLSelectElement).options].map(o => o.textContent)).toContain('خبرها');
    fireEvent.change(panel.getByLabelText('پیوند به'), { target: { value: 'news' } });
    const target = panel.getByLabelText('مقصد') as HTMLSelectElement;
    expect([...target.options].map(o => o.textContent)).toEqual(['برگزینید', 'شب یلدا در گالری', 'خبر در نوبت (اکنون روی سایت نیست)']);
    fireEvent.click(panel.getByRole('button', { name: /^ذخیره/ }));
    // no item chosen yet: the save is refused on the screen
    expect(calls.list.some(c => c.init?.method === 'PUT')).toBe(false);
    fireEvent.change(target, { target: { value: '21' } });
    fireEvent.click(panel.getByRole('button', { name: /^ذخیره/ }));
    await waitFor(() => expect(calls.list.some(c => c.init?.method === 'PUT')).toBe(true));
    expect(JSON.parse(String(calls.list.find(c => c.init?.method === 'PUT')?.init?.body)).items[0]).toMatchObject({ label: 'یلدا', kind: 'news', newsId: 21, target: '', pageId: null, itemId: null, campaignId: null });
    // another kind never carries the item along
    fireEvent.change(panel.getByLabelText('پیوند به'), { target: { value: 'page' } });
    fireEvent.change(panel.getByLabelText('مقصد'), { target: { value: 'news' } });
    calls.list = [];
    fireEvent.click(panel.getByRole('button', { name: /^ذخیره/ }));
    await waitFor(() => expect(calls.list.some(c => c.init?.method === 'PUT')).toBe(true));
    expect(JSON.parse(String(calls.list.find(c => c.init?.method === 'PUT')?.init?.body)).items[0]).toMatchObject({ kind: 'page', target: 'news', newsId: null });
  });

  it('opens a saved link with its item chosen, and saves it again as it was', async () => {
    menus.current = withSavedNewsLink(21, 'شب یلدا در گالری');
    page('/site-menus?place=header');
    const panel = within(await screen.findByRole('tabpanel'));
    await waitFor(() => expect(calls.list.some(c => c.url === '/storefront/menus/link-options')).toBe(true));
    const target = panel.getByLabelText('مقصد') as HTMLSelectElement;
    // red before a fix would be: the saved item lost on opening, the field back on «برگزینید» and every save refused
    await waitFor(() => expect(target.value).toBe('21'));
    expect((panel.getByLabelText('پیوند به') as HTMLSelectElement).value).toBe('news');
    fireEvent.change(panel.getByLabelText('عنوان'), { target: { value: 'خبر یلدا' } });
    fireEvent.click(panel.getByRole('button', { name: /^ذخیره/ }));
    await waitFor(() => expect(calls.list.some(c => c.init?.method === 'PUT')).toBe(true));
    expect(sent().items[0]).toMatchObject({ id: 4, label: 'خبر یلدا', kind: 'news', newsId: 21, target: '' });
    // the server's schema is strict: a field of the screen's own would be a 400 on every save
    expect(Object.keys(sent().items[0]).sort()).toEqual(['campaignId', 'children', 'icon', 'id', 'isActive', 'itemId', 'kind', 'label', 'newsId', 'pageId', 'target']);
  });

  it('keeps a saved item that is not among the newest under its own title, and one that is gone as removed, each still its own choice', async () => {
    // an older item: the list offers only the newest, the server sent this one's title with the menu
    menus.current = withSavedNewsLink(7, 'خبر سال پیش');
    page('/site-menus?place=header');
    let panel = within(await screen.findByRole('tabpanel'));
    await waitFor(() => expect([...(panel.getByLabelText('مقصد') as HTMLSelectElement).options].map(o => o.textContent)).toEqual(['برگزینید', 'خبر سال پیش', 'شب یلدا در گالری', 'خبر در نوبت (اکنون روی سایت نیست)']));
    expect((panel.getByLabelText('مقصد') as HTMLSelectElement).value).toBe('7');
    cleanup();
    calls.list = [];
    // a removed item: the server sends no title for it; it can be changed for another and saved
    menus.current = withSavedNewsLink(9, '');
    page('/site-menus?place=header');
    panel = within(await screen.findByRole('tabpanel'));
    const target = panel.getByLabelText('مقصد') as HTMLSelectElement;
    await waitFor(() => expect([...target.options].map(o => o.textContent)).toContain('خبری که حذف شده است'));
    expect(target.value).toBe('9');
    fireEvent.change(target, { target: { value: '21' } });
    fireEvent.click(panel.getByRole('button', { name: /^ذخیره/ }));
    await waitFor(() => expect(calls.list.some(c => c.init?.method === 'PUT')).toBe(true));
    expect(sent().items[0]).toMatchObject({ id: 4, kind: 'news', newsId: 21 });
  });
});
