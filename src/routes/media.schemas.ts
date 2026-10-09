import { z } from 'zod';
import { numericIdString } from '../middleware/validate.js';
import { MEDIA_SHOT_TYPES, MEDIA_VARIANTS } from '../lib/media/mediaRules.js';

/** v10.0.21 (N-05): query and body shapes of the media library routes (`media.routes.ts`) */

const positiveId = (label: string) => z.string().regex(/^[1-9]\d*$/, `${label} باید عدد صحیح مثبت باشد`).transform(Number);
const shotType = z.enum(MEDIA_SHOT_TYPES, { error: 'نوع نما نامعتبر است' });

export const mediaUploadSchema = z.object({
  query: z.object({
    sectionId: positiveId('بخش'),
    itemId: positiveId('کالا').optional(),
    shotType: shotType.default('other'),
  }).strict(),
});

export const mediaPosterSchema = z.object({
  params: z.object({ id: numericIdString }).passthrough(),
  query: z.object({
    durationSeconds: z.string().regex(/^\d{1,6}(\.\d{1,2})?$/, 'مدت فیلم نامعتبر است').transform(Number).optional(),
  }).strict(),
});

export const mediaListSchema = z.object({
  query: z.object({
    sectionId: positiveId('بخش').optional(),
    itemId: positiveId('کالا').optional(),
    kind: z.enum(['image', 'video']).optional(),
    shotType: shotType.optional(),
    lowQuality: z.enum(['1', 'true']).optional(),
    search: z.string().max(200).optional(),
    page: positiveId('صفحه').optional(),
    limit: positiveId('اندازه صفحه').refine(n => n <= 200, 'اندازه صفحه حداکثر ۲۰۰ است').optional(),
  }).strict(),
});

export const mediaFileSchema = z.object({
  params: z.object({ id: numericIdString }).passthrough(),
  query: z.object({
    variant: z.enum(MEDIA_VARIANTS).default('original'),
    download: z.enum(['1', 'true']).optional(),
  }).strict(),
});

export const mediaUpdateSchema = z.object({
  params: z.object({ id: numericIdString }).passthrough(),
  body: z.object({
    version: z.number().int().positive('نسخه فایل لازم است'),
    title: z.string().max(200, 'عنوان حداکثر ۲۰۰ نویسه است').optional(),
    description: z.string().max(5000, 'توضیح حداکثر ۵۰۰۰ نویسه است').optional(),
    shotType: shotType.optional(),
    sortOrder: z.number().int().min(0).max(100000).optional(),
  }).strict(),
});

/** v10.0.22 (N-05 PR 2): the product grid of the library; every condition is applied in SQL */
export const mediaProductListSchema = z.object({
  query: z.object({
    search: z.string().max(200).optional(),
    collection: z.string().max(60).optional(),
    designYear: z.string().regex(/^\d{4}$/, 'سال طراحی باید چهاررقمی باشد').transform(Number).optional(),
    transferCode: z.string().max(30).optional(),
    category: z.string().max(100).optional(),
    withoutImages: z.enum(['1', 'true']).optional(),
    withoutWhiteBackground: z.enum(['1', 'true']).optional(),
    lowQuality: z.enum(['1', 'true']).optional(),
    page: positiveId('صفحه').optional(),
    limit: positiveId('اندازه صفحه').refine(n => n <= 100, 'اندازه صفحه حداکثر ۱۰۰ است').optional(),
  }).strict(),
});

export const mediaProductParamsSchema = z.object({
  params: z.object({ itemId: numericIdString }).passthrough(),
});

/** The product card; a key not sent keeps its value, the values are read by `productCardValues` (422 when invalid) */
export const mediaProductInfoSchema = z.object({
  params: z.object({ itemId: numericIdString }).passthrough(),
  body: z.object({
    version: z.number().int().positive('نسخه محصول لازم است'),
    collections: z.array(z.string()).max(100).optional(),
    designYear: z.union([z.number(), z.string()]).nullable().optional(),
    transferCode: z.string().nullable().optional(),
    productDescription: z.string().nullable().optional(),
    technicalNotes: z.string().nullable().optional(),
  }).strict(),
});

/** A read, so a GET (a POST guarded by a view key alone breaks the route policy, TD-298): `ids=1,2,3` */
export const mediaZipSchema = z.object({
  query: z.object({
    ids: z.string().regex(/^[1-9]\d*(,[1-9]\d*)*$/, 'فهرست فایل‌ها نامعتبر است')
      .transform(v => v.split(',').map(Number))
      .refine(ids => ids.length <= 500, 'حداکثر ۵۰۰ فایل در یک بار'),
    variant: z.enum(['original', 'light']).default('original'),
  }).strict(),
});
