import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import type { CollectionTextList, CollectionTextRow } from '../../lib/storefront/storefrontCollectionContracts';

/**
 * v12 phase 10e (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): «کالکشن‌های سایت» in the ERP: the collections of the
 * site with what each has, the form of one (introduction, image with its alternative text, «آشنایی بیشتر»), a save
 * under the version the form read, a colleague's newer version beside unsaved edits, and the screen for a holder of
 * the view key alone.
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

const StorefrontCollectionsPage = (await import('../../pages/StorefrontCollectionsPage')).default;
const { COLLECTIONS_KEY } = await import('../../hooks/queries/useStorefrontCollectionQueries');

const row = (over: Partial<CollectionTextRow>): CollectionTextRow => ({
  name: 'کاشی', intro: '', imageAssetId: null, imageAlt: '', morePageId: null, count: 4, imageTitle: '', imageUsable: false, morePageTitle: '', morePageLive: false,
  version: 0, updatedAt: '', updatedBy: '', ...over,
});
const WRITTEN = row({ name: 'فیروزه', intro: 'سنگ نیشابور', imageAssetId: 31, imageAlt: 'انگشتر فیروزه', morePageId: 8, imageTitle: 'عکس فیروزه', imageUsable: true, morePageTitle: 'داستان فیروزه', morePageLive: true, version: 3, count: 2 });
/** what the server says when it refuses a save, and when the list cannot be read */
const REFUSED = 'این کالکشن روی سایت کالایی ندارد.';
const UNREAD = 'خواندن نشد';
const PAGES = [{ id: 8, title: 'داستان فیروزه', live: true }, { id: 9, title: 'راهنمای نگهداری', live: false }];
const LIST: CollectionTextList = { data: [row({}), WRITTEN, row({ name: 'قدیمی', intro: 'متنی که مانده', count: 0, version: 1 })], pages: PAGES };

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  permissions.current = [];
});

type Call = [string, { method?: string; body?: string } | undefined];
const puts = () => (fetchJson.mock.calls as Call[]).filter(([, init]) => init?.method === 'PUT').map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);

function open(options: { list?: () => CollectionTextList; save?: (body: Record<string, unknown>) => Promise<{ data: CollectionTextRow }> | { data: CollectionTextRow } } = {}) {
  fetchJson.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    if (url === '/storefront/collections' && !init) return options.list ? options.list() : LIST;
    if (url === '/storefront/collections' && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      if (options.save) return options.save(body);
      const before = LIST.data.find(r => r.name === body.name) ?? row({});
      return { data: { ...before, ...body, version: Number(body.version) + 1 } as CollectionTextRow };
    }
    throw new Error(`unexpected call ${init?.method ?? 'GET'} ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><StorefrontCollectionsPage /></QueryClientProvider>);
  return client;
}
const openRow = async (name: string) => {
  const list = await screen.findByRole('list', { name: 'کالکشن‌ها' });
  const item = within(list).getAllByRole('listitem').find(li => within(li).queryByText(name)) as HTMLElement;
  fireEvent.click(within(item).getByRole('button', { expanded: false }));
  return within(item).getByRole('form', { name: `متن و تصویر کالکشن ${name}` });
};

describe('the screen of the collections of the site', () => {
  it('lists each collection with how many items it has on the site and whether it has words', async () => {
    permissions.current = ['site_content.manage'];
    open();
    const items = within(await screen.findByRole('list', { name: 'کالکشن‌ها' })).getAllByRole('listitem');
    expect(items.map(li => li.textContent)).toEqual([
      expect.stringMatching(/^کاشی۴ کالا روی سایتبی متن و تصویر/), expect.stringMatching(/^فیروزه۲ کالا روی سایتمتن یا تصویر دارد/), expect.stringMatching(/^قدیمیاکنون کالایی روی سایت نداردمتن یا تصویر دارد/),
    ]);
    // no form is open until a collection is chosen
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('saves the first words of a collection under version 0 and then goes on from the version the server gave', async () => {
    permissions.current = ['site_content.manage'];
    open();
    const form = await openRow('کاشی');
    const save = within(form).getByRole('button', { name: 'ذخیره' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(within(form).getByLabelText('متن معرفی (اختیاری)'), { target: { value: 'نقش کاشی هفت‌رنگ' } });
    fireEvent.change(within(form).getByLabelText('پیوند «آشنایی بیشتر» (اختیاری)'), { target: { value: '9' } });
    expect(within(form).getByRole('option', { name: 'راهنمای نگهداری (اکنون روی سایت نیست)' })).toBeTruthy();
    // no image: no alternative text to write
    expect(within(form).queryByLabelText('متن جایگزین تصویر (اختیاری)')).toBeNull();
    fireEvent.click(save);
    await waitFor(() => expect(puts()).toEqual([{ name: 'کاشی', intro: 'نقش کاشی هفت‌رنگ', imageAssetId: null, imageAlt: '', morePageId: 9, version: 0 }]));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('متن و تصویر کالکشن «کاشی» ذخیره شد.'));
    await waitFor(() => expect(save.disabled).toBe(true));
    fireEvent.change(within(form).getByLabelText('متن معرفی (اختیاری)'), { target: { value: 'متن دوم' } });
    fireEvent.submit(form);
    // the list read again after the save may still be the older copy (it began before the save landed): the form keeps its own
    await waitFor(() => expect(puts()[1]).toMatchObject({ intro: 'متن دوم', version: 1 }));
    expect(within(form).queryByText(/همکار دیگری/)).toBeNull();
  });

  it('shows what a collection has, drops the alternative text with the image, and refuses a text past its length before sending', async () => {
    permissions.current = ['site_content.manage', 'media.view'];
    open();
    const form = await openRow('فیروزه');
    expect((within(form).getByLabelText('متن معرفی (اختیاری)') as HTMLTextAreaElement).value).toBe('سنگ نیشابور');
    expect(within(form).getByText('عکس فیروزه')).toBeTruthy();
    expect((within(form).getByLabelText('متن جایگزین تصویر (اختیاری)') as HTMLInputElement).value).toBe('انگشتر فیروزه');
    expect((within(form).getByLabelText('پیوند «آشنایی بیشتر» (اختیاری)') as HTMLSelectElement).value).toBe('8');
    fireEvent.change(within(form).getByLabelText('متن معرفی (اختیاری)'), { target: { value: 'ب'.repeat(1501) } });
    expect(within(form).getByRole('alert').textContent).toContain('حداکثر');
    expect((within(form).getByRole('button', { name: 'ذخیره' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(form);
    fireEvent.change(within(form).getByLabelText('متن معرفی (اختیاری)'), { target: { value: 'سنگ نیشابور' } });
    fireEvent.click(within(form).getByRole('button', { name: 'برداشتن تصویر کالکشن (اختیاری)' }));
    expect(within(form).queryByLabelText('متن جایگزین تصویر (اختیاری)')).toBeNull();
    fireEvent.click(within(form).getByRole('button', { name: 'ذخیره' }));
    await waitFor(() => expect(puts()).toEqual([{ name: 'فیروزه', intro: 'سنگ نیشابور', imageAssetId: null, imageAlt: '', morePageId: 8, version: 3 }]));
  });

  it('tells of an image that left the library and of a page that was removed', async () => {
    permissions.current = ['site_content.manage'];
    open({ list: () => ({ data: [{ ...WRITTEN, imageUsable: false, morePageId: 77, morePageTitle: '' }], pages: PAGES }) });
    const form = await openRow('فیروزه');
    expect(within(form).getByText(/این عکس دیگر در کتابخانهٔ تصاویر نیست/)).toBeTruthy();
    expect(within(form).getByRole('option', { name: 'صفحه‌ای که حذف شده است' })).toBeTruthy();
    // without «مشاهده کتابخانه تصاویر» a new image cannot be chosen, and the form says so
    expect(within(form).getByText(/دسترسی «مشاهده کتابخانه تصاویر» لازم است/)).toBeTruthy();
    expect(within(form).queryByRole('button', { name: /کتابخانهٔ تصاویر/ })).toBeNull();
  });

  it('keeps unsaved edits when a colleague saves first, says so, and sends nothing until the newer copy is read', async () => {
    permissions.current = ['site_content.manage'];
    let served = LIST;
    const client = open({ list: () => served });
    const form = await openRow('فیروزه');
    const intro = within(form).getByLabelText('متن معرفی (اختیاری)') as HTMLTextAreaElement;
    fireEvent.change(intro, { target: { value: 'نوشتهٔ من' } });
    served = { ...LIST, data: LIST.data.map(r => (r.name === 'فیروزه' ? { ...r, intro: 'نوشتهٔ همکار', version: 4 } : r)) };
    await client.invalidateQueries({ queryKey: COLLECTIONS_KEY });
    await within(form).findByText(/همکار دیگری متن این کالکشن را در همین فاصله عوض کرده است/);
    expect(intro.value).toBe('نوشتهٔ من');
    expect((within(form).getByRole('button', { name: 'ذخیره' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(form);
    expect(puts()).toEqual([]);
    fireEvent.click(within(form).getByRole('button', { name: 'خواندن نسخهٔ تازه و دور ریختن تغییرهای من' }));
    expect(intro.value).toBe('نوشتهٔ همکار');
    fireEvent.change(intro, { target: { value: 'نوشتهٔ من روی نسخهٔ تازه' } });
    fireEvent.click(within(form).getByRole('button', { name: 'ذخیره' }));
    await waitFor(() => expect(puts()).toEqual([expect.objectContaining({ intro: 'نوشتهٔ من روی نسخهٔ تازه', version: 4 })]));
  });

  it('takes a colleague\'s newer copy at once while nothing here is unsaved, and tells of a refused save', async () => {
    permissions.current = ['site_content.manage'];
    let served = LIST;
    const client = open({ list: () => served, save: () => Promise.reject(new Error(REFUSED)) });
    const form = await openRow('فیروزه');
    served = { ...LIST, data: LIST.data.map(r => (r.name === 'فیروزه' ? { ...r, intro: 'نوشتهٔ همکار', version: 4 } : r)) };
    await client.invalidateQueries({ queryKey: COLLECTIONS_KEY });
    await waitFor(() => expect((within(form).getByLabelText('متن معرفی (اختیاری)') as HTMLTextAreaElement).value).toBe('نوشتهٔ همکار'));
    expect(within(form).queryByText(/همکار دیگری/)).toBeNull();
    fireEvent.change(within(form).getByLabelText('متن معرفی (اختیاری)'), { target: { value: 'تلاش' } });
    fireEvent.click(within(form).getByRole('button', { name: 'ذخیره' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(REFUSED));
    // the edit is still in the form, to try again
    expect((within(form).getByLabelText('متن معرفی (اختیاری)') as HTMLTextAreaElement).value).toBe('تلاش');
  });

  it('shows everything and changes nothing for a holder of the view key alone', async () => {
    permissions.current = [];
    open();
    expect(await screen.findByText(/شما فقط می‌توانید ببینید/)).toBeTruthy();
    const form = await openRow('فیروزه');
    expect((form.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
    expect(within(form).queryByRole('button', { name: 'ذخیره' })).toBeNull();
    fireEvent.submit(form);
    expect(puts()).toEqual([]);
  });

  it('says so when no collection has an item on the site, and when the list cannot be read', async () => {
    permissions.current = ['site_content.manage'];
    open({ list: () => ({ data: [], pages: [] }) });
    expect(await screen.findByText('هنوز هیچ کالکشنی کالایی روی سایت ندارد.')).toBeTruthy();
    cleanup();
    open({ list: () => { throw new Error(UNREAD); } });
    expect(await screen.findByText(UNREAD)).toBeTruthy();
  });
});
