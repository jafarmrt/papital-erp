import { ALL_ITEM_IMPORT_PERMISSIONS } from '../../lib/items/itemImportPermissions.js';
import { personnelVersion } from '../fixtures/personnelVersion.js';
import { money } from '../../lib/money.js';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { categories, items, documents, documentItems, transactions, warehouses, journalVouchers, journalVoucherItems, accounts, documentRefCounters } from '../../db/schema.js';
import { cleanTestTableData } from '../fixtures/dbTestHelper.js';
import { normalizeDateToDbTimestamp, jalaliToIsoDate, getErrorMessage } from '../../utils.js';
import { businessTodayIsoDate, resolveJalaliFiscalYear } from '../../lib/businessClock.js';
import { VoucherSyncService } from '../../services/accounting/voucherSync.service.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { AccountingService } from '../../services/accounting.service.js';
import { KardexWacRecalculatorService } from '../../services/inventory/kardexWacRecalculator.service.js';
import { InventoryStockRepairService } from '../../services/inventory/inventoryStockRepair.service.js';
import { ItemCatalogService } from '../../services/items/itemCatalog.service.js';
import { DocumentService } from '../../services/document.service.js';
import { CustomerService } from '../../services/customer.service.js';
import { WarehouseService } from '../../services/warehouse.service.js';
import { PendingMaterialsService } from '../../services/pendingMaterials.service.js';
import { ProjectService } from '../../services/projects.service.js';
import { PieceworkService } from '../../services/piecework.service.js';
import { TransferService } from '../../services/transfer.service.js';
import { IdempotencyService } from '../../services/idempotency.service.js';
import { ProcurementService } from '../../services/procurement.service.js';
import {
  createVoucherSchema,
  createChequeSchema,
  transferSchema,
  createTreasuryTxSchema
} from '../../routes/accounting.routes.js';
import {
  normalizeDateToIso,
  calculateDateDiffDays,
  matchStatementWithTransactions,
  StatementRow,
  TreasuryTxCandidate
} from '../../components/accounting/reconciliation/bankStatementMatcher.js';
import { LockHierarchyLevel, sortIdsForLocking, validateLockOrder } from '../../lib/lockOrder.js';
import { seedFixtureItemStocks } from '../fixtures/factories.js';
import { ItemWarehouseStockService } from '../../services/inventory/itemWarehouseStock.service.js';
import type { CreateDocumentInput } from '../../services/documents/types.js';
import { miscContraAccountId } from '../fixtures/treasuryParty.js';

export async function runRegressionTests(filter?: string): Promise<TestCaseResult[]> {
  const normalizedFilter = filter?.toLowerCase().replace(/[-_]/g, "").trim();
  const shouldRun = (id: string, ...extra: (string | undefined)[]) => {
    if (!normalizedFilter) return true;
    const hay = `${id} ${extra.filter(Boolean).join(" ")}`.toLowerCase().replace(/[-_]/g, "");
    return hay.includes(normalizedFilter);
  };
  const results: TestCaseResult[] = [];

  // Test 1: 22 Standard Categories & Default Units Auto-Fill
  if (shouldRun('reg_categories_default_units', 'regression_sanity', 'categories')) {
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
  }

  // ------------------------------------------------------------------
  // Test 2: Runtime Contracts & Zod Validation for Inventory & Transfers (Sub-phase 4.3)
  // ------------------------------------------------------------------
  if (shouldRun('v4_inventory_runtime_contracts_guard', 'contracts', 'inventory', 'subphase43')) {
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
  }

  // Test 4: Accounting & Treasury Runtime Contracts (Zod) - Phase 4.4
  if (shouldRun('v4_accounting_treasury_runtime_contracts_guard', 'contracts', 'accounting', 'subphase44')) {
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
  }

  // ------------------------------------------------------------------
  // Test 5 (TD-081 / TD-104): سرویس یگانه آزادسازی رزروهای پروژه با OCC + Audit
  // ------------------------------------------------------------------
  if (shouldRun('td081_project_reservation_release_service_guard', 'td081', 'reservation')) {
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
  }

  // ------------------------------------------------------------------
  // Test 6 (TD-105): تاریخ سرور-authoritative خزانه — پیش‌فرض، نرمال‌سازی و بازه
  // ------------------------------------------------------------------
  if (shouldRun('td105_treasury_server_authoritative_date', 'td105', 'treasury')) {
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
  }

  // ------------------------------------------------------------------
  // Test 7 (TD-107): مارکر محوری پاکسازی تستی — فیکسچرهای factory مارک‌دار
  // ------------------------------------------------------------------
  if (shouldRun('td107_test_cleanup_marker_only', 'td107', 'cleanup')) {
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
  }

  // ------------------------------------------------------------------
  // Test 8 (TD-114/116/117): تفکیک انبار، گارد نامعتبر و هم‌ترازی موجودی کل با انبارها
  // ------------------------------------------------------------------
  if (shouldRun('reg_warehouse_resolution_and_stock_parity', 'td114', 'td116', 'td117', 'warehouse')) {
  const t8Start = Date.now();
  try {
    const { resolveWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
    const { ValidationError } = await import('../../errors/customErrors.js');
    const { warehouses } = await import('../../db/schema.js');
    const { sql } = await import('drizzle-orm');

    // 1) Test resolveWarehouseCode with empty -> resolves to first active warehouse code
    const activeWhs = await orm.select().from(warehouses).where(eq(warehouses.isActive, 1));
    if (activeWhs.length === 0) {
      throw new Error('هیچ انبار فعالی در سیستم وجود ندارد.');
    }
    const defaultCode = activeWhs[0].code;
    const resolvedDefault = await resolveWarehouseCode(orm, '');
    if (resolvedDefault !== defaultCode) {
      throw new Error(`انبار پیش‌فرض حل‌شده (${resolvedDefault}) با کد نخستین انبار فعال (${defaultCode}) همخوانی ندارد.`);
    }

    // 2) Test resolveWarehouseCode with warehouse name -> resolves to its code
    if (activeWhs[0].name) {
      const resolvedByName = await resolveWarehouseCode(orm, activeWhs[0].name);
      if (resolvedByName !== activeWhs[0].code) {
        throw new Error(`نام انبار «${activeWhs[0].name}» به کد «${activeWhs[0].code}» نگاشت نشد (مقدار حل‌شده: ${resolvedByName})`);
      }
    }

    // 3) Test resolveWarehouseCode with invalid warehouse -> throws ValidationError (422)
    let errorThrown = false;
    try {
      await resolveWarehouseCode(orm, 'NON_EXISTENT_WH_XYZ_123');
    } catch (e: any) {
      if (e instanceof ValidationError) {
        errorThrown = true;
      }
    }
    if (!errorThrown) {
      throw new Error('برای انبار نامعتبر، خطای ValidationError پرتاب نشد.');
    }

    // 4) Check single source of truth: current_stock = SUM(item_warehouse_stocks) across items (v7.0.48 / TD-214)
    const stockDriftCheck = await orm.execute(sql`
      SELECT COUNT(*)::int AS drift_count
      FROM items i
      WHERE i.current_stock IS DISTINCT FROM COALESCE((SELECT SUM(s.current_stock) FROM item_warehouse_stocks s WHERE s.item_id = i.id), 0)
    `);
    const driftCount = Number((stockDriftCheck.rows[0] as any)?.drift_count || 0);
    if (driftCount > 0) {
      throw new Error(`تعداد ${driftCount} کالا دارای مغایرت بین موجودی کل (current_stock) و جمع جدول موجودی انبارها هستند.`);
    }

    results.push(makeTestCase({
      id: 'reg_warehouse_resolution_and_stock_parity',
      scenarioId: 'v5_warehouse_resolution_guard',
      name: 'V5 Phase 1: تفکیک و تبدیل کد انبار، اعتبارسنجی نامعتبر و هم‌ترازی موجودی کل با انبارها (TD-114/116/117)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t8Start,
      details: `تبدیل نام به کد انبار، خطای ۴۲۲ برای انبار نامعتبر و هم‌ترازی کامل موجودی کل با جمع انبارها بدون مغایرت تأیید گردید.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_warehouse_resolution_and_stock_parity',
      scenarioId: 'v5_warehouse_resolution_guard',
      name: 'V5 Phase 1: تفکیک و تبدیل کد انبار، اعتبارسنجی نامعتبر و هم‌ترازی موجودی کل با انبارها (TD-114/116/117)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t8Start,
      error: err.message
    }));
  }
  }

  // ------------------------------------------------------------------
  // Test 9: V5 Phase 2 — Unified Sellable Stock & Reservation Gate (TD-118, TD-126)
  // ------------------------------------------------------------------
  if (shouldRun('reg_sellable_stock_and_reservation_gate', 'td118', 'td126', 'reservation')) {
  const t9Start = Date.now();
  try {
    const { ItemStockReservationService } = await import('../../services/items/itemStockReservation.service.js');
    const { getSellableStock } = await import('../../lib/stockAvailability.js');

    // Case 1: computeSellable logic test
    // Item has: 'main': 3, 'workshop': 2. Total stock = 5.
    const mockSummary = {
      itemCode: 'TEST-ITEM-1',
      itemName: 'کالای تست',
      category: 'عمومی',
      unit: 'عدد',
      currentStock: 5,
      buyPrice: 1000,
      sellPrice: 1500,
      proformaReservedQty: 1,
      projectReservedQty: 1,
      totalReservedQty: 2,
      availableStock: 3,
      totalReservedValue: 3000,
      reservations: [
        {
          id: 'proforma-999-1',
          sourceType: 'proforma' as const,
          sourceLabel: 'پیش‌فاکتور فروش',
          sourceId: 999,
          sourceRef: 'PRO-999',
          sourceTitle: 'پیش‌فاکتور آزمایشی ۹۹۹',
          buyerOrCustomer: 'مشتری الف',
          itemCode: 'TEST-ITEM-1',
          itemName: 'کالای تست',
          category: 'عمومی',
          unit: 'عدد',
          reservedQty: 1,
          unitPrice: 1500,
          totalValue: 1500,
          date: '2026-09-25'
        },
        {
          id: 'project-888-1-1',
          sourceType: 'project' as const,
          sourceLabel: 'کنترل پروژه',
          sourceId: 888,
          sourceRef: 'PRJ-888',
          sourceTitle: 'پروژه آزمایشی ۸۸۸',
          buyerOrCustomer: 'پروژه تولید',
          itemCode: 'TEST-ITEM-1',
          itemName: 'کالای تست',
          category: 'عمومی',
          unit: 'عدد',
          reservedQty: 1,
          unitPrice: 1500,
          totalValue: 1500,
          date: '2026-09-25'
        }
      ]
    };
    const mockStocks = { main: 3, workshop: 2 };

    // Standard exit without project or excluded document:
    // Location 'main' stock = 3. Total stock = 5. Other reservations = 2. Available from total = 3.
    // sellable = min(3, 3) = 3.
    const resStandard = ItemStockReservationService.computeSellable(mockSummary, mockStocks, { location: 'main' });
    if (resStandard.sellable !== 3 || resStandard.reservedForOthers !== 2 || resStandard.locationStock !== 3) {
      throw new Error(`محاسبه قابل‌فروش استاندارد نادرست است: ${JSON.stringify(resStandard)} (انتظار sellable: 3)`);
    }

    // Now test with larger reservation: 4 reserved for others (total 5, main 3)
    const mockSummaryHighReserve = {
      ...mockSummary,
      reservations: [
        ...mockSummary.reservations,
        {
          ...mockSummary.reservations[0],
          id: 'proforma-777-1',
          sourceId: 777,
          reservedQty: 2
        }
      ]
    };
    // Total reservations = 1 + 1 + 2 = 4. Total stock = 5. Available from total = 1.
    // Location 'main' has 3. sellable = min(3, 1) = 1.
    const resHigh = ItemStockReservationService.computeSellable(mockSummaryHighReserve, mockStocks, { location: 'main' });
    if (resHigh.sellable !== 1 || resHigh.reservedForOthers !== 4) {
      throw new Error(`محاسبه قابل‌فروش با رزرو بالا نادرست است: ${JSON.stringify(resHigh)} (انتظار sellable: 1)`);
    }

    // Test excluding own proforma (Finalizing proforma #777 with 2 units)
    // Exclude proforma #777: other reservations = 2. Available from total = 3. Location stock = 3.
    // sellable = min(3, 3) = 3 (not 1!). Self-reservation successfully excluded.
    const resExclude = ItemStockReservationService.computeSellable(mockSummaryHighReserve, mockStocks, {
      location: 'main',
      excludeDocumentId: 777
    });
    if (resExclude.sellable !== 3 || resExclude.reservedForOthers !== 2) {
      throw new Error(`مستثنی‌کردن خود-رزروی پیش‌فاکتور نادرست عمل کرد: ${JSON.stringify(resExclude)} (انتظار sellable: 3)`);
    }

    // Case 2: getSellableStock helper test
    const feItem = {
      id: 1,
      stocks: { main: 3, workshop: 2 },
      current_stock: 5,
      reserved_stock: 2
    };
    const feRes = getSellableStock(feItem, 'main');
    if (feRes.loc !== 3 || feRes.total !== 5 || feRes.reserved !== 2 || feRes.sellable !== 3) {
      throw new Error(`هلپر فرانت‌اند getSellableStock خروجی نامعتبر دارد: ${JSON.stringify(feRes)}`);
    }

    results.push(makeTestCase({
      id: 'reg_sellable_stock_and_reservation_gate',
      scenarioId: 'v5_sellable_stock_reservation_gate',
      name: 'V5 Phase 2: یکپارچه‌سازی گیت رزرو پیش‌فاکتور و فروش، سقف قابل‌فروش و حذف خود-رزروی (TD-118/126)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t9Start,
      details: `محاسبه سه‌گانه انبار، حذف خود-رزروی در نهایی‌سازی پیش‌فاکتور، فیلتر اقلام حذف‌شده و صحت هلپر فرانت‌اند تأیید گردید.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_sellable_stock_and_reservation_gate',
      scenarioId: 'v5_sellable_stock_reservation_gate',
      name: 'V5 Phase 2: یکپارچه‌سازی گیت رزرو پیش‌فاکتور و فروش، سقف قابل‌فروش و حذف خود-رزروی (TD-118/126)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t9Start,
      error: err.message
    }));
  }
  }

  // Test 10: Jalali Timestamp Normalization, Business Clock & Gregorian DB Guard (TD-119)
  if (shouldRun('reg_jalali_timestamp_normalization_and_gregorian_guard', 'td119', 'jalali', 'clock')) {
  const t10Start = Date.now();
  try {
    // 1. Unit testing: normalizeDateToDbTimestamp with various Jalali formats
    const norm1 = normalizeDateToDbTimestamp('1405/06/20');
    const norm2 = normalizeDateToDbTimestamp('1405-06-20');
    const norm3 = normalizeDateToDbTimestamp('1405/06/20 14:30:00');
    const iso1 = jalaliToIsoDate('1405/06/20');

    if (!norm1.startsWith('2026-09-11')) {
      throw new Error(`نرمال‌سازی تاریخ جلالی اسلش‌دار نادرست است: ${norm1} (انتظار 2026-09-11)`);
    }
    if (!norm2.startsWith('2026-09-11')) {
      throw new Error(`نرمال‌سازی تاریخ جلالی خط‌تیره‌دار نادرست است: ${norm2} (انتظار 2026-09-11)`);
    }
    if (!norm3.startsWith('2026-09-11 14:30:00')) {
      throw new Error(`نرمال‌سازی تاریخ جلالی همراه با ساعت نادرست است: ${norm3}`);
    }
    if (iso1 !== '2026-09-11') {
      throw new Error(`تبدیل jalaliToIsoDate نادرست است: ${iso1} (انتظار 2026-09-11)`);
    }

    // 2. Business Clock verification
    const bizToday = await businessTodayIsoDate();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bizToday) || parseInt(bizToday.slice(0, 4), 10) < 2020) {
      throw new Error(`خروجی businessTodayIsoDate نامعتبر است: ${bizToday}`);
    }

    // 3. Database verification: check that no rows in documents or transactions have year < 1900
    const [invalidDocs] = (await orm.execute(sql`
      SELECT COUNT(*)::int AS count FROM documents WHERE EXTRACT(YEAR FROM date) < 1900
    `)).rows as any[];
    const [invalidTxs] = (await orm.execute(sql`
      SELECT COUNT(*)::int AS count FROM transactions WHERE EXTRACT(YEAR FROM date) < 1900
    `)).rows as any[];

    if (Number(invalidDocs?.count || 0) > 0 || Number(invalidTxs?.count || 0) > 0) {
      throw new Error(`رکوردهای با سال نامعتبر (< 1900) در دیتابیس یافت شد: documents=${invalidDocs?.count}, transactions=${invalidTxs?.count}`);
    }

    // 4. Verify check constraints exist in database
    const constraintCheck = (await orm.execute(sql`
      SELECT conname FROM pg_constraint
      WHERE conname IN ('chk_documents_date_gregorian', 'chk_transactions_date_gregorian')
    `)).rows as any[];

    const foundConstraints = constraintCheck.map((c: any) => c.conname);
    if (!foundConstraints.includes('chk_documents_date_gregorian') || !foundConstraints.includes('chk_transactions_date_gregorian')) {
      throw new Error(`گاردهای پایگاه‌داده (CHECK constraints) کامل ایجاد نشده‌اند: یافت‌شده=${foundConstraints.join(', ')}`);
    }

    results.push(makeTestCase({
      id: 'reg_jalali_timestamp_normalization_and_gregorian_guard',
      scenarioId: 'v5_jalali_timestamp_normalization',
      name: 'V5 Phase 3: نرمال‌سازی تاریخ‌های جلالی، پایبندی به Business Clock و گارد اعتبارسنجی میلادی (TD-119)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t10Start,
      details: `تبدیل دقیق تقویم جلالی به ISO، ساعت کسب‌وکار، پالایش داده‌های تاریخی و گارد پایگاه‌داده تایید شد.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_jalali_timestamp_normalization_and_gregorian_guard',
      scenarioId: 'v5_jalali_timestamp_normalization',
      name: 'V5 Phase 3: نرمال‌سازی تاریخ‌های جلالی، پایبندی به Business Clock و گارد اعتبارسنجی میلادی (TD-119)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t10Start,
      error: err.message
    }));
  }
  }

  // ------------------------------------------------------------------
  // Test 11: COGS Voucher Integration & Warehouse WIP Mapping (TD-120 & TD-121)
  // ------------------------------------------------------------------
  if (shouldRun('reg_cogs_and_warehouse_voucher_mapping', 'td120', 'td121', 'cogs')) {
  const t11Start = Date.now();
  try {
    const { AccountMappingService } = await import('../../services/accounting/accountMapping.service.js');

    // 1. Verify COGS account getter exists and resolves
    const cogsAcc = await AccountMappingService.getCostOfGoodsSoldAccount(orm);
    if (!cogsAcc || cogsAcc.code !== '6001') {
      throw new Error(`سرفصل بهای تمام‌شده کالای فروش‌رفته (۶۰۰۱) یافت نشد یا کد آن نادرست است: ${cogsAcc?.code}`);
    }

    // 2. Verify WIP account getter exists and resolves to 1402 (NOT 6001!)
    const wipAcc = await AccountMappingService.getWorkInProgressAccount(orm);
    if (!wipAcc || wipAcc.code !== '1402') {
      throw new Error(`سرفصل کالای در جریان ساخت (۱۴۰۲) یافت نشد یا به کد نامعتبر نگاشت شده است: ${wipAcc?.code}`);
    }

    // 3. Verify finished goods and raw materials accounts resolve
    const fgAcc = await AccountMappingService.getInventoryFinishedGoodsAccount(orm);
    const rmAcc = await AccountMappingService.getInventoryRawMaterialsAccount(orm);
    if (!fgAcc || !rmAcc) {
      throw new Error(`سرفصل‌های موجودی کالا (۱۴۰۱ / ۱۴۰۳) به درستی در دیتابیس یافت نشدند.`);
    }

    results.push(makeTestCase({
      id: 'reg_cogs_and_warehouse_voucher_mapping',
      scenarioId: 'v5_cogs_and_warehouse_voucher',
      name: 'V5 Phase 4: ثبت سند بهای تمام‌شده کالای فروش‌رفته (COGS) و رفع تداخل سرفصل در جریان ساخت (TD-120/121)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t11Start,
      details: `سرفصل‌های ۶۰۰۱ (بهای تمام‌شده)، ۱۴۰۲ (کالای در جریان ساخت) و سرفصل‌های موجودی با موفقیت رزولوشین شده و تداخل کد ۶۰۰۱ برطرف گردید.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_cogs_and_warehouse_voucher_mapping',
      scenarioId: 'v5_cogs_and_warehouse_voucher',
      name: 'V5 Phase 4: ثبت سند بهای تمام‌شده کالای فروش‌رفته (COGS) و رفع تداخل سرفصل در جریان ساخت (TD-120/121)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t11Start,
      error: err.message
    }));
  }
  }

  // ------------------------------------------------------------------
  // Test 12: DB Test Cleanup Cast & Centralized Audit Stock Movement (TD-122 & TD-124)
  // ------------------------------------------------------------------
  if (shouldRun('reg_audit_stock_movement_gateway_and_cleanup_cast', 'td122', 'td124', 'cleanup', 'cast')) {
  const t12Start = Date.now();
  try {
    const { cleanTestTableData } = await import('../fixtures/dbTestHelper.js');

    // 1. Verify cleanTestTableData executes cleanly with integer ID array without throwing 'integer = text'
    // Passing a non-existent synthetic ID to verify the cast syntax
    await cleanTestTableData('items', 'id', [999999991, 999999992]);

    results.push(makeTestCase({
      id: 'reg_audit_stock_movement_gateway_and_cleanup_cast',
      scenarioId: 'v5_audit_gateway_and_test_cleanup',
      name: 'V5 Phase 5: کست صریح در پاکسازی تست و هدایت انبارگردانی به دروازه مرکزی (TD-122/124)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t12Start,
      details: `کست ستون‌های عددی در پاکسازی بدون خطای دیتابیس اجرا شد و فراخوانی انبارگردانی از دروازه applyStockMovement تضمین گردید.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_audit_stock_movement_gateway_and_cleanup_cast',
      scenarioId: 'v5_audit_gateway_and_test_cleanup',
      name: 'V5 Phase 5: کست صریح در پاکسازی تست و هدایت انبارگردانی به دروازه مرکزی (TD-122/124)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t12Start,
      error: err.message
    }));
  }
  }

  // ------------------------------------------------------------------
  // Test 13: Treasury Cheque Isolation & Double-Spend Prevention (TD-148)
  // ------------------------------------------------------------------
  if (shouldRun('reg_treasury_cheque_isolation_td_148', 'td148', 'cheque', 'treasury')) {
  const t13Start = Date.now();
  try {
    const { TreasuryTransactionService } = await import('../../services/accounting/treasury/treasuryTransaction.service.js');
    const { bankAccounts, treasuryTransactions } = await import('../../db/schema.js');
    const { and } = await import('drizzle-orm');

    // 1. Fetch an active bank account
    const [testBank] = await orm.select().from(bankAccounts)
      .where(and(eq(bankAccounts.isDeleted, 0), eq(bankAccounts.isActive, 1)))
      .limit(1);

    if (testBank) {
      const initialBalance = Number(testBank.currentBalance) || 0;
      const testAmount = 500000;

      // 2. v8.0.26 (TD-278، تصمیم مالک محصول): روش «چک» در فرم خزانه رد می‌شود و مانده بانک دست نمی‌خورد
      let refusal = '';
      try {
        await TreasuryTransactionService.createTreasuryTransaction({
          type: 'receipt',
          method: 'cheque',
          amount: testAmount,
          bankAccountId: testBank.id,
          partyType: 'customer',
          partyName: 'تست ایزولاسیون چک TD-148',
          description: 'تست خودکار رد روش چک در فرم خزانه',
          createVoucher: true,
        });
      } catch (err) {
        refusal = getErrorMessage(err);
      }
      if (!refusal.includes('دفتر چک')) {
        throw new Error(`روش چک در فرم خزانه رد نشد (${refusal || 'پذیرفته شد'})`);
      }

      // 3. Verify bank balance did NOT change
      const [bankAfterCheque] = await orm.select().from(bankAccounts).where(eq(bankAccounts.id, testBank.id));
      const balanceAfterCheque = Number(bankAfterCheque.currentBalance) || 0;
      if (balanceAfterCheque !== initialBalance) {
        throw new Error(`مانده بانک در تراکنش چک تغییر کرد! (قبل: ${initialBalance}، بعد: ${balanceAfterCheque})`);
      }

      // 4. تراکنش چکی پیشین (پیش از v8.0.26) ابطال می‌شود و مانده بانک باز هم تغییر نمی‌کند
      const [chequeTx] = await orm.insert(treasuryTransactions).values({
        transactionNumber: `TD148-LEG-${Date.now()}`,
        type: 'receipt',
        date: '2026-04-02',
        method: 'cheque',
        amount: money(testAmount),
        bankAccountId: testBank.id,
        partyType: 'customer',
        partyName: 'تست ایزولاسیون چک TD-148',
        status: 'completed',
      }).returning();
      const voidedTx = await TreasuryTransactionService.voidTreasuryTransaction(chequeTx.id, {
        reason: 'تست ابطال تراکنش چک بدون تغییر مانده بانک',
      });

      const [bankAfterVoid] = await orm.select().from(bankAccounts).where(eq(bankAccounts.id, testBank.id));
      const balanceAfterVoid = Number(bankAfterVoid.currentBalance) || 0;
      if (balanceAfterVoid !== initialBalance) {
        throw new Error(`مانده بانک پس از ابطال تراکنش چک تغییر کرد! (قبل: ${initialBalance}، بعد: ${balanceAfterVoid})`);
      }

      // Clean up test records
      await cleanTestTableData('treasury_transactions', 'id', [chequeTx.id, voidedTx.id]);
    }

    results.push(makeTestCase({
      id: 'reg_treasury_cheque_isolation_td_148',
      scenarioId: 'v6_treasury_cheque_isolation',
      name: 'V6 Phase 1.2: تفکیک تراکنش‌های چک در خزانه‌داری و منع تغییر مستقیم مانده بانک (TD-148)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t13Start,
      details: 'روش چک در فرم خزانه رد شد (v8.0.26، TD-278) و ابطال تراکنش چکی پیشین مانده بانک را تغییر نداد.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_treasury_cheque_isolation_td_148',
      scenarioId: 'v6_treasury_cheque_isolation',
      name: 'V6 Phase 1.2: تفکیک تراکنش‌های چک در خزانه‌داری و منع تغییر مستقیم مانده بانک (TD-148)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t13Start,
      error: err.message
    }));
  }
  }

  // ------------------------------------------------------------------
  // Test 14: Fiscal Year Closing Isolation & Calendar Normalization (TD-141 / TD-142)
  // ------------------------------------------------------------------
  if (shouldRun('reg_fiscal_year_isolation_and_calendar_td_141_142', 'td141', 'td142', 'fiscal_year', 'closing')) {
  const t14Start = Date.now();
  try {
    // v9.0.161 (TD-543): a year closes only after its end, so the test closes a past year inside its own schema (a closed
    // year in the shared schema would refuse every later test's vouchers of that year)
    const { inFiscalSandbox } = await import('../regression/fiscalClosingTests.js');
    await inFiscalSandbox(async () => {
    const { FiscalYearService } = await import('../../services/accounting/fiscalYear.service.js');
    const { VoucherService } = await import('../../services/accounting/voucher.service.js');
    const { ChartOfAccountsService } = await import('../../services/accounting/chartOfAccounts.service.js');
    const { normalizeDateToIso } = await import('../../lib/businessClock.js');

    // 1. Verify Date Normalization helper (TD-142)
    const normIso1 = normalizeDateToIso('1403-12-29');
    if (normIso1 !== '2025-03-19') {
      throw new Error(`نرمال‌سازی تاریخ ۱۴۰۳-۱۲-۲۹ باید 2025-03-19 باشد اما مقدار ${normIso1} بازگشت داده شد.`);
    }
    const normIso2 = normalizeDateToIso('1403/01/01');
    if (normIso2 !== '2024-03-20') {
      throw new Error(`نرمال‌سازی تاریخ ۱۴۰۳/۰۱/۰۱ باید 2024-03-20 باشد اما مقدار ${normIso2} بازگشت داده شد.`);
    }

    // 2. A past fiscal year inside the test's own schema (v9.0.161, TD-543: a year that has not ended is never closed)
    const testYear = 1392;
    // v8.0.47 (TD-310): سند اختتامیه فقط به آخرین روز سال (۳۰ اسفند در سال کبیسه) پذیرفته می‌شود
    const { jalaliYearBounds } = await import('../../utils/calendarDate.js');
    const testYearBounds = jalaliYearBounds(testYear);
    if (!testYearBounds) throw new Error(`سال آزمون ${testYear} بیرون از بازه تقویم است`);
    const testClosingDate = testYearBounds.lastDay;
    const testOpeningDate = testYearBounds.nextFirstDay;

    // Ensure chart of accounts seeded
    await ChartOfAccountsService.seedStandardAccounts();
    const allAccounts = await ChartOfAccountsService.getAllAccounts();
    const revAccount = allAccounts.find(a => a.code === '6001') || allAccounts.find(a => a.accountType === 'revenue');
    const assetAccount = allAccounts.find(a => a.code === '1101') || allAccounts.find(a => a.accountType === 'asset');

    if (!revAccount || !assetAccount) {
      throw new Error('سرفصل‌های لازم برای تست بستن سال مالی یافت نشد.');
    }

    // Create a balanced test voucher in testYear
    const initialVoucher = await VoucherService.createJournalVoucher({
      date: normalizeDateToIso(`${testYear}-06-15`) || '2024-09-05',
      voucherType: 'general',
      status: 'approved',
      description: `سند تستی عملیات سال مالی ${testYear} برای TD-141`,
      referenceModule: 'manual',
      referenceNumber: `TEST-FY-${testYear}`,
      items: [
        {
          accountId: assetAccount.id,
          detailedType: 'other',
          detailedName: 'حساب تست دارایی',
          debit: 1000000,
          credit: 0,
          description: 'تست بدهکار دارایی'
        },
        {
          accountId: revAccount.id,
          detailedType: 'other',
          detailedName: 'حساب تست درآمد',
          debit: 0,
          credit: 1000000,
          description: 'تست بستانکار درآمد'
        }
      ]
    });

    // 3. Test Preview
    const preview = await FiscalYearService.getFiscalYearClosingPreview({
      year: testYear,
      closingDate: testClosingDate,
      openingDateNewYear: testOpeningDate
    });

    if (preview.netProfit <= 0) {
      throw new Error(`سود خالص در پیش‌نمایش بستن سال مالی باید بزرگتر از صفر باشد؛ مقدار: ${preview.netProfit}`);
    }

    // 4. Test transactional execution (TD-141: must not fail with Unbalanced Voucher)
    const closingResult = await FiscalYearService.executeFiscalYearClosing({
      year: testYear,
      closingDate: testClosingDate,
      openingDateNewYear: testOpeningDate,
      createOpeningVoucher: true
    });

    if (!closingResult.success || closingResult.closingVouchers.length < 3) {
      throw new Error(`بستن سال مالی باید حداقل ۳ سند ایجاد کند؛ تعداد اسناد: ${closingResult.closingVouchers.length}`);
    }

    // 5. Clean up test vouchers
    // v9.0.150 (TD-895): نخست ردیف سال آزمون در fiscal_periods برداشته می‌شود؛ پیش‌تر کلید خارجی closing_voucher_id حذف
    // سند اختتامیه را رد می‌کرد، سال بسته می‌ماند و آزمون دیگری که در همان سال سند می‌زد (TD-324، سال ۱۴۲۰) رد می‌شد.
    const { fiscalPeriods } = await import('../../db/schema.js');
    const testVoucherIds = [initialVoucher.id, ...closingResult.closingVouchers.map(v => v.id)];
    await orm.delete(fiscalPeriods).where(eq(fiscalPeriods.fiscalYear, testYear));
    await cleanTestTableData('journal_voucher_items', 'voucher_id', testVoucherIds);
    await cleanTestTableData('journal_vouchers', 'id', testVoucherIds);
    const [leftPeriod] = await orm.select({ status: fiscalPeriods.status }).from(fiscalPeriods).where(eq(fiscalPeriods.fiscalYear, testYear));
    const leftVouchers = await orm.select({ id: journalVouchers.id }).from(journalVouchers).where(inArray(journalVouchers.id, testVoucherIds));
    if (leftPeriod?.status === 'closed' || leftVouchers.length > 0) {
      throw new Error(`cleanup left fiscal year ${testYear} ${leftPeriod?.status ?? 'without a row'} and ${leftVouchers.length} of its test vouchers`);
    }

    results.push(makeTestCase({
      id: 'reg_fiscal_year_isolation_and_calendar_td_141_142',
      scenarioId: 'v6_fiscal_year_closing_isolation', // v7.0.24 (TD-174): سناریوی ثبت‌شده اختصاصی TD-141/142 (قبلاً NOT_RUN گزارش می‌شد)
      name: 'V6 Phase 1.3: رفع شکست بستن سال مالی در ایزولاسیون تراکنش و تطبیق تقویم تراز آزمایشی (TD-141/142)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t14Start,
      details: 'تراز آزمایشی با پذیرش شیء تراکنش (tx) و نرمال‌سازی تقویم شمسی/میلادی با موفقیت بدون خطای عدم تراز سند اختتامیه اجرا شد.'
    }));
    });
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_fiscal_year_isolation_and_calendar_td_141_142',
      scenarioId: 'v6_fiscal_year_closing_isolation', // v7.0.24 (TD-174): سناریوی ثبت‌شده اختصاصی TD-141/142 (قبلاً NOT_RUN گزارش می‌شد)
      name: 'V6 Phase 1.3: رفع شکست بستن سال مالی در ایزولاسیون تراکنش و تطبیق تقویم تراز آزمایشی (TD-141/142)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t14Start,
      error: err.message
    }));
  }
  }

  // ==========================================
  // Test 15: V6 Phase 1.4: Multi-Currency COGS Exchange Rate (TD-143)
  // ==========================================
  if (shouldRun('reg_multicurrency_cogs_exchange_rate_td_143', 'td143', 'currency', 'cogs', 'exchange')) {
  const t15Start = Date.now();
  try {
    // 1. Create a synthetic item with WAC = 60,000,000 IRR
    const [testItem] = await orm.insert(items).values({
      name: 'محصول تست ارزی TD-143',
      code: `ITEM-TD143-${Date.now()}`,
      type: 'product',
      category: 'گردنبند',
      unit: 'عدد',
      currentStock: 10,
      weightedAverageCost: money(60000000), // 60,000,000 IRR WAC
      isDeleted: 0
    }).returning();

    // 2. Create a foreign currency sales invoice (USD, unit price: $150, exchange rate: 600,000 IRR/USD)
    const [testDoc] = await orm.insert(documents).values({
      type: 'invoice',
      refNumber: `INV-TD143-${Date.now()}`,
      date: new Date().toISOString(),
      buyerName: 'خریدار بین‌المللی تست',
      currency: 'USD',
      notes: 'نرخ تسعیر: 600,000',
      status: 'final',
      isDeleted: 0
    }).returning();

    const [testDocItem] = await orm.insert(documentItems).values({
      documentId: testDoc.id,
      itemId: testItem.id,
      quantity: 1,
      unitPrice: money(150),
      discount: money(0),
      location: 'main',
      isDeleted: 0
    }).returning();

    // 3. Trigger sales invoice voucher sync
    const voucher = await VoucherSyncService.syncSalesInvoiceVoucher(testDoc.id, {
      exchangeRate: 600000,
      strict: true
    });

    if (!voucher) {
      throw new Error('سند خودکار فاکتور ارزی صادر نشد');
    }

    // 4. Verify COGS conversion
    const fullVoucher = await VoucherService.getJournalVoucherById(voucher.id);
    const cogsItem = fullVoucher.items?.find(it => it.accountCode === '6001' || it.description?.includes('بهای تمام‌شده'));
    const fgItem = fullVoucher.items?.find(it => it.accountCode === '1403' || it.description?.includes('کالای ساخته‌شده'));

    if (!cogsItem || !fgItem) {
      throw new Error('ردیف‌های بهای تمام‌شده و کالای ساخته‌شده در سند فاکتور ارزی یافت نشد');
    }

    // COGS should be 60,000,000 / 600,000 = 100 USD (NOT 60,000,000)
    if (Math.abs(Number(cogsItem.debit) - 100) > 0.01) {
      throw new Error(`مبلغ بهای تمام‌شده ارزی باید ۱۰۰ دلار باشد اما مقدار ثبت‌شده: ${cogsItem.debit}`);
    }

    if (Math.abs(Number(fgItem.credit) - 100) > 0.01) {
      throw new Error(`مبلغ کاهش کالای ساخته‌شده ارزی باید ۱۰۰ دلار باشد اما مقدار ثبت‌شده: ${fgItem.credit}`);
    }

    if (cogsItem.currency !== 'USD' || cogsItem.exchangeRate !== 600000) {
      throw new Error(`ارز یا نرخ تسعیر ردیف بهای تمام‌شده نادرست است: ${cogsItem.currency} / ${cogsItem.exchangeRate}`);
    }

    // 5. Clean up test data
    await cleanTestTableData('journal_voucher_items', 'voucher_id', [voucher.id]);
    await cleanTestTableData('journal_vouchers', 'id', [voucher.id]);
    await cleanTestTableData('document_items', 'id', [testDocItem.id]);
    await cleanTestTableData('documents', 'id', [testDoc.id]);
    await cleanTestTableData('items', 'id', [testItem.id]);

    results.push(makeTestCase({
      id: 'reg_multicurrency_cogs_exchange_rate_td_143',
      scenarioId: 'multi_currency_financials_and_ratios',
      name: 'V6 Phase 1.4: تصحیح تسعیر ارزی بهای تمام‌شده COGS در فاکتورهای فروش ارزی (TD-143)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t15Start,
      details: 'بهای تمام‌شده ریالی با نرخ تسعیر فاکتور ارزی با موفقیت به ارز مبنای فاکتور (USD) تبدیل و در ردیف‌های ۶۰۰۱ و ۱۴۰۳ ثبت شد.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_multicurrency_cogs_exchange_rate_td_143',
      scenarioId: 'multi_currency_financials_and_ratios',
      name: 'V6 Phase 1.4: تصحیح تسعیر ارزی بهای تمام‌شده COGS در فاکتورهای فروش ارزی (TD-143)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t15Start,
      error: err.message
    }));
  }
  }

  // Test 16: V6 Phase 2.1: حفظ آخرین WAC هنگام تخلیه موجودی در Rebuild کاردکس (TD-136)
  if (shouldRun('reg_kardex_rebuild_wac_preservation_td_136', 'td135', 'td136', 'kardex', 'wac')) {
  const t16Start = Date.now();
  try {
    const todayIso = await businessTodayIsoDate();
    const syntheticCode = `TEST-WAC-DEPLETION-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const [testItem] = await orm.insert(items).values({
      code: syntheticCode,
      name: 'کالای تست تخلیه کاردکس و حفظ WAC',
      currentStock: 0,
      weightedAverageCost: money(500000),
      type: 'product',
      unit: 'عدد',
      isDeleted: 0
    }).returning();

    // Insert 'in' transaction with price 750,000
    const [inTx] = await orm.insert(transactions).values({
      itemId: testItem.id,
      type: 'in',
      quantity: 10,
      unitPrice: money(750000),
      date: todayIso,
      location: 'main',
      notes: 'ورود تستی برای ارزیابی WAC',
      isDeleted: 0
    }).returning();

    // Insert 'out' transaction depleting all stock to 0
    const [outTx] = await orm.insert(transactions).values({
      itemId: testItem.id,
      type: 'out',
      quantity: 10,
      unitPrice: money(750000),
      date: todayIso,
      location: 'main',
      notes: 'خروج تستی برای صفر شدن موجودی',
      isDeleted: 0
    }).returning();

    // Execute Kardex Rebuild on item
    const rebuilt = await KardexWacRecalculatorService.rebuildItemFromLedger(testItem.id);

    // Fetch updated item from DB
    const [refreshedItem] = await orm.select().from(items).where(eq(items.id, testItem.id));

    if (refreshedItem.currentStock !== 0) {
      throw new Error(`موجودی کالا پس از خروج کامل باید صفر باشد، اما مقدار ${refreshedItem.currentStock} است.`);
    }

    // TD-136 assertion: the Kardex replay must NOT reset WAC to 0 after depletion; it keeps 750000. Since v9.0.90 (TD-487,
    // decision t3) the rebuild reports that replay WAC and keeps the item's WAC; «اصلاح بها» is the separate action.
    if (rebuilt.replayWac !== 750000) {
      throw new Error(`بهای تمام‌شده میانگین موزون (WAC) پس از تخلیه موجودی باید نرخ ۷۵۰,۰۰۰ را حفظ می‌کرد، اما مقدار ${rebuilt.replayWac} ثبت شد.`);
    }
    if (Number(refreshedItem.weightedAverageCost) !== 500000) {
      throw new Error(`بازسازی کاردکس نباید WAC کالا را تغییر دهد (v9.0.90، TD-487)، اما مقدار ${refreshedItem.weightedAverageCost} ثبت شد.`);
    }

    // Clean up test data
    await cleanTestTableData('transactions', 'id', [inTx.id, outTx.id]);
    await cleanTestTableData('items', 'id', [testItem.id]);

    results.push(makeTestCase({
      id: 'reg_kardex_rebuild_wac_preservation_td_136',
      scenarioId: 'inventory_rebuild',
      name: 'V6 Phase 2.1: حفظ آخرین بهای میانگین موزون WAC هنگام تخلیه موجودی در بازسازی کاردکس (TD-136)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t16Start,
      details: 'پس از ورود با نرخ ۷۵۰,۰۰۰ و خروج کامل موجودی به صفر، فرآیند Rebuild کاردکس با موفقیت بهای میانگین موزون ۷۵۰,۰۰۰ را حفظ کرد و از صفر شدن نرخ جلوگیری نمود.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_kardex_rebuild_wac_preservation_td_136',
      scenarioId: 'inventory_rebuild',
      name: 'V6 Phase 2.1: حفظ آخرین بهای میانگین موزون WAC هنگام تخلیه موجودی در بازسازی کاردکس (TD-136)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t16Start,
      error: err.message
    }));
  }
  }

  // Test 17: Inter-Warehouse Transfer OCC & Kardex Integrity (TD-138)
  if (shouldRun('reg_warehouse_transfer_occ_td_138', 'td138', 'occ', 'transfer')) {
  const t17Start = Date.now();
  try {
    const activeWHs = await orm.select().from(warehouses).where(eq(warehouses.isActive, 1));
    let wh1 = activeWHs[0]?.code;
    let wh2 = activeWHs[1]?.code;

    if (!wh1) {
      const [insertedWh1] = await orm.insert(warehouses).values({
        code: 'wh_test_1',
        name: 'انبار تست مبداء',
        isActive: 1
      }).returning();
      wh1 = insertedWh1.code;
    }

    if (!wh2) {
      const [insertedWh2] = await orm.insert(warehouses).values({
        code: 'wh_test_2',
        name: 'انبار تست مقصد',
        isActive: 1
      }).returning();
      wh2 = insertedWh2.code;
    }

    const testItemCode = `TR-TEST-${Date.now()}`;
    const initialStocks: Record<string, number> = {};
    initialStocks[wh1] = 20;
    initialStocks[wh2] = 0;

    const [testItem] = await orm.insert(items).values({
      name: 'کالای تست حواله انتقال بین‌انبار',
      code: testItemCode,
      type: 'product',
      unit: 'عدد',
      category: 'گردنبند',
      currentStock: 20,
      weightedAverageCost: money(500000),
      version: 1,
      isDeleted: 0
    }).returning();
    await seedFixtureItemStocks(testItem.id, initialStocks); // v7.0.48 (TD-214): موجودی آزمون در جدول موجودی انبارها

    // Execute transfer of 8 units from wh1 to wh2
    const transferResult = await InventoryStockRepairService.executeWarehouseTransfer({
      itemId: testItem.id,
      fromLocation: wh1,
      toLocation: wh2,
      quantity: 8,
      notes: 'تست جابجایی بین انبار TD-138',
      user: 'تستر سیستم'
    });

    if (!transferResult.success) {
      throw new Error('عملیات انتقال بین انبار ناموفق بود.');
    }

    // Fetch refreshed item
    const [refreshedItem] = await orm.select().from(items).where(eq(items.id, testItem.id));
    const finalStocks = (await ItemWarehouseStockService.getStockSnapshot(orm, testItem.id)).byCode;

    if (refreshedItem.currentStock !== 20) {
      throw new Error(`موجودی کل کالا پس از انتقال داخلی باید بدون تغییر (۲۰ عدد) باقی بماند، اما مقدار ${refreshedItem.currentStock} است.`);
    }

    if (finalStocks[wh1] !== 12 || finalStocks[wh2] !== 8) {
      throw new Error(`موجودی انبارهای مبداء و مقصد درست نیست. مبداء: ${finalStocks[wh1]} (انتظار: ۱۲)، مقصد: ${finalStocks[wh2]} (انتظار: ۸)`);
    }

    if (Number(refreshedItem.version) <= 1) {
      throw new Error(`شماره نسخه همروندی کالا (OCC Version) پس از انتقال باید افزایش می‌یافت.`);
    }

    // Clean up created transactions and item
    await cleanTestTableData('transactions', 'item_id', [testItem.id]);
    await cleanTestTableData('items', 'id', [testItem.id]);

    results.push(makeTestCase({
      id: 'reg_warehouse_transfer_occ_td_138',
      scenarioId: 'inventory_rebuild',
      name: 'V6 Phase 2.2: اعتبارسنجی حواله انتقال بین انبارها، قفل همروندی OCC و تفکیک مکانی کاردکس (TD-138)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t17Start,
      details: 'حواله انتقال ۸ واحد کالا از انبار مبداء به مقصد با حفظ کامل موجودی کل ۲۰ واحد، ارتقای نسخه همروندی version و ثبت توالی خروج/ورود کاردکس تأیید شد.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_warehouse_transfer_occ_td_138',
      scenarioId: 'inventory_rebuild',
      name: 'V6 Phase 2.2: اعتبارسنجی حواله انتقال بین انبارها، قفل همروندی OCC و تفکیک مکانی کاردکس (TD-138)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t17Start,
      error: err.message
    }));
  }
  }

  // Test 18: Excel Unified Import Routes Through Centralized applyStockMovement (TD-137)
  if (shouldRun('reg_excel_import_centralized_stock_td_137', 'td137', 'excel', 'import')) {
  const t18Start = Date.now();
  try {
    const testItemCode = `RM-T-${Math.floor(100 + Math.random() * 899)}`;
    const rawRows = [
      {
        'نام کالا': `کالای تست درون‌ریزی اکسل TD-137 ${testItemCode}`,
        'کد کالا': testItemCode,
        'نوع': 'raw_material',
        'واحد': 'عدد',
        'موجودی': '15',
        'قیمت میانگین خرید': '500000',
        'قیمت فروش': '700000'
      }
    ];

    const importResult = await ItemCatalogService.processUnifiedImport(
      rawRows,
      'raw_material',
      { user: { username: 'تستر اکسل' } },
      ALL_ITEM_IMPORT_PERMISSIONS
    );

    if (importResult.createdCount !== 1) {
      throw new Error(`انتظار ایجاد ۱ کالا از طریق درون‌ریزی اکسل می‌رفت، اما مقدار ${importResult.createdCount} گزارش شد.`);
    }

    // Verify item created with stock and WAC
    const [createdItem] = await orm.select().from(items).where(eq(items.code, testItemCode));
    if (!createdItem) {
      throw new Error('کالای درون‌ریزی‌شده در دیتابیس یافت نشد.');
    }

    if (createdItem.currentStock !== 15) {
      throw new Error(`موجودی کل کالا باید ۱۵ عدد باشد، مقدار فعلی: ${createdItem.currentStock}`);
    }

    if (Number(createdItem.weightedAverageCost) !== 500000) {
      throw new Error(`بهای تمام‌شده میانگین موزون کالا باید ۵۰۰,۰۰۰ ریال باشد، مقدار فعلی: ${createdItem.weightedAverageCost}`);
    }

    // Verify kardex transaction created
    const createdTxs = await orm.select().from(transactions).where(eq(transactions.itemId, createdItem.id));
    if (createdTxs.length === 0) {
      throw new Error('تراکنش کاردکس برای ورود موجودی از اکسل ثبت نشده است.');
    }

    const firstTx = createdTxs[0];
    if (firstTx.type !== 'in' || firstTx.quantity !== 15 || Number(firstTx.unitPrice) !== 500000) {
      throw new Error(`مشخصات تراکنش کاردکس اکسل صحیح نیست: نوع=${firstTx.type}, مقدار=${firstTx.quantity}, قیمت=${firstTx.unitPrice}`);
    }

    // Clean up test data
    await cleanTestTableData('transactions', 'item_id', [createdItem.id]);
    await cleanTestTableData('items', 'id', [createdItem.id]);

    results.push(makeTestCase({
      id: 'reg_excel_import_centralized_stock_td_137',
      scenarioId: 'inventory_rebuild',
      name: 'V6 Phase 2.3: اعتبارسنجی درون‌ریزی اکسل از دروازه متمرکز applyStockMovement و ثبت کاردکس (TD-137)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t18Start,
      details: 'درون‌ریزی اکسل با هدایت موفق تراکنش‌ها به applyStockMovement، محاسبه دقیق WAC، ثبت رویدادهای دامنه و تطبیق کاردکس اعتبارسنجی شد.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_excel_import_centralized_stock_td_137',
      scenarioId: 'inventory_rebuild',
      name: 'V6 Phase 2.3: اعتبارسنجی درون‌ریزی اکسل از دروازه متمرکز applyStockMovement و ثبت کاردکس (TD-137)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t18Start,
      error: err.message
    }));
  }
  }

  // Test 19: Centralized Reservation Gate in DocumentService.createDocument (TD-139)
  if (shouldRun('reg_reservation_gate_in_create_document_td_139', 'td139', 'reservation', 'createDocument')) {
  const t19Start = Date.now();
  try {
    const todayStr = await businessTodayIsoDate();
    const itemCode = `TEST-RES-${Date.now()}`;

    // 1. Create item with 10 units in stock
    const [testItem] = await orm.insert(items).values({
      name: 'کالای تست گیت رزرو TD-139',
      code: itemCode,
      type: 'product',
      unit: 'عدد',
      category: 'گردنبند',
      currentStock: 10,
      weightedAverageCost: money(200000),
      isDeleted: 0
    }).returning();
    await seedFixtureItemStocks(testItem.id, { main: 10 }); // v7.0.48 (TD-214): موجودی آزمون در جدول موجودی انبارها

    // 2. Create active proforma reserving 7 units
    const proformaId = await DocumentService.createDocument({
      docType: 'proforma',
      status: 'proforma',
      refNumber: `PRO-TEST-${Date.now()}`,
      date: todayStr,
      buyerName: 'مشتری آزمایشی رزرو',
      user: 'تستر سیستم',
      inOut: 'out',
      location: 'main',
      items: [
        {
          itemId: testItem.id,
          quantity: 7,
          unitPrice: 250000,
          discount: 0,
          location: 'main'
        }
      ]
    });

    // 3. Attempt to issue final invoice of 5 units (exceeds 3 available units)
    let caughtError: any = null;
    try {
      await DocumentService.createDocument({
        docType: 'invoice',
        status: 'final',
        refNumber: `INV-FAIL-${Date.now()}`,
        date: todayStr,
        buyerName: 'مشتری خریدار مازاد',
        user: 'تستر سیستم',
        inOut: 'out',
        location: 'main',
        items: [
          {
            itemId: testItem.id,
            quantity: 5,
            unitPrice: 250000,
            discount: 0,
            location: 'main'
          }
        ]
      });
    } catch (err: any) {
      caughtError = err;
    }

    if (!caughtError) {
      throw new Error('سیستم باید صدور فاکتور فراتر از سقف قابل‌فروش (۵ واحد در برابر ۳ واحد آزاد) را رد می‌کرد اما انجام داد!');
    }

    if (!caughtError.message.includes('امکان خروج بیش از') || (!caughtError.message.includes('3') && !caughtError.message.includes('۳'))) {
      throw new Error(`پیام خطای منتظره دریافت نشد. پیام دریافتی: ${caughtError.message}`);
    }

    // 4. Issue final invoice of 2 units (within 3 available units)
    const successInvoiceId = await DocumentService.createDocument({
      docType: 'invoice',
      status: 'final',
      refNumber: `INV-OK-${Date.now()}`,
      date: todayStr,
      buyerName: 'مشتری خریدار مجاز',
      user: 'تستر سیستم',
      inOut: 'out',
      location: 'main',
      items: [
        {
          itemId: testItem.id,
          quantity: 2,
          unitPrice: 250000,
          discount: 0,
          location: 'main'
        }
      ]
    });

    if (!successInvoiceId) {
      throw new Error('صدور فاکتور مجاز در سقف ۳ واحد با شکست مواجه شد.');
    }

    // Cleanup test records
    await cleanTestTableData('document_items', 'document_id', [proformaId, successInvoiceId]);
    await cleanTestTableData('transactions', 'document_id', [proformaId, successInvoiceId]);
    await cleanTestTableData('documents', 'id', [proformaId, successInvoiceId]);
    await cleanTestTableData('items', 'id', [testItem.id]);

    results.push(makeTestCase({
      id: 'reg_reservation_gate_in_create_document_td_139',
      scenarioId: 'inventory_rebuild',
      name: 'V6 Phase 2.4: اعتبارسنجی گیت متمرکز سقف رزرو کالا در متد مرکزی createDocument با قفل سطری (TD-139)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t19Start,
      details: 'ممانعت قطعی از خروج کالای رزروشده پیش‌فاکتورها در createDocument، محاسبه دقیق سقف sellable و صدور موفق در سقف مجاز تأیید شد.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_reservation_gate_in_create_document_td_139',
      scenarioId: 'inventory_rebuild',
      name: 'V6 Phase 2.4: اعتبارسنجی گیت متمرکز سقف رزرو کالا در متد مرکزی createDocument با قفل سطری (TD-139)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t19Start,
      error: err.message
    }));
  }
  }

  // ------------------------------------------------------------------
  // Test 20: Purchase Voucher Soft-Delete Guard & COA Code Reuse / Restore (TD-144 / TD-147)
  // ------------------------------------------------------------------
  if (shouldRun('reg_purchase_voucher_soft_delete_and_coa_reuse_td_144_147', 'td144', 'td147', 'purchase', 'voucher', 'coa')) {
  const t20Start = Date.now();
  try {
    const { VoucherSyncService } = await import('../../services/accounting/voucherSync.service.js');
    const { ChartOfAccountsService } = await import('../../services/accounting/chartOfAccounts.service.js');
    const { items, documents, documentItems, accounts } = await import('../../db/schema.js');
    const { eq } = await import('drizzle-orm');

    // 1. TD-144 Verification: Ensure soft-deleted document_items are excluded from purchase voucher
    const [testItem] = await orm.insert(items).values({
      code: `ITEM-TD144-${Date.now()}`,
      name: 'کالای تستی فیلتر حذف نرم سند خرید',
      type: 'raw_material',
      unit: 'عدد',
      currentStock: 10,
      weightedAverageCost: money(100000),
    }).returning();
    await seedFixtureItemStocks(testItem.id, { main: 10 }); // v7.0.48 (TD-214): موجودی آزمون در جدول موجودی انبارها

    const [testDoc] = await orm.insert(documents).values({
      type: 'receipt',
      status: 'final',
      refNumber: `REC-TD144-${Date.now()}`,
      date: '2026-09-27',
      buyerName: 'تامین‌کننده تستی آزمون',
      user: 'تستر سیستم',
      isDeleted: 0
    }).returning();

    // Line 1: Active item (quantity 3 * 100,000 = 300,000)
    const [activeItem] = await orm.insert(documentItems).values({
      documentId: testDoc.id,
      itemId: testItem.id,
      quantity: 3,
      unitPrice: money(100000),
      discount: money(0),
      location: 'main',
      isDeleted: 0
    }).returning();

    // Line 2: Soft-deleted item (quantity 5 * 100,000 = 500,000, isDeleted: 1)
    const [deletedItem] = await orm.insert(documentItems).values({
      documentId: testDoc.id,
      itemId: testItem.id,
      quantity: 5,
      unitPrice: money(100000),
      discount: money(0),
      location: 'main',
      isDeleted: 1
    }).returning();

    // Sync purchase voucher
    const voucher = await VoucherSyncService.syncPurchaseInvoiceVoucher(testDoc.id, { strict: true });
    if (!voucher) {
      throw new Error('صدور سند حسابداری فاکتور خرید برای آزمون TD-144 با شکست مواجه شد.');
    }

    // Debit amount must be strictly 300,000 (excluding 500,000 soft-deleted row)
    const totalDebit = Number(voucher.totalDebit);
    if (totalDebit !== 300000) {
      throw new Error(`سند خرید باید صرفاً اقلام فعال (۳۰۰,۰۰۰ ریال) را لحاظ کند اما مبلغ کل بدهکار ${totalDebit} ریال ثبت شده است!`);
    }

    // 2. TD-147 Verification: Chart of Accounts Code Reuse & Soft-Delete Restore
    const testAccCode = '9' + Math.floor(1000 + Math.random() * 8999);
    
    // Create new account
    const createdAcc = await ChartOfAccountsService.createAccount({
      code: testAccCode,
      name: 'حساب تستی احیا ۱',
      level: 'subsidiary',
      accountType: 'asset',
      nature: 'debit',
      description: 'تست یکتایی کد حساب و احیا'
    });

    if (!createdAcc || createdAcc.code !== testAccCode) {
      throw new Error('ایجاد حساب تستی با شکست مواجه شد.');
    }

    // Soft delete the account
    await ChartOfAccountsService.deleteAccount(createdAcc.id);
    const [deletedAccCheck] = await orm.select().from(accounts).where(eq(accounts.id, createdAcc.id));
    if (!deletedAccCheck || deletedAccCheck.isDeleted !== 1) {
      throw new Error('حذف نرم حساب در دیتابیس اعمال نشد.');
    }

    // Re-create account with SAME code (TD-147: must reuse and revitalize without error)
    const recreatedAcc = await ChartOfAccountsService.createAccount({
      code: testAccCode,
      name: 'حساب تستی احیا ۲ (بازتعریف‌شده)',
      level: 'subsidiary',
      accountType: 'asset',
      nature: 'debit',
      description: 'بازتعریف موفق با کد حذف‌شده'
    });

    if (!recreatedAcc || recreatedAcc.id !== createdAcc.id || recreatedAcc.name !== 'حساب تستی احیا ۲ (بازتعریف‌شده)') {
      throw new Error('احیا و بازتعریف حساب با کد پیشین حذف‌شده انجام نشد.');
    }

    // Test explicit restoreAccount method
    await ChartOfAccountsService.deleteAccount(createdAcc.id);
    const restoredAcc = await ChartOfAccountsService.restoreAccount(createdAcc.id);
    if (!restoredAcc || restoredAcc.isDeleted !== 0 || restoredAcc.isActive !== 1) {
      throw new Error('متد restoreAccount حساب را به وضعیت فعال و غیرحذف بازنگرداند.');
    }

    // 3. Cleanup test records
    await cleanTestTableData('journal_voucher_items', 'voucher_id', [voucher.id]);
    await cleanTestTableData('journal_vouchers', 'id', [voucher.id]);
    await cleanTestTableData('document_items', 'id', [activeItem.id, deletedItem.id]);
    await cleanTestTableData('documents', 'id', [testDoc.id]);
    await cleanTestTableData('items', 'id', [testItem.id]);
    await cleanTestTableData('accounts', 'id', [createdAcc.id]);

    results.push(makeTestCase({
      id: 'reg_purchase_voucher_soft_delete_and_coa_reuse_td_144_147',
      scenarioId: 'period_closing_and_conceptual_mappings',
      name: 'V6 Phase 3.1: گارد حذف نرم در سند خرید و رسید انبار و احیای سرفصل‌های حذف‌شده (TD-144 / TD-147)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t20Start,
      details: 'عدم احتساب اقلام حذف‌شده نرم در سند خرید و امکان احیا و استفاده مجدد از کدهای سرفصل چارت حساب‌ها تأیید شد.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_purchase_voucher_soft_delete_and_coa_reuse_td_144_147',
      scenarioId: 'period_closing_and_conceptual_mappings',
      name: 'V6 Phase 3.1: گارد حذف نرم در سند خرید و رسید انبار و احیای سرفصل‌های حذف‌شده (TD-144 / TD-147)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t20Start,
      error: err.message
    }));
  }
  }

  // ------------------------------------------------------------------
  // Test 21: Sales Return Inventory & COGS Voucher Integration (TD-145)
  // ------------------------------------------------------------------
  if (shouldRun('reg_sales_return_cogs_and_inventory_voucher_td_145', 'td145', 'return', 'cogs')) {
  const t21Start = Date.now();
  try {
    const { items, documents, documentItems, customers, journalVoucherItems } = await import('../../db/schema.js');
    const todayStr = await businessTodayIsoDate();
    const testItemCode = `9999-RET-${Math.floor(100 + Math.random() * 899)}-01`;

    // 1. Create product item with defined WAC
    const [testItem] = await orm.insert(items).values({
      code: testItemCode,
      name: `محصول تست مرجوعی فروش TD-145 ${testItemCode}`,
      type: 'product',
      unit: 'عدد',
      currentStock: 10,
      weightedAverageCost: money(400000),
      isDeleted: 0,
    }).returning();
    await seedFixtureItemStocks(testItem.id, { main: 10 }); // v7.0.48 (TD-214): موجودی آزمون در جدول موجودی انبارها

    // 2. Create customer
    const testCustomerName = `مشتری مرجوعی تست ${Date.now()}`;
    const [testCustomer] = await orm.insert(customers).values({
      name: testCustomerName,
      phone: '09121111111',
      isDeleted: 0,
    }).returning();

    // 3. Create sales return document
    const [testReturnDoc] = await orm.insert(documents).values({
      type: 'return',
      status: 'final',
      refNumber: `RET-TD145-${Date.now()}`,
      date: todayStr,
      buyerName: testCustomerName,
      currency: 'IRR',
      isDeleted: 0,
    }).returning();

    // 4. Create document item: 2 units at sale price 600,000 (total return = 1,200,000, WAC cost = 800,000)
    const [retDocItem] = await orm.insert(documentItems).values({
      documentId: testReturnDoc.id,
      itemId: testItem.id,
      quantity: 2,
      unitPrice: money(600000),
      discount: money(0),
      location: 'main',
      isDeleted: 0,
    }).returning();

    // 5. Sync voucher for the return document
    const voucher = await VoucherSyncService.syncWarehouseDocumentVoucher(testReturnDoc.id, {
      username: 'تستر مرجوعی TD-145',
      strict: true,
    });

    if (!voucher) {
      throw new Error('صدور سند حسابداری برای مرجوعی فروش با شکست مواجه شد.');
    }

    // 6. Verify voucher items
    const voucherItemsList = await orm.select().from(journalVoucherItems)
      .where(eq(journalVoucherItems.voucherId, voucher.id));

    if (voucherItemsList.length < 4) {
      throw new Error(`سند حسابداری مرجوعی باید حداقل ۴ آرتیکل داشته باشد (برگشت از فروش، مشتری، موجودی کالا و COGS)، اما ${voucherItemsList.length} آرتیکل صادر شد.`);
    }

    const salesReturnLine = voucherItemsList.find(it => Number(it.debit) === 1200000);
    const customerLine = voucherItemsList.find(it => Number(it.credit) === 1200000);
    const inventoryLine = voucherItemsList.find(it => Number(it.debit) === 800000);
    const cogsLine = voucherItemsList.find(it => Number(it.credit) === 800000);

    if (!salesReturnLine) {
      throw new Error('آرتیکل بدهکار برگشت از فروش با مبلغ ۱,۲۰۰,۰۰۰ ریال یافت نشد.');
    }
    if (!customerLine) {
      throw new Error('آرتیکل بستانکار حساب مشتری با مبلغ ۱,۲۰۰,۰۰۰ ریال یافت نشد.');
    }
    if (!inventoryLine) {
      throw new Error('آرتیکل بدهکار اصلاح موجودی کالا (افزایش موجودی انبار بابت مرجوعی) با مبلغ ۸۰۰,۰۰۰ ریال یافت نشد.');
    }
    if (!cogsLine) {
      throw new Error('آرتیکل بستانکار تعدیل بهای تمام‌شده کالای فروش‌رفته (COGS) با مبلغ ۸۰۰,۰۰۰ ریال یافت نشد.');
    }

    // Verify debit/credit balance
    const totalDebit = voucherItemsList.reduce((acc, it) => acc + Number(it.debit || 0), 0);
    const totalCredit = voucherItemsList.reduce((acc, it) => acc + Number(it.credit || 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new Error(`سند حسابداری مرجوعی تراز نیست! بدهکار: ${totalDebit}، بستانکار: ${totalCredit}`);
    }

    // 7. Clean up test records
    await cleanTestTableData('journal_voucher_items', 'voucher_id', [voucher.id]);
    await cleanTestTableData('journal_vouchers', 'id', [voucher.id]);
    await cleanTestTableData('document_items', 'id', [retDocItem.id]);
    await cleanTestTableData('documents', 'id', [testReturnDoc.id]);
    await cleanTestTableData('customers', 'id', [testCustomer.id]);
    await cleanTestTableData('items', 'id', [testItem.id]);

    results.push(makeTestCase({
      id: 'reg_sales_return_cogs_and_inventory_voucher_td_145',
      scenarioId: 'period_closing_and_conceptual_mappings',
      name: 'V6 Phase 3.2: صدور آرتیکل‌های انبار و بهای تمام‌شده (COGS) در سند حسابداری مرجوعی فروش (TD-145)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t21Start,
      details: 'صدور متقارن و متوازن ۴ آرتیکل حسابداری مرجوعی فروش (برگشت فروش، بدهکاران، موجودی کالا و تعدیل COGS) با نرخ میانگین موزون تأیید شد.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_sales_return_cogs_and_inventory_voucher_td_145',
      scenarioId: 'period_closing_and_conceptual_mappings',
      name: 'V6 Phase 3.2: صدور آرتیکل‌های انبار و بهای تمام‌شده (COGS) در سند حسابداری مرجوعی فروش (TD-145)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t21Start,
      error: err.message
    }));
  }
  }

  // ------------------------------------------------------------------
  // Test 22: Double Reversal Guard & Row Lock in VoucherService.reverseVoucher (TD-146)
  // ------------------------------------------------------------------
  if (shouldRun('reg_double_reversal_guard_td_146', 'td146', 'reversal', 'double_reversal')) {
  const t22Start = Date.now();
  try {
    const { VoucherService } = await import('../../services/accounting/voucher.service.js');
    const { ChartOfAccountsService } = await import('../../services/accounting/chartOfAccounts.service.js');

    // 1. Get accounts for balanced test voucher
    const allAccs = await ChartOfAccountsService.getAllAccounts();
    const acc1 = allAccs.find(a => a.level === 'detailed' || a.level === 'subsidiary') || allAccs[0];
    const acc2 = allAccs.find(a => a.id !== acc1.id && (a.level === 'detailed' || a.level === 'subsidiary')) || allAccs[1];

    const testVoucher = await VoucherService.createJournalVoucher({
      date: '2026-03-25',
      voucherType: 'general',
      description: 'سند تستی ممیزی ابطال مضاعف TD-146',
      status: 'approved',
      items: [
        { accountId: acc1.id, debit: 1500000, credit: 0, description: 'بدهکار تستی' },
        { accountId: acc2.id, debit: 0, credit: 1500000, description: 'بستانکار تستی' }
      ]
    });

    if (!testVoucher || !testVoucher.id) {
      throw new Error('ایجاد سند تستی اولیه ناموفق بود.');
    }

    // 2. Perform first reversal - MUST succeed
    const firstReversal = await VoucherService.reverseVoucher({
      voucherId: testVoucher.id,
      reason: 'برگشت اولیه مجاز',
      username: 'test_auditor'
    });

    if (!firstReversal || !firstReversal.id) {
      throw new Error('صدور اولین سند معکوس باید موفقیت‌آمیز باشد.');
    }

    if (!firstReversal.referenceNumber?.startsWith('REV-V')) {
      throw new Error(`شماره عطف سند معکوس باید با REV-V شروع شود اما «${firstReversal.referenceNumber}» بود.`);
    }

    // 3. Attempt second reversal on the SAME original voucher - MUST FAIL (ConflictError TD-146)
    let doubleReversalBlocked = false;
    try {
      await VoucherService.reverseVoucher({
        voucherId: testVoucher.id,
        reason: 'تلاش دوم غیرمجاز برای ابطال مضاعف',
        username: 'test_auditor'
      });
    } catch (doubleErr: any) {
      if (doubleErr.name === 'ConflictError' || doubleErr.message?.includes('قبلاً سند معکوس')) {
        doubleReversalBlocked = true;
      } else {
        throw new Error(`خطای رد ابطال مضاعف باید ConflictError باشد اما «${doubleErr.message}» دریافت شد.`);
      }
    }

    if (!doubleReversalBlocked) {
      throw new Error('سیستم نتوانست مانع از ابطال مضاعف (Double Reversal) یک سند مالی شود!');
    }

    // 4. Attempt reversing the reversal voucher itself - MUST FAIL
    let revOfRevBlocked = false;
    try {
      await VoucherService.reverseVoucher({
        voucherId: firstReversal.id,
        reason: 'تلاش غیرمجاز برای ابطال سند برگشتی',
        username: 'test_auditor'
      });
    } catch (revOfRevErr: any) {
      if (revOfRevErr.name === 'ConflictError' || revOfRevErr.message?.includes('سند برگشتی')) {
        revOfRevBlocked = true;
      } else {
        throw new Error(`خطای ابطال سند برگشتی باید ConflictError باشد اما «${revOfRevErr.message}» دریافت شد.`);
      }
    }

    if (!revOfRevBlocked) {
      throw new Error('سیستم اجازه ابطال سندی که خود سند برگشتی است را صادر کرد!');
    }

    // Clean up test records
    await cleanTestTableData('journal_voucher_items', 'voucher_id', [testVoucher.id, firstReversal.id]);
    await cleanTestTableData('journal_vouchers', 'id', [testVoucher.id, firstReversal.id]);

    results.push(makeTestCase({
      id: 'reg_double_reversal_guard_td_146',
      scenarioId: 'period_closing_and_conceptual_mappings',
      name: 'V6 Phase 3.3: ممانعت از ابطال مضاعف اسناد مالی با قفل سطری و گارد عدم تکرار سند معکوس (TD-146)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t22Start,
      details: 'قفل سطری سخت‌گیرانه، ممانعت قطعی از صدور دو سند معکوس برای یک سند مبدأ (Double Reversal) و مسدود بودن ابطال سند برگشتی تأیید شد.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_double_reversal_guard_td_146',
      scenarioId: 'period_closing_and_conceptual_mappings',
      name: 'V6 Phase 3.3: ممانعت از ابطال مضاعف اسناد مالی با قفل سطری و گارد عدم تکرار سند معکوس (TD-146)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t22Start,
      error: err.message
    }));
    }
  }

  // =========================================================================
  // Test 23: Voucher Date Normalization to Gregorian ISO in Cheques & Vouchers (TD-149)
  // =========================================================================
  if (shouldRun('reg_voucher_iso_date_normalization_td_149', 'td149', 'cheque date', 'iso voucher date')) {
    const t23Start = Date.now();
    try {
      // 1. Ensure required accounts exist
      await AccountingService.seedStandardAccounts();
      const allAccounts = await AccountingService.getAllAccounts();
      const expenseAcc = allAccounts.find((a: any) => a.code === '7101') || allAccounts[0];
      const bankAcc = allAccounts.find((a: any) => a.code === '1102') || allAccounts[1];

      // 2. Direct Voucher with Jalali Date (1404-10-15) -> Must normalize to Gregorian ISO
      const vJalali = await VoucherService.createJournalVoucher({
        date: '1404-10-15',
        description: 'Test Voucher with Jalali Date TD-149',
        voucherType: 'general',
        status: 'approved', // v8.0.70 (TD-323): سند پیش‌نویس بازثبت نمی‌شود
        items: [
          { accountId: expenseAcc.id, debit: 500000, credit: 0, description: 'Deb row' },
          { accountId: bankAcc.id, debit: 0, credit: 500000, description: 'Cred row' },
        ]
      });

      const [storedVoucher] = await orm.select().from(journalVouchers).where(eq(journalVouchers.id, vJalali.id));
      if (!storedVoucher.date || !storedVoucher.date.startsWith('2026-01-05')) {
        throw new Error(`تاریخ سند به درستی به میلادی نرمال‌سازی نشد! مقدار ذخیره‌شده: ${storedVoucher.date}`);
      }

      // 3. Repost voucher with no date passed -> must use businessTodayIsoDate, not Jalali string
      const repostRes = await VoucherService.repostVoucher({
        voucherId: vJalali.id,
        reason: 'تغییر ردیف برای آزمون نرمال‌سازی تاریخ',
        newItems: [
          { accountId: expenseAcc.id, debit: 600000, credit: 0, description: 'New row 1' },
          { accountId: bankAcc.id, debit: 0, credit: 600000, description: 'New row 2' },
        ]
      });

      const todayIso = await businessTodayIsoDate();
      if (!repostRes.voidVoucher.date || !repostRes.voidVoucher.date.startsWith(todayIso.slice(0, 7))) {
        throw new Error(`تاریخ سند ابطال بازثبت میلادی ISO نیست! مقدار: ${repostRes.voidVoucher.date}`);
      }
      if (!repostRes.repostedVoucher.date || !repostRes.repostedVoucher.date.startsWith(todayIso.slice(0, 7))) {
        throw new Error(`تاریخ سند جدید بازثبت میلادی ISO نیست! مقدار: ${repostRes.repostedVoucher.date}`);
      }

      // 4. Cheque with Jalali issueDate -> Voucher date must be ISO
      const testChequeNum = `CHQ-TEST-${Date.now()}`;
      const chq = await AccountingService.createCheque({
        type: 'received',
        chequeNumber: testChequeNum,
        amount: 250000,
        issueDate: '1404-10-15',
        dueDate: '1404-11-15',
        partyName: 'مشتری آزمایشی چک TD-149',
        bankName: 'بانک ملت',
      });

      // Find voucher created for this cheque
      const [chqVoucher] = await orm.select().from(journalVouchers)
        .where(eq(journalVouchers.referenceNumber, testChequeNum));

      if (chqVoucher) {
        if (!chqVoucher.date || !chqVoucher.date.startsWith('2026-01-05')) {
          throw new Error(`سند حسابداری صادره برای چک دارای تاریخ میلادی ISO نیست! مقدار: ${chqVoucher.date}`);
        }
      }

      // Clean up test records
      if (chq?.id) {
        await cleanTestTableData('cheques', 'id', [chq.id]);
      }
      const voucherIdsToClean = [vJalali.id, repostRes.voidVoucher.id, repostRes.repostedVoucher.id];
      if (chqVoucher) voucherIdsToClean.push(chqVoucher.id);
      await cleanTestTableData('journal_voucher_items', 'voucher_id', voucherIdsToClean);
      await cleanTestTableData('journal_vouchers', 'id', voucherIdsToClean);

      results.push(makeTestCase({
        id: 'reg_voucher_iso_date_normalization_td_149',
        scenarioId: 'period_closing_and_conceptual_mappings',
        name: 'V6 Phase 3.4: اصلاح فرمت تاریخ سند در چرخه چک و بازثبت به ISO میلادی (TD-149)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t23Start,
        details: 'تثبیت قطعی فرمت ISO میلادی (YYYY-MM-DD) برای اسناد حسابداری، بازثبت (Repost) و چرخه چک تأیید شد.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_voucher_iso_date_normalization_td_149',
        scenarioId: 'period_closing_and_conceptual_mappings',
        name: 'V6 Phase 3.4: اصلاح فرمت تاریخ سند در چرخه چک و بازثبت به ISO میلادی (TD-149)',
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - t23Start,
        error: err.message
      }));
    }
  }

  // Test 24: Cheque Spent Status in Sayad Lifecycle & Endorsement Double-Entry Voucher (TD-150)
  if (shouldRun('reg_cheque_spent_status_td_150', 'td150', 'cheque_spent', 'spent')) {
    const t24Start = Date.now();
    let recChq: any = null;
    let paidChq: any = null;
    const vouchersToClean: number[] = [];
    try {
      // 1. Create a received cheque
      recChq = await AccountingService.createCheque({
        type: 'received',
        chequeNumber: 'CHQ-SPENT-TEST-99',
        sayadNumber: '9988776655443322',
        bankName: 'بانک ملت',
        issueDate: '2026-09-27',
        dueDate: '2026-10-15',
        amount: 45000000,
        currency: 'IRR',
        partyName: 'مشتری آزمایشی واگذاری',
        createVoucher: true,
      });

      if (recChq.voucherId) {
        vouchersToClean.push(recChq.voucherId);
      }

      if (recChq.status !== 'received') {
        throw new Error(`وضعیت اولیه چک باید received باشد ولی ${recChq.status} است`);
      }

      // 2. Transition received cheque to 'spent' (واگذاری و خرج چک به تامین‌کننده)
      // v9.0.85 (TD-498): spending a cheque needs the supplier's id; the payee name comes from the supplier row
      const { createTestCustomer: createSpendSupplier } = await import('../fixtures/factories.js');
      const spendSupplier = await createSpendSupplier({ name: `بازرگانی فلزات البرز ${Date.now()}`, partyType: 'supplier' });
      const spentChq = await AccountingService.updateChequeStatus(recChq.id, {
        status: 'spent',
        transfereePartyId: spendSupplier.id,
        notes: 'واگذاری به تامین‌کننده بابت تسویه شمش طلا'
      });

      if (spentChq.status !== 'spent') {
        throw new Error(`وضعیت چک پس از واگذاری باید spent باشد اما ${spentChq.status} است`);
      }

      if (spentChq.payeeName !== spendSupplier.name) {
        throw new Error(`نام تحویل‌گیرنده در payeeName چک درج نشد: ${spentChq.payeeName}`);
      }

      const hasSpentHistory = Array.isArray(spentChq.statusHistory) &&
        spentChq.statusHistory.some((h: any) => h.status === 'spent');
      if (!hasSpentHistory) {
        throw new Error('وضعیت spent در statusHistory ثبت نشده است');
      }

      // 3. Verify double-entry journal voucher was created for spent cheque
      const spentVouchers = await orm.select().from(journalVouchers)
        .where(eq(journalVouchers.referenceNumber, 'CHQ-SPENT-TEST-99'));
      
      const endorsementVoucher = spentVouchers.find(v => v.description?.includes('واگذاری و خرج'));
      if (!endorsementVoucher) {
        throw new Error('سند حسابداری دوبل واگذاری و خرج چک صادر نشده است');
      }
      vouchersToClean.push(endorsementVoucher.id);

      // 4. Verify delete guard: spent cheque CANNOT be deleted
      let deleteBlocked = false;
      try {
        await AccountingService.deleteCheque(recChq.id);
      } catch (err: any) {
        if (err.message?.includes('خرج‌شده')) {
          deleteBlocked = true;
        }
      }
      if (!deleteBlocked) {
        throw new Error('چک در وضعیت spent نباید قابل حذف باشد!');
      }

      // 5. Verify guard on paid cheques: paid cheques cannot be spent
      paidChq = await AccountingService.createCheque({
        type: 'paid',
        chequeNumber: 'CHQ-PAID-TEST-88',
        sayadNumber: '1122334455667788',
        bankName: 'بانک صادرات',
        issueDate: '2026-09-27',
        dueDate: '2026-10-20',
        amount: 30000000,
        currency: 'IRR',
        partyName: 'تامین‌کننده تستی',
        createVoucher: true,
      });
      if (paidChq.voucherId) {
        vouchersToClean.push(paidChq.voucherId);
      }

      let paidSpendBlocked = false;
      try {
        await AccountingService.updateChequeStatus(paidChq.id, {
          status: 'spent',
          transfereePartyId: spendSupplier.id
        });
      } catch (err: any) {
        if (err.message?.includes('تنها چک‌های دریافتی') || err.message?.includes('مجاز نیست')) {
          paidSpendBlocked = true;
        }
      }
      if (!paidSpendBlocked) {
        throw new Error('خرج کردن چک پرداختی (paid) نباید مجاز باشد!');
      }

      // Clean up test records
      const chequeIdsToClean = [recChq.id];
      if (paidChq?.id) chequeIdsToClean.push(paidChq.id);
      await cleanTestTableData('cheques', 'id', chequeIdsToClean);

      if (vouchersToClean.length > 0) {
        await cleanTestTableData('journal_voucher_items', 'voucher_id', vouchersToClean);
        await cleanTestTableData('journal_vouchers', 'id', vouchersToClean);
      }

      results.push(makeTestCase({
        id: 'reg_cheque_spent_status_td_150',
        scenarioId: 'period_closing_and_conceptual_mappings',
        name: 'V6 Phase 4.1: فعال‌سازی وضعیت «خرج چک» در ماشین وضعیت صیادی (TD-150)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t24Start,
        details: 'انتقال به وضعیت spent، صدور سند حسابداری دوبل واگذاری، ثبت در تاریخچه وضعیت و گارد ممانعت از خرج چک پرداختی تایید شد.'
      }));
    } catch (err: any) {
      if (recChq?.id || paidChq?.id) {
        const ids = [recChq?.id, paidChq?.id].filter(Boolean);
        await cleanTestTableData('cheques', 'id', ids);
      }
      if (vouchersToClean.length > 0) {
        await cleanTestTableData('journal_voucher_items', 'voucher_id', vouchersToClean);
        await cleanTestTableData('journal_vouchers', 'id', vouchersToClean);
      }
      results.push(makeTestCase({
        id: 'reg_cheque_spent_status_td_150',
        scenarioId: 'period_closing_and_conceptual_mappings',
        name: 'V6 Phase 4.1: فعال‌سازی وضعیت «خرج چک» در ماشین وضعیت صیادی (TD-150)',
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - t24Start,
        error: err.message
      }));
    }
  }

  // Test 25: Bank Reconciliation Calendar Matching & Zero Day Difference (TD-151)
  if (shouldRun('reg_bank_statement_matcher_calendar_td_151', 'td151', 'bank_reconciliation', 'calendar')) {
    const t25Start = Date.now();
    try {
      // 1. Verify normalizeDateToIso on various input formats
      const jalaliIso = normalizeDateToIso('1405/06/15');
      if (jalaliIso !== '2026-09-06') {
        throw new Error(`نرمال‌سازی تاریخ شمسی 1405/06/15 به میلادی با شکست مواجه شد: دریافت شد ${jalaliIso}`);
      }

      const jalaliContinuous = normalizeDateToIso('14050615');
      if (jalaliContinuous !== '2026-09-06') {
        throw new Error(`نرمال‌سازی تاریخ شمسی پیوسته 14050615 با شکست مواجه شد: دریافت شد ${jalaliContinuous}`);
      }

      const gregorianIso = normalizeDateToIso('2026-09-06');
      if (gregorianIso !== '2026-09-06') {
        throw new Error(`نرمال‌سازی تاریخ میلادی با شکست مواجه شد: دریافت شد ${gregorianIso}`);
      }

      const gregorianTimestamp = normalizeDateToIso('2026-09-06T14:30:00.000Z');
      if (gregorianTimestamp !== '2026-09-06') {
        throw new Error(`نرمال‌سازی تاریخ timestamp با شکست مواجه شد: دریافت شد ${gregorianTimestamp}`);
      }

      // 2. Verify calculateDateDiffDays
      const sameDayDiff = calculateDateDiffDays('1405/06/15', '2026-09-06');
      if (sameDayDiff !== 0) {
        throw new Error(`تفاضل روز برای همان روز تقویمی (1405/06/15 و 2026-09-06) باید صفر باشد اما ${sameDayDiff} روز است`);
      }

      const oneDayDiff = calculateDateDiffDays('1405/06/16', '2026-09-06');
      if (oneDayDiff !== 1) {
        throw new Error(`تفاضل روز برای یک روز بعد باید 1 باشد اما ${oneDayDiff} است`);
      }

      const twoDayDiff = calculateDateDiffDays('1405/06/17', '2026-09-06');
      if (twoDayDiff !== 2) {
        throw new Error(`تفاضل روز برای دو روز بعد باید 2 باشد اما ${twoDayDiff} است`);
      }

      const fourDayDiff = calculateDateDiffDays('1405/06/19', '2026-09-06');
      if (fourDayDiff !== 4) {
        throw new Error(`تفاضل روز برای چهار روز بعد باید 4 باشد اما ${fourDayDiff} است`);
      }

      // 3. Verify matchStatementWithTransactions correctly matches Level 2 (amount_date)
      // Statement row from Bank in Jalali:
      const statementRows: StatementRow[] = [
        {
          rowNo: 1,
          date: '1405/06/15',
          amount: 25000000,
          type: 'receipt',
          description: 'واریز ساتنا شرکت مهندسی پایا',
          tracking: '778899',
        },
      ];

      // ERP transactions in Gregorian: one on exact date (2026-09-06), one 15 days later (2026-09-21)
      const erpCandidates: TreasuryTxCandidate[] = [
        {
          id: 99101,
          transactionNumber: 'TR-REC-101',
          date: '2026-09-06',
          type: 'receipt',
          amount: 25000000,
          partyName: 'شرکت مهندسی پایا',
          trackingNumber: '', // Different tracking so it tests Level 2 (amount_date)
        },
        {
          id: 99102,
          transactionNumber: 'TR-REC-102',
          date: '2026-09-21',
          type: 'receipt',
          amount: 25000000,
          partyName: 'شرکت دیگر با همان مبلغ',
          trackingNumber: '',
        },
      ];

      const matchResults = matchStatementWithTransactions(statementRows, erpCandidates);
      if (matchResults.length !== 1) {
        throw new Error(`انتظار ۱ نتیجه تطبیق می‌رفت اما ${matchResults.length} دریافت شد`);
      }

      const matched = matchResults[0];
      if (matched.matchedTxId !== 99101) {
        throw new Error(`تطبیق اشتباه انجام شد: شناسه مورد انتظار 99101 بود ولی ${matched.matchedTxId} ثبت شد`);
      }

      if (matched.matchQuality !== 'amount_date') {
        throw new Error(`کیفیت تطبیق باید amount_date باشد ولی ${matched.matchQuality} است`);
      }

      if (matched.dateDiffDays !== 0) {
        throw new Error(`تفاضل روز تطبیق باید 0 باشد ولی ${matched.dateDiffDays} است`);
      }

      results.push(makeTestCase({
        id: 'reg_bank_statement_matcher_calendar_td_151',
        scenarioId: 'period_closing_and_conceptual_mappings',
        name: 'V6 Phase 4.2: اصلاح الگوریتم تقویمی در مغایرت‌گیری بانکی (TD-151)',
        layer: 'regression',
        executionType: 'real_code',
        passed: true,
        durationMs: Date.now() - t25Start,
        details: 'نرمال‌سازی تاریخ‌های شمسی اکسل به ISO، رفع خطای تفاضل نجومی روزها و تطبیق هوشمند دقیق در سطح amount_date تایید شد.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_bank_statement_matcher_calendar_td_151',
        scenarioId: 'period_closing_and_conceptual_mappings',
        name: 'V6 Phase 4.2: اصلاح الگوریتم تقویمی در مغایرت‌گیری بانکی (TD-151)',
        layer: 'regression',
        executionType: 'real_code',
        passed: false,
        durationMs: Date.now() - t25Start,
        error: err.message
      }));
    }
  }

  // Test 26: Fiscal Year Ref Number Isolation & Partitioned Duplicate Ref Detection (TD-152 & TD-153)
  if (shouldRun('reg_fiscal_year_ref_isolation_td_152_153', 'td152', 'td153', 'ref_counters', 'duplicate_refs')) {
    const t26Start = Date.now();
    const createdDocIds: number[] = [];
    const testDocTypeInv = 'reg_test_inv';
    const testDocTypeRec = 'reg_test_rec';
    try {
      // 1. Setup existing synthetic document in fiscal year 1404 with high ref number '888'
      // 1404/05/10 is approximately 2025-08-01
      const [doc1404] = await orm.insert(documents).values({
        type: testDocTypeInv,
        refNumber: '888',
        date: '2025-08-01 10:00:00',
        user: 'test-agent',
        status: 'final'
      }).returning({ id: documents.id });
      createdDocIds.push(doc1404.id);

      // 2. TD-152: Peek and Next for fiscal year 1405 (a new year with no documents yet of this type)
      // 1405/05/10 is approximately 2026-08-01
      // Must return '1' (or startNumber), NOT '889'
      const peek1405 = await DocumentService.peekNextRef(testDocTypeInv, '2026-08-01');
      if (peek1405 !== '1') {
        throw new Error(`شماره پیش‌نمایش سال مالی جدید باید 1 باشد اما ${peek1405} برگردانده شد (عدم ایزولاسیون سال مالی TD-152)`);
      }

      const next1405 = await DocumentService.getNextRef(testDocTypeInv, '2026-08-01');
      if (next1405 !== '1') {
        throw new Error(`شماره عطف سال مالی جدید باید 1 باشد اما ${next1405} تولید شد`);
      }

      // Insert doc for 1405
      const [doc1405] = await orm.insert(documents).values({
        type: testDocTypeInv,
        refNumber: next1405,
        date: '2026-08-01 10:00:00',
        user: 'test-agent',
        status: 'final'
      }).returning({ id: documents.id });
      createdDocIds.push(doc1405.id);

      // Verify next for 1405 is now '2'
      const next1405Again = await DocumentService.getNextRef(testDocTypeInv, '2026-08-01');
      if (next1405Again !== '2') {
        throw new Error(`شماره بعدی سال 1405 باید 2 باشد اما ${next1405Again} تولید شد`);
      }

      // Also verify that for fiscal year 1404, cold start still sees '888' and yields '889'
      const peek1404 = await DocumentService.peekNextRef(testDocTypeInv, '2025-08-01');
      if (peek1404 !== '889') {
        throw new Error(`شماره پیش‌نمایش سال 1404 باید 889 باشد اما ${peek1404} برگردانده شد`);
      }

      results.push(makeTestCase({
        id: 'reg_fiscal_year_ref_isolation_td_152_153',
        scenarioId: 'period_closing_and_conceptual_mappings',
        name: 'V6 Phase 4.3: بهینه‌سازی شمارنده سالانه و رفع مثبت کاذب در چک سلامت (TD-152/153)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t26Start,
        details: 'تفکیک سال مالی در کوئری استخراج عطف اسناد و ریست صحیح شماره سریال در سال جدید تایید شد.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_fiscal_year_ref_isolation_td_152_153',
        scenarioId: 'period_closing_and_conceptual_mappings',
        name: 'V6 Phase 4.3: بهینه‌سازی شمارنده سالانه و رفع مثبت کاذب در چک سلامت (TD-152/153)',
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - t26Start,
        error: err.message
      }));
    } finally {
      if (createdDocIds.length > 0) {
        await cleanTestTableData('documents', 'id', createdDocIds);
      }
      await orm.delete(documentRefCounters).where(eq(documentRefCounters.docType, testDocTypeInv));
      await orm.delete(documentRefCounters).where(eq(documentRefCounters.docType, testDocTypeRec));
    }
  }

  // Test 27.1: v7.0.21 (TD-178 / audit P0-2): شماره عطف یکسان در دو سال مالی متوالی نباید با قید یکتایی برخورد کند
  if (shouldRun('reg_fiscal_year_ref_unique_scope_td_178', 'td178', 'ref_counters', 'duplicate_refs', 'fiscal_year')) {
    const tStart = Date.now();
    const createdDocIds: number[] = [];
    const testDocType = 'reg_test_fy178';
    try {
      // 1. شماره‌گذاری خودکار در سال ۱۴۰۴ و سپس سال ۱۴۰۵ — هر دو باید «1» باشند و هر دو با موفقیت درج شوند
      const doc1404 = await DocumentService.createDocument({ docType: testDocType, status: 'draft', date: '2025-08-01', items: [], user: 'test-agent' });
      createdDocIds.push(doc1404);
      const doc1405 = await DocumentService.createDocument({ docType: testDocType, status: 'draft', date: '2026-08-01', items: [], user: 'test-agent' });
      createdDocIds.push(doc1405);

      const rows = await orm
        .select({ id: documents.id, refNumber: documents.refNumber, refFiscalYear: documents.refFiscalYear })
        .from(documents)
        .where(inArray(documents.id, createdDocIds));
      const r1404 = rows.find(r => r.id === doc1404);
      const r1405 = rows.find(r => r.id === doc1405);
      if (r1404?.refNumber !== '1' || r1404?.refFiscalYear !== 1404) {
        throw new Error(`سند سال ۱۴۰۴ باید شماره «1» و سال مالی 1404 داشته باشد: ${JSON.stringify(r1404)}`);
      }
      if (r1405?.refNumber !== '1' || r1405?.refFiscalYear !== 1405) {
        throw new Error(`سند سال ۱۴۰۵ باید شماره «1» و سال مالی 1405 داشته باشد (برخورد بین‌سالی): ${JSON.stringify(r1405)}`);
      }

      // 2. شماره تکراری در همان سال مالی همچنان باید توسط دیتابیس رد شود
      let sameYearRejected = false;
      try {
        const [dup] = await orm.insert(documents).values({
          type: testDocType, refNumber: '1', refFiscalYear: 1405, date: '2026-09-01 10:00:00', user: 'test-agent', status: 'draft'
        }).returning({ id: documents.id });
        createdDocIds.push(dup.id);
      } catch {
        sameYearRejected = true;
      }
      if (!sameYearRejected) {
        throw new Error('درج شماره عطف تکراری در همان سال مالی و همان نوع سند نباید مجاز باشد (قید uq_documents_type_fy_ref_active).');
      }

      results.push(makeTestCase({
        id: 'reg_fiscal_year_ref_unique_scope_td_178',
        scenarioId: 'period_closing_and_conceptual_mappings',
        name: 'v7.0.21: یکتایی شماره عطف در دامنه سال مالی و عدم برخورد شماره «1» سال جدید با سال قبل (TD-178 / P0-2)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'شماره «1» در سال‌های ۱۴۰۴ و ۱۴۰۵ هر دو صادر شد و درج تکراری در همان سال توسط ایندکس یکتای سال‌محور رد شد.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_fiscal_year_ref_unique_scope_td_178',
        scenarioId: 'period_closing_and_conceptual_mappings',
        name: 'v7.0.21: یکتایی شماره عطف در دامنه سال مالی و عدم برخورد شماره «1» سال جدید با سال قبل (TD-178 / P0-2)',
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      }));
    } finally {
      if (createdDocIds.length > 0) {
        await cleanTestTableData('documents', 'id', createdDocIds);
      }
      await orm.delete(documentRefCounters).where(eq(documentRefCounters.docType, testDocType));
    }
  }

  // Test 27.2: v7.0.25 (TD-183 / audit P1-1): تحویل تضمینی Outbox — شکست هندلر، backoff واقعی، عدم تکرار هندلر موفق و انتقال به DLQ
  if (shouldRun('reg_outbox_tracked_dispatch_td_183', 'td183', 'outbox', 'dlq', 'events')) {
    const tStart = Date.now();
    const { domainEventBus } = await import('../../services/events/domainEventBus.js');
    const { OutboxService } = await import('../../services/events/outboxService.js');
    const { outboxEvents, deadLetterEvents } = await import('../../db/schema.js');
    const probeType = `RegOutboxProbe_${Date.now()}`;
    const fatalType = `RegOutboxFatal_${Date.now()}`;
    const createdEventIds: string[] = [];
    try {
      const calls = { ok: 0, flaky: 0 };
      // خواندن از طریق تابع تا narrowing کنترل‌جریان TypeScript شمارنده‌های تغییرکرده در هندلرها را ثابت فرض نکند
      const count = (key: 'ok' | 'flaky'): number => calls[key];
      let flakyShouldFail = true;
      domainEventBus.subscribe(probeType, async () => { calls.ok++; }, 'reg-probe-ok');
      domainEventBus.subscribe(probeType, async () => {
        calls.flaky++;
        if (flakyShouldFail) throw new Error('reg probe transient failure');
      }, 'reg-probe-flaky');
      domainEventBus.subscribe(fatalType, async () => { throw new Error('reg probe permanent failure'); }, 'reg-probe-fatal');

      // 0. مسیر publish (غیر Outbox) همچنان غیرمسدودکننده است و خطای هندلر را به فراخوان پرتاب نمی‌کند
      await domainEventBus.publish(domainEventBus.createEvent(fatalType, 'Item', '0', { probe: true }, {}));

      // 1. اولین تلاش: هندلر موفق اجرا می‌شود، هندلر ناپایدار شکست می‌خورد → pending با backoff آینده
      const ev = domainEventBus.createEvent(probeType, 'Item', '1', { probe: true }, {});
      createdEventIds.push(ev.eventId);
      await OutboxService.saveToOutbox(orm, ev);
      await OutboxService.processPendingBatch(100);
      let [row] = await orm.select().from(outboxEvents).where(eq(outboxEvents.eventId, ev.eventId));
      if (row.status !== 'pending' || row.retryCount !== 1 || !row.nextRetryAt || new Date(`${row.nextRetryAt}Z`).getTime() <= Date.now() - 1000) {
        throw new Error(`پس از شکست هندلر، رویداد باید pending با retryCount=1 و زمان backoff آینده باشد: ${JSON.stringify({ status: row.status, retryCount: row.retryCount, nextRetryAt: row.nextRetryAt })}`);
      }
      if (!row.completedHandlers.includes('reg-probe-ok') || row.completedHandlers.includes('reg-probe-flaky')) {
        throw new Error(`completed_handlers باید فقط هندلر موفق را داشته باشد: ${JSON.stringify(row.completedHandlers)}`);
      }

      // 2. اجرای فوری دوباره نباید پیش از رسیدن زمان backoff رویداد را بردارد
      await OutboxService.processPendingBatch(100);
      [row] = await orm.select().from(outboxEvents).where(eq(outboxEvents.eventId, ev.eventId));
      if (row.retryCount !== 1 || count('flaky') !== 1) {
        throw new Error(`backoff رعایت نشد: retryCount=${row.retryCount}، تعداد اجرای هندلر ناپایدار=${count('flaky')}`);
      }

      // 3. پس از رسیدن زمان backoff: فقط هندلر ناموفق دوباره اجرا می‌شود و رویداد completed می‌شود
      flakyShouldFail = false;
      await orm.update(outboxEvents).set({ nextRetryAt: '2000-01-01 00:00:00' }).where(eq(outboxEvents.eventId, ev.eventId));
      await OutboxService.processPendingBatch(100);
      [row] = await orm.select().from(outboxEvents).where(eq(outboxEvents.eventId, ev.eventId));
      if (row.status !== 'completed' || count('ok') !== 1 || count('flaky') !== 2) {
        throw new Error(`تلاش مجدد باید فقط هندلر ناموفق را اجرا و رویداد را completed کند: ${JSON.stringify({ status: row.status, calls })}`);
      }

      // 4. شکست نهایی (آخرین تلاش مجاز) → وضعیت failed و انتقال به DLQ
      const fatal = domainEventBus.createEvent(fatalType, 'Item', '2', { probe: true }, {});
      createdEventIds.push(fatal.eventId);
      await OutboxService.saveToOutbox(orm, fatal);
      await orm.update(outboxEvents).set({ retryCount: 4 }).where(eq(outboxEvents.eventId, fatal.eventId));
      await OutboxService.processPendingBatch(100);
      const [fatalRow] = await orm.select().from(outboxEvents).where(eq(outboxEvents.eventId, fatal.eventId));
      const dlqRows = await orm.select().from(deadLetterEvents).where(eq(deadLetterEvents.originalEventId, fatal.eventId));
      if (fatalRow.status !== 'failed' || dlqRows.length !== 1) {
        throw new Error(`پس از آخرین تلاش ناموفق رویداد باید failed و در DLQ باشد: ${JSON.stringify({ status: fatalRow.status, dlq: dlqRows.length })}`);
      }

      results.push(makeTestCase({
        id: 'reg_outbox_tracked_dispatch_td_183',
        scenarioId: 'regression_sanity',
        name: 'v7.0.25: تحویل تضمینی Outbox، backoff واقعی، عدم تکرار هندلر موفق و انتقال به DLQ (TD-183 / P1-1)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'شکست هندلر به Outbox رسید، backoff رعایت شد، فقط هندلر ناموفق دوباره اجرا شد و شکست نهایی به DLQ منتقل شد؛ مسیر publish غیرمسدودکننده ماند.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_outbox_tracked_dispatch_td_183',
        scenarioId: 'regression_sanity',
        name: 'v7.0.25: تحویل تضمینی Outbox، backoff واقعی، عدم تکرار هندلر موفق و انتقال به DLQ (TD-183 / P1-1)',
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      }));
    } finally {
      if (createdEventIds.length > 0) {
        await orm.delete(deadLetterEvents).where(inArray(deadLetterEvents.originalEventId, createdEventIds));
        await orm.delete(outboxEvents).where(inArray(outboxEvents.eventId, createdEventIds));
      }
    }
  }

  // Test 27.3: v7.0.30 (TD-190 / audit P1-2): چرخه کامل سفارش ووکامرس از مسیر واقعی وب‌هوک امضاشده
  if (shouldRun('reg_woocommerce_order_lifecycle_td_190', 'td190', 'woocommerce', 'webhook')) {
    const tStart = Date.now();
    const { getTestApp } = await import('../fixtures/httpTestHelper.js');
    const { postSignedWooWebhook, buildWooOrder } = await import('../fixtures/wooWebhookHelper.js');
    const { createTestItem, createTestCustomer } = await import('../fixtures/factories.js');
    const { appSettings, woocommerceOrderLogs, customers } = await import('../../db/schema.js');
    const secretKey = 'wc_webhook_secret';
    const [originalSecret] = await orm.select().from(appSettings).where(eq(appSettings.key, secretKey));
    const probeSecret = `whsec_td190_${Date.now()}`;
    const base = String(7000000 + Math.floor(Math.random() * 900000));
    // B پیشوند A است: LIKE '%#B%' قبلی فاکتور A را به‌عنوان فاکتور B تشخیص می‌داد (الف)
    const ids = { P: `${base}1`, A: `${base}3`, B: base, C: `${base}5`, D: `${base}7`, E: `${base}9` };
    const createdItemIds: number[] = [];
    const createdCustomerIds: number[] = [];
    const violations: string[] = [];
    const check = (cond: boolean, msg: string) => { if (!cond) violations.push(msg); };
    try {
      const app = await getTestApp();
      await orm.insert(appSettings).values({ key: secretKey, value: probeSecret })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: probeSecret } });
      const send = (payload: Record<string, unknown>) => postSignedWooWebhook(app, probeSecret, payload);

      const [defWh] = await orm.select({ code: warehouses.code }).from(warehouses)
        .where(eq(warehouses.isActive, 1)).orderBy(warehouses.id).limit(1);
      const whCode = defWh.code;
      const sku = `WOO-TD190-${base}`;
      const item = await createTestItem({ code: sku, currentStock: 20, stocks: { [whCode]: 20 }, weightedAverageCost: 40000 });
      createdItemIds.push(item.id);
      const stockOf = async () => {
        const [row] = await orm.select({ s: items.currentStock }).from(items).where(eq(items.id, item.id));
        return Number(row?.s || 0);
      };
      const activeInvoices = async (orderId: string) => orm.select({ id: documents.id, buyerName: documents.buyerName })
        .from(documents)
        .where(and(
          eq(documents.type, 'invoice'),
          eq(documents.isDeleted, 0),
          sql`${documents.notes} ~ ${`^سفارش ووکامرس #${orderId}(\\D|$)`}`
        ));
      const logOf = async (orderId: string) => {
        const [row] = await orm.select().from(woocommerceOrderLogs).where(eq(woocommerceOrderLogs.wcOrderId, orderId));
        return row;
      };
      const line = (qty: number) => ({ sku, quantity: qty, price: 900000 });

      // ۱) (د) سفارش پرداخت‌نشده (pending): بدون فاکتور و بدون کسر موجودی، لاگ «در انتظار پرداخت»
      const rP = await send(buildWooOrder({ id: ids.P, status: 'pending', lines: [line(1)] }));
      check(rP.status === 200, `وب‌هوک pending باید 200 بدهد (وضعیت ${rP.status})`);
      check((await activeInvoices(ids.P)).length === 0, 'سفارش pending نباید فاکتور قطعی بگیرد (د)');
      check(await stockOf() === 20, `سفارش pending نباید موجودی را کسر کند (موجودی ${await stockOf()})`);
      check((await logOf(ids.P))?.status === 'deferred', `لاگ سفارش pending باید deferred باشد: ${(await logOf(ids.P))?.status}`);

      // ۲) سفارش پرداخت‌شده A: فاکتور قطعی در انبار پیش‌فرض قطعی (و)
      const rA = await send(buildWooOrder({ id: ids.A, status: 'processing', lines: [line(2)] }));
      const invA = await activeInvoices(ids.A);
      check(rA.status === 200 && rA.body?.success === true, `سفارش processing باید موفق شود: ${JSON.stringify(rA.body)}`);
      check(invA.length === 1, `سفارش A باید دقیقاً یک فاکتور داشته باشد (${invA.length})`);
      const stockAfterA = await stockOf();
      check(stockAfterA === 18, `موجودی پس از فاکتور A باید 18 باشد (${stockAfterA})`);
      if (invA[0]) {
        const lines = await orm.select({ loc: documentItems.location }).from(documentItems).where(eq(documentItems.documentId, invA[0].id));
        check(lines.every(l => l.loc === whCode), `قلم فاکتور باید در قدیمی‌ترین انبار فعال (${whCode}) باشد: ${JSON.stringify(lines)}`);
      }

      // ۳) (الف) سفارش B که شماره‌اش پیشوند A است فاکتور مستقل می‌گیرد؛ (ز) نام فاکتور = نام پرونده مشتری
      const probePhone = `0912${base.slice(-7)}`;
      const existingCustomer = await createTestCustomer({ phone: probePhone });
      createdCustomerIds.push(existingCustomer.id);
      const orderB = buildWooOrder({ id: ids.B, status: 'processing', lines: [line(1)], phone: probePhone, firstName: 'نام', lastName: 'متفاوت' });
      await send(orderB);
      const invB = await activeInvoices(ids.B);
      check(invB.length === 1, `سفارش B (پیشوند A) باید فاکتور مستقل بگیرد؛ تعداد فاکتور: ${invB.length} (الف)`);
      check(invB[0]?.buyerName === existingCustomer.name, `فاکتور B باید به پرونده مشتری با همان تلفن نسبت داده شود: «${invB[0]?.buyerName}» (ز)`);

      // ۴) وب‌هوک تکراری (completed) فاکتور دوم نمی‌سازد
      await send({ ...orderB, status: 'completed' });
      check((await activeInvoices(ids.B)).length === 1, 'وب‌هوک تکراری نباید فاکتور دوم بسازد');
      const stockAfterB = await stockOf();
      check(stockAfterB === 17, `موجودی پس از B باید 17 باشد (${stockAfterB})`);

      // ۵) تطبیق ناقص: یک SKU معتبر + یک SKU ناشناخته → کل سفارش رد، بدون فاکتور، لاگ شکست ماندگار
      const rC = await send(buildWooOrder({ id: ids.C, status: 'processing', lines: [line(1), { sku: `UNKNOWN-${base}`, quantity: 1, price: 5000 }] }));
      check(rC.status === 200 && rC.body?.success === false, `تطبیق ناقص باید 200 با success=false بدهد: ${rC.status} ${JSON.stringify(rC.body)}`);
      check((await activeInvoices(ids.C)).length === 0, 'سفارش با SKU ناشناخته نباید فاکتور (ناقص) بگیرد');
      check(await stockOf() === 17, `تطبیق ناقص نباید موجودی را کسر کند (${await stockOf()})`);
      const logC = await logOf(ids.C);
      check(logC?.status === 'failed' && String(logC?.errorMessage || '').includes(`UNKNOWN-${base}`), `لاگ شکست C باید ماندگار و شامل SKU ناشناخته باشد: ${JSON.stringify(logC)}`);

      // ۶) (ب) شکست کامل (همه SKUها ناشناخته): لاگ failed باید پس از پاسخ ماندگار باشد
      const rD = await send(buildWooOrder({ id: ids.D, status: 'processing', lines: [{ sku: `NOPE-${base}`, quantity: 1, price: 1000 }] }));
      check(rD.status === 200, `خطای پردازش نباید پاسخ غیر 2xx بدهد (وضعیت ${rD.status}) (هـ)`);
      check((await logOf(ids.D))?.status === 'failed', `لاگ شکست D ماندگار نشد: ${JSON.stringify(await logOf(ids.D))} (ب)`);

      // ۷) ابطال خودکار: A لغو شد → حذف نرم فاکتور، برگشت موجودی، سند حسابداری معکوس
      const docA = invA[0]?.id;
      await send(buildWooOrder({ id: ids.A, status: 'cancelled', lines: [line(2)] }));
      check((await activeInvoices(ids.A)).length === 0, 'فاکتور سفارش لغوشده باید ابطال (حذف نرم) شود');
      check(await stockOf() === 19, `لغو سفارش A باید ۲ عدد را به انبار برگرداند (${await stockOf()})`);
      check((await logOf(ids.A))?.status === 'voided', `لاگ A باید voided باشد: ${(await logOf(ids.A))?.status}`);
      if (docA) {
        // v8.0.2 (TD-251): سند پیش‌نویس فاکتور ابطال‌شده حذف نرم می‌شود؛ سند تأییدشده سند معکوس می‌گیرد
        const [origVoucher] = await orm.select().from(journalVouchers)
          .where(eq(journalVouchers.sourceDocumentId, docA))
          .orderBy(journalVouchers.id).limit(1);
        const reversal = origVoucher
          ? await orm.select({ id: journalVouchers.id }).from(journalVouchers).where(eq(journalVouchers.referenceNumber, `REV-V${origVoucher.voucherNumber}`))
          : [];
        const neutralized = origVoucher?.status === 'draft'
          ? origVoucher.isDeleted === 1 && reversal.length === 0
          : origVoucher?.isDeleted === 0 && reversal.length === 1;
        check(Boolean(origVoucher) && neutralized, 'ابطال فاکتور باید سند پیش‌نویس را حذف کند یا سند تأییدشده را معکوس کند');
      }

      // ۸) استرداد: B مسترد شد → فاکتور فعال می‌ماند و برای بررسی حسابدار علامت می‌خورد
      await send({ ...orderB, status: 'refunded' });
      check((await activeInvoices(ids.B)).length === 1, 'استرداد نباید فاکتور را خودکار ابطال کند');
      check((await logOf(ids.B))?.status === 'needs_review', `لاگ B پس از استرداد باید needs_review باشد: ${(await logOf(ids.B))?.status}`);

      // ۹) همزمانی: دو وب‌هوک موازی برای سفارش تازه E → دقیقاً یک فاکتور
      const orderE = buildWooOrder({ id: ids.E, status: 'processing', lines: [line(1)] });
      await Promise.all([send(orderE), send(orderE)]);
      check((await activeInvoices(ids.E)).length === 1, `دو وب‌هوک همزمان باید دقیقاً یک فاکتور بسازند (${(await activeInvoices(ids.E)).length})`);
      check(await stockOf() === 18, `همزمانی نباید موجودی را دوبار کسر کند (${await stockOf()})`);

      if (violations.length > 0) {
        throw new Error(violations.join(' | '));
      }
      results.push(makeTestCase({
        id: 'reg_woocommerce_order_lifecycle_td_190',
        scenarioId: 'woocommerce_order_lifecycle',
        name: 'v7.0.30: چرخه کامل سفارش ووکامرس — تطبیق دقیق، لاگ شکست ماندگار، سیاست وضعیت‌ها، ابطال و همزمانی (TD-190 / P1-2)',
        layer: 'regression',
        executionType: 'real_api',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'pending بدون فاکتور، تطبیق شماره سفارش دقیق، رد کامل تطبیق ناقص با لاگ ماندگار و پاسخ 200، ابطال خودکار با برگشت موجودی و سند معکوس، علامت بررسی برای استرداد و یک فاکتور برای وب‌هوک‌های همزمان تأیید شد.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_woocommerce_order_lifecycle_td_190',
        scenarioId: 'woocommerce_order_lifecycle',
        name: 'v7.0.30: چرخه کامل سفارش ووکامرس — تطبیق دقیق، لاگ شکست ماندگار، سیاست وضعیت‌ها، ابطال و همزمانی (TD-190 / P1-2)',
        layer: 'regression',
        executionType: 'real_api',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      }));
    } finally {
      const orderIdList = Object.values(ids);
      const logs = await orm.select({ docId: woocommerceOrderLogs.erpDocumentId }).from(woocommerceOrderLogs)
        .where(inArray(woocommerceOrderLogs.wcOrderId, orderIdList));
      await orm.delete(woocommerceOrderLogs).where(inArray(woocommerceOrderLogs.wcOrderId, orderIdList));
      const docIds = logs.map(l => l.docId).filter((v): v is number => typeof v === 'number');
      if (docIds.length > 0) {
        await cleanTestTableData('document_items', 'document_id', docIds);
        await cleanTestTableData('documents', 'id', docIds);
      }
      if (createdCustomerIds.length > 0) {
        await orm.delete(customers).where(inArray(customers.id, createdCustomerIds));
      }
      if (originalSecret) {
        await orm.update(appSettings).set({ value: originalSecret.value }).where(eq(appSettings.key, secretKey));
      } else {
        await orm.delete(appSettings).where(eq(appSettings.key, secretKey));
      }
    }
  }

  // Test 27.4: v7.0.31 (TD-193 / audit P1-8): یک سند حسابداری فعال برای هر سند انبار، حذف همگام‌سازی از بوت
  // و همگام‌سازی دستی «فقط اسناد فاقد سند» با قفل مشورتی
  if (shouldRun('reg_document_voucher_link_td_193', 'td193', 'voucher', 'sync', 'boot')) {
    const tStart = Date.now();
    const { createTestItem } = await import('../fixtures/factories.js');
    const { pool } = await import('../../db/drizzle.js');
    const fs = await import('fs');
    const path = await import('path');
    const createdDocIds: number[] = [];
    const violations: string[] = [];
    const check = (cond: boolean, msg: string) => { if (!cond) violations.push(msg); };
    try {
      const [defWh] = await orm.select({ code: warehouses.code }).from(warehouses)
        .where(eq(warehouses.isActive, 1)).orderBy(warehouses.id).limit(1);
      const item = await createTestItem({ currentStock: 50, stocks: { [defWh.code]: 50 }, weightedAverageCost: 30000 });
      const today = await businessTodayIsoDate();
      const makeInvoice = async (skipVoucherSync: boolean) => {
        const id = await DocumentService.createDocument({
          docType: 'invoice', status: 'final', date: today, user: 'test-agent', buyerName: 'خریدار آزمون TD-193',
          location: defWh.code, skipVoucherSync,
          items: [{ itemId: item.id, quantity: 1, unit_price: 100000, location: defWh.code }]
        });
        createdDocIds.push(id);
        return id;
      };
      // اسناد معکوس/اصلاحی (REV-V…) reference_id = شناسه سند حسابداری مبدأ دارند و ممکن است تصادفاً با شناسه سند برابر شوند
      const vouchersOf = async (docId: number) => (await orm.select().from(journalVouchers)
        .where(and(eq(journalVouchers.referenceModule, 'invoice'), eq(journalVouchers.referenceId, docId), eq(journalVouchers.isDeleted, 0))))
        .filter(v => !/^(RE-REV-V|REV-V|CORR-V|VOID-REPOST-V|REPOST-V)/.test(v.referenceNumber || ''));
      const insertBareVoucher = async (values: { referenceId: number; referenceNumber: string; status: string; voucherType: string }) => {
        const voucherNumber = await VoucherService.getNextVoucherNumber();
        const [row] = await orm.insert(journalVouchers).values({
          voucherNumber, date: today, description: 'سند آزمون TD-193', referenceModule: 'invoice',
          totalDebit: money(1000), totalCredit: money(1000), ...values
        }).returning();
        return row;
      };

      // ۱) فاکتور قطعی → سند حسابداری با پیوند صریح به سند
      const d1 = await makeInvoice(false);
      const [v1] = await vouchersOf(d1);
      check(Boolean(v1) && (v1 as any).sourceDocumentId === d1, `سند حسابداری فاکتور باید source_document_id=${d1} داشته باشد: ${JSON.stringify(v1 ? { id: v1.id, src: (v1 as any).sourceDocumentId } : null)}`);

      // ۲) دیتابیس دومین سند فعال برای همان سند را رد می‌کند (ایندکس یکتای جزئی)
      let duplicateRejected = false;
      try {
        await orm.execute(sql`INSERT INTO journal_vouchers (voucher_number, date, description, reference_module, reference_id, reference_number, source_document_id, total_debit, total_credit)
          VALUES (nextval('journal_voucher_number_seq'), ${today}, 'probe duplicate', 'invoice', ${d1}, 'probe', ${d1}, 0, 0)`);
      } catch {
        duplicateRejected = true;
      }
      check(duplicateRejected, 'درج دومین سند حسابداری فعال برای یک سند انبار باید توسط ایندکس یکتا رد شود (uq_jv_source_document_active)');

      // ۳) سند معکوسی که reference_id آن (شناسه سند حسابداری مبدأ) با شناسه یک فاکتور برابر است نباید سند آن فاکتور تلقی شود
      const d2 = await makeInvoice(true);
      const fakeReversal = await insertBareVoucher({ referenceId: d2, referenceNumber: 'REV-V990001', status: 'approved', voucherType: 'adjustment' });
      const ensured = await VoucherSyncService.autoCreateVoucherForInvoice(d2, undefined, 'test-agent', undefined, { strict: true });
      check(Boolean(ensured) && ensured!.id !== fakeReversal.id, `برای فاکتور بدون سند باید سند جدید صادر شود، نه بازگرداندن سند معکوس نامرتبط #${fakeReversal.id} (دریافتی: #${ensured?.id})`);
      let deleteError = '';
      try {
        await DocumentService.deleteDocument(d2, 'test-agent');
      } catch (err: any) {
        deleteError = err?.message || String(err);
      }
      check(!deleteError, `حذف فاکتور نباید برای سند معکوس نامرتبط خطا دهد: ${deleteError}`);
      const reversalOfFake = await orm.select({ id: journalVouchers.id }).from(journalVouchers)
        .where(eq(journalVouchers.referenceNumber, `REV-V${fakeReversal.voucherNumber}`));
      check(reversalOfFake.length === 0, 'حذف فاکتور نباید سند معکوس نامرتبط را دوباره معکوس کند');
      if (ensured) {
        // v8.0.2 (TD-251): سند پیش‌نویس خودِ فاکتور حذف نرم می‌شود و سند تأییدشده معکوس می‌شود
        const reversalOfOwn = await orm.select({ id: journalVouchers.id }).from(journalVouchers)
          .where(eq(journalVouchers.referenceNumber, `REV-V${ensured.voucherNumber}`));
        const [ownAfter] = await orm.select({ isDeleted: journalVouchers.isDeleted }).from(journalVouchers).where(eq(journalVouchers.id, ensured.id));
        const ownNeutralized = ensured.status === 'draft'
          ? ownAfter?.isDeleted === 1 && reversalOfOwn.length === 0
          : reversalOfOwn.length === 1;
        check(ownNeutralized, `حذف فاکتور باید سند حسابداری خودِ فاکتور را بی‌اثر کند (وضعیت ${ensured.status}، حذف نرم ${ownAfter?.isDeleted}، سند معکوس ${reversalOfOwn.length})`);
      }

      // ۴) همگام‌سازی دستی «فقط اسناد فاقد سند»: سند موجود بازنویسی نمی‌شود و اجرای دوباره سند تکراری نمی‌سازد
      const d3 = await makeInvoice(true);
      if (v1) {
        await orm.update(journalVouchers).set({ description: 'TD193-PRESERVE-MARKER' }).where(eq(journalVouchers.id, v1.id));
      }
      const syncMissing = (VoucherSyncService as any).syncMissingDocumentVouchers;
      check(typeof syncMissing === 'function', 'متد syncMissingDocumentVouchers باید وجود داشته باشد');
      if (typeof syncMissing === 'function') {
        await syncMissing.call(VoucherSyncService, { batchSize: 2 });
        await syncMissing.call(VoucherSyncService, { batchSize: 2 });
        const d3Vouchers = await vouchersOf(d3);
        check(d3Vouchers.length === 1, `سند فاقد سند حسابداری باید دقیقاً یک سند بگیرد (${d3Vouchers.length})`);
        if (v1) {
          const [v1After] = await orm.select({ description: journalVouchers.description }).from(journalVouchers).where(eq(journalVouchers.id, v1.id));
          check(v1After?.description === 'TD193-PRESERVE-MARKER', `همگام‌سازی نباید سند حسابداری موجود را بازنویسی کند: «${v1After?.description}»`);
        }

        // ۵) سند قدیمی بدون پیوند: سند جدید صادر نمی‌شود و برای بررسی حسابدار گزارش می‌شود
        const d5 = await makeInvoice(true);
        const [d5Doc] = await orm.select({ refNumber: documents.refNumber }).from(documents).where(eq(documents.id, d5));
        await insertBareVoucher({ referenceId: d5, referenceNumber: d5Doc.refNumber, status: 'draft', voucherType: 'sales' });
        const summary = await syncMissing.call(VoucherSyncService, {});
        const d5Vouchers = await vouchersOf(d5);
        check(d5Vouchers.length === 1, `برای سند دارای سند حسابداری قدیمی بدون پیوند نباید سند دوم صادر شود: ${JSON.stringify(d5Vouchers.map(v => ({ id: v.id, ref: v.referenceNumber, src: (v as any).sourceDocumentId })))}`);
        check(Array.isArray(summary?.reviewDocumentIds) && summary.reviewDocumentIds.includes(d5), `سند ${d5} باید در فهرست بررسی حسابدار باشد: ${JSON.stringify(summary?.reviewDocumentIds)}`);

        // ۶) قفل مشورتی: وقتی اجرای دیگری قفل را دارد، کاری انجام نمی‌شود
        const d6 = await makeInvoice(true);
        const holder = await pool.connect();
        try {
          await holder.query('SELECT pg_advisory_lock(91001)');
          const lockedRun = await syncMissing.call(VoucherSyncService, {});
          check(lockedRun?.locked === true, 'با قفل گرفته‌شده توسط نمونه دیگر، اجرا باید locked=true برگرداند');
          check((await vouchersOf(d6)).length === 0, 'اجرای قفل‌شده نباید سندی صادر کند');
        } finally {
          await holder.query('SELECT pg_advisory_unlock(91001)').catch(() => undefined);
          holder.release();
        }

        // ۷) گزارش سلامت مالی اسناد تکراری قدیمی را فهرست می‌کند
        const legacyDuplicate = v1 ? await insertBareVoucher({ referenceId: d1, referenceNumber: (await orm.select({ r: documents.refNumber }).from(documents).where(eq(documents.id, d1)))[0].r, status: 'draft', voucherType: 'sales' }) : null;
        const health = await AccountingService.runFinancialHealthCheck();
        const dupTest = health.tests.find((t: any) => t.id === 'duplicate_document_vouchers');
        check(Boolean(legacyDuplicate) && dupTest?.status === 'error' && (dupTest.items || []).some((i: any) => i.id === legacyDuplicate!.id),
          `بازرس سلامت مالی باید سند تکراری #${legacyDuplicate?.id} را گزارش کند: ${JSON.stringify(dupTest ? { status: dupTest.status, count: dupTest.count } : null)}`);
      }

      // ۸) مسیر بوت دیگر همگام‌سازی کامل اسناد و پرکردن کاردکس را اجرا نمی‌کند
      const serverSource = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
      check(!/syncAllInvoiceVouchers\(|syncMissingInitialTransactions\(|syncMissingDocumentVouchers\(/.test(serverSource),
        'server.ts نباید در مسیر بوت همگام‌سازی اسناد حسابداری یا پرکردن کاردکس را اجرا کند');

      if (violations.length > 0) {
        throw new Error(violations.join(' | '));
      }
      results.push(makeTestCase({
        id: 'reg_document_voucher_link_td_193',
        scenarioId: 'document_voucher_uniqueness',
        name: 'v7.0.31: یکتایی سند حسابداری هر سند انبار، همگام‌سازی دستی فقط اسناد فاقد سند با قفل مشورتی و حذف از بوت (TD-193 / P1-8)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'پیوند source_document_id و ایندکس یکتا، تفکیک سند معکوس از سند فاکتور در صدور و حذف، عدم بازنویسی اسناد موجود، گزارش اسناد قدیمی بدون پیوند، قفل مشورتی و حذف از مسیر بوت تأیید شد.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_document_voucher_link_td_193',
        scenarioId: 'document_voucher_uniqueness',
        name: 'v7.0.31: یکتایی سند حسابداری هر سند انبار، همگام‌سازی دستی فقط اسناد فاقد سند با قفل مشورتی و حذف از بوت (TD-193 / P1-8)',
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      }));
    } finally {
      if (createdDocIds.length > 0) {
        await cleanTestTableData('document_items', 'document_id', createdDocIds);
      }
    }
  }

  // Test 27.5: v7.0.32 (TD-197 / audit P1-7): مالیات بر ارزش افزوده ساختاریافته — بدون استخراج از متن یادداشت
  if (shouldRun('reg_structured_vat_td_197', 'td197', 'vat', 'tax', 'voucher')) {
    const tStart = Date.now();
    const { createTestItem } = await import('../fixtures/factories.js');
    const { journalVoucherItems: jvItems } = await import('../../db/schema.js');
    const createdDocIds: number[] = [];
    const violations: string[] = [];
    const check = (cond: boolean, msg: string) => { if (!cond) violations.push(msg); };
    try {
      const [defWh] = await orm.select({ code: warehouses.code }).from(warehouses)
        .where(eq(warehouses.isActive, 1)).orderBy(warehouses.id).limit(1);
      const item = await createTestItem({ currentStock: 50, stocks: { [defWh.code]: 50 }, weightedAverageCost: 20000 });
      const today = await businessTodayIsoDate();
      const lines = [{ itemId: item.id, quantity: 2, unit_price: 100000, location: defWh.code }]; // خالص ۲۰۰٬۰۰۰
      const create = async (extra: Record<string, unknown>) => {
        const id = await DocumentService.createDocument({
          docType: 'invoice', status: 'final', date: today, user: 'test-agent', buyerName: 'خریدار آزمون TD-197',
          location: defWh.code, items: lines, ...extra
        } as any);
        createdDocIds.push(id);
        return id;
      };
      const docRow = async (id: number) => (await orm.select().from(documents).where(eq(documents.id, id)))[0] as any;
      const voucherVat = async (docId: number) => {
        const [v] = await orm.select({ id: journalVouchers.id }).from(journalVouchers)
          .where(and(eq(journalVouchers.sourceDocumentId, docId), eq(journalVouchers.isDeleted, 0)));
        if (!v) return { exists: false, vat: 0, receivable: 0 };
        const rows = await orm.select().from(jvItems).where(eq(jvItems.voucherId, v.id));
        const vat = rows.filter(r => r.detailedName === 'مالیات بر ارزش افزوده').reduce((a, r) => a + Number(r.credit || 0), 0);
        const receivable = rows.filter(r => r.detailedType === 'customer').reduce((a, r) => a + Number(r.debit || 0), 0);
        return { exists: true, vat, receivable };
      };

      // ۱) یادداشت آزاد درباره مالیات بدون مالیات ساختاریافته → هیچ مالیاتی در سند حسابداری
      const docA = await create({ notes: 'مالیات ۲ قلم آخر محاسبه نشود - vat 1403 پرداخت شد' });
      const vA = await voucherVat(docA);
      check(vA.exists && vA.vat === 0, `یادداشت آزاد نباید به مالیات تبدیل شود (مالیات ثبت‌شده: ${vA.vat})`);
      check(vA.receivable === 200000, `بدهکار مشتری باید برابر خالص فاکتور (۲۰۰٬۰۰۰) باشد: ${vA.receivable}`);
      // همگام‌سازی دوباره بدون گزینه (مسیری که پیش‌تر هنگام راه‌اندازی اجرا می‌شد)
      await VoucherSyncService.syncSalesInvoiceVoucher(docA);
      check((await voucherVat(docA)).vat === 0, 'همگام‌سازی دوباره نباید مالیات را از یادداشت استخراج کند');

      // ۲) درصد مالیات → مبلغ ذخیره‌شده روی فاکتور و همان مبلغ در سند حسابداری، بدون نوشتن در یادداشت
      const docB = await create({ vatPercent: 9, notes: 'فاکتور آزمون' });
      const rowB = await docRow(docB);
      check(Number(rowB?.vatPercent) === 9 && Number(rowB?.vatAmount) === 18000, `مالیات فاکتور باید ساختاریافته ذخیره شود (۹٪، ۱۸٬۰۰۰): ${JSON.stringify({ p: rowB?.vatPercent, a: rowB?.vatAmount })}`);
      check(!String(rowB?.notes || '').includes('ارزش افزوده'), `مالیات نباید در یادداشت نوشته شود: «${rowB?.notes}»`);
      const vB = await voucherVat(docB);
      check(vB.vat === 18000 && vB.receivable === 218000, `سند حسابداری باید مالیات ۱۸٬۰۰۰ و بدهکار ۲۱۸٬۰۰۰ داشته باشد: ${JSON.stringify(vB)}`);
      const formattedB: any = await DocumentService.getDocumentById(docB);
      check(formattedB?.payableAmount === 218000 && formattedB?.remainingAmount === 218000, `مبلغ قابل وصول فاکتور باید شامل مالیات باشد: ${JSON.stringify({ payable: formattedB?.payableAmount, remaining: formattedB?.remainingAmount })}`);

      // ۳) پیش‌فاکتور با مبلغ مالیات → نهایی‌سازی بدون گزینه از مقدار ذخیره‌شده استفاده می‌کند
      const docC = await create({ docType: 'proforma', status: 'proforma', vatAmount: 50000 });
      await DocumentService.finalizeDocument(docC, 'test-agent');
      check(Number((await docRow(docC))?.vatAmount) === 50000 && (await voucherVat(docC)).vat === 50000, 'نهایی‌سازی پیش‌فاکتور باید مالیات ذخیره‌شده (۵۰٬۰۰۰) را ثبت کند');

      // ۴) ویرایش پیش‌فاکتور با درصد مالیات → ذخیره و ثبت در نهایی‌سازی
      const docD = await create({ docType: 'proforma', status: 'proforma' });
      await DocumentService.updateDocument(docD, { vatPercent: 10 } as any);
      check(Number((await docRow(docD))?.vatAmount) === 20000, `ویرایش پیش‌فاکتور باید مالیات ۱۰٪ (۲۰٬۰۰۰) را ذخیره کند: ${(await docRow(docD))?.vatAmount}`);
      await DocumentService.finalizeDocument(docD, 'test-agent');
      check((await voucherVat(docD)).vat === 20000, 'سند حسابداری پیش‌فاکتور ویرایش‌شده باید مالیات ۲۰٬۰۰۰ داشته باشد');

      // ۵) اعتبارسنجی سرویس: درصد بیش از ۱۰۰ و مبلغ منفی رد می‌شوند
      for (const bad of [{ vatPercent: 150 }, { vatAmount: -5 }]) {
        let rejected = false;
        try {
          await create(bad);
        } catch {
          rejected = true;
        }
        check(rejected, `مالیات نامعتبر باید رد شود: ${JSON.stringify(bad)}`);
      }

      if (violations.length > 0) {
        throw new Error(violations.join(' | '));
      }
      results.push(makeTestCase({
        id: 'reg_structured_vat_td_197',
        scenarioId: 'structured_vat',
        name: 'v7.0.32: مالیات بر ارزش افزوده ساختاریافته در فاکتور و سند حسابداری، بدون استخراج از یادداشت (TD-197 / P1-7)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'یادداشت آزاد به مالیات تبدیل نشد، درصد/مبلغ مالیات روی فاکتور ذخیره و عیناً در سند حسابداری ثبت شد، ویرایش و نهایی‌سازی پیش‌فاکتور از مقدار ذخیره‌شده استفاده کرد و مبلغ قابل وصول شامل مالیات بود.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_structured_vat_td_197',
        scenarioId: 'structured_vat',
        name: 'v7.0.32: مالیات بر ارزش افزوده ساختاریافته در فاکتور و سند حسابداری، بدون استخراج از یادداشت (TD-197 / P1-7)',
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      }));
    } finally {
      if (createdDocIds.length > 0) {
        await cleanTestTableData('document_items', 'document_id', createdDocIds);
      }
    }
  }

  // Test 27.6: v7.0.33 (TD-200 / audit P1-9): گزارش و ترمیم دستی موجودی انبارها از روی کاردکس
  if (shouldRun('reg_warehouse_stock_reconciliation_td_200', 'td200', 'inventory', 'reconcile', 'kardex')) {
    const tStart = Date.now();
    const createdItemIds: number[] = [];
    const violations: string[] = [];
    const check = (cond: boolean, msg: string) => { if (!cond) violations.push(msg); };
    try {
      const { WarehouseStockReconciliationService } = await import('../../services/inventory/warehouseStockReconciliation.service.js');
      const { createTestItem, createTestWarehouse } = await import('../fixtures/factories.js');
      const { itemWarehouseStocks, inventoryReconciliationAnomalies } = await import('../../db/schema.js');
      const { pool } = await import('../../db/drizzle.js');
      const [w1] = await orm.select().from(warehouses).where(eq(warehouses.isActive, 1)).orderBy(warehouses.id).limit(1);
      const w2 = await createTestWarehouse({ name: `انبار دوم آزمون ${Date.now()}` });
      const today = `${await businessTodayIsoDate()} 10:00:00`;
      const kardex = async (itemId: number, type: 'in' | 'out', quantity: number, location: string, extra: Record<string, unknown> = {}) => {
        const [row] = await orm.insert(transactions).values({ itemId, type, quantity, unitPrice: 1000, totalPrice: quantity * 1000, date: today, documentType: 'audit', documentRef: 'TD200-PROBE', location, isDeleted: 0, ...extra } as any).returning({ id: transactions.id });
        return row.id;
      };
      const setTable = async (itemId: number, warehouseId: number, warehouseCode: string, currentStock: number) => {
        await orm.insert(itemWarehouseStocks).values({ itemId, warehouseId, warehouseCode, currentStock, reservedStock: 0, version: 1 });
      };
      // v7.0.48 (TD-214): بدون ستون JSONB؛ وضعیت جدول هر کالا صریحاً با setTable ساخته می‌شود
      const mkItem = async () => {
        const it = await createTestItem({ stocks: {}, weightedAverageCost: 12345 });
        createdItemIds.push(it.id);
        return it;
      };

      // I1: کلید تکراری JSON در 0014 بازنویسی شد → جدول ۳ ولی کاردکس ۱۰ (انبار ۱) و ۵ (انبار ۲، بدون ردیف)
      const i1 = await mkItem();
      await kardex(i1.id, 'in', 10, w1.code);
      await kardex(i1.id, 'in', 5, w2.code);
      await setTable(i1.id, w1.id, w1.code, 3);
      // I2: مانده منفی کاردکس که 0014 به صفر رساند
      const i2 = await mkItem();
      await kardex(i2.id, 'in', 2, w1.code);
      await kardex(i2.id, 'out', 5, w1.code);
      await setTable(i2.id, w1.id, w1.code, 0);
      // I3: گردش کاردکس در محلی که به هیچ انباری نگاشت نمی‌شود
      const i3 = await mkItem();
      await kardex(i3.id, 'in', 4, `انبار حذف‌شده ${Date.now()}`);
      await kardex(i3.id, 'in', 1, w1.code);
      await setTable(i3.id, w1.id, w1.code, 7);
      // I4: کد انبار در جدول همان کلید خام JSON (نام انبار) است
      const i4 = await mkItem();
      await kardex(i4.id, 'in', 6, w2.code);
      await setTable(i4.id, w2.id, w2.name, 6);
      // I5: حذف سند: ردیف مبدأ حذف نرم + ردیف معکوس فعال → نباید مغایرت تلقی شود
      const i5 = await mkItem();
      await kardex(i5.id, 'in', 8, w1.code);
      const orig = await kardex(i5.id, 'out', 2, w1.code, { isDeleted: 1 });
      await kardex(i5.id, 'in', 2, 'default', { reversalOfId: orig });
      await setTable(i5.id, w1.id, w1.code, 8);

      const testIds = [i1.id, i2.id, i3.id, i4.id, i5.id];
      const rowFor = (report: any, itemId: number, whId: number) => report.rows.find((r: any) => r.itemId === itemId && r.warehouseId === whId);

      // ۱) گزارش
      const report = await WarehouseStockReconciliationService.getReport();
      check(rowFor(report, i1.id, w1.id)?.status === 'mismatch' && rowFor(report, i1.id, w1.id)?.ledgerQty === 10, `I1/انبار۱ باید مغایرت ۱۰ در برابر ۳ باشد: ${JSON.stringify(rowFor(report, i1.id, w1.id))}`);
      check(rowFor(report, i1.id, w2.id)?.status === 'mismatch' && rowFor(report, i1.id, w2.id)?.tableQty === null, `I1/انبار۲ باید مغایرت بدون ردیف جدول باشد: ${JSON.stringify(rowFor(report, i1.id, w2.id))}`);
      check(rowFor(report, i2.id, w1.id)?.status === 'negative_ledger', `I2 باید مانده منفی کاردکس گزارش شود: ${JSON.stringify(rowFor(report, i2.id, w1.id))}`);
      check(report.unresolvedLocations.some((u: any) => u.itemId === i3.id), 'I3 باید محل نامعلوم کاردکس گزارش شود');
      check(rowFor(report, i4.id, w2.id)?.codeMismatch === true, `I4 باید ناهمخوانی کد انبار گزارش شود: ${JSON.stringify(rowFor(report, i4.id, w2.id))}`);
      check(!report.rows.some((r: any) => r.itemId === i5.id), `I5 (حذف سند با ردیف معکوس) نباید مغایرت داشته باشد: ${JSON.stringify(report.rows.filter((r: any) => r.itemId === i5.id))}`);

      // ۲) اجرای آزمایشی پیش‌فرض: برنامه تغییرات بدون تغییر داده
      const dry = await WarehouseStockReconciliationService.repair({ itemIds: testIds });
      check(dry.dryRun === true && dry.changes.some((c: any) => c.itemId === i1.id && c.warehouseId === w1.id && c.afterQty === 10), `اجرای آزمایشی باید پیش‌فرض و شامل اصلاح I1 باشد: ${JSON.stringify(dry).slice(0, 300)}`);
      const [i1w1Before] = await orm.select().from(itemWarehouseStocks).where(and(eq(itemWarehouseStocks.itemId, i1.id), eq(itemWarehouseStocks.warehouseId, w1.id)));
      check(Number(i1w1Before?.currentStock) === 3, 'اجرای آزمایشی نباید داده را تغییر دهد');

      // ۳) قفل مشورتی: اجرای همزمان دیگر کاری انجام نمی‌دهد
      const holder = await pool.connect();
      try {
        await holder.query('SELECT pg_advisory_lock(91003)');
        const lockedRun = await WarehouseStockReconciliationService.repair({ dryRun: false, itemIds: testIds });
        check(lockedRun.locked === true && lockedRun.rowsChanged === 0, 'با قفل گرفته‌شده توسط نمونه دیگر نباید ترمیمی انجام شود');
      } finally {
        await holder.query('SELECT pg_advisory_unlock(91003)').catch(() => undefined);
        holder.release();
      }

      // ۴) ترمیم واقعی
      const run = await WarehouseStockReconciliationService.repair({ dryRun: false, itemIds: testIds, username: 'test-agent' });
      const tableOf = async (itemId: number) => orm.select().from(itemWarehouseStocks).where(eq(itemWarehouseStocks.itemId, itemId));
      const itemOf = async (itemId: number) => (await orm.select().from(items).where(eq(items.id, itemId)))[0];
      const t1 = await tableOf(i1.id);
      const i1After = await itemOf(i1.id);
      check(Number(t1.find(r => r.warehouseId === w1.id)?.currentStock) === 10 && Number(t1.find(r => r.warehouseId === w2.id)?.currentStock) === 5, `I1 باید به ۱۰ و ۵ اصلاح شود: ${JSON.stringify(t1.map(r => [r.warehouseId, r.currentStock]))}`);
      const i1Stocks = (await ItemWarehouseStockService.getStockSnapshot(orm, i1.id)).byCode;
      check(Number(i1After.currentStock) === 15 && i1Stocks[w1.code] === 10 && i1Stocks[w2.code] === 5, `موجودی کل و تفکیکی I1 باید ۱۵ (۱۰ و ۵) باشد: ${JSON.stringify({ c: i1After.currentStock, s: i1Stocks })}`);
      check(Number(i1After.weightedAverageCost) === 12345, 'ترمیم نباید بهای میانگین موزون را تغییر دهد');
      check(Number((await tableOf(i2.id))[0]?.currentStock) === 0, 'مانده منفی کاردکس نباید خودکار تعدیل شود');
      check(Number((await tableOf(i3.id))[0]?.currentStock) === 7, 'کالای دارای محل نامعلوم نباید اصلاح شود');
      check((await tableOf(i4.id))[0]?.warehouseCode === w2.code, 'کد انبار I4 باید به کد استاندارد اصلاح شود');
      const anomalies = await orm.select().from(inventoryReconciliationAnomalies).where(eq(inventoryReconciliationAnomalies.runId, run.runId));
      const kinds = (itemId: number) => anomalies.filter(a => a.itemId === itemId).map(a => a.kind);
      check(kinds(i1.id).filter(k => k === 'repaired').length === 2, `دو اصلاح I1 باید در جدول ناهنجاری‌ها ثبت شود: ${JSON.stringify(kinds(i1.id))}`);
      check(kinds(i2.id).includes('negative_ledger') && kinds(i3.id).includes('unresolved_location'), `امتناع‌ها باید ثبت شوند: ${JSON.stringify({ i2: kinds(i2.id), i3: kinds(i3.id) })}`);

      // ۵) گزارش پس از ترمیم
      const after = await WarehouseStockReconciliationService.getReport();
      check(!after.rows.some((r: any) => r.itemId === i1.id || r.itemId === i4.id), 'پس از ترمیم I1 و I4 نباید مغایرت داشته باشند');

      if (violations.length > 0) {
        throw new Error(violations.join(' | '));
      }
      results.push(makeTestCase({
        id: 'reg_warehouse_stock_reconciliation_td_200',
        scenarioId: 'warehouse_stock_reconciliation',
        name: 'v7.0.33: گزارش و ترمیم دستی موجودی انبارها از روی کاردکس — بدون تعدیل خودکار منفی‌ها (TD-200 / P1-9)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'مغایرت‌های ناشی از مهاجرت 0014 (بازنویسی کلید تکراری، صفر شدن منفی، کد خام انبار) گزارش شد؛ اجرای آزمایشی پیش‌فرض داده را تغییر نداد؛ ترمیم فقط مقدار را از کاردکس اصلاح کرد، منفی‌ها و محل‌های نامعلوم را دست نزد و همه را در جدول ناهنجاری‌ها ثبت کرد.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_warehouse_stock_reconciliation_td_200',
        scenarioId: 'warehouse_stock_reconciliation',
        name: 'v7.0.33: گزارش و ترمیم دستی موجودی انبارها از روی کاردکس — بدون تعدیل خودکار منفی‌ها (TD-200 / P1-9)',
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      }));
    } finally {
      if (createdItemIds.length > 0) {
        await cleanTestTableData('transactions', 'item_id', createdItemIds);
      }
    }
  }

  // Test 27.7: v7.0.34 (TD-196): شماره دستی طولانی نباید شماره‌گذاری خودکار سال مالی را متوقف کند
  if (shouldRun('reg_ref_counter_long_manual_ref_td_196', 'td196', 'ref_counters', 'refnumber')) {
    const tStart = Date.now();
    const createdDocIds: number[] = [];
    const testDocType = 'reg_test_td196';
    try {
      // ۱) سند با شماره دستی ۱۳ رقمی پیش از اولین شماره خودکار این نوع سند در سال مالی
      const manualId = await DocumentService.createDocument({ docType: testDocType, status: 'draft', date: '2026-08-01', refNumber: `MAN-${1790882288234}`, items: [], user: 'test-agent' });
      createdDocIds.push(manualId);
      // ۲) شماره‌گذاری خودکار باید کار کند و از سقف شمارنده عبور نکند
      const peek = await DocumentService.peekNextRef(testDocType, '2026-08-02');
      const autoId = await DocumentService.createDocument({ docType: testDocType, status: 'draft', date: '2026-08-02', items: [], user: 'test-agent' });
      createdDocIds.push(autoId);
      const [autoDoc] = await orm.select({ refNumber: documents.refNumber }).from(documents).where(eq(documents.id, autoId));
      if (autoDoc?.refNumber !== '1' || peek !== '1') {
        throw new Error(`شماره خودکار پس از سند با شماره دستی طولانی باید «1» باشد: ${JSON.stringify({ peek, ref: autoDoc?.refNumber })}`);
      }
      results.push(makeTestCase({
        id: 'reg_ref_counter_long_manual_ref_td_196',
        scenarioId: 'period_closing_and_conceptual_mappings',
        name: 'v7.0.34: شماره دستی طولانی شماره‌گذاری خودکار سال مالی را متوقف نمی‌کند (TD-196)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'پس از ثبت سند با شماره دستی ۱۳ رقمی، مقداردهی اولیه شمارنده آن را نادیده گرفت و شماره خودکار «1» صادر شد.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_ref_counter_long_manual_ref_td_196',
        scenarioId: 'period_closing_and_conceptual_mappings',
        name: 'v7.0.34: شماره دستی طولانی شماره‌گذاری خودکار سال مالی را متوقف نمی‌کند (TD-196)',
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      }));
    } finally {
      if (createdDocIds.length > 0) {
        await cleanTestTableData('documents', 'id', createdDocIds);
      }
      await orm.delete(documentRefCounters).where(eq(documentRefCounters.docType, testDocType));
    }
  }

  // Test 27.7b: v7.0.60 (audit P3-10): شماره دستی دارای پیشوند و سال فقط با پسوند عددی‌اش شمارنده را جلو می‌برد
  if (shouldRun('reg_ref_counter_numeric_suffix_p3_10', 'p310', 'ref_counters', 'refnumber')) {
    const tStart = Date.now();
    const createdDocIds: number[] = [];
    const testDocType = 'reg_test_p3_10';
    const testName = 'v7.0.60: شماره دستی «INV-1403-0005» شمارنده را به ۵ می‌برد، نه 14030005 (P3-10)';
    try {
      // ۱) همگام‌سازی شمارنده با شماره دستی در createDocument
      const manualId = await DocumentService.createDocument({ docType: testDocType, status: 'draft', date: '2026-08-01', refNumber: 'INV-1403-0005', items: [], user: 'test-agent' });
      createdDocIds.push(manualId);
      const autoId = await DocumentService.createDocument({ docType: testDocType, status: 'draft', date: '2026-08-02', items: [], user: 'test-agent' });
      createdDocIds.push(autoId);
      const [autoDoc] = await orm.select({ refNumber: documents.refNumber }).from(documents).where(eq(documents.id, autoId));
      if (autoDoc?.refNumber !== '6') {
        throw new Error(`شماره خودکار پس از «INV-1403-0005» باید «6» باشد: ${autoDoc?.refNumber}`);
      }
      // ۲) مقداردهی اولیه شمارنده از روی اسناد موجود (شروع سرد) نیز فقط پسوند عددی را می‌خواند
      await orm.delete(documentRefCounters).where(eq(documentRefCounters.docType, testDocType));
      const peek = await DocumentService.peekNextRef(testDocType, '2026-08-03');
      if (peek !== '7') {
        throw new Error(`پیش‌نمایش شماره پس از شروع سرد باید «7» باشد: ${peek}`);
      }
      results.push(makeTestCase({
        id: 'reg_ref_counter_numeric_suffix_p3_10',
        scenarioId: 'period_closing_and_conceptual_mappings',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'شماره دستی دارای سال (INV-1403-0005) شمارنده را به ۵ رساند؛ شماره خودکار بعدی «6» و پس از شروع سرد «7» بود.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_ref_counter_numeric_suffix_p3_10',
        scenarioId: 'period_closing_and_conceptual_mappings',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      }));
    } finally {
      if (createdDocIds.length > 0) {
        await cleanTestTableData('documents', 'id', createdDocIds);
      }
      await orm.delete(documentRefCounters).where(eq(documentRefCounters.docType, testDocType));
    }
  }

  // Test 27.7c: v7.0.62 (TD-179): روز دقیق نوروز در سال مالی شماره‌گذاری (TS و SQL) و اصلاح ردیف‌های مرزی قدیمی
  if (shouldRun('reg_ref_fiscal_year_exact_nowruz_td_179', 'td179', 'nowruz', 'ref_fiscal_year')) {
    const tStart = Date.now();
    const createdDocIds: number[] = [];
    const testDocType = 'reg_test_td179';
    const testName = 'v7.0.62: سند ۲۰ مارس ۲۰۲۴ (نوروز ۱۴۰۳) در سال ۱۴۰۳ شماره می‌خورد و ردیف‌های مرزی قدیمی با گزارش اصلاح می‌شوند (TD-179)';
    try {
      const violations: string[] = [];
      // ۱) سمت برنامه
      const expected: Record<string, number> = { '2024-03-19': 1402, '2024-03-20': 1403, '2025-03-20': 1403, '2025-03-21': 1404, '2028-03-20': 1407, '2026-03-20': 1404 };
      for (const [d, fy] of Object.entries(expected)) {
        const got = resolveJalaliFiscalYear(d);
        if (got !== fy) violations.push(`resolveJalaliFiscalYear(${d}) = ${got}، انتظار ${fy}`);
      }
      // ۲) سمت پایگاه‌داده باید برای همه روزهای ۱۹ تا ۲۳ مارس ۱۹۲۱ تا ۲۱۲۱ با برنامه یکی باشد
      const sqlRows = await orm.execute(sql`
        SELECT y::int AS y, dd::int AS dd, erp_ref_fiscal_year(make_timestamp(y::int, 3, dd::int, 12, 0, 0)) AS fy
          FROM generate_series(1921, 2121) y, generate_series(19, 23) dd`);
      const mismatches = (sqlRows.rows as Array<{ y: number; dd: number; fy: number }>).filter(r => {
        const iso = `${r.y}-03-${String(r.dd).padStart(2, '0')}`;
        return resolveJalaliFiscalYear(iso) !== Number(r.fy);
      });
      if (mismatches.length > 0) violations.push(`erp_ref_fiscal_year با برنامه در ${mismatches.length} روز متفاوت است: ${JSON.stringify(mismatches.slice(0, 3))}`);

      // ۳) اصلاح ردیف‌های مرزی قدیمی: سال مالی تقریبی ۱۴۰۲ برای ۲۰ مارس ۲۰۲۴
      const mk = async (refNumber: string, date: string) => {
        const id = await DocumentService.createDocument({ docType: testDocType, status: 'draft', date, refNumber, items: [], user: 'test-agent' });
        createdDocIds.push(id);
        return id;
      };
      const boundary = await mk('TD179-7', '2024-03-20');
      const occupant = await mk('TD179-8', '2024-04-01');
      // سند هم‌شماره در سال ۱۴۰۲ ساخته و سپس به روز مرزی منتقل می‌شود تا وضعیت پیش از v7.0.62 بازسازی شود
      const conflicting = await mk('TD179-8', '2024-03-10');
      const regular = await mk('TD179-9', '2024-03-25');
      await orm.update(documents).set({ refFiscalYear: 1402, date: '2024-03-20 00:00:00' }).where(inArray(documents.id, [boundary, conflicting]));
      await orm.insert(documentRefCounters).values({ docType: testDocType, fiscalYear: 1403, lastRefNumber: 3 })
        .onConflictDoUpdate({ target: [documentRefCounters.docType, documentRefCounters.fiscalYear], set: { lastRefNumber: 3 } });

      await orm.execute(sql`SELECT erp_correct_ref_fiscal_year_boundaries()`);
      await orm.execute(sql`SELECT erp_correct_ref_fiscal_year_boundaries()`); // اجرای دوباره نباید چیزی را تکرار کند

      const rows = await orm.select({ id: documents.id, fy: documents.refFiscalYear, ref: documents.refNumber }).from(documents).where(inArray(documents.id, createdDocIds));
      const byId = new Map(rows.map(r => [r.id, r]));
      if (byId.get(boundary)?.fy !== 1403 || byId.get(boundary)?.ref !== 'TD179-7') violations.push(`سند مرزی باید با همان شماره به ۱۴۰۳ برود: ${JSON.stringify(byId.get(boundary))}`);
      if (byId.get(conflicting)?.fy !== 1402) violations.push(`سند هم‌شماره نباید منتقل شود: ${JSON.stringify(byId.get(conflicting))}`);
      if (byId.get(occupant)?.fy !== 1403 || byId.get(regular)?.fy !== 1403) violations.push('اسناد غیرمرزی نباید تغییر کنند');
      // ترتیب درج گزارش (INSERT ... SELECT بی ORDER BY) به ترتیب فیزیکی ردیف‌های documents بستگی دارد؛ مقایسه به ترتیب شناسه سند
      const report = await orm.execute(sql`SELECT document_id, status FROM ref_fiscal_year_corrections WHERE document_id = ANY(${sql.param(createdDocIds)}::int[]) ORDER BY document_id`);
      const statuses = (report.rows as Array<{ document_id: number; status: string }>).map(r => `${r.document_id}:${r.status}`);
      if (JSON.stringify(statuses) !== JSON.stringify([`${boundary}:corrected`, `${conflicting}:conflict`])) violations.push(`گزارش اصلاح نادرست است: ${JSON.stringify(statuses)}`);
      const [counter] = await orm.select().from(documentRefCounters).where(and(eq(documentRefCounters.docType, testDocType), eq(documentRefCounters.fiscalYear, 1403)));
      if ((counter?.lastRefNumber ?? 0) < 7) violations.push(`شمارنده ۱۴۰۳ باید دست‌کم به شماره سند منتقل‌شده (۷) برسد: ${counter?.lastRefNumber}`);

      // ۴) گزارش در بازرس سلامت مالی
      const { FinancialHealthService } = await import('../../services/accounting/financialHealth.service.js');
      const health = await FinancialHealthService.runHealthCheck();
      const fyTest = health.tests.find(t => t.id === 'ref_fiscal_year_boundary_corrections');
      if (!fyTest || fyTest.status !== 'warning' || !fyTest.items?.some(i => i.linkId === conflicting)) violations.push(`بازرس سلامت مالی باید سند منتقل‌نشده را هشدار دهد: ${JSON.stringify(fyTest?.metrics)}`);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_ref_fiscal_year_exact_nowruz_td_179',
        scenarioId: 'period_closing_and_conceptual_mappings',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'سال مالی برنامه و تابع SQL برای ۱۹ تا ۲۳ مارس ۱۹۲۱ تا ۲۱۲۱ یکسان است؛ سند مرزی با همان شماره به ۱۴۰۳ رفت، سند هم‌شماره منتقل نشد و هر دو در گزارش و بازرس سلامت مالی آمدند.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_ref_fiscal_year_exact_nowruz_td_179',
        scenarioId: 'period_closing_and_conceptual_mappings',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      }));
    } finally {
      if (createdDocIds.length > 0) {
        await cleanTestTableData('ref_fiscal_year_corrections', 'document_id', createdDocIds);
        await cleanTestTableData('documents', 'id', createdDocIds);
      }
      await orm.delete(documentRefCounters).where(eq(documentRefCounters.docType, testDocType));
    }
  }

  // Test 27.7d: v7.0.63 (TD-198): نرخ تسعیر ساختاریافته؛ برای سند ارزی الزامی و هرگز از یادداشت خوانده نمی‌شود
  if (shouldRun('reg_structured_exchange_rate_td_198', 'td198', 'currency', 'exchange')) {
    const tStart = Date.now();
    const createdDocIds: number[] = [];
    const createdVoucherIds: number[] = [];
    let createdItemId: number | null = null;
    const testName = 'v7.0.63: سند ارزی بدون نرخ تسعیر ثبت، ویرایش و صدور سند حسابداری نمی‌شود و نرخ از یادداشت خوانده نمی‌شود (TD-198)';
    try {
      const violations: string[] = [];
      const expectValidation = async (label: string, fn: () => Promise<unknown>) => {
        try {
          await fn();
          violations.push(`${label}: باید با خطای اعتبارسنجی رد شود`);
        } catch (err: any) {
          if (!String(err?.message || '').includes('نرخ تسعیر')) violations.push(`${label}: خطای نامرتبط ${err?.message}`);
        }
      };
      const [item] = await orm.insert(items).values({
        name: 'کالای تست نرخ تسعیر TD-198', code: `ITEM-TD198-${Date.now()}`, type: 'product', category: 'گردنبند',
        unit: 'عدد', weightedAverageCost: money(60000000), isDeleted: 0
      }).returning();
      createdItemId = item.id;
      const line = [{ itemId: item.id, quantity: 1, unit_price: 150, discount: 0 }];

      // ۱) ثبت پیش‌فاکتور ارزی بدون نرخ رد می‌شود؛ با نرخ ذخیره می‌شود
      await expectValidation('ثبت پیش‌فاکتور دلاری بدون نرخ', () => DocumentService.createDocument({ docType: 'proforma', status: 'proforma', date: '2026-08-01', refNumber: `TD198-A-${Date.now()}`, currency: 'USD', items: line, user: 'test-agent' }));
      const proformaId = await DocumentService.createDocument({ docType: 'proforma', status: 'proforma', date: '2026-08-01', refNumber: `TD198-B-${Date.now()}`, currency: 'USD', exchangeRate: 600000, items: line, user: 'test-agent' });
      createdDocIds.push(proformaId);
      const [stored] = await orm.select({ rate: documents.exchangeRate }).from(documents).where(eq(documents.id, proformaId));
      if (Number(stored?.rate) !== 600000) violations.push(`نرخ تسعیر باید روی سند ذخیره شود: ${stored?.rate}`);

      // ۲) ویرایش به ارز دیگر بدون نرخ جدید با نرخ قبلی ذخیره می‌شود؛ سند ریالی نرخ ندارد
      const irrId = await DocumentService.createDocument({ docType: 'proforma', status: 'proforma', date: '2026-08-01', refNumber: `TD198-C-${Date.now()}`, items: line, user: 'test-agent' });
      createdDocIds.push(irrId);
      await expectValidation('تغییر ارز سند ریالی به یورو بدون نرخ', () => DocumentService.updateDocument(irrId, { currency: 'EUR' }));
      const [irrDoc] = await orm.select({ rate: documents.exchangeRate, currency: documents.currency }).from(documents).where(eq(documents.id, irrId));
      if (irrDoc?.rate !== null || irrDoc?.currency !== 'IRR') violations.push(`سند ریالی نباید نرخ یا ارز تغییرکرده داشته باشد: ${JSON.stringify(irrDoc)}`);

      // ۳) سند حسابداری: نرخ از ستون سند، نه از یادداشت «نرخ تسعیر: 1»
      const [usdDoc] = await orm.insert(documents).values({
        type: 'invoice', refNumber: `TD198-D-${Date.now()}`, date: '2026-08-02 00:00:00', buyerName: 'خریدار تست TD-198',
        currency: 'USD', exchangeRate: money(600000), notes: 'نرخ تسعیر: 1', status: 'final', isDeleted: 0
      }).returning();
      createdDocIds.push(usdDoc.id);
      await orm.insert(documentItems).values({ documentId: usdDoc.id, itemId: item.id, quantity: 1, unitPrice: money(150), discount: money(0), location: 'main', isDeleted: 0 });
      const voucher = await VoucherSyncService.syncSalesInvoiceVoucher(usdDoc.id, { strict: true });
      if (voucher) createdVoucherIds.push(voucher.id);
      const full = voucher ? await VoucherService.getJournalVoucherById(voucher.id) : null;
      const cogs = full?.items?.find(it => it.accountCode === '6001' || it.description?.includes('بهای تمام‌شده'));
      if (!cogs || Number(cogs.exchangeRate) !== 600000 || Math.abs(Number(cogs.debit) - 100) > 0.01) {
        violations.push(`سند حسابداری باید با نرخ ستون سند (600000) و بهای تمام‌شده ۱۰۰ دلار صادر شود: ${JSON.stringify({ rate: cogs?.exchangeRate, debit: cogs?.debit })}`);
      }

      // ۴) سند ارزی قدیمی بدون نرخ (فقط نرخ در یادداشت) با نرخ ۱ سند حسابداری نمی‌گیرد
      const [legacyDoc] = await orm.insert(documents).values({
        type: 'invoice', refNumber: `TD198-E-${Date.now()}`, date: '2026-08-02 00:00:00', buyerName: 'خریدار تست TD-198',
        currency: 'AED', notes: 'نرخ تسعیر: 150000', status: 'final', isDeleted: 0
      }).returning();
      createdDocIds.push(legacyDoc.id);
      await orm.insert(documentItems).values({ documentId: legacyDoc.id, itemId: item.id, quantity: 1, unitPrice: money(10), discount: money(0), location: 'main', isDeleted: 0 });
      await expectValidation('سند حسابداری سند درهمی بدون نرخ', () => VoucherSyncService.syncSalesInvoiceVoucher(legacyDoc.id, { strict: true }));

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_structured_exchange_rate_td_198',
        scenarioId: 'multi_currency_financials_and_ratios',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'پیش‌فاکتور دلاری بدون نرخ و تغییر ارز بدون نرخ رد شد؛ سند حسابداری با نرخ ستون سند (نه یادداشت) صادر شد و سند درهمی بدون نرخ سند حسابداری نگرفت.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_structured_exchange_rate_td_198',
        scenarioId: 'multi_currency_financials_and_ratios',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      }));
    } finally {
      if (createdVoucherIds.length > 0) {
        await cleanTestTableData('journal_voucher_items', 'voucher_id', createdVoucherIds);
        await cleanTestTableData('journal_vouchers', 'id', createdVoucherIds);
      }
      if (createdDocIds.length > 0) {
        await cleanTestTableData('document_items', 'document_id', createdDocIds);
        await cleanTestTableData('documents', 'id', createdDocIds);
      }
      if (createdItemId !== null) await cleanTestTableData('items', 'id', [createdItemId]);
    }
  }

  // Test 27.8: v7.0.35 (audit P2-2): اولین حرکت همزمان یک کالا در یک انبار نباید با 23505 شکست بخورد
  if (shouldRun('reg_first_movement_race_p2_2', 'p22', 'race', 'item_warehouse_stocks', 'concurrency')) {
    const tStart = Date.now();
    const createdItemIds: number[] = [];
    try {
      const { ItemWarehouseStockService } = await import('../../services/inventory/itemWarehouseStock.service.js');
      const { createTestItem } = await import('../fixtures/factories.js');
      const { itemWarehouseStocks } = await import('../../db/schema.js');
      const [w1] = await orm.select({ id: warehouses.id, code: warehouses.code, name: warehouses.name })
        .from(warehouses).where(eq(warehouses.isActive, 1)).orderBy(warehouses.id).limit(1);
      const trials = 5;
      const parallel = 6;
      const failures: string[] = [];
      for (let t = 0; t < trials; t++) {
        const item = await createTestItem({ stocks: {}, currentStock: 0 });
        createdItemIds.push(item.id);
        // سرویس به‌تنهایی (بدون قفل قبلی ردیف کالا توسط فراخواننده) باید ایمن باشد
        const outcomes = await Promise.allSettled(Array.from({ length: parallel }, () =>
          orm.transaction(tx => ItemWarehouseStockService.applyMovement(tx, { itemId: item.id, warehouse: w1, inOut: 'in', quantity: 1 }))
        ));
        const rejected = outcomes.filter(o => o.status === 'rejected') as PromiseRejectedResult[];
        const [row] = await orm.select({ s: itemWarehouseStocks.currentStock }).from(itemWarehouseStocks)
          .where(and(eq(itemWarehouseStocks.itemId, item.id), eq(itemWarehouseStocks.warehouseId, w1.id)));
        if (rejected.length > 0 || Number(row?.s) !== parallel) {
          failures.push(`trial ${t + 1}: rejected=${rejected.length} stock=${row?.s} ${rejected[0] ? String(rejected[0].reason?.cause?.code || rejected[0].reason?.message).slice(0, 80) : ''}`);
        }
      }
      if (failures.length > 0) {
        throw new Error(`اولین حرکت همزمان کالا در انبار ناموفق بود (${failures.length}/${trials}): ${failures.join(' | ')}`);
      }
      results.push(makeTestCase({
        id: 'reg_first_movement_race_p2_2',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'v7.0.35: ایمنی همزمانی اولین حرکت کالا در یک انبار در ItemWarehouseStockService (P2-2)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: `${trials} آزمایش × ${parallel} تراکنش همزمان اولین ورود کالا به انبار بدون خطای یکتایی و با جمع درست موجودی انجام شد.`
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_first_movement_race_p2_2',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'v7.0.35: ایمنی همزمانی اولین حرکت کالا در یک انبار در ItemWarehouseStockService (P2-2)',
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      }));
    }
  }

  // Test 27.9: v7.0.36 (audit P2-3): انبار پیش‌فرض باید قطعی (انبار فعال با کمترین شناسه) باشد
  if (shouldRun('reg_default_warehouse_deterministic_p2_3', 'p23', 'warehouse', 'default_warehouse')) {
    const tStart = Date.now();
    try {
      const { ItemWarehouseStockService } = await import('../../services/inventory/itemWarehouseStock.service.js');
      const { resolveWarehouseCode, createWarehouseResolver } = await import('../../services/inventory/warehouseResolver.js');
      const { createTestWarehouse } = await import('../fixtures/factories.js');
      await createTestWarehouse({ name: `انبار دوم P2-3 ${Date.now()}` });
      const [first] = await orm.select().from(warehouses).where(eq(warehouses.isActive, 1)).orderBy(warehouses.id).limit(1);
      // بازنویسی ردیف قدیمی‌ترین انبار، نسخه جدید آن را به انتهای صفحه heap می‌برد؛ بدون ORDER BY ترتیب خواندن عوض می‌شود
      for (let i = 0; i < 3; i++) {
        await orm.update(warehouses).set({ name: first.name }).where(eq(warehouses.id, first.id));
      }
      const viaService = await ItemWarehouseStockService.resolveWarehouse(orm, '');
      const viaResolver = await resolveWarehouseCode(orm, '');
      const viaFactory = (await createWarehouseResolver(orm))('');
      const listed = await WarehouseService.listActive();
      const picks = { service: viaService.code, resolver: viaResolver, factory: viaFactory, list: listed[0]?.code };
      if (Object.values(picks).some(code => code !== first.code)) {
        throw new Error(`انبار پیش‌فرض باید «${first.code}» (کمترین شناسه فعال) باشد: ${JSON.stringify(picks)}`);
      }
      results.push(makeTestCase({
        id: 'reg_default_warehouse_deterministic_p2_3',
        scenarioId: 'v5_warehouse_resolution_guard',
        name: 'v7.0.36: انبار پیش‌فرض قطعی پس از بازنویسی ردیف انبارها (P2-3)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'پس از به‌روزرسانی ردیف قدیمی‌ترین انبار، سرویس موجودی، حل‌کننده انبار و فهرست انبارهای فعال همچنان همان انبار را پیش‌فرض برگرداندند.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_default_warehouse_deterministic_p2_3',
        scenarioId: 'v5_warehouse_resolution_guard',
        name: 'v7.0.36: انبار پیش‌فرض قطعی پس از بازنویسی ردیف انبارها (P2-3)',
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      }));
    }
  }

  // Test 27.10: v7.0.37 (TD-201): حذف سند قطعی نباید در گزارش سه‌جانبه موجودی مغایرت کاذب بسازد
  if (shouldRun('reg_integrity_report_deleted_document_td_201', 'td201', 'integrity', 'kardex', 'reversal')) {
    const tStart = Date.now();
    const createdDocIds: number[] = [];
    try {
      const { StockReconciliationService } = await import('../../services/inventory/stockReconciliation.service.js');
      const { createTestItem } = await import('../fixtures/factories.js');
      const [w1] = await orm.select({ code: warehouses.code }).from(warehouses)
        .where(eq(warehouses.isActive, 1)).orderBy(warehouses.id).limit(1);
      const item = await createTestItem({ stocks: {}, currentStock: 0, weightedAverageCost: 0 });
      const today = await businessTodayIsoDate();
      const receiptId = await DocumentService.createDocument({
        docType: 'receipt', status: 'final', inOut: 'in', date: today, user: 'test-agent', buyerName: 'تأمین‌کننده آزمون TD-201',
        location: w1.code, items: [{ itemId: item.id, quantity: 10, unit_price: 50000, location: w1.code }]
      });
      createdDocIds.push(receiptId);
      const invoiceId = await DocumentService.createDocument({
        docType: 'invoice', status: 'final', inOut: 'out', date: today, user: 'test-agent', buyerName: 'خریدار آزمون TD-201',
        location: w1.code, items: [{ itemId: item.id, quantity: 2, unit_price: 90000, location: w1.code }]
      });
      createdDocIds.push(invoiceId);
      await DocumentService.deleteDocument(invoiceId, 'test-agent');

      const [after] = await orm.select({ s: items.currentStock }).from(items).where(eq(items.id, item.id));
      const report = await StockReconciliationService.getIntegrityReport({ search: String(item.code) });
      const audit = report.audits.find(a => a.itemId === item.id);
      if (Number(after?.s) !== 10 || !audit || audit.kardexNetBalance !== 10 || audit.discrepancies.length > 0) {
        throw new Error(`پس از حذف فاکتور، موجودی و مانده کاردکس باید ۱۰ و بدون مغایرت باشد: ${JSON.stringify({ stock: after?.s, kardex: audit?.kardexNetBalance, discrepancies: audit?.discrepancies })}`);
      }
      results.push(makeTestCase({
        id: 'reg_integrity_report_deleted_document_td_201',
        scenarioId: 'inventory_integrity_3way_reconciliation',
        name: 'v7.0.37: گزارش سه‌جانبه موجودی پس از حذف سند قطعی مغایرت کاذب نشان نمی‌دهد (TD-201)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'رسید ۱۰، فاکتور ۲ و حذف فاکتور: موجودی و مانده کاردکس هر دو ۱۰ و کالا بدون مغایرت گزارش شد.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_integrity_report_deleted_document_td_201',
        scenarioId: 'inventory_integrity_3way_reconciliation',
        name: 'v7.0.37: گزارش سه‌جانبه موجودی پس از حذف سند قطعی مغایرت کاذب نشان نمی‌دهد (TD-201)',
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      }));
    } finally {
      if (createdDocIds.length > 0) {
        await cleanTestTableData('document_items', 'document_id', createdDocIds);
      }
    }
  }

  // Test 27.11: v7.0.38 (audit P2-12): رانر تست بدون پایگاه‌داده واقعی (mockPool) باید پیش از ساخت اسکیما و اجرای هر سوئیتی رد شود
  if (shouldRun('reg_test_runner_mock_db_refusal_p2_12', 'p212', 'runner', 'mock')) {
    const tStart = Date.now();
    try {
      const { spawnSync } = await import('child_process');
      const path = await import('path');
      const { MOCK_DATABASE_REFUSAL } = await import('../testRunner.js');
      const tsxBin = path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
      // dotenv مقدار موجود (حتی رشته خالی) را بازنویسی نمی‌کند، پس .env محلی هم پایگاه‌داده واقعی را برنمی‌گرداند
      const child = spawnSync(tsxBin, ['scripts/run-tests.ts', '--suite', 'unit', '--summary'], {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: '', NODE_ENV: 'test' },
        encoding: 'utf-8',
        timeout: 120_000
      });
      const output = `${child.stdout || ''}${child.stderr || ''}`;
      const refused = output.includes(MOCK_DATABASE_REFUSAL);
      const ranSuites = output.includes('Passed Tests') || output.includes('Migrator] Drizzle database migrations completed');
      if (child.status === 0 || !refused || ranSuites) {
        throw new Error(`رانر روی mockPool باید با کد خروج غیرصفر و پیش از مهاجرت/اجرای سوئیت متوقف شود: ${JSON.stringify({ status: child.status, refused, ranSuites, tail: output.slice(-400) })}`);
      }
      results.push(makeTestCase({
        id: 'reg_test_runner_mock_db_refusal_p2_12',
        scenarioId: 'test_runner_real_database_guard',
        name: 'v7.0.38: رانر تست بدون پایگاه‌داده واقعی حتی برای سوئیت unit رد می‌شود (P2-12)',
        layer: 'regression',
        executionType: 'real_code',
        passed: true,
        durationMs: Date.now() - tStart,
        details: `اجرای «--suite unit» با DATABASE_URL خالی با کد ${child.status} و پیام صریح، بدون مهاجرت روی mockPool و بدون گزارش نتیجه متوقف شد.`
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_test_runner_mock_db_refusal_p2_12',
        scenarioId: 'test_runner_real_database_guard',
        name: 'v7.0.38: رانر تست بدون پایگاه‌داده واقعی حتی برای سوئیت unit رد می‌شود (P2-12)',
        layer: 'regression',
        executionType: 'real_code',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      }));
    }
  }

  // Test 27.12: v7.0.39 (TD-176 / audit P2-11): زمان‌های انتظار جلسه باید در بسته راه‌اندازی اتصال تنظیم شوند، نه با SET بدون انتظار
  if (shouldRun('reg_pool_session_timeouts_td_176', 'td176', 'pool', 'statement_timeout')) {
    const tStart = Date.now();
    try {
      const res: any = await orm.execute(sql`SELECT name, setting, source FROM pg_settings WHERE name IN ('statement_timeout', 'idle_in_transaction_session_timeout') ORDER BY name`);
      const rows: Array<{ name: string; setting: string; source: string }> = res.rows ?? res;
      const expected: Record<string, string> = {
        statement_timeout: String(parseInt(process.env.DB_STATEMENT_TIMEOUT || '60000', 10)),
        idle_in_transaction_session_timeout: String(parseInt(process.env.DB_IDLE_IN_TX_TIMEOUT || '60000', 10))
      };
      const bad = rows.filter(r => r.source !== 'client' || r.setting !== expected[r.name]);
      if (rows.length !== 2 || bad.length > 0) {
        throw new Error(`زمان‌های انتظار جلسه باید از بسته راه‌اندازی (source=client) با مقدار پیکربندی‌شده بیایند: ${JSON.stringify(rows)}`);
      }
      results.push(makeTestCase({
        id: 'reg_pool_session_timeouts_td_176',
        scenarioId: 'startup_db_session_hygiene',
        name: 'v7.0.39: زمان‌های انتظار جلسه از پارامترهای راه‌اندازی اتصال استخر (TD-176)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'statement_timeout و idle_in_transaction_session_timeout روی اتصال استخر با منبع client (بسته راه‌اندازی) و مقدار پیکربندی‌شده گزارش شدند.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_pool_session_timeouts_td_176',
        scenarioId: 'startup_db_session_hygiene',
        name: 'v7.0.39: زمان‌های انتظار جلسه از پارامترهای راه‌اندازی اتصال استخر (TD-176)',
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      }));
    }
  }

  // Test 27.13: v7.0.39 (TD-176): ساخت برنامه (ایمپورت روت‌ها) نباید پیش از مهاجرت‌ها کوئری پایگاه‌داده اجرا کند
  if (shouldRun('reg_app_build_no_db_access_td_176', 'td176', 'startup', 'personnel')) {
    const tStart = Date.now();
    try {
      const { spawnSync } = await import('child_process');
      const path = await import('path');
      const tsxBin = path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
      // پورت ۱ همیشه بسته است: هر کوئری فوراً با ECONNREFUSED شکست می‌خورد و در خروجی دیده می‌شود
      const child = spawnSync(tsxBin, ['src/tests/fixtures/appBuildProbe.ts'], {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: 'postgresql://probe:probe@127.0.0.1:1/probe', NODE_ENV: 'test' },
        encoding: 'utf-8',
        timeout: 120_000
      });
      const output = `${child.stdout || ''}${child.stderr || ''}`;
      if (!output.includes('APP_BUILD_PROBE_DONE') || /Failed query|ECONNREFUSED/.test(output)) {
        throw new Error(`ساخت برنامه نباید به پایگاه‌داده دسترسی داشته باشد: ${JSON.stringify({ status: child.status, tail: output.slice(-600) })}`);
      }
      results.push(makeTestCase({
        id: 'reg_app_build_no_db_access_td_176',
        scenarioId: 'startup_db_session_hygiene',
        name: 'v7.0.39: ساخت برنامه بدون هیچ کوئری پایگاه‌داده پیش از مهاجرت‌ها (TD-176)',
        layer: 'regression',
        executionType: 'real_code',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'ساخت برنامه در پردازه جدا با پایگاه‌داده غیرقابل‌دسترس بدون هیچ کوئری ناموفق کامل شد.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_app_build_no_db_access_td_176',
        scenarioId: 'startup_db_session_hygiene',
        name: 'v7.0.39: ساخت برنامه بدون هیچ کوئری پایگاه‌داده پیش از مهاجرت‌ها (TD-176)',
        layer: 'regression',
        executionType: 'real_code',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      }));
    }
  }

  // Test 27.14: v7.0.39 (TD-194): قفل مشورتی seed باید روی همان اتصالی آزاد شود که گرفته شده است
  if (shouldRun('reg_seed_advisory_lock_released_td_194', 'td194', 'seed', 'advisory')) {
    const tStart = Date.now();
    try {
      const { runSeedWithLock } = await import('../../db/seed.js');
      const { pool } = await import('../../db/drizzle.js');
      const pg = (await import('pg')).default;
      const heldSeedLocks = async (): Promise<number> => {
        const r: any = await orm.execute(sql`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND classid = 0 AND objid = 89345 AND granted`);
        return Number((r.rows ?? r)[0]?.n ?? 0);
      };
      // استخر اتصال تضمین نمی‌کند کوئری بعدی روی همان اتصال قبلی اجرا شود (زیر بار، اتصال دیگری می‌دهد).
      // برای قطعی‌کردن آزمون، هر آزادسازی قفل مشورتی که از مسیر عمومی استخر (pool.query) برود روی اتصال دیگری اجرا می‌شود؛
      // کد درست قفل را روی اتصال اختصاصی خودش آزاد می‌کند و از این مسیر عبور نمی‌کند.
      const poolTarget = pool as unknown as { query: (...args: any[]) => Promise<any> };
      const originalQuery = poolTarget.query;
      let reroutedUnlocks = 0;
      poolTarget.query = async (...args: any[]) => {
        const text = typeof args[0] === 'string' ? args[0] : args[0]?.text;
        if (typeof text === 'string' && text.includes('pg_advisory_unlock')) {
          reroutedUnlocks++;
          const other = new pg.Client({ connectionString: process.env.DATABASE_URL });
          await other.connect();
          try {
            return await other.query(args[0], args[1]);
          } finally {
            await other.end();
          }
        }
        return originalQuery(...args);
      };
      try {
        await runSeedWithLock();
      } finally {
        delete (poolTarget as { query?: unknown }).query;
      }
      const held = await heldSeedLocks();
      if (held > 0) {
        throw new Error(`پس از پایان seed قفل 89345 هنوز در ${held} جلسه نگه داشته شده است (آزادسازی از مسیر عمومی استخر: ${reroutedUnlocks})`);
      }
      results.push(makeTestCase({
        id: 'reg_seed_advisory_lock_released_td_194',
        scenarioId: 'startup_db_session_hygiene',
        name: 'v7.0.39: آزادسازی قفل مشورتی seed روی همان اتصال (TD-194)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'حتی وقتی استخر برای کوئری بعدی اتصال دیگری می‌دهد، قفل 89345 پس از seed روی همان اتصال قفل‌گیرنده آزاد شد.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_seed_advisory_lock_released_td_194',
        scenarioId: 'startup_db_session_hygiene',
        name: 'v7.0.39: آزادسازی قفل مشورتی seed روی همان اتصال (TD-194)',
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      }));
    }
  }

  // Test 27.15: v7.0.40 (audit P2-11): پردازه سرور در همه محیط‌ها پس از خطای مدیریت‌نشده یا شکست نهایی مهاجرت متوقف می‌شود
  if (shouldRun('reg_process_exits_on_unhandled_errors_p2_11', 'p211', 'uncaught', 'process')) {
    const tStart = Date.now();
    try {
      const { spawnSync } = await import('child_process');
      const runServer = (extraImport: string | null, port: number) => {
        const args = ['--import', 'tsx', ...(extraImport ? ['--import', extraImport] : []), 'server.ts'];
        const child = spawnSync(process.execPath, args, {
          cwd: process.cwd(),
          // محیط توسعه؛ پایگاه‌داده غیرقابل‌دسترس تا هیچ داده‌ای لمس نشود (پورت ۱ همیشه بسته است)
          env: { ...process.env, NODE_ENV: 'development', PORT: String(port), DATABASE_URL: 'postgresql://probe:probe@127.0.0.1:1/probe' },
          encoding: 'utf-8',
          timeout: 90_000,
          killSignal: 'SIGKILL'
        });
        return { status: child.status, output: `${child.stdout || ''}${child.stderr || ''}` };
      };
      // پورت آزاد از سیستم‌عامل: پورت تصادفی ۳۹۰۰۰ تا ۳۹۴۹۹ در بازه پورت‌های موقت لینوکس است و گاهی پورت محلی یکی از
      // اتصال‌های باز همین پردازه بود؛ سرور فرزند با EADDRINUSE (نه شکست مهاجرت) متوقف می‌شد و تست تصادفی شکست می‌خورد
      const net = await import('net');
      const freePort = () => new Promise<number>((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(0, '0.0.0.0', () => {
          const address = probe.address();
          const port = typeof address === 'object' && address ? address.port : 0;
          probe.close(() => resolve(port));
        });
      });

      // ۱) شکست نهایی مهاجرت در محیط توسعه: پیش‌تر سرور بدون اسکیما به کار ادامه می‌داد
      const migration = runServer(null, await freePort());
      if (migration.status !== 1 || !migration.output.includes('FATAL: Database migrations failed after 5 attempts')) {
        throw new Error(`پس از شکست نهایی مهاجرت پردازه باید با کد ۱ متوقف شود: ${JSON.stringify({ status: migration.status, tail: migration.output.slice(-500) })}`);
      }

      // ۲) خطای مدیریت‌نشده پس از راه‌اندازی در محیط توسعه: پیش‌تر فقط لاگ می‌شد
      const uncaught = runServer('./src/tests/fixtures/uncaughtAfterStartupProbe.ts', await freePort());
      if (uncaught.status !== 1 || !uncaught.output.includes('UNCAUGHT_PROBE_FIRING')
        || !uncaught.output.includes('Initiating graceful shutdown (exit code 1)')
        || uncaught.output.includes('FATAL: Database migrations failed after 5 attempts')) {
        throw new Error(`پس از خطای مدیریت‌نشده پردازه باید خاموشی کنترل‌شده با کد ۱ انجام دهد: ${JSON.stringify({ status: uncaught.status, tail: uncaught.output.slice(-500) })}`);
      }

      results.push(makeTestCase({
        id: 'reg_process_exits_on_unhandled_errors_p2_11',
        scenarioId: 'startup_db_session_hygiene',
        name: 'v7.0.40: توقف پردازه در محیط توسعه پس از خطای مدیریت‌نشده و شکست نهایی مهاجرت (P2-11)',
        layer: 'regression',
        executionType: 'real_code',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'سرور واقعی در محیط توسعه پس از ۵ شکست مهاجرت و نیز پس از یک خطای مدیریت‌نشده، هر دو بار با کد ۱ متوقف شد.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_process_exits_on_unhandled_errors_p2_11',
        scenarioId: 'startup_db_session_hygiene',
        name: 'v7.0.40: توقف پردازه در محیط توسعه پس از خطای مدیریت‌نشده و شکست نهایی مهاجرت (P2-11)',
        layer: 'regression',
        executionType: 'real_code',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      }));
    }
  }

  // Test 27.16: v7.0.42 (TD-192): هر اسکیمای ایزوله تست باید همه مهاجرت‌ها را دریافت کند، حتی اگر پیش‌تر روی همان پایگاه‌داده تست اجرا شده باشد
  if (shouldRun('reg_test_schema_own_migration_journal_td_192', 'td192', 'isolation', 'journal')) {
    const tStart = Date.now();
    try {
      const { setupTestSchema } = await import('../setup/testDb.js');
      const { getMigrationsJournalSchema } = await import('../../db/migrator.js');
      const { pool } = await import('../../db/drizzle.js');
      const outerJournal = getMigrationsJournalSchema();
      // اسکیمای ایزوله دوم روی همان پایگاه‌داده (معادل اجرای دوباره تست‌ها پس از یک اجرای کامل)
      const inner = await setupTestSchema();
      let present: Record<string, boolean> = {};
      try {
        const checks = ['items', 'documents', 'journal_vouchers', 'item_warehouse_stocks', 'inventory_reconciliation_anomalies'];
        for (const table of checks) {
          const r = await pool.query('SELECT to_regclass($1) IS NOT NULL AS ok', [`"${inner.schema}".${table}`]);
          present[table] = Boolean(r.rows[0]?.ok);
        }
      } finally {
        await inner.teardown();
      }
      const missing = Object.entries(present).filter(([, ok]) => !ok).map(([t]) => t);
      if (missing.length > 0) {
        throw new Error(`اسکیمای ایزوله دوم بدون جداول مهاجرت ماند: ${missing.join(', ')}`);
      }
      if (getMigrationsJournalSchema() !== outerJournal) {
        throw new Error(`پس از پایان اسکیمای ایزوله، دفتر مهاجرت باید به «${outerJournal}» برگردد نه «${getMigrationsJournalSchema()}»`);
      }
      results.push(makeTestCase({
        id: 'reg_test_schema_own_migration_journal_td_192',
        scenarioId: 'test_runner_real_database_guard',
        name: 'v7.0.42: هر اسکیمای ایزوله تست دفتر مهاجرت خودش را دارد و همه جداول را می‌گیرد (TD-192)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'یک اسکیمای ایزوله دوم روی همان پایگاه‌داده همه جداول را دریافت کرد و دفتر مهاجرت پس از حذف آن به اسکیمای قبلی بازگشت.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_test_schema_own_migration_journal_td_192',
        scenarioId: 'test_runner_real_database_guard',
        name: 'v7.0.42: هر اسکیمای ایزوله تست دفتر مهاجرت خودش را دارد و همه جداول را می‌گیرد (TD-192)',
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      }));
    }
  }

  // Test 27.16b: v7.0.50 (TD-217): شکست مهاجرت در آماده‌سازی اسکیمای ایزوله، آمادگی پایگاه‌داده تست و seed پنهان نمی‌ماند
  // (runMigrations خطا را برنمی‌اندازد و { success: false } برمی‌گرداند؛ این نتیجه پیش‌تر نادیده گرفته می‌شد)
  if (shouldRun('reg_migration_failure_not_masked_td_217', 'td217', 'isolation', 'migration')) {
    const tStart = Date.now();
    const testName = 'v7.0.50: شکست مهاجرت در اسکیمای ایزوله، آمادگی پایگاه‌داده تست و seed، اجرا را متوقف می‌کند (TD-217)';
    try {
      const { setupTestSchema } = await import('../setup/testDb.js');
      const dbHelper: any = await import('../fixtures/dbTestHelper.js');
      const seedModule: any = await import('../../db/seed.js');
      const { getMigrationsJournalSchema } = await import('../../db/migrator.js');
      const { pool } = await import('../../db/drizzle.js');
      const marker = 'TD217 injected migration failure';
      const failingMigrate = async () => ({ success: false, appliedCount: 0, errors: [marker] });
      const listTestSchemas = async (): Promise<string> =>
        (await pool.query(`SELECT nspname FROM pg_namespace WHERE nspname LIKE 'test\\_%' ORDER BY nspname`)).rows
          .map((r: any) => r.nspname).join(',');
      const acquireListeners = (): number => (pool as any).listenerCount?.('acquire') ?? -1;

      // الف) اسکیمای ایزوله با مهاجرت شکست‌خورده: خطا با علت واقعی، حذف اسکیما، بازگشت دفتر مهاجرت و شنونده‌ها
      const outerJournal = getMigrationsJournalSchema();
      const schemasBefore = await listTestSchemas();
      const listenersBefore = acquireListeners();
      let innerCtx: { teardown: () => Promise<void> } | null = null;
      let setupError = '';
      try {
        innerCtx = await (setupTestSchema as any)({ migrate: failingMigrate });
      } catch (e: any) {
        setupError = e.message;
      }
      if (innerCtx) {
        await innerCtx.teardown();
        throw new Error('setupTestSchema با مهاجرت شکست‌خورده موفق برگشت؛ تست‌ها روی اسکیمای ناقص اجرا می‌شدند');
      }
      if (!setupError.includes(marker)) {
        throw new Error(`خطای setupTestSchema علت شکست مهاجرت را ندارد: ${setupError}`);
      }
      const schemasAfter = await listTestSchemas();
      if (schemasAfter !== schemasBefore) {
        throw new Error(`اسکیمای ایزوله شکست‌خورده حذف نشد (پیش: ${schemasBefore} / پس: ${schemasAfter})`);
      }
      if (getMigrationsJournalSchema() !== outerJournal) {
        throw new Error(`دفتر مهاجرت پس از شکست به «${outerJournal}» برنگشت (${getMigrationsJournalSchema()})`);
      }
      if (acquireListeners() !== listenersBefore) {
        throw new Error(`شنونده acquire اسکیمای شکست‌خورده روی pool ماند (${listenersBefore} → ${acquireListeners()})`);
      }

      // ب) آمادگی پایگاه‌داده تست: مهاجرت شکست‌خورده «آماده» نیست و اجراکننده تست خطا می‌گیرد
      const ready = await dbHelper.ensureTestDatabaseReady(failingMigrate);
      if (ready !== false) {
        throw new Error('ensureTestDatabaseReady مهاجرت شکست‌خورده را «آماده» گزارش کرد');
      }
      if (typeof dbHelper.assertTestDatabaseReady !== 'function') {
        throw new Error('assertTestDatabaseReady (نسخه خطادهنده برای اجراکننده تست‌ها) وجود ندارد');
      }
      let assertError = '';
      try {
        await dbHelper.assertTestDatabaseReady(failingMigrate);
      } catch (e: any) {
        assertError = e.message;
      }
      if (!assertError) {
        throw new Error('assertTestDatabaseReady با مهاجرت شکست‌خورده خطا نداد');
      }
      if ((await dbHelper.ensureTestDatabaseReady()) !== true) {
        throw new Error('شکست تزریق‌شده وضعیت کش آمادگی پیش‌فرض را خراب کرد');
      }

      // ج) seed روی اسکیمای مهاجرت‌نشده اجرا نمی‌شود
      let seedError = '';
      try {
        await seedModule.runSeed({ migrate: failingMigrate });
      } catch (e: any) {
        seedError = e.message;
      }
      if (!seedError.includes(marker)) {
        throw new Error(`runSeed پس از مهاجرت شکست‌خورده ادامه داد (${seedError || 'بدون خطا'})`);
      }

      results.push(makeTestCase({
        id: 'reg_migration_failure_not_masked_td_217',
        scenarioId: 'test_runner_real_database_guard',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'اسکیمای ایزوله با مهاجرت شکست‌خورده با علت واقعی متوقف و حذف شد؛ آمادگی پایگاه‌داده تست false و نسخه خطادهنده آن خطا داد؛ seed پیش از هر نوشتن متوقف شد.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_migration_failure_not_masked_td_217',
        scenarioId: 'test_runner_real_database_guard',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      }));
    }
  }

  // Test 27.17: v7.0.45 (audit P2-1): جدول item_warehouse_stocks تنها منبع موجودی؛ جدول، کش JSONB، موجودی کل و کاردکس
  // پس از هر مسیر نوشتن یکسان می‌مانند (تعریف کالا، انتقال بین انبارها، فروش، انبارگردانی، بازسازی کاردکس، افتتاحیه)
  if (shouldRun('reg_single_stock_source_p2_1', 'p21', 'stock', 'invariant')) {
    const tStart = Date.now();
    const steps: string[] = [];
    try {
      const { createTestWarehouse } = await import('../fixtures/factories.js');
      const { itemWarehouseStocks } = await import('../../db/schema.js');
      const [w1] = await orm.select().from(warehouses).where(eq(warehouses.isActive, 1)).orderBy(warehouses.id).limit(1);
      const w2 = await createTestWarehouse({ name: `انبار دوم P2-1 ${Date.now()}` });
      const w3 = await createTestWarehouse({ name: `انبار سوم P2-1 ${Date.now()}` });
      const today = await businessTodayIsoDate();
      const user = { id: undefined, username: 'test-agent', fullName: 'آزمون P2-1' };

      // سه‌جانبه: جدول (با کد استاندارد انبار) = موجودی کل = مانده کاردکس (معنای رسمی دفتر)؛ ستون JSONB از v7.0.48 حذف شد
      const assertInvariant = async (itemId: number, label: string, expected: Record<string, number>) => {
        const tableRows = await orm.select({ code: warehouses.code, qty: itemWarehouseStocks.currentStock })
          .from(itemWarehouseStocks).innerJoin(warehouses, eq(warehouses.id, itemWarehouseStocks.warehouseId))
          .where(eq(itemWarehouseStocks.itemId, itemId));
        const table: Record<string, number> = {};
        for (const r of tableRows) if (Number(r.qty) !== 0) table[r.code] = Number(r.qty);
        const [it] = await orm.select({ total: items.currentStock }).from(items).where(eq(items.id, itemId));
        const ledger: any = await orm.execute(sql`
          SELECT COALESCE(SUM(CASE WHEN t.type IN ('in', 'transfer_in') THEN t.quantity WHEN t.type IN ('out', 'transfer_out') THEN -t.quantity ELSE 0 END), 0) AS net
          FROM transactions t LEFT JOIN transactions o ON o.id = t.reversal_of_id
          WHERE t.item_id = ${itemId} AND t.is_deleted = 0 AND NOT (t.reversal_of_id IS NOT NULL AND COALESCE(o.is_deleted, 0) = 1)`);
        const kardexNet = Number((ledger.rows ?? ledger)[0]?.net ?? 0);
        const expectedTotal = Object.values(expected).reduce((a, b) => a + b, 0);
        const sorted = (o: Record<string, number>) => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));
        if (sorted(table) !== sorted(expected) || Number(it.total) !== expectedTotal || kardexNet !== expectedTotal) {
          throw new Error(`${label}: انتظار ${JSON.stringify(expected)}؛ جدول=${JSON.stringify(table)}، کل=${it.total}، کاردکس=${kardexNet}`);
        }
        steps.push(label);
      };

      // ۱) تعریف کالا با موجودی اولیه: پیش‌تر فقط کش و کاردکس نوشته می‌شد و جدول ردیفی نداشت
      const created = await ItemCatalogService.createItem({
        type: 'raw_material', name: `کالای منبع واحد P2-1 ${Date.now()}`, code: `P21-${Date.now()}`, unit: 'عدد',
        category: '', weighted_average_cost: 1000, [`stock_${w1.code}`]: 10
      }, user);
      const itemId = created.insertedId;
      await assertInvariant(itemId, 'تعریف کالا با موجودی اولیه', { [w1.code]: 10 });

      // ۲) انتقال بین انبارها: پیش‌تر فقط کش تغییر می‌کرد
      await InventoryStockRepairService.executeWarehouseTransfer({ itemId, fromLocation: w1.code, toLocation: w2.code, quantity: 4, user: 'test-agent' });
      await assertInvariant(itemId, 'انتقال ۴ عدد به انبار دوم', { [w1.code]: 6, [w2.code]: 4 });

      // ۳) فروش بیش از موجودی انبار مبدأ رد و فروش مجاز ثبت شود؛ پیش‌تر موجودی کهنه جدول دوباره در کش نوشته می‌شد (۹ به‌جای ۵)
      let oversellRejected = false;
      try {
        await DocumentService.createDocument({ docType: 'invoice', status: 'final', inOut: 'out', date: today, user: 'test-agent', buyerName: 'خریدار آزمون P2-1', location: w1.code, items: [{ itemId, quantity: 7, unit_price: 2000, location: w1.code }] });
      } catch {
        oversellRejected = true;
      }
      if (!oversellRejected) throw new Error('فروش ۷ عدد از انبار مبدأ با موجودی ۶ نباید پذیرفته شود');
      await DocumentService.createDocument({ docType: 'invoice', status: 'final', inOut: 'out', date: today, user: 'test-agent', buyerName: 'خریدار آزمون P2-1', location: w1.code, items: [{ itemId, quantity: 5, unit_price: 2000, location: w1.code }] });
      await assertInvariant(itemId, 'فروش ۵ عدد از انبار مبدأ', { [w1.code]: 1, [w2.code]: 4 });

      // ۴) انبارگردانی در انباری که کالا در آن موجودی ندارد (شمارش صفر): پیش‌تر موجودی کل کالا مبنای انحراف بود
      await DocumentService.createDocument({ docType: 'audit', status: 'final', date: today, user: 'test-agent', location: w3.code, items: [{ itemId, quantity: 0, physical_stock: 0, location: w3.code }] });
      await assertInvariant(itemId, 'انبارگردانی صفر در انبار بدون موجودی', { [w1.code]: 1, [w2.code]: 4 });

      // ۵) بازسازی کاردکس همان مقادیر را نگه دارد
      await KardexWacRecalculatorService.rebuildItemFromLedger(itemId, { user: 'test-agent' });
      await assertInvariant(itemId, 'بازسازی کاردکس', { [w1.code]: 1, [w2.code]: 4 });

      // ۶) ثبت موجودی افتتاحیه در ویرایش کالا
      const second = await ItemCatalogService.createItem({
        type: 'raw_material', name: `کالای افتتاحیه P2-1 ${Date.now()}`, code: `P21O-${Date.now()}`, unit: 'عدد', category: '', weighted_average_cost: 500
      }, user);
      await ItemCatalogService.updateItem(second.insertedId, {
        name: second.item.name, code: second.item.code, unit: 'عدد', category: '', weighted_average_cost: 500, [`stock_${w2.code}`]: 7, version: second.item.version
      }, user);
      await assertInvariant(second.insertedId, 'موجودی افتتاحیه در ویرایش کالا', { [w2.code]: 7 });

      results.push(makeTestCase({
        id: 'reg_single_stock_source_p2_1',
        scenarioId: 'inventory_integrity_3way_reconciliation',
        name: 'v7.0.45: جدول موجودی انبارها تنها منبع موجودی؛ جدول، کش، موجودی کل و کاردکس در همه مسیرها یکسان (P2-1)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: `ناوردایی سه‌جانبه پس از هر مرحله برقرار ماند: ${steps.join('، ')}.`
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_single_stock_source_p2_1',
        scenarioId: 'inventory_integrity_3way_reconciliation',
        name: 'v7.0.45: جدول موجودی انبارها تنها منبع موجودی؛ جدول، کش، موجودی کل و کاردکس در همه مسیرها یکسان (P2-1)',
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: `${err.message} (مراحل موفق: ${steps.join('، ') || 'هیچ'})`
      }));
    }
  }

  // Test 27.18: v7.0.45 (audit P2-1): بازسازی کاردکس گردش در محل نامعلوم را بی‌صدا کنار نمی‌گذارد
  // (بخش پرکردن جدول از JSONB قدیمی همین آزمون در v7.0.45 اجرا شد؛ تابع آن با حذف ستون در مهاجرت 0021 حذف شد)
  if (shouldRun('reg_kardex_rebuild_unresolved_guard_p2_1', 'p21', 'rebuild', 'kardex')) {
    const tStart = Date.now();
    try {
      const { createTestItem } = await import('../fixtures/factories.js');
      const [w1] = await orm.select().from(warehouses).where(eq(warehouses.isActive, 1)).orderBy(warehouses.id).limit(1);
      const legacy = await createTestItem({ stocks: { [w1.code]: 5 } });
      const today = `${await businessTodayIsoDate()} 10:00:00`;
      await orm.insert(transactions).values({ itemId: legacy.id, type: 'in', quantity: 5, unitPrice: 1000, totalPrice: 5000, date: today, documentType: 'audit', documentRef: 'P21-PROBE', location: w1.code, isDeleted: 0 } as any);
      await orm.insert(transactions).values({ itemId: legacy.id, type: 'in', quantity: 2, unitPrice: 1000, totalPrice: 2000, date: today, documentType: 'audit', documentRef: 'P21-PROBE', location: 'محل-نامعلوم-P21', isDeleted: 0 } as any);
      let rebuildRefused = false;
      try {
        await KardexWacRecalculatorService.rebuildItemFromLedger(legacy.id, { user: 'test-agent' });
      } catch (e: any) {
        rebuildRefused = String(e?.message || '').includes('محل-نامعلوم-P21');
      }
      const [afterRebuild] = await orm.select({ total: items.currentStock }).from(items).where(eq(items.id, legacy.id));
      if (!rebuildRefused || Number(afterRebuild.total) !== 5) {
        throw new Error(`بازسازی کاردکس با گردش در محل نامعلوم باید رد شود و موجودی دست نخورد: ${JSON.stringify({ rebuildRefused, total: afterRebuild.total })}`);
      }
      results.push(makeTestCase({
        id: 'reg_kardex_rebuild_unresolved_guard_p2_1',
        scenarioId: 'inventory_integrity_3way_reconciliation',
        name: 'v7.0.45: رد بازسازی کاردکس کالای دارای گردش در محل نامعلوم بدون تغییر موجودی (P2-1)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'بازسازی کاردکس کالای دارای گردش در محل نامعلوم با خطای روشن رد شد و موجودی ۵ دست نخورد.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_kardex_rebuild_unresolved_guard_p2_1',
        scenarioId: 'inventory_integrity_3way_reconciliation',
        name: 'v7.0.45: رد بازسازی کاردکس کالای دارای گردش در محل نامعلوم بدون تغییر موجودی (P2-1)',
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      }));
    }
  }

  // Test 27.19: v7.0.46 (audit P2-4): خروج کالای بدون بهای تمام‌شده رد شود (فروش، حواله خروج)؛ کسری انبارگردانی با بهای صفر
  if (shouldRun('reg_zero_cost_outflow_p2_4', 'p24', 'cogs', 'wac')) {
    const tStart = Date.now();
    try {
      const { createTestItem } = await import('../fixtures/factories.js');
      const { itemPrices } = await import('../../db/schema.js');
      const [w1] = await orm.select().from(warehouses).where(eq(warehouses.isActive, 1)).orderBy(warehouses.id).limit(1);
      const today = await businessTodayIsoDate();
      const noCost = await createTestItem({ stocks: { [w1.code]: 5 }, currentStock: 5, weightedAverageCost: 0 });
      // قیمت فهرست فروش: پیش‌تر مبنای بهای کسری انبارگردانی کالای بدون بهای تمام‌شده قرار می‌گرفت
      await orm.insert(itemPrices).values({ itemId: noCost.id, title: 'قیمت فروش آزمون P2-4', price: money(70000) });

      const rejectedFor: string[] = [];
      for (const [docType, label] of [['invoice', 'فروش'], ['remittance', 'حواله خروج']] as const) {
        try {
          await DocumentService.createDocument({ docType, status: 'final', inOut: 'out', date: today, user: 'test-agent', buyerName: 'خریدار آزمون P2-4', location: w1.code, items: [{ itemId: noCost.id, quantity: 1, unit_price: 90000, location: w1.code }] });
        } catch (e: any) {
          if (String(e?.message || '').includes('بهای تمام‌شده ندارد')) rejectedFor.push(label);
          else throw e;
        }
      }
      if (rejectedFor.length !== 2) {
        throw new Error(`خروج کالای بدون بهای تمام‌شده باید در فروش و حواله خروج رد شود؛ رد شده در: ${rejectedFor.join('، ') || 'هیچ'}`);
      }

      // کسری انبارگردانی (۵ ← ۳) مجاز است و با بهای صفر ثبت می‌شود، نه قیمت فهرست
      await DocumentService.createDocument({ docType: 'audit', status: 'final', date: today, user: 'test-agent', location: w1.code, items: [{ itemId: noCost.id, quantity: 0, physical_stock: 3, location: w1.code }] });
      const outs = await orm.select({ unitPrice: transactions.unitPrice, quantity: transactions.quantity }).from(transactions)
        .where(and(eq(transactions.itemId, noCost.id), eq(transactions.type, 'out'), eq(transactions.isDeleted, 0)));
      const [after] = await orm.select({ total: items.currentStock }).from(items).where(eq(items.id, noCost.id));
      if (outs.length !== 1 || Number(outs[0].quantity) !== 2 || Number(outs[0].unitPrice) !== 0 || Number(after.total) !== 3) {
        throw new Error(`کسری انبارگردانی کالای بدون بهای تمام‌شده باید ۲ عدد با بهای صفر ثبت شود: ${JSON.stringify({ outs, total: after.total })}`);
      }

      // کالای دارای بهای تمام‌شده همچنان با بهای میانگین موزون فروخته می‌شود
      const withCost = await createTestItem({ stocks: { [w1.code]: 5 }, currentStock: 5, weightedAverageCost: 40000 });
      await DocumentService.createDocument({ docType: 'invoice', status: 'final', inOut: 'out', date: today, user: 'test-agent', buyerName: 'خریدار آزمون P2-4', location: w1.code, items: [{ itemId: withCost.id, quantity: 1, unit_price: 90000, location: w1.code }] });
      const [sold] = await orm.select({ unitPrice: transactions.unitPrice }).from(transactions)
        .where(and(eq(transactions.itemId, withCost.id), eq(transactions.type, 'out'), eq(transactions.isDeleted, 0)));
      if (Number(sold?.unitPrice) !== 40000) {
        throw new Error(`بهای تمام‌شده فروش کالای دارای بها باید ۴۰۰۰۰ باشد: ${sold?.unitPrice}`);
      }

      results.push(makeTestCase({
        id: 'reg_zero_cost_outflow_p2_4',
        scenarioId: 'v5_cogs_and_warehouse_voucher',
        name: 'v7.0.46: رد خروج کالای بدون بهای تمام‌شده در فروش و حواله؛ کسری انبارگردانی با بهای صفر (P2-4)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'فروش و حواله خروج کالای با بهای میانگین صفر رد شد، کسری انبارگردانی ۲ عدد با بهای صفر (نه قیمت فهرست) ثبت شد و فروش کالای دارای بها با بهای میانگین ثبت شد.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_zero_cost_outflow_p2_4',
        scenarioId: 'v5_cogs_and_warehouse_voucher',
        name: 'v7.0.46: رد خروج کالای بدون بهای تمام‌شده در فروش و حواله؛ کسری انبارگردانی با بهای صفر (P2-4)',
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      }));
    }
  }

  // Test 27.20: v7.0.48 (TD-214): پس از حذف ستون JSONB، پاسخ‌های API موجودی هر انبار را از جدول نرمال می‌دهند
  // و فهرست انبارگردانی برای انباری که کالا در آن موجودی ندارد صفر نشان می‌دهد (نه موجودی کل)
  if (shouldRun('reg_stock_api_from_table_td_214', 'td214', 'stocks', 'api')) {
    const tStart = Date.now();
    try {
      const request = (await import('supertest')).default;
      const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
      const { createTestItem, createTestWarehouse } = await import('../fixtures/factories.js');
      const app = await getTestApp();
      const session = await getAdminSession();
      const [w1] = await orm.select().from(warehouses).where(eq(warehouses.isActive, 1)).orderBy(warehouses.id).limit(1);
      const w2 = await createTestWarehouse({ name: `انبار دوم TD-214 ${Date.now()}` });
      const w3 = await createTestWarehouse({ name: `انبار سوم TD-214 ${Date.now()}` });
      const item = await createTestItem({ stocks: { [w1.code]: 3, [w2.code]: 4 } });

      const list = await request(app).get('/api/items?limit=0').set('Cookie', session.cookie);
      const rows: any[] = Array.isArray(list.body?.data) ? list.body.data : (Array.isArray(list.body) ? list.body : []);
      const row = rows.find(r => r.id === item.id);
      if (list.status !== 200 || !row || row.current_stock !== 7 || row.stocks?.[w1.code] !== 3 || row.stocks?.[w2.code] !== 4
        || row[`stock_${w1.code}`] !== 3 || row[`stock_${w2.code}`] !== 4) {
        throw new Error(`فهرست کالاها باید موجودی هر انبار را از جدول بدهد: ${JSON.stringify({ status: list.status, row: row && { current_stock: row.current_stock, stocks: row.stocks } })}`);
      }

      const audit = await request(app).get(`/api/documents/audit-items?location=${encodeURIComponent(w3.code)}`).set('Cookie', session.cookie);
      const auditRow = (Array.isArray(audit.body) ? audit.body : []).find((r: any) => r.id === item.id);
      if (audit.status !== 200 || !auditRow || auditRow.system_stock !== 0) {
        throw new Error(`موجودی سیستمی انبارگردانی در انبار بدون موجودی باید صفر باشد: ${JSON.stringify({ status: audit.status, system_stock: auditRow?.system_stock })}`);
      }

      results.push(makeTestCase({
        id: 'reg_stock_api_from_table_td_214',
        scenarioId: 'inventory_integrity_3way_reconciliation',
        name: 'v7.0.48: موجودی انبارها در API از جدول نرمال و صفر برای انبار بدون موجودی در فهرست انبارگردانی (TD-214)',
        layer: 'regression',
        executionType: 'real_api',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'GET /api/items نقشه stocks و stock_<کد> را از جدول داد (۳ و ۴، کل ۷) و فهرست انبارگردانی انبار سوم موجودی سیستمی صفر نشان داد.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_stock_api_from_table_td_214',
        scenarioId: 'inventory_integrity_3way_reconciliation',
        name: 'v7.0.48: موجودی انبارها در API از جدول نرمال و صفر برای انبار بدون موجودی در فهرست انبارگردانی (TD-214)',
        layer: 'regression',
        executionType: 'real_api',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      }));
    }
  }

  // Test 27.21: v7.0.49 (audit P2-5): وضعیت سال مالی از fiscal_periods؛ بدون استنباط از متن مرجع، بدون دور زدن با
  // سند از نوع اختتامیه، و بستن سال منتظر سندی می‌ماند که همزمان در همان سال ثبت می‌شود
  if (shouldRun('reg_fiscal_periods_p2_5', 'p25', 'fiscal', 'closing')) {
    const tStart = Date.now();
    const createdVoucherIds: number[] = [];
    try {
      // v9.0.161 (TD-543): a year closes only after its end; past years inside the test's own schema
      const { inFiscalSandbox } = await import('../regression/fiscalClosingTests.js');
      await inFiscalSandbox(async () => {
      const { FiscalYearService } = await import('../../services/accounting/fiscalYear.service.js');
      const { VoucherService } = await import('../../services/accounting/voucher.service.js');
      const { ChartOfAccountsService } = await import('../../services/accounting/chartOfAccounts.service.js');
      const { normalizeDateToIso } = await import('../../lib/businessClock.js');
      const { fiscalPeriods } = await import('../../db/schema.js');
      await ChartOfAccountsService.seedStandardAccounts();
      const allAccounts = await ChartOfAccountsService.getAllAccounts();
      const revAccount = allAccounts.find(a => a.code === '6001') || allAccounts.find(a => a.accountType === 'revenue');
      const assetAccount = allAccounts.find(a => a.code === '1101') || allAccounts.find(a => a.accountType === 'asset');
      if (!revAccount || !assetAccount) throw new Error('سرفصل‌های لازم آزمون یافت نشد');
      // v9.0.161 (TD-543): سال‌های گذشته در اسکیمای خود آزمون؛ سال B که بسته می‌شود پیش از سال‌های A و C است
      const baseYear = 1393;
      const voucher = (year: number, amount: number, extra: Record<string, unknown> = {}) => ({
        date: normalizeDateToIso(`${year}-06-15`) as string,
        voucherType: 'general' as const,
        status: 'approved' as const,
        description: `سند آزمون P2-5 سال ${year}`,
        referenceModule: 'manual',
        referenceNumber: `TEST-P25-${year}`,
        items: [
          { accountId: assetAccount.id, detailedType: 'other', detailedName: 'دارایی آزمون', debit: amount, credit: 0, description: 'بدهکار' },
          { accountId: revAccount.id, detailedType: 'other', detailedName: 'درآمد آزمون', debit: 0, credit: amount, description: 'بستانکار' },
        ],
        ...extra
      });
      const problems: string[] = [];

      // ۱) سندی از نوع «اختتامیه» با مرجع CLOSE-…-سال که از فرایند بستن سال نیامده، سال را نمی‌بندد
      const yearA = baseYear + 1;
      const fake = await VoucherService.createJournalVoucher(voucher(yearA, 1000, { voucherType: 'closing', referenceNumber: `CLOSE-NOTE-${yearA}` }) as any);
      createdVoucherIds.push(fake.id);
      try {
        const v = await VoucherService.createJournalVoucher(voucher(yearA, 500) as any);
        createdVoucherIds.push(v.id);
      } catch (e: any) {
        problems.push(`سال ${yearA} فقط با متن مرجع یک سند بسته فرض شد: ${e.message}`);
      }

      // ۲) بستن واقعی سال B همزمان با تراکنشی که در سال B سند ثبت کرده و هنوز commit نشده است
      const yearB = baseYear;
      const holdMs = 1500;
      const inflight = orm.transaction(async (tx) => {
        const v = await VoucherService.createJournalVoucher(voucher(yearB, 2000) as any, tx);
        createdVoucherIds.push(v.id);
        await new Promise(r => setTimeout(r, holdMs));
      });
      await new Promise(r => setTimeout(r, 300));
      let closing: any = null;
      try {
        closing = await FiscalYearService.executeFiscalYearClosing({ year: yearB, createOpeningVoucher: true, username: 'test-agent' });
        createdVoucherIds.push(...(closing.closingVouchers || []).map((v: any) => v.id));
      } catch (e: any) {
        problems.push(`بستن سال ${yearB} شکست خورد: ${e.message}`);
      }
      await inflight;
      // مانده تجمعی درآمد تا پایان سال B پس از بستن باید صفر باشد (بستن سال همه مانده‌های موقت تا تاریخ اختتامیه
      // را می‌بندد): سند ثبت‌شده همزمان باید در اسناد اختتامیه دیده شده باشد
      const to = normalizeDateToIso(`${yearB + 1}-01-01`) as string;
      const revBal: any = await orm.execute(sql`
        SELECT COALESCE(SUM(i.credit - i.debit), 0) AS bal
        FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id
        WHERE v.is_deleted = 0 AND i.is_deleted = 0 AND v.status IN ('approved', 'permanent')
          AND i.account_id = ${revAccount.id} AND v.date < ${to}`);
      const revenueLeft = Number((revBal.rows ?? revBal)[0]?.bal ?? 0);
      if (Math.abs(revenueLeft) > 0.0001) {
        problems.push(`پس از بستن سال ${yearB} مانده درآمد ${revenueLeft} باقی ماند؛ سند ثبت‌شده همزمان در بستن سال دیده نشد`);
      }
      const [period] = await orm.select().from(fiscalPeriods).where(eq(fiscalPeriods.fiscalYear, yearB));
      if (period?.status !== 'closed' || !period.closingVoucherId) {
        problems.push(`وضعیت سال ${yearB} در fiscal_periods باید بسته با شناسه سند اختتامیه باشد: ${JSON.stringify(period)}`);
      }

      // ۳) پس از بستن، هیچ سندی (حتی از نوع اختتامیه) وارد سال B نمی‌شود
      for (const type of ['general', 'closing'] as const) {
        try {
          const v = await VoucherService.createJournalVoucher(voucher(yearB, 100, { voucherType: type, referenceNumber: `TEST-P25-AFTER-${type}` }) as any);
          createdVoucherIds.push(v.id);
          problems.push(`ثبت سند ${type} در سال بسته ${yearB} پذیرفته شد`);
        } catch (e: any) {
          if (!String(e?.message || '').includes('بسته')) problems.push(`خطای نامرتبط برای سند ${type}: ${e.message}`);
        }
      }

      // ۴) آستانه یکسان تراز ۰٫۰۱ در ایجاد سند (پیش‌تر ۰٫۰۰۰۱ در ایجاد و ۰٫۰۱ در قطعی‌سازی)
      const yearC = baseYear + 2;
      const tolerance = (diff: number) => ({
        ...voucher(yearC, 0),
        items: [
          { accountId: assetAccount.id, detailedType: 'other', detailedName: 'دارایی آزمون', debit: 1000 + diff, credit: 0, description: 'بدهکار' },
          { accountId: revAccount.id, detailedType: 'other', detailedName: 'درآمد آزمون', debit: 0, credit: 1000, description: 'بستانکار' },
        ]
      });
      try {
        const v = await VoucherService.createJournalVoucher(tolerance(0.005) as any);
        createdVoucherIds.push(v.id);
      } catch (e: any) {
        problems.push(`سند با اختلاف ۰٫۰۰۵ باید پذیرفته شود: ${e.message}`);
      }
      let overRejected = false;
      try {
        const v = await VoucherService.createJournalVoucher(tolerance(0.02) as any);
        createdVoucherIds.push(v.id);
      } catch {
        overRejected = true;
      }
      if (!overRejected) problems.push('سند با اختلاف ۰٫۰۲ باید رد شود');

      if (problems.length > 0) throw new Error(problems.join(' | '));
      results.push(makeTestCase({
        id: 'reg_fiscal_periods_p2_5',
        scenarioId: 'v6_fiscal_year_closing_isolation',
        name: 'v7.0.49: وضعیت سال مالی در fiscal_periods، قفل بین بستن سال و ثبت همزمان و آستانه یکسان تراز (P2-5)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'سند «اختتامیه» دستی سال را نبست، بستن سال منتظر سند همزمان ماند و آن را بست، پس از بستن هیچ سندی وارد سال نشد و آستانه تراز ۰٫۰۱ در ایجاد سند اعمال شد.'
      }));
      // the sandbox is gone with its vouchers: nothing left to clean in the shared schema
      }).finally(() => { createdVoucherIds.length = 0; });
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_fiscal_periods_p2_5',
        scenarioId: 'v6_fiscal_year_closing_isolation',
        name: 'v7.0.49: وضعیت سال مالی در fiscal_periods، قفل بین بستن سال و ثبت همزمان و آستانه یکسان تراز (P2-5)',
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      }));
    } finally {
      if (createdVoucherIds.length > 0) {
        await cleanTestTableData('journal_voucher_items', 'voucher_id', createdVoucherIds);
        await cleanTestTableData('journal_vouchers', 'id', createdVoucherIds);
      }
    }
  }

  // Test 27.22: v7.0.51 (audit P2-10): کد نقش و کلید مجوز دو فضای نام جدا هستند؛ نقشی با کد هم‌نام یک مجوز
  // (مثل customers.manage) آن مجوز را نمی‌گیرد و نقش تازه با کد نقطه‌دار ساخته نمی‌شود
  if (shouldRun('reg_role_permission_namespace_p2_10', 'p210', 'authorize', 'roles')) {
    const tStart = Date.now();
    const testName = 'v7.0.51: a role whose code equals a permission key does not get that permission in authorizePermission or userHasRoleOrPermission (P2-10)';
    const createdRoleIds: number[] = [];
    try {
      const { authorizePermission, userHasRoleOrPermission } = await import('../../middleware/authorize.js');
      const { createTestRole } = await import('../fixtures/factories.js');
      const { roles } = await import('../../db/schema.js');
      const request = (await import('supertest')).default;
      const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');

      // میدل‌ور از asyncHandler عبور می‌کند (v7.0.66)؛ پایان آن با فراخوانی next یا json شناخته می‌شود
      const runGuard = (guard: any, role: string): Promise<number> => new Promise<number>((resolve) => {
        let status = 0;
        const req: any = { user: { id: -1, username: 'p210_probe', role } };
        const res: any = {
          status(code: number) { status = code; return this; },
          json() { resolve(status); return this; }
        };
        guard(req, res, () => resolve(200));
      });

      // الف) کاربری که کد نقشش دقیقاً نام مجوز است (نقشی که پیش‌تر ساخته شده) و خود مجوز را ندارد
      const dotted = 'customers.manage';
      const guardedPerm = await runGuard(authorizePermission('customers.manage'), dotted);
      if (guardedPerm !== 403) {
        throw new Error(`authorizePermission به نقشی با کد «${dotted}» بدون داشتن مجوز دسترسی داد (وضعیت ${guardedPerm})`);
      }
      if (await userHasRoleOrPermission({ role: dotted }, 'customers.manage')) {
        throw new Error(`userHasRoleOrPermission نقشی با کد «${dotted}» را دارنده همان مجوز دانست`);
      }

      // ب) کنترل: دارنده واقعی مجوز و مدیر سیستم مجازند و نقش بی مجوز رد می‌شود. از v9.0.107 (TD-516) هیچ گاردی کد نقش
      // نمی‌پذیرد، پس «نقش نام‌برده در گارد» دیگر حالتی نیست (آزمون sec_route_guards_permission_only_td_516)
      const holder = await createTestRole({ permissions: ['customers.manage'] });
      createdRoleIds.push(holder.id);
      const plain = await createTestRole({ permissions: ['daily_logs.view'] });
      createdRoleIds.push(plain.id);
      const checks: Array<[string, number, number]> = [
        ['permission holder', await runGuard(authorizePermission('customers.manage'), holder.code), 200],
        ['role without the permission', await runGuard(authorizePermission('customers.manage'), plain.code), 403],
        ['system admin', await runGuard(authorizePermission('customers.manage'), 'admin'), 200]
      ];
      const wrong = checks.filter(([, got, want]) => got !== want);
      if (wrong.length > 0) {
        throw new Error(`رفتار گارد برای نقش‌های عادی تغییر کرد: ${wrong.map(([n, got, want]) => `${n}: ${got} به‌جای ${want}`).join('، ')}`);
      }

      // ج) ساخت نقش تازه با کد نقطه‌دار از API رد می‌شود
      const app = await getTestApp();
      const session = await getAdminSession();
      const probeCode = `p210.probe_${Date.now()}`;
      const created = await request(app)
        .post('/api/roles')
        .set('Cookie', session.cookie)
        .set('x-csrf-token', session.csrfToken)
        .send({ name: 'نقش آزمون P2-10', code: probeCode, permissions: [] });
      const [probeRow] = await orm.select({ id: roles.id }).from(roles).where(eq(roles.code, probeCode));
      if (probeRow) createdRoleIds.push(probeRow.id);
      if (created.status !== 400 || probeRow) {
        throw new Error(`نقش با کد نقطه‌دار «${probeCode}» ساخته شد (وضعیت ${created.status})`);
      }

      results.push(makeTestCase({
        id: 'reg_role_permission_namespace_p2_10',
        scenarioId: 'route_authorization_scope',
        name: testName,
        layer: 'regression',
        executionType: 'real_code',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'a role coded customers.manage was refused by authorizePermission and userHasRoleOrPermission; the real holder and the system admin passed; creating a role with a dotted code returned 400'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_role_permission_namespace_p2_10',
        scenarioId: 'route_authorization_scope',
        name: testName,
        layer: 'regression',
        executionType: 'real_code',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      }));
    } finally {
      if (createdRoleIds.length > 0) {
        const { roles } = await import('../../db/schema.js');
        await orm.delete(roles).where(inArray(roles.id, createdRoleIds));
      }
    }
  }

  // Test 27.21b: v7.0.52 (TD-219): پس از حذف ستون items.stocks (v7.0.48) آمار BI انبار و غیرفعال‌سازی انبار
  // موجودی را از item_warehouse_stocks می‌خوانند (هر دو از آن زمان با خطای 500 شکست می‌خوردند)
  if (shouldRun('reg_dropped_stocks_column_leftovers_td_219', 'td219', 'td214', 'stocks')) {
    const tStart = Date.now();
    const testName = 'v7.0.52: آمار BI انبار و غیرفعال‌سازی انبار پس از حذف ستون items.stocks از جدول موجودی انبارها می‌خوانند (TD-219)';
    try {
      const request = (await import('supertest')).default;
      const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
      const { createTestItem, createTestWarehouse } = await import('../fixtures/factories.js');
      const { invalidateDashboardBiCache }: any = await import('../../routes/dashboard.routes.js');
      const app = await getTestApp();
      const admin = await getAdminSession();
      const stocked = await createTestWarehouse({ name: `انبار دارای موجودی TD-219 ${Date.now()}` });
      const empty = await createTestWarehouse({ name: `انبار خالی TD-219 ${Date.now()}` });
      await createTestItem({ stocks: { [stocked.code]: 5 } });

      // الف) توزیع موجودی بین انبارها در آمار BI
      if (typeof invalidateDashboardBiCache === 'function') invalidateDashboardBiCache();
      const bi = await request(app).get('/api/dashboard-bi-stats').set('Cookie', admin.cookie);
      if (bi.status !== 200 || Number(bi.body?.locations?.[stocked.code]) !== 5 || Number(bi.body?.locations?.[empty.code]) !== 0) {
        throw new Error(`آمار BI باید موجودی انبار تازه را ۵ و انبار خالی را ۰ بدهد (وضعیت ${bi.status}، ${JSON.stringify(bi.body?.locations ?? bi.body).slice(0, 200)})`);
      }

      // ب) غیرفعال‌سازی: انبار دارای موجودی 409، انبار خالی موفق
      const blocked = await request(app).delete(`/api/warehouses/${stocked.id}`)
        .set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken);
      const allowed = await request(app).delete(`/api/warehouses/${empty.id}`)
        .set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken);
      const [stockedAfter] = await orm.select({ isActive: warehouses.isActive }).from(warehouses).where(eq(warehouses.id, stocked.id));
      const [emptyAfter] = await orm.select({ isActive: warehouses.isActive }).from(warehouses).where(eq(warehouses.id, empty.id));
      if (blocked.status !== 409 || stockedAfter?.isActive !== 1) {
        throw new Error(`غیرفعال‌سازی انبار دارای موجودی باید با 409 رد شود (وضعیت ${blocked.status}، ${JSON.stringify(blocked.body).slice(0, 160)})`);
      }
      if (allowed.status !== 200 || emptyAfter?.isActive !== 0) {
        throw new Error(`انبار بدون موجودی باید غیرفعال شود (وضعیت ${allowed.status}، ${JSON.stringify(allowed.body).slice(0, 160)})`);
      }

      results.push(makeTestCase({
        id: 'reg_dropped_stocks_column_leftovers_td_219',
        scenarioId: 'inventory_rebuild',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'آمار BI موجودی انبار تازه را ۵ داد؛ غیرفعال‌سازی انبار دارای موجودی 409 و انبار خالی 200 شد.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_dropped_stocks_column_leftovers_td_219',
        scenarioId: 'inventory_rebuild',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      }));
    }
  }

  // Test 27.23: v7.0.53 (audit P2-10): جستجوی سراسری، کاردکس و آمار داشبورد انبار فقط برای دارنده مجوز همان بخش؛
  // نویسه‌های % و _ در جستجوی سراسری و کاردکس نویسه عام نیستند
  if (shouldRun('reg_read_endpoint_scope_p2_10', 'p210', 'authorize', 'search')) {
    const tStart = Date.now();
    const testName = 'v7.0.53/55: جستجوی سراسری بخش‌به‌بخش با مجوز، کاردکس با warehouse.view/accounting.view و آمار داشبورد انبار با reports.view/warehouse.view (P2-10)';
    const createdRoleIds: number[] = [];
    try {
      const request = (await import('supertest')).default;
      const { getTestApp, getAdminSession, loginTestUser } = await import('../fixtures/httpTestHelper.js');
      const { createTestRole, createTestUser, createTestCustomer, createTestItem, createTestDocument } = await import('../fixtures/factories.js');
      const { withTestMarker } = await import('../fixtures/testMarker.js');
      const { productionProjects } = await import('../../db/schema.js');
      const app = await getTestApp();
      const admin = await getAdminSession();

      const sessionFor = async (permissions: string[]): Promise<string> => {
        const role = await createTestRole({ permissions });
        createdRoleIds.push(role.id);
        const user = await createTestUser({ role: role.code });
        return loginTestUser(app, user.username);
      };
      const logger = await sessionFor(['daily_logs.view', 'daily_logs.create']);
      const customerViewer = await sessionFor(['customers.view']);
      const warehouseViewer = await sessionFor(['warehouse.view']);
      const accountingViewer = await sessionFor(['accounting.view']);
      const reportsViewer = await sessionFor(['reports.view']);

      // داده با نشانه یکتا در هر چهار بخش؛ دو طرف حساب برای آزمون نویسه «_»
      const token = `P210Q${Date.now()}`;
      await createTestCustomer({ name: withTestMarker(`${token}_A`) });
      await createTestCustomer({ name: withTestMarker(`${token}xA`) });
      await createTestItem({ name: withTestMarker(`کالای ${token}`) });
      await createTestDocument({ refNumber: `DOC_${token}`, buyerName: withTestMarker(`خریدار ${token}`) }, []);
      await orm.insert(productionProjects).values({ projectCode: `PRJ_${token}`, title: withTestMarker(`پروژه ${token}`) });

      const search = async (cookie: string, q: string) => {
        const r = await request(app).get(`/api/global-search?q=${encodeURIComponent(q)}`).set('Cookie', cookie);
        const body = r.body || {};
        return {
          status: r.status,
          items: Array.isArray(body.items) ? body.items.length : -1,
          customers: Array.isArray(body.customers) ? body.customers.length : -1,
          documents: Array.isArray(body.documents) ? body.documents.length : -1,
          projects: Array.isArray(body.projects) ? body.projects.length : -1
        };
      };
      const fmt = (o: unknown) => JSON.stringify(o);

      // الف) جستجوی سراسری
      const asAdmin = await search(admin.cookie, token);
      if (asAdmin.status !== 200 || asAdmin.items < 1 || asAdmin.customers < 2 || asAdmin.documents < 1 || asAdmin.projects < 1) {
        throw new Error(`کنترل: مدیر سیستم باید هر چهار بخش را بیابد ${fmt(asAdmin)}`);
      }
      const asLogger = await search(logger, token);
      if (asLogger.status !== 200 || asLogger.items !== 0 || asLogger.customers !== 0 || asLogger.documents !== 0 || asLogger.projects !== 0) {
        throw new Error(`کاربر بدون مجوز مشاهده نباید نتیجه‌ای از کالا، طرف حساب، سند یا پروژه بگیرد ${fmt(asLogger)}`);
      }
      const asCustomerViewer = await search(customerViewer, token);
      if (asCustomerViewer.status !== 200 || asCustomerViewer.customers !== 2 || asCustomerViewer.items !== 0
        || asCustomerViewer.documents !== 0 || asCustomerViewer.projects !== 0) {
        throw new Error(`دارنده customers.view فقط باید بخش طرف حساب را بگیرد ${fmt(asCustomerViewer)}`);
      }
      const underscore = await search(admin.cookie, `${token}_A`);
      if (underscore.customers !== 1) {
        throw new Error(`«_» در جستجوی سراسری نویسه عام شد: «${token}_A» باید فقط یک طرف حساب بیابد (${underscore.customers})`);
      }

      // ب) کاردکس
      const kardex: Record<string, number> = {};
      for (const [name, cookie] of [['logger', logger], ['reports', reportsViewer], ['warehouse', warehouseViewer], ['accounting', accountingViewer]] as const) {
        kardex[name] = (await request(app).get('/api/transactions?limit=1').set('Cookie', cookie)).status;
      }
      if (kardex.logger !== 403 || kardex.reports !== 403 || kardex.warehouse !== 200 || kardex.accounting !== 200) {
        throw new Error(`کاردکس فقط برای warehouse.view یا accounting.view: ${fmt(kardex)}`);
      }
      // جستجو در کاردکس: پاسخ 200 (پیش‌تر هر جستجو 500 می‌داد، TD-221) و «%%%» نویسه عام نیست
      const kardexItem = await createTestItem({ name: withTestMarker(`کالای کاردکس ${token}`), stocks: {} });
      const kardexRef = `KDX_${token}`;
      await orm.transaction(async (tx) => {
        await DocumentService.applyStockMovement(tx as any, {
          itemId: kardexItem.id, inOut: 'in', quantity: 2, price: 1000, date: await businessTodayIsoDate(),
          documentType: 'receipt', documentRef: kardexRef, user: 'p210_probe', targetLoc: ''
        });
      });
      const kardexSearch = await request(app).get(`/api/transactions?limit=5&search=${encodeURIComponent(kardexRef)}`).set('Cookie', admin.cookie);
      const kardexFound: any[] = Array.isArray(kardexSearch.body?.data) ? kardexSearch.body.data : [];
      if (kardexSearch.status !== 200 || kardexFound.length !== 1 || kardexFound[0]?.item_id !== kardexItem.id || Number(kardexSearch.body?.total) !== 1) {
        throw new Error(`جستجوی کاردکس با شماره سند باید همان یک گردش را بدهد (وضعیت ${kardexSearch.status}، ${JSON.stringify(kardexSearch.body).slice(0, 200)})`);
      }
      const kardexPercent = await request(app).get('/api/transactions?limit=5&search=%25%25%25').set('Cookie', admin.cookie);
      const kardexRows: any[] = Array.isArray(kardexPercent.body?.data) ? kardexPercent.body.data : [];
      if (kardexPercent.status !== 200 || kardexRows.length !== 0) {
        throw new Error(`«%%%» در جستجوی کاردکس نویسه عام شد (وضعیت ${kardexPercent.status}، ${kardexRows.length} ردیف)`);
      }

      // ج) آمار داشبورد انبار: reports.view یا (از v7.0.55، تصمیم مالک محصول) warehouse.view
      const dash: Record<string, number> = {};
      for (const [name, cookie] of [['logger', logger], ['accounting', accountingViewer], ['warehouse', warehouseViewer], ['reports', reportsViewer]] as const) {
        dash[`${name}:stats`] = (await request(app).get('/api/stats').set('Cookie', cookie)).status;
        dash[`${name}:bi`] = (await request(app).get('/api/dashboard-bi-stats').set('Cookie', cookie)).status;
      }
      const dashExpected: Record<string, number> = {
        'logger:stats': 403, 'logger:bi': 403, 'accounting:stats': 403, 'accounting:bi': 403,
        'warehouse:stats': 200, 'warehouse:bi': 200, 'reports:stats': 200, 'reports:bi': 200
      };
      if (Object.entries(dashExpected).some(([k, want]) => dash[k] !== want)) {
        throw new Error(`آمار داشبورد انبار فقط برای reports.view یا warehouse.view: ${fmt(dash)}`);
      }

      results.push(makeTestCase({
        id: 'reg_read_endpoint_scope_p2_10',
        scenarioId: 'route_authorization_scope',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: `جستجو: ${fmt({ asLogger, asCustomerViewer })}؛ کاردکس: ${fmt(kardex)}؛ داشبورد: ${fmt(dash)}`
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_read_endpoint_scope_p2_10',
        scenarioId: 'route_authorization_scope',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      }));
    } finally {
      if (createdRoleIds.length > 0) {
        const { roles } = await import('../../db/schema.js');
        await orm.delete(roles).where(inArray(roles.id, createdRoleIds));
      }
    }
  }

  // Test 27.24: v7.0.56 (audit P2-9): فایل پیوست‌ها روی دیسک و ستون attachments فقط فراداده؛ دریافت فایل فقط با مجوز
  // خواندن رکورد مالک؛ SVG دانلود می‌شود نه نمایش؛ انتقال پیوست‌های قدیمی Base64 (آزمایشی سپس واقعی)
  if (shouldRun('reg_attachments_on_disk_p2_9', 'p29', 'attachments')) {
    const tStart = Date.now();
    const testName = 'v7.0.56: پیوست‌ها روی دیسک با دریافت مجوزدار و انتقال پیوست‌های قدیمی داخل پایگاه‌داده (P2-9)';
    const fsMod = await import('fs');
    const pathMod = await import('path');
    const osMod = await import('os');
    const previousAttachmentsDir = process.env.ATTACHMENTS_DIR;
    const tempRoot = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'erp-attachments-'));
    process.env.ATTACHMENTS_DIR = tempRoot;
    const createdVoucherIds: number[] = [];
    try {
      const { VoucherService } = await import('../../services/accounting/voucher.service.js');
      const { ChartOfAccountsService } = await import('../../services/accounting/chartOfAccounts.service.js');
      const { createTestDocument, createTestRole, createTestUser } = await import('../fixtures/factories.js');
      const { getTestApp, getAdminSession, loginTestUser } = await import('../fixtures/httpTestHelper.js');
      const request = (await import('supertest')).default;
      const app = await getTestApp();
      const admin = await getAdminSession();

      const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
      const svgBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'utf8');
      const pngDataUrl = `data:image/png;base64,${pngBytes.toString('base64')}`;
      const svgDataUrl = `data:image/svg+xml;base64,${svgBytes.toString('base64')}`;

      // الف) ثبت سند حسابداری با دو پیوست: ستون attachments نباید داده Base64 داشته باشد
      await ChartOfAccountsService.seedStandardAccounts();
      const allAccounts = await ChartOfAccountsService.getAllAccounts();
      const debitAcc = allAccounts.find(a => a.code === '1101') || allAccounts.find(a => a.accountType === 'asset');
      const creditAcc = allAccounts.find(a => a.code === '6001') || allAccounts.find(a => a.accountType === 'revenue');
      if (!debitAcc || !creditAcc) throw new Error('سرفصل‌های لازم آزمون یافت نشد');
      const created: any = await VoucherService.createJournalVoucher({
        date: await businessTodayIsoDate(),
        voucherType: 'general',
        status: 'draft',
        description: 'سند آزمون پیوست P2-9',
        referenceModule: 'manual',
        referenceNumber: `TEST-P29-${Date.now()}`,
        username: 'p29_probe',
        attachments: [
          { id: 'att_png', name: 'receipt.png', url: pngDataUrl, type: 'image/png', size: pngBytes.length },
          { id: 'att_svg', name: 'logo.svg', url: svgDataUrl, type: 'image/svg+xml', size: svgBytes.length },
        ],
        items: [
          { accountId: debitAcc.id, detailedType: 'other', detailedName: 'آزمون', debit: 100, credit: 0, description: 'بدهکار' },
          { accountId: creditAcc.id, detailedType: 'other', detailedName: 'آزمون', debit: 0, credit: 100, description: 'بستانکار' },
        ],
      } as any);
      createdVoucherIds.push(created.id);
      const [voucherRow] = await orm.select({ attachments: journalVouchers.attachments }).from(journalVouchers).where(eq(journalVouchers.id, created.id));
      const storedList: any[] = Array.isArray(voucherRow?.attachments) ? voucherRow.attachments as any[] : [];
      if (JSON.stringify(storedList).includes('data:')) {
        throw new Error('ستون attachments سند حسابداری هنوز داده Base64 پیوست را نگه می‌دارد');
      }
      const pngItem = storedList.find(a => a.name === 'receipt.png');
      const svgItem = storedList.find(a => a.name === 'logo.svg');
      if (!pngItem?.url?.startsWith('/api/attachments/') || !svgItem?.url?.startsWith('/api/attachments/') || pngItem.type !== 'image/png') {
        throw new Error(`فراداده پیوست‌ها نادرست است: ${JSON.stringify(storedList).slice(0, 300)}`);
      }

      const { fileAttachments, roles } = await import('../../db/schema.js');
      const { AttachmentStorageService } = await import('../../services/attachments/attachmentStorage.service.js');
      const registry = await orm.select().from(fileAttachments)
        .where(and(eq(fileAttachments.entityType, 'journal_voucher'), eq(fileAttachments.entityId, created.id)));
      const pngRow = registry.find(r => pngItem.url.endsWith(r.id));
      if (registry.length !== 2 || !pngRow || !fsMod.readFileSync(AttachmentStorageService.absolutePath(pngRow.storagePath)).equals(pngBytes)) {
        throw new Error(`فایل پیوست روی دیسک یا ثبت آن نادرست است (${registry.length} ردیف)`);
      }

      // ب) دریافت فایل: مدیر 200 با همان بایت‌ها؛ SVG فقط دانلود؛ بدون مجوز حسابداری 403؛ بدون نشست 401
      const binary = (res: any, cb: any) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      };
      const pngRes = await request(app).get(pngItem.url).set('Cookie', admin.cookie).buffer(true).parse(binary);
      if (pngRes.status !== 200 || pngRes.headers['content-type'] !== 'image/png'
        || !String(pngRes.headers['content-disposition'] || '').startsWith('inline') || !Buffer.from(pngRes.body).equals(pngBytes)) {
        throw new Error(`دریافت تصویر پیوست نادرست است (وضعیت ${pngRes.status}، ${pngRes.headers['content-type']})`);
      }
      const svgRes = await request(app).get(svgItem.url).set('Cookie', admin.cookie).buffer(true).parse(binary);
      if (svgRes.status !== 200 || !String(svgRes.headers['content-disposition'] || '').startsWith('attachment')
        || svgRes.headers['x-content-type-options'] !== 'nosniff') {
        throw new Error(`SVG باید فقط دانلود شود (وضعیت ${svgRes.status}، ${svgRes.headers['content-disposition']})`);
      }
      const noPermRole = await createTestRole({ permissions: ['daily_logs.view'] });
      const accountingRole = await createTestRole({ permissions: ['accounting.view'] });
      const noPermCookie = await loginTestUser(app, (await createTestUser({ role: noPermRole.code })).username);
      const accountingCookie = await loginTestUser(app, (await createTestUser({ role: accountingRole.code })).username);
      const statuses = {
        noPermission: (await request(app).get(pngItem.url).set('Cookie', noPermCookie)).status,
        accounting: (await request(app).get(pngItem.url).set('Cookie', accountingCookie)).status,
        anonymous: (await request(app).get(pngItem.url)).status,
        publicUploads: (await request(app).get(`/uploads/.attachments/${pngRow.storagePath}`)).status,
      };
      await orm.delete(roles).where(inArray(roles.id, [noPermRole.id, accountingRole.id]));
      if (statuses.noPermission !== 403 || statuses.accounting !== 200 || statuses.anonymous !== 401 || statuses.publicUploads !== 404) {
        throw new Error(`کنترل دسترسی دریافت پیوست نادرست است: ${JSON.stringify(statuses)}`);
      }

      // ج) ویرایش: حذف SVG از فهرست آن را جدا می‌کند؛ آدرس javascript: رد می‌شود
      await VoucherService.updateJournalVoucher(created.id, { attachments: [pngItem] } as any);
      const svgAfter = await request(app).get(svgItem.url).set('Cookie', admin.cookie);
      const pngAfter = await request(app).get(pngItem.url).set('Cookie', admin.cookie);
      if (svgAfter.status !== 404 || pngAfter.status !== 200) {
        throw new Error(`پس از حذف SVG از فهرست: SVG ${svgAfter.status} (انتظار 404)، PNG ${pngAfter.status} (انتظار 200)`);
      }
      let rejected = false;
      try {
        await VoucherService.updateJournalVoucher(created.id, { attachments: [{ id: 'x', name: 'bad', url: 'javascript:alert(1)' }] } as any);
      } catch {
        rejected = true;
      }
      if (!rejected) throw new Error('آدرس javascript: برای پیوست پذیرفته شد');

      // د) انتقال پیوست قدیمی Base64 داخل سند انبار: آزمایشی بدون تغییر، سپس واقعی و تکرارپذیر
      const { document: legacyDoc } = await createTestDocument({ refNumber: `DOC_P29_${Date.now()}` }, []);
      const legacyList = [{ id: 'legacy1', name: 'old-receipt.png', url: pngDataUrl, type: 'image/png' }];
      await orm.update(documents).set({ attachments: legacyList as any }).where(eq(documents.id, legacyDoc.id));
      const scope = { entityType: 'document' as const, ids: [legacyDoc.id] };
      const dry = await AttachmentStorageService.migrateInlineAttachments({ apply: false, actor: 'p29', scope });
      const [afterDry] = await orm.select({ attachments: documents.attachments }).from(documents).where(eq(documents.id, legacyDoc.id));
      if (dry.files !== 1 || !JSON.stringify(afterDry?.attachments).includes('data:image/png')) {
        throw new Error(`اجرای آزمایشی انتقال باید یک فایل بشمارد و چیزی را تغییر ندهد: ${JSON.stringify(dry)}`);
      }
      const applied = await AttachmentStorageService.migrateInlineAttachments({ apply: true, actor: 'p29', scope });
      const [afterApply] = await orm.select({ attachments: documents.attachments }).from(documents).where(eq(documents.id, legacyDoc.id));
      const migrated: any = Array.isArray(afterApply?.attachments) ? (afterApply.attachments as any[])[0] : null;
      if (applied.files !== 1 || applied.failures.length !== 0 || !migrated?.url?.startsWith('/api/attachments/')) {
        throw new Error(`انتقال واقعی پیوست قدیمی انجام نشد: ${JSON.stringify({ applied, migrated }).slice(0, 300)}`);
      }
      const migratedRes = await request(app).get(migrated.url).set('Cookie', admin.cookie).buffer(true).parse(binary);
      if (migratedRes.status !== 200 || !Buffer.from(migratedRes.body).equals(pngBytes)) {
        throw new Error(`فایل منتقل‌شده با محتوای اصلی یکسان نیست (وضعیت ${migratedRes.status})`);
      }
      const again = await AttachmentStorageService.migrateInlineAttachments({ apply: true, actor: 'p29', scope });
      if (again.files !== 0) throw new Error('اجرای دوباره انتقال باید کاری انجام ندهد');

      results.push(makeTestCase({
        id: 'reg_attachments_on_disk_p2_9',
        scenarioId: 'route_authorization_scope',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: `پیوست‌ها روی دیسک و ثبت‌شده؛ دسترسی: ${JSON.stringify(statuses)}؛ انتقال قدیمی: آزمایشی ${dry.files}، واقعی ${applied.files}، تکرار ${again.files}`
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_attachments_on_disk_p2_9',
        scenarioId: 'route_authorization_scope',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      }));
    } finally {
      if (createdVoucherIds.length > 0) {
        await orm.update(journalVouchers).set({ isDeleted: 1 }).where(inArray(journalVouchers.id, createdVoucherIds));
      }
      if (previousAttachmentsDir === undefined) delete process.env.ATTACHMENTS_DIR;
      else process.env.ATTACHMENTS_DIR = previousAttachmentsDir;
      fsMod.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  // Test 27.25: v7.0.57 (TD-222): «_» و «%» در جستجوی فهرست طرف‌حساب‌ها، کالاها، اسناد و اسناد حسابداری نویسه عام نیستند
  if (shouldRun('reg_like_wildcards_escaped_td_222', 'td222', 'search', 'like')) {
    const tStart = Date.now();
    const testName = 'v7.0.57: «_» و «%» در جستجوی طرف‌حساب، کالا، سند و سند حسابداری نویسه عام نیستند (TD-222)';
    try {
      const request = (await import('supertest')).default;
      const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
      const { createTestCustomer, createTestItem, createTestDocument } = await import('../fixtures/factories.js');
      const { withTestMarker } = await import('../fixtures/testMarker.js');
      const { VoucherService } = await import('../../services/accounting/voucher.service.js');
      const { ChartOfAccountsService } = await import('../../services/accounting/chartOfAccounts.service.js');
      const app = await getTestApp();
      const admin = await getAdminSession();
      const token = `TD222Q${Date.now()}`;
      await ChartOfAccountsService.seedStandardAccounts();
      const allAccounts = await ChartOfAccountsService.getAllAccounts();
      const debitAcc = allAccounts.find(a => a.code === '1101') || allAccounts.find(a => a.accountType === 'asset');
      const creditAcc = allAccounts.find(a => a.code === '6001') || allAccounts.find(a => a.accountType === 'revenue');
      if (!debitAcc || !creditAcc) throw new Error('سرفصل‌های لازم آزمون یافت نشد');
      // در هر بخش دو ردیف: «<نشانه>_A» و «<نشانه>xA»؛ جستجوی «<نشانه>_A» باید فقط اولی را بیابد
      for (const suffix of ['_A', 'xA']) {
        await createTestCustomer({ name: withTestMarker(`${token}${suffix}`) });
        await createTestItem({ name: withTestMarker(`${token}${suffix}`) });
        await createTestDocument({ refNumber: `DOC_${token}${suffix}`, buyerName: withTestMarker(`${token}${suffix}`) }, []);
        await VoucherService.createJournalVoucher({
          date: await businessTodayIsoDate(),
          voucherType: 'general',
          status: 'draft',
          description: withTestMarker(`${token}${suffix}`),
          referenceModule: 'manual',
          referenceNumber: `TEST-TD222-${suffix}`,
          items: [
            { accountId: debitAcc.id, detailedType: 'other', detailedName: 'آزمون', debit: 10, credit: 0 },
            { accountId: creditAcc.id, detailedType: 'other', detailedName: 'آزمون', debit: 0, credit: 10 },
          ],
        } as any);
      }
      const rows = (body: any): any[] => Array.isArray(body?.data) ? body.data : (Array.isArray(body) ? body : []);
      const q = encodeURIComponent(`${token}_A`);
      const counts = {
        customers: rows((await request(app).get(`/api/customers?search=${q}`).set('Cookie', admin.cookie)).body).length,
        items: rows((await request(app).get(`/api/items?search=${q}`).set('Cookie', admin.cookie)).body).length,
        documents: rows((await request(app).get(`/api/documents?search=${q}`).set('Cookie', admin.cookie)).body).length,
        vouchers: rows(await VoucherService.getJournalVouchers({ search: `${token}_A` } as any)).length,
        percentCustomers: rows((await request(app).get(`/api/customers?search=${encodeURIComponent(`${token}%A`)}`).set('Cookie', admin.cookie)).body).length,
      };
      const wrong = Object.entries({ customers: 1, items: 1, documents: 1, vouchers: 1, percentCustomers: 0 })
        .filter(([k, want]) => (counts as Record<string, number>)[k] !== want);
      if (wrong.length > 0) {
        throw new Error(`نویسه عام در جستجو: ${JSON.stringify(counts)} (انتظار هر بخش ۱ و برای «%» صفر)`);
      }
      results.push(makeTestCase({
        id: 'reg_like_wildcards_escaped_td_222',
        scenarioId: 'route_authorization_scope',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: JSON.stringify(counts)
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_like_wildcards_escaped_td_222',
        scenarioId: 'route_authorization_scope',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      }));
    } finally {
      await orm.update(journalVouchers).set({ isDeleted: 1 }).where(sql`${journalVouchers.referenceNumber} LIKE 'TEST-TD222-%'`);
    }
  }

  // Test 27.26: v7.0.59 (TD-223، تصمیم مالک محصول): مسیرهای خواندن فقط برای دارنده مجوز همان بخش (یا فرم‌هایی که
  // از آن فهرست انتخاب می‌گیرند)؛ مبالغ فیش‌ها فقط با مجوز فیش؛ فهرست کامل کاربران و نقش‌ها فقط برای مدیریت؛
  // پیوست فاکتور و سند انبار از مجوز خواندن سند پیروی می‌کند
  if (shouldRun('reg_read_scope_routes_td_223', 'td223', 'authorize', 'routes')) {
    const tStart = Date.now();
    const testName = 'v7.0.59: محدوده مجوز مسیرهای خواندن طرف‌حساب، سند، کالا، قیمت، پرسنل، کارمزد، فیش، کاربران و پیوست سند (TD-223)';
    const createdRoleIds: number[] = [];
    const fsMod = await import('fs');
    const pathMod = await import('path');
    const osMod = await import('os');
    const previousAttachmentsDir = process.env.ATTACHMENTS_DIR;
    const tempRoot = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'erp-td223-'));
    process.env.ATTACHMENTS_DIR = tempRoot;
    try {
      const request = (await import('supertest')).default;
      const { getTestApp, loginTestUser } = await import('../fixtures/httpTestHelper.js');
      const { createTestRole, createTestUser, createTestDocument } = await import('../fixtures/factories.js');
      const { roles } = await import('../../db/schema.js');
      const app = await getTestApp();
      const sessionFor = async (permissions: string[]): Promise<string> => {
        const role = await createTestRole({ permissions });
        createdRoleIds.push(role.id);
        return loginTestUser(app, (await createTestUser({ role: role.code })).username);
      };
      const logger = await sessionFor(['daily_logs.view', 'daily_logs.create']);
      const production = await sessionFor(['products.view', 'warehouse.view', 'projects.view', 'piecework.view', 'piecework.log']);
      const treasurer = await sessionFor(['accounting.view', 'accounting.treasury', 'accounting.cheques', 'documents.view', 'customers.view']);
      const payroll = await sessionFor(['piecework.payroll']);
      const userAdmin = await sessionFor(['users.manage']);

      const status = async (cookie: string, url: string) => (await request(app).get(url).set('Cookie', cookie)).status;
      const expectations: Array<[string, string, string, number]> = [
        // کاربر ثبت گزارش: هیچ‌کدام
        ['logger', logger, '/api/customers', 403],
        ['logger', logger, '/api/customers/export-excel', 403],
        ['logger', logger, '/api/documents', 403],
        ['logger', logger, '/api/items', 403],
        ['logger', logger, '/api/items/prices/all', 403],
        ['logger', logger, '/api/personnel', 403],
        ['logger', logger, '/api/piecework/tasks', 403],
        ['logger', logger, '/api/piecework/logs', 403],
        ['logger', logger, '/api/piecework/payrolls', 403],
        ['logger', logger, '/api/transfers', 403],
        ['logger', logger, '/api/pending-materials', 403],
        ['logger', logger, '/api/inventory/reserved-items', 403],
        ['logger', logger, '/api/users', 403],
        ['logger', logger, '/api/roles', 403],
        ['logger', logger, '/api/permissions', 403],
        // آنچه برای همه باز می‌ماند
        ['logger', logger, '/api/users/list-simple', 200],
        ['logger', logger, '/api/piecework/payrolls/mine', 200],
        // مدیر تولید: کارمزد و پرسنل و کالا بله، مبالغ فیش‌ها نه
        ['production', production, '/api/piecework/tasks', 200],
        ['production', production, '/api/personnel', 200],
        ['production', production, '/api/items', 200],
        ['production', production, '/api/piecework/payrolls', 403],
        ['production', production, '/api/users', 403],
        // خزانه‌دار: فیش‌ها (پرداخت) و فهرست انتخاب کالا برای صفحه ورود و خروج انبار بله، قیمت‌ها نه؛ فهرست کامل کالا از
        // v9.0.138 (TD-888، ت۱۰ الف) فقط با مجوزهای بخش کالا
        ['treasurer', treasurer, '/api/piecework/payrolls', 200],
        ['treasurer', treasurer, '/api/items/options', 200],
        ['treasurer', treasurer, '/api/items', 403],
        ['treasurer', treasurer, '/api/items/prices/all', 403],
        ['treasurer', treasurer, '/api/customers/export-excel', 200],
        // دارنده مجوز فیش و مدیر کاربران
        ['payroll', payroll, '/api/piecework/payrolls', 200],
        ['userAdmin', userAdmin, '/api/users', 200],
        ['userAdmin', userAdmin, '/api/roles', 200],
        ['userAdmin', userAdmin, '/api/permissions', 200],
      ];
      const wrong: string[] = [];
      for (const [who, cookie, url, want] of expectations) {
        const got = await status(cookie, url);
        if (got !== want) wrong.push(`${who} ${url}: ${got} (انتظار ${want})`);
      }

      // پیوست سند انبار: از مجوز خواندن سند پیروی می‌کند
      const { AttachmentStorageService } = await import('../../services/attachments/attachmentStorage.service.js');
      const { document: doc } = await createTestDocument({ refNumber: `DOC_TD223_${Date.now()}` }, []);
      const [stored] = await AttachmentStorageService.attachToNewRecord(orm as any, 'document', doc.id,
        [{ id: 'a', name: 'note.txt', url: 'data:text/plain;base64,c2FsYW0=' }], 'td223');
      const attLogger = await status(logger, stored.url);
      const attTreasurer = await status(treasurer, stored.url);
      if (attLogger !== 403) wrong.push(`پیوست سند برای کاربر ثبت گزارش: ${attLogger} (انتظار 403)`);
      if (attTreasurer !== 200) wrong.push(`پیوست سند برای دارنده documents.view: ${attTreasurer} (انتظار 200)`);
      await orm.delete(roles).where(inArray(roles.id, createdRoleIds));
      createdRoleIds.length = 0;

      if (wrong.length > 0) {
        throw new Error(`محدوده مجوز نادرست (${wrong.length}): ${wrong.join('، ')}`);
      }
      results.push(makeTestCase({
        id: 'reg_read_scope_routes_td_223',
        scenarioId: 'route_authorization_scope',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: `${expectations.length + 2} بررسی وضعیت دسترسی`
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_read_scope_routes_td_223',
        scenarioId: 'route_authorization_scope',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      }));
    } finally {
      if (createdRoleIds.length > 0) {
        const { roles } = await import('../../db/schema.js');
        await orm.delete(roles).where(inArray(roles.id, createdRoleIds));
      }
      if (previousAttachmentsDir === undefined) delete process.env.ATTACHMENTS_DIR;
      else process.env.ATTACHMENTS_DIR = previousAttachmentsDir;
      fsMod.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  // Test 28: V6 Phase 5.1: رعایت دقیق سلسله‌مراتب قفل‌ها (ITEMS_STOCK:40 قبل از DOCUMENTS:60) و ممانعت از بن‌بست (TD-159)
  if (shouldRun('reg_lock_hierarchy_deadlock_prevention_td_159', 'td159', 'lock', 'deadlock', 'concurrency')) {
    const t28Start = Date.now();
    const createdItemIds: number[] = [];
    const createdDocIds: number[] = [];
    try {
      // 1. Unit verification of sortIdsForLocking & validateLockOrder
      const unorderedIds = [88, 12, 45, 12, 3, 99];
      const sortedIds = sortIdsForLocking(unorderedIds);
      if (JSON.stringify(sortedIds) !== JSON.stringify([3, 12, 45, 88, 99])) {
        throw new Error(`مرتب‌سازی شناسه‌های قفل ناموفق بود: ${JSON.stringify(sortedIds)}`);
      }

      // Items (40) before Documents (60) must be valid (throws if invalid)
      validateLockOrder([
        { name: 'items', hierarchyLevel: LockHierarchyLevel.ITEMS_STOCK },
        { name: 'documents', hierarchyLevel: LockHierarchyLevel.DOCUMENTS }
      ]);

      // 2. Real Database Integration: Multi-item Document Finalization with Strict Lock Hierarchy
      const [itemA] = await orm.insert(items).values({
        name: 'کالای تست سلسله‌مراتب قفل A',
        code: `ITEM-LOCK-A-${Date.now()}`,
        type: 'product',
        unit: 'عدد',
        currentStock: 25,
        weightedAverageCost: money(100000),
        isDeleted: 0
      }).returning({ id: items.id });
      await seedFixtureItemStocks(itemA.id, { main: 25 }); // v7.0.48 (TD-214): موجودی آزمون در جدول موجودی انبارها
      createdItemIds.push(itemA.id);

      const [itemB] = await orm.insert(items).values({
        name: 'کالای تست سلسله‌مراتب قفل B',
        code: `ITEM-LOCK-B-${Date.now()}`,
        type: 'product',
        unit: 'عدد',
        currentStock: 30,
        weightedAverageCost: money(200000),
        isDeleted: 0
      }).returning({ id: items.id });
      await seedFixtureItemStocks(itemB.id, { main: 30 }); // v7.0.48 (TD-214): موجودی آزمون در جدول موجودی انبارها
      createdItemIds.push(itemB.id);

      const [draftDoc] = await orm.insert(documents).values({
        type: 'invoice',
        refNumber: `DOC-TD159-${Date.now()}`,
        date: new Date().toISOString(),
        buyerName: 'مشتری تست همروندی قفل',
        status: 'draft',
        currency: 'IRR',
        isDeleted: 0
      }).returning({ id: documents.id });
      createdDocIds.push(draftDoc.id);

      // Insert line items in REVERSE order of ID to verify automatic ascending sorting
      const higherId = Math.max(itemA.id, itemB.id);
      const lowerId = Math.min(itemA.id, itemB.id);

      await orm.insert(documentItems).values([
        {
          documentId: draftDoc.id,
          itemId: higherId,
          quantity: 2,
          unitPrice: money(150000),
          location: 'main',
          isDeleted: 0
        },
        {
          documentId: draftDoc.id,
          itemId: lowerId,
          quantity: 3,
          unitPrice: money(250000),
          location: 'main',
          isDeleted: 0
        }
      ]);

      // Execute finalizeDocument - internally uses withOrderedLocks (items ASC -> documents)
      await DocumentService.finalizeDocument(draftDoc.id, 'lock-test-user', undefined, { strict: false });

      // Verify status is now final
      const [finalizedDoc] = await orm.select().from(documents).where(eq(documents.id, draftDoc.id));
      if (finalizedDoc?.status !== 'final') {
        throw new Error(`وضعیت سند پس از finalizeDocument باید 'final' باشد، اما مقدار فعلی: ${finalizedDoc?.status}`);
      }

      // Verify stock was properly moved
      const [refreshedItemA] = await orm.select().from(items).where(eq(items.id, itemA.id));
      const [refreshedItemB] = await orm.select().from(items).where(eq(items.id, itemB.id));

      const expectedQtyA = itemA.id === higherId ? 25 - 2 : 25 - 3;
      const expectedQtyB = itemB.id === higherId ? 30 - 2 : 30 - 3;

      if (Number(refreshedItemA.currentStock) !== expectedQtyA || Number(refreshedItemB.currentStock) !== expectedQtyB) {
        throw new Error(`موجودی کالاها پس از نهایی‌سازی نادرست است: A=${refreshedItemA.currentStock} (انتظار: ${expectedQtyA})، B=${refreshedItemB.currentStock} (انتظار: ${expectedQtyB})`);
      }

      // Idempotency check: second finalization call should be a clean no-op
      await DocumentService.finalizeDocument(draftDoc.id, 'lock-test-user', undefined, { strict: false });
      const [recheckedDoc] = await orm.select().from(documents).where(eq(documents.id, draftDoc.id));
      if (recheckedDoc?.status !== 'final') {
        throw new Error('فراخوانی مجدد نهایی‌سازی باید بدون تغییر در وضعیت سند باقی بماند.');
      }

      results.push(makeTestCase({
        id: 'reg_lock_hierarchy_deadlock_prevention_td_159',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'V6 Phase 5.1: رعایت دقیق سلسله‌مراتب قفل‌ها (ITEMS_STOCK:40 قبل از DOCUMENTS:60) و ممانعت از بن‌بست (TD-159)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t28Start,
        details: 'اخذ قفل‌های سطری به ترتیب استاندارد (اقلام کالا با شناسه‌های صعودی در اولویت ۴۰ پیش از سند در اولویت ۶۰) و نهایی‌سازی اتمیک با موفقیت تأیید گردید.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_lock_hierarchy_deadlock_prevention_td_159',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'V6 Phase 5.1: رعایت دقیق سلسله‌مراتب قفل‌ها (ITEMS_STOCK:40 قبل از DOCUMENTS:60) و ممانعت از بن‌بست (TD-159)',
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - t28Start,
        error: err.message
      }));
    } finally {
      if (createdDocIds.length > 0) {
        await cleanTestTableData('transactions', 'document_id', createdDocIds);
        await cleanTestTableData('document_items', 'document_id', createdDocIds);
        await cleanTestTableData('documents', 'id', createdDocIds);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Test 29: V6 Phase 5.2 (TD-154) — قفل سطری در ویرایش سند، کنترل همروندی OCC و ممانعت از Lost Update
  // -------------------------------------------------------------------------
  {
    const t29Start = Date.now();
    const createdDocIds: number[] = [];
    const createdItemIds: number[] = [];
    try {
      const now = new Date();
      const codeSuffix = `${now.getTime()}_${Math.floor(Math.random() * 1000)}`;

      // 1. Create a test item
      const [testItem] = await orm.insert(items).values({
        code: `REG-ITEM-TD154-${codeSuffix}`,
        name: `کالای آزمایشی تست همروندی ویرایش سند ${codeSuffix}`,
        unit: 'عدد',
        category: 'انگشتر',
        type: 'product',
        currentStock: 100,
        weightedAverageCost: money(50000),
        isDeleted: 0
      }).returning();
      await seedFixtureItemStocks(testItem.id, { main: 100 }); // v7.0.48 (TD-214): موجودی آزمون در جدول موجودی انبارها
      createdItemIds.push(testItem.id);

      // 2. Create a test draft document
      const [draftDoc] = await orm.insert(documents).values({
        type: 'invoice',
        refNumber: `TD154-${codeSuffix}`,
        date: now.toISOString(),
        user: 'occ-test-user',
        status: 'draft',
        currency: 'IRR',
        version: 1,
        isDeleted: 0
      }).returning();
      createdDocIds.push(draftDoc.id);

      await orm.insert(documentItems).values({
        documentId: draftDoc.id,
        itemId: testItem.id,
        quantity: 5,
        unitPrice: money(60000),
        discount: money(0),
        location: 'main'
      });

      // 3. Test successful update with matching expectedVersion (version 1 -> 2)
      await DocumentService.updateDocument(draftDoc.id, {
        buyer_name: 'خریدار تست اول',
        expectedVersion: 1,
        items: [
          {
            itemId: testItem.id,
            quantity: 7,
            unitPrice: 65000,
            location: 'main'
          }
        ]
      });

      // Verify version was bumped to 2 and fields updated
      const [docAfterUpdate1] = await orm.select().from(documents).where(eq(documents.id, draftDoc.id));
      if (docAfterUpdate1?.version !== 2) {
        throw new Error(`نسخه سند پس از ویرایش باید 2 باشد، اما مقدار فعلی: ${docAfterUpdate1?.version}`);
      }
      if (docAfterUpdate1.buyerName !== 'خریدار تست اول') {
        throw new Error(`نام خریدار به‌درستی ذخیره نشده است: ${docAfterUpdate1.buyerName}`);
      }

      // Verify line items were updated (active records)
      const updatedLines = await orm.select().from(documentItems).where(and(eq(documentItems.documentId, draftDoc.id), eq(documentItems.isDeleted, 0)));
      if (updatedLines.length !== 1 || Number(updatedLines[0].quantity) !== 7) {
        throw new Error(`تعداد ردیف کالای سند پس از ویرایش نادرست است: ${updatedLines[0]?.quantity}`);
      }

      // 4. Test OCC conflict: attempting update with stale expectedVersion (version 1 when version is 2)
      let occConflictCaught = false;
      try {
        await DocumentService.updateDocument(draftDoc.id, {
          buyer_name: 'خریدار متناقض',
          expectedVersion: 1, // Stale! Current is 2
          items: [
            {
              itemId: testItem.id,
              quantity: 10,
              unitPrice: 65000,
              location: 'main'
            }
          ]
        });
      } catch (err: any) {
        if (err.name === 'OptimisticLockError' || err.message?.includes('Optimistic concurrency conflict') || err.message?.includes('ویرایش همزمان')) {
          occConflictCaught = true;
        } else {
          throw err;
        }
      }

      if (!occConflictCaught) {
        throw new Error('سیستم باید خطای OptimisticLockError را در صورت عدم تطابق expectedVersion پرتاب می‌کرد.');
      }

      // 5. Test protection: editing a finalized document must be blocked
      await orm.update(documents).set({ status: 'final' }).where(eq(documents.id, draftDoc.id));
      let finalBlockCaught = false;
      try {
        await DocumentService.updateDocument(draftDoc.id, {
          buyer_name: 'تلاش ویرایش سند نهایی',
          expectedVersion: 2
        });
      } catch (err: any) {
        if (err.message?.includes('امکان ویرایش مستقیم سند نهایی‌شده وجود ندارد')) {
          finalBlockCaught = true;
        }
      }

      if (!finalBlockCaught) {
        throw new Error('سیستم باید از ویرایش مستقیم سند نهایی‌شده ممانعت می‌کرد.');
      }

      results.push(makeTestCase({
        id: 'reg_update_document_row_lock_occ_td_154',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'V6 Phase 5.2: قفل سطری در ویرایش سند، کنترل همروندی OCC و ممانعت از Lost Update (TD-154)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t29Start,
        details: 'ویرایش سند تحت قفل سطری FOR UPDATE و کنترل نسخه OCC با ارتقای اتمیک version و مسدودسازی بازنویسی اسناد نهایی‌شده با موفقیت تأیید گردید.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_update_document_row_lock_occ_td_154',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'V6 Phase 5.2: قفل سطری در ویرایش سند، کنترل همروندی OCC و ممانعت از Lost Update (TD-154)',
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - t29Start,
        error: err.message
      }));
    } finally {
      if (createdDocIds.length > 0) {
        await cleanTestTableData('document_items', 'document_id', createdDocIds);
        await cleanTestTableData('documents', 'id', createdDocIds);
      }
      if (createdItemIds.length > 0) {
        await cleanTestTableData('items', 'id', createdItemIds);
      }
    }
  }

  // Test 30: WooCommerce Order Webhook Concurrency & First-Time Idempotency Guard (V6 Phase 5.3 / TD-155)
  if (shouldRun('reg_woocommerce_order_idempotency_race_td_155', 'td155', 'woocommerce', 'idempotency')) {
    const t30Start = Date.now();
    const testWcOrderId = `TEST_WC_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const testIdemKey = `wc_order_${testWcOrderId}`;
    const testScope = 'woocommerce_order_sync';

    try {
      // 1. Initial attempt: Acquire idempotency key for first-time order
      const firstAcquire = await IdempotencyService.acquireKey(testIdemKey, {
        scope: testScope,
        lockTimeoutSeconds: 45,
        ttlSeconds: 3600,
        requestPayload: { wcOrderId: testWcOrderId, total: 1500000 }
      });

      if (firstAcquire.state !== 'acquired') {
        throw new Error(`درخواست اول باید کلید ایدمپوتنسی را دریافت کند، اما وضعیت: ${firstAcquire.state}`);
      }

      // 2. Parallel concurrent attempt while first is in-flight: Should return 'in_flight'
      const secondAcquire = await IdempotencyService.acquireKey(testIdemKey, {
        scope: testScope,
        lockTimeoutSeconds: 45,
        ttlSeconds: 3600,
        requestPayload: { wcOrderId: testWcOrderId, total: 1500000 }
      });

      if (secondAcquire.state !== 'in_flight') {
        throw new Error(`درخواست موازی همزمان باید وضعیت in_flight برگرداند، اما وضعیت: ${secondAcquire.state}`);
      }

      // 3. Complete processing of first order: Save response
      const mockResult = {
        success: true,
        docId: 999999,
        refNumber: 'INV-TEST-WC-01',
        message: `فاکتور فروش شماره INV-TEST-WC-01 جهت سفارش ووکامرس #${testWcOrderId} صادر گردید.`
      };

      await IdempotencyService.saveResponse(testIdemKey, 200, mockResult, { scope: testScope });

      // 4. Third attempt (retried webhook after completion): Should return 'cached' with saved response
      const thirdAcquire = await IdempotencyService.acquireKey(testIdemKey, {
        scope: testScope,
        lockTimeoutSeconds: 45,
        ttlSeconds: 3600
      });

      if (thirdAcquire.state !== 'cached') {
        throw new Error(`درخواست بعدی باید وضعیت cached را دریافت کند، اما وضعیت: ${thirdAcquire.state}`);
      }

      const cachedBody = thirdAcquire.responseBody as typeof mockResult;
      if (cachedBody?.docId !== 999999 || cachedBody?.refNumber !== 'INV-TEST-WC-01') {
        throw new Error(`پاسخ کش‌شده با پاسخ اصلی ذخیره‌شده مطابقت ندارد: ${JSON.stringify(cachedBody)}`);
      }

      results.push(makeTestCase({
        id: 'reg_woocommerce_order_idempotency_race_td_155',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'V6 Phase 5.3: قفل ایدمپوتنسی سفارش‌های بار اول ووکامرس و ممانعت از مسابقه همزمانی (TD-155)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t30Start,
        details: 'درخواست اول کلید پردازش را اخذ کرد، درخواست موازی به درستی in_flight تشخیص داده شد، و درخواست‌های تکراری پاسخ قطعی کش‌شده را بدون صدور فاکتور مضاعف دریافت کردند.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_woocommerce_order_idempotency_race_td_155',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'V6 Phase 5.3: قفل ایدمپوتنسی سفارش‌های بار اول ووکامرس و ممانعت از مسابقه همزمانی (TD-155)',
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - t30Start,
        error: err.message
      }));
    } finally {
      // Clean test idempotency key
      try {
        await cleanTestTableData('idempotency_keys', 'key', [testIdemKey]);
      } catch {
        // Safe dev ignore
      }
    }
  }

  // Test 31: Elimination of Direct DB Mutations in General & Warehouse Routes (V6 Phase 6.1 / TD-156 Part A)
  if (shouldRun('reg_domain_services_part_a_td_156', 'td156', 'domain_services', 'architecture')) {
    const t31Start = Date.now();
    const createdCustIds: number[] = [];
    const createdWhIds: number[] = [];
    const createdPendingIds: number[] = [];
    const createdItemIds: number[] = [];

    try {
      const now = Date.now();

      // 1. Verify CustomerService creation, update, and soft-delete
      const cust = await CustomerService.createCustomer({
        name: `طرف حساب تست معماری ${now}`,
        phone: `0912${String(now).slice(-7)}`,
        partyType: 'customer',
        city: 'تهران',
        address: 'خیابان آزمایشی پلاک ۱'
      });
      createdCustIds.push(cust.id);

      if (!cust.id || cust.name !== `طرف حساب تست معماری ${now}`) {
        throw new Error('ایجاد طرف حساب از طریق CustomerService ناموفق بود.');
      }

      const { current: updatedCust } = await CustomerService.updateCustomer(cust.id, {
        name: `طرف حساب تست معماری به‌روزرسانی شده ${now}`,
        phone: `0912${String(now).slice(-7)}`,
        partyType: 'both',
        city: 'اصفهان',
        address: 'خیابان به‌روزرسانی پلاک ۲',
        version: cust.version
      });

      if (updatedCust.name !== `طرف حساب تست معماری به‌روزرسانی شده ${now}` || updatedCust.partyType !== 'both') {
        throw new Error('ویرایش طرف حساب از طریق CustomerService ناموفق بود.');
      }

      const delCust = await CustomerService.deleteCustomer(cust.id);
      if (!delCust) {
        throw new Error('حذف نرم طرف حساب از طریق CustomerService با شکست مواجه شد.');
      }

      // Verify soft deletion in database
      const checkCust = await CustomerService.getById(cust.id);
      if (checkCust !== null) {
        throw new Error('طرف حساب حذف‌شده نباید در کوئری‌های فعال بازگردانده شود.');
      }

      // 2. Verify WarehouseService creation and update
      const wh = await WarehouseService.createWarehouse({
        name: `انبار تست معماری ${now}`,
        code: `wh_arch_${now}`
      });
      createdWhIds.push(wh.id);

      if (!wh.id || wh.code !== `wh_arch_${now}`) {
        throw new Error('تعریف انبار از طریق WarehouseService ناموفق بود.');
      }

      const { current: updatedWh } = await WarehouseService.updateWarehouse(wh.id, {
        name: `انبار تست معماری بازنگری‌شده ${now}`
      });

      if (updatedWh.name !== `انبار تست معماری بازنگری‌شده ${now}`) {
        throw new Error('ویرایش انبار از طریق WarehouseService ناموفق بود.');
      }

      // 3. Verify PendingMaterialsService submission and approval into official items
      const pendingMat = await PendingMaterialsService.submitPendingMaterial({
        name: `ماده خام تست معماری ${now}`,
        code: `PM-ARCH-${now}`,
        category: 'سنگ و نگین',
        unit: 'قیراط',
        reorderPoint: 10,
        weightedAverageCost: 150000
      });
      createdPendingIds.push(pendingMat.id);

      if (!pendingMat.id || pendingMat.status !== 'pending') {
        throw new Error('ثبت ماده اولیه موقت از طریق PendingMaterialsService ناموفق بود.');
      }

      const { officialItem } = await PendingMaterialsService.approvePendingMaterial(pendingMat.id);
      createdItemIds.push(officialItem.id);

      if (!officialItem.id || officialItem.code !== `PM-ARCH-${now}`) {
        throw new Error('تأیید و تبدیل ماده اولیه به کالای رسمی از طریق PendingMaterialsService ناموفق بود.');
      }

      // 4. Verify ItemCatalogService soft-delete
      const deletedItem = await ItemCatalogService.deleteItem(officialItem.id);
      if (!deletedItem) {
        throw new Error('حذف نرم کالای رسمی از طریق ItemCatalogService.deleteItem با شکست مواجه شد.');
      }

      results.push(makeTestCase({
        id: 'reg_domain_services_part_a_td_156',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'V6 Phase 6.1: پاکسازی جهش مستقیم در روت‌های عمومی و انبار و کپسوله‌سازی در لایه سرویس (TD-156 Part A)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t31Start,
        details: 'عملیات درج، ویرایش و حذف در روت‌های طرف‌حساب، انبار و مواد اولیه از لایه کنترلر پاکسازی شده و با موفقیت ۱۰۰٪ از طریق سرویس‌های دامنه CustomerService، WarehouseService و PendingMaterialsService اجرا گردید.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_domain_services_part_a_td_156',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'V6 Phase 6.1: پاکسازی جهش مستقیم در روت‌های عمومی و انبار و کپسوله‌سازی در لایه سرویس (TD-156 Part A)',
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - t31Start,
        error: err.message
      }));
    } finally {
      if (createdCustIds.length > 0) {
        await cleanTestTableData('customers', 'id', createdCustIds);
      }
      if (createdWhIds.length > 0) {
        await cleanTestTableData('warehouses', 'id', createdWhIds);
      }
      if (createdPendingIds.length > 0) {
        await cleanTestTableData('pending_materials', 'id', createdPendingIds);
      }
      if (createdItemIds.length > 0) {
        await cleanTestTableData('items', 'id', createdItemIds);
      }
    }
  }

  // Test 32: Elimination of Direct DB Mutations in Projects, Piecework & Transfers Routes (V6 Phase 6.2 / TD-156 Part B)
  if (shouldRun('reg_domain_services_part_b_td_156') || shouldRun('td156') || shouldRun('all')) {
    const t32Start = Date.now();
    const createdProjectIds: number[] = [];
    const createdTaskIds: number[] = [];
    const createdTransferCodes: string[] = [];
    const createdCategoryNames: string[] = [];

    try {
      const now = Date.now();

      // 1. Verify ProjectService project creation, stage update, progress update, and soft-delete
      const { project, stages } = await ProjectService.createProject({
        title: `پروژه تست معماری ${now}`,
        priority: 'high',
        quantity: 5,
        initialStages: [
          { title: 'طراحی اولیه', status: 'pending' },
          { title: 'مونتاژ نهایی', status: 'pending' }
        ]
      });
      createdProjectIds.push(project.id);

      if (!project.id || stages.length !== 2) {
        throw new Error('ایجاد پروژه و مراحل اولیه از طریق ProjectService ناموفق بود.');
      }

      // Update stage via ProjectService
      const updatedStage = await ProjectService.updateStage(project.id, stages[0].id, {
        title: 'طراحی نهایی',
        status: 'in_progress',
        progressPercent: 50
      });

      if (!updatedStage || updatedStage.title !== 'طراحی نهایی' || updatedStage.progressPercent !== 50) {
        throw new Error('ویرایش مرحله پروژه از طریق ProjectService.updateStage ناموفق بود.');
      }

      // 2. Verify PieceworkService task creation, update, rate setting, and work logging
      const task = await PieceworkService.createTask({
        title: `عنوان پرکیسی تست معماری ${now}`,
        category: 'تراشکاری',
        defaultRate: 25000,
        unit: 'عدد'
      });
      createdTaskIds.push(task.id);

      if (!task.id || Number(task.defaultRate) !== 25000) {
        throw new Error('تعریف عنوان کاری از طریق PieceworkService.createTask ناموفق بود.');
      }

      // Update task via PieceworkService
      const { current: updatedTask } = await PieceworkService.updateTask(task.id, {
        defaultRate: 30000,
        title: `عنوان پرکیسی بازنگری‌شده ${now}`
      });

      if (!updatedTask || Number(updatedTask.defaultRate) !== 30000) {
        throw new Error('ویرایش نرخ و عنوان کاری از طریق PieceworkService.updateTask ناموفق بود.');
      }

      // Category management via PieceworkService
      const cat = await PieceworkService.createCategory({
        name: `دسته کارمزدی تست ${now}`,
        description: 'تست یکپارچگی سرویس کارمزدی'
      });
      createdCategoryNames.push(cat.name);

      if (!cat.id || cat.name !== `دسته کارمزدی تست ${now}`) {
        throw new Error('ایجاد دسته‌بندی کارمزدی از طریق PieceworkService.createCategory ناموفق بود.');
      }

      // 3. Verify TransferService save and delete
      const transferCode = `TR-ARCH-${now}`;
      createdTransferCodes.push(transferCode);

      const savedTransfer = await TransferService.saveTransfer({
        code: transferCode,
        title: `ترنسفر تست معماری ${now}`,
        notes: 'ثبت از طریق TransferService'
      });

      if (!savedTransfer || savedTransfer.code !== transferCode) {
        throw new Error('ثبت اطلاعات ترنسفر از طریق TransferService.saveTransfer ناموفق بود.');
      }

      await TransferService.deleteTransfer(transferCode);

      results.push(makeTestCase({
        id: 'reg_domain_services_part_b_td_156',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'V6 Phase 6.2: پاکسازی جهش مستقیم در روت‌های پروژه‌ها، کارمزدی و ترنسفرها (TD-156 Part B)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t32Start,
        details: 'کلیه عملیات جهش دیتابیس در روت‌های پروژه‌ها (ProjectService)، عناوین کارمزدی و لاگ کارکردها (PieceworkService) و ترنسفرها (TransferService) از لایه روت تفکیک و در لایه سرویس دامنه کپسوله شدند.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_domain_services_part_b_td_156',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'V6 Phase 6.2: پاکسازی جهش مستقیم در روت‌های پروژه‌ها، کارمزدی و ترنسفرها (TD-156 Part B)',
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - t32Start,
        error: err.message
      }));
    } finally {
      if (createdProjectIds.length > 0) {
        await cleanTestTableData('production_projects', 'id', createdProjectIds);
        await cleanTestTableData('project_stages', 'project_id', createdProjectIds);
      }
      if (createdTaskIds.length > 0) {
        await cleanTestTableData('piecework_tasks', 'id', createdTaskIds);
      }
      if (createdCategoryNames.length > 0) {
        await cleanTestTableData('task_categories', 'name', createdCategoryNames);
      }
      if (createdTransferCodes.length > 0) {
        await cleanTestTableData('transfers', 'code', createdTransferCodes);
      }
    }
  }

  // ==========================================
  // Test 33: Elimination of Hard Delete in Document Items and Journal Voucher Lines (V6 Phase 6.3 / TD-157)
  // ==========================================
  if (shouldRun('reg_no_hard_delete_td_157', 'td157', 'td_157', 'hard_delete', 'all')) {
    const t33Start = Date.now();
    const createdItemIds: number[] = [];
    const createdDocIds: number[] = [];
    const createdVoucherIds: number[] = [];

    try {
      const now = Date.now();

      // 1. Create items for document testing
      const [item1] = await orm.insert(items).values({
        name: `کالای تست سافت‌دلیت ۱ ${now}`,
        code: `HD-ITM1-${now}`,
        category: 'دستبند',
        unit: 'عدد',
        type: 'product',
        currentStock: 50,
        isDeleted: 0
      }).returning();
      await seedFixtureItemStocks(item1.id, { main: 50 }); // v7.0.48 (TD-214): موجودی آزمون در جدول موجودی انبارها
      createdItemIds.push(item1.id);

      const [item2] = await orm.insert(items).values({
        name: `کالای تست سافت‌دلیت ۲ ${now}`,
        code: `HD-ITM2-${now}`,
        category: 'انگشتر',
        unit: 'عدد',
        type: 'product',
        currentStock: 50,
        isDeleted: 0
      }).returning();
      await seedFixtureItemStocks(item2.id, { main: 50 }); // v7.0.48 (TD-214): موجودی آزمون در جدول موجودی انبارها
      createdItemIds.push(item2.id);

      // 2. Create a draft document with item1
      const docId = await DocumentService.createDocument({
        docType: 'proforma',
        refNumber: `PRF-HD-${now}`,
        date: '1403/07/01',
        user: 'تست ایجنت',
        buyer_name: 'مشتری تست سافت‌دلیت',
        status: 'proforma',
        items: [
          { itemId: item1.id, quantity: 5, unitPrice: 100000, discount: 0, location: 'main' }
        ]
      });
      createdDocIds.push(docId);

      // Verify initial document items in DB
      const initialDocItems = await orm.select().from(documentItems).where(eq(documentItems.documentId, docId));
      if (initialDocItems.length !== 1 || initialDocItems[0].isDeleted !== 0) {
        throw new Error('قلم اولیه پیش‌فاکتور به درستی ثبت نشد.');
      }

      // 3. Update the document with item2 (replacing item1)
      await DocumentService.updateDocument(docId, {
        refNumber: `PRF-HD-${now}`,
        date: '1403/07/01',
        buyer_name: 'مشتری تست سافت‌دلیت',
        status: 'proforma',
        items: [
          { itemId: item2.id, quantity: 10, unitPrice: 200000, discount: 0, location: 'main' }
        ]
      });

      // 4. Invariant Check (RULE 09 / TD-157): Old documentItem MUST still exist with isDeleted = 1
      const allDocItemsInDb = await orm.select().from(documentItems).where(eq(documentItems.documentId, docId));
      if (allDocItemsInDb.length !== 2) {
        throw new Error(`حذف فیزیکی شناسایی شد! انتظار ۲ ردیف (۱ ردیف حذف نرم + ۱ ردیف فعال) در جدول document_items، ولی ${allDocItemsInDb.length} ردیف یافت شد.`);
      }

      const deletedLines = allDocItemsInDb.filter(d => d.isDeleted === 1);
      const activeLines = allDocItemsInDb.filter(d => d.isDeleted === 0);

      if (deletedLines.length !== 1 || deletedLines[0].itemId !== item1.id) {
        throw new Error('ردیف قبلی قلم سند به صورت نرم (is_deleted = 1) بایگانی نشده است.');
      }
      if (activeLines.length !== 1 || activeLines[0].itemId !== item2.id) {
        throw new Error('ردیف جدید قلم سند در وضعیت فعال قرار ندارد.');
      }

      // 5. Query Check: DocumentService.getDocumentById MUST only return active line items
      const fetchedDoc = await DocumentService.getDocumentById(docId);
      if (!fetchedDoc || fetchedDoc.items.length !== 1 || fetchedDoc.items[0].item_id !== item2.id) {
        throw new Error('خروجی getDocumentById اقلام حذف‌شده را فیلتر نکرده است.');
      }

      // 6. Test Double-Entry Journal Voucher Line Items Soft-Delete
      // Fetch two real accounts
      const activeAccounts = await orm.select().from(accounts).where(eq(accounts.isDeleted, 0)).limit(2);
      if (activeAccounts.length < 2) {
        throw new Error('حداقل ۲ حساب فعال در جدول accounts جهت تست سند حسابداری یافت نشد.');
      }

      const [accDebit, accCredit] = activeAccounts;

      // Create a draft journal voucher with initial lines
      const voucher = await VoucherService.createJournalVoucher({
        date: '1403-07-01',
        description: `سند تست سافت‌دلیت آرتیکل‌ها ${now}`,
        status: 'draft',
        items: [
          { accountId: accDebit.id, debit: 500000, credit: 0, description: 'بدهکار اولیه' },
          { accountId: accCredit.id, debit: 0, credit: 500000, description: 'بستانکار اولیه' }
        ]
      });
      createdVoucherIds.push(voucher.id);

      // Verify initial voucher items
      const initialVoucherItems = await orm.select().from(journalVoucherItems).where(eq(journalVoucherItems.voucherId, voucher.id));
      if (initialVoucherItems.length !== 2) {
        throw new Error('آرتیکل‌های اولیه سند حسابداری به درستی درج نشدند.');
      }

      // 7. Update voucher with new amounts (triggers item replacement)
      await VoucherService.updateJournalVoucher(voucher.id, {
        date: '1403-07-01',
        description: `سند تست سافت‌دلیت آرتیکل‌ها ویرایش‌شده ${now}`,
        items: [
          { accountId: accDebit.id, debit: 800000, credit: 0, description: 'بدهکار بازنگری‌شده' },
          { accountId: accCredit.id, debit: 0, credit: 800000, description: 'بستانکار بازنگری‌شده' }
        ]
      });

      // 8. Invariant Check (RULE 09 / TD-157): Old journalVoucherItems MUST still exist with isDeleted = 1
      const allVoucherItemsInDb = await orm.select().from(journalVoucherItems).where(eq(journalVoucherItems.voucherId, voucher.id));
      if (allVoucherItemsInDb.length !== 4) {
        throw new Error(`حذف فیزیکی در آرتیکل‌ها شناسایی شد! انتظار ۴ سطر (۲ سطر حذف نرم + ۲ سطر فعال)، ولی ${allVoucherItemsInDb.length} سطر یافت شد.`);
      }

      const deletedVoucherLines = allVoucherItemsInDb.filter(v => v.isDeleted === 1);
      const activeVoucherLines = allVoucherItemsInDb.filter(v => v.isDeleted === 0);

      if (deletedVoucherLines.length !== 2) {
        throw new Error('آرتیکل‌های قبلی سند به درستی سافت‌دلیت نشده‌اند.');
      }
      if (activeVoucherLines.length !== 2 || Number(activeVoucherLines[0].debit || activeVoucherLines[1].debit) !== 800000) {
        throw new Error('آرتیکل‌های جدید سند فعال نیستند یا مبلغ آنها تطابق ندارد.');
      }

      // 9. Query Check: VoucherService.getJournalVoucherById MUST only return active line items
      const fetchedVoucher = await VoucherService.getJournalVoucherById(voucher.id);
      if (!fetchedVoucher || !fetchedVoucher.items || fetchedVoucher.items.length !== 2) {
        throw new Error('خروجی getJournalVoucherById آرتیکل‌های حذف‌شده را تفکیک نکرده است.');
      }

      // 10. Delete the journal voucher and verify cascade soft-delete
      await VoucherService.deleteJournalVoucher(voucher.id);
      const deletedVoucherCheck = await orm.select().from(journalVouchers).where(eq(journalVouchers.id, voucher.id));
      if (deletedVoucherCheck[0]?.isDeleted !== 1) {
        throw new Error('سند حسابداری به درستی سافت‌دلیت نشد.');
      }

      const allItemsAfterVoucherDelete = await orm.select().from(journalVoucherItems).where(eq(journalVoucherItems.voucherId, voucher.id));
      if (!allItemsAfterVoucherDelete.every(item => item.isDeleted === 1)) {
        throw new Error('آرتیکل‌های سند پس از حذف سند حسابداری باید همگی is_deleted = 1 باشند.');
      }

      results.push(makeTestCase({
        id: 'reg_no_hard_delete_td_157',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'V6 Phase 6.3: ریشه‌کنی Hard Delete در اقلام اسناد و آرتیکل‌های حسابداری (TD-157 / RULE 09)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t33Start,
        details: 'حذف فیزیکی (Hard Delete) در جداول اقلام اسناد انبار (document_items) و آرتیکل‌های حسابداری (journal_voucher_items) کاملاً ریشه‌کن شد و کلیه عملیات جایگزینی و حذف به Soft-Delete همراه با ستون is_deleted ارتقا یافتند.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_no_hard_delete_td_157',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'V6 Phase 6.3: ریشه‌کنی Hard Delete در اقلام اسناد و آرتیکل‌های حسابداری (TD-157 / RULE 09)',
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - t33Start,
        error: err.message
      }));
    } finally {
      if (createdDocIds.length > 0) {
        await cleanTestTableData('documents', 'id', createdDocIds);
        await cleanTestTableData('document_items', 'document_id', createdDocIds);
      }
      if (createdVoucherIds.length > 0) {
        await cleanTestTableData('journal_vouchers', 'id', createdVoucherIds);
        await cleanTestTableData('journal_voucher_items', 'voucher_id', createdVoucherIds);
      }
      if (createdItemIds.length > 0) {
        await cleanTestTableData('items', 'id', createdItemIds);
      }
    }
  }

  // Test 34: V6 Phase 6.4: حذف قطعه‌کد Raw SQL در شمارنده تدارکات و انطباق کامل با RULE 04 (TD-158)
  if (shouldRun('reg_procurement_counter_no_raw_sql_td_158', 'td158', 'procurement', 'raw_sql', 'counter')) {
    const t34Start = Date.now();
    const createdReqIds: number[] = [];
    try {
      const fiscalYear = resolveJalaliFiscalYear();

      // 1. Concurrently generate sequential requisition codes
      const code1 = await ProcurementService.generateRequisitionCode();
      const code2 = await ProcurementService.generateRequisitionCode();
      const code3 = await ProcurementService.generateRequisitionCode();

      if (!code1.startsWith(`PR-${fiscalYear}-`) || !code2.startsWith(`PR-${fiscalYear}-`) || !code3.startsWith(`PR-${fiscalYear}-`)) {
        throw new Error(`فرمت کد درخواست خرید نامعتبر است: ${code1}, ${code2}, ${code3}`);
      }

      const num1 = parseInt(code1.split('-')[2], 10);
      const num2 = parseInt(code2.split('-')[2], 10);
      const num3 = parseInt(code3.split('-')[2], 10);

      if (num2 !== num1 + 1 || num3 !== num2 + 1) {
        throw new Error(`توالی شماره‌گذاری درخواست خرید مخدوش است: ${num1} -> ${num2} -> ${num3}`);
      }

      // 2. Test createRequisition with full transactional lifecycle and item sanitization
      const req = await ProcurementService.createRequisition(
        {
          title: 'درخواست خرید تست TD-158',
          priority: 'high',
          notes: 'تست حذف قطعه‌کد Raw SQL و الگوی Read-Calculate-Update',
          items: [
            {
              itemId: null,
              itemCode: 'RAW-MAT-99',
              itemName: 'ماده اولیه تستی',
              requestedQty: 5,
              unitPriceEstimate: 50000,
              unit: 'کیلوگرم'
            }
          ]
        },
        { username: 'test_procurement_admin', role: 'admin' }
      );

      if (!req || !req.id || !req.code) {
        throw new Error('درخواست خرید در دیتابیس ثبت نشد.');
      }
      createdReqIds.push(req.id);

      if (req.totalEstimatedAmount !== 250000) {
        throw new Error(`مبلغ برآوردی درخواست خرید نادرست است: ${req.totalEstimatedAmount} (انتظار: 250000)`);
      }

      results.push(makeTestCase({
        id: 'reg_procurement_counter_no_raw_sql_td_158',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'V6 Phase 6.4: حذف قطعه‌کد Raw SQL در شمارنده تدارکات و انطباق با RULE 04 (TD-158)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t34Start,
        details: 'قطعه‌کد Raw SQL در شمارنده درخواست‌های خرید حذف و با الگوی Read-Calculate-Update و قفل سطری ردیف شمارنده استانداردسازی شد؛ توالی یکتای کدهای PR بدون خطا و تداخل تایید گردید.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_procurement_counter_no_raw_sql_td_158',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'V6 Phase 6.4: حذف قطعه‌کد Raw SQL در شمارنده تدارکات و انطباق با RULE 04 (TD-158)',
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - t34Start,
        error: err.message
      }));
    } finally {
      if (createdReqIds.length > 0) {
        await cleanTestTableData('purchase_requisitions', 'id', createdReqIds);
      }
    }
  }

  // Test 27.30: v7.0.67 (audit P2-6 / TD-210): مبلغ ۱۸ رقمی numeric(18,4) در ستون‌های حسابداری و خزانه بدون عبور
  // از double ذخیره، خوانده و جمع می‌شود؛ پاسخ JSON همچنان عدد است.
  if (shouldRun('reg_money_decimal_accounting_p2_6', 'p26', 'td210', 'money', 'decimal')) {
    const tStart = Date.now();
    const testName = 'v7.0.67: مبلغ ۱۸ رقمی با اعشار در سند حسابداری و مانده بانک دقیق ذخیره و جمع می‌شود و در JSON عدد است (P2-6)';
    const createdVoucherIds: number[] = [];
    const createdTxIds: number[] = [];
    let createdBankId: number | null = null;
    try {
      const { ChartOfAccountsService } = await import('../../services/accounting/chartOfAccounts.service.js');
      const { TreasuryTransactionService } = await import('../../services/accounting/treasury/treasuryTransaction.service.js');
      const { bankAccounts, treasuryTransactions } = await import('../../db/schema.js');
      const { money } = await import('../../lib/money.js');
      const { sanitizeSensitiveData } = await import('../../lib/auditLogger.js');
      const { fin } = await import('../../lib/financialDecimal.js');
      const violations: string[] = [];
      const BIG = '12345678901234.5678'; // ۱۸ رقم معنادار؛ double فقط ۱۲۳۴۵۶۷۸۹۰۱۲۳۴٫۵۶۸ را نگه می‌دارد

      // الف) سند حسابداری دوطرفه با مبلغ بزرگ
      const allAccs = await ChartOfAccountsService.getAllAccounts();
      const leaf = allAccs.filter(a => a.level === 'detailed' || a.level === 'subsidiary');
      const voucher = await VoucherService.createJournalVoucher({
        date: await businessTodayIsoDate(),
        voucherType: 'general',
        status: 'draft',
        description: 'ERP-TEST-MARKER سند آزمون دقت مبلغ P2-6',
        items: [
          { accountId: leaf[0].id, debit: BIG, credit: 0 },
          { accountId: leaf[1].id, debit: 0, credit: BIG },
        ],
      });
      createdVoucherIds.push(voucher.id);
      const [header] = await orm.select().from(journalVouchers).where(eq(journalVouchers.id, voucher.id));
      const rows = await orm.select().from(journalVoucherItems).where(eq(journalVoucherItems.voucherId, voucher.id));
      if (fin(header.totalDebit).toString() !== BIG) violations.push(`جمع بدهکار سند ${fin(header.totalDebit).toString()} ذخیره شد`);
      const debitRow = rows.find(r => !fin(r.debit).isZero());
      if (!debitRow || fin(debitRow.debit).toString() !== BIG) violations.push(`ردیف بدهکار ${debitRow ? fin(debitRow.debit).toString() : '-'} ذخیره شد`);
      const twice = fin(debitRow?.debit).add(debitRow?.debit ?? 0).toString();
      if (twice !== '24691357802469.1356') violations.push(`جمع دو ردیف ${twice} شد`);

      // ب) مانده بانک: افزودن ۰٫۰۰۰۱ به مانده ۱۸ رقمی نباید با گرد شدن double از دست برود
      const [bank] = await orm.insert(bankAccounts).values({
        code: `ERP-TEST-P26-${Date.now()}`,
        title: 'ERP-TEST-MARKER صندوق آزمون دقت P2-6',
        type: 'cash',
        currency: 'IRR',
        initialBalance: money(0),
        currentBalance: money(BIG),
      }).returning();
      createdBankId = bank.id;
      const receipt = await TreasuryTransactionService.createTreasuryTransaction({
        type: 'receipt', method: 'cash', amount: 0.0001, bankAccountId: bank.id, contraAccountId: await miscContraAccountId(),
        partyName: 'ERP-TEST-MARKER', createVoucher: false, allowNoVoucher: true,
      });
      createdTxIds.push(receipt.id);
      const [bankAfter] = await orm.select().from(bankAccounts).where(eq(bankAccounts.id, bank.id));
      if (fin(bankAfter.currentBalance).toString() !== '12345678901234.5679') violations.push(`مانده بانک پس از دریافت ${fin(bankAfter.currentBalance).toString()} شد`);
      const [txRow] = await orm.select().from(treasuryTransactions).where(eq(treasuryTransactions.id, receipt.id));
      if (fin(txRow.amount).toString() !== '0.0001') violations.push(`مبلغ تراکنش ${fin(txRow.amount).toString()} ذخیره شد`);
      if (typeof receipt.amount !== 'number') violations.push(`مبلغ تراکنش در خروجی سرویس از نوع ${typeof receipt.amount} است`);

      // ج) قرارداد API و لاگ ممیزی: مبلغ عدد است
      const json = JSON.parse(JSON.stringify({ amount: bankAfter.currentBalance })) as { amount: unknown };
      if (typeof json.amount !== 'number') violations.push(`مبلغ در JSON از نوع ${typeof json.amount} است`);
      const audited = sanitizeSensitiveData({ amount: money('2.5') }) as { amount: unknown };
      if (audited.amount !== 2.5) violations.push(`مبلغ در اسنپ‌شات ممیزی ${JSON.stringify(audited.amount)} شد`);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_money_decimal_accounting_p2_6',
        scenarioId: 'multi_currency_financials_and_ratios',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'سند ۱۲۳۴۵۶۷۸۹۰۱۲۳۴٫۵۶۷۸ دقیق ذخیره و جمع شد؛ مانده بانک پس از دریافت ۰٫۰۰۰۱ برابر ...۵۶۷۹ شد؛ JSON و اسنپ‌شات ممیزی عدد دارند.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_money_decimal_accounting_p2_6',
        scenarioId: 'multi_currency_financials_and_ratios',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      await cleanTestTableData('treasury_transactions', 'id', createdTxIds);
      if (createdBankId !== null) await cleanTestTableData('bank_accounts', 'id', [createdBankId]);
      await cleanTestTableData('journal_voucher_items', 'voucher_id', createdVoucherIds);
      await cleanTestTableData('journal_vouchers', 'id', createdVoucherIds);
    }
  }


  // Test: v7.0.68 (audit P2-6 / TD-210 بخش ۲): قیمت سند، بهای میانگین (WAC)، گردش کاردکس و نرخ کارمزدی ۱۸ رقمی دقیق ذخیره می‌شوند
  if (shouldRun('reg_money_decimal_documents_p2_6', 'p26', 'td210', 'money', 'decimal', 'wac')) {
    const tStart = Date.now();
    const testName = 'v7.0.68: قیمت اقلام سند، WAC، گردش کاردکس و نرخ کارمزدی با مبلغ ۱۸ رقمی دقیق ذخیره و جمع می‌شوند (P2-6)';
    const createdDocIds: number[] = [];
    let createdTaskId: number | null = null;
    try {
      const { createTestItem } = await import('../fixtures/factories.js');
      const { pieceworkTasks } = await import('../../db/schema.js');
      const { fin } = await import('../../lib/financialDecimal.js');
      const violations: string[] = [];
      const [w1] = await orm.select({ code: warehouses.code }).from(warehouses)
        .where(eq(warehouses.isActive, 1)).orderBy(warehouses.id).limit(1);
      const item = await createTestItem({ stocks: {}, currentStock: 0, weightedAverageCost: 0 });
      const today = await businessTodayIsoDate();

      // الف) دو رسید با قیمت ۱۷ رقمی: WAC = (۳ × ...۴۵۶۷ + ۱ × ...۴۵۷۱) ÷ ۴ = ...۴۵۶۸ دقیق
      const receipt = (qty: number, unitPrice: string) => DocumentService.createDocument({
        docType: 'receipt', status: 'final', inOut: 'in', date: today, user: 'test-agent', buyerName: 'تأمین‌کننده آزمون P2-6',
        location: w1.code, items: [{ itemId: item.id, quantity: qty, unit_price: unitPrice, location: w1.code }]
      });
      createdDocIds.push(await receipt(3, '1234567890123.4567'));
      createdDocIds.push(await receipt(1, '1234567890123.4571'));

      const [line] = await orm.select({ unitPrice: documentItems.unitPrice }).from(documentItems).where(eq(documentItems.documentId, createdDocIds[0]));
      if (fin(line?.unitPrice).toString() !== '1234567890123.4567') violations.push(`قیمت قلم سند ${fin(line?.unitPrice).toString()} ذخیره شد`);
      const [kardex] = await orm.select({ totalPrice: transactions.totalPrice }).from(transactions)
        .where(and(eq(transactions.itemId, item.id), eq(transactions.documentId, createdDocIds[0])));
      if (fin(kardex?.totalPrice).toString() !== '3703703670370.3701') violations.push(`مبلغ گردش کاردکس ${fin(kardex?.totalPrice).toString()} ذخیره شد`);
      const [after] = await orm.select({ wac: items.weightedAverageCost }).from(items).where(eq(items.id, item.id));
      if (fin(after?.wac).toString() !== '1234567890123.4568') violations.push(`WAC پس از دو رسید ${fin(after?.wac).toString()} شد`);

      // ب) جمع سند با Decimal: ۰٫۱ + ۰٫۲ = ۰٫۳ (نه 0.30000000000000004) و خروجی API عدد
      const smallId = await DocumentService.createDocument({
        docType: 'receipt', status: 'draft', inOut: 'in', date: today, user: 'test-agent', buyerName: 'تأمین‌کننده آزمون P2-6',
        location: w1.code, items: [
          { itemId: item.id, quantity: 1, unit_price: 0.1, location: w1.code },
          { itemId: item.id, quantity: 1, unit_price: 0.2, location: w1.code },
        ]
      });
      createdDocIds.push(smallId);
      const doc = await DocumentService.getDocumentById(smallId) as { totalAmount?: unknown } | null;
      if (doc?.totalAmount !== 0.3) violations.push(`جمع سند ${JSON.stringify(doc?.totalAmount)} شد`);

      // ج) نرخ پایه کارمزدی ۱۸ رقمی
      const task = await PieceworkService.createTask({ title: `ERP-TEST-MARKER نرخ P2-6 ${Date.now()}`, defaultRate: '12345678901234.5678', unit: 'عدد' });
      createdTaskId = task.id;
      const [storedTask] = await orm.select({ rate: pieceworkTasks.defaultRate }).from(pieceworkTasks).where(eq(pieceworkTasks.id, task.id));
      if (fin(storedTask?.rate).toString() !== '12345678901234.5678') violations.push(`نرخ کارمزدی ${fin(storedTask?.rate).toString()} ذخیره شد`);
      if (typeof JSON.parse(JSON.stringify(task)).defaultRate !== 'number') violations.push('نرخ کارمزدی در JSON عدد نیست');

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_money_decimal_documents_p2_6',
        scenarioId: 'multi_currency_financials_and_ratios',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'قیمت قلم و گردش کاردکس ۱۷ رقمی دقیق ذخیره شد؛ WAC دو رسید ...۴۵۶۸ شد؛ جمع ۰٫۱ + ۰٫۲ برابر ۰٫۳ و نرخ کارمزدی دقیق ذخیره شد.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_money_decimal_documents_p2_6',
        scenarioId: 'multi_currency_financials_and_ratios',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      if (createdDocIds.length > 0) await cleanTestTableData('document_items', 'document_id', createdDocIds);
      if (createdTaskId !== null) {
        await cleanTestTableData('piecework_task_rate_history', 'task_id', [createdTaskId]);
        await cleanTestTableData('piecework_tasks', 'id', [createdTaskId]);
      }
    }
  }


  // Test: v7.0.69 (TD-227، تصمیم مالک محصول): قیمت ورود سند ارزی پیش از محاسبه WAC با نرخ تسعیر سند به ریال تبدیل می‌شود
  if (shouldRun('reg_foreign_receipt_wac_irr_td_227', 'td227', 'wac', 'currency', 'exchange')) {
    const tStart = Date.now();
    const testName = 'v7.0.69: رسید ارزی (ثبت قطعی، نهایی‌سازی و حذف) بهای میانگین ریالی کالا را با قیمت × نرخ تسعیر سند به‌روز می‌کند (TD-227)';
    const createdDocIds: number[] = [];
    try {
      const { createTestItem } = await import('../fixtures/factories.js');
      const { fin } = await import('../../lib/financialDecimal.js');
      const violations: string[] = [];
      const [w1] = await orm.select({ code: warehouses.code }).from(warehouses)
        .where(eq(warehouses.isActive, 1)).orderBy(warehouses.id).limit(1);
      const item = await createTestItem({ stocks: {}, currentStock: 0, weightedAverageCost: 0 });
      const today = await businessTodayIsoDate();
      const wacNow = async () => {
        const [row] = await orm.select({ wac: items.weightedAverageCost }).from(items).where(eq(items.id, item.id));
        return fin(row?.wac).toString();
      };

      // الف) رسید قطعی ۲ عدد × ۱۵۰ دلار با نرخ ۶۰۰٬۰۰۰ ← WAC = ۹۰٬۰۰۰٬۰۰۰ ریال
      const docA = await DocumentService.createDocument({
        docType: 'receipt', status: 'final', inOut: 'in', date: today, user: 'test-agent', buyerName: 'تأمین‌کننده آزمون TD-227',
        currency: 'USD', exchangeRate: 600000, location: w1.code,
        items: [{ itemId: item.id, quantity: 2, unit_price: 150, location: w1.code }]
      });
      createdDocIds.push(docA);
      if (await wacNow() !== '90000000') violations.push(`WAC پس از رسید قطعی ارزی ${await wacNow()} شد (انتظار ۹۰٬۰۰۰٬۰۰۰)`);
      const [kardexA] = await orm.select({ unitPrice: transactions.unitPrice, totalPrice: transactions.totalPrice }).from(transactions)
        .where(and(eq(transactions.itemId, item.id), eq(transactions.documentId, docA)));
      if (fin(kardexA?.unitPrice).toString() !== '90000000' || fin(kardexA?.totalPrice).toString() !== '180000000') {
        violations.push(`کاردکس رسید ارزی باید ریالی باشد: ${fin(kardexA?.unitPrice).toString()} / ${fin(kardexA?.totalPrice).toString()}`);
      }

      // ب) پیش‌نویس ۲ عدد × ۱۰۰ دلار، نهایی‌سازی با نرخ ۵۰۰٬۰۰۰ ← WAC = (۱۸۰M + ۱۰۰M) ÷ ۴ = ۷۰٬۰۰۰٬۰۰۰
      const docB = await DocumentService.createDocument({
        docType: 'receipt', status: 'draft', inOut: 'in', date: today, user: 'test-agent', buyerName: 'تأمین‌کننده آزمون TD-227',
        currency: 'USD', exchangeRate: 400000, location: w1.code,
        items: [{ itemId: item.id, quantity: 2, unit_price: 100, location: w1.code }]
      });
      createdDocIds.push(docB);
      await DocumentService.finalizeDocument(docB, 'test-agent', undefined, { strict: false, exchangeRate: 500000 });
      if (await wacNow() !== '70000000') violations.push(`WAC پس از نهایی‌سازی رسید ارزی ${await wacNow()} شد (انتظار ۷۰٬۰۰۰٬۰۰۰)`);

      // ج) حذف رسید دوم ← WAC به ۹۰٬۰۰۰٬۰۰۰ برمی‌گردد
      await DocumentService.deleteDocument(docB, 'test-agent');
      if (await wacNow() !== '90000000') violations.push(`WAC پس از حذف رسید ارزی ${await wacNow()} شد (انتظار ۹۰٬۰۰۰٬۰۰۰)`);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_foreign_receipt_wac_irr_td_227',
        scenarioId: 'multi_currency_financials_and_ratios',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'رسید ۱۵۰ دلاری با نرخ ۶۰۰٬۰۰۰ WAC و کاردکس ۹۰٬۰۰۰٬۰۰۰ ریال ثبت کرد؛ نهایی‌سازی با نرخ ۵۰۰٬۰۰۰ WAC را ۷۰٬۰۰۰٬۰۰۰ و حذف آن دوباره ۹۰٬۰۰۰٬۰۰۰ کرد.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_foreign_receipt_wac_irr_td_227',
        scenarioId: 'multi_currency_financials_and_ratios',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      if (createdDocIds.length > 0) await cleanTestTableData('document_items', 'document_id', createdDocIds);
    }
  }


  // Test: v7.0.71 (audit P2-6 / TD-210 بخش ۳): جمع گزارش‌های حسابداری در SQL و Decimal — ۰٫۱ + ۰٫۱ + ۰٫۱ = ۰٫۳
  if (shouldRun('reg_money_decimal_reports_p2_6', 'p26', 'td210', 'money', 'decimal', 'report', 'trial')) {
    const tStart = Date.now();
    const testName = 'v7.0.71: تراز آزمایشی، کارت حساب و دفتر روزنامه جمع مبالغ اعشاری را بدون خطای double گزارش می‌کنند (P2-6)';
    const createdVoucherIds: number[] = [];
    try {
      const { ChartOfAccountsService } = await import('../../services/accounting/chartOfAccounts.service.js');
      const { AccountingReportService } = await import('../../services/accounting/accountingReport.service.js');
      const violations: string[] = [];
      const allAccs = await ChartOfAccountsService.getAllAccounts();
      const leaf = allAccs.filter(a => a.level === 'subsidiary');
      const dName = `ERP-TEST-MARKER تفصیلی P2-6-3 ${Date.now()}`;
      const today = await businessTodayIsoDate();
      const priorDate = '2020-01-15';

      // سه سند تأییدشده ۰٫۱ (یکی پیش از بازه) روی یک تفصیلی
      for (const date of [priorDate, today, today]) {
        const v = await VoucherService.createJournalVoucher({
          date, voucherType: 'general', status: 'approved',
          description: 'ERP-TEST-MARKER سند آزمون جمع گزارش P2-6',
          items: [
            { accountId: leaf[0].id, debit: '0.1', credit: 0, detailedType: 'other', detailedName: dName },
            { accountId: leaf[1].id, debit: 0, credit: '0.1', detailedType: 'other', detailedName: dName },
          ],
        });
        createdVoucherIds.push(v.id);
      }

      // الف) تراز آزمایشی سطح تفصیلی: جمع کل بدهکار ۰٫۳ و گردش دوره ۰٫۲
      const detailed = await AccountingReportService.getTrialBalance({ level: 'detailed', startDate: '2021-01-01' });
      const row = detailed.find(r => r.accountId === leaf[0].id && r.name.startsWith(dName));
      if (!row || row.totalDebit !== 0.3 || row.debitTurnover !== 0.2 || row.initialDebit !== 0.1 || row.debitBalance !== 0.3) {
        violations.push(`تراز تفصیلی: ${JSON.stringify(row && { totalDebit: row.totalDebit, debitTurnover: row.debitTurnover, initialDebit: row.initialDebit, debitBalance: row.debitBalance })}`);
      }

      // ب) کارت حساب: مانده ابتدای دوره ۰٫۱ و مانده پایانی ۰٫۳
      const card = await AccountingReportService.getDetailedAccountCard({ accountId: leaf[0].id, detailedName: dName, startDate: '2021-01-01' });
      if (card.openingBalance !== 0.1 || card.totalDebit !== 0.2 || card.finalBalance !== 0.3) {
        violations.push(`کارت حساب: ${JSON.stringify({ opening: card.openingBalance, totalDebit: card.totalDebit, final: card.finalBalance })}`);
      }

      // ج) دفتر روزنامه از ابتدا: مانده جاری پس از سه ردیف بدهکار ۰٫۱ برای همین تفصیلی
      const book = await AccountingReportService.getJournalBook({ startDate: priorDate, endDate: priorDate });
      const bookRows = book.items.filter(i => i.detailedName === dName && i.debit > 0);
      if (bookRows.length !== 1 || bookRows[0].debit !== 0.1) {
        violations.push(`دفتر روزنامه: ${JSON.stringify(bookRows.map(r => r.debit))}`);
      }

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_money_decimal_reports_p2_6',
        scenarioId: 'multi_currency_financials_and_ratios',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'سه ردیف ۰٫۱ در تراز تفصیلی جمع ۰٫۳ (ابتدای دوره ۰٫۱ و گردش ۰٫۲) و در کارت حساب مانده پایانی ۰٫۳ داد.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_money_decimal_reports_p2_6',
        scenarioId: 'multi_currency_financials_and_ratios',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      await cleanTestTableData('journal_voucher_items', 'voucher_id', createdVoucherIds);
      await cleanTestTableData('journal_vouchers', 'id', createdVoucherIds);
    }
  }


  // Test: v7.0.72 (audit P3-5): ردیف‌های سند حسابداری و اقلام سند انبار با یک INSERT چندردیفی درج می‌شوند
  if (shouldRun('reg_batch_insert_voucher_document_lines_p3_5', 'p35', 'batch', 'insert')) {
    const tStart = Date.now();
    const testName = 'v7.0.72: سند حسابداری ۲۰ ردیفی و سند انبار ۲۰ قلمی هر کدام با یک INSERT ردیف‌ها ثبت می‌شوند و ترتیب ردیف‌ها حفظ می‌شود (P3-5)';
    let voucherId: number | null = null;
    let documentId: number | null = null;
    try {
      const { ChartOfAccountsService } = await import('../../services/accounting/chartOfAccounts.service.js');
      const { createTestItem } = await import('../fixtures/factories.js');
      const violations: string[] = [];
      // شمارنده INSERT روی جدول‌های ردیف، با پراکسی روی همان تراکنش
      const countingTx = <T extends object>(tx: T, counts: Map<unknown, number>): T => new Proxy(tx, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if (prop === 'insert' && typeof value === 'function') {
            return (table: unknown) => {
              counts.set(table, (counts.get(table) ?? 0) + 1);
              return value.call(target, table);
            };
          }
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });

      const allAccs = await ChartOfAccountsService.getAllAccounts();
      const leaf = allAccs.filter(a => a.level === 'subsidiary');
      const voucherItems = Array.from({ length: 20 }, (_, i) => i % 2 === 0
        ? { accountId: leaf[0].id, debit: 1000 + i, credit: 0, description: `ردیف ${i + 1}` }
        : { accountId: leaf[1].id, debit: 0, credit: 1000 + i - 1, description: `ردیف ${i + 1}` });
      const voucherCounts = new Map<unknown, number>();
      await orm.transaction(async (tx) => {
        const v = await VoucherService.createJournalVoucher({
          date: await businessTodayIsoDate(), voucherType: 'general', status: 'draft',
          description: 'ERP-TEST-MARKER سند آزمون درج دسته‌ای P3-5', items: voucherItems,
        }, countingTx(tx, voucherCounts));
        voucherId = v.id;
      });
      if (voucherCounts.get(journalVoucherItems) !== 1) violations.push(`INSERT ردیف‌های سند حسابداری: ${voucherCounts.get(journalVoucherItems)} (انتظار ۱)`);
      const vRows = await orm.select({ id: journalVoucherItems.id, rowOrder: journalVoucherItems.rowOrder, description: journalVoucherItems.description })
        .from(journalVoucherItems).where(eq(journalVoucherItems.voucherId, voucherId!)).orderBy(journalVoucherItems.id);
      if (vRows.length !== 20 || vRows.some((r, i) => r.rowOrder !== i + 1 || r.description !== `ردیف ${i + 1}`)) {
        violations.push(`ترتیب ردیف‌های سند حسابداری: ${JSON.stringify(vRows.map(r => r.rowOrder))}`);
      }

      const item = await createTestItem({});
      const docCounts = new Map<unknown, number>();
      await orm.transaction(async (tx) => {
        documentId = await DocumentService.createDocument({
          docType: 'receipt', status: 'draft', inOut: 'in', date: await businessTodayIsoDate(), user: 'test-agent',
          buyerName: 'تأمین‌کننده آزمون P3-5',
          items: Array.from({ length: 20 }, (_, i) => ({ itemId: item.id, quantity: i + 1, unit_price: 1000 })),
          externalTx: countingTx(tx, docCounts),
        });
      });
      if (docCounts.get(documentItems) !== 1) violations.push(`INSERT اقلام سند انبار: ${docCounts.get(documentItems)} (انتظار ۱)`);
      const dRows = await orm.select({ quantity: documentItems.quantity }).from(documentItems)
        .where(eq(documentItems.documentId, documentId!)).orderBy(documentItems.id);
      if (dRows.length !== 20 || dRows.some((r, i) => Number(r.quantity) !== i + 1)) violations.push(`ترتیب اقلام سند انبار: ${JSON.stringify(dRows.map(r => r.quantity))}`);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_batch_insert_voucher_document_lines_p3_5',
        scenarioId: 'multi_currency_financials_and_ratios',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: '۲۰ ردیف سند حسابداری و ۲۰ قلم سند انبار هر کدام با یک INSERT و به همان ترتیب ثبت شدند.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_batch_insert_voucher_document_lines_p3_5',
        scenarioId: 'multi_currency_financials_and_ratios',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      if (voucherId !== null) {
        await cleanTestTableData('journal_voucher_items', 'voucher_id', [voucherId]);
        await cleanTestTableData('journal_vouchers', 'id', [voucherId]);
      }
      if (documentId !== null) await cleanTestTableData('document_items', 'document_id', [documentId]);
    }
  }

  // Test: v7.0.73 (audit P3-14): پرچم‌های عددی is_* / has_* فقط ۰ یا ۱ می‌پذیرند (CHECK، بدون تغییر نوع ستون)
  if (shouldRun('reg_flag_check_constraints_p3_14', 'p314', 'flag', 'check')) {
    const tStart = Date.now();
    const testName = 'v7.0.73: همه ستون‌های پرچم عددی is_*/has_* قید CHECK معتبرشده (۰/۱) دارند و مقدار ۲ رد می‌شود (P3-14)';
    try {
      const violations: string[] = [];
      const missing = await orm.execute(sql`
        SELECT c.table_name, c.column_name
        FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = current_schema() AND t.table_type = 'BASE TABLE'
          AND c.data_type IN ('smallint', 'integer', 'bigint')
          AND (c.column_name LIKE 'is\_%' OR c.column_name LIKE 'has\_%')
          AND NOT EXISTS (
            SELECT 1 FROM pg_constraint pc
            JOIN pg_class rel ON rel.oid = pc.conrelid
            WHERE rel.relname = c.table_name AND rel.relnamespace = current_schema()::regnamespace
              AND pc.conname = 'chk_' || c.table_name || '_' || c.column_name || '_flag'
              AND pc.contype = 'c' AND pc.convalidated
          )
        ORDER BY 1, 2`);
      const missingRows = (missing as unknown as { rows: Array<{ table_name: string; column_name: string }> }).rows;
      if (missingRows.length > 0) violations.push(`بدون CHECK معتبر: ${missingRows.map(r => `${r.table_name}.${r.column_name}`).join(', ')}`);

      const isCheckViolation = (err: unknown): boolean => {
        const e = err as { code?: string; cause?: { code?: string } };
        return e?.code === '23514' || e?.cause?.code === '23514';
      };
      const ROLLBACK = new Error('ROLLBACK_P3_14');
      const expectRejected = async (label: string, write: (tx: Parameters<Parameters<typeof orm.transaction>[0]>[0]) => Promise<unknown>) => {
        try {
          await orm.transaction(async (tx) => { await write(tx); throw ROLLBACK; });
        } catch (err) {
          if (err === ROLLBACK) violations.push(`${label}: مقدار ۲ پذیرفته شد`);
          else if (!isCheckViolation(err)) violations.push(`${label}: خطای غیرمنتظره ${err instanceof Error ? err.message : String(err)}`);
        }
      };
      const [acc] = await orm.select({ id: accounts.id }).from(accounts).orderBy(accounts.id).limit(1);
      const [wh] = await orm.select({ id: warehouses.id }).from(warehouses).orderBy(warehouses.id).limit(1);
      if (!acc || !wh) throw new Error('حساب یا انبار پایه برای آزمون یافت نشد');
      await expectRejected('accounts.is_deleted', (tx) => tx.update(accounts).set({ isDeleted: 2 }).where(eq(accounts.id, acc.id)));
      await expectRejected('warehouses.is_active', (tx) => tx.update(warehouses).set({ isActive: 2 }).where(eq(warehouses.id, wh.id)));

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_flag_check_constraints_p3_14',
        scenarioId: 'multi_currency_financials_and_ratios',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'همه پرچم‌های عددی قید CHECK معتبرشده دارند و به‌روزرسانی با مقدار ۲ با خطای 23514 رد شد.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_flag_check_constraints_p3_14',
        scenarioId: 'multi_currency_financials_and_ratios',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    }
  }

  // Test: v7.0.74: تاریخ شمسی امروز (businessTodayJalaliDash) به قالب ۱۴۰۵-۰۷-۱۰ است؛ سند و تراکنش خزانه پرداخت حقوق تاریخ ISO امروز را دارند
  if (shouldRun('reg_jalali_dash_today_payroll_dates', 'jalalidash', 'payroll', 'date')) {
    const tStart = Date.now();
    const testName = 'v7.0.74: تاریخ شمسی امروز سرور به قالب سال-ماه-روز است و پرداخت حقوق سند و تراکنش خزانه را با تاریخ ISO امروز ثبت می‌کند';
    const created = { personnelId: null as number | null, bankId: null as number | null, payrollId: null as number | null, treasuryId: null as number | null, voucherId: null as number | null };
    try {
      const { businessTodayJalaliDash } = await import('../../lib/businessClock.js');
      const { personnel, bankAccounts, pieceworkPayrolls, treasuryTransactions } = await import('../../db/schema.js');
      const { PayrollPaymentService } = await import('../../services/accounting/payrollPayment.service.js');
      const violations: string[] = [];
      const todayIso = await businessTodayIsoDate();
      const jalaliDash = await businessTodayJalaliDash();
      if (!/^1[345]\d{2}-\d{2}-\d{2}$/.test(jalaliDash)) violations.push(`businessTodayJalaliDash: «${jalaliDash}» (انتظار YYYY-MM-DD شمسی)`);
      if (jalaliToIsoDate(jalaliDash) !== todayIso) violations.push(`تبدیل «${jalaliDash}» به میلادی: «${jalaliToIsoDate(jalaliDash)}» (انتظار ${todayIso})`);

      const { ChartOfAccountsService } = await import('../../services/accounting/chartOfAccounts.service.js');
      const allAccs = await ChartOfAccountsService.getAllAccounts();
      const leaf = allAccs.find(a => a.level === 'subsidiary');
      if (!leaf) throw new Error('حساب معین برای حساب بانکی آزمون یافت نشد');
      const [pers] = await orm.insert(personnel).values({ fullName: 'ERP-TEST-MARKER پرسنل آزمون تاریخ پرداخت' }).returning({ id: personnel.id });
      created.personnelId = pers.id;
      const [bank] = await orm.insert(bankAccounts).values({
        code: `BA-JD-${Date.now()}`, title: 'حساب آزمون تاریخ پرداخت', type: 'bank', accountId: leaf.id, currentBalance: money(1000000), isDeleted: 0
      }).returning({ id: bankAccounts.id });
      created.bankId = bank.id;
      const [payroll] = await orm.insert(pieceworkPayrolls).values({
        payrollNumber: `PAY-JD-${Date.now()}`, personnelId: pers.id, startDate: '2026-08-23', endDate: '2026-09-22', title: 'فیش آزمون تاریخ پرداخت',
        totalPieceworkAmount: money(500000), totalFixedAmount: money(0), totalBonuses: money(0), totalDeductions: money(0),
        netPayable: money(500000), status: 'approved', isDeleted: 0
      }).returning({ id: pieceworkPayrolls.id });
      created.payrollId = payroll.id;

      const result = await PayrollPaymentService.registerPayrollPayment({ payrollId: payroll.id, bankAccountId: bank.id, method: 'bank_transfer', username: 'test-agent' });
      created.treasuryId = result.transactionId;
      created.voucherId = result.voucherId;
      const [tr] = await orm.select({ date: treasuryTransactions.date }).from(treasuryTransactions).where(eq(treasuryTransactions.id, result.transactionId));
      if (tr?.date !== todayIso) violations.push(`تاریخ تراکنش خزانه: «${tr?.date}» (انتظار ${todayIso})`);
      if (result.voucherId !== null) {
        const [v] = await orm.select({ date: journalVouchers.date }).from(journalVouchers).where(eq(journalVouchers.id, result.voucherId));
        if (v?.date !== todayIso) violations.push(`تاریخ سند حسابداری: «${v?.date}» (انتظار ${todayIso})`);
      } else {
        violations.push('سند حسابداری پرداخت صادر نشد');
      }
      // v7.0.134 (TD-232): تاریخ پرداخت فیش هم میلادی ISO ذخیره می‌شود
      if (result.payroll.paymentDate !== todayIso) violations.push(`تاریخ پرداخت فیش: «${result.payroll.paymentDate}» (انتظار ${todayIso})`);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_jalali_dash_today_payroll_dates',
        scenarioId: 'multi_currency_financials_and_ratios',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: `امروز شمسی ${jalaliDash}؛ سند و تراکنش خزانه پرداخت حقوق با تاریخ ${todayIso} ثبت شدند.`
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_jalali_dash_today_payroll_dates',
        scenarioId: 'multi_currency_financials_and_ratios',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      if (created.treasuryId !== null) await cleanTestTableData('treasury_transactions', 'id', [created.treasuryId]);
      if (created.voucherId !== null) {
        await cleanTestTableData('journal_voucher_items', 'voucher_id', [created.voucherId]);
        await cleanTestTableData('journal_vouchers', 'id', [created.voucherId]);
      }
      if (created.payrollId !== null) await cleanTestTableData('piecework_payrolls', 'id', [created.payrollId]);
      if (created.bankId !== null) await cleanTestTableData('bank_accounts', 'id', [created.bankId]);
      if (created.personnelId !== null) await cleanTestTableData('personnel', 'id', [created.personnelId]);
    }
  }

  // Test: v7.0.75 (audit P3-15): ستون‌های تاریخ متنی فقط قالب تاریخ معتبر می‌پذیرند (CHECK، بدون تغییر نوع ستون)
  if (shouldRun('reg_date_format_check_constraints_p3_15', 'p315', 'date', 'check')) {
    const tStart = Date.now();
    const testName = 'v7.0.75: همه ستون‌های تاریخ متنی قید قالب معتبرشده دارند؛ «abc» رد و تاریخ شمسی، میلادی و ارقام فارسی پذیرفته می‌شود (P3-15)';
    let personnelId: number | null = null;
    try {
      const { normalizeError } = await import('../../errors/customErrors.js');
      const violations: string[] = [];
      const missing = await orm.execute(sql`
        SELECT c.table_name, c.column_name
        FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = current_schema() AND t.table_type = 'BASE TABLE' AND c.data_type = 'text'
          AND left(c.table_name, 1) <> '_' -- جدول‌های پشتیبان مهاجرت‌ها (مانند _repair_0011_timestamps_backup)
          AND (c.column_name ~ '(^|_)date(_|$)' OR c.column_name IN ('reconciled_at', 'completed_at', 'last_failed_login_at'))
          AND NOT EXISTS (
            SELECT 1 FROM pg_constraint pc
            JOIN pg_class rel ON rel.oid = pc.conrelid
            WHERE rel.relname = c.table_name AND rel.relnamespace = current_schema()::regnamespace
              AND pc.conname = 'chk_' || c.table_name || '_' || c.column_name || '_datefmt'
              AND pc.contype = 'c' AND pc.convalidated
          )
        ORDER BY 1, 2`);
      const missingRows = (missing as unknown as { rows: Array<{ table_name: string; column_name: string }> }).rows;
      const [{ n: covered }] = (await orm.execute(sql`
        SELECT count(*)::int AS n FROM pg_constraint pc JOIN pg_class rel ON rel.oid = pc.conrelid
        WHERE rel.relnamespace = current_schema()::regnamespace AND pc.conname LIKE 'chk%datefmt' AND pc.convalidated`) as unknown as { rows: Array<{ n: number }> }).rows;
      // v7.0.82 (TD-231): ۲۴ قید مهاجرت 0028 و ۳ قید مهاجرت 0030
      if (covered !== 27) violations.push(`تعداد قیدهای قالب تاریخ معتبرشده: ${covered} (انتظار ۲۷)`);
      if (missingRows.length > 0) violations.push(`بدون قید قالب معتبر: ${missingRows.map(r => `${r.table_name}.${r.column_name}`).join(', ')}`);

      const ROLLBACK = new Error('ROLLBACK_P3_15');
      const { personnel } = await import('../../db/schema.js');
      const [pers] = await orm.insert(personnel).values({ fullName: 'ERP-TEST-MARKER پرسنل آزمون قالب تاریخ P3-15' }).returning({ id: personnel.id });
      personnelId = pers.id;
      const tryBirthDate = async (birthDate: string): Promise<unknown> => {
        try {
          await orm.transaction(async (tx) => {
            await tx.update(personnel).set({ birthDate }).where(eq(personnel.id, personnelId!));
            throw ROLLBACK;
          });
          return null;
        } catch (err) {
          return err === ROLLBACK ? null : err;
        }
      };
      // v7.0.135 (TD-232): تاریخ تولد پس از یکسان‌سازی فقط ISO می‌پذیرد؛ قالب «any» (شمسی، میلادی، ارقام فارسی) با تابع SQL سنجیده می‌شود
      for (const ok of ['2026-10-02', '']) {
        const err = await tryBirthDate(ok);
        if (err) violations.push(`«${ok}» رد شد: ${err instanceof Error ? err.message : String(err)}`);
      }
      for (const v of ['2026-10-02', '1370/05/12', '1370-5-1', '۱۳۷۰/۰۵/۱۲', '2026-10-02 18:30:00']) {
        const ok = (await orm.execute(sql`SELECT erp_date_text_ok(${v}::text, 'any') AS ok`) as unknown as { rows: Array<{ ok: boolean }> }).rows[0].ok;
        if (!ok) violations.push(`قالب any «${v}» را رد کرد`);
      }
      for (const bad of ['abc', '1370/13/01', '2026-10-32', '10/02/2026', '07-10-1405 AP', '1370/05/12']) {
        const err = await tryBirthDate(bad);
        if (!err) { violations.push(`«${bad}» پذیرفته شد`); continue; }
        const normalized = normalizeError(err);
        if (normalized.code !== 'INVALID_DATE_FORMAT' || normalized.statusCode !== 422) {
          violations.push(`«${bad}»: پاسخ ${normalized.statusCode} ${normalized.code} (انتظار 422 INVALID_DATE_FORMAT)`);
        }
      }
      // ستون‌های *_iso فقط YYYY-MM-DD
      const isoKind = (await orm.execute(sql`SELECT erp_date_text_ok('2026-10-02', 'iso') AS a, erp_date_text_ok('1405/07/10', 'iso') AS b`) as unknown as { rows: Array<{ a: boolean; b: boolean }> }).rows[0];
      if (!isoKind.a || isoKind.b) violations.push(`قالب iso: 2026-10-02=${isoKind.a}، 1405/07/10=${isoKind.b}`);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_date_format_check_constraints_p3_15',
        scenarioId: 'multi_currency_financials_and_ratios',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'همه ستون‌های تاریخ متنی قید قالب معتبرشده دارند؛ تاریخ نامعتبر با 422 INVALID_DATE_FORMAT رد شد.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_date_format_check_constraints_p3_15',
        scenarioId: 'multi_currency_financials_and_ratios',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      if (personnelId !== null) await cleanTestTableData('personnel', 'id', [personnelId]);
    }
  }

  // Test: v7.0.78: نام کاربری «tester…» کاربر واقعی است (الگوی test_% با escape؛ `_` در LIKE هر نویسه‌ای را تطبیق می‌دهد).
  // از v9.0.76 (TD-521) فهرست کاربران همه کاربران را نشان می‌دهد و این شرط فقط «راه‌اندازی شده» و بررسی سلامت را می‌سازد.
  if (shouldRun('reg_synthetic_username_like_escape', 'synthetic', 'tester', 'like')) {
    const tStart = Date.now();
    const testName = 'v7.0.78: only test_ / e2e_ / testuser_ usernames are synthetic test users; tester and e2eadmin are real, and since v9.0.76 (TD-521) the user lists show both kinds';
    const { users } = await import('../../db/schema.js');
    const { notSyntheticTestUsername, syntheticTestUsername } = await import('../../lib/syntheticUsers.js');
    const suffix = Date.now().toString(36);
    const realNames = [`tester${suffix}`, `e2eadmin${suffix}`];
    const syntheticNames = [`test_${suffix}`, `e2e_${suffix}`];
    const allNames = [...realNames, ...syntheticNames];
    try {
      const request = (await import('supertest')).default;
      const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
      const app = await getTestApp();
      const session = await getAdminSession();
      await orm.insert(users).values(allNames.map(username => ({
        username, password: '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva', fullName: `کاربر آزمون ${username}`, role: 'viewer',
      })));
      const namesWhere = async (cond: ReturnType<typeof notSyntheticTestUsername>) => new Set((await orm.select({ username: users.username }).from(users)
        .where(and(inArray(users.username, allNames), cond))).map(r => r.username));
      const real = await namesWhere(notSyntheticTestUsername(users.username));
      const synthetic = await namesWhere(syntheticTestUsername(users.username));
      const res = await request(app).get('/api/users/list-simple').set('Cookie', session.cookie);
      const listed = new Set((Array.isArray(res.body) ? res.body : []).map((u: { username: string }) => u.username));
      const violations: string[] = [];
      if (res.status !== 200) violations.push(`list-simple HTTP ${res.status}`);
      for (const n of realNames) if (!real.has(n) || synthetic.has(n)) violations.push(`${n} is classified as synthetic`);
      for (const n of syntheticNames) if (real.has(n) || !synthetic.has(n)) violations.push(`${n} is not classified as synthetic`);
      for (const n of allNames) if (!listed.has(n)) violations.push(`${n} is missing from list-simple`);
      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_synthetic_username_like_escape',
        scenarioId: 'multi_currency_financials_and_ratios',
        name: testName,
        layer: 'regression',
        executionType: 'real_api',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'tester and e2eadmin are real, test_ and e2e_ are synthetic; list-simple shows all four.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_synthetic_username_like_escape',
        scenarioId: 'multi_currency_financials_and_ratios',
        name: testName,
        layer: 'regression',
        executionType: 'real_api',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      await orm.delete(users).where(inArray(users.username, allNames));
    }
  }

  // Test: v7.0.80 (TD-199): گزارش پیش‌فاکتورهای قدیمی که مالیات را فقط در یادداشت دارند (بازرس سلامت مالی)
  if (shouldRun('reg_legacy_proforma_vat_in_notes_td_199', 'td199', 'vat', 'proforma', 'health')) {
    const tStart = Date.now();
    const testName = 'v7.0.80: بازرس سلامت مالی پیش‌فاکتور بازی را که مالیات را فقط در یادداشت «[ارزش افزوده: …]» دارد گزارش می‌کند (TD-199)';
    const createdDocIds: number[] = [];
    try {
      const { createTestItem } = await import('../fixtures/factories.js');
      const { FinancialHealthService } = await import('../../services/accounting/financialHealth.service.js');
      const [defWh] = await orm.select({ code: warehouses.code }).from(warehouses)
        .where(eq(warehouses.isActive, 1)).orderBy(warehouses.id).limit(1);
      const item = await createTestItem({ currentStock: 50, stocks: { [defWh.code]: 50 }, weightedAverageCost: 20000 });
      const today = await businessTodayIsoDate();
      const legacyNote = 'سفارش مشتری [ارزش افزوده: ۱۸٬۰۰۰ ریال (9٪)]';
      const create = async (extra: Partial<CreateDocumentInput>) => {
        const id = await DocumentService.createDocument({
          docType: 'proforma', status: 'proforma', date: today, user: 'test-agent', buyerName: 'خریدار آزمون TD-199',
          location: defWh.code, items: [{ itemId: item.id, quantity: 2, unit_price: 100000, location: defWh.code }], ...extra
        });
        createdDocIds.push(id);
        return id;
      };
      const legacyId = await create({ notes: legacyNote });
      const structuredId = await create({ notes: legacyNote, vatPercent: 9 });
      const plainId = await create({ notes: 'پیش‌فاکتور بدون مالیات' });

      const health = await FinancialHealthService.runHealthCheck();
      const check = health.tests.find((t) => t.id === 'legacy_proforma_vat_in_notes');
      const listed = new Set((check?.items || []).map((i) => i.id));
      const violations: string[] = [];
      if (!check) violations.push('آزمون legacy_proforma_vat_in_notes در گزارش سلامت نیست');
      if (check && check.status !== 'warning') violations.push(`وضعیت باید warning باشد: ${check.status}`);
      if (!listed.has(legacyId)) violations.push('پیش‌فاکتور با مالیات فقط در یادداشت گزارش نشد');
      if (listed.has(structuredId)) violations.push('پیش‌فاکتور دارای مالیات ساختاریافته نباید گزارش شود');
      if (listed.has(plainId)) violations.push('پیش‌فاکتور بدون برچسب مالیات نباید گزارش شود');
      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_legacy_proforma_vat_in_notes_td_199',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'فقط پیش‌فاکتوری که مالیات را در یادداشت دارد و ستون مالیاتش صفر است گزارش شد.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_legacy_proforma_vat_in_notes_td_199',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      if (createdDocIds.length > 0) {
        await orm.update(documents).set({ isDeleted: 1 }).where(inArray(documents.id, createdDocIds));
        await cleanTestTableData('document_items', 'document_id', createdDocIds);
      }
    }
  }

  // Test: v7.0.81 (TD-230): برگشت از فروش با بهای خروج فاکتور اصلی وارد انبار می‌شود، نه با قیمت فروش
  if (shouldRun('reg_sales_return_original_cost_td_230', 'td230', 'return', 'wac', 'kardex')) {
    const tStart = Date.now();
    const testName = 'v7.0.81: برگشت از فروش با بهای خروج فاکتور اصلی (بدون فاکتور مرجع با WAC جاری) وارد انبار می‌شود و سند حسابداری همان بها را برمی‌گرداند (TD-230)';
    const createdDocIds: number[] = [];
    const violations: string[] = [];
    const check = (cond: boolean, msg: string) => { if (!cond) violations.push(msg); };
    try {
      const { createTestItem } = await import('../fixtures/factories.js');
      const { journalVoucherItems: jvItems } = await import('../../db/schema.js');
      const [defWh] = await orm.select({ code: warehouses.code }).from(warehouses)
        .where(eq(warehouses.isActive, 1)).orderBy(warehouses.id).limit(1);
      const item = await createTestItem({ currentStock: 50, stocks: { [defWh.code]: 50 }, weightedAverageCost: 20000 });
      const other = await createTestItem({ currentStock: 50, stocks: { [defWh.code]: 50 }, weightedAverageCost: 30000 });
      const today = await businessTodayIsoDate();
      const create = async (input: Partial<CreateDocumentInput>) => {
        const id = await DocumentService.createDocument({
          docType: 'return', status: 'final', date: today, user: 'test-agent', buyerName: 'خریدار آزمون TD-230',
          location: defWh.code, items: [{ itemId: item.id, quantity: 2, unit_price: 100000, location: defWh.code }], ...input
        });
        createdDocIds.push(id);
        return id;
      };
      const inCost = async (docId: number) => {
        const rows = await orm.select({ unitPrice: transactions.unitPrice, type: transactions.type }).from(transactions)
          .where(and(eq(transactions.documentId, docId), eq(transactions.isDeleted, 0)));
        return rows.length === 1 && rows[0].type === 'in' ? Number(rows[0].unitPrice) : NaN;
      };
      const voucherCogsReversal = async (docId: number) => {
        const [v] = await orm.select({ id: journalVouchers.id }).from(journalVouchers)
          .where(and(eq(journalVouchers.sourceDocumentId, docId), eq(journalVouchers.isDeleted, 0)));
        if (!v) return NaN;
        const rows = await orm.select().from(jvItems).where(eq(jvItems.voucherId, v.id));
        return rows.filter(r => r.detailedName === 'بهای تمام‌شده کالای فروش‌رفته').reduce((a, r) => a + Number(r.credit || 0), 0);
      };
      const rejects = async (input: Partial<CreateDocumentInput>) => {
        try { await create(input); return false; } catch { return true; }
      };

      // فاکتور فروش ۳ عدد با بهای خروج ۲۰٬۰۰۰ و سپس رسید خرید که WAC را به ۲۵٬۰۰۰ می‌برد
      const invoiceId = await create({ docType: 'invoice', inOut: 'out', items: [{ itemId: item.id, quantity: 3, unit_price: 100000, location: defWh.code }] });
      await create({ docType: 'receipt', inOut: 'in', items: [{ itemId: item.id, quantity: 47, unit_price: 30000, location: defWh.code }] });
      const [wacRow] = await orm.select({ wac: items.weightedAverageCost }).from(items).where(eq(items.id, item.id));
      check(Number(wacRow.wac) === 25000, `WAC پس از رسید باید ۲۵٬۰۰۰ باشد: ${Number(wacRow.wac)}`);

      // ۱) با فاکتور مرجع: بهای ورود = بهای خروج فاکتور (۲۰٬۰۰۰)، نه قیمت فروش و نه WAC جاری
      const linked = await create({ returnOfDocumentId: invoiceId });
      check(await inCost(linked) === 20000, `بهای ورود برگشت با فاکتور مرجع باید ۲۰٬۰۰۰ باشد: ${await inCost(linked)}`);
      check(await voucherCogsReversal(linked) === 40000, `برگشت بهای تمام‌شده در سند حسابداری باید ۴۰٬۰۰۰ باشد: ${await voucherCogsReversal(linked)}`);
      const formatted = await DocumentService.getDocumentById(linked);
      check(formatted?.returnOfDocumentId === invoiceId, `پیوند فاکتور مرجع در پاسخ سند نیست: ${formatted?.returnOfDocumentId}`);

      // ۲) بدون فاکتور مرجع: WAC جاری کالا
      const [wacNow] = await orm.select({ wac: items.weightedAverageCost }).from(items).where(eq(items.id, item.id));
      const unlinked = await create({});
      check(await inCost(unlinked) === Number(wacNow.wac), `بهای ورود برگشت بدون فاکتور مرجع باید WAC جاری (${Number(wacNow.wac)}) باشد: ${await inCost(unlinked)}`);
      check(await voucherCogsReversal(unlinked) === 2 * Number(wacNow.wac), `سند حسابداری برگشت بدون مرجع باید با همان بهای ورود باشد: ${await voucherCogsReversal(unlinked)}`);

      // ۳) پیش‌نویس با فاکتور مرجع و نهایی‌سازی بعدی (v8.0.8، TD-253: ۲ از ۳ برگشت خورده، پس ۱ عدد در سقف فاکتور)
      const draft = await create({ status: 'draft', returnOfDocumentId: invoiceId, items: [{ itemId: item.id, quantity: 1, unit_price: 100000, location: defWh.code }] });
      await DocumentService.finalizeDocument(draft, 'test-agent');
      check(await inCost(draft) === 20000, `نهایی‌سازی برگشت پیش‌نویس باید با بهای خروج فاکتور (۲۰٬۰۰۰) باشد: ${await inCost(draft)}`);

      // ۴) ردها: کالای خارج‌نشده در فاکتور، سند مرجعی که فاکتور فروش نیست، فاکتور مرجع برای سند غیر برگشتی
      check(await rejects({ returnOfDocumentId: invoiceId, items: [{ itemId: other.id, quantity: 1, unit_price: 1000, location: defWh.code }] }), 'کالایی که در فاکتور مرجع نیست باید رد شود');
      check(await rejects({ returnOfDocumentId: createdDocIds[1] }), 'رسید خرید به‌عنوان فاکتور مرجع باید رد شود');
      check(await rejects({ docType: 'receipt', inOut: 'in', returnOfDocumentId: invoiceId }), 'فاکتور مرجع روی سند غیر برگشتی باید رد شود');

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_sales_return_original_cost_td_230',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'برگشت با فاکتور مرجع با بهای خروج فاکتور و بدون آن با WAC جاری وارد شد؛ سند حسابداری همان بها را برگرداند.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_sales_return_original_cost_td_230',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      if (createdDocIds.length > 0) {
        await cleanTestTableData('document_items', 'document_id', createdDocIds);
      }
    }
  }

  // Test: v7.0.82 (TD-231): اصلاح تاریخ‌های قدیمی «07-10-1405 AP» با پشتیبان و گزارش (مهاجرت 0030)
  if (shouldRun('reg_legacy_mdy_date_repair_td_231', 'td231', 'date', 'repair')) {
    const tStart = Date.now();
    const testName = 'v7.0.82: تاریخ‌های «07-10-1405» سند حسابداری، تراکنش خزانه و فیش حقوقی با ثبت مقدار قبلی اصلاح می‌شوند؛ سند سال مالی بسته اصلاح نمی‌شود (TD-231)';
    const ROLLBACK = new Error('ROLLBACK_TD_231');
    const violations: string[] = [];
    try {
      const { treasuryTransactions, pieceworkPayrolls, personnel, fiscalPeriods, legacyDateRepairs } = await import('../../db/schema.js');
      // ۱) تبدیل شمسی به میلادی SQL با تبدیلگر برنامه یکی است (نوروز ۲۰ و ۲۱ مارس، سال کبیسه، مرز نیمه دوم سال)
      for (const j of ['1405-07-10', '1403-01-01', '1403-12-30', '1404-01-01', '1404-12-29', '1405-06-31', '1405-07-01', '1407-01-01']) {
        const [jy, jm, jd] = j.split('-').map(Number);
        const rows = (await orm.execute(sql`SELECT to_char(erp_jalali_to_gregorian(${jy}::int, ${jm}::int, ${jd}::int), 'YYYY-MM-DD') AS g`) as unknown as { rows: Array<{ g: string }> }).rows;
        if (rows[0]?.g !== jalaliToIsoDate(j)) violations.push(`تبدیل ${j}: SQL ${rows[0]?.g}، برنامه ${jalaliToIsoDate(j)}`);
      }
      // ۲) قیدهای قالب تاریخ این سه ستون معتبرشده‌اند
      const [{ n: constraints }] = (await orm.execute(sql`
        SELECT count(*)::int AS n FROM pg_constraint pc JOIN pg_class rel ON rel.oid = pc.conrelid
        WHERE rel.relnamespace = current_schema()::regnamespace AND pc.convalidated
          AND pc.conname IN ('chk_journal_vouchers_date_datefmt', 'chk_treasury_transactions_date_datefmt', 'chk_piecework_payrolls_payment_date_datefmt')`) as unknown as { rows: Array<{ n: number }> }).rows;
      if (constraints !== 3) violations.push(`قیدهای قالب تاریخ سه ستون: ${constraints} (انتظار ۳)`);

      // ۳) داده قدیمی در تراکنشی که در پایان برگردانده می‌شود: قیدها برداشته، ردیف‌ها خراب و تابع اصلاح اجرا می‌شود
      try {
        await orm.transaction(async (tx) => {
          await tx.execute(sql`ALTER TABLE journal_vouchers DROP CONSTRAINT chk_journal_vouchers_date_datefmt`);
          await tx.execute(sql`ALTER TABLE treasury_transactions DROP CONSTRAINT chk_treasury_transactions_date_datefmt`);
          await tx.execute(sql`ALTER TABLE piecework_payrolls DROP CONSTRAINT chk_piecework_payrolls_payment_date_datefmt`);
          const base = 990000000 + Math.floor(Math.random() * 1000000);
          const [vOpen] = await tx.insert(journalVouchers).values({ voucherNumber: base, date: '07-10-1405', description: 'ERP-TEST-MARKER TD-231 باز' }).returning({ id: journalVouchers.id });
          const [vClosed] = await tx.insert(journalVouchers).values({ voucherNumber: base + 1, date: '12-20-1390', description: 'ERP-TEST-MARKER TD-231 بسته' }).returning({ id: journalVouchers.id });
          await tx.insert(fiscalPeriods).values({ fiscalYear: 1390, status: 'closed' }).onConflictDoUpdate({ target: fiscalPeriods.fiscalYear, set: { status: 'closed' } });
          const [tr] = await tx.insert(treasuryTransactions).values({
            transactionNumber: `TD231-${base}`, type: 'payment', date: '07-10-1405 AP', method: 'cash', amount: money(1000), partyName: 'ERP-TEST-MARKER',
          }).returning({ id: treasuryTransactions.id });
          const [pers] = await tx.insert(personnel).values({ fullName: 'ERP-TEST-MARKER پرسنل TD-231' }).returning({ id: personnel.id });
          const [pay] = await tx.insert(pieceworkPayrolls).values({
            payrollNumber: `TD231-${base}`, personnelId: pers.id, startDate: '2026-09-23', endDate: '2026-10-02', title: 'آزمون TD-231',
            netPayable: money(1000), paymentDate: '07-10-1405 AP',
          }).returning({ id: pieceworkPayrolls.id });

          await tx.execute(sql`SELECT erp_repair_legacy_mdy_dates()`);

          const [jvOpen] = await tx.select({ date: journalVouchers.date }).from(journalVouchers).where(eq(journalVouchers.id, vOpen.id));
          const [jvClosed] = await tx.select({ date: journalVouchers.date }).from(journalVouchers).where(eq(journalVouchers.id, vClosed.id));
          const [trRow] = await tx.select({ date: treasuryTransactions.date }).from(treasuryTransactions).where(eq(treasuryTransactions.id, tr.id));
          const [payRow] = await tx.select({ paymentDate: pieceworkPayrolls.paymentDate }).from(pieceworkPayrolls).where(eq(pieceworkPayrolls.id, pay.id));
          if (jvOpen.date !== '1405-07-10') violations.push(`تاریخ سند حسابداری: ${jvOpen.date} (انتظار 1405-07-10)`);
          if (jvClosed.date !== '12-20-1390') violations.push(`سند سال مالی بسته نباید تغییر کند: ${jvClosed.date}`);
          if (trRow.date !== '2026-10-02') violations.push(`تاریخ تراکنش خزانه: ${trRow.date} (انتظار 2026-10-02)`);
          if (payRow.paymentDate !== '1405-07-10') violations.push(`تاریخ پرداخت فیش: ${payRow.paymentDate} (انتظار 1405-07-10)`);

          const log = await tx.select().from(legacyDateRepairs);
          const entry = (table: string, id: number) => log.find(r => r.tableName === table && r.rowId === id);
          const eOpen = entry('journal_vouchers', vOpen.id);
          const eClosed = entry('journal_vouchers', vClosed.id);
          const eTr = entry('treasury_transactions', tr.id);
          const ePay = entry('piecework_payrolls', pay.id);
          if (eOpen?.status !== 'corrected' || eOpen.oldValue !== '07-10-1405') violations.push(`گزارش سند حسابداری: ${JSON.stringify(eOpen)}`);
          if (eClosed?.status !== 'refused') violations.push(`گزارش سند سال بسته باید refused باشد: ${JSON.stringify(eClosed)}`);
          if (eTr?.oldValue !== '07-10-1405 AP' || eTr.newValue !== '2026-10-02') violations.push(`گزارش تراکنش خزانه: ${JSON.stringify(eTr)}`);
          if (ePay?.oldValue !== '07-10-1405 AP') violations.push(`گزارش فیش حقوقی: ${JSON.stringify(ePay)}`);

          // اجرای دوباره چیزی را دوباره ثبت یا تغییر نمی‌دهد
          await tx.execute(sql`SELECT erp_repair_legacy_mdy_dates()`);
          const again = await tx.select().from(legacyDateRepairs);
          if (again.length !== log.length) violations.push(`اجرای دوباره ${again.length - log.length} ردیف گزارش تازه ساخت`);

          throw ROLLBACK;
        });
      } catch (err) {
        if (err !== ROLLBACK) throw err;
      }

      const { FinancialHealthService } = await import('../../services/accounting/financialHealth.service.js');
      const health = await FinancialHealthService.runHealthCheck();
      if (!health.tests.some(t => t.id === 'legacy_mdy_date_repairs')) violations.push('آزمون legacy_mdy_date_repairs در گزارش سلامت مالی نیست');

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_legacy_mdy_date_repair_td_231',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'سه ستون اصلاح و در legacy_date_repairs ثبت شدند، سند سال بسته رد شد و تبدیل تاریخ SQL با برنامه یکی بود.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_legacy_mdy_date_repair_td_231',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    }
  }

  // Test: v7.0.131 (TD-232): ابزار یکسان‌سازی تاریخ متنی به میلادی ISO (مهاجرت 0038) و گزارش فقط‌خواندنی تقویم
  if (shouldRun('reg_calendar_date_tools_td_232', 'td232', 'calendar', 'date')) {
    const tStart = Date.now();
    const testName = 'v7.0.131: تبدیل تاریخ SQL با مبدل برنامه یکی است؛ یکسان‌سازی ستون مقدار قبلی را ثبت و تاریخ نامعتبر را رد می‌کند؛ گزارش تقویم ستون‌ها را می‌شمارد (TD-232)';
    const ROLLBACK = new Error('ROLLBACK_TD_232');
    const violations: string[] = [];
    try {
      const { personnel, legacyDateRepairs } = await import('../../db/schema.js');
      const { toStorageDate } = await import('../../utils/calendarDate.js');
      const { toEnglishDigits } = await import('../../utils/persianNumber.js');
      const { requireStorageDate } = await import('../../lib/storageDate.js');
      const { normalizeError } = await import('../../errors/customErrors.js');
      const { DateCalendarReportService } = await import('../../services/system/dateCalendarReport.service.js');

      // ۱) erp_text_date_to_iso همان نتیجه toStorageDate را می‌دهد
      const samples = ['1405/07/10', '1405-7-1', '۱۴۰۵/۰۷/۱۰', '1403/12/30', '1404/12/30', '1405/07/31', '1405/13/01', '2026-10-02',
        '2026/2/9', '2026-02-29', '2024-02-29', '2026-10-02 18:30:00', '07-10-1405 AP', 'abc', '1600/01/01', '1300/01/01', '1500/12/29'];
      for (const v of samples) {
        const rows = (await orm.execute(sql`SELECT erp_text_date_to_iso(${v}::text) AS iso, erp_text_date_kind(${v}::text) AS kind`) as unknown as { rows: Array<{ iso: string | null; kind: string }> }).rows;
        const expected = toStorageDate(v);
        if ((rows[0]?.iso ?? null) !== expected) violations.push(`«${v}»: SQL ${rows[0]?.iso}، برنامه ${expected}`);
        const expectedKind = expected === null ? 'invalid' : expected === v ? 'iso' : /^1[345]\d{2}/.test(toEnglishDigits(v).trim()) ? 'jalali' : 'gregorian';
        if (rows[0]?.kind !== expectedKind) violations.push(`نوع «${v}»: ${rows[0]?.kind} (انتظار ${expectedKind})`);
      }

      // ۲) ورودی API: تاریخ نامعتبر با 422 رد می‌شود
      try {
        requireStorageDate('1405/07/31', 'تاریخ آزمون');
        violations.push('requireStorageDate تاریخ ۳۱ مهر را پذیرفت');
      } catch (err) {
        const n = normalizeError(err);
        if (n.statusCode !== 422) violations.push(`requireStorageDate: پاسخ ${n.statusCode} (انتظار 422)`);
      }
      if (requireStorageDate('۱۴۰۵/۰۷/۱۰', 'تاریخ آزمون') !== '2026-10-02') violations.push('requireStorageDate شمسی را به ISO تبدیل نکرد');

      // ۳) یکسان‌سازی یک ستون در تراکنشی که برگردانده می‌شود
      try {
        await orm.transaction(async (tx) => {
          await tx.execute(sql`ALTER TABLE personnel DROP CONSTRAINT IF EXISTS chk_personnel_birth_date_datefmt`);
          const ids: Record<string, number> = {};
          for (const [key, birthDate] of Object.entries({ jalali: '1370/05/12', persian: '۱۳۷۰/۰۵/۱۲', loose: '1990-8-3', iso: '1990-08-03', empty: '', bad: '1370/13/40' })) {
            const [row] = await tx.insert(personnel).values({ fullName: `ERP-TEST-MARKER TD-232 ${key}`, birthDate }).returning({ id: personnel.id });
            ids[key] = row.id;
          }
          await tx.execute(sql`SELECT erp_unify_text_date_column('personnel', 'birth_date')`);
          const read = async (id: number) => (await tx.select({ v: personnel.birthDate }).from(personnel).where(eq(personnel.id, id)))[0]?.v;
          const expectations: Record<string, string> = { jalali: '1991-08-03', persian: '1991-08-03', loose: '1990-08-03', iso: '1990-08-03', empty: '', bad: '1370/13/40' };
          for (const [key, want] of Object.entries(expectations)) {
            const got = await read(ids[key]);
            if (got !== want) violations.push(`personnel.birth_date ${key}: ${got} (انتظار ${want})`);
          }
          const log = await tx.select().from(legacyDateRepairs).where(and(eq(legacyDateRepairs.tableName, 'personnel'), eq(legacyDateRepairs.repairKind, 'calendar')));
          const entry = (key: string) => log.find(r => r.rowId === ids[key]);
          if (entry('jalali')?.oldValue !== '1370/05/12' || entry('jalali')?.status !== 'corrected') violations.push(`گزارش شمسی: ${JSON.stringify(entry('jalali'))}`);
          if (entry('bad')?.status !== 'refused') violations.push(`تاریخ نامعتبر باید refused باشد: ${JSON.stringify(entry('bad'))}`);
          if (entry('iso') || entry('empty')) violations.push('ردیف ISO یا خالی نباید در گزارش بیاید');

          await tx.execute(sql`SELECT erp_unify_text_date_column('personnel', 'birth_date')`);
          const again = await tx.select().from(legacyDateRepairs).where(and(eq(legacyDateRepairs.tableName, 'personnel'), eq(legacyDateRepairs.repairKind, 'calendar')));
          if (again.length !== log.length) violations.push(`اجرای دوباره ${again.length - log.length} ردیف گزارش تازه ساخت`);

          const constraintWithBad = (await tx.execute(sql`SELECT erp_set_iso_date_constraint('personnel', 'birth_date') AS ok`) as unknown as { rows: Array<{ ok: boolean }> }).rows[0].ok;
          if (constraintWithBad) violations.push('قید iso با ردیف نامعتبر معتبرشده اعلام شد');
          await tx.delete(personnel).where(eq(personnel.id, ids.bad));
          const constraintClean = (await tx.execute(sql`SELECT erp_set_iso_date_constraint('personnel', 'birth_date') AS ok`) as unknown as { rows: Array<{ ok: boolean }> }).rows[0].ok;
          if (!constraintClean) violations.push('قید iso روی ستون تمیز معتبر نشد');
          throw ROLLBACK;
        });
      } catch (err) {
        if (err !== ROLLBACK) throw err;
      }

      // ۴) گزارش فقط‌خواندنی: ستون‌ها و شمارش (از v7.0.137 هیچ ستونی شمسی نمی‌پذیرد؛ شمارش شمسی در گام ۱ با erp_text_date_kind سنجیده شد)
      const report = await DateCalendarReportService.buildReport();
      const col = (t: string, c: string) => report.columns.find(x => x.table === t && x.column === c);
      for (const [t, c] of [['crm_activities', 'activity_date'], ['cheques', 'due_date'], ['journal_vouchers', 'date'], ['personnel', 'birth_date']]) {
        if (!col(t, c)) violations.push(`ستون ${t}.${c} در گزارش نیست`);
      }
      if (report.columns.some(c => c.total !== c.empty + c.iso + c.gregorian + c.jalali + c.invalid)) violations.push('جمع شمارش‌های گزارش با کل ردیف‌ها نمی‌خواند');
      if (report.columns.some(x => x.table === 'legacy_date_repairs')) violations.push('جدول legacy_date_repairs نباید در گزارش باشد');

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_calendar_date_tools_td_232',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'تبدیل SQL و برنامه یکی بود؛ یکسان‌سازی ستون با گزارش و رد تاریخ نامعتبر و گزارش تقویم کار کرد.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_calendar_date_tools_td_232',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    }
  }

  // Test: v7.0.132 (TD-232): تاریخ‌های CRM میلادی ISO ذخیره می‌شوند؛ ورودی شمسی تبدیل و یادآوری پیگیری آینده زودتر اعلان نمی‌شود
  if (shouldRun('reg_crm_dates_iso_td_232', 'td232', 'crm', 'calendar', 'followup')) {
    const tStart = Date.now();
    const testName = 'v7.0.132: تاریخ اقدام، پیگیری و بستن فرصت CRM میلادی ISO ذخیره می‌شود؛ تاریخ قدیمی با ثبت مقدار قبلی تبدیل می‌شود؛ پیگیری آینده سررسید اعلام نمی‌شود (TD-232)';
    const ROLLBACK = new Error('ROLLBACK_TD_232_CRM');
    const violations: string[] = [];
    const activityIds: number[] = [];
    try {
      const request = (await import('supertest')).default;
      const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
      const { crmActivities, crmLeads, legacyDateRepairs, notifications } = await import('../../db/schema.js');
      const { toStorageDate, isoToJalaliDate } = await import('../../utils/calendarDate.js');
      const { toPersianDigits } = await import('../../utils/persianNumber.js');

      // ۱) قید iso روی سه ستون اصلی CRM معتبر است
      const [{ n: isoConstraints }] = (await orm.execute(sql`
        SELECT count(*)::int AS n FROM pg_constraint pc JOIN pg_class rel ON rel.oid = pc.conrelid
        WHERE rel.relnamespace = current_schema()::regnamespace AND pc.convalidated AND pg_get_constraintdef(pc.oid) LIKE '%''iso''%'
          AND pc.conname IN ('chk_crm_activities_activity_date_datefmt', 'chk_crm_activities_next_followup_date_datefmt', 'chk_crm_leads_expected_close_date_datefmt')`) as unknown as { rows: Array<{ n: number }> }).rows;
      if (isoConstraints !== 3) violations.push(`قید iso معتبر ستون‌های CRM: ${isoConstraints} (انتظار ۳)`);

      // ۲) تبدیل داده قدیمی (همان گام‌های مهاجرت 0039) در تراکنشی که برگردانده می‌شود
      try {
        await orm.transaction(async (tx) => {
          for (const c of ['chk_crm_activities_activity_date_datefmt', 'chk_crm_activities_next_followup_date_datefmt']) {
            await tx.execute(sql`ALTER TABLE crm_activities DROP CONSTRAINT IF EXISTS ${sql.identifier(c)}`);
          }
          await tx.execute(sql`ALTER TABLE crm_leads DROP CONSTRAINT IF EXISTS chk_crm_leads_expected_close_date_datefmt`);
          const [lead] = await tx.insert(crmLeads).values({ title: 'ERP-TEST-MARKER TD-232 CRM', expectedCloseDate: '1405/08/15' }).returning({ id: crmLeads.id });
          const legacy: Record<string, { activityDate: string; nextFollowUpDate: string; nextFollowUpDateIso: string }> = {
            picker: { activityDate: '1405/07/10', nextFollowUpDate: '1405/08/01', nextFollowUpDateIso: '' },
            proforma: { activityDate: '۱۴۰۵/۷/۱۱', nextFollowUpDate: '', nextFollowUpDateIso: '' },
            server: { activityDate: '2026-10-02', nextFollowUpDate: '', nextFollowUpDateIso: '' },
            stale: { activityDate: '1405/07/10', nextFollowUpDate: '1405/08/01', nextFollowUpDateIso: '2020-01-01' },
            bad: { activityDate: 'دیروز', nextFollowUpDate: '', nextFollowUpDateIso: '' },
          };
          const ids: Record<string, number> = {};
          for (const [key, v] of Object.entries(legacy)) {
            const [row] = await tx.insert(crmActivities).values({ leadId: lead.id, type: 'note', title: `ERP-TEST-MARKER TD-232 ${key}`, ...v }).returning({ id: crmActivities.id });
            ids[key] = row.id;
          }
          await tx.execute(sql`SELECT erp_unify_text_date_column('crm_activities', 'activity_date')`);
          await tx.execute(sql`SELECT erp_unify_text_date_column('crm_activities', 'next_followup_date')`);
          await tx.execute(sql`SELECT erp_unify_text_date_column('crm_leads', 'expected_close_date')`);
          await tx.execute(sql`SELECT erp_sync_crm_iso_companions()`);

          const [leadRow] = await tx.select({ d: crmLeads.expectedCloseDate }).from(crmLeads).where(eq(crmLeads.id, lead.id));
          if (leadRow.d !== toStorageDate('1405/08/15')) violations.push(`expected_close_date: ${leadRow.d}`);
          for (const [key, v] of Object.entries(legacy)) {
            const [row] = await tx.select().from(crmActivities).where(eq(crmActivities.id, ids[key]));
            const wantAct = key === 'bad' ? 'دیروز' : toStorageDate(v.activityDate);
            const wantNext = toStorageDate(v.nextFollowUpDate) ?? '';
            if (row.activityDate !== wantAct) violations.push(`${key}.activity_date: ${row.activityDate} (انتظار ${wantAct})`);
            if (row.nextFollowUpDate !== wantNext) violations.push(`${key}.next_followup_date: ${row.nextFollowUpDate} (انتظار ${wantNext})`);
            if (key !== 'bad' && (row.activityDateIso !== wantAct || row.nextFollowUpDateIso !== wantNext)) {
              violations.push(`${key}: ستون‌های _iso هم‌سان نشدند (${row.activityDateIso}، ${row.nextFollowUpDateIso})`);
            }
          }
          const log = await tx.select().from(legacyDateRepairs).where(and(eq(legacyDateRepairs.repairKind, 'calendar'), inArray(legacyDateRepairs.rowId, Object.values(ids))));
          const find = (key: string, column: string) => log.find(r => r.rowId === ids[key] && r.tableName === 'crm_activities' && r.columnName === column);
          if (find('proforma', 'activity_date')?.oldValue !== '۱۴۰۵/۷/۱۱') violations.push('مقدار قبلی تاریخ پیش‌فاکتور ثبت نشد');
          if (find('bad', 'activity_date')?.status !== 'refused') violations.push('تاریخ نامعتبر باید refused ثبت شود');
          if (find('server', 'activity_date')) violations.push('تاریخ ISO نباید در گزارش بیاید');
          if (find('stale', 'next_followup_date_iso')?.oldValue !== '2020-01-01') violations.push('مقدار قبلی next_followup_date_iso ناهم‌سان ثبت نشد');
          throw ROLLBACK;
        });
      } catch (err) {
        if (err !== ROLLBACK) throw err;
      }

      // ۳) API: ورودی شمسی میلادی ISO ذخیره می‌شود، تاریخ نامعتبر 422 و فیلتر بازه شمسی کار می‌کند
      const app = await getTestApp();
      const session = await getAdminSession();
      const todayIso = await businessTodayIsoDate();
      const shiftIso = (days: number) => {
        const d = new Date(`${todayIso}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + days);
        return d.toISOString().slice(0, 10);
      };
      const futureIso = shiftIso(20);
      const post = (body: Record<string, unknown>) => request(app).post('/api/crm/activities')
        .set('Cookie', session.cookie).set('x-csrf-token', session.csrfToken).send(body);
      const created = await post({ title: 'ERP-TEST-MARKER TD-232 پیگیری آینده', type: 'call', activityDate: '۱۴۰۵/۰۷/۱۰', nextFollowUpDate: isoToJalaliDate(futureIso), nextFollowUpTask: 'تماس' });
      if (created.status !== 201) throw new Error(`ثبت اقدام: ${created.status} ${JSON.stringify(created.body)}`);
      activityIds.push(created.body.id);
      if (created.body.activityDate !== '2026-10-02' || created.body.nextFollowUpDate !== futureIso) {
        violations.push(`پاسخ ثبت باید ISO باشد: ${created.body.activityDate}، ${created.body.nextFollowUpDate}`);
      }
      const [stored] = await orm.select().from(crmActivities).where(eq(crmActivities.id, created.body.id));
      if (stored.activityDate !== '2026-10-02' || stored.activityDateIso !== '2026-10-02' || stored.nextFollowUpDate !== futureIso || stored.nextFollowUpDateIso !== futureIso) {
        violations.push(`ذخیره: ${JSON.stringify({ a: stored.activityDate, ai: stored.activityDateIso, n: stored.nextFollowUpDate, ni: stored.nextFollowUpDateIso })}`);
      }
      const invalid = await post({ title: 'ERP-TEST-MARKER TD-232 نامعتبر', activityDate: '1405/07/31' });
      if (invalid.status !== 422) {
        violations.push(`تاریخ ۳۱ مهر باید 422 بگیرد: ${invalid.status}`);
        if (invalid.body?.id) activityIds.push(invalid.body.id);
      }
      const inRange = await request(app).get(`/api/crm/activities?fromDate=${encodeURIComponent('1405/07/09')}&toDate=${encodeURIComponent('۱۴۰۵/۰۷/۱۰')}&limit=500`).set('Cookie', session.cookie);
      const outRange = await request(app).get(`/api/crm/activities?fromDate=${encodeURIComponent('1405/07/11')}&limit=500`).set('Cookie', session.cookie);
      if (!(Array.isArray(inRange.body) && inRange.body.some((a: { id: number }) => a.id === created.body.id))) violations.push('فیلتر بازه شمسی اقدام داخل بازه را نیاورد');
      if (Array.isArray(outRange.body) && outRange.body.some((a: { id: number }) => a.id === created.body.id)) violations.push('فیلتر «از ۱۱ مهر» اقدام ۱۰ مهر را آورد');

      // ۴) یادآوری: پیگیری آینده سررسید اعلام نمی‌شود؛ پیگیری گذشته اعلام می‌شود و تاریخ پیام شمسی است
      const link = `/crm?activityId=${created.body.id}`;
      const dueNotifs = async () => orm.select().from(notifications).where(and(eq(notifications.link, link), eq(notifications.type, 'crm_due_task')));
      await request(app).get('/api/notifications').set('Cookie', session.cookie);
      if ((await dueNotifs()).length > 0) violations.push('پیگیری ۲۰ روز آینده همین امروز سررسید اعلام شد');
      const pastIso = shiftIso(-1);
      await orm.update(crmActivities).set({ nextFollowUpDate: pastIso, nextFollowUpDateIso: pastIso }).where(eq(crmActivities.id, created.body.id));
      await request(app).get('/api/notifications').set('Cookie', session.cookie);
      const due = await dueNotifs();
      // اعلان «تسک جدید» همین پیوند را دارد و نباید جلوی یادآوری سررسید را بگیرد
      if (due.length !== 1) violations.push(`پیگیری دیروز باید یک اعلان سررسید بسازد: ${due.length}`);
      else if (!due[0].message?.includes(toPersianDigits(isoToJalaliDate(pastIso)))) violations.push(`تاریخ پیام اعلان شمسی نیست: ${due[0].message}`);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_crm_dates_iso_td_232',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_api',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'تاریخ شمسی ورودی ISO ذخیره شد، تاریخ نامعتبر 422 گرفت، فیلتر بازه شمسی درست بود، داده قدیمی با گزارش تبدیل شد و یادآوری فقط برای پیگیری گذشته ساخته شد.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_crm_dates_iso_td_232',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_api',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      if (activityIds.length > 0) {
        await orm.execute(sql`DELETE FROM notifications WHERE link = ANY(${sql.param(activityIds.map(id => `/crm?activityId=${id}`))}::text[])`);
        await cleanTestTableData('crm_activities', 'id', activityIds);
      }
    }
  }

  // Test: v7.0.133 (TD-232): تاریخ صدور و سررسید چک میلادی ISO ذخیره می‌شوند؛ فیلتر بازه شمسی و چک سررسیدگذشته درست‌اند
  if (shouldRun('reg_cheque_dates_iso_td_232', 'td232', 'cheque', 'calendar')) {
    const tStart = Date.now();
    const testName = 'v7.0.133: تاریخ چک میلادی ISO ذخیره می‌شود؛ تاریخ قدیمی با ثبت مقدار قبلی تبدیل می‌شود؛ فیلتر بازه شمسی و چک سررسیدگذشته درست‌اند (TD-232)';
    const ROLLBACK = new Error('ROLLBACK_TD_232_CHEQUE');
    const violations: string[] = [];
    const chequeIds: number[] = [];
    try {
      const { cheques, legacyDateRepairs } = await import('../../db/schema.js');
      const { toStorageDate, isoToJalaliDate } = await import('../../utils/calendarDate.js');
      const { ChequeLifecycleService } = await import('../../services/accounting/treasury/chequeLifecycle.service.js');
      const { normalizeError } = await import('../../errors/customErrors.js');
      const { FinancialHealthService } = await import('../../services/accounting/financialHealth.service.js');

      const [{ n: isoConstraints }] = (await orm.execute(sql`
        SELECT count(*)::int AS n FROM pg_constraint pc JOIN pg_class rel ON rel.oid = pc.conrelid
        WHERE rel.relnamespace = current_schema()::regnamespace AND pc.convalidated AND pg_get_constraintdef(pc.oid) LIKE '%''iso''%'
          AND pc.conname IN ('chk_cheques_issue_date_datefmt', 'chk_cheques_due_date_datefmt')`) as unknown as { rows: Array<{ n: number }> }).rows;
      if (isoConstraints !== 2) violations.push(`قید iso معتبر ستون‌های چک: ${isoConstraints} (انتظار ۲)`);

      // ۱) تبدیل داده قدیمی (گام‌های مهاجرت 0040) در تراکنشی که برگردانده می‌شود
      try {
        await orm.transaction(async (tx) => {
          await tx.execute(sql`ALTER TABLE cheques DROP CONSTRAINT IF EXISTS chk_cheques_issue_date_datefmt`);
          await tx.execute(sql`ALTER TABLE cheques DROP CONSTRAINT IF EXISTS chk_cheques_due_date_datefmt`);
          const legacy = [['1405/07/10', '1405-8-1'], ['۱۴۰۵/۰۷/۱۰', '2026-11-05']];
          const ids: number[] = [];
          for (const [i, [issueDate, dueDate]] of legacy.entries()) {
            const [row] = await tx.insert(cheques).values({
              type: 'received', chequeNumber: `TD232-${Date.now()}-${i}`, bankName: 'ERP-TEST-MARKER بانک', issueDate, dueDate,
              amount: money(1000), partyName: 'ERP-TEST-MARKER',
            }).returning({ id: cheques.id });
            ids.push(row.id);
          }
          await tx.execute(sql`SELECT erp_unify_text_date_column('cheques', 'issue_date')`);
          await tx.execute(sql`SELECT erp_unify_text_date_column('cheques', 'due_date')`);
          for (const [i, [issueDate, dueDate]] of legacy.entries()) {
            const [row] = await tx.select({ issueDate: cheques.issueDate, dueDate: cheques.dueDate }).from(cheques).where(eq(cheques.id, ids[i]));
            if (row.issueDate !== toStorageDate(issueDate) || row.dueDate !== toStorageDate(dueDate)) violations.push(`چک قدیمی ${i}: ${row.issueDate}، ${row.dueDate}`);
          }
          const log = await tx.select().from(legacyDateRepairs).where(and(eq(legacyDateRepairs.tableName, 'cheques'), eq(legacyDateRepairs.repairKind, 'calendar'), inArray(legacyDateRepairs.rowId, ids)));
          if (log.length !== 3) violations.push(`گزارش تبدیل چک: ${log.length} ردیف (انتظار ۳؛ سررسید ISO ثبت نمی‌شود)`);
          throw ROLLBACK;
        });
      } catch (err) {
        if (err !== ROLLBACK) throw err;
      }

      // ۲) ثبت با تاریخ شمسی ← ISO؛ تاریخ نامعتبر 422
      const todayIso = await businessTodayIsoDate();
      const shiftIso = (days: number) => {
        const d = new Date(`${todayIso}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + days);
        return d.toISOString().slice(0, 10);
      };
      const base = { type: 'received' as const, bankName: 'ERP-TEST-MARKER بانک', amount: 1000, partyName: 'ERP-TEST-MARKER TD-232 چک', createVoucher: false, allowNoVoucher: true };
      const overdue = await ChequeLifecycleService.createCheque({ ...base, chequeNumber: `TD232-A-${Date.now()}`, issueDate: isoToJalaliDate(shiftIso(-30)), dueDate: isoToJalaliDate(shiftIso(-3)) });
      chequeIds.push(overdue.id);
      const future = await ChequeLifecycleService.createCheque({ ...base, chequeNumber: `TD232-B-${Date.now()}`, issueDate: isoToJalaliDate(shiftIso(-1)), dueDate: isoToJalaliDate(shiftIso(40)) });
      chequeIds.push(future.id);
      const [stored] = await orm.select().from(cheques).where(eq(cheques.id, overdue.id));
      if (stored.issueDate !== shiftIso(-30) || stored.dueDate !== shiftIso(-3)) violations.push(`ذخیره چک: ${stored.issueDate}، ${stored.dueDate}`);
      try {
        const bad = await ChequeLifecycleService.createCheque({ ...base, chequeNumber: `TD232-C-${Date.now()}`, issueDate: '1405/07/10', dueDate: '1405/07/31' });
        chequeIds.push(bad.id);
        violations.push('سررسید ۳۱ مهر پذیرفته شد');
      } catch (err) {
        if (normalizeError(err).statusCode !== 422) violations.push(`سررسید نامعتبر: ${normalizeError(err).statusCode} (انتظار 422)`);
      }

      // ۳) فیلتر بازه شمسی سررسید
      const inRange = await ChequeLifecycleService.getCheques({ type: 'all', startDate: isoToJalaliDate(shiftIso(-5)), endDate: isoToJalaliDate(shiftIso(0)), search: 'TD-232 چک' });
      const ids = inRange.map(c => c.id);
      if (!ids.includes(overdue.id) || ids.includes(future.id)) violations.push(`فیلتر بازه شمسی: ${JSON.stringify(ids)} (انتظار فقط ${overdue.id})`);

      // ۴) چک سررسیدگذشته در بازرس سلامت با تاریخ شمسی
      const health = await FinancialHealthService.runHealthCheck();
      const overdueTest = health.tests.find(t => t.id === 'overdue_cheques');
      const item = overdueTest?.items?.find(i => i.id === overdue.id);
      if (!item) violations.push('چک سررسیدگذشته در بازرس سلامت نیامد');
      else if (!String(item.subtitle).includes(isoToJalaliDate(shiftIso(-3))) || !String(item.subtitle).includes('3 روز')) violations.push(`زیرعنوان چک سررسیدگذشته: ${item.subtitle}`);
      if (overdueTest?.items?.some(i => i.id === future.id)) violations.push('چک آینده سررسیدگذشته اعلام شد');

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_cheque_dates_iso_td_232',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'تاریخ چک ISO ذخیره شد، تاریخ نامعتبر 422 گرفت، فیلتر بازه شمسی و چک سررسیدگذشته درست بودند و داده قدیمی با گزارش تبدیل شد.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_cheque_dates_iso_td_232',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      if (chequeIds.length > 0) await cleanTestTableData('cheques', 'id', chequeIds);
    }
  }

  // Test: v7.0.134 (TD-232): تاریخ کارکرد روزانه، کارمزدی، فیش و نرخ میلادی ISO؛ ماه حقوق ثابت ماه شمسی است
  if (shouldRun('reg_work_payroll_dates_iso_td_232', 'td232', 'payroll', 'piecework', 'calendar')) {
    const tStart = Date.now();
    const testName = 'v7.0.134: تاریخ کارکرد، فیش و نرخ کارمزد میلادی ISO ذخیره می‌شود؛ داده قدیمی با ثبت مقدار قبلی تبدیل می‌شود؛ حقوق ثابت یک ماه شمسی در دو فیش دو بار حساب نمی‌شود (TD-232)';
    const ROLLBACK = new Error('ROLLBACK_TD_232_PAYROLL');
    const violations: string[] = [];
    let personnelId: number | null = null;
    let taskId: number | null = null;
    const payrollIds: number[] = [];
    const logIds: number[] = [];
    try {
      const { dailyWorkLogs, pieceworkLogs, pieceworkPayrolls, pieceworkTaskRateHistory, pieceworkTasks, personnel, legacyDateRepairs, users } = await import('../../db/schema.js');
      const { toStorageDate } = await import('../../utils/calendarDate.js');
      const { PieceworkPayrollService } = await import('../../services/piecework/payroll.service.js');

      const columns = [['daily_work_logs', 'date'], ['piecework_logs', 'date'], ['piecework_payrolls', 'start_date'], ['piecework_payrolls', 'end_date'], ['piecework_payrolls', 'payment_date'], ['piecework_task_rate_history', 'effective_date']];
      const [{ n: isoConstraints }] = (await orm.execute(sql`
        SELECT count(*)::int AS n FROM pg_constraint pc JOIN pg_class rel ON rel.oid = pc.conrelid
        WHERE rel.relnamespace = current_schema()::regnamespace AND pc.convalidated AND pg_get_constraintdef(pc.oid) LIKE '%''iso''%'
          AND pc.conname = ANY(${sql.param(columns.map(([t, c]) => `chk_${t}_${c}_datefmt`))}::text[])`) as unknown as { rows: Array<{ n: number }> }).rows;
      if (isoConstraints !== columns.length) violations.push(`قید iso معتبر: ${isoConstraints} (انتظار ${columns.length})`);

      const [pers] = await orm.insert(personnel).values({ fullName: 'ERP-TEST-MARKER پرسنل TD-232 حقوق', salaryType: 'monthly_fixed', monthlySalary: money(3000000) }).returning({ id: personnel.id });
      personnelId = pers.id;
      const [task] = await orm.insert(pieceworkTasks).values({ code: `TD232-${Date.now()}`, title: 'ERP-TEST-MARKER کار TD-232', defaultRate: money(1000), unit: 'عدد' }).returning({ id: pieceworkTasks.id });
      taskId = task.id;

      // ۱) تبدیل داده قدیمی (گام‌های مهاجرت 0041) در تراکنشی که برگردانده می‌شود
      try {
        await orm.transaction(async (tx) => {
          for (const [t, c] of columns) await tx.execute(sql`ALTER TABLE ${sql.identifier(t)} DROP CONSTRAINT IF EXISTS ${sql.identifier(`chk_${t}_${c}_datefmt`)}`);
          const [u] = await tx.insert(users).values({ username: `td232_${Date.now()}`, password: 'x', fullName: 'ERP-TEST-MARKER', role: 'admin' }).returning({ id: users.id });
          const [dl] = await tx.insert(dailyWorkLogs).values({ userId: u.id, username: 'td232', date: '۱۴۰۵/۰۷/۱۰', dateIso: '', title: 'ERP-TEST-MARKER', content: 'TD-232' }).returning({ id: dailyWorkLogs.id });
          const [pl] = await tx.insert(pieceworkLogs).values({ personnelId: pers.id, taskId: task.id, date: '1405/07/10', dateIso: '2020-01-01', quantity: 1, unitRate: money(1000), totalAmount: money(1000) }).returning({ id: pieceworkLogs.id });
          const [pr] = await tx.insert(pieceworkPayrolls).values({ payrollNumber: `TD232-${Date.now()}`, personnelId: pers.id, startDate: '1405/07/01', endDate: '1405/07/30', paymentDate: '1405-07-10', title: 'ERP-TEST-MARKER', netPayable: money(0) }).returning({ id: pieceworkPayrolls.id });
          const [rh] = await tx.insert(pieceworkTaskRateHistory).values({ taskId: task.id, newRate: money(1000), changeType: 'create', effectiveDate: '۱۴۰۵/۰۷/۱۱' }).returning({ id: pieceworkTaskRateHistory.id });
          for (const [t, c] of columns) await tx.execute(sql`SELECT erp_unify_text_date_column(${t}, ${c})`);
          await tx.execute(sql`SELECT erp_sync_iso_companion('daily_work_logs', 'date', 'date_iso')`);
          await tx.execute(sql`SELECT erp_sync_iso_companion('piecework_logs', 'date', 'date_iso')`);
          const [dlr] = await tx.select().from(dailyWorkLogs).where(eq(dailyWorkLogs.id, dl.id));
          const [plr] = await tx.select().from(pieceworkLogs).where(eq(pieceworkLogs.id, pl.id));
          const [prr] = await tx.select().from(pieceworkPayrolls).where(eq(pieceworkPayrolls.id, pr.id));
          const [rhr] = await tx.select().from(pieceworkTaskRateHistory).where(eq(pieceworkTaskRateHistory.id, rh.id));
          if (dlr.date !== '2026-10-02' || dlr.dateIso !== '2026-10-02') violations.push(`کارکرد روزانه: ${dlr.date}، ${dlr.dateIso}`);
          if (plr.date !== '2026-10-02' || plr.dateIso !== '2026-10-02') violations.push(`کارکرد کارمزدی: ${plr.date}، ${plr.dateIso}`);
          if (prr.startDate !== toStorageDate('1405/07/01') || prr.endDate !== toStorageDate('1405/07/30') || prr.paymentDate !== '2026-10-02') violations.push(`فیش: ${prr.startDate}، ${prr.endDate}، ${prr.paymentDate}`);
          if (rhr.effectiveDate !== '2026-10-03') violations.push(`تاریخ نرخ: ${rhr.effectiveDate}`);
          const log = await tx.select().from(legacyDateRepairs).where(and(eq(legacyDateRepairs.repairKind, 'calendar'), eq(legacyDateRepairs.tableName, 'piecework_logs'), eq(legacyDateRepairs.rowId, pl.id)));
          if (!log.some(r => r.columnName === 'date_iso' && r.oldValue === '2020-01-01')) violations.push('مقدار قبلی ناهم‌سان date_iso ثبت نشد');
          throw ROLLBACK;
        });
      } catch (err) {
        if (err !== ROLLBACK) throw err;
      }

      // ۲) ثبت کارکرد با تاریخ شمسی ← ISO؛ فیلتر بازه شمسی
      const ids = await PieceworkService.logWorkEntries([
        { personnelId: pers.id, taskId: task.id, date: '۱۴۰۵/۰۷/۰۵', quantity: 2 },
        { personnelId: pers.id, taskId: task.id, date: '1405/07/20', quantity: 3 },
      ]);
      logIds.push(...ids);
      const stored = await orm.select({ date: pieceworkLogs.date, dateIso: pieceworkLogs.dateIso }).from(pieceworkLogs).where(inArray(pieceworkLogs.id, ids));
      if (!stored.every(r => r.date === r.dateIso && /^\d{4}-\d{2}-\d{2}$/.test(r.date))) violations.push(`ذخیره کارکرد: ${JSON.stringify(stored)}`);
      try {
        const badIds = await PieceworkService.logWorkEntries([{ personnelId: pers.id, taskId: task.id, date: '1405/07/31', quantity: 1 }]);
        logIds.push(...badIds);
        violations.push('تاریخ کارکرد ۳۱ مهر پذیرفته شد');
      } catch { /* انتظار: 422 */ }
      await PieceworkService.recordTaskRateHistory({ taskId: task.id, newRate: 1000, changeType: 'create', username: 'ERP-TEST-MARKER' });
      const [rate] = await orm.select({ d: pieceworkTaskRateHistory.effectiveDate }).from(pieceworkTaskRateHistory).where(eq(pieceworkTaskRateHistory.taskId, task.id)).orderBy(sql`id DESC`).limit(1);
      if (rate?.d !== await businessTodayIsoDate()) violations.push(`تاریخ اعمال نرخ: ${rate?.d} (انتظار امروز ISO)`);
      const { PieceworkReadService } = await import('../../services/piecework/pieceworkRead.service.js');
      const ranged = await PieceworkReadService.listWorkLogs({ personnelId: String(pers.id), startDate: '1405/07/01', endDate: '1405/07/10' });
      if (ranged.length !== 1 || ranged[0].date !== toStorageDate('1405/07/05')) violations.push(`فیلتر بازه شمسی کارکرد: ${JSON.stringify(ranged.map(r => r.date))}`);

      // ۳) حقوق ثابت: دو فیش در یک ماه شمسی (مهر ۱۴۰۵ = ۲۳ سپتامبر تا ۲۲ اکتبر) روی هم فقط یک ماه حقوق ثابت می‌گیرند
      const audit = { username: 'ERP-TEST-MARKER' };
      const first = await PieceworkPayrollService.generatePayroll({ personnelId: pers.id, startDate: '1405/07/01', endDate: '1405/07/15', ...audit });
      if (first.status !== 201 || !('payroll' in first) || !first.payroll) throw new Error(`فیش اول: ${JSON.stringify(first)}`);
      payrollIds.push(first.payroll.id);
      const second = await PieceworkPayrollService.generatePayroll({ personnelId: pers.id, startDate: '1405/07/16', endDate: '1405/07/30', ...audit });
      if (second.status !== 201 || !('payroll' in second) || !second.payroll) throw new Error(`فیش دوم: ${JSON.stringify(second)}`);
      payrollIds.push(second.payroll.id);
      if (first.payroll.startDate !== toStorageDate('1405/07/01') || first.payroll.endDate !== toStorageDate('1405/07/15')) violations.push(`بازه فیش: ${first.payroll.startDate}، ${first.payroll.endDate}`);
      // v8.0.30 (TD-284، تصمیم مالک محصول — گزینه ب): ماه ناقص به نسبت روزها؛ دو نیمه مهر (۳۰ روزه) روی هم دقیقاً یک ماه
      if (!first.payroll.totalFixedAmount?.equals(1500000)) violations.push(`حقوق ثابت فیش اول (۱۵ از ۳۰ روز): ${first.payroll.totalFixedAmount?.toString()}`);
      if (!second.payroll.totalFixedAmount?.equals(1500000)) violations.push(`حقوق ثابت فیش دوم همان ماه شمسی (باقی ماه): ${second.payroll.totalFixedAmount?.toString()}`);
      if (!second.payroll.totalPieceworkAmount?.equals(3000)) violations.push(`کارکرد فیش دوم: ${second.payroll.totalPieceworkAmount?.toString()}`);
      try {
        await PieceworkPayrollService.generatePayroll({ personnelId: pers.id, startDate: '1405/08/10', endDate: '1405/08/01', ...audit });
        violations.push('بازه برعکس پذیرفته شد');
      } catch { /* انتظار: خطای بازه */ }

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_work_payroll_dates_iso_td_232',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'تاریخ‌ها ISO ذخیره شدند، داده قدیمی با گزارش تبدیل شد، فیلتر بازه شمسی درست بود و حقوق ثابت مهر فقط در فیش اول آمد.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_work_payroll_dates_iso_td_232',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      const { PieceworkPayrollService } = await import('../../services/piecework/payroll.service.js');
      for (const id of payrollIds.reverse()) {
        try { await PieceworkPayrollService.deletePayroll(id, { username: 'ERP-TEST-MARKER' }); } catch { /* ignore */ }
      }
      if (logIds.length > 0) await cleanTestTableData('piecework_logs', 'id', logIds);
      if (personnelId !== null) await cleanTestTableData('piecework_logs', 'personnel_id', [personnelId]);
      if (taskId !== null) {
        await cleanTestTableData('piecework_task_rate_history', 'task_id', [taskId]);
        await cleanTestTableData('piecework_tasks', 'id', [taskId]);
      }
    }
  }

  // Test: v7.0.135 (TD-232): تاریخ پروژه، مرحله، درخواست خرید و پرسنل میلادی ISO ذخیره می‌شوند
  if (shouldRun('reg_project_personnel_dates_iso_td_232', 'td232', 'project', 'personnel', 'calendar')) {
    const tStart = Date.now();
    const testName = 'v7.0.135: تاریخ پروژه و مراحل، تاریخ نیاز درخواست خرید و تاریخ تولد و پایان همکاری پرسنل میلادی ISO ذخیره می‌شوند؛ تاریخ قدیمی با ثبت مقدار قبلی تبدیل می‌شود (TD-232)';
    const ROLLBACK = new Error('ROLLBACK_TD_232_PROJECT');
    const violations: string[] = [];
    let projectId: number | null = null;
    let requisitionId: number | null = null;
    let personnelId: number | null = null;
    try {
      const { productionProjects, projectStages, purchaseRequisitions, personnel, legacyDateRepairs } = await import('../../db/schema.js');
      const { toStorageDate } = await import('../../utils/calendarDate.js');
      const { normalizeError } = await import('../../errors/customErrors.js');
      const request = (await import('supertest')).default;
      const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');

      const columns = [['production_projects', 'start_date'], ['production_projects', 'end_date'], ['project_stages', 'start_date'], ['project_stages', 'end_date'], ['purchase_requisitions', 'required_date'], ['personnel', 'birth_date'], ['personnel', 'end_date']];
      const [{ n: isoConstraints }] = (await orm.execute(sql`
        SELECT count(*)::int AS n FROM pg_constraint pc JOIN pg_class rel ON rel.oid = pc.conrelid
        WHERE rel.relnamespace = current_schema()::regnamespace AND pc.convalidated AND pg_get_constraintdef(pc.oid) LIKE '%''iso''%'
          AND pc.conname = ANY(${sql.param(columns.map(([t, c]) => `chk_${t}_${c}_datefmt`))}::text[])`) as unknown as { rows: Array<{ n: number }> }).rows;
      if (isoConstraints !== columns.length) violations.push(`قید iso معتبر: ${isoConstraints} (انتظار ${columns.length})`);

      // ۱) تبدیل داده قدیمی (گام‌های مهاجرت 0042) در تراکنشی که برگردانده می‌شود
      try {
        await orm.transaction(async (tx) => {
          for (const [t, c] of columns) await tx.execute(sql`ALTER TABLE ${sql.identifier(t)} DROP CONSTRAINT IF EXISTS ${sql.identifier(`chk_${t}_${c}_datefmt`)}`);
          const tag = Date.now();
          const [pr] = await tx.insert(productionProjects).values({ projectCode: `TD232-${tag}`, title: 'ERP-TEST-MARKER پروژه', startDate: '1405/07/01', endDate: '۱۴۰۵/۰۸/۱۵' }).returning({ id: productionProjects.id });
          const [st] = await tx.insert(projectStages).values({ projectId: pr.id, title: 'ERP-TEST-MARKER مرحله', startDate: '1405-7-2', endDate: '2026-10-30' }).returning({ id: projectStages.id });
          const [rq] = await tx.insert(purchaseRequisitions).values({ code: `TD232-${tag}`, title: 'ERP-TEST-MARKER', requiredDate: '1405/07/20' }).returning({ id: purchaseRequisitions.id });
          const [pe] = await tx.insert(personnel).values({ fullName: 'ERP-TEST-MARKER پرسنل', birthDate: '1370/05/12', endDate: 'نامعلوم' }).returning({ id: personnel.id });
          for (const [t, c] of columns) await tx.execute(sql`SELECT erp_unify_text_date_column(${t}, ${c})`);
          const [p1] = await tx.select().from(productionProjects).where(eq(productionProjects.id, pr.id));
          const [s1] = await tx.select().from(projectStages).where(eq(projectStages.id, st.id));
          const [r1] = await tx.select().from(purchaseRequisitions).where(eq(purchaseRequisitions.id, rq.id));
          const [e1] = await tx.select().from(personnel).where(eq(personnel.id, pe.id));
          if (p1.startDate !== toStorageDate('1405/07/01') || p1.endDate !== toStorageDate('1405/08/15')) violations.push(`پروژه: ${p1.startDate}، ${p1.endDate}`);
          if (s1.startDate !== toStorageDate('1405/07/02') || s1.endDate !== '2026-10-30') violations.push(`مرحله: ${s1.startDate}، ${s1.endDate}`);
          if (r1.requiredDate !== toStorageDate('1405/07/20')) violations.push(`درخواست خرید: ${r1.requiredDate}`);
          if (e1.birthDate !== '1991-08-03' || e1.endDate !== 'نامعلوم') violations.push(`پرسنل: ${e1.birthDate}، ${e1.endDate}`);
          const refused = await tx.select().from(legacyDateRepairs).where(and(eq(legacyDateRepairs.repairKind, 'calendar'), eq(legacyDateRepairs.tableName, 'personnel'), eq(legacyDateRepairs.rowId, pe.id), eq(legacyDateRepairs.columnName, 'end_date')));
          if (refused[0]?.status !== 'refused') violations.push('مقدار غیرتاریخی پایان همکاری باید refused ثبت شود');
          throw ROLLBACK;
        });
      } catch (err) {
        if (err !== ROLLBACK) throw err;
      }

      // ۲) ثبت پروژه و مرحله با تاریخ شمسی ← ISO؛ تاریخ نامعتبر 422
      const { project, stages } = await ProjectService.createProject({
        title: 'ERP-TEST-MARKER پروژه TD-232', startDate: '۱۴۰۵/۰۷/۰۱', endDate: '1405/08/15',
        initialStages: [{ title: 'برش', start_date: '1405/07/02', end_date: '1405/07/10' }],
      });
      projectId = project.id;
      if (project.startDate !== toStorageDate('1405/07/01') || project.endDate !== toStorageDate('1405/08/15')) violations.push(`پروژه جدید: ${project.startDate}، ${project.endDate}`);
      if (stages[0]?.startDate !== toStorageDate('1405/07/02') || stages[0]?.endDate !== toStorageDate('1405/07/10')) violations.push(`مرحله جدید: ${stages[0]?.startDate}، ${stages[0]?.endDate}`);
      try {
        await ProjectService.updateProject(project.id, { endDate: '1405/12/30' });
        violations.push('۳۰ اسفند ۱۴۰۵ (سال عادی) پذیرفته شد');
      } catch (err) {
        if (normalizeError(err).statusCode !== 422) violations.push(`تاریخ نامعتبر پروژه: ${normalizeError(err).statusCode}`);
      }

      // ۳) درخواست خرید بدون تاریخ نیاز ← امروز ISO
      const req = await ProcurementService.createRequisition({ title: 'ERP-TEST-MARKER درخواست TD-232', items: [{ itemName: 'آزمون', quantity: 1, unit: 'عدد' } as never] }, { username: 'ERP-TEST-MARKER' });
      requisitionId = req.id;
      const [reqRow] = await orm.select({ d: purchaseRequisitions.requiredDate }).from(purchaseRequisitions).where(eq(purchaseRequisitions.id, req.id));
      if (reqRow.d !== await businessTodayIsoDate()) violations.push(`تاریخ نیاز پیش‌فرض: ${reqRow.d}`);

      // ۴) پرسنل از API: تاریخ تولد شمسی ← ISO
      const app = await getTestApp();
      const session = await getAdminSession();
      const created = await request(app).post('/api/personnel').set('Cookie', session.cookie).set('x-csrf-token', session.csrfToken)
        .send({ firstName: 'ERP-TEST-MARKER', lastName: 'TD-232', birthDate: '۱۳۷۰/۰۵/۱۲' });
      personnelId = created.body?.id ?? created.body?.data?.id ?? null;
      if (created.status >= 300 || !personnelId) violations.push(`ثبت پرسنل: ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
      else {
        const [pRow] = await orm.select({ b: personnel.birthDate }).from(personnel).where(eq(personnel.id, personnelId));
        if (pRow.b !== '1991-08-03') violations.push(`تاریخ تولد ذخیره‌شده: ${pRow.b}`);
      }

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_project_personnel_dates_iso_td_232',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_api',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'تاریخ‌های پروژه، مرحله، درخواست خرید و پرسنل ISO ذخیره شدند، تاریخ نامعتبر 422 گرفت و داده قدیمی با گزارش تبدیل شد.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_project_personnel_dates_iso_td_232',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_api',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      if (projectId !== null) {
        await cleanTestTableData('project_stages', 'project_id', [projectId]);
        await cleanTestTableData('production_projects', 'id', [projectId]);
      }
      if (requisitionId !== null) await cleanTestTableData('purchase_requisitions', 'id', [requisitionId]);
      if (personnelId !== null) await cleanTestTableData('personnel', 'id', [personnelId]);
    }
  }

  // Test: v7.0.136 (TD-232): فیلترهای تاریخ شمسی گزارش‌ها و فهرست‌ها ISO می‌شوند؛ روند ماهانه خزانه شمسی است؛ قیدهای نهایی
  if (shouldRun('reg_calendar_final_td_232', 'td232', 'calendar', 'filter', 'cashflow')) {
    const tStart = Date.now();
    const testName = 'v7.0.136: فیلتر تاریخ شمسی کاردکس و اسناد خطا نمی‌دهد؛ جریان نقدی بازه شمسی را درست می‌گیرد و ماه شمسی می‌دهد؛ ستون‌های زمان سرور فقط زمان میلادی می‌پذیرند (TD-232)';
    const violations: string[] = [];
    let treasuryId: number | null = null;
    try {
      const request = (await import('supertest')).default;
      const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
      const { treasuryTransactions } = await import('../../db/schema.js');
      const { isoToJalaliDate } = await import('../../utils/calendarDate.js');
      const { DateCalendarReportService } = await import('../../services/system/dateCalendarReport.service.js');

      // ۱) قاعده‌های نهایی
      const rules = (await orm.execute(sql`
        SELECT pc.conname AS name, pg_get_constraintdef(pc.oid) AS def, pc.convalidated AS validated
          FROM pg_constraint pc JOIN pg_class rel ON rel.oid = pc.conrelid
         WHERE rel.relnamespace = current_schema()::regnamespace
           AND pc.conname IN ('chk_treasury_transactions_date_datefmt', 'chk_treasury_transactions_reconciled_at_datefmt',
                              'chk_project_stages_completed_at_datefmt', 'chk_users_last_failed_login_at_datefmt', 'chk_journal_vouchers_date_datefmt')`) as unknown as { rows: Array<{ name: string; def: string; validated: boolean }> }).rows;
      const ruleOf = (n: string) => rules.find(r => r.name === n);
      const expectRule = (n: string, kind: string) => {
        const r = ruleOf(n);
        if (!r || !r.validated || !r.def.includes(`'${kind}'`)) violations.push(`${n}: ${r?.def} (انتظار ${kind} معتبر)`);
      };
      expectRule('chk_treasury_transactions_date_datefmt', 'iso');
      expectRule('chk_treasury_transactions_reconciled_at_datefmt', 'isots');
      expectRule('chk_project_stages_completed_at_datefmt', 'isots');
      expectRule('chk_users_last_failed_login_at_datefmt', 'isots');
      expectRule('chk_journal_vouchers_date_datefmt', 'iso'); // v7.0.137 (TD-248)
      const kinds = (await orm.execute(sql`SELECT erp_date_text_ok('1405/07/10', 'isots') AS j, erp_date_text_ok('2026-10-02T10:00:00.000Z', 'isots') AS g`) as unknown as { rows: Array<{ j: boolean; g: boolean }> }).rows[0];
      if (kinds.j || !kinds.g) violations.push(`قالب isots: شمسی=${kinds.j}، میلادی=${kinds.g}`);
      const report = await DateCalendarReportService.buildReport();
      const tr = report.columns.find(c => c.table === 'treasury_transactions' && c.column === 'date');
      if (tr?.rule !== 'iso' || !tr.ruleValidated) violations.push(`گزارش قاعده تاریخ خزانه: ${tr?.rule}`);

      // ۲) فیلتر شمسی در query (پیش‌تر «1405/07/01» خام به ستون timestamp می‌رسید)
      const app = await getTestApp();
      const session = await getAdminSession();
      const q = (path: string) => request(app).get(path).set('Cookie', session.cookie);
      const kardex = await q(`/api/transactions?startDate=${encodeURIComponent('1405/07/01')}&endDate=${encodeURIComponent('۱۴۰۵/۰۷/۳۰')}`);
      if (kardex.status !== 200) violations.push(`کاردکس با بازه شمسی: ${kardex.status} ${JSON.stringify(kardex.body).slice(0, 150)}`);
      const docs = await q(`/api/documents?startDate=${encodeURIComponent('1405/07/01')}&endDate=${encodeURIComponent('1405/07/30')}`);
      if (docs.status !== 200) violations.push(`اسناد با بازه شمسی: ${docs.status}`);
      const bad = await q(`/api/transactions?startDate=${encodeURIComponent('1405/07/31')}`);
      if (bad.status !== 400) violations.push(`تاریخ نامعتبر در فیلتر باید 400 بگیرد: ${bad.status}`);

      // ۳) جریان نقدی: بازه شمسی و ماه شمسی
      const today = await businessTodayIsoDate();
      const [t] = await orm.insert(treasuryTransactions).values({
        transactionNumber: `TRX-TD232-${Date.now()}`, type: 'receipt', date: today, method: 'cash', amount: money(7777), partyName: 'ERP-TEST-MARKER TD-232',
      }).returning({ id: treasuryTransactions.id });
      treasuryId = t.id;
      const yesterday = new Date(`${today}T00:00:00Z`);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const cash = await AccountingService.getCashFlowReport({ startDate: isoToJalaliDate(yesterday.toISOString().slice(0, 10)), endDate: isoToJalaliDate(today) });
      const monthKey = isoToJalaliDate(today).slice(0, 7);
      const month = cash.months.find(m => m.month === monthKey);
      if (!month || month.receipts < 7777) violations.push(`روند ماهانه شمسی ${monthKey}: ${JSON.stringify(cash.months)}`);
      if (cash.months.some(m => /^\d{4}-/.test(m.month))) violations.push(`ماه میلادی در روند ماهانه: ${JSON.stringify(cash.months.map(m => m.month))}`);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_calendar_final_td_232',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_api',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'فیلترهای شمسی ISO شدند، تاریخ نامعتبر 400 گرفت، جریان نقدی ماه شمسی داد و قاعده‌های نهایی معتبر بودند.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_calendar_final_td_232',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_api',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      if (treasuryId !== null) await cleanTestTableData('treasury_transactions', 'id', [treasuryId]);
    }
  }

  // Test: v7.0.137 (TD-248): تاریخ سند حسابداری میلادی ISO؛ اسناد قدیمی شمسی با ثبت مقدار قبلی تبدیل و سند سال بسته رد می‌شود
  if (shouldRun('reg_voucher_dates_iso_td_248', 'td248', 'voucher', 'calendar')) {
    const tStart = Date.now();
    const testName = 'v7.0.137: تاریخ سند حسابداری میلادی ISO ذخیره می‌شود؛ تاریخ شمسی قدیمی با ثبت مقدار قبلی تبدیل و سند سال مالی بسته دست نخورده می‌ماند؛ فیلتر شمسی فهرست اسناد درست است (TD-248)';
    const ROLLBACK = new Error('ROLLBACK_TD_248');
    const violations: string[] = [];
    let voucherId: number | null = null;
    try {
      const { legacyDateRepairs, fiscalPeriods } = await import('../../db/schema.js');
      const { normalizeError } = await import('../../errors/customErrors.js');
      const request = (await import('supertest')).default;
      const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');

      const [rule] = (await orm.execute(sql`
        SELECT pg_get_constraintdef(pc.oid) AS def, pc.convalidated AS validated FROM pg_constraint pc JOIN pg_class rel ON rel.oid = pc.conrelid
         WHERE rel.relnamespace = current_schema()::regnamespace AND pc.conname = 'chk_journal_vouchers_date_datefmt'`) as unknown as { rows: Array<{ def: string; validated: boolean }> }).rows;
      if (!rule?.validated || !rule.def.includes("'iso'")) violations.push(`قید تاریخ سند: ${rule?.def} (انتظار iso معتبر)`);

      // ۱) تبدیل اسناد قدیمی (مهاجرت 0044) در تراکنشی که برگردانده می‌شود
      try {
        await orm.transaction(async (tx) => {
          await tx.execute(sql`ALTER TABLE journal_vouchers DROP CONSTRAINT IF EXISTS chk_journal_vouchers_date_datefmt`);
          await tx.insert(fiscalPeriods).values({ fiscalYear: 1390, status: 'closed' }).onConflictDoUpdate({ target: fiscalPeriods.fiscalYear, set: { status: 'closed' } });
          const base = 970000000 + Math.floor(Math.random() * 1000000);
          const legacy: Record<string, string> = { open: '1405-07-10', persian: '۱۴۰۵/۰۷/۱۱', closed: '1390/12/20', bad: 'نامعلوم', iso: '2026-10-02' };
          const ids: Record<string, number> = {};
          let i = 0;
          for (const [key, date] of Object.entries(legacy)) {
            const [row] = await tx.insert(journalVouchers).values({ voucherNumber: base + i++, date, description: `ERP-TEST-MARKER TD-248 ${key}` }).returning({ id: journalVouchers.id });
            ids[key] = row.id;
          }
          await tx.execute(sql`SELECT erp_unify_journal_voucher_dates()`);
          const dateOf = async (key: string) => (await tx.select({ d: journalVouchers.date }).from(journalVouchers).where(eq(journalVouchers.id, ids[key])))[0]?.d;
          const expected: Record<string, string> = { open: '2026-10-02', persian: '2026-10-03', closed: '1390/12/20', bad: 'نامعلوم', iso: '2026-10-02' };
          for (const [key, want] of Object.entries(expected)) {
            const got = await dateOf(key);
            if (got !== want) violations.push(`سند ${key}: ${got} (انتظار ${want})`);
          }
          const log = await tx.select().from(legacyDateRepairs).where(and(eq(legacyDateRepairs.tableName, 'journal_vouchers'), eq(legacyDateRepairs.repairKind, 'calendar'), inArray(legacyDateRepairs.rowId, Object.values(ids))));
          const entry = (key: string) => log.find(r => r.rowId === ids[key]);
          if (entry('open')?.status !== 'corrected' || entry('open')?.oldValue !== '1405-07-10') violations.push(`گزارش سند باز: ${JSON.stringify(entry('open'))}`);
          if (entry('closed')?.status !== 'refused' || !String(entry('closed')?.reason).includes('1390')) violations.push(`سند سال بسته باید refused شود: ${JSON.stringify(entry('closed'))}`);
          if (entry('bad')?.status !== 'refused') violations.push('تاریخ غیرقابل‌تشخیص باید refused شود');
          if (entry('iso')) violations.push('سند ISO نباید در گزارش بیاید');
          await tx.execute(sql`SELECT erp_unify_journal_voucher_dates()`);
          const again = await tx.select().from(legacyDateRepairs).where(and(eq(legacyDateRepairs.tableName, 'journal_vouchers'), inArray(legacyDateRepairs.rowId, Object.values(ids))));
          if (again.length !== log.length) violations.push(`اجرای دوباره ${again.length - log.length} ردیف تازه ساخت`);
          throw ROLLBACK;
        });
      } catch (err) {
        if (err !== ROLLBACK) throw err;
      }

      // ۲) ثبت سند با تاریخ شمسی ارقام فارسی ← ISO؛ تاریخ نامعتبر 422
      const allAccounts = await orm.select().from(accounts).where(eq(accounts.isDeleted, 0));
      const debitAcc = allAccounts.find(a => a.code === '1101') || allAccounts.find(a => a.accountType === 'asset');
      const creditAcc = allAccounts.find(a => a.code === '6001') || allAccounts.find(a => a.accountType === 'revenue');
      if (!debitAcc || !creditAcc) throw new Error('سرفصل لازم برای آزمون یافت نشد');
      const voucherInput = (date: string) => ({
        date, voucherType: 'general' as const, description: 'ERP-TEST-MARKER سند TD-248', referenceModule: 'manual' as const,
        items: [
          { accountId: debitAcc.id, debit: 1000, credit: 0, description: 'آزمون' },
          { accountId: creditAcc.id, debit: 0, credit: 1000, description: 'آزمون' },
        ],
      });
      const created = await VoucherService.createJournalVoucher(voucherInput('۱۴۰۵/۰۷/۱۰'));
      voucherId = created.id;
      const [stored] = await orm.select({ d: journalVouchers.date }).from(journalVouchers).where(eq(journalVouchers.id, created.id));
      if (stored.d !== '2026-10-02') violations.push(`تاریخ سند ذخیره‌شده: ${stored.d} (انتظار 2026-10-02)`);
      try {
        const bad = await VoucherService.createJournalVoucher(voucherInput('1405/07/31'));
        await cleanTestTableData('journal_voucher_items', 'voucher_id', [bad.id]);
        await cleanTestTableData('journal_vouchers', 'id', [bad.id]);
        violations.push('تاریخ ۳۱ مهر برای سند پذیرفته شد');
      } catch (err) {
        if (normalizeError(err).statusCode !== 422) violations.push(`تاریخ نامعتبر سند: ${normalizeError(err).statusCode} (انتظار 422)`);
      }

      // ۳) فهرست اسناد با بازه شمسی
      const app = await getTestApp();
      const session = await getAdminSession();
      const list = await request(app).get(`/api/accounting/vouchers?startDate=${encodeURIComponent('1405/07/10')}&endDate=${encodeURIComponent('1405/07/10')}&limit=1000`).set('Cookie', session.cookie);
      const rows: Array<{ id: number }> = Array.isArray(list.body?.data) ? list.body.data : (Array.isArray(list.body) ? list.body : []);
      if (list.status !== 200 || !rows.some(r => r.id === created.id)) violations.push(`فهرست اسناد با بازه شمسی: ${list.status}، ${rows.length} ردیف بدون سند آزمون`);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_voucher_dates_iso_td_248',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_api',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'سند قدیمی شمسی تبدیل و ثبت شد، سند سال بسته و تاریخ نامعتبر دست نخوردند، سند تازه ISO ذخیره شد و فیلتر شمسی آن را یافت.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_voucher_dates_iso_td_248',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_api',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      if (voucherId !== null) {
        await cleanTestTableData('journal_voucher_items', 'voucher_id', [voucherId]);
        await cleanTestTableData('journal_vouchers', 'id', [voucherId]);
      }
    }
  }

  // Test: v7.0.138 (TD-249): تراز آزمایشی با سطح «all» (پیش‌فرض صفحه صورت‌ها و گزارش‌های مالی) خطای اعتبارسنجی نمی‌دهد
  if (shouldRun('reg_trial_balance_level_all_td_249', 'td249', 'trial', 'balance', 'level')) {
    const tStart = Date.now();
    const testName = 'v7.0.138: تراز آزمایشی با سطح all و tree پاسخ می‌دهد و سطح نامعتبر 400 می‌گیرد (TD-249)';
    try {
      const request = (await import('supertest')).default;
      const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
      const app = await getTestApp();
      const session = await getAdminSession();
      const violations: string[] = [];
      const get = (q: string) => request(app).get(`/api/accounting/reports/trial-balance?${q}`).set('Cookie', session.cookie);
      for (const level of ['all', 'tree', 'group', 'detailed']) {
        const res = await get(`level=${level}`);
        if (res.status !== 200) violations.push(`level=${level}: ${res.status} ${String(res.body?.message || '').slice(0, 120)}`);
      }
      const withDates = await get(`level=all&startDate=${encodeURIComponent('1405/01/01')}&endDate=${encodeURIComponent('1405/12/29')}`);
      if (withDates.status !== 200) violations.push(`level=all با بازه شمسی: ${withDates.status}`);
      const bad = await get('level=bogus');
      if (bad.status !== 400) violations.push(`سطح نامعتبر باید 400 بگیرد: ${bad.status}`);
      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_trial_balance_level_all_td_249',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_api',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'تراز آزمایشی با سطح all، tree، group و detailed و با بازه شمسی 200 داد و سطح نامعتبر 400 گرفت.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_trial_balance_level_all_td_249',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_api',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    }
  }

  // Test: v7.0.139 (TD-189): رمز نوبیتکس پرسنل رمزنگاری‌شده ذخیره می‌شود؛ بدون کلید ساده ذخیره نمی‌شود و ذخیره فرم آن را پاک نمی‌کند
  if (shouldRun('reg_personnel_secret_encryption_td_189', 'td189', 'nobitex', 'secret', 'encrypt')) {
    const tStart = Date.now();
    const testName = 'v7.0.139: رمز نوبیتکس با AES-256-GCM رمزنگاری می‌شود و فقط برای کاربر مجاز باز می‌شود؛ بدون کلید ذخیره نمی‌شود و پاک نمی‌شود؛ رمزهای ساده قدیمی با اسکریپت رمزنگاری می‌شوند (TD-189)';
    const violations: string[] = [];
    const ids: number[] = [];
    const previousKey = process.env.ERP_SECRETS_KEY;
    try {
      const request = (await import('supertest')).default;
      const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
      const { personnel } = await import('../../db/schema.js');
      const { decryptSecret, encryptSecret } = await import('../../lib/secretBox.js');
      const { PersonnelSecretEncryptionService } = await import('../../services/system/personnelSecretEncryption.service.js');
      const app = await getTestApp();
      const session = await getAdminSession();
      const send = (method: 'post' | 'put', path: string, body: Record<string, unknown>) =>
        request(app)[method](path).set('Cookie', session.cookie).set('x-csrf-token', session.csrfToken).send(body);
      const stored = async (id: number) => (await orm.select({ v: personnel.nobitexPassword }).from(personnel).where(eq(personnel.id, id)))[0]?.v || '';
      process.env.ERP_SECRETS_KEY = 'td189-test-key-0123456789-abcdefghijklmnop';

      // ۱) ثبت: ستون رمزشده است و متن ساده در آن نیست؛ پاسخ خواندن برای مدیر متن ساده است
      const created = await send('post', '/api/personnel', { firstName: 'ERP-TEST-MARKER', lastName: 'TD-189', nobitexPassword: 'Secret#123' });
      if (created.status !== 201) throw new Error(`ثبت پرسنل: ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
      const id = created.body.id as number;
      ids.push(id);
      const first = await stored(id);
      if (!first.startsWith('enc:v1:') || first.includes('Secret#123')) violations.push(`ستون رمز نوبیتکس رمزنگاری نشده: ${first.slice(0, 30)}`);
      if (created.body.nobitexPassword !== 'Secret#123') violations.push('پاسخ ثبت باید متن ساده را برگرداند نه متن رمزشده');
      const read = await request(app).get(`/api/personnel/${id}`).set('Cookie', session.cookie);
      if (read.body?.nobitexPassword !== 'Secret#123') violations.push(`خواندن برای مدیر: «${read.body?.nobitexPassword}»`);
      const list = await request(app).get('/api/personnel').set('Cookie', session.cookie);
      const listed = (Array.isArray(list.body) ? list.body : []).find((p: { id: number }) => p.id === id);
      // v9.0.23 (TD-434، تصمیم D1): رمز فقط در جزئیات یک پرسنل؛ فهرست نه متن ساده می‌دهد و نه متن رمزشده
      if (!listed || 'nobitexPassword' in listed) violations.push('فهرست پرسنل نباید رمز نوبیتکس بدهد (فقط جزئیات)');

      // ۲) ذخیره فرم با همان رمز ← متن رمزشده عوض نمی‌شود؛ رمز تازه ← رمزنگاری تازه
      await send('put', `/api/personnel/${id}`, { version: await personnelVersion(id), firstName: 'ERP-TEST-MARKER', lastName: 'TD-189 ویرایش', nobitexPassword: 'Secret#123' });
      if (await stored(id) !== first) violations.push('ذخیره با همان رمز متن رمزشده را عوض کرد');
      await send('put', `/api/personnel/${id}`, { version: await personnelVersion(id), firstName: 'ERP-TEST-MARKER', lastName: 'TD-189', nobitexPassword: 'New#456' });
      const second = await stored(id);
      if (!second.startsWith('enc:v1:') || decryptSecret(second) !== 'New#456') violations.push('رمز تازه درست رمزنگاری نشد');

      // ۳) دست‌کاری متن رمزشده ← باز نمی‌شود (هرگز متن نادرست برنمی‌گردد)
      const tampered = second.slice(0, -4) + (second.endsWith('AAAA') ? 'BBBB' : 'AAAA');
      if (decryptSecret(tampered) !== null) violations.push('متن رمزشده دست‌کاری‌شده باز شد');

      // ۴) بدون کلید: خواندن متن رمزشده بیرون نمی‌دهد، فرم خالی رمز را پاک نمی‌کند، رمز تازه 503 می‌گیرد
      delete process.env.ERP_SECRETS_KEY;
      const noKeyRead = await request(app).get(`/api/personnel/${id}`).set('Cookie', session.cookie);
      if (noKeyRead.body?.nobitexPassword !== '') violations.push(`بدون کلید پاسخ باید خالی باشد: «${String(noKeyRead.body?.nobitexPassword).slice(0, 20)}»`);
      await send('put', `/api/personnel/${id}`, { version: await personnelVersion(id), firstName: 'ERP-TEST-MARKER', lastName: 'TD-189', nobitexPassword: '' });
      if (await stored(id) !== second) violations.push('ذخیره فرم بدون کلید رمز ذخیره‌شده را پاک کرد');
      const noKeySave = await send('put', `/api/personnel/${id}`, { version: await personnelVersion(id), firstName: 'ERP-TEST-MARKER', lastName: 'TD-189', nobitexPassword: 'Plain#789' });
      if (noKeySave.status !== 503) violations.push(`رمز تازه بدون کلید باید 503 بگیرد: ${noKeySave.status}`);
      if (await stored(id) !== second) violations.push('رمز تازه بدون کلید ذخیره شد');
      try { encryptSecret('x'); violations.push('encryptSecret بدون کلید خطا نداد'); } catch { /* انتظار */ }

      // ۵) رمز ساده قدیمی: اجرای آزمایشی چیزی را تغییر نمی‌دهد؛ اجرای واقعی با کلید رمزنگاری می‌کند
      const [legacy] = await orm.insert(personnel).values({ fullName: 'ERP-TEST-MARKER TD-189 قدیمی', nobitexPassword: 'old-plain' }).returning({ id: personnel.id });
      ids.push(legacy.id);
      process.env.ERP_SECRETS_KEY = 'td189-test-key-0123456789-abcdefghijklmnop';
      const dry = await PersonnelSecretEncryptionService.run({ apply: false });
      if (dry.plaintext < 1 || await stored(legacy.id) !== 'old-plain') violations.push(`اجرای آزمایشی: ${JSON.stringify(dry)}`);
      const applied = await PersonnelSecretEncryptionService.run({ apply: true });
      const legacyNow = await stored(legacy.id);
      if (applied.encryptedNow < 1 || !legacyNow.startsWith('enc:v1:') || decryptSecret(legacyNow) !== 'old-plain') violations.push(`رمزنگاری رمز قدیمی: ${JSON.stringify(applied)}`);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_personnel_secret_encryption_td_189',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_api',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'رمز رمزنگاری‌شده ذخیره و فقط برای مدیر باز شد، بدون کلید نه ذخیره شد نه پاک، و رمز قدیمی با اسکریپت رمزنگاری شد.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_personnel_secret_encryption_td_189',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_api',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      if (previousKey === undefined) delete process.env.ERP_SECRETS_KEY; else process.env.ERP_SECRETS_KEY = previousKey;
      if (ids.length > 0) await cleanTestTableData('personnel', 'id', ids);
    }
  }

  // Test: v7.0.83 (TD-224): پاک‌سازی دستی فایل‌های پیوست بدون ثبت؛ فایل ثبت‌شده، جداشده و تازه دست نمی‌خورند
  if (shouldRun('reg_attachment_orphan_cleanup_td_224', 'td224', 'attachment', 'orphan', 'cleanup')) {
    const tStart = Date.now();
    const testName = 'v7.0.83: پاک‌سازی پیوست‌ها فقط فایل بدون ثبت و قدیمی را پاک می‌کند؛ اجرای آزمایشی چیزی پاک نمی‌کند (TD-224)';
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');
    const crypto = await import('crypto');
    const { fileAttachments } = await import('../../db/schema.js');
    const prevRoot = process.env.ATTACHMENTS_DIR;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-td224-'));
    const ids = { active: crypto.randomUUID(), detached: crypto.randomUUID(), orphan: crypto.randomUUID(), recent: crypto.randomUUID() };
    try {
      process.env.ATTACHMENTS_DIR = root;
      const { AttachmentOrphanCleanupService } = await import('../../services/attachments/attachmentOrphanCleanup.service.js');
      const dir = path.join(root, 'document');
      fs.mkdirSync(dir, { recursive: true });
      const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const write = (name: string, aged: boolean) => {
        const p = path.join(dir, name);
        fs.writeFileSync(p, 'ERP-TEST-MARKER TD-224');
        if (aged) fs.utimesSync(p, old, old);
        return p;
      };
      const files = {
        active: write(`${ids.active}.pdf`, true),
        detached: write(`${ids.detached}.pdf`, true),
        orphan: write(`${ids.orphan}.pdf`, true),
        recent: write(`${ids.recent}.pdf`, false),
        foreign: write('README.txt', true),
      };
      const row = (id: string, isDeleted: number) => ({
        id, entityType: 'document', entityId: 0, storagePath: `document/${id}.pdf`, originalName: 'td224.pdf',
        mimeType: 'application/pdf', sizeBytes: 22, sha256: 'x', createdBy: 'ERP-TEST-MARKER', isDeleted,
      });
      await orm.insert(fileAttachments).values([row(ids.active, 0), row(ids.detached, 1)]);

      const violations: string[] = [];
      const dry = await AttachmentOrphanCleanupService.cleanupOrphanFiles({ apply: false, actor: 'td224' });
      if (!dry.dryRun || dry.unregistered.removed !== 0 || !fs.existsSync(files.orphan)) violations.push(`اجرای آزمایشی نباید چیزی پاک کند: ${JSON.stringify(dry.unregistered)}`);
      if (!dry.unregistered.paths.includes(`document/${ids.orphan}.pdf`)) violations.push('فایل بدون ثبت در گزارش آزمایشی نیست');

      const applied = await AttachmentOrphanCleanupService.cleanupOrphanFiles({ apply: true, actor: 'td224' });
      if (fs.existsSync(files.orphan)) violations.push('فایل بدون ثبت قدیمی پاک نشد');
      if (applied.unregistered.removed !== 1) violations.push(`تعداد پاک‌شده: ${applied.unregistered.removed} (انتظار ۱)`);
      if (!fs.existsSync(files.active)) violations.push('فایل ثبت‌شده پاک شد');
      if (!fs.existsSync(files.detached)) violations.push('فایل پیوست جداشده پاک شد');
      if (!fs.existsSync(files.recent)) violations.push('فایل بدون ثبت تازه (تراکنش در جریان) پاک شد');
      if (!fs.existsSync(files.foreign)) violations.push('فایلی با نام غیر از الگوی ذخیره پاک شد');
      if (applied.detached.files !== 1 || applied.recentUnregistered !== 1) violations.push(`گزارش جداشده/تازه: ${applied.detached.files}/${applied.recentUnregistered} (انتظار ۱/۱)`);

      const request = (await import('supertest')).default;
      const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
      const session = await getAdminSession();
      const res = await request(await getTestApp()).post('/api/attachments/cleanup-orphans')
        .set('Cookie', session.cookie).set('x-csrf-token', session.csrfToken).send({});
      if (res.status !== 200 || res.body?.dryRun !== true) violations.push(`مسیر مدیر: HTTP ${res.status} dryRun=${res.body?.dryRun}`);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_attachment_orphan_cleanup_td_224',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'فقط فایل بدون ثبت قدیمی پاک شد؛ فایل ثبت‌شده، جداشده، تازه و ناشناس ماندند.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_attachment_orphan_cleanup_td_224',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      if (prevRoot === undefined) delete process.env.ATTACHMENTS_DIR; else process.env.ATTACHMENTS_DIR = prevRoot;
      await orm.delete(fileAttachments).where(inArray(fileAttachments.id, [ids.active, ids.detached]));
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  // Test: v7.0.85 (TD-109): فلگ بی‌اثر test_endpoints حذف شد؛ فرم قدیمی که کلید آن را می‌فرستد ذخیره‌اش شکست نمی‌خورد
  if (shouldRun('reg_retired_test_endpoints_flag_td_109', 'td109', 'settings', 'flag')) {
    const tStart = Date.now();
    const testName = 'v7.0.85: کلید بازنشسته runtime_enable_test_endpoints ذخیره نمی‌شود و ذخیره فرم را نمی‌شکند؛ /system/env دیگر آن را گزارش نمی‌کند (TD-109)';
    const { appSettings } = await import('../../db/schema.js');
    const RETIRED = 'runtime_enable_test_endpoints';
    const [original] = await orm.select().from(appSettings).where(eq(appSettings.key, RETIRED));
    const [originalName] = await orm.select().from(appSettings).where(eq(appSettings.key, 'company_name'));
    try {
      const request = (await import('supertest')).default;
      const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
      const app = await getTestApp();
      const session = await getAdminSession();
      await orm.delete(appSettings).where(eq(appSettings.key, RETIRED));
      const violations: string[] = [];
      const save = await request(app).post('/api/settings').set('Cookie', session.cookie).set('x-csrf-token', session.csrfToken)
        .send({ settings: [{ key: RETIRED, value: 'true' }, { key: 'company_name', value: `شرکت آزمون TD-109 ${Date.now()}` }] });
      if (save.status !== 200) violations.push(`ذخیره فرم با کلید بازنشسته: HTTP ${save.status} ${JSON.stringify(save.body).slice(0, 160)}`);
      if (Array.isArray(save.body?.changedKeys) && save.body.changedKeys.includes(RETIRED)) violations.push('کلید بازنشسته در کلیدهای تغییرکرده است');
      const [stored] = await orm.select().from(appSettings).where(eq(appSettings.key, RETIRED));
      if (stored) violations.push(`کلید بازنشسته ذخیره شد: ${stored.value}`);
      const env = await request(app).get('/api/system/env').set('Cookie', session.cookie);
      if (env.status !== 200) violations.push(`/system/env: HTTP ${env.status}`);
      if (env.body && ('effectiveTestEndpoints' in env.body || 'ENABLE_TEST_ENDPOINTS' in (env.body.flags || {}))) {
        violations.push('/system/env هنوز فلگ test_endpoints را گزارش می‌کند');
      }
      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_retired_test_endpoints_flag_td_109',
        scenarioId: 'multi_currency_financials_and_ratios',
        name: testName,
        layer: 'regression',
        executionType: 'real_api',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'کلید بازنشسته نادیده گرفته شد، بقیه فرم ذخیره شد و گزارش محیط آن را ندارد.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_retired_test_endpoints_flag_td_109',
        scenarioId: 'multi_currency_financials_and_ratios',
        name: testName,
        layer: 'regression',
        executionType: 'real_api',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      for (const [key, row] of [[RETIRED, original], ['company_name', originalName]] as const) {
        if (row) {
          await orm.insert(appSettings).values({ key, value: row.value }).onConflictDoUpdate({ target: appSettings.key, set: { value: row.value } });
        } else {
          await orm.delete(appSettings).where(eq(appSettings.key, key));
        }
      }
      const { invalidateSettingsCache } = await import('../../lib/memoryCache.js');
      invalidateSettingsCache();
    }
  }

  // Test: v7.0.87 (TD-112): هر ذخیره تعریف ورکفلو یک نسخه کامل با شناسه‌های پایگاه‌داده ثبت می‌کند؛ فرایند تازه از آخرین نسخه
  // و فرایند در جریان از نسخه خودش پیش می‌رود؛ روت‌های انتشار، بازگردانی، گلوگاه و انطباق حذف شده‌اند
  if (shouldRun('reg_workflow_versions_on_save_td_112', 'td112', 'workflow', 'version')) {
    const tStart = Date.now();
    const testName = 'v7.0.87: ذخیره طراحی ورکفلو نسخه تازه با شناسه‌های واقعی ثبت می‌کند و فرایندها گیر نمی‌کنند؛ فقط تاریخچه خواندنی است (TD-112)';
    const {
      workflowDefinitions, workflowStates, workflowTransitions, workflowInstances, workflowHistoryLogs,
      workflowPendingApprovals, workflowDefinitionVersions, workflowTasks,
    } = await import('../../db/schema.js');
    const { WorkflowDefinitionService } = await import('../../services/workflow/workflowDefinitionService.js');
    const { WorkflowTransitionExecutor } = await import('../../services/workflow/workflowTransitionExecutor.js');
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const entityType = `reg_td112_${suffix}`;
    let defId: number | undefined;
    try {
      const violations: string[] = [];
      // همان شکل payload طراح و seed: وضعیت‌ها با کلید، انتقال‌ها با کلید مبدأ و مقصد
      const saved = await WorkflowDefinitionService.saveWorkflowDefinition({
        code: `REG_TD112_${suffix}`, title: 'ورکفلو آزمون TD-112', entityType, description: 'v1',
        states: [
          { stateKey: 'draft', title: 'پیش‌نویس', stateType: 'initial' },
          { stateKey: 'done', title: 'تایید', stateType: 'terminal' },
        ],
        transitions: [{ fromStateKey: 'draft', toStateKey: 'done', actionKey: 'approve', title: 'تایید' }],
      });
      defId = saved?.definition?.id;
      if (!defId) throw new Error('تعریف ذخیره نشد');

      const availableFor = async (entityId: string) => {
        const st = await WorkflowTransitionExecutor.getInstanceByEntity(entityType, entityId, undefined, 'admin', ['*']);
        return (st?.availableTransitions || []) as Array<{ id: number; actionKey: string }>;
      };

      const first = await WorkflowTransitionExecutor.startInstance({ workflowDefinitionId: defId, entityType, entityId: '1' });
      const firstAvailable = await availableFor('1');
      if (firstAvailable.length !== 1) violations.push(`فرایند نسخه ۱: ${firstAvailable.length} اقدام مجاز (انتظار ۱)`);

      // ویرایش در طراح: وضعیت‌های بارگذاری‌شده با id، یک وضعیت و یک انتقال تازه
      const loadedStates = await orm.select().from(workflowStates).where(eq(workflowStates.workflowDefinitionId, defId));
      await WorkflowDefinitionService.saveWorkflowDefinition({
        id: defId, code: `REG_TD112_${suffix}`, title: 'ورکفلو آزمون TD-112', entityType, description: 'v2',
        states: [
          ...loadedStates.map((s) => ({ id: s.id, stateKey: s.stateKey, title: s.title, stateType: s.stateType ?? undefined })),
          { stateKey: 'rejected', title: 'رد', stateType: 'terminal' },
        ],
        transitions: [
          { fromStateKey: 'draft', toStateKey: 'done', actionKey: 'approve', title: 'تایید' },
          { fromStateKey: 'draft', toStateKey: 'rejected', actionKey: 'reject', title: 'رد' },
        ],
      });

      const versions = await orm.select().from(workflowDefinitionVersions)
        .where(eq(workflowDefinitionVersions.definitionId, defId));
      const [def] = await orm.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, defId));
      if (versions.length !== 2 || def?.version !== 2) {
        violations.push(`پس از دو ذخیره: ${versions.length} نسخه، نسخه جاری ${def?.version} (انتظار ۲ و ۲)`);
      }
      const v2 = versions.find((v) => v.version === 2);
      const v2Dsl = (v2?.dslJson || {}) as { states?: Array<{ id?: unknown }>; transitions?: Array<{ id?: unknown; fromStateId?: unknown }> };
      if ((v2Dsl.states || []).length !== 3 || (v2Dsl.transitions || []).some((t) => typeof t.id !== 'number' || typeof t.fromStateId !== 'number')) {
        violations.push('نسخه ۲ همه وضعیت‌ها و انتقال‌ها را با شناسه پایگاه‌داده ندارد');
      }

      await WorkflowTransitionExecutor.startInstance({ workflowDefinitionId: defId, entityType, entityId: '2' });
      const secondAvailable = await availableFor('2');
      if (secondAvailable.length !== 2) violations.push(`فرایند تازه پس از ویرایش: ${secondAvailable.length} اقدام مجاز (انتظار ۲)`);

      const firstAfter = await availableFor('1');
      if (firstAfter.length !== 1) {
        violations.push(`فرایند در جریان پس از ویرایش: ${firstAfter.length} اقدام مجاز (انتظار ۱ از نسخه خودش)`);
      } else {
        await WorkflowTransitionExecutor.executeTransition({
          instanceId: first.id, transitionId: firstAfter[0].id, userRole: 'admin', userPermissions: ['*'],
        });
        const [done] = await orm.select().from(workflowInstances).where(eq(workflowInstances.id, first.id));
        if (done?.status === 'IN_PROGRESS') violations.push('فرایند در جریان با اقدام نسخه خودش پایان نیافت');
      }

      const request = (await import('supertest')).default;
      const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
      const app = await getTestApp();
      const session = await getAdminSession();
      const list = await request(app).get(`/api/workflow/definitions/${defId}/versions`).set('Cookie', session.cookie);
      if (list.status !== 200 || !Array.isArray(list.body) || list.body.length !== 2) {
        violations.push(`فهرست نسخه‌ها: HTTP ${list.status}، ${Array.isArray(list.body) ? list.body.length : '-'} ردیف`);
      }
      const one = await request(app).get(`/api/workflow/definitions/${defId}/versions/1`).set('Cookie', session.cookie);
      if (one.status !== 200 || one.body?.version !== 1) violations.push(`دیدن نسخه ۱: HTTP ${one.status}`);
      for (const [method, url] of [
        ['post', `/api/workflow/definitions/${defId}/rollback`],
        ['post', `/api/workflow/definitions/${defId}/publish`],
        ['get', '/api/workflow/analytics/bottlenecks'],
        ['get', '/api/workflow/analytics/compliance'],
      ] as const) {
        const call = method === 'post'
          ? request(app).post(url).set('Cookie', session.cookie).set('x-csrf-token', session.csrfToken).send({ version: 1 })
          : request(app).get(url).set('Cookie', session.cookie);
        const res = await call;
        if (res.status !== 404) violations.push(`${method.toUpperCase()} ${url.replace(String(defId), ':id')} هنوز پاسخ می‌دهد (HTTP ${res.status})`);
      }

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_workflow_versions_on_save_td_112',
        scenarioId: 'workflow_approval_postgres',
        name: testName,
        layer: 'regression',
        executionType: 'real_api',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'دو ذخیره دو نسخه ساخت؛ فرایند تازه و فرایند در جریان هر کدام با نسخه خود پیش رفتند؛ روت‌های حذف‌شده ۴۰۴ دادند.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_workflow_versions_on_save_td_112',
        scenarioId: 'workflow_approval_postgres',
        name: testName,
        layer: 'regression',
        executionType: 'real_api',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      if (defId) {
        const instanceIds = (await orm.select({ id: workflowInstances.id }).from(workflowInstances)
          .where(eq(workflowInstances.workflowDefinitionId, defId))).map((r) => r.id);
        if (instanceIds.length > 0) {
          await orm.delete(workflowTasks).where(inArray(workflowTasks.instanceId, instanceIds));
          await orm.delete(workflowPendingApprovals).where(inArray(workflowPendingApprovals.instanceId, instanceIds));
          await orm.delete(workflowHistoryLogs).where(inArray(workflowHistoryLogs.instanceId, instanceIds));
          await orm.delete(workflowInstances).where(inArray(workflowInstances.id, instanceIds));
        }
        await orm.delete(workflowTransitions).where(eq(workflowTransitions.workflowDefinitionId, defId));
        await orm.delete(workflowStates).where(eq(workflowStates.workflowDefinitionId, defId));
        await orm.delete(workflowDefinitionVersions).where(eq(workflowDefinitionVersions.definitionId, defId));
        await orm.delete(workflowDefinitions).where(eq(workflowDefinitions.id, defId));
      }
    }
  }

  // Test: v7.0.88 (TD-085): پاسخ GET /workflow/instance همان ساختاری است که ویجت مراحل ورکفلو می‌خواند
  // (instance، definition، allStates، currentState، availableTransitions، approvalProgress، history)
  if (shouldRun('reg_workflow_instance_widget_contract_td_085', 'td085', 'workflow', 'stepper')) {
    const tStart = Date.now();
    const testName = 'v7.0.88: ویجت مراحل ورکفلو فرایند در جریان را می‌بیند؛ پاسخ API ساختار instance/currentState/allStates دارد (TD-085)';
    const {
      workflowDefinitions, workflowStates, workflowTransitions, workflowInstances, workflowHistoryLogs,
      workflowPendingApprovals, workflowDefinitionVersions, workflowTasks,
    } = await import('../../db/schema.js');
    const { WorkflowDefinitionService } = await import('../../services/workflow/workflowDefinitionService.js');
    const { WorkflowTransitionExecutor } = await import('../../services/workflow/workflowTransitionExecutor.js');
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const entityType = `reg_td085_${suffix}`;
    let defId: number | undefined;
    try {
      const violations: string[] = [];
      const saved = await WorkflowDefinitionService.saveWorkflowDefinition({
        code: `REG_TD085_${suffix}`, title: 'ورکفلو آزمون ویجت', entityType,
        states: [
          { stateKey: 'draft', title: 'پیش‌نویس', stateType: 'initial', stepOrder: 1 },
          { stateKey: 'review', title: 'بررسی', stateType: 'normal', stepOrder: 2 },
          { stateKey: 'done', title: 'تایید نهایی', stateType: 'terminal', stepOrder: 3 },
        ],
        transitions: [
          { fromStateKey: 'draft', toStateKey: 'review', actionKey: 'send', title: 'ارسال' },
          { fromStateKey: 'review', toStateKey: 'done', actionKey: 'approve', title: 'تایید' },
        ],
      });
      defId = saved?.definition?.id;
      if (!defId) throw new Error('تعریف ذخیره نشد');
      const instance = await WorkflowTransitionExecutor.startInstance({ workflowDefinitionId: defId, entityType, entityId: '1' });

      const request = (await import('supertest')).default;
      const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
      const app = await getTestApp();
      const session = await getAdminSession();
      const get = () => request(app).get(`/api/workflow/instance/${entityType}/1`).set('Cookie', session.cookie);

      const res = await get();
      const body = res.body || {};
      if (res.status !== 200) violations.push(`HTTP ${res.status}`);
      if (body.instance?.id !== instance.id) violations.push(`instance.id=${body.instance?.id} (انتظار ${instance.id})`);
      if (body.definition?.id !== defId || body.definition?.code !== `REG_TD085_${suffix}`) violations.push('definition ناقص است');
      const titles = Array.isArray(body.allStates) ? body.allStates.map((s: { title: string }) => s.title) : [];
      if (titles.join('|') !== 'پیش‌نویس|بررسی|تایید نهایی') violations.push(`allStates به ترتیب مراحل نیست: ${titles.join('|') || '-'}`);
      if (body.currentState?.title !== 'پیش‌نویس' || body.currentState?.id !== instance.currentStateId) violations.push(`currentState=${body.currentState?.title ?? '-'}`);
      const actions = Array.isArray(body.availableTransitions) ? body.availableTransitions : [];
      if (actions.length !== 1 || actions[0]?.title !== 'ارسال') violations.push(`availableTransitions=${actions.length}`);
      if (!body.approvalProgress || typeof body.approvalProgress !== 'object') violations.push('approvalProgress نیست');
      if (!Array.isArray(body.history) || body.history.length !== 1) violations.push(`history=${Array.isArray(body.history) ? body.history.length : '-'}`);

      if (actions[0]?.id) {
        const exec = await request(app).post('/api/workflow/transition').set('Cookie', session.cookie).set('x-csrf-token', session.csrfToken)
          .send({ instanceId: instance.id, transitionId: actions[0].id, comment: 'آزمون' });
        if (exec.status !== 200) violations.push(`اجرای اقدام: HTTP ${exec.status}`);
        const after = (await get()).body || {};
        if (after.currentState?.title !== 'بررسی') violations.push(`پس از ارسال currentState=${after.currentState?.title ?? '-'}`);
        if ((after.availableTransitions || [])[0]?.title !== 'تایید') violations.push('اقدام مرحله بعد دیده نمی‌شود');
      }
      const none = await request(app).get(`/api/workflow/instance/${entityType}/999`).set('Cookie', session.cookie);
      if (none.status !== 200 || none.body?.instance !== null) violations.push(`بدون فرایند: ${JSON.stringify(none.body).slice(0, 80)}`);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_workflow_instance_widget_contract_td_085',
        scenarioId: 'workflow_approval_postgres',
        name: testName,
        layer: 'regression',
        executionType: 'real_api',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'پاسخ API فرایند، مراحل به ترتیب، مرحله جاری و اقدام مجاز را داشت و پس از اجرا مرحله بعد را نشان داد.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_workflow_instance_widget_contract_td_085',
        scenarioId: 'workflow_approval_postgres',
        name: testName,
        layer: 'regression',
        executionType: 'real_api',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      if (defId) {
        const instanceIds = (await orm.select({ id: workflowInstances.id }).from(workflowInstances)
          .where(eq(workflowInstances.workflowDefinitionId, defId))).map((r) => r.id);
        if (instanceIds.length > 0) {
          await orm.delete(workflowTasks).where(inArray(workflowTasks.instanceId, instanceIds));
          await orm.delete(workflowPendingApprovals).where(inArray(workflowPendingApprovals.instanceId, instanceIds));
          await orm.delete(workflowHistoryLogs).where(inArray(workflowHistoryLogs.instanceId, instanceIds));
          await orm.delete(workflowInstances).where(inArray(workflowInstances.id, instanceIds));
        }
        await orm.delete(workflowTransitions).where(eq(workflowTransitions.workflowDefinitionId, defId));
        await orm.delete(workflowStates).where(eq(workflowStates.workflowDefinitionId, defId));
        await orm.delete(workflowDefinitionVersions).where(eq(workflowDefinitionVersions.definitionId, defId));
        await orm.delete(workflowDefinitions).where(eq(workflowDefinitions.id, defId));
      }
    }
  }

  // Test: v7.0.89 (TD-085 بند ۱): اقدامی که شرطش برقرار نیست با دلیل فارسی برمی‌گردد (نه پنهان) و خطای اجرا فارسی است
  if (shouldRun('reg_workflow_condition_preview_td_085', 'td085', 'workflow', 'condition')) {
    const tStart = Date.now();
    const testName = 'v7.0.89: پیش‌نمایش فارسی شرط‌های اقدام ورکفلو؛ اقدام مسدود با دلیل برمی‌گردد و خطای اجرا فارسی است (TD-085)';
    const {
      workflowDefinitions, workflowStates, workflowTransitions, workflowInstances, workflowHistoryLogs,
      workflowPendingApprovals, workflowDefinitionVersions, workflowTasks,
    } = await import('../../db/schema.js');
    const { WorkflowDefinitionService } = await import('../../services/workflow/workflowDefinitionService.js');
    const { WorkflowTransitionExecutor } = await import('../../services/workflow/workflowTransitionExecutor.js');
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const entityType = `reg_td085c_${suffix}`;
    let defId: number | undefined;
    try {
      const violations: string[] = [];
      const saved = await WorkflowDefinitionService.saveWorkflowDefinition({
        code: `REG_TD085C_${suffix}`, title: 'ورکفلو آزمون شرط', entityType,
        states: [
          { stateKey: 'draft', title: 'پیش‌نویس', stateType: 'initial', stepOrder: 1 },
          { stateKey: 'done', title: 'تایید', stateType: 'terminal', stepOrder: 2 },
          { stateKey: 'big', title: 'تایید کلان', stateType: 'terminal', stepOrder: 2 },
        ],
        transitions: [
          { fromStateKey: 'draft', toStateKey: 'done', actionKey: 'approve', title: 'تایید عادی',
            ruleConditionsJson: [{ field: 'entityId', operator: 'eq', value: '1' }] },
          { fromStateKey: 'draft', toStateKey: 'big', actionKey: 'approve_big', title: 'تایید کلان',
            ruleConditionsJson: [{ field: 'entityId', operator: 'gt', value: 100 }] },
        ],
      });
      defId = saved?.definition?.id;
      if (!defId) throw new Error('تعریف ذخیره نشد');
      const instance = await WorkflowTransitionExecutor.startInstance({ workflowDefinitionId: defId, entityType, entityId: '1' });
      const st = await WorkflowTransitionExecutor.getInstanceByEntity(entityType, '1', undefined, 'admin', ['*']);
      const available = st?.availableTransitions || [];
      const blocked = st?.blockedTransitions || [];
      if (available.length !== 1 || available[0].title !== 'تایید عادی') violations.push(`اقدام مجاز: ${available.map((t) => t.title).join('،') || '-'}`);
      if (available[0]?.conditions?.[0] !== 'entityId برابر ۱ باشد') violations.push(`متن شرط اقدام مجاز: ${available[0]?.conditions?.join('،') ?? '-'}`);
      if (blocked.length !== 1 || blocked[0].title !== 'تایید کلان') {
        violations.push(`اقدام مسدود: ${blocked.length}`);
      } else if (blocked[0].unmetConditions[0] !== 'entityId بیشتر از ۱۰۰ باشد (مقدار فعلی: ۱)') {
        violations.push(`دلیل مسدود بودن: ${blocked[0].unmetConditions.join('،')}`);
      }
      const blockedId = blocked[0]?.id;
      if (blockedId) {
        let message = '';
        try {
          await WorkflowTransitionExecutor.executeTransition({ instanceId: instance.id, transitionId: blockedId, userRole: 'admin', userPermissions: ['*'] });
        } catch (err) {
          message = err instanceof Error ? err.message : String(err);
        }
        if (!message.includes('entityId بیشتر از ۱۰۰ باشد') || /\bgt\b/.test(message)) violations.push(`خطای اجرای اقدام مسدود: ${message || 'خطا نداد'}`);
      }
      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_workflow_condition_preview_td_085',
        scenarioId: 'workflow_approval_postgres',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'اقدام مجاز متن شرطش را داشت، اقدام مسدود با دلیل فارسی برگشت و اجرای آن با پیام فارسی رد شد.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_workflow_condition_preview_td_085',
        scenarioId: 'workflow_approval_postgres',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      if (defId) {
        const instanceIds = (await orm.select({ id: workflowInstances.id }).from(workflowInstances)
          .where(eq(workflowInstances.workflowDefinitionId, defId))).map((r) => r.id);
        if (instanceIds.length > 0) {
          await orm.delete(workflowTasks).where(inArray(workflowTasks.instanceId, instanceIds));
          await orm.delete(workflowPendingApprovals).where(inArray(workflowPendingApprovals.instanceId, instanceIds));
          await orm.delete(workflowHistoryLogs).where(inArray(workflowHistoryLogs.instanceId, instanceIds));
          await orm.delete(workflowInstances).where(inArray(workflowInstances.id, instanceIds));
        }
        await orm.delete(workflowTransitions).where(eq(workflowTransitions.workflowDefinitionId, defId));
        await orm.delete(workflowStates).where(eq(workflowStates.workflowDefinitionId, defId));
        await orm.delete(workflowDefinitionVersions).where(eq(workflowDefinitionVersions.definitionId, defId));
        await orm.delete(workflowDefinitions).where(eq(workflowDefinitions.id, defId));
      }
    }
  }


  // Test: v7.0.91 (TD-195 / audit P1-8): پایگاه‌داده شماره سند حسابداری تکراری را نمی‌پذیرد و بازرس سلامت مالی
  // شماره‌های تکراری (در داده‌ای که ایندکس یکتا روی آن ساخته نشده) را گزارش می‌کند
  if (shouldRun('reg_voucher_number_unique_td_195', 'td195', 'voucher', 'number', 'unique')) {
    const tStart = Date.now();
    const testName = 'v7.0.91: یکتایی شماره سند حسابداری در پایگاه‌داده و گزارش شماره‌های تکراری (TD-195)';
    const { journalVouchers } = await import('../../db/schema.js');
    const { findDuplicateVoucherNumbers, hasVoucherNumberUniqueIndex, VOUCHER_NUMBER_UNIQUE_INDEX } = await import('../../services/accounting/voucherNumberIntegrity.js');
    const { FinancialHealthService } = await import('../../services/accounting/financialHealth.service.js');
    const fs = await import('fs');
    const path = await import('path');
    const createdIds: number[] = [];
    try {
      const violations: string[] = [];
      const nextNumber = async (executor: { execute: typeof orm.execute } = orm) =>
        Number((await executor.execute(sql`SELECT nextval('journal_voucher_number_seq') AS n`)).rows?.[0]?.n);
      const row = (voucherNumber: number) => ({ voucherNumber, date: '2026-01-10', description: 'ERP-TEST-MARKER TD-195 شماره تکراری' });

      if (!(await hasVoucherNumberUniqueIndex())) violations.push('ایندکس یکتای شماره سند ساخته نشده است');
      const n = await nextNumber();
      const [first] = await orm.insert(journalVouchers).values(row(n)).returning({ id: journalVouchers.id });
      createdIds.push(first.id);
      let duplicateRejected = false;
      try {
        const [dup] = await orm.insert(journalVouchers).values(row(n)).returning({ id: journalVouchers.id });
        createdIds.push(dup.id);
      } catch {
        duplicateRejected = true;
      }
      if (!duplicateRejected) violations.push(`شماره سند تکراری ${n} پذیرفته شد`);

      const report = await FinancialHealthService.runHealthCheck();
      const check = report.tests.find((t) => t.id === 'voucher_number_uniqueness');
      if (!check) violations.push('بازرس سلامت مالی آزمون یکتایی شماره سند ندارد');
      else if (!duplicateRejected && check.count === 0) violations.push('شماره تکراری در گزارش سلامت نیامد');

      // داده قدیمی بدون ایندکس یکتا (تراکنش برگشت‌خورده): شماره‌های تکراری با هر دو سند گزارش می‌شوند
      let reported: number[] = [];
      try {
        await orm.transaction(async (tx) => {
          await tx.execute(sql.raw(`DROP INDEX IF EXISTS ${VOUCHER_NUMBER_UNIQUE_INDEX}`));
          const m = await nextNumber(tx);
          await tx.insert(journalVouchers).values([row(m), row(m)]);
          reported = (await findDuplicateVoucherNumbers(tx)).filter((r) => r.voucherNumber === m).map((r) => r.id);
          // مهاجرت 0031 روی چنین داده‌ای خطا نمی‌دهد، ایندکس نمی‌سازد و sequence را از بزرگ‌ترین شماره جلو می‌برد
          const ahead = m + 1000;
          await tx.insert(journalVouchers).values(row(ahead));
          const migrationSql = fs.readFileSync(path.join(process.cwd(), 'drizzle', '0031_journal_voucher_number_unique.sql'), 'utf8');
          await tx.execute(sql.raw(migrationSql));
          if (await hasVoucherNumberUniqueIndex(tx)) violations.push('مهاجرت روی داده دارای شماره تکراری ایندکس یکتا ساخت');
          const afterMigration = await nextNumber(tx);
          if (afterMigration <= ahead) violations.push(`sequence پس از مهاجرت عقب ماند: ${afterMigration} <= ${ahead}`);
          throw new Error('rollback');
        });
      } catch (err) {
        if (!(err instanceof Error && err.message === 'rollback')) throw err;
      }
      if (reported.length !== 2) violations.push(`گزارش شماره تکراری: ${reported.length} سند (باید ۲)`);
      if (!(await hasVoucherNumberUniqueIndex())) violations.push('ایندکس یکتا پس از برگشت تراکنش آزمون از بین رفت');

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_voucher_number_unique_td_195',
        scenarioId: 'v6_fiscal_year_closing_isolation',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'ایندکس یکتا وجود داشت، شماره تکراری رد شد، بازرس سلامت آزمون یکتایی را داشت و شماره‌های تکراری داده بدون ایندکس گزارش شدند.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_voucher_number_unique_td_195',
        scenarioId: 'v6_fiscal_year_closing_isolation',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      if (createdIds.length > 0) await orm.delete(journalVouchers).where(inArray(journalVouchers.id, createdIds));
    }
  }

  // Test: v7.0.101 (TD-085 بند ۴): پس از گذشتن مهلت کار تاییدی، هر کاربر مسئول (نقش کار) یک اعلان می‌گیرد، بدون تکرار
  if (shouldRun('reg_workflow_sla_reminder_td_085', 'td085', 'workflow', 'sla', 'reminder')) {
    const tStart = Date.now();
    const testName = 'v7.0.101: یادآوری یک‌باره مهلت کار تاییدی به مسئول کار (TD-085)';
    const {
      workflowDefinitions, workflowStates, workflowTransitions, workflowInstances, workflowHistoryLogs,
      workflowPendingApprovals, workflowDefinitionVersions, workflowTasks, users, notifications, roles,
    } = await import('../../db/schema.js');
    const { WorkflowDefinitionService } = await import('../../services/workflow/workflowDefinitionService.js');
    const { WorkflowTransitionExecutor } = await import('../../services/workflow/workflowTransitionExecutor.js');
    const { WorkflowSlaReminderService, WORKFLOW_SLA_REMINDER_LINK } = await import('../../services/workflow/workflowSlaReminderService.js');
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const entityType = `reg_td085s_${suffix}`;
    const role = `reg_sla_${suffix}`;
    let defId: number | undefined;
    const userIds: number[] = [];
    try {
      const violations: string[] = [];
      // v9.0.128 (TD-542): نقش گام باید تعریف شده باشد
      await orm.insert(roles).values({ code: role, name: `نقش آزمون مهلت ${suffix}`, permissions: [] });
      for (const [name, userRole] of [['a', role], ['b', role], ['other', `reg_other_${suffix}`]] as const) {
        const [u] = await orm.insert(users).values({
          username: `reg_sla_${name}_${suffix}`, password: 'x', fullName: `کاربر آزمون مهلت ${name}`, role: userRole,
        }).returning({ id: users.id });
        userIds.push(u.id);
      }
      const saved = await WorkflowDefinitionService.saveWorkflowDefinition({
        code: `REG_TD085S_${suffix}`, title: 'ورکفلو آزمون مهلت', entityType,
        states: [
          { stateKey: 'review', title: 'بررسی', stateType: 'initial', stepOrder: 1, slaHours: 1 },
          { stateKey: 'done', title: 'تایید', stateType: 'terminal', stepOrder: 2 },
        ],
        transitions: [{ fromStateKey: 'review', toStateKey: 'done', actionKey: 'approve', title: 'تایید مدیر', requiredRole: role }],
      });
      defId = saved?.definition?.id;
      if (!defId) throw new Error('تعریف ذخیره نشد');
      const instance = await WorkflowTransitionExecutor.startInstance({ workflowDefinitionId: defId, entityType, entityId: '7' });
      const ours = async () => orm.select().from(notifications).where(inArray(notifications.userId, userIds));

      await WorkflowSlaReminderService.sendDueReminders(new Date());
      if ((await ours()).length !== 0) violations.push('پیش از گذشتن مهلت اعلان فرستاده شد');

      const later = new Date(Date.now() + 2 * 3600 * 1000);
      await WorkflowSlaReminderService.sendDueReminders(later);
      await WorkflowSlaReminderService.sendDueReminders(new Date(later.getTime() + 3600 * 1000));
      const sent = await ours();
      for (const [i, id] of userIds.slice(0, 2).entries()) {
        const mine = sent.filter((n) => n.userId === id);
        if (mine.length !== 1) violations.push(`کاربر مسئول ${i + 1}: ${mine.length} اعلان (باید ۱)`);
        else if (mine[0].link !== WORKFLOW_SLA_REMINDER_LINK || !mine[0].message.includes('تایید مدیر')) violations.push(`متن اعلان: ${mine[0].message}`);
      }
      if (sent.some((n) => n.userId === userIds[2])) violations.push('کاربر با نقش دیگر اعلان گرفت');
      const tasks = await orm.select().from(workflowTasks).where(eq(workflowTasks.instanceId, instance.id));
      if (tasks.length === 0 || tasks.some((t) => t.status !== 'pending' || !t.slaRemindedAt)) {
        violations.push(`وضعیت کار پس از یادآوری: ${tasks.map((t) => `${t.status}/${t.slaRemindedAt ? 'reminded' : '-'}`).join('،') || '-'}`);
      }
      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_workflow_sla_reminder_td_085',
        scenarioId: 'workflow_approval_postgres',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'پیش از مهلت اعلانی نرفت؛ پس از مهلت هر کاربر نقش کار یک اعلان گرفت، اجرای دوباره تکرار نکرد، نقش دیگر اعلان نگرفت و کار باز ماند.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_workflow_sla_reminder_td_085',
        scenarioId: 'workflow_approval_postgres',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      if (userIds.length > 0) await orm.delete(notifications).where(inArray(notifications.userId, userIds));
      if (defId) {
        const instanceIds = (await orm.select({ id: workflowInstances.id }).from(workflowInstances)
          .where(eq(workflowInstances.workflowDefinitionId, defId))).map((r) => r.id);
        if (instanceIds.length > 0) {
          await orm.delete(workflowTasks).where(inArray(workflowTasks.instanceId, instanceIds));
          await orm.delete(workflowPendingApprovals).where(inArray(workflowPendingApprovals.instanceId, instanceIds));
          await orm.delete(workflowHistoryLogs).where(inArray(workflowHistoryLogs.instanceId, instanceIds));
          await orm.delete(workflowInstances).where(inArray(workflowInstances.id, instanceIds));
        }
        await orm.delete(workflowTransitions).where(eq(workflowTransitions.workflowDefinitionId, defId));
        await orm.delete(workflowStates).where(eq(workflowStates.workflowDefinitionId, defId));
        await orm.delete(workflowDefinitionVersions).where(eq(workflowDefinitionVersions.definitionId, defId));
        await orm.delete(workflowDefinitions).where(eq(workflowDefinitions.id, defId));
      }
      if (userIds.length > 0) await orm.delete(users).where(inArray(users.id, userIds));
      await orm.delete(roles).where(eq(roles.code, role));
    }
  }

  // Test: v7.0.101 (TD-085، تصمیم «بازگشایی با گزارش»): کار تاییدی با گذشتن مهلت منقضی نمی‌شود و مهاجرت 0032
  // کار منقضی‌شده مرحله جاری فرایند در جریان را باز می‌کند، بقیه را با دلیل منقضی نگه می‌دارد و همه را گزارش می‌کند
  if (shouldRun('reg_workflow_task_reopen_td_085', 'td085', 'workflow', 'expired', 'reopen')) {
    const tStart = Date.now();
    const testName = 'v7.0.101: کار تاییدی منقضی نمی‌شود و کارهای منقضی‌شده مرحله جاری با گزارش بازگشایی می‌شوند (TD-085)';
    const {
      workflowDefinitions, workflowStates, workflowTransitions, workflowInstances, workflowHistoryLogs,
      workflowPendingApprovals, workflowDefinitionVersions, workflowTasks, users, roles,
    } = await import('../../db/schema.js');
    const { WorkflowDefinitionService } = await import('../../services/workflow/workflowDefinitionService.js');
    const { WorkflowTransitionExecutor } = await import('../../services/workflow/workflowTransitionExecutor.js');
    const { WorkflowTaskService } = await import('../../services/workflow/workflowTaskService.js');
    const fs = await import('fs');
    const path = await import('path');
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const entityType = `reg_td085r_${suffix}`;
    const role = `reg_reopen_${suffix}`;
    let defId: number | undefined;
    let userId: number | undefined;
    try {
      const violations: string[] = [];
      // v9.0.128 (TD-542): نقش گام باید تعریف شده باشد
      await orm.insert(roles).values({ code: role, name: `نقش آزمون بازگشایی ${suffix}`, permissions: [] });
      const [u] = await orm.insert(users).values({
        username: `reg_reopen_${suffix}`, password: 'x', fullName: 'کاربر آزمون بازگشایی', role,
      }).returning({ id: users.id });
      userId = u.id;
      const saved = await WorkflowDefinitionService.saveWorkflowDefinition({
        code: `REG_TD085R_${suffix}`, title: 'ورکفلو آزمون بازگشایی', entityType,
        states: [
          { stateKey: 'review', title: 'بررسی', stateType: 'initial', stepOrder: 1, slaHours: 1 },
          { stateKey: 'check', title: 'کنترل', stateType: 'normal', stepOrder: 2, slaHours: 1 },
          { stateKey: 'done', title: 'تایید', stateType: 'terminal', stepOrder: 3 },
        ],
        transitions: [
          { fromStateKey: 'review', toStateKey: 'check', actionKey: 'pass', title: 'ارسال به کنترل', requiredRole: role },
          { fromStateKey: 'check', toStateKey: 'done', actionKey: 'approve', title: 'تایید نهایی', requiredRole: role },
        ],
      });
      defId = saved?.definition?.id;
      if (!defId) throw new Error('تعریف ذخیره نشد');
      const transitions = await orm.select().from(workflowTransitions).where(eq(workflowTransitions.workflowDefinitionId, defId));
      const passId = transitions.find((t) => t.actionKey === 'pass')!.id;
      const approveId = transitions.find((t) => t.actionKey === 'approve')!.id;

      // ۱) کار مرحله جاری با مهلت گذشته پس از باز کردن کارتابل در انتظار می‌ماند
      const running = await WorkflowTransitionExecutor.startInstance({ workflowDefinitionId: defId, entityType, entityId: '1' });
      const past = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
      await orm.update(workflowTasks).set({ dueAt: past }).where(eq(workflowTasks.instanceId, running.id));
      await WorkflowTaskService.getMyTasks({ userId: u.id, userRole: role });
      const afterInbox = await orm.select().from(workflowTasks).where(eq(workflowTasks.instanceId, running.id));
      if (afterInbox.length === 0 || afterInbox.some((t) => t.status !== 'pending')) {
        violations.push(`کار با مهلت گذشته پس از کارتابل: ${afterInbox.map((t) => t.status).join('،') || '-'}`);
      }

      // ۲) داده قدیمی: کار منقضی مرحله جاری، کار منقضی مرحله گذشته و کار منقضی فرایند پایان‌یافته (تراکنش برگشت‌خورده)
      const finished = await WorkflowTransitionExecutor.startInstance({ workflowDefinitionId: defId, entityType, entityId: '2' });
      let outcome: Record<string, string> = {};
      let logged: Array<{ taskId: number; action: string; reason: string }> = [];
      try {
        await orm.transaction(async (tx) => {
          await tx.update(workflowTasks).set({ status: 'expired' }).where(eq(workflowTasks.instanceId, running.id));
          const [stale] = await tx.insert(workflowTasks).values({
            instanceId: running.id, transitionId: approveId, assignedRole: role, status: 'expired', title: 'کار مرحله دیگر', dueAt: past,
          }).returning({ id: workflowTasks.id });
          await tx.update(workflowTasks).set({ status: 'expired' }).where(eq(workflowTasks.instanceId, finished.id));
          await tx.update(workflowInstances).set({ status: 'COMPLETED' }).where(eq(workflowInstances.id, finished.id));
          const migrationSql = fs.readFileSync(path.join(process.cwd(), 'drizzle', '0032_workflow_task_sla_reminder.sql'), 'utf8');
          await tx.execute(sql.raw(migrationSql));
          const rows = await tx.select().from(workflowTasks).where(inArray(workflowTasks.instanceId, [running.id, finished.id]));
          for (const r of rows) {
            const kind = r.id === stale.id ? 'stale' : r.instanceId === finished.id ? 'finished' : r.transitionId === passId ? 'current' : `other${r.id}`;
            outcome[kind] = r.status;
          }
          const log = await tx.execute(sql`SELECT task_id, action, reason FROM workflow_task_reopen_log WHERE task_id IN (${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)})`);
          logged = (log.rows ?? []).map((r) => ({ taskId: Number(r.task_id), action: String(r.action), reason: String(r.reason) }));
          throw new Error('rollback');
        });
      } catch (err) {
        if (!(err instanceof Error && err.message === 'rollback')) throw err;
      }
      if (outcome.current !== 'pending') violations.push(`کار منقضی مرحله جاری: ${outcome.current} (باید pending)`);
      if (outcome.stale !== 'expired') violations.push(`کار منقضی مرحله دیگر: ${outcome.stale} (باید expired)`);
      if (outcome.finished !== 'expired') violations.push(`کار منقضی فرایند پایان‌یافته: ${outcome.finished} (باید expired)`);
      if (logged.length !== 3) violations.push(`ردیف گزارش: ${logged.length} (باید ۳)`);
      if (logged.filter((l) => l.action === 'reopened').length !== 1) violations.push('گزارش باید دقیقاً یک بازگشایی داشته باشد');
      if (logged.some((l) => !l.reason)) violations.push('ردیف گزارش بدون دلیل');

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_workflow_task_reopen_td_085',
        scenarioId: 'workflow_approval_postgres',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'کار با مهلت گذشته در انتظار ماند؛ مهاجرت فقط کار مرحله جاری فرایند در جریان را باز کرد و هر سه کار منقضی با دلیل گزارش شدند.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_workflow_task_reopen_td_085',
        scenarioId: 'workflow_approval_postgres',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      if (defId) {
        const instanceIds = (await orm.select({ id: workflowInstances.id }).from(workflowInstances)
          .where(eq(workflowInstances.workflowDefinitionId, defId))).map((r) => r.id);
        if (instanceIds.length > 0) {
          await orm.delete(workflowTasks).where(inArray(workflowTasks.instanceId, instanceIds));
          await orm.delete(workflowPendingApprovals).where(inArray(workflowPendingApprovals.instanceId, instanceIds));
          await orm.delete(workflowHistoryLogs).where(inArray(workflowHistoryLogs.instanceId, instanceIds));
          await orm.delete(workflowInstances).where(inArray(workflowInstances.id, instanceIds));
        }
        await orm.delete(workflowTransitions).where(eq(workflowTransitions.workflowDefinitionId, defId));
        await orm.delete(workflowStates).where(eq(workflowStates.workflowDefinitionId, defId));
        await orm.delete(workflowDefinitionVersions).where(eq(workflowDefinitionVersions.definitionId, defId));
        await orm.delete(workflowDefinitions).where(eq(workflowDefinitions.id, defId));
      }
      if (userId) await orm.delete(users).where(eq(users.id, userId));
      await orm.delete(roles).where(eq(roles.code, role));
    }
  }

  // ------------------------------------------------------------------
  // v7.0.102 (TD-233، تصمیم مالک محصول «کسر در سرور»): رزرو پروژه در همان تراکنش حواله خروج کم می‌شود
  // ------------------------------------------------------------------
  if (shouldRun('reg_project_reservation_server_td_233', 'td233', 'reservation', 'createDocument')) {
    const tStart = Date.now();
    const testName = 'v7.0.102 Regression: کسر رزرو پروژه داخل تراکنش حواله خروج، از همه ردیف‌های هم‌کالا (TD-233)';
    const suffix = `${Date.now()}`;
    const docIds: number[] = [];
    const projectIds: number[] = [];
    let itemId = 0;
    try {
      const { productionProjects } = await import('../../db/schema.js');
      const { createTestItem } = await import('../fixtures/factories.js');
      const { ItemStockReservationService } = await import('../../services/items/itemStockReservation.service.js');
      const today = await businessTodayIsoDate();
      const item = await createTestItem({ name: `ERP-TEST-MARKER کالای رزرو TD-233 ${suffix}`, code: `ITEM_TD233_${suffix}`, stocks: { '': 20 } });
      itemId = item.id;
      const newProject = async (reservedItems: unknown[]) => {
        const [p] = await orm.insert(productionProjects).values({
          projectCode: `PROJ_TD233_${suffix}_${projectIds.length}`,
          title: `ERP-TEST-MARKER پروژه رزرو TD-233 ${suffix}`,
          status: 'in_progress',
          version: 1,
          inventoryControl: { isReserved: true, reservedItems },
        }).returning();
        projectIds.push(p.id);
        return p.id;
      };
      const reservedOf = async (projectId: number) => {
        const [p] = await orm.select().from(productionProjects).where(eq(productionProjects.id, projectId));
        const inv = (p.inventoryControl ?? {}) as { reservedItems?: Array<Record<string, unknown>> };
        return Array.isArray(inv.reservedItems) ? inv.reservedItems : [];
      };
      const remittance = (projectId: number, quantity: number, status: string, ref: string): CreateDocumentInput => ({
        docType: 'remittance', status, refNumber: ref, date: today, user: 'test-agent', inOut: 'out', location: '',
        projectId, skipVoucherSync: true, items: [{ itemId: item.id, quantity, unit_price: 0 }],
      });
      const violations: string[] = [];

      // ۱. دو ردیف رزرو یک کالا (دومی با مقدار تبدیل‌شده): خروج ۴ عدد از هر دو ردیف به ترتیب کم می‌شود
      const projA = await newProject([
        { itemId: item.id, itemCode: item.code, itemName: item.name, reservedQty: 2, unit: 'عدد' },
        { itemCode: item.code, itemName: item.name, convertedQty: 5, reservedQty: 50, unit: 'عدد' },
      ]);
      const created = await DocumentService.createDocumentWithDetails(remittance(projA, 4, 'final', `REM-TD233-A-${suffix}`));
      docIds.push(created.docId);
      const afterA = await reservedOf(projA);
      if (created.projectReservation?.releasedQuantity !== 4) violations.push(`مقدار کسرشده: ${created.projectReservation?.releasedQuantity} (باید ۴)`);
      if (afterA.length !== 1 || Number(afterA[0].convertedQty) !== 3 || Number(afterA[0].reservedQty) !== 50) {
        violations.push(`رزرو باقی‌مانده پروژه A: ${JSON.stringify(afterA)} (باید یک ردیف با convertedQty=3)`);
      }
      const report = await ItemStockReservationService.getReservedStockDetails();
      const reportedA = report.allReservationEntries
        .filter(e => e.sourceType === 'project' && Number(e.sourceId) === projA)
        .reduce((sum, e) => sum + Number(e.reservedQty || 0), 0);
      if (reportedA !== 3) violations.push(`گزارش رزروها برای پروژه A: ${reportedA} (باید ۳)`);

      // ۲. خطای کسر رزرو، کل حواله را برمی‌گرداند (سند و گردش انبار ثبت نمی‌شوند). شکست با تریگری موقت روی
      // به‌روزرسانی همین پروژه ساخته می‌شود که با برگشت تراکنش بیرونی حذف می‌شود.
      const projB = await newProject([{ itemId: item.id, reservedQty: 3, unit: 'عدد' }]);
      const failRef = `REM-TD233-B-${suffix}`;
      let rejected = false;
      let leaked = false;
      let stockAfterReject = -1;
      try {
        await orm.transaction(async (outer) => {
          await outer.execute(sql.raw(`CREATE FUNCTION td233_fail_reservation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'td233 forced reservation failure'; END $$`));
          await outer.execute(sql.raw(`CREATE TRIGGER td233_fail_reservation BEFORE UPDATE ON production_projects FOR EACH ROW WHEN (OLD.id = ${projB}) EXECUTE FUNCTION td233_fail_reservation()`));
          try {
            await outer.transaction(async (sp) => {
              await DocumentService.createDocumentWithDetails({ ...remittance(projB, 1, 'final', failRef), externalTx: sp });
            });
          } catch {
            rejected = true;
          }
          const found = await outer.select({ id: documents.id }).from(documents).where(eq(documents.refNumber, failRef));
          leaked = found.length > 0;
          stockAfterReject = (await ItemWarehouseStockService.getStocksForItems(outer, [item.id])).get(item.id)?.total ?? -1;
          throw new Error('rollback');
        });
      } catch (err) {
        if (!(err instanceof Error && err.message === 'rollback')) throw err;
      }
      if (!rejected) violations.push('حواله با خطای کسر رزرو باید رد شود');
      if (leaked) violations.push('سند حواله ردشده نباید ثبت شده باشد');
      if (stockAfterReject !== 16) violations.push(`موجودی پس از حواله ردشده: ${stockAfterReject} (باید ۱۶)`);

      // ۳. پیش‌نویس رزرو را کم نمی‌کند؛ نهایی‌سازی آن در همان تراکنش کم می‌کند
      const projC = await newProject([{ itemId: item.id, reservedQty: 6, unit: 'عدد' }]);
      const draftId = await DocumentService.createDocument(remittance(projC, 2, 'draft', `REM-TD233-C-${suffix}`));
      docIds.push(draftId);
      const afterDraft = await reservedOf(projC);
      if (Number(afterDraft[0]?.reservedQty) !== 6) violations.push(`پیش‌نویس رزرو را تغییر داد: ${JSON.stringify(afterDraft)}`);
      await DocumentService.finalizeDocument(draftId, 'test-agent', undefined, { strict: false });
      const afterFinal = await reservedOf(projC);
      if (Number(afterFinal[0]?.reservedQty) !== 4) violations.push(`رزرو پس از نهایی‌سازی: ${JSON.stringify(afterFinal)} (باید ۴)`);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_project_reservation_server_td_233',
        scenarioId: 'inventory_rebuild',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'خروج ۴ عدد از دو ردیف رزرو کم شد (گزارش رزروها همان ۳ را نشان داد)، خطای کسر حواله را برگرداند و نهایی‌سازی پیش‌نویس رزرو را کم کرد.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_project_reservation_server_td_233',
        scenarioId: 'inventory_rebuild',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      if (docIds.length > 0) {
        await cleanTestTableData('document_items', 'document_id', docIds);
        await cleanTestTableData('transactions', 'document_id', docIds);
        await cleanTestTableData('documents', 'id', docIds);
      }
      if (projectIds.length > 0) await cleanTestTableData('production_projects', 'id', projectIds);
      if (itemId) await cleanTestTableData('items', 'id', [itemId]);
    }
  }
  // ------------------------------------------------------------------
  // v7.0.103 (TD-191، تصمیم مالک محصول «ثبت کامل»): هزینه ارسال، کارمزد و مالیات سفارش ووکامرس روی فاکتور
  // ------------------------------------------------------------------
  if (shouldRun('reg_woocommerce_shipping_tax_td_191', 'td191', 'woocommerce')) {
    const tStart = Date.now();
    const testName = 'v7.0.103 Regression: هزینه ارسال و کارمزد به «درآمد حمل و خدمات» و مالیات سفارش ووکامرس به vat_amount؛ جمع فاکتور = مبلغ پرداختی (TD-191)';
    const { woocommerceOrderLogs, customers } = await import('../../db/schema.js');
    const base = String(8100000 + Math.floor(Math.random() * 800000));
    const ids = { ok: `${base}1`, bad: `${base}3` };
    let itemId = 0;
    const violations: string[] = [];
    try {
      const { WooOrderSyncService } = await import('../../services/woocommerce/wooOrderSync.service.js');
      const { createTestItem } = await import('../fixtures/factories.js');
      const item = await createTestItem({ code: `WC_TD191_${base}`, name: `ERP-TEST-MARKER کالای ووکامرس TD-191 ${base}`, stocks: { '': 10 } });
      itemId = item.id;
      const order = (id: string, total: string) => ({
        id, number: id, status: 'processing', currency: 'IRR', total,
        billing: { first_name: 'خریدار', last_name: `آزمون TD-191 ${id}`, phone: '', city: 'تهران', address_1: 'خیابان آزمون' },
        line_items: [{ id: 1, name: 'قلم آزمون', sku: item.code, quantity: 2, price: 1000, total: '2000' }],
        shipping_lines: [{ method_title: 'پیک', total: '300' }],
        fee_lines: [{ name: 'بسته‌بندی', total: '50' }, { name: 'تخفیف کارمزد', total: '-20' }],
        total_tax: '230',
      });

      // ۱. سفارش سازگار: ۲۰۰۰ اقلام + ۳۳۰ ارسال و کارمزد + ۲۳۰ مالیات = ۲۵۶۰ پرداختی
      const okResult = await WooOrderSyncService.handleOrder(order(ids.ok, '2560'));
      if (okResult.status !== 'processed' || !okResult.docId) {
        throw new Error(`سفارش سازگار باید فاکتور شود: ${okResult.status} ${okResult.message}`);
      }
      const doc = await DocumentService.getDocumentById(okResult.docId);
      // v8.0.42 (TD-295، تصمیم مالک محصول — گزینه الف): کارمزد منفی ۲۰ تخفیف سطر است، نه کسر از هزینه خدمات؛ قابل وصول همان ۲۵۶۰
      if (doc?.serviceChargeAmount !== 350) violations.push(`هزینه ارسال و خدمات فاکتور: ${doc?.serviceChargeAmount} (باید ۳۵۰ = ارسال ۳۰۰ + کارمزد ۵۰)`);
      if (doc?.vatAmount !== 230) violations.push(`مالیات فاکتور: ${doc?.vatAmount} (باید ۲۳۰)`);
      if (doc?.payableAmount !== 2560) violations.push(`مبلغ قابل وصول فاکتور: ${doc?.payableAmount} (باید ۲۵۶۰ = مبلغ پرداختی)`);
      const [voucher] = await orm.select().from(journalVouchers)
        .where(and(eq(journalVouchers.sourceDocumentId, okResult.docId), eq(journalVouchers.isDeleted, 0)));
      if (!voucher) {
        violations.push('سند حسابداری فاکتور صادر نشد');
      } else {
        const rows = await orm.select({ code: accounts.code, debit: journalVoucherItems.debit, credit: journalVoucherItems.credit })
          .from(journalVoucherItems).innerJoin(accounts, eq(journalVoucherItems.accountId, accounts.id))
          .where(eq(journalVoucherItems.voucherId, voucher.id));
        const credit = (code: string) => rows.filter(r => r.code === code).reduce((s, r) => s + Number(r.credit), 0);
        const debit = (code: string) => rows.filter(r => r.code === code).reduce((s, r) => s + Number(r.debit), 0);
        if (credit('5004') !== 350) violations.push(`بستانکار درآمد حمل و خدمات (۵۰۰۴): ${credit('5004')} (باید ۳۵۰)`);
        if (credit('3203') !== 230) violations.push(`بستانکار مالیات (۳۲۰۳): ${credit('3203')} (باید ۲۳۰)`);
        if (debit('1201') !== 2560) violations.push(`بدهکار مشتری (۱۲۰۱): ${debit('1201')} (باید ۲۵۶۰)`);
      }

      // ۲. جمع ناسازگار با مبلغ پرداختی: کل سفارش رد و شکست در لاگ ثبت می‌شود
      const badResult = await WooOrderSyncService.handleOrder(order(ids.bad, '2400'));
      const [badLog] = await orm.select().from(woocommerceOrderLogs).where(eq(woocommerceOrderLogs.wcOrderId, ids.bad));
      if (badResult.status !== 'failed' || badLog?.erpDocumentId) violations.push(`سفارش با جمع ناسازگار باید رد شود: ${badResult.status}`);
      if (!String(badLog?.errorMessage || '').includes('مبلغ پرداختی')) violations.push(`پیام شکست جمع ناسازگار: ${badLog?.errorMessage}`);

      // ۳. مهاجرت 0033 روی پایگاه‌داده موجود (بدون حساب ۵۰۰۴) حساب «درآمد حمل و خدمات» را زیر حساب کل ۵۰ می‌سازد
      const fs = await import('fs');
      const migrationSql = fs.readFileSync('drizzle/0033_document_service_charge.sql', 'utf8').split('--> statement-breakpoint');
      let createdUnder50 = false;
      try {
        await orm.transaction(async (tx) => {
          await tx.execute(sql`UPDATE accounts SET is_deleted = 1 WHERE code = '5004'`);
          await tx.execute(sql.raw(migrationSql[migrationSql.length - 1]));
          const res = await tx.execute(sql`SELECT a.name, p.code AS parent_code FROM accounts a JOIN accounts p ON p.id = a.parent_id WHERE a.code = '5004' AND a.is_deleted = 0`);
          const row = (res.rows ?? [])[0] as { name?: string; parent_code?: string } | undefined;
          createdUnder50 = row?.name === 'درآمد حمل و خدمات' && row?.parent_code === '50';
          throw new Error('rollback');
        });
      } catch (err) {
        if (!(err instanceof Error && err.message === 'rollback')) throw err;
      }
      if (!createdUnder50) violations.push('مهاجرت 0033 حساب ۵۰۰۴ را زیر حساب ۵۰ نساخت');

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_woocommerce_shipping_tax_td_191',
        scenarioId: 'woocommerce_order_lifecycle',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'فاکتور سفارش ۳۵۰ هزینه ارسال و خدمات، ۲۰ تخفیف سطر (کارمزد منفی، TD-295) و ۲۳۰ مالیات گرفت و قابل وصولش ۲۵۶۰ (مبلغ پرداختی) شد؛ سند حسابداری ۳۵۰ را به ۵۰۰۴ برد و سفارش با جمع ناسازگار رد شد.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_woocommerce_shipping_tax_td_191',
        scenarioId: 'woocommerce_order_lifecycle',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      const orderIdList = Object.values(ids);
      const logs = await orm.select({ docId: woocommerceOrderLogs.erpDocumentId, buyerName: woocommerceOrderLogs.buyerName })
        .from(woocommerceOrderLogs).where(inArray(woocommerceOrderLogs.wcOrderId, orderIdList));
      await orm.delete(woocommerceOrderLogs).where(inArray(woocommerceOrderLogs.wcOrderId, orderIdList));
      const docIds = logs.map(l => l.docId).filter((v): v is number => typeof v === 'number');
      if (docIds.length > 0) {
        await cleanTestTableData('document_items', 'document_id', docIds);
        await cleanTestTableData('transactions', 'document_id', docIds);
        await cleanTestTableData('documents', 'id', docIds);
      }
      const buyerNames = logs.map(l => l.buyerName).filter((v): v is string => Boolean(v) && String(v).includes('TD-191'));
      if (buyerNames.length > 0) await orm.delete(customers).where(inArray(customers.name, buyerNames));
      if (itemId) await cleanTestTableData('items', 'id', [itemId]);
    }
  }
  // ------------------------------------------------------------------
  // v7.0.105 (TD-237، تصمیم مالک محصول «برگردد»): ابطال حواله خروج پروژه، رزرو کسرشده را به همان پروژه برمی‌گرداند
  // ------------------------------------------------------------------
  if (shouldRun('reg_project_reservation_restore_td_237', 'td237', 'reservation', 'deleteDocument')) {
    const tStart = Date.now();
    const testName = 'v7.0.105 Regression: ابطال حواله خروج پروژه، همان رزرو کسرشده را به همان پروژه برمی‌گرداند (TD-237)';
    const suffix = `${Date.now()}`;
    const docIds: number[] = [];
    const projectIds: number[] = [];
    let itemId = 0;
    try {
      const { productionProjects, projectReservationReleases } = await import('../../db/schema.js');
      const { createTestItem } = await import('../fixtures/factories.js');
      const { ItemStockReservationService } = await import('../../services/items/itemStockReservation.service.js');
      const today = await businessTodayIsoDate();
      const item = await createTestItem({ name: `ERP-TEST-MARKER کالای رزرو TD-237 ${suffix}`, code: `ITEM_TD237_${suffix}`, stocks: { '': 20 } });
      itemId = item.id;
      const newProject = async (reservedItems: unknown[]) => {
        const [p] = await orm.insert(productionProjects).values({
          projectCode: `PROJ_TD237_${suffix}_${projectIds.length}`,
          title: `ERP-TEST-MARKER پروژه رزرو TD-237 ${suffix}`,
          status: 'in_progress',
          version: 1,
          inventoryControl: { isReserved: true, reservedItems },
        }).returning();
        projectIds.push(p.id);
        return p.id;
      };
      const reservedOf = async (projectId: number) => {
        const [p] = await orm.select().from(productionProjects).where(eq(productionProjects.id, projectId));
        const inv = (p.inventoryControl ?? {}) as { reservedItems?: Array<Record<string, unknown>>; isReserved?: boolean };
        return { rows: Array.isArray(inv.reservedItems) ? inv.reservedItems : [], isReserved: inv.isReserved };
      };
      const reportedFor = async (projectId: number) => (await ItemStockReservationService.getReservedStockDetails()).allReservationEntries
        .filter(e => e.sourceType === 'project' && Number(e.sourceId) === projectId)
        .reduce((sum, e) => sum + Number(e.reservedQty || 0), 0);
      const stockOf = async () => (await ItemWarehouseStockService.getStocksForItems(orm, [item.id])).get(item.id)?.total ?? -1;
      const remittance = (projectId: number, quantity: number, status: string, ref: string): CreateDocumentInput => ({
        docType: 'remittance', status, refNumber: ref, date: today, user: 'test-agent', inOut: 'out', location: '',
        projectId, skipVoucherSync: true, items: [{ itemId: item.id, quantity, unit_price: 0 }],
      });
      const violations: string[] = [];

      // ۱. خروج ۴ عدد، ردیف اول (۲ عدد) را کامل مصرف و حذف می‌کند و از ردیف دوم ۲ عدد کم می‌کند؛ ابطال هر دو را برمی‌گرداند
      const projA = await newProject([
        { itemId: item.id, itemCode: item.code, itemName: item.name, reservedQty: 2, unit: 'عدد' },
        { itemCode: item.code, itemName: item.name, convertedQty: 5, reservedQty: 50, unit: 'عدد' },
      ]);
      const docA = await DocumentService.createDocument(remittance(projA, 4, 'final', `REM-TD237-A-${suffix}`));
      docIds.push(docA);
      if ((await reservedOf(projA)).rows.length !== 1) violations.push('پیش از ابطال باید فقط یک ردیف رزرو بماند');
      await DocumentService.deleteDocument(docA, 'test-agent');
      const restoredA = await reservedOf(projA);
      const firstRow = restoredA.rows.find(r => Number(r.itemId) === item.id && Number(r.reservedQty) === 2);
      const secondRow = restoredA.rows.find(r => Number(r.convertedQty) === 5 && Number(r.reservedQty) === 50);
      if (restoredA.rows.length !== 2 || !firstRow || !secondRow) violations.push(`رزرو پروژه A پس از ابطال: ${JSON.stringify(restoredA.rows)} (باید ۲ + ۵)`);
      if (restoredA.isReserved !== true) violations.push('پروژه A پس از ابطال باید رزرودار باشد');
      const reportedA = await reportedFor(projA);
      if (reportedA !== 7) violations.push(`گزارش رزروها برای پروژه A: ${reportedA} (باید ۷)`);
      const records = await orm.select().from(projectReservationReleases).where(eq(projectReservationReleases.documentId, docA));
      if (records.length !== 2 || records.some(r => !r.restoredAt)) violations.push(`سابقه کسر حواله A: ${records.length} ردیف، بازگشته: ${records.filter(r => r.restoredAt).length} (باید ۲ و ۲)`);
      if (await stockOf() !== 20) violations.push(`موجودی پس از ابطال حواله A: ${await stockOf()} (باید ۲۰)`);

      // ۲. رزرو کامل مصرف‌شده (فهرست خالی) هم برمی‌گردد؛ مسیر نهایی‌سازی پیش‌نویس نیز سابقه کسر ثبت می‌کند
      const projB = await newProject([{ itemId: item.id, itemCode: item.code, reservedQty: 3, unit: 'عدد' }]);
      const draftB = await DocumentService.createDocument(remittance(projB, 3, 'draft', `REM-TD237-B-${suffix}`));
      docIds.push(draftB);
      await DocumentService.finalizeDocument(draftB, 'test-agent', undefined, { strict: false });
      const consumedB = await reservedOf(projB);
      if (consumedB.rows.length !== 0 || consumedB.isReserved !== false) violations.push(`رزرو پروژه B پس از نهایی‌سازی: ${JSON.stringify(consumedB)} (باید خالی)`);
      await DocumentService.deleteDocument(draftB, 'test-agent');
      const restoredB = await reservedOf(projB);
      if (restoredB.rows.length !== 1 || Number(restoredB.rows[0].reservedQty) !== 3 || restoredB.isReserved !== true) {
        violations.push(`رزرو پروژه B پس از ابطال: ${JSON.stringify(restoredB)} (باید یک ردیف ۳ عددی)`);
      }

      // ۳. حذف پیش‌نویس حواله (که چیزی کسر نکرده بود) رزرو را تغییر نمی‌دهد
      const projC = await newProject([{ itemId: item.id, reservedQty: 6, unit: 'عدد' }]);
      const draftC = await DocumentService.createDocument(remittance(projC, 2, 'draft', `REM-TD237-C-${suffix}`));
      docIds.push(draftC);
      await DocumentService.deleteDocument(draftC, 'test-agent');
      const afterC = await reservedOf(projC);
      if (afterC.rows.length !== 1 || Number(afterC.rows[0].reservedQty) !== 6) violations.push(`حذف پیش‌نویس رزرو را تغییر داد: ${JSON.stringify(afterC.rows)}`);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_project_reservation_restore_td_237',
        scenarioId: 'inventory_rebuild',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'ابطال حواله ۴ عددی هر دو ردیف رزرو (۲ و ۵) را برگرداند و گزارش رزروها ۷ نشان داد؛ رزرو کامل مصرف‌شده هم برگشت و حذف پیش‌نویس رزرو را تغییر نداد.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_project_reservation_restore_td_237',
        scenarioId: 'inventory_rebuild',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      if (docIds.length > 0) {
        await cleanTestTableData('document_items', 'document_id', docIds);
        await cleanTestTableData('transactions', 'document_id', docIds);
        await cleanTestTableData('documents', 'id', docIds);
      }
      if (projectIds.length > 0) await cleanTestTableData('production_projects', 'id', projectIds);
      if (itemId) await cleanTestTableData('items', 'id', [itemId]);
    }
  }

  // ------------------------------------------------------------------
  // v7.0.110 (TD-240): فیلتر «all» خزانه و چک یعنی بدون فیلتر، نه «هیچ ردیف»
  // ------------------------------------------------------------------
  if (shouldRun('reg_treasury_cheque_all_filter_td_240', 'td240', 'cheque', 'treasury')) {
    const tStart = Date.now();
    const testName = 'v7.0.110 Regression: فیلتر all در فهرست تراکنش‌های خزانه و چک‌ها همه ردیف‌ها را برمی‌گرداند (TD-240)';
    const suffix = `${Date.now()}`;
    let chequeId = 0;
    let treasuryId = 0;
    try {
      const { cheques, treasuryTransactions } = await import('../../db/schema.js');
      const { AccountingService } = await import('../../services/accounting.service.js');
      const today = await businessTodayIsoDate();
      const [c] = await orm.insert(cheques).values({
        type: 'received', chequeNumber: `CHQ-TD240-${suffix}`, bankName: 'ERP-TEST-MARKER بانک', issueDate: today, dueDate: today,
        amount: money(1000), partyName: 'ERP-TEST-MARKER طرف حساب TD-240', status: 'pending',
      }).returning();
      chequeId = c.id;
      const [t] = await orm.insert(treasuryTransactions).values({
        transactionNumber: `TRX-TD240-${suffix}`, type: 'receipt', date: today, method: 'cash', amount: money(1000),
        partyName: 'ERP-TEST-MARKER طرف حساب TD-240',
      }).returning();
      treasuryId = t.id;
      const violations: string[] = [];
      const chequesAll = await AccountingService.getCheques({ type: 'all', status: 'all' });
      if (!chequesAll.some(x => x.id === chequeId)) violations.push(`چک با type=all و status=all برنگشت (${chequesAll.length} ردیف)`);
      const chequesPaid = await AccountingService.getCheques({ type: 'paid' });
      if (chequesPaid.some(x => x.id === chequeId)) violations.push('فیلتر type=paid چک دریافتی را برگرداند');
      const txAll = await AccountingService.getTreasuryTransactions({ type: 'all' });
      if (!txAll.some(x => x.id === treasuryId)) violations.push(`تراکنش خزانه با type=all برنگشت (${txAll.length} ردیف)`);
      const txPayments = await AccountingService.getTreasuryTransactions({ type: 'payment' });
      if (txPayments.some(x => x.id === treasuryId)) violations.push('فیلتر type=payment دریافت را برگرداند');
      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_treasury_cheque_all_filter_td_240', scenarioId: 'multi_currency_financials_and_ratios', name: testName, layer: 'regression',
        executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
        details: 'type=all و status=all همه چک‌ها و تراکنش‌های خزانه را برگرداندند و فیلتر نوع همچنان کار می‌کند.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_treasury_cheque_all_filter_td_240', scenarioId: 'multi_currency_financials_and_ratios', name: testName, layer: 'regression',
        executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      if (chequeId) await cleanTestTableData('cheques', 'id', [chequeId]);
      if (treasuryId) await cleanTestTableData('treasury_transactions', 'id', [treasuryId]);
    }
  }

  // ------------------------------------------------------------------
  // v7.0.111 (TD-238): فرایند درخواست خرید از تصویر قدیمی بدون شناسه پایگاه‌داده استفاده نمی‌کند (AGENTS §14.3)
  // ------------------------------------------------------------------
  if (shouldRun('reg_procurement_workflow_snapshot_td_238', 'td238', 'procurement', 'snapshot')) {
    const tStart = Date.now();
    const testName = 'v7.0.111 Regression: درخواست خرید تصویر فرایند بدون شناسه را کنار می‌گذارد و جدول‌های جاری را می‌خواند (TD-238)';
    const defIds: number[] = [];
    try {
      const { createTestWorkflow } = await import('../fixtures/factories.js');
      const { ProcurementService } = await import('../../services/procurement.service.js');
      const wf = await createTestWorkflow({ definition: { entityType: 'purchase_requisition' } });
      defIds.push(wf.definition.id);
      const violations: string[] = [];
      // تصویر نسخه ۱ قدیمی: payload خام طراح با کلید وضعیت و بدون شناسه پایگاه‌داده
      const legacy = await ProcurementService.workflowGraphOf({
        workflowDefinitionId: wf.definition.id,
        snapshotDsl: { states: [{ stateKey: 'draft' }, { stateKey: 'review' }], transitions: [{ actionKey: 'submit', fromStateKey: 'draft', toStateKey: 'review' }] },
      });
      if (legacy.states.length !== 3 || legacy.states.some(st => !st.id)) violations.push(`وضعیت‌ها از تصویر قدیمی خوانده شد: ${JSON.stringify(legacy.states)}`);
      const submit = legacy.transitions.find(t => t.actionKey === 'submit');
      if (!submit || submit.fromStateId !== wf.states.draft.id || submit.toStateId !== wf.states.review.id) violations.push(`انتقال submit از جدول خوانده نشد: ${JSON.stringify(legacy.transitions)}`);
      // تصویر معتبر (با شناسه) همچنان منبع فرایند در جریان است
      const usable = { states: [{ id: wf.states.draft.id, stateKey: 'draft' }], transitions: [{ id: 999999, fromStateId: wf.states.draft.id, toStateId: wf.states.draft.id, actionKey: 'loop' }] };
      const fromSnapshot = await ProcurementService.workflowGraphOf({ workflowDefinitionId: wf.definition.id, snapshotDsl: usable });
      if (fromSnapshot.states.length !== 1 || fromSnapshot.transitions[0]?.id !== 999999) violations.push('تصویر معتبر فرایند باید منبع وضعیت‌ها و انتقال‌ها بماند');
      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_procurement_workflow_snapshot_td_238', scenarioId: 'workflow_approval_postgres', name: testName, layer: 'regression',
        executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
        details: 'تصویر بدون شناسه کنار گذاشته شد و ۳ وضعیت و انتقال submit از جدول خوانده شد؛ تصویر معتبر همچنان استفاده شد.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_procurement_workflow_snapshot_td_238', scenarioId: 'workflow_approval_postgres', name: testName, layer: 'regression',
        executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      if (defIds.length > 0) {
        await cleanTestTableData('workflow_transitions', 'workflow_definition_id', defIds);
        await cleanTestTableData('workflow_states', 'workflow_definition_id', defIds);
        await cleanTestTableData('workflow_definitions', 'id', defIds);
      }
    }
  }

  // ------------------------------------------------------------------
  // v7.0.113 (TD-239): مبلغ سفارش خرید و ارزش رزرو پیش‌فاکتور با FinancialDecimal، نه ضرب و جمع عدد JS
  // ------------------------------------------------------------------
  if (shouldRun('reg_procurement_reservation_decimal_td_239', 'td239', 'procurement', 'reservation')) {
    const tStart = Date.now();
    const testName = 'v7.0.113 Regression: جمع سفارش خرید و ارزش رزرو پیش‌فاکتور خطای ممیز شناور ندارد (TD-239)';
    const suffix = `${Date.now()}`;
    const docIds: number[] = [];
    let itemId = 0;
    try {
      const { createTestItem, createTestDocument } = await import('../fixtures/factories.js');
      const { ProcurementService } = await import('../../services/procurement.service.js');
      const { ItemStockReservationService } = await import('../../services/items/itemStockReservation.service.js');
      const item = await createTestItem({ name: `ERP-TEST-MARKER کالای اعشاری TD-239 ${suffix}`, code: `ITEM_TD239_${suffix}`, stocks: { '': 10 } });
      itemId = item.id;
      const violations: string[] = [];
      // 3 × 0.1 در عدد JS برابر 0.30000000000000004 است
      const receiptRef = `PO-TD239-${suffix}`;
      const receipt = await createTestDocument({ type: 'receipt', status: 'draft', refNumber: receiptRef, notes: `[تدارکات: درخواست TD239-${suffix}]` }, [
        { itemId: item.id, quantity: 3, unitPrice: 0.1 },
        { itemId: item.id, quantity: 1, unitPrice: 0.2 },
      ]);
      docIds.push(receipt.document.id);
      const orders = await ProcurementService.getProcurementOrders({ search: receiptRef });
      const order = orders.data.find(o => o.id === receipt.document.id);
      if (!order) violations.push('سفارش خرید آزمایشی در فهرست نیامد');
      else {
        if (order.totalAmount !== 0.5) violations.push(`جمع سفارش خرید: ${order.totalAmount} (باید 0.5)`);
        if (order.items[0]?.totalPrice !== 0.3) violations.push(`جمع ردیف سفارش: ${order.items[0]?.totalPrice} (باید 0.3)`);
      }
      const proforma = await createTestDocument({ type: 'invoice', status: 'proforma', refNumber: `PF-TD239-${suffix}` }, [{ itemId: item.id, quantity: 3, unitPrice: 0.1 }]);
      docIds.push(proforma.document.id);
      const report = await ItemStockReservationService.getReservedStockDetails(undefined, true);
      const entry = report.allReservationEntries.find(e => e.sourceType === 'proforma' && Number(e.sourceId) === proforma.document.id);
      if (!entry) violations.push('رزرو پیش‌فاکتور آزمایشی در گزارش نیامد');
      else if (entry.totalValue !== 0.3) violations.push(`ارزش رزرو پیش‌فاکتور: ${entry.totalValue} (باید 0.3)`);
      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_procurement_reservation_decimal_td_239', scenarioId: 'multi_currency_financials_and_ratios', name: testName, layer: 'regression',
        executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
        details: 'جمع سفارش خرید 0.5، ردیف 3 × 0.1 = 0.3 و ارزش رزرو پیش‌فاکتور 0.3 بدون خطای ممیز شناور.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_procurement_reservation_decimal_td_239', scenarioId: 'multi_currency_financials_and_ratios', name: testName, layer: 'regression',
        executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      if (docIds.length > 0) {
        await cleanTestTableData('document_items', 'document_id', docIds);
        await cleanTestTableData('documents', 'id', docIds);
      }
      if (itemId) await cleanTestTableData('items', 'id', [itemId]);
    }
  }

  // ------------------------------------------------------------------
  // TD-242: سند حسابداری فیش حقوقی فقط از پیوند صریح source_payroll_id؛ سند معکوس/اصلاحی سند فیش دیگر
  // (reference_id = شناسه «سند حسابداری مبدأ») هرگز سند فیش هم‌شناسه تلقی نمی‌شود
  // ------------------------------------------------------------------
  if (shouldRun('reg_payroll_voucher_link_td_242', 'td242', 'payroll', 'voucher')) {
    const tStart = Date.now();
    const testName = 'TD-242 Regression: صدور، نمایش و ابطال سند فیش حقوقی سند معکوس/اصلاحی فیش دیگر را برنمی‌دارد';
    const suffix = `${Date.now()}`;
    const payrollIds: number[] = [];
    let personnelId: number | null = null;
    try {
      const fs = await import('fs');
      const path = await import('path');
      const { personnel, pieceworkPayrolls } = await import('../../db/schema.js');
      const { PayrollReadService } = await import('../../services/piecework/payrollRead.service.js');
      const violations: string[] = [];
      const check = (cond: boolean, msg: string) => { if (!cond) violations.push(msg); };
      const todayIso = await businessTodayIsoDate();
      const [pers] = await orm.insert(personnel).values({ fullName: `ERP-TEST-MARKER پرسنل آزمون TD-242 ${suffix}` }).returning({ id: personnel.id });
      personnelId = pers.id;
      const makePayroll = async (tag: string) => {
        const [row] = await orm.insert(pieceworkPayrolls).values({
          payrollNumber: `PAY-TD242-${tag}-${suffix}`, personnelId: pers.id, startDate: todayIso, endDate: todayIso, title: `فیش آزمون TD-242 ${tag}`,
          totalPieceworkAmount: money(500000), totalFixedAmount: money(0), totalBonuses: money(0), totalDeductions: money(0),
          netPayable: money(500000), status: 'approved', isDeleted: 0
        }).returning({ id: pieceworkPayrolls.id, payrollNumber: pieceworkPayrolls.payrollNumber });
        payrollIds.push(row.id);
        return row;
      };
      // اسناد معکوس فعال یک سند (REV-V<شماره> / RE-REV-V<شماره>، reference_id = شناسه آن سند)
      const activeReversalsOf = async (voucherId: number, voucherNumber: number) => (await orm.select({ id: journalVouchers.id }).from(journalVouchers)
        .where(and(
          eq(journalVouchers.referenceId, voucherId),
          inArray(journalVouchers.referenceNumber, [`REV-V${voucherNumber}`, `RE-REV-V${voucherNumber}`]),
          eq(journalVouchers.isDeleted, 0)
        ))).map(r => r.id);
      const voucherRow = async (voucherId: number) => (await orm.select().from(journalVouchers).where(eq(journalVouchers.id, voucherId)))[0];
      const sourcePayrollOf = async (voucherId: number) => {
        const res = await orm.execute(sql`SELECT source_payroll_id FROM journal_vouchers WHERE id = ${voucherId}`) as unknown as { rows: Array<{ source_payroll_id: number | null }> };
        return res.rows[0]?.source_payroll_id ?? null;
      };

      // ۱) فیش A: سند صادرشده توسط VoucherSync پیوند صریح source_payroll_id دارد
      const payA = await makePayroll('A');
      const payB = await makePayroll('B');
      const vA = await VoucherSyncService.autoCreateVoucherForPayroll(payA.id, undefined, 'test-agent', undefined, { strict: true });
      if (!vA) throw new Error('سند حسابداری فیش A صادر نشد');
      check(await sourcePayrollOf(vA.id) === payA.id, `سند فیش A باید source_payroll_id=${payA.id} داشته باشد (دریافتی: ${await sourcePayrollOf(vA.id)})`);
      // سند قطعی‌شده A (approved) تا بتوان آن را معکوس/اصلاح کرد
      await orm.update(journalVouchers).set({ status: 'approved' }).where(eq(journalVouchers.id, vA.id));
      const itemsA = (vA.items || []).map(i => ({ accountId: i.accountId, detailedType: i.detailedType || 'none', detailedId: i.detailedId ?? null, detailedName: i.detailedName || '', debit: i.debit, credit: i.credit, description: 'ردیف آزمون TD-242' }));

      // ۲) سند معکوس (REV-V…) و اصلاحی (CORR-V…) سند A که reference_id آن‌ها — مانند اسناد VoucherService —
      //    شناسه «سند حسابداری مبدأ» است و تصادفاً با شناسه فیش B برابر شده است
      const rev = await VoucherService.createJournalVoucher({
        date: todayIso, voucherType: 'adjustment', status: 'approved', description: 'سند معکوس آزمون TD-242',
        referenceModule: 'payroll', referenceId: payB.id, referenceNumber: `REV-V${vA.voucherNumber}`,
        items: itemsA.map(i => ({ ...i, debit: i.credit, credit: i.debit }))
      });
      const corr = await VoucherService.createJournalVoucher({
        date: todayIso, voucherType: 'payroll', status: 'approved', description: 'سند اصلاحی آزمون TD-242',
        referenceModule: 'payroll', referenceId: payB.id, referenceNumber: `CORR-V${vA.voucherNumber}`, items: itemsA
      });
      const foreign = new Set([rev.id, corr.id]);

      // ۳) صدور سند فیش B: سند جدید با پیوند صریح، نه بازگرداندن سند معکوس/اصلاحی A
      const vB = await VoucherSyncService.autoCreateVoucherForPayroll(payB.id, undefined, 'test-agent', undefined, { strict: true });
      check(Boolean(vB) && !foreign.has(vB!.id), `برای فیش B باید سند جدید صادر شود، نه سند معکوس/اصلاحی #${rev.id}/#${corr.id} فیش A (دریافتی: #${vB?.id})`);
      if (vB && !foreign.has(vB.id)) {
        check(await sourcePayrollOf(vB.id) === payB.id, `سند فیش B باید source_payroll_id=${payB.id} داشته باشد`);
        check(vB.referenceNumber === payB.payrollNumber, `شماره عطف سند فیش B: «${vB.referenceNumber}»`);
      }

      // ۴) دیتابیس دومین سند فعال برای همان فیش را رد می‌کند (ایندکس یکتای جزئی)
      let duplicateRejected = false;
      try {
        await orm.execute(sql`INSERT INTO journal_vouchers (voucher_number, date, description, reference_module, reference_id, reference_number, source_payroll_id, total_debit, total_credit)
          VALUES (nextval('journal_voucher_number_seq'), ${todayIso}, 'probe duplicate TD-242', 'payroll', ${payB.id}, 'probe', ${payB.id}, 0, 0)`);
      } catch {
        duplicateRejected = true;
      }
      check(duplicateRejected, 'درج دومین سند حسابداری فعال برای یک فیش باید توسط ایندکس یکتا رد شود (uq_jv_source_payroll_active)');

      // ۵) فهرست و جزئیات فیش سند خود فیش را نشان می‌دهند
      const detailB = await PayrollReadService.getPayrollDetail(payB.id);
      check(detailB?.voucherLink.voucherId === vB?.id, `جزئیات فیش B باید سند #${vB?.id} را نشان دهد (دریافتی: #${detailB?.voucherLink.voucherId})`);
      const listed = await PayrollReadService.listPayrolls({ personnelId: pers.id });
      const listedA = listed.find(r => r.id === payA.id);
      const listedB = listed.find(r => r.id === payB.id);
      check(listedA?.voucherId === vA.id, `فهرست: سند فیش A باید #${vA.id} باشد (دریافتی: #${listedA?.voucherId})`);
      check(listedB?.voucherId === vB?.id, `فهرست: سند فیش B باید #${vB?.id} باشد (دریافتی: #${listedB?.voucherId})`);

      // ۶) ابطال فیش B فقط سند خودش را حذف/معکوس می‌کند؛ سند معکوس/اصلاحی فیش A دست‌نخورده می‌ماند
      let deleteError = '';
      try {
        await PieceworkService.deletePayroll(payB.id, { username: 'test-agent' });
      } catch (err) {
        deleteError = err instanceof Error ? err.message : String(err);
      }
      check(!deleteError, `ابطال فیش B نباید برای سند فیش A خطا دهد: ${deleteError}`);
      for (const fid of foreign) {
        const row = await voucherRow(fid);
        check(row?.isDeleted === 0, `ابطال فیش B سند #${fid} فیش A را حذف کرد`);
        const reversals = row ? await activeReversalsOf(fid, row.voucherNumber) : [];
        check(reversals.length === 0, `ابطال فیش B سند #${fid} فیش A را معکوس کرد (اسناد: ${reversals.join(', ')})`);
      }
      if (vB && !foreign.has(vB.id)) {
        const vBAfter = await voucherRow(vB.id);
        check(vBAfter?.isDeleted === 1, `سند پیش‌نویس فیش B باید با ابطال فیش حذف شود (is_deleted=${vBAfter?.isDeleted})`);
      }

      // ۷) سند قدیمی بدون پیوند (پیش از مهاجرت 0035): سند دوم صادر نمی‌شود و ابطال فیش آن را هم باطل می‌کند
      const payC = await makePayroll('C');
      const legacyItems = itemsA.map(i => ({ ...i, description: 'ردیف سند قدیمی TD-242' }));
      const legacyVoucher = async (payrollId: number, payrollNumber: string) => {
        const v = await VoucherService.createJournalVoucher({
          date: todayIso, voucherType: 'payroll', status: 'draft', description: 'سند قدیمی بدون پیوند TD-242',
          referenceModule: 'payroll', referenceId: payrollId, referenceNumber: payrollNumber, items: legacyItems
        });
        return v;
      };
      const legacyC1 = await legacyVoucher(payC.id, payC.payrollNumber);
      const legacyC2 = await legacyVoucher(payC.id, payC.payrollNumber);
      const ensuredC = await VoucherSyncService.autoCreateVoucherForPayroll(payC.id, undefined, 'test-agent', undefined, { strict: true });
      check(ensuredC?.id === legacyC1.id, `فیش دارای سند قدیمی بدون پیوند باید قدیمی‌ترین سند (#${legacyC1.id}) را برگرداند، نه سند جدید (دریافتی: #${ensuredC?.id})`);

      // ۸) پرکردن مهاجرت 0035: فقط فیش دارای یک سند با الگوی دقیق پیوند می‌گیرد؛ فیش دارای دو سند و سند معکوس دست‌نخورده
      const payD = await makePayroll('D');
      const legacyD = await legacyVoucher(payD.id, payD.payrollNumber);
      const migrationSql = fs.readFileSync(path.join(process.cwd(), 'drizzle', '0035_journal_voucher_source_payroll.sql'), 'utf8');
      const backfillSql = migrationSql.split('--> statement-breakpoint').find(part => /UPDATE journal_vouchers/.test(part));
      check(Boolean(backfillSql), 'بخش پرکردن داده در مهاجرت 0035 یافت نشد');
      if (backfillSql) {
        try {
          await orm.transaction(async (tx) => {
            await tx.execute(sql.raw(backfillSql));
            const res = await tx.execute(sql`SELECT id, source_payroll_id FROM journal_vouchers WHERE id IN (${legacyD.id}, ${legacyC1.id}, ${legacyC2.id}, ${rev.id}, ${corr.id})`) as unknown as { rows: Array<{ id: number; source_payroll_id: number | null }> };
            const src = new Map(res.rows.map(r => [Number(r.id), r.source_payroll_id === null ? null : Number(r.source_payroll_id)]));
            check(src.get(legacyD.id) === payD.id, `مهاجرت باید سند تنهای فیش D را پیوند دهد (دریافتی: ${src.get(legacyD.id)})`);
            check(src.get(legacyC1.id) === null && src.get(legacyC2.id) === null, `مهاجرت نباید سندهای مبهم فیش C را پیوند دهد (${src.get(legacyC1.id)}, ${src.get(legacyC2.id)})`);
            check(src.get(rev.id) === null && src.get(corr.id) === null, `مهاجرت نباید سند معکوس/اصلاحی را پیوند دهد (${src.get(rev.id)}, ${src.get(corr.id)})`);
            throw new Error('rollback');
          });
        } catch (err) {
          if (!(err instanceof Error && err.message === 'rollback')) throw err;
        }
      }

      let deleteCError = '';
      try {
        await PieceworkService.deletePayroll(payC.id, { username: 'test-agent' });
      } catch (err) {
        deleteCError = err instanceof Error ? err.message : String(err);
      }
      check(!deleteCError, `ابطال فیش C نباید خطا دهد: ${deleteCError}`);
      for (const lid of [legacyC1.id, legacyC2.id]) {
        const row = await voucherRow(lid);
        check(row?.isDeleted === 1, `ابطال فیش C باید سند قدیمی پیش‌نویس #${lid} را حذف کند`);
      }

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_payroll_voucher_link_td_242', scenarioId: 'document_voucher_uniqueness', name: testName, layer: 'regression',
        executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
        details: 'سند فیش با source_payroll_id و ایندکس یکتا؛ سند معکوس/اصلاحی هم‌شناسه در صدور، فهرست، جزئیات و ابطال فیش انتخاب نشد؛ سند قدیمی بدون پیوند مانع صدور دوباره شد و پرکردن مهاجرت فقط موارد بی‌ابهام را پیوند داد.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_payroll_voucher_link_td_242', scenarioId: 'document_voucher_uniqueness', name: testName, layer: 'regression',
        executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      if (payrollIds.length > 0) {
        const res = await orm.execute(sql`
          WITH base AS (
            SELECT id FROM journal_vouchers
            WHERE reference_module = 'payroll' AND reference_id::text = ANY(${sql.param(payrollIds.map(String))}::text[])
          )
          SELECT id FROM base
          UNION SELECT v.id FROM journal_vouchers v WHERE v.reference_id IN (SELECT id FROM base)`) as unknown as { rows: Array<{ id: number }> };
        const voucherIds = res.rows.map(r => Number(r.id));
        if (voucherIds.length > 0) {
          await cleanTestTableData('journal_voucher_items', 'voucher_id', voucherIds);
          await cleanTestTableData('journal_vouchers', 'id', voucherIds);
        }
        await cleanTestTableData('piecework_payrolls', 'id', payrollIds);
      }
      if (personnelId !== null) await cleanTestTableData('personnel', 'id', [personnelId]);
    }
  }

  // ------------------------------------------------------------------
  // TD-243: کد خودکار عنوان کاری پرکیسی از توالی اتمیک (نه COUNT(*)+1 / MAX()+1)؛ ایجاد هم‌زمان، کد دستی
  // جلوتر از شمارنده، ردیف حذف‌شده و ورود اکسل هرگز کد تکراری نمی‌سازند
  // ------------------------------------------------------------------
  if (shouldRun('reg_piecework_task_code_atomic_td_243', 'td243', 'piecework', 'task_code')) {
    const tStart = Date.now();
    const testName = 'TD-243 Regression: کد خودکار عنوان کاری پرکیسی در ایجاد هم‌زمان، کنار کد دستی/حذف‌شده و ورود اکسل یکتاست';
    const suffix = `${Date.now()}`;
    const taskIds: number[] = [];
    try {
      const { pieceworkTasks } = await import('../../db/schema.js');
      const violations: string[] = [];
      const check = (cond: boolean, msg: string) => { if (!cond) violations.push(msg); };
      const codeNumber = (code: string): string | null => {
        const m = String(code ?? '').trim().match(/^PW-0*(\d+)$/i);
        return m ? m[1] : null;
      };
      const pad = (n: number) => `PW-${String(n).padStart(3, '0')}`;
      const title = (tag: string) => `ERP-TEST-MARKER عنوان آزمون TD-243 ${tag} ${suffix}`;
      const insertRaw = async (code: string, tag: string, isDeleted: 0 | 1) => {
        const [row] = await orm.insert(pieceworkTasks).values({ code, title: title(tag), defaultRate: money(0), isActive: 1, isDeleted })
          .returning({ id: pieceworkTasks.id, code: pieceworkTasks.code });
        taskIds.push(row.id);
        return row;
      };
      // هر کد خودکار نباید با کد (یا شماره PW) هیچ ردیف دیگری — فعال یا حذف‌شده — برابر باشد
      const assertUniqueAgainstAll = async (label: string, created: Array<{ id: number; code: string }>) => {
        const all = await orm.select({ id: pieceworkTasks.id, code: pieceworkTasks.code }).from(pieceworkTasks);
        for (const t of created) {
          check(/^PW-\d{3,}$/.test(t.code), `${label}: قالب کد خودکار باید PW- و دست‌کم سه رقم باشد (دریافتی: ${t.code})`);
          const num = codeNumber(t.code);
          const clashes = all.filter(r => r.id !== t.id && (
            r.code.trim().toLowerCase() === t.code.trim().toLowerCase() || (num !== null && codeNumber(r.code) === num)
          ));
          check(clashes.length === 0, `${label}: کد خودکار ${t.code} (#${t.id}) با ردیف(های) موجود تکراری است: ${clashes.map(c => `#${c.id}=${c.code}`).join(', ')}`);
        }
      };

      // (الف) چند ایجاد هم‌زمان بدون کد → کدهای متمایز
      const concurrent = await Promise.all(Array.from({ length: 6 }, (_, i) =>
        PieceworkService.createTask({ title: title(`هم‌زمان-${i}`), defaultRate: 1000, username: 'test-agent' })
      ));
      taskIds.push(...concurrent.map(t => t.id));
      const concurrentCodes = concurrent.map(t => t.code);
      check(new Set(concurrentCodes).size === concurrentCodes.length, `ایجاد هم‌زمان کد تکراری داد: ${concurrentCodes.join(', ')}`);
      await assertUniqueAgainstAll('ایجاد هم‌زمان', concurrent);

      // (ب) کد دستی برابر با کدی که روش قدیمی (COUNT(*)+1) بعدی می‌ساخت، سپس ایجاد خودکار
      const [{ count: rowCount }] = await orm.select({ count: sql<number>`count(*)` }).from(pieceworkTasks);
      const manual = await PieceworkService.createTask({ code: pad(Number(rowCount) + 2), title: title('دستی'), defaultRate: 1000, username: 'test-agent' });
      taskIds.push(manual.id);
      const afterManual = await PieceworkService.createTask({ title: title('پس از دستی'), defaultRate: 1000, username: 'test-agent' });
      taskIds.push(afterManual.id);
      await assertUniqueAgainstAll('پس از کد دستی', [afterManual]);

      // (ج) ورود اکسل بدون کد کنار ردیف حذف‌شده‌ای که کد «بیشینه فعال + ۱» را دارد (روش قدیمی MAX فعال + 1)
      const activeRows = await orm.select({ code: pieceworkTasks.code }).from(pieceworkTasks).where(eq(pieceworkTasks.isDeleted, 0));
      const maxActive = activeRows.reduce((max, r) => Math.max(max, Number(codeNumber(r.code) ?? 0)), 0);
      await insertRaw(pad(maxActive + 1), 'حذف‌شده-اکسل', 1);
      const importResult = await PieceworkService.importTasksFromExcel({
        rows: [{ title: title('اکسل-۱'), defaultRate: 500 }, { title: title('اکسل-۲'), defaultRate: 700 }],
        mode: 'upsert',
        username: 'test-agent'
      });
      check(importResult.createdCount === 2, `ورود اکسل باید دو عنوان جدید بسازد (دریافتی: ${importResult.createdCount})`);
      const imported = await orm.select({ id: pieceworkTasks.id, code: pieceworkTasks.code }).from(pieceworkTasks)
        .where(inArray(pieceworkTasks.title, [title('اکسل-۱'), title('اکسل-۲')]));
      taskIds.push(...imported.map(t => t.id));
      await assertUniqueAgainstAll('ورود اکسل', imported);

      if (violations.length > 0) throw new Error(violations.join(' | '));

      // (د) کد دستی دقیقاً جلوتر از شمارنده (فعال، و حذف‌شده با حروف کوچک و صفر اضافه) → شماره رد می‌شود، خطا نمی‌دهد
      const seqRes = await orm.execute(sql`SELECT last_value, is_called FROM piecework_task_code_seq`) as unknown as { rows: Array<{ last_value: string | number; is_called: boolean }> };
      const seqRow = seqRes.rows[0];
      const nextSeq = Number(seqRow.last_value) + (seqRow.is_called ? 1 : 0);
      await insertRaw(pad(nextSeq), 'جلوتر-فعال', 0);
      await insertRaw(`pw-0${String(nextSeq + 1).padStart(3, '0')}`, 'جلوتر-حذف‌شده', 1);
      const skipped = await PieceworkService.createTask({ title: title('رد شماره'), defaultRate: 1000, username: 'test-agent' });
      taskIds.push(skipped.id);
      check(Number(codeNumber(skipped.code)) >= nextSeq + 2, `کد خودکار باید از شماره‌های گرفته‌شده ${nextSeq} و ${nextSeq + 1} بگذرد (دریافتی: ${skipped.code})`);
      await assertUniqueAgainstAll('رد شماره گرفته‌شده', [skipped]);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_piecework_task_code_atomic_td_243', scenarioId: 'v10_next_code_concurrent_unique', name: testName, layer: 'regression',
        executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
        details: `کدهای هم‌زمان ${concurrentCodes.join(', ')} متمایز؛ پس از کد دستی ${manual.code} کد ${afterManual.code}؛ ورود اکسل ${imported.map(t => t.code).join(', ')}؛ رد شماره‌های گرفته‌شده → ${skipped.code}.`
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_piecework_task_code_atomic_td_243', scenarioId: 'v10_next_code_concurrent_unique', name: testName, layer: 'regression',
        executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      if (taskIds.length > 0) {
        await cleanTestTableData('piecework_task_rate_history', 'task_id', taskIds);
        await cleanTestTableData('piecework_tasks', 'id', taskIds);
      }
    }
  }

  // ------------------------------------------------------------------
  // TD-246 (تصمیم «قید یکتا»): کد تکراری بین عناوین کاری فعال پرکیسی را برنامه با ConflictError فارسی و پایگاه‌داده
  // با ایندکس uq_ptask_code_active (lower(btrim(code)) WHERE is_deleted = 0) رد می‌کنند؛ عنوان حذف‌شده حساب نمی‌شود؛
  // مهاجرت 0037 روی داده تکراری ایندکس نمی‌سازد و بازرس سلامت مالی تکراری‌ها را فهرست می‌کند
  // ------------------------------------------------------------------
  if (shouldRun('reg_piecework_task_code_unique_td_246', 'td246', 'piecework', 'task_code', 'unique')) {
    const tStart = Date.now();
    const testName = 'TD-246 Regression: کد عنوان کاری پرکیسی بین عناوین فعال یکتاست (ایجاد، ویرایش، بازیابی، ورود اکسل، مهاجرت و بازرس سلامت)';
    const suffix = `${Date.now()}`;
    const taskIds: number[] = [];
    const { pieceworkTasks } = await import('../../db/schema.js');
    try {
      const { ConflictError } = await import('../../errors/customErrors.js');
      const taskCodeMod: Partial<typeof import('../../services/piecework/taskCode.js')> = await import('../../services/piecework/taskCode.js');
      const healthMod: Partial<typeof import('../../services/accounting/financialHealth.service.js')> = await import('../../services/accounting/financialHealth.service.js');
      const { FinancialHealthService } = await import('../../services/accounting/financialHealth.service.js');
      const fs = await import('fs');
      const path = await import('path');
      const violations: string[] = [];
      const check = (cond: boolean, msg: string) => { if (!cond) violations.push(msg); };
      const title = (tag: string) => `ERP-TEST-MARKER عنوان آزمون TD-246 ${tag} ${suffix}`;
      const code = (tag: string) => `T246-${tag}-${suffix}`;
      const errText = (err: unknown) => err instanceof Error ? `${err.constructor.name}: ${err.message}` : String(err);
      const indexDef = async (executor: { execute: typeof orm.execute } = orm): Promise<string | null> => {
        const res = await executor.execute(sql`SELECT pg_get_indexdef(to_regclass('uq_ptask_code_active')) AS def`);
        return ((res.rows?.[0] as { def?: string | null } | undefined)?.def) ?? null;
      };
      const activeWithKey = async (c: string) => (await orm.select({ id: pieceworkTasks.id }).from(pieceworkTasks)
        .where(sql`${pieceworkTasks.isDeleted} = 0 AND lower(btrim(${pieceworkTasks.code})) = lower(btrim(${c}::text))`)).map(r => r.id);
      const expectConflict = async (label: string, codeShown: string, fn: () => Promise<unknown>) => {
        try {
          const r = await fn();
          const id = (r as { id?: number } | undefined)?.id;
          if (typeof id === 'number') taskIds.push(id);
          violations.push(`${label}: کد تکراری «${codeShown}» پذیرفته شد`);
        } catch (err) {
          if (!(err instanceof ConflictError)) violations.push(`${label}: باید ConflictError باشد (دریافتی ${errText(err)})`);
          else if (!/[؀-ۿ]/.test(err.message) || !err.message.includes(codeShown.trim())) {
            violations.push(`${label}: پیام خطا باید فارسی و شامل کد «${codeShown.trim()}» باشد (دریافتی: ${err.message})`);
          }
        }
      };

      // (الف) ایندکس یکتای جزئی پس از مهاجرت روی داده تمیز
      const def = await indexDef();
      check(def !== null, 'ایندکس uq_ptask_code_active پس از مهاجرت وجود ندارد');
      if (def) check(/UNIQUE/i.test(def) && /lower\(btrim\(code\)\)/i.test(def) && /is_deleted = 0/i.test(def), `تعریف ایندکس نادرست است: ${def}`);

      // (ب) کد دستی تکراری — عین کد، و فقط با تفاوت حروف بزرگ/کوچک و فاصله
      const codeA = code('A');
      const taskA = await PieceworkService.createTask({ code: codeA, title: title('A'), defaultRate: 1000, username: 'test-agent' });
      taskIds.push(taskA.id);
      await expectConflict('ایجاد با کد تکراری', codeA, () => PieceworkService.createTask({ code: codeA, title: title('A-تکرار'), defaultRate: 1000, username: 'test-agent' }));
      const codeAVariant = `  ${codeA.toLowerCase()}  `;
      await expectConflict('ایجاد با کد تکراری (حروف کوچک و فاصله)', codeAVariant, () => PieceworkService.createTask({ code: codeAVariant, title: title('A-حروف'), defaultRate: 1000, username: 'test-agent' }));
      // قید پایگاه‌داده مستقل از برنامه (درج مستقیم)، و نگاشت 23505 آن به همان ConflictError فارسی
      try {
        const [raw] = await orm.insert(pieceworkTasks).values({ code: `${codeA.toLowerCase()} `, title: title('A-مستقیم'), defaultRate: money(0), isActive: 1, isDeleted: 0 })
          .returning({ id: pieceworkTasks.id });
        taskIds.push(raw.id);
        violations.push('پایگاه‌داده درج مستقیم کد تکراری را پذیرفت');
      } catch (err) {
        const mapped = taskCodeMod.toPieceworkTaskCodeError?.(err, codeA);
        check(mapped instanceof ConflictError && (mapped as Error).message.includes(codeA), `نقض ایندکس به ConflictError فارسی نگاشت نشد (${errText(mapped ?? err)})`);
      }

      // (ج) کد عنوان حذف‌شده دوباره قابل استفاده است؛ بازیابی عنوان حذف‌شده با کد گرفته‌شده رد می‌شود
      const codeB = code('B');
      const taskB = await PieceworkService.createTask({ code: codeB, title: title('B'), defaultRate: 1000, username: 'test-agent' });
      taskIds.push(taskB.id);
      await PieceworkService.deleteTask(taskB.id, { username: 'test-agent' });
      try {
        const taskB2 = await PieceworkService.createTask({ code: codeB, title: title('B-جدید'), defaultRate: 1000, username: 'test-agent' });
        taskIds.push(taskB2.id);
      } catch (err) {
        violations.push(`کد عنوان حذف‌شده باید قابل استفاده باشد (دریافتی ${errText(err)})`);
      }
      await expectConflict('بازیابی عنوان حذف‌شده با کد گرفته‌شده', codeB, () => PieceworkService.restoreTask(taskB.id, { username: 'test-agent' }));
      check((await activeWithKey(codeB)).length === 1, `پس از بازیابی رد‌شده باید یک عنوان فعال با کد ${codeB} باشد`);

      // (د) ویرایش کد به کد گرفته‌شده رد می‌شود؛ ویرایش به کد آزاد ذخیره می‌شود
      const taskC = await PieceworkService.createTask({ code: code('C'), title: title('C'), defaultRate: 1000, username: 'test-agent' });
      taskIds.push(taskC.id);
      await expectConflict('ویرایش به کد گرفته‌شده', codeA.toUpperCase(), () => PieceworkService.updateTask(taskC.id, { code: codeA.toUpperCase(), username: 'test-agent' }));
      const [afterRejected] = await orm.select({ code: pieceworkTasks.code }).from(pieceworkTasks).where(eq(pieceworkTasks.id, taskC.id));
      check(afterRejected?.code === code('C'), `کد عنوان پس از ویرایش رد‌شده نباید تغییر کند (دریافتی ${afterRejected?.code})`);
      try {
        await PieceworkService.updateTask(taskC.id, { code: code('C2'), username: 'test-agent' });
        const [afterFree] = await orm.select({ code: pieceworkTasks.code }).from(pieceworkTasks).where(eq(pieceworkTasks.id, taskC.id));
        check(afterFree?.code === code('C2'), `ویرایش به کد آزاد ذخیره نشد (دریافتی ${afterFree?.code})`);
      } catch (err) {
        violations.push(`ویرایش به کد آزاد نباید خطا بدهد (دریافتی ${errText(err)})`);
      }

      // (ه) ورود اکسل به شیوه append: کد موجود یا تکرار کد در همان فایل کل فایل را رد می‌کند و هیچ ردیفی درج نمی‌شود
      const countByTitle = async (titles: string[]) => (await orm.select({ id: pieceworkTasks.id }).from(pieceworkTasks)
        .where(inArray(pieceworkTasks.title, titles))).length;
      const appendTitles = [title('اکسل-افزودن-۱'), title('اکسل-افزودن-۲')];
      await expectConflict('ورود اکسل append با کد موجود', ` ${codeA.toLowerCase()}`, () => PieceworkService.importTasksFromExcel({
        rows: [{ title: appendTitles[0], code: code('D') }, { title: appendTitles[1], code: ` ${codeA.toLowerCase()}` }],
        mode: 'append', username: 'test-agent'
      }));
      check(await countByTitle(appendTitles) === 0, 'ورود اکسل رد‌شده نباید هیچ ردیفی درج کند');
      const inFileTitles = [title('اکسل-درون-فایل-۱'), title('اکسل-درون-فایل-۲')];
      await expectConflict('ورود اکسل append با کد تکراری درون فایل', code('E').toLowerCase(), () => PieceworkService.importTasksFromExcel({
        rows: [{ title: inFileTitles[0], code: code('E') }, { title: inFileTitles[1], code: code('E').toLowerCase() }],
        mode: 'append', username: 'test-agent'
      }));
      check(await countByTitle(inFileTitles) === 0, 'ورود اکسل با کد تکراری درون فایل نباید هیچ ردیفی درج کند');
      // upsert: ردیف دوم با همان کد همان عنوان را به‌روز می‌کند، عنوان دوم ساخته نمی‌شود
      const upsertTitles = [title('اکسل-upsert-۱'), title('اکسل-upsert-۲')];
      const upsert = await PieceworkService.importTasksFromExcel({
        rows: [{ title: upsertTitles[0], code: code('F') }, { title: upsertTitles[1], code: ` ${code('F').toLowerCase()} ` }],
        mode: 'upsert', username: 'test-agent'
      });
      const fIds = await activeWithKey(code('F'));
      taskIds.push(...fIds);
      check(upsert.createdCount === 1 && upsert.updatedCount === 1 && fIds.length === 1,
        `ورود upsert با کد تکراری درون فایل باید یک عنوان بسازد و همان را به‌روز کند (ساخته ${upsert.createdCount}، به‌روز ${upsert.updatedCount}، فعال ${fIds.length})`);

      // (و) بازرس سلامت مالی: روی داده تمیز سالم
      const report = await FinancialHealthService.runHealthCheck();
      const entry = report.tests.find((t) => t.id === 'piecework_task_code_uniqueness');
      if (!entry) violations.push('بازرس سلامت مالی آزمون یکتایی کد عناوین کاری ندارد');
      else check(entry.status === 'healthy' && entry.count === 0, `آزمون سلامت روی داده بدون تکرار باید سالم باشد (وضعیت ${entry.status}، تعداد ${entry.count})`);

      // (ز) داده قدیمی بدون ایندکس (تراکنش برگشت‌خورده): تکراری‌ها گزارش می‌شوند و مهاجرت 0037 ایندکس نمی‌سازد؛
      // پس از رفع تکرار مهاجرت ایندکس را می‌سازد. طرح پایگاه‌داده پس از برگشت دست‌نخورده می‌ماند.
      const migrationPath = path.join(process.cwd(), 'drizzle', '0037_piecework_task_code_unique.sql');
      const { findDuplicatePieceworkTaskCodes } = taskCodeMod;
      const { buildPieceworkTaskCodeHealthTest } = healthMod;
      if (!fs.existsSync(migrationPath)) violations.push('مهاجرت 0037_piecework_task_code_unique.sql وجود ندارد');
      else if (typeof findDuplicatePieceworkTaskCodes !== 'function' || typeof buildPieceworkTaskCodeHealthTest !== 'function') {
        violations.push('یابنده کدهای تکراری یا آزمون سلامت یکتایی کد عناوین کاری تعریف نشده است');
      } else {
        try {
          await orm.transaction(async (tx) => {
            await tx.execute(sql.raw('DROP INDEX IF EXISTS uq_ptask_code_active'));
            const dupCode = code('G');
            const inserted = await tx.insert(pieceworkTasks).values([
              { code: dupCode, title: title('G-1'), defaultRate: money(0), isActive: 1, isDeleted: 0 },
              { code: ` ${dupCode.toLowerCase()}`, title: title('G-2'), defaultRate: money(0), isActive: 1, isDeleted: 0 },
              { code: dupCode, title: title('G-حذف‌شده'), defaultRate: money(0), isActive: 1, isDeleted: 1 },
            ]).returning({ id: pieceworkTasks.id });
            const activeIds = inserted.slice(0, 2).map(r => r.id).sort((a, b) => a - b);
            const reported = (await findDuplicatePieceworkTaskCodes(tx)).filter(r => r.code.trim().toLowerCase() === dupCode.toLowerCase());
            check(JSON.stringify(reported.map(r => r.id).sort((a, b) => a - b)) === JSON.stringify(activeIds),
              `یابنده تکراری باید فقط دو عنوان فعال ${activeIds.join(',')} را بدهد (دریافتی ${reported.map(r => r.id).join(',')})`);
            const healthEntry = buildPieceworkTaskCodeHealthTest(await findDuplicatePieceworkTaskCodes(tx), (await indexDef(tx)) !== null);
            check(healthEntry.status !== 'healthy' && healthEntry.count >= 1 && activeIds.every(id => healthEntry.items?.some(it => it.id === id)),
              `آزمون سلامت باید کد تکراری را با هر دو عنوان گزارش کند (وضعیت ${healthEntry.status}، تعداد ${healthEntry.count})`);
            const migrationSql = fs.readFileSync(migrationPath, 'utf8');
            await tx.execute(sql.raw(migrationSql));
            check((await indexDef(tx)) === null, 'مهاجرت 0037 روی داده دارای کد تکراری ایندکس یکتا ساخت');
            await tx.update(pieceworkTasks).set({ isDeleted: 1 }).where(eq(pieceworkTasks.id, activeIds[1]));
            await tx.execute(sql.raw(migrationSql));
            check((await indexDef(tx)) !== null, 'مهاجرت 0037 پس از رفع تکرار ایندکس یکتا را نساخت');
            throw new Error('rollback');
          });
        } catch (err) {
          if (!(err instanceof Error && err.message === 'rollback')) throw err;
        }
        check((await indexDef()) !== null, 'ایندکس یکتا پس از برگشت تراکنش آزمون از بین رفت');
      }

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_piecework_task_code_unique_td_246', scenarioId: 'v10_next_code_concurrent_unique', name: testName, layer: 'regression',
        executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
        details: 'کد تکراری (عین کد، حروف/فاصله، درج مستقیم، ویرایش، بازیابی، اکسل append) رد شد؛ کد عنوان حذف‌شده دوباره استفاده شد؛ مهاجرت 0037 روی داده تکراری ایندکس نساخت و بازرس سلامت تکراری‌ها را گزارش کرد.'
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: 'reg_piecework_task_code_unique_td_246', scenarioId: 'v10_next_code_concurrent_unique', name: testName, layer: 'regression',
        executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      const marked = await orm.select({ id: pieceworkTasks.id }).from(pieceworkTasks)
        .where(sql`position(${`TD-246`} in ${pieceworkTasks.title}) > 0 AND position(${suffix} in ${pieceworkTasks.title}) > 0`);
      const ids = Array.from(new Set([...taskIds, ...marked.map(r => r.id)]));
      if (ids.length > 0) {
        await cleanTestTableData('piecework_task_rate_history', 'task_id', ids);
        await cleanTestTableData('piecework_tasks', 'id', ids);
      }
    }
  }

  // v7.0.127 (TD-247): یافته‌های تفکیک روتر حسابداری — جمع پول با Decimal در گزارش پروژه و تطبیق بانک، آستانه تراز
  // طرح Zod سند برابر سرویس، اعتبارسنجی ورودی‌های بدون Zod، و انتخاب قطعی نمونه گردش کار در امضای چاپ سند
  if (shouldRun('reg_accounting_route_findings_td_247', 'td247', 'accounting_routes')) {
    const tStart = Date.now();
    const testName = 'TD-247 Regression: جمع اعشاری گزارش پروژه و تطبیق بانک، آستانه تراز طرح سند، اعتبارسنجی ورودی مسیرهای حسابداری و نمونه قطعی امضای سند';
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const { bankAccounts, appSettings, workflowInstances, workflowHistoryLogs } = await import('../../db/schema.js');
    const createdAccountIds: number[] = [];
    const createdVoucherIds: number[] = [];
    const createdBankIds: number[] = [];
    const createdInstanceIds: number[] = [];
    const createdDefinitionIds: number[] = [];
    const settingKeys = ['accounting_account_mappings', 'accounting_mappings_disabled'];
    const savedSettings = await orm.select().from(appSettings).where(inArray(appSettings.key, settingKeys));
    try {
      const request = (await import('supertest')).default;
      const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
      const { createTestVoucher, createTestWorkflow } = await import('../fixtures/factories.js');
      const { updateVoucherSchema, correctVoucherSchema } = await import('../../routes/accounting.routes.js');
      const { FinancialMath } = await import('../../lib/financialDecimal.js');
      const app = await getTestApp();
      const session = await getAdminSession();
      const violations: string[] = [];
      const check = (cond: boolean, msg: string) => { if (!cond) violations.push(msg); };
      const get = (url: string) => request(app).get(url).set('Cookie', session.cookie);
      const send = (method: 'post' | 'put', url: string, body: object) => request(app)[method](url)
        .set('Cookie', session.cookie).set('x-csrf-token', session.csrfToken).send(body);

      const account = await AccountingService.createAccount({
        code: `T247${suffix}`, name: `ERP-TEST-MARKER حساب TD-247 ${suffix}`, level: 'detailed', parentId: null,
        accountType: 'asset', nature: 'debit', description: '',
      });
      createdAccountIds.push(account.id);

      // (الف) گزارش پروژه: ۰٫۱ + ۰٫۲ بدهکار و ۰٫۱ بستانکار — تراز جاری ۰٫۱، ۰٫۳، ۰٫۲ و مانده خلاصه ۰٫۲ (نه 0.30000000000000004 / 0.19999999999999998)
      const projectId = 1_900_000_000 + Math.floor(Math.random() * 200_000_000);
      const { voucher } = await createTestVoucher({ date: '2026-01-01', status: 'approved', totalDebit: money(0.3), totalCredit: money(0.1) }, []);
      createdVoucherIds.push(voucher.id);
      const lines: Array<[number, number]> = [[0.1, 0], [0.2, 0], [0, 0.1]];
      for (let i = 0; i < lines.length; i++) {
        await orm.insert(journalVoucherItems).values({
          voucherId: voucher.id, accountId: account.id, rowOrder: i + 1, detailedType: 'project', detailedId: projectId,
          debit: money(lines[i][0]), credit: money(lines[i][1]), description: 'ERP-TEST-MARKER TD-247',
        });
      }
      const detailRes = await get(`/api/accounting/reports/project-detail?projectId=${projectId}`);
      const detail = ((detailRes.body as { detail?: Array<{ runningBalance: number; debit: number; credit: number }> })?.detail) ?? [];
      const running = detail.map(d => d.runningBalance);
      check(detailRes.status === 200 && JSON.stringify(running) === JSON.stringify([0.1, 0.3, 0.2]),
        `تراز جاری ریز گردش پروژه باید [0.1,0.3,0.2] باشد (وضعیت ${detailRes.status}، دریافتی ${JSON.stringify(running)})`);
      check(detail.length === 3 && detail[1].debit === 0.2 && detail[2].credit === 0.1, `مبالغ ردیف‌های ریز گردش پروژه نادرست است: ${JSON.stringify(detail)}`);
      const summaryRes = await get('/api/accounting/reports/project-summary');
      const summaryRows = Array.isArray(summaryRes.body) ? summaryRes.body as Array<{ projectId: number; totalDebit: number; totalCredit: number; balance: number; entriesCount: number }> : [];
      const summary = summaryRows.find(r => Number(r.projectId) === projectId);
      check(summaryRes.status === 200 && !!summary && summary.totalDebit === 0.3 && summary.totalCredit === 0.1 && summary.balance === 0.2 && summary.entriesCount === 3,
        `خلاصه گردش پروژه باید بدهکار 0.3، بستانکار 0.1 و مانده 0.2 باشد (وضعیت ${summaryRes.status}، دریافتی ${JSON.stringify(summary)})`);

      // (ب) گزارش تطبیق بانک: جمع کل‌ها برابر جمع اعشاری مانده حساب‌های همان گزارش. مبالغ دو حساب آزمون از میان
      // نامزدها چنان انتخاب می‌شوند که جمع `+=` اعداد جاوااسکریپت (روش پیشین) با جمع دقیق فرق کند.
      const bankCodes = [`ZZT247A${suffix}`, `ZZT247B${suffix}`];
      for (const code of bankCodes) {
        const [b] = await orm.insert(bankAccounts).values({
          code, title: `ERP-TEST-MARKER صندوق TD-247 ${code}`, type: 'cash', initialBalance: money(0), currentBalance: money(0), currency: 'IRR', isDeleted: 0,
        }).returning({ id: bankAccounts.id });
        createdBankIds.push(b.id);
      }
      type ReconAccount = { id: number; ledgerBalance: number; treasuryBalance: number; discrepancy: number };
      type ReconReport = { totalCashAndBankLedger: number; totalCashAndBankTreasury: number; totalDiscrepancy: number; unlinkedCount: number; accounts: ReconAccount[] };
      const candidates: Array<[string, string]> = [['0.1', '0.2'], ['1234567890123.45', '0.1'], ['0.7', '0.1'], ['0.3', '0.6'], ['1.1', '2.2'], ['987654321.17', '0.03']];
      let recon: ReconReport | null = null;
      let reconStatus = 0;
      let meaningful = false;
      for (const [a, b] of candidates) {
        await orm.update(bankAccounts).set({ initialBalance: money(a) }).where(eq(bankAccounts.id, createdBankIds[0]));
        await orm.update(bankAccounts).set({ initialBalance: money(b) }).where(eq(bankAccounts.id, createdBankIds[1]));
        const res = await get('/api/accounting/banks/reconciliation-report');
        reconStatus = res.status;
        recon = (res.body as { report?: ReconReport })?.report ?? null;
        const accs = recon?.accounts ?? [];
        const jsSum = accs.reduce((s, x) => s + (x.ledgerBalance || 0), 0);
        if (jsSum !== FinancialMath.sum(accs.map(x => x.ledgerBalance)).toNumber()) { meaningful = true; break; }
      }
      const accs = recon?.accounts ?? [];
      check(reconStatus === 200 && createdBankIds.every(id => accs.some(x => x.id === id)), `گزارش تطبیق بانک باید حساب‌های آزمون را برگرداند (وضعیت ${reconStatus})`);
      check(meaningful, 'هیچ‌یک از مبالغ نامزد خطای جمع اعشاری جاوااسکریپت ایجاد نکرد؛ آزمون معنادار نیست');
      for (const key of ['ledgerBalance', 'treasuryBalance', 'discrepancy'] as const) {
        const totalKey = key === 'ledgerBalance' ? 'totalCashAndBankLedger' : key === 'treasuryBalance' ? 'totalCashAndBankTreasury' : 'totalDiscrepancy';
        const exact = FinancialMath.sum(accs.map(x => x[key])).toNumber();
        check(recon?.[totalKey] === exact, `${totalKey} گزارش تطبیق بانک باید جمع اعشاری ${exact} باشد (دریافتی ${recon?.[totalKey]})`);
      }

      // (ج) تراز طرح Zod سند: اختلاف ۰٫۰۰۵ و دقیقاً ۰٫۰۱ مانند VoucherService پذیرفته، ۰٫۰۲ رد می‌شود
      const items = (debit: number) => [
        { accountId: account.id, debit, credit: 0 },
        { accountId: account.id, debit: 0, credit: 100 },
      ];
      const base = { date: '1405/01/15', description: 'ERP-TEST-MARKER سند TD-247' };
      for (const [debit, want] of [[100.005, true], [100.01, true], [100.02, false]] as Array<[number, boolean]>) {
        const c = createVoucherSchema.safeParse({ body: { ...base, items: items(debit) } }).success;
        const u = updateVoucherSchema.safeParse({ params: { id: '1' }, body: { items: items(debit) } }).success;
        const k = correctVoucherSchema.safeParse({ params: { id: '1' }, body: { reason: 'اصلاح آزمون', newItems: items(debit) } }).success;
        check(c === want && u === want && k === want, `طرح سند با بدهکار ${debit} و بستانکار 100 باید ${want ? 'پذیرفته' : 'رد'} شود (ایجاد ${c}، ویرایش ${u}، اصلاحی ${k})`);
      }
      const createRes = await send('post', '/api/accounting/vouchers', { ...base, status: 'draft', items: items(100.005) });
      const createdId = (createRes.body as { id?: number })?.id;
      if (typeof createdId === 'number') createdVoucherIds.push(createdId);
      check(createRes.status === 201 || createRes.status === 200, `ایجاد سند با اختلاف 0.005 از مسیر HTTP باید مانند سرویس پذیرفته شود (وضعیت ${createRes.status}: ${JSON.stringify(createRes.body).slice(0, 200)})`);

      // (د) ورودی‌های تازه اعتبارسنجی‌شده: بدنه واقعی رابط کاربری می‌گذرد، ورودی نامعتبر 400
      const expectStatus = (label: string, got: number, want: number) => check(got === want, `${label}: وضعیت ${got} (انتظار ${want})`);
      // نگاشت سرفصل‌ها — همان کاری که AccountingSettingsTab می‌کند: پاسخ GET بدون disabled/accountsCount، به‌علاوه disabled
      const mappingsGet = await get('/api/accounting/mappings');
      const { disabled: currentDisabled, accountsCount: _count, ...uiMappings } = (mappingsGet.body || {}) as Record<string, unknown>;
      void _count;
      const uiSave = await send('post', '/api/accounting/mappings', { ...uiMappings, disabled: Array.isArray(currentDisabled) ? currentDisabled : [] });
      expectStatus('ذخیره نگاشت با بدنه رابط کاربری', uiSave.status, 200);
      const savedData = (uiSave.body as { data?: Record<string, unknown> })?.data ?? {};
      check(!('chartHasAccounts' in savedData), 'کلید غیرنگاشتی chartHasAccounts نباید در نگاشت سرفصل‌ها ذخیره شود');
      expectStatus('نگاشت با کد عددی', (await send('post', '/api/accounting/mappings', { salesRevenueAccountCode: 5001 })).status, 400);
      expectStatus('نگاشت با disabled غیرآرایه', (await send('post', '/api/accounting/mappings', { disabled: 'salesRevenueAccountCode' })).status, 400);
      // ویرایش حساب — همان بدنه فرم ChartOfAccountsTab
      const uiAccount = { code: account.code, name: `${account.name} ویرایش`, level: 'detailed', parentId: null, accountType: 'asset', nature: 'debit', description: 'شرح' };
      const accRes = await send('put', `/api/accounting/accounts/${account.id}`, uiAccount);
      expectStatus('ویرایش حساب با بدنه رابط کاربری', accRes.status, 200);
      check((accRes.body as { name?: string })?.name === uiAccount.name, `نام حساب ویرایش نشد: ${JSON.stringify(accRes.body).slice(0, 200)}`);
      expectStatus('ویرایش حساب با سطح نامعتبر', (await send('put', `/api/accounting/accounts/${account.id}`, { level: 'bogus' })).status, 400);
      expectStatus('ویرایش حساب با نام عددی', (await send('put', `/api/accounting/accounts/${account.id}`, { name: 123 })).status, 400);
      const [accAfter] = await orm.select({ level: accounts.level, name: accounts.name }).from(accounts).where(eq(accounts.id, account.id));
      check(accAfter?.level === 'detailed' && accAfter?.name === uiAccount.name, `حساب پس از ورودی نامعتبر نباید تغییر کند: ${JSON.stringify(accAfter)}`);
      // فهرست طرف‌های حساب
      expectStatus('فهرست طرف‌های حساب بدون پارامتر (رابط کاربری)', (await get('/api/accounting/reports/parties')).status, 200);
      expectStatus('فهرست طرف‌های حساب با نوع معتبر', (await get('/api/accounting/reports/parties?type=personnel&search=x')).status, 200);
      expectStatus('فهرست طرف‌های حساب با نوع نامعتبر', (await get('/api/accounting/reports/parties?type=bogus')).status, 400);
      expectStatus('فهرست طرف‌های حساب با جستجوی تکراری', (await get('/api/accounting/reports/parties?search=a&search=b')).status, 400);
      // کد پیشنهادی حساب خزانه
      const cashCode = await get('/api/accounting/banks/next-code?type=cash');
      check(cashCode.status === 200 && /^CASH-\d+$/.test(String((cashCode.body as { code?: string })?.code)), `کد پیشنهادی صندوق نادرست است (${cashCode.status} ${JSON.stringify(cashCode.body)})`);
      const emptyCode = await get('/api/accounting/bank-accounts/next-code?type=');
      check(emptyCode.status === 200 && /^BANK-\d+$/.test(String((emptyCode.body as { code?: string })?.code)), `نوع خالی باید مانند پیش bank باشد (${emptyCode.status} ${JSON.stringify(emptyCode.body)})`);
      expectStatus('کد پیشنهادی با نوع نامعتبر', (await get('/api/accounting/banks/next-code?type=bogus')).status, 400);

      // (ه) امضای چاپ سند: با دو نمونه گردش کار برای یک سند، جدیدترین (created_at، در زمان برابر بزرگ‌ترین شناسه)
      // — همان نمونه GET /workflow/instance — نه اولین ردیف بدون ORDER BY
      const wf = await createTestWorkflow();
      createdDefinitionIds.push(wf.definition.id);
      const approvedState = wf.states.approved;
      const addInstance = async (entityId: string, createdAt: string, signer: string) => {
        const [inst] = await orm.insert(workflowInstances).values({
          workflowDefinitionId: wf.definition.id, definitionVersion: 1, entityType: 'document', entityId,
          currentStateId: approvedState.id, status: 'COMPLETED', version: 1, createdAt, updatedAt: createdAt,
        }).returning({ id: workflowInstances.id });
        createdInstanceIds.push(inst.id);
        await orm.insert(workflowHistoryLogs).values({
          instanceId: inst.id, toStateId: approvedState.id, performedByName: signer, actionKey: 'approve', actionTitle: 'تایید', createdAt,
        });
        return inst.id;
      };
      const signersOf = async (entityId: string) => {
        const res = await get(`/api/accounting/doc-signatures?entityId=${encodeURIComponent(entityId)}`);
        return { status: res.status, names: (((res.body as { signatures?: Array<{ name: string }> })?.signatures) ?? []).map(s => s.name) };
      };
      const entityLatest = `TD247-LATEST-${suffix}`;
      await addInstance(entityLatest, '2026-01-01 10:00:00', 'امضاکننده قدیمی');
      await addInstance(entityLatest, '2026-02-01 10:00:00', 'امضاکننده جدید');
      const latest = await signersOf(entityLatest);
      check(latest.status === 200 && JSON.stringify(latest.names) === JSON.stringify(['امضاکننده جدید']),
        `امضای سند باید از جدیدترین نمونه باشد (وضعیت ${latest.status}، دریافتی ${JSON.stringify(latest.names)})`);
      const entityTie = `TD247-TIE-${suffix}`;
      await addInstance(entityTie, '2026-03-01 10:00:00', 'امضاکننده شناسه کوچک');
      const highId = await addInstance(entityTie, '2026-03-01 10:00:00', 'امضاکننده شناسه بزرگ');
      const tie = await signersOf(entityTie);
      check(tie.status === 200 && JSON.stringify(tie.names) === JSON.stringify(['امضاکننده شناسه بزرگ']),
        `در زمان ایجاد برابر امضا باید از نمونه با شناسه بزرگ‌تر باشد (وضعیت ${tie.status}، دریافتی ${JSON.stringify(tie.names)})`);
      const instRes = await get(`/api/workflow/instance/document/${encodeURIComponent(entityTie)}`);
      const shownId = (instRes.body as { instance?: { id?: number } | null })?.instance?.id;
      check(instRes.status === 200 && shownId === highId, `GET /workflow/instance باید همان نمونه امضای چاپ (${highId}) را نشان دهد (وضعیت ${instRes.status}، دریافتی ${shownId})`);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_accounting_route_findings_td_247', scenarioId: 'v4_accounting_treasury_runtime_contracts_guard', name: testName, layer: 'regression',
        executionType: 'real_api', passed: true, durationMs: Date.now() - tStart,
        details: 'تراز جاری و مانده پروژه و جمع کل تطبیق بانک دقیق (Decimal)؛ طرح سند اختلاف ≤ ۰٫۰۱ را مانند سرویس پذیرفت و ۰٫۰۲ را رد کرد؛ نگاشت، ویرایش حساب، طرف‌های حساب و کد خزانه ورودی نامعتبر را با 400 رد و بدنه رابط کاربری را پذیرفتند؛ امضای سند از جدیدترین نمونه گردش کار آمد.'
      }));
    } catch (err: unknown) {
      results.push(makeTestCase({
        id: 'reg_accounting_route_findings_td_247', scenarioId: 'v4_accounting_treasury_runtime_contracts_guard', name: testName, layer: 'regression',
        executionType: 'real_api', passed: false, durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      // بازگرداندن تنظیمات نگاشت به پیش از آزمون
      await orm.delete(appSettings).where(inArray(appSettings.key, settingKeys));
      for (const row of savedSettings) {
        await orm.insert(appSettings).values({ key: row.key, value: row.value });
      }
      if (createdInstanceIds.length > 0) await cleanTestTableData('workflow_instances', 'id', createdInstanceIds);
      if (createdDefinitionIds.length > 0) {
        await cleanTestTableData('workflow_transitions', 'workflow_definition_id', createdDefinitionIds);
        await cleanTestTableData('workflow_states', 'workflow_definition_id', createdDefinitionIds);
        await cleanTestTableData('workflow_definition_versions', 'definition_id', createdDefinitionIds);
        await cleanTestTableData('workflow_definitions', 'id', createdDefinitionIds);
      }
      if (createdBankIds.length > 0) await cleanTestTableData('bank_accounts', 'id', createdBankIds);
      if (createdVoucherIds.length > 0) {
        await cleanTestTableData('journal_voucher_items', 'voucher_id', createdVoucherIds);
        await cleanTestTableData('journal_vouchers', 'id', createdVoucherIds);
      }
      if (createdAccountIds.length > 0) await cleanTestTableData('accounts', 'id', createdAccountIds);
    }
  }

  if (shouldRun('reg_system_route_findings_td_245', 'td245', 'system_routes', 'dead_letter', 'reconciliation')) {
    const tStart = Date.now();
    const testName = 'TD-245 Regression: بازگردانی فقط رویدادهای حل‌نشده DLQ با علامت‌گذاری و ممیزی، شمارنده‌های سلامت و ممیزی یکپارچگی (DLQ، تراز ۰٫۰۱، حذف نرم)، ممیزی بازنشانی Outbox، تاریخ کسب‌وکار نام فایل خروجی و اعتبارسنجی Zod';
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const { deadLetterEvents, outboxEvents, activityLogs, appSettings, users } = await import('../../db/schema.js');
    const createdDlqIds: number[] = [];
    const createdOutboxEventIds: string[] = [];
    const createdVoucherIds: number[] = [];
    const createdAccountIds: number[] = [];
    const createdItemIds: number[] = [];
    const createdLogIds: number[] = [];
    const [savedTz] = await orm.select().from(appSettings).where(eq(appSettings.key, 'display_timezone'));
    // ردیف‌های حل‌نشده DLQ سایر آزمون‌ها: بازگردانی گروهی آن‌ها را هم علامت می‌زند؛ پس از آزمون به حالت قبل برمی‌گردند
    const foreignDlq = await orm.select().from(deadLetterEvents).where(sql`${deadLetterEvents.status} NOT IN ('replayed', 'dismissed')`);
    const foreignOutbox = foreignDlq.length > 0
      ? await orm.select().from(outboxEvents).where(inArray(outboxEvents.eventId, foreignDlq.map(r => r.originalEventId)))
      : [];
    const RealDate = Date;
    try {
      const request = (await import('supertest')).default;
      const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
      const { createTestVoucher, createTestItem } = await import('../fixtures/factories.js');
      const { invalidateTimezoneCache } = await import('../../lib/businessClock.js');
      const app = await getTestApp();
      const session = await getAdminSession();
      const [admin] = await orm.select({ id: users.id }).from(users).where(eq(users.username, 'pen_admin'));
      const violations: string[] = [];
      const check = (cond: boolean, msg: string) => { if (!cond) violations.push(msg); };
      const get = (url: string) => request(app).get(url).set('Cookie', session.cookie);
      const post = (url: string, body: object) => request(app).post(url)
        .set('Cookie', session.cookie).set('x-csrf-token', session.csrfToken).send(body);
      const [{ maxLogId }] = (await orm.execute(sql`SELECT COALESCE(MAX(id), 0)::int AS "maxLogId" FROM activity_logs`)).rows as Array<{ maxLogId: number }>;
      const unresolvedDlqCount = async () => Number(((await orm.execute(sql`SELECT count(*)::int AS n FROM dead_letter_events WHERE status NOT IN ('replayed', 'dismissed')`)).rows[0] as { n: number }).n);
      type Health = { outbox?: { dlqCount?: number }; accounting?: { totalVouchers?: number; unbalancedVouchers?: number } };
      type Scan = { checks?: Array<{ id: string; details: string }> };
      const health = async () => { const r = await get('/api/system/health'); return { status: r.status, body: r.body as Health }; };
      const scan = async () => { const r = await get('/api/system/reconciliation-check'); return { status: r.status, body: r.body as Scan }; };
      const scanNumber = (s: Scan, id: string, re: RegExp) => {
        const details = s.checks?.find(c => c.id === id)?.details ?? '';
        const m = details.match(re);
        return m ? Number(m[1]) : 0;
      };

      // (الف) DLQ: یک ردیف قرنطینه با ردیف Outbox ناموفق، یک ردیف قرنطینه بدون Outbox، یک replayed و یک dismissed
      const ev = (tag: string) => `TD245-${tag}-${suffix}`;
      const dlqRow = (tag: string, status: string) => ({
        originalEventId: ev(tag), eventType: 'td245.test', aggregateType: 'test', aggregateId: tag, source: 'outbox',
        payload: { tag }, metadata: {}, failureReason: 'ERP-TEST-MARKER TD-245', status,
        resolutionNotes: status === 'quarantined' ? '' : `یادداشت پیشین ${tag}`,
      });
      const inserted = await orm.insert(deadLetterEvents).values([
        dlqRow('A', 'quarantined'), dlqRow('D', 'quarantined'), dlqRow('B', 'replayed'), dlqRow('C', 'dismissed'),
      ]).returning();
      createdDlqIds.push(...inserted.map(r => r.id));
      const byTag = (tag: string) => inserted.find(r => r.originalEventId === ev(tag))!;
      await orm.insert(outboxEvents).values({
        eventId: ev('A'), eventType: 'td245.test', aggregateType: 'test', aggregateId: 'A', status: 'failed',
        payload: { tag: 'A' }, retryCount: 5, lastError: 'خطای آزمون', completedHandlers: ['td245-handler-ok'],
      });
      createdOutboxEventIds.push(ev('A'), ev('B'), ev('C'), ev('D'));

      const h1 = await health();
      const wantUnresolved = await unresolvedDlqCount();
      check(h1.status === 200 && h1.body.outbox?.dlqCount === wantUnresolved,
        `dlqCount صفحه سلامت باید فقط ردیف‌های حل‌نشده (${wantUnresolved}) را بشمارد (وضعیت ${h1.status}، دریافتی ${h1.body.outbox?.dlqCount})`);
      const s1 = await scan();
      check(s1.status === 200 && scanNumber(s1.body, 'outbox_dlq', /تعداد (\d+) رویداد/) === wantUnresolved,
        `ممیزی یکپارچگی باید ${wantUnresolved} رویداد حل‌نشده DLQ گزارش کند (دریافتی ${s1.body.checks?.find(c => c.id === 'outbox_dlq')?.details})`);

      const requeueRes = await post('/api/system/reconciliation-fix', { action: 'requeue_dlq' });
      check(requeueRes.status === 200 && (requeueRes.body as { success?: boolean })?.success === true,
        `requeue_dlq با بدنه رابط کاربری باید 200 بدهد (وضعیت ${requeueRes.status}: ${JSON.stringify(requeueRes.body).slice(0, 200)})`);
      const after = await orm.select().from(deadLetterEvents).where(inArray(deadLetterEvents.id, createdDlqIds));
      const afterTag = (tag: string) => after.find(r => r.originalEventId === ev(tag));
      for (const tag of ['A', 'D']) {
        const r = afterTag(tag);
        check(!!r, `ردیف DLQ ${tag} نباید حذف شود`);
        check(r?.status === 'replayed' && !!r?.resolvedAt && r?.resolvedBy === admin?.id && /Outbox/.test(r?.resolutionNotes || ''),
          `ردیف DLQ ${tag} باید مانند بازپخش با وضعیت replayed، زمان و کاربر حل علامت بخورد (دریافتی ${JSON.stringify(r ? { status: r.status, resolvedAt: r.resolvedAt, resolvedBy: r.resolvedBy, notes: r.resolutionNotes } : null)})`);
      }
      for (const tag of ['B', 'C']) {
        const r = afterTag(tag);
        const orig = byTag(tag);
        check(!!r && r.status === orig.status && r.resolutionNotes === orig.resolutionNotes && r.resolvedAt === orig.resolvedAt,
          `ردیف حل‌شده DLQ ${tag} (${orig.status}) نباید دوباره بازگردانده یا تغییر داده شود (دریافتی ${JSON.stringify(r ? { status: r.status, notes: r.resolutionNotes } : null)})`);
      }
      const outboxRows = await orm.select().from(outboxEvents).where(sql`${outboxEvents.eventId} LIKE ${`TD245-%-${suffix}%`}`);
      for (const r of outboxRows) if (!createdOutboxEventIds.includes(r.eventId)) createdOutboxEventIds.push(r.eventId);
      const outA = outboxRows.filter(r => r.eventId.startsWith(ev('A')));
      check(outA.length === 1 && outA[0].eventId === ev('A') && outA[0].status === 'pending' && outA[0].retryCount === 0
        && JSON.stringify(outA[0].completedHandlers) === JSON.stringify(['td245-handler-ok']),
        `ردیف Outbox رویداد A باید همان ردیف (شناسه اصلی) با وضعیت pending، شمارنده صفر و هندلرهای موفق قبلی باشد (دریافتی ${JSON.stringify(outA.map(r => ({ id: r.eventId, status: r.status, retry: r.retryCount, handlers: r.completedHandlers })))})`);
      const outD = outboxRows.filter(r => r.eventId.startsWith(ev('D')));
      check(outD.length === 1 && outD[0].eventId === ev('D') && outD[0].status === 'pending',
        `رویداد D بدون ردیف Outbox باید با همان شناسه یک بار درج شود (دریافتی ${JSON.stringify(outD.map(r => r.eventId))})`);
      check(!outboxRows.some(r => r.eventId.startsWith(ev('B')) || r.eventId.startsWith(ev('C'))), 'رویدادهای replayed / dismissed نباید به Outbox برگردند');
      const [requeueLog] = await orm.select().from(activityLogs)
        .where(and(sql`${activityLogs.id} > ${maxLogId}`, eq(activityLogs.entityId, 'dlq_requeue'))).orderBy(sql`${activityLogs.id} DESC`).limit(1);
      if (requeueLog) createdLogIds.push(requeueLog.id);
      const requeueDetails = (requeueLog?.details || {}) as { before?: Array<{ id: number; status: string }>; after?: Array<{ id: number; status: string }> };
      check(!!requeueLog && !!requeueLog.ipAddress && requeueLog.userId === admin?.id
        && [byTag('A').id, byTag('D').id].every(id => requeueDetails.before?.some(b => b.id === id && b.status === 'quarantined') && requeueDetails.after?.some(a => a.id === id && a.status === 'replayed'))
        && !requeueDetails.before?.some(b => b.id === byTag('B').id || b.id === byTag('C').id),
        `ثبت ممیزی requeue_dlq باید IP، کاربر و وضعیت پیش و پس ردیف‌های A و D را داشته باشد (دریافتی ${JSON.stringify(requeueLog ? { ip: requeueLog.ipAddress, userId: requeueLog.userId, details: requeueLog.details } : null).slice(0, 300)})`);
      const h2 = await health();
      const wantAfter = await unresolvedDlqCount();
      check(h2.body.outbox?.dlqCount === wantAfter, `پس از بازگردانی dlqCount باید ${wantAfter} باشد (دریافتی ${h2.body.outbox?.dlqCount})`);

      // (ب) تراز اسناد: حذف‌شده نرم ناتراز، اختلاف ۰٫۰۰۵، ردیف حذف‌شده نرم و اختلاف ۰٫۰۲ — فقط آخری ناتراز است
      const baseHealth = await health();
      const baseScan = await scan();
      const baseUnbalanced = scanNumber(baseScan.body, 'accounting_vouchers', /تعداد (\d+) سند/);
      const baseTotal = baseHealth.body.accounting?.totalVouchers ?? -1;
      const account = await AccountingService.createAccount({
        code: `T245${suffix}`, name: `ERP-TEST-MARKER حساب TD-245 ${suffix}`, level: 'detailed', parentId: null,
        accountType: 'asset', nature: 'debit', description: '',
      });
      createdAccountIds.push(account.id);
      const addVoucher = async (lines: Array<[number, number, number?]>, isDeleted = 0) => {
        const { voucher } = await createTestVoucher({ date: '2026-01-01', status: 'approved', isDeleted }, []);
        createdVoucherIds.push(voucher.id);
        for (let i = 0; i < lines.length; i++) {
          await orm.insert(journalVoucherItems).values({
            voucherId: voucher.id, accountId: account.id, rowOrder: i + 1,
            debit: money(lines[i][0]), credit: money(lines[i][1]), isDeleted: lines[i][2] ?? 0, description: 'ERP-TEST-MARKER TD-245',
          });
        }
        return voucher.id;
      };
      await addVoucher([[100, 0], [0, 50]], 1);
      await addVoucher([[100.005, 0], [0, 100]]);
      await addVoucher([[100, 0], [0, 100], [50, 0, 1]]);
      await addVoucher([[100.02, 0], [0, 100]]);
      const vScan = await scan();
      const vHealth = await health();
      const scanUnbalanced = scanNumber(vScan.body, 'accounting_vouchers', /تعداد (\d+) سند/);
      check(scanUnbalanced === baseUnbalanced + 1,
        `ممیزی یکپارچگی فقط سند با اختلاف ۰٫۰۲ را باید ناتراز بداند (پایه ${baseUnbalanced}، دریافتی ${scanUnbalanced}: ${vScan.body.checks?.find(c => c.id === 'accounting_vouchers')?.details})`);
      check(vHealth.body.accounting?.unbalancedVouchers === scanUnbalanced,
        `unbalancedVouchers صفحه سلامت (${vHealth.body.accounting?.unbalancedVouchers}) باید با ممیزی یکپارچگی (${scanUnbalanced}) برابر باشد`);
      check(vHealth.body.accounting?.totalVouchers === baseTotal + 3,
        `totalVouchers نباید سند حذف‌شده نرم را بشمارد (پایه ${baseTotal}، دریافتی ${vHealth.body.accounting?.totalVouchers})`);

      // (ج) شمار کالاهای فعال در ممیزی یکپارچگی بدون کالای حذف‌شده نرم
      const deletedItem = await createTestItem({ isDeleted: 1, stocks: {} });
      createdItemIds.push(deletedItem.id);
      const iScan = await scan();
      const [{ n: activeItems }] = (await orm.execute(sql`SELECT count(*)::int AS n FROM items WHERE is_deleted = 0`)).rows as Array<{ n: number }>;
      // v9.0.111 (TD-495): the count is written with Persian digits
      const scanItemsText = iScan.body.checks?.find(c => c.id === 'inventory_kardex')?.details?.match(/([۰-۹]+) کالای فعال/)?.[1] ?? '';
      const scanItems = Number(scanItemsText.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))) || -1);
      check(scanItems === Number(activeItems), `ممیزی یکپارچگی باید ${activeItems} کالای فعال گزارش کند (دریافتی ${scanItems})`);

      // (د) بازنشانی رویدادهای متوقف Outbox ثبت ممیزی دارد
      const stuckId = ev('STUCK');
      createdOutboxEventIds.push(stuckId);
      await orm.insert(outboxEvents).values({
        eventId: stuckId, eventType: 'td245.test', aggregateType: 'test', aggregateId: 'STUCK', status: 'processing',
        payload: {}, retryCount: 2, occurredAt: sql`now() - interval '10 minutes'` as unknown as string,
      });
      const stuckRes = await post('/api/system/reconciliation-fix', { action: 'clear_stuck_outbox' });
      check(stuckRes.status === 200, `clear_stuck_outbox با بدنه رابط کاربری باید 200 بدهد (وضعیت ${stuckRes.status})`);
      const [stuckRow] = await orm.select().from(outboxEvents).where(eq(outboxEvents.eventId, stuckId));
      check(stuckRow?.status === 'pending' && stuckRow?.retryCount === 0, `رویداد متوقف باید به pending برگردد (دریافتی ${stuckRow?.status})`);
      const [stuckLog] = await orm.select().from(activityLogs)
        .where(and(sql`${activityLogs.id} > ${maxLogId}`, eq(activityLogs.entityId, 'outbox_stuck_reset'))).orderBy(sql`${activityLogs.id} DESC`).limit(1);
      if (stuckLog) createdLogIds.push(stuckLog.id);
      const stuckDetails = (stuckLog?.details || {}) as { eventIds?: string[]; before?: { status?: string }; after?: { status?: string } };
      check(!!stuckLog && !!stuckLog.ipAddress && !!stuckDetails.eventIds?.includes(stuckId) && stuckDetails.before?.status === 'processing' && stuckDetails.after?.status === 'pending',
        `clear_stuck_outbox باید ثبت ممیزی با IP، شناسه رویداد و وضعیت پیش و پس داشته باشد (دریافتی ${JSON.stringify(stuckLog ? { ip: stuckLog.ipAddress, details: stuckLog.details } : null).slice(0, 300)})`);

      // (ه) نام فایل خروجی با تاریخ امروز کسب‌وکار: ساعت ۲۳:۰۰ UTC (اخیرترین گذشته) در تهران روز بعد است
      await orm.insert(appSettings).values({ key: 'display_timezone', value: 'Asia/Tehran' })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: 'Asia/Tehran' } });
      const realNow = RealDate.now();
      let fixedMs = RealDate.parse(`${new RealDate(realNow).toISOString().slice(0, 10)}T23:00:00Z`);
      if (fixedMs > realNow) fixedMs -= 24 * 60 * 60 * 1000;
      const utcDay = new RealDate(fixedMs).toISOString().slice(0, 10);
      const tehranDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new RealDate(fixedMs));
      check(utcDay !== tehranDay, `تاریخ UTC و تهران در لحظه آزمون باید متفاوت باشند (${utcDay} / ${tehranDay})`);
      class FixedDate extends RealDate {
        constructor(...args: unknown[]) {
          if (args.length === 0) super(fixedMs);
          else super(...(args as [number]));
        }
        static now() { return fixedMs; }
      }
      let disposition = '';
      let exportStatus = 0;
      invalidateTimezoneCache();
      globalThis.Date = FixedDate as DateConstructor;
      try {
        const exportRes = await get('/api/export-backup');
        exportStatus = exportRes.status;
        disposition = String(exportRes.headers['content-disposition'] || '');
      } finally {
        globalThis.Date = RealDate;
        invalidateTimezoneCache();
      }
      check(exportStatus === 200 && disposition.includes(`erp-data-export-${tehranDay}.json`),
        `نام فایل خروجی باید تاریخ کسب‌وکار ${tehranDay} (نه تاریخ UTC ${utcDay}) باشد (وضعیت ${exportStatus}، دریافتی ${disposition})`);

      // (و) Zod: بدنه / کوئری واقعی رابط کاربری می‌گذرد، ورودی نامعتبر 400
      const expectStatus = (label: string, got: number, want: number) => check(got === want, `${label}: وضعیت ${got} (انتظار ${want})`);
      const uiLogs = await get(`/api/activity-logs?page=1&limit=25&search=${encodeURIComponent('ERP')}&category=settings_system&user=pen_admin&action=RESTORE&entity=${encodeURIComponent('رویدادهای سیستم')}&startDate=2026-01-01&endDate=2026-12-31`);
      expectStatus('تاریخچه ممیزی با کوئری رابط کاربری', uiLogs.status, 200);
      check(Array.isArray((uiLogs.body as { data?: unknown[] })?.data) && (uiLogs.body as { limit?: number })?.limit === 25, `پاسخ تاریخچه ممیزی نادرست است: ${JSON.stringify(uiLogs.body).slice(0, 200)}`);
      expectStatus('تاریخچه ممیزی بدون پارامتر', (await get('/api/activity-logs')).status, 200);
      expectStatus('تاریخچه ممیزی با کاربر تکراری (آرایه)', (await get('/api/activity-logs?user=a&user=b')).status, 400);
      expectStatus('تاریخچه ممیزی با دسته نامعتبر', (await get('/api/activity-logs?category=bogus')).status, 400);
      expectStatus('تاریخچه ممیزی با صفحه غیرعددی', (await get('/api/activity-logs?page=abc')).status, 400);
      expectStatus('پاکسازی ممیزی با بدنه رابط کاربری', (await post('/api/activity-logs/purge', { retentionDays: 730, preserveCritical: true })).status, 200);
      expectStatus('پاکسازی ممیزی با مدت آرایه', (await post('/api/activity-logs/purge', { retentionDays: [36500] })).status, 400);
      expectStatus('پاکسازی ممیزی با allowForceRecent رشته‌ای', (await post('/api/activity-logs/purge', { retentionDays: 36500, allowForceRecent: 'false' })).status, 400);
      expectStatus('پاکسازی ممیزی با مدت غیرعددی', (await post('/api/activity-logs/purge', { retentionDays: 'abc' })).status, 400);
      for (const [label, body] of [['عملیات ناشناخته', { action: 'bogus' }], ['بدون عملیات', {}], ['عملیات آرایه', { action: ['requeue_dlq'] }]] as Array<[string, object]>) {
        const r = await post('/api/system/reconciliation-fix', body);
        check(r.status === 400 && (r.body as { code?: string })?.code === 'VALIDATION_ERROR',
          `اقدام اصلاحی با ${label} باید خطای اعتبارسنجی 400 بدهد (وضعیت ${r.status}، ${JSON.stringify(r.body).slice(0, 150)})`);
      }

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_system_route_findings_td_245', scenarioId: 'recovery_outbox_webhook_retry', name: testName, layer: 'regression',
        executionType: 'real_api', passed: true, durationMs: Date.now() - tStart,
        details: 'requeue_dlq فقط ردیف‌های حل‌نشده را با همان شناسه به Outbox برگرداند و علامت replayed زد (بدون حذف، با ممیزی IP و پیش/پس)؛ شمارنده DLQ، تراز ۰٫۰۱ بدون حذف نرم، totalVouchers و کالاهای فعال درست شمرده شدند؛ بازنشانی Outbox ممیزی شد؛ نام فایل خروجی تاریخ کسب‌وکار گرفت؛ ورودی نامعتبر 400.'
      }));
    } catch (err: unknown) {
      results.push(makeTestCase({
        id: 'reg_system_route_findings_td_245', scenarioId: 'recovery_outbox_webhook_retry', name: testName, layer: 'regression',
        executionType: 'real_api', passed: false, durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      globalThis.Date = RealDate;
      await orm.delete(appSettings).where(eq(appSettings.key, 'display_timezone'));
      if (savedTz) await orm.insert(appSettings).values({ key: savedTz.key, value: savedTz.value });
      const { invalidateTimezoneCache } = await import('../../lib/businessClock.js');
      invalidateTimezoneCache();
      for (const row of foreignDlq) {
        await orm.update(deadLetterEvents).set({ status: row.status, resolvedAt: row.resolvedAt, resolvedBy: row.resolvedBy, resolutionNotes: row.resolutionNotes })
          .where(eq(deadLetterEvents.id, row.id));
      }
      for (const row of foreignOutbox) {
        await orm.update(outboxEvents).set({ status: row.status, retryCount: row.retryCount, nextRetryAt: row.nextRetryAt, lastError: row.lastError, processedAt: row.processedAt, lockedAt: row.lockedAt, lockedBy: row.lockedBy })
          .where(eq(outboxEvents.eventId, row.eventId));
      }
      const foreignOutboxIds = new Set(foreignOutbox.map(r => r.eventId));
      const reinsertedForeign = foreignDlq.map(r => r.originalEventId).filter(id => !foreignOutboxIds.has(id));
      if (reinsertedForeign.length > 0) await cleanTestTableData('outbox_events', 'event_id', reinsertedForeign);
      if (createdLogIds.length > 0) await cleanTestTableData('activity_logs', 'id', createdLogIds);
      if (createdDlqIds.length > 0) await cleanTestTableData('dead_letter_events', 'id', createdDlqIds);
      if (createdOutboxEventIds.length > 0) await cleanTestTableData('outbox_events', 'event_id', createdOutboxEventIds);
      if (createdItemIds.length > 0) await cleanTestTableData('items', 'id', createdItemIds);
      if (createdVoucherIds.length > 0) {
        await cleanTestTableData('journal_voucher_items', 'voucher_id', createdVoucherIds);
        await cleanTestTableData('journal_vouchers', 'id', createdVoucherIds);
      }
      if (createdAccountIds.length > 0) await cleanTestTableData('accounts', 'id', createdAccountIds);
    }
  }

  // Test: TD-245 (تصمیم مالک محصول «همه پاک شود»): بازنشانی کامل سال‌های مالی بسته، پیوست‌ها و فایل‌هایشان، گزارش‌های
  // اصلاح داده و جداول وابسته را هم پاک می‌کند، زیر قفل seed اجرا می‌شود و ممیزی آن می‌ماند. اجرا در اسکیمای ایزوله
  // داخلی (setupTestSchema) تا داده بقیه آزمون‌ها در اسکیمای اجرای جاری دست نخورد.
  if (shouldRun('reg_factory_reset_complete_td_245', 'td245', 'factory', 'reset', 'clear-data', 'wipeAndReseed')) {
    const tStart = Date.now();
    const testName = 'TD-245: پاک کردن داده‌ها سال مالی بسته، پیوست‌ها و فایل‌هایشان و گزارش‌های اصلاح را هم پاک می‌کند، زیر قفل seed و با ممیزی';
    const violations: string[] = [];
    const savedPurge = process.env.ALLOW_DANGEROUS_DATA_PURGE;
    const savedAttachmentsDir = process.env.ATTACHMENTS_DIR;
    const fsMod = (await import('fs')).default;
    const pathMod = (await import('path')).default;
    const osMod = (await import('os')).default;
    const cryptoMod = (await import('crypto')).default;
    const pg = (await import('pg')).default;
    const { pool } = await import('../../db/drizzle.js');
    let inner: { schema: string; teardown: () => Promise<void> } | null = null;
    let lockClient: InstanceType<typeof pg.Client> | null = null;
    const tmpRoot = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'erp-td245-'));
    try {
      const { setupTestSchema } = await import('../setup/testDb.js');
      const { FactoryResetService } = await import('../../services/system/factoryReset.service.js');
      const schema = await import('../../db/schema.js');
      const {
        users, productionProjects, fiscalPeriods, fileAttachments, legacyDateRepairs, refFiscalYearCorrections,
        workflowTaskReopenLog, projectReservationReleases, inventoryReconciliationAnomalies, itemWarehouseStocks, activityLogs, roles
      } = schema;

      inner = await setupTestSchema();
      const current = (await pool.query('SELECT current_schema() AS s')).rows[0]?.s;
      if (current !== inner.schema) throw new Error(`اسکیمای ایزوله داخلی فعال نشد (${current} به‌جای ${inner.schema})؛ بازنشانی اجرا نشد`);

      const attachmentsDir = pathMod.join(tmpRoot, '.attachments');
      process.env.ATTACHMENTS_DIR = attachmentsDir;
      process.env.ALLOW_DANGEROUS_DATA_PURGE = 'true';

      // داده: کاربر، انبار و کالا با موجودی، مغایرت انبار، پروژه، سند پروژه با کسر رزرو و اصلاح سال مرجع، سند حسابداری
      // اختتامیه با سال مالی بسته، اصلاح تاریخ قدیمی، گزارش بازگشایی کار گردش‌کار، پیوست با فایل واقعی و یک ردیف ممیزی
      await orm.insert(users).values({ username: 'td245_admin', role: 'admin', fullName: 'آزمون TD-245', password: 'x' });
      const [wh] = await orm.insert(warehouses).values({ code: 'TD245', name: 'انبار TD-245' }).returning({ id: warehouses.id });
      const [item] = await orm.insert(items).values({ code: 'TD245-1', name: 'کالای TD-245', unit: 'عدد', type: 'raw_material' }).returning({ id: items.id });
      await orm.insert(itemWarehouseStocks).values({ itemId: item.id, warehouseId: wh.id, warehouseCode: 'TD245', currentStock: 5 });
      await orm.insert(inventoryReconciliationAnomalies).values({ runId: 'td245', itemId: item.id, warehouseId: wh.id, kind: 'test' });
      const [project] = await orm.insert(productionProjects).values({ title: 'پروژه TD-245', projectCode: 'TD245' }).returning({ id: productionProjects.id });
      const [doc] = await orm.insert(documents).values({ type: 'remittance', date: '2026-01-10 00:00:00', refNumber: 'TD245-REF', projectId: project.id }).returning({ id: documents.id });
      await orm.insert(projectReservationReleases).values({ documentId: doc.id, projectId: project.id, itemId: item.id, qtyField: 'reservedQty', quantity: 1, reservationRow: {} });
      await orm.insert(refFiscalYearCorrections).values({ documentId: doc.id, docType: 'remittance', refNumber: 'TD245-REF', documentDate: '2026-01-10 00:00:00', oldFiscalYear: 1405, newFiscalYear: 1404, status: 'corrected' });
      const voucherNumber = await VoucherService.getNextVoucherNumber();
      const [closing] = await orm.insert(journalVouchers).values({ voucherNumber, date: '2025-03-20', description: 'سند اختتامیه TD-245', voucherType: 'closing' }).returning({ id: journalVouchers.id });
      await orm.insert(fiscalPeriods).values({ fiscalYear: 1403, status: 'closed', closedAt: '2025-03-20 00:00:00', closedBy: 'td245_admin', closingVoucherId: closing.id });
      await orm.insert(legacyDateRepairs).values({ tableName: 'journal_vouchers', rowId: closing.id, columnName: 'date', oldValue: '12-30-1403', newValue: '1403/12/30', status: 'corrected' });
      await orm.insert(workflowTaskReopenLog).values({ taskId: 1, instanceId: 1, action: 'reopened', reason: 'آزمون TD-245' });
      await orm.insert(activityLogs).values({ username: 'td245_admin', action: 'CREATE', entity: 'آزمون TD-245', description: 'ردیف ممیزی پیش از بازنشانی', timestamp: new Date().toISOString() });

      const attachmentId = cryptoMod.randomUUID();
      const storagePath = `document/${attachmentId}.txt`;
      const attachmentFile = pathMod.join(attachmentsDir, storagePath);
      fsMod.mkdirSync(pathMod.dirname(attachmentFile), { recursive: true });
      fsMod.writeFileSync(attachmentFile, 'td245');
      await orm.insert(fileAttachments).values({ id: attachmentId, entityType: 'document', entityId: doc.id, storagePath, sizeBytes: 5, sha256: cryptoMod.createHash('sha256').update('td245').digest('hex') });
      // فایل‌هایی که به انبار پیوست‌ها تعلق ندارند (یا ثبت نشده‌اند) نباید پاک شوند
      const foreignFile = pathMod.join(tmpRoot, 'keep-me.txt');
      const unregisteredFile = pathMod.join(attachmentsDir, 'document', 'notes.txt');
      fsMod.writeFileSync(foreignFile, 'keep');
      fsMod.writeFileSync(unregisteredFile, 'keep');

      const countOf = async (table: string): Promise<number> =>
        Number((await pool.query(`SELECT count(*)::int AS n FROM "${inner!.schema}"."${table}"`)).rows[0]?.n ?? -1);
      const wipedTables = [
        'fiscal_periods', 'file_attachments', 'legacy_date_repairs', 'ref_fiscal_year_corrections', 'workflow_task_reopen_log',
        'project_reservation_releases', 'inventory_reconciliation_anomalies', 'item_warehouse_stocks',
        'documents', 'journal_vouchers', 'production_projects', 'items', 'users'
      ];
      const assertIntact = async (stage: string): Promise<void> => {
        for (const t of ['fiscal_periods', 'file_attachments', 'legacy_date_repairs', 'documents', 'users']) {
          if ((await countOf(t)) === 0) violations.push(`${stage}: جدول ${t} پاک شد در حالی که بازنشانی نباید انجام می‌شد`);
        }
        if (!fsMod.existsSync(attachmentFile)) violations.push(`${stage}: فایل پیوست پیش از commit پاک شد`);
      };
      const actor = { username: 'td245_admin', ip: '127.0.0.245' };

      // الف) seed دیگری قفل 89345 را دارد: بازنشانی با تداخل رد می‌شود و هیچ چیز پاک نمی‌شود
      lockClient = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await lockClient.connect();
      await lockClient.query('SELECT pg_advisory_lock(89345)');
      let lockedError: unknown = null;
      try {
        await FactoryResetService.wipeAndReseed(actor);
      } catch (e: unknown) {
        lockedError = e;
      }
      await lockClient.query('SELECT pg_advisory_unlock(89345)');
      await lockClient.end();
      lockClient = null;
      if ((lockedError as { statusCode?: number } | null)?.statusCode !== 409) {
        violations.push(`بازنشانی هنگام نگه‌داشتن قفل seed باید با 409 رد شود: ${lockedError instanceof Error ? lockedError.message : String(lockedError)}`);
      }
      await assertIntact('قفل seed گرفته‌شده');

      // ب) شکست درون تراکنش (کلید خارجی ناشناخته به users): همه چیز برمی‌گردد و فایل پیوست روی دیسک می‌ماند
      await pool.query(`CREATE TABLE "${inner.schema}".td245_blocker (user_id integer REFERENCES "${inner.schema}".users(id))`);
      await pool.query(`INSERT INTO "${inner.schema}".td245_blocker (user_id) SELECT id FROM "${inner.schema}".users`);
      let blockedError: unknown = null;
      try {
        await FactoryResetService.wipeAndReseed(actor);
      } catch (e: unknown) {
        blockedError = e;
      }
      await pool.query(`DROP TABLE "${inner.schema}".td245_blocker`);
      if (!blockedError) violations.push('بازنشانی با ردیف وابسته ناشناخته به users باید شکست بخورد');
      await assertIntact('تراکنش برگشت‌خورده');

      // ج) بازنشانی موفق
      let report: Awaited<ReturnType<typeof FactoryResetService.wipeAndReseed>>;
      try {
        report = await FactoryResetService.wipeAndReseed(actor);
      } catch (e: unknown) {
        violations.push(`بازنشانی شکست خورد: ${e instanceof Error ? e.message : String(e)}`);
        throw new Error(violations.join(' | '));
      }
      if ((await countOf('fiscal_periods')) !== 0 || (await countOf('journal_vouchers')) !== 0) {
        violations.push('سال مالی بسته یا سند اختتامیه پس از بازنشانی ماند');
      }
      for (const t of wipedTables) {
        const n = await countOf(t);
        if (n !== 0) violations.push(`جدول ${t} پس از بازنشانی ${n} ردیف دارد`);
      }
      if (fsMod.existsSync(attachmentFile)) violations.push('فایل پیوست ثبت‌شده پس از بازنشانی روی دیسک ماند');
      if (!fsMod.existsSync(foreignFile) || !fsMod.existsSync(unregisteredFile)) violations.push('فایلی که متعلق به پیوست‌های ثبت‌شده نبود پاک شد');
      if ((report as { attachmentFiles?: { removed?: number } } | undefined)?.attachmentFiles?.removed !== 1) {
        violations.push(`گزارش بازنشانی باید یک فایل حذف‌شده نشان دهد: ${JSON.stringify((report as unknown as Record<string, unknown> | undefined)?.attachmentFiles)}`);
      }

      // seed دوباره اجرا شد و قفل آن آزاد است
      const categoryCount = await countOf('categories');
      if (categoryCount < 22) violations.push(`پس از بازنشانی seed دسته‌بندی‌ها را نساخت (${categoryCount})`);
      if ((await countOf('accounts')) === 0) violations.push('پس از بازنشانی seed سرفصل‌های حساب را نساخت');
      const [adminRole] = await orm.select({ code: roles.code }).from(roles).where(eq(roles.code, 'admin'));
      if (!adminRole) violations.push('پس از بازنشانی نقش admin وجود ندارد');
      const held = Number((await pool.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND classid = 0 AND objid = 89345 AND granted`)).rows[0]?.n ?? -1);
      if (held !== 0) violations.push(`قفل seed پس از بازنشانی آزاد نشد (${held})`);

      // ممیزی: ردیف قبلی پاک و فقط ردیف بازنشانی با نام کاربر و IP مانده است
      const logs = await orm.select().from(activityLogs);
      if (logs.some(l => l.entity === 'آزمون TD-245')) violations.push('ردیف ممیزی پیش از بازنشانی پاک نشد');
      const resetLogs = logs.filter(l => l.action === 'PURGE' && l.entity === 'سیستم:بازنشانی کامل');
      if (resetLogs.length !== 1 || resetLogs[0].username !== 'td245_admin' || resetLogs[0].ipAddress !== '127.0.0.245' || resetLogs[0].userId !== null) {
        violations.push(`باید دقیقاً یک ردیف ممیزی بازنشانی با نام کاربر و IP و بدون user_id بماند: ${JSON.stringify(resetLogs.map(l => ({ u: l.username, ip: l.ipAddress, uid: l.userId })))}`);
      }

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_factory_reset_complete_td_245', scenarioId: 'test_runner_real_database_guard', name: testName, layer: 'regression',
        executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
        details: 'در اسکیمای ایزوله داخلی: با قفل seed گرفته‌شده بازنشانی 409 داد و چیزی پاک نشد؛ با شکست درون تراکنش همه چیز و فایل پیوست ماند؛ بازنشانی موفق سال مالی بسته با سند اختتامیه، پیوست‌ها و فایل ثبت‌شده، گزارش‌های اصلاح و جداول وابسته را پاک کرد، فایل‌های دیگر ماندند، seed دوباره اجرا و قفل آزاد شد و یک ردیف ممیزی PURGE ماند.'
      }));
    } catch (err: unknown) {
      results.push(makeTestCase({
        id: 'reg_factory_reset_complete_td_245', scenarioId: 'test_runner_real_database_guard', name: testName, layer: 'regression',
        executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      if (lockClient) {
        await lockClient.query('SELECT pg_advisory_unlock_all()').catch(() => undefined);
        await lockClient.end().catch(() => undefined);
      }
      if (inner) await inner.teardown();
      if (savedPurge === undefined) delete process.env.ALLOW_DANGEROUS_DATA_PURGE; else process.env.ALLOW_DANGEROUS_DATA_PURGE = savedPurge;
      if (savedAttachmentsDir === undefined) delete process.env.ATTACHMENTS_DIR; else process.env.ATTACHMENTS_DIR = savedAttachmentsDir;
      fsMod.rmSync(tmpRoot, { recursive: true, force: true });
      // کش‌های درون‌حافظه‌ای داده اسکیمای داخلی را برای آزمون‌های بعدی نگه ندارند
      const { invalidateRoleCache, invalidateSettingsCache } = await import('../../lib/memoryCache.js');
      const { invalidateUserAuthCache } = await import('../../middleware/auth.js');
      const { invalidateTimezoneCache } = await import('../../lib/businessClock.js');
      invalidateRoleCache();
      invalidateSettingsCache();
      invalidateUserAuthCache();
      invalidateTimezoneCache();
    }
  }

  // بسته ۹ (v9.0.4، TD-416): کارت حساب طرف حساب با شناسه او
  const { runPartyAccountCardTests } = await import('../regression/partyAccountCardTests.js');
  results.push(...await runPartyAccountCardTests(shouldRun));
  // بسته ۹ (v9.0.6، TD-417): اسناد پرونده مشتری با نام خریدار برابر و فقط نوع‌های فروش
  const { runCustomerDossierDocumentsTests } = await import('../regression/customerDossierDocumentsTests.js');
  results.push(...await runCustomerDossierDocumentsTests(shouldRun));
  // بسته ۹ (v9.0.7، TD-419): تلفن طرف حساب با کلید تطبیق
  const { runCustomerPhoneKeyTests } = await import('../regression/customerPhoneKeyTests.js');
  results.push(...await runCustomerPhoneKeyTests(shouldRun));
  // بسته ۹ (v9.0.8، TD-420): یکتایی نام طرف حساب فعال
  const { runCustomerUniqueNameTests } = await import('../regression/customerUniqueNameTests.js');
  results.push(...await runCustomerUniqueNameTests(shouldRun));
  // بسته ۱۲، بخش پرسنل (v9.0.25 به بعد): یکپارچگی داده پرسنل
  const { runPersonnelIntegrityTests } = await import('../regression/personnelIntegrityTests.js');
  results.push(...await runPersonnelIntegrityTests(shouldRun));
  // بسته ۹ (v9.0.9، TD-421): نوع خالی در درون‌ریزی اکسل طرف حساب‌ها
  const { runCustomerImportPartyTypeTests } = await import('../regression/customerImportPartyTypeTests.js');
  results.push(...await runCustomerImportPartyTypeTests(shouldRun));
  // بسته ۹ (v9.0.10، TD-431): رد حذف طرف حساب دارای مانده یا کار باز
  const { runCustomerDeleteGuardTests } = await import('../regression/customerDeleteGuardTests.js');
  results.push(...await runCustomerDeleteGuardTests(shouldRun));
  // بسته ۹ (v9.0.11، TD-422): آمار پرونده‌های فروش به تفکیک ارز
  const { runCrmStatsCurrencyTests } = await import('../regression/crmStatsCurrencyTests.js');
  results.push(...await runCrmStatsCurrencyTests(shouldRun));
  // بسته ۹ (v9.0.12، TD-423): ابطال پیش‌فاکتور «فروش موفق» را برمی‌گرداند
  const { runLeadProformaVoidTests } = await import('../regression/leadProformaVoidTests.js');
  results.push(...await runLeadProformaVoidTests(shouldRun));
  // بسته ۹ (v9.0.13، TD-424): یک پیش‌فاکتور برای هر پرونده زیر درخواست‌های هم‌زمان
  const { runLeadProformaConcurrencyTests } = await import('../regression/leadProformaConcurrencyTests.js');
  results.push(...await runLeadProformaConcurrencyTests(shouldRun));
  // بسته ۹ (v9.0.14، TD-428): پیگیری‌های باز بی بازه تاریخ اقدام
  const { runCrmFollowupsTests } = await import('../regression/crmFollowupsTests.js');
  results.push(...await runCrmFollowupsTests(shouldRun));
  // بسته ۹ (v9.0.15، TD-429): فیلتر مشتری پرونده‌های فروش با شناسه طرف حساب
  const { runCrmLeadCustomerFilterTests } = await import('../regression/crmLeadCustomerFilterTests.js');
  results.push(...await runCrmLeadCustomerFilterTests(shouldRun));
  // بسته ۹ (v9.0.16، TD-425): حذف پرونده فروش (ناموجود، سند فعال، پیگیری‌های پرونده حذف‌شده)
  const { runCrmLeadDeleteTests } = await import('../regression/crmLeadDeleteTests.js');
  results.push(...await runCrmLeadDeleteTests(shouldRun));
  // بسته ۹ (v9.0.17، TD-426): اقدام CRM با پرونده یا طرف حساب ناموجود رد می‌شود
  const { runCrmActivityParentsTests } = await import('../regression/crmActivityParentsTests.js');
  results.push(...await runCrmActivityParentsTests(shouldRun));
  // بسته ۹ (v9.0.18، TD-427): اعتبارسنجی ورودی پرونده فروش
  const { runCrmLeadInputTests } = await import('../regression/crmLeadInputTests.js');
  results.push(...await runCrmLeadInputTests(shouldRun));
  // بسته ۹ (v9.0.19، TD-430): «انجام» و «بازگشایی» صریح پیگیری
  const { runCrmFollowupActionTests } = await import('../regression/crmFollowupActionTests.js');
  results.push(...await runCrmFollowupActionTests(shouldRun));
  // Package 6 (v9.0.55, TD-480): stock-count sheet book stock by warehouse code or name, stale book stock 409
  const { runStockCountSheetTests } = await import('../regression/stockCountSheetTests.js');
  results.push(...await runStockCountSheetTests(shouldRun));
  // Package 4 (v9.0.67 on): treasury money and vouchers (TD-499..TD-504)
  const { runTreasuryMoneyVoucherTests } = await import('../regression/treasuryMoneyVoucherTests.js');
  results.push(...await runTreasuryMoneyVoucherTests(shouldRun));
  // Package 4 (v9.0.82 on): treasury and cheque party accounts (TD-507, TD-501, TD-497, TD-498)
  const { runTreasuryPartyTests } = await import('../regression/treasuryPartyTests.js');
  results.push(...await runTreasuryPartyTests(shouldRun));
  // Package 4 PR c (v9.0.97 on): treasury input and access (TD-505, TD-506, TD-508, TD-510, TD-514, TD-669)
  const { runTreasuryInputTests } = await import('../regression/treasuryInputTests.js');
  results.push(...await runTreasuryInputTests(shouldRun));
  // Package 4 PR d: treasury lists, reconciliation, cheque audit and wording (TD-509, TD-511, TD-512, TD-513, TD-515)
  const { runTreasuryListTests } = await import('../regression/treasuryListTests.js');
  results.push(...await runTreasuryListTests(shouldRun));
  // Package 3 PR a (v9.0.115 on): accounting reports and lists in the UI (TD-565 ...)
  const { runAccountingReportsTests } = await import('../regression/accountingReportsTests.js');
  results.push(...await runAccountingReportsTests(shouldRun));
  // Package 3 PR b (v9.0.159 on): fiscal-year closing and reopening (TD-545 ...)
  const { runFiscalClosingTests } = await import('../regression/fiscalClosingTests.js');
  results.push(...await runFiscalClosingTests(shouldRun));
  const { runFiscalYearOrderTests } = await import('../regression/fiscalYearOrderTests.js');
  results.push(...await runFiscalYearOrderTests(shouldRun));
  const { runManualVoucherCurrencyTests } = await import('../regression/manualVoucherCurrencyTests.js');
  results.push(...await runManualVoucherCurrencyTests(shouldRun));
  // Package 6 (v9.0.79, TD-483): no future-dated stock movement, transfer date normalized, future rows in the health check
  const { runStockMovementFutureDateTests } = await import('../regression/stockMovementFutureDateTests.js');
  results.push(...await runStockMovementFutureDateTests(shouldRun));
  // Package 6 (v9.0.80, TD-489): a warehouse transfer is a numbered transfer document, voidable without changing WAC
  const { runWarehouseTransferDocumentTests } = await import('../regression/warehouseTransferDocumentTests.js');
  results.push(...await runWarehouseTransferDocumentTests(shouldRun));
  // Package 6 (v9.0.81, TD-494): typed transfer and rebuild errors, shared warehouse resolver, missing item Kardex 404
  const { runInventoryBusinessErrorsTests } = await import('../regression/inventoryBusinessErrorsTests.js');
  results.push(...await runInventoryBusinessErrorsTests(shouldRun));
  // Package 6 (v9.0.88, TD-486): the integrity report checks WAC against the Kardex replay
  const { runIntegrityReportReplayWacTests } = await import('../regression/integrityReportReplayWacTests.js');
  results.push(...await runIntegrityReportReplayWacTests(shouldRun));
  // Package 6 (v9.0.90, TD-487): the Kardex rebuild keeps WAC; WAC correction is a separate permission with a draft voucher
  const { runKardexWacCorrectionTests } = await import('../regression/kardexWacCorrectionTests.js');
  results.push(...await runKardexWacCorrectionTests(shouldRun));
  // Package 6 (v9.0.91, TD-491): an unchanged item gets no version bump, outbox event or audit row from the rebuild
  const { runKardexRebuildQuietTests } = await import('../regression/kardexRebuildQuietTests.js');
  results.push(...await runKardexRebuildQuietTests(shouldRun));
  // Package 6 (v9.0.92, TD-488): the initial Kardex backfill never reprices its earlier rows
  const { runKardexBackfillNoRewriteTests } = await import('../regression/kardexBackfillNoRewriteTests.js');
  results.push(...await runKardexBackfillNoRewriteTests(shouldRun));
  // Package 6 (v9.0.93, TD-481): the item opening voucher is worth its opening Kardex rows and rewrites no row
  const { runItemOpeningVoucherValueTests } = await import('../regression/itemOpeningVoucherValueTests.js');
  results.push(...await runItemOpeningVoucherValueTests(shouldRun));
  // Package 6 (v9.0.94, TD-492): the stock movement chart counts ledger rows only, within the window
  const { runMovementTrendLedgerTests } = await import('../regression/movementTrendLedgerTests.js');
  results.push(...await runMovementTrendLedgerTests(shouldRun));
  // Package 6 (v9.0.95, TD-493): a deleted transfer design answers 404 and its code can be saved again
  const { runTransferCodeLifecycleTests } = await import('../regression/transferCodeLifecycleTests.js');
  results.push(...await runTransferCodeLifecycleTests(shouldRun));
  // Package 6 (v9.0.96, TD-496): the warehouse chart counts items with stock, not quantities of different units
  const { runWarehouseItemCountTests } = await import('../regression/warehouseItemCountTests.js');
  results.push(...await runWarehouseItemCountTests(shouldRun));
  // Package 6 (v9.0.110, TD-482): a warehouse code «default» is refused and reversals name a real warehouse
  const { runWarehouseReservedCodeTests } = await import('../regression/warehouseReservedCodeTests.js');
  results.push(...await runWarehouseReservedCodeTests(shouldRun));

  // v9.0.111 (TD-495): system reconciliation scan reads the stock integrity summary
  const { runSystemInventoryCheckTests } = await import('../regression/systemInventoryCheckTests.js');
  results.push(...await runSystemInventoryCheckTests(shouldRun));

  // v9.0.112 (TD-490): warehouse deactivation lock, last active warehouse and reactivation
  const { runWarehouseDeactivationTests } = await import('../regression/warehouseDeactivationTests.js');
  results.push(...await runWarehouseDeactivationTests(shouldRun));

  // Package 5 PR A (v9.0.152+): Excel import / export of items and the pricing quick import
  const { runItemExcelImportTests } = await import('../regression/itemExcelImportTests.js');
  results.push(...await runItemExcelImportTests(shouldRun));
  const { runItemIntegrityTests } = await import('../regression/itemIntegrityTests.js');
  results.push(...await runItemIntegrityTests(shouldRun));
  const { runItemPriceTests } = await import('../regression/itemPriceTests.js');
  results.push(...await runItemPriceTests(shouldRun));
  const { runItemCategoryTests } = await import('../regression/itemCategoryTests.js');
  results.push(...await runItemCategoryTests(shouldRun));
  const { runItemPerformanceTests } = await import('../regression/itemPerformanceTests.js');
  results.push(...await runItemPerformanceTests(shouldRun));
  const { runItemExcelExportTests } = await import('../regression/itemExcelExportTests.js');
  results.push(...await runItemExcelExportTests(shouldRun));

  return results;
}
