import { describe, expect, it } from 'vitest';
import { isPublicUploadPath, isUploadsRequestPath, normalizedUploadPath } from '../../lib/attachments/publicUploadPath';

describe('obs_r2_60: public upload paths are matched after decoding and normalizing', () => {
  it('keeps the public folders and a root logo file open', () => {
    expect(isPublicUploadPath('/public/a.png')).toBe(true);
    expect(isPublicUploadPath('/Branding/A.PNG')).toBe(true);
    expect(isPublicUploadPath('/logo-1234.png')).toBe(true);
    expect(isPublicUploadPath('/logo-%61.png')).toBe(true);
  });

  it('never opens an item image through a traversal, an encoded separator or a backslash', () => {
    for (const p of [
      '/items/x.jpg',
      '/items/logo-x.png',
      '/public/..%2fitems%2fx.jpg',
      '/branding/..%2fitems%2fx.jpg',
      '/logo-a%2f..%2fitems%2fx.jpg',
      '/public/%2e%2e/items/x.jpg',
      '/public/../items/x.jpg',
      '/public/..%5citems%5cx.jpg',
      '/public\\..\\items\\x.jpg',
      '/public//x.jpg/..',
      '/public/%E0%A4%A.jpg',
      '/public/a%00.jpg',
    ]) expect(isPublicUploadPath(p), p).toBe(false);
  });

  it('normalizes only a clean path', () => {
    expect(normalizedUploadPath('/Items/X.jpg')).toBe('/items/x.jpg');
    expect(normalizedUploadPath('/%2e%2e/x')).toBeNull();
    expect(normalizedUploadPath('/a/./b')).toBeNull();
    expect(normalizedUploadPath('/%ZZ')).toBeNull();
  });

  it('sends every spelling of /uploads away from the site root static handler', () => {
    for (const p of ['/uploads', '/uploads/items/x.jpg', '//uploads/items/x.jpg', '/uploads%2fitems%2fx.jpg', '/%75ploads/items/x.jpg',
      '/UPLOADS/x', '/fonts/../uploads/x', '\\uploads\\x', '/%ZZ']) {
      expect(isUploadsRequestPath(p), p).toBe(true);
    }
    for (const p of ['/favicon.svg', '/fonts/a.woff2', '/uploadsx/a', '/pwa/icon.png']) expect(isUploadsRequestPath(p), p).toBe(false);
  });
});
