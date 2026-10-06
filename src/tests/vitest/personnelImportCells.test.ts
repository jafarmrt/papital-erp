import { describe, expect, it } from 'vitest';
import { parseEmploymentStatusCell, parseGenderCell, parseNationalityCell, personnelCellLabel } from '../../lib/personnel/personnelImportCells';

describe('personnel Excel import cells (TD-436)', () => {
  it('reads an empty cell as no value', () => {
    expect(parseGenderCell('')).toBeUndefined();
    expect(parseGenderCell(undefined)).toBeUndefined();
    expect(parseEmploymentStatusCell('  ')).toBeUndefined();
    expect(parseNationalityCell('')).toBeUndefined();
  });

  it('maps filled cells like the previous preview', () => {
    expect(parseGenderCell('زن')).toBe('زن');
    expect(parseGenderCell('Female')).toBe('زن');
    expect(parseGenderCell('مرد')).toBe('مرد');
    expect(parseEmploymentStatusCell('استعفا داده')).toBe('قطع همکاری');
    expect(parseEmploymentStatusCell('مرخصی')).toBe('مرخصی');
    expect(parseEmploymentStatusCell('تعلیق')).toBe('تعلیق');
    expect(parseEmploymentStatusCell('فعال')).toBe('فعال');
    expect(parseNationalityCell(' افغانستانی ')).toBe('افغانستانی');
  });

  it('labels an empty cell «بدون تغییر» only for an existing personnel', () => {
    expect(personnelCellLabel(undefined, true, 'فعال')).toBe('بدون تغییر');
    expect(personnelCellLabel(undefined, false, 'فعال')).toBe('فعال');
    expect(personnelCellLabel('مرخصی', true, 'فعال')).toBe('مرخصی');
  });
});
