import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Transform, type Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { ValidationError } from '../../errors/customErrors.js';
import {
  MEDIA_FORMAT_TEXT, MEDIA_LIGHT_LONG_SIDE, MEDIA_MAX_BYTES, MEDIA_THUMB_LONG_SIDE, MEDIA_TOO_LARGE_TEXT, MEDIA_TYPES,
  type MediaKind, type MediaVariant,
} from '../../lib/media/mediaRules.js';

/**
 * v10.0.16 (N-05): files of the media library on disk. The root is `MEDIA_DIR` (default `<app>/media-library`), never under
 * `public/uploads`, so the static route never serves it and the daily backup archive of the uploads stays small. Layout:
 * `originals/<aa>/<sha256>.<ext>` (the file as sent, never changed), `light/<aa>/<sha256>.webp`, `thumbs/<aa>/<sha256>.webp`
 * and `tmp/` for uploads in progress. A file named by its content is written once and shared by every row holding it.
 */

export function getMediaRoot(): string {
  return path.resolve(process.env.MEDIA_DIR || path.join(process.cwd(), 'media-library'));
}

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

export interface ReceivedFile {
  tempPath: string;
  sizeBytes: number;
  sha256: string;
}

export function mediaTooLarge(): ValidationError {
  return new ValidationError(MEDIA_TOO_LARGE_TEXT, undefined, 'MEDIA_FILE_TOO_LARGE');
}

/**
 * Streams a request body to a temporary file while hashing and counting it. A body above `maxBytes` stops at once and
 * leaves no file (422 `MEDIA_FILE_TOO_LARGE`); an empty body is 422 `MEDIA_FILE_EMPTY`.
 */
export async function receiveToTemp(body: Readable, maxBytes: number = MEDIA_MAX_BYTES): Promise<ReceivedFile> {
  const tmpDir = path.join(getMediaRoot(), 'tmp');
  await fs.promises.mkdir(tmpDir, { recursive: true });
  const tempPath = path.join(tmpDir, `${uuidv4()}.part`);
  const hash = crypto.createHash('sha256');
  let size = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, done) {
      size += chunk.length;
      if (size > maxBytes) { done(mediaTooLarge()); return; }
      hash.update(chunk);
      done(null, chunk);
    },
  });
  try {
    await pipeline(body, meter, fs.createWriteStream(tempPath, { flags: 'wx' }));
  } catch (err) {
    await fs.promises.rm(tempPath, { force: true });
    throw err;
  }
  if (size === 0) {
    await fs.promises.rm(tempPath, { force: true });
    throw new ValidationError('فایل خالی است.', undefined, 'MEDIA_FILE_EMPTY');
  }
  return { tempPath, sizeBytes: size, sha256: hash.digest('hex') };
}

/** The media type the first bytes of a file prove, or null; the declared type must agree with it */
export function sniffMediaType(head: Buffer): string | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (head.length >= 12 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (head.length >= 4 && (head.toString('latin1', 0, 4) === 'II*\u0000' || head.toString('latin1', 0, 4) === 'MM\u0000*')) return 'image/tiff';
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'video/webm';
  if (head.length >= 12 && head.toString('latin1', 4, 8) === 'ftyp') {
    const brand = head.toString('latin1', 8, 12);
    if (brand === 'qt  ') return 'video/quicktime';
    if (/^(heic|heix|heim|heis|hevc|mif1|msf1|avif)$/.test(brand)) return null;
    return 'video/mp4';
  }
  return null;
}

async function readHead(filePath: string, bytes = 32): Promise<Buffer> {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Checks that the content is the declared kind of media. MP4 and MOV share one container, so a declared MOV holding an
 * MP4 brand (and the reverse) is accepted under the declared type.
 */
export async function assertContentMatches(tempPath: string, declaredType: string): Promise<void> {
  const sniffed = sniffMediaType(await readHead(tempPath));
  const sameContainer = (a: string, b: string) => a === b || (['video/mp4', 'video/quicktime'].includes(a) && ['video/mp4', 'video/quicktime'].includes(b));
  if (!sniffed || !sameContainer(sniffed, declaredType)) {
    throw new ValidationError(MEDIA_FORMAT_TEXT, undefined, 'MEDIA_FORMAT_INVALID');
  }
}

export interface ImageFacts { width: number; height: number }

/** Width and height of an image as displayed (EXIF orientation applied); an unreadable image is 422 */
export async function readImageFacts(filePath: string): Promise<ImageFacts> {
  try {
    const meta = await sharp(filePath, { limitInputPixels: 300_000_000 }).metadata();
    const width = meta.autoOrient?.width ?? meta.width;
    const height = meta.autoOrient?.height ?? meta.height;
    if (!width || !height) throw new Error('no dimensions');
    return { width, height };
  } catch {
    throw new ValidationError('تصویر خوانده نشد؛ فایل آسیب دیده یا قالب آن پشتیبانی نمی‌شود.', undefined, 'MEDIA_IMAGE_UNREADABLE');
  }
}

/** Moves an upload into its permanent place; an identical file already there is kept and the upload dropped */
export async function placeOriginal(tempPath: string, sha256: string, ext: string): Promise<void> {
  const target = mediaFilePath(sha256, 'original', ext);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) {
    await fs.promises.rm(tempPath, { force: true });
    return;
  }
  await fs.promises.rename(tempPath, target);
}

async function writeAtomically(target: string, data: Buffer): Promise<void> {
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const part = `${target}.${uuidv4()}.part`;
  await fs.promises.writeFile(part, data);
  await fs.promises.rename(part, target);
}

/** Makes the light version and the thumbnail of a stored image and answers their sizes */
export async function buildImageVariants(sha256: string, ext: string): Promise<{ lightBytes: number; thumbBytes: number }> {
  const source = mediaFilePath(sha256, 'original', ext);
  const base = () => sharp(source, { limitInputPixels: 300_000_000 }).rotate();
  const light = await base()
    .resize({ width: MEDIA_LIGHT_LONG_SIDE, height: MEDIA_LIGHT_LONG_SIDE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  const thumb = await base()
    .resize({ width: MEDIA_THUMB_LONG_SIDE, height: MEDIA_THUMB_LONG_SIDE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 75 })
    .toBuffer();
  await writeAtomically(mediaFilePath(sha256, 'light', ext), light);
  await writeAtomically(mediaFilePath(sha256, 'thumb', ext), thumb);
  return { lightBytes: light.length, thumbBytes: thumb.length };
}

/** Makes the thumbnail of a video from the poster image the browser took of its first frame */
export async function buildPosterThumb(sha256: string, posterPath: string): Promise<number> {
  let thumb: Buffer;
  try {
    thumb = await sharp(posterPath, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: MEDIA_THUMB_LONG_SIDE, height: MEDIA_THUMB_LONG_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();
  } catch {
    throw new ValidationError('تصویر نخست فیلم خوانده نشد.', undefined, 'MEDIA_IMAGE_UNREADABLE');
  }
  await writeAtomically(mediaFilePath(sha256, 'thumb', 'webp'), thumb);
  return thumb.length;
}

export function kindOfType(mimeType: string): MediaKind {
  const known = MEDIA_TYPES[mimeType];
  if (!known) throw new ValidationError(MEDIA_FORMAT_TEXT, undefined, 'MEDIA_FORMAT_INVALID');
  return known.kind;
}
