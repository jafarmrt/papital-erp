/**
 * v10.0.33 (OBS-R1-79): صفحه قیمت‌گذاری یک صفحه از کالاها را با قیمت‌های همان کالاها و فهرست‌های قیمت از سرور می‌خواند
 * (`GET /items/pricing-page`)؛ پیش‌تر همه کالاها (`limit=0`)، همه قیمت‌ها و همه تنظیمات جدا خوانده می‌شد و پالایش و
 * صفحه‌بندی در مرورگر بود. پالایش «قیمت کامل / ناقص» بر قیمت‌های ذخیره‌شده است: کالایی کامل است که هر فهرست قیمت
 * تنظیم‌شده یک قیمت بزرگ‌تر از صفر دارد. این فایل مشترک سرور و صفحه است.
 */
export const PRICING_PAGE_SIZE = 50;
export const PRICING_PAGE_MAX_LIMIT = 200;
export const PRICING_PRICE_FILTERS = ['all', 'missing_price', 'has_price'] as const;
export type PricingPriceFilter = typeof PRICING_PRICE_FILTERS[number];

export interface PricingPageQuery {
  type: 'product' | 'raw_material';
  search?: string;
  category?: string;
  priceFilter?: PricingPriceFilter;
  page?: number;
  limit?: number;
  /** همه کالاهای پالایش بی صفحه‌بندی، برای خروجی اکسل و ورود سریع */
  all?: boolean;
}

export interface PricingPageItem {
  id: number;
  code: string;
  name: string;
  category?: string;
  unit: string;
  type: 'product' | 'raw_material';
  current_stock: number;
  weighted_average_cost: number;
}

export interface PricingPagePrice {
  id: number;
  itemId: number;
  title: string;
  price: number | string;
  currency: string | null;
  [key: string]: unknown;
}

export interface PricingPage {
  data: PricingPageItem[];
  /** قیمت‌های فعال کالاهای همین صفحه، به تفکیک شناسه کالا */
  prices: Record<number, PricingPagePrice[]>;
  /** عنوان فهرست‌های قیمت تنظیم‌شده */
  strategies: string[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function pricingPageUrl(q: PricingPageQuery): string {
  const params = new URLSearchParams({ type: q.type });
  if (q.search?.trim()) params.set('search', q.search.trim());
  if (q.category) params.set('category', q.category);
  if (q.priceFilter && q.priceFilter !== 'all') params.set('priceFilter', q.priceFilter);
  if (q.all) params.set('all', 'true');
  else {
    params.set('page', String(q.page ?? 1));
    params.set('limit', String(q.limit ?? PRICING_PAGE_SIZE));
  }
  return `/items/pricing-page?${params.toString()}`;
}
