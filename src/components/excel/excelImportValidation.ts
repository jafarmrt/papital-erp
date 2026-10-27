import { Category, Item } from '../../types';
import { PreviewRow } from './types';
import { ITEM_EXCEL_TYPE_LABELS, newItemStockWithoutCost, newItemTypeOf, parseItemTypeCell, parseNumberCell, stockColumnsOf, type ItemExcelType } from '../../lib/items/itemExcelCells';
import { ITEM_WAC_COLUMN, WAC_COLUMNS } from '../../lib/items/excelPriceColumns';
import { REORDER_POINT_COLUMNS } from '../../lib/items/itemExcelColumns';
import { PRODUCT_CODE_FORMAT_HINT, PRODUCT_CODE_PATTERN, RAW_MATERIAL_CODE_FORMAT_HINT, RAW_MATERIAL_CODE_PATTERN } from '../../lib/items/itemCodeFormat';

export interface ParsedExcelItem {
  index: number;
  raw: Record<string, any>;
  code: string;
  name: string;
  category: string;
  type: string;
}

/** v10.0.2 (TD-1011): سلول‌های عددی که سرور رد می‌کند؛ ستون‌های موجودی از سرستون خوانده می‌شوند */
function numberCellErrors(raw: Record<string, unknown>): Array<string | undefined> {
  const groups: Array<readonly string[]> = [WAC_COLUMNS, REORDER_POINT_COLUMNS, ['وزن', 'weight'], ...stockColumnsOf(raw).map(h => [h])];
  return groups.map(headers => parseNumberCell(raw, headers).error);
}

/**
 * v11 phase 6.1j (N2): the server refuses a type change of an item with stock or a stock movement (phase 3.2, S1). An
 * item with stock is refused here too; for one without stock the preview cannot see its movements, so it warns.
 */
function typeChangeIssue(item: Item | undefined, newType: ItemExcelType | undefined): { error?: string; warning?: string } {
  if (!item?.type || !newType || newType === item.type) return {};
  const from = ITEM_EXCEL_TYPE_LABELS[item.type] ?? item.type;
  const to = ITEM_EXCEL_TYPE_LABELS[newType];
  if (Number(item.current_stock ?? item.currentStock ?? 0) !== 0) {
    return { error: `نوع کالای «${item.name}» از «${from}» به «${to}» عوض نمی‌شود، چون موجودی دارد. ستون «نوع کالا» را خالی بگذارید یا «${from}» بنویسید.` };
  }
  return { warning: `نوع کالا از «${from}» به «${to}» عوض می‌شود؛ اگر این کالا گردش انبار داشته باشد، ثبت این ردیف رد می‌شود.` };
}

function cleanCodeIsNew(code: string, dbCodes: Set<string>): boolean {
  const clean = code.trim();
  return clean !== '' && !dbCodes.has(clean);
}

export function validateExcelRows(
  rows: ParsedExcelItem[],
  catsList: Category[],
  dbItems: Item[],
  typeFilter = ''
): PreviewRow[] {
  // Count names in batch
  const nameCountsInBatch = new Map<string, number>();
  rows.forEach(r => {
    const cleanName = r.name.trim().toLowerCase();
    if (cleanName) {
      nameCountsInBatch.set(cleanName, (nameCountsInBatch.get(cleanName) || 0) + 1);
    }
  });

  // Create DB name lookup map (name -> item)
  const dbNameMap = new Map<string, Item>();
  dbItems.forEach(it => {
    if (it.name) dbNameMap.set(it.name.trim().toLowerCase(), it);
  });

  // v9.0.155 (TD-650): کالای موجود با کد شناخته می‌شود و قالب کد فقط برای کالای تازه سنجیده می‌شود (مثل سرور)
  const dbCodes = new Set(dbItems.map(it => String(it.code ?? '').trim()).filter(Boolean));
  const dbByCode = new Map(dbItems.map(it => [String(it.code ?? '').trim(), it]));

  // Create category lookup
  const catMap = new Map<string, Category>();
  catsList.forEach(c => {
    if (c.name) catMap.set(c.name.trim().toLowerCase(), c);
  });

  return rows.map(r => {
    const cleanCode = r.code.trim();
    const cleanName = r.name.trim();
    const cleanCat = r.category.trim();

    const matchedCat = catMap.get(cleanCat.toLowerCase());
    const expectedPrefix = matchedCat?.prefix?.trim() || '';

    const issues: string[] = [];
    let hasPrefixMismatch = false;
    let isDuplicateInBatch = false;
    let isDuplicateInDb = false;

    // v10.0.1 (TD-1010): نوع کالای تازه با قاعده سرور (ستون نوع، وگرنه پالایش صفحه، وگرنه محصول)؛ پیش‌تر از دسته
    // خوانده می‌شد و پیش‌نمایش کدی را درست می‌دید که سرور با قالب نوع دیگر رد می‌کرد
    const typeCell = parseItemTypeCell(r.raw ?? {});
    const cellErrors = [typeCell.error, ...numberCellErrors(r.raw ?? {})].filter((e): e is string => !!e);
    // v10.0.13 (TD-1012): کالای تازه با موجودی و بی میانگین موزون بها، مثل سرور
    if (cleanCodeIsNew(r.code, dbCodes) && newItemStockWithoutCost(r.raw ?? {}, WAC_COLUMNS)) {
      cellErrors.push(`کالای تازه موجودی دارد ولی «${ITEM_WAC_COLUMN}» ندارد؛ موجودی بی‌بها وارد انبار نمی‌شود.`);
    }
    const typeChange = typeChangeIssue(dbByCode.get(r.code.trim()), typeCell.value);
    if (typeChange.error) cellErrors.push(typeChange.error);
    issues.push(...cellErrors);
    if (typeChange.warning) issues.push(typeChange.warning);
    const itemType = newItemTypeOf(typeCell.value, typeFilter);

    // 1. Format & Prefix Validation

    if (!cleanCode) {
      hasPrefixMismatch = true;
      issues.push(`کد کالا خالی است.`);
    } else if (!dbCodes.has(cleanCode)) {
      if (itemType === 'product') {
        if (!PRODUCT_CODE_PATTERN.test(cleanCode)) {
          hasPrefixMismatch = true;
          issues.push(`قالب کد درست نیست؛ ${PRODUCT_CODE_FORMAT_HINT}.`);
        }
      } else {
        if (!RAW_MATERIAL_CODE_PATTERN.test(cleanCode)) {
          hasPrefixMismatch = true;
          issues.push(`قالب کد درست نیست؛ ${RAW_MATERIAL_CODE_FORMAT_HINT}.`);
        }
      }

      if (expectedPrefix) {
        const basePrefix = expectedPrefix.toLowerCase().replace(/-$/, '');
        if (!cleanCode.toLowerCase().includes(basePrefix)) {
          hasPrefixMismatch = true;
          issues.push(`کد «${cleanCode}» شامل پیشوند دسته‌بندی «${expectedPrefix}» نیست.`);
        }
      }
    }

    // 2. Duplicate Name in Batch
    if (cleanName && (nameCountsInBatch.get(cleanName.toLowerCase()) || 0) > 1) {
      isDuplicateInBatch = true;
      issues.push(`نام محصول «${cleanName}» در ردیف‌های فایل اکسل تکراری است.`);
    }

    // 3. Duplicate Name in Database with different code
    const dbMatch = dbNameMap.get(cleanName.toLowerCase());
    if (dbMatch && dbMatch.code !== cleanCode) {
      isDuplicateInDb = true;
      issues.push(`کالایی با نام «${cleanName}» قبلاً با کد «${dbMatch.code}» در سیستم ثبت شده است.`);
    }

    return {
      ...r,
      code: cleanCode,
      name: cleanName,
      category: cleanCat,
      expectedPrefix,
      hasPrefixMismatch,
      isDuplicateInBatch,
      isDuplicateInDb,
      hasCellError: cellErrors.length > 0,
      hasTypeChange: !!typeChange.warning,
      issues
    };
  });
}
