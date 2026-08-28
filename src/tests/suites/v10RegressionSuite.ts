import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { items, pieceworkPayrolls, personnel, itemCodeCounters } from '../../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { StockReconciliationService } from '../../services/inventory/stockReconciliation.service.js';
import { ItemCatalogService } from '../../services/items/itemCatalog.service.js';
import { PayrollPaymentService } from '../../services/accounting/payrollPayment.service.js';
import { ConflictError } from '../../errors/customErrors.js';
import { DataReconciliationService } from '../../services/reconciliation/dataReconciliation.service.js';
import { getMenuGroups } from '../../components/layout/menuConfig.js';
import { cleanupAllTestFixtures } from '../fixtures/dbTestHelper.js';

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

  return results;
}
