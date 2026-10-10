import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { voucherPrimaryAction } from '../../lib/accounting/voucherRowActions';
import { VoucherPrimaryActionCell } from '../../components/accounting/vouchers/VoucherPrimaryActionCell';

// Guide side findings of lane L1 (TD-1120..TD-1125): accounting screens that misled a user.

const LEDGER_LOCK = 'قفل دفاتر';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('voucher primary action shows the ledger lock only on a permanent voucher (TD-1120)', () => {
  it('maps status and access to the primary action', () => {
    expect(voucherPrimaryAction('permanent', { canApprove: true, canFinalize: true })).toBe('locked');
    expect(voucherPrimaryAction('draft', { canApprove: true, canFinalize: true })).toBe('approve');
    expect(voucherPrimaryAction('draft', { canApprove: false, canFinalize: true })).toBeNull();
    expect(voucherPrimaryAction('approved', { canApprove: true, canFinalize: true })).toBe('finalize');
    expect(voucherPrimaryAction('approved', { canApprove: true, canFinalize: false })).toBeNull();
  });

  it('renders no lock badge for a draft or approved voucher the user cannot advance', () => {
    render(<VoucherPrimaryActionCell status="draft" />);
    expect(screen.queryByText(LEDGER_LOCK)).toBeNull();
    cleanup();
    render(<VoucherPrimaryActionCell status="approved" />);
    expect(screen.queryByText(LEDGER_LOCK)).toBeNull();
    cleanup();
    render(<VoucherPrimaryActionCell status="permanent" onApprove={() => {}} onFinalize={() => {}} />);
    expect(screen.getByText(LEDGER_LOCK)).toBeTruthy();
  });
});

describe('treasury rows offer the move-to-another-document button where the server moves them (TD-1122)', () => {
  it('only a live customer receipt or supplier payment that is not a payslip payment', async () => {
    const { canRelinkTreasuryRow } = await import('../../lib/treasury/treasuryRelink');
    expect(canRelinkTreasuryRow({ type: 'receipt', partyType: 'customer', status: 'completed' })).toBe(true);
    expect(canRelinkTreasuryRow({ type: 'payment', partyType: 'supplier', status: 'completed' })).toBe(true);
    expect(canRelinkTreasuryRow({ type: 'receipt', partyType: 'supplier', status: 'completed' })).toBe(false);
    expect(canRelinkTreasuryRow({ type: 'payment', partyType: 'personnel', status: 'completed' })).toBe(false);
    expect(canRelinkTreasuryRow({ type: 'payment', partyType: 'supplier', status: 'voided' })).toBe(false);
    expect(canRelinkTreasuryRow({ type: 'receipt', partyType: 'customer', reversalOfId: 4 })).toBe(false);
    expect(canRelinkTreasuryRow({ type: 'payment', partyType: 'supplier', payrollId: 9 })).toBe(false);
  });
});
