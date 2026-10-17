import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { MediaAssetView, MediaProductDetail, MediaProductRow } from '../../lib/media/mediaApi';
import { MediaProductCard } from '../../components/media/MediaProductCard';

// v10.1.70: the item's own picture is the product's one featured image. The library grid card shows it (a library file
// only while the item has none), the product page shows it with the button that changes it, and the library's own cover
// button and badge are gone. Only products.edit, the item form's key, changes it, and the hint shows only while a file can
// become it.

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

const { default: MediaProductPage } = await import('../../pages/MediaProductPage');

const PRODUCT_NAME = 'گردنبند ماه';
const FEATURED_TITLE = 'تصویر شاخص محصول';
const MAKE_FEATURED = 'تصویر شاخص محصول شود';
const OLD_COVER_TEXTS = ['برداشتن تصویر شاخص'];
const EMPTY_TEXT = 'این محصول هنوز تصویر شاخص ندارد.';
const CHANGE_HINT = 'برای عوض کردن آن، زیر تصویر دلخواه روی «تصویر شاخص محصول شود» بزنید.';

function row(extra: Partial<MediaProductRow>): MediaProductRow {
  return {
    itemId: 7, code: '1404-N-101-01', name: PRODUCT_NAME, category: null, collections: [], designYear: null, transferCode: null,
    assetCount: 1, imageCount: 1, videoCount: 0, lowQualityCount: 0, featuredImage: null, fallbackAssetId: null, ...extra,
  };
}

function renderCard(r: MediaProductRow) {
  render(<MemoryRouter><MediaProductCard row={r} /></MemoryRouter>);
  return screen.queryByRole('img', { name: PRODUCT_NAME }) as HTMLImageElement | null;
}

function asset(id: number, extra: Partial<MediaAssetView> = {}): MediaAssetView {
  return {
    id, sectionId: 1, itemId: 7, kind: 'image', shotType: 'white_background', title: `file ${id}`, description: '', sortOrder: id,
    originalName: `f${id}.jpg`, mimeType: 'image/jpeg', sizeBytes: 2_000_000, width: 2000, height: 2000, durationSeconds: null,
    isLowQuality: false, hasLight: true, hasThumb: true, lightFailed: false, createdBy: 'ali', createdAt: null, version: 1, warnings: [], tags: [], ...extra,
  };
}

function detail(featured: MediaProductDetail['featuredImage'], assets: MediaAssetView[] = [asset(1)]): MediaProductDetail {
  return {
    item: {
      id: 7, code: '1404-N-101-01', name: PRODUCT_NAME, category: null, unit: null, color: null, material: null, size: null,
      weight: null, collections: [], designYear: null, transferCode: null, productDescription: null, technicalNotes: null, version: 3,
    },
    featuredImage: featured,
    assets,
    productsSectionId: 1,
  };
}

async function renderPage(keys: string[], featured: MediaProductDetail['featuredImage'], assets?: MediaAssetView[]) {
  granted = new Set(keys);
  fetchJson.mockImplementation(async (url: string) => {
    if (url === '/media/products/7') return detail(featured, assets);
    if (url === '/media/assets/1/item-image') return { success: true, data: { itemId: 7, image: '/uploads/new.webp', thumbnail: '/uploads/new-thumb.webp', version: 4 } };
    throw new Error(`unexpected request ${url}`);
  });
  render(
    <MemoryRouter initialEntries={['/media-library/products/7']}>
      <Routes>
        <Route path="/media-library/products/:itemId" element={<MediaProductPage user={{ id: 1, username: 'boss', full_name: 'x', role: 'r' }} />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { name: PRODUCT_NAME });
  return screen.getByRole('region', { name: FEATURED_TITLE });
}

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

describe('media library grid card', () => {
  it('shows the item picture as the featured image', () => {
    const img = renderCard(row({ featuredImage: '/uploads/item-thumb.webp', fallbackAssetId: 9 }));
    expect(img?.getAttribute('src')).toBe('/uploads/item-thumb.webp');
  });

  it('shows the first library file only while the item has no picture', () => {
    const img = renderCard(row({ featuredImage: null, fallbackAssetId: 9 }));
    expect(img?.getAttribute('src')).toContain('/media/assets/9/file?variant=thumb');
  });

  it('shows no picture when neither exists', () => {
    expect(renderCard(row({ featuredImage: null, fallbackAssetId: null, imageCount: 0 }))).toBeNull();
  });
});

describe('media library product page featured image', () => {
  it('shows the item picture and replaces it after «make featured»', async () => {
    const panel = await renderPage(['media.view', 'products.edit'], { image: '/uploads/old.webp', thumbnail: '/uploads/old-thumb.webp' });
    expect(within(panel).getByText(CHANGE_HINT)).toBeTruthy();
    expect(within(panel).getByRole('img').getAttribute('src')).toBe('/uploads/old-thumb.webp');
    const tile = screen.getByTestId('media-asset-1');
    for (const text of OLD_COVER_TEXTS) expect(screen.queryByText(text)).toBeNull();
    expect(screen.queryByTestId('media-cover-badge')).toBeNull();
    fireEvent.click(within(tile).getByText(MAKE_FEATURED));
    await waitFor(() => expect(within(panel).getByRole('img').getAttribute('src')).toBe('/uploads/new-thumb.webp'));
    expect(fetchJson.mock.calls.filter(([u]) => u === '/media/assets/1/item-image').map(([, init]) => JSON.parse(String(init.body))))
      .toEqual([{ version: 3 }]);
  });

  it('says when the product has no featured image and offers no change to a viewer', async () => {
    const panel = await renderPage(['media.view'], { image: null, thumbnail: null });
    expect(within(panel).getByText(EMPTY_TEXT)).toBeTruthy();
    expect(screen.queryByText(MAKE_FEATURED)).toBeNull();
  });

  it('offers no change to media.manage without products.edit', async () => {
    const panel = await renderPage(['media.view', 'media.manage'], { image: null, thumbnail: null });
    expect(screen.queryByText(MAKE_FEATURED)).toBeNull();
    expect(within(panel).queryByText(CHANGE_HINT)).toBeNull();
  });

  it('shows the change hint only while an image can become the featured image', async () => {
    const panel = await renderPage(['media.view', 'products.edit'], { image: null, thumbnail: null },
      [asset(1, { hasLight: false }), asset(2, { kind: 'video', shotType: 'video', mimeType: 'video/mp4' })]);
    expect(within(panel).queryByText(CHANGE_HINT)).toBeNull();
    expect(screen.queryByText(MAKE_FEATURED)).toBeNull();
  });
});
