import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import type { NewsDetail, NewsList, NewsListRow } from '../../lib/storefront/storefrontNewsContracts';

/**
 * v12 phase 10d (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): «خبرهای سایت» in the ERP: the list with each item's
 * state and day, a new item, and the editor (a body of text and gallery parts, a saved draft under its version, the
 * question before a removal, «انتشار», «برگرداندن» and «برداشتن از روی سایت» under the version, a colleague's newer
 * version beside unsaved edits), and the list a page at a time, for a holder of the manage key and of the view key alone.
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
const { NEWS_KEY } = await import('../../hooks/queries/useStorefrontNewsQueries');

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

const TEXT = { kind: 'text', background: 'white', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'متن خبر' }] }] } } as NewsDetail['draft']['sections'][number];
/** an item on the site whose saved draft differs from it: every action is open */
const CHANGED: NewsDetail = { ...DRAFT, status: 'changed', newsDate: '2026-11-20', publishedDate: '2026-11-20', draft: { ...DRAFT.draft, newsDate: '2026-11-20', sections: [TEXT] } };

function open(at: string, detail: NewsDetail = DRAFT, options: { list?: (page: number) => NewsList; acted?: (action: string) => Partial<NewsDetail> } = {}) {
  fetchJson.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    if (url.startsWith('/storefront/news?page=') && !init) return options.list ? options.list(Number(url.split('=')[1])) : { data: ROWS, total: 2, page: 1, pageSize: 50 };
    if (init?.method === 'POST' && url.startsWith(`/storefront/news/${detail.id}/`)) return { data: { ...detail, version: detail.version + 1, ...options.acted?.(url.split('/').pop() ?? '') } };
    if (url === `/storefront/news/${detail.id}` && !init) return { data: detail };
    if (init?.method === 'POST' && url === '/storefront/news') return { data: { ...DRAFT, id: 12, ...(JSON.parse(String(init.body)) as object) } };
    if (url === '/storefront/news/12' && !init) return { data: { ...DRAFT, id: 12 } };
    if (init?.method === 'PUT' && url === `/storefront/news/${detail.id}`) return { data: { ...detail, version: detail.version + 1, draft: JSON.parse(String(init.body)) as NewsDetail['draft'] } };
    if (init?.method === 'DELETE') return { success: true };
    throw new Error(`unexpected call ${init?.method ?? 'GET'} ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[at]}><StorefrontNewsPage /></MemoryRouter></QueryClientProvider>);
  return client;
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

  it('publishes, reverts and takes an item off the site under the version it read, each to its own address', async () => {
    permissions.current = ['site_content.view', 'site_content.manage'];
    const press: Record<string, () => void> = {
      publish: () => fireEvent.click(screen.getByRole('button', { name: 'انتشار روی سایت' })),
      revert: () => {
        fireEvent.click(screen.getByRole('button', { name: 'برگرداندن به نسخهٔ روی سایت' }));
        fireEvent.click(within(screen.getByRole('group', { name: 'تأیید این کار' })).getByRole('button', { name: 'بله، انجام شود' }));
      },
      unpublish: () => {
        fireEvent.click(screen.getByRole('button', { name: 'برداشتن از روی سایت' }));
        expect(calls('POST')).toHaveLength(0);
        fireEvent.click(within(screen.getByRole('group', { name: 'تأیید این کار' })).getByRole('button', { name: 'بله، انجام شود' }));
      },
    };
    for (const action of ['publish', 'revert', 'unpublish']) {
      open('/site-news?item=5', CHANGED, { acted: () => ({ scheduled: action === 'publish' }) });
      await screen.findByLabelText('عنوان خبر');
      press[action]();
      await waitFor(() => expect(calls('POST'), action).toHaveLength(1));
      expect(calls('POST')[0][0], action).toBe(`/storefront/news/5/${action}`);
      expect(JSON.parse(String(calls('POST')[0][1]?.body)), action).toEqual({ version: 2 });
      cleanup();
      fetchJson.mockReset();
    }
    // an item published under a day to come is said to be waiting, not on the site
    expect(vi.mocked(toast.success).mock.calls.map(call => String(call[0]))).toContain('خبر منتشر شد و در روز خودش روی سایت می‌آید.');
  });

  it('holds unsaved edits against an action while they are unsaved, and shows the day the item has on the site', async () => {
    permissions.current = ['site_content.view', 'site_content.manage'];
    open('/site-news?item=5', CHANGED);
    fireEvent.change(await screen.findByLabelText('عنوان خبر'), { target: { value: 'عنوان دیگر' } });
    expect((screen.getByRole('button', { name: 'انتشار روی سایت' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'برگرداندن به نسخهٔ روی سایت' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'برداشتن از روی سایت' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/تاریخ این خبر روی سایت/)).toBeNull();
    fireEvent.change(document.querySelector('[data-date]') as HTMLInputElement, { target: { value: '2026-12-01' } });
    expect(screen.getByText(/تاریخ این خبر روی سایت/).textContent).toMatch(/۱۴۰۵/);
  });

  it('never lets a colleague\'s newer version overwrite unsaved edits, also after an action of its own that changed nothing', async () => {
    permissions.current = ['site_content.view', 'site_content.manage'];
    // «انتشار» that changes nothing answers with the version as it was
    const client = open('/site-news?item=5', CHANGED, { acted: () => ({ version: 2 }) });
    const title = await screen.findByLabelText('عنوان خبر') as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: 'انتشار روی سایت' }));
    await waitFor(() => expect(calls('POST')).toHaveLength(1));
    await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalled());
    fireEvent.change(title, { target: { value: 'ویرایش من' } });
    client.setQueryData([...NEWS_KEY, 'detail', 5], { ...CHANGED, version: 3, title: 'عنوان همکار', draft: { ...CHANGED.draft, title: 'عنوان همکار' } });
    const banner = await screen.findByText(/همکار دیگری این خبر را در همین فاصله عوض کرده است/);
    expect(title.value).toBe('ویرایش من');
    expect((screen.getByRole('button', { name: 'ذخیرهٔ پیش‌نویس' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(banner.closest('[role="alert"]') as HTMLElement).getByRole('button'));
    await waitFor(() => expect(title.value).toBe('عنوان همکار'));
    expect(screen.queryByText(/همکار دیگری این خبر را/)).toBeNull();
  });

  it('reads the list a page at a time from the server, and goes to the last page when the one shown has ended', async () => {
    permissions.current = ['site_content.view'];
    // 120 items; the third page has just lost its items to a colleague's removals
    let total = 120;
    open('/site-news', DRAFT, {
      list: (page) => {
        if (page === 3) total = 100;
        return { data: page === 3 ? [] : [row({ id: page, title: `خبر صفحهٔ ${page}` })], total, page, pageSize: 50 };
      },
    });
    await screen.findByText('خبر صفحهٔ 1');
    const pager = within(screen.getByRole('navigation', { name: 'صفحه‌های فهرست خبرها' }));
    expect(pager.getByText('صفحهٔ ۱ از ۳')).toBeTruthy();
    expect((pager.getByRole('button', { name: 'قبلی' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(pager.getByRole('button', { name: 'بعدی' }));
    await screen.findByText('خبر صفحهٔ 2');
    fireEvent.click(within(screen.getByRole('navigation', { name: 'صفحه‌های فهرست خبرها' })).getByRole('button', { name: 'بعدی' }));
    // page three is empty and the list now has two pages: the screen shows the second, not «هنوز خبری ساخته نشده است»
    await waitFor(() => expect(within(screen.getByRole('navigation', { name: 'صفحه‌های فهرست خبرها' })).getByText('صفحهٔ ۲ از ۲')).toBeTruthy());
    expect(await screen.findByText('خبر صفحهٔ 2')).toBeTruthy();
    expect(screen.queryByText('هنوز خبری ساخته نشده است.')).toBeNull();
    expect((fetchJson.mock.calls as Call[]).map(([url]) => url).filter(url => url.includes('?page='))).toEqual(expect.arrayContaining(['/storefront/news?page=1', '/storefront/news?page=2', '/storefront/news?page=3']));
  });
});
