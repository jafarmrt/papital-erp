import request from 'supertest';
import { eq } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { customers } from '../../db/schema.js';

/**
 * Package 9 (customers and CRM), TD-975: `PUT /customers/:id` changes only the fields it is sent. Before, the edit body
 * used the create schema with `.default('')`, so an edit sending only the phone emptied the address, notes, bank details
 * and contacts and set the party type back to «customer». Red on v10.0.26.
 */
export async function runCustomerPartialEditTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_customer_partial_edit_keeps_fields_td_975';
  if (!shouldRun(id, 'td975', 'customers', 'package9')) return results;

  const name = 'v10.0.27: a party edit that sends only some fields keeps every other field (address, notes, type, bank details, contacts) (TD-975)';
  const tStart = Date.now();
  let customerId: number | null = null;
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestCustomer } = await import('../fixtures/factories.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const bank = { bankName: 'ملت', accountNumber: '1234567890', shaba: 'IR120000000000001234567890', cardNumber: '6104337812345678' };
    const contacts = [{ id: 'c1', name: 'رابط آزمایشی', role: 'خرید', phone: '09121112233', isPrimary: true }];
    const created = await createTestCustomer({
      partyType: 'supplier', address: 'نشانی آزمایشی TD-975', notes: 'یادداشت آزمایشی TD-975', city: 'شیراز',
      supplierCategory: 'سنگ', bankInfo: bank, contacts,
    });
    customerId = created.id;

    const res = await request(app).put(`/api/customers/${created.id}`)
      .set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken)
      .send({ phone: '09129998877', version: created.version });
    if (res.status !== 200) throw new Error(`partial edit answered ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);

    const [row] = await orm.select().from(customers).where(eq(customers.id, created.id));
    const wrong: string[] = [];
    if (row.phone !== '09129998877') wrong.push(`phone ${row.phone}`);
    if (row.name !== created.name) wrong.push(`name ${row.name}`);
    if (row.partyType !== 'supplier') wrong.push(`party type ${row.partyType}`);
    if (row.address !== 'نشانی آزمایشی TD-975') wrong.push('address changed');
    if (row.notes !== 'یادداشت آزمایشی TD-975') wrong.push('notes changed');
    if (row.city !== 'شیراز') wrong.push('city changed');
    if (row.supplierCategory !== 'سنگ') wrong.push('supplier category changed');
    const storedBank = (row.bankInfo ?? {}) as Record<string, string>;
    if (Object.entries(bank).some(([k, v]) => storedBank[k] !== v)) wrong.push(`bank info ${JSON.stringify(row.bankInfo)}`);
    if (!Array.isArray(row.contacts) || row.contacts.length !== 1) wrong.push(`contacts ${JSON.stringify(row.contacts)}`);
    if (row.version !== created.version + 1) wrong.push(`version ${row.version}`);

    // A sent bank field changes only itself
    const res2 = await request(app).put(`/api/customers/${created.id}`)
      .set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken)
      .send({ bankInfo: { bankName: 'ملی' }, version: row.version });
    if (res2.status !== 200) wrong.push(`bank edit answered ${res2.status}`);
    const [row2] = await orm.select().from(customers).where(eq(customers.id, created.id));
    const bank2 = row2.bankInfo as Record<string, string>;
    if (bank2?.bankName !== 'ملی' || bank2?.cardNumber !== bank.cardNumber) wrong.push(`bank after partial bank edit ${JSON.stringify(bank2)}`);

    if (wrong.length > 0) throw new Error(wrong.join(' | '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'Phone-only edit kept address, notes, city, type, category, bank details and contacts; a partial bank edit kept the other bank fields',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (customerId !== null) await orm.update(customers).set({ isDeleted: 1 }).where(eq(customers.id, customerId)).catch(() => undefined);
  }
  return results;
}
