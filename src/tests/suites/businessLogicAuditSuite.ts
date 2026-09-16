import { TestCaseResult, makeTestCase } from '../types.js';
import bcrypt from 'bcryptjs';
import { orm } from '../../db/drizzle.js';
import { items, pieceworkPayrolls, personnel, itemCodeCounters, dailyWorkLogs, pieceworkLogs, pieceworkTasks, crmActivities, bankAccounts, users, accounts, journalVouchers, journalVoucherItems, documents, documentItems, transactions, activityLogs } from '../../db/schema.js';
import { and, eq, sql } from 'drizzle-orm';
import { StockReconciliationService } from '../../services/inventory/stockReconciliation.service.js';
import { ItemCatalogService } from '../../services/items/itemCatalog.service.js';
import { PayrollPaymentService } from '../../services/accounting/payrollPayment.service.js';
import { ConflictError, ValidationError, NotFoundError, InsufficientStockError } from '../../errors/customErrors.js';
import { BankAccountService } from '../../services/accounting/treasury/bankAccount.service.js';
import { VoucherSyncService } from '../../services/accounting/voucherSync.service.js';
import { DocumentService } from '../../services/document.service.js';
import { DataReconciliationService } from '../../services/reconciliation/dataReconciliation.service.js';
import { getMenuGroups } from '../../components/layout/menuConfig.js';
import { cleanupAllTestFixtures } from '../fixtures/dbTestHelper.js';
import { jalaliToIsoDate } from '../../utils.js';

/**
 * Business Logic & System Invariants Audit Suite
 * آزمون‌های ممیزی رفتارهای کلیدی و قواعد سیستم:
 *  ۱. ساختار کاردکس کالا
 *  ۲. شماره‌گذاری اتمیک کد کالا تحت همروندی
 *  ۳. محدودیت تسویه فیش حقوقی منحصراً از خزانه‌داری
 *  ۴. ماتریس دسترسی به منوها (menu_visibility)
 *  ۵. پاکسازی امن داده‌های آزمایشی
 *  ۶. اعتبارسنجی و تبدیل تاریخ‌ها به ISO
 */
export async function runBusinessLogicAuditTests(): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  // ── 1. Kardex Envelope Contract: {item, summary, entries} ────────────────
  const t1 = Date.now();
  try {
    const [anyItem] = await orm.select({ id: items.id, code: items.code }).from(items).where(eq(items.isDeleted, 0)).limit(1);
    if (!anyItem) {
      results.push(makeTestCase({
        id: 'v10_kardex_envelope_contract',
        scenarioId: 'v10_kardex_envelope_contract',
        name: 'V10 Regression: Kardex Envelope Contract {item, summary, entries}',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t1,
        details: 'No items in database — contract assertion skipped gracefully.'
      }));
    } else {
      const envelope = await StockReconciliationService.getItemRunningKardex(anyItem.id);
      const shapeOk =
        envelope && typeof envelope === 'object' &&
        typeof envelope.item === 'object' && envelope.item !== null &&
        typeof envelope.summary === 'object' && envelope.summary !== null &&
        Array.isArray(envelope.entries);
      if (!shapeOk) {
        throw new Error(`Kardex envelope contract violated: got keys ${Object.keys(envelope || {}).join(',')}`);
      }
      results.push(makeTestCase({
        id: 'v10_kardex_envelope_contract',
        scenarioId: 'v10_kardex_envelope_contract',
        name: 'V10 Regression: Kardex Envelope Contract {item, summary, entries}',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t1,
        details: `پاکت کاردکس برای کالای ${anyItem.code} با ${envelope.entries.length} ردیف مطابق قرارداد {item, summary, entries} بود.`
      }));
    }
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'v10_kardex_envelope_contract',
      scenarioId: 'v10_kardex_envelope_contract',
      name: 'V10 Regression: Kardex Envelope Contract {item, summary, entries}',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t1,
      error: err.message
    }));
  }

  // ── 2. /items/next-code concurrency uniqueness (۸ درخواست موازی) ─────────
  const t2 = Date.now();
  const counterKey = '1404|VT10|777';
  try {
    const inputs = Array.from({ length: 8 }, () =>
      ItemCatalogService.consumeNextItemCode({ type: 'product', year: '1404', prefix: 'VT10', transfer: '777' })
    );
    const resultsArr = await Promise.all(inputs);
    const codes = resultsArr.map(r => r.code);
    const unique = new Set(codes);
    const allWellFormed = codes.every(c => /^1404-VT10-777-\d{2}$/.test(c));
    if (unique.size !== 8 || !allWellFormed) {
      throw new Error(`Expected 8 unique well-formed codes, got ${unique.size} unique: ${codes.join(', ')}`);
    }
    results.push(makeTestCase({
      id: 'v10_next_code_concurrent_unique',
      scenarioId: 'v10_next_code_concurrent_unique',
      name: 'V10 Regression: Atomic next-code Uniqueness Under Concurrency (8 parallel)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t2,
      details: `۸ درخواست موازی تولید کد، ۸ کد یکتا و قالب‌درست برگرداند (سری: ${resultsArr[0].serial} تا ${resultsArr[7].serial}).`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'v10_next_code_concurrent_unique',
      scenarioId: 'v10_next_code_concurrent_unique',
      name: 'V10 Regression: Atomic next-code Uniqueness Under Concurrency (8 parallel)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t2,
      error: err.message
    }));
  } finally {
    // Cleanup synthetic counter row
    try {
      await orm.delete(itemCodeCounters).where(and(
        eq(itemCodeCounters.scope, 'product'),
        eq(itemCodeCounters.prefixKey, counterKey)
      ));
    } catch { /* non-blocking */ }
  }

  // ── 3. Payroll 'paid' فقط از مسیر خزانه (ConflictError روی فیش پرداخت‌شده) ─
  const t3 = Date.now();
  let payrollFixtureId: number | null = null;
  let tempBankAccountId: number | null = null;
  try {
    const [anyPerson] = await orm.select({ id: personnel.id }).from(personnel).where(eq(personnel.isDeleted, 0)).limit(1);
    if (!anyPerson) {
      results.push(makeTestCase({
        id: 'v10_payroll_paid_treasury_only',
        scenarioId: 'v10_payroll_paid_treasury_only',
        name: 'V10 Regression: Payroll paid-state Reachable Only Via Treasury',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t3,
        details: 'No personnel rows — assertion skipped gracefully.'
      }));
    } else {
      // V3.0.9 (TD-067): سخت‌کد bankAccountId=1 حذف شد — سرویس خزانه حساب را
      // «قبل از» بررسی وضعیت فیش می‌جست و خطای fixture، پوشش سناریو را می‌کشت.
      // اکنون یک حساب واقعی موجود متصل به کدینگ یا fixture سینتتیک استفاده می‌شود.
      let [bankAcc] = await orm.select({ id: bankAccounts.id })
        .from(bankAccounts)
        .where(and(eq(bankAccounts.isDeleted, 0), sql`${bankAccounts.accountId} IS NOT NULL`))
        .limit(1);
      if (!bankAcc) {
        const [acc] = await orm.select({ id: accounts.id }).from(accounts).where(eq(accounts.isDeleted, 0)).limit(1);
        const [createdBank] = await orm.insert(bankAccounts).values({
          code: `BA-V10T-${Date.now()}`,
          title: 'حساب تستی ممیزی V10',
          type: 'bank',
          accountId: acc ? acc.id : null,
          currentBalance: 0,
          isDeleted: 0
        }).returning({ id: bankAccounts.id });
        bankAcc = createdBank;
        tempBankAccountId = createdBank.id;
      }
      const [fixture] = await orm.insert(pieceworkPayrolls).values({
        payrollNumber: `PAY-V10T-${Date.now()}`,
        personnelId: anyPerson.id,
        startDate: '1404/01/01',
        endDate: '1404/01/30',
        title: 'V10 regression fixture',
        totalPieceworkAmount: 0,
        totalFixedAmount: 0,
        totalBonuses: 0,
        totalDeductions: 0,
        netPayable: 500000,
        status: 'paid',
        isDeleted: 0
      }).returning({ id: pieceworkPayrolls.id });
      payrollFixtureId = fixture.id;

      let conflictThrown = false;
      try {
        await PayrollPaymentService.registerPayrollPayment({
          payrollId: fixture.id,
          bankAccountId: bankAcc.id,
          method: 'bank_transfer',
          userId: null as any,
          username: 'v10-suite'
        });
      } catch (e: any) {
        if (e instanceof ConflictError) conflictThrown = true;
        else throw e;
      }
      if (!conflictThrown) {
        throw new Error('registerPayrollPayment did NOT throw ConflictError for an already-paid payroll');
      }
      results.push(makeTestCase({
        id: 'v10_payroll_paid_treasury_only',
        scenarioId: 'v10_payroll_paid_treasury_only',
        name: 'V10 Regression: Payroll paid-state Reachable Only Via Treasury',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t3,
        details: 'ثبت پرداخت دوباره برای فیش paid با ConflictError مسدود شد — قفل پرداخت خزانه‌ای فعال است.'
      }));
    }
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'v10_payroll_paid_treasury_only',
      scenarioId: 'v10_payroll_paid_treasury_only',
      name: 'V10 Regression: Payroll paid-state Reachable Only Via Treasury',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t3,
      error: err.message
    }));
  } finally {
    if (payrollFixtureId !== null) {
      try { await orm.delete(pieceworkPayrolls).where(eq(pieceworkPayrolls.id, payrollFixtureId)); } catch { /* non-blocking */ }
    }
    if (tempBankAccountId !== null) {
      try { await orm.delete(bankAccounts).where(eq(bankAccounts.id, tempBankAccountId)); } catch { /* non-blocking */ }
    }
  }

  // ── 4. menu_visibility deny-list + admin bypass (pure unit) ──────────────
  const t4 = Date.now();
  try {
    const fakeUser: any = { role: 'warehouse_keeper' };
    const fakePerms: any = { permissions: ['products.view'], isAdmin: false };

    const base = getMenuGroups(fakeUser, fakePerms, null);
    const productsBase = base.flatMap(g => g.items).find(i => i.path === '/products');
    if (!productsBase || !productsBase.visible) throw new Error('Baseline: /products should be visible without visibility map');

    const hidden = getMenuGroups(fakeUser, fakePerms, { warehouse_keeper: ['/products'] });
    const productsHidden = hidden.flatMap(g => g.items).find(i => i.path === '/products');
    if (!productsHidden || productsHidden.visible) throw new Error('Deny-list failed: /products still visible for warehouse_keeper');

    const adminUser: any = { role: 'admin' };
    const adminView = getMenuGroups(adminUser, { isAdmin: true } as any, { admin: ['/products', '/crm'] });
    const adminProducts = adminView.flatMap(g => g.items).find(i => i.path === '/products');
    if (!adminProducts || !adminProducts.visible) throw new Error('Admin bypass failed: admin must always see /products');

    results.push(makeTestCase({
      id: 'v10_menu_visibility_deny_list',
      scenarioId: 'v10_menu_visibility_deny_list',
      name: 'V10 Regression: menu_visibility Deny-List & Admin Bypass',
      layer: 'regression',
      executionType: 'simulation_logic',
      passed: true,
      durationMs: Date.now() - t4,
      details: 'deny-list نقش‌محور مخفی‌سازی کرد، بدون override رفتار permission-محور حفظ شد و مدیر ارشد همیشه bypass است.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'v10_menu_visibility_deny_list',
      scenarioId: 'v10_menu_visibility_deny_list',
      name: 'V10 Regression: menu_visibility Deny-List & Admin Bypass',
      layer: 'regression',
      executionType: 'simulation_logic',
      passed: false,
      durationMs: Date.now() - t4,
      error: err.message
    }));
  }

  // ── 5. Cleanup refusal بدون پرچم ایمنی (silent no-op) ────────────────────
  const t5 = Date.now();
  let canaryId: number | null = null;
  const savedFlag = process.env.ERP_ALLOW_TEST_CLEANUP;
  try {
    delete process.env.ERP_ALLOW_TEST_CLEANUP;

    const [canary] = await orm.insert(items).values({
      type: 'raw_material',
      name: 'V10 Cleanup Canary',
      code: `V10-CANARY-${Date.now()}`,
      unit: 'عدد',
      currentStock: 0,
      isDeleted: 0
    }).returning({ id: items.id });
    canaryId = canary.id;

    await cleanupAllTestFixtures();

    const [stillThere] = await orm.select({ id: items.id }).from(items).where(eq(items.id, canary.id));
    if (!stillThere) {
      throw new Error('Safety gate FAILED: cleanup removed data without ERP_ALLOW_TEST_CLEANUP=1');
    }
    results.push(makeTestCase({
      id: 'v10_cleanup_refusal_without_flag',
      scenarioId: 'v10_cleanup_refusal_without_flag',
      name: 'V10 Regression: Test-Cleanup Refusal Without Safety Flag (Silent No-Op)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t5,
      details: 'cleanupAllTestFixtures بدون پرچم ERP_ALLOW_TEST_CLEANUP=1 هیچ داده‌ای را حذف نکرد (canary سالم ماند).'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'v10_cleanup_refusal_without_flag',
      scenarioId: 'v10_cleanup_refusal_without_flag',
      name: 'V10 Regression: Test-Cleanup Refusal Without Safety Flag (Silent No-Op)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t5,
      error: err.message
    }));
  } finally {
    if (canaryId !== null) {
      try { await orm.delete(items).where(eq(items.id, canaryId)); } catch { /* non-blocking */ }
    }
    if (savedFlag !== undefined) process.env.ERP_ALLOW_TEST_CLEANUP = savedFlag;
  }

  // ── 6. Date-normalization idempotence: دوبار scanIntegrity پشت‌سرهم سالم ──
  const t6 = Date.now();
  try {
    const run1 = await DataReconciliationService.scanIntegrity();
    const run2 = await DataReconciliationService.scanIntegrity();
    if (run1.criticalCount !== 0 || run2.criticalCount !== 0 || !run2.healthy) {
      throw new Error(`Integrity not healthy/idempotent: run1(critical=${run1.criticalCount}), run2(healthy=${run2.healthy}, critical=${run2.criticalCount})`);
    }
    results.push(makeTestCase({
      id: 'v10_date_normalization_idempotence',
      scenarioId: 'v10_date_normalization_idempotence',
      name: 'V10 Regression: Date-Normalization Idempotence (re-run Integrity Scan healthy)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t6,
      details: `دو اجرای متوالی پویش یکپارچگی هر دو سالم بودند (${run1.totalChecks} و ${run2.totalChecks} بررسی) — نرمال‌سازی تاریخ‌ها idempotent است.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'v10_date_normalization_idempotence',
      scenarioId: 'v10_date_normalization_idempotence',
      name: 'V10 Regression: Date-Normalization Idempotence (re-run Integrity Scan healthy)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t6,
      error: err.message
    }));
  }

  // ── 7. ISO Date Standardization & Dual-Write Accuracy (TD-034) ────────────
  const t7 = Date.now();
  let createdWorkLogId: number | null = null;
  let createdPieceworkLogId: number | null = null;
  let createdActivityId: number | null = null;
  let tempTaskId: number | null = null;
  let tempPersonId: number | null = null;
  let tempUserId: number | null = null;
  try {
    // V3.0.9 (TD-067): سخت‌کد userId=1 حذف شد — FK daily_work_logs.user_id
    // در DBهایی که schema کامل دارند با id ناموجود شکست می‌خورد. اکنون یک
    // کاربر واقعی موجود (یا fixture سینتتیک) استفاده می‌شود.
    let [fixtureUser] = await orm.select({ id: users.id }).from(users).where(eq(users.isDeleted, 0)).limit(1);
    if (!fixtureUser) {
      const [createdUser] = await orm.insert(users).values({
        username: `v10_test_user_${Date.now()}`,
        password: bcrypt.hashSync('v10-fixture-pass-1234', 10),
        fullName: 'کاربر تستی V10',
        role: 'admin',
        isDeleted: 0
      }).returning({ id: users.id });
      fixtureUser = createdUser;
      tempUserId = createdUser.id;
    }

    // 7.1 Test Daily Work Logs dual-write
    const jDate1 = '1404/05/15';
    const isoExpected1 = jalaliToIsoDate(jDate1); // '2025-08-06'
    const [insertedWorkLog] = await orm.insert(dailyWorkLogs).values({
      userId: fixtureUser.id,
      username: 'v10_test_user',
      userFullName: 'کاربر تستی V10',
      date: jDate1,
      dateIso: isoExpected1,
      startTime: '08:00',
      endTime: '16:00',
      workHours: 8,
      workMode: 'onsite',
      title: 'تست استانداردسازی تاریخ روزانه',
      content: 'محتوای گزارش تستی جهت ارزیابی ستون dateIso',
      visibility: 'public',
      isDeleted: 0
    }).returning({ id: dailyWorkLogs.id });
    createdWorkLogId = insertedWorkLog.id;

    const [queriedWorkLog] = await orm.select().from(dailyWorkLogs).where(eq(dailyWorkLogs.id, createdWorkLogId));
    if (!queriedWorkLog || queriedWorkLog.dateIso !== isoExpected1) {
      throw new Error(`DailyWorkLog dateIso mismatch: expected ${isoExpected1}, got ${queriedWorkLog?.dateIso}`);
    }

    // 7.2 Test Piecework Logs dual-write
    let [person] = await orm.select({ id: personnel.id }).from(personnel).where(eq(personnel.isDeleted, 0)).limit(1);
    if (!person) {
      const [newPerson] = await orm.insert(personnel).values({
        fullName: 'پرسنل تستی تاریخ',
        isDeleted: 0
      }).returning({ id: personnel.id });
      person = newPerson;
      tempPersonId = newPerson.id;
    }

    let [task] = await orm.select({ id: pieceworkTasks.id }).from(pieceworkTasks).where(eq(pieceworkTasks.isDeleted, 0)).limit(1);
    if (!task) {
      const [newTask] = await orm.insert(pieceworkTasks).values({
        code: `TSK-T7-${Date.now()}`,
        title: 'وظیفه تستی تاریخ',
        defaultRate: 10000,
        unit: 'عدد',
        isDeleted: 0
      }).returning({ id: pieceworkTasks.id });
      task = newTask;
      tempTaskId = newTask.id;
    }

    const jDate2 = '1404/01/01';
    const isoExpected2 = jalaliToIsoDate(jDate2); // '2025-03-21'
    const [insertedPiecework] = await orm.insert(pieceworkLogs).values({
      personnelId: person.id,
      taskId: task.id,
      date: jDate2,
      dateIso: isoExpected2,
      quantity: 10,
      unitRate: 10000,
      totalAmount: 100000,
      isDeleted: 0
    }).returning({ id: pieceworkLogs.id });
    createdPieceworkLogId = insertedPiecework.id;

    const [queriedPiecework] = await orm.select().from(pieceworkLogs).where(eq(pieceworkLogs.id, createdPieceworkLogId));
    if (!queriedPiecework || queriedPiecework.dateIso !== isoExpected2) {
      throw new Error(`PieceworkLog dateIso mismatch: expected ${isoExpected2}, got ${queriedPiecework?.dateIso}`);
    }

    // 7.3 Test CRM Activities dual-write & ISO dates
    const jDateAct = '1404/06/10';
    const jDateFollow = '1404/06/20';
    const isoActExpected = jalaliToIsoDate(jDateAct);
    const isoFollowExpected = jalaliToIsoDate(jDateFollow);

    const [insertedActivity] = await orm.insert(crmActivities).values({
      type: 'call',
      title: 'تماس پیگیری تستی استاندارد تاریخ',
      loggedBy: 'v10_tester',
      activityDate: jDateAct,
      activityDateIso: isoActExpected,
      nextFollowUpDate: jDateFollow,
      nextFollowUpDateIso: isoFollowExpected,
      isFollowUpCompleted: 0,
      isDeleted: 0
    }).returning({ id: crmActivities.id });
    createdActivityId = insertedActivity.id;

    const [queriedActivity] = await orm.select().from(crmActivities).where(eq(crmActivities.id, createdActivityId));
    if (!queriedActivity || queriedActivity.activityDateIso !== isoActExpected || queriedActivity.nextFollowUpDateIso !== isoFollowExpected) {
      throw new Error(`CRMActivity dateIso mismatch: expected (${isoActExpected}, ${isoFollowExpected}), got (${queriedActivity?.activityDateIso}, ${queriedActivity?.nextFollowUpDateIso})`);
    }

    results.push(makeTestCase({
      id: 'v10_iso_date_standardization',
      scenarioId: 'v10_iso_date_standardization',
      name: 'V10 Regression: ISO Date Standardization & Dual-Write Accuracy (TD-034)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t7,
      details: 'نگارش همزمان (Dual-Write) ستون‌های date_iso و تبدیل دقیق تاریخ‌های شمسی به میلادی استاندارد در گزارش کار، کارکرد پرکیسی و فعالیت‌های CRM با موفقیت اعتبارسنجی شد.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'v10_iso_date_standardization',
      scenarioId: 'v10_iso_date_standardization',
      name: 'V10 Regression: ISO Date Standardization & Dual-Write Accuracy (TD-034)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t7,
      error: err.message
    }));
  } finally {
    if (createdWorkLogId !== null) {
      try { await orm.delete(dailyWorkLogs).where(eq(dailyWorkLogs.id, createdWorkLogId)); } catch { /* non-blocking */ }
    }
    if (createdPieceworkLogId !== null) {
      try { await orm.delete(pieceworkLogs).where(eq(pieceworkLogs.id, createdPieceworkLogId)); } catch { /* non-blocking */ }
    }
    if (createdActivityId !== null) {
      try { await orm.delete(crmActivities).where(eq(crmActivities.id, createdActivityId)); } catch { /* non-blocking */ }
    }
    if (tempTaskId !== null) {
      try { await orm.delete(pieceworkTasks).where(eq(pieceworkTasks.id, tempTaskId)); } catch { /* non-blocking */ }
    }
    if (tempPersonId !== null) {
      try { await orm.delete(personnel).where(eq(personnel.id, tempPersonId)); } catch { /* non-blocking */ }
    }
    if (tempUserId !== null) {
      try { await orm.delete(users).where(eq(users.id, tempUserId)); } catch { /* non-blocking */ }
    }
  }

  // ── 8. V4.0.5 Strict Financial Voucher Guard & Elimination of Log-and-Continue (F-3 / TD-093) ──
  const t8 = Date.now();
  let createdBankAccId: number | null = null;
  let createdVoucherId: number | null = null;
  try {
    // 8.1 Test autoCreateVoucherForPayroll in strict mode fails fast on invalid payroll ID
    let payrollErrorThrown = false;
    try {
      await VoucherSyncService.autoCreateVoucherForPayroll(999999999, undefined, undefined, undefined, { strict: true });
    } catch (err: any) {
      if (err instanceof NotFoundError || err instanceof ValidationError) {
        payrollErrorThrown = true;
      }
    }
    if (!payrollErrorThrown) {
      throw new Error('autoCreateVoucherForPayroll did not throw ValidationError/NotFoundError in strict mode for non-existent payroll');
    }

    // 8.2 Test BankAccount creation with initial balance and NO accountId fails fast (strict is enabled by default)
    let bankNoAccountErrorThrown = false;
    try {
      await BankAccountService.createBankAccount({
        code: 'TEST-ORPHAN-BANK-' + Date.now(),
        title: 'حساب بانکی تستی بدون سرفصل',
        type: 'bank',
        initialBalance: 1500000,
        accountId: null,
        strict: true
      });
    } catch (err: any) {
      if (err instanceof ValidationError) {
        bankNoAccountErrorThrown = true;
      }
    }
    if (!bankNoAccountErrorThrown) {
      throw new Error('createBankAccount with initialBalance did not throw ValidationError when accountId is missing');
    }

    // 8.3 Test BankAccount creation with valid accountId creates both bank account AND opening voucher atomically
    const [existingBankSubAccount] = await orm.select({ id: accounts.id, code: accounts.code })
      .from(accounts)
      .where(and(eq(accounts.level, 'subsidiary'), eq(accounts.isDeleted, 0)))
      .limit(1);

    if (existingBankSubAccount) {
      const bankCode = 'TB-' + Math.floor(Math.random() * 89999 + 10000);
      const bankResult = await BankAccountService.createBankAccount({
        code: bankCode,
        title: 'بانک آزمون فاز ۳.۳',
        type: 'bank',
        bankName: 'بانک ملت',
        initialBalance: 2500000,
        accountId: existingBankSubAccount.id,
        strict: true
      });
      createdBankAccId = bankResult.id;

      // Verify opening voucher was created
      const [openingVoucher] = await orm.select()
        .from(journalVouchers)
        .where(and(
          eq(journalVouchers.referenceModule, 'treasury_opening'),
          eq(journalVouchers.referenceId, bankResult.id),
          eq(journalVouchers.isDeleted, 0)
        ));

      if (!openingVoucher) {
        throw new Error('Opening journal voucher was not created for bank account with initial balance');
      }
      createdVoucherId = openingVoucher.id;

      // Verify balanced double-entry voucher items
      const voucherItems = await orm.select()
        .from(journalVoucherItems)
        .where(eq(journalVoucherItems.voucherId, openingVoucher.id));

      const totalDebit = voucherItems.reduce((s, it) => s + (Number(it.debit) || 0), 0);
      const totalCredit = voucherItems.reduce((s, it) => s + (Number(it.credit) || 0), 0);

      if (Math.abs(totalDebit - 2500000) > 0.01 || Math.abs(totalCredit - 2500000) > 0.01 || Math.abs(totalDebit - totalCredit) > 0.01) {
        throw new Error(`Opening voucher is not balanced: debit=${totalDebit}, credit=${totalCredit}`);
      }
    }

    results.push(makeTestCase({
      id: 'v4_strict_financial_voucher_guard',
      scenarioId: 'v4_strict_financial_voucher_guard',
      name: 'V4.0.5 Regression: Strict Financial Voucher Guard & Elimination of Log-and-Continue (F-3 / TD-093)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t8,
      details: 'تضمین شکست سریع و پرتاب استثنای صلب (ValidationError/NotFoundError) در صورت نقص کدینگ یا خطای سند، و تضمین ثبت اتمیک سند افتتاحیه برای حساب‌های خزانه‌داری با موجودی اولیه اعتبارسنجی شد.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'v4_strict_financial_voucher_guard',
      scenarioId: 'v4_strict_financial_voucher_guard',
      name: 'V4.0.5 Regression: Strict Financial Voucher Guard & Elimination of Log-and-Continue (F-3 / TD-093)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t8,
      error: err.message
    }));
  } finally {
    if (createdVoucherId !== null) {
      try {
        await orm.delete(journalVoucherItems).where(eq(journalVoucherItems.voucherId, createdVoucherId));
        await orm.delete(journalVouchers).where(eq(journalVouchers.id, createdVoucherId));
      } catch { /* non-blocking */ }
    }
    if (createdBankAccId !== null) {
      try {
        await orm.delete(bankAccounts).where(eq(bankAccounts.id, createdBankAccId));
      } catch { /* non-blocking */ }
    }
  }

  // ── 9. Atomic Document Finalization Orchestration (Phase 3.4 / DB-008) ───
  const t9 = Date.now();
  let orchItemId: number | null = null;
  let orchDocEmptyId: number | null = null;
  let orchDocOverId: number | null = null;
  let orchDocValidId: number | null = null;
  let orchVoucherId: number | null = null;

  try {
    // Setup test item with stock = 5
    const [insertedItem] = await orm.insert(items).values({
      code: 'ORCH-ITM-' + Date.now(),
      type: 'product',
      name: 'کالای آزمون ارکستراسیون ۳.۴',
      category: 'گردنبند',
      unit: 'عدد',
      currentStock: 5,
      stocks: { default: 5 },
      weightedAverageCost: 100000,
      isDeleted: 0,
    }).returning({ id: items.id });
    orchItemId = insertedItem.id;

    // 9.1 Test Empty Document Finalization Guard (Must throw ValidationError & remain draft)
    const emptyDocId = await DocumentService.createDocument({
      docType: 'invoice',
      status: 'draft',
      items: [],
      user: 'تست ارکستراسیون',
      skipVoucherSync: true,
    });
    orchDocEmptyId = emptyDocId;

    let emptyFinalizeErrorThrown = false;
    try {
      await DocumentService.finalizeDocument(emptyDocId, 'تست ارکستراسیون');
    } catch (err: any) {
      if (err instanceof ValidationError) {
        emptyFinalizeErrorThrown = true;
      }
    }
    if (!emptyFinalizeErrorThrown) {
      throw new Error('finalizeDocument on document with 0 items did not throw ValidationError');
    }

    const [emptyDocAfter] = await orm.select({ status: documents.status }).from(documents).where(eq(documents.id, emptyDocId));
    if (emptyDocAfter?.status !== 'draft') {
      throw new Error(`Empty document status changed to ${emptyDocAfter?.status} instead of staying draft`);
    }

    // 9.2 Test Insufficient Stock Finalization Guard (Must throw InsufficientStockError & rollback completely)
    const overDocId = await DocumentService.createDocument({
      docType: 'invoice',
      status: 'draft',
      items: [{
        itemId: orchItemId,
        quantity: 20, // available is 5
        unitPrice: 150000,
        location: 'default',
      }],
      user: 'تست ارکستراسیون',
      skipVoucherSync: true,
    });
    orchDocOverId = overDocId;

    let overStockErrorThrown = false;
    try {
      await DocumentService.finalizeDocument(overDocId, 'تست ارکستراسیون');
    } catch (err: any) {
      if (err instanceof InsufficientStockError) {
        overStockErrorThrown = true;
      }
    }
    if (!overStockErrorThrown) {
      throw new Error('finalizeDocument exceeding available stock did not throw InsufficientStockError');
    }

    // Assert status remained draft
    const [overDocAfter] = await orm.select({ status: documents.status }).from(documents).where(eq(documents.id, overDocId));
    if (overDocAfter?.status !== 'draft') {
      throw new Error(`Over-stock document status changed to ${overDocAfter?.status} instead of staying draft`);
    }

    // Assert stock remained untouched at 5
    const [itemAfterOver] = await orm.select({ currentStock: items.currentStock }).from(items).where(eq(items.id, orchItemId));
    if (Number(itemAfterOver?.currentStock) !== 5) {
      throw new Error(`Item stock was mutated during failed finalization: stock=${itemAfterOver?.currentStock}, expected=5`);
    }

    // 9.3 Test Successful 3-Step Atomic Orchestration (Document -> Stock -> Voucher)
    const validDocId = await DocumentService.createDocument({
      docType: 'invoice',
      status: 'draft',
      items: [{
        itemId: orchItemId,
        quantity: 2,
        unitPrice: 150000,
        location: 'default',
      }],
      user: 'تست ارکستراسیون',
      skipVoucherSync: true,
    });
    orchDocValidId = validDocId;

    await DocumentService.finalizeDocument(validDocId, 'تست ارکستراسیون', undefined, { strict: true });

    // Verify Step 1: Document status is now 'final'
    const [validDocFinal] = await orm.select({ status: documents.status, type: documents.type }).from(documents).where(eq(documents.id, validDocId));
    if (validDocFinal?.status !== 'final') {
      throw new Error(`Valid document was not finalized: status=${validDocFinal?.status}`);
    }

    // Verify Step 2: Inventory deducted atomically (5 - 2 = 3)
    const [itemFinalStock] = await orm.select({ currentStock: items.currentStock, stocks: items.stocks }).from(items).where(eq(items.id, orchItemId));
    if (Number(itemFinalStock?.currentStock) !== 3) {
      throw new Error(`Inventory deduction failed: stock=${itemFinalStock?.currentStock}, expected=3`);
    }
    const locStocks = (itemFinalStock?.stocks as Record<string, number>) || {};
    if (Number(locStocks.default) !== 3) {
      throw new Error(`Location stock breakdown mismatch: default=${locStocks.default}, expected=3`);
    }

    // Verify Step 3: Journal voucher exists and is balanced (DB-008)
    const [invoiceVoucher] = await orm.select()
      .from(journalVouchers)
      .where(and(
        eq(journalVouchers.referenceModule, 'invoice'),
        eq(journalVouchers.referenceId, validDocId),
        eq(journalVouchers.isDeleted, 0)
      ));

    if (!invoiceVoucher) {
      throw new Error(`Accounting journal voucher was not created for finalized invoice #${validDocId}`);
    }
    orchVoucherId = invoiceVoucher.id;

    const vItems = await orm.select().from(journalVoucherItems).where(eq(journalVoucherItems.voucherId, invoiceVoucher.id));
    const totalD = vItems.reduce((s, it) => s + (Number(it.debit) || 0), 0);
    const totalC = vItems.reduce((s, it) => s + (Number(it.credit) || 0), 0);
    if (Math.abs(totalD - totalC) > 0.01 || totalD <= 0) {
      throw new Error(`Accounting voucher for finalized document is unbalanced: debit=${totalD}, credit=${totalC}`);
    }

    // 9.4 Test Composable External Transaction (externalTx)
    let outerTxRollbackVerified = false;
    const extDocId = await DocumentService.createDocument({
      docType: 'invoice',
      status: 'draft',
      items: [{
        itemId: orchItemId,
        quantity: 1,
        unitPrice: 150000,
        location: 'default',
      }],
      user: 'تست ارکستراسیون',
      skipVoucherSync: true,
    });

    try {
      await orm.transaction(async (outerTx) => {
        await DocumentService.finalizeDocument(extDocId, 'تست خارجی', outerTx, { strict: true });
        // Deliberately fail the outer transaction to test atomicity across the caller boundary
        throw new Error('SIMULATED_OUTER_TRANSACTION_FAILURE');
      });
    } catch (err: any) {
      if (err.message === 'SIMULATED_OUTER_TRANSACTION_FAILURE') {
        outerTxRollbackVerified = true;
      }
    }
    if (!outerTxRollbackVerified) {
      throw new Error('Outer transaction did not throw expected failure');
    }

    // Assert document remained draft and stock was not deducted after outer rollback
    const [extDocAfterRollback] = await orm.select({ status: documents.status }).from(documents).where(eq(documents.id, extDocId));
    if (extDocAfterRollback?.status !== 'draft') {
      throw new Error(`Document status rolled forward despite outer transaction failure: status=${extDocAfterRollback?.status}`);
    }
    const [itemAfterExtRollback] = await orm.select({ currentStock: items.currentStock }).from(items).where(eq(items.id, orchItemId));
    if (Number(itemAfterExtRollback?.currentStock) !== 3) {
      throw new Error(`Stock was permanently deducted during aborted outer transaction: stock=${itemAfterExtRollback?.currentStock}, expected=3`);
    }

    // Clean up extDocId
    try {
      await orm.delete(documentItems).where(eq(documentItems.documentId, extDocId));
      await orm.delete(documents).where(eq(documents.id, extDocId));
    } catch { /* safe */ }

    results.push(makeTestCase({
      id: 'v4_atomic_document_orchestration',
      scenarioId: 'v4_atomic_document_orchestration',
      name: 'V4.0.6 Regression: Atomic 3-Step Document Finalization Orchestration (Phase 3.4 / DB-008)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t9,
      details: 'ارکستراسیون صلب ۳ مرحله‌ای نهایی‌سازی اسناد (ثبت سند، تحرک کاردکس انبار با حفظ WAC، صدور سند دوبل خودکار با رعایت قاعده DB-008 و rollback کامل در صورت خطا) با موفقیت اعتبارسنجی شد.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'v4_atomic_document_orchestration',
      scenarioId: 'v4_atomic_document_orchestration',
      name: 'V4.0.6 Regression: Atomic 3-Step Document Finalization Orchestration (Phase 3.4 / DB-008)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t9,
      error: err.message
    }));
  } finally {
    if (orchVoucherId !== null) {
      try {
        await orm.delete(journalVoucherItems).where(eq(journalVoucherItems.voucherId, orchVoucherId));
        await orm.delete(journalVouchers).where(eq(journalVouchers.id, orchVoucherId));
      } catch { /* safe */ }
    }
    for (const docId of [orchDocEmptyId, orchDocOverId, orchDocValidId]) {
      if (docId !== null) {
        try {
          await orm.delete(transactions).where(eq(transactions.documentId, docId));
          await orm.delete(documentItems).where(eq(documentItems.documentId, docId));
          await orm.delete(documents).where(eq(documents.id, docId));
        } catch { /* safe */ }
      }
    }
    if (orchItemId !== null) {
      try {
        await orm.delete(items).where(eq(items.id, orchItemId));
      } catch { /* safe */ }
    }
  }

  // ── 10. Audit Log Retention Policy & Insertion Integrity Guard (Sub-phase 1.5 / D-2) ───
  const t10 = Date.now();
  const testAuditLogIds: number[] = [];

  try {
    const { logActivity, purgeOldAuditLogs, checkAuditLogIntegrity, MIN_AUDIT_RETENTION_DAYS } = await import('../../lib/auditLogger.js');
    const { ValidationError } = await import('../../errors/customErrors.js');

    // 1. Test Strict Insertion
    const strictResult = await logActivity({
      action: 'CREATE',
      entity: 'آزمون ممیزی',
      entityId: 'test_strict_1',
      description: 'ثبت آزمایشی ممیزی با strict=true',
      details: { token: 'secret_jwt_token', password: '123', safeField: 'ok' },
      strict: true,
      username: 'test_runner'
    });

    if (!strictResult.success || !strictResult.id) {
      throw new Error(`logActivity with strict=true failed to return success or id: ${JSON.stringify(strictResult)}`);
    }
    testAuditLogIds.push(strictResult.id);

    // Verify sanitization of sensitive data
    const [insertedLog] = await orm.select().from(activityLogs).where(eq(activityLogs.id, strictResult.id));
    if (!insertedLog) {
      throw new Error('Inserted audit log was not found in database');
    }
    const detailsObj = insertedLog.details as any;
    if (detailsObj?.token !== '[PROTECTED]' || detailsObj?.password !== '[PROTECTED]' || detailsObj?.safeField !== 'ok') {
      throw new Error(`Sensitive fields were not properly sanitized: ${JSON.stringify(detailsObj)}`);
    }

    // 2. Test Minimum Retention Policy Guard (Must reject retentionDays < 90 without allowForceRecent)
    let threwValidationError = false;
    try {
      await purgeOldAuditLogs({ retentionDays: 30, allowForceRecent: false });
    } catch (err: any) {
      if (err instanceof ValidationError || err.name === 'ValidationError' || err.statusCode === 422) {
        threwValidationError = true;
      }
    }
    if (!threwValidationError) {
      throw new Error('purgeOldAuditLogs failed to enforce minimum retention policy (did not throw ValidationError for retentionDays < 90)');
    }

    // 3. Test Selective Preservation of Critical Audit Records
    // Seed three historical audit logs older than 100 days
    const pastTimestamp = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();

    // A: Routine non-critical log (should be purged)
    const [routineLog] = await orm.insert(activityLogs).values({
      action: 'VIEW',
      entity: 'گزارش آزمایشی',
      entityId: 'test_view_1',
      description: 'مشاهده گزارش عادی تاریخی',
      timestamp: pastTimestamp,
      username: 'synthetic_audit_test'
    }).returning({ id: activityLogs.id });
    if (routineLog) testAuditLogIds.push(routineLog.id);

    // B: Critical action log: DELETE (should be preserved)
    const [criticalActionLog] = await orm.insert(activityLogs).values({
      action: 'DELETE',
      entity: 'کالای تست',
      entityId: 'test_crit_del_1',
      description: 'حذف داده بحرانی تاریخی',
      timestamp: pastTimestamp,
      username: 'synthetic_audit_test'
    }).returning({ id: activityLogs.id });
    if (criticalActionLog) testAuditLogIds.push(criticalActionLog.id);

    // C: Critical entity log: 'تنظیمات سیستم' (should be preserved)
    const [criticalEntityLog] = await orm.insert(activityLogs).values({
      action: 'UPDATE',
      entity: 'تنظیمات سیستم',
      entityId: 'test_crit_setting_1',
      description: 'تغییر تنظیمات بحرانی تاریخی',
      timestamp: pastTimestamp,
      username: 'synthetic_audit_test'
    }).returning({ id: activityLogs.id });
    if (criticalEntityLog) testAuditLogIds.push(criticalEntityLog.id);

    // Execute purge with retentionDays=90 and preserveCritical=true
    const purgeReport = await purgeOldAuditLogs({
      retentionDays: 90,
      preserveCritical: true,
      actorUsername: 'تست_ممیزی'
    });

    if (!purgeReport.success) {
      throw new Error('purgeOldAuditLogs returned unsuccessful result');
    }

    // Check that routine log was purged
    const [checkRoutine] = await orm.select().from(activityLogs).where(eq(activityLogs.id, routineLog.id));
    if (checkRoutine) {
      throw new Error('Routine audit log older than 90 days was NOT purged as expected');
    }

    // Check that critical logs WERE PRESERVED
    const [checkCritAction] = await orm.select().from(activityLogs).where(eq(activityLogs.id, criticalActionLog.id));
    if (!checkCritAction) {
      throw new Error('Critical audit log with action DELETE was erroneously purged despite preserveCritical=true');
    }

    const [checkCritEntity] = await orm.select().from(activityLogs).where(eq(activityLogs.id, criticalEntityLog.id));
    if (!checkCritEntity) {
      throw new Error('Critical audit log with entity "تنظیمات سیستم" was erroneously purged despite preserveCritical=true');
    }

    // 4. Test Audit Log Integrity Check
    const integrity = await checkAuditLogIntegrity();
    if (!integrity.healthy || integrity.totalLogs < 1 || integrity.minRetentionDays !== MIN_AUDIT_RETENTION_DAYS) {
      throw new Error(`Audit log integrity check returned invalid report: ${JSON.stringify(integrity)}`);
    }

    results.push(makeTestCase({
      id: 'v4_audit_log_retention_and_integrity_guard',
      scenarioId: 'v4_audit_log_retention_and_integrity_guard',
      name: 'V4.0.8 Regression: Audit Log Retention Policy & Insertion Integrity Guard (Sub-phase 1.5 / D-2)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t10,
      details: 'سیاست نگه‌داشت ممیزی ۹۰ روزه (D-2)، حفاظت خودکار از لاگ‌های بحرانی (DELETE و تنظیمات)، پاکسازی هدفمند لاگ‌های عادی، ثبت اتمیک با strict=true و چک یکپارچگی سیستمی با موفقیت اعتبارسنجی شد.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'v4_audit_log_retention_and_integrity_guard',
      scenarioId: 'v4_audit_log_retention_and_integrity_guard',
      name: 'V4.0.8 Regression: Audit Log Retention Policy & Insertion Integrity Guard (Sub-phase 1.5 / D-2)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t10,
      error: err.message
    }));
  } finally {
    if (testAuditLogIds.length > 0) {
      try {
        const { inArray } = await import('drizzle-orm');
        await orm.delete(activityLogs).where(inArray(activityLogs.id, testAuditLogIds));
      } catch { /* safe cleanup */ }
    }
  }

  return results;
}
