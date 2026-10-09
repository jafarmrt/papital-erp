import { describe, expect, it } from 'vitest';
import * as xlsx from 'xlsx';
import { bankNumberCell, phoneCellText } from '../../lib/customers/customerExcelCells';

// v10.0.22 (TD-974): the party Excel import keeps the leading zero of a phone and never accepts a bank number Excel truncated
function rowsOf(cells: Record<string, unknown>): Record<string, unknown> {
  const ws = xlsx.utils.aoa_to_sheet([Object.keys(cells), Object.values(cells)]);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'p');
  const back = xlsx.read(xlsx.write(wb, { type: 'binary', bookType: 'xlsx' }), { type: 'binary' });
  return xlsx.utils.sheet_to_json<Record<string, unknown>>(back.Sheets[back.SheetNames[0]])[0];
}

describe('party Excel cells (TD-974)', () => {
  it('gives a numeric mobile and landline cell its leading zero back', () => {
    const row = rowsOf({ mobile: 9121234567, landline: 2188776655 });
    expect(phoneCellText(row.mobile)).toBe('09121234567');
    expect(phoneCellText(row.landline)).toBe('02188776655');
  });

  it('reads a text phone as written, with Latin digits', () => {
    expect(phoneCellText('0912 123 4567')).toBe('0912 123 4567');
    expect(phoneCellText('۰۹۱۲۱۲۳۴۵۶۷')).toBe('09121234567');
    expect(phoneCellText(undefined)).toBe('');
  });

  it('refuses a card number Excel stored as a number (16 digits, last one lost)', () => {
    const row = rowsOf({ card: 6037991234567891 });
    const read = bankNumberCell(row.card, 'شماره کارت');
    expect(read.issue).toContain('شماره کارت');
  });

  it('keeps a text card number and a short numeric account number exactly', () => {
    expect(bankNumberCell('6037991234567891', 'شماره کارت')).toEqual({ text: '6037991234567891' });
    const row = rowsOf({ account: 123456789012 });
    expect(bankNumberCell(row.account, 'شماره حساب')).toEqual({ text: '123456789012' });
  });
});
