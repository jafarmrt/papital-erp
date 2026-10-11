/**
 * v10.0.182 (OBS-R1-82): قرارداد فهرست کدهای ترنسفر، مشترک سرور و صفحه «کدهای ترنسفر».
 * `GET /transfers` یک صفحه از کدها (ذخیره‌شده یا آمده در کد کالاهای محصول) با کالاهای همان صفحه و خلاصه همه کدها
 * برمی‌گرداند؛ جست‌وجو و پالایش تصویر در پایگاه‌داده انجام می‌شود.
 */
export const TRANSFER_CODE_PAGE_SIZE = 12;
export const TRANSFER_CODE_MAX_PAGE_SIZE = 200;

export const TRANSFER_IMAGE_FILTERS = ['all', 'with_image', 'without_image'] as const;
export type TransferImageFilter = typeof TRANSFER_IMAGE_FILTERS[number];

export interface TransferCodeListFilters {
  page?: number;
  limit?: number;
  search?: string;
  image?: TransferImageFilter;
}

/** شمار همه کدها، بی جست‌وجو و پالایش: کارت‌های بالای صفحه و برچسب دکمه‌های پالایش */
export interface TransferCodeSummary {
  totalCodes: number;
  withImage: number;
  linkedProducts: number;
}

export interface TransferCodePage<Row> {
  data: Row[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  summary: TransferCodeSummary;
}

export function transferCodeListUrl(filters: TransferCodeListFilters): string {
  const params = new URLSearchParams();
  params.set('page', String(filters.page ?? 1));
  params.set('limit', String(filters.limit ?? TRANSFER_CODE_PAGE_SIZE));
  const search = (filters.search ?? '').trim();
  if (search) params.set('search', search);
  if (filters.image && filters.image !== 'all') params.set('image', filters.image);
  return `/transfers?${params.toString()}`;
}
