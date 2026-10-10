import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// v10.0.136 (TD-1222): the customer dossier has no English label and the party card totals name both sides of a party
const read = (p: string) => readFileSync(resolve(process.cwd(), 'src', p), 'utf8');
const DEBIT_LABEL = 'مجموع بدهکار (فروش به شخص و پرداخت به او)';
const CREDIT_LABEL = 'مجموع بستانکار (دریافت از شخص و خرید از او)';

describe('customer dossier labels (TD-1222)', () => {
  it('the dossier shows no English label', () => {
    const src = read('components/crm/CustomerDossierDrawer.tsx');
    expect(src).not.toContain('(Won)');
    expect(src).not.toContain('(Double-Entry Ledger)');
  });
  it('the party card totals fit a customer and a supplier', () => {
    const src = read('pages/CustomersPage.tsx');
    expect(src).toContain(DEBIT_LABEL);
    expect(src).toContain(CREDIT_LABEL);
  });
});
