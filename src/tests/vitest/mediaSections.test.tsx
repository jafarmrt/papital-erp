import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import {
  EMPTY_SECTION_QUERY, mediaSectionQueryFrom, mediaSectionQueryParams, movedIds, sectionIdFrom, type MediaSection,
} from '../../lib/media/mediaSectionsApi';

// v10.0.27 (N-05 PR 3): the media library's sections. The section manager is offered only to media.manage and sends the
// bodies the section routes take; a custom section and its search conditions live in the page address.

let granted = new Set<string>();
vi.mock('../../contexts/AuthContext', () => ({
  useHasPermission: (key: string) => granted.has(key),
  useHasAnyPermission: (keys: readonly string[]) => keys.some(k => granted.has(k)),
}));
const fetchJson = vi.fn();
vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  fetchJson: (...args: unknown[]) => fetchJson(...args),
}));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: vi.fn(async () => true) }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { toast: t, default: t };
});

const { default: MediaLibraryPage } = await import('../../pages/MediaLibraryPage');

const MANAGE_TEXT = 'مدیریت بخش‌ها';
const ADD_TEXT = 'افزودن بخش';
const TITLE_LABEL = 'عنوان بخش';
const PRODUCTS_TITLE = 'محصولات';
const CUSTOM_TITLE = 'تبلیغات';
const NEW_TITLE = 'نمایشگاه';
const TAG = 'بهار';

const sections: MediaSection[] = [
  { id: 1, kind: 'products', title: PRODUCTS_TITLE, description: '', sortOrder: 1, version: 1, assetCount: 10 },
  { id: 5, kind: 'custom', title: CUSTOM_TITLE, description: '', sortOrder: 2, version: 2, assetCount: 3 },
];

function answer(url: string, init?: RequestInit): unknown {
  const method = init?.method ?? 'GET';
  if (url === '/media/sections' && method === 'GET') return { data: sections };
  if (url === '/media/sections' && method === 'POST') return { success: true, data: { ...sections[1], id: 9, title: NEW_TITLE } };
  if (url === '/media/sections/order') return { success: true, data: [sections[1], sections[0]] };
  if (url.startsWith('/media/products/filters')) return { collections: [], designYears: [], transferCodes: [], categories: [] };
  if (url.startsWith('/media/products')) return { data: [], total: 0, page: 1, limit: 24 };
  if (url.startsWith('/media/tags')) return { data: [TAG] };
  if (url.startsWith('/media/assets')) return { data: [], total: 0, page: 1, limit: 60 };
  throw new Error(`unexpected request ${method} ${url}`);
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.search}</span>;
}

function renderPage(keys: string[], entry = '/media-library') {
  granted = new Set(keys);
  fetchJson.mockImplementation(async (url: string, init?: RequestInit) => answer(url, init));
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/media-library" element={<><MediaLibraryPage user={{ id: 1, username: 'ali', full_name: 'x', role: 'r' }} /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

const calls = (url: string, method: string) => fetchJson.mock.calls.filter(([u, init]) => u === url && ((init as RequestInit | undefined)?.method ?? 'GET') === method);

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

describe('media library sections', () => {
  it('shows the sections with their counts and no manager button without media.manage', async () => {
    renderPage(['media.view', 'media.upload']);
    const tabs = await screen.findByRole('tablist');
    expect(within(tabs).getByText(PRODUCTS_TITLE)).toBeTruthy();
    expect(within(tabs).getByText(CUSTOM_TITLE)).toBeTruthy();
    expect(screen.queryByText(MANAGE_TEXT)).toBeNull();
  });

  it('lets a media.manage holder add a section and move one with the full new order', async () => {
    renderPage(['media.view', 'media.manage']);
    fireEvent.click(await screen.findByText(MANAGE_TEXT));
    fireEvent.change(screen.getByLabelText(TITLE_LABEL), { target: { value: `  ${NEW_TITLE} ` } });
    fireEvent.click(screen.getByRole('button', { name: ADD_TEXT }));
    await waitFor(() => expect(calls('/media/sections', 'POST')).toHaveLength(1));
    expect(JSON.parse(String(calls('/media/sections', 'POST')[0][1].body))).toEqual({ title: NEW_TITLE, description: '' });

    const row = await screen.findByTestId('media-section-row-5');
    fireEvent.click(within(row).getByLabelText(`جابه‌جایی ${CUSTOM_TITLE} به بالا`));
    await waitFor(() => expect(calls('/media/sections/order', 'PUT')).toHaveLength(1));
    expect(JSON.parse(String(calls('/media/sections/order', 'PUT')[0][1].body))).toEqual({ ids: [5, 1] });
  });

  it('offers no edit or delete for the products section', async () => {
    renderPage(['media.view', 'media.manage']);
    fireEvent.click(await screen.findByText(MANAGE_TEXT));
    const row = screen.getByTestId('media-section-row-1');
    expect(within(row).queryByLabelText(`ویرایش ${PRODUCTS_TITLE}`)).toBeNull();
    expect(within(row).queryByLabelText(`حذف ${PRODUCTS_TITLE}`)).toBeNull();
    expect(within(screen.getByTestId('media-section-row-5')).getByLabelText(`حذف ${CUSTOM_TITLE}`)).toBeTruthy();
  });

  it('opens a custom section from the address and asks the server with its conditions', async () => {
    renderPage(['media.view'], `/media-library?section=5&tag=${encodeURIComponent(TAG)}&kind=image&page=2`);
    await waitFor(() => expect(fetchJson.mock.calls.some(([u]) => String(u).startsWith('/media/assets?'))).toBe(true));
    const url = String(fetchJson.mock.calls.find(([u]) => String(u).startsWith('/media/assets?'))?.[0]);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(Object.fromEntries(params)).toEqual({ sectionId: '5', tag: TAG, kind: 'image', page: '2', limit: '60' });
    expect(calls('/media/tags?sectionId=5', 'GET')).toHaveLength(1);
    expect(screen.queryByLabelText('بارگذاری تصویر و فیلم')).toBeNull();
  });

  it('keeps the chosen section in the address when a tab is clicked', async () => {
    renderPage(['media.view']);
    fireEvent.click(within(await screen.findByRole('tablist')).getByText(CUSTOM_TITLE));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('?section=5'));
    fireEvent.click(within(screen.getByRole('tablist')).getByText(PRODUCTS_TITLE));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(''));
  });
});

describe('media section address', () => {
  it('round-trips a section and its conditions through the query string', () => {
    const query = { search: ' poster ', tag: TAG, kind: 'video' as const, shotType: 'detail' as const, lowQuality: true, page: 3 };
    const params = mediaSectionQueryParams(7, query);
    expect(params.toString()).toBe(`section=7&search=poster&tag=${encodeURIComponent(TAG)}&kind=video&shotType=detail&lowQuality=1&page=3`);
    expect(sectionIdFrom(params)).toBe(7);
    expect(mediaSectionQueryFrom(params)).toEqual({ ...query, search: 'poster' });
  });

  it('leaves out empty conditions and ignores unknown values', () => {
    expect(mediaSectionQueryParams(2, EMPTY_SECTION_QUERY).toString()).toBe('section=2');
    const read = mediaSectionQueryFrom(new URLSearchParams('kind=pdf&shotType=nope&page=-1'));
    expect(read).toEqual(EMPTY_SECTION_QUERY);
    expect(sectionIdFrom(new URLSearchParams('section=abc'))).toBeNull();
  });

  it('moves one id a place and leaves the ends unchanged', () => {
    expect(movedIds([1, 2, 3], 3, -1)).toEqual([1, 3, 2]);
    const ids = [1, 2, 3];
    expect(movedIds(ids, 1, -1)).toBe(ids);
    expect(movedIds(ids, 3, 1)).toBe(ids);
  });
});
