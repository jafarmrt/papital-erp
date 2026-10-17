/**
 * Closing sweep (#291 review): the cheque status window fixes a paid cheque's clearing account from the type the cheque
 * row carries, not only from the loaded account list. Red on v10.1.65, where an account missing from the list asked
 * for another account that the server then refused with CHEQUE_PAID_BANK_FIXED.
 */
import { describe, expect, it } from 'vitest';
import { PAID_CHEQUE_OPEN_CLEARING_STATUSES, paidChequeIssuingAccountFixed } from '../../lib/treasury/chequeTransitions';

describe('paid cheque issuing account', () => {
  it('paid_cheque_issuing_account_from_row: the row type decides, the loaded list is the fallback', () => {
    expect(paidChequeIssuingAccountFixed({ type: 'paid', bankAccountId: 4, bankAccountType: 'bank' }, undefined)).toBe(true);
    expect(paidChequeIssuingAccountFixed({ type: 'paid', bankAccountId: 4, bankAccountType: 'pos' }, 'bank')).toBe(false);
    expect(paidChequeIssuingAccountFixed({ type: 'paid', bankAccountId: 4 }, 'cash')).toBe(true);
    expect(paidChequeIssuingAccountFixed({ type: 'paid', bankAccountId: 4 }, undefined)).toBe(false);
    expect(paidChequeIssuingAccountFixed({ type: 'received', bankAccountId: 4, bankAccountType: 'bank' })).toBe(false);
    expect(paidChequeIssuingAccountFixed({ type: 'paid', bankAccountId: null, bankAccountType: 'bank' })).toBe(false);
  });

  it('paid_cheque_open_clearing_statuses: a paid cheque still clears from received, in treasury, in safe and a legacy in collection', () => {
    expect([...PAID_CHEQUE_OPEN_CLEARING_STATUSES].sort()).toEqual(['in_collection', 'in_safe', 'in_treasury', 'received']);
  });
});
