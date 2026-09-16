import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import {
  users, items, documents, transactions, journalVouchers, documentItems
} from '../../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { DocumentService } from '../../services/document.service.js';
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
        throw new Error(`خطای پرتاب‌شده از نوع ValidationError نیست: ${err?.constructor?.name}`);
      }
    }

    if (!threw) {
      throw new Error('updateDocument با status=final خطا صادر نکرد — حفره دور زدن نهایی‌سازی بازگشته است!');
    }
    if (!errMessage.includes('نهایی')) {
      throw new Error(`پیام خطای گذار به final نامعتبر است: ${errMessage}`);
    }

    // بررسی اینکه سند همچنان draft باقی مانده
    const [afterDoc] = await orm.select().from(documents).where(eq(documents.id, docId));
    if (!afterDoc || afterDoc.status !== 'draft') {
      throw new Error('وضعیت سند پس از رد گذار به final تغییر کرده است!');
    }
    // موجودی نباید کسر شده باشد (کاردکس خالی)
    const txRows = await orm.select().from(transactions).where(eq(transactions.documentId, docId));
    if (txRows.length > 0) {
      throw new Error('تراکنش انبار برای سند draft ثبت شده — نشت مسیر نهایی‌سازی!');
    }

    // پاکسازی آرمانی soft-delete
    await DocumentService.deleteDocument(docId, 'v9_regression');

    results.push(makeTestCase({
      id: 'v9_put_finalization_bypass_blocked',
      scenarioId: 'v9_finalization_bypass_blocked',
      name: 'V9: مسدودسازی دور زدن نهایی‌سازی سند از مسیر ویرایش (Finalization Bypass)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t1Start,
      details: 'گذار وضعیت draft→final از مسیر updateDocument با ValidationError رد شد؛ سند دست‌نخورده و بدون هیچ گردش انبار باقی ماند.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'v9_put_finalization_bypass_blocked',
      scenarioId: 'v9_finalization_bypass_blocked',
      name: 'V9: مسدودسازی دور زدن نهایی‌سازی سند از مسیر ویرایش (Finalization Bypass)',
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
          throw new Error(`رد ${attempt.label} با خطای غیر Validation انجام شد: ${err?.constructor?.name}`);
        }
      }
      if (!rejected) {
        throw new Error(`${attempt.label} در applyStockMovement رد نشد — خطر خرابی WAC و جهت انبار!`);
      }
      if (!msg.includes(attempt.expectContains)) {
        throw new Error(`پیام رد ${attempt.label} نامعتبر است: ${msg}`);
      }
    }

    // موجودی باید دست‌نخورده باشد
    const [itemAfter] = await orm.select({ currentStock: items.currentStock }).from(items).where(eq(items.id, item.id));
    if (Number(itemAfter?.currentStock ?? 0) !== 50) {
      throw new Error(`موجودی کالا پس از تلاش‌های ناموفق تغییر کرد: ${itemAfter?.currentStock}`);
    }

    results.push(makeTestCase({
      id: 'v9_negative_item_validation',
      scenarioId: 'v9_negative_item_validation',
      name: 'V9: اعتبارسنجی مقدار مثبت و قیمت غیرمنفی در گردش انبار (applyStockMovement Guard)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t2Start,
      details: 'هر سه حالت مخرب (تعداد منفی، تعداد صفر، قیمت منفی) با ValidationError رد شدند و موجودی کالا دست‌نخورده ماند.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'v9_negative_item_validation',
      scenarioId: 'v9_negative_item_validation',
      name: 'V9: اعتبارسنجی مقدار مثبت و قیمت غیرمنفی در گردش انبار (applyStockMovement Guard)',
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
  let reversalDocIdForCleanup = 0;
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
      buyerName: 'مشتری تست برگشت حسابداری',
      inOut: 'out',
      status: 'final',
      items: [{ itemId: item.id, quantity: 3, unit_price: 250000 }]
    });
    reversalDocIdForCleanup = docId;

    // سند حسابداری متصل باید وجود داشته باشد
    const [originalVoucher] = await orm.select()
      .from(journalVouchers)
      .where(and(
        eq(journalVouchers.referenceModule, 'invoice'),
        eq(journalVouchers.referenceId, docId),
        eq(journalVouchers.isDeleted, 0)
      ));
    if (!originalVoucher) {
      throw new Error('سند حسابداری متناظر فاکتور نهایی ایجاد نشد (نگاشت حساب‌ها)');
    }

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
      throw new Error('سند معکوس (REV-V) پس از حذف سند نهایی صادر نشد — واگرایی دفاتر از انبار!');
    }
    // مبالغ جابجا شده: بدهکار/بستانکار معکوس اصلی
    if (Math.abs(Number(reversal.totalDebit) - Number(originalVoucher.totalCredit)) > 1 ||
        Math.abs(Number(reversal.totalCredit) - Number(originalVoucher.totalDebit)) > 1) {
      throw new Error('مبالغ سند معکوس با معکوس مبالغ سند اصلی مطابقت ندارد');
    }

    // تراکنش‌های معکوس کاردکس با reversalOfId
    const kardexReversals = await orm.select()
      .from(transactions)
      .where(and(eq(transactions.documentId, docId)));
    const withReversalRef = kardexReversals.filter(t => (t as any).reversalOfId);
    if (withReversalRef.length === 0) {
      throw new Error('تراکنش معکوس کاردکس با reversal_of_id ثبت نشد (DB-009 نقض شد)');
    }

    // جفت‌سازی دقیق: برای هر تراکنش اصلی حذف‌شده، یک ردیف فعال معکوس با نوع وارونه و همان مقدار
    const originals = kardexReversals.filter(t => t.isDeleted === 1 && !((t as any).reversalOfId));
    const reversalsActive = kardexReversals.filter(t => t.isDeleted === 0 && (t as any).reversalOfId);
    if (originals.length === 0) {
      throw new Error('هیچ تراکنش اصلی حذف‌شده‌ای برای سند یافت نشد');
    }
    for (const orig of originals) {
      const pair = reversalsActive.find(r =>
        Number((r as any).reversalOfId) === Number(orig.id) &&
        r.type !== orig.type &&
        Math.abs(Number(r.quantity) - Number(orig.quantity)) < 0.0001
      );
      if (!pair) {
        throw new Error(`جفت معکوس برای تراکنش #${orig.id} (${orig.type} ${orig.quantity}) یافت نشد`);
      }
    }

    // اقلام سند soft-delete شده باشند
    const diRows = await orm.select().from(documentItems).where(eq(documentItems.documentId, docId));
    if (diRows.some(d => d.isDeleted !== 1)) {
      throw new Error('اقلام سند پس از حذف کاملاً soft-delete نشده‌اند');
    }

    results.push(makeTestCase({
      id: 'v9_document_delete_accounting_reversal',
      scenarioId: 'v9_document_delete_accounting_reversal',
      name: 'V9: صدور سند معکوس حسابداری و تراکنش‌های معکوس کاردکس هنگام حذف سند نهایی (DB-009)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t3Start,
      details: `حذف سند نهایی #${docId} سند برگشت شماره ${reversal.voucherNumber} (${reversal.referenceNumber}) با مبالغ معکوس صادر کرد؛ ${withReversalRef.length} تراکنش معکوس کاردکس با reversal_of_id ثبت شد.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'v9_document_delete_accounting_reversal',
      scenarioId: 'v9_document_delete_accounting_reversal',
      name: 'V9: صدور سند معکوس حسابداری و تراکنش‌های معکوس کاردکس هنگام حذف سند نهایی (DB-009)',
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
      throw new Error(`دو فراخوانی متوالی peek مقادیر متفاوت برگرداند: ${r1} سپس ${r2} — شمارنده می‌سوزد!`);
    }

    // اکنون getNextRef واقعاً افزایش می‌دهد
    const consumed = await DocumentService.getNextRef(type);
    if (Number(consumed) < Number(r1)) {
      throw new Error(`getNextRef شماره کوچکتر از peek برگرداند: peek=${r1}, consume=${consumed}`);
    }

    results.push(makeTestCase({
      id: 'v9_peek_next_ref_non_destructive',
      scenarioId: 'v9_peek_next_ref_non_destructive',
      name: 'V9: نگاه غیرمخرب شماره بعدی سند (Peek بدون سوختن شماره)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t4Start,
      details: `دو peek متوالی هر دو «${r1}» برگرداندند (بدون کاهش شمارنده) و getNextRef بعدی «${consumed}» را مصرف کرد.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'v9_peek_next_ref_non_destructive',
      scenarioId: 'v9_peek_next_ref_non_destructive',
      name: 'V9: نگاه غیرمخرب شماره بعدی سند (Peek بدون سوختن شماره)',
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
        throw new Error(`${c.label}: انتظار page=${c.exp.page},limit=${c.exp.limit} | دریافتی page=${got.page},limit=${got.limit}`);
      }
      const expectedOffset = (c.exp.page - 1) * c.exp.limit;
      if (got.offset !== expectedOffset) {
        throw new Error(`${c.label}: offset غلط (${got.offset} بجای ${expectedOffset})`);
      }
    }

    // حداقل نسوزد: تولید عدد صفحات سالم
    const dumpCheck = parsePagination({ limit: '1000000' }, { page: 1, limit: 50 });
    if (dumpCheck.limit > MAX_PAGE_LIMIT) {
      throw new Error('dump کل جدول هنوز ممکن است!');
    }

    results.push(makeTestCase({
      id: 'v9_pagination_nan_safe',
      scenarioId: 'v9_pagination_nan_safe',
      name: 'V9: صفحه‌بندی NaN-Safe با سقف حداکثر (parsePagination)',
      layer: 'regression',
      executionType: 'simulation_logic',
      passed: true,
      durationMs: Date.now() - t5Start,
      details: `پنج ترکیب ورودی مخرب/معتبر صحت‌سنجی شد؛ سقف MAX_PAGE_LIMIT=${MAX_PAGE_LIMIT}.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'v9_pagination_nan_safe',
      scenarioId: 'v9_pagination_nan_safe',
      name: 'V9: صفحه‌بندی NaN-Safe با سقف حداکثر (parsePagination)',
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
        // اگر هیچ‌کدام نشد هم timeout رها می‌کند
        Promise.resolve().then(() => {}).then(() => {});
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
      throw new Error(`توکن هم‌نسخه رد شد: ${resA.statusCodeCaptured} ${JSON.stringify(resA.bodyCaptured).slice(0, 200)}`);
    }
    if (reqA.user?.role !== 'accountant') {
      throw new Error('نقش کاربر از دیتابیس بازخوانی نشد (زمان تغییر نقش نباید منتظر انقضای JWT بمانیم)');
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
      throw new Error('نشست با tokenVersion کهنه مسدود نشد — نقش‌های باطل‌شده تا انقضای JWT زنده می‌مانند!');
    }

    // Case C: کاربر soft-deleted حتی با توکن معتبر باید 401 شود
    await orm.update(users).set({ isDeleted: 1 }).where(eq(users.id, testUser.id));
    const reqC: any = { path: '/api/items', originalUrl: '/api/items', method: 'GET', cookies: { [AUTH_COOKIE_NAME]: validToken }, headers: {} };
    const resC = mkRes();
    await runAuth(reqC, resC);
    if (reqC.__nextCalled || resC.statusCodeCaptured !== 401) {
      throw new Error('کاربر soft-deleted با توکن معتبر عبور کرد!');
    }

    // Cleanup
    await orm.delete(users).where(eq(users.id, testUser.id));

    results.push(makeTestCase({
      id: 'v9_auth_live_session_validation',
      scenarioId: 'v9_auth_live_session_validation',
      name: 'V9: اعتبارسنجی زنده نشست — ابطال tokenVersion و رد کاربر Soft-Deleted (V9-014)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t6Start,
      details: 'سه سناریو: توکن هم‌نسخه عبور کرد و نقش زنده از DB خوانده شد؛ توکن نسخه ۶ با 401 رد شد؛ کاربر حذف‌شده با 401 مسدود گشت.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'v9_auth_live_session_validation',
      scenarioId: 'v9_auth_live_session_validation',
      name: 'V9: اعتبارسنجی زنده نشست — ابطال tokenVersion و رد کاربر Soft-Deleted (V9-014)',
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
        buyer_name: 'شرکت آزمایشی',
        currency: 'IRR',
        items: [
          { itemId: '10', quantity: '5', unit_price: '150000', discount: '5000' }
        ]
      }
    };
    const parsedValid = await documentCreateSchema.parseAsync(validDocPayload);
    if (!parsedValid.body || parsedValid.body.items[0].itemId !== 10) {
      throw new Error('شِمای سند باید itemId رشته‌ای معتبر را به عدد تبدیل کند.');
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
      throw new Error('شِمای سند باید ایجاد سند با آرایه خالی اقلام را مسدود کند.');
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
      throw new Error('شِمای سند باید اقلام با قیمت منفی را مسدود کند.');
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
      throw new Error('شِمای ویرایش سند باید تغییر وضعیت به final را رد کند.');
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
      throw new Error('شِمای کوئری اسناد باید پارامترهای مجاز را به درستی بپذیرد.');
    }

    results.push(makeTestCase({
      id: 'v4_document_runtime_contracts_guard',
      scenarioId: 'v4_document_runtime_contracts_guard',
      name: 'قراردادهای زمان اجرای اسناد و فاکتورها با Zod (زیرفاز ۴.۲)',
      layer: 'regression',
      executionType: 'simulation_logic',
      passed: true,
      durationMs: Date.now() - t7Start,
      details: 'تمامی اعتبارسنجی‌های صلب ساختار اسناد، اقلام نامنفی، شماره عطف، فیلترهای کوئری و حفاظت از وضعیت‌های فاکتور با موفقیت تایید شدند.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'v4_document_runtime_contracts_guard',
      scenarioId: 'v4_document_runtime_contracts_guard',
      name: 'قراردادهای زمان اجرای اسناد و فاکتورها با Zod (زیرفاز ۴.۲)',
      layer: 'regression',
      executionType: 'simulation_logic',
      passed: false,
      durationMs: Date.now() - t7Start,
      error: err.message
    }));
  }

  return results;
}
