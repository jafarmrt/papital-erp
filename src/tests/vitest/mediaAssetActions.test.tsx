import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import toast from 'react-hot-toast';
import type { MediaAssetView, MediaProductDetail } from '../../lib/media/mediaApi';
import { MEDIA_TAG_TEXT } from '../../lib/media/mediaTags';
import { orderAfterMove } from '../../components/media/useMediaGalleryActions';

// v10.0.27 (N-05 PR 3): a product gallery shows the cover and order buttons only to media.manage, «replace with a better
// version» by the file's change rule and «use as the item picture» to media.manage or products.edit, each sending the body
// its route takes; the edit form sends normalized tags and shows the tag error under the field.

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
const replaceMediaFileContent = vi.fn();
const precheckMediaFile = vi.fn();
vi.mock('../../lib/media/mediaUpload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/media/mediaUpload')>()),
  replaceMediaFileContent: (...args: unknown[]) => replaceMediaFileContent(...args),
  precheckMediaFile: (...args: unknown[]) => precheckMediaFile(...args),
}));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: vi.fn(async () => true) }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { toast: t, default: t };
});

const { default: MediaProductPage } = await import('../../pages/MediaProductPage');
const { MEDIA_REPLACE_KIND_TEXT } = await import('../../lib/media/mediaUpload');

const COVER_TEXT = 'تصویر شاخص';
const REPLACE_TEXT = 'جایگزینی با نسخه بهتر';
const ITEM_IMAGE_TEXT = 'استفاده به‌عنوان عکس کالا';
const EDIT_TEXT = 'ویرایش';
const SAVE_TEXT = 'ذخیره';
const TAGS_LABEL = 'برچسب‌ها';
const MOVE_LATER = 'جابه‌جایی به بعد';
const MOVE_EARLIER = 'جابه‌جایی به قبل';
const PRODUCT_NAME = 'گوشواره';
const SPRING_TAG = 'بهار';
const SUMMER_TAG = 'تابستان';
const TAGS_INPUT = ` ${SPRING_TAG}، #${SUMMER_TAG} ,${SPRING_TAG} `;
const TAG_LIST_LABEL = 'برچسب‌ها';

function asset(id: number, createdBy: string, extra: Partial<MediaAssetView> = {}): MediaAssetView {
  return {
    id, sectionId: 1, itemId: 7, kind: 'image', shotType: 'white_background', title: `file ${id}`, description: '', sortOrder: id,
    isCover: false, originalName: `f${id}.jpg`, mimeType: 'image/jpeg', sizeBytes: 2_000_000, width: 2000, height: 2000,
    durationSeconds: null, isLowQuality: false, hasLight: true, hasThumb: true, lightFailed: false, createdBy, createdAt: null,
    version: 1, warnings: [], tags: [], ...extra,
  };
}

function detail(): MediaProductDetail {
  return {
    item: {
      id: 7, code: '1404-N-101-01', name: PRODUCT_NAME, category: null, unit: null, color: null, material: null, size: null,
      weight: null, collections: [], designYear: null, transferCode: null, productDescription: null, technicalNotes: null, version: 3,
    },
    assets: [asset(1, 'ali'), asset(2, 'sara', { tags: [SPRING_TAG] }), asset(3, 'sara', { kind: 'video', shotType: 'video', mimeType: 'video/mp4' })],
    productsSectionId: 1,
  };
}

function answer(url: string, init?: RequestInit): unknown {
  const method = init?.method ?? 'GET';
  if (url === '/media/products/7') return detail();
  if (url === '/media/assets/1/cover') return { success: true, data: [asset(1, 'ali', { isCover: true }), asset(2, 'sara')] };
  if (url === '/media/assets/order') return { success: true, data: [asset(2, 'sara', { sortOrder: 1 }), asset(1, 'ali', { sortOrder: 2 })] };
  if (url === '/media/assets/1/item-image') return { success: true, data: { itemId: 7, image: '/i.jpg', thumbnail: '/t.jpg', version: 4 } };
  if (url === '/media/assets/1' && method === 'PUT') return { success: true, data: asset(1, 'ali', { tags: ['x'] }) };
  throw new Error(`unexpected request ${method} ${url}`);
}

async function renderAs(keys: string[], username = 'ali') {
  granted = new Set(keys);
  fetchJson.mockImplementation(async (url: string, init?: RequestInit) => answer(url, init));
  render(
    <MemoryRouter initialEntries={['/media-library/products/7']}>
      <Routes>
        <Route path="/media-library/products/:itemId" element={<MediaProductPage user={{ id: 1, username, full_name: 'x', role: 'r' }} />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByText(PRODUCT_NAME);
}

const tile = (id: number) => screen.getByTestId(`media-asset-${id}`);
const sent = (url: string) => fetchJson.mock.calls.filter(([u]) => u === url).map(([, init]) => JSON.parse(String((init as RequestInit).body)));

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  replaceMediaFileContent.mockReset();
  precheckMediaFile.mockReset();
  vi.mocked(toast.error).mockClear();
});

describe('media gallery manager actions by permission', () => {
  it('gives an uploader only the replacement of own files', async () => {
    await renderAs(['media.view', 'media.upload'], 'ali');
    expect(within(tile(1)).getByText(REPLACE_TEXT)).toBeTruthy();
    expect(within(tile(2)).queryByText(REPLACE_TEXT)).toBeNull();
    expect(screen.queryByText(COVER_TEXT)).toBeNull();
    expect(screen.queryByLabelText(`${MOVE_LATER} file 1`)).toBeNull();
    expect(screen.queryByText(ITEM_IMAGE_TEXT)).toBeNull();
  });

  it('gives products.edit the item picture button on images only', async () => {
    await renderAs(['media.view', 'products.edit']);
    expect(within(tile(1)).getByText(ITEM_IMAGE_TEXT)).toBeTruthy();
    expect(within(tile(3)).queryByText(ITEM_IMAGE_TEXT)).toBeNull();
    expect(screen.queryByText(COVER_TEXT)).toBeNull();
  });

  it('sets the cover and replaces the list with the answer', async () => {
    await renderAs(['media.view', 'media.manage'], 'boss');
    expect(within(tile(3)).queryByText(COVER_TEXT)).toBeNull();
    fireEvent.click(within(tile(1)).getByText(COVER_TEXT));
    await waitFor(() => expect(screen.getByTestId('media-cover-badge')).toBeTruthy());
    expect(sent('/media/assets/1/cover')).toEqual([{ cover: true }]);
    expect(screen.queryByTestId('media-asset-3')).toBeNull();
  });

  it('sends the full new order of the product files', async () => {
    await renderAs(['media.view', 'media.manage'], 'boss');
    expect(screen.queryByLabelText(`${MOVE_EARLIER} file 1`)).toBeNull();
    fireEvent.click(screen.getByLabelText(`${MOVE_LATER} file 1`));
    await waitFor(() => expect(sent('/media/assets/order')).toHaveLength(1));
    expect(sent('/media/assets/order')[0]).toEqual({ sectionId: 1, itemId: 7, ids: [2, 1, 3] });
  });

  it('copies an image into the item picture with the item version and keeps the new version', async () => {
    await renderAs(['media.view', 'media.manage'], 'boss');
    fireEvent.click(within(tile(1)).getByText(ITEM_IMAGE_TEXT));
    await waitFor(() => expect(sent('/media/assets/1/item-image')).toHaveLength(1));
    fireEvent.click(within(tile(1)).getByText(ITEM_IMAGE_TEXT));
    await waitFor(() => expect(sent('/media/assets/1/item-image')).toHaveLength(2));
    expect(sent('/media/assets/1/item-image')).toEqual([{ version: 3 }, { version: 4 }]);
  });

  it('replaces a file only with a file of the same kind', async () => {
    await renderAs(['media.view', 'media.manage'], 'boss');
    const input = screen.getByTestId('media-replace-input') as HTMLInputElement;
    const video = new File(['v'], 'clip.mp4', { type: 'video/mp4' });
    precheckMediaFile.mockResolvedValue({ ok: true, type: 'video/mp4', kind: 'video', warnings: [] });
    fireEvent.click(within(tile(1)).getByText(REPLACE_TEXT));
    expect(input.accept).toContain('image/jpeg');
    expect(input.accept).not.toContain('video/mp4');
    fireEvent.change(input, { target: { files: [video] } });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(MEDIA_REPLACE_KIND_TEXT.image));
    expect(replaceMediaFileContent).not.toHaveBeenCalled();

    const image = new File(['i'], 'better.jpg', { type: 'image/jpeg' });
    precheckMediaFile.mockResolvedValue({ ok: true, type: 'image/jpeg', kind: 'image', warnings: [] });
    replaceMediaFileContent.mockResolvedValue({ data: asset(1, 'ali', { version: 2, originalName: 'better.jpg' }), warnings: [] });
    fireEvent.click(within(tile(1)).getByText(REPLACE_TEXT));
    fireEvent.change(input, { target: { files: [image] } });
    await waitFor(() => expect(replaceMediaFileContent).toHaveBeenCalledTimes(1));
    expect(replaceMediaFileContent.mock.calls[0].slice(0, 3)).toEqual([1, image, 'image/jpeg']);
  });
});

describe('media file tags', () => {
  it('sends normalized tags from the edit form', async () => {
    await renderAs(['media.view', 'media.upload'], 'ali');
    fireEvent.click(within(tile(1)).getByText(EDIT_TEXT));
    fireEvent.change(screen.getByRole('textbox', { name: TAGS_LABEL }), { target: { value: TAGS_INPUT } });
    fireEvent.click(screen.getByRole('button', { name: SAVE_TEXT }));
    await waitFor(() => expect(sent('/media/assets/1')).toHaveLength(1));
    expect(sent('/media/assets/1')[0].tags).toEqual([SPRING_TAG, SUMMER_TAG]);
  });

  it('shows the tag error under the field and sends nothing', async () => {
    await renderAs(['media.view', 'media.upload'], 'ali');
    fireEvent.click(within(tile(1)).getByText(EDIT_TEXT));
    fireEvent.change(screen.getByRole('textbox', { name: TAGS_LABEL }), { target: { value: 'x'.repeat(41) } });
    fireEvent.click(screen.getByRole('button', { name: SAVE_TEXT }));
    expect(await screen.findByText(MEDIA_TAG_TEXT.tooLong)).toBeTruthy();
    expect(sent('/media/assets/1')).toHaveLength(0);
  });

  it('shows the tags of a file as chips', async () => {
    await renderAs(['media.view']);
    expect(within(within(tile(2)).getByRole('list', { name: TAG_LIST_LABEL })).getByText(SPRING_TAG)).toBeTruthy();
    expect(within(tile(1)).queryByRole('list', { name: TAG_LIST_LABEL })).toBeNull();
  });
});

describe('media gallery order', () => {
  it('moves a file within its shot type group and keeps the other groups in place', () => {
    const list = [asset(1, 'a'), asset(2, 'a', { shotType: 'detail' }), asset(3, 'a')];
    expect(orderAfterMove(list, list[0], 1)).toEqual([3, 2, 1]);
    expect(orderAfterMove(list, list[1], 1)).toBeNull();
  });
});
