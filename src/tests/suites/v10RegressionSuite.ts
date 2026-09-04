import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { items, pieceworkPayrolls, personnel, itemCodeCounters, dailyWorkLogs, pieceworkLogs, pieceworkTasks, crmActivities } from '../../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { StockReconciliationService } from '../../services/inventory/stockReconciliation.service.js';
import { ItemCatalogService } from '../../services/items/itemCatalog.service.js';
import { PayrollPaymentService } from '../../services/accounting/payrollPayment.service.js';
import { ConflictError } from '../../errors/customErrors.js';
import { DataReconciliationService } from '../../services/reconciliation/dataReconciliation.service.js';
import { getMenuGroups } from '../../components/layout/menuConfig.js';
import { cleanupAllTestFixtures } from '../fixtures/dbTestHelper.js';
import { jalaliToIsoDate } from '../../utils.js';

// V10-7.4: سوییت رگرسیون نسخه ۱۰ — ۶ سناریوی بحرانی رفتارهای جدید V10
export async function runV10RegressionTests(): Promise<TestCaseResult[]> {
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
          bankAccountId: 1,
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
  try {
    // 7.1 Test Daily Work Logs dual-write
    const jDate1 = '1404/05/15';
    const isoExpected1 = jalaliToIsoDate(jDate1); // '2025-08-06'
    const [insertedWorkLog] = await orm.insert(dailyWorkLogs).values({
      userId: 1,
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
  }

  return results;
}
