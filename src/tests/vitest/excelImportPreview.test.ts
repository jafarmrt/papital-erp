import { describe, expect, it } from 'vitest';
import { validateExcelRows } from '../../components/excel/excelImportValidation';
import { codeFormatError } from '../../lib/items/itemCodeFormat';
import type { Item } from '../../types';

const row = (code: string, name: string, type = '') => ({ index: 0, raw: {}, code, name, category: '', type });

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
