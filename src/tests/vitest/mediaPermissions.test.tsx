import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { MediaAssetView, MediaProductDetail } from '../../lib/media/mediaApi';
import { canChangeAsset } from '../../lib/media/mediaAccess';
import { canOpenPage } from '../../lib/permissions/pageAccess';

// v10.0.25 (N-05 PR 2): the product view of the media library shows each button by the key its route asks: upload by
// media.upload or media.manage, a file's edit and delete by media.manage or its own uploader, the product card edit by
// media.manage or products.edit.

let granted = new Set<string>();
vi.mock('../../contexts/AuthContext', () => ({
  useHasPermission: (key: string) => granted.has(key),
  useHasAnyPermission: (keys: readonly string[]) => keys.some(k => granted.has(k)),
}));
const getMediaProduct = vi.fn();
vi.mock('../../lib/media/mediaApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/media/mediaApi')>()),
  getMediaProduct: (...args: unknown[]) => getMediaProduct(...args),
}));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { toast: t, default: t };
});

const { default: MediaProductPage } = await import('../../pages/MediaProductPage');

const EDIT_TEXT = 'ویرایش';
const DELETE_TEXT = 'حذف';
const EDIT_INFO_TEXT = 'ویرایش مشخصات';
const UPLOAD_BOX_LABEL = 'بارگذاری تصویر و فیلم';
const LIGHT_DOWNLOAD_TEXT = 'دانلود نسخه سبک';
const PREPARING = 'در حال آماده‌سازی';

function asset(id: number, createdBy: string, extra: Partial<MediaAssetView> = {}): MediaAssetView {
  return {
    id, sectionId: 1, itemId: 7, kind: 'image', shotType: 'white_background', title: `file ${id}`, description: '', sortOrder: id,
    isCover: false, originalName: `f${id}.jpg`, mimeType: 'image/jpeg', sizeBytes: 2_000_000, width: 2000, height: 2000,
    durationSeconds: null, isLowQuality: false, hasLight: true, hasThumb: true, lightFailed: false, createdBy, createdAt: null,
    version: 1, warnings: [], ...extra,
  };
}

const detail: MediaProductDetail = {
  item: {
    id: 7, code: '1404-N-101-01', name: 'گوشواره', category: 'گوشواره میخی', unit: 'جفت', color: null, material: null, size: null,
    weight: null, collections: ['بهار'], designYear: 1404, transferCode: '101', productDescription: null, technicalNotes: null, version: 3,
  },
  assets: [asset(1, 'ali'), asset(2, 'sara', { hasThumb: false, hasLight: false })],
  productsSectionId: 1,
};

async function renderAs(keys: string[], username = 'ali') {
  granted = new Set(keys);
  getMediaProduct.mockResolvedValue(detail);
  render(
    <MemoryRouter initialEntries={['/media-library/products/7']}>
      <Routes>
        <Route path="/media-library/products/:itemId" element={<MediaProductPage user={{ id: 1, username, full_name: 'x', role: 'r' }} />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByText('گوشواره');
}

const tile = (id: number) => screen.getByTestId(`media-asset-${id}`);

afterEach(() => {
  cleanup();
  getMediaProduct.mockReset();
});

describe('media library product view by permission', () => {
  it('shows no upload, edit or delete to a viewer with media.view only', async () => {
    await renderAs(['media.view']);
    expect(screen.queryByLabelText(UPLOAD_BOX_LABEL)).toBeNull();
    expect(screen.queryByText(EDIT_INFO_TEXT)).toBeNull();
    for (const id of [1, 2]) {
      expect(within(tile(id)).queryByText(EDIT_TEXT)).toBeNull();
      expect(within(tile(id)).queryByText(DELETE_TEXT)).toBeNull();
    }
    expect(within(tile(1)).getByText(LIGHT_DOWNLOAD_TEXT)).toBeTruthy();
    expect(within(tile(2)).queryByText(LIGHT_DOWNLOAD_TEXT)).toBeNull();
    expect(within(tile(2)).getByText(PREPARING)).toBeTruthy();
  });

  it('lets a media.upload holder upload and change only own files', async () => {
    await renderAs(['media.view', 'media.upload'], 'ali');
    expect(screen.getByLabelText(UPLOAD_BOX_LABEL)).toBeTruthy();
    expect(within(tile(1)).getByText(EDIT_TEXT)).toBeTruthy();
    expect(within(tile(1)).getByText(DELETE_TEXT)).toBeTruthy();
    expect(within(tile(2)).queryByText(EDIT_TEXT)).toBeNull();
    expect(within(tile(2)).queryByText(DELETE_TEXT)).toBeNull();
    expect(screen.queryByText(EDIT_INFO_TEXT)).toBeNull();
  });

  it('lets a media.manage holder change every file and the product card', async () => {
    await renderAs(['media.view', 'media.manage'], 'someone');
    expect(screen.getByLabelText(UPLOAD_BOX_LABEL)).toBeTruthy();
    for (const id of [1, 2]) {
      expect(within(tile(id)).getByText(EDIT_TEXT)).toBeTruthy();
      expect(within(tile(id)).getByText(DELETE_TEXT)).toBeTruthy();
    }
    expect(screen.getByText(EDIT_INFO_TEXT)).toBeTruthy();
  });

  it('lets a products.edit holder edit the product card without upload', async () => {
    await renderAs(['media.view', 'products.edit']);
    expect(screen.getByText(EDIT_INFO_TEXT)).toBeTruthy();
    expect(screen.queryByLabelText(UPLOAD_BOX_LABEL)).toBeNull();
  });

  it('decides own files by the uploader name', () => {
    expect(canChangeAsset({ createdBy: 'ali' }, { canUpload: true, canManage: false, username: 'ali' })).toBe(true);
    expect(canChangeAsset({ createdBy: 'ali' }, { canUpload: true, canManage: false, username: 'sara' })).toBe(false);
    expect(canChangeAsset({ createdBy: '' }, { canUpload: true, canManage: false, username: '' })).toBe(false);
    expect(canChangeAsset({ createdBy: 'ali' }, { canUpload: false, canManage: true, username: null })).toBe(true);
  });

  it('opens the media library pages for media.view only', () => {
    expect(canOpenPage('/media-library', { permissions: ['media.view'] })).toBe(true);
    expect(canOpenPage('/media-library/products/:itemId', { permissions: ['media.view'] })).toBe(true);
    expect(canOpenPage('/media-library', { permissions: ['products.view'] })).toBe(false);
  });
});
