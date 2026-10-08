import { formatPersianNumber } from '../../utils/persianNumber';

/**
 * v9.0.323 (TD-724، B15-22): نتیجه «همگام‌سازی دسته‌ای موجودی» برای کاربر. پاسخ `/woocommerce/sync-all-stocks` همیشه
 * `success: true` است و شمار شکست‌ها را در `failedCount` و `errors[]` می‌آورد؛ زبانه ووکامرس پیش‌تر فقط پیام سبز سرور را
 * نشان می‌داد، حتی وقتی هیچ کالایی به‌روز نشده بود، و کاربر گمان می‌کرد موجودی فروشگاه درست است (خطر فروش بیش از موجودی).
 * اکنون هر شکست پیام خطا با شمار کالاها و نخستین خطاها می‌گیرد.
 */
export interface StockSyncResponse {
  totalItems?: number;
  syncedCount?: number;
  failedCount?: number;
  errors?: unknown;
}

export interface StockSyncOutcome {
  tone: 'success' | 'error';
  message: string;
}

/** شمار خطاهایی که در پیام می‌آیند؛ بقیه فقط شمرده می‌شوند */
export const STOCK_SYNC_ERRORS_SHOWN = 3;

function count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function stockSyncOutcome(res: StockSyncResponse): StockSyncOutcome {
  const total = count(res.totalItems);
  const synced = count(res.syncedCount);
  const errors = Array.isArray(res.errors) ? res.errors.map(e => String(e)).filter(e => e.trim() !== '') : [];
  const failed = Math.max(count(res.failedCount), errors.length);
  const notInShop = Math.max(0, total - synced - failed);
  const fa = (n: number) => formatPersianNumber(n);
  const notInShopText = notInShop > 0 ? ` ${fa(notInShop)} کالا با این کد در فروشگاه یافت نشد.` : '';
  if (failed === 0) {
    return { tone: 'success', message: `موجودی ${fa(synced)} کالا در فروشگاه به‌روز شد.${notInShopText}` };
  }
  const shown = errors.slice(0, STOCK_SYNC_ERRORS_SHOWN).join('؛ ');
  const more = errors.length > STOCK_SYNC_ERRORS_SHOWN ? ` و ${fa(errors.length - STOCK_SYNC_ERRORS_SHOWN)} خطای دیگر` : '';
  return {
    tone: 'error',
    message: `همگام‌سازی موجودی ${fa(failed)} کالا شکست خورد و موجودی این کالاها در فروشگاه به‌روز نیست؛ موجودی ${fa(synced)} کالا به‌روز شد.${notInShopText}${shown ? ` ${shown}${more}.` : ''}`,
  };
}
