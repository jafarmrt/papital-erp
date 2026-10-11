/**
 * v10.0.261 (OBS-R1-04): which `/uploads` paths are served without a session. Only image files (the company logo,
 * catalog and product photos are all stored with an image extension by `uploadBase64ToStorage`) and the public
 * asset folders; a file whose name merely contains «logo» or «favicon» is no longer public.
 */
const PUBLIC_IMAGE_EXTENSION = /\.(jpg|jpeg|png|webp|gif|svg|ico)$/i;

export function isPublicUploadPath(lowerCasePath: string): boolean {
  return PUBLIC_IMAGE_EXTENSION.test(lowerCasePath)
    || lowerCasePath.startsWith('/public/')
    || lowerCasePath.startsWith('/branding/');
}
