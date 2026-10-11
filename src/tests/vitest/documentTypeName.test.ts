import { describe, expect, it } from 'vitest';
import { DOCUMENT_TYPE_NAMES, documentTypeName, documentVoidVoucherReason } from '../../lib/documents/documentTypeName';
import { DOCUMENT_STOCK_DIRECTIONS } from '../../lib/documents/documentDirection';

describe('document type names (TD-1241)', () => {
  it('names every recordable type in Persian', () => {
    for (const type of [...Object.keys(DOCUMENT_STOCK_DIRECTIONS), 'audit', 'transfer']) {
      expect(DOCUMENT_TYPE_NAMES[type], type).toBeTruthy();
      expect(documentTypeName(type)).not.toMatch(/[a-z]/i);
    }
  });

  it('never shows a type code, an unknown type is a plain document', () => {
    expect(documentTypeName('mystery')).toBe('سند');
    expect(documentTypeName(null)).toBe('سند');
    expect(documentTypeName(' invoice ')).toBe('فاکتور فروش');
  });

  it('writes the void reason with the Persian type name', () => {
    expect(documentVoidVoucherReason('invoice', 'INV-7')).toBe('ابطال فاکتور فروش شماره INV-7');
    expect(documentVoidVoucherReason('waste', '12')).not.toContain('waste');
  });
});
