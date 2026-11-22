import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PageDetail } from '../../lib/storefront/storefrontPageContracts';

/**
 * v12 phase 10c (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): «پیش‌نمایش روی سایت» in the page editor of the ERP:
 * the button asks for a one-hour link to the saved draft, shows it to open or copy with the time it ends, waits while
 * something is unsaved, and is not there for a view-only holder.
 */
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ API_URL: '/api', fetchJson: (...args: unknown[]) => fetchJson(...(args as [])), isAbortError: () => false }));
const toastError = vi.hoisted(() => vi.fn());
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: toastError, loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});
const permissions = vi.hoisted(() => ({ current: [] as string[] }));
vi.mock('../../contexts/AuthContext', async () => {
  const actual = await vi.importActual<typeof import('../../contexts/AuthContext')>('../../contexts/AuthContext');
  return { ...actual, useHasPermission: (key: string) => permissions.current.includes(key) };
});
vi.mock('../../components/storefront/pages/RichTextEditor', () => ({ default: () => null }));

const StorefrontPagesPage = (await import('../../pages/StorefrontPagesPage')).default;

const DETAIL: PageDetail = {
  id: 9, kind: 'custom', slug: 'our-story', title: 'داستان ما', status: 'draft', publishedAt: '', updatedAt: '2026-11-21 10:00:00', updatedBy: '', version: 4,
  draft: { title: 'داستان ما', slug: 'our-story', seoTitle: '', seoDescription: '', noindex: false, shareImageAssetId: null, sections: [{ kind: 'button', background: 'white', label: 'خرید', href: '/products' }] },
  assets: [], menuPlaces: [],
};

/** the head of the link the server answers, and whether it is the address written in the settings */
const site = { origin: 'https://test-site.example', written: true };

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  permissions.current = [];
  Object.assign(site, { origin: 'https://test-site.example', written: true });
});

type Call = [string, { method?: string; body?: string } | undefined];
const calls = (method: string) => (fetchJson.mock.calls as Call[]).filter(([, init]) => init?.method === method);

function open() {
  fetchJson.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    if (url === '/storefront/pages' && !init) return { data: [DETAIL] };
    if (url === '/storefront/menus/link-options') return { data: { categories: [], collections: [], campaigns: [], products: [] } };
    if (url === '/storefront/pages/9' && !init) return { data: DETAIL };
    if (init?.method === 'POST' && url === '/storefront/pages/9/preview') {
      return { data: { path: '/preview/KEY', url: `${site.origin}/preview/KEY`, expiresAt: '2026-11-22T09:30:00.000Z', addressSet: site.written } };
    }
    throw new Error(`unexpected call ${init?.method ?? 'GET'} ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/site-pages?page=9']}><StorefrontPagesPage /></MemoryRouter></QueryClientProvider>);
}

describe('the preview link of a page in the ERP', () => {
  it('says so when no site address is written in the settings and the link begins with the main domain', async () => {
    permissions.current = ['site_content.view', 'site_content.manage'];
    Object.assign(site, { origin: 'https://papitalgallery.com', written: false });
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'پیش‌نمایش روی سایت' }));
    const box = within(await screen.findByRole('group', { name: 'پیوند پیش‌نمایش' }));
    expect(box.getByRole('note').textContent).toMatch(/«نشانی فروشگاه سایت» در «جست‌وجو و آمار بازدید» نوشته نشده است/);
    expect(box.getByRole('link', { name: 'باز کردن پیش‌نمایش' }).getAttribute('href')).toBe('https://papitalgallery.com/preview/KEY');
  });

  it('makes a preview link of the saved draft, shows it to open or copy, and waits while something is unsaved (v12 phase 10c)', async () => {
    permissions.current = ['site_content.view', 'site_content.manage'];
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (text: string) => { written.push(text); return Promise.resolve(); } } });
    open();
    const button = await screen.findByRole('button', { name: 'پیش‌نمایش روی سایت' }) as HTMLButtonElement;
    // with an unsaved edit there is nothing saved to show yet: the button waits and says why
    fireEvent.change(screen.getByLabelText('عنوان صفحه'), { target: { value: 'داستان تازه' } });
    expect(button.disabled).toBe(true);
    // the reason is a sentence on the screen tied to the button, not a tooltip a keyboard never reaches
    expect(document.getElementById(String(button.getAttribute('aria-describedby')))?.textContent).toContain('نخست ذخیره کنید');
    fireEvent.change(screen.getByLabelText('عنوان صفحه'), { target: { value: 'داستان ما' } });
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-describedby')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.queryByRole('group', { name: 'پیوند پیش‌نمایش' })).toBeNull();
    fireEvent.click(button);
    fireEvent.click(button);
    const box = within(await screen.findByRole('group', { name: 'پیوند پیش‌نمایش' }));
    // one request, under no version (a link changes nothing a colleague edits), and the page is not read again as changed
    expect(calls('POST')).toHaveLength(1);
    expect(calls('POST')[0][0]).toBe('/storefront/pages/9/preview');
    expect(JSON.parse(String(calls('POST')[0][1]?.body))).toEqual({});
    expect(screen.getByText('https://test-site.example/preview/KEY')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('پیوند پیش‌نمایش ساخته شد.');
    // the address is the one written in the settings: nothing to warn about
    expect(box.queryByRole('note')).toBeNull();
    const openLink = box.getByRole('link', { name: 'باز کردن پیش‌نمایش' });
    expect(openLink.getAttribute('href')).toBe('https://test-site.example/preview/KEY');
    expect(openLink.getAttribute('target')).toBe('_blank');
    expect(openLink.getAttribute('rel')).toBe('noopener noreferrer');
    // it says until when, and that whoever has the link sees the draft
    expect(screen.getByRole('group', { name: 'پیوند پیش‌نمایش' }).textContent).toMatch(/این پیوند تا .*[۰-۹]{2}:[۰-۹]{2}.* هر کس پیوند را داشته باشد آن را می‌بیند/);
    fireEvent.click(box.getByRole('button', { name: 'کپی پیوند' }));
    expect(written).toEqual(['https://test-site.example/preview/KEY']);
    // the editor is as it was: nothing unsaved, nothing stale
    expect((screen.getByRole('button', { name: 'ذخیرهٔ پیش‌نویس' }) as HTMLButtonElement).disabled).toBe(true);
    // a browser without a clipboard (a page not on https): the click says so and breaks nothing
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    fireEvent.click(box.getByRole('button', { name: 'کپی پیوند' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('کپی نشد؛ پیوند را از همین‌جا بردارید.'));
    cleanup();
    fetchJson.mockReset();
    permissions.current = ['site_content.view'];
    open();
    await screen.findByLabelText('عنوان صفحه');
    expect(screen.queryByRole('button', { name: 'پیش‌نمایش روی سایت' })).toBeNull();
  });
});
