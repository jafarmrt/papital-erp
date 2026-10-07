/**
 * قالب کد کالای تازه، مشترک میان ورود اکسل سرور و پیش‌نمایش مرورگر (v9.0.117، TD-650؛ پیش‌تر الگوی کد ماده اولیه مرورگر
 * `/^[A-Za-z\-]+-\d{3}$/` با سرور فرق داشت). کد کالای موجود از اکسل عوض نمی‌شود و این قالب برای آن سنجیده نمی‌شود.
 */
export const PRODUCT_CODE_PATTERN = /^\d{4}-[A-Za-z]+-\d{3}-\d{2}$/;
/** V10-2.1: قالب تک‌خط جدید (B-H-101) + سازگاری با داده تاریخی دوخط‌تیره (B-H--101) */
export const RAW_MATERIAL_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9-]*-{1,2}\d{2,3}$/;

/** کد کالا با قالب نوع خودش؛ پیام خطا یا null */
export function codeFormatError(code: string, itemType: 'product' | 'raw_material', category: string): string | null {
  const isProductType = itemType === 'product' || category.includes('محصول');
  if (isProductType) {
    if (!PRODUCT_CODE_PATTERN.test(code)) {
      return `فرمت کد محصول نهایی نامعتبر است (الگوی صحیح: nnnn-x-nnn-nn). کد ارسال شده: ${code}`;
    }
  } else if (!RAW_MATERIAL_CODE_PATTERN.test(code)) {
    return `فرمت کد ماده اولیه نامعتبر است (الگوی صحیح: PREFIX-NNN مانند B-H-101). کد ارسال شده: ${code}`;
  }
  return null;
}
