import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { TreasuryHealthBanner } from '../../components/accounting/treasury/TreasuryHealthBanner';

// TD-1125: the treasury health banner printed counts in Latin digits, said «دوبل» and did not name a draft voucher as a
// cause of the gap; cheque numbers were printed in Latin digits; treasury, cheque, payslip and invoice settlement screens
// said «سند دوبل» instead of «سند حسابداری».

const ROOT = join(__dirname, '..', '..');
const DRAFT_CAUSE = 'هنوز پیش‌نویس است';
const FILES = [
  'components/accounting/treasury/TreasuryHealthBanner.tsx', 'components/accounting/treasury/BankAccountCard.tsx',
  'components/accounting/treasury/TreasuryTransactionModal.tsx', 'components/accounting/treasury/TreasuryTransferModal.tsx',
  'components/accounting/BankAndTreasuryTab.tsx', 'components/accounting/ChequesTab.tsx', 'components/piecework/PieceworkPayrollsTab.tsx',
  'components/invoices/InvoiceSettlementModal.tsx', 'hooks/invoices/useInvoiceSave.ts',
];

afterEach(cleanup);

describe('treasury health banner (TD-1125)', () => {
  it('prints counts in Persian digits and names a draft voucher as a cause', () => {
    const { container } = render(<TreasuryHealthBanner totalLedgerBalance={0} totalTreasuryBalance={5} totalDiscrepancy={5}
      syncedAccountsCount={2} discrepantAccountsCount={3} totalAccountsCount={5} appCurrency="IRR" />);
    const text = container.textContent ?? '';
    expect(text).toContain('۳ حساب');
    expect(text).toContain('۲ از ۵');
    expect(text).not.toMatch(/\d حساب|[0-9] از [0-9]/);
    expect(text).toContain(DRAFT_CAUSE);
    expect(text).not.toContain('دوبل');
  });
});

describe('accounting voucher wording instead of the double-entry loanword, and cheque numbers in Persian digits (TD-1125)', () => {
  it('has no double-entry loanword outside comments', () => {
    const offenders = FILES.flatMap(f => readFileSync(join(ROOT, f), 'utf8').split('\n')
      .map((l, i) => ({ l: l.trim(), at: `${f}:${i + 1}` }))
      .filter(({ l }) => !/^(\/\/|\*|\/\*|\{\/\*)/.test(l) && l.includes('دوبل')).map(x => x.at));
    expect(offenders).toEqual([]);
  });

  it('prints every cheque and Sayad number through toPersianDigits', () => {
    const src = readFileSync(join(ROOT, 'components/accounting/ChequesTab.tsx'), 'utf8')
      + readFileSync(join(ROOT, 'components/accounting/AccountingDashboard.tsx'), 'utf8');
    const raw = src.split('\n').filter(l => /\{[\w.]*(chequeNumber|sayadNumber)\}/.test(l) && !/value=\{/.test(l));
    expect(raw).toEqual([]);
    expect(src).not.toMatch(/formatPersianNumber\([\w.]*chequeNumber\)/);
  });
});
