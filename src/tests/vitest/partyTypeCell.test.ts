import { describe, expect, it } from 'vitest';
import { parsePartyTypeCell, partyTypeCellLabel } from '../../lib/customers/partyTypeCell';

// v9.0.9 (TD-421): ستون نوع درون‌ریزی اکسل طرف حساب‌ها؛ خانه خالی یعنی «بدون تغییر»
describe('party type cell of the customer Excel import (TD-421)', () => {
  it('reads an empty cell as no type, so an existing party keeps its own', () => {
    for (const empty of ['', '   ', undefined, null, '‌']) expect(parsePartyTypeCell(empty)).toBeUndefined();
  });

  it('reads supplier with or without hamza and both before supplier', () => {
    expect(parsePartyTypeCell('تامین‌کننده')).toBe('supplier');
    expect(parsePartyTypeCell('تأمین‌کننده')).toBe('supplier');
    expect(parsePartyTypeCell(' Supplier ')).toBe('supplier');
    expect(parsePartyTypeCell('هر دو')).toBe('both');
    expect(parsePartyTypeCell('هر دو (مشتری و تامین‌کننده)')).toBe('both');
    expect(parsePartyTypeCell('مشتری و تأمین کننده')).toBe('both');
    expect(parsePartyTypeCell('BOTH')).toBe('both');
    expect(parsePartyTypeCell('مشتری')).toBe('customer');
  });

  it('labels an empty cell "unchanged" on an existing party and "customer" on a new one', () => {
    expect(partyTypeCellLabel(undefined, true)).toBe('بدون تغییر');
    expect(partyTypeCellLabel(undefined, false)).toBe('مشتری');
    expect(partyTypeCellLabel('supplier', true)).toBe('تامین‌کننده');
    expect(partyTypeCellLabel('both', false)).toBe('هر دو (مشتری و تامین‌کننده)');
  });
});
