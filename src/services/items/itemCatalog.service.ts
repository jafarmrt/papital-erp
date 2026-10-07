import { terminateOpenWorkflows } from '../workflow/workflowTermination.js';
import { eq, and, desc, ilike, asc } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { items, itemPrices, warehouses, itemCodeCounters, documentItems, transactions } from '../../db/schema.js';
import { uploadBase64ToStorage } from '../../lib/storage.js';
import { normalizeStrategyTitle, getStrategyCanonicalKey } from '../../utils.js';
import { ItemPricingService } from './itemPricing.service.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { ValidationError, NotFoundError, ConflictError, BadRequestError } from '../../errors/customErrors.js';
import { DocumentService } from '../document.service.js';
import { getDefaultWarehouseCode } from '../inventory/warehouseResolver.js';
import { checkOccVersion, nextVersion, OptimisticLockError } from '../../lib/occHelper.js';
import { advanceItemCodeCounter } from './itemCodeCounter.js';
import { assertItemCodeAvailable, assertItemNameAvailable, guardItemIdentity } from './itemIdentity.js';
import { ItemOpeningService, itemIdsWithOpeningVoucher } from '../inventory/itemOpening.service.js';
import { ItemWarehouseStockService } from '../inventory/itemWarehouseStock.service.js';
import { WorkflowEngineService } from '../workflow/workflowEngineService.js';
import { startsWithLikePattern } from '../../lib/sqlLike.js';
import { money } from '../../lib/money.js';
import { ITEM_WAC_COLUMN } from '../../lib/items/excelPriceColumns.js';
import type { ItemImportPermissions } from '../../lib/items/itemImportPermissions.js';
import { EXCEL_WAC_TOLERANCE, importItemsFromExcel, type ItemImportActor, type ItemImportResult } from './itemExcelImport.js';

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
  weight?: string | number | null;
  material?: string;
  size?: string;
  /** v9.0.171 (TD-654): نسخه کالایی که فرم ویرایش از آن ساخته شده است؛ ویرایش بی آن رد می‌شود */
  version?: number | string;
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
      row[ITEM_WAC_COLUMN] = Number(it.weightedAverageCost || 0);

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
   * ورود یکپارچه اکسل کالا؛ پیاده‌سازی در `itemExcelImport.ts` (v9.0.154، TD-648).
   */
  static async processUnifiedImport(
    rows: Array<Record<string, unknown>>,
    typeFilter: string | undefined,
    req: { user?: ItemImportActor },
    permissions: ItemImportPermissions,
  ): Promise<ItemImportResult> {
    return importItemsFromExcel(rows, typeFilter, req.user ?? {}, permissions);
  }

  /**
   * Soft deletes an item after validating that it has no non-zero physical inventory and no active document references
   */
  static async deleteItem(id: number, outer: DbExecutor = orm): Promise<typeof items.$inferSelect> {
    // v9.0.40 (TD-447، ت۵): حذف کالا و بستن فرایند در جریان آن در یک تراکنش، زیر قفل ردیف کالا
    return outer.transaction(async (executor) => {
      const itemId = Number(id);
      const [delItem] = await executor.select().from(items).where(eq(items.id, itemId)).for('no key update');
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
      await terminateOpenWorkflows(executor, {
        entityType: 'item', entityId: itemId, actionKey: 'terminate', actionTitle: 'بستن فرایند با حذف کالا', comment: 'حذف کالا',
      });

      return delItem;
    });
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
      // v9.0.170 (TD-653): کد و نام با کلید ایندکس‌های یکتای uq_items_code_active / uq_items_name_active
      await assertItemCodeAvailable(tx, code);
      await assertItemNameAvailable(tx, name);

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

      const [inserted] = await guardItemIdentity(name, () => tx.insert(items).values({
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
      }).returning());
      await advanceItemCodeCounter(tx, inserted.type, inserted.code);

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
      // v9.0.171 (TD-654، تصمیم ت۷ الف): قفل خوش‌بینانه همیشه اجرا می‌شود (همان قرارداد طرف حساب، TD-403)؛ پیش‌تر نسخه
      // فقط افزایش می‌یافت و فرم کهنه یا درخواست بی نسخه تغییر کاربر دیگر را بی‌خطا پاک می‌کرد
      const expectedVersion = Number(body.version);
      if (!Number.isInteger(expectedVersion) || expectedVersion <= 0) {
        throw new BadRequestError('نسخه کالا ارسال نشده است؛ صفحه را بازخوانی کنید و دوباره ویرایش کنید.');
      }
      checkOccVersion(prevItem, { entityType: 'Item', entityId: itemId, expectedVersion });

      // v9.0.170 (TD-653): کد و نام با کلید ایندکس‌های یکتا، جز خود کالا
      if (code && code !== prevItem.code) await assertItemCodeAvailable(tx, code, itemId);
      if (name && name !== prevItem.name) await assertItemNameAvailable(tx, name, itemId);

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
      // v9.0.179 (TD-663): سند افتتاحیه این کالا، سند خودش یا سند ورود اکسل
      const voucherRow = (await itemIdsWithOpeningVoucher(tx, [itemId])).has(itemId);

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

      const requestedWac = weighted_average_cost !== undefined && weighted_average_cost !== ''
        ? money(weighted_average_cost)
        : (body.initial_cost !== undefined && body.initial_cost !== '' ? money(body.initial_cost) : money(prevItem.weightedAverageCost));
      // حوزه H (TD-305): WAC کالای دارای موجودی با ویرایش کالا عوض نمی‌شود (AGENTS.md §3، همان قاعده اکسل TD-264)؛
      // پیش‌تر فرم ویرایش ارزش موجودی را بی‌کاردکس و بی‌سند حسابداری بازنویسی می‌کرد. اختلاف کمتر از یک ریال «بی‌تغییر» است.
      const prevWac = money(prevItem.weightedAverageCost);
      const wacChanged = !requestedWac.subtract(prevWac).abs().lessThan(EXCEL_WAC_TOLERANCE);
      if (stockBefore.total > 0 && wacChanged) {
        throw new ValidationError(
          `بهای میانگین (WAC) کالای «${prevItem.name}» که ${stockBefore.total} موجودی دارد با ویرایش کالا تغییر نمی‌کند ` +
          `(فعلی ${prevWac.toString()}، درخواستی ${requestedWac.toString()}). WAC فقط با ورود کالا عوض می‌شود.`
        );
      }
      const effectiveWac = stockBefore.total > 0 ? prevWac : requestedWac;

      // v9.0.171 (TD-654): فیلدی که در بدنه نیامده مقدار فعلی کالا را نگه می‌دارد؛ رشته خالی یعنی پاک کردن آن
      const keep = <T>(value: unknown, current: T, write: (v: unknown) => T): T => (value === undefined ? current : write(value));
      const updateData: Partial<typeof items.$inferInsert> = {
        name, code, unit,
        category: keep(category, prevItem.category, v => String(v || '')),
        reorderPoint: keep(reorder_point, prevItem.reorderPoint, v => Number(v || 0)),
        weightedAverageCost: effectiveWac,
        color: keep(color, prevItem.color, v => (v ? String(v) : null)),
        weight: keep(weight, prevItem.weight, v => (v ? Number(v) : null)),
        material: keep(material, prevItem.material, v => (v ? String(v) : null)),
        size: keep(size, prevItem.size, v => (v ? String(v) : null)),
        version: nextVersion(prevItem.version)
      };

      if (imageUrl !== undefined) updateData.image = imageUrl;
      if (thumbnailUrl !== undefined) updateData.thumbnail = thumbnailUrl;

      let openingVoucherId: number | null = null;

      let [updatedItem] = await guardItemIdentity(name ?? prevItem.name, () => tx.update(items).set(updateData)
        .where(and(eq(items.id, itemId), eq(items.version, prevItem.version))).returning());
      if (!updatedItem) throw new OptimisticLockError({ entityType: 'Item', entityId: itemId, expectedVersion });
      if (code && code !== prevItem.code) await advanceItemCodeCounter(tx, updatedItem.type, updatedItem.code);

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
          userName: user?.fullName || user?.username,
          tx // v8.0.77 (TD-324)
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

