import { asc, eq } from 'drizzle-orm';
import { orm, extendStatementTimeout, type DbExecutor } from '../../db/drizzle.js';
import { items, warehouses } from '../../db/schema.js';
import { advanceItemCodeCounter } from './itemCodeCounter.js';
import { guardItemIdentity } from './itemIdentity.js';
import { itemAuditSnapshot, logItemImportChange, logItemImportSummary } from './itemExcelAudit.js';
import { ItemPricingService } from './itemPricing.service.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { getDefaultWarehouseCode } from '../inventory/warehouseResolver.js';
import { ImportItemIndex } from './itemImportIndex.js';
import { ItemOpeningService } from '../inventory/itemOpening.service.js';
import { syncStockAdjustmentVoucher } from '../accounting/stockAdjustmentVoucher.js';
import { ItemWarehouseStockService } from '../inventory/itemWarehouseStock.service.js';
import { money } from '../../lib/money.js';
import { nextVersion } from '../../lib/occHelper.js';
import { ITEM_IMPORT_DENIED_MESSAGES, type ItemImportPermissions } from '../../lib/items/itemImportPermissions.js';
import {
  EXCEL_DOCUMENT_REF, ITEM_FIELD_KEYS, applyStockChange, changedRowPrices, codeFormatError, deniedStockPermissions,
  newItemType, planStockChanges, readRowFields, readRowPrices, readRowStock, saveRowPrices, sameFieldValue, stockWithoutCostError,
  type ItemRow, type Row, type RowFields, type RowStock, type Warehouse,
} from './itemExcelRow.js';

/** v8.0.5 (TD-264): اختلاف کمتر از ۱ ریال میان WAC فایل اکسل و WAC فعلی «همان مقدار» شمرده می‌شود (WAC فعلی می‌ماند) */
export const EXCEL_WAC_TOLERANCE = 1;

export interface ItemImportActor {
  id?: number;
  username?: string;
  full_name?: string;
  ipAddress?: string;
}

export interface ItemImportRowError {
  row: number;
  name?: string;
  code?: string;
  message: string;
}

export interface ItemImportResult {
  success: true;
  createdCount: number;
  updatedCount: number;
  pricesCount: number;
  errors: ItemImportRowError[];
}

interface ImportState {
  createdCount: number;
  updatedCount: number;
  pricesCount: number;
  errors: ItemImportRowError[];
  /** v8.0.3 (TD-262): ردیف‌های کاردکس اصلاح موجودی کالاهای موجود، برای یک سند «کسری و اضافات انبار» */
  adjustmentTransactionIds: number[];
  /** v9.0.206 (TD-663، ت۱۰ بند ۳): کالاهای تازه با موجودی اولیه، برای یک سند افتتاحیه کل فایل */
  openingItemIds: number[];
}

interface ImportContext {
  tx: DbExecutor;
  whs: Warehouse[];
  defaultWhCode: string;
  strategies: string[];
  typeFilter: string | undefined;
  actor: ItemImportActor;
  perms: ItemImportPermissions;
  state: ImportState;
  /** v9.0.206 (TD-663): کالاهای کد و نام‌های فایل، یک‌بار خوانده و قفل‌شده */
  index: ImportItemIndex;
}

function rowCodeAndName(row: Row) {
  return {
    rawCode: row['کد کالا'] || row['کد'] || row['code'] || row['Code'],
    rawName: row['نام محصول'] || row['نام کالا'] || row['نام'] || row['name'] || row['Name'],
  };
}

async function importRow(ctx: ImportContext, row: Row, rowNum: number): Promise<void> {
  const { tx, state, perms } = ctx;
  const { rawCode, rawName } = rowCodeAndName(row);
  if (!rawCode && !rawName) {
    state.errors.push({ row: rowNum, message: 'نام یا کد کالا در این ردیف نامشخص است.' });
    return;
  }
  const code = String(rawCode || '').trim();
  const name = String(rawName || '').trim();
  const push = (message: string) => state.errors.push({ row: rowNum, name, code, message });
  const fields = readRowFields(row);
  const stock = readRowStock(row, ctx.whs);

  if (!code) {
    push('کد کالا نامعتبر است (خالی می‌باشد).');
    return;
  }
  const cellError = fields.cellError ?? stock.cellError;
  if (cellError) {
    push(cellError);
    return;
  }
  // v9.0.156 (TD-651، تصمیم ت۳ و ت۵ الف): کالا فقط با کد پیدا می‌شود و کد هرگز از اکسل عوض نمی‌شود؛ پیش‌تر ردیفی با کد تازه
  // و نام کالای موجود آن کالا را با نام پیدا می‌کرد و کدش (SKU ووکامرس) را بی‌صدا عوض می‌کرد
  const found = ctx.index.findByCode(code);
  if (found.ambiguous.length > 0) {
    push(`کد «${code}» با چند کالا (${found.ambiguous.join('، ')}) فقط در بزرگی و کوچکی حروف فرق دارد؛ کد دقیق را بنویسید.`);
    return;
  }
  const matchedItem = found.item;
  const formatError = matchedItem ? null : codeFormatError(code, newItemType(fields, ctx.typeFilter), fields.category ?? '');
  if (formatError) {
    push(formatError);
    return;
  }
  if (!matchedItem && !name) {
    // v9.0.170 (TD-653): نام کالا یکتاست، پس کالای تازه بی نام «کالای بدون نام» دوم نمی‌سازد
    push('نام کالای تازه خالی است؛ این ردیف ثبت نشد.');
    return;
  }
  if (name) {
    // v9.0.170 (TD-653): همان کلید ایندکس یکتای نام (lower(btrim(name)))
    const nameConflict = ctx.index.nameConflict(name, matchedItem?.id);
    if (nameConflict) {
      push(`خطای نام تکراری: محصولی با نام «${name}» قبلاً با کد «${nameConflict.code}» در سیستم ثبت شده است؛ این ردیف ثبت نشد.`);
      return;
    }
  }
  if (!matchedItem && !perms.createItems) {
    push(ITEM_IMPORT_DENIED_MESSAGES.createItems);
    return;
  }

  // v9.0.176 (TD-657): قیمت نامعتبر یا ارز ناشناخته کل ردیف را پیش از هر نوشتن رد می‌کند
  const rowPrices = readRowPrices(row, ctx.strategies, push);
  if (!rowPrices) return;

  // v9.0.158 (TD-655): تصویر کالا پیش از تغییر، برای ردیف ممیزی همان کالا
  const before = matchedItem ? await itemAuditSnapshot(tx, matchedItem.id) : null;
  // V3.0.6 (Business Clock): تاریخ تراکنش‌های کاردکس از ساعت توافقی سامانه
  const todayStr = await businessTodayIsoDate();
  const currentUser = ctx.actor.username || 'مدیر سیستم';
  const targetItemId = matchedItem
    ? await updateExistingItem(ctx, matchedItem, { code, name, fields, stock, todayStr, currentUser, push })
    : await createNewItem(ctx, { code, name, fields, stock, todayStr, currentUser, push });
  if (targetItemId === null) return;

  const changedPrices = await changedRowPrices(tx, targetItemId, rowPrices, !matchedItem);
  if (changedPrices.length > 0 && !perms.editPrices) {
    push(ITEM_IMPORT_DENIED_MESSAGES.editPrices);
  } else {
    state.pricesCount += await saveRowPrices(tx, targetItemId, changedPrices);
  }
  await logItemImportChange(tx, ctx.actor, targetItemId, rowNum, before, await itemAuditSnapshot(tx, targetItemId));
}

interface RowInput {
  code: string;
  name: string;
  fields: RowFields;
  stock: RowStock;
  todayStr: string;
  currentUser: string;
  push: (message: string) => void;
}

async function updateExistingItem(ctx: ImportContext, matchedItem: ItemRow, input: RowInput): Promise<number | null> {
  const { tx, state, perms } = ctx;
  const { name, fields, stock, push } = input;
  const targetItemId = matchedItem.id;
  // v7.0.45 (audit P2-1): موجودی فعلی از جدول موجودی انبارها، نه کش JSONB
  const existingSnapshot = await ItemWarehouseStockService.getStockSnapshot(tx, targetItemId);
  const currentWac = money(matchedItem.weightedAverageCost);
  const fileWac = fields.weightedAverageCost > 0 ? money(fields.weightedAverageCost) : null;
  // v8.0.5 (TD-264، تصمیم مالک محصول — گزینه الف): WAC کالای دارای موجودی از اکسل عوض نمی‌شود؛ WAC فقط با
  // گردش ورود تغییر می‌کند. مقدار برابر WAC فعلی (اختلاف کمتر از EXCEL_WAC_TOLERANCE) نادیده گرفته می‌شود تا فایل
  // خروجی بی‌خطا برگردد.
  if (fileWac && existingSnapshot.total > 0 && !fileWac.subtract(currentWac).abs().lessThan(EXCEL_WAC_TOLERANCE)) {
    push(
      `میانگین موزون بهای کالای «${matchedItem.name}» (${matchedItem.code}) که ${existingSnapshot.total} موجودی دارد از اکسل تغییر نمی‌کند ` +
      `(فعلی ${currentWac.toString()}، فایل ${fileWac.toString()}). میانگین موزون بها فقط با ورود کالا عوض می‌شود؛ این ردیف ثبت نشد. ` +
      'ستون «میانگین موزون بها» را خالی بگذارید یا همان مقدار فعلی را بنویسید.',
    );
    return null;
  }
  const itemWac = fileWac && existingSnapshot.total <= 0 ? fileWac : currentWac;
  // v9.0.157 (TD-649): موجودی پیش از هر نوشتن سنجیده می‌شود؛ ناسازگاری ستون‌های موجودی کل ردیف را رد می‌کند
  const plan = planStockChanges(stock, existingSnapshot, ctx.whs, ctx.defaultWhCode);
  if ('error' in plan) {
    push(plan.error);
    return null;
  }
  const noCost = stockWithoutCostError(matchedItem, plan.changes, itemWac);
  if (noCost) {
    push(noCost);
    return null;
  }

  const updateSet = {
    name: name || matchedItem.name,
    // v9.0.155 (TD-650، ت۳ الف): ستونِ نبود یا سلول خالی یعنی «بی‌تغییر»؛ نوع از خود کالا، مگر ستون نوع صریح باشد
    type: fields.itemType ?? matchedItem.type,
    unit: fields.unit ?? matchedItem.unit,
    category: fields.category ?? matchedItem.category,
    reorderPoint: fields.reorderPoint ?? matchedItem.reorderPoint,
    weightedAverageCost: itemWac,
    color: fields.color ?? matchedItem.color,
    size: fields.size ?? matchedItem.size,
    weight: fields.weight ?? matchedItem.weight,
    material: fields.material ?? matchedItem.material,
    image: fields.image ?? matchedItem.image,
  };
  const fieldsChange = ITEM_FIELD_KEYS.some(k => !sameFieldValue(matchedItem[k], updateSet[k]));
  if (fieldsChange && !perms.editItems) {
    push(ITEM_IMPORT_DENIED_MESSAGES.editItems);
  } else if (fieldsChange) {
    // v9.0.171 (TD-654): تغییر مشخصات از اکسل نسخه کالا را هم جلو می‌برد تا فرم بازِ کهنه آن را بازنویسی نکند
    await guardItemIdentity(updateSet.name ?? matchedItem.name, () => tx.update(items)
      .set({ ...updateSet, version: nextVersion(matchedItem.version) }).where(eq(items.id, targetItemId)));
    ctx.index.remember({ ...matchedItem, ...updateSet, version: nextVersion(matchedItem.version) });
  }

  const changes = plan.changes;
  const denied = deniedStockPermissions(changes, perms);
  if (denied.length > 0) {
    denied.forEach(k => push(ITEM_IMPORT_DENIED_MESSAGES[k]));
  } else {
    const movement = { itemId: targetItemId, price: itemWac, date: input.todayStr, user: input.currentUser };
    for (const change of changes) {
      state.adjustmentTransactionIds.push(await applyStockChange(tx, movement, change, {
        in: 'افزایش موجودی از اکسل',
        out: 'کاهش موجودی از اکسل (شمارش فیزیکی)',
      }));
    }
  }
  state.updatedCount++;
  return targetItemId;
}

async function createNewItem(ctx: ImportContext, input: RowInput): Promise<number | null> {
  const { tx, state } = ctx;
  const { code, name, fields, stock } = input;
  const plan = planStockChanges(stock, { byCode: {}, total: 0 }, ctx.whs, ctx.defaultWhCode);
  if ('error' in plan) {
    input.push(plan.error);
    return null;
  }
  const itemWac = money(fields.weightedAverageCost);
  const noCost = stockWithoutCostError({ name, code }, plan.changes, itemWac);
  if (noCost) {
    input.push(noCost);
    return null;
  }
  const [newItem] = await guardItemIdentity(name, () => tx.insert(items).values({
    name,
    code,
    type: newItemType(fields, ctx.typeFilter),
    unit: fields.unit || 'عدد',
    category: fields.category ?? '',
    reorderPoint: fields.reorderPoint ?? 0,
    weightedAverageCost: itemWac,
    color: fields.color || null,
    size: fields.size || null,
    weight: fields.weight ?? null,
    material: fields.material || null,
    image: fields.image || '',
    currentStock: 0,
    isDeleted: 0,
  }).returning());
  ctx.index.remember(newItem);
  const targetItemId = newItem.id;
  await advanceItemCodeCounter(tx, newItem.type, code);

  const movement = { itemId: targetItemId, price: itemWac, date: input.todayStr, user: input.currentUser };
  const opening = plan.changes;
  for (const change of opening) {
    await applyStockChange(tx, movement, change, { in: 'موجودی اولیه از فایل اکسل', out: '' });
  }
  // v8.0.3 (TD-262): کالای تازه با موجودی سند افتتاحیه می‌گیرد (ردیف‌های افتتاحیه کاردکس / سرمایه اولیه). v9.0.206
  // (TD-663، ت۱۰ بند ۳): یک سند برای همه کالاهای تازه فایل، پس از آخرین ردیف؛ ردیف بعدی همین فایل برای همین کد کالای
  // موجود است و اختلافش به سند اصلاح موجودی می‌رود، و ارزش سند فقط ردیف‌های افتتاحیه کاردکس را می‌شمارد
  if (opening.length > 0) state.openingItemIds.push(targetItemId);
  state.createdCount++;
  return targetItemId;
}

/**
 * ورود یکپارچه اکسل کالا: مشخصات، موجودی هر انبار و قیمت فهرست‌ها، همه در یک تراکنش.
 * v9.0.154 (TD-648): `perms` در route با `can()` ساخته می‌شود؛ هر بخش فقط با مجوز خودش ثبت می‌شود.
 */
export async function importItemsFromExcel(
  rows: Row[],
  typeFilter: string | undefined,
  actor: ItemImportActor,
  perms: ItemImportPermissions,
): Promise<ItemImportResult> {
  const whs = await orm.select().from(warehouses).orderBy(asc(warehouses.id));
  // v7.0.36 (P2-3): انبار پیش‌فرض قطعی (انبار فعال با کمترین شناسه)
  const defaultWhCode = (await getDefaultWarehouseCode(orm)) ?? whs[0]?.code ?? 'main';
  const strategies = await ItemPricingService.getPricingStrategies();
  const state: ImportState = { createdCount: 0, updatedCount: 0, pricesCount: 0, errors: [], adjustmentTransactionIds: [], openingItemIds: [] };

  await orm.transaction(async (tx) => {
    // v9.0.188 (TD-615): a large import may take longer than the 1-minute statement limit of a request
    await extendStatementTimeout(tx);
    const keys = rows.map(rowCodeAndName);
    const index = await ImportItemIndex.load(tx, keys.map(k => String(k.rawCode || '').trim()), keys.map(k => String(k.rawName || '').trim()));
    const ctx: ImportContext = { tx, whs, defaultWhCode, strategies, typeFilter, actor, perms, state, index };
    for (let i = 0; i < rows.length; i++) {
      await importRow(ctx, rows[i], i + 2);
    }
    const openingVoucher = await ItemOpeningService.issueImportOpeningVoucher(tx, state.openingItemIds, {
      userId: actor.id,
      username: actor.username || 'مدیر سیستم',
    });
    // v8.0.3 (TD-262، تصمیم مالک محصول درباره TD-255): اصلاح موجودی کالاهای موجود با بهای کاردکس به «کسری و اضافات
    // انبار»، در همان تراکنش؛ پیش‌تر موجودی عوض می‌شد و دفتر کل از آن خبر نداشت
    await syncStockAdjustmentVoucher({
      transactionIds: state.adjustmentTransactionIds,
      date: await businessTodayIsoDate(),
      refNumber: EXCEL_DOCUMENT_REF,
      description: 'اصلاح موجودی کالا از درون‌ریزی اکسل',
      userId: actor.id,
      username: actor.username || 'مدیر سیستم',
    }, tx);
    await logItemImportSummary(tx, actor, {
      rows: rows.length,
      createdCount: state.createdCount,
      updatedCount: state.updatedCount,
      pricesCount: state.pricesCount,
      errorCount: state.errors.length,
      stockAdjustmentMovements: state.adjustmentTransactionIds.length,
      openingVoucherId: openingVoucher?.id ?? null,
      openingItems: state.openingItemIds.length,
    });
  });

  return {
    success: true,
    createdCount: state.createdCount,
    updatedCount: state.updatedCount,
    pricesCount: state.pricesCount,
    errors: state.errors,
  };
}
