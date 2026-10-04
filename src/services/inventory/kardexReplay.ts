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
 *   `applyStockReversal`: برگشتِ ورود ارزش همان ردیف را از ارزش انبار کم می‌کند، برگشتِ خروج (از v8.0.11، TD-254) کالا
 *   را با بهای همان خروج برمی‌گرداند و WAC را بازمحاسبه می‌کند — بازسازی این قاعده را بر ابطال‌های قدیمی‌تر هم اعمال
 *   می‌کند و WAC آن کالاها را با دفتر کل (که بهای اصلی را برگردانده بود) همخوان می‌کند؛
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

/**
 * v8.0.7 (TD-266): بازپخش گام‌به‌گام با همان فرمول‌ها، برای گزارش‌هایی که ردیف‌ها را به ترتیب دیگری (مثلاً تاریخ)
 * نشان می‌دهند. `apply` برای ردیفی که در دفتر اثری ندارد (حذف‌شده بی‌معکوس، معکوسِ حذف‌شده، نوع ناشناخته) null می‌دهد.
 */
export function createKardexReplayer(allRows: KardexReplayRow[], startWac: DecimalValue) {
  const byId = new Map(allRows.map(r => [r.id, r]));
  const activelyReversed = new Set<number>();
  for (const r of allRows) {
    if (r.isDeleted !== 1 && r.reversalOfId !== null) activelyReversed.add(r.reversalOfId);
  }
  let balance = fin(0);
  let wac = fin(startWac);

  const counts = (row: KardexReplayRow): boolean => {
    if (!isInType(row.type) && !isOutType(row.type)) return false;
    if (row.isDeleted === 1 && !activelyReversed.has(row.id)) return false;
    return !(row.isDeleted === 1 && row.reversalOfId !== null);
  };

  const apply = (row: KardexReplayRow): { balance: FinancialDecimal; wac: FinancialDecimal } | null => {
    if (!counts(row)) return null;
    const isIn = isInType(row.type);
    const qty = fin(row.quantity);
    const unitPrice = fin(row.unitPrice ?? 0);
    const original = row.reversalOfId !== null ? byId.get(row.reversalOfId) : undefined;
    const quantityOnly = (row.reversalOfId !== null && original?.isDeleted !== 1)
      || String(row.documentRef ?? '').startsWith('REV-')
      || row.documentType === 'transfer';

    if (original && original.isDeleted === 1) {
      // ابطال سند: همان فرمول DocumentStockEngine.applyStockReversal
      if (!isIn) {
        const newBalance = balance.subtract(qty);
        if (newBalance.isPositive()) {
          const remainingValue = balance.multiply(wac).subtract(qty.multiply(unitPrice));
          if (!remainingValue.isNegative()) wac = remainingValue.divide(newBalance).round(4);
        }
        balance = newBalance;
      } else {
        // v8.0.11 (TD-254): برگشتِ خروج با بهای همان خروج و بازمحاسبه WAC (applyStockReversal)
        wac = FinancialMath.calculateWAC(balance, wac, qty, unitPrice);
        balance = balance.add(qty);
      }
    } else if (isIn) {
      if (!quantityOnly) wac = FinancialMath.calculateWAC(balance, wac, qty, unitPrice);
      balance = balance.add(qty);
    } else {
      balance = balance.subtract(qty);
    }
    return { balance, wac };
  };

  return { apply, counts, isVoidedOriginal: (row: KardexReplayRow) => row.isDeleted === 1 && activelyReversed.has(row.id) };
}

export function replayKardexWac(rows: KardexReplayRow[], startWac: DecimalValue): KardexReplayResult {
  const sorted = [...rows].sort((a, b) => a.id - b.id);
  const replayer = createKardexReplayer(sorted, startWac);
  let balance = fin(0);
  let wac = fin(startWac);
  let minimumBalance = fin(0);
  let firstNegativeRowId: number | null = null;

  for (const row of sorted) {
    const step = replayer.apply(row);
    if (!step) continue;
    balance = step.balance;
    wac = step.wac;
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
