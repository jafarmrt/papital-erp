import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { ExcelResultStep } from '../../components/excel/ExcelResultStep';
import { itemImportOutcome } from '../../lib/items/itemImportOutcome';

const SUCCESS_TEXT = 'با موفقیت';
const REFUSED_ROWS_TEXT = '۲ ردیف خطا داشت';
const errors = [{ row: 3, message: 'نام تکراری' }, { row: 5, message: 'کد خالی' }];

describe('item Excel import result (TD-1139)', () => {
  it('reports success only when no row was refused', () => {
    expect(itemImportOutcome({ createdCount: 2, updatedCount: 1, pricesCount: 0, errors: [] }).tone).toBe('success');
    const partial = itemImportOutcome({ createdCount: 2, updatedCount: 0, pricesCount: 0, errors });
    expect(partial.tone).toBe('warning');
    expect(partial.message).toContain(REFUSED_ROWS_TEXT);
    expect(partial.message).not.toContain(SUCCESS_TEXT);
    expect(itemImportOutcome({ createdCount: 0, updatedCount: 0, pricesCount: 0, errors }).tone).toBe('error');
  });

  it('the result step header names the refused rows instead of a plain success', () => {
    render(<ExcelResultStep importResult={{ createdCount: 1, updatedCount: 0, pricesCount: 0, errors }} />);
    expect(screen.getByText(/ردیف خطا داشت و ثبت نشد/).getAttribute('data-tone')).toBe('warning');
  });

  it('the dead import errors window is gone from the items page', () => {
    expect(existsSync('src/components/items/ImportErrorsModal.tsx')).toBe(false);
    expect(readFileSync('src/pages/ItemsPage.tsx', 'utf8')).not.toContain('ImportErrorsModal');
    expect(readFileSync('src/components/excel/useUnifiedExcelImport.ts', 'utf8')).not.toContain("toast.success('ورود داده‌های اکسل");
  });
});
