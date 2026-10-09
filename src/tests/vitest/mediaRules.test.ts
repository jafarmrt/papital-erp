// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  MB, MEDIA_IMAGE_LOW_BYTES, isHeicName, mediaDownloadName, mediaTypeOf, mediaWarnings,
} from '../../lib/media/mediaRules';
import { sniffMediaType } from '../../services/media/mediaStorage';

const PRODUCT_CODE = 'گ-۱۲۰';
const EXPECTED_NAME = 'گ-۱۲۰_پشت‌سفید_7.jpg';

describe('media library rules (N-05)', () => {
  it('warns an image above 10 MB and below 200 KB or 1000 px, never a video', () => {
    expect(mediaWarnings('image', 11 * MB, 4000)).toEqual(['large_image']);
    expect(mediaWarnings('image', MEDIA_IMAGE_LOW_BYTES - 1, 4000)).toEqual(['low_quality']);
    expect(mediaWarnings('image', 3 * MB, 800)).toEqual(['low_quality']);
    expect(mediaWarnings('image', 3 * MB, 3000)).toEqual([]);
    expect(mediaWarnings('video', 40 * MB)).toEqual([]);
  });

  it('reads the type from the declared type, else from the extension', () => {
    expect(mediaTypeOf('a.bin', 'image/png')).toBe('image/png');
    expect(mediaTypeOf('clip.MOV', '')).toBe('video/quicktime');
    expect(mediaTypeOf('scan.tiff', 'application/octet-stream')).toBe('image/tiff');
    expect(mediaTypeOf('photo.heic', '')).toBeNull();
    expect(isHeicName('IMG_1.HEIC')).toBe(true);
  });

  it('builds a readable download name without path characters', () => {
    expect(mediaDownloadName({ prefix: PRODUCT_CODE, shotType: 'white_background', id: 7, ext: 'jpg' })).toBe(EXPECTED_NAME);
    expect(mediaDownloadName({ prefix: 'a/b:c', shotType: 'other', id: 3, ext: 'png' })).not.toMatch(/[/:]/);
  });

  it('sniffs the content and refuses HEIC inside an ftyp box', () => {
    expect(sniffMediaType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMediaType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    const box = (brand: string) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from(`ftyp${brand}`, 'latin1')]);
    expect(sniffMediaType(box('isom'))).toBe('video/mp4');
    expect(sniffMediaType(box('qt  '))).toBe('video/quicktime');
    expect(sniffMediaType(box('heic'))).toBeNull();
    expect(sniffMediaType(Buffer.from('%PDF-1.7', 'latin1'))).toBeNull();
  });
});
