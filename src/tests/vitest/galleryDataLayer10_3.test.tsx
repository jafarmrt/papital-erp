import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ownReads } from './helpers/ownReads';
import { appQueryClient } from './helpers/queryWrapper';

/**
 * 10.3 (ARCH review finding 3, part 16): the gallery reads its page and the categories through the shared cache, again on
 * each visit and never showing what an earlier visit left; a refused page shows the server's reason, not «nothing to
 * show»; a new filter reads only its first page; an item change refreshes the page on screen.
 */
/** Persian words the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = {
  loading: /در حال بارگذاری تصاویر گالری/,
  empty: /موردی برای نمایش در گالری یافت نشد/,
  next: 'بعدی',
  products: 'محصولات نهایی',
  materials: 'مواد اولیه',
  searchBox: /جست/,
  categoriesFailed: 'خطا در دریافت دسته‌بندی‌ها',
  pageOf: (page: string, total: string) => `صفحه ${page} از ${total}`,
} as const;

type Opts = { method?: string; signal?: AbortSignal };
const item = (id: number, name: string) => ({ id, name, code: `P-${id}`, image: `/p${id}.png`, current_stock: 1, unit: 'u' });
const server = {
  page: { data: [item(1, 'fresh item')], total: 1, totalPages: 1 } as Record<string, unknown>,
  categories: [{ id: 1, name: 'rings', type: 'product' }] as unknown[],
};
const reads = { hold: null as string | null, fail: null as string | null, held: [] as Array<(answer: unknown) => void> };
const fetchJson = vi.fn(async (url: string, opts?: Opts): Promise<unknown> => {
  const path = url.split('?')[0] ?? '';
  if (opts?.method) return { success: true };
  if (reads.hold === path) { reads.hold = null; return new Promise(resolve => { reads.held.push(resolve); }); }
  if (reads.fail === path) { reads.fail = null; throw new Error('server refused the read'); }
  if (path === '/items') return server.page;
  if (path === '/categories') return server.categories;
  return [];
});
vi.mock('../../api', () => ({ API_URL: '/api', fetchJson: (url: string, opts?: Opts) => fetchJson(url, opts), isAbortError: () => false }));
const toastError = vi.fn();
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: (m: string) => toastError(m), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});

import GalleryPage from '../../pages/GalleryPage';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { SearchProvider } from '../../SearchContext';

afterEach(() => {
  cleanup();
  fetchJson.mockClear();
  toastError.mockClear();
  Object.assign(reads, { hold: null, fail: null, held: [] });
  server.page = { data: [item(1, 'fresh item')], total: 1, totalPages: 1 };
  server.categories = [{ id: 1, name: 'rings', type: 'product' }];
});

/** the app's read defaults (fresh for five minutes): the screen must read again on its own */
const newClient = appQueryClient;
const visit = (client = newClient()) => render(
  <QueryClientProvider client={client}><SearchProvider><GalleryPage user={{ id: 1, username: 'u', role: 'admin' } as never} /></SearchProvider></QueryClientProvider>,
);
/** the time an earlier visit read its data: a moment ago, so only reading again on each visit hides it */
const earlier = () => ({ updatedAt: Date.now() - 1_000 });
const FIRST_PAGE = { tab: 'product', page: 1, search: '', category: '' };
const itemReads = () => fetchJson.mock.calls
  .filter(([u, o]) => u.split('?')[0] === '/items' && !o?.method)
  .map(([u]) => new URLSearchParams(u.split('?')[1] ?? ''));

describe('the gallery reads through the shared cache (10.3)', () => {
  it('never shows the page an earlier visit left while it reads again', async () => {
    const client = newClient();
    client.setQueryData([...QUERY_KEYS.items.all, 'gallery', FIRST_PAGE], { rows: [item(9, 'stale item')], totalPages: 1 }, earlier());
    reads.hold = '/items';
    visit(client);
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(screen.queryByText('stale item')).toBeNull();
    expect(screen.getByText(SHOWN.loading)).toBeTruthy();
    await act(async () => { reads.held[0]?.(server.page); });
    expect(await screen.findByText('fresh item')).toBeTruthy();
  });

  it('a refused page shows the server reason, not «nothing to show»', async () => {
    reads.fail = '/items';
    visit();
    expect((await screen.findByRole('alert')).textContent).toBe('server refused the read');
    expect(screen.queryByText(SHOWN.empty)).toBeNull();
    expect(screen.queryByText(SHOWN.loading)).toBeNull();
  });

  it('the next page keeps the page count while it is read', async () => {
    server.page = { data: [item(1, 'fresh item')], total: 120, totalPages: 3 };
    visit();
    expect(await screen.findByText('fresh item')).toBeTruthy();
    reads.hold = '/items';
    fireEvent.click(screen.getByText(SHOWN.next));
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(screen.getByText(SHOWN.pageOf('۲', '۳'))).toBeTruthy();
    expect(itemReads().at(-1)?.get('page')).toBe('2');
  });

  it('a new category reads its first page only', async () => {
    server.page = { data: [item(1, 'fresh item')], total: 120, totalPages: 3 };
    visit();
    expect(await screen.findByText('fresh item')).toBeTruthy();
    fireEvent.click(screen.getByText(SHOWN.next));
    await waitFor(() => expect(itemReads().at(-1)?.get('page')).toBe('2'));
    await screen.findByRole('option', { name: 'rings' });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'rings' } });
    await waitFor(() => expect(itemReads().at(-1)?.get('category')).toBe('rings'));
    const ofRings = itemReads().filter(q => q.get('category') === 'rings');
    expect(ofRings.map(q => q.get('page'))).toEqual(['1']);
  });

  it('a return to an earlier tab starts at its first page, and pages on from there', async () => {
    server.page = { data: [item(1, 'fresh item')], total: 120, totalPages: 3 };
    visit();
    expect(await screen.findByText('fresh item')).toBeTruthy();
    fireEvent.click(screen.getByText(SHOWN.next));
    fireEvent.click(screen.getByText(SHOWN.next));
    await waitFor(() => expect(itemReads().at(-1)?.get('page')).toBe('3'));
    fireEvent.click(screen.getByText(SHOWN.materials));
    await waitFor(() => expect(itemReads().at(-1)?.get('type')).toBe('raw_material'));
    expect(itemReads().at(-1)?.get('page')).toBe('1');
    fireEvent.click(screen.getByText(SHOWN.products));
    await waitFor(() => expect(itemReads().at(-1)?.get('type')).toBe('product'));
    expect(itemReads().at(-1)?.get('page')).toBe('1');
    await screen.findByText(SHOWN.pageOf('۱', '۳'));
    fireEvent.click(screen.getByText(SHOWN.next));
    await waitFor(() => expect(screen.getByText(SHOWN.pageOf('۲', '۳'))).toBeTruthy());
  });

  it('a new search reads its first page only', async () => {
    server.page = { data: [item(1, 'fresh item')], total: 120, totalPages: 3 };
    visit();
    expect(await screen.findByText('fresh item')).toBeTruthy();
    fireEvent.click(screen.getByText(SHOWN.next));
    await waitFor(() => expect(itemReads().at(-1)?.get('page')).toBe('2'));
    fireEvent.change(screen.getByPlaceholderText(SHOWN.searchBox), { target: { value: 'ring' } });
    await waitFor(() => expect(itemReads().at(-1)?.get('search')).toBe('ring'));
    expect(itemReads().filter(q => q.get('search') === 'ring').map(q => q.get('page'))).toEqual(['1']);
  });

  it('a later filter with fewer pages shows its own page count', async () => {
    server.page = { data: [item(1, 'fresh item')], total: 120, totalPages: 3 };
    visit();
    expect(await screen.findByText(SHOWN.pageOf('۱', '۳'))).toBeTruthy();
    server.page = { data: [item(2, 'one of two')], total: 60, totalPages: 2 };
    fireEvent.click(screen.getByText(SHOWN.materials));
    expect(await screen.findByText('one of two')).toBeTruthy();
    expect(screen.getByText(SHOWN.pageOf('۱', '۲'))).toBeTruthy();
  });

  it('a failed refresh keeps the page on screen and says it was not refreshed', async () => {
    const client = newClient();
    visit(client);
    expect(await screen.findByText('fresh item')).toBeTruthy();
    reads.fail = '/items';
    await act(async () => { await client.invalidateQueries({ queryKey: QUERY_KEYS.items.all }); });
    expect((await screen.findByRole('alert')).textContent).toBe('server refused the read');
    expect(screen.getByText('fresh item')).toBeTruthy();
  });

  it('an item change refreshes the page on screen', async () => {
    const client = newClient();
    visit(client);
    expect(await screen.findByText('fresh item')).toBeTruthy();
    server.page = { data: [item(2, 'changed item')], total: 1, totalPages: 1 };
    await act(async () => { await client.invalidateQueries({ queryKey: QUERY_KEYS.items.all }); });
    expect(await screen.findByText('changed item')).toBeTruthy();
  });

  it('never offers the categories an earlier visit left while it reads them again', async () => {
    const client = newClient();
    client.setQueryData(QUERY_KEYS.categories.list(undefined), [{ id: 2, name: 'stale rings', type: 'product' }], earlier());
    reads.hold = '/categories';
    visit(client);
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(screen.queryByRole('option', { name: 'stale rings' })).toBeNull();
    await act(async () => { reads.held[0]?.(server.categories); });
    expect(await screen.findByRole('option', { name: 'rings' })).toBeTruthy();
  });

  it('a failed categories read says so once', async () => {
    reads.fail = '/categories';
    visit();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(SHOWN.categoriesFailed));
    expect(await screen.findByText('fresh item')).toBeTruthy();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('makes no read of its own', () => {
    expect(ownReads('pages/GalleryPage.tsx')).toEqual([]);
  });
});
