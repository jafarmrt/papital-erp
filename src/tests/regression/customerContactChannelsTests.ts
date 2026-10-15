import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { customers } from '../../db/schema.js';

/**
 * N-02 part 1 (v10.1.15): a party's website, e-mail and Instagram username (and each contact person's e-mail) are
 * checked and normalized by one rule on create, edit and Excel import. A wrong value is 422
 * `CUSTOMER_CONTACT_CHANNEL_INVALID` before any write (an import row error), a field not sent keeps its value, an empty
 * import cell leaves it unchanged, and the customer list search reads them. Red on v10.1.12, which had no such columns.
 */
export async function runCustomerContactChannelsTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_customer_contact_channels_n02';
  if (!shouldRun(id, 'n02', 'customers', 'crm')) return results;

  const name = 'v10.1.15: party website, e-mail and Instagram are validated, normalized, kept on partial edits and imported from Excel (N-02)';
  const tStart = Date.now();
  const created: number[] = [];
  const stamp = Date.now();
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const post = (body: object) => request(app).post('/api/customers').set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body);
    const wrong: string[] = [];

    const bad = await post({ name: `N02 bad mail ${stamp}`, email: 'not-an-email' });
    if (bad.status !== 422 || bad.body?.code !== 'CUSTOMER_CONTACT_CHANNEL_INVALID') wrong.push(`bad e-mail answered ${bad.status} ${bad.body?.code}`);
    const badContact = await post({ name: `N02 bad contact ${stamp}`, contacts: [{ name: 'رابط', email: 'x@y' }] });
    if (badContact.status !== 422) wrong.push(`bad contact e-mail answered ${badContact.status}`);
    const badSite = await post({ name: `N02 bad site ${stamp}`, website: 'not a site' });
    if (badSite.status !== 422) wrong.push(`bad website answered ${badSite.status}`);
    const badRows = await orm.select({ id: customers.id }).from(customers)
      .where(inArray(customers.name, [`N02 bad mail ${stamp}`, `N02 bad contact ${stamp}`, `N02 bad site ${stamp}`]));
    if (badRows.length) wrong.push(`refused parties were written: ${badRows.length}`);

    const ok = await post({
      name: `N02 channels ${stamp}`, website: 'Papital.ir/shop', email: ' Info@Papital.IR ', instagram: 'https://www.instagram.com/Papital.Gallery/',
      contacts: [{ name: 'رابط آزمایشی', phone: '09121112233', email: 'buyer@papital.ir', isPrimary: true }],
    });
    if (ok.status !== 200) throw new Error(`valid create answered ${ok.status} ${JSON.stringify(ok.body).slice(0, 200)}`);
    created.push(ok.body.id);
    const [row] = await orm.select().from(customers).where(eq(customers.id, ok.body.id));
    if (row.website !== 'https://Papital.ir/shop') wrong.push(`website ${row.website}`);
    if (row.email !== 'Info@papital.ir') wrong.push(`email ${row.email}`);
    if (row.instagram !== 'papital.gallery') wrong.push(`instagram ${row.instagram}`);
    const contact = (row.contacts as Array<{ email?: string }>)[0];
    if (contact?.email !== 'buyer@papital.ir') wrong.push(`contact email ${JSON.stringify(row.contacts)}`);

    // A partial edit keeps the channels; a sent empty value clears one
    const put = await request(app).put(`/api/customers/${row.id}`).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken)
      .send({ phone: '09125556677', instagram: '', version: row.version });
    if (put.status !== 200) wrong.push(`partial edit answered ${put.status}`);
    const [row2] = await orm.select().from(customers).where(eq(customers.id, row.id));
    if (row2.website !== row.website || row2.email !== row.email) wrong.push(`partial edit changed website or e-mail: ${row2.website} ${row2.email}`);
    if (row2.instagram !== '') wrong.push(`cleared instagram is ${row2.instagram}`);

    // The list search finds the party by its e-mail
    const list = await request(app).get('/api/customers').query({ search: 'info@papital.ir' }).set('Cookie', admin.cookie);
    if (!(list.body?.data ?? []).some((c: { id: number }) => c.id === row.id)) wrong.push('search by e-mail did not find the party');

    // Excel import: a bad cell is a row error, an empty cell keeps the value, a filled cell is normalized
    const imp = await request(app).post('/api/customers/bulk-import').set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send({
      rows: [
        { id: row2.id, version: row2.version, name: row2.name, website: '', email: '', instagram: '@NewHandle' },
        { name: `N02 import bad ${stamp}`, email: 'broken@' },
        { name: `N02 import new ${stamp}`, website: 'example.org' },
      ],
    });
    if (imp.status !== 200) wrong.push(`import answered ${imp.status}`);
    if (!(imp.body?.errors ?? []).some((e: { row: number }) => e.row === 2)) wrong.push(`bad import row not reported: ${JSON.stringify(imp.body?.errors)}`);
    const [row3] = await orm.select().from(customers).where(eq(customers.id, row.id));
    if (row3.website !== row.website || row3.email !== row.email) wrong.push(`empty import cells changed the party: ${row3.website} ${row3.email}`);
    if (row3.instagram !== 'newhandle') wrong.push(`imported instagram ${row3.instagram}`);
    const imported = await orm.select().from(customers).where(inArray(customers.name, [`N02 import bad ${stamp}`, `N02 import new ${stamp}`]));
    created.push(...imported.map(r => r.id));
    if (imported.some(r => r.name.includes('import bad'))) wrong.push('bad import row was written');
    const fresh = imported.find(r => r.name.includes('import new'));
    if (fresh?.website !== 'https://example.org') wrong.push(`imported website ${fresh?.website}`);

    if (wrong.length > 0) throw new Error(wrong.join(' | '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'Wrong channels refused with 422 and nothing written; values normalized; partial edit and empty import cells kept them; search found the e-mail',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (created.length) await orm.update(customers).set({ isDeleted: 1 }).where(inArray(customers.id, created)).catch(() => undefined);
  }
  return results;
}
