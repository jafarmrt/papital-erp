import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PageDetail } from '../../lib/storefront/storefrontPageContracts';

/**
 * v12 phase 10c (owner's decision 23; docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): a fixed page of the site in the
 * ERP's «صفحه‌های سایت»: the list names it with its address on the site, and its editor offers only its words (a title,
 * one text above the page, the search title and description), with no address, search switch, share image, preview or
 * removal.
 */
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ API_URL: '/api', fetchJson: (...args: unknown[]) => fetchJson(...(args as [])), isAbortError: () => false }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});
const permissions = vi.hoisted(() => ({ current: [] as string[] }));
vi.mock('../../contexts/AuthContext', async () => {
  const actual = await vi.importActual<typeof import('../../contexts/AuthContext')>('../../contexts/AuthContext');
  return { ...actual, useHasPermission: (key: string) => permissions.current.includes(key) };
});
vi.mock('../../components/storefront/pages/RichTextEditor', () => ({ default: () => null }));

const StorefrontPagesPage = (await import('../../pages/StorefrontPagesPage')).default;

const CART: PageDetail = {
  id: 21, kind: 'fixed', slug: 'fixed-cart', title: 'سبد خرید', status: 'draft', publishedAt: '', updatedAt: '2026-11-23 10:00:00', updatedBy: '', version: 1,
  draft: { title: 'سبد خرید', slug: 'fixed-cart', seoTitle: '', seoDescription: '', noindex: false, shareImageAssetId: null, sections: [] },
  assets: [], menuPlaces: [],
};
const STORY: PageDetail = {
  ...CART, id: 9, kind: 'custom', slug: 'our-story', title: 'داستان ما',
  draft: { ...CART.draft, title: 'داستان ما', slug: 'our-story', sections: [{ kind: 'button', background: 'white', label: 'خرید', href: '/products' }] },
};

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  permissions.current = [];
});

type Call = [string, { method?: string; body?: string } | undefined];
const calls = (method: string) => (fetchJson.mock.calls as Call[]).filter(([, init]) => init?.method === method);

function open(at: string) {
  fetchJson.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    if (url === '/storefront/pages' && !init) return { data: [CART, STORY] };
    if (url === '/storefront/menus/link-options') return { data: { categories: [], collections: [], campaigns: [], products: [] } };
    if (url === '/storefront/pages/21' && !init) return { data: CART };
    if (url === '/storefront/pages/9' && !init) return { data: STORY };
    if (init?.method === 'PUT' && url === '/storefront/pages/21') return { data: { ...CART, version: 2, draft: JSON.parse(String(init.body)) as PageDetail['draft'] } };
    throw new Error(`unexpected call ${init?.method ?? 'GET'} ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[at]}><StorefrontPagesPage /></MemoryRouter></QueryClientProvider>);
}

describe('a fixed page of the site in the ERP', () => {
  it('is named in the list with its address on the site, apart from the pages the shop made', async () => {
    permissions.current = ['site_content.view', 'site_content.manage'];
    open('/site-pages');
    await screen.findByText('صفحهٔ ثابت');
    const rows = within(screen.getByRole('list', { name: 'صفحه‌ها' })).getAllByRole('listitem');
    expect(rows[0].textContent).toContain('سبد خرید');
    expect(rows[0].textContent).toContain('صفحهٔ ثابت');
    expect(rows[0].textContent).toContain('/cart');
    expect(rows[0].textContent).not.toContain('fixed-cart');
    expect(rows[1].textContent).toContain('/pages/our-story');
    expect(rows[1].textContent).not.toContain('صفحهٔ ثابت');
  });

  it('offers only its words in the editor: a title, one text above the page and the search words', async () => {
    permissions.current = ['site_content.view', 'site_content.manage'];
    open('/site-pages?page=21');
    const titleField = await screen.findByLabelText('عنوان صفحه') as HTMLInputElement;
    expect(screen.getByRole('note').textContent).toMatch(/این صفحهٔ ثابت سایت است \(\/cart\).*تا «انتشار»، سایت متن کنونی خودش را نشان می‌دهد/);
    // nothing of a page the shop makes that a fixed page has no use for
    expect((screen.getByLabelText('نشانی لاتین').closest('div') as HTMLDivElement).hidden).toBe(true);
    expect(screen.queryByLabelText('این صفحه در موتور جست‌وجو نیاید')).toBeNull();
    expect(screen.queryByText('تصویر اشتراک‌گذاری (اختیاری)')).toBeNull();
    expect(screen.queryByRole('button', { name: 'پیش‌نمایش روی سایت' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'حذف صفحه' })).toBeNull();
    expect(screen.getByLabelText('عنوان جست‌وجو (اختیاری)')).toBeTruthy();
    expect(screen.getByLabelText('توضیح جست‌وجو (اختیاری)')).toBeTruthy();
    // the one kind of part is a text, and only one
    const kinds = within(screen.getByLabelText('بخش تازه')).getAllByRole('option').map(option => option.textContent);
    expect(kinds).toEqual(['متن']);
    const add = screen.getByRole('button', { name: 'افزودن بخش' }) as HTMLButtonElement;
    fireEvent.click(add);
    expect(add.disabled).toBe(true);
    expect(within(screen.getByRole('region', { name: 'متن بالای صفحه' })).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByLabelText('زمینه')).toBeNull();
    // the words are saved under the row's own name
    fireEvent.change(titleField, { target: { value: 'سبد خرید شما' } });
    fireEvent.change(screen.getByLabelText('توضیح جست‌وجو (اختیاری)'), { target: { value: 'سبد خرید گالری' } });
    fireEvent.click(screen.getByRole('button', { name: 'ذخیرهٔ پیش‌نویس' }));
    await waitFor(() => expect(calls('PUT')).toHaveLength(1));
    const sent = JSON.parse(String(calls('PUT')[0][1]?.body)) as PageDetail['draft'] & { version: number };
    expect(sent).toMatchObject({ title: 'سبد خرید شما', slug: 'fixed-cart', seoDescription: 'سبد خرید گالری', noindex: false, shareImageAssetId: null, version: 1 });
    expect(sent.sections.map(section => section.kind)).toEqual(['text']);
  });

  it('leaves the editor of a page the shop made as it was', async () => {
    permissions.current = ['site_content.view', 'site_content.manage'];
    open('/site-pages?page=9');
    await screen.findByLabelText('عنوان صفحه');
    expect(screen.queryByRole('note')).toBeNull();
    expect((screen.getByLabelText('نشانی لاتین').closest('div') as HTMLDivElement).hidden).toBe(false);
    expect(screen.getByLabelText('این صفحه در موتور جست‌وجو نیاید')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'پیش‌نمایش روی سایت' })).toBeTruthy();
    expect(within(screen.getByLabelText('بخش تازه')).getAllByRole('option').length).toBeGreaterThan(5);
    expect(screen.getByRole('region', { name: 'بخش‌های صفحه' })).toBeTruthy();
  });
});
