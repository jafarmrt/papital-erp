/**
 * قالب کد کالای تازه، مشترک میان ورود اکسل سرور و پیش‌نمایش مرورگر (v9.0.155، TD-650؛ پیش‌تر الگوی کد ماده اولیه مرورگر
 * `/^[A-Za-z\-]+-\d{3}$/` با سرور فرق داشت). کد کالای موجود از اکسل عوض نمی‌شود و این قالب برای آن سنجیده نمی‌شود.
 */
export const PRODUCT_CODE_PATTERN = /^\d{4}-[A-Za-z]+-\d{3}-\d{2}$/;
/** V10-2.1: قالب تک‌خط جدید (B-H-101) + سازگاری با داده تاریخی دوخط‌تیره (B-H--101) */
export const RAW_MATERIAL_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9-]*-{1,2}\d{2,3}$/;

/** راهنمای قالب هر نوع کد، مشترک پیام سرور و پیش‌نمایش مرورگر (v9.0.203، TD-664: «قالب» به‌جای «فرمت»، بی نشانه انگلیسی) */
export const PRODUCT_CODE_FORMAT_HINT = 'کد محصول نهایی باید سال، حرف دسته، شماره ترنسفر سه‌رقمی و شماره سری دورقمی باشد، مانند 1404-N-101-01';
export const RAW_MATERIAL_CODE_FORMAT_HINT = 'کد ماده اولیه باید پیشوند دسته و شماره دو یا سه‌رقمی باشد، مانند B-H-101';

/** کد کالا با قالب نوع خودش؛ پیام خطا یا null */
export function codeFormatError(code: string, itemType: 'product' | 'raw_material', category: string): string | null {
  const isProductType = itemType === 'product' || category.includes('محصول');
  if (isProductType) {
    if (!PRODUCT_CODE_PATTERN.test(code)) {
      return `قالب کد درست نیست؛ ${PRODUCT_CODE_FORMAT_HINT}. کد فرستاده‌شده: ${code}`;
    }
  } else if (!RAW_MATERIAL_CODE_PATTERN.test(code)) {
    return `قالب کد درست نیست؛ ${RAW_MATERIAL_CODE_FORMAT_HINT}. کد فرستاده‌شده: ${code}`;
  }
  return null;
}
