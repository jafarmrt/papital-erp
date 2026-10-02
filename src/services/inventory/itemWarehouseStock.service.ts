import { eq, and, asc, inArray } from 'drizzle-orm';
import { itemWarehouseStocks, warehouses, items } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { ValidationError, InsufficientStockError } from '../../errors/customErrors.js';
import type { DbExecutor } from '../../db/drizzle.js';

export type DbClient = DbExecutor;

export interface WarehouseInfo {
  id: number;
  code: string;
  name: string;
}

export class ItemWarehouseStockService {
  /**
   * Resolves raw warehouse input (code, name, id or empty) to standard WarehouseInfo.
   */
  public static async resolveWarehouse(tx: DbClient, raw?: unknown): Promise<WarehouseInfo> {
    const allWarehouses = await tx
      .select({ id: warehouses.id, code: warehouses.code, name: warehouses.name })
      .from(warehouses)
      .where(eq(warehouses.isActive, 1))
      .orderBy(asc(warehouses.id)); // v7.0.36 (P2-3): پیش‌فرض قطعی = انبار فعال با کمترین شناسه

    if (allWarehouses.length === 0) {
      throw new ValidationError('هیچ انبار فعالی در سیستم تعریف نشده است.');
    }

    const input = String(raw ?? '').trim();
    if (!input) {
      return allWarehouses[0];
    }

    const lower = input.toLowerCase();
    const byCode = allWarehouses.find(w => w.code.toLowerCase() === lower);
    if (byCode) return byCode;

    const byName = allWarehouses.find(w => w.name.trim().toLowerCase() === lower);
    if (byName) return byName;

    const byId = allWarehouses.find(w => String(w.id) === input);
    if (byId) return byId;

    throw new ValidationError(`انبار با مشخصه «${input}» تعریف نشده یا غیرفعال است.`);
  }

  /**
   * Applies stock movement directly on the normalized item_warehouse_stocks table under row lock.
   */
  public static async applyMovement(
    tx: DbClient,
    params: {
      itemId: number;
      warehouse: WarehouseInfo;
      inOut: 'in' | 'out';
      quantity: number;
    }
  ): Promise<{ newLocationStock: number; previousLocationStock: number }> {
    const { itemId, warehouse, inOut, quantity } = params;
    const qty = Number(quantity);

    if (!Number.isFinite(qty) || qty <= 0) {
      throw new ValidationError(`مقدار گردش انبار باید عددی مثبت باشد: ${quantity}`);
    }

    // v7.0.35 (audit P2-2): ردیف (کالا × انبار) ابتدا با INSERT ... ON CONFLICT DO NOTHING تضمین و سپس قفل
    // سطری واقعی گرفته می‌شود. پیش‌تر SELECT ... FOR UPDATE روی ردیف ناموجود قفلی نمی‌گرفت و دو تراکنش همزمانِ
    // اولین حرکت یک کالا در یک انبار هر دو INSERT می‌کردند و یکی با خطای 23505 شکست می‌خورد.
    const { row: existing, created } = await ItemWarehouseStockService.lockOrCreateRow(tx, itemId, warehouse);

    // v7.0.45 (audit P2-1): این جدول تنها منبع موجودی هر انبار است؛ ردیف تازه با صفر شروع می‌شود و دیگر از کش
    // JSONB مقدار اولیه نمی‌گیرد (ردیف‌های جاافتاده داده قدیمی را مهاجرت 0020 ساخته است).
    const previousLocationStock = Number(existing.currentStock || 0);
    let newLocationStock: number;

    if (inOut === 'in') {
      newLocationStock = fin(previousLocationStock).add(qty).round(4).toNumber();
    } else {
      // v7.0.22 (TD-180 / audit P0-3): منفی شدن موجودی همیشه ممنوع است (هم‌راستا با قید
      // دیتابیسی chk_iws_current_stock_non_negative)؛ پیام خوانا به‌جای خطای ۵۰۰ نقض قید.
      if (previousLocationStock < qty) {
        throw new InsufficientStockError(
          `موجودی کافی در انبار «${warehouse.name}» (${warehouse.code}) نیست. موجودی فعلی: ${previousLocationStock}، درخواست کسر: ${qty}`
        );
      }
      newLocationStock = fin(previousLocationStock).subtract(qty).round(4).toNumber();
    }

    await tx
      .update(itemWarehouseStocks)
      .set({
        currentStock: newLocationStock,
        warehouseCode: warehouse.code,
        version: created ? existing.version : existing.version + 1,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(itemWarehouseStocks.id, existing.id));

    return { newLocationStock, previousLocationStock };
  }

  /**
   * v7.0.35 (audit P2-2): ردیف موجودی (کالا × انبار) را در صورت نبود با موجودی صفر درج می‌کند (ON CONFLICT DO
   * NOTHING روی ایندکس یکتای idx_item_warehouse_unique) و سپس آن را FOR UPDATE قفل می‌کند. درج همزمان تا پایان
   * تراکنش اول منتظر می‌ماند، پس فراخوان دوم همیشه ردیف commitشده و قفل واقعی را می‌گیرد. `created` یعنی ردیف
   * در همین تراکنش ساخته شد و مقدار اولیه آن هنوز تعیین نشده است.
   */
  private static async lockOrCreateRow(
    tx: DbClient,
    itemId: number,
    warehouse: WarehouseInfo
  ): Promise<{ row: typeof itemWarehouseStocks.$inferSelect; created: boolean }> {
    const nowIso = new Date().toISOString();
    const inserted = await tx
      .insert(itemWarehouseStocks)
      .values({
        itemId,
        warehouseId: warehouse.id,
        warehouseCode: warehouse.code,
        currentStock: 0,
        reservedStock: 0,
        version: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .onConflictDoNothing({ target: [itemWarehouseStocks.itemId, itemWarehouseStocks.warehouseId] })
      .returning({ id: itemWarehouseStocks.id });

    const [row] = await tx
      .select()
      .from(itemWarehouseStocks)
      .where(and(
        eq(itemWarehouseStocks.itemId, itemId),
        eq(itemWarehouseStocks.warehouseId, warehouse.id)
      ))
      .for('update');

    return { row, created: inserted.length > 0 };
  }

  /**
   * v7.0.45 (audit P2-1): موجودی فعلی کالا در هر انبار، فقط از جدول نرمال (منبع حقیقت) با کد استاندارد انبار
   * (از جدول انبارها، نه ستون کپی warehouse_code که در مهاجرت 0014 گاهی نام انبار گرفته است).
   */
  public static async getStockSnapshot(tx: DbClient, itemId: number): Promise<StockSnapshot> {
    const map = await ItemWarehouseStockService.getStocksForItems(tx, [itemId]);
    return map.get(itemId) ?? { byCode: {}, total: 0 };
  }

  /** نسخه دسته‌ای getStockSnapshot برای حلقه‌های سند (بدون N+1) */
  public static async getStocksForItems(tx: DbClient, itemIds: number[]): Promise<Map<number, StockSnapshot>> {
    const ids = Array.from(new Set(itemIds.filter(id => Number.isInteger(id) && id > 0)));
    const result = new Map<number, StockSnapshot>();
    if (ids.length === 0) return result;
    const rows = await tx
      .select({
        itemId: itemWarehouseStocks.itemId,
        code: warehouses.code,
        currentStock: itemWarehouseStocks.currentStock,
      })
      .from(itemWarehouseStocks)
      .innerJoin(warehouses, eq(warehouses.id, itemWarehouseStocks.warehouseId))
      .where(inArray(itemWarehouseStocks.itemId, ids))
      .orderBy(asc(itemWarehouseStocks.warehouseId));
    const totals = new Map<number, ReturnType<typeof fin>>();
    for (const id of ids) {
      result.set(id, { byCode: {}, total: 0 });
      totals.set(id, fin(0));
    }
    for (const r of rows) {
      const snap = result.get(r.itemId)!;
      const val = fin(Number(r.currentStock) || 0).round(4).toNumber();
      snap.byCode[r.code] = fin(snap.byCode[r.code] ?? 0).add(val).round(4).toNumber();
      totals.set(r.itemId, totals.get(r.itemId)!.add(val));
    }
    for (const [id, total] of totals) {
      result.get(id)!.total = total.round(4).toNumber();
    }
    return result;
  }

  /**
   * کش خواندنی JSONB (items.stocks) و موجودی کل (items.current_stock) را از جدول نرمال بازسازی و ذخیره می‌کند.
   * v7.0.45 (audit P2-1): هیچ مسیری مستقیم در این دو ستون نمی‌نویسد؛ هر تغییر موجودی پس از اعمال روی جدول نرمال
   * همین تابع را صدا می‌زند (یا مقدار getStockSnapshot را در همان UPDATE می‌نویسد).
   */
  public static async syncJsonbReadCache(
    tx: DbClient,
    itemId: number
  ): Promise<{ stocksJson: Record<string, number>; totalStock: number }> {
    const snapshot = await ItemWarehouseStockService.getStockSnapshot(tx, itemId);
    await tx
      .update(items)
      .set({
        stocks: snapshot.byCode,
        currentStock: snapshot.total,
      })
      .where(eq(items.id, itemId));
    return { stocksJson: snapshot.byCode, totalStock: snapshot.total };
  }

  /**
   * موجودی همه انبارهای یک کالا را به مقادیر داده‌شده (کلید: شناسه انبار) تنظیم می‌کند؛ ردیف انبارهایی که در
   * نقشه نیستند صفر می‌شوند (بازسازی کاردکس: دفتر کاردکس مرجع است). مقدار منفی پذیرفته نمی‌شود.
   */
  public static async setItemWarehouseStocks(
    tx: DbClient,
    itemId: number,
    qtyByWarehouseId: Map<number, number>
  ): Promise<void> {
    for (const [whId, qty] of qtyByWarehouseId) {
      if (!Number.isFinite(qty) || qty < 0) {
        throw new ValidationError(`موجودی کالای ${itemId} در انبار ${whId} نمی‌تواند منفی یا نامعتبر باشد (${qty}).`);
      }
    }
    const allWarehouses = await tx
      .select({ id: warehouses.id, code: warehouses.code, name: warehouses.name })
      .from(warehouses);
    const whById = new Map(allWarehouses.map(w => [w.id, w]));
    const existingRows = await tx
      .select({ warehouseId: itemWarehouseStocks.warehouseId })
      .from(itemWarehouseStocks)
      .where(eq(itemWarehouseStocks.itemId, itemId));
    const targetIds = new Set<number>([...qtyByWarehouseId.keys(), ...existingRows.map(r => r.warehouseId)]);
    const nowIso = new Date().toISOString();

    for (const whId of [...targetIds].sort((a, b) => a - b)) {
      const wh = whById.get(whId);
      if (!wh) continue;
      const stockNum = fin(qtyByWarehouseId.get(whId) ?? 0).round(4).toNumber();
      const { row: existing, created } = await ItemWarehouseStockService.lockOrCreateRow(tx, itemId, wh);
      await tx
        .update(itemWarehouseStocks)
        .set({
          currentStock: stockNum,
          warehouseCode: wh.code,
          version: created ? existing.version : existing.version + 1,
          updatedAt: nowIso,
        })
        .where(eq(itemWarehouseStocks.id, existing.id));
    }
  }
}

export interface StockSnapshot {
  /** موجودی هر انبار با کد استاندارد انبار */
  byCode: Record<string, number>;
  total: number;
}
