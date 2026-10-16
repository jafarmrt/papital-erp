import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { CHEQUE_STATUSES, CHEQUE_STATUS_LABELS, chequeHasNextStep, chequeNextStatuses, chequeStepTakesBankAccount, isChequeClearingAccountType } from '../../lib/treasury/chequeTransitions';

// v10.1.47 closing sweep: OBS-R1-61 (paid cheque steps), OBS-R1-70 (bank account only for collection and clearing),
// OBS-PR-12 (the list filter takes the real statuses).
const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../..', rel), 'utf8');

describe('OBS-R1-61: the next steps of a cheque follow its type', () => {
  it('a paid cheque is never sent to collection or spent', () => {
    expect(chequeNextStatuses('in_treasury', 'paid')).toEqual(['passed', 'bounced']);
    expect(chequeNextStatuses('in_treasury', 'received')).toContain('in_collection');
    expect(chequeNextStatuses('received', 'received')).toContain('spent');
    expect(chequeHasNextStep('passed', 'paid')).toBe(false);
    expect(chequeHasNextStep('bounced', 'paid')).toBe(true);
  });
});

describe('OBS-R1-70: only collection and clearing take a bank account', () => {
  it('names the two steps and the window sends no default bank', () => {
    expect(CHEQUE_STATUSES.filter(chequeStepTakesBankAccount)).toEqual(['in_collection', 'passed']);
    expect(read('src/components/accounting/ChequesTab.tsx')).not.toContain('bankAccounts[0]');
  });
});

describe('OBS-PR-12: the list filter takes every real status', () => {
  it('CHEQUE_STATUSES is the label table and the schema reads it', () => {
    expect([...CHEQUE_STATUSES].sort()).toEqual(Object.keys(CHEQUE_STATUS_LABELS).sort());
    const schemas = read('src/routes/accounting/accounting.schemas.ts');
    expect(schemas).toContain("status: z.enum([...CHEQUE_STATUSES, 'all']).optional()");
    expect(schemas).not.toMatch(/'pending',\s*'passed',\s*'cashed'/);
  });
});

describe('OBS-R2-04: saving settings reads the shop warehouse with the save transaction', () => {
  it('validateSettingValue takes the transaction and reads warehouses through it', () => {
    const src = read('src/services/settings/systemSettings.service.ts');
    expect(src).toContain('await validateSettingValue(tx, item.key, value)');
    expect(src).not.toMatch(/await orm\.select\(\{ id: warehouses\.id \}\)/);
  });
});

describe('decision t40: a cheque clears only into a bank or cash account', () => {
  it('allows bank and cash, refuses POS and petty cash', () => {
    expect(['bank', 'cash', 'pos', 'petty_cash'].filter(isChequeClearingAccountType)).toEqual(['bank', 'cash']);
  });

  it('the status window lists only those accounts and shows the issuing account of a paid cheque', () => {
    const tab = read('src/components/accounting/ChequesTab.tsx');
    expect(tab).toContain('clearingBankAccounts.map');
    expect(tab).toContain('paidBankFixed');
  });
});
