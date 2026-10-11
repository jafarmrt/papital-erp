import path from 'path';

/**
 * v10.0.21 (N-05): the root directory of the media library files, `MEDIA_DIR` or `<app>/media-library`. Shared by the
 * media services and the health page (v10.0.248), which reads its size and free space without importing the media package.
 */
export function getMediaRoot(): string {
  return path.resolve(process.env.MEDIA_DIR || path.join(process.cwd(), 'media-library'));
}
