import { Router, type Request, type Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { can, requirePermission } from '../middleware/authorize.js';
import { validate, paramsIdSchema } from '../middleware/validate.js';
import { logger } from '../middleware/logger.js';
import { errorMessageOf } from '../utils/index.js';
import { MEDIA_MAX_BYTES, MEDIA_POSTER_MAX_BYTES, type MediaShotType, type MediaVariant } from '../lib/media/mediaRules.js';
import { MediaAssetService, type MediaActor } from '../services/media/mediaAsset.service.js';
import { mediaTooLarge } from '../services/media/mediaStorage.js';
import { MediaProductService } from '../services/media/mediaProducts.service.js';
import { planMediaZip, writeMediaZip } from '../services/media/mediaZip.js';
import { MediaSectionService } from '../services/media/mediaSections.service.js';
import { MediaArrangeService } from '../services/media/mediaArrange.service.js';
import { businessTodayIsoDate } from '../lib/businessClock.js';
import {
  mediaAssetOrderSchema, mediaCoverSchema, mediaFileSchema, mediaItemImageSchema, mediaListSchema, mediaPosterSchema,
  mediaProductInfoSchema, mediaProductListSchema, mediaProductParamsSchema, mediaReplaceSchema, mediaSectionCreateSchema,
  mediaSectionOrderSchema, mediaSectionUpdateSchema, mediaTagsSchema, mediaUpdateSchema, mediaUploadSchema, mediaZipSchema,
} from './media.schemas.js';

/**
 * v10.0.21 (N-05): the media library. Files are uploaded as the raw request body (not base64 JSON, which caps at 14 MB),
 * with the file name in `X-File-Name` (URI-encoded) and its type in `Content-Type`; the JSON body parser leaves such a
 * body alone. Files are read only through `GET /media/assets/:id/file`, which needs a session and supports ranges.
 */
const router = Router();

export const MEDIA_VIEW_PERMISSION = 'media.view';
export const MEDIA_UPLOAD_PERMISSION = 'media.upload';
export const MEDIA_MANAGE_PERMISSION = 'media.manage';
/** v10.0.25 (N-05 PR 2): the product card is item data, so the item editor's key opens it too */
export const MEDIA_PRODUCT_INFO_PERMISSIONS = [MEDIA_MANAGE_PERMISSION, 'products.edit'] as const;

async function actorOf(req: Request): Promise<MediaActor> {
  return {
    req,
    userId: req.user?.id,
    username: req.user?.username ?? '',
    canManage: await can(req.user, MEDIA_MANAGE_PERMISSION),
  };
}

/** A declared length above the limit is refused before the body is read */
function assertDeclaredLength(req: Request, maxBytes: number): void {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw mediaTooLarge();
}

function fileNameOf(req: Request): string {
  const raw = String(req.headers['x-file-name'] ?? '');
  try {
    return decodeURIComponent(raw).slice(0, 255);
  } catch {
    return raw.slice(0, 255);
  }
}

router.get('/media/sections', authenticateToken, requirePermission(MEDIA_VIEW_PERMISSION), asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: await MediaAssetService.listSections() });
}));

// v10.0.27 (N-05 PR 3): sections are created, renamed, reordered and deleted with media.manage; the order route comes
// before `/:id` so its path is not read as an id
router.post('/media/sections', authenticateToken, requirePermission(MEDIA_MANAGE_PERMISSION), validate(mediaSectionCreateSchema), asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json({ success: true, data: await MediaSectionService.create(req.body, await actorOf(req)) });
}));

router.put('/media/sections/order', authenticateToken, requirePermission(MEDIA_MANAGE_PERMISSION), validate(mediaSectionOrderSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await MediaSectionService.reorder((req.body as { ids: number[] }).ids, await actorOf(req)) });
}));

router.put('/media/sections/:id', authenticateToken, requirePermission(MEDIA_MANAGE_PERMISSION), validate(mediaSectionUpdateSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await MediaSectionService.update(Number(req.params.id), req.body, await actorOf(req)) });
}));

router.delete('/media/sections/:id', authenticateToken, requirePermission(MEDIA_MANAGE_PERMISSION), validate(paramsIdSchema), asyncHandler(async (req: Request, res: Response) => {
  await MediaSectionService.remove(Number(req.params.id), await actorOf(req));
  res.json({ success: true });
}));

router.get('/media/tags', authenticateToken, requirePermission(MEDIA_VIEW_PERMISSION), validate(mediaTagsSchema), asyncHandler(async (req: Request, res: Response) => {
  const q = req.query as unknown as { sectionId?: number };
  res.json({ data: await MediaAssetService.listTags(q.sectionId) });
}));

router.get('/media/assets', authenticateToken, requirePermission(MEDIA_VIEW_PERMISSION), validate(mediaListSchema), asyncHandler(async (req: Request, res: Response) => {
  const q = req.query as unknown as { sectionId?: number; itemId?: number; kind?: string; shotType?: string; lowQuality?: string; tag?: string; search?: string; page?: number; limit?: number };
  res.json(await MediaAssetService.list({
    sectionId: q.sectionId, itemId: q.itemId, kind: q.kind, shotType: q.shotType, lowQuality: q.lowQuality !== undefined,
    tag: q.tag, search: q.search, page: q.page ?? 1, limit: q.limit ?? 48,
  }));
}));

router.get('/media/assets/:id', authenticateToken, requirePermission(MEDIA_VIEW_PERMISSION), validate(paramsIdSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await MediaAssetService.get(Number(req.params.id)) });
}));

router.get('/media/assets/:id/file', authenticateToken, requirePermission(MEDIA_VIEW_PERMISSION), validate(mediaFileSchema), asyncHandler(async (req: Request, res: Response) => {
  const q = req.query as unknown as { variant: MediaVariant; download?: string };
  const file = await MediaAssetService.fileOf(Number(req.params.id), q.variant);
  const disposition = q.download !== undefined ? 'attachment' : 'inline';
  const asciiName = file.downloadName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  res.setHeader('Content-Disposition', `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.downloadName)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  await new Promise<void>((resolve) => {
    res.sendFile(file.path, { headers: { 'Content-Type': file.mimeType }, dotfiles: 'deny' }, (err) => {
      if (err && !res.headersSent) {
        logger.warn(`[media] file of asset ${req.params.id} (${q.variant}) could not be read: ${errorMessageOf(err)}`);
        res.status(404).json({ success: false, code: 'MEDIA_FILE_MISSING', message: 'فایل روی دیسک یافت نشد.' });
      }
      resolve();
    });
  });
}));

router.post('/media/assets', authenticateToken, requirePermission(MEDIA_UPLOAD_PERMISSION), validate(mediaUploadSchema), asyncHandler(async (req: Request, res: Response) => {
  assertDeclaredLength(req, MEDIA_MAX_BYTES);
  const q = req.query as unknown as { sectionId: number; itemId?: number; shotType: MediaShotType };
  const result = await MediaAssetService.upload({
    body: req,
    fileName: fileNameOf(req),
    declaredType: String(req.headers['content-type'] ?? ''),
    sectionId: q.sectionId,
    itemId: q.itemId ?? null,
    shotType: q.shotType,
  }, await actorOf(req));
  res.status(201).json({ success: true, data: result.asset, warnings: result.warnings });
}));

// v10.0.27 (N-05 PR 3): the order of a section's (or one product's) files, before `/media/assets/:id`
router.put('/media/assets/order', authenticateToken, requirePermission(MEDIA_MANAGE_PERMISSION), validate(mediaAssetOrderSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await MediaArrangeService.reorder(req.body, await actorOf(req)) });
}));

router.put('/media/assets/:id/cover', authenticateToken, requirePermission(MEDIA_MANAGE_PERMISSION), validate(mediaCoverSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await MediaArrangeService.setCover(Number(req.params.id), (req.body as { cover: boolean }).cover, await actorOf(req)) });
}));

/** Replaces the file with a better version; the body is the raw file, like an upload */
router.put('/media/assets/:id/content', authenticateToken, requirePermission(MEDIA_UPLOAD_PERMISSION, MEDIA_MANAGE_PERMISSION), validate(mediaReplaceSchema), asyncHandler(async (req: Request, res: Response) => {
  assertDeclaredLength(req, MEDIA_MAX_BYTES);
  const result = await MediaArrangeService.replaceContent(Number(req.params.id), {
    body: req, fileName: fileNameOf(req), declaredType: String(req.headers['content-type'] ?? ''),
  }, await actorOf(req));
  res.json({ success: true, data: result.asset, warnings: result.warnings });
}));

/** The item's picture from a product image of the library: item data, so the product card's keys open it */
router.post('/media/assets/:id/item-image', authenticateToken, requirePermission(...MEDIA_PRODUCT_INFO_PERMISSIONS), validate(mediaItemImageSchema), asyncHandler(async (req: Request, res: Response) => {
  const data = await MediaArrangeService.useAsItemImage(Number(req.params.id), (req.body as { version: number }).version, {
    req, userId: req.user?.id, username: req.user?.username ?? '',
  });
  res.json({ success: true, data });
}));

router.put('/media/assets/:id/poster', authenticateToken, requirePermission(MEDIA_UPLOAD_PERMISSION, MEDIA_MANAGE_PERMISSION), validate(mediaPosterSchema), asyncHandler(async (req: Request, res: Response) => {
  assertDeclaredLength(req, MEDIA_POSTER_MAX_BYTES);
  const q = req.query as unknown as { durationSeconds?: number };
  const data = await MediaAssetService.setVideoPoster(Number(req.params.id), req, q.durationSeconds ?? null, await actorOf(req));
  res.json({ success: true, data });
}));

router.put('/media/assets/:id', authenticateToken, requirePermission(MEDIA_UPLOAD_PERMISSION, MEDIA_MANAGE_PERMISSION), validate(mediaUpdateSchema), asyncHandler(async (req: Request, res: Response) => {
  const data = await MediaAssetService.update(Number(req.params.id), req.body, await actorOf(req));
  res.json({ success: true, data });
}));

router.delete('/media/assets/:id', authenticateToken, requirePermission(MEDIA_UPLOAD_PERMISSION, MEDIA_MANAGE_PERMISSION), validate(paramsIdSchema), asyncHandler(async (req: Request, res: Response) => {
  await MediaAssetService.remove(Number(req.params.id), await actorOf(req));
  res.json({ success: true });
}));

router.post('/media/assets/:id/rebuild-light', authenticateToken, requirePermission(MEDIA_MANAGE_PERMISSION), validate(paramsIdSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await MediaAssetService.rebuildLight(Number(req.params.id)) });
}));

router.get('/media/products', authenticateToken, requirePermission(MEDIA_VIEW_PERMISSION), validate(mediaProductListSchema), asyncHandler(async (req: Request, res: Response) => {
  const q = req.query as unknown as {
    search?: string; collection?: string; designYear?: number; transferCode?: string; category?: string;
    withoutImages?: string; withoutWhiteBackground?: string; lowQuality?: string; page?: number; limit?: number;
  };
  res.json(await MediaProductService.list({
    search: q.search, collection: q.collection, designYear: q.designYear, transferCode: q.transferCode, category: q.category,
    withoutImages: q.withoutImages !== undefined, withoutWhiteBackground: q.withoutWhiteBackground !== undefined,
    lowQuality: q.lowQuality !== undefined, page: q.page ?? 1, limit: q.limit ?? 24,
  }));
}));

router.get('/media/products/filters', authenticateToken, requirePermission(MEDIA_VIEW_PERMISSION), asyncHandler(async (_req: Request, res: Response) => {
  res.json(await MediaProductService.filters());
}));

router.get('/media/products/:itemId', authenticateToken, requirePermission(MEDIA_VIEW_PERMISSION), validate(mediaProductParamsSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json(await MediaProductService.detail(Number(req.params.itemId)));
}));

router.put('/media/products/:itemId/info', authenticateToken, requirePermission(...MEDIA_PRODUCT_INFO_PERMISSIONS), validate(mediaProductInfoSchema), asyncHandler(async (req: Request, res: Response) => {
  const b = req.body as {
    version: number; collections?: string[]; designYear?: number | string | null; transferCode?: string | null;
    productDescription?: string | null; technicalNotes?: string | null;
  };
  const data = await MediaProductService.updateInfo(Number(req.params.itemId), {
    version: b.version, collections: b.collections, design_year: b.designYear, transfer_code: b.transferCode,
    product_description: b.productDescription, technical_notes: b.technicalNotes,
  }, { req, userId: req.user?.id, username: req.user?.username ?? '' });
  res.json({ success: true, data });
}));

router.get('/media/zip', authenticateToken, requirePermission(MEDIA_VIEW_PERMISSION), validate(mediaZipSchema), asyncHandler(async (req: Request, res: Response) => {
  const q = req.query as unknown as { ids: number[]; variant: 'original' | 'light' };
  const entries = await planMediaZip(q.ids, q.variant);
  const fileName = `papital-media-${await businessTodayIsoDate()}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    await writeMediaZip(res, entries);
  } catch (err) {
    logger.error(`[media] zip of ${entries.length} files stopped before it was finished: ${errorMessageOf(err)}`);
    // once the stream has started there is no status code left; closing the connection shows the browser a broken download
    if (!res.headersSent) throw err;
    res.destroy();
  }
}));

export default router;
