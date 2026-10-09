/**
 * v10.0.22 (N-05 PR 2): which media library actions the browser offers, by the keys the server routes ask
 * (`media.routes.ts`, `/media/products/:itemId/info`). Display only; the server checks the same rule itself.
 */

export const MEDIA_UPLOAD_KEYS = ['media.upload', 'media.manage'] as const;
export const MEDIA_MANAGE_KEY = 'media.manage';
export const MEDIA_INFO_EDIT_KEYS = ['media.manage', 'products.edit'] as const;

export interface MediaViewerRights {
  /** holds media.upload or media.manage: may upload, and edit or delete own files */
  canUpload: boolean;
  /** holds media.manage: may edit or delete any file */
  canManage: boolean;
  /** user name of the viewer, compared with the file's `createdBy` */
  username: string | null | undefined;
}

/** A file may be edited or deleted by media.manage, or by its own uploader holding media.upload */
export function canChangeAsset(asset: { createdBy: string }, rights: MediaViewerRights): boolean {
  if (rights.canManage) return true;
  return rights.canUpload && Boolean(rights.username) && asset.createdBy === rights.username;
}
