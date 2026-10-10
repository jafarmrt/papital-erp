import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PartyPurposeFields } from '../../components/accounting/treasury/PartyPurposeFields';
import { isSalarySettlementPayment } from '../../lib/treasury/partyPurpose';

afterEach(cleanup);

const SETTLEMENT_OPTION = 'تسویه حقوق و دستمزد → «حقوق پرداختنی»';

const fields = (isReceipt: boolean) => render(
  <PartyPurposeFields partyType="personnel" purpose="" contraAccountId={null} isReceipt={isReceipt} settlementViaPayslipOnly onChange={() => undefined} />,
);

// v10.0.57 (TD-925, decision t8 «الف»): salary is settled only through the payslip payment
describe('salary settlement only through the payslip (TD-925)', () => {
  it('the treasury payment form offers no salary settlement and says where it is paid', () => {
    fields(false);
    expect(screen.queryByRole('option', { name: SETTLEMENT_OPTION })).toBeNull();
    expect(screen.getByText(/پرداخت فیش/)).toBeTruthy();
  });

  it('the treasury receipt form still offers a settlement receipt', () => {
    fields(true);
    expect(screen.getByRole('option', { name: SETTLEMENT_OPTION })).toBeTruthy();
  });

  it('the shared rule refuses only a personnel settlement payment', () => {
    expect(isSalarySettlementPayment('payment', 'personnel', 'settlement')).toBe(true);
    expect(isSalarySettlementPayment('receipt', 'personnel', 'settlement')).toBe(false);
    expect(isSalarySettlementPayment('payment', 'personnel', 'advance')).toBe(false);
    expect(isSalarySettlementPayment('payment', 'supplier', 'settlement')).toBe(false);
  });
});
