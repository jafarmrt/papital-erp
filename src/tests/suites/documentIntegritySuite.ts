import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import {
  users, items, documents, transactions, journalVouchers, documentItems
} from '../../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { DocumentService } from '../../services/document.service.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { ValidationError } from '../../errors/customErrors.js';
import { parsePagination, MAX_PAGE_LIMIT } from '../../lib/pagination.js';
import { generateToken, authenticateToken, AUTH_COOKIE_NAME } from '../../middleware/auth.js';
import { createTestItem } from '../fixtures/factories.js';

// کمک‌تابع بی‌اثر برای پرچم‌های استفاده‌نشده در helper ناهمگام تست
const doneNoop = undefined;

/**
 * Document Integrity & Financial Reversal Suite
 * آزمون‌های یکپارچگی اسناد و برگشت‌های مالی:
 *  ۱. مسدودسازی دور زدن نهایی‌سازی سند با PUT (SEC-DOC-001)
 *  ۲. اعتبارسنجی اقلام منفی/صفر در گردش انبار (INV-VAL-002)
 *  ۳. برگشت سند حسابداری هنگام حذف سند نهایی + تراکنش‌های معکوس DB-009
 *  ۴. نگاه غیرمخرب next-ref (عدم سوختن شماره سند)
 *  ۵. صفحه‌بندی NaN-safe با سقف مجاز
 *  ۶. اعتبارسنجی زنده نشست: tokenVersion و soft-delete کاربر
 */
export async function runDocumentIntegrityTests(): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  // ------------------------------------------------------------------
  // Test 1: PUT /documents/:id must NOT be able to set status='final'
  // ------------------------------------------------------------------
  const t1Start = Date.now();
  try {
    // پیش‌نویس آزمایشی با یک قلم
    const item = await createTestItem({ name: 'کالای bypass V9', code: `V9_BYPASS_${Date.now()}` });
    const docId = await DocumentService.createDocument({
      docType: 'invoice',
      refNumber: `V9-BYPASS-${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      user: 'v9_regression',
      status: 'draft',
      items: [{ itemId: item.id, quantity: 1, unit_price: 1000 }]
    });

    let threw = false;
    let errMessage = '';
    try {
      await DocumentService.updateDocument(docId, { status: 'final' });
    } catch (err: any) {
      threw = true;
      errMessage = String(err?.message || '');
      if (!(err instanceof ValidationError)) {
        throw new Error(`thrown error is not a ValidationError: ${err?.constructor?.name}`);
      }
    }

    if (!threw) {
      throw new Error('updateDocument with status=final threw no error — the finalization bypass hole is back!');
    }
    if (!errMessage.includes('نهایی')) {
      throw new Error(`error message of the transition to final is invalid: ${errMessage}`);
    }

    // بررسی اینکه سند همچنان draft باقی مانده
    const [afterDoc] = await orm.select().from(documents).where(eq(documents.id, docId));
    if (!afterDoc || afterDoc.status !== 'draft') {
      throw new Error('document status changed after the transition to final was refused!');
    }
    // موجودی نباید کسر شده باشد (کاردکس خالی)
    const txRows = await orm.select().from(transactions).where(eq(transactions.documentId, docId));
    if (txRows.length > 0) {
      throw new Error('stock transaction recorded for a draft document — finalization path leak!');
    }

    // پاکسازی آرمانی soft-delete
    await DocumentService.deleteDocument(docId, 'v9_regression');

    results.push(makeTestCase({
      id: 'v9_put_finalization_bypass_blocked',
      scenarioId: 'v9_finalization_bypass_blocked',
      name: 'V9: blocks bypassing document finalization through the edit path (Finalization Bypass)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t1Start,
      details: 'draft→final transition through updateDocument was refused with ValidationError; the document stayed untouched with no stock movement.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'v9_put_finalization_bypass_blocked',
      scenarioId: 'v9_finalization_bypass_blocked',
      name: 'V9: blocks bypassing document finalization through the edit path (Finalization Bypass)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t1Start,
      error: err.message
    }));
  }

  // ------------------------------------------------------------------
  // Test 2: applyStockMovement must reject non-positive qty / negative price
  // ------------------------------------------------------------------
  const t2Start = Date.now();
  try {
    const item = await createTestItem({ name: 'کالای منفی V9', code: `V9_NEG_${Date.now()}`, currentStock: 50, stocks: { main: 50 } });

    const attempts: Array<{ params: any; expectContains: string; label: string }> = [
      {
        label: 'تعداد منفی',
        expectContains: 'بزرگ‌تر از صفر',
        params: { itemId: item.id, documentId: 0, inOut: 'out', quantity: -5, price: 1000, date: new Date().toISOString(), documentType: 'invoice', documentRef: 'V9NEG', user: 'v9_regression', targetLoc: 'main' }
      },
      {
        label: 'تعداد صفر',
        expectContains: 'بزرگ‌تر از صفر',
        params: { itemId: item.id, documentId: 0, inOut: 'in', quantity: 0, price: 1000, date: new Date().toISOString(), documentType: 'invoice', documentRef: 'V9NEG', user: 'v9_regression', targetLoc: 'main' }
      },
      {
        label: 'قیمت منفی',
        expectContains: 'نمی‌تواند منفی',
        params: { itemId: item.id, documentId: 0, inOut: 'in', quantity: 2, price: -5000, date: new Date().toISOString(), documentType: 'receipt', documentRef: 'V9NEG', user: 'v9_regression', targetLoc: 'main' }
      }
    ];

    for (const attempt of attempts) {
      let rejected = false;
      let msg = '';
      try {
        await orm.transaction(async (tx) => {
          await DocumentService.applyStockMovement(tx as any, attempt.params);
        });
      } catch (err: any) {
        rejected = true;
        msg = String(err?.message || '');
        if (!(err instanceof ValidationError)) {
          throw new Error(`refusal of ${attempt.label} happened with a non-Validation error: ${err?.constructor?.name}`);
        }
      }
      if (!rejected) {
        throw new Error(`${attempt.label} was not refused in applyStockMovement — risk of corrupting WAC and stock direction!`);
      }
      if (!msg.includes(attempt.expectContains)) {
        throw new Error(`refusal message of ${attempt.label} is invalid: ${msg}`);
      }
    }

    // موجودی باید دست‌نخورده باشد
    const [itemAfter] = await orm.select({ currentStock: items.currentStock }).from(items).where(eq(items.id, item.id));
    if (Number(itemAfter?.currentStock ?? 0) !== 50) {
      throw new Error(`item stock changed after the failed attempts: ${itemAfter?.currentStock}`);
    }

    results.push(makeTestCase({
      id: 'v9_negative_item_validation',
      scenarioId: 'v9_negative_item_validation',
      name: 'V9: positive quantity and non-negative price check on stock movements (applyStockMovement Guard)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t2Start,
      details: 'all three harmful cases (negative quantity, zero quantity, negative price) were refused with ValidationError and the item stock stayed untouched.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'v9_negative_item_validation',
      scenarioId: 'v9_negative_item_validation',
      name: 'V9: positive quantity and non-negative price check on stock movements (applyStockMovement Guard)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t2Start,
      error: err.message
    }));
  }

  // ------------------------------------------------------------------
  // Test 3: Deleting a FINAL document reverses its accounting voucher
  // ------------------------------------------------------------------
  const t3Start = Date.now();
  try {
    const item = await createTestItem({
      name: 'کالای برگشت حسابداری V9',
      code: `V9_REV_${Date.now()}`,
      currentStock: 30,
      stocks: { main: 30 }
    });

    const docId = await DocumentService.createDocument({
      docType: 'invoice',
      refNumber: `V9-REVAL-${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      user: 'v9_regression',
      buyerName: 'ERP-TEST-MARKER مشتری تست برگشت حسابداری',
      inOut: 'out',
      status: 'final',
      items: [{ itemId: item.id, quantity: 3, unit_price: 250000 }]
    });

    // سند حسابداری متصل باید وجود داشته باشد
    const [originalVoucher] = await orm.select()
      .from(journalVouchers)
      .where(and(
        eq(journalVouchers.referenceModule, 'invoice'),
        eq(journalVouchers.referenceId, docId),
        eq(journalVouchers.isDeleted, 0)
      ));
    if (!originalVoucher) {
      throw new Error('journal voucher of the final invoice was not created (account mapping)');
    }

    // v8.0.2 (TD-251): فقط سند تأییدشده هنگام ابطال سند معکوس می‌گیرد؛ سند پیش‌نویس حذف نرم می‌شود
    // (آزمون inv_td_251_void_deletes_draft_voucher)، پس این آزمون سند را پیش از حذف تأیید می‌کند
    await VoucherService.approveJournalVouchers([originalVoucher.id], undefined, 'v9_regression');

    // حذف سند انبار
    await DocumentService.deleteDocument(docId, 'v9_regression');

    // باید سند برگشت REV-V صادر شده باشد
    const reversalVouchers = await orm.select()
      .from(journalVouchers)
      .where(and(
        eq(journalVouchers.referenceModule, 'invoice'),
        eq(journalVouchers.referenceId, originalVoucher.id),
        eq(journalVouchers.isDeleted, 0)
      ))
      .orderBy(desc(journalVouchers.id));

    const reversal = reversalVouchers.find(v => String(v.referenceNumber || '').startsWith(`REV-V${originalVoucher.voucherNumber}`));
    if (!reversal) {
      throw new Error('reversal voucher (REV-V) was not issued after deleting the final document — ledgers diverge from the warehouse!');
    }
    // مبالغ جابجا شده: بدهکار/بستانکار معکوس اصلی
    if (Math.abs(Number(reversal.totalDebit) - Number(originalVoucher.totalCredit)) > 1 ||
        Math.abs(Number(reversal.totalCredit) - Number(originalVoucher.totalDebit)) > 1) {
      throw new Error('reversal voucher amounts do not match the reversed amounts of the original voucher');
    }

    // تراکنش‌های معکوس کاردکس با reversalOfId
    const kardexReversals = await orm.select()
      .from(transactions)
      .where(and(eq(transactions.documentId, docId)));
    const withReversalRef = kardexReversals.filter(t => (t as any).reversalOfId);
    if (withReversalRef.length === 0) {
      throw new Error('Kardex reversal transaction with reversal_of_id was not recorded (DB-009 violated)');
    }

    // جفت‌سازی دقیق: برای هر تراکنش اصلی حذف‌شده، یک ردیف فعال معکوس با نوع وارونه و همان مقدار
    const originals = kardexReversals.filter(t => t.isDeleted === 1 && !((t as any).reversalOfId));
    const reversalsActive = kardexReversals.filter(t => t.isDeleted === 0 && (t as any).reversalOfId);
    if (originals.length === 0) {
      throw new Error('no deleted original transaction found for the document');
    }
    for (const orig of originals) {
      const pair = reversalsActive.find(r =>
        Number((r as any).reversalOfId) === Number(orig.id) &&
        r.type !== orig.type &&
        Math.abs(Number(r.quantity) - Number(orig.quantity)) < 0.0001
      );
      if (!pair) {
        throw new Error(`reversal pair for transaction #${orig.id} (${orig.type} ${orig.quantity}) not found`);
      }
    }

    // اقلام سند soft-delete شده باشند
    const diRows = await orm.select().from(documentItems).where(eq(documentItems.documentId, docId));
    if (diRows.some(d => d.isDeleted !== 1)) {
      throw new Error('document lines were not fully soft-deleted after delete');
    }

    results.push(makeTestCase({
      id: 'v9_document_delete_accounting_reversal',
      scenarioId: 'v9_document_delete_accounting_reversal',
      name: 'V9: deleting a final document issues a reversal journal voucher and Kardex reversal transactions (DB-009)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t3Start,
      details: `deleting final document #${docId} issued reversal voucher number ${reversal.voucherNumber} (${reversal.referenceNumber}) with reversed amounts; ${withReversalRef.length} Kardex reversal transactions recorded with reversal_of_id.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'v9_document_delete_accounting_reversal',
      scenarioId: 'v9_document_delete_accounting_reversal',
      name: 'V9: deleting a final document issues a reversal journal voucher and Kardex reversal transactions (DB-009)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t3Start,
      error: err.message
    }));
  }

  // ------------------------------------------------------------------
  // Test 4: peekNextRef is read-only (no counter burn)
  // ------------------------------------------------------------------
  const t4Start = Date.now();
  try {
    const type = 'proforma';
    const r1 = await DocumentService.peekNextRef(type);
    const r2 = await DocumentService.peekNextRef(type);
    if (r1 !== r2) {
      throw new Error(`two consecutive peek calls returned different values: ${r1} then ${r2} — the counter burns numbers!`);
    }

    // اکنون getNextRef واقعاً افزایش می‌دهد
    const consumed = await DocumentService.getNextRef(type);
    if (Number(consumed) < Number(r1)) {
      throw new Error(`getNextRef returned a number lower than peek: peek=${r1}, consume=${consumed}`);
    }

    results.push(makeTestCase({
      id: 'v9_peek_next_ref_non_destructive',
      scenarioId: 'v9_peek_next_ref_non_destructive',
      name: 'V9: non-destructive peek of the next document number (peek without burning a number)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t4Start,
      details: `two consecutive peeks both returned "${r1}" (counter not advanced) and the next getNextRef consumed "${consumed}".`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'v9_peek_next_ref_non_destructive',
      scenarioId: 'v9_peek_next_ref_non_destructive',
      name: 'V9: non-destructive peek of the next document number (peek without burning a number)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t4Start,
      error: err.message
    }));
  }

  // ------------------------------------------------------------------
  // Test 5: parsePagination NaN-safe & capped (Unit)
  // ------------------------------------------------------------------
  const t5Start = Date.now();
  try {
    const checks: Array<{ q: Record<string, unknown>; exp: { page: number; limit: number }; label: string }> = [
      { q: {}, exp: { page: 1, limit: 50 }, label: 'پیش‌فرض بدون پارامتر' },
      { q: { page: 'abc', limit: 'xyz' }, exp: { page: 1, limit: 50 }, label: 'NaN-safe (مقادیر غیرعددی)' },
      { q: { limit: '99999999' }, exp: { page: 1, limit: MAX_PAGE_LIMIT }, label: 'سقف limit عظیم' },
      { q: { page: '2', limit: '10' }, exp: { page: 2, limit: 10 }, label: 'مقادیر معتبر' },
      { q: { page: '-5', limit: '-3' }, exp: { page: 1, limit: 50 }, label: 'مقادیر منفی' }
    ];

    for (const c of checks) {
      const got = parsePagination(c.q, { page: 1, limit: 50 });
      if (got.page !== c.exp.page || got.limit !== c.exp.limit) {
        throw new Error(`${c.label}: expected page=${c.exp.page},limit=${c.exp.limit} | got page=${got.page},limit=${got.limit}`);
      }
      const expectedOffset = (c.exp.page - 1) * c.exp.limit;
      if (got.offset !== expectedOffset) {
        throw new Error(`${c.label}: wrong offset (${got.offset} instead of ${expectedOffset})`);
      }
    }

    // حداقل نسوزد: تولید عدد صفحات سالم
    const dumpCheck = parsePagination({ limit: '1000000' }, { page: 1, limit: 50 });
    if (dumpCheck.limit > MAX_PAGE_LIMIT) {
      throw new Error('dumping the whole table is still possible!');
    }

    results.push(makeTestCase({
      id: 'v9_pagination_nan_safe',
      scenarioId: 'v9_pagination_nan_safe',
      name: 'V9: NaN-safe pagination with a maximum cap (parsePagination)',
      layer: 'regression',
      executionType: 'simulation_logic',
      passed: true,
      durationMs: Date.now() - t5Start,
      details: `five harmful/valid input combinations verified; cap MAX_PAGE_LIMIT=${MAX_PAGE_LIMIT}.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'v9_pagination_nan_safe',
      scenarioId: 'v9_pagination_nan_safe',
      name: 'V9: NaN-safe pagination with a maximum cap (parsePagination)',
      layer: 'regression',
      executionType: 'simulation_logic',
      passed: false,
      durationMs: Date.now() - t5Start,
      error: err.message
    }));
  }

  // ------------------------------------------------------------------
  // Test 6: authenticateToken live validation (tokenVersion + soft delete)
  // ------------------------------------------------------------------
  const t6Start = Date.now();
  try {
    const suffix = Date.now();
    const username = `v9_session_${suffix}`;

    const [testUser] = await orm.insert(users).values({
      username,
      password: '$2a$10$placeholderplaceholderplaceholderplacehold',
      fullName: 'کاربر آزمون نشست V9',
      role: 'accountant',
      tokenVersion: 7,
      isDeleted: 0
    }).returning();

    const mkRes = () => {
      const res: any = {};
      res.statusCodeCaptured = 0;
      res.bodyCaptured = null;
      res.settled = false;
      res.status = (code: number) => {
        res.statusCodeCaptured = code;
        return { json: (b: any) => { res.bodyCaptured = b; res.settled = true; } };
      };
      return res;
    };

    // jwt.verify کال‌بک ناهمگام دارد (await دیتابیس داخلش) — باید تا settle شدن صبر کنیم
    const runAuth = async (req: any, res: any): Promise<void> => {
      await new Promise<void>((resolve) => {
        let resolved = false;
        const finish = () => { if (!resolved) { resolved = true; resolve(); } };
        const safety = setTimeout(finish, 5000);
        authenticateToken(req, res, () => { (req as any).__nextCalled = true; clearTimeout(safety); finish(); });
        // در مسیر خطا، settled داخل json ست می‌شود
        const poll = setInterval(() => {
          if (res.settled || (req as any).__nextCalled) { clearInterval(poll); }
        }, 25);
        setTimeout(() => clearInterval(poll), 5100);
        // poll دیگری برای next
        const poll2 = setInterval(() => {
          if ((req as any).__nextCalled) { clearInterval(poll2); finish(); }
        }, 25);
        setTimeout(() => clearInterval(poll2), 5100);
        void doneNoop;
      });
    };
    void doneNoop;

    // Case A: توکن هم‌نسخه (tokenVersion=7) باید عبور کند و نقش از DB بازخوانی شود
    const validToken = generateToken({
      id: testUser.id, username, role: 'warehouse_keeper', // نقش قدیمی/غلط عمدی
      csrfToken: 'x'.repeat(64), tokenVersion: 7
    } as any);
    const reqA: any = { path: '/api/items', originalUrl: '/api/items', method: 'GET', cookies: { [AUTH_COOKIE_NAME]: validToken }, headers: {} };
    const resA = mkRes();
    await runAuth(reqA, resA);
    if (!reqA.__nextCalled) {
      throw new Error(`same-version token was refused: ${resA.statusCodeCaptured} ${JSON.stringify(resA.bodyCaptured).slice(0, 200)}`);
    }
    if (reqA.user?.role !== 'accountant') {
      throw new Error('user role was not reloaded from the database (a role change must not wait for JWT expiry)');
    }

    // Case B: توکن با tokenVersion قدیمی باید 401 شود (ابطال نشست)
    const staleToken = generateToken({
      id: testUser.id, username, role: 'accountant',
      csrfToken: 'x'.repeat(64), tokenVersion: 6
    } as any);
    const reqB: any = { path: '/api/items', originalUrl: '/api/items', method: 'GET', cookies: { [AUTH_COOKIE_NAME]: staleToken }, headers: {} };
    const resB = mkRes();
    await runAuth(reqB, resB);
    if (reqB.__nextCalled || resB.statusCodeCaptured !== 401) {
      throw new Error('session with a stale tokenVersion was not blocked — revoked roles stay alive until JWT expiry!');
    }

    // Case C: کاربر soft-deleted حتی با توکن معتبر باید 401 شود
    await orm.update(users).set({ isDeleted: 1 }).where(eq(users.id, testUser.id));
    const reqC: any = { path: '/api/items', originalUrl: '/api/items', method: 'GET', cookies: { [AUTH_COOKIE_NAME]: validToken }, headers: {} };
    const resC = mkRes();
    await runAuth(reqC, resC);
    if (reqC.__nextCalled || resC.statusCodeCaptured !== 401) {
      throw new Error('soft-deleted user passed with a valid token!');
    }

    // Cleanup
    await orm.delete(users).where(eq(users.id, testUser.id));

    results.push(makeTestCase({
      id: 'v9_auth_live_session_validation',
      scenarioId: 'v9_auth_live_session_validation',
      name: 'V9: live session validation — tokenVersion revocation and refusal of a soft-deleted user (V9-014)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t6Start,
      details: 'three scenarios: a same-version token passed and the live role was read from the DB; a version 6 token was refused with 401; a deleted user was blocked with 401.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'v9_auth_live_session_validation',
      scenarioId: 'v9_auth_live_session_validation',
      name: 'V9: live session validation — tokenVersion revocation and refusal of a soft-deleted user (V9-014)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t6Start,
      error: err.message
    }));
  }

  // ------------------------------------------------------------------
  // Test 7: Runtime Contracts & Zod Validation for Documents (Sub-phase 4.2)
  // ------------------------------------------------------------------
  const t7Start = Date.now();
  try {
    const { documentCreateSchema, documentUpdateSchema, documentsQuerySchema } = await import('../../routes/documents.routes.js');

    // Case 1: تایید سند معتبر با ساختار استاندارد
    const validDocPayload = {
      body: {
        docType: 'invoice',
        refNumber: 'INV-TEST-402',
        date: '1405/06/25',
        buyer_name: 'ERP-TEST-MARKER شرکت آزمایشی',
        currency: 'IRR',
        items: [
          { itemId: '10', quantity: '5', unit_price: '150000', discount: '5000' }
        ]
      }
    };
    const parsedValid = await documentCreateSchema.parseAsync(validDocPayload);
    if (!parsedValid.body || parsedValid.body.items[0].itemId !== 10) {
      throw new Error('document schema must convert a valid string itemId to a number.');
    }

    // Case 2: رد سند بدون اقلام (آرایه خالی)
    let emptyItemsThrew = false;
    try {
      await documentCreateSchema.parseAsync({
        body: {
          docType: 'invoice',
          refNumber: 'INV-TEST-EMPTY',
          date: '1405/06/25',
          items: []
        }
      });
    } catch {
      emptyItemsThrew = true;
    }
    if (!emptyItemsThrew) {
      throw new Error('document schema must block creating a document with an empty items array.');
    }

    // Case 3: رد سند با قیمت منفی یا تخفیف منفی
    let negativePriceThrew = false;
    try {
      await documentCreateSchema.parseAsync({
        body: {
          docType: 'invoice',
          refNumber: 'INV-TEST-NEG',
          date: '1405/06/25',
          items: [{ itemId: 1, quantity: 2, unit_price: -5000 }]
        }
      });
    } catch {
      negativePriceThrew = true;
    }
    if (!negativePriceThrew) {
      throw new Error('document schema must block items with a negative price.');
    }

    // Case 4: رد تلاش برای تغییر وضعیت به 'final' در ویرایش عادی (Bypass Guard)
    let updateFinalThrew = false;
    try {
      await documentUpdateSchema.parseAsync({
        body: {
          status: 'final'
        },
        params: { id: '12' }
      });
    } catch {
      updateFinalThrew = true;
    }
    if (!updateFinalThrew) {
      throw new Error('document edit schema must refuse a status change to final.');
    }

    // Case 5: اعتبارسنجی فیلترهای کوئری لیست اسناد
    const validQuery = await documentsQuerySchema.parseAsync({
      query: {
        type: 'invoice',
        status: 'draft',
        page: '2',
        limit: '25'
      }
    });
    if (!validQuery.query || validQuery.query.type !== 'invoice') {
      throw new Error('documents query schema must accept the allowed parameters correctly.');
    }

    results.push(makeTestCase({
      id: 'v4_document_runtime_contracts_guard',
      scenarioId: 'v4_document_runtime_contracts_guard',
      name: 'runtime contracts of documents and invoices with Zod (subphase 4.2)',
      layer: 'regression',
      executionType: 'simulation_logic',
      passed: true,
      durationMs: Date.now() - t7Start,
      details: 'all strict checks of document structure, non-negative lines, reference number, query filters and invoice status protection verified.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'v4_document_runtime_contracts_guard',
      scenarioId: 'v4_document_runtime_contracts_guard',
      name: 'runtime contracts of documents and invoices with Zod (subphase 4.2)',
      layer: 'regression',
      executionType: 'simulation_logic',
      passed: false,
      durationMs: Date.now() - t7Start,
      error: err.message
    }));
  }

  return results;
}
