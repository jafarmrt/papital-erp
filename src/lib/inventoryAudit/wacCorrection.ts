/**
 * v9.0.77 (TD-487، تصمیم مالک محصول ت۳): «بازسازی موجودی از کاردکس» فقط مقدار را می‌سازد و WAC را تغییر نمی‌دهد؛
 * کالایی که WAC آن با بازپخش کاردکس نمی‌خواند فهرست می‌شود و «اصلاح بهای میانگین» عملی جداست با همین مجوز (پیش‌فرض به
 * هیچ نقشی داده نمی‌شود، مدیر سیستم همیشه دارد) و سند پیش‌نویس اختلاف ارزش در برابر «کسری و اضافات انبار». سرور و صفحه
 * هر دو همین کلید را می‌خوانند.
 */
export const WAC_CORRECTION_PERMISSION = 'inventory.wac_correct';

/** کالای با WAC ناهمخوان با بازپخش کاردکس (پاسخ بازسازی) */
export interface KardexWacDifferenceRow {
  itemId: number;
  itemCode: string;
  itemName: string;
  stock: number;
  recordedWac: number;
  replayWac: number;
  valueDifference: number;
}

interface RebuildResponseLike {
  wacDifferences?: unknown;
  wacDiffers?: unknown;
  itemId?: unknown;
  itemCode?: unknown;
  itemName?: unknown;
  newStock?: unknown;
  oldWac?: unknown;
  replayWac?: unknown;
  valueDifference?: unknown;
}

/** فهرست ناهمخوانی‌های WAC از پاسخ بازسازی همه کالاها یا یک کالا */
export function wacDifferencesOf(result: RebuildResponseLike | null | undefined): KardexWacDifferenceRow[] {
  if (!result) return [];
  if (Array.isArray(result.wacDifferences)) return result.wacDifferences as KardexWacDifferenceRow[];
  if (result.wacDiffers !== true) return [];
  return [{
    itemId: Number(result.itemId),
    itemCode: String(result.itemCode ?? ''),
    itemName: String(result.itemName ?? ''),
    stock: Number(result.newStock ?? 0),
    recordedWac: Number(result.oldWac ?? 0),
    replayWac: Number(result.replayWac ?? 0),
    valueDifference: Number(result.valueDifference ?? 0),
  }];
}
