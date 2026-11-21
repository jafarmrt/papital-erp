import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PageDetail, PageListRow } from '../../lib/storefront/storefrontPageContracts';
import type { RichDoc } from '../../lib/storefront/storefrontPageRules';

/**
 * v12 phase 10b (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): the page builder of the ERP: the list with the five
 * base pages, a new page from a template, the sections of a page (added, filled, moved, removed), a draft saved under
 * its version, publishing only a saved and finished draft, and a view-only holder.
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
// the editor's own behaviour is its library's; here it is a plain field that reports a document
vi.mock('../../components/storefront/pages/RichTextEditor', () => ({
  default: ({ label, value, disabled, onChange }: { label: string; value: RichDoc; disabled: boolean; onChange: (doc: RichDoc) => void }) => (
    <textarea aria-label={`ویرایشگر ${label}`} disabled={disabled} defaultValue={JSON.stringify(value)}
      onChange={e => onChange({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: e.target.value }] }] })} />
  ),
}));

const StorefrontPagesPage = (await import('../../pages/StorefrontPagesPage')).default;
const { canOpenPage } = await import('../../lib/permissions/pageAccess');
const { getMenuGroups } = await import('../../components/layout/menuConfig');

const row = (over: Partial<PageListRow>): PageListRow => ({
  id: 1, kind: 'base', slug: 'about', title: 'درباره ما', status: 'draft', publishedAt: '', updatedAt: '2026-11-21 10:00:00', updatedBy: '', version: 1, ...over,
});
const LIST: PageListRow[] = [row({}), row({ id: 2, slug: 'contact', title: 'تماس با ما' }), row({ id: 9, kind: 'custom', slug: 'our-story', title: 'داستان ما', status: 'changed', version: 4 })];
const detailOf = (over: Partial<PageDetail> = {}): PageDetail => ({
  ...row({ id: 9, kind: 'custom', slug: 'our-story', title: 'داستان ما', version: 4 }),
  draft: { title: 'داستان ما', slug: 'our-story', seoTitle: '', seoDescription: '', noindex: false, shareImageAssetId: null, sections: [{ kind: 'button', background: 'white', label: 'خرید', href: '/products' }] },
  assets: [], ...over,
});

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  permissions.current = [];
});

type Call = [string, { method?: string; body?: string } | undefined];
const calls = (method: string) => (fetchJson.mock.calls as Call[]).filter(([, init]) => init?.method === method);

function open(address: string, first = detailOf()) {
  // the mock keeps what was saved, as the server does: a read after a save returns the saved page
  let detail = first;
  fetchJson.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    if (url === '/storefront/pages' && !init) return { data: LIST };
    if (url === '/storefront/menus/link-options') return { data: { categories: [], collections: ['نمونه'], campaigns: [], products: [{ itemId: 3, name: 'گردنبند نمونه', sku: 'N-1' }] } };
    if (url === `/storefront/pages/${detail.id}` && !init) return { data: detail };
    if (url === '/storefront/pages' && init?.method === 'POST') return { data: detailOf({ id: 12, title: JSON.parse(init.body ?? '{}').title }) };
    if (url === '/storefront/pages/12' && !init) return { data: detailOf({ id: 12 }) };
    if (init?.method === 'PUT') {
      detail = { ...detail, version: detail.version + 1, draft: (({ version: _v, ...draft }) => draft)(JSON.parse(init.body ?? '{}')) };
      return { data: detail };
    }
    if (init?.method === 'POST') {
      detail = { ...detail, version: detail.version + 1, status: 'published' };
      return { data: detail };
    }
    throw new Error(`unexpected call ${init?.method ?? 'GET'} ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[address]}><StorefrontPagesPage /></MemoryRouter></QueryClientProvider>);
  return {
    /** another colleague saves the page, and this screen reads it again (as it does when its window comes back into view) */
    changedElsewhere: async (title: string) => {
      detail = { ...detail, version: detail.version + 1, title, draft: { ...detail.draft, title } };
      await client.invalidateQueries();
    },
  };
}

describe('the site pages screen', () => {
  it('is opened by site_content.view and listed in the site shop group of the sidebar', () => {
    expect(canOpenPage('/site-pages', { permissions: ['site_content.view'] })).toBe(true);
    expect(canOpenPage('/site-pages', { permissions: ['storefront.view', 'storefront.manage'] })).toBe(false);
    const groups = getMenuGroups({ id: 3, username: 'u3', full_name: 'x', role: 'r' }, { permissions: ['site_content.view'], isAdmin: false });
    const paths = groups.flatMap(group => group.items.filter(item => item.visible).map(item => item.path));
    expect(paths).toContain('/site-pages');
  });

  it('lists the pages with their address on the site and their state, and makes a new page from a template', async () => {
    permissions.current = ['site_content.view', 'site_content.manage'];
    open('/site-pages');
    const list = await screen.findByRole('list', { name: 'صفحه‌ها' });
    const items = await within(list).findAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('/about');
    expect(items[0].textContent).toContain('صفحهٔ پایه');
    expect(items[0].textContent).toContain('پیش‌نویس');
    expect(items[2].textContent).toContain('/pages/our-story');
    expect(items[2].textContent).toContain('روی سایت، با تغییر منتشرنشده');

    const form = screen.getByRole('form', { name: 'صفحهٔ تازه' });
    const make = within(form).getByRole('button', { name: 'ساختن صفحه' }) as HTMLButtonElement;
    expect(make.disabled).toBe(true);
    fireEvent.change(within(form).getByLabelText('عنوان صفحه'), { target: { value: 'کارگاه ما' } });
    fireEvent.change(within(form).getByLabelText('نشانی لاتین'), { target: { value: 'Our Workshop' } });
    // the shared rule names the problem before any request
    expect(within(form).getByRole('alert').textContent).toContain('حرف کوچک انگلیسی');
    expect(make.disabled).toBe(true);
    fireEvent.change(within(form).getByLabelText('نشانی لاتین'), { target: { value: 'our-workshop' } });
    fireEvent.change(within(form).getByLabelText('شروع از الگو'), { target: { value: 'about' } });
    fireEvent.click(make);
    await waitFor(() => expect(calls('POST')).toHaveLength(1));
    expect(JSON.parse(calls('POST')[0][1]!.body!)).toEqual({ title: 'کارگاه ما', slug: 'our-workshop', template: 'about' });
    // the new page opens in the builder
    expect(await screen.findByRole('button', { name: 'همهٔ صفحه‌ها' })).toBeTruthy();
  });

  it('builds a page from sections and saves the draft under its version; publishing waits for a saved draft', async () => {
    permissions.current = ['site_content.view', 'site_content.manage'];
    open('/site-pages?page=9');
    const save = await screen.findByRole('button', { name: 'ذخیرهٔ پیش‌نویس' }) as HTMLButtonElement;
    const publish = screen.getByRole('button', { name: 'انتشار روی سایت' }) as HTMLButtonElement;
    // nothing changed yet: nothing to save, and the saved draft is finished, so it can be published
    expect(save.disabled).toBe(true);
    expect(publish.disabled).toBe(false);

    fireEvent.change(screen.getByLabelText('بخش تازه'), { target: { value: 'hero' } });
    fireEvent.click(screen.getByRole('button', { name: 'افزودن بخش' }));
    const sections = () => within(screen.getByRole('region', { name: 'بخش‌های صفحه' })).getAllByRole('listitem').filter(li => li.getAttribute('aria-label')?.startsWith('بخش '));
    expect(sections().map(li => li.getAttribute('aria-label'))).toEqual(['بخش ۱، دکمه', 'بخش ۲، سربرگ']);
    fireEvent.change(within(sections()[1]).getByLabelText('عنوان'), { target: { value: 'داستان کارگاه' } });
    fireEvent.click(screen.getByRole('button', { name: 'بخش ۲، سربرگ: بالا' }));
    expect(sections().map(li => li.getAttribute('aria-label'))).toEqual(['بخش ۱، سربرگ', 'بخش ۲، دکمه']);
    // an unsaved change turns publishing off and says why
    expect(publish.disabled).toBe(true);
    expect(screen.getByText(/هنوز ذخیره نشده‌اند/)).toBeTruthy();

    // a link of another kind is named by the shared rule and keeps the save off
    fireEvent.change(within(sections()[1]).getByLabelText('پیوند دکمه'), { target: { value: 'javascript:alert(1)' } });
    expect(screen.getByRole('alert').textContent).toMatch(/^بخش ۲: /);
    expect(save.disabled).toBe(true);
    fireEvent.change(within(sections()[1]).getByLabelText('پیوند دکمه'), { target: { value: '/products' } });
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.click(save);
    await waitFor(() => expect(calls('PUT')).toHaveLength(1));
    const [url, init] = calls('PUT')[0];
    expect(url).toBe('/storefront/pages/9');
    const body = JSON.parse(init!.body!);
    expect(body.version).toBe(4);
    expect(body.sections.map((s: { kind: string }) => s.kind)).toEqual(['hero', 'button']);
    expect(body.sections[0]).toMatchObject({ kind: 'hero', background: 'brand', title: 'داستان کارگاه', imageAssetId: null });
    // the saved draft comes back: the form is clean again and publishing is on
    await waitFor(() => expect(publish.disabled).toBe(false));
    fireEvent.click(publish);
    await waitFor(() => expect(calls('POST')).toHaveLength(1));
    expect(calls('POST')[0][0]).toBe('/storefront/pages/9/publish');
    expect(JSON.parse(calls('POST')[0][1]!.body!)).toEqual({ version: 5 });
  });

  it('never overwrites unsaved edits with a colleague\'s newer copy: it says so and waits for a choice', async () => {
    permissions.current = ['site_content.view', 'site_content.manage'];
    const server = open('/site-pages?page=9');
    const title = await screen.findByLabelText('عنوان صفحه') as HTMLInputElement;
    // nothing unsaved: a newer copy simply replaces the screen's
    await server.changedElsewhere('عنوان همکار');
    await waitFor(() => expect(title.value).toBe('عنوان همکار'));
    expect(screen.queryByRole('alert')).toBeNull();
    // unsaved edits: the newer copy waits, and neither a save nor a publish can go out on the old version
    fireEvent.change(title, { target: { value: 'عنوان من' } });
    await server.changedElsewhere('عنوان دوم همکار');
    const notice = await screen.findByRole('alert');
    expect(notice.textContent).toContain('همکار دیگری این صفحه را');
    expect(title.value).toBe('عنوان من');
    expect((screen.getByRole('button', { name: 'ذخیرهٔ پیش‌نویس' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'انتشار روی سایت' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(notice).getByRole('button', { name: 'خواندن نسخهٔ تازه و دور ریختن تغییرهای من' }));
    await waitFor(() => expect(title.value).toBe('عنوان دوم همکار'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(calls('PUT')).toHaveLength(0);
  });

  it('says what a saved draft still needs before it can be published', async () => {
    permissions.current = ['site_content.view', 'site_content.manage'];
    const unfinished = detailOf();
    unfinished.draft.sections = [{ kind: 'gallery', background: 'white', title: '', images: [] }];
    open('/site-pages?page=9', unfinished);
    const publish = await screen.findByRole('button', { name: 'انتشار روی سایت' }) as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
    expect(screen.getByText(/^برای انتشار: بخش ۱، گالری دست‌کم ۲ عکس می‌خواهد\.$/)).toBeTruthy();
  });

  it('asks before throwing a draft away, taking a page off the site or removing it, and never removes a base page', async () => {
    permissions.current = ['site_content.view', 'site_content.manage'];
    open('/site-pages?page=9', detailOf({ status: 'changed' }));
    fireEvent.click(await screen.findByRole('button', { name: 'برداشتن از روی سایت' }));
    expect(calls('POST')).toHaveLength(0);
    const ask = screen.getByRole('group', { name: 'تأیید این کار' });
    expect(ask.textContent).toContain('«پیدا نشد»');
    fireEvent.click(within(ask).getByRole('button', { name: 'انصراف' }));
    expect(screen.queryByRole('group', { name: 'تأیید این کار' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'برگرداندن به نسخهٔ روی سایت' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'تأیید این کار' })).getByRole('button', { name: 'بله، انجام شود' }));
    await waitFor(() => expect(calls('POST')).toHaveLength(1));
    expect(calls('POST')[0][0]).toBe('/storefront/pages/9/revert');
    expect(screen.getByRole('button', { name: 'حذف صفحه' })).toBeTruthy();
    cleanup();
    fetchJson.mockReset();
    open('/site-pages?page=1', { ...detailOf(), id: 1, kind: 'base', slug: 'about', title: 'درباره ما', draft: { ...detailOf().draft, slug: 'about', title: 'درباره ما' } });
    await screen.findByRole('button', { name: 'ذخیرهٔ پیش‌نویس' });
    expect(screen.queryByRole('button', { name: 'حذف صفحه' })).toBeNull();
    expect((screen.getByLabelText('نشانی لاتین') as HTMLInputElement).disabled).toBe(true);
  });

  it('shows a page without any way to change it to a holder of the view key', async () => {
    permissions.current = ['site_content.view'];
    open('/site-pages?page=9');
    const title = await screen.findByLabelText('عنوان صفحه') as HTMLInputElement;
    expect(title.value).toBe('داستان ما');
    expect(title.matches(':disabled')).toBe(true);
    for (const name of ['ذخیرهٔ پیش‌نویس', 'انتشار روی سایت', 'افزودن بخش', 'حذف صفحه']) expect(screen.queryByRole('button', { name })).toBeNull();
    cleanup();
    open('/site-pages');
    expect(await screen.findAllByRole('button', { name: /^دیدن / })).toHaveLength(3);
    expect(screen.queryByRole('form', { name: 'صفحهٔ تازه' })).toBeNull();
  });
});
