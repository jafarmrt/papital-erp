import { afterEach, describe, expect, it, vi } from 'vitest';
import toast from 'react-hot-toast';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Editor } from '@tiptap/react';
import type { PageDetail } from '../../lib/storefront/storefrontPageContracts';
import type { PageSection } from '../../lib/storefront/storefrontPageRules';

/**
 * v12 phase 10b (review): the page builder with its real text editor, not a stand-in. Opening a page changes nothing; a
 * section keeps its own editor when it is moved or its neighbour is removed; a request that acts on the saved draft
 * waits for a screen with nothing unsaved.
 */
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ API_URL: '/api', fetchJson: (...args: unknown[]) => fetchJson(...(args as [])), isAbortError: () => false }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});
vi.mock('../../contexts/AuthContext', async () => {
  const actual = await vi.importActual<typeof import('../../contexts/AuthContext')>('../../contexts/AuthContext');
  return { ...actual, useHasPermission: () => true };
});

const StorefrontPagesPage = (await import('../../pages/StorefrontPagesPage')).default;
const { PAGES_KEY } = await import('../../hooks/queries/useStorefrontPageQueries');

const text = (words: string, background: PageSection['background'] = 'white'): PageSection => ({
  kind: 'text', background, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: words }] }] },
});
const detailOf = (sections: PageSection[], over: Partial<PageDetail> = {}): PageDetail => ({
  id: 9, kind: 'custom', slug: 'our-story', title: 'داستان ما', status: 'draft', publishedAt: '', updatedAt: '2026-11-21 10:00:00', updatedBy: '', version: 4,
  draft: { title: 'داستان ما', slug: 'our-story', seoTitle: '', seoDescription: '', noindex: false, shareImageAssetId: null, sections },
  menuPlaces: [], linkedCollections: [],
  assets: [], ...over,
});

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

type Call = [string, { method?: string; body?: string } | undefined];
const calls = (method: string) => (fetchJson.mock.calls as Call[]).filter(([, init]) => init?.method === method);

function open(first: PageDetail) {
  let detail = first;
  fetchJson.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    if (url === '/storefront/menus/link-options') return { data: { categories: [], collections: [], campaigns: [], products: [] } };
    if (url === '/storefront/pages' && !init) return { data: [] };
    if (url === '/storefront/pages/9' && !init) return { data: detail };
    // an action that changes nothing answers with the page as it is, its version too
    if (init?.method === 'POST' && url.startsWith('/storefront/pages/9/')) return { data: detail };
    if (init?.method === 'PUT') {
      detail = { ...detail, version: detail.version + 1, draft: (({ version: _v, ...draft }) => draft)(JSON.parse(init.body ?? '{}')) };
      return { data: detail };
    }
    throw new Error(`unexpected call ${init?.method ?? 'GET'} ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/site-pages?page=9']}><StorefrontPagesPage /></MemoryRouter></QueryClientProvider>);
  return client;
}

const sections = () => within(screen.getByRole('region', { name: 'بخش‌های صفحه' })).getAllByRole('listitem').filter(li => li.getAttribute('aria-label')?.startsWith('بخش '));
/** the live editor of a section, as Tiptap hangs it on its own element */
const editorOf = async (section: HTMLElement): Promise<Editor> => {
  const box = await within(section).findByRole('textbox');
  return (box as unknown as { editor: Editor }).editor;
};
const wordsOf = async (section: HTMLElement) => (await within(section).findByRole('textbox')).textContent;

describe('the page builder with its real text editor', () => {
  it('opens a saved page with a text as unchanged: nothing to save, and it can be published', async () => {
    open(detailOf([text('متن ذخیره‌شده')]));
    const save = await screen.findByRole('button', { name: 'ذخیرهٔ پیش‌نویس' }) as HTMLButtonElement;
    expect(await wordsOf(sections()[0])).toBe('متن ذخیره‌شده');
    // red before the review's fix: switching the editor on reported an update, the draft took the editor's own form of
    // the text, and the page looked changed for ever, so «انتشار» never came on
    await waitFor(() => expect((screen.getByRole('button', { name: 'انتشار روی سایت' }) as HTMLButtonElement).disabled).toBe(false));
    expect(save.disabled).toBe(true);
    expect(screen.queryByText(/هنوز ذخیره نشده‌اند/)).toBeNull();
    // typing and taking it back leaves the page unchanged again: the screen compares the form the server keeps
    const editor = await editorOf(sections()[0]);
    editor.commands.insertContentAt(1, 'x');
    await waitFor(() => expect(save.disabled).toBe(false));
    editor.commands.deleteRange({ from: 1, to: 2 });
    await waitFor(() => expect(save.disabled).toBe(true));
  });

  it('keeps each section\'s own text in its own editor when a section is moved, and saves what the screen shows', async () => {
    open(detailOf([text('الف الف', 'white'), text('ب ب', 'dark')]));
    await screen.findByRole('button', { name: 'ذخیرهٔ پیش‌نویس' });
    expect(await wordsOf(sections()[0])).toBe('الف الف');
    fireEvent.click(screen.getByRole('button', { name: 'بخش ۱، متن: پایین' }));
    // red before: the two boxes went on showing «الف الف», «ب ب» while the draft was already the other way round
    expect(await wordsOf(sections()[0])).toBe('ب ب');
    expect(await wordsOf(sections()[1])).toBe('الف الف');
    const moved = await editorOf(sections()[0]);
    // the edit reaches the screen's draft before the next click, as it does between two events in a browser
    await act(async () => { moved.commands.insertContentAt(1, 'تازه '); });
    fireEvent.click(screen.getByRole('button', { name: 'ذخیرهٔ پیش‌نویس' }));
    await waitFor(() => expect(calls('PUT')).toHaveLength(1));
    const saved = JSON.parse(calls('PUT')[0][1]!.body!).sections as Array<{ background: string; doc: { content: Array<{ content: Array<{ text: string }> }> } }>;
    // red before: the save carried «الف الف» twice and lost «ب ب»
    expect(saved.map(s => [s.background, s.doc.content[0].content[0].text])).toEqual([['dark', 'تازه ب ب'], ['white', 'الف الف']]);
    // the saved form holds no empty attribute of the editor's own
    expect(JSON.stringify(saved)).not.toContain('textAlign');
  });

  it('shows the text of the section that is left when its neighbour is removed', async () => {
    open(detailOf([text('الف الف'), text('ب ب')]));
    await screen.findByRole('button', { name: 'ذخیرهٔ پیش‌نویس' });
    fireEvent.click(screen.getByRole('button', { name: 'حذف بخش ۱، متن' }));
    expect(sections()).toHaveLength(1);
    // red before: the box that was left still showed «الف الف»
    expect(await wordsOf(sections()[0])).toBe('ب ب');
  });

  it('gives each text editor and each image button a name of its own', async () => {
    open(detailOf([text('یک'), { kind: 'textImage', background: 'white', title: '', doc: { type: 'doc', content: [] }, imageAssetId: null, imageAlt: '', imageSide: 'right', buttonLabel: '', buttonHref: '' }]));
    await screen.findByRole('button', { name: 'ذخیرهٔ پیش‌نویس' });
    expect(await screen.findByRole('textbox', { name: 'متن بخش ۱' })).toBeTruthy();
    expect(await screen.findByRole('textbox', { name: 'متن بخش ۲' })).toBeTruthy();
    expect(screen.getByRole('toolbar', { name: 'ابزار متن بخش ۲' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'انتخاب از کتابخانهٔ تصاویر: عکس، بخش ۲' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'انتخاب از کتابخانهٔ تصاویر: تصویر اشتراک‌گذاری (اختیاری)' })).toBeTruthy();
  });

  it('keeps unsaved edits when a page is asked to leave the site: the request waits for a saved draft', async () => {
    open(detailOf([text('متن')], { status: 'published', publishedAt: '2026-11-21 10:00:00' }));
    const title = await screen.findByLabelText('عنوان صفحه') as HTMLInputElement;
    const unpublish = screen.getByRole('button', { name: 'برداشتن از روی سایت' }) as HTMLButtonElement;
    await waitFor(() => expect(unpublish.disabled).toBe(false));
    // the address of a page on the site is not the draft's to move
    expect((screen.getByLabelText('نشانی لاتین') as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(title, { target: { value: 'عنوان ذخیره‌نشده' } });
    // red before: the button stayed on, the request went out and the answer replaced the unsaved title without a word
    expect(unpublish.disabled).toBe(true);
    expect(screen.getByText(/«برداشتن از روی سایت» پس از ذخیرهٔ پیش‌نویس روشن می‌شوند/)).toBeTruthy();
    expect(title.value).toBe('عنوان ذخیره‌نشده');
    expect(calls('POST')).toHaveLength(0);
  });

  it('never lets a colleague\'s newer version overwrite unsaved edits after an action of its own that changed nothing', async () => {
    const first = detailOf([text('متن')], { status: 'changed', publishedAt: '2026-11-21 10:00:00' });
    const client = open(first);
    const title = await screen.findByLabelText('عنوان صفحه') as HTMLInputElement;
    const publish = screen.getByRole('button', { name: 'انتشار روی سایت' }) as HTMLButtonElement;
    await waitFor(() => expect(publish.disabled).toBe(false));
    fireEvent.click(publish);
    await waitFor(() => expect(calls('POST')).toHaveLength(1));
    await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalled());
    fireEvent.change(title, { target: { value: 'ویرایش من' } });
    // red before: the screen still took the next version for its own and replaced the unsaved title without a word
    act(() => { client.setQueryData([...PAGES_KEY, 'detail', 9], { ...first, version: 5, title: 'عنوان همکار', draft: { ...first.draft, title: 'عنوان همکار' } }); });
    expect(await screen.findByText(/همکار دیگری این صفحه را در همین فاصله عوض کرده است/)).toBeTruthy();
    expect(title.value).toBe('ویرایش من');
  });
});
