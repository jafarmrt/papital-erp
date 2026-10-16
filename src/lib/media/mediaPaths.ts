import path from 'path';
import { MEDIA_TYPES, type MediaVariant } from './mediaRules.js';
import { getMediaRoot } from './mediaRoot.js';

/**
 * v10.0.21 (N-05): where a media library file lives on disk, named by its SHA-256 under `MEDIA_DIR`
 * (`originals/<aa>/<sha256>.<ext>`, `light/<aa>/<sha256>.webp`, `thumbs/<aa>/<sha256>.webp`).
 * v10.1.45: moved from `src/services/media/mediaStorage.ts` so the factory reset can remove the files of the rows it wipes.
 */
const SHA256 = /^[0-9a-f]{64}$/;
const VARIANT_DIRS: Readonly<Record<MediaVariant, string>> = { original: 'originals', light: 'light', thumb: 'thumbs' };

/** Absolute path of one variant of a stored file; the extension of light and thumbnail is always webp */
export function mediaFilePath(sha256: string, variant: MediaVariant, originalExt: string): string {
  if (!SHA256.test(sha256)) throw new Error(`Invalid media file key ${sha256}`);
  const ext = variant === 'original' ? originalExt : 'webp';
  if (!/^[a-z0-9]{2,5}$/.test(ext)) throw new Error(`Invalid media file extension ${ext}`);
  return path.join(getMediaRoot(), VARIANT_DIRS[variant], sha256.slice(0, 2), `${sha256}.${ext}`);
}

export function extensionOfType(mimeType: string): string {
  const known = MEDIA_TYPES[mimeType];
  if (!known) throw new Error(`Unknown media type ${mimeType}`);
  return known.ext;
}
