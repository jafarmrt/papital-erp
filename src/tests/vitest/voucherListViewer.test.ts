import { describe, expect, it } from 'vitest';
import { isViewerVoucherMaker, voucherMakerName, voucherReferenceText } from '../../lib/accounting/voucherListViewer';

const TREASURY_REFERENCE = 'خزانه (REC-12)';
const OTHER_REFERENCE = 'سایر (X-1)';
const FULL_NAME = 'مدیر مالی';

describe('voucher list viewer (TD-1129, TD-1230, TD-1231)', () => {
  it('TD-1129: names the reference module in Persian, never its code', () => {
    expect(voucherReferenceText('treasury', 'REC-12')).toBe(TREASURY_REFERENCE);
    expect(voucherReferenceText('unknown_module', 'X-1')).toBe(OTHER_REFERENCE);
    for (const code of ['invoice', 'inventory', 'cheque', 'payroll', 'payroll_payment', 'item_opening', 'treasury_opening']) {
      expect(voucherReferenceText(code, 'N')).not.toMatch(/[a-z]{3,}/);
    }
  });

  it('TD-1230: shows the maker full name, else the username', () => {
    expect(voucherMakerName({ createdByName: FULL_NAME, createdByUsername: 'modir-mali' })).toBe(FULL_NAME);
    expect(voucherMakerName({ createdByName: '', createdByUsername: 'anbar' })).toBe('anbar');
  });

  it('TD-1231: the maker of a manual draft is not offered the approval, others and the admin are', () => {
    const draft = { status: 'draft', createdById: 5, updatedById: 7, sourceKind: null, sourceFiscalYear: null };
    expect(isViewerVoucherMaker(draft, { id: 5, isAdmin: false })).toBe(true);
    expect(isViewerVoucherMaker(draft, { id: 7, isAdmin: false })).toBe(true);
    expect(isViewerVoucherMaker(draft, { id: 9, isAdmin: false })).toBe(false);
    expect(isViewerVoucherMaker(draft, { id: 5, isAdmin: true })).toBe(false);
    expect(isViewerVoucherMaker({ ...draft, sourceKind: 'document' }, { id: 5, isAdmin: false })).toBe(false);
    expect(isViewerVoucherMaker({ ...draft, status: 'approved' }, { id: 5, isAdmin: false })).toBe(false);
  });
});
