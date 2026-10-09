// v10.0.31 (OBS-R2-30, TD-991): the proforma opened from a sales lead never prints the lead's notes as the buyer address.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { leadProformaState } from '../../lib/crm/leadProformaState';

const lead = { id: 12, title: 'گردنبند عروس', customerName: 'سارا', phone: '09120000000', currency: 'USD', notes: 'تماس عصر؛ مشتری حساس به قیمت' };

describe('proforma state from a sales lead (OBS-R2-30)', () => {
  it('leaves the buyer address empty when the customer has none, never the lead notes', () => {
    const state = leadProformaState(lead, { id: 5, name: 'سارا', phone: '', address: '' });
    expect(state.buyerAddress).toBe('');
    expect(JSON.stringify(state)).not.toContain('حساس به قیمت');
  });

  it('takes the customer address, id, name and phone, and the lead currency', () => {
    const state = leadProformaState(lead, { id: 5, name: 'سارا احمدی', phone: '0912', address: 'تهران، ونک' });
    expect(state).toMatchObject({ crmLeadId: 12, customerId: 5, buyerName: 'سارا احمدی', buyerPhone: '0912', buyerAddress: 'تهران، ونک', currency: 'USD', status: 'proforma' });
  });

  it('is what the sales leads page sends to the proforma form', () => {
    const page = readFileSync(join(__dirname, '../../pages/CRMPage.tsx'), 'utf8');
    expect(page).toContain('leadProformaState(lead, res.customer)');
    expect(page).not.toMatch(/buyerAddress:[^\n]*lead\.notes/);
  });
});
