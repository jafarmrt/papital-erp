import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NewsDetail, NewsListRow } from '../../lib/storefront/storefrontNewsContracts';

/**
 * v12 phase 10d (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): «خبرهای سایت» in the ERP: the list with each item's
 * state and day, a new item, and the editor (a body of text and gallery parts, a saved draft under its version, the
 * question before a removal), for a holder of the manage key and of the view key alone.
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
vi.mock('../../components/common/JalaliDateInput', () => ({
  JalaliDateInput: ({ id, value, onChange }: { id?: string; value: string; onChange: (iso: string) => void }) => <input id={id} data-date value={value} onChange={e => onChange(e.target.value)} />,
}));

const StorefrontNewsPage = (await import('../../pages/StorefrontNewsPage')).default;

const row = (over: Partial<NewsListRow>): NewsListRow => ({
  id: 5, slug: 'new-collection', title: 'کالکشن تازه رسید', status: 'draft', newsDate: '', publishedDate: '', scheduled: false, updatedAt: '2026-11-23 10:00:00', updatedBy: '', version: 2, ...over,
});
const DRAFT: NewsDetail = {
  ...row({}),
  draft: { title: 'کالکشن تازه رسید', slug: 'new-collection', summary: '', coverAssetId: null, newsDate: '', seoTitle: '', seoDescription: '', sections: [] },
  assets: [],
};
const ROWS = [DRAFT, row({ id: 6, slug: 'yalda', title: 'یلدا در گالری', status: 'published', newsDate: '2026-12-20', publishedDate: '2026-12-20', scheduled: true })];

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  permissions.current = [];
});

type Call = [string, { method?: string; body?: string } | undefined];
const calls = (method: string) => (fetchJson.mock.calls as Call[]).filter(([, init]) => init?.method === method);

function open(at: string, detail: NewsDetail = DRAFT) {
  fetchJson.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    if (url.startsWith('/storefront/news?page=') && !init) return { data: ROWS, total: 2, page: 1, pageSize: 50 };
    if (url === `/storefront/news/${detail.id}` && !init) return { data: detail };
    if (init?.method === 'POST' && url === '/storefront/news') return { data: { ...DRAFT, id: 12, ...(JSON.parse(String(init.body)) as object) } };
    if (url === '/storefront/news/12' && !init) return { data: { ...DRAFT, id: 12 } };
    if (init?.method === 'PUT' && url === `/storefront/news/${detail.id}`) return { data: { ...detail, version: detail.version + 1, draft: JSON.parse(String(init.body)) as NewsDetail['draft'] } };
    if (init?.method === 'DELETE') return { success: true };
    throw new Error(`unexpected call ${init?.method ?? 'GET'} ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[at]}><StorefrontNewsPage /></MemoryRouter></QueryClientProvider>);
}

describe('the news of the site in the ERP', () => {
  it('lists the items with their address, day and state, and marks one waiting for its day', async () => {
    permissions.current = ['site_content.view', 'site_content.manage'];
    open('/site-news');
    await screen.findByText('یلدا در گالری');
    const rows = within(screen.getByRole('list', { name: 'خبرها' })).getAllByRole('listitem');
    expect(rows[0].textContent).toContain('/news/new-collection');
    expect(rows[0].textContent).not.toContain('در نوبت انتشار');
    expect(rows[1].textContent).toContain('/news/yalda');
    expect(rows[1].textContent).toContain('در نوبت انتشار');
    // the day is shown in the Persian calendar (20 December 2026)
    expect(rows[1].textContent).toMatch(/۱۴۰۵/);
    expect(within(rows[0]).getByRole('button', { name: 'ویرایش کالکشن تازه رسید' })).toBeTruthy();
  });

  it('makes a new item from a title and an address, refusing a bad address before it is sent', async () => {
    permissions.current = ['site_content.view', 'site_content.manage'];
    open('/site-news');
    const form = within(await screen.findByRole('form', { name: 'خبر تازه' }));
    const make = form.getByRole('button', { name: 'ساختن خبر' }) as HTMLButtonElement;
    fireEvent.change(form.getByLabelText('عنوان خبر'), { target: { value: 'رونمایی' } });
    fireEvent.change(form.getByLabelText('نشانی لاتین'), { target: { value: 'Bad Address' } });
    expect(form.getByRole('alert').textContent).toContain('نشانی لاتین خبر');
    expect(make.disabled).toBe(true);
    fireEvent.change(form.getByLabelText('نشانی لاتین'), { target: { value: 'unveiling' } });
    fireEvent.click(make);
    await waitFor(() => expect(calls('POST')).toHaveLength(1));
    expect(JSON.parse(String(calls('POST')[0][1]?.body))).toEqual({ title: 'رونمایی', slug: 'unveiling' });
    // the new item opens in the editor
    expect(await screen.findByRole('region', { name: 'مشخصات خبر' })).toBeTruthy();
  });

  it('edits an item: text and gallery parts only, a day, a summary, and a save under the version it read', async () => {
    permissions.current = ['site_content.view', 'site_content.manage'];
    open('/site-news?item=5');
    const title = await screen.findByLabelText('عنوان خبر') as HTMLInputElement;
    expect(within(screen.getByLabelText('بخش تازه')).getAllByRole('option').map(option => option.textContent)).toEqual(['متن', 'گالری تصاویر']);
    const save = screen.getByRole('button', { name: 'ذخیرهٔ پیش‌نویس' }) as HTMLButtonElement;
    const publish = screen.getByRole('button', { name: 'انتشار روی سایت' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    // an item with no text cannot be published, and the screen says why
    expect(publish.disabled).toBe(true);
    expect(screen.getByText(/برای انتشار: خبر هنوز بخشی ندارد/)).toBeTruthy();
    fireEvent.change(title, { target: { value: 'کالکشن زمستان رسید' } });
    fireEvent.change(screen.getByLabelText('خلاصه (اختیاری)'), { target: { value: 'چند خط دربارهٔ کالکشن' } });
    fireEvent.change(document.querySelector('[data-date]') as HTMLInputElement, { target: { value: '2026-12-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'افزودن بخش' }));
    expect(within(screen.getByRole('region', { name: 'متن خبر' })).getAllByRole('listitem')).toHaveLength(1);
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(calls('PUT')).toHaveLength(1));
    const sent = JSON.parse(String(calls('PUT')[0][1]?.body)) as NewsDetail['draft'] & { version: number };
    expect(calls('PUT')[0][0]).toBe('/storefront/news/5');
    expect(sent).toMatchObject({ title: 'کالکشن زمستان رسید', slug: 'new-collection', summary: 'چند خط دربارهٔ کالکشن', newsDate: '2026-12-01', coverAssetId: null, version: 2 });
    expect(sent.sections.map(section => section.kind)).toEqual(['text']);
  });

  it('asks before a removal, with the focus on the question, and keeps the address of an item that is on the site', async () => {
    permissions.current = ['site_content.view', 'site_content.manage'];
    open('/site-news?item=5', { ...DRAFT, status: 'published', publishedDate: '2026-11-20', newsDate: '2026-11-20', draft: { ...DRAFT.draft, newsDate: '2026-11-20' } });
    await screen.findByLabelText('عنوان خبر');
    expect((screen.getByLabelText('نشانی لاتین') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'حذف خبر' }));
    const question = screen.getByRole('group', { name: 'تأیید این کار' });
    expect(question.textContent).toContain('این خبر حذف می‌شود');
    expect(document.activeElement).toBe(question);
    expect(calls('DELETE')).toHaveLength(0);
    fireEvent.click(within(question).getByRole('button', { name: 'بله، انجام شود' }));
    await waitFor(() => expect(calls('DELETE')).toHaveLength(1));
    expect(calls('DELETE')[0][0]).toBe('/storefront/news/5?version=2');
  });

  it('shows an item without any way to change it to a holder of the view key', async () => {
    permissions.current = ['site_content.view'];
    open('/site-news');
    await screen.findByText('یلدا در گالری');
    expect(screen.queryByRole('form', { name: 'خبر تازه' })).toBeNull();
    expect(screen.getByRole('button', { name: 'دیدن کالکشن تازه رسید' })).toBeTruthy();
    cleanup();
    fetchJson.mockReset();
    open('/site-news?item=5');
    const title = await screen.findByLabelText('عنوان خبر') as HTMLInputElement;
    expect(title.closest('fieldset')?.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'ذخیرهٔ پیش‌نویس' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'افزودن بخش' })).toBeNull();
  });
});
