import request from 'supertest';
import { TestCaseResult, makeTestCase } from '../types.js';
import { getTestApp, getAdminSession, AdminSession, TestApp } from '../fixtures/httpTestHelper.js';
import { createTestItem } from '../fixtures/factories.js';
import { orm } from '../../db/drizzle.js';
import { sql } from 'drizzle-orm';
import { journalVoucherItems, journalVouchers, cheques, documents, documentItems, transactions, items } from '../../db/schema.js';
import { eq, inArray } from 'drizzle-orm';

function extractId(body: any): number | undefined {
  const raw = body?.id ?? body?.docId ?? body?.data?.id ?? body?.data?.docId ?? body?.voucher?.id ?? body?.document?.id;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function extractVoucherNumber(body: any): string | number | undefined {
  return body?.voucherNumber ?? body?.data?.voucherNumber ?? body?.voucher?.voucherNumber;
}

async function runCase(
  results: TestCaseResult[],
  id: string,
  scenarioId: string,
  name: string,
  fn: () => Promise<string>
): Promise<void> {
  const start = Date.now();
  try {
    const details = await fn();
    results.push(makeTestCase({
      id,
      scenarioId: scenarioId as any,
      name,
      layer: 'critical_path',
      executionType: 'real_api',
      passed: true,
      durationMs: Date.now() - start,
      details
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id,
      scenarioId: scenarioId as any,
      name,
      layer: 'critical_path',
      executionType: 'real_api',
      passed: false,
      durationMs: Date.now() - start,
      error: err?.message || String(err)
    }));
  }
}

export async function runCriticalPathTests(): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const app: TestApp = await getTestApp();
  let session: AdminSession = { cookie: '', csrfToken: '' };

  try {
    session = await getAdminSession();
  } catch {
    session = { cookie: '', csrfToken: '' };
  }

  const authHeaders = () => ({
    Origin: 'http://localhost:3000',
    Cookie: session.cookie,
    'x-csrf-token': session.csrfToken
  });

  // ===============================================================
  // 1. Concurrent voucher inserts → PostgreSQL SEQUENCE uniqueness (DB-001)
  // ===============================================================
  await runCase(results, 'cp_voucher_concurrent_unique', 'concurrent_voucher_unique_postgres',
    'یکپارچگی: درج همزمان اسناد حسابداری باید شمارههای یکتا تولید کند',
    async () => {
      if (!session.cookie) throw new Error('admin session in hand nist');

      const accountsRes = await orm.execute(sql`
        SELECT id FROM accounts WHERE is_deleted = 0 ORDER BY id LIMIT 2
      `);
      const accountRows: any[] = (accountsRes as any).rows || [];
      if (accountRows.length < 2) throw new Error('حداقل دو سرفصل برای آزمون لازم است');
      const accA = accountRows[0].id;
      const accB = accountRows[1].id;

      const stamp = Date.now();
      const promises = [];
      for (let i = 0; i < 8; i++) {
        promises.push(
          request(app)
            .post('/api/accounting/vouchers')
            .set(authHeaders())
            .send({
              date: new Date().toISOString().split('T')[0],
              voucherType: 'general',
              description: `CP-RACE-${stamp}-${i}`,
              items: [
                { accountId: accA, debit: 1000 + i, credit: 0 },
                { accountId: accB, debit: 0, credit: 1000 + i }
              ]
            })
        );
      }

      const responses = await Promise.all(promises);
      const okResponses = responses.filter(r => r.status >= 200 && r.status < 300);
      if (okResponses.length < 2) {
        throw new Error(`فقط ${okResponses.length} سند از ۸ موفق شد: ${responses.map(r => r.status).join(',')}`);
      }

      const numbers = okResponses.map(r => String(extractVoucherNumber(r.body)));
      const uniqueNumbers = new Set(numbers);
      if (uniqueNumbers.size !== numbers.length) {
        throw new Error(`شماره سند تکراری تولید شد! ${numbers.join(' , ')}`);
      }

      // Cleanup created vouchers
      const ids = okResponses.map(r => extractId(r.body)).filter(Boolean) as number[];
      if (ids.length > 0) {
        await orm.delete(journalVoucherItems).where(inArray(journalVoucherItems.voucherId, ids));
        await orm.delete(journalVouchers).where(inArray(journalVouchers.id, ids));
      }

      return `${okResponses.length} سند همزمان ثبت شد و تمام شمارهها یکتا بودند (${numbers.slice(0, 3).join(',')}...).`;
    });

  // ===============================================================
  // 2. Concurrent finalize race → single stock deduction (DB-002 / DB-005)
  // ===============================================================
  await runCase(results, 'cp_finalize_race_single_deduction', 'finalize_race_single_deduction',
    'یکپارچگی: نهاییسازی همزمان سند باید موجودی را دقیقا یکبار کسر کند',
    async () => {
      if (!session.cookie) throw new Error('admin session in hand nist');

      const item = await createTestItem({ currentStock: 100 });
      const initialStock = Number(item.currentStock ?? 100);
      const qty = 3;

      const createRes = await request(app)
        .post('/api/documents')
        .set(authHeaders())
        .send({
          docType: 'invoice',
          refNumber: `CP-FIN-${Date.now()}`,
          date: new Date().toISOString().split('T')[0],
          status: 'draft',
          inOut: 'out',
          buyer_name: 'خریدار مسابقه نهاییسازی',
          items: [{ itemId: item.id, quantity: qty, unit_price: 1000 }]
        });

      if (createRes.status !== 200 && createRes.status !== 201) {
        throw new Error(`ایجاد سند شکست خورد (${createRes.status}): ${JSON.stringify(createRes.body).slice(0, 250)}`);
      }
      const docId = extractId(createRes.body);
      if (!docId) throw new Error('شناسه سند بازنگشت');

      // 10 concurrent finalize requests — only one must apply the stock movement
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          request(app)
            .put(`/api/documents/${docId}/finalize`)
            .set(authHeaders())
        );
      }
      const responses = await Promise.all(promises);
      const successCount = responses.filter(r => r.status >= 200 && r.status < 300).length;
      if (successCount < 1) {
        throw new Error(`هیچ finalizeای موفق نشد: ${responses.map(r => r.status).join(',')}`);
      }

      // Verify stock deducted exactly once (read directly from DB — items API
      // exposes no /:id route; kardex truth lives in the items table anyway)
      const [finalItemRow] = await orm.select().from(items).where(eq(items.id, item.id));
      const finalStock = Number(finalItemRow?.currentStock ?? NaN);

      // Cleanup document artifacts before assertion failure escapes
      const cleanup = async () => {
        try {
          await orm.delete(transactions).where(eq(transactions.documentId, docId));
          await orm.delete(documentItems).where(eq(documentItems.documentId, docId));
          await orm.delete(documents).where(eq(documents.id, docId));
        } catch { /* best effort */ }
      };

      if (!Number.isFinite(finalStock)) {
        await cleanup();
        throw new Error('موجودی نهایی از دیتابیس خوانده نشد');
      }
      if (Math.abs(finalStock - (initialStock - qty)) > 0.0001) {
        await cleanup();
        throw new Error(`موجودی نهایی ${finalStock} بجای ${initialStock - qty} — کسر ${successCount > 1 ? 'چندباره' : 'نادرست'} رخ داد`);
      }
      await cleanup();

      return `${successCount} finalize موفق؛ موجودی دقیقا یکبار به مقدار ${qty} کسر شد (${initialStock} ← ${finalStock}).`;
    });

  // ===============================================================
  // 3. Cheque lifecycle state machine → invalid transition rejected
  // ===============================================================
  await runCase(results, 'cp_cheque_invalid_transition', 'cheque_invalid_transition',
    'یکپارچگی: گذار نامعتبر چک (بدون واریز به حساب) باید رد شود',
    async () => {
      if (!session.cookie) throw new Error('admin session in hand nist');

      const stamp = Date.now();
      const [cheque] = await orm.insert(cheques).values({
        type: 'received',
        chequeNumber: `CP-CHQ-${stamp}`,
        sayadNumber: `${stamp}`,
        bankName: 'بانک آزمایشی',
        issueDate: new Date().toISOString().split('T')[0],
        dueDate: new Date().toISOString().split('T')[0],
        amount: 500000,
        partyName: 'طرف حساب چک آزمایشی',
        status: 'received'
      }).returning();

      try {
        // received → passed WITHOUT depositing (in_collection) and WITHOUT targetBankId
        const transitionRes = await request(app)
          .put(`/api/accounting/cheques/${cheque.id}/status`)
          .set(authHeaders())
          .send({ status: 'passed' });

        if (transitionRes.status >= 200 && transitionRes.status < 300) {
          throw new Error('گذار غیرمجاز received→passed بدون حساب بانکی پذیرفته شد!');
        }
        return `گذار نامعتبر با ${transitionRes.status} رد شد.`;
      } finally {
        try {
          await orm.delete(cheques).where(eq(cheques.id, cheque.id));
        } catch { /* best effort */ }
      }
    });

  // ===============================================================
  // 4. Idempotent duplicate document creation returns cached response
  // ===============================================================
  await runCase(results, 'cp_idempotent_duplicate_document', 'idempotent_duplicate_request',
    'یکپارچگی: درخواست تکراری با همان Idempotency-Key باید پاسخ کششده برگرداند',
    async () => {
      if (!session.cookie) throw new Error('admin session in hand nist');

      const item = await createTestItem({ currentStock: 50 });
      const key = `CP-IDEM-${Date.now()}`;
      const payload = {
        docType: 'invoice',
        refNumber: `CP-IDEM-${Date.now()}`,
        date: new Date().toISOString().split('T')[0],
        status: 'draft',
        inOut: 'out',
        items: [{ itemId: item.id, quantity: 1, unit_price: 100 }]
      };

      const res1 = await request(app)
        .post('/api/documents')
        .set(authHeaders())
        .set('Idempotency-Key', key)
        .send(payload);
      if (res1.status !== 200 && res1.status !== 201) {
        throw new Error(`درخواست اول شکست خورد (${res1.status})`);
      }
      const id1 = extractId(res1.body);

      const res2 = await request(app)
        .post('/api/documents')
        .set(authHeaders())
        .set('Idempotency-Key', key)
        .send(payload);

      const hitHeader = String(res2.headers['x-idempotency-hit'] || '').toLowerCase();
      const id2 = extractId(res2.body);

      // Cleanup both potential documents
      const idsToClean = [id1, id2].filter(Boolean) as number[];
      for (const did of idsToClean) {
        try {
          await orm.delete(transactions).where(eq(transactions.documentId, did));
          await orm.delete(documentItems).where(eq(documentItems.documentId, did));
          await orm.delete(documents).where(eq(documents.id, did));
        } catch { /* best effort */ }
      }

      if (hitHeader !== 'true') {
        throw new Error(`هدر X-Idempotency-Hit صادر نشد (status=${res2.status})`);
      }
      if (!id1 || !id2 || id1 !== id2) {
        throw new Error(`پاسخ کششده همان سند را برنگرداند (${id1} vs ${id2})`);
      }
      return `درخواست تکراری با پاسخ کششده همان سند ${id1} را برگرداند (X-Idempotency-Hit=true).`;
    });

  return results;
}
