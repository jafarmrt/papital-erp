import request from 'supertest';
import { inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { customers } from '../../db/schema.js';

/**
 * بسته ۹ (مشتریان و CRM) — ستون نوع در درون‌ریزی اکسل طرف حساب‌ها در مسیر واقعی Express؛ روی کد پیشین قرمز است.
 */

export async function runCustomerImportPartyTypeTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_customer_import_keeps_party_type_td_421';
  if (!shouldRun(id, 'td421', 'customer', 'excel', 'import', 'package9')) return results;

  const name = 'v9.0.9: an empty type cell in the Excel import keeps an existing party\'s type and makes a new record a customer; supplier with hamza and «both (customer and supplier)» are read correctly (TD-421)';
  const tStart = Date.now();
  const customerIds: number[] = [];
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestCustomer } = await import('../fixtures/factories.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const tag = String(Date.now()).slice(-6);
    const wrong: string[] = [];

    const supplier = await createTestCustomer({ name: `تامین سنگ الماس ${tag}`, phone: `0913${tag}1`, partyType: 'supplier', supplierCategory: 'سنگ' });
    const both = await createTestCustomer({ name: `کارگاه نقره ${tag}`, phone: `0913${tag}2`, partyType: 'both' });
    const switched = await createTestCustomer({ name: `پخش مهره ${tag}`, phone: `0913${tag}3`, partyType: 'supplier' });
    customerIds.push(supplier.id, both.id, switched.id);

    const fresh = { plain: `مشتری تازه ${tag}`, hamza: `تأمین طلا ${tag}`, dual: `بازرگانی دوسویه ${tag}` };
    const res = await request(app).post('/api/customers/bulk-import').set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send({
      updateIfExists: true,
      rows: [
        { name: supplier.name, city: 'اصفهان' },
        { name: both.name, city: 'شیراز', partyType: '' },
        { name: switched.name, partyType: 'مشتری' },
        { name: fresh.plain },
        { name: fresh.hamza, partyType: 'تأمین‌کننده' },
        { name: fresh.dual, partyType: 'هر دو (مشتری و تامین‌کننده)' },
      ],
    });
    if (res.status !== 200 || res.body?.updatedCount !== 3 || res.body?.createdCount !== 3 || (res.body?.errors ?? []).length !== 0) {
      throw new Error(`import returned ${res.status}: updated ${res.body?.updatedCount}, new ${res.body?.createdCount}, errors ${JSON.stringify(res.body?.errors ?? res.body).slice(0, 200)}`);
    }

    const rows = await orm.select({ id: customers.id, name: customers.name, partyType: customers.partyType, city: customers.city, supplierCategory: customers.supplierCategory })
      .from(customers).where(inArray(customers.name, [supplier.name, both.name, switched.name, fresh.plain, fresh.hamza, fresh.dual]));
    for (const r of rows) if (!customerIds.includes(r.id)) customerIds.push(r.id);
    const byName = new Map(rows.map(r => [r.name, r]));
    const expectType = (n: string, type: string, why: string) => {
      const got = byName.get(n)?.partyType;
      if (got !== type) wrong.push(`${why}: type of "${n}" became ${String(got)}, not ${type}`);
    };
    expectType(supplier.name, 'supplier', 'a supplier with a row of only name and city');
    expectType(both.name, 'both', 'a "both" party with an empty type');
    expectType(switched.name, 'customer', 'an explicit "customer" type on a supplier');
    expectType(fresh.plain, 'customer', 'a new row without a type');
    expectType(fresh.hamza, 'supplier', 'a new row with "supplier" (spelled with hamza)');
    expectType(fresh.dual, 'both', 'a new row with "both (customer and supplier)"');
    const s = byName.get(supplier.name);
    if (s?.city !== 'اصفهان' || s?.supplierCategory !== 'سنگ') wrong.push(`supplier city and category became ${s?.city} / ${s?.supplierCategory}`);

    if (wrong.length > 0) throw new Error(wrong.join(', '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'supplier and "both" with an empty type kept their type and their city was updated; an explicit "customer" changed the type; a new row with no type became customer, with "supplier" supplier and with "both (...)" both',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (customerIds.length > 0) await orm.update(customers).set({ isDeleted: 1 }).where(inArray(customers.id, customerIds)).catch(() => undefined);
  }
  return results;
}
