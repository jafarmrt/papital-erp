/**
 * Which `/uploads` paths are served without a session. v10.0.261 (OBS-R1-04) narrowed it to image files and the public
 * asset folders; v10.1.58 (OBS-R2-60, decision ت۴۰ item 1) to the public asset folders and a legacy company logo file
 * (`logo-<uuid>.<image>` at the folder root, shown on the login page). Item, transfer, raw material and profile
 * images need a session; the company logo saved since V3.1.11 is a data URL in the settings and needs no file.
 */
const PUBLIC_LOGO_FILE = /^\/logo-[^/]+\.(jpg|jpeg|png|webp|gif|svg|ico)$/i;

export function isPublicUploadPath(lowerCasePath: string): boolean {
  return PUBLIC_LOGO_FILE.test(lowerCasePath)
    || lowerCasePath.startsWith('/public/')
    || lowerCasePath.startsWith('/branding/');
}
