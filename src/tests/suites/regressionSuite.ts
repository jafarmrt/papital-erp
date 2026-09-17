import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { eq } from 'drizzle-orm';
import { categories } from '../../db/schema.js';
import { cleanTestTableData } from '../fixtures/dbTestHelper.js';
import {
  createVoucherSchema,
  createChequeSchema,
  transferSchema,
  createTreasuryTxSchema
} from '../../routes/accounting.routes.js';

export async function runRegressionTests(): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  // Test 1: 22 Standard Categories & Default Units Auto-Fill
  const t1Start = Date.now();
  try {
    const allCategories = await orm.select().from(categories);
    const categoryCount = allCategories.length;
    const earringsCategory = allCategories.find(c => c.name.includes('گوشواره میخی') || c.name.includes('گوشواره آویز'));
    const defaultUnit = earringsCategory ? (earringsCategory.defaultUnit || (earringsCategory as any).default_unit) : null;

    if (categoryCount >= 22 && defaultUnit === 'جفت') {
      results.push(makeTestCase({
        id: 'reg_categories_default_units',
        scenarioId: 'regression_sanity',
        name: 'ارزیابی ۲۲ دسته‌بندی استاندارد سیستم و واحد سنجش خودکار (Regression Sanity)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t1Start,
        details: `تعداد ${categoryCount} دسته‌بندی اصلی در دیتابیس موجود بوده و تنظیم خودکار واحد سنجش (جفت برای گوشواره) تأیید گردید.`
      }));
    } else {
      // V3.0.6 (FC-2): شاخه «شکست» قبلاً نیز passed:true ثبت می‌کرد و تست عملاً
      // هرگز fail نمی‌شد (False Confidence). اکنون انحراف از baseline واقعاً گزارش می‌شود.
      results.push(makeTestCase({
        id: 'reg_categories_default_units',
        scenarioId: 'regression_sanity',
        name: 'ارزیابی ۲۲ دسته‌بندی استاندارد سیستم و واحد سنجش خودکار (Regression Sanity)',
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - t1Start,
        error: `Baseline دسته‌بندی‌ها مغایر است — تعداد دسته‌بندی‌ها: ${categoryCount} (انتظار: >= 22)، واحد پیش‌فرض گوشواره: ${defaultUnit || 'null'} (انتظار: جفت)`
      }));
    }
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_categories_default_units',
      scenarioId: 'regression_sanity',
      name: 'ارزیابی ۲۲ دسته‌بندی استاندارد سیستم و واحد سنجش خودکار (Regression Sanity)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t1Start,
      error: err.message
    }));
  }

  // ------------------------------------------------------------------
  // Test 2: Runtime Contracts & Zod Validation for Inventory & Transfers (Sub-phase 4.3)
  // ------------------------------------------------------------------
  const t2Start = Date.now();
  try {
    const {
      transferStockSchema,
      negativeStockPolicySchema,
      projectAllocateSchema,
      allocationsQuerySchema
    } = await import('../../routes/inventory.routes.js');

    // Case 1: تایید انتقال معتبر بین دو انبار مجزا
    const validTransfer = await transferStockSchema.parseAsync({
      body: {
        itemId: '15',
        fromLocation: 'main',
        toLocation: 'workshop',
        quantity: '10',
        date: '1405/06/25'
      }
    });
    if (!validTransfer.body || validTransfer.body.itemId !== 15 || validTransfer.body.quantity !== 10) {
      throw new Error('شِمای انتقال باید شناسه‌ها و مقادیر رشته‌ای را به عدد تبدیل کند.');
    }

    // Case 2: رد انتقال با انبار مبداء و مقصد یکسان (Self-Transfer Block)
    let sameWarehouseThrew = false;
    try {
      await transferStockSchema.parseAsync({
        body: {
          itemId: 15,
          fromLocation: 'main',
          toLocation: 'main',
          quantity: 5
        }
      });
    } catch {
      sameWarehouseThrew = true;
    }
    if (!sameWarehouseThrew) {
      throw new Error('شِمای انتقال باید انتقال با انبار مبداء و مقصد یکسان را رد کند.');
    }

    // Case 3: رد انتقال با مقدار صفر یا منفی
    let negativeQtyThrew = false;
    try {
      await transferStockSchema.parseAsync({
        body: {
          itemId: 15,
          fromLocation: 'main',
          toLocation: 'workshop',
          quantity: -2
        }
      });
    } catch {
      negativeQtyThrew = true;
    }
    if (!negativeQtyThrew) {
      throw new Error('شِمای انتقال باید مقادیر منفی یا صفر را رد کند.');
    }

    // Case 4: اعتبارسنجی سیاست موجودی منفی (فقط forbidden, warning, allowed)
    const validPolicy = await negativeStockPolicySchema.parseAsync({
      body: { policy: 'forbidden' }
    });
    if (validPolicy.body.policy !== 'forbidden') {
      throw new Error('شِمای سیاست موجودی منفی باید مقدار معتبر را بپذیرد.');
    }

    let invalidPolicyThrew = false;
    try {
      await negativeStockPolicySchema.parseAsync({
        body: { policy: 'unlimited_dangerous' }
      });
    } catch {
      invalidPolicyThrew = true;
    }
    if (!invalidPolicyThrew) {
      throw new Error('شِمای سیاست موجودی منفی باید مقادیر ناشناخته را رد کند.');
    }

    // Case 5: اعتبارسنجی تخصیص به پروژه و ممانعت از آرایه خالی اقلام
    let emptyAllocationsThrew = false;
    try {
      await projectAllocateSchema.parseAsync({
        body: {
          projectId: 4,
          allocations: []
        }
      });
    } catch {
      emptyAllocationsThrew = true;
    }
    if (!emptyAllocationsThrew) {
      throw new Error('شِمای تخصیص پروژه باید ارسال آرایه خالی اقلام را رد کند.');
    }

    // Case 6: اعتبارسنجی فیلترهای کوئری تخصیص‌ها
    const validAllocQuery = await allocationsQuerySchema.parseAsync({
      query: {
        projectId: '4',
        status: 'allocated'
      }
    });
    if (!validAllocQuery.query || validAllocQuery.query.projectId !== 4) {
      throw new Error('شِمای فیلترهای تخصیص باید مقادیر مجاز را بپذیرد.');
    }

    results.push(makeTestCase({
      id: 'v4_inventory_runtime_contracts_guard',
      scenarioId: 'v4_inventory_runtime_contracts_guard',
      name: 'قراردادهای زمان اجرای انبارداری، انتقالات و تخصیص BOM با Zod (زیرفاز ۴.۳)',
      layer: 'regression',
      executionType: 'simulation_logic',
      passed: true,
      durationMs: Date.now() - t2Start,
      details: 'اعتبارسنجی صلب انتقال بین‌انباری، ممانعت از مبدأ/مقصد یکسان، مقادیر نامنفی، سیاست موجودی منفی و تخصیص پروژه با موفقیت تایید شدند.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'v4_inventory_runtime_contracts_guard',
      scenarioId: 'v4_inventory_runtime_contracts_guard',
      name: 'قراردادهای زمان اجرای انبارداری، انتقالات و تخصیص BOM با Zod (زیرفاز ۴.۳)',
      layer: 'regression',
      executionType: 'simulation_logic',
      passed: false,
      durationMs: Date.now() - t2Start,
      error: err.message
    }));
  }

  // Test 4: Accounting & Treasury Runtime Contracts (Zod) - Phase 4.4
  const t4Start = Date.now();
  try {
    // Case 1: سند حسابداری تراز شده باید معتبر باشد
    const validVoucher = await createVoucherSchema.parseAsync({
      body: {
        date: '1403/06/26',
        description: 'ثبت سند پرداخت هزینه و کسر از بانک',
        voucherType: 'general',
        items: [
          { accountId: 10, debit: 500000, credit: 0, description: 'هزینه عمومی' },
          { accountId: 20, debit: 0, credit: 500000, description: 'بانک ملت' }
        ]
      }
    });
    if (validVoucher.body.items.length !== 2) {
      throw new Error('شِمای سند حسابداری باید سند معتبر و تراز شده را بپذیرد.');
    }

    // Case 2: سند حسابداری ناتراز باید توسط Zod رد شود
    let unbalanceThrew = false;
    try {
      await createVoucherSchema.parseAsync({
        body: {
          date: '1403/06/26',
          description: 'سند ناتراز تستی',
          items: [
            { accountId: 10, debit: 500000, credit: 0 },
            { accountId: 20, debit: 0, credit: 400000 }
          ]
        }
      });
    } catch {
      unbalanceThrew = true;
    }
    if (!unbalanceThrew) {
      throw new Error('شِمای سند دوبل باید اسناد ناتراز بدهکار/بستانکار را رد کند.');
    }

    // Case 3: چک صیادی با شناسه ۱۶ رقمی معتبر و ممانعت از شناسه نامعتبر
    const validCheque = await createChequeSchema.parseAsync({
      body: {
        type: 'received',
        chequeNumber: 'CHQ-9901',
        sayadNumber: '1234567890123456',
        bankName: 'بانک ملی',
        issueDate: '1403/06/26',
        dueDate: '1403/08/26',
        amount: 15000000,
        partyName: 'مشتری الف'
      }
    });
    if (validCheque.body.sayadNumber !== '1234567890123456') {
      throw new Error('شِمای چک صیادی باید شناسه ۱۶ رقمی معتبر را بپذیرد.');
    }

    let invalidSayadThrew = false;
    try {
      await createChequeSchema.parseAsync({
        body: {
          type: 'received',
          chequeNumber: 'CHQ-9902',
          sayadNumber: '12345', // کمتر از ۱۶ رقم
          bankName: 'بانک ملی',
          issueDate: '1403/06/26',
          dueDate: '1403/08/26',
          amount: 15000000,
          partyName: 'مشتری الف'
        }
      });
    } catch {
      invalidSayadThrew = true;
    }
    if (!invalidSayadThrew) {
      throw new Error('شِمای چک صیادی باید شناسه صیادی با فرمت نامعتبر را رد کند.');
    }

    // Case 4: انتقال وجه بین‌بانکی با ممانعت از حساب مبدا و مقصد یکسان
    let sameBankTransferThrew = false;
    try {
      await transferSchema.parseAsync({
        body: {
          date: '1403/06/26',
          amount: 1000000,
          fromBankAccountId: 5,
          toBankAccountId: 5 // حساب یکسان
        }
      });
    } catch {
      sameBankTransferThrew = true;
    }
    if (!sameBankTransferThrew) {
      throw new Error('شِمای انتقال وجه خزانه باید حساب مبدا و مقصد یکسان را رد کند.');
    }

    // Case 5: تراکنش دریافت/پرداخت با مبلغ منفی باید رد شود
    let negativeTreasuryTxThrew = false;
    try {
      await createTreasuryTxSchema.parseAsync({
        body: {
          type: 'receipt',
          date: '1403/06/26',
          method: 'cash',
          amount: -5000,
          bankAccountId: 1,
          partyName: 'تست'
        }
      });
    } catch {
      negativeTreasuryTxThrew = true;
    }
    if (!negativeTreasuryTxThrew) {
      throw new Error('شِمای تراکنش خزانه باید مبلغ منفی را رد کند.');
    }

    results.push(makeTestCase({
      id: 'v4_accounting_treasury_runtime_contracts_guard',
      scenarioId: 'v4_accounting_treasury_runtime_contracts_guard',
      name: 'قراردادهای زمان اجرای حسابداری و خزانه‌داری با Zod (زیرفاز ۴.۴)',
      layer: 'regression',
      executionType: 'simulation_logic',
      passed: true,
      durationMs: Date.now() - t4Start,
      details: 'اعتبارسنجی تراز بودن سند حسابداری دوبل (Debit == Credit)، شناسه صیادی ۱۶ رقمی چک‌ها، ممانعت از حساب‌های مبدا/مقصد یکسان در انتقال وجه و مبالغ مثبت خزانه با موفقیت تایید شدند.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'v4_accounting_treasury_runtime_contracts_guard',
      scenarioId: 'v4_accounting_treasury_runtime_contracts_guard',
      name: 'قراردادهای زمان اجرای حسابداری و خزانه‌داری با Zod (زیرفاز ۴.۴)',
      layer: 'regression',
      executionType: 'simulation_logic',
      passed: false,
      durationMs: Date.now() - t4Start,
      error: err.message
    }));
  }

  // ------------------------------------------------------------------
  // Test 5 (TD-081 / TD-104): سرویس یگانه آزادسازی رزروهای پروژه با OCC + Audit
  // ------------------------------------------------------------------
  const t5Start = Date.now();
  const td081Suffix = `${Date.now()}`;
  try {
    const { ItemStockReservationService } = await import('../../services/items/itemStockReservation.service.js');
    const { productionProjects } = await import('../../db/schema.js');
    const { createTestItem } = await import('../fixtures/factories.js');

    // ۱. فیکسچر مارک‌دار (TD-107): کالا و پروژه با مارکر مرکزی
    const item = await createTestItem({
      name: `ERP-TEST-MARKER کالای آزادسازی TD-081 ${td081Suffix}`,
      code: `ITEM_TD081_${td081Suffix}`
    });
    const projectCode = `PROJ_TD081_${td081Suffix}`;
    const [project] = await orm.insert(productionProjects).values({
      projectCode,
      title: `ERP-TEST-MARKER پروژه آزادسازی TD-081 ${td081Suffix}`,
      status: 'in_progress',
      version: 1,
      inventoryControl: {
        isReserved: true,
        reservedItems: [
          { itemId: item.id, itemCode: item.code, itemName: item.name, reservedQty: 10, unit: 'عدد' }
        ]
      }
    }).returning();

    // ۲. آزادسازی رسمی — کسر ۴ عدد از ۱۰ رزرو
    const releaseResult = await ItemStockReservationService.releaseProjectReservations(orm, {
      projectId: project.id,
      docItems: [{ itemId: item.id, quantity: 4 }],
      expectedVersion: project.version,
      userId: undefined,
      username: 'test_runner'
    });

    if (!releaseResult.changed || releaseResult.releasedItemIds.length !== 1) {
      throw new Error('نتیجه آزادسازی باید changed=true با یک قلم آزادشده باشد.');
    }

    // ۳. راستی‌آزمایی jsonb: رزرو از ۱۰ به ۶ کاهش یافته و version بامپ شده است
    const [afterProj] = await orm.select().from(productionProjects).where(eq(productionProjects.id, project.id));
    const invControl: any = (afterProj.inventoryControl as any) || {};
    const reservedListAfter = Array.isArray(invControl.reservedItems) ? invControl.reservedItems : [];
    const remainingQty = reservedListAfter.length > 0 ? Number(reservedListAfter[0].reservedQty || 0) : 0;
    if (remainingQty !== 6) {
      throw new Error(`رزرو باقی‌مانده باید ۱۰-۴=۶ باشد؛ مقدار واقعی: ${remainingQty}`);
    }
    if (Number(afterProj.version) !== 2) {
      throw new Error(`نسخه پروژه پس از آزادسازی باید ۲ باشد؛ واقعی: ${afterProj.version}`);
    }

    // ۴. OCC: فراخوانی با نسخه کهنه باید OptimisticLockError بدهد
    let occThrew = false;
    try {
      await ItemStockReservationService.releaseProjectReservations(orm, {
        projectId: project.id,
        docItems: [{ itemId: item.id, quantity: 1 }],
        expectedVersion: 1 // نسخه قدیمی — هم‌اکنون ۲ است
      });
    } catch (err: any) {
      occThrew = err?.name === 'OptimisticLockError' || err?.name === 'ConflictError' || /version/i.test(String(err?.message || ''));
    }
    if (!occThrew) {
      throw new Error('آزادسازی با نسخه OCC کهنه باید رد شود.');
    }

    results.push(makeTestCase({
      id: 'td081_project_reservation_release_service_guard',
      scenarioId: 'v4_project_reservation_release_guard',
      name: 'V4.0.31 Regression: سرویس یگانه آزادسازی رزروهای پروژه با OCC و Audit (TD-081)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t5Start,
      details: `کسر رزرو (۱۰→۶ واحد باقی‌مانده = ${remainingQty})، بامپ نسخه OCC و رد فراخوانی با نسخه کهنه تأیید شد.`
    }));

    // پاکسازی فیکسچر مارک‌دار
    await cleanTestTableData('production_projects', 'id', [project.id]);
    await cleanTestTableData('items', 'id', [item.id]);
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'td081_project_reservation_release_service_guard',
      scenarioId: 'v4_project_reservation_release_guard',
      name: 'V4.0.31 Regression: سرویس یگانه آزادسازی رزروهای پروژه با OCC و Audit (TD-081)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t5Start,
      error: err.message
    }));
  }

  // ------------------------------------------------------------------
  // Test 6 (TD-105): تاریخ سرور-authoritative خزانه — پیش‌فرض، نرمال‌سازی و بازه
  // ------------------------------------------------------------------
  const t6Start = Date.now();
  try {
    const { resolveTreasuryBusinessDate } = await import('../../services/accounting/treasury/treasuryTransaction.service.js');
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');

    const today = await businessTodayIsoDate();

    // 1) مقدار خالی → پیش‌فرض businessTodayIsoDate
    const defaulted = await resolveTreasuryBusinessDate('');
    if (defaulted !== today) {
      throw new Error(`پیش‌فرض تاریخ خالی باید «${today}» باشد؛ واقعی: «${defaulted}»`);
    }

    // 2) نرمال‌سازی ورودی جلالی به ISO
    const [gy, gm, gd] = today.split('-').map(Number);
    const normalized = await resolveTreasuryBusinessDate('1405/01/15');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      throw new Error(`نرمال‌سازی جلالی به ISO انجام نشد: «${normalized}»`);
    }

    // 3) تاریخ آینده باید رد شود (بازه مجاز: گذشته تا امروز کسب‌وکار)
    const future = `${gy + 2}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
    let futureThrew = false;
    try {
      await resolveTreasuryBusinessDate(future);
    } catch {
      futureThrew = true;
    }
    if (!futureThrew) {
      throw new Error(`تاریخ آینده «${future}» باید رد شود.`);
    }

    // 4) فرمت نامعتبر باید رد شود
    let invalidFormatThrew = false;
    try {
      await resolveTreasuryBusinessDate('not-a-date');
    } catch {
      invalidFormatThrew = true;
    }
    if (!invalidFormatThrew) {
      throw new Error('فرمت نامعتبر تاریخ باید رد شود.');
    }

    results.push(makeTestCase({
      id: 'td105_treasury_server_authoritative_date',
      scenarioId: 'v4_treasury_server_authoritative_date_guard',
      name: 'V4.0.31 Regression: تاریخ سرور-authoritative خزانه و اعتبارسنجی بازه (TD-105)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t6Start,
      details: 'پیش‌فرض businessTodayIsoDate، نرمال‌سازی جلالی→ISO، رد تاریخ آینده و رد فرمت نامعتبر تأیید شد.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'td105_treasury_server_authoritative_date',
      scenarioId: 'v4_treasury_server_authoritative_date_guard',
      name: 'V4.0.31 Regression: تاریخ سرور-authoritative خزانه و اعتبارسنجی بازه (TD-105)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t6Start,
      error: err.message
    }));
  }

  // ------------------------------------------------------------------
  // Test 7 (TD-107): مارکر محوری پاکسازی تستی — فیکسچرهای factory مارک‌دار
  // ------------------------------------------------------------------
  const t7Start = Date.now();
  try {
    const { TEST_MARKER } = await import('../fixtures/testMarker.js');
    const { createTestItem } = await import('../fixtures/factories.js');

    const item = await createTestItem({ code: `ITEM_MARKER_${Date.now()}` });
    if (!String(item.name || '').includes(TEST_MARKER)) {
      throw new Error(`نام فیکسچر factory باید مارکر «${TEST_MARKER}» را داشته باشد؛ واقعی: «${item.name}»`);
    }

    await cleanTestTableData('items', 'id', [item.id]);

    results.push(makeTestCase({
      id: 'td107_test_cleanup_marker_only',
      scenarioId: 'v4_test_cleanup_marker_only_guard',
      name: 'V4.0.31 Regression: مارکر محوری پاکسازی تستی — فیکسچرها مارک‌دار (TD-107)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t7Start,
      details: `فیکسچر factory با مارکر مرکزی «${TEST_MARKER}» علامت‌گذاری می‌شود و پاکسازی فقط رکوردهای حامل مارکر/شناسه ساختاریافته را هدف می‌گیرد.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'td107_test_cleanup_marker_only',
      scenarioId: 'v4_test_cleanup_marker_only_guard',
      name: 'V4.0.31 Regression: مارکر محوری پاکسازی تستی — فیکسچرها مارک‌دار (TD-107)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t7Start,
      error: err.message
    }));
  }

  return results;
}


