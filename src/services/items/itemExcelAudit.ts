import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { items, itemPrices } from '../../db/schema.js';
import { computeAuditDiff, logActivity } from '../../lib/auditLogger.js';
import { ItemWarehouseStockService } from '../inventory/itemWarehouseStock.service.js';

/**
 * v9.0.158 (TD-655): ممیزی ورود اکسل کالا. هر کالای ساخته یا تغییرکرده یک ردیف ممیزی با مقدار قبل و بعد مشخصات،
 * موجودی هر انبار و قیمت هر فهرست می‌گیرد و یک ردیف جمع‌بندی برای کل فایل نوشته می‌شود، همه درون تراکنش ورود
 * (AGENTS §19). پیش‌تر فقط دو ردیف با شمارش‌ها و `details: {}` بیرون از تراکنش نوشته می‌شد.
 */
export type ItemAuditSnapshot = Record<string, unknown>;

/** تصویر یک کالا برای ممیزی: مشخصات، `موجودی <کد انبار>` و `قیمت <عنوان>` (مبلغ و ارز) */
export async function itemAuditSnapshot(tx: DbExecutor, itemId: number): Promise<ItemAuditSnapshot> {
  const [it] = await tx.select().from(items).where(eq(items.id, itemId));
  const stock = await ItemWarehouseStockService.getStockSnapshot(tx, itemId);
  const prices = await tx.select({ title: itemPrices.title, price: itemPrices.price, currency: itemPrices.currency })
    .from(itemPrices).where(and(eq(itemPrices.itemId, itemId), eq(itemPrices.isDeleted, 0)));
  const snap: ItemAuditSnapshot = {
    name: it.name,
    code: it.code,
    type: it.type,
    unit: it.unit,
    category: it.category,
    reorderPoint: it.reorderPoint,
    weightedAverageCost: it.weightedAverageCost?.toNumber() ?? 0,
    color: it.color,
    size: it.size,
    weight: it.weight,
    material: it.material,
    image: it.image,
  };
  for (const [code, qty] of Object.entries(stock.byCode)) {
    if (qty !== 0) snap[`موجودی ${code}`] = qty;
  }
  for (const p of prices) snap[`قیمت ${p.title}`] = `${p.price.toString()} ${p.currency || 'IRR'}`;
  return snap;
}

export interface ItemImportAuditActor {
  id?: number;
  username?: string;
  full_name?: string;
  ipAddress?: string;
}

function actorFields(actor: ItemImportAuditActor) {
  return {
    userId: actor.id,
    username: actor.username || 'سیستم',
    userFullName: actor.full_name || '',
    ipAddress: actor.ipAddress,
  };
}

/** ردیف ممیزی یک کالای اکسل؛ کالای موجود بی تغییر ردیفی نمی‌گیرد */
export async function logItemImportChange(
  tx: DbExecutor,
  actor: ItemImportAuditActor,
  itemId: number,
  rowNum: number,
  before: ItemAuditSnapshot | null,
  after: ItemAuditSnapshot,
): Promise<void> {
  if (before === null) {
    await logActivity({
      ...actorFields(actor),
      tx,
      action: 'CREATE',
      entity: 'کالا',
      entityId: itemId,
      description: `تعریف کالای «${after.name}» با کد «${after.code}» از ورود اکسل (ردیف ${rowNum})`,
      details: { after, source: 'excel_import', row: rowNum },
    });
    return;
  }
  const { diff, hasChanges } = computeAuditDiff(before, after);
  if (!hasChanges) return;
  await logActivity({
    ...actorFields(actor),
    tx,
    action: 'UPDATE',
    entity: 'کالا',
    entityId: itemId,
    description: `ویرایش کالای «${after.name}» (کد ${after.code}) از ورود اکسل (ردیف ${rowNum}): ${Object.keys(diff).join('، ')}`,
    details: { before, after, changes: diff, source: 'excel_import', row: rowNum },
  });
}

export interface ItemImportSummary {
  rows: number;
  createdCount: number;
  updatedCount: number;
  pricesCount: number;
  errorCount: number;
  stockAdjustmentMovements: number;
  /** v9.0.206 (TD-663): سند افتتاحیه کل فایل و تعداد کالاهای آن */
  openingVoucherId?: number | null;
  openingItems?: number;
}

/** ردیف جمع‌بندی ورود، درون همان تراکنش */
export async function logItemImportSummary(tx: DbExecutor, actor: ItemImportAuditActor, summary: ItemImportSummary): Promise<void> {
  await logActivity({
    ...actorFields(actor),
    tx,
    action: 'IMPORT',
    entity: 'ورود اطلاعات اکسل',
    description: `ورود جامع اطلاعات از اکسل (${summary.rows} ردیف): ${summary.createdCount} کالای جدید، ${summary.updatedCount} کالای به‌روزرسانی شده، ${summary.pricesCount} قیمت و ${summary.errorCount} خطا.`,
    details: { ...summary },
  });
}
