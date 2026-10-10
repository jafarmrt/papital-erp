import { and, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documentItems, documents, items, warehouses } from '../../db/schema.js';
import { isReservingDocument } from '../../lib/documents/reservingDocuments.js';
import { fin, type DecimalValue, type FinancialDecimal } from '../../lib/financialDecimal.js';
import { InsufficientStockError, NotFoundError } from '../../errors/customErrors.js';
import { formatPersianNumber } from '../../utils/persianNumber.js';
import { createWarehouseResolver } from '../inventory/warehouseResolver.js';
import { ItemWarehouseStockService } from '../inventory/itemWarehouseStock.service.js';
import { ItemStockReservationService } from '../items/itemStockReservation.service.js';

/**
 * v9.0.239 (TD-775، یافته B08-06): گیت «قابل فروش = min(موجودی انبار، موجودی کل − رزرو دیگران)» (AGENTS §3) برای هر سند
 * خروجی که قطعی ثبت یا نهایی می‌شود، یک تابع برای `createDocumentWithDetails` و `finalizeDocument`.
 *
 * مقدار درخواستی هر (کالا، انبار) جمع زده و یک بار سنجیده می‌شود، موجودی و رزرو همه کالاهای سند یک‌جا و فقط برای همان
 * کالاها خوانده می‌شود، و خطای ساختن گزارش رزرو ثبت را رد می‌کند (fail-closed). پیش‌تر ثبت فقط وقتی گیت را اجرا می‌کرد که
 * `inOut: out` در بدنه آمده بود و هر دو مسیر هر ردیف را جدا با موجودی پیش از حلقه می‌سنجیدند: با قابل فروش ۴، فاکتور ۵ عددی
 * بی `inOut` و دو ردیف ۴ عددی یک کالا (در ثبت و در نهایی‌سازی) پذیرفته شدند و پیش‌فاکتور مشتری دیگر دیگر نهایی نشد.
 *
 * کالاها پیش از این تابع قفل شده‌اند (`lockStockItems` یا `withOrderedLocks`).
 */

export interface OutflowLine {
  itemId: number | string;
  quantity: unknown;
  location?: string | null;
}

export interface OutflowContext {
  /** انبار سربرگ سند، برای ردیفی که انبار ندارد */
  docLocation?: string | null;
  /** پیش‌فاکتوری که خودش نهایی می‌شود؛ رزرو خودش از رزرو دیگران کم می‌شود */
  excludeDocumentId?: number | null;
  /** رزرو همین پروژه برای حواله خروج همین پروژه آزاد است */
  projectId?: number | null;
}

interface Shortage {
  itemId: number;
  code: string;
  name: string;
  location: string;
  /** v10.0.114 (TD-1199): نام انبار برای پیام؛ کد انبار در `location` می‌ماند */
  locationName: string;
  requested: number;
  sellable: number;
  locationStock: number;
  reservedForOthers: number;
  /** رزروهای دیگری که قابل فروش را کم کرده‌اند */
  holders: string[];
}

const fa = (n: number) => formatPersianNumber(n, 4);

interface ShortageReport {
  shortages: Shortage[];
  units: Map<number, string>;
}

async function findSellableShortages(tx: DbExecutor, lines: OutflowLine[], ctx: OutflowContext): Promise<ShortageReport> {
  const resolveWh = await createWarehouseResolver(tx);
  const requested = new Map<string, { itemId: number; location: string; qty: FinancialDecimal }>();
  for (const line of lines) {
    const itemId = Number(line.itemId);
    const qty = fin((line.quantity ?? 0) as DecimalValue);
    if (!Number.isInteger(itemId) || itemId <= 0 || !qty.isPositive()) continue;
    const raw = line.location ? String(line.location).trim() : '';
    const location = resolveWh(raw || (ctx.docLocation ? String(ctx.docLocation).trim() : ''));
    const key = `${itemId}|${location}`;
    const prev = requested.get(key);
    requested.set(key, { itemId, location, qty: prev ? prev.qty.add(qty) : qty });
  }
  if (requested.size === 0) return { shortages: [], units: new Map() };

  const itemIds = Array.from(new Set(Array.from(requested.values(), r => r.itemId))).sort((a, b) => a - b);
  const itemRows = await tx
    .select({ id: items.id, code: items.code, name: items.name, unit: items.unit })
    .from(items)
    .where(and(inArray(items.id, itemIds), eq(items.isDeleted, 0)));
  const itemById = new Map(itemRows.map(row => [row.id, row]));
  const missing = itemIds.find(id => !itemById.has(id));
  if (missing !== undefined) throw new NotFoundError(`کالا با شناسه ${formatPersianNumber(missing, 0)} یافت نشد.`);

  const stocks = await ItemWarehouseStockService.getStocksForItems(tx, itemIds);
  const report = await ItemStockReservationService.getReservedStockDetails(tx, true, { itemIds });
  const summaryById = new Map(report.itemSummaries.map(s => [Number(s.itemId), s]));

  const shortages: Shortage[] = [];
  const units = new Map<number, string>();
  for (const { itemId, location, qty } of requested.values()) {
    const info = ItemStockReservationService.computeSellable(summaryById.get(itemId), stocks.get(itemId)?.byCode ?? {}, {
      location,
      excludeDocumentId: ctx.excludeDocumentId ?? undefined,
      projectId: ctx.projectId ?? null,
    });
    if (qty.greaterThan(info.sellable)) {
      const row = itemById.get(itemId)!;
      units.set(itemId, row.unit || 'عدد');
      const holders = (summaryById.get(itemId)?.reservations ?? [])
        .filter(r => !(r.sourceType === 'proforma' && ctx.excludeDocumentId && Number(r.sourceId) === ctx.excludeDocumentId))
        .filter(r => !(r.sourceType === 'project' && ctx.projectId && Number(r.sourceId) === ctx.projectId))
        .map(r => `«${r.sourceRef || r.sourceTitle}» (${fa(Number(r.reservedQty) || 0)})`);
      shortages.push({ itemId, code: row.code, name: row.name, location, locationName: location, requested: qty.toNumber(), holders, ...info });
    }
  }
  if (shortages.length > 0) {
    const names = new Map((await tx.select({ code: warehouses.code, name: warehouses.name }).from(warehouses))
      .map(w => [w.code, w.name] as const));
    for (const s of shortages) s.locationName = names.get(s.location)?.trim() || s.location;
  }
  return { shortages, units };
}

export async function assertOutflowWithinSellable(tx: DbExecutor, lines: OutflowLine[], ctx: OutflowContext = {}): Promise<void> {
  const { shortages, units } = await findSellableShortages(tx, lines, ctx);
  if (shortages.length === 0) return;

  const sentences = shortages.map(s => {
    const unit = units.get(s.itemId) ?? 'عدد';
    return `امکان خروج بیش از ${fa(s.sellable)} ${unit} برای کالا «${s.name}» (${s.code}) از انبار «${s.locationName}» وجود ندارد؛ `
      + `این سند ${fa(s.requested)} ${unit} می‌خواهد. موجودی انبار: ${fa(s.locationStock)}، رزرو سایر مصارف: ${fa(s.reservedForOthers)}`
      + `${s.holders.length > 0 ? ` (${s.holders.join('، ')})` : ''}، قابل فروش: ${fa(s.sellable)}.`;
  });
  throw new InsufficientStockError(sentences.join(' '), { shortages });
}

/**
 * v10.0.86 (TD-1138، تصمیم مالک محصول ت۱۴ «هشدار»): پیش‌فاکتور فروش ذخیره‌شده با همان قاعده قابل فروش سنجیده می‌شود، ولی
 * کمبود ذخیره را رد نمی‌کند: هر کالایی که بیش از قابل فروش انبارش خواسته شده یک جمله هشدار می‌گیرد و پاسخ ثبت و ویرایش آن
 * را به فرم می‌رساند. رزرو خود همین پیش‌فاکتور از رزرو دیگران کم می‌شود. سند دیگری (پیش‌نویس، قطعی، خرید) هشداری ندارد.
 * پیش‌تر پیش‌فاکتور بی هیچ سنجشی ذخیره می‌شد و کمبود فقط هنگام قطعی شدن دیده می‌شد.
 */
export async function proformaStockWarnings(tx: DbExecutor, documentId: number): Promise<string[]> {
  const [doc] = await tx.select({ type: documents.type, status: documents.status }).from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.isDeleted, 0)));
  if (!doc || !isReservingDocument(doc.type, doc.status)) return [];
  const lines = await tx.select({ itemId: documentItems.itemId, quantity: documentItems.quantity, location: documentItems.location })
    .from(documentItems)
    .where(and(eq(documentItems.documentId, documentId), eq(documentItems.isDeleted, 0)));
  const { shortages, units } = await findSellableShortages(tx, lines, { excludeDocumentId: documentId });
  return shortages.map(s => {
    const unit = units.get(s.itemId) ?? 'عدد';
    return `کالای «${s.name}» (${s.code}) در انبار «${s.locationName}»: این پیش‌فاکتور ${fa(s.requested)} ${unit} می‌خواهد و قابل فروش `
      + `${fa(s.sellable)} ${unit} است (موجودی انبار: ${fa(s.locationStock)}، رزرو سایر مصارف: ${fa(s.reservedForOthers)}`
      + `${s.holders.length > 0 ? `؛ ${s.holders.join('، ')}` : ''}).`;
  });
}
