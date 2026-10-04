import { eq, and, desc, ilike, asc } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { items, itemPrices, warehouses, itemCodeCounters, documentItems, transactions, journalVouchers } from '../../db/schema.js';
import { logActivity } from '../../lib/auditLogger.js';
import { uploadBase64ToStorage } from '../../lib/storage.js';
import { normalizeStrategyTitle, getStrategyCanonicalKey } from '../../utils.js';
import { ItemPricingService } from './itemPricing.service.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { ValidationError, NotFoundError, ConflictError } from '../../errors/customErrors.js';
import { DocumentService } from '../document.service.js';
import { resolveWarehouseCode, getDefaultWarehouseCode } from '../inventory/warehouseResolver.js';
import { nextVersion } from '../../lib/occHelper.js';
import { ItemOpeningService } from '../inventory/itemOpening.service.js';
import { syncStockAdjustmentVoucher } from '../accounting/stockAdjustmentVoucher.js';
import { ItemWarehouseStockService } from '../inventory/itemWarehouseStock.service.js';
import { WorkflowEngineService } from '../workflow/workflowEngineService.js';
import { startsWithLikePattern } from '../../lib/sqlLike.js';
import { money } from '../../lib/money.js';

// V10-2.1: تایپ کلاینت اتصال DB برای تراکنش‌های داخلی
type DbLike = DbExecutor;

export interface NextItemCodeInput {
  type?: string;
  year?: string;
  prefix?: string;
  transfer?: string;
}

export interface NextItemCodeResult {
  type: 'product' | 'raw_material';
  code: string;
  serial: string;
  year?: string;
  catPrefix?: string;
  transfer?: string;
  prefix?: string;
}

/**
 * بدنه ایجاد/ویرایش کالا (خروجی itemCreateUpdateSchema مسیر کالا با passthrough)؛
 * کلیدهای پویای stock_<کد انبار> نیز در همین شیء می‌آیند.
 */
export interface ItemWriteBody {
  [key: string]: unknown;
  type?: string;
  name: string;
  code: string;
  unit: string;
  category?: string;
  image?: string;
  thumbnail?: string;
  reorder_point?: string | number;
  weighted_average_cost?: string | number;
  initial_cost?: string | number;
  current_stock?: string | number;
  stocks?: Record<string, unknown>;
  color?: string;
  weight?: string | number;
  material?: string;
  size?: string;
}

function cleanSegment(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/^-+|-+$/g, '');
}

export class ItemCatalogService {
  /**
   * V10-2.1: نرمال‌سازی segmentهای کد محصول و ساخت الگوی پایه + کلید شمارنده
   */
  private static resolveProductContext(input: NextItemCodeInput) {
    const year = cleanSegment(input.year);
    const catPrefix = cleanSegment(input.prefix);
    const transfer = cleanSegment(input.transfer);

    if (!/^\d{4}$/.test(year)) {
      throw new ValidationError('سال طراحی باید عددی چهاررقمی باشد.');
    }
    if (!catPrefix) {
      throw new ValidationError('حرف کد دسته‌بندی الزامی است.');
    }
    if (!transfer) {
      throw new ValidationError('کد ترنسفر الزامی است.');
    }

    return {
      base: `${year}-${catPrefix}-${transfer}-`,
      counterKey: `${year}|${catPrefix}|${transfer}`,
      year,
      catPrefix,
      transfer,
      pad: 2 as const
    };
  }

  /**
   * V10-2.1: نرمال‌سازی پیشوند ماده اولیه (حذف dash انتهایی — رفع دوخط‌تیره B-H--101)
   */
  private static resolveRawContext(input: NextItemCodeInput) {
    const prefix = cleanSegment(input.prefix);
    if (!prefix || !/^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$/.test(prefix)) {
      throw new ValidationError(`پیشوند کد ماده اولیه نامعتبر است: «${prefix}»`);
    }
    return { prefix, counterKey: prefix, pad: 3 as const };
  }

  /**
   * Cold-start scan: حداکثر شماره سری موجود روی کدهای فعلی (فقط یک‌بار برای seed اولیه شمارنده)
   */
  private static async getMaxExistingSerial(db: DbLike, type: 'product' | 'raw_material', ctx: { base?: string; prefix?: string }): Promise<number> {
    let maxNum = 0;
    if (type === 'product') {
      const rows = await db
        .select({ code: items.code })
        .from(items)
        .where(ilike(items.code, startsWithLikePattern(String(ctx.base))));
      for (const r of rows) {
        const tail = String(r.code).slice(String(ctx.base).length).replace(/[^0-9].*$/, '');
        const n = parseInt(tail, 10);
        if (!isNaN(n) && n > maxNum) maxNum = n;
      }
    } else {
      const rows = await db
        .select({ code: items.code })
        .from(items)
        .where(ilike(items.code, startsWithLikePattern(String(ctx.prefix))));
      for (const r of rows) {
        // هم سازگار با داده قدیمی دوخط‌تیره (B-H--101) و هم قالب جدید تک‌خط (B-H-101)
        let tail = String(r.code).slice(String(ctx.prefix!).length).replace(/^-+/, '');
        tail = tail.replace(/[^0-9].*$/, '');
        const n = parseInt(tail, 10);
        if (!isNaN(n) && n > maxNum) maxNum = n;
      }
    }
    return maxNum;
  }

  private static assembleCode(type: 'product' | 'raw_material', ctx: { pad: number; base?: string; prefix?: string }, serialNum: number): string {
    const serial = String(serialNum).padStart(ctx.pad, '0');
    if (type === 'product') {
      return `${ctx.base}${serial}`;
    }
    return `${ctx.prefix}-${serial}`;
  }

  static async peekNextItemCode(input: NextItemCodeInput): Promise<NextItemCodeResult> {
    const itemType = input.type === 'raw_material' ? 'raw_material' : 'product';

    if (itemType === 'product') {
      const ctx = ItemCatalogService.resolveProductContext(input);
      const [counter] = await orm
        .select()
        .from(itemCodeCounters)
        .where(and(
          eq(itemCodeCounters.scope, itemType),
          eq(itemCodeCounters.prefixKey, ctx.counterKey)
        ));
      let nextNum: number;
      if (counter) {
        nextNum = Number(counter.lastNumber) + 1;
      } else {
        const maxNum = await ItemCatalogService.getMaxExistingSerial(orm, itemType, { base: ctx.base });
        nextNum = maxNum + 1;
      }
      return {
        type: itemType,
        code: ItemCatalogService.assembleCode(itemType, ctx, nextNum),
        serial: String(nextNum).padStart(ctx.pad, '0'),
        year: ctx.year, catPrefix: ctx.catPrefix, transfer: ctx.transfer
      };
    }

    const rawCtx = ItemCatalogService.resolveRawContext(input);
    const [counter] = await orm
      .select()
      .from(itemCodeCounters)
      .where(and(
        eq(itemCodeCounters.scope, itemType),
        eq(itemCodeCounters.prefixKey, rawCtx.counterKey)
      ));
    let nextNumRaw: number;
    if (counter) {
      nextNumRaw = Number(counter.lastNumber) + 1;
    } else {
      const maxNum = await ItemCatalogService.getMaxExistingSerial(orm, itemType, { prefix: rawCtx.prefix });
      nextNumRaw = maxNum + 1;
    }
    return {
      type: itemType,
      code: ItemCatalogService.assembleCode(itemType, rawCtx, nextNumRaw),
      serial: String(nextNumRaw).padStart(rawCtx.pad, '0'),
      prefix: rawCtx.prefix
    };
  }

  /**
   * V10-2.1: تخصیص اتمیک شماره سری بعدی — الگوی قفل سطر شمارنده + UPSERT RETURNING
   * (مشابه DocumentService.getNextRef؛ ورودی‌ها فقط فیلدهای غیرتناقض‌آمیز، بدون raw SQL bind)
   */
  static async consumeNextItemCode(input: NextItemCodeInput): Promise<NextItemCodeResult> {
    const itemType = input.type === 'raw_material' ? 'raw_material' : 'product';

    // نرمال‌سازی بیرون از tx تا خطاهای validation قبل از باز کردن تراکنش پرتاب شوند
    if (itemType === 'product') {
      const ctx = ItemCatalogService.resolveProductContext(input);
      const nextNum = await orm.transaction(async (tx: DbLike) =>
        ItemCatalogService.consumeCounterRow(tx, itemType, ctx.counterKey, () =>
          ItemCatalogService.getMaxExistingSerial(tx, itemType, { base: ctx.base })
        )
      );
      return {
        type: itemType,
        code: ItemCatalogService.assembleCode(itemType, ctx, nextNum),
        serial: String(nextNum).padStart(ctx.pad, '0'),
        year: ctx.year, catPrefix: ctx.catPrefix, transfer: ctx.transfer
      };
    }

    const rawCtx = ItemCatalogService.resolveRawContext(input);
    const nextNumRaw = await orm.transaction(async (tx: DbLike) =>
      ItemCatalogService.consumeCounterRow(tx, itemType, rawCtx.counterKey, () =>
        ItemCatalogService.getMaxExistingSerial(tx, itemType, { prefix: rawCtx.prefix })
      )
    );
    return {
      type: itemType,
      code: ItemCatalogService.assembleCode(itemType, rawCtx, nextNumRaw),
      serial: String(nextNumRaw).padStart(rawCtx.pad, '0'),
      prefix: rawCtx.prefix
    };
  }

  private static async consumeCounterRow(
    tx: DbLike,
    scope: 'product' | 'raw_material',
    counterKey: string,
    coldStartScan: () => Promise<number>
  ): Promise<number> {
    // Lock only the specific counter row for (scope, prefixKey)
    const [counter] = await tx
      .select()
      .from(itemCodeCounters)
      .where(and(
        eq(itemCodeCounters.scope, scope),
        eq(itemCodeCounters.prefixKey, counterKey)
      ))
      .for('update');

    if (counter) {
      const nextNum = Number(counter.lastNumber) + 1;
      await tx
        .update(itemCodeCounters)
        .set({ lastNumber: nextNum })
        .where(and(
          eq(itemCodeCounters.scope, scope),
          eq(itemCodeCounters.prefixKey, counterKey)
        ));
      return nextNum;
    }

    // Cold-start atomic seeding: INSERT ... ON CONFLICT DO NOTHING eliminates the MAX()+1 race
    const scanMax = await coldStartScan();
    const seedNum = Math.max(scanMax + 1, 1);

    const inserted = await tx
      .insert(itemCodeCounters)
      .values({ scope, prefixKey: counterKey, lastNumber: seedNum })
      .onConflictDoNothing({
        target: [itemCodeCounters.scope, itemCodeCounters.prefixKey]
      })
      .returning({ lastNumber: itemCodeCounters.lastNumber });

    if (inserted.length > 0) {
      return Number(inserted[0].lastNumber);
    }

    // A concurrent transaction seeded the counter first — lock and increment atomically
    const [retryCounter] = await tx
      .select()
      .from(itemCodeCounters)
      .where(and(
        eq(itemCodeCounters.scope, scope),
        eq(itemCodeCounters.prefixKey, counterKey)
      ))
      .for('update');
    const nextNum = Number(retryCounter?.lastNumber || 0) + 1;
    await tx
      .update(itemCodeCounters)
      .set({ lastNumber: nextNum })
      .where(and(
        eq(itemCodeCounters.scope, scope),
        eq(itemCodeCounters.prefixKey, counterKey)
      ));
    return nextNum;
  }

  /**
   * Computes the next product code based on year, prefix, and transfer parameters.
   */
  static async getNextProductCode(year?: string, prefix?: string, transfer?: string): Promise<string> {
    // V10-2.1: delegate to atomic peek logic (no more ilike-scan MAX()+1)
    const result = await ItemCatalogService.peekNextItemCode({ type: 'product', year, prefix, transfer });
    return result.code;
  }

  /**
   * Generates formatted rows for Excel export including warehouse stocks and pricing strategy columns.
   */
  static async processUnifiedExport(typeFilter?: string) {
    const whs = await orm.select().from(warehouses).orderBy(asc(warehouses.id));
    const configuredStrategies = await ItemPricingService.getPricingStrategies();

    const conditions = [eq(items.isDeleted, 0)];
    if (typeFilter === 'product' || typeFilter === 'raw_material') {
      conditions.push(eq(items.type, typeFilter));
    }

    const fetchedItems = await orm.select().from(items).where(and(...conditions)).orderBy(desc(items.id));
    // v7.0.48 (TD-214): موجودی هر انبار از جدول نرمال
    const exportStockMap = await ItemWarehouseStockService.getStocksForItems(orm, fetchedItems.map(i => i.id));
    const allPrices = await orm.select().from(itemPrices).where(eq(itemPrices.isDeleted, 0));

    const priceMap = new Map<number, Map<string, { price: number; currency: string }>>();
    const normalizedToRawMap = new Map<string, string>();

    configuredStrategies.forEach(s => {
      const cleanRaw = (s || '').trim();
      if (!cleanRaw) return;
      const norm = normalizeStrategyTitle(cleanRaw);
      if (norm && !normalizedToRawMap.has(norm)) {
        normalizedToRawMap.set(norm, cleanRaw);
      }
    });

    for (const pr of allPrices) {
      const cleanRaw = (pr.title || '').trim();
      if (!cleanRaw) continue;
      const norm = normalizeStrategyTitle(cleanRaw);
      const canKey = getStrategyCanonicalKey(cleanRaw);

      if (!priceMap.has(pr.itemId)) {
        priceMap.set(pr.itemId, new Map());
      }
      const itemMap = priceMap.get(pr.itemId)!;
      const priceObj = { price: Number(pr.price), currency: pr.currency || 'IRR' };
      itemMap.set(cleanRaw, priceObj);
      itemMap.set(norm, priceObj);
      if (canKey) itemMap.set(canKey, priceObj);
    }

    const normalizedStrategies = Array.from(normalizedToRawMap.keys());

    const exportRows = fetchedItems.map(it => {
      const itemPriceObj = priceMap.get(it.id);
      const row: Record<string, unknown> = {
        'کد کالا': it.code,
        'نام محصول': it.name,
        'نوع کالا': it.type === 'product' ? 'محصول نهایی' : 'ماده اولیه',
        'دسته‌بندی': it.category || '',
        'واحد': it.unit,
        'موجودی کل': Number(it.currentStock || 0),
      };

      const st = exportStockMap.get(it.id)?.byCode ?? {};
      for (const w of whs) {
        row[`موجودی انبار ${w.name}`] = Number(st[w.code] || 0);
      }

      row['حد نقطه سفارش (آلارم کسری)'] = Number(it.reorderPoint || 0);
      row['قیمت میانگین خرید (WAC)'] = Number(it.weightedAverageCost || 0);

      let itemCurrency = 'IRR';
      for (const normStrat of normalizedStrategies) {
        const canKey = getStrategyCanonicalKey(normStrat);
        const prVal = itemPriceObj?.get(normStrat) || (canKey ? itemPriceObj?.get(canKey) : undefined);
        const numPrice = prVal && prVal.price !== undefined && prVal.price !== null && !isNaN(Number(prVal.price)) && Number(prVal.price) > 0 ? Number(prVal.price) : '';
        row[`قیمت ${normStrat}`] = numPrice;
        if (prVal?.currency && prVal.currency !== 'IRR') {
          itemCurrency = prVal.currency;
        }
      }

      row['واحد ارز'] = itemCurrency;
      row['تصویر'] = it.image || '';
      row['رنگ'] = it.color || '';
      row['سایز'] = it.size || '';
      row['وزن'] = it.weight ? Number(it.weight) : '';
      row['جنس'] = it.material || '';

      return row;
    });

    return {
      rows: exportRows,
      warehouses: whs,
      strategies: normalizedStrategies.map(s => `قیمت ${s}`)
    };
  }

  /**
   * Processes Excel bulk import rows for items, stock logs, and pricing levels.
   */
  static async processUnifiedImport(
    rows: Array<Record<string, unknown>>,
    typeFilter: string | undefined,
    req: { user?: { id?: number; username?: string; full_name?: string } }
  ) {
    const whs = await orm.select().from(warehouses).orderBy(asc(warehouses.id));
    // v7.0.36 (P2-3): انبار پیش‌فرض قطعی (انبار فعال با کمترین شناسه)
    const importDefaultWhCode = (await getDefaultWarehouseCode(orm)) ?? whs[0]?.code ?? 'main';
    const strategies = await ItemPricingService.getPricingStrategies();

    let createdCount = 0;
    let updatedCount = 0;
    let pricesCount = 0;
    const errors: Array<{ row: number; name?: string; code?: string; message: string }> = [];
    // v8.0.3 (TD-262): ردیف‌های کاردکس اصلاح موجودی کالاهای موجود، برای یک سند حسابداری «کسری و اضافات انبار»
    const adjustmentTransactionIds: number[] = [];

    await orm.transaction(async (tx) => {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;

        const rawCode = row['کد کالا'] || row['کد'] || row['code'] || row['Code'];
        const rawName = row['نام محصول'] || row['نام کالا'] || row['نام'] || row['name'] || row['Name'];

        if (!rawCode && !rawName) {
          errors.push({ row: rowNum, message: 'نام یا کد کالا در این ردیف نامشخص است.' });
          continue;
        }

        const code = String(rawCode || '').trim();
        const name = String(rawName || '').trim();

        let rawType = row['نوع کالا'] || row['نوع'] || row['type'];
        let itemType: 'product' | 'raw_material' = 'product';
        if (rawType === 'ماده اولیه' || rawType === 'raw_material' || typeFilter === 'raw_material') {
          itemType = 'raw_material';
        } else if (rawType === 'محصول نهایی' || rawType === 'product' || typeFilter === 'product') {
          itemType = 'product';
        }

        const category = String(row['دسته‌بندی'] || row['دسته'] || row['category'] || '').trim();
        const unit = String(row['واحد'] || row['واحد اندازه‌گیری'] || row['unit'] || 'عدد').trim();
        const reorderPoint = Number(row['حد نقطه سفارش (آلارم کسری)'] || row['حد نقطه سفارش'] || row['نقطه سفارش'] || row['reorder_point'] || 0);
        const weightedAverageCost = Number(row['قیمت میانگین خرید (WAC)'] || row['قیمت میانگین خرید (WAC - ریال)'] || row['قیمت میانگین خرید'] || row['ارزش خرید'] || row['weighted_average_cost'] || 0);
        const image = String(row['تصویر'] || row['آدرس عکس'] || row['image'] || '').trim();
        const color = String(row['رنگ'] || row['color'] || '').trim();
        const size = String(row['سایز'] || row['size'] || '').trim();
        const weight = row['وزن'] || row['weight'] ? Number(row['وزن'] || row['weight']) : null;
        const material = String(row['جنس'] || row['material'] || '').trim();

        const defaultWhCode = importDefaultWhCode;
        const stockValues: Record<string, number> = {};
        let computedStock = 0;
        let hasCustomStockInRow = false;

        for (const w of whs) {
          const val = row[`موجودی انبار ${w.name}`] ?? row[`موجودی ${w.name}`] ?? row[w.name] ?? row[`stock_${w.code}`];
          if (val !== undefined && val !== '' && !isNaN(Number(val))) {
            stockValues[w.code] = Number(val);
            computedStock += Number(val);
            hasCustomStockInRow = true;
          }
        }

        const currentStock = Number(row['موجودی کل'] || row['موجودی فعلی'] || row['موجودی']) || computedStock;

        const totalWhStock = Object.values(stockValues).reduce((a, b) => a + Number(b || 0), 0);
        if (totalWhStock === 0 && currentStock > 0) {
          stockValues[defaultWhCode] = currentStock;
          hasCustomStockInRow = true;
        }

        let matchedItem: typeof items.$inferSelect | null = null;
        if (code) {
          const [byCode] = await tx.select().from(items)
            .where(and(eq(items.code, code), eq(items.isDeleted, 0)))
            .for('update');
          if (byCode) matchedItem = byCode;
        }

        if (!matchedItem && name) {
          const [byName] = await tx.select().from(items)
            .where(and(eq(items.name, name), eq(items.isDeleted, 0)))
            .for('update');
          if (byName) matchedItem = byName;
        }

        if (!code) {
          errors.push({ row: rowNum, name, code, message: 'کد کالا نامعتبر است (خالی می‌باشد).' });
          continue;
        }

        const isProductType = itemType === 'product' || category.includes('محصول');
        if (isProductType) {
          const productRegex = /^\d{4}-[A-Za-z]+-\d{3}-\d{2}$/;
          if (!productRegex.test(code)) {
            errors.push({ row: rowNum, name, code, message: `فرمت کد محصول نهایی نامعتبر است (الگوی صحیح: nnnn-x-nnn-nn). کد ارسال شده: ${code}` });
            continue;
          }
        } else {
          // V10-2.1: قالب تک‌خط جدید (B-H-101) + سازگاری با داده تاریخی دوخط‌تیره (B-H--101)
          const rawRegex = /^[A-Za-z][A-Za-z0-9\-]*-{1,2}\d{2,3}$/;
          if (!rawRegex.test(code)) {
            errors.push({ row: rowNum, name, code, message: `فرمت کد ماده اولیه نامعتبر است (الگوی صحیح: PREFIX-NNN مانند B-H-101). کد ارسال شده: ${code}` });
            continue;
          }
        }

        if (name) {
          const [nameConflict] = await tx.select().from(items)
            .where(and(eq(items.name, name), eq(items.isDeleted, 0)))
            .for('update');
          if (nameConflict && matchedItem && nameConflict.id !== matchedItem.id) {
            errors.push({
              row: rowNum,
              name,
              code,
              message: `خطای نام تکراری: محصولی با نام «${name}» قبلاً با کد «${nameConflict.code}» در سیستم ثبت شده است.`
            });
            continue;
          }
        }

        let targetItemId: number;
        // V3.0.6 (Business Clock): تاریخ تراکنش‌های کاردکس از ساعت توافقی سامانه
        const todayStr = await businessTodayIsoDate();
        const currentUser = req.user?.username || 'مدیر سیستم';

        if (matchedItem) {
          targetItemId = matchedItem.id;
          // v7.0.45 (audit P2-1): موجودی فعلی از جدول موجودی انبارها، نه کش JSONB
          const existingSnapshot = await ItemWarehouseStockService.getStockSnapshot(tx, targetItemId);
          const existingStocks = existingSnapshot.byCode;
          const itemWac = !isNaN(weightedAverageCost) && weightedAverageCost > 0
            ? money(weightedAverageCost)
            : money(matchedItem?.weightedAverageCost);

          await tx.update(items).set({
            name: name || matchedItem.name,
            code: code || matchedItem.code,
            type: itemType,
            unit: unit || matchedItem.unit,
            category: category || matchedItem.category,
            reorderPoint: isNaN(reorderPoint) ? matchedItem.reorderPoint : reorderPoint,
            weightedAverageCost: itemWac,
            color: color || matchedItem.color,
            size: size || matchedItem.size,
            weight: weight !== null && !isNaN(weight) ? weight : matchedItem.weight,
            material: material || matchedItem.material,
            image: image || matchedItem.image,
          }).where(eq(items.id, targetItemId));

          if (hasCustomStockInRow && Object.keys(stockValues).length > 0) {
            for (const whCode of Object.keys(stockValues)) {
              const oldQty = Number(existingStocks[whCode] || 0);
              const newQty = Number(stockValues[whCode] || 0);
              const diff = newQty - oldQty;
              if (diff > 0) {
                adjustmentTransactionIds.push((await DocumentService.applyStockMovement(tx, {
                  itemId: targetItemId,
                  inOut: 'in',
                  quantity: diff,
                  price: itemWac,
                  date: todayStr,
                  documentType: 'audit',
                  documentRef: 'درون‌ریزی اکسل',
                  user: currentUser,
                  targetLoc: whCode,
                  notes: 'افزایش موجودی از اکسل'
                })).transactionId);
              } else if (diff < 0) {
                adjustmentTransactionIds.push((await DocumentService.applyStockMovement(tx, {
                  itemId: targetItemId,
                  inOut: 'out',
                  quantity: Math.abs(diff),
                  price: itemWac,
                  date: todayStr,
                  documentType: 'audit',
                  documentRef: 'درون‌ریزی اکسل',
                  user: currentUser,
                  targetLoc: whCode,
                  notes: 'کاهش موجودی از اکسل (شمارش فیزیکی)'
                })).transactionId);
              }
            }
          } else if (hasCustomStockInRow || currentStock !== undefined) {
            const finalStock = (hasCustomStockInRow ? currentStock : existingSnapshot.total) ?? 0;
            const diff = finalStock - existingSnapshot.total;
            const defaultLoc = await resolveWarehouseCode(tx, '');
            if (diff > 0) {
              adjustmentTransactionIds.push((await DocumentService.applyStockMovement(tx, {
                itemId: targetItemId,
                inOut: 'in',
                quantity: diff,
                price: itemWac,
                date: todayStr,
                documentType: 'audit',
                documentRef: 'درون‌ریزی اکسل',
                user: currentUser,
                targetLoc: defaultLoc,
                notes: 'افزایش موجودی از اکسل'
              })).transactionId);
            } else if (diff < 0) {
              adjustmentTransactionIds.push((await DocumentService.applyStockMovement(tx, {
                itemId: targetItemId,
                inOut: 'out',
                quantity: Math.abs(diff),
                price: itemWac,
                date: todayStr,
                documentType: 'audit',
                documentRef: 'درون‌ریزی اکسل',
                user: currentUser,
                targetLoc: defaultLoc,
                notes: 'کاهش موجودی از اکسل (شمارش فیزیکی)'
              })).transactionId);
            }
          }

          updatedCount++;
        } else {
          const finalCode = code || `ITEM-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
          const itemWac = money(isNaN(weightedAverageCost) ? 0 : weightedAverageCost);
          const [newItem] = await tx.insert(items).values({
            name: name || 'کالای بدون نام',
            code: finalCode,
            type: itemType,
            unit: unit || 'عدد',
            category: category || '',
            reorderPoint: isNaN(reorderPoint) ? 0 : reorderPoint,
            weightedAverageCost: itemWac,
            color: color || null,
            size: size || null,
            weight: weight !== null && !isNaN(weight) ? weight : null,
            material: material || null,
            image: image || '',
            currentStock: 0,
            isDeleted: 0
          }).returning({ id: items.id });

          targetItemId = newItem.id;

          if (hasCustomStockInRow && Object.keys(stockValues).length > 0) {
            for (const whCode of Object.keys(stockValues)) {
              const qty = Number(stockValues[whCode] || 0);
              if (qty > 0) {
                await DocumentService.applyStockMovement(tx, {
                  itemId: targetItemId,
                  inOut: 'in',
                  quantity: qty,
                  price: itemWac,
                  date: todayStr,
                  documentType: 'audit',
                  documentRef: 'درون‌ریزی اکسل',
                  user: currentUser,
                  targetLoc: whCode,
                  notes: 'موجودی اولیه از فایل اکسل'
                });
              }
            }
          } else if (currentStock > 0) {
            const defaultLoc = await resolveWarehouseCode(tx, '');
            await DocumentService.applyStockMovement(tx, {
              itemId: targetItemId,
              inOut: 'in',
              quantity: currentStock,
              price: itemWac,
              date: todayStr,
              documentType: 'audit',
              documentRef: 'درون‌ریزی اکسل',
              user: currentUser,
              targetLoc: defaultLoc,
              notes: 'موجودی اولیه از فایل اکسل'
            });
          }
          // v8.0.3 (TD-262): کالای تازه با موجودی، همان سند افتتاحیه فرم کالا را می‌گیرد (موجودی × WAC / سرمایه اولیه)؛
          // همین‌جا صادر می‌شود تا ردیف بعدی همین فایل برای همین کد فقط اختلاف را به سند اصلاح موجودی ببرد
          if (Object.values(stockValues).some(qty => Number(qty) > 0) || currentStock > 0) {
            await ItemOpeningService.issueItemOpeningVoucher(targetItemId, { userId: req.user?.id, username: currentUser, tx });
          }

          createdCount++;
        }

        const extractedPrices = new Map<string, { price: number; currency: string }>();

        // 1. Check explicit configured strategies
        for (const strat of strategies) {
          const norm = normalizeStrategyTitle(strat);
          if (!norm) continue;

          const priceVal =
            row[`قیمت ${norm}`] ??
            row[`قیمت - ${norm}`] ??
            row[`قیمت ${strat}`] ??
            row[`قیمت - ${strat}`] ??
            row[strat];

          const currVal =
            row[`ارز - ${norm}`] ??
            row[`ارز - قیمت ${norm}`] ??
            row[`ارز ${norm}`] ??
            row[`ارز - ${strat}`] ??
            row['واحد ارز'] ??
            row['ارز'] ??
            'IRR';

          if (priceVal !== undefined && priceVal !== '' && !isNaN(Number(priceVal)) && Number(priceVal) >= 0) {
            extractedPrices.set(norm, { price: Number(priceVal), currency: String(currVal || 'IRR').trim() });
          }
        }

        // 2. Check any other price columns in row
        Object.keys(row).forEach(k => {
          let normKey = '';
          if (k.startsWith('قیمت - ')) normKey = normalizeStrategyTitle(k.replace('قیمت - ', ''));
          else if (k.startsWith('قیمت ')) normKey = normalizeStrategyTitle(k.replace('قیمت ', ''));
          else if (k.startsWith('Price - ')) normKey = normalizeStrategyTitle(k.replace('Price - ', ''));
          else if (k.startsWith('Price ')) normKey = normalizeStrategyTitle(k.replace('Price ', ''));

          if (normKey && !extractedPrices.has(normKey)) {
            const rawPrice = row[k];
            if (rawPrice !== undefined && rawPrice !== '' && !isNaN(Number(rawPrice)) && Number(rawPrice) >= 0) {
              const currVal =
                row[`ارز - ${normKey}`] ??
                row[`ارز - قیمت ${normKey}`] ??
                row[`ارز ${normKey}`] ??
                row['واحد ارز'] ??
                row['ارز'] ??
                'IRR';

              extractedPrices.set(normKey, { price: Number(rawPrice), currency: String(currVal || 'IRR').trim() });
            }
          }
        });

        // Save extracted prices
        const nowIso = new Date().toISOString();
        for (const [normKey, pObj] of extractedPrices.entries()) {
          const cleanTitle = normalizeStrategyTitle(normKey);
          const canKey = getStrategyCanonicalKey(cleanTitle);

          const existingList = await tx.select().from(itemPrices)
            .where(and(eq(itemPrices.itemId, targetItemId), eq(itemPrices.isDeleted, 0)))
            .for('update');

          const matchingActive = existingList.filter(p => getStrategyCanonicalKey(p.title) === canKey);

          for (const m of matchingActive) {
            await tx.update(itemPrices)
              .set({ isDeleted: 1, updatedAt: nowIso })
              .where(eq(itemPrices.id, m.id));
          }

          await tx.insert(itemPrices).values({
            itemId: targetItemId,
            title: cleanTitle,
            price: money(pObj.price),
            currency: pObj.currency,
            createdAt: nowIso,
            updatedAt: nowIso,
            isDeleted: 0
          });
          pricesCount++;
        }
      }

      // v8.0.3 (TD-262، تصمیم مالک محصول درباره TD-255): اصلاح موجودی کالاهای موجود با بهای کاردکس به «کسری و اضافات
      // انبار»، در همان تراکنش؛ پیش‌تر موجودی عوض می‌شد و دفتر کل از آن خبر نداشت
      await syncStockAdjustmentVoucher({
        transactionIds: adjustmentTransactionIds,
        date: await businessTodayIsoDate(),
        refNumber: 'درون‌ریزی اکسل',
        description: 'اصلاح موجودی کالا از درون‌ریزی اکسل',
        userId: req.user?.id,
        username: req.user?.username || 'مدیر سیستم',
      }, tx);
    });

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      userFullName: req.user?.full_name || '',
      action: 'UPDATE',
      entity: 'ورود اطلاعات اکسل',
      description: `ورود جامع اطلاعات از اکسل: ${createdCount} کالای جدید، ${updatedCount} کالای به‌روزرسانی شده و ${pricesCount} قیمت تنظیم گردید.`
    });

    return {
      success: true,
      createdCount,
      updatedCount,
      pricesCount,
      errors
    };
  }

  /**
   * Soft deletes an item after validating that it has no non-zero physical inventory and no active document references
   */
  static async deleteItem(id: number, executor: DbExecutor = orm): Promise<typeof items.$inferSelect> {
    const itemId = Number(id);
    const [delItem] = await executor.select().from(items).where(eq(items.id, itemId));
    if (!delItem || delItem.isDeleted === 1) {
      throw new NotFoundError('کالا یافت نشد.');
    }

    // V9-2.2: منع حذف کالای دارای موجودی — ارزش موجودی از ارزیابی انبار حذف می‌شود اما ردیف‌های کاردکس باقی می‌مانند
    const currentStockNum = Number(delItem.currentStock || 0);
    if (currentStockNum > 0) {
      throw new ConflictError(
        `حذف کالای «${delItem.name}» مجاز نیست زیرا دارای ${currentStockNum} ${delItem.unit || 'عدد'} موجودی در انبار است. ابتدا موجودی را از طریق سند انبارگردانی یا حواله به صفر برسانید.`
      );
    }

    // V9-2.2: منع حذف کالای دارای ارجاع در اسناد فعال (غیرحذف‌شده)
    const [activeDocRefsResult] = await executor
      .select({ id: documentItems.id })
      .from(documentItems)
      .where(and(eq(documentItems.itemId, itemId), eq(documentItems.isDeleted, 0)))
      .limit(1);

    if (activeDocRefsResult) {
      throw new ConflictError(
        `حذف کالای «${delItem.name}» مجاز نیست زیرا در ردیف‌های اسناد فعال (فاکتور/رسید/حواله) استفاده شده است. برای حفظ یکپارچگی تاریخچه اسناد، ابتدا باید اسناد مرتبط حذف شوند.`
      );
    }

    await executor.update(items).set({ isDeleted: 1 }).where(eq(items.id, itemId));

    return delItem;
  }

  /**
   * Creates a new item with initial inventory stocks in a domain-level atomic transaction (RULE 01 compliant)
   */
  static async createItem(
    body: ItemWriteBody,
    user?: { id?: number; username?: string; fullName?: string; full_name?: string },
    externalTx?: DbExecutor
  ): Promise<{
    item: typeof items.$inferSelect;
    insertedId: number;
    stockValues: Record<string, number>;
    computedStock: number;
    imageUrl: string;
    thumbnailUrl: string;
  }> {
    const { type, name, code, unit, category, image, thumbnail, reorder_point, weighted_average_cost, color, weight, material, size } = body;

    const executeWork = async (tx: DbExecutor) => {
      const [existing] = await tx.select({ id: items.id }).from(items).where(and(eq(items.code, code), eq(items.isDeleted, 0)));
      if (existing) {
        throw new ConflictError('کد کالا تکراری است و مجاز به استفاده مجدد نیستید.');
      }

      const [existingName] = await tx.select({ id: items.id, code: items.code }).from(items)
        .where(and(eq(items.name, name), eq(items.isDeleted, 0)));
      if (existingName) {
        throw new ConflictError(`محصولی با نام «${name}» قبلاً با کد «${existingName.code}» در سیستم ثبت شده است. ثبت دو محصول با نام مشابه امکان‌پذیر نیست.`);
      }

      const whs = await tx.select({ code: warehouses.code }).from(warehouses).orderBy(asc(warehouses.id));
      let computedStock = 0;
      const stockValues: Record<string, number> = {};

      for (const wh of whs) {
        const bodyKey = `stock_${wh.code}`;
        const val = body[bodyKey] !== undefined ? Number(body[bodyKey]) : 0;
        // v7.0.45 (audit P2-1): موجودی اولیه از مسیر جدول موجودی انبارها ثبت می‌شود که مقدار منفی را نمی‌پذیرد
        if (!Number.isFinite(val) || val < 0) {
          throw new ValidationError(`موجودی اولیه انبار «${wh.code}» باید عددی صفر یا مثبت باشد.`);
        }
        stockValues[wh.code] = val;
        computedStock += val;
      }

      const currentStockBody = Number(body.current_stock || 0);
      if (computedStock === 0 && currentStockBody > 0 && whs.length > 0) {
        const defaultWh = (await getDefaultWarehouseCode(tx)) ?? whs[0].code;
        stockValues[defaultWh] = currentStockBody;
        computedStock = currentStockBody;
      }

      const imageUrl = image && image.startsWith('data:image') ? await uploadBase64ToStorage(image, 'image') : (image || '');
      const thumbnailUrl = thumbnail && thumbnail.startsWith('data:image') ? await uploadBase64ToStorage(thumbnail, 'thumbnail') : (thumbnail || '');

      const [inserted] = await tx.insert(items).values({
        type: type || 'product',
        name,
        code,
        unit,
        category: category || '',
        image: imageUrl,
        thumbnail: thumbnailUrl,
        reorderPoint: Number(reorder_point || 0),
        weightedAverageCost: money(weighted_average_cost || 0),
        color: color || null,
        weight: weight ? Number(weight) : null,
        material: material || null,
        size: size || null,
        isDeleted: 0
      }).returning();

      // v7.0.45 (audit P2-1): موجودی اولیه از موتور مرکزی گردش انبار (کاردکس + جدول موجودی انبارها + کش)؛
      // پیش‌تر فقط JSONB و کاردکس نوشته می‌شد و جدول موجودی انبارها ردیفی نداشت.
      if (computedStock > 0) {
        const txDate = await businessTodayIsoDate();
        for (const whCode of Object.keys(stockValues)) {
          const qty = stockValues[whCode];
          if (qty > 0) {
            await DocumentService.applyStockMovement(tx, {
              itemId: inserted.id,
              inOut: 'in',
              quantity: qty,
              price: Number(weighted_average_cost) || 0,
              date: txDate,
              documentType: 'audit',
              documentRef: 'ثبت اولیه کالا',
              user: user?.username || 'admin',
              targetLoc: whCode,
              notes: 'موجودی اولیه هنگام تعریف کالا'
            });
          }
        }
      }
      const [createdItem] = await tx.select().from(items).where(eq(items.id, inserted.id));

      return {
        item: createdItem,
        insertedId: inserted.id,
        stockValues,
        computedStock,
        imageUrl,
        thumbnailUrl
      };
    };

    if (externalTx) {
      return await executeWork(externalTx);
    }
    return await orm.transaction(executeWork);
  }

  /**
   * Updates an item's details and manages initial opening stock / voucher issuance if applicable.
   */
  static async updateItem(
    itemId: number,
    body: ItemWriteBody,
    user?: { id?: number; username?: string; fullName?: string },
    externalTx?: DbExecutor
  ): Promise<{
    item: typeof items.$inferSelect;
    prevItem: typeof items.$inferSelect;
    updateData: Partial<typeof items.$inferInsert>;
    openingVoucherId: number | null;
    computedStock: number;
    canSetOpening: boolean;
  }> {
    const { name, code, unit, category, image, thumbnail, reorder_point, weighted_average_cost, color, weight, material, size } = body;

    const executeWork = async (tx: DbExecutor) => {
      const [prevItem] = await tx.select().from(items).where(and(eq(items.id, itemId), eq(items.isDeleted, 0))).for('update');
      if (!prevItem) {
        throw new NotFoundError('کالای مورد نظر یافت نشد.');
      }

      if (code && code !== prevItem.code) {
        const [existingCode] = await tx.select({ id: items.id }).from(items).where(and(eq(items.code, code), eq(items.isDeleted, 0)));
        if (existingCode && existingCode.id !== itemId) {
          throw new ConflictError('کد کالای جدید تکراری است و مجاز به استفاده مجدد نیستید.');
        }
      }

      if (name && name !== prevItem.name) {
        const [existingName] = await tx.select({ id: items.id, code: items.code }).from(items)
          .where(and(eq(items.name, name), eq(items.isDeleted, 0)));
        if (existingName && existingName.id !== itemId) {
          throw new ConflictError(`محصولی با نام «${name}» قبلاً با کد «${existingName.code}» در سیستم ثبت شده است.`);
        }
      }

      let imageUrl: string | undefined = undefined;
      let thumbnailUrl: string | undefined = undefined;

      if (image !== undefined) {
        if (image && image.startsWith('data:image')) {
          imageUrl = await uploadBase64ToStorage(image, 'image');
        } else {
          imageUrl = image || '';
        }
      }

      if (thumbnail !== undefined) {
        if (thumbnail && thumbnail.startsWith('data:image')) {
          thumbnailUrl = await uploadBase64ToStorage(thumbnail, 'thumbnail');
        } else {
          thumbnailUrl = thumbnail || '';
        }
      }

      const [txRow] = await tx.select({ id: transactions.id })
        .from(transactions)
        .where(and(eq(transactions.itemId, itemId), eq(transactions.isDeleted, 0)))
        .limit(1);
      const [docRow] = await tx.select({ id: documentItems.id })
        .from(documentItems)
        .where(and(eq(documentItems.itemId, itemId), eq(documentItems.isDeleted, 0)))
        .limit(1);
      const [voucherRow] = await tx.select({ id: journalVouchers.id })
        .from(journalVouchers)
        .where(and(
          eq(journalVouchers.referenceModule, 'item_opening'),
          eq(journalVouchers.referenceId, itemId),
          eq(journalVouchers.isDeleted, 0)
        ))
        .limit(1);

      // v7.0.45 (audit P2-1): موجودی فعلی از جدول موجودی انبارها (منبع حقیقت)
      const stockBefore = await ItemWarehouseStockService.getStockSnapshot(tx, itemId);
      const canSetOpening = stockBefore.total <= 0 && !txRow && !docRow && !voucherRow;

      const whs = await tx.select({ code: warehouses.code }).from(warehouses).orderBy(asc(warehouses.id));
      let computedStock = 0;
      const stockValues: Record<string, number> = {};

      if (canSetOpening) {
        if (body.stocks && typeof body.stocks === 'object') {
          for (const wh of whs) {
            const val = Number(body.stocks[wh.code] ?? body.stocks[wh.code.toLowerCase()] ?? 0);
            stockValues[wh.code] = val > 0 ? val : 0;
            computedStock += stockValues[wh.code];
          }
        } else {
          for (const wh of whs) {
            const bodyKey = `stock_${wh.code}`;
            const val = body[bodyKey] !== undefined ? Number(body[bodyKey]) : 0;
            stockValues[wh.code] = val > 0 ? val : 0;
            computedStock += stockValues[wh.code];
          }
        }

        const currentStockBody = Number(body.current_stock || 0);
        if (computedStock === 0 && currentStockBody > 0 && whs.length > 0) {
          const defaultWh = (await getDefaultWarehouseCode(tx)) ?? whs[0].code;
          stockValues[defaultWh] = currentStockBody;
          computedStock = currentStockBody;
        }
      }

      const effectiveWac = weighted_average_cost !== undefined && weighted_average_cost !== ''
        ? money(weighted_average_cost)
        : (body.initial_cost !== undefined && body.initial_cost !== '' ? money(body.initial_cost) : money(prevItem.weightedAverageCost));

      const updateData: Partial<typeof items.$inferInsert> = {
        name, code, unit, category: category || '',
        reorderPoint: Number(reorder_point || 0),
        weightedAverageCost: effectiveWac,
        color: color || null, weight: weight ? Number(weight) : null, material: material || null, size: size || null,
        version: nextVersion(prevItem.version)
      };

      if (imageUrl !== undefined) updateData.image = imageUrl;
      if (thumbnailUrl !== undefined) updateData.thumbnail = thumbnailUrl;

      let openingVoucherId: number | null = null;

      let [updatedItem] = await tx.update(items).set(updateData).where(eq(items.id, itemId)).returning();

      if (canSetOpening && computedStock > 0) {
        // v7.0.45 (audit P2-1): موجودی افتتاحیه از موتور مرکزی گردش انبار (کاردکس + جدول موجودی انبارها + کش)
        const txDate = await businessTodayIsoDate();
        for (const whCode of Object.keys(stockValues)) {
          const qty = stockValues[whCode];
          if (qty > 0) {
            await DocumentService.applyStockMovement(tx, {
              itemId,
              inOut: 'in',
              quantity: qty,
              price: effectiveWac,
              date: txDate,
              documentType: 'audit',
              documentRef: 'ثبت موجودی افتتاحیه',
              user: user?.username || 'admin',
              targetLoc: whCode,
              notes: 'موجودی اولیه هنگام ویرایش کالا (سند افتتاحیه)'
            });
          }
        }
        [updatedItem] = await tx.select().from(items).where(eq(items.id, itemId));

        const wfInstance = await WorkflowEngineService.maybeStartWorkflow({
          entityType: 'item',
          entityId: String(itemId),
          userId: user?.id,
          userName: user?.fullName || user?.username
        });
        if (!wfInstance) {
          const opening = await ItemOpeningService.issueItemOpeningVoucher(itemId, {
            userId: user?.id,
            username: user?.fullName || user?.username,
            tx
          });
          openingVoucherId = opening?.id || null;
        }
      }

      return {
        item: updatedItem,
        prevItem,
        updateData,
        openingVoucherId,
        computedStock,
        canSetOpening
      };
    };

    if (externalTx) {
      return await executeWork(externalTx);
    }
    return await orm.transaction(executeWork);
  }
}

