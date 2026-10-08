import { Category, Item } from '../../types';
import { PreviewRow } from './types';
import { newItemTypeOf, parseItemTypeCell, parseNumberCell, stockColumnsOf } from '../../lib/items/itemExcelCells';
import { WAC_COLUMNS } from '../../lib/items/excelPriceColumns';
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
    issues.push(...cellErrors);
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
      issues
    };
  });
}
