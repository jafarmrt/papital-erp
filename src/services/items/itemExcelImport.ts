import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { items, warehouses } from '../../db/schema.js';
import { itemAuditSnapshot, logItemImportChange, logItemImportSummary } from './itemExcelAudit.js';
import { ItemPricingService } from './itemPricing.service.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { getDefaultWarehouseCode } from '../inventory/warehouseResolver.js';
import { ItemOpeningService } from '../inventory/itemOpening.service.js';
import { syncStockAdjustmentVoucher } from '../accounting/stockAdjustmentVoucher.js';
import { ItemWarehouseStockService } from '../inventory/itemWarehouseStock.service.js';
import { money } from '../../lib/money.js';
import { ITEM_IMPORT_DENIED_MESSAGES, type ItemImportPermissions } from '../../lib/items/itemImportPermissions.js';
import {
  EXCEL_DOCUMENT_REF, ITEM_FIELD_KEYS, applyStockChange, changedRowPrices, codeFormatError, findItemByCode, deniedStockPermissions,
  newItemType, planStockChanges, readRowFields, readRowPrices, readRowStock, saveRowPrices, sameFieldValue,
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
}

async function importRow(ctx: ImportContext, row: Row, rowNum: number): Promise<void> {
  const { tx, state, perms } = ctx;
  const rawCode = row['کد کالا'] || row['کد'] || row['code'] || row['Code'];
  const rawName = row['نام محصول'] || row['نام کالا'] || row['نام'] || row['name'] || row['Name'];
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
  // v9.0.118 (TD-651، تصمیم ت۳ و ت۵ الف): کالا فقط با کد پیدا می‌شود و کد هرگز از اکسل عوض نمی‌شود؛ پیش‌تر ردیفی با کد تازه
  // و نام کالای موجود آن کالا را با نام پیدا می‌کرد و کدش (SKU ووکامرس) را بی‌صدا عوض می‌کرد
  const found = await findItemByCode(tx, code);
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
  if (name) {
    const [nameConflict] = await tx.select({ id: items.id, code: items.code }).from(items)
      .where(and(sql`btrim(${items.name}) = ${name}`, eq(items.isDeleted, 0), matchedItem ? ne(items.id, matchedItem.id) : undefined))
      .limit(1);
    if (nameConflict) {
      push(`خطای نام تکراری: محصولی با نام «${name}» قبلاً با کد «${nameConflict.code}» در سیستم ثبت شده است؛ این ردیف ثبت نشد.`);
      return;
    }
  }
  if (!matchedItem && !perms.createItems) {
    push(ITEM_IMPORT_DENIED_MESSAGES.createItems);
    return;
  }

  // v9.0.120 (TD-655): تصویر کالا پیش از تغییر، برای ردیف ممیزی همان کالا
  const before = matchedItem ? await itemAuditSnapshot(tx, matchedItem.id) : null;
  // V3.0.6 (Business Clock): تاریخ تراکنش‌های کاردکس از ساعت توافقی سامانه
  const todayStr = await businessTodayIsoDate();
  const currentUser = ctx.actor.username || 'مدیر سیستم';
  const targetItemId = matchedItem
    ? await updateExistingItem(ctx, matchedItem, { code, name, fields, stock, todayStr, currentUser, push })
    : await createNewItem(ctx, { code, name, fields, stock, todayStr, currentUser, push });
  if (targetItemId === null) return;

  const changedPrices = await changedRowPrices(tx, targetItemId, readRowPrices(row, ctx.strategies, push));
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
      `بهای میانگین (WAC) کالای «${matchedItem.name}» (${matchedItem.code}) که ${existingSnapshot.total} موجودی دارد از اکسل تغییر نمی‌کند ` +
      `(فعلی ${currentWac.toString()}، فایل ${fileWac.toString()}). WAC فقط با ورود کالا عوض می‌شود؛ این ردیف ثبت نشد. ` +
      'ستون «میانگین موزون بها» را خالی بگذارید یا همان مقدار فعلی را بنویسید.',
    );
    return null;
  }
  const itemWac = fileWac && existingSnapshot.total <= 0 ? fileWac : currentWac;
  // v9.0.119 (TD-649): موجودی پیش از هر نوشتن سنجیده می‌شود؛ ناسازگاری ستون‌های موجودی کل ردیف را رد می‌کند
  const plan = planStockChanges(stock, existingSnapshot, ctx.whs, ctx.defaultWhCode);
  if ('error' in plan) {
    push(plan.error);
    return null;
  }

  const updateSet = {
    name: name || matchedItem.name,
    // v9.0.117 (TD-650، ت۳ الف): ستونِ نبود یا سلول خالی یعنی «بی‌تغییر»؛ نوع از خود کالا، مگر ستون نوع صریح باشد
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
    await tx.update(items).set(updateSet).where(eq(items.id, targetItemId));
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
  const [newItem] = await tx.insert(items).values({
    name: name || 'کالای بدون نام',
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
  }).returning({ id: items.id });
  const targetItemId = newItem.id;

  const movement = { itemId: targetItemId, price: itemWac, date: input.todayStr, user: input.currentUser };
  const opening = plan.changes;
  for (const change of opening) {
    await applyStockChange(tx, movement, change, { in: 'موجودی اولیه از فایل اکسل', out: '' });
  }
  // v8.0.3 (TD-262): کالای تازه با موجودی، همان سند افتتاحیه فرم کالا را می‌گیرد (موجودی × WAC / سرمایه اولیه)؛
  // همین‌جا صادر می‌شود تا ردیف بعدی همین فایل برای همین کد فقط اختلاف را به سند اصلاح موجودی ببرد
  if (opening.length > 0) {
    await ItemOpeningService.issueItemOpeningVoucher(targetItemId, { userId: ctx.actor.id, username: input.currentUser, tx });
  }
  state.createdCount++;
  return targetItemId;
}

/**
 * ورود یکپارچه اکسل کالا: مشخصات، موجودی هر انبار و قیمت فهرست‌ها، همه در یک تراکنش.
 * v9.0.116 (TD-648): `perms` در route با `can()` ساخته می‌شود؛ هر بخش فقط با مجوز خودش ثبت می‌شود.
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
  const state: ImportState = { createdCount: 0, updatedCount: 0, pricesCount: 0, errors: [], adjustmentTransactionIds: [] };

  await orm.transaction(async (tx) => {
    const ctx: ImportContext = { tx, whs, defaultWhCode, strategies, typeFilter, actor, perms, state };
    for (let i = 0; i < rows.length; i++) {
      await importRow(ctx, rows[i], i + 2);
    }
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
