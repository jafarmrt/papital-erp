export interface DefaultCategory {
  name: string;
  prefix: string;
  type: 'product' | 'raw_material';
  defaultUnit: string;
}

/**
 * ۲۲ دسته استاندارد (AGENTS §9). پایگاه‌داده‌ای که هیچ دسته‌ای ندارد در بوت همین فهرست را می‌گیرد (v9.0.133، TD-591) و دکمه
 * «بازگردانی دسته‌های پیش‌فرض» هم از همین فهرست می‌خواند (v9.0.134، TD-526: پیش‌تر `GET /categories` در نصب تولیدی فهرست دیگری
 * با پیشوندهای خط‌تیره‌دار می‌نوشت).
 * پیشوند مواد اولیه خط تیره انتهایی ندارد تا کد کالا تک‌خط ساخته شود (V10-2.1).
 */
export const DEFAULT_CATEGORIES: readonly DefaultCategory[] = [
  // محصولات نهایی
  { name: 'گردنبند', prefix: 'N', type: 'product', defaultUnit: 'عدد' },
  { name: 'گوشواره میخی', prefix: 'S', type: 'product', defaultUnit: 'جفت' },
  { name: 'گوشواره آویز', prefix: 'E', type: 'product', defaultUnit: 'جفت' },
  { name: 'انگشتر', prefix: 'R', type: 'product', defaultUnit: 'عدد' },
  { name: 'دستبند', prefix: 'B', type: 'product', defaultUnit: 'عدد' },
  { name: 'گوشواره آویز بزرگ', prefix: 'E', type: 'product', defaultUnit: 'جفت' },
  { name: 'گردنبند بزرگ', prefix: 'N', type: 'product', defaultUnit: 'عدد' },
  { name: 'گوشواره دو تکه', prefix: 'E', type: 'product', defaultUnit: 'عدد' },
  { name: 'گردنبند دو تکه', prefix: 'N', type: 'product', defaultUnit: 'عدد' },

  // مواد اولیه
  { name: 'ترنسفر', prefix: 'T', type: 'raw_material', defaultUnit: 'برگ' },
  { name: 'مهره', prefix: 'B', type: 'raw_material', defaultUnit: 'ریسه' },
  { name: 'مهره کریستالی', prefix: 'B-C', type: 'raw_material', defaultUnit: 'ریسه' },
  { name: 'سنگ', prefix: 'S', type: 'raw_material', defaultUnit: 'ریسه' },
  { name: 'مهره حدید', prefix: 'B-H', type: 'raw_material', defaultUnit: 'ریسه' },
  { name: 'مهره چوبی', prefix: 'B-W', type: 'raw_material', defaultUnit: 'ریسه' },
  { name: 'خرج کار', prefix: 'M', type: 'raw_material', defaultUnit: 'عدد' },
  { name: 'خرج کار طلایی', prefix: 'M-G', type: 'raw_material', defaultUnit: 'عدد' },
  { name: 'خرج کار برنزی', prefix: 'M-B', type: 'raw_material', defaultUnit: 'عدد' },
  { name: 'خرج کار استیل', prefix: 'M-M', type: 'raw_material', defaultUnit: 'عدد' },
  { name: 'بند چرمی و زنجیر', prefix: 'C', type: 'raw_material', defaultUnit: 'متر' },
  { name: 'کیلر، رنگ، گلیز', prefix: 'G', type: 'raw_material', defaultUnit: 'عدد' },
  { name: 'سایر اقلام', prefix: 'O', type: 'raw_material', defaultUnit: 'عدد' },
];
