import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAuthToken, setCsrfToken } from '../../api';
import {
  MEDIA_FORMAT_TEXT, MEDIA_HEIC_TEXT, MEDIA_IMAGE_WARN_BYTES, MEDIA_MAX_BYTES, MEDIA_TOO_LARGE_TEXT,
} from '../../lib/media/mediaRules';
import { DEFAULT_SHOT_TYPE, MediaUploadError, checkMediaFile, posterDuration, uploadMediaFile, uploadUrl } from '../../lib/media/mediaUpload';
import { downloadMediaZip, fileNameFromDisposition, mediaProductQueryFrom, mediaProductQueryParams } from '../../lib/media/mediaApi';

// v10.0.16 (N-05 PR 2): the upload box checks a file with the server's rules before sending it, and sends the raw file
// with its name, type, the CSRF header and the session cookie.

const MB = 1024 * 1024;
const PERSIAN_FILE_NAME = 'گوشواره سفید.jpg';
const PERSIAN_ZIP_NAME = 'تصاویر.zip';

describe('media pre-upload checks', () => {
  it('refuses a file above 50 MB with the size message', () => {
    expect(checkMediaFile({ name: 'a.mp4', type: 'video/mp4', size: MEDIA_MAX_BYTES + 1 })).toEqual({ ok: false, error: MEDIA_TOO_LARGE_TEXT });
  });

  it('refuses an iPhone HEIC photo with its own hint, whatever its declared type', () => {
    expect(checkMediaFile({ name: 'IMG_0001.HEIC', type: 'image/heic', size: MB })).toEqual({ ok: false, error: MEDIA_HEIC_TEXT });
    expect(checkMediaFile({ name: 'x.heif', type: '', size: MB })).toEqual({ ok: false, error: MEDIA_HEIC_TEXT });
  });

  it('refuses an unknown format', () => {
    expect(checkMediaFile({ name: 'doc.pdf', type: 'application/pdf', size: MB })).toEqual({ ok: false, error: MEDIA_FORMAT_TEXT });
  });

  it('reads the type from the extension when the browser sends none', () => {
    const check = checkMediaFile({ name: 'clip.MOV', type: '', size: 5 * MB });
    expect(check).toEqual({ ok: true, type: 'video/quicktime', kind: 'video', warnings: [] });
  });

  it('warns about a large image and a small one, and lets it through', () => {
    expect(checkMediaFile({ name: 'big.jpg', type: 'image/jpeg', size: MEDIA_IMAGE_WARN_BYTES + 1 }, 4000))
      .toEqual({ ok: true, type: 'image/jpeg', kind: 'image', warnings: ['large_image'] });
    expect(checkMediaFile({ name: 'tiny.png', type: 'image/png', size: 100 * 1024 }))
      .toEqual({ ok: true, type: 'image/png', kind: 'image', warnings: ['low_quality'] });
    expect(checkMediaFile({ name: 'small-pixels.jpg', type: 'image/jpeg', size: 2 * MB }, 800))
      .toEqual({ ok: true, type: 'image/jpeg', kind: 'image', warnings: ['low_quality'] });
    expect(checkMediaFile({ name: 'fine.jpg', type: 'image/jpeg', size: 2 * MB }, 3000))
      .toEqual({ ok: true, type: 'image/jpeg', kind: 'image', warnings: [] });
  });

  it('defaults the shot type to white background for an image and short film for a video', () => {
    expect(DEFAULT_SHOT_TYPE).toEqual({ image: 'white_background', video: 'video' });
  });

  it('sends a poster duration with at most two decimals', () => {
    expect(posterDuration(12.3456)).toBe('12.35');
    expect(posterDuration(0)).toBeNull();
    expect(posterDuration(Number.NaN)).toBeNull();
  });
});

class FakeXhr {
  static last: FakeXhr | null = null;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  withCredentials = false;
  body: unknown = null;
  status = 0;
  responseText = '';
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() { FakeXhr.last = this; }
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  send(body: unknown) { this.body = body; }
  abort() { this.onabort?.(); }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
  setAuthToken(null);
  FakeXhr.last = null;
});

async function sentRequest(): Promise<FakeXhr> {
  for (let i = 0; i < 20 && !FakeXhr.last?.body; i++) await Promise.resolve();
  if (!FakeXhr.last) throw new Error('no request was sent');
  return FakeXhr.last;
}

describe('media upload request', () => {
  it('posts the raw file with its type, encoded name, CSRF and bearer headers and reports progress', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    setCsrfToken('csrf-1');
    setAuthToken('tok-1');
    const file = new File(['abc'], PERSIAN_FILE_NAME, { type: 'image/jpeg' });
    const progress: number[] = [];
    const answer = uploadMediaFile(file, 'image/jpeg', { sectionId: 2, itemId: 15, shotType: 'detail' }, p => progress.push(p));
    const xhr = await sentRequest();
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('/api/media/assets?sectionId=2&itemId=15&shotType=detail');
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.headers['Content-Type']).toBe('image/jpeg');
    expect(xhr.headers['X-File-Name']).toBe(encodeURIComponent(PERSIAN_FILE_NAME));
    expect(xhr.headers['x-csrf-token']).toBe('csrf-1');
    expect(xhr.headers.Authorization).toBe('Bearer tok-1');
    expect(xhr.body).toBe(file);
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 } as ProgressEvent);
    xhr.respond(201, { success: true, data: { id: 9 }, warnings: ['low_quality'] });
    await expect(answer).resolves.toEqual({ success: true, data: { id: 9 }, warnings: ['low_quality'] });
    expect(progress).toEqual([0.5]);
  });

  it('rejects with the server message and code', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    setCsrfToken('csrf-1');
    const answer = uploadMediaFile(new File(['x'], 'a.png', { type: 'image/png' }), 'image/png', { sectionId: 1, shotType: 'other' });
    const xhr = await sentRequest();
    xhr.respond(409, { message: 'duplicate', code: 'MEDIA_DUPLICATE' });
    await expect(answer).rejects.toMatchObject({ code: 'MEDIA_DUPLICATE', status: 409, message: 'duplicate' });
    await expect(answer).rejects.toBeInstanceOf(MediaUploadError);
  });

  it('leaves the item out of the address of a file without an item', () => {
    expect(uploadUrl({ sectionId: 3, shotType: 'other' })).toBe('/api/media/assets?sectionId=3&shotType=other');
  });
});

describe('media library helpers', () => {
  it('reads the UTF-8 file name of a zip answer', () => {
    const header = `attachment; filename="_.zip"; filename*=UTF-8''${encodeURIComponent(PERSIAN_ZIP_NAME)}`;
    expect(fileNameFromDisposition(header, 'x.zip')).toBe(PERSIAN_ZIP_NAME);
    expect(fileNameFromDisposition('attachment; filename="a.zip"', 'x.zip')).toBe('a.zip');
    expect(fileNameFromDisposition(null, 'x.zip')).toBe('x.zip');
  });

  it('keeps the grid conditions in the page address and back', () => {
    const query = mediaProductQueryFrom(new URLSearchParams('search=ring&lowQuality=1&designYear=1404&page=3'));
    expect(query).toMatchObject({ search: 'ring', lowQuality: true, designYear: '1404', page: 3, withoutImages: false });
    expect(mediaProductQueryParams(query).toString()).toBe('search=ring&designYear=1404&lowQuality=1&page=3');
    expect(mediaProductQueryParams({ ...query, page: 1, search: ' ' }).toString()).toBe('designYear=1404&lowQuality=1');
  });

  it('downloads the zip with a GET of the ids, the session cookie and the bearer header, without a body', async () => {
    setAuthToken('tok-2');
    const fetchMock = vi.fn(async () => new Response(new Blob(['zip']), {
      status: 200,
      headers: { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(PERSIAN_ZIP_NAME)}` },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const createObjectURL = vi.fn(() => 'blob:zip');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await downloadMediaZip([4, 5, 6], 'light');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/media/zip?ids=4,5,6&variant=light');
    expect(init.method ?? 'GET').toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.credentials).toBe('include');
    expect(init.headers).toEqual({ Authorization: 'Bearer tok-2' });
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it('reports the server message of a refused zip', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'too large', code: 'MEDIA_ZIP_TOO_LARGE' }), { status: 422 })));
    await expect(downloadMediaZip([1], 'original')).rejects.toMatchObject({ code: 'MEDIA_ZIP_TOO_LARGE', status: 422, message: 'too large' });
  });
});
