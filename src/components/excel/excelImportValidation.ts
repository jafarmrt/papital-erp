import { Category, Item } from '../../types';
import { PreviewRow } from './types';

export interface ParsedExcelItem {
  index: number;
  raw: Record<string, any>;
  code: string;
  name: string;
  category: string;
  type: string;
}

export function validateExcelRows(
  rows: ParsedExcelItem[],
  catsList: Category[],
  dbItems: Item[]
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

    // 1. Format & Prefix Validation
    const itemType = matchedCat?.type || (r.type === 'محصول نهایی' || cleanCat.includes('محصول') ? 'product' : 'raw_material');

    if (!cleanCode) {
      hasPrefixMismatch = true;
      issues.push(`کد کالا خالی است.`);
    } else {
      if (itemType === 'product') {
        const productRegex = /^\d{4}-[A-Za-z]+-\d{3}-\d{2}$/;
        if (!productRegex.test(cleanCode)) {
          hasPrefixMismatch = true;
          issues.push(`فرمت کد محصول نهایی نامعتبر است (الگوی صحیح: nnnn-x-nnn-nn).`);
        }
      } else {
        const rawRegex = /^[A-Za-z\-]+-\d{3}$/;
        if (!rawRegex.test(cleanCode)) {
          hasPrefixMismatch = true;
          issues.push(`فرمت کد ماده اولیه نامعتبر است (الگوی صحیح: x-nnn).`);
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
      issues
    };
  });
}
