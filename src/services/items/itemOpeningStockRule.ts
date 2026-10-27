import { ForbiddenError, ValidationError } from '../../errors/customErrors.js';
import type { Money } from '../../lib/money.js';
import { OPENING_STOCK_PERMISSION } from '../../lib/permissions/stockActionPermissions.js';

/**
 * v11 phase 6.1j (S8, S9, card t56-5): opening stock enters only when an item is defined, by a user who may record a
 * receipt, and never at zero cost. Before, the item form took it with «تعریف کالا» alone, and an item entered at zero
 * cost had stock that no sale or remittance accepted. The Excel import already had both rules.
 */
export function assertOpeningStockAllowed(item: { name: string; code: string }, unitCost: Money, canEnterStock: boolean): void {
  if (!canEnterStock) {
    throw new ForbiddenError(
      `ثبت موجودی اول دوره هنگام تعریف کالا مجوز «ثبت ورود کالا (رسید)» را می‌خواهد. کالا را بی موجودی تعریف کنید و موجودی را `
        + 'کسی که این مجوز را دارد با رسید انبار ثبت کند.',
      { permissions: [OPENING_STOCK_PERMISSION] },
      'ITEM_OPENING_STOCK_NOT_ALLOWED',
    );
  }
  if (!unitCost.isPositive()) {
    throw new ValidationError(
      `کالای «${item.name}» (${item.code}) میانگین موزون بهای اولیه ندارد و موجودی بی‌بها وارد انبار نمی‌شود، چون چنین کالایی `
        + 'هیچ فروش یا حواله‌ای را نمی‌پذیرد. «میانگین موزون بهای اولیه» را بنویسید یا موجودی اول دوره را خالی بگذارید.',
      undefined,
      'ITEM_OPENING_WITHOUT_COST',
    );
  }
}

/** v11 phase 6.1j (S8, card t56-5): the edit of an item never takes opening stock; a receipt or a stock count does */
export function assertNoOpeningStockOnEdit(item: { name: string; code: string }): never {
  throw new ValidationError(
    `موجودی اول دوره فقط هنگام تعریف کالا ثبت می‌شود. برای کالای «${item.name}» (${item.code}) موجودی را با رسید انبار یا `
      + 'شمارش انبار ثبت کنید.',
    undefined,
    'ITEM_OPENING_ON_CREATE_ONLY',
  );
}
