import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PARTNER_ACCOUNT_FIELD_TEXT, PartyPurposeFields } from '../../components/accounting/treasury/PartyPurposeFields';

// v12 colleague sales part B2: the treasury form offers «حساب جاری شریک»; a rial row of it asks the euro rate
afterEach(() => cleanup());

describe('v12 colleague sales: the partner account use in the treasury form', () => {
  it('is offered only where the form asks for it (the cheque book does not)', () => {
    const { rerender } = render(<PartyPurposeFields partyType="personnel" purpose="" contraAccountId={null} isReceipt onChange={vi.fn()} />);
    expect(screen.queryByRole('option', { name: PARTNER_ACCOUNT_FIELD_TEXT.option(true) })).toBeNull();
    rerender(<PartyPurposeFields partyType="personnel" purpose="" contraAccountId={null} isReceipt onChange={vi.fn()}
      partnerAccount={{ bankCurrency: 'IRR', euroRate: 0, onEuroRateChange: vi.fn() }} />);
    expect(screen.getByRole('option', { name: PARTNER_ACCOUNT_FIELD_TEXT.option(true) })).toBeTruthy();
  });

  it('asks the euro rate of a rial row and none of a euro row', () => {
    const onRate = vi.fn();
    const { rerender } = render(<PartyPurposeFields partyType="personnel" purpose="partner_account" contraAccountId={null} isReceipt onChange={vi.fn()}
      partnerAccount={{ bankCurrency: 'IRR', euroRate: 0, onEuroRateChange: onRate }} />);
    const rate = screen.getByLabelText(PARTNER_ACCOUNT_FIELD_TEXT.rate);
    expect(rate).toHaveProperty('required', true);
    fireEvent.change(rate, { target: { value: '2100000' } });
    expect(onRate).toHaveBeenLastCalledWith(2100000);
    rerender(<PartyPurposeFields partyType="personnel" purpose="partner_account" contraAccountId={null} isReceipt onChange={vi.fn()}
      partnerAccount={{ bankCurrency: 'EUR', euroRate: 0, onEuroRateChange: onRate }} />);
    expect(screen.queryByLabelText(PARTNER_ACCOUNT_FIELD_TEXT.rate)).toBeNull();
    expect(screen.getByText(PARTNER_ACCOUNT_FIELD_TEXT.euroHint)).toBeTruthy();
  });
});
