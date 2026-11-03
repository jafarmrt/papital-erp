/** Public facts of the brand that every page shows; nothing here is a secret or a server detail */
export const BRAND = {
  name: 'پاپیتال',
  fullName: 'گالری پاپیتال',
  tagline: 'زیورآلات دست‌ساز با نقش کاشی‌های ایران',
  instagram: 'https://www.instagram.com/papital.gallery/',
  instagramHandle: 'papital.gallery',
} as const;

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
