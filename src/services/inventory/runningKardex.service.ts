import { orm } from '../../db/drizzle.js';
import { items, transactions, users, warehouses } from '../../db/schema.js';
import { eq, asc, sql } from 'drizzle-orm';
import { fin, FinancialMath } from '../../lib/financialDecimal.js';
import { createLedgerLocationResolver } from './warehouseResolver.js';
import { createKardexReplayer } from './kardexReplay.js';
import { NotFoundError } from '../../errors/customErrors.js';
import {
  RUNNING_KARDEX_MAX_PAGE_SIZE, RUNNING_KARDEX_PAGE_SIZE, runningKardexEntryMatches,
  type RunningKardexOpening, type RunningKardexQuery,
} from '../../lib/transactions/runningKardex.js';

export interface RunningKardexEntry {
  transactionId: number;
  date: string;
  type: 'in' | 'out' | 'transfer';
  documentType: string;
  documentRef: string;
  location: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  runningBalance: number;
  runningLocationStock: number;
  runningGlobalStock: number;
  runningWac: number;
  runningTotalValue: number;
  notes: string;
  createdBy: string;
  reversalOfId?: number | null;
  isReversal?: boolean;
  /** v8.0.7 (TD-266): ردیف اصلی سند ابطال‌شده؛ در تاریخ خودش گردش داشته و ردیف معکوس آن در تاریخ ابطال می‌آید */
  isVoided?: boolean;
}

/**
 * V10-0.2: Full kardex envelope. Previously this endpoint returned a bare
 * array while the frontend modal expected { item, summary, entries } —
 * dereferencing data.item.name on an array crashed React (white screen).
 */
export interface RunningKardexResponse {
  item: {
    id: number;
    code: string;
    name: string;
    unit: string;
    category: string | null;
    type: string | null;
    currentStock: number;
    weightedAverageCost: number;
  };
  summary: {
    totalIn: number;
    totalOut: number;
    netBalance: number;
    transactionCount: number;
    valuation: number;
  };
  entries: RunningKardexEntry[];
}

/**
 * کاردکس تفصیلی یک کالا (GET /inventory/item-kardex/:itemId) به ترتیب تاریخ.
 *
 * v8.0.7 (TD-266، تصمیم مالک محصول): سند ابطال‌شده با برچسب نشان داده می‌شود. ردیف اصلی آن در تاریخ خودش (`isVoided`)
 * و ردیف معکوس در تاریخ ابطال (`isReversal`) می‌آیند و مانده جاری هر دو را حساب می‌کند. پیش‌تر ردیف اصلی حذف‌شده کنار
 * گذاشته می‌شد ولی ردیف معکوس می‌آمد، پس پس از ابطال یک فاکتور ۳ عددی مانده پایانی ۱۳ بود در حالی که موجودی ۱۰ است.
 * جمع ورود و خروج فقط گردش‌های واقعی (دفتر §12، بدون سند ابطال‌شده و معکوسش) را می‌شمارد.
 *
 * ترتیب نمایش و مانده جاری: (روز، ترتیب ثبت)، همان ترتیب قاعده تاریخ TD-257. WAC هر ردیف همان WAC موتور زنده بلافاصله
 * پس از ثبت آن ردیف است (`createKardexReplayer` به ترتیب ثبت)، چون معکوسِ ابطال در تاریخ ابطال می‌آید و ممکن است پس از
 * سندهایی بیاید که بعد از ابطال ثبت شده‌اند؛ ارزش‌گذاری خلاصه با WAC فعلی کالا. مانده هر انبار با همان نگاشت محل
 * کاردکس (`createLedgerLocationResolver`).
 */
export async function buildItemRunningKardex(itemId: number): Promise<RunningKardexResponse> {
  const [item] = await orm
    .select({
      id: items.id,
      code: items.code,
      name: items.name,
      unit: items.unit,
      category: items.category,
      type: items.type,
      currentStock: items.currentStock,
      weightedAverageCost: items.weightedAverageCost,
    })
    .from(items)
    .where(eq(items.id, itemId));
  // v9.0.81 (TD-494): کاردکس کالای ناموجود ۴۰۴ است؛ پیش‌تر کالایی ساختگی («کالای <شناسه>»، کد «-») برمی‌گشت
  if (!item) throw new NotFoundError(`کالا با شناسه ${itemId} یافت نشد.`);
  const defaultWac = fin(item?.weightedAverageCost || 0).toNumber();

  const allTxs = await orm
    .select()
    .from(transactions)
    .where(eq(transactions.itemId, itemId))
    .orderBy(sql`${transactions.date}::date`, asc(transactions.id));
  const replayer = createKardexReplayer(allTxs, 0);
  const deletedIds = new Set(allTxs.filter(t => t.isDeleted === 1).map(t => t.id));
  // WAC موتور زنده پس از هر ردیف، به ترتیب ثبت
  const wacAfterRow = new Map<number, number>();
  for (const tx of [...allTxs].sort((a, b) => a.id - b.id)) {
    const step = replayer.apply(tx);
    if (step) wacAfterRow.set(tx.id, step.wac.toNumber());
  }

  // یک موجودیت هویت کاربر: resolve نام کامل کاربر از جدول users برای نمایش یکدست
  const allUsers = await orm.select({ username: users.username, fullName: users.fullName }).from(users);
  const userFullNameMap = new Map(allUsers.map(u => [u.username, u.fullName]));
  const allWarehouses = await orm.select({ id: warehouses.id, code: warehouses.code, name: warehouses.name, isActive: warehouses.isActive })
    .from(warehouses);
  const resolveLocation = createLedgerLocationResolver(allWarehouses);

  let runningBal = 0;
  const locationRunning: Record<string, number> = {};
  let totalIn = 0;
  let totalOut = 0;
  const entries: RunningKardexEntry[] = [];

  for (const tx of allTxs) {
    if (!replayer.counts(tx)) continue;
    const runningWac = wacAfterRow.get(tx.id) ?? 0;

    const qty = fin(tx.quantity).toNumber();
    const txPrice = Number(tx.unitPrice) || 0;
    const isVoided = replayer.isVoidedOriginal(tx);
    const isReversal = Boolean(tx.reversalOfId) || (Boolean(tx.documentRef) && tx.documentRef!.startsWith('REV-'));
    const isIn = tx.type === 'in' || tx.type === 'transfer_in';
    // جمع ورود و خروج فقط گردش‌های واقعی: بدون سند ابطال‌شده و ردیف معکوس آن
    const inLedger = !isVoided && !(tx.reversalOfId !== null && deletedIds.has(tx.reversalOfId));
    if (inLedger) {
      if (isIn) totalIn = FinancialMath.add(totalIn, qty);
      else totalOut = FinancialMath.add(totalOut, qty);
    }
    runningBal = isIn ? FinancialMath.add(runningBal, qty) : FinancialMath.subtract(runningBal, qty);

    const wh = resolveLocation(tx.location);
    const loc = wh ? wh.code : (tx.location || '');
    locationRunning[loc] = isIn ? FinancialMath.add(locationRunning[loc] ?? 0, qty) : FinancialMath.subtract(locationRunning[loc] ?? 0, qty);

    const rowWac = runningWac > 0 ? runningWac : defaultWac;
    const effectiveUnitPrice = txPrice > 0 ? txPrice : rowWac;

    entries.push({
      transactionId: tx.id,
      date: tx.date || '',
      type: (isIn ? 'in' : 'out'),
      documentType: tx.documentType || '',
      documentRef: tx.documentRef || '',
      location: loc,
      quantity: qty,
      unitPrice: effectiveUnitPrice,
      totalAmount: FinancialMath.multiply(qty, effectiveUnitPrice),
      runningBalance: runningBal,
      runningLocationStock: locationRunning[loc],
      runningGlobalStock: runningBal,
      runningWac: rowWac,
      runningTotalValue: FinancialMath.multiply(runningBal, rowWac),
      notes: tx.notes || '',
      createdBy: userFullNameMap.get(tx.createdBy || '') || tx.createdBy || 'سیستم',
      reversalOfId: tx.reversalOfId,
      isReversal,
      isVoided,
    });
  }

  return {
    item: {
      id: Number(item?.id || itemId),
      code: item?.code || '-',
      name: item?.name || `کالای ${itemId}`,
      unit: item?.unit || 'عدد',
      category: item?.category ?? null,
      type: item?.type ?? null,
      currentStock: fin(item?.currentStock || 0).toNumber(),
      weightedAverageCost: defaultWac,
    },
    summary: {
      totalIn,
      totalOut,
      netBalance: runningBal,
      transactionCount: entries.length,
      valuation: FinancialMath.multiply(runningBal, defaultWac),
    },
    entries,
  };
}

/** v11 phase 6.1ch (S11): one page of the Kardex window (`src/lib/transactions/runningKardex.ts`) */
export interface RunningKardexPage extends RunningKardexResponse {
  opening: RunningKardexOpening | null;
  locations: string[];
  total: number;
  page: number;
  limit: number;
}

/**
 * v11 phase 6.1ch (S11): the Kardex window's page. The running balances and WAC need the whole ledger in registration
 * order, so it is replayed here as before, but only the rows of the range (`from`, `to`, by day) that pass the filters
 * leave the server, a page at a time (`export`: all of them). The range opens with the balance, WAC and value at the end
 * of the day before `from`; the summary stays the item's whole ledger.
 */
export async function buildItemRunningKardexPage(
  itemId: number,
  query: RunningKardexQuery & { limit?: number; exportAll?: boolean },
): Promise<RunningKardexPage> {
  const full = await buildItemRunningKardex(itemId);
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const limit = Math.min(RUNNING_KARDEX_MAX_PAGE_SIZE, Math.max(1, Math.trunc(query.limit ?? RUNNING_KARDEX_PAGE_SIZE)));
  const dayOf = (entry: RunningKardexEntry) => entry.date.slice(0, 10);

  let opening: RunningKardexOpening | null = null;
  if (query.from) {
    const before = full.entries.filter(entry => dayOf(entry) < query.from!).at(-1);
    opening = {
      date: query.from,
      runningBalance: before?.runningBalance ?? 0,
      runningWac: before?.runningWac ?? 0,
      runningTotalValue: before?.runningTotalValue ?? 0,
    };
  }
  const matching = full.entries.filter(entry => (!query.from || dayOf(entry) >= query.from)
    && (!query.to || dayOf(entry) <= query.to)
    && runningKardexEntryMatches(entry, query));
  const locations = [...new Set(full.entries.map(entry => entry.location).filter(Boolean))];

  return {
    ...full,
    entries: query.exportAll ? matching : matching.slice((page - 1) * limit, page * limit),
    opening,
    locations,
    total: matching.length,
    page: query.exportAll ? 1 : page,
    limit: query.exportAll ? Math.max(matching.length, 1) : limit,
  };
}
