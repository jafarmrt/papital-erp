import { z } from 'zod';
import { decimalInput, numericIdString } from '../middleware/validate.js';
import { fin } from '../lib/financialDecimal.js';
import { normalizeDecimalString } from '../lib/numericInput.js';

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
        // v9.0.173 (TD-657): ارقام فارسی خوانده می‌شوند؛ مقدار نامعتبر را اعتبارسنجی `stocks` با ۴۰۰ رد می‌کند
        const num = Number(normalizeDecimalString(String(val ?? ''))) || 0;
        if (num !== 0) {
          copy[`stock_${whKey}`] = num;
        }
      }
    }
    return copy;
  }
  return val;
}

/**
 * v9.0.173 (TD-657، بخش کالا): عددهای کالا با `decimalInput` خوانده می‌شوند (ارقام فارسی و جداکننده هزارگان پذیرفته، متن
 * خطای ۴۰۰) و نامنفی‌اند. پیش‌تر «abc» نقطه سفارش NaN و وزن «سبک» خطای ۵۰۰ می‌داد و «-۵» منفی ذخیره می‌شد.
 */
const nonNegativeDecimal = (label: string) =>
  decimalInput(label).refine(v => v === undefined || !fin(v).isNegative(), `${label} نمی‌تواند منفی باشد`);

const itemBodyFields = z.object({
  type: z.enum(['product', 'raw_material']).optional(),
  name: z.string().min(2, 'نام کالا باید حداقل ۲ کاراکتر باشد'),
  code: z.string().min(1, 'کد کالا الزامی است'),
  unit: z.string().min(1, 'واحد اندازه گیری الزامی است'),
  category: z.string().optional(),
  image: z.string().optional(),
  thumbnail: z.string().optional(),
  reorder_point: nonNegativeDecimal('نقطه سفارش').optional(),
  weighted_average_cost: nonNegativeDecimal('میانگین موزون بها').optional(),
  initial_cost: nonNegativeDecimal('بهای اولیه').optional(),
  current_stock: nonNegativeDecimal('موجودی').optional(),
  stocks: z.record(z.string(), nonNegativeDecimal('موجودی اولیه انبار').optional()).optional(),
  color: z.string().optional(),
  // null وزن را پاک می‌کند؛ نیامدن آن در ویرایش وزن فعلی را نگه می‌دارد
  weight: nonNegativeDecimal('وزن').nullable().optional(),
  material: z.string().optional(),
  size: z.string().optional()
}).passthrough();

export const itemCreateUpdateSchema = z.object({
  body: z.preprocess(itemBodyAliases, itemBodyFields)
});

/** نسخه کالایی که فرم ویرایش از آن ساخته شده است (عدد صحیح مثبت؛ رشته عددی هم پذیرفته است) */
const itemVersion = z.coerce.number().int('نسخه کالا باید عدد صحیح باشد').positive('نسخه کالا باید مثبت باشد');

/**
 * v9.0.171 (TD-654، تصمیم ت۷ الف): ویرایش کالا نسخه کالایی را که فرم از آن ساخته شده می‌فرستد و قفل خوش‌بینانه همیشه
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

/** v10.0.21 (TD-979): گرفتن شماره سری بعدی کد کالا؛ قالب سال، حرف دسته و پیشوند را سرویس می‌سنجد (422) */
export const consumeNextItemCodeSchema = z.object({
  body: z.object({
    type: z.enum(['product', 'raw_material']).optional(),
    year: z.union([z.string().max(20), z.number()]).transform(v => String(v)).optional(),
    prefix: z.string().max(40).optional(),
    transfer: z.string().max(60).optional(),
  }),
});
