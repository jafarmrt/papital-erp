import { fin, FinancialMath, type DecimalValue, type FinancialDecimal } from '../../lib/financialDecimal.js';

/**
 * v8.0.4 (TD-258): بازپخش WAC کاردکس دقیقاً با الگوریتم و ترتیب موتور زنده (DocumentStockEngine).
 *
 * پیش‌تر بازسازی کاردکس به ترتیب تاریخ اجرا می‌شد و رسید ابطال‌شده را کامل کنار می‌گذاشت؛ موتور زنده اما WAC را به
 * ترتیب ثبت حساب می‌کند و ابطال ورود را هنگام ابطال با کم کردن ارزش همان رسید اعمال می‌کند. نتیجه این بود که ابزار
 * تعمیر WAC سالمِ همخوان با دفتر کل را به عددی ناهمخوان تغییر می‌داد. این تابع همان گام‌های موتور زنده را بازپخش می‌کند:
 *
 * - ترتیب: شناسه ردیف (ترتیب ثبت)؛
 * - ورود: `FinancialMath.calculateWAC` (همان applyStockMovement)؛ خروج WAC را تغییر نمی‌دهد؛
 * - ردیف سند ابطال‌شده (is_deleted = 1 با ردیف معکوس فعال) در جای خود اعمال می‌شود و ردیف معکوس آن با فرمول
 *   `applyStockReversal`: برگشتِ ورود ارزش همان ردیف را از ارزش انبار کم می‌کند، برگشتِ خروج فقط مقدار را برمی‌گرداند؛
 * - انتقال بین انبارها (documentType = 'transfer') و ردیف‌های معکوس قدیمی فقط مقدار را جابه‌جا می‌کنند.
 *
 * ردیف حذف‌شده بدون ردیف معکوس فعال (حذف‌های پیش از DB-009) نادیده گرفته می‌شود، مانند دفتر کاردکس (§12).
 */
export interface KardexReplayRow {
  id: number;
  type: string;
  quantity: DecimalValue;
  unitPrice: DecimalValue | null;
  documentType: string | null;
  documentRef: string | null;
  reversalOfId: number | null;
  isDeleted: number | null;
}

export interface KardexReplayResult {
  /** مانده کل پس از بازپخش */
  balance: FinancialDecimal;
  /** WAC پس از بازپخش؛ اگر به صفر یا کمتر برسد WAC شروع حفظ می‌شود (TD-136) */
  wac: FinancialDecimal;
  /** شناسه نخستین ردیفی که مانده کل را به ترتیب ثبت منفی کرد */
  firstNegativeRowId: number | null;
  /** کمترین مانده کل در طول بازپخش */
  minimumBalance: FinancialDecimal;
}

const isInType = (type: string) => type === 'in' || type === 'transfer_in';
const isOutType = (type: string) => type === 'out' || type === 'transfer_out';

export function replayKardexWac(rows: KardexReplayRow[], startWac: DecimalValue): KardexReplayResult {
  const sorted = [...rows].sort((a, b) => a.id - b.id);
  const byId = new Map(sorted.map(r => [r.id, r]));
  const activelyReversed = new Set<number>();
  for (const r of sorted) {
    if (r.isDeleted !== 1 && r.reversalOfId !== null) activelyReversed.add(r.reversalOfId);
  }

  let balance = fin(0);
  let wac = fin(startWac);
  let minimumBalance = fin(0);
  let firstNegativeRowId: number | null = null;

  for (const row of sorted) {
    const isIn = isInType(row.type);
    const isOut = isOutType(row.type);
    if (!isIn && !isOut) continue;
    if (row.isDeleted === 1 && !activelyReversed.has(row.id)) continue;
    if (row.isDeleted === 1 && row.reversalOfId !== null) continue;

    const qty = fin(row.quantity);
    const unitPrice = fin(row.unitPrice ?? 0);
    const original = row.reversalOfId !== null ? byId.get(row.reversalOfId) : undefined;
    const quantityOnly = (row.reversalOfId !== null && original?.isDeleted !== 1)
      || String(row.documentRef ?? '').startsWith('REV-')
      || row.documentType === 'transfer';

    if (original && original.isDeleted === 1) {
      // ابطال سند: همان فرمول DocumentStockEngine.applyStockReversal
      if (isOut) {
        const newBalance = balance.subtract(qty);
        if (newBalance.isPositive()) {
          const remainingValue = balance.multiply(wac).subtract(qty.multiply(unitPrice));
          if (!remainingValue.isNegative()) wac = remainingValue.divide(newBalance).round(4);
        }
        balance = newBalance;
      } else {
        balance = balance.add(qty);
      }
    } else if (isIn) {
      if (!quantityOnly) wac = FinancialMath.calculateWAC(balance, wac, qty, unitPrice);
      balance = balance.add(qty);
    } else {
      balance = balance.subtract(qty);
    }

    if (balance.lessThan(minimumBalance)) minimumBalance = balance;
    if (balance.isNegative() && firstNegativeRowId === null) firstNegativeRowId = row.id;
  }

  return {
    balance,
    wac: wac.lessThanOrEqual(0) ? fin(startWac) : wac,
    firstNegativeRowId,
    minimumBalance,
  };
}
