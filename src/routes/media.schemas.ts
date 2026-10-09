import { z } from 'zod';
import { numericIdString } from '../middleware/validate.js';
import { MEDIA_SHOT_TYPES, MEDIA_VARIANTS } from '../lib/media/mediaRules.js';

/** v10.0.18 (N-05): query and body shapes of the media library routes (`media.routes.ts`) */

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
