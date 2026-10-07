import { z } from 'zod';
import { numericIdString } from '../middleware/validate.js';

/** بدنه ثبت و ویرایش کالا (مسیرهای `POST /items` و `PUT /items/:id`) */
function itemBodyAliases(val: unknown): unknown {
  if (val && typeof val === 'object') {
    const copy = { ...(val as Record<string, unknown>) };
    // V2.0.0: alias — فرم کالا initial_cost می‌فرستد؛ به weighted_average_cost نگاشت شود
    if (copy.initial_cost !== undefined && copy.weighted_average_cost === undefined) {
      copy.weighted_average_cost = copy.initial_cost;
    }
    // V2.0.0: پشتیبانی از stocks به‌صورت شیء کلیددار (کلید = شناسه انبار) —
    // به کلیدهای stock_<warehouseId> تبدیل می‌شود (همان قرارداد قبلی بک‌اند)
    if (copy.stocks && typeof copy.stocks === 'object' && !Array.isArray(copy.stocks)) {
      for (const [whKey, val] of Object.entries(copy.stocks)) {
        const num = Number(val) || 0;
        if (num !== 0) {
          copy[`stock_${whKey}`] = num;
        }
      }
    }
    return copy;
  }
  return val;
}

const itemBodyFields = z.object({
  type: z.enum(['product', 'raw_material']).optional(),
  name: z.string().min(2, 'نام کالا باید حداقل ۲ کاراکتر باشد'),
  code: z.string().min(1, 'کد کالا الزامی است'),
  unit: z.string().min(1, 'واحد اندازه گیری الزامی است'),
  category: z.string().optional(),
  image: z.string().optional(),
  thumbnail: z.string().optional(),
  reorder_point: z.union([z.string(), z.number()]).optional(),
  weighted_average_cost: z.union([z.string(), z.number()]).optional(),
  initial_cost: z.union([z.string(), z.number()]).optional(),
  current_stock: z.union([z.string(), z.number()]).optional(),
  stocks: z.record(z.string(), z.any()).optional(),
  color: z.string().optional(),
  weight: z.union([z.string(), z.number()]).optional(),
  material: z.string().optional(),
  size: z.string().optional()
}).passthrough();

export const itemCreateUpdateSchema = z.object({
  body: z.preprocess(itemBodyAliases, itemBodyFields)
});

/** نسخه کالایی که فرم ویرایش از آن ساخته شده است (عدد صحیح مثبت؛ رشته عددی هم پذیرفته است) */
const itemVersion = z.coerce.number().int('نسخه کالا باید عدد صحیح باشد').positive('نسخه کالا باید مثبت باشد');

/**
 * v9.0.161 (TD-654، تصمیم ت۷ الف): ویرایش کالا نسخه کالایی را که فرم از آن ساخته شده می‌فرستد و قفل خوش‌بینانه همیشه
 * اجرا می‌شود، همان قرارداد طرف حساب (TD-403). پیش‌تر نسخه فقط افزایش می‌یافت و فرم کهنه تغییر کاربر دیگر را پاک می‌کرد.
 */
export const itemUpdateSchema = z.object({
  body: z.preprocess(itemBodyAliases, itemBodyFields.extend({ version: itemVersion.optional() }).refine(b => b.version !== undefined, {
    message: 'نسخه کالا ارسال نشده است؛ صفحه را بازخوانی کنید و دوباره ویرایش کنید.',
    path: ['version'],
  })),
  params: z.object({
    id: numericIdString
  })
});
