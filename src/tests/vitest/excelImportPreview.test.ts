import { describe, expect, it } from 'vitest';
import { validateExcelRows } from '../../components/excel/excelImportValidation';
import { codeFormatError } from '../../lib/items/itemCodeFormat';
import type { Category, Item } from '../../types';
import { parseItemTypeCell } from '../../lib/items/itemExcelCells';

const row = (code: string, name: string, type = '') => ({ index: 0, raw: type ? { 'نوع کالا': type } : {}, code, name, category: '', type });

describe('item Excel preview code checks (TD-650)', () => {
  it('checks the code format only for new items, like the server', () => {
    const db = [{ id: 1, code: 'N-801', name: 'کد قدیمی' }] as unknown as Item[];
    expect(validateExcelRows([row('N-801', 'کد قدیمی')], [], db)[0].issues).toEqual([]);
    expect(validateExcelRows([row('N-802', 'تازه', 'محصول نهایی')], [], db)[0].hasPrefixMismatch).toBe(true);
  });

  it('accepts the server raw-material pattern in the preview', () => {
    expect(validateExcelRows([row('B-H-101', 'زنجیر', 'ماده اولیه')], [], [])[0].issues).toEqual([]);
    expect(codeFormatError('B-H--101', 'raw_material', '')).toBeNull();
    expect(codeFormatError('N-101', 'product', '')).toContain('1404-N-101-01');
  });
});

const TYPE_COLUMN = 'نوع کالا';

describe('item Excel type cell (TD-1010)', () => {
  it('reads the plural and short type words and refuses an unknown word naming the column', () => {
    expect(parseItemTypeCell({ [TYPE_COLUMN]: 'مواد اولیه' }).value).toBe('raw_material');
    expect(parseItemTypeCell({ [TYPE_COLUMN]: ' ماده‌اولیه ' }).value).toBe('raw_material');
    expect(parseItemTypeCell({ [TYPE_COLUMN]: 'محصول' }).value).toBe('product');
    expect(parseItemTypeCell({ [TYPE_COLUMN]: '' })).toEqual({});
    const unknown = parseItemTypeCell({ [TYPE_COLUMN]: 'کالا' });
    expect(unknown.value).toBeUndefined();
    expect(unknown.error).toContain(TYPE_COLUMN);
  });

  it('resolves a new item type like the server: type column, else page filter, else product', () => {
    const rawCategory = [{ id: 1, name: 'زنجیر', type: 'raw_material', prefix: '' }] as unknown as Category[];
    const chain = { ...row('B-H-101', 'زنجیر نو'), category: 'زنجیر' };
    expect(validateExcelRows([chain], rawCategory, [])[0].hasPrefixMismatch).toBe(true);
    expect(validateExcelRows([chain], rawCategory, [], 'raw_material')[0].issues).toEqual([]);
    const bad = validateExcelRows([row('B-H-102', 'نوع بد', 'کالا')], [], [], 'raw_material')[0];
    expect(bad.hasCellError).toBe(true);
  });
});
