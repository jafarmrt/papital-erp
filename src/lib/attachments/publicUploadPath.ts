import path from 'node:path';

/**
 * Which `/uploads` paths are served without a session. v10.0.261 (OBS-R1-04) narrowed it to image files and the public
 * asset folders; v10.1.58 (OBS-R2-60, decision ت۴۰ item 1) to the public asset folders and a legacy company logo file
 * (`logo-<uuid>.<image>` at the folder root, shown on the login page). Item, transfer, raw material and profile
 * images need a session; the company logo saved since V3.1.11 is a data URL in the settings and needs no file.
 *
 * A path is matched only after it is decoded and normalized: an encoded slash or backslash (`%2f`, `%5c`), a backslash,
 * a NUL, a `..` segment or a path that normalizing changes is never public, so `/public/..%2fitems/x.jpg` reaches no
 * item image without a session.
 */
const PUBLIC_LOGO_FILE = /^\/logo-[^/]+\.(jpg|jpeg|png|webp|gif|svg|ico)$/i;
const ENCODED_SEPARATOR = /%2f|%5c/i;

/** the decoded, normalized, lower-case path, or null when it is malformed or tries to leave its folder */
export function normalizedUploadPath(rawPath: string): string | null {
  if (ENCODED_SEPARATOR.test(rawPath)) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(rawPath); } catch { return null; }
  if (decoded.includes('\\') || decoded.includes('\0')) return null;
  if (decoded.split('/').includes('..')) return null;
  const normalized = path.posix.normalize(decoded);
  if (normalized !== decoded) return null;
  return normalized.toLowerCase();
}

export function isPublicUploadPath(rawPath: string): boolean {
  const p = normalizedUploadPath(rawPath);
  if (p === null) return false;
  return PUBLIC_LOGO_FILE.test(p) || p.startsWith('/public/') || p.startsWith('/branding/');
}

/**
 * Whether a request to the site root static handler would reach `public/uploads`: the path decoded (a malformed escape
 * counts as such a request), backslashes read as slashes, normalized and lower-cased. The root handler refuses such a
 * request, so `/uploads` files are served only through the guarded `/uploads` handler (`//uploads/…`,
 * `/uploads%2f…`, `/%75ploads/…`).
 */
export function isUploadsRequestPath(rawPath: string): boolean {
  let decoded: string;
  try { decoded = decodeURIComponent(rawPath); } catch { return true; }
  const p = path.posix.normalize(`/${decoded.replace(/\\/g, '/')}`).toLowerCase();
  return p === '/uploads' || p.startsWith('/uploads/');
}
