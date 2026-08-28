import { eq, and, desc, ilike } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { items, itemPrices, warehouses, transactions, itemCodeCounters } from '../../db/schema.js';
import { logActivity } from '../../lib/auditLogger.js';
import { normalizeStrategyTitle, getStrategyCanonicalKey } from '../../utils.js';
import { ItemPricingService } from './itemPricing.service.js';
import { fin } from '../../lib/financialDecimal.js';
import { ValidationError } from '../../errors/customErrors.js';

// V10-2.1: تایپ کلاینت اتصال DB برای تراکنش‌های داخلی
type DbLike = any;

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
        .where(ilike(items.code, `${ctx.base}%`));
      for (const r of rows) {
        const tail = String(r.code).slice(String(ctx.base).length).replace(/[^0-9].*$/, '');
        const n = parseInt(tail, 10);
        if (!isNaN(n) && n > maxNum) maxNum = n;
      }
    } else {
      const rows = await db
        .select({ code: items.code })
        .from(items)
        .where(ilike(items.code, `${ctx.prefix}%`));
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

  private static assembleCode(type: 'product' | 'raw_material', ctx: any, serialNum: number): string {
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
    const whs = await orm.select().from(warehouses);
    const configuredStrategies = await ItemPricingService.getPricingStrategies();

    const conditions = [eq(items.isDeleted, 0)];
    if (typeFilter === 'product' || typeFilter === 'raw_material') {
      conditions.push(eq(items.type, typeFilter));
    }

    const fetchedItems = await orm.select().from(items).where(and(...conditions)).orderBy(desc(items.id));
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
      const row: Record<string, any> = {
        'کد کالا': it.code,
        'نام محصول': it.name,
        'نوع کالا': it.type === 'product' ? 'محصول نهایی' : 'ماده اولیه',
        'دسته‌بندی': it.category || '',
        'واحد': it.unit,
        'موجودی کل': Number(it.currentStock || 0),
      };

      const st = (it.stocks as Record<string, any>) || {};
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
  static async processUnifiedImport(rows: any[], typeFilter: string | undefined, req: any) {
    const whs = await orm.select().from(warehouses);
    const strategies = await ItemPricingService.getPricingStrategies();

    let createdCount = 0;
    let updatedCount = 0;
    let pricesCount = 0;
    const errors: Array<{ row: number; name?: string; code?: string; message: string }> = [];

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

        const defaultWhCode = whs[0]?.code || 'main';
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

        let matchedItem: any = null;
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
        const todayStr = new Date().toISOString().split('T')[0];
        const currentUser = req.user?.username || 'مدیر سیستم';

        if (matchedItem) {
          targetItemId = matchedItem.id;
          const existingStocks = (matchedItem.stocks as Record<string, number>) || {};
          const mergedStocks = { ...existingStocks, ...stockValues };
          const finalStock = hasCustomStockInRow ? currentStock : matchedItem.currentStock;

          await tx.update(items).set({
            name: name || matchedItem.name,
            code: code || matchedItem.code,
            type: itemType,
            unit: unit || matchedItem.unit,
            category: category || matchedItem.category,
            reorderPoint: isNaN(reorderPoint) ? matchedItem.reorderPoint : reorderPoint,
            weightedAverageCost: isNaN(weightedAverageCost) ? matchedItem.weightedAverageCost : weightedAverageCost,
            color: color || matchedItem.color,
            size: size || matchedItem.size,
            weight: weight !== null && !isNaN(weight) ? weight : matchedItem.weight,
            material: material || matchedItem.material,
            image: image || matchedItem.image,
            stocks: mergedStocks,
            currentStock: finalStock
          }).where(eq(items.id, targetItemId));

          const itemWac = isNaN(weightedAverageCost) ? Number(matchedItem?.weightedAverageCost || 0) : weightedAverageCost;

          if (hasCustomStockInRow && Object.keys(stockValues).length > 0) {
            for (const whCode of Object.keys(stockValues)) {
              const oldQty = Number(existingStocks[whCode] || 0);
              const newQty = Number(stockValues[whCode] || 0);
              const diff = newQty - oldQty;
              if (diff > 0) {
                await tx.insert(transactions).values({
                  itemId: targetItemId,
                  type: 'in',
                  quantity: diff,
                  unitPrice: itemWac,
                  totalPrice: fin(itemWac).multiply(diff).round(4).toNumber(),
                  date: todayStr,
                  documentType: 'audit',
                  documentRef: 'درون‌ریزی اکسل',
                  location: whCode,
                  notes: 'افزایش موجودی از اکسل',
                  createdBy: currentUser,
                  isDeleted: 0
                });
              }
            }
          } else {
            const diff = finalStock - (matchedItem.currentStock || 0);
            if (diff > 0) {
              await tx.insert(transactions).values({
                itemId: targetItemId,
                type: 'in',
                quantity: diff,
                unitPrice: itemWac,
                totalPrice: fin(itemWac).multiply(diff).round(4).toNumber(),
                date: todayStr,
                documentType: 'audit',
                documentRef: 'درون‌ریزی اکسل',
                location: 'main',
                notes: 'افزایش موجودی از اکسل',
                createdBy: currentUser,
                isDeleted: 0
              });
            }
          }

          updatedCount++;
        } else {
          const finalCode = code || `ITEM-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
          const itemWac = isNaN(weightedAverageCost) ? 0 : weightedAverageCost;
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
            stocks: stockValues,
            currentStock: currentStock || 0,
            isDeleted: 0
          }).returning({ id: items.id });

          targetItemId = newItem.id;

          if (hasCustomStockInRow && Object.keys(stockValues).length > 0) {
            for (const whCode of Object.keys(stockValues)) {
              const qty = Number(stockValues[whCode] || 0);
              if (qty > 0) {
                await tx.insert(transactions).values({
                  itemId: targetItemId,
                  type: 'in',
                  quantity: qty,
                  unitPrice: itemWac,
                  totalPrice: fin(itemWac).multiply(qty).round(4).toNumber(),
                  date: todayStr,
                  documentType: 'audit',
                  documentRef: 'درون‌ریزی اکسل',
                  location: whCode,
                  notes: 'موجودی اولیه از فایل اکسل',
                  createdBy: currentUser,
                  isDeleted: 0
                });
              }
            }
          } else if (currentStock > 0) {
            await tx.insert(transactions).values({
              itemId: targetItemId,
              type: 'in',
              quantity: currentStock,
              unitPrice: itemWac,
              totalPrice: fin(itemWac).multiply(currentStock).round(4).toNumber(),
              date: todayStr,
              documentType: 'audit',
              documentRef: 'درون‌ریزی اکسل',
              location: 'main',
              notes: 'موجودی اولیه از فایل اکسل',
              createdBy: currentUser,
              isDeleted: 0
            });
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
            price: pObj.price,
            currency: pObj.currency,
            createdAt: nowIso,
            updatedAt: nowIso,
            isDeleted: 0
          });
          pricesCount++;
        }
      }
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
}
