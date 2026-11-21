// v12 phase 10a: the brand's name, motto and Instagram page were fixed here; they now come from the ERP's «اطلاعات
// فروشگاه» (`shopInfo.ts`), with the same words while a field is empty.

export const SORT_TITLES = {
  default: 'پیشنهاد ما',
  newest: 'تازه‌ترین',
  price_asc: 'ارزان‌ترین',
  price_desc: 'گران‌ترین',
} as const;

export const productPath = (slug: string) => `/p/${slug}`;
export const collectionPath = (name: string) => `/collections/${encodeURIComponent(name)}`;
export const categoryPath = (name: string) => `/products?category=${encodeURIComponent(name)}`;
export const mediaPath = (sha256: string, thumb = false) => `/media/${sha256}${thumb ? '-thumb' : ''}.webp`;
/** v11 phase 8.5b: a «صفحهٔ ویژه» (a campaign page); its slug is lowercase Latin, so it needs no encoding */
export const campaignPath = (slug: string) => `/campaigns/${slug}`;
