import { and, eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, customers, documents, journalVoucherItems, journalVouchers, woocommerceOrderLogs } from '../../db/schema.js';
import { cleanTestTableData } from '../fixtures/dbTestHelper.js';

/**
 * Package 15 (events and integrations), TD-703 / B15-01 (decision t1 a): a WooCommerce buyer whose name is the name of
 * another customer gets a new customer named «name (phone)», the invoice and its voucher go to that customer and the order
 * log says so; a name differing only in letter case matches the stored customer, whose stored name the invoice takes. On
 * v9.0.323 the namesake's sale was debited to the existing customer (detailed_id of the other person), a case variant
 * left the receivable row without a party, and nothing was reported.
 */
export async function runWooNamesakeCustomerTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_woocommerce_namesake_customer_td_703';
  if (!shouldRun(id, 'td703', 'b15-01', 'woocommerce', 'customer', 'package15')) return results;

  const name = 'v9.0.324: a WooCommerce namesake with another phone gets a distinct customer and a case variant matches the stored customer (TD-703)';
  const tStart = Date.now();
  const tag = String(Date.now()).slice(-7);
  const orderIds = [1, 2, 3, 4].map(n => `703${tag}${n}`);
  const customerIds: number[] = [];
  try {
    const { WooOrderSyncService } = await import('../../services/woocommerce/wooOrderSync.service.js');
    const { namesakeCustomerName } = await import('../../services/woocommerce/wooOrderCustomer.js');
    const { createTestItem } = await import('../fixtures/factories.js');
    const item = await createTestItem({ code: `WC_TD703_${tag}`, stocks: { '': 20 } });
    const order = (wcId: string, firstName: string, lastName: string, phone: string) => ({
      id: wcId, number: wcId, status: 'processing', currency: 'IRR', total: '500000',
      billing: { first_name: firstName, last_name: lastName, phone, city: 'تهران', address_1: 'خیابان آزمون' },
      line_items: [{ id: 1, name: 'قلم آزمون', sku: item.code, quantity: 1, price: 500000, total: '500000' }],
    });
    const addCustomer = async (customerName: string, phone: string) => {
      const [row] = await orm.insert(customers).values({ name: customerName, phone }).returning({ id: customers.id });
      customerIds.push(row.id);
      return row.id;
    };
    const receivableParty = async (docId: number) => {
      const rows = await orm.select({ detailedId: journalVoucherItems.detailedId, debit: journalVoucherItems.debit })
        .from(journalVoucherItems)
        .innerJoin(journalVouchers, eq(journalVouchers.id, journalVoucherItems.voucherId))
        .where(and(eq(journalVouchers.sourceDocumentId, docId), eq(journalVouchers.isDeleted, 0),
          eq(journalVoucherItems.isDeleted, 0), eq(journalVoucherItems.detailedType, 'customer')));
      return rows.find(r => Number(r.debit) > 0)?.detailedId ?? null;
    };
    const buyerOf = async (docId: number) => (await orm.select({ b: documents.buyerName }).from(documents).where(eq(documents.id, docId)))[0]?.b;
    const wrong: string[] = [];

    // 1. a namesake with another phone: distinct customer «name (phone)», invoice and receivable on it, note in the log
    const first = 'ERP-TEST-MARKER علی';
    const last = `رضایی ${tag}`;
    const existingId = await addCustomer(`${first} ${last}`, `0912${tag}`);
    const namesakePhone = `0935${tag}`;
    const r1 = await WooOrderSyncService.handleOrder(order(orderIds[0], first, last, namesakePhone));
    const distinct = namesakeCustomerName(`${first} ${last}`, namesakePhone);
    if (r1.status !== 'processed' || !r1.docId) throw new Error(`namesake order not invoiced: ${r1.status} ${r1.message}`);
    const [created] = await orm.select().from(customers).where(and(eq(customers.name, distinct), eq(customers.isDeleted, 0)));
    if (!created) wrong.push(`no customer «${distinct}» was created`);
    else customerIds.push(created.id);
    if (await buyerOf(r1.docId) !== distinct) wrong.push(`namesake invoice buyer: ${await buyerOf(r1.docId)}`);
    const party1 = await receivableParty(r1.docId);
    if (!created || party1 !== created.id) wrong.push(`namesake receivable party ${party1} (existing customer ${existingId}, new ${created?.id})`);
    const [log1] = await orm.select().from(woocommerceOrderLogs).where(eq(woocommerceOrderLogs.wcOrderId, orderIds[0]));
    if (!String(log1?.errorMessage ?? '').includes(distinct) || !r1.message.includes(distinct)) wrong.push(`order log does not report the distinct customer: «${log1?.errorMessage}»`);
    if (created) {
      const audit = await orm.select({ id: activityLogs.id }).from(activityLogs)
        .where(and(eq(activityLogs.entity, 'طرف حساب'), eq(activityLogs.entityId, String(created.id)), eq(activityLogs.action, 'CREATE')));
      if (audit.length !== 1) wrong.push(`audit rows for the new customer: ${audit.length}`);
    }

    // 2. the same buyer again: found by phone, no third customer
    const r2 = await WooOrderSyncService.handleOrder(order(orderIds[1], first, last, namesakePhone));
    if (r2.status !== 'processed' || !r2.docId) wrong.push(`second order: ${r2.status} ${r2.message}`);
    else if (await buyerOf(r2.docId) !== distinct) wrong.push(`second order buyer: ${await buyerOf(r2.docId)}`);
    const sameName = await orm.select({ id: customers.id }).from(customers).where(and(eq(customers.name, distinct), eq(customers.isDeleted, 0)));
    if (sameName.length !== 1) wrong.push(`customers named «${distinct}»: ${sameName.length}`);

    // 3. a letter-case variant without a phone: the stored customer and its stored name
    const saraId = await addCustomer(`ERP-TEST-MARKER Sara Ahmadi${tag}`, '');
    const r3 = await WooOrderSyncService.handleOrder(order(orderIds[2], 'erp-test-marker sara', `ahmadi${tag}`, ''));
    if (r3.status !== 'processed' || !r3.docId) wrong.push(`case variant order: ${r3.status} ${r3.message}`);
    else {
      if (await buyerOf(r3.docId) !== `ERP-TEST-MARKER Sara Ahmadi${tag}`) wrong.push(`case variant buyer: ${await buyerOf(r3.docId)}`);
      const party3 = await receivableParty(r3.docId);
      if (party3 !== saraId) wrong.push(`case variant receivable party ${party3} (expected ${saraId})`);
    }

    // 4. the distinct name is taken too: the order fails with a message instead of posting to someone else
    const takenFirst = 'ERP-TEST-MARKER مریم';
    const takenLast = `کاظمی ${tag}`;
    const takenPhone = `0919${tag}`;
    await addCustomer(`${takenFirst} ${takenLast}`, `0901${tag}`);
    await addCustomer(namesakeCustomerName(`${takenFirst} ${takenLast}`, takenPhone), `0902${tag}`);
    const r4 = await WooOrderSyncService.handleOrder(order(orderIds[3], takenFirst, takenLast, takenPhone));
    const [log4] = await orm.select().from(woocommerceOrderLogs).where(eq(woocommerceOrderLogs.wcOrderId, orderIds[3]));
    if (r4.status !== 'failed' || log4?.erpDocumentId) wrong.push(`taken distinct name: ${r4.status}, document ${log4?.erpDocumentId}`);
    if (!String(log4?.errorMessage ?? '').includes('نام متمایز')) wrong.push(`taken distinct name message: «${log4?.errorMessage}»`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'namesake -> distinct customer with its own receivable and a log note; repeat order found by phone; case variant -> stored customer; taken distinct name -> failed order',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    const logs = await orm.select({ docId: woocommerceOrderLogs.erpDocumentId }).from(woocommerceOrderLogs)
      .where(inArray(woocommerceOrderLogs.wcOrderId, orderIds));
    await orm.delete(woocommerceOrderLogs).where(inArray(woocommerceOrderLogs.wcOrderId, orderIds));
    const docIds = logs.map(l => l.docId).filter((v): v is number => typeof v === 'number');
    if (docIds.length > 0) {
      await cleanTestTableData('document_items', 'document_id', docIds);
      await cleanTestTableData('transactions', 'document_id', docIds);
    }
    if (customerIds.length > 0) await orm.update(customers).set({ isDeleted: 1 }).where(inArray(customers.id, customerIds));
  }
  return results;
}
