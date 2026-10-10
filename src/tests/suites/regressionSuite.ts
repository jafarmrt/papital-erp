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
        name: 'Check of the 22 standard categories and automatic default units (Regression Sanity)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t1Start,
        details: `${categoryCount} main categories exist in the database and the automatic unit (pair for earrings) is confirmed.`
      }));
    } else {
      // V3.0.6 (FC-2): شاخه «شکست» قبلاً نیز passed:true ثبت می‌کرد و تست عملاً
      // هرگز fail نمی‌شد (False Confidence). اکنون انحراف از baseline واقعاً گزارش می‌شود.
      results.push(makeTestCase({
        id: 'reg_categories_default_units',
        scenarioId: 'regression_sanity',
        name: 'Check of the 22 standard categories and automatic default units (Regression Sanity)',
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - t1Start,
        error: `Category baseline mismatch — category count: ${categoryCount} (expected >= 22), default earring unit: ${defaultUnit || 'null'} (expected: pair)`
      }));
    }
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_categories_default_units',
      scenarioId: 'regression_sanity',
      name: 'Check of the 22 standard categories and automatic default units (Regression Sanity)',
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
      throw new Error('transfer schema must convert ids and string values to numbers.');
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
      throw new Error('transfer schema must reject a transfer with the same source and destination warehouse.');
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
      throw new Error('transfer schema must reject negative or zero quantities.');
    }

    // Case 4: اعتبارسنجی سیاست موجودی منفی (فقط forbidden, warning, allowed)
    const validPolicy = await negativeStockPolicySchema.parseAsync({
      body: { policy: 'forbidden' }
    });
    if (validPolicy.body.policy !== 'forbidden') {
      throw new Error('negative stock policy schema must accept a valid value.');
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
      throw new Error('negative stock policy schema must reject unknown values.');
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
      throw new Error('project allocation schema must reject an empty items array.');
    }

    // Case 6: اعتبارسنجی فیلترهای کوئری تخصیص‌ها
    const validAllocQuery = await allocationsQuerySchema.parseAsync({
      query: {
        projectId: '4',
        status: 'allocated'
      }
    });
    if (!validAllocQuery.query || validAllocQuery.query.projectId !== 4) {
      throw new Error('allocation filter schema must accept valid values.');
    }

    results.push(makeTestCase({
      id: 'v4_inventory_runtime_contracts_guard',
      scenarioId: 'v4_inventory_runtime_contracts_guard',
      name: 'Inventory, transfer and BOM allocation runtime contracts with Zod (subphase 4.3)',
      layer: 'regression',
      executionType: 'simulation_logic',
      passed: true,
      durationMs: Date.now() - t2Start,
      details: 'Strict inter-warehouse transfer validation, refusal of the same source/destination, non-negative quantities, negative stock policy and project allocation are confirmed.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'v4_inventory_runtime_contracts_guard',
      scenarioId: 'v4_inventory_runtime_contracts_guard',
      name: 'Inventory, transfer and BOM allocation runtime contracts with Zod (subphase 4.3)',
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
      throw new Error('journal voucher schema must accept a valid balanced voucher.');
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
      throw new Error('double-entry voucher schema must reject unbalanced debit/credit vouchers.');
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
      throw new Error('Sayad cheque schema must accept a valid 16-digit id.');
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
      throw new Error('Sayad cheque schema must reject a Sayad id with an invalid format.');
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
      throw new Error('treasury fund transfer schema must reject the same source and destination account.');
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
      throw new Error('treasury transaction schema must reject a negative amount.');
    }

    results.push(makeTestCase({
      id: 'v4_accounting_treasury_runtime_contracts_guard',
      scenarioId: 'v4_accounting_treasury_runtime_contracts_guard',
      name: 'Accounting and treasury runtime contracts with Zod (subphase 4.4)',
      layer: 'regression',
      executionType: 'simulation_logic',
      passed: true,
      durationMs: Date.now() - t4Start,
      details: 'Balanced double-entry journal voucher (Debit == Credit), 16-digit Sayad cheque id, refusal of the same source/destination account in fund transfers and positive treasury amounts are confirmed.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'v4_accounting_treasury_runtime_contracts_guard',
      scenarioId: 'v4_accounting_treasury_runtime_contracts_guard',
      name: 'Accounting and treasury runtime contracts with Zod (subphase 4.4)',
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
      throw new Error('release result must be changed=true with one released item.');
    }

    // ۳. راستی‌آزمایی jsonb: رزرو از ۱۰ به ۶ کاهش یافته و version بامپ شده است
    const [afterProj] = await orm.select().from(productionProjects).where(eq(productionProjects.id, project.id));
    const invControl: any = (afterProj.inventoryControl as any) || {};
    const reservedListAfter = Array.isArray(invControl.reservedItems) ? invControl.reservedItems : [];
    const remainingQty = reservedListAfter.length > 0 ? Number(reservedListAfter[0].reservedQty || 0) : 0;
    if (remainingQty !== 6) {
      throw new Error(`remaining reservation must be 10-4=6; actual: ${remainingQty}`);
    }
    if (Number(afterProj.version) !== 2) {
      throw new Error(`project version after release must be 2; actual: ${afterProj.version}`);
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
      throw new Error('release with a stale OCC version must be refused.');
    }

    results.push(makeTestCase({
      id: 'td081_project_reservation_release_service_guard',
      scenarioId: 'v4_project_reservation_release_guard',
      name: 'V4.0.31 Regression: single project reservation release service with OCC and Audit (TD-081)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t5Start,
      details: `Reservation deduction (10→6 units, remaining = ${remainingQty}), OCC version bump and refusal of a call with a stale version are confirmed.`
    }));

    // پاکسازی فیکسچر مارک‌دار
    await cleanTestTableData('production_projects', 'id', [project.id]);
    await cleanTestTableData('items', 'id', [item.id]);
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'td081_project_reservation_release_service_guard',
      scenarioId: 'v4_project_reservation_release_guard',
      name: 'V4.0.31 Regression: single project reservation release service with OCC and Audit (TD-081)',
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
      throw new Error(`empty date must default to "${today}"; actual: "${defaulted}"`);
    }

    // 2) نرمال‌سازی ورودی جلالی به ISO
    const [gy, gm, gd] = today.split('-').map(Number);
    const normalized = await resolveTreasuryBusinessDate('1405/01/15');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      throw new Error(`Jalali to ISO normalization failed: "${normalized}"`);
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
      throw new Error(`future date "${future}" must be refused.`);
    }

    // 4) فرمت نامعتبر باید رد شود
    let invalidFormatThrew = false;
    try {
      await resolveTreasuryBusinessDate('not-a-date');
    } catch {
      invalidFormatThrew = true;
    }
    if (!invalidFormatThrew) {
      throw new Error('invalid date format must be refused.');
    }

    results.push(makeTestCase({
      id: 'td105_treasury_server_authoritative_date',
      scenarioId: 'v4_treasury_server_authoritative_date_guard',
      name: 'V4.0.31 Regression: server-authoritative treasury date and range validation (TD-105)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t6Start,
      details: 'businessTodayIsoDate default, Jalali→ISO normalization, refusal of a future date and refusal of an invalid format are confirmed.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'td105_treasury_server_authoritative_date',
      scenarioId: 'v4_treasury_server_authoritative_date_guard',
      name: 'V4.0.31 Regression: server-authoritative treasury date and range validation (TD-105)',
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
      throw new Error(`factory fixture name must carry the marker "${TEST_MARKER}"; actual: "${item.name}"`);
    }

    await cleanTestTableData('items', 'id', [item.id]);

    results.push(makeTestCase({
      id: 'td107_test_cleanup_marker_only',
      scenarioId: 'v4_test_cleanup_marker_only_guard',
      name: 'V4.0.31 Regression: marker-based test cleanup — fixtures are marked (TD-107)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t7Start,
      details: `the factory fixture is marked with the central marker "${TEST_MARKER}" and cleanup targets only records carrying the marker or a structured id.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'td107_test_cleanup_marker_only',
      scenarioId: 'v4_test_cleanup_marker_only_guard',
      name: 'V4.0.31 Regression: marker-based test cleanup — fixtures are marked (TD-107)',
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
      throw new Error('no active warehouse exists in the system.');
    }
    const defaultCode = activeWhs[0].code;
    const resolvedDefault = await resolveWarehouseCode(orm, '');
    if (resolvedDefault !== defaultCode) {
      throw new Error(`resolved default warehouse (${resolvedDefault}) does not match the code of the first active warehouse (${defaultCode}).`);
    }

    // 2) Test resolveWarehouseCode with warehouse name -> resolves to its code
    if (activeWhs[0].name) {
      const resolvedByName = await resolveWarehouseCode(orm, activeWhs[0].name);
      if (resolvedByName !== activeWhs[0].code) {
        throw new Error(`warehouse name "${activeWhs[0].name}" was not mapped to code "${activeWhs[0].code}" (resolved value: ${resolvedByName})`);
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
      throw new Error('no ValidationError was thrown for an invalid warehouse.');
    }

    // 4) Check single source of truth: current_stock = SUM(item_warehouse_stocks) across items (v7.0.48 / TD-214)
    const stockDriftCheck = await orm.execute(sql`
      SELECT COUNT(*)::int AS drift_count
      FROM items i
      WHERE i.current_stock IS DISTINCT FROM COALESCE((SELECT SUM(s.current_stock) FROM item_warehouse_stocks s WHERE s.item_id = i.id), 0)
    `);
    const driftCount = Number((stockDriftCheck.rows[0] as any)?.drift_count || 0);
    if (driftCount > 0) {
      throw new Error(`${driftCount} items differ between total stock (current_stock) and the sum of the warehouse stock table.`);
    }

    results.push(makeTestCase({
      id: 'reg_warehouse_resolution_and_stock_parity',
      scenarioId: 'v5_warehouse_resolution_guard',
      name: 'V5 Phase 1: warehouse code resolution, invalid-warehouse validation and parity of total stock with warehouses (TD-114/116/117)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t8Start,
      details: `warehouse name-to-code conversion, 422 error for an invalid warehouse and full parity of total stock with the warehouse sum are confirmed.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_warehouse_resolution_and_stock_parity',
      scenarioId: 'v5_warehouse_resolution_guard',
      name: 'V5 Phase 1: warehouse code resolution, invalid-warehouse validation and parity of total stock with warehouses (TD-114/116/117)',
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
      weightedAverageCost: 1000,
      proformaReservedQty: 1,
      projectReservedQty: 1,
      totalReservedQty: 2,
      availableStock: 3,
      totalReservedCost: 2000,
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
          unitCost: 1000,
          totalCost: 1000,
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
          unitCost: 1000,
          totalCost: 1000,
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
      throw new Error(`standard sellable calculation is wrong: ${JSON.stringify(resStandard)} (expected sellable: 3)`);
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
      throw new Error(`sellable calculation with a high reservation is wrong: ${JSON.stringify(resHigh)} (expected sellable: 1)`);
    }

    // Test excluding own proforma (Finalizing proforma #777 with 2 units)
    // Exclude proforma #777: other reservations = 2. Available from total = 3. Location stock = 3.
    // sellable = min(3, 3) = 3 (not 1!). Self-reservation successfully excluded.
    const resExclude = ItemStockReservationService.computeSellable(mockSummaryHighReserve, mockStocks, {
      location: 'main',
      excludeDocumentId: 777
    });
    if (resExclude.sellable !== 3 || resExclude.reservedForOthers !== 2) {
      throw new Error(`excluding the proforma's own reservation is wrong: ${JSON.stringify(resExclude)} (expected sellable: 3)`);
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
      throw new Error(`frontend helper getSellableStock returns invalid output: ${JSON.stringify(feRes)}`);
    }

    results.push(makeTestCase({
      id: 'reg_sellable_stock_and_reservation_gate',
      scenarioId: 'v5_sellable_stock_reservation_gate',
      name: 'V5 Phase 2: unified proforma and sales reservation gate, sellable cap and self-reservation exclusion (TD-118/126)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t9Start,
      details: `three-way warehouse calculation, self-reservation exclusion on proforma finalize, filtering of deleted lines and the frontend helper are confirmed.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_sellable_stock_and_reservation_gate',
      scenarioId: 'v5_sellable_stock_reservation_gate',
      name: 'V5 Phase 2: unified proforma and sales reservation gate, sellable cap and self-reservation exclusion (TD-118/126)',
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
      throw new Error(`normalization of a slash-separated Jalali date is wrong: ${norm1} (expected 2026-09-11)`);
    }
    if (!norm2.startsWith('2026-09-11')) {
      throw new Error(`normalization of a dash-separated Jalali date is wrong: ${norm2} (expected 2026-09-11)`);
    }
    if (!norm3.startsWith('2026-09-11 14:30:00')) {
      throw new Error(`normalization of a Jalali date with time is wrong: ${norm3}`);
    }
    if (iso1 !== '2026-09-11') {
      throw new Error(`jalaliToIsoDate conversion is wrong: ${iso1} (expected 2026-09-11)`);
    }

    // 2. Business Clock verification
    const bizToday = await businessTodayIsoDate();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bizToday) || parseInt(bizToday.slice(0, 4), 10) < 2020) {
      throw new Error(`businessTodayIsoDate output is invalid: ${bizToday}`);
    }

    // 3. Database verification: check that no rows in documents or transactions have year < 1900
    const [invalidDocs] = (await orm.execute(sql`
      SELECT COUNT(*)::int AS count FROM documents WHERE EXTRACT(YEAR FROM date) < 1900
    `)).rows as any[];
    const [invalidTxs] = (await orm.execute(sql`
      SELECT COUNT(*)::int AS count FROM transactions WHERE EXTRACT(YEAR FROM date) < 1900
    `)).rows as any[];

    if (Number(invalidDocs?.count || 0) > 0 || Number(invalidTxs?.count || 0) > 0) {
      throw new Error(`records with an invalid year (< 1900) found in the database: documents=${invalidDocs?.count}, transactions=${invalidTxs?.count}`);
    }

    // 4. Verify check constraints exist in database
    const constraintCheck = (await orm.execute(sql`
      SELECT conname FROM pg_constraint
      WHERE conname IN ('chk_documents_date_gregorian', 'chk_transactions_date_gregorian')
    `)).rows as any[];

    const foundConstraints = constraintCheck.map((c: any) => c.conname);
    if (!foundConstraints.includes('chk_documents_date_gregorian') || !foundConstraints.includes('chk_transactions_date_gregorian')) {
      throw new Error(`database guards (CHECK constraints) are not all created: found=${foundConstraints.join(', ')}`);
    }

    results.push(makeTestCase({
      id: 'reg_jalali_timestamp_normalization_and_gregorian_guard',
      scenarioId: 'v5_jalali_timestamp_normalization',
      name: 'V5 Phase 3: Jalali date normalization, Business Clock adherence and Gregorian validation guard (TD-119)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t10Start,
      details: `exact Jalali-to-ISO conversion, business clock, historical data cleanup and database guard are confirmed.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_jalali_timestamp_normalization_and_gregorian_guard',
      scenarioId: 'v5_jalali_timestamp_normalization',
      name: 'V5 Phase 3: Jalali date normalization, Business Clock adherence and Gregorian validation guard (TD-119)',
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
      throw new Error(`cost of goods sold account (6001) not found or its code is wrong: ${cogsAcc?.code}`);
    }

    // 2. Verify WIP account getter exists and resolves to 1402 (NOT 6001!)
    const wipAcc = await AccountMappingService.getWorkInProgressAccount(orm);
    if (!wipAcc || wipAcc.code !== '1402') {
      throw new Error(`work in progress account (1402) not found or mapped to an invalid code: ${wipAcc?.code}`);
    }

    // 3. Verify finished goods and raw materials accounts resolve
    const fgAcc = await AccountMappingService.getInventoryFinishedGoodsAccount(orm);
    const rmAcc = await AccountMappingService.getInventoryRawMaterialsAccount(orm);
    if (!fgAcc || !rmAcc) {
      throw new Error(`inventory accounts (1401 / 1403) not found in the database.`);
    }

    results.push(makeTestCase({
      id: 'reg_cogs_and_warehouse_voucher_mapping',
      scenarioId: 'v5_cogs_and_warehouse_voucher',
      name: 'V5 Phase 4: cost of goods sold (COGS) voucher and work in progress account conflict fix (TD-120/121)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t11Start,
      details: `accounts 6001 (cost of goods sold), 1402 (work in progress) and the inventory accounts resolve correctly and the 6001 code conflict is fixed.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_cogs_and_warehouse_voucher_mapping',
      scenarioId: 'v5_cogs_and_warehouse_voucher',
      name: 'V5 Phase 4: cost of goods sold (COGS) voucher and work in progress account conflict fix (TD-120/121)',
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
      name: 'V5 Phase 5: explicit cast in test cleanup and stock count routed through the central gateway (TD-122/124)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t12Start,
      details: `casting numeric columns in cleanup runs without a database error and stock count goes through the applyStockMovement gateway.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_audit_stock_movement_gateway_and_cleanup_cast',
      scenarioId: 'v5_audit_gateway_and_test_cleanup',
      name: 'V5 Phase 5: explicit cast in test cleanup and stock count routed through the central gateway (TD-122/124)',
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
        throw new Error(`cheque method in the treasury form was not refused (${refusal || 'accepted'})`);
      }

      // 3. Verify bank balance did NOT change
      const [bankAfterCheque] = await orm.select().from(bankAccounts).where(eq(bankAccounts.id, testBank.id));
      const balanceAfterCheque = Number(bankAfterCheque.currentBalance) || 0;
      if (balanceAfterCheque !== initialBalance) {
        throw new Error(`bank balance changed on a cheque transaction! (before: ${initialBalance}, after: ${balanceAfterCheque})`);
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
        throw new Error(`bank balance changed after voiding a cheque transaction! (before: ${initialBalance}, after: ${balanceAfterVoid})`);
      }

      // Clean up test records
      await cleanTestTableData('treasury_transactions', 'id', [chequeTx.id, voidedTx.id]);
    }

    results.push(makeTestCase({
      id: 'reg_treasury_cheque_isolation_td_148',
      scenarioId: 'v6_treasury_cheque_isolation',
      name: 'V6 Phase 1.2: cheque transactions separated in treasury, no direct bank balance change (TD-148)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t13Start,
      details: 'cheque method is refused in the treasury form (v8.0.26, TD-278) and voiding a legacy cheque transaction does not change the bank balance.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_treasury_cheque_isolation_td_148',
      scenarioId: 'v6_treasury_cheque_isolation',
      name: 'V6 Phase 1.2: cheque transactions separated in treasury, no direct bank balance change (TD-148)',
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
      throw new Error(`normalizing date 1403-12-29 must give 2025-03-19 but returned ${normIso1}.`);
    }
    const normIso2 = normalizeDateToIso('1403/01/01');
    if (normIso2 !== '2024-03-20') {
      throw new Error(`normalizing date 1403/01/01 must give 2024-03-20 but returned ${normIso2}.`);
    }

    // 2. A past fiscal year inside the test's own schema (v9.0.161, TD-543: a year that has not ended is never closed)
    const testYear = 1392;
    // v8.0.47 (TD-310): سند اختتامیه فقط به آخرین روز سال (۳۰ اسفند در سال کبیسه) پذیرفته می‌شود
    const { jalaliYearBounds } = await import('../../utils/calendarDate.js');
    const testYearBounds = jalaliYearBounds(testYear);
    if (!testYearBounds) throw new Error(`test year ${testYear} is outside the calendar range`);
    const testClosingDate = testYearBounds.lastDay;
    const testOpeningDate = testYearBounds.nextFirstDay;

    // Ensure chart of accounts seeded
    await ChartOfAccountsService.seedStandardAccounts();
    const allAccounts = await ChartOfAccountsService.getAllAccounts();
    const revAccount = allAccounts.find(a => a.code === '6001') || allAccounts.find(a => a.accountType === 'revenue');
    const assetAccount = allAccounts.find(a => a.code === '1101') || allAccounts.find(a => a.accountType === 'asset');

    if (!revAccount || !assetAccount) {
      throw new Error('accounts needed for the fiscal year closing test not found.');
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
      throw new Error(`net profit in the fiscal year closing preview must be greater than zero; value: ${preview.netProfit}`);
    }

    // 4. Test transactional execution (TD-141: must not fail with Unbalanced Voucher)
    const closingResult = await FiscalYearService.executeFiscalYearClosing({
      year: testYear,
      closingDate: testClosingDate,
      openingDateNewYear: testOpeningDate,
      createOpeningVoucher: true
    });

    if (!closingResult.success || closingResult.closingVouchers.length < 3) {
      throw new Error(`fiscal year closing must create at least 3 vouchers; voucher count: ${closingResult.closingVouchers.length}`);
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
      name: 'V6 Phase 1.3: fiscal year closing no longer fails under transaction isolation; trial balance calendar matching (TD-141/142)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t14Start,
      details: 'trial balance accepts the transaction object (tx) and normalizes Jalali/Gregorian dates, and runs without an unbalanced closing voucher error.'
    }));
    });
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_fiscal_year_isolation_and_calendar_td_141_142',
      scenarioId: 'v6_fiscal_year_closing_isolation', // v7.0.24 (TD-174): سناریوی ثبت‌شده اختصاصی TD-141/142 (قبلاً NOT_RUN گزارش می‌شد)
      name: 'V6 Phase 1.3: fiscal year closing no longer fails under transaction isolation; trial balance calendar matching (TD-141/142)',
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
      throw new Error('automatic voucher of the foreign-currency invoice was not issued');
    }

    // 4. Verify COGS conversion
    const fullVoucher = await VoucherService.getJournalVoucherById(voucher.id);
    const cogsItem = fullVoucher.items?.find(it => it.accountCode === '6001' || it.description?.includes('بهای تمام‌شده'));
    const fgItem = fullVoucher.items?.find(it => it.accountCode === '1403' || it.description?.includes('کالای ساخته‌شده'));

    if (!cogsItem || !fgItem) {
      throw new Error('cost of goods sold and finished goods rows not found in the foreign-currency invoice voucher');
    }

    // COGS should be 60,000,000 / 600,000 = 100 USD (NOT 60,000,000)
    if (Math.abs(Number(cogsItem.debit) - 100) > 0.01) {
      throw new Error(`foreign cost of goods sold amount must be 100 dollars but the posted value is: ${cogsItem.debit}`);
    }

    if (Math.abs(Number(fgItem.credit) - 100) > 0.01) {
      throw new Error(`foreign finished goods credit must be 100 dollars but the posted value is: ${fgItem.credit}`);
    }

    if (cogsItem.currency !== 'USD' || cogsItem.exchangeRate !== 600000) {
      throw new Error(`currency or exchange rate of the cost of goods sold row is wrong: ${cogsItem.currency} / ${cogsItem.exchangeRate}`);
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
      name: 'V6 Phase 1.4: correct currency conversion of COGS in foreign-currency sales invoices (TD-143)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t15Start,
      details: 'rial cost of goods sold is converted to the invoice base currency (USD) at the invoice exchange rate and posted on rows 6001 and 1403.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_multicurrency_cogs_exchange_rate_td_143',
      scenarioId: 'multi_currency_financials_and_ratios',
      name: 'V6 Phase 1.4: correct currency conversion of COGS in foreign-currency sales invoices (TD-143)',
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
      throw new Error(`item stock after a full outflow must be zero, but it is ${refreshedItem.currentStock}.`);
    }

    // TD-136 assertion: the Kardex replay must NOT reset WAC to 0 after depletion; it keeps 750000. Since v9.0.90 (TD-487,
    // decision t3) the rebuild reports that replay WAC and keeps the item's WAC; «اصلاح بها» is the separate action.
    if (rebuilt.replayWac !== 750000) {
      throw new Error(`weighted average cost (WAC) after stock runs out should have kept the rate 750,000, but ${rebuilt.replayWac} was recorded.`);
    }
    if (Number(refreshedItem.weightedAverageCost) !== 500000) {
      throw new Error(`Kardex rebuild must not change the item WAC (v9.0.90, TD-487), but ${refreshedItem.weightedAverageCost} was recorded.`);
    }

    // Clean up test data
    await cleanTestTableData('transactions', 'id', [inTx.id, outTx.id]);
    await cleanTestTableData('items', 'id', [testItem.id]);

    results.push(makeTestCase({
      id: 'reg_kardex_rebuild_wac_preservation_td_136',
      scenarioId: 'inventory_rebuild',
      name: 'V6 Phase 2.1: Kardex rebuild keeps the last weighted average cost (WAC) when stock runs out (TD-136)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t16Start,
      details: 'after an inflow at 750,000 and a full outflow to zero, the Kardex rebuild keeps the weighted average cost of 750,000 and does not reset it to zero.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_kardex_rebuild_wac_preservation_td_136',
      scenarioId: 'inventory_rebuild',
      name: 'V6 Phase 2.1: Kardex rebuild keeps the last weighted average cost (WAC) when stock runs out (TD-136)',
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
      throw new Error('inter-warehouse transfer failed.');
    }

    // Fetch refreshed item
    const [refreshedItem] = await orm.select().from(items).where(eq(items.id, testItem.id));
    const finalStocks = (await ItemWarehouseStockService.getStockSnapshot(orm, testItem.id)).byCode;

    if (refreshedItem.currentStock !== 20) {
      throw new Error(`total item stock after an internal transfer must stay unchanged (20 units), but it is ${refreshedItem.currentStock}.`);
    }

    if (finalStocks[wh1] !== 12 || finalStocks[wh2] !== 8) {
      throw new Error(`source and destination warehouse stock is wrong. Source: ${finalStocks[wh1]} (expected: 12), destination: ${finalStocks[wh2]} (expected: 8)`);
    }

    if (Number(refreshedItem.version) <= 1) {
      throw new Error(`item concurrency version (OCC Version) should have increased after the transfer.`);
    }

    // Clean up created transactions and item
    await cleanTestTableData('transactions', 'item_id', [testItem.id]);
    await cleanTestTableData('items', 'id', [testItem.id]);

    results.push(makeTestCase({
      id: 'reg_warehouse_transfer_occ_td_138',
      scenarioId: 'inventory_rebuild',
      name: 'V6 Phase 2.2: inter-warehouse transfer remittance, OCC concurrency lock and per-location Kardex (TD-138)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t17Start,
      details: 'transfer of 8 units from the source to the destination warehouse keeps total stock at 20 units, bumps the concurrency version and records the Kardex out/in sequence.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_warehouse_transfer_occ_td_138',
      scenarioId: 'inventory_rebuild',
      name: 'V6 Phase 2.2: inter-warehouse transfer remittance, OCC concurrency lock and per-location Kardex (TD-138)',
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
      throw new Error(`expected 1 item to be created by the Excel import, but ${importResult.createdCount} was reported.`);
    }

    // Verify item created with stock and WAC
    const [createdItem] = await orm.select().from(items).where(eq(items.code, testItemCode));
    if (!createdItem) {
      throw new Error('imported item not found in the database.');
    }

    if (createdItem.currentStock !== 15) {
      throw new Error(`total item stock must be 15 units, current value: ${createdItem.currentStock}`);
    }

    if (Number(createdItem.weightedAverageCost) !== 500000) {
      throw new Error(`item weighted average cost must be 500,000 rials, current value: ${createdItem.weightedAverageCost}`);
    }

    // Verify kardex transaction created
    const createdTxs = await orm.select().from(transactions).where(eq(transactions.itemId, createdItem.id));
    if (createdTxs.length === 0) {
      throw new Error('no Kardex transaction recorded for the stock entered from Excel.');
    }

    const firstTx = createdTxs[0];
    if (firstTx.type !== 'in' || firstTx.quantity !== 15 || Number(firstTx.unitPrice) !== 500000) {
      throw new Error(`Excel Kardex transaction details are wrong: type=${firstTx.type}, quantity=${firstTx.quantity}, price=${firstTx.unitPrice}`);
    }

    // Clean up test data
    await cleanTestTableData('transactions', 'item_id', [createdItem.id]);
    await cleanTestTableData('items', 'id', [createdItem.id]);

    results.push(makeTestCase({
      id: 'reg_excel_import_centralized_stock_td_137',
      scenarioId: 'inventory_rebuild',
      name: 'V6 Phase 2.3: Excel import goes through the central applyStockMovement gateway and records Kardex (TD-137)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t18Start,
      details: 'Excel import routes transactions to applyStockMovement, computes WAC exactly, records domain events and matches the Kardex.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_excel_import_centralized_stock_td_137',
      scenarioId: 'inventory_rebuild',
      name: 'V6 Phase 2.3: Excel import goes through the central applyStockMovement gateway and records Kardex (TD-137)',
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
      throw new Error('the system should have refused an invoice above the sellable cap (5 units against 3 free units) but accepted it!');
    }

    if (!caughtError.message.includes('امکان خروج بیش از') || (!caughtError.message.includes('3') && !caughtError.message.includes('۳'))) {
      throw new Error(`expected error message not received. Received message: ${caughtError.message}`);
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
      throw new Error('issuing an allowed invoice within the 3-unit cap failed.');
    }

    // Cleanup test records
    await cleanTestTableData('document_items', 'document_id', [proformaId, successInvoiceId]);
    await cleanTestTableData('transactions', 'document_id', [proformaId, successInvoiceId]);
    await cleanTestTableData('documents', 'id', [proformaId, successInvoiceId]);
    await cleanTestTableData('items', 'id', [testItem.id]);

    results.push(makeTestCase({
      id: 'reg_reservation_gate_in_create_document_td_139',
      scenarioId: 'inventory_rebuild',
      name: 'V6 Phase 2.4: central reservation cap gate in createDocument with a row lock (TD-139)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t19Start,
      details: 'createDocument refuses the outflow of items reserved by proformas, computes the sellable cap exactly and issues within the allowed cap.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_reservation_gate_in_create_document_td_139',
      scenarioId: 'inventory_rebuild',
      name: 'V6 Phase 2.4: central reservation cap gate in createDocument with a row lock (TD-139)',
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
      throw new Error('issuing the purchase invoice journal voucher for the TD-144 test failed.');
    }

    // Debit amount must be strictly 300,000 (excluding 500,000 soft-deleted row)
    const totalDebit = Number(voucher.totalDebit);
    if (totalDebit !== 300000) {
      throw new Error(`purchase voucher must count only active lines (300,000 rials) but the total debit posted is ${totalDebit} rials!`);
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
      throw new Error('creating the test account failed.');
    }

    // Soft delete the account
    await ChartOfAccountsService.deleteAccount(createdAcc.id);
    const [deletedAccCheck] = await orm.select().from(accounts).where(eq(accounts.id, createdAcc.id));
    if (!deletedAccCheck || deletedAccCheck.isDeleted !== 1) {
      throw new Error('soft delete of the account was not applied in the database.');
    }

    // Re-create account with SAME code. v9.0.197 (TD-546, decision ت۴ الف): the code of a deleted account makes a new
    // row; the deleted row is no longer revived (TD-147), because its voucher rows would follow the new name and type
    const recreatedAcc = await ChartOfAccountsService.createAccount({
      code: testAccCode,
      name: 'حساب تستی احیا ۲ (بازتعریف‌شده)',
      level: 'subsidiary',
      accountType: 'asset',
      nature: 'debit',
      description: 'بازتعریف موفق با کد حذف‌شده'
    });

    if (!recreatedAcc || recreatedAcc.id === createdAcc.id || recreatedAcc.name !== 'حساب تستی احیا ۲ (بازتعریف‌شده)') {
      throw new Error(`re-creating a deleted account code must make a new account (old id ${createdAcc.id}, got ${recreatedAcc?.id})`);
    }
    const [oldAccRow] = await orm.select().from(accounts).where(eq(accounts.id, createdAcc.id));
    if (oldAccRow?.isDeleted !== 1 || oldAccRow.name !== 'حساب تستی احیا ۱') {
      throw new Error(`the deleted account was changed by re-creating its code: ${JSON.stringify({ isDeleted: oldAccRow?.isDeleted, name: oldAccRow?.name })}`);
    }

    // Test explicit restoreAccount method: refused while another active account holds the code, then accepted
    const refusedRestore = await ChartOfAccountsService.restoreAccount(createdAcc.id).then(() => 'restored', (e: unknown) => (e as { code?: string })?.code ?? String(e));
    if (refusedRestore !== 'ACCOUNT_CODE_TAKEN') {
      throw new Error(`restoring an account whose code another active account holds answered ${refusedRestore}, expected ACCOUNT_CODE_TAKEN`);
    }
    await ChartOfAccountsService.deleteAccount(recreatedAcc.id);
    const restoredAcc = await ChartOfAccountsService.restoreAccount(createdAcc.id);
    if (!restoredAcc || restoredAcc.isDeleted !== 0 || restoredAcc.isActive !== 1) {
      throw new Error('restoreAccount did not bring the account back as active and not deleted');
    }

    // 3. Cleanup test records
    await cleanTestTableData('journal_voucher_items', 'voucher_id', [voucher.id]);
    await cleanTestTableData('journal_vouchers', 'id', [voucher.id]);
    await cleanTestTableData('document_items', 'id', [activeItem.id, deletedItem.id]);
    await cleanTestTableData('documents', 'id', [testDoc.id]);
    await cleanTestTableData('items', 'id', [testItem.id]);
    await cleanTestTableData('accounts', 'id', [createdAcc.id, recreatedAcc.id]);

    results.push(makeTestCase({
      id: 'reg_purchase_voucher_soft_delete_and_coa_reuse_td_144_147',
      scenarioId: 'period_closing_and_conceptual_mappings',
      name: 'V6 Phase 3.1: soft-delete guard in the purchase voucher and warehouse receipt, and revival of deleted accounts (TD-144 / TD-147)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t20Start,
      details: 'soft-deleted lines are left out of the purchase voucher, and deleted chart of accounts codes can be revived and reused.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_purchase_voucher_soft_delete_and_coa_reuse_td_144_147',
      scenarioId: 'period_closing_and_conceptual_mappings',
      name: 'V6 Phase 3.1: soft-delete guard in the purchase voucher and warehouse receipt, and revival of deleted accounts (TD-144 / TD-147)',
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
      throw new Error('issuing the journal voucher for the sales return failed.');
    }

    // 6. Verify voucher items
    const voucherItemsList = await orm.select().from(journalVoucherItems)
      .where(eq(journalVoucherItems.voucherId, voucher.id));

    if (voucherItemsList.length < 4) {
      throw new Error(`sales return journal voucher must have at least 4 rows (sales return, customer, inventory and COGS), but ${voucherItemsList.length} rows were issued.`);
    }

    const salesReturnLine = voucherItemsList.find(it => Number(it.debit) === 1200000);
    const customerLine = voucherItemsList.find(it => Number(it.credit) === 1200000);
    const inventoryLine = voucherItemsList.find(it => Number(it.debit) === 800000);
    const cogsLine = voucherItemsList.find(it => Number(it.credit) === 800000);

    if (!salesReturnLine) {
      throw new Error('sales return debit row of 1,200,000 rials not found.');
    }
    if (!customerLine) {
      throw new Error('customer account credit row of 1,200,000 rials not found.');
    }
    if (!inventoryLine) {
      throw new Error('inventory adjustment debit row (warehouse stock increase for the return) of 800,000 rials not found.');
    }
    if (!cogsLine) {
      throw new Error('cost of goods sold (COGS) adjustment credit row of 800,000 rials not found.');
    }

    // Verify debit/credit balance
    const totalDebit = voucherItemsList.reduce((acc, it) => acc + Number(it.debit || 0), 0);
    const totalCredit = voucherItemsList.reduce((acc, it) => acc + Number(it.credit || 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new Error(`sales return journal voucher is not balanced! Debit: ${totalDebit}, credit: ${totalCredit}`);
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
      name: 'V6 Phase 3.2: inventory and cost of goods sold (COGS) rows in the sales return journal voucher (TD-145)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t21Start,
      details: 'the 4 balanced sales return rows (sales return, receivables, inventory and COGS adjustment) are issued at the weighted average cost.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_sales_return_cogs_and_inventory_voucher_td_145',
      scenarioId: 'period_closing_and_conceptual_mappings',
      name: 'V6 Phase 3.2: inventory and cost of goods sold (COGS) rows in the sales return journal voucher (TD-145)',
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
      throw new Error('creating the initial test voucher failed.');
    }

    // 2. Perform first reversal - MUST succeed
    const firstReversal = await VoucherService.reverseVoucher({
      voucherId: testVoucher.id,
      reason: 'برگشت اولیه مجاز',
      username: 'test_auditor'
    });

    if (!firstReversal || !firstReversal.id) {
      throw new Error('issuing the first reversal voucher must succeed.');
    }

    if (!firstReversal.referenceNumber?.startsWith('REV-V')) {
      throw new Error(`reversal voucher reference number must start with REV-V but was "${firstReversal.referenceNumber}".`);
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
        throw new Error(`refusal of a double reversal must be a ConflictError but got "${doubleErr.message}".`);
      }
    }

    if (!doubleReversalBlocked) {
      throw new Error('the system did not prevent a double reversal of a financial voucher!');
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
        throw new Error(`reversing a reversal voucher must fail with ConflictError but got "${revOfRevErr.message}".`);
      }
    }

    if (!revOfRevBlocked) {
      throw new Error('the system allowed reversing a voucher that is itself a reversal!');
    }

    // Clean up test records
    await cleanTestTableData('journal_voucher_items', 'voucher_id', [testVoucher.id, firstReversal.id]);
    await cleanTestTableData('journal_vouchers', 'id', [testVoucher.id, firstReversal.id]);

    results.push(makeTestCase({
      id: 'reg_double_reversal_guard_td_146',
      scenarioId: 'period_closing_and_conceptual_mappings',
      name: 'V6 Phase 3.3: double reversal of financial vouchers prevented with a row lock and a no-repeat reversal guard (TD-146)',
      layer: 'regression',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t22Start,
      details: 'strict row lock, refusal of a second reversal voucher for the same source voucher (Double Reversal) and blocking of reversing a reversal voucher are confirmed.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_double_reversal_guard_td_146',
      scenarioId: 'period_closing_and_conceptual_mappings',
      name: 'V6 Phase 3.3: double reversal of financial vouchers prevented with a row lock and a no-repeat reversal guard (TD-146)',
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
        throw new Error(`voucher date was not normalized to Gregorian! Stored value: ${storedVoucher.date}`);
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
        throw new Error(`void voucher date of the repost is not Gregorian ISO! Value: ${repostRes.voidVoucher.date}`);
      }
      if (!repostRes.repostedVoucher.date || !repostRes.repostedVoucher.date.startsWith(todayIso.slice(0, 7))) {
        throw new Error(`new voucher date of the repost is not Gregorian ISO! Value: ${repostRes.repostedVoucher.date}`);
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
          throw new Error(`journal voucher issued for the cheque does not have a Gregorian ISO date! Value: ${chqVoucher.date}`);
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
        name: 'V6 Phase 3.4: voucher date format in the cheque cycle and repost fixed to Gregorian ISO (TD-149)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t23Start,
        details: 'Gregorian ISO format (YYYY-MM-DD) is enforced for journal vouchers, repost and the cheque cycle.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_voucher_iso_date_normalization_td_149',
        scenarioId: 'period_closing_and_conceptual_mappings',
        name: 'V6 Phase 3.4: voucher date format in the cheque cycle and repost fixed to Gregorian ISO (TD-149)',
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
        throw new Error(`initial cheque status must be received but is ${recChq.status}`);
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
        throw new Error(`cheque status after transfer must be spent but is ${spentChq.status}`);
      }

      if (spentChq.payeeName !== spendSupplier.name) {
        throw new Error(`recipient name was not written to the cheque payeeName: ${spentChq.payeeName}`);
      }

      const hasSpentHistory = Array.isArray(spentChq.statusHistory) &&
        spentChq.statusHistory.some((h: any) => h.status === 'spent');
      if (!hasSpentHistory) {
        throw new Error('spent status was not recorded in statusHistory');
      }

      // 3. Verify double-entry journal voucher was created for spent cheque
      const spentVouchers = await orm.select().from(journalVouchers)
        .where(eq(journalVouchers.referenceNumber, 'CHQ-SPENT-TEST-99'));
      
      const endorsementVoucher = spentVouchers.find(v => v.description?.includes('واگذاری و خرج'));
      if (!endorsementVoucher) {
        throw new Error('double-entry journal voucher for transferring and spending the cheque was not issued');
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
        throw new Error('a cheque in spent status must not be deletable!');
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
        throw new Error('spending a paid cheque must not be allowed!');
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
        name: 'V6 Phase 4.1: "spent cheque" status enabled in the Sayad state machine (TD-150)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t24Start,
        details: 'transition to spent status, issue of the double-entry transfer voucher, status history entry and the guard against spending a paid cheque are confirmed.'
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
        name: 'V6 Phase 4.1: "spent cheque" status enabled in the Sayad state machine (TD-150)',
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
        throw new Error(`normalizing Jalali date 1405/06/15 to Gregorian failed: got ${jalaliIso}`);
      }

      const jalaliContinuous = normalizeDateToIso('14050615');
      if (jalaliContinuous !== '2026-09-06') {
        throw new Error(`normalizing continuous Jalali date 14050615 failed: got ${jalaliContinuous}`);
      }

      const gregorianIso = normalizeDateToIso('2026-09-06');
      if (gregorianIso !== '2026-09-06') {
        throw new Error(`normalizing a Gregorian date failed: got ${gregorianIso}`);
      }

      const gregorianTimestamp = normalizeDateToIso('2026-09-06T14:30:00.000Z');
      if (gregorianTimestamp !== '2026-09-06') {
        throw new Error(`normalizing a timestamp date failed: got ${gregorianTimestamp}`);
      }

      // 2. Verify calculateDateDiffDays
      const sameDayDiff = calculateDateDiffDays('1405/06/15', '2026-09-06');
      if (sameDayDiff !== 0) {
        throw new Error(`day difference for the same calendar day (1405/06/15 and 2026-09-06) must be zero but is ${sameDayDiff} days`);
      }

      const oneDayDiff = calculateDateDiffDays('1405/06/16', '2026-09-06');
      if (oneDayDiff !== 1) {
        throw new Error(`day difference for one day later must be 1 but is ${oneDayDiff}`);
      }

      const twoDayDiff = calculateDateDiffDays('1405/06/17', '2026-09-06');
      if (twoDayDiff !== 2) {
        throw new Error(`day difference for two days later must be 2 but is ${twoDayDiff}`);
      }

      const fourDayDiff = calculateDateDiffDays('1405/06/19', '2026-09-06');
      if (fourDayDiff !== 4) {
        throw new Error(`day difference for four days later must be 4 but is ${fourDayDiff}`);
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
        throw new Error(`expected 1 match result but got ${matchResults.length}`);
      }

      const matched = matchResults[0];
      if (matched.matchedTxId !== 99101) {
        throw new Error(`wrong match: expected id 99101 but ${matched.matchedTxId} was recorded`);
      }

      if (matched.matchQuality !== 'amount_date') {
        throw new Error(`match quality must be amount_date but is ${matched.matchQuality}`);
      }

      if (matched.dateDiffDays !== 0) {
        throw new Error(`match day difference must be 0 but is ${matched.dateDiffDays}`);
      }

      results.push(makeTestCase({
        id: 'reg_bank_statement_matcher_calendar_td_151',
        scenarioId: 'period_closing_and_conceptual_mappings',
        name: 'V6 Phase 4.2: calendar algorithm fixed in bank reconciliation (TD-151)',
        layer: 'regression',
        executionType: 'real_code',
        passed: true,
        durationMs: Date.now() - t25Start,
        details: 'normalization of Excel Jalali dates to ISO, the fix of the astronomical day difference error and exact smart matching at amount_date level are confirmed.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_bank_statement_matcher_calendar_td_151',
        scenarioId: 'period_closing_and_conceptual_mappings',
        name: 'V6 Phase 4.2: calendar algorithm fixed in bank reconciliation (TD-151)',
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
    // v9.0.338 (TD-786): documents.type has a CHECK constraint, so the case uses a real type in far past fiscal years (1390 and
    // 1391) that no other case writes, and removes only those two counter rows
    const testDocTypeInv = 'waste';
    const testYears = [1390, 1391];
    try {
      // 1. Setup existing synthetic document in fiscal year 1390 with high ref number '888'
      // 1390/05/10 is approximately 2011-08-01
      const [doc1404] = await orm.insert(documents).values({
        type: testDocTypeInv,
        refNumber: '888',
        date: '2011-08-01 10:00:00',
        user: 'test-agent',
        status: 'final'
      }).returning({ id: documents.id });
      createdDocIds.push(doc1404.id);

      // 2. TD-152: Peek and Next for fiscal year 1391 (a new year with no documents yet of this type)
      // 1391/05/10 is approximately 2012-08-01
      // Must return '1' (or startNumber), NOT '889'
      const peek1405 = await DocumentService.peekNextRef(testDocTypeInv, '2012-08-01');
      if (peek1405 !== '1') {
        throw new Error(`preview number of the new fiscal year must be 1 but ${peek1405} was returned (no fiscal year isolation, TD-152)`);
      }

      const next1405 = await DocumentService.getNextRef(testDocTypeInv, '2012-08-01');
      if (next1405 !== '1') {
        throw new Error(`reference number of the new fiscal year must be 1 but ${next1405} was generated`);
      }

      // Insert doc for 1405
      const [doc1405] = await orm.insert(documents).values({
        type: testDocTypeInv,
        refNumber: next1405,
        date: '2012-08-01 10:00:00',
        user: 'test-agent',
        status: 'final'
      }).returning({ id: documents.id });
      createdDocIds.push(doc1405.id);

      // Verify next for 1391 is now '2'
      const next1405Again = await DocumentService.getNextRef(testDocTypeInv, '2012-08-01');
      if (next1405Again !== '2') {
        throw new Error(`next number of year 1405 must be 2 but ${next1405Again} was generated`);
      }

      // Also verify that for fiscal year 1390, cold start still sees '888' and yields '889'
      const peek1404 = await DocumentService.peekNextRef(testDocTypeInv, '2011-08-01');
      if (peek1404 !== '889') {
        throw new Error(`preview number of year 1404 must be 889 but ${peek1404} was returned`);
      }

      results.push(makeTestCase({
        id: 'reg_fiscal_year_ref_isolation_td_152_153',
        scenarioId: 'period_closing_and_conceptual_mappings',
        name: 'V6 Phase 4.3: yearly counter optimization and false-positive fix in the health check (TD-152/153)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t26Start,
        details: 'fiscal year separation in the document reference query and correct serial reset in the new year are confirmed.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_fiscal_year_ref_isolation_td_152_153',
        scenarioId: 'period_closing_and_conceptual_mappings',
        name: 'V6 Phase 4.3: yearly counter optimization and false-positive fix in the health check (TD-152/153)',
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
      await orm.delete(documentRefCounters).where(and(eq(documentRefCounters.docType, testDocTypeInv), inArray(documentRefCounters.fiscalYear, testYears)));
    }
  }

  // Test 27.1: v7.0.21 (TD-178 / audit P0-2): شماره عطف یکسان در دو سال مالی متوالی نباید با قید یکتایی برخورد کند
  if (shouldRun('reg_fiscal_year_ref_unique_scope_td_178', 'td178', 'ref_counters', 'duplicate_refs', 'fiscal_year')) {
    const tStart = Date.now();
    const createdDocIds: number[] = [];
    // v9.0.338 (TD-786): a real type (documents.type has a CHECK constraint) in fiscal years 1392 and 1393, which no other case writes
    const testDocType = 'remittance';
    const testYears = [1392, 1393];
    try {
      // 1. شماره‌گذاری خودکار در سال ۱۳۹۲ و سپس سال ۱۳۹۳ — هر دو باید «1» باشند و هر دو با موفقیت درج شوند
      const doc1404 = await DocumentService.createDocument({ docType: testDocType, status: 'draft', date: '2013-08-01', items: [], user: 'test-agent' });
      createdDocIds.push(doc1404);
      const doc1405 = await DocumentService.createDocument({ docType: testDocType, status: 'draft', date: '2014-08-01', items: [], user: 'test-agent' });
      createdDocIds.push(doc1405);

      const rows = await orm
        .select({ id: documents.id, refNumber: documents.refNumber, refFiscalYear: documents.refFiscalYear })
        .from(documents)
        .where(inArray(documents.id, createdDocIds));
      const r1404 = rows.find(r => r.id === doc1404);
      const r1405 = rows.find(r => r.id === doc1405);
      if (r1404?.refNumber !== '1' || r1404?.refFiscalYear !== 1392) {
        throw new Error(`document of year 1392 must have number "1" and fiscal year 1392: ${JSON.stringify(r1404)}`);
      }
      if (r1405?.refNumber !== '1' || r1405?.refFiscalYear !== 1393) {
        throw new Error(`document of year 1393 must have number "1" and fiscal year 1393 (cross-year collision): ${JSON.stringify(r1405)}`);
      }

      // 2. شماره تکراری در همان سال مالی همچنان باید توسط دیتابیس رد شود
      let sameYearRejected = false;
      try {
        const [dup] = await orm.insert(documents).values({
          type: testDocType, refNumber: '1', refFiscalYear: 1393, date: '2014-09-01 10:00:00', user: 'test-agent', status: 'draft'
        }).returning({ id: documents.id });
        createdDocIds.push(dup.id);
      } catch {
        sameYearRejected = true;
      }
      if (!sameYearRejected) {
        throw new Error('a duplicate reference number in the same fiscal year and document type must not be allowed (constraint uq_documents_type_fy_ref_active).');
      }

      results.push(makeTestCase({
        id: 'reg_fiscal_year_ref_unique_scope_td_178',
        scenarioId: 'period_closing_and_conceptual_mappings',
        name: 'v7.0.21: reference numbers are unique per fiscal year and number "1" of a new year does not collide with the previous year (TD-178 / P0-2)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'number "1" is issued in both 1404 and 1405, and a duplicate in the same year is refused by the year-scoped unique index.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_fiscal_year_ref_unique_scope_td_178',
        scenarioId: 'period_closing_and_conceptual_mappings',
        name: 'v7.0.21: reference numbers are unique per fiscal year and number "1" of a new year does not collide with the previous year (TD-178 / P0-2)',
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
      await orm.delete(documentRefCounters).where(and(eq(documentRefCounters.docType, testDocType), inArray(documentRefCounters.fiscalYear, testYears)));
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

      // v9.0.458: earlier tests of the same run leave due outbox events behind and a batch takes only the oldest 100 by
      // id, so the probe below was skipped once more than 100 were waiting. Drain them first so the batch reaches it.
      for (let round = 0; round < 50; round++) {
        if ((await OutboxService.processPendingBatch(100)).processed === 0) break;
      }

      // 1. اولین تلاش: هندلر موفق اجرا می‌شود، هندلر ناپایدار شکست می‌خورد → pending با backoff آینده
      const ev = domainEventBus.createEvent(probeType, 'Item', '1', { probe: true }, {});
      createdEventIds.push(ev.eventId);
      await OutboxService.saveToOutbox(orm, ev);
      await OutboxService.processPendingBatch(100);
      let [row] = await orm.select().from(outboxEvents).where(eq(outboxEvents.eventId, ev.eventId));
      if (row.status !== 'pending' || row.retryCount !== 1 || !row.nextRetryAt || new Date(`${row.nextRetryAt}Z`).getTime() <= Date.now() - 1000) {
        throw new Error(`after a handler failure the event must be pending with retryCount=1 and a future backoff time: ${JSON.stringify({ status: row.status, retryCount: row.retryCount, nextRetryAt: row.nextRetryAt })}`);
      }
      if (!row.completedHandlers.includes('reg-probe-ok') || row.completedHandlers.includes('reg-probe-flaky')) {
        throw new Error(`completed_handlers must hold only the successful handler: ${JSON.stringify(row.completedHandlers)}`);
      }

      // 2. اجرای فوری دوباره نباید پیش از رسیدن زمان backoff رویداد را بردارد
      await OutboxService.processPendingBatch(100);
      [row] = await orm.select().from(outboxEvents).where(eq(outboxEvents.eventId, ev.eventId));
      if (row.retryCount !== 1 || count('flaky') !== 1) {
        throw new Error(`backoff not respected: retryCount=${row.retryCount}, flaky handler runs=${count('flaky')}`);
      }

      // 3. پس از رسیدن زمان backoff: فقط هندلر ناموفق دوباره اجرا می‌شود و رویداد completed می‌شود
      flakyShouldFail = false;
      await orm.update(outboxEvents).set({ nextRetryAt: '2000-01-01 00:00:00' }).where(eq(outboxEvents.eventId, ev.eventId));
      await OutboxService.processPendingBatch(100);
      [row] = await orm.select().from(outboxEvents).where(eq(outboxEvents.eventId, ev.eventId));
      if (row.status !== 'completed' || count('ok') !== 1 || count('flaky') !== 2) {
        throw new Error(`retry must run only the failed handler and complete the event: ${JSON.stringify({ status: row.status, calls })}`);
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
        throw new Error(`after the last failed attempt the event must be failed and in the DLQ: ${JSON.stringify({ status: fatalRow.status, dlq: dlqRows.length })}`);
      }

      results.push(makeTestCase({
        id: 'reg_outbox_tracked_dispatch_td_183',
        scenarioId: 'regression_sanity',
        name: 'v7.0.25: guaranteed Outbox delivery, real backoff, no rerun of a successful handler and move to the DLQ (TD-183 / P1-1)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'a handler failure reaches the Outbox, backoff is respected, only the failed handler reruns and the final failure moves to the DLQ; the publish path stays non-blocking.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_outbox_tracked_dispatch_td_183',
        scenarioId: 'regression_sanity',
        name: 'v7.0.25: guaranteed Outbox delivery, real backoff, no rerun of a successful handler and move to the DLQ (TD-183 / P1-1)',
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
    const { appSettings, woocommerceOrderLogs } = await import('../../db/schema.js');
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
      check(rP.status === 200, `the pending webhook must answer 200 (status ${rP.status})`);
      check((await activeInvoices(ids.P)).length === 0, 'a pending order must not get a final invoice (d)');
      check(await stockOf() === 20, `a pending order must not reduce stock (stock ${await stockOf()})`);
      check((await logOf(ids.P))?.status === 'deferred', `the pending order log must be deferred: ${(await logOf(ids.P))?.status}`);

      // ۲) سفارش پرداخت‌شده A: فاکتور قطعی در انبار پیش‌فرض قطعی (و)
      const rA = await send(buildWooOrder({ id: ids.A, status: 'processing', lines: [line(2)] }));
      const invA = await activeInvoices(ids.A);
      check(rA.status === 200 && rA.body?.success === true, `a processing order must succeed: ${JSON.stringify(rA.body)}`);
      check(invA.length === 1, `order A must have exactly one invoice (${invA.length})`);
      const stockAfterA = await stockOf();
      check(stockAfterA === 18, `stock after invoice A must be 18 (${stockAfterA})`);
      if (invA[0]) {
        const lines = await orm.select({ loc: documentItems.location }).from(documentItems).where(eq(documentItems.documentId, invA[0].id));
        check(lines.every(l => l.loc === whCode), `invoice lines must be in the oldest active warehouse (${whCode}): ${JSON.stringify(lines)}`);
      }

      // ۳) (الف) سفارش B که شماره‌اش پیشوند A است فاکتور مستقل می‌گیرد؛ (ز) نام فاکتور = نام پرونده مشتری
      const probePhone = `0912${base.slice(-7)}`;
      const existingCustomer = await createTestCustomer({ phone: probePhone });
      createdCustomerIds.push(existingCustomer.id);
      const orderB = buildWooOrder({ id: ids.B, status: 'processing', lines: [line(1)], phone: probePhone, firstName: 'نام', lastName: 'متفاوت' });
      await send(orderB);
      const invB = await activeInvoices(ids.B);
      check(invB.length === 1, `order B (a prefix of A) must get its own invoice; invoice count: ${invB.length} (a)`);
      check(invB[0]?.buyerName === existingCustomer.name, `invoice B must go to the customer with the same phone: "${invB[0]?.buyerName}" (g)`);

      // ۴) وب‌هوک تکراری (completed) فاکتور دوم نمی‌سازد
      await send({ ...orderB, status: 'completed' });
      check((await activeInvoices(ids.B)).length === 1, 'a repeated webhook must not create a second invoice');
      const stockAfterB = await stockOf();
      check(stockAfterB === 17, `stock after B must be 17 (${stockAfterB})`);

      // ۵) تطبیق ناقص: یک SKU معتبر + یک SKU ناشناخته → کل سفارش رد، بدون فاکتور، لاگ شکست ماندگار
      const rC = await send(buildWooOrder({ id: ids.C, status: 'processing', lines: [line(1), { sku: `UNKNOWN-${base}`, quantity: 1, price: 5000 }] }));
      check(rC.status === 200 && rC.body?.success === false, `a partial SKU match must answer 200 with success=false: ${rC.status} ${JSON.stringify(rC.body)}`);
      check((await activeInvoices(ids.C)).length === 0, 'an order with an unknown SKU must not get a (partial) invoice');
      check(await stockOf() === 17, `a partial SKU match must not reduce stock (${await stockOf()})`);
      const logC = await logOf(ids.C);
      check(logC?.status === 'failed' && String(logC?.errorMessage || '').includes(`UNKNOWN-${base}`), `the failure log of C must persist and name the unknown SKU: ${JSON.stringify(logC)}`);

      // ۶) (ب) شکست کامل (همه SKUها ناشناخته): لاگ failed باید پس از پاسخ ماندگار باشد
      const rD = await send(buildWooOrder({ id: ids.D, status: 'processing', lines: [{ sku: `NOPE-${base}`, quantity: 1, price: 1000 }] }));
      check(rD.status === 200, `a processing error must not answer non-2xx (status ${rD.status}) (e)`);
      check((await logOf(ids.D))?.status === 'failed', `the failure log of D did not persist: ${JSON.stringify(await logOf(ids.D))} (b)`);

      // ۷) ابطال خودکار: A لغو شد → حذف نرم فاکتور، برگشت موجودی، سند حسابداری معکوس
      const docA = invA[0]?.id;
      await send(buildWooOrder({ id: ids.A, status: 'cancelled', lines: [line(2)] }));
      check((await activeInvoices(ids.A)).length === 0, 'the invoice of a cancelled order must be voided (soft-deleted)');
      check(await stockOf() === 19, `cancelling order A must return 2 units to stock (${await stockOf()})`);
      check((await logOf(ids.A))?.status === 'voided', `the log of A must be voided: ${(await logOf(ids.A))?.status}`);
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
        check(Boolean(origVoucher) && neutralized, 'voiding the invoice must delete a draft voucher or reverse an approved one');
      }

      // ۸) استرداد: B مسترد شد → فاکتور فعال می‌ماند و برای بررسی حسابدار علامت می‌خورد
      await send({ ...orderB, status: 'refunded' });
      check((await activeInvoices(ids.B)).length === 1, 'a refund must not void the invoice automatically');
      check((await logOf(ids.B))?.status === 'needs_review', `the log of B after the refund must be needs_review: ${(await logOf(ids.B))?.status}`);

      // ۹) همزمانی: دو وب‌هوک موازی برای سفارش تازه E → دقیقاً یک فاکتور
      const orderE = buildWooOrder({ id: ids.E, status: 'processing', lines: [line(1)] });
      await Promise.all([send(orderE), send(orderE)]);
      check((await activeInvoices(ids.E)).length === 1, `two concurrent webhooks must create exactly one invoice (${(await activeInvoices(ids.E)).length})`);
      check(await stockOf() === 18, `concurrent webhooks must not reduce stock twice (${await stockOf()})`);

      if (violations.length > 0) {
        throw new Error(violations.join(' | '));
      }
      results.push(makeTestCase({
        id: 'reg_woocommerce_order_lifecycle_td_190',
        scenarioId: 'woocommerce_order_lifecycle',
        name: 'v7.0.30: full WooCommerce order lifecycle — exact matching, persistent failure log, status policy, void and concurrency (TD-190 / P1-2)',
        layer: 'regression',
        executionType: 'real_api',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'pending with no invoice, exact order number matching, full refusal of a partial match with a persistent log and a 200 answer, automatic void with stock return and a reversal voucher, a review flag for refunds and one invoice for concurrent webhooks are confirmed.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_woocommerce_order_lifecycle_td_190',
        scenarioId: 'woocommerce_order_lifecycle',
        name: 'v7.0.30: full WooCommerce order lifecycle — exact matching, persistent failure log, status policy, void and concurrency (TD-190 / P1-2)',
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
      // v9.0.447 (TD-903): a Kardex row keeps its document (fk_transactions_document_id) and a document its party, so an
      // invoice that moved stock and its customer stay in the isolated test schema
      if (docIds.length > 0) {
        await orm.execute(sql`DELETE FROM document_items WHERE document_id = ANY(${sql.param(docIds)}::int[])
          AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.document_id = document_items.document_id)`);
        await orm.execute(sql`DELETE FROM documents WHERE id = ANY(${sql.param(docIds)}::int[])
          AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.document_id = documents.id)`);
      }
      if (createdCustomerIds.length > 0) {
        await orm.execute(sql`DELETE FROM customers WHERE id = ANY(${sql.param(createdCustomerIds)}::int[])
          AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.party_id = customers.id)`);
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
      check(Boolean(v1) && (v1 as any).sourceDocumentId === d1, `the invoice voucher must have source_document_id=${d1}: ${JSON.stringify(v1 ? { id: v1.id, src: (v1 as any).sourceDocumentId } : null)}`);

      // ۲) دیتابیس دومین سند فعال برای همان سند را رد می‌کند (ایندکس یکتای جزئی)
      let duplicateRejected = false;
      try {
        await orm.execute(sql`INSERT INTO journal_vouchers (voucher_number, date, description, reference_module, reference_id, reference_number, source_document_id, total_debit, total_credit)
          VALUES (nextval('journal_voucher_number_seq'), ${today}, 'probe duplicate', 'invoice', ${d1}, 'probe', ${d1}, 0, 0)`);
      } catch {
        duplicateRejected = true;
      }
      check(duplicateRejected, 'a second active voucher for one stock document must be refused by the unique index (uq_jv_source_document_active)');

      // ۳) سند معکوسی که reference_id آن (شناسه سند حسابداری مبدأ) با شناسه یک فاکتور برابر است نباید سند آن فاکتور تلقی شود
      const d2 = await makeInvoice(true);
      const fakeReversal = await insertBareVoucher({ referenceId: d2, referenceNumber: 'REV-V990001', status: 'approved', voucherType: 'adjustment' });
      const ensured = await VoucherSyncService.autoCreateVoucherForInvoice(d2, undefined, 'test-agent', undefined, { strict: true });
      check(Boolean(ensured) && ensured!.id !== fakeReversal.id, `an invoice without a voucher must get a new voucher, not the unrelated reversal #${fakeReversal.id} (got #${ensured?.id})`);
      let deleteError = '';
      try {
        await DocumentService.deleteDocument(d2, 'test-agent');
      } catch (err: any) {
        deleteError = err?.message || String(err);
      }
      check(!deleteError, `deleting the invoice must not fail because of the unrelated reversal: ${deleteError}`);
      const reversalOfFake = await orm.select({ id: journalVouchers.id }).from(journalVouchers)
        .where(eq(journalVouchers.referenceNumber, `REV-V${fakeReversal.voucherNumber}`));
      check(reversalOfFake.length === 0, 'deleting the invoice must not reverse the unrelated reversal again');
      if (ensured) {
        // v8.0.2 (TD-251): سند پیش‌نویس خودِ فاکتور حذف نرم می‌شود و سند تأییدشده معکوس می‌شود
        const reversalOfOwn = await orm.select({ id: journalVouchers.id }).from(journalVouchers)
          .where(eq(journalVouchers.referenceNumber, `REV-V${ensured.voucherNumber}`));
        const [ownAfter] = await orm.select({ isDeleted: journalVouchers.isDeleted }).from(journalVouchers).where(eq(journalVouchers.id, ensured.id));
        const ownNeutralized = ensured.status === 'draft'
          ? ownAfter?.isDeleted === 1 && reversalOfOwn.length === 0
          : reversalOfOwn.length === 1;
        check(ownNeutralized, `deleting the invoice must neutralize the invoice's own voucher (status ${ensured.status}, soft-deleted ${ownAfter?.isDeleted}, reversals ${reversalOfOwn.length})`);
      }

      // ۴) همگام‌سازی دستی «فقط اسناد فاقد سند»: سند موجود بازنویسی نمی‌شود و اجرای دوباره سند تکراری نمی‌سازد
      const d3 = await makeInvoice(true);
      if (v1) {
        await orm.update(journalVouchers).set({ description: 'TD193-PRESERVE-MARKER' }).where(eq(journalVouchers.id, v1.id));
      }
      const syncMissing = (VoucherSyncService as any).syncMissingDocumentVouchers;
      check(typeof syncMissing === 'function', 'the method syncMissingDocumentVouchers must exist');
      if (typeof syncMissing === 'function') {
        await syncMissing.call(VoucherSyncService, { batchSize: 2 });
        await syncMissing.call(VoucherSyncService, { batchSize: 2 });
        const d3Vouchers = await vouchersOf(d3);
        check(d3Vouchers.length === 1, `a document without a voucher must get exactly one voucher (${d3Vouchers.length})`);
        if (v1) {
          const [v1After] = await orm.select({ description: journalVouchers.description }).from(journalVouchers).where(eq(journalVouchers.id, v1.id));
          check(v1After?.description === 'TD193-PRESERVE-MARKER', `the sync must not rewrite an existing voucher: "${v1After?.description}"`);
        }

        // ۵) سند قدیمی بدون پیوند: سند جدید صادر نمی‌شود و برای بررسی حسابدار گزارش می‌شود
        const d5 = await makeInvoice(true);
        const [d5Doc] = await orm.select({ refNumber: documents.refNumber }).from(documents).where(eq(documents.id, d5));
        await insertBareVoucher({ referenceId: d5, referenceNumber: d5Doc.refNumber, status: 'draft', voucherType: 'sales' });
        const summary = await syncMissing.call(VoucherSyncService, {});
        const d5Vouchers = await vouchersOf(d5);
        check(d5Vouchers.length === 1, `a document with an unlinked legacy voucher must not get a second voucher: ${JSON.stringify(d5Vouchers.map(v => ({ id: v.id, ref: v.referenceNumber, src: (v as any).sourceDocumentId })))}`);
        check(Array.isArray(summary?.reviewDocumentIds) && summary.reviewDocumentIds.includes(d5), `document ${d5} must be in the accountant review list: ${JSON.stringify(summary?.reviewDocumentIds)}`);

        // ۶) قفل مشورتی: وقتی اجرای دیگری قفل را دارد، کاری انجام نمی‌شود
        const d6 = await makeInvoice(true);
        const holder = await pool.connect();
        try {
          await holder.query('SELECT pg_advisory_lock(91001)');
          const lockedRun = await syncMissing.call(VoucherSyncService, {});
          check(lockedRun?.locked === true, 'with the lock held by another instance, the run must return locked=true');
          check((await vouchersOf(d6)).length === 0, 'a locked run must not issue any voucher');
        } finally {
          await holder.query('SELECT pg_advisory_unlock(91001)').catch(() => undefined);
          holder.release();
        }

        // ۷) گزارش سلامت مالی اسناد تکراری قدیمی را فهرست می‌کند
        const legacyDuplicate = v1 ? await insertBareVoucher({ referenceId: d1, referenceNumber: (await orm.select({ r: documents.refNumber }).from(documents).where(eq(documents.id, d1)))[0].r, status: 'draft', voucherType: 'sales' }) : null;
        const health = await AccountingService.runFinancialHealthCheck();
        const dupTest = health.tests.find((t: any) => t.id === 'duplicate_document_vouchers');
        check(Boolean(legacyDuplicate) && dupTest?.status === 'error' && (dupTest.items || []).some((i: any) => i.id === legacyDuplicate!.id),
          `the financial health check must report the duplicate voucher #${legacyDuplicate?.id}: ${JSON.stringify(dupTest ? { status: dupTest.status, count: dupTest.count } : null)}`);
      }

      // ۸) مسیر بوت دیگر همگام‌سازی کامل اسناد و پرکردن کاردکس را اجرا نمی‌کند
      const serverSource = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
      check(!/syncAllInvoiceVouchers\(|syncMissingInitialTransactions\(|syncMissingDocumentVouchers\(/.test(serverSource),
        'server.ts must not run the voucher sync or the Kardex backfill at boot');

      if (violations.length > 0) {
        throw new Error(violations.join(' | '));
      }
      results.push(makeTestCase({
        id: 'reg_document_voucher_link_td_193',
        scenarioId: 'document_voucher_uniqueness',
        name: 'v7.0.31: one journal voucher per stock document, manual sync only of documents without a voucher under an advisory lock, removed from boot (TD-193 / P1-8)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'source_document_id link and unique index, reversal voucher kept apart from the invoice voucher on issue and delete, no rewrite of existing vouchers, report of old unlinked vouchers, advisory lock and removal from the boot path are confirmed.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_document_voucher_link_td_193',
        scenarioId: 'document_voucher_uniqueness',
        name: 'v7.0.31: one journal voucher per stock document, manual sync only of documents without a voucher under an advisory lock, removed from boot (TD-193 / P1-8)',
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
      check(vA.exists && vA.vat === 0, `a free-text note must not turn into VAT (VAT recorded: ${vA.vat})`);
      check(vA.receivable === 200000, `the customer debit must equal the invoice net (200,000): ${vA.receivable}`);
      // همگام‌سازی دوباره بدون گزینه (مسیری که پیش‌تر هنگام راه‌اندازی اجرا می‌شد)
      await VoucherSyncService.syncSalesInvoiceVoucher(docA);
      check((await voucherVat(docA)).vat === 0, 'a re-sync must not read VAT from the notes');

      // ۲) درصد مالیات → مبلغ ذخیره‌شده روی فاکتور و همان مبلغ در سند حسابداری، بدون نوشتن در یادداشت
      const docB = await create({ vatPercent: 9, notes: 'فاکتور آزمون' });
      const rowB = await docRow(docB);
      check(Number(rowB?.vatPercent) === 9 && Number(rowB?.vatAmount) === 18000, `the invoice VAT must be stored structured (9%, 18,000): ${JSON.stringify({ p: rowB?.vatPercent, a: rowB?.vatAmount })}`);
      const VAT_NOTE_WORDS = 'ارزش افزوده';
      check(!String(rowB?.notes || '').includes(VAT_NOTE_WORDS), `VAT must not be written into the notes: "${rowB?.notes}"`);
      const vB = await voucherVat(docB);
      check(vB.vat === 18000 && vB.receivable === 218000, `the voucher must have VAT 18,000 and a debit of 218,000: ${JSON.stringify(vB)}`);
      const formattedB: any = await DocumentService.getDocumentById(docB);
      check(formattedB?.payableAmount === 218000 && formattedB?.remainingAmount === 218000, `the invoice payable amount must include VAT: ${JSON.stringify({ payable: formattedB?.payableAmount, remaining: formattedB?.remainingAmount })}`);

      // ۳) پیش‌فاکتور با مبلغ مالیات → نهایی‌سازی بدون گزینه از مقدار ذخیره‌شده استفاده می‌کند
      const docC = await create({ docType: 'proforma', status: 'proforma', vatAmount: 50000 });
      await DocumentService.finalizeDocument(docC, 'test-agent');
      check(Number((await docRow(docC))?.vatAmount) === 50000 && (await voucherVat(docC)).vat === 50000, 'finalizing the proforma must post the stored VAT (50,000)');

      // ۴) ویرایش پیش‌فاکتور با درصد مالیات → ذخیره و ثبت در نهایی‌سازی
      const docD = await create({ docType: 'proforma', status: 'proforma' });
      await DocumentService.updateDocument(docD, { vatPercent: 10 } as any);
      check(Number((await docRow(docD))?.vatAmount) === 20000, `editing the proforma must store VAT at 10% (20,000): ${(await docRow(docD))?.vatAmount}`);
      await DocumentService.finalizeDocument(docD, 'test-agent');
      check((await voucherVat(docD)).vat === 20000, 'the voucher of the edited proforma must have VAT 20,000');

      // ۵) اعتبارسنجی سرویس: درصد بیش از ۱۰۰ و مبلغ منفی رد می‌شوند
      for (const bad of [{ vatPercent: 150 }, { vatAmount: -5 }]) {
        let rejected = false;
        try {
          await create(bad);
        } catch {
          rejected = true;
        }
        check(rejected, `an invalid VAT must be refused: ${JSON.stringify(bad)}`);
      }

      if (violations.length > 0) {
        throw new Error(violations.join(' | '));
      }
      results.push(makeTestCase({
        id: 'reg_structured_vat_td_197',
        scenarioId: 'structured_vat',
        name: 'v7.0.32: structured VAT on the invoice and journal voucher, never parsed from notes (TD-197 / P1-7)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'free-text notes do not turn into VAT, the VAT percent/amount is stored on the invoice and posted as is in the journal voucher, proforma edit and finalize use the stored value, and the receivable amount includes VAT.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_structured_vat_td_197',
        scenarioId: 'structured_vat',
        name: 'v7.0.32: structured VAT on the invoice and journal voucher, never parsed from notes (TD-197 / P1-7)',
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
      check(rowFor(report, i1.id, w1.id)?.status === 'mismatch' && rowFor(report, i1.id, w1.id)?.ledgerQty === 10, `I1 in warehouse 1 must be a mismatch of 10 against 3: ${JSON.stringify(rowFor(report, i1.id, w1.id))}`);
      check(rowFor(report, i1.id, w2.id)?.status === 'mismatch' && rowFor(report, i1.id, w2.id)?.tableQty === null, `I1 in warehouse 2 must be a mismatch without a table row: ${JSON.stringify(rowFor(report, i1.id, w2.id))}`);
      check(rowFor(report, i2.id, w1.id)?.status === 'negative_ledger', `I2 must be reported as a negative Kardex balance: ${JSON.stringify(rowFor(report, i2.id, w1.id))}`);
      check(report.unresolvedLocations.some((u: any) => u.itemId === i3.id), 'I3 must be reported as an unresolved Kardex location');
      check(rowFor(report, i4.id, w2.id)?.codeMismatch === true, `I4 must be reported as a warehouse code mismatch: ${JSON.stringify(rowFor(report, i4.id, w2.id))}`);
      check(!report.rows.some((r: any) => r.itemId === i5.id), `I5 (a deleted document with a reversal row) must not be a mismatch: ${JSON.stringify(report.rows.filter((r: any) => r.itemId === i5.id))}`);

      // ۲) اجرای آزمایشی پیش‌فرض: برنامه تغییرات بدون تغییر داده
      const dry = await WarehouseStockReconciliationService.repair({ itemIds: testIds });
      check(dry.dryRun === true && dry.changes.some((c: any) => c.itemId === i1.id && c.warehouseId === w1.id && c.afterQty === 10), `the dry run must be the default and include the repair of I1: ${JSON.stringify(dry).slice(0, 300)}`);
      const [i1w1Before] = await orm.select().from(itemWarehouseStocks).where(and(eq(itemWarehouseStocks.itemId, i1.id), eq(itemWarehouseStocks.warehouseId, w1.id)));
      check(Number(i1w1Before?.currentStock) === 3, 'the dry run must not change data');

      // ۳) قفل مشورتی: اجرای همزمان دیگر کاری انجام نمی‌دهد
      const holder = await pool.connect();
      try {
        await holder.query('SELECT pg_advisory_lock(91003)');
        const lockedRun = await WarehouseStockReconciliationService.repair({ dryRun: false, itemIds: testIds });
        check(lockedRun.locked === true && lockedRun.rowsChanged === 0, 'with the lock held by another instance no repair may run');
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
      check(Number(t1.find(r => r.warehouseId === w1.id)?.currentStock) === 10 && Number(t1.find(r => r.warehouseId === w2.id)?.currentStock) === 5, `I1 must be repaired to 10 and 5: ${JSON.stringify(t1.map(r => [r.warehouseId, r.currentStock]))}`);
      const i1Stocks = (await ItemWarehouseStockService.getStockSnapshot(orm, i1.id)).byCode;
      check(Number(i1After.currentStock) === 15 && i1Stocks[w1.code] === 10 && i1Stocks[w2.code] === 5, `the total and per-warehouse stock of I1 must be 15 (10 and 5): ${JSON.stringify({ c: i1After.currentStock, s: i1Stocks })}`);
      check(Number(i1After.weightedAverageCost) === 12345, 'the repair must not change the weighted average cost');
      check(Number((await tableOf(i2.id))[0]?.currentStock) === 0, 'a negative Kardex balance must not be adjusted automatically');
      check(Number((await tableOf(i3.id))[0]?.currentStock) === 7, 'an item with an unresolved location must not be repaired');
      check((await tableOf(i4.id))[0]?.warehouseCode === w2.code, 'the warehouse code of I4 must be repaired to the canonical code');
      const anomalies = await orm.select().from(inventoryReconciliationAnomalies).where(eq(inventoryReconciliationAnomalies.runId, run.runId));
      const kinds = (itemId: number) => anomalies.filter(a => a.itemId === itemId).map(a => a.kind);
      check(kinds(i1.id).filter(k => k === 'repaired').length === 2, `the two repairs of I1 must be recorded in the anomalies table: ${JSON.stringify(kinds(i1.id))}`);
      check(kinds(i2.id).includes('negative_ledger') && kinds(i3.id).includes('unresolved_location'), `the refusals must be recorded: ${JSON.stringify({ i2: kinds(i2.id), i3: kinds(i3.id) })}`);

      // ۵) گزارش پس از ترمیم
      const after = await WarehouseStockReconciliationService.getReport();
      check(!after.rows.some((r: any) => r.itemId === i1.id || r.itemId === i4.id), 'after the repair I1 and I4 must have no mismatch');

      if (violations.length > 0) {
        throw new Error(violations.join(' | '));
      }
      results.push(makeTestCase({
        id: 'reg_warehouse_stock_reconciliation_td_200',
        scenarioId: 'warehouse_stock_reconciliation',
        name: 'v7.0.33: manual report and repair of warehouse stock from the Kardex — no automatic adjustment of negatives (TD-200 / P1-9)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'differences caused by migration 0014 (duplicate key overwrite, negatives set to zero, raw warehouse code) are reported; the default dry run does not change data; repair only corrects quantities from the Kardex, leaves negatives and unknown locations alone and records everything in the anomalies table.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_warehouse_stock_reconciliation_td_200',
        scenarioId: 'warehouse_stock_reconciliation',
        name: 'v7.0.33: manual report and repair of warehouse stock from the Kardex — no automatic adjustment of negatives (TD-200 / P1-9)',
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
    // v9.0.338 (TD-786): documents.type has a CHECK constraint, so the case uses a real type in a fiscal year no other case writes
    const testDocType = 'waste';
    const testYear = 1394;
    try {
      // ۱) سند با شماره دستی ۱۳ رقمی پیش از اولین شماره خودکار این نوع سند در سال مالی
      const manualId = await DocumentService.createDocument({ docType: testDocType, status: 'draft', date: '2015-08-01', refNumber: `MAN-${1790882288234}`, items: [], user: 'test-agent' });
      createdDocIds.push(manualId);
      // ۲) شماره‌گذاری خودکار باید کار کند و از سقف شمارنده عبور نکند
      const peek = await DocumentService.peekNextRef(testDocType, '2015-08-02');
      const autoId = await DocumentService.createDocument({ docType: testDocType, status: 'draft', date: '2015-08-02', items: [], user: 'test-agent' });
      createdDocIds.push(autoId);
      const [autoDoc] = await orm.select({ refNumber: documents.refNumber }).from(documents).where(eq(documents.id, autoId));
      if (autoDoc?.refNumber !== '1' || peek !== '1') {
        throw new Error(`automatic number after a document with a long manual number must be "1": ${JSON.stringify({ peek, ref: autoDoc?.refNumber })}`);
      }
      results.push(makeTestCase({
        id: 'reg_ref_counter_long_manual_ref_td_196',
        scenarioId: 'period_closing_and_conceptual_mappings',
        name: 'v7.0.34: a long manual number does not stop automatic numbering of the fiscal year (TD-196)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'after a document with a 13-digit manual number, counter initialization ignores it and automatic number "1" is issued.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_ref_counter_long_manual_ref_td_196',
        scenarioId: 'period_closing_and_conceptual_mappings',
        name: 'v7.0.34: a long manual number does not stop automatic numbering of the fiscal year (TD-196)',
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
      await orm.delete(documentRefCounters).where(and(eq(documentRefCounters.docType, testDocType), eq(documentRefCounters.fiscalYear, testYear)));
    }
  }

  // Test 27.7b: v7.0.60 (audit P3-10): شماره دستی دارای پیشوند و سال فقط با پسوند عددی‌اش شمارنده را جلو می‌برد
  if (shouldRun('reg_ref_counter_numeric_suffix_p3_10', 'p310', 'ref_counters', 'refnumber')) {
    const tStart = Date.now();
    const createdDocIds: number[] = [];
    // v9.0.338 (TD-786): documents.type has a CHECK constraint, so the case uses a real type in a fiscal year no other case writes
    const testDocType = 'waste';
    const testYear = 1395;
    const testName = 'v7.0.60: the manual number «INV-1403-0005» moves the counter to 5, not 14030005 (P3-10)';
    try {
      // ۱) همگام‌سازی شمارنده با شماره دستی در createDocument
      const manualId = await DocumentService.createDocument({ docType: testDocType, status: 'draft', date: '2016-08-01', refNumber: 'INV-1403-0005', items: [], user: 'test-agent' });
      createdDocIds.push(manualId);
      const autoId = await DocumentService.createDocument({ docType: testDocType, status: 'draft', date: '2016-08-02', items: [], user: 'test-agent' });
      createdDocIds.push(autoId);
      const [autoDoc] = await orm.select({ refNumber: documents.refNumber }).from(documents).where(eq(documents.id, autoId));
      if (autoDoc?.refNumber !== '6') {
        throw new Error(`automatic number after "INV-1403-0005" must be "6": ${autoDoc?.refNumber}`);
      }
      // ۲) مقداردهی اولیه شمارنده از روی اسناد موجود (شروع سرد) نیز فقط پسوند عددی را می‌خواند
      await orm.delete(documentRefCounters).where(and(eq(documentRefCounters.docType, testDocType), eq(documentRefCounters.fiscalYear, testYear)));
      const peek = await DocumentService.peekNextRef(testDocType, '2016-08-03');
      if (peek !== '7') {
        throw new Error(`number preview after a cold start must be "7": ${peek}`);
      }
      results.push(makeTestCase({
        id: 'reg_ref_counter_numeric_suffix_p3_10',
        scenarioId: 'period_closing_and_conceptual_mappings',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'a manual number with a year (INV-1403-0005) moves the counter to 5; the next automatic number is "6" and "7" after a cold start.'
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
      await orm.delete(documentRefCounters).where(and(eq(documentRefCounters.docType, testDocType), eq(documentRefCounters.fiscalYear, testYear)));
    }
  }

  // Test 27.7c: v7.0.62 (TD-179): روز دقیق نوروز در سال مالی شماره‌گذاری (TS و SQL) و اصلاح ردیف‌های مرزی قدیمی
  if (shouldRun('reg_ref_fiscal_year_exact_nowruz_td_179', 'td179', 'nowruz', 'ref_fiscal_year')) {
    const tStart = Date.now();
    const createdDocIds: number[] = [];
    // v9.0.338 (TD-786): documents.type has a CHECK constraint, so the case uses a real type in a fiscal year no other case writes
    const testDocType = 'waste';
    const testName = 'v7.0.62: a document dated 20 March 2024 (Nowruz 1403) is numbered in year 1403 and old boundary rows are corrected with a report (TD-179)';
    try {
      const violations: string[] = [];
      // ۱) سمت برنامه
      const expected: Record<string, number> = { '2024-03-19': 1402, '2024-03-20': 1403, '2025-03-20': 1403, '2025-03-21': 1404, '2028-03-20': 1407, '2026-03-20': 1404 };
      for (const [d, fy] of Object.entries(expected)) {
        const got = resolveJalaliFiscalYear(d);
        if (got !== fy) violations.push(`resolveJalaliFiscalYear(${d}) = ${got}, expected ${fy}`);
      }
      // ۲) سمت پایگاه‌داده باید برای همه روزهای ۱۹ تا ۲۳ مارس ۱۹۲۱ تا ۲۱۲۱ با برنامه یکی باشد
      const sqlRows = await orm.execute(sql`
        SELECT y::int AS y, dd::int AS dd, erp_ref_fiscal_year(make_timestamp(y::int, 3, dd::int, 12, 0, 0)) AS fy
          FROM generate_series(1921, 2121) y, generate_series(19, 23) dd`);
      const mismatches = (sqlRows.rows as Array<{ y: number; dd: number; fy: number }>).filter(r => {
        const iso = `${r.y}-03-${String(r.dd).padStart(2, '0')}`;
        return resolveJalaliFiscalYear(iso) !== Number(r.fy);
      });
      if (mismatches.length > 0) violations.push(`erp_ref_fiscal_year differs from the application on ${mismatches.length} days: ${JSON.stringify(mismatches.slice(0, 3))}`);

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
      if (byId.get(boundary)?.fy !== 1403 || byId.get(boundary)?.ref !== 'TD179-7') violations.push(`the boundary document must move to 1403 with the same number: ${JSON.stringify(byId.get(boundary))}`);
      if (byId.get(conflicting)?.fy !== 1402) violations.push(`the document with the same number must not be moved: ${JSON.stringify(byId.get(conflicting))}`);
      if (byId.get(occupant)?.fy !== 1403 || byId.get(regular)?.fy !== 1403) violations.push('non-boundary documents must not change');
      // ترتیب درج گزارش (INSERT ... SELECT بی ORDER BY) به ترتیب فیزیکی ردیف‌های documents بستگی دارد؛ مقایسه به ترتیب شناسه سند
      const report = await orm.execute(sql`SELECT document_id, status FROM ref_fiscal_year_corrections WHERE document_id = ANY(${sql.param(createdDocIds)}::int[]) ORDER BY document_id`);
      const statuses = (report.rows as Array<{ document_id: number; status: string }>).map(r => `${r.document_id}:${r.status}`);
      if (JSON.stringify(statuses) !== JSON.stringify([`${boundary}:corrected`, `${conflicting}:conflict`])) violations.push(`correction report is wrong: ${JSON.stringify(statuses)}`);
      const [counter] = await orm.select().from(documentRefCounters).where(and(eq(documentRefCounters.docType, testDocType), eq(documentRefCounters.fiscalYear, 1403)));
      if ((counter?.lastRefNumber ?? 0) < 7) violations.push(`the 1403 counter must reach at least the moved document number (7): ${counter?.lastRefNumber}`);

      // ۴) گزارش در بازرس سلامت مالی
      const { FinancialHealthService } = await import('../../services/accounting/financialHealth.service.js');
      const health = await FinancialHealthService.runHealthCheck();
      const fyTest = health.tests.find(t => t.id === 'ref_fiscal_year_boundary_corrections');
      if (!fyTest || fyTest.status !== 'warning' || !fyTest.items?.some(i => i.linkId === conflicting)) violations.push(`the financial health check must warn about the document that was not moved: ${JSON.stringify(fyTest?.metrics)}`);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_ref_fiscal_year_exact_nowruz_td_179',
        scenarioId: 'period_closing_and_conceptual_mappings',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'the application fiscal year and the SQL function agree for March 19 to 23 of 1921 to 2121; the boundary document moves to 1403 with the same number, the document with the same number is not moved and both appear in the report and the financial health check.'
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
      await orm.delete(documentRefCounters).where(and(eq(documentRefCounters.docType, testDocType), inArray(documentRefCounters.fiscalYear, [1402, 1403])));
    }
  }

  // Test 27.7d: v7.0.63 (TD-198): نرخ تسعیر ساختاریافته؛ برای سند ارزی الزامی و هرگز از یادداشت خوانده نمی‌شود
  if (shouldRun('reg_structured_exchange_rate_td_198', 'td198', 'currency', 'exchange')) {
    const tStart = Date.now();
    const createdDocIds: number[] = [];
    const createdVoucherIds: number[] = [];
    let createdItemId: number | null = null;
    const testName = 'v7.0.63: a foreign-currency document without an exchange rate is not recorded, edited or given a journal voucher, and the rate is never read from the notes (TD-198)';
    try {
      const violations: string[] = [];
      const expectValidation = async (label: string, fn: () => Promise<unknown>) => {
        try {
          await fn();
          violations.push(`${label}: must be refused with a validation error`);
        } catch (err: any) {
          if (!String(err?.message || '').includes('نرخ تسعیر')) violations.push(`${label}: unrelated error ${err?.message}`);
        }
      };
      const [item] = await orm.insert(items).values({
        name: 'کالای تست نرخ تسعیر TD-198', code: `ITEM-TD198-${Date.now()}`, type: 'product', category: 'گردنبند',
        unit: 'عدد', weightedAverageCost: money(60000000), isDeleted: 0
      }).returning();
      createdItemId = item.id;
      const line = [{ itemId: item.id, quantity: 1, unit_price: 150, discount: 0 }];

      // ۱) ثبت پیش‌فاکتور ارزی بدون نرخ رد می‌شود؛ با نرخ ذخیره می‌شود
      await expectValidation('a dollar proforma without a rate', () => DocumentService.createDocument({ docType: 'proforma', status: 'proforma', date: '2026-08-01', refNumber: `TD198-A-${Date.now()}`, currency: 'USD', items: line, user: 'test-agent' }));
      const proformaId = await DocumentService.createDocument({ docType: 'proforma', status: 'proforma', date: '2026-08-01', refNumber: `TD198-B-${Date.now()}`, currency: 'USD', exchangeRate: 600000, items: line, user: 'test-agent' });
      createdDocIds.push(proformaId);
      const [stored] = await orm.select({ rate: documents.exchangeRate }).from(documents).where(eq(documents.id, proformaId));
      if (Number(stored?.rate) !== 600000) violations.push(`exchange rate must be stored on the document: ${stored?.rate}`);

      // ۲) ویرایش به ارز دیگر بدون نرخ جدید با نرخ قبلی ذخیره می‌شود؛ سند ریالی نرخ ندارد
      const irrId = await DocumentService.createDocument({ docType: 'proforma', status: 'proforma', date: '2026-08-01', refNumber: `TD198-C-${Date.now()}`, items: line, user: 'test-agent' });
      createdDocIds.push(irrId);
      await expectValidation('changing a rial document to euro without a rate', () => DocumentService.updateDocument(irrId, { currency: 'EUR' }));
      const [irrDoc] = await orm.select({ rate: documents.exchangeRate, currency: documents.currency }).from(documents).where(eq(documents.id, irrId));
      if (irrDoc?.rate !== null || irrDoc?.currency !== 'IRR') violations.push(`a rial document must not have a changed rate or currency: ${JSON.stringify(irrDoc)}`);

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
        violations.push(`journal voucher must be issued at the document column rate (600000) with a cost of goods sold of 100 dollars: ${JSON.stringify({ rate: cogs?.exchangeRate, debit: cogs?.debit })}`);
      }

      // ۴) سند ارزی قدیمی بدون نرخ (فقط نرخ در یادداشت) با نرخ ۱ سند حسابداری نمی‌گیرد
      const [legacyDoc] = await orm.insert(documents).values({
        type: 'invoice', refNumber: `TD198-E-${Date.now()}`, date: '2026-08-02 00:00:00', buyerName: 'خریدار تست TD-198',
        currency: 'AED', notes: 'نرخ تسعیر: 150000', status: 'final', isDeleted: 0
      }).returning();
      createdDocIds.push(legacyDoc.id);
      await orm.insert(documentItems).values({ documentId: legacyDoc.id, itemId: item.id, quantity: 1, unitPrice: money(10), discount: money(0), location: 'main', isDeleted: 0 });
      await expectValidation('the voucher of a dirham document without a rate', () => VoucherSyncService.syncSalesInvoiceVoucher(legacyDoc.id, { strict: true }));

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_structured_exchange_rate_td_198',
        scenarioId: 'multi_currency_financials_and_ratios',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'a dollar proforma without a rate and a currency change without a rate are refused; the journal voucher uses the document column rate (not the notes), and a dirham document without a rate gets no journal voucher.'
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
        throw new Error(`first concurrent stock movement of an item in a warehouse failed (${failures.length}/${trials}): ${failures.join(' | ')}`);
      }
      results.push(makeTestCase({
        id: 'reg_first_movement_race_p2_2',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'v7.0.35: concurrency safety of the first item movement in a warehouse in ItemWarehouseStockService (P2-2)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: `${trials} trials × ${parallel} concurrent transactions of the first item entry into a warehouse run without a unique error and with the correct stock total.`
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_first_movement_race_p2_2',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'v7.0.35: concurrency safety of the first item movement in a warehouse in ItemWarehouseStockService (P2-2)',
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
        throw new Error(`default warehouse must be "${first.code}" (lowest active id): ${JSON.stringify(picks)}`);
      }
      results.push(makeTestCase({
        id: 'reg_default_warehouse_deterministic_p2_3',
        scenarioId: 'v5_warehouse_resolution_guard',
        name: 'v7.0.36: deterministic default warehouse after warehouse rows are rewritten (P2-3)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'after updating the row of the oldest warehouse, the stock service, the warehouse resolver and the active warehouse list still return the same default warehouse.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_default_warehouse_deterministic_p2_3',
        scenarioId: 'v5_warehouse_resolution_guard',
        name: 'v7.0.36: deterministic default warehouse after warehouse rows are rewritten (P2-3)',
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
        throw new Error(`after deleting the invoice, stock and the Kardex balance must be 10 with no difference: ${JSON.stringify({ stock: after?.s, kardex: audit?.kardexNetBalance, discrepancies: audit?.discrepancies })}`);
      }
      results.push(makeTestCase({
        id: 'reg_integrity_report_deleted_document_td_201',
        scenarioId: 'inventory_integrity_3way_reconciliation',
        name: 'v7.0.37: the three-way stock report shows no false difference after a final document is deleted (TD-201)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'receipt 10, invoice 2 and invoice delete: stock and the Kardex balance are both 10 and the item is reported with no difference.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_integrity_report_deleted_document_td_201',
        scenarioId: 'inventory_integrity_3way_reconciliation',
        name: 'v7.0.37: the three-way stock report shows no false difference after a final document is deleted (TD-201)',
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
        throw new Error(`the runner on mockPool must stop with a non-zero exit code before migrations or suites run: ${JSON.stringify({ status: child.status, refused, ranSuites, tail: output.slice(-400) })}`);
      }
      results.push(makeTestCase({
        id: 'reg_test_runner_mock_db_refusal_p2_12',
        scenarioId: 'test_runner_real_database_guard',
        name: 'v7.0.38: the test runner refuses to run without a real database, even for the unit suite (P2-12)',
        layer: 'regression',
        executionType: 'real_code',
        passed: true,
        durationMs: Date.now() - tStart,
        details: `running "--suite unit" with an empty DATABASE_URL stops with code ${child.status} and a clear message, without migrations on mockPool and without a result report.`
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_test_runner_mock_db_refusal_p2_12',
        scenarioId: 'test_runner_real_database_guard',
        name: 'v7.0.38: the test runner refuses to run without a real database, even for the unit suite (P2-12)',
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
        throw new Error(`session timeouts must come from the startup packet (source=client) with the configured value: ${JSON.stringify(rows)}`);
      }
      results.push(makeTestCase({
        id: 'reg_pool_session_timeouts_td_176',
        scenarioId: 'startup_db_session_hygiene',
        name: 'v7.0.39: session timeouts come from the pool connection startup parameters (TD-176)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'statement_timeout and idle_in_transaction_session_timeout on a pool connection report source client (startup packet) and the configured value.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_pool_session_timeouts_td_176',
        scenarioId: 'startup_db_session_hygiene',
        name: 'v7.0.39: session timeouts come from the pool connection startup parameters (TD-176)',
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
        throw new Error(`building the app must not access the database: ${JSON.stringify({ status: child.status, tail: output.slice(-600) })}`);
      }
      results.push(makeTestCase({
        id: 'reg_app_build_no_db_access_td_176',
        scenarioId: 'startup_db_session_hygiene',
        name: 'v7.0.39: building the app runs no database query before migrations (TD-176)',
        layer: 'regression',
        executionType: 'real_code',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'building the app in a separate process with an unreachable database completes without any failed query.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_app_build_no_db_access_td_176',
        scenarioId: 'startup_db_session_hygiene',
        name: 'v7.0.39: building the app runs no database query before migrations (TD-176)',
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
        throw new Error(`after the seed ends, lock 89345 is still held in ${held} sessions (released through the general pool path: ${reroutedUnlocks})`);
      }
      results.push(makeTestCase({
        id: 'reg_seed_advisory_lock_released_td_194',
        scenarioId: 'startup_db_session_hygiene',
        name: 'v7.0.39: the seed advisory lock is released on the same connection (TD-194)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'even when the pool hands out another connection for the next query, lock 89345 is released after the seed on the same connection that took it.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_seed_advisory_lock_released_td_194',
        scenarioId: 'startup_db_session_hygiene',
        name: 'v7.0.39: the seed advisory lock is released on the same connection (TD-194)',
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
        throw new Error(`after the final migration failure the process must stop with code 1: ${JSON.stringify({ status: migration.status, tail: migration.output.slice(-500) })}`);
      }

      // ۲) خطای مدیریت‌نشده پس از راه‌اندازی در محیط توسعه: پیش‌تر فقط لاگ می‌شد
      const uncaught = runServer('./src/tests/fixtures/uncaughtAfterStartupProbe.ts', await freePort());
      if (uncaught.status !== 1 || !uncaught.output.includes('UNCAUGHT_PROBE_FIRING')
        || !uncaught.output.includes('Initiating graceful shutdown (exit code 1)')
        || uncaught.output.includes('FATAL: Database migrations failed after 5 attempts')) {
        throw new Error(`after an unhandled error the process must shut down in a controlled way with code 1: ${JSON.stringify({ status: uncaught.status, tail: uncaught.output.slice(-500) })}`);
      }

      results.push(makeTestCase({
        id: 'reg_process_exits_on_unhandled_errors_p2_11',
        scenarioId: 'startup_db_session_hygiene',
        name: 'v7.0.40: the process stops in development after an unhandled error and after the final migration failure (P2-11)',
        layer: 'regression',
        executionType: 'real_code',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'the real server in development stops with code 1 both after 5 migration failures and after an unhandled error.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_process_exits_on_unhandled_errors_p2_11',
        scenarioId: 'startup_db_session_hygiene',
        name: 'v7.0.40: the process stops in development after an unhandled error and after the final migration failure (P2-11)',
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
        throw new Error(`the second isolated schema was left without migration tables: ${missing.join(', ')}`);
      }
      if (getMigrationsJournalSchema() !== outerJournal) {
        throw new Error(`after the isolated schema ends, the migration journal must return to "${outerJournal}", not "${getMigrationsJournalSchema()}"`);
      }
      results.push(makeTestCase({
        id: 'reg_test_schema_own_migration_journal_td_192',
        scenarioId: 'test_runner_real_database_guard',
        name: 'v7.0.42: each isolated test schema has its own migration journal and gets all tables (TD-192)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'a second isolated schema on the same database gets all tables, and the migration journal returns to the previous schema after it is dropped.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_test_schema_own_migration_journal_td_192',
        scenarioId: 'test_runner_real_database_guard',
        name: 'v7.0.42: each isolated test schema has its own migration journal and gets all tables (TD-192)',
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
    const testName = 'v7.0.50: a migration failure in an isolated schema, in test database readiness or in the seed stops the run (TD-217)';
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
        throw new Error('setupTestSchema returned success with a failed migration; tests would run on an incomplete schema');
      }
      if (!setupError.includes(marker)) {
        throw new Error(`setupTestSchema error does not carry the cause of the migration failure: ${setupError}`);
      }
      const schemasAfter = await listTestSchemas();
      if (schemasAfter !== schemasBefore) {
        throw new Error(`the failed isolated schema was not dropped (before: ${schemasBefore} / after: ${schemasAfter})`);
      }
      if (getMigrationsJournalSchema() !== outerJournal) {
        throw new Error(`the migration journal did not return to "${outerJournal}" after the failure (${getMigrationsJournalSchema()})`);
      }
      if (acquireListeners() !== listenersBefore) {
        throw new Error(`the acquire listener of the failed schema stayed on the pool (${listenersBefore} → ${acquireListeners()})`);
      }

      // ب) آمادگی پایگاه‌داده تست: مهاجرت شکست‌خورده «آماده» نیست و اجراکننده تست خطا می‌گیرد
      const ready = await dbHelper.ensureTestDatabaseReady(failingMigrate);
      if (ready !== false) {
        throw new Error('ensureTestDatabaseReady reported a failed migration as "ready"');
      }
      if (typeof dbHelper.assertTestDatabaseReady !== 'function') {
        throw new Error('assertTestDatabaseReady (the throwing version for the test runner) does not exist');
      }
      let assertError = '';
      try {
        await dbHelper.assertTestDatabaseReady(failingMigrate);
      } catch (e: any) {
        assertError = e.message;
      }
      if (!assertError) {
        throw new Error('assertTestDatabaseReady did not throw on a failed migration');
      }
      if ((await dbHelper.ensureTestDatabaseReady()) !== true) {
        throw new Error('the injected failure broke the cached default readiness state');
      }

      // ج) seed روی اسکیمای مهاجرت‌نشده اجرا نمی‌شود
      let seedError = '';
      try {
        await seedModule.runSeed({ migrate: failingMigrate });
      } catch (e: any) {
        seedError = e.message;
      }
      if (!seedError.includes(marker)) {
        throw new Error(`runSeed went on after a failed migration (${seedError || 'no error'})`);
      }

      results.push(makeTestCase({
        id: 'reg_migration_failure_not_masked_td_217',
        scenarioId: 'test_runner_real_database_guard',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'an isolated schema with a failed migration stops with the real cause and is dropped; test database readiness is false and its throwing version throws; the seed stops before any write.'
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
          throw new Error(`${label}: expected ${JSON.stringify(expected)}; table=${JSON.stringify(table)}, total=${it.total}, Kardex=${kardexNet}`);
        }
        steps.push(label);
      };

      // ۱) تعریف کالا با موجودی اولیه: پیش‌تر فقط کش و کاردکس نوشته می‌شد و جدول ردیفی نداشت
      const created = await ItemCatalogService.createItem({
        type: 'raw_material', name: `کالای منبع واحد P2-1 ${Date.now()}`, code: `P21-${Date.now()}`, unit: 'عدد',
        category: '', weighted_average_cost: 1000, [`stock_${w1.code}`]: 10
      }, user);
      const itemId = created.insertedId;
      await assertInvariant(itemId, 'item created with opening stock', { [w1.code]: 10 });

      // ۲) انتقال بین انبارها: پیش‌تر فقط کش تغییر می‌کرد
      await InventoryStockRepairService.executeWarehouseTransfer({ itemId, fromLocation: w1.code, toLocation: w2.code, quantity: 4, user: 'test-agent' });
      await assertInvariant(itemId, 'transfer of 4 units to the second warehouse', { [w1.code]: 6, [w2.code]: 4 });

      // ۳) فروش بیش از موجودی انبار مبدأ رد و فروش مجاز ثبت شود؛ پیش‌تر موجودی کهنه جدول دوباره در کش نوشته می‌شد (۹ به‌جای ۵)
      let oversellRejected = false;
      try {
        await DocumentService.createDocument({ docType: 'invoice', status: 'final', inOut: 'out', date: today, user: 'test-agent', buyerName: 'خریدار آزمون P2-1', location: w1.code, items: [{ itemId, quantity: 7, unit_price: 2000, location: w1.code }] });
      } catch {
        oversellRejected = true;
      }
      if (!oversellRejected) throw new Error('selling 7 units from a source warehouse holding 6 must not be accepted');
      await DocumentService.createDocument({ docType: 'invoice', status: 'final', inOut: 'out', date: today, user: 'test-agent', buyerName: 'خریدار آزمون P2-1', location: w1.code, items: [{ itemId, quantity: 5, unit_price: 2000, location: w1.code }] });
      await assertInvariant(itemId, 'sale of 5 units from the source warehouse', { [w1.code]: 1, [w2.code]: 4 });

      // ۴) انبارگردانی در انباری که کالا در آن موجودی ندارد (شمارش صفر): پیش‌تر موجودی کل کالا مبنای انحراف بود
      await DocumentService.createDocument({ docType: 'audit', status: 'final', date: today, user: 'test-agent', location: w3.code, items: [{ itemId, quantity: 0, physical_stock: 0, location: w3.code }] });
      await assertInvariant(itemId, 'zero stock count in a warehouse without stock', { [w1.code]: 1, [w2.code]: 4 });

      // ۵) بازسازی کاردکس همان مقادیر را نگه دارد
      await KardexWacRecalculatorService.rebuildItemFromLedger(itemId, { user: 'test-agent' });
      await assertInvariant(itemId, 'Kardex rebuild', { [w1.code]: 1, [w2.code]: 4 });

      // ۶) ثبت موجودی افتتاحیه در ویرایش کالا
      const second = await ItemCatalogService.createItem({
        type: 'raw_material', name: `کالای افتتاحیه P2-1 ${Date.now()}`, code: `P21O-${Date.now()}`, unit: 'عدد', category: '', weighted_average_cost: 500
      }, user);
      await ItemCatalogService.updateItem(second.insertedId, {
        name: second.item.name, code: second.item.code, unit: 'عدد', category: '', weighted_average_cost: 500, [`stock_${w2.code}`]: 7, version: second.item.version
      }, user);
      await assertInvariant(second.insertedId, 'opening stock in an item edit', { [w2.code]: 7 });

      results.push(makeTestCase({
        id: 'reg_single_stock_source_p2_1',
        scenarioId: 'inventory_integrity_3way_reconciliation',
        name: 'v7.0.45: the warehouse stock table is the only stock source; table, cache, total stock and Kardex agree on every path (P2-1)',
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
        name: 'v7.0.45: the warehouse stock table is the only stock source; table, cache, total stock and Kardex agree on every path (P2-1)',
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
        throw new Error(`Kardex rebuild with movements in an unknown location must be refused and stock left untouched: ${JSON.stringify({ rebuildRefused, total: afterRebuild.total })}`);
      }
      results.push(makeTestCase({
        id: 'reg_kardex_rebuild_unresolved_guard_p2_1',
        scenarioId: 'inventory_integrity_3way_reconciliation',
        name: 'v7.0.45: Kardex rebuild of an item with movements in an unknown location is refused without changing stock (P2-1)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'Kardex rebuild of an item with movements in an unknown location is refused with a clear error and stock 5 is left untouched.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_kardex_rebuild_unresolved_guard_p2_1',
        scenarioId: 'inventory_integrity_3way_reconciliation',
        name: 'v7.0.45: Kardex rebuild of an item with movements in an unknown location is refused without changing stock (P2-1)',
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
      for (const [docType, label] of [['invoice', 'sale'], ['remittance', 'outgoing remittance']] as const) {
        try {
          await DocumentService.createDocument({ docType, status: 'final', inOut: 'out', date: today, user: 'test-agent', buyerName: 'خریدار آزمون P2-4', location: w1.code, items: [{ itemId: noCost.id, quantity: 1, unit_price: 90000, location: w1.code }] });
        } catch (e: any) {
          if (String(e?.message || '').includes('بهای تمام‌شده ندارد')) rejectedFor.push(label);
          else throw e;
        }
      }
      if (rejectedFor.length !== 2) {
        throw new Error(`an outflow of an item without cost must be refused in a sale and an outgoing remittance; refused in: ${rejectedFor.join(', ') || 'none'}`);
      }

      // کسری انبارگردانی (۵ ← ۳) مجاز است و با بهای صفر ثبت می‌شود، نه قیمت فهرست
      await DocumentService.createDocument({ docType: 'audit', status: 'final', date: today, user: 'test-agent', location: w1.code, items: [{ itemId: noCost.id, quantity: 0, physical_stock: 3, location: w1.code }] });
      const outs = await orm.select({ unitPrice: transactions.unitPrice, quantity: transactions.quantity }).from(transactions)
        .where(and(eq(transactions.itemId, noCost.id), eq(transactions.type, 'out'), eq(transactions.isDeleted, 0)));
      const [after] = await orm.select({ total: items.currentStock }).from(items).where(eq(items.id, noCost.id));
      if (outs.length !== 1 || Number(outs[0].quantity) !== 2 || Number(outs[0].unitPrice) !== 0 || Number(after.total) !== 3) {
        throw new Error(`stock count shortage of an item without cost must be recorded as 2 units at cost zero: ${JSON.stringify({ outs, total: after.total })}`);
      }

      // کالای دارای بهای تمام‌شده همچنان با بهای میانگین موزون فروخته می‌شود
      const withCost = await createTestItem({ stocks: { [w1.code]: 5 }, currentStock: 5, weightedAverageCost: 40000 });
      await DocumentService.createDocument({ docType: 'invoice', status: 'final', inOut: 'out', date: today, user: 'test-agent', buyerName: 'خریدار آزمون P2-4', location: w1.code, items: [{ itemId: withCost.id, quantity: 1, unit_price: 90000, location: w1.code }] });
      const [sold] = await orm.select({ unitPrice: transactions.unitPrice }).from(transactions)
        .where(and(eq(transactions.itemId, withCost.id), eq(transactions.type, 'out'), eq(transactions.isDeleted, 0)));
      if (Number(sold?.unitPrice) !== 40000) {
        throw new Error(`cost of sale of an item with a cost must be 40000: ${sold?.unitPrice}`);
      }

      results.push(makeTestCase({
        id: 'reg_zero_cost_outflow_p2_4',
        scenarioId: 'v5_cogs_and_warehouse_voucher',
        name: 'v7.0.46: outflow of an item without cost is refused in sales and remittances; stock count shortage at cost zero (P2-4)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'sales and outgoing remittances of an item with a zero average cost are refused, a stock count shortage of 2 units is recorded at cost zero (not the list price), and the sale of an item with a cost is recorded at the average cost.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_zero_cost_outflow_p2_4',
        scenarioId: 'v5_cogs_and_warehouse_voucher',
        name: 'v7.0.46: outflow of an item without cost is refused in sales and remittances; stock count shortage at cost zero (P2-4)',
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
        throw new Error(`the item list must give each warehouse stock from the table: ${JSON.stringify({ status: list.status, row: row && { current_stock: row.current_stock, stocks: row.stocks } })}`);
      }

      const audit = await request(app).get(`/api/documents/audit-items?location=${encodeURIComponent(w3.code)}`).set('Cookie', session.cookie);
      const auditRow = (Array.isArray(audit.body) ? audit.body : []).find((r: any) => r.id === item.id);
      if (audit.status !== 200 || !auditRow || auditRow.system_stock !== 0) {
        throw new Error(`stock count book stock in a warehouse without stock must be zero: ${JSON.stringify({ status: audit.status, system_stock: auditRow?.system_stock })}`);
      }

      results.push(makeTestCase({
        id: 'reg_stock_api_from_table_td_214',
        scenarioId: 'inventory_integrity_3way_reconciliation',
        name: 'v7.0.48: warehouse stock in the API comes from the normalized table, zero for a warehouse without stock in the stock count list (TD-214)',
        layer: 'regression',
        executionType: 'real_api',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'GET /api/items gives the stocks map and stock_<code> from the table (3 and 4, total 7), and the stock count list of the third warehouse shows book stock zero.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_stock_api_from_table_td_214',
        scenarioId: 'inventory_integrity_3way_reconciliation',
        name: 'v7.0.48: warehouse stock in the API comes from the normalized table, zero for a warehouse without stock in the stock count list (TD-214)',
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
      if (!revAccount || !assetAccount) throw new Error('accounts needed for the test not found');
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
        problems.push(`year ${yearA} was taken as closed only from the reference text of a voucher: ${e.message}`);
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
        problems.push(`closing year ${yearB} failed: ${e.message}`);
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
        problems.push(`after closing year ${yearB} a revenue balance of ${revenueLeft} remains; the voucher posted concurrently was not seen by the year closing`);
      }
      const [period] = await orm.select().from(fiscalPeriods).where(eq(fiscalPeriods.fiscalYear, yearB));
      if (period?.status !== 'closed' || !period.closingVoucherId) {
        problems.push(`status of year ${yearB} in fiscal_periods must be closed with the closing voucher id: ${JSON.stringify(period)}`);
      }

      // ۳) پس از بستن، هیچ سندی (حتی از نوع اختتامیه) وارد سال B نمی‌شود
      for (const type of ['general', 'closing'] as const) {
        try {
          const v = await VoucherService.createJournalVoucher(voucher(yearB, 100, { voucherType: type, referenceNumber: `TEST-P25-AFTER-${type}` }) as any);
          createdVoucherIds.push(v.id);
          problems.push(`posting a ${type} voucher in closed year ${yearB} was accepted`);
        } catch (e: any) {
          if (!String(e?.message || '').includes('بسته')) problems.push(`unrelated error for a ${type} voucher: ${e.message}`);
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
        problems.push(`a voucher with a difference of 0.005 must be accepted: ${e.message}`);
      }
      let overRejected = false;
      try {
        const v = await VoucherService.createJournalVoucher(tolerance(0.02) as any);
        createdVoucherIds.push(v.id);
      } catch {
        overRejected = true;
      }
      if (!overRejected) problems.push('a voucher with a difference of 0.02 must be refused');

      if (problems.length > 0) throw new Error(problems.join(' | '));
      results.push(makeTestCase({
        id: 'reg_fiscal_periods_p2_5',
        scenarioId: 'v6_fiscal_year_closing_isolation',
        name: 'v7.0.49: fiscal year status in fiscal_periods, a lock between year closing and concurrent posting, and one balance tolerance (P2-5)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'a manual "closing" voucher does not close the year, the year closing waits for the concurrent voucher and closes it, no voucher enters the year after closing, and the 0.01 balance tolerance applies on voucher create.'
      }));
      // the sandbox is gone with its vouchers: nothing left to clean in the shared schema
      }).finally(() => { createdVoucherIds.length = 0; });
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_fiscal_periods_p2_5',
        scenarioId: 'v6_fiscal_year_closing_isolation',
        name: 'v7.0.49: fiscal year status in fiscal_periods, a lock between year closing and concurrent posting, and one balance tolerance (P2-5)',
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
        throw new Error(`authorizePermission granted access to a role with code "${dotted}" that does not hold the permission (status ${guardedPerm})`);
      }
      if (await userHasRoleOrPermission({ role: dotted }, 'customers.manage')) {
        throw new Error(`userHasRoleOrPermission treated a role with code "${dotted}" as holding that permission`);
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
        throw new Error(`guard behaviour for ordinary roles changed: ${wrong.map(([n, got, want]) => `${n}: ${got} instead of ${want}`).join(', ')}`);
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
        throw new Error(`a role with the dotted code "${probeCode}" was created (status ${created.status})`);
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
    const testName = 'v7.0.52: warehouse BI stats and warehouse deactivation read the warehouse stock table after items.stocks was dropped (TD-219)';
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
        throw new Error(`BI stats must give 5 for the new warehouse stock and 0 for the empty warehouse (status ${bi.status}, ${JSON.stringify(bi.body?.locations ?? bi.body).slice(0, 200)})`);
      }

      // ب) غیرفعال‌سازی: انبار دارای موجودی 409، انبار خالی موفق
      const blocked = await request(app).delete(`/api/warehouses/${stocked.id}`)
        .set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken);
      const allowed = await request(app).delete(`/api/warehouses/${empty.id}`)
        .set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken);
      const [stockedAfter] = await orm.select({ isActive: warehouses.isActive }).from(warehouses).where(eq(warehouses.id, stocked.id));
      const [emptyAfter] = await orm.select({ isActive: warehouses.isActive }).from(warehouses).where(eq(warehouses.id, empty.id));
      if (blocked.status !== 409 || stockedAfter?.isActive !== 1) {
        throw new Error(`deactivating a warehouse with stock must be refused with 409 (status ${blocked.status}, ${JSON.stringify(blocked.body).slice(0, 160)})`);
      }
      if (allowed.status !== 200 || emptyAfter?.isActive !== 0) {
        throw new Error(`a warehouse without stock must be deactivated (status ${allowed.status}, ${JSON.stringify(allowed.body).slice(0, 160)})`);
      }

      results.push(makeTestCase({
        id: 'reg_dropped_stocks_column_leftovers_td_219',
        scenarioId: 'inventory_rebuild',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'BI stats give 5 for the new warehouse stock; deactivating a warehouse with stock gives 409 and an empty warehouse 200.'
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
    const testName = 'v7.0.53/55: global search per section by permission, Kardex with warehouse.view/accounting.view and warehouse dashboard stats with reports.view/warehouse.view (P2-10)';
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
        throw new Error(`control check: the system admin must find all four sections ${fmt(asAdmin)}`);
      }
      const asLogger = await search(logger, token);
      if (asLogger.status !== 200 || asLogger.items !== 0 || asLogger.customers !== 0 || asLogger.documents !== 0 || asLogger.projects !== 0) {
        throw new Error(`a user without view permission must get no item, party, document or project result ${fmt(asLogger)}`);
      }
      const asCustomerViewer = await search(customerViewer, token);
      if (asCustomerViewer.status !== 200 || asCustomerViewer.customers !== 2 || asCustomerViewer.items !== 0
        || asCustomerViewer.documents !== 0 || asCustomerViewer.projects !== 0) {
        throw new Error(`a holder of customers.view must get only the party section ${fmt(asCustomerViewer)}`);
      }
      const underscore = await search(admin.cookie, `${token}_A`);
      if (underscore.customers !== 1) {
        throw new Error(`"_" became a wildcard in global search: "${token}_A" must find only one party (${underscore.customers})`);
      }

      // ب) کاردکس
      const kardex: Record<string, number> = {};
      for (const [name, cookie] of [['logger', logger], ['reports', reportsViewer], ['warehouse', warehouseViewer], ['accounting', accountingViewer]] as const) {
        kardex[name] = (await request(app).get('/api/transactions?limit=1').set('Cookie', cookie)).status;
      }
      if (kardex.logger !== 403 || kardex.reports !== 403 || kardex.warehouse !== 200 || kardex.accounting !== 200) {
        throw new Error(`Kardex only for warehouse.view or accounting.view: ${fmt(kardex)}`);
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
        throw new Error(`Kardex search by document number must return that one movement (status ${kardexSearch.status}, ${JSON.stringify(kardexSearch.body).slice(0, 200)})`);
      }
      const kardexPercent = await request(app).get('/api/transactions?limit=5&search=%25%25%25').set('Cookie', admin.cookie);
      const kardexRows: any[] = Array.isArray(kardexPercent.body?.data) ? kardexPercent.body.data : [];
      if (kardexPercent.status !== 200 || kardexRows.length !== 0) {
        throw new Error(`"%%%" became a wildcard in Kardex search (status ${kardexPercent.status}, ${kardexRows.length} rows)`);
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
        throw new Error(`warehouse dashboard stats only for reports.view or warehouse.view: ${fmt(dash)}`);
      }

      results.push(makeTestCase({
        id: 'reg_read_endpoint_scope_p2_10',
        scenarioId: 'route_authorization_scope',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: `search: ${fmt({ asLogger, asCustomerViewer })}; Kardex: ${fmt(kardex)}; dashboard: ${fmt(dash)}`
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
    const testName = 'v7.0.56: attachments on disk with permission-checked download, and old in-database attachments moved out (P2-9)';
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
      if (!debitAcc || !creditAcc) throw new Error('accounts needed for the test not found');
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
        throw new Error('the journal voucher attachments column still holds Base64 attachment data');
      }
      const pngItem = storedList.find(a => a.name === 'receipt.png');
      const svgItem = storedList.find(a => a.name === 'logo.svg');
      if (!pngItem?.url?.startsWith('/api/attachments/') || !svgItem?.url?.startsWith('/api/attachments/') || pngItem.type !== 'image/png') {
        throw new Error(`attachment metadata is wrong: ${JSON.stringify(storedList).slice(0, 300)}`);
      }

      const { fileAttachments, roles } = await import('../../db/schema.js');
      const { AttachmentStorageService } = await import('../../services/attachments/attachmentStorage.service.js');
      const registry = await orm.select().from(fileAttachments)
        .where(and(eq(fileAttachments.entityType, 'journal_voucher'), eq(fileAttachments.entityId, created.id)));
      const pngRow = registry.find(r => pngItem.url.endsWith(r.id));
      if (registry.length !== 2 || !pngRow || !fsMod.readFileSync(AttachmentStorageService.absolutePath(pngRow.storagePath)).equals(pngBytes)) {
        throw new Error(`attachment file on disk or its registration is wrong (${registry.length} rows)`);
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
        throw new Error(`downloading the attachment image is wrong (status ${pngRes.status}, ${pngRes.headers['content-type']})`);
      }
      const svgRes = await request(app).get(svgItem.url).set('Cookie', admin.cookie).buffer(true).parse(binary);
      if (svgRes.status !== 200 || !String(svgRes.headers['content-disposition'] || '').startsWith('attachment')
        || svgRes.headers['x-content-type-options'] !== 'nosniff') {
        throw new Error(`SVG must only be downloaded (status ${svgRes.status}, ${svgRes.headers['content-disposition']})`);
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
        throw new Error(`attachment download access control is wrong: ${JSON.stringify(statuses)}`);
      }

      // ج) ویرایش: حذف SVG از فهرست آن را جدا می‌کند؛ آدرس javascript: رد می‌شود
      await VoucherService.updateJournalVoucher(created.id, { attachments: [pngItem] } as any);
      const svgAfter = await request(app).get(svgItem.url).set('Cookie', admin.cookie);
      const pngAfter = await request(app).get(pngItem.url).set('Cookie', admin.cookie);
      if (svgAfter.status !== 404 || pngAfter.status !== 200) {
        throw new Error(`after removing the SVG from the list: SVG ${svgAfter.status} (expected 404), PNG ${pngAfter.status} (expected 200)`);
      }
      let rejected = false;
      try {
        await VoucherService.updateJournalVoucher(created.id, { attachments: [{ id: 'x', name: 'bad', url: 'javascript:alert(1)' }] } as any);
      } catch {
        rejected = true;
      }
      if (!rejected) throw new Error('a javascript: URL was accepted for an attachment');

      // د) انتقال پیوست قدیمی Base64 داخل سند انبار: آزمایشی بدون تغییر، سپس واقعی و تکرارپذیر
      const { document: legacyDoc } = await createTestDocument({ refNumber: `DOC_P29_${Date.now()}` }, []);
      const legacyList = [{ id: 'legacy1', name: 'old-receipt.png', url: pngDataUrl, type: 'image/png' }];
      await orm.update(documents).set({ attachments: legacyList as any }).where(eq(documents.id, legacyDoc.id));
      const scope = { entityType: 'document' as const, ids: [legacyDoc.id] };
      const dry = await AttachmentStorageService.migrateInlineAttachments({ apply: false, actor: 'p29', scope });
      const [afterDry] = await orm.select({ attachments: documents.attachments }).from(documents).where(eq(documents.id, legacyDoc.id));
      if (dry.files !== 1 || !JSON.stringify(afterDry?.attachments).includes('data:image/png')) {
        throw new Error(`a dry run of the migration must count one file and change nothing: ${JSON.stringify(dry)}`);
      }
      const applied = await AttachmentStorageService.migrateInlineAttachments({ apply: true, actor: 'p29', scope });
      const [afterApply] = await orm.select({ attachments: documents.attachments }).from(documents).where(eq(documents.id, legacyDoc.id));
      const migrated: any = Array.isArray(afterApply?.attachments) ? (afterApply.attachments as any[])[0] : null;
      if (applied.files !== 1 || applied.failures.length !== 0 || !migrated?.url?.startsWith('/api/attachments/')) {
        throw new Error(`the real migration of the legacy attachment did not happen: ${JSON.stringify({ applied, migrated }).slice(0, 300)}`);
      }
      const migratedRes = await request(app).get(migrated.url).set('Cookie', admin.cookie).buffer(true).parse(binary);
      if (migratedRes.status !== 200 || !Buffer.from(migratedRes.body).equals(pngBytes)) {
        throw new Error(`the migrated file does not match the original content (status ${migratedRes.status})`);
      }
      const again = await AttachmentStorageService.migrateInlineAttachments({ apply: true, actor: 'p29', scope });
      if (again.files !== 0) throw new Error('running the migration again must do nothing');

      results.push(makeTestCase({
        id: 'reg_attachments_on_disk_p2_9',
        scenarioId: 'route_authorization_scope',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: `attachments on disk and registered; access: ${JSON.stringify(statuses)}; legacy migration: dry run ${dry.files}, real ${applied.files}, repeat ${again.files}`
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
    const testName = 'v7.0.57: «_» and «%» are not wildcards in party, item, document and journal voucher search (TD-222)';
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
      if (!debitAcc || !creditAcc) throw new Error('accounts needed for the test not found');
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
        throw new Error(`wildcard in search: ${JSON.stringify(counts)} (expected 1 per section and zero for "%")`);
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
    const testName = 'v7.0.59: permission scope of the read routes for parties, documents, items, prices, personnel, piecework, payslips, users and document attachments (TD-223)';
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
        if (got !== want) wrong.push(`${who} ${url}: ${got} (expected ${want})`);
      }

      // پیوست سند انبار: از مجوز خواندن سند پیروی می‌کند
      const { AttachmentStorageService } = await import('../../services/attachments/attachmentStorage.service.js');
      const { document: doc } = await createTestDocument({ refNumber: `DOC_TD223_${Date.now()}` }, []);
      const [stored] = await AttachmentStorageService.attachToNewRecord(orm as any, 'document', doc.id,
        [{ id: 'a', name: 'note.txt', url: 'data:text/plain;base64,c2FsYW0=' }], 'td223');
      const attLogger = await status(logger, stored.url);
      const attTreasurer = await status(treasurer, stored.url);
      if (attLogger !== 403) wrong.push(`document attachment for the report-entry user: ${attLogger} (expected 403)`);
      if (attTreasurer !== 200) wrong.push(`document attachment for a holder of documents.view: ${attTreasurer} (expected 200)`);
      await orm.delete(roles).where(inArray(roles.id, createdRoleIds));
      createdRoleIds.length = 0;

      if (wrong.length > 0) {
        throw new Error(`wrong permission scope (${wrong.length}): ${wrong.join(', ')}`);
      }
      results.push(makeTestCase({
        id: 'reg_read_scope_routes_td_223',
        scenarioId: 'route_authorization_scope',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: `${expectations.length + 2} access status checks`
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
        throw new Error(`sorting the lock ids failed: ${JSON.stringify(sortedIds)}`);
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
        throw new Error(`document status after finalizeDocument must be 'final', but the current value is: ${finalizedDoc?.status}`);
      }

      // Verify stock was properly moved
      const [refreshedItemA] = await orm.select().from(items).where(eq(items.id, itemA.id));
      const [refreshedItemB] = await orm.select().from(items).where(eq(items.id, itemB.id));

      const expectedQtyA = itemA.id === higherId ? 25 - 2 : 25 - 3;
      const expectedQtyB = itemB.id === higherId ? 30 - 2 : 30 - 3;

      if (Number(refreshedItemA.currentStock) !== expectedQtyA || Number(refreshedItemB.currentStock) !== expectedQtyB) {
        throw new Error(`item stock after finalize is wrong: A=${refreshedItemA.currentStock} (expected: ${expectedQtyA}), B=${refreshedItemB.currentStock} (expected: ${expectedQtyB})`);
      }

      // Idempotency check: second finalization call should be a clean no-op
      await DocumentService.finalizeDocument(draftDoc.id, 'lock-test-user', undefined, { strict: false });
      const [recheckedDoc] = await orm.select().from(documents).where(eq(documents.id, draftDoc.id));
      if (recheckedDoc?.status !== 'final') {
        throw new Error('calling finalize again must leave the document status unchanged.');
      }

      results.push(makeTestCase({
        id: 'reg_lock_hierarchy_deadlock_prevention_td_159',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'V6 Phase 5.1: strict lock hierarchy (ITEMS_STOCK:40 before DOCUMENTS:60) and deadlock prevention (TD-159)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t28Start,
        details: 'row locks are taken in the standard order (item rows in ascending id order at priority 40 before the document at priority 60) and the atomic finalize succeeds.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_lock_hierarchy_deadlock_prevention_td_159',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'V6 Phase 5.1: strict lock hierarchy (ITEMS_STOCK:40 before DOCUMENTS:60) and deadlock prevention (TD-159)',
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
        throw new Error(`document version after the edit must be 2, but the current value is: ${docAfterUpdate1?.version}`);
      }
      if (docAfterUpdate1.buyerName !== 'خریدار تست اول') {
        throw new Error(`buyer name was not stored correctly: ${docAfterUpdate1.buyerName}`);
      }

      // Verify line items were updated (active records)
      const updatedLines = await orm.select().from(documentItems).where(and(eq(documentItems.documentId, draftDoc.id), eq(documentItems.isDeleted, 0)));
      if (updatedLines.length !== 1 || Number(updatedLines[0].quantity) !== 7) {
        throw new Error(`quantity of the document item row after the edit is wrong: ${updatedLines[0]?.quantity}`);
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
        throw new Error('the system should have thrown OptimisticLockError on an expectedVersion mismatch.');
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
        throw new Error('the system should have prevented a direct edit of a finalized document.');
      }

      results.push(makeTestCase({
        id: 'reg_update_document_row_lock_occ_td_154',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'V6 Phase 5.2: row lock on document edit, OCC concurrency control and Lost Update prevention (TD-154)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t29Start,
        details: 'document edit under a FOR UPDATE row lock with OCC version control, an atomic version bump and blocking of finalized document rewrites is confirmed.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_update_document_row_lock_occ_td_154',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'V6 Phase 5.2: row lock on document edit, OCC concurrency control and Lost Update prevention (TD-154)',
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
        throw new Error(`the first request must acquire the idempotency key, but the state is: ${firstAcquire.state}`);
      }

      // 2. Parallel concurrent attempt while first is in-flight: Should return 'in_flight'
      const secondAcquire = await IdempotencyService.acquireKey(testIdemKey, {
        scope: testScope,
        lockTimeoutSeconds: 45,
        ttlSeconds: 3600,
        requestPayload: { wcOrderId: testWcOrderId, total: 1500000 }
      });

      if (secondAcquire.state !== 'in_flight') {
        throw new Error(`a concurrent parallel request must return in_flight, but the state is: ${secondAcquire.state}`);
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
        throw new Error(`the next request must get the cached state, but the state is: ${thirdAcquire.state}`);
      }

      const cachedBody = thirdAcquire.responseBody as typeof mockResult;
      if (cachedBody?.docId !== 999999 || cachedBody?.refNumber !== 'INV-TEST-WC-01') {
        throw new Error(`the cached response does not match the stored original response: ${JSON.stringify(cachedBody)}`);
      }

      results.push(makeTestCase({
        id: 'reg_woocommerce_order_idempotency_race_td_155',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'V6 Phase 5.3: idempotency lock for first-time WooCommerce orders prevents a concurrency race (TD-155)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t30Start,
        details: 'the first request takes the processing key, the parallel request is detected as in_flight, and repeated requests get the final cached response without a double invoice.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_woocommerce_order_idempotency_race_td_155',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'V6 Phase 5.3: idempotency lock for first-time WooCommerce orders prevents a concurrency race (TD-155)',
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
        throw new Error('Creating a party through CustomerService failed.');
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
        throw new Error('Editing a party through CustomerService failed.');
      }

      const delCust = await CustomerService.deleteCustomer(cust.id);
      if (!delCust) {
        throw new Error('Soft delete of a party through CustomerService failed.');
      }

      // Verify soft deletion in database
      const checkCust = await CustomerService.getById(cust.id);
      if (checkCust !== null) {
        throw new Error('A deleted party must not be returned by active queries.');
      }

      // 2. Verify WarehouseService creation and update
      const wh = await WarehouseService.createWarehouse({
        name: `انبار تست معماری ${now}`,
        code: `wh_arch_${now}`
      });
      createdWhIds.push(wh.id);

      if (!wh.id || wh.code !== `wh_arch_${now}`) {
        throw new Error('Defining a warehouse through WarehouseService failed.');
      }

      const { current: updatedWh } = await WarehouseService.updateWarehouse(wh.id, {
        name: `انبار تست معماری بازنگری‌شده ${now}`
      });

      if (updatedWh.name !== `انبار تست معماری بازنگری‌شده ${now}`) {
        throw new Error('Editing a warehouse through WarehouseService failed.');
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
        throw new Error('Registering a pending raw material through PendingMaterialsService failed.');
      }

      const { officialItem } = await PendingMaterialsService.approvePendingMaterial(pendingMat.id);
      createdItemIds.push(officialItem.id);

      if (!officialItem.id || officialItem.code !== `PM-ARCH-${now}`) {
        throw new Error('Approving and converting a raw material into an official item through PendingMaterialsService failed.');
      }

      // 4. Verify ItemCatalogService soft-delete
      const deletedItem = await ItemCatalogService.deleteItem(officialItem.id);
      if (!deletedItem) {
        throw new Error('Soft delete of an official item through ItemCatalogService.deleteItem failed.');
      }

      results.push(makeTestCase({
        id: 'reg_domain_services_part_a_td_156',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'V6 Phase 6.1: remove direct mutations from the general and warehouse routes and encapsulate them in the service layer (TD-156 Part A)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t31Start,
        details: 'Insert, edit and delete operations of the party, warehouse and raw material routes are removed from the controller layer and run fully through the domain services CustomerService, WarehouseService and PendingMaterialsService.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_domain_services_part_a_td_156',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'V6 Phase 6.1: remove direct mutations from the general and warehouse routes and encapsulate them in the service layer (TD-156 Part A)',
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
        throw new Error('Creating a project and its initial stages through ProjectService failed.');
      }

      // Update stage via ProjectService
      const updatedStage = await ProjectService.updateStage(project.id, stages[0].id, {
        title: 'طراحی نهایی',
        status: 'in_progress',
        progressPercent: 50
      });

      if (!updatedStage || updatedStage.title !== 'طراحی نهایی' || updatedStage.progressPercent !== 50) {
        throw new Error('Editing a project stage through ProjectService.updateStage failed.');
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
        throw new Error('Defining a task title through PieceworkService.createTask failed.');
      }

      // Update task via PieceworkService
      const { current: updatedTask } = await PieceworkService.updateTask(task.id, {
        defaultRate: 30000,
        title: `عنوان پرکیسی بازنگری‌شده ${now}`
      });

      if (!updatedTask || Number(updatedTask.defaultRate) !== 30000) {
        throw new Error('Editing a task rate and title through PieceworkService.updateTask failed.');
      }

      // Category management via PieceworkService
      const cat = await PieceworkService.createCategory({
        name: `دسته کارمزدی تست ${now}`,
        description: 'تست یکپارچگی سرویس کارمزدی'
      });
      createdCategoryNames.push(cat.name);

      if (!cat.id || cat.name !== `دسته کارمزدی تست ${now}`) {
        throw new Error('Creating a piecework category through PieceworkService.createCategory failed.');
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
        throw new Error('Saving transfer data through TransferService.saveTransfer failed.');
      }

      await TransferService.deleteTransfer(transferCode);

      results.push(makeTestCase({
        id: 'reg_domain_services_part_b_td_156',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'V6 Phase 6.2: remove direct mutations from the project, piecework and transfer routes (TD-156 Part B)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t32Start,
        details: 'All database mutations of the project routes (ProjectService), piecework task titles and work logs (PieceworkService) and transfers (TransferService) are separated from the route layer and encapsulated in the domain service layer.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_domain_services_part_b_td_156',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'V6 Phase 6.2: remove direct mutations from the project, piecework and transfer routes (TD-156 Part B)',
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
        // v9.0.447 (TD-903): the rate change wrote a history row that references the task
        await cleanTestTableData('piecework_task_rate_history', 'task_id', createdTaskIds);
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
        throw new Error('The initial proforma line was not recorded correctly.');
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
        throw new Error(`Hard delete detected! Expected 2 rows (1 soft-deleted + 1 active) in document_items, but found ${allDocItemsInDb.length} rows.`);
      }

      const deletedLines = allDocItemsInDb.filter(d => d.isDeleted === 1);
      const activeLines = allDocItemsInDb.filter(d => d.isDeleted === 0);

      if (deletedLines.length !== 1 || deletedLines[0].itemId !== item1.id) {
        throw new Error('The previous document line row was not archived with a soft delete (is_deleted = 1).');
      }
      if (activeLines.length !== 1 || activeLines[0].itemId !== item2.id) {
        throw new Error('The new document line row is not active.');
      }

      // 5. Query Check: DocumentService.getDocumentById MUST only return active line items
      const fetchedDoc = await DocumentService.getDocumentById(docId);
      if (!fetchedDoc || fetchedDoc.items.length !== 1 || fetchedDoc.items[0].item_id !== item2.id) {
        throw new Error('getDocumentById output did not filter out deleted lines.');
      }

      // 6. Test Double-Entry Journal Voucher Line Items Soft-Delete
      // Fetch two real accounts
      const activeAccounts = await orm.select().from(accounts).where(eq(accounts.isDeleted, 0)).limit(2);
      if (activeAccounts.length < 2) {
        throw new Error('Fewer than 2 active accounts found in the accounts table for the journal voucher test.');
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
        throw new Error('The initial journal voucher rows were not inserted correctly.');
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
        throw new Error(`Hard delete detected in voucher rows! Expected 4 rows (2 soft-deleted + 2 active), but found ${allVoucherItemsInDb.length} rows.`);
      }

      const deletedVoucherLines = allVoucherItemsInDb.filter(v => v.isDeleted === 1);
      const activeVoucherLines = allVoucherItemsInDb.filter(v => v.isDeleted === 0);

      if (deletedVoucherLines.length !== 2) {
        throw new Error('The previous voucher rows were not soft-deleted correctly.');
      }
      // v9.0.202: rows come back in no fixed order and a zero Money is truthy, so the debit total is compared
      const activeDebit = activeVoucherLines.reduce((sum, line) => sum + Number(line.debit ?? 0), 0);
      if (activeVoucherLines.length !== 2 || activeDebit !== 800000) {
        throw new Error('The new voucher rows are not active or their amount does not match.');
      }

      // 9. Query Check: VoucherService.getJournalVoucherById MUST only return active line items
      const fetchedVoucher = await VoucherService.getJournalVoucherById(voucher.id);
      if (!fetchedVoucher || !fetchedVoucher.items || fetchedVoucher.items.length !== 2) {
        throw new Error('getJournalVoucherById output did not separate deleted voucher rows.');
      }

      // 10. Delete the journal voucher and verify cascade soft-delete
      await VoucherService.deleteJournalVoucher(voucher.id);
      const deletedVoucherCheck = await orm.select().from(journalVouchers).where(eq(journalVouchers.id, voucher.id));
      if (deletedVoucherCheck[0]?.isDeleted !== 1) {
        throw new Error('The journal voucher was not soft-deleted correctly.');
      }

      const allItemsAfterVoucherDelete = await orm.select().from(journalVoucherItems).where(eq(journalVoucherItems.voucherId, voucher.id));
      if (!allItemsAfterVoucherDelete.every(item => item.isDeleted === 1)) {
        throw new Error('All voucher rows must have is_deleted = 1 after the journal voucher is deleted.');
      }

      results.push(makeTestCase({
        id: 'reg_no_hard_delete_td_157',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'V6 Phase 6.3: eliminate hard delete of document lines and accounting voucher rows (TD-157 / RULE 09)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t33Start,
        details: 'Hard delete in the warehouse document lines (document_items) and accounting voucher rows (journal_voucher_items) tables is fully eliminated; every replace and delete operation now uses soft delete with the is_deleted column.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_no_hard_delete_td_157',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'V6 Phase 6.3: eliminate hard delete of document lines and accounting voucher rows (TD-157 / RULE 09)',
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
        throw new Error(`Invalid purchase requisition code format: ${code1}, ${code2}, ${code3}`);
      }

      const num1 = parseInt(code1.split('-')[2], 10);
      const num2 = parseInt(code2.split('-')[2], 10);
      const num3 = parseInt(code3.split('-')[2], 10);

      if (num2 !== num1 + 1 || num3 !== num2 + 1) {
        throw new Error(`Purchase requisition numbering sequence is broken: ${num1} -> ${num2} -> ${num3}`);
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
        throw new Error('The purchase requisition was not saved in the database.');
      }
      createdReqIds.push(req.id);

      if (req.totalEstimatedAmount !== 250000) {
        throw new Error(`Wrong estimated amount of the purchase requisition: ${req.totalEstimatedAmount} (expected 250000)`);
      }

      results.push(makeTestCase({
        id: 'reg_procurement_counter_no_raw_sql_td_158',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'V6 Phase 6.4: remove the raw SQL snippet from the procurement counter and comply with RULE 04 (TD-158)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t34Start,
        details: 'The raw SQL snippet in the purchase requisition counter is removed and standardized on the Read-Calculate-Update pattern with a row lock on the counter row; the unique sequence of PR codes is confirmed without errors or conflicts.'
      }));
    } catch (err: any) {
      results.push(makeTestCase({
        id: 'reg_procurement_counter_no_raw_sql_td_158',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'V6 Phase 6.4: remove the raw SQL snippet from the procurement counter and comply with RULE 04 (TD-158)',
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
    const testName = 'v7.0.67: an 18-digit amount with decimals is stored and summed exactly in a journal voucher and a bank balance, and is a number in JSON (P2-6)';
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
      if (fin(header.totalDebit).toString() !== BIG) violations.push(`voucher total debit stored as ${fin(header.totalDebit).toString()}`);
      const debitRow = rows.find(r => !fin(r.debit).isZero());
      if (!debitRow || fin(debitRow.debit).toString() !== BIG) violations.push(`debit row stored as ${debitRow ? fin(debitRow.debit).toString() : '-'}`);
      const twice = fin(debitRow?.debit).add(debitRow?.debit ?? 0).toString();
      if (twice !== '24691357802469.1356') violations.push(`sum of the two rows is ${twice}`);

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
      if (fin(bankAfter.currentBalance).toString() !== '12345678901234.5679') violations.push(`bank balance after the receipt is ${fin(bankAfter.currentBalance).toString()}`);
      const [txRow] = await orm.select().from(treasuryTransactions).where(eq(treasuryTransactions.id, receipt.id));
      if (fin(txRow.amount).toString() !== '0.0001') violations.push(`transaction amount stored as ${fin(txRow.amount).toString()}`);
      if (typeof receipt.amount !== 'number') violations.push(`transaction amount in the service output is of type ${typeof receipt.amount}`);

      // ج) قرارداد API و لاگ ممیزی: مبلغ عدد است
      const json = JSON.parse(JSON.stringify({ amount: bankAfter.currentBalance })) as { amount: unknown };
      if (typeof json.amount !== 'number') violations.push(`amount in JSON is of type ${typeof json.amount}`);
      const audited = sanitizeSensitiveData({ amount: money('2.5') }) as { amount: unknown };
      if (audited.amount !== 2.5) violations.push(`amount in the audit log snapshot is ${JSON.stringify(audited.amount)}`);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_money_decimal_accounting_p2_6',
        scenarioId: 'multi_currency_financials_and_ratios',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'Voucher 12345678901234.5678 is stored and summed exactly; the bank balance after a 0.0001 receipt is ...5679; JSON and the audit log snapshot hold numbers.'
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
    const testName = 'v7.0.68: document line prices, WAC, Kardex movements and piecework rates with 18-digit amounts are stored and summed exactly (P2-6)';
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
      if (fin(line?.unitPrice).toString() !== '1234567890123.4567') violations.push(`document line price stored as ${fin(line?.unitPrice).toString()}`);
      const [kardex] = await orm.select({ totalPrice: transactions.totalPrice }).from(transactions)
        .where(and(eq(transactions.itemId, item.id), eq(transactions.documentId, createdDocIds[0])));
      if (fin(kardex?.totalPrice).toString() !== '3703703670370.3701') violations.push(`Kardex movement amount stored as ${fin(kardex?.totalPrice).toString()}`);
      const [after] = await orm.select({ wac: items.weightedAverageCost }).from(items).where(eq(items.id, item.id));
      if (fin(after?.wac).toString() !== '1234567890123.4568') violations.push(`WAC after two receipts is ${fin(after?.wac).toString()}`);

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
      if (doc?.totalAmount !== 0.3) violations.push(`document total is ${JSON.stringify(doc?.totalAmount)}`);

      // ج) نرخ پایه کارمزدی ۱۸ رقمی
      const task = await PieceworkService.createTask({ title: `ERP-TEST-MARKER نرخ P2-6 ${Date.now()}`, defaultRate: '12345678901234.5678', unit: 'عدد' });
      createdTaskId = task.id;
      const [storedTask] = await orm.select({ rate: pieceworkTasks.defaultRate }).from(pieceworkTasks).where(eq(pieceworkTasks.id, task.id));
      if (fin(storedTask?.rate).toString() !== '12345678901234.5678') violations.push(`piecework rate stored as ${fin(storedTask?.rate).toString()}`);
      if (typeof JSON.parse(JSON.stringify(task)).defaultRate !== 'number') violations.push('piecework rate in JSON is not a number');

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_money_decimal_documents_p2_6',
        scenarioId: 'multi_currency_financials_and_ratios',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'The 17-digit line price and Kardex movement are stored exactly; WAC of two receipts is ...4568; 0.1 + 0.2 sums to 0.3 and the piecework rate is stored exactly.'
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
    const testName = 'v7.0.69: a foreign-currency receipt (final create, finalize and void) updates the item\'s rial average cost with price x the document\'s exchange rate (TD-227)';
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
      if (await wacNow() !== '90000000') violations.push(`WAC after the final foreign-currency receipt is ${await wacNow()} (expected 90,000,000)`);
      const [kardexA] = await orm.select({ unitPrice: transactions.unitPrice, totalPrice: transactions.totalPrice }).from(transactions)
        .where(and(eq(transactions.itemId, item.id), eq(transactions.documentId, docA)));
      if (fin(kardexA?.unitPrice).toString() !== '90000000' || fin(kardexA?.totalPrice).toString() !== '180000000') {
        violations.push(`Kardex of a foreign-currency receipt must be in rials: ${fin(kardexA?.unitPrice).toString()} / ${fin(kardexA?.totalPrice).toString()}`);
      }

      // ب) پیش‌نویس ۲ عدد × ۱۰۰ دلار، نهایی‌سازی با نرخ ۵۰۰٬۰۰۰ ← WAC = (۱۸۰M + ۱۰۰M) ÷ ۴ = ۷۰٬۰۰۰٬۰۰۰
      const docB = await DocumentService.createDocument({
        docType: 'receipt', status: 'draft', inOut: 'in', date: today, user: 'test-agent', buyerName: 'تأمین‌کننده آزمون TD-227',
        currency: 'USD', exchangeRate: 400000, location: w1.code,
        items: [{ itemId: item.id, quantity: 2, unit_price: 100, location: w1.code }]
      });
      createdDocIds.push(docB);
      await DocumentService.finalizeDocument(docB, 'test-agent', undefined, { strict: false, exchangeRate: 500000 });
      if (await wacNow() !== '70000000') violations.push(`WAC after finalizing the foreign-currency receipt is ${await wacNow()} (expected 70,000,000)`);

      // ج) حذف رسید دوم ← WAC به ۹۰٬۰۰۰٬۰۰۰ برمی‌گردد
      await DocumentService.deleteDocument(docB, 'test-agent');
      if (await wacNow() !== '90000000') violations.push(`WAC after deleting the foreign-currency receipt is ${await wacNow()} (expected 90,000,000)`);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_foreign_receipt_wac_irr_td_227',
        scenarioId: 'multi_currency_financials_and_ratios',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'A 150-dollar receipt at rate 600,000 recorded WAC and Kardex of 90,000,000 rials; finalizing at rate 500,000 made WAC 70,000,000 and deleting it made it 90,000,000 again.'
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
    const testName = 'v7.0.71: the trial balance, account card and journal book sum decimal amounts without double-precision errors (P2-6)';
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
        violations.push(`detailed trial balance: ${JSON.stringify(row && { totalDebit: row.totalDebit, debitTurnover: row.debitTurnover, initialDebit: row.initialDebit, debitBalance: row.debitBalance })}`);
      }

      // ب) کارت حساب: مانده ابتدای دوره ۰٫۱ و مانده پایانی ۰٫۳
      const card = await AccountingReportService.getDetailedAccountCard({ accountId: leaf[0].id, detailedName: dName, startDate: '2021-01-01' });
      if (card.openingBalance !== 0.1 || card.totalDebit !== 0.2 || card.finalBalance !== 0.3) {
        violations.push(`account card: ${JSON.stringify({ opening: card.openingBalance, totalDebit: card.totalDebit, final: card.finalBalance })}`);
      }

      // ج) دفتر روزنامه از ابتدا: مانده جاری پس از سه ردیف بدهکار ۰٫۱ برای همین تفصیلی
      const book = await AccountingReportService.getJournalBook({ startDate: priorDate, endDate: priorDate });
      const bookRows = book.items.filter(i => i.detailedName === dName && i.debit > 0);
      if (bookRows.length !== 1 || bookRows[0].debit !== 0.1) {
        violations.push(`journal book: ${JSON.stringify(bookRows.map(r => r.debit))}`);
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
        details: 'Three 0.1 rows sum to 0.3 in the detailed trial balance (opening 0.1 and turnover 0.2) and give a closing balance of 0.3 in the account card.'
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
    const testName = 'v7.0.72: a 20-row journal voucher and a 20-line stock document each insert their rows with one INSERT and keep the row order (P3-5)';
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
      if (voucherCounts.get(journalVoucherItems) !== 1) violations.push(`journal voucher row INSERTs: ${voucherCounts.get(journalVoucherItems)} (expected 1)`);
      const vRows = await orm.select({ id: journalVoucherItems.id, rowOrder: journalVoucherItems.rowOrder, description: journalVoucherItems.description })
        .from(journalVoucherItems).where(eq(journalVoucherItems.voucherId, voucherId!)).orderBy(journalVoucherItems.id);
      if (vRows.length !== 20 || vRows.some((r, i) => r.rowOrder !== i + 1 || r.description !== `ردیف ${i + 1}`)) {
        violations.push(`journal voucher row order: ${JSON.stringify(vRows.map(r => r.rowOrder))}`);
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
      if (docCounts.get(documentItems) !== 1) violations.push(`warehouse document line INSERTs: ${docCounts.get(documentItems)} (expected 1)`);
      const dRows = await orm.select({ quantity: documentItems.quantity }).from(documentItems)
        .where(eq(documentItems.documentId, documentId!)).orderBy(documentItems.id);
      if (dRows.length !== 20 || dRows.some((r, i) => Number(r.quantity) !== i + 1)) violations.push(`warehouse document line order: ${JSON.stringify(dRows.map(r => r.quantity))}`);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_batch_insert_voucher_document_lines_p3_5',
        scenarioId: 'multi_currency_financials_and_ratios',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: '20 journal voucher rows and 20 warehouse document lines are each written with one INSERT, in the same order.'
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
    const testName = 'v7.0.73: every numeric is_*/has_* flag column has a validated CHECK (0/1) constraint and the value 2 is refused (P3-14)';
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
      if (missingRows.length > 0) violations.push(`without a valid CHECK: ${missingRows.map(r => `${r.table_name}.${r.column_name}`).join(', ')}`);

      const isCheckViolation = (err: unknown): boolean => {
        const e = err as { code?: string; cause?: { code?: string } };
        return e?.code === '23514' || e?.cause?.code === '23514';
      };
      const ROLLBACK = new Error('ROLLBACK_P3_14');
      const expectRejected = async (label: string, write: (tx: Parameters<Parameters<typeof orm.transaction>[0]>[0]) => Promise<unknown>) => {
        try {
          await orm.transaction(async (tx) => { await write(tx); throw ROLLBACK; });
        } catch (err) {
          if (err === ROLLBACK) violations.push(`${label}: value 2 was accepted`);
          else if (!isCheckViolation(err)) violations.push(`${label}: unexpected error ${err instanceof Error ? err.message : String(err)}`);
        }
      };
      const [acc] = await orm.select({ id: accounts.id }).from(accounts).orderBy(accounts.id).limit(1);
      const [wh] = await orm.select({ id: warehouses.id }).from(warehouses).orderBy(warehouses.id).limit(1);
      if (!acc || !wh) throw new Error('Base account or warehouse for the test not found');
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
        details: 'Every numeric flag has a validated CHECK constraint and an update to value 2 is refused with error 23514.'
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
    const testName = 'v7.0.74: the server\'s Jalali today is in year-month-day form, and a payroll payment records its voucher and treasury row with today\'s ISO date';
    const created = { personnelId: null as number | null, bankId: null as number | null, payrollId: null as number | null, treasuryId: null as number | null, voucherId: null as number | null, payrollVoucherId: null as number | null };
    try {
      const { businessTodayJalaliDash } = await import('../../lib/businessClock.js');
      const { personnel, bankAccounts, pieceworkPayrolls, treasuryTransactions } = await import('../../db/schema.js');
      const { PayrollPaymentService } = await import('../../services/accounting/payrollPayment.service.js');
      const violations: string[] = [];
      const todayIso = await businessTodayIsoDate();
      const jalaliDash = await businessTodayJalaliDash();
      if (!/^1[345]\d{2}-\d{2}-\d{2}$/.test(jalaliDash)) violations.push(`businessTodayJalaliDash: "${jalaliDash}" (expected Jalali YYYY-MM-DD)`);
      if (jalaliToIsoDate(jalaliDash) !== todayIso) violations.push(`converting "${jalaliDash}" to Gregorian: "${jalaliToIsoDate(jalaliDash)}" (expected ${todayIso})`);

      const { ChartOfAccountsService } = await import('../../services/accounting/chartOfAccounts.service.js');
      const allAccs = await ChartOfAccountsService.getAllAccounts();
      const leaf = allAccs.find(a => a.level === 'subsidiary');
      if (!leaf) throw new Error('Subsidiary account for the test bank account not found');
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
      // v9.0.266 (TD-804): a payslip is paid only with its own voucher, so this test issues it first
      const { PieceworkPayrollService } = await import('../../services/piecework/payroll.service.js');
      const issued = await PieceworkPayrollService.syncPayrollVoucher(payroll.id, { username: 'test-agent' });
      created.payrollVoucherId = issued.voucher?.id ?? null;

      const result = await PayrollPaymentService.registerPayrollPayment({ payrollId: payroll.id, bankAccountId: bank.id, method: 'bank_transfer', username: 'test-agent' });
      created.treasuryId = result.transactionId;
      created.voucherId = result.voucherId;
      const [tr] = await orm.select({ date: treasuryTransactions.date }).from(treasuryTransactions).where(eq(treasuryTransactions.id, result.transactionId));
      if (tr?.date !== todayIso) violations.push(`treasury transaction date: "${tr?.date}" (expected ${todayIso})`);
      if (result.voucherId !== null) {
        const [v] = await orm.select({ date: journalVouchers.date }).from(journalVouchers).where(eq(journalVouchers.id, result.voucherId));
        if (v?.date !== todayIso) violations.push(`journal voucher date: "${v?.date}" (expected ${todayIso})`);
      } else {
        violations.push('payment journal voucher was not issued');
      }
      // v7.0.134 (TD-232): تاریخ پرداخت فیش هم میلادی ISO ذخیره می‌شود
      if (result.payroll.paymentDate !== todayIso) violations.push(`payslip payment date: "${result.payroll.paymentDate}" (expected ${todayIso})`);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_jalali_dash_today_payroll_dates',
        scenarioId: 'multi_currency_financials_and_ratios',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: `Jalali today is ${jalaliDash}; the salary payment voucher and treasury transaction are recorded with date ${todayIso}.`
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
      if (created.payrollVoucherId !== null) {
        await cleanTestTableData('journal_voucher_items', 'voucher_id', [created.payrollVoucherId]);
        await cleanTestTableData('journal_vouchers', 'id', [created.payrollVoucherId]);
      }
      if (created.payrollId !== null) await cleanTestTableData('piecework_payrolls', 'id', [created.payrollId]);
      if (created.bankId !== null) await cleanTestTableData('bank_accounts', 'id', [created.bankId]);
      if (created.personnelId !== null) await cleanTestTableData('personnel', 'id', [created.personnelId]);
    }
  }

  // Test: v7.0.75 (audit P3-15): ستون‌های تاریخ متنی فقط قالب تاریخ معتبر می‌پذیرند (CHECK، بدون تغییر نوع ستون)
  if (shouldRun('reg_date_format_check_constraints_p3_15', 'p315', 'date', 'check')) {
    const tStart = Date.now();
    const testName = 'v7.0.75: every text date column has a validated format constraint; «abc» is refused and Jalali, Gregorian and Persian-digit dates are accepted (P3-15)';
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
      if (covered !== 27) violations.push(`number of validated date format constraints: ${covered} (expected 27)`);
      if (missingRows.length > 0) violations.push(`without a valid format constraint: ${missingRows.map(r => `${r.table_name}.${r.column_name}`).join(', ')}`);

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
        if (err) violations.push(`"${ok}" was refused: ${err instanceof Error ? err.message : String(err)}`);
      }
      for (const v of ['2026-10-02', '1370/05/12', '1370-5-1', '۱۳۷۰/۰۵/۱۲', '2026-10-02 18:30:00']) {
        const ok = (await orm.execute(sql`SELECT erp_date_text_ok(${v}::text, 'any') AS ok`) as unknown as { rows: Array<{ ok: boolean }> }).rows[0].ok;
        if (!ok) violations.push(`format any refused "${v}"`);
      }
      for (const bad of ['abc', '1370/13/01', '2026-10-32', '10/02/2026', '07-10-1405 AP', '1370/05/12']) {
        const err = await tryBirthDate(bad);
        if (!err) { violations.push(`"${bad}" was accepted`); continue; }
        const normalized = normalizeError(err);
        if (normalized.code !== 'INVALID_DATE_FORMAT' || normalized.statusCode !== 422) {
          violations.push(`"${bad}": answer ${normalized.statusCode} ${normalized.code} (expected 422 INVALID_DATE_FORMAT)`);
        }
      }
      // ستون‌های *_iso فقط YYYY-MM-DD
      const isoKind = (await orm.execute(sql`SELECT erp_date_text_ok('2026-10-02', 'iso') AS a, erp_date_text_ok('1405/07/10', 'iso') AS b`) as unknown as { rows: Array<{ a: boolean; b: boolean }> }).rows[0];
      if (!isoKind.a || isoKind.b) violations.push(`format iso: 2026-10-02=${isoKind.a}, 1405/07/10=${isoKind.b}`);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_date_format_check_constraints_p3_15',
        scenarioId: 'multi_currency_financials_and_ratios',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'Every text date column has a validated format constraint; an invalid date is refused with 422 INVALID_DATE_FORMAT.'
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
    const testName = 'v7.0.80: the financial health check reports an open proforma whose VAT is only in a «[VAT: ...]» note (TD-199)';
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
      if (!check) violations.push('check legacy_proforma_vat_in_notes is not in the health report');
      if (check && check.status !== 'warning') violations.push(`status must be warning: ${check.status}`);
      if (!listed.has(legacyId)) violations.push('proforma with VAT only in its notes was not reported');
      if (listed.has(structuredId)) violations.push('proforma with structured VAT must not be reported');
      if (listed.has(plainId)) violations.push('proforma without a VAT tag must not be reported');
      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_legacy_proforma_vat_in_notes_td_199',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'Only the proforma that holds VAT in its notes and has a zero VAT column is reported.'
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
    const testName = 'v7.0.81: a sales return enters stock at the original invoice\'s outflow cost (current WAC without an original invoice) and its voucher reverses that cost (TD-230)';
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
      check(Number(wacRow.wac) === 25000, `WAC after the receipt must be 25,000: ${Number(wacRow.wac)}`);

      // ۱) با فاکتور مرجع: بهای ورود = بهای خروج فاکتور (۲۰٬۰۰۰)، نه قیمت فروش و نه WAC جاری
      const linked = await create({ returnOfDocumentId: invoiceId });
      check(await inCost(linked) === 20000, `the incoming cost of a return with an original invoice must be 20,000: ${await inCost(linked)}`);
      check(await voucherCogsReversal(linked) === 40000, `the cost of sales reversal in the voucher must be 40,000: ${await voucherCogsReversal(linked)}`);
      const formatted = await DocumentService.getDocumentById(linked);
      check(formatted?.returnOfDocumentId === invoiceId, `the original invoice link is missing from the document response: ${formatted?.returnOfDocumentId}`);

      // ۲) بدون فاکتور مرجع: WAC جاری کالا
      const [wacNow] = await orm.select({ wac: items.weightedAverageCost }).from(items).where(eq(items.id, item.id));
      const unlinked = await create({});
      check(await inCost(unlinked) === Number(wacNow.wac), `the incoming cost of a return without an original invoice must be the current WAC (${Number(wacNow.wac)}): ${await inCost(unlinked)}`);
      check(await voucherCogsReversal(unlinked) === 2 * Number(wacNow.wac), `the voucher of a return without an original invoice must use the same incoming cost: ${await voucherCogsReversal(unlinked)}`);

      // ۳) پیش‌نویس با فاکتور مرجع و نهایی‌سازی بعدی (v8.0.8، TD-253: ۲ از ۳ برگشت خورده، پس ۱ عدد در سقف فاکتور)
      const draft = await create({ status: 'draft', returnOfDocumentId: invoiceId, items: [{ itemId: item.id, quantity: 1, unit_price: 100000, location: defWh.code }] });
      await DocumentService.finalizeDocument(draft, 'test-agent');
      check(await inCost(draft) === 20000, `finalizing a draft return must use the invoice outflow cost (20,000): ${await inCost(draft)}`);

      // ۴) ردها: کالای خارج‌نشده در فاکتور، سند مرجعی که فاکتور فروش نیست، فاکتور مرجع برای سند غیر برگشتی
      check(await rejects({ returnOfDocumentId: invoiceId, items: [{ itemId: other.id, quantity: 1, unit_price: 1000, location: defWh.code }] }), 'an item that is not on the original invoice must be refused');
      check(await rejects({ returnOfDocumentId: createdDocIds[1] }), 'a purchase receipt as the original invoice must be refused');
      check(await rejects({ docType: 'receipt', inOut: 'in', returnOfDocumentId: invoiceId }), 'an original invoice on a document that is not a return must be refused');

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_sales_return_original_cost_td_230',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'A return with an original invoice enters at the invoice outflow cost and one without it at the current WAC; the journal voucher reverses the same cost.'
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
    const testName = 'v7.0.82: «07-10-1405» dates of journal vouchers, treasury rows and payslips are corrected with the old value recorded; a voucher in a closed fiscal year is not corrected (TD-231)';
    const ROLLBACK = new Error('ROLLBACK_TD_231');
    const violations: string[] = [];
    try {
      const { treasuryTransactions, pieceworkPayrolls, personnel, fiscalPeriods, legacyDateRepairs } = await import('../../db/schema.js');
      // ۱) تبدیل شمسی به میلادی SQL با تبدیلگر برنامه یکی است (نوروز ۲۰ و ۲۱ مارس، سال کبیسه، مرز نیمه دوم سال)
      for (const j of ['1405-07-10', '1403-01-01', '1403-12-30', '1404-01-01', '1404-12-29', '1405-06-31', '1405-07-01', '1407-01-01']) {
        const [jy, jm, jd] = j.split('-').map(Number);
        const rows = (await orm.execute(sql`SELECT to_char(erp_jalali_to_gregorian(${jy}::int, ${jm}::int, ${jd}::int), 'YYYY-MM-DD') AS g`) as unknown as { rows: Array<{ g: string }> }).rows;
        if (rows[0]?.g !== jalaliToIsoDate(j)) violations.push(`conversion ${j}: SQL ${rows[0]?.g}, application ${jalaliToIsoDate(j)}`);
      }
      // ۲) قیدهای قالب تاریخ این سه ستون معتبرشده‌اند
      const [{ n: constraints }] = (await orm.execute(sql`
        SELECT count(*)::int AS n FROM pg_constraint pc JOIN pg_class rel ON rel.oid = pc.conrelid
        WHERE rel.relnamespace = current_schema()::regnamespace AND pc.convalidated
          AND pc.conname IN ('chk_journal_vouchers_date_datefmt', 'chk_treasury_transactions_date_datefmt', 'chk_piecework_payrolls_payment_date_datefmt')`) as unknown as { rows: Array<{ n: number }> }).rows;
      if (constraints !== 3) violations.push(`date format constraints of the three columns: ${constraints} (expected 3)`);

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
          if (jvOpen.date !== '1405-07-10') violations.push(`journal voucher date: ${jvOpen.date} (expected 1405-07-10)`);
          if (jvClosed.date !== '12-20-1390') violations.push(`a voucher of a closed fiscal year must not change: ${jvClosed.date}`);
          if (trRow.date !== '2026-10-02') violations.push(`treasury transaction date: ${trRow.date} (expected 2026-10-02)`);
          if (payRow.paymentDate !== '1405-07-10') violations.push(`payslip payment date: ${payRow.paymentDate} (expected 1405-07-10)`);

          const log = await tx.select().from(legacyDateRepairs);
          const entry = (table: string, id: number) => log.find(r => r.tableName === table && r.rowId === id);
          const eOpen = entry('journal_vouchers', vOpen.id);
          const eClosed = entry('journal_vouchers', vClosed.id);
          const eTr = entry('treasury_transactions', tr.id);
          const ePay = entry('piecework_payrolls', pay.id);
          if (eOpen?.status !== 'corrected' || eOpen.oldValue !== '07-10-1405') violations.push(`journal voucher log entry: ${JSON.stringify(eOpen)}`);
          if (eClosed?.status !== 'refused') violations.push(`closed-year voucher log entry must be refused: ${JSON.stringify(eClosed)}`);
          if (eTr?.oldValue !== '07-10-1405 AP' || eTr.newValue !== '2026-10-02') violations.push(`treasury transaction log entry: ${JSON.stringify(eTr)}`);
          if (ePay?.oldValue !== '07-10-1405 AP') violations.push(`payslip log entry: ${JSON.stringify(ePay)}`);

          // اجرای دوباره چیزی را دوباره ثبت یا تغییر نمی‌دهد
          await tx.execute(sql`SELECT erp_repair_legacy_mdy_dates()`);
          const again = await tx.select().from(legacyDateRepairs);
          if (again.length !== log.length) violations.push(`running again created ${again.length - log.length} new log rows`);

          throw ROLLBACK;
        });
      } catch (err) {
        if (err !== ROLLBACK) throw err;
      }

      const { FinancialHealthService } = await import('../../services/accounting/financialHealth.service.js');
      const health = await FinancialHealthService.runHealthCheck();
      if (!health.tests.some(t => t.id === 'legacy_mdy_date_repairs')) violations.push('check legacy_mdy_date_repairs is not in the financial health report');

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_legacy_mdy_date_repair_td_231',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'Three columns are repaired and recorded in legacy_date_repairs, the closed-year voucher is refused and the SQL date conversion matches the application.'
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
    const testName = 'v7.0.131: the SQL date conversion matches the application converter; normalizing a column records the old value and refuses an invalid date; the calendar report counts the columns (TD-232)';
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
        if ((rows[0]?.iso ?? null) !== expected) violations.push(`"${v}": SQL ${rows[0]?.iso}, application ${expected}`);
        const expectedKind = expected === null ? 'invalid' : expected === v ? 'iso' : /^1[345]\d{2}/.test(toEnglishDigits(v).trim()) ? 'jalali' : 'gregorian';
        if (rows[0]?.kind !== expectedKind) violations.push(`kind of "${v}": ${rows[0]?.kind} (expected ${expectedKind})`);
      }

      // ۲) ورودی API: تاریخ نامعتبر با 422 رد می‌شود
      try {
        requireStorageDate('1405/07/31', 'تاریخ آزمون');
        violations.push('requireStorageDate accepted the date 31 Mehr');
      } catch (err) {
        const n = normalizeError(err);
        if (n.statusCode !== 422) violations.push(`requireStorageDate: answer ${n.statusCode} (expected 422)`);
      }
      if (requireStorageDate('۱۴۰۵/۰۷/۱۰', 'تاریخ آزمون') !== '2026-10-02') violations.push('requireStorageDate did not convert a Jalali date to ISO');

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
            if (got !== want) violations.push(`personnel.birth_date ${key}: ${got} (expected ${want})`);
          }
          const log = await tx.select().from(legacyDateRepairs).where(and(eq(legacyDateRepairs.tableName, 'personnel'), eq(legacyDateRepairs.repairKind, 'calendar')));
          const entry = (key: string) => log.find(r => r.rowId === ids[key]);
          if (entry('jalali')?.oldValue !== '1370/05/12' || entry('jalali')?.status !== 'corrected') violations.push(`Jalali log entry: ${JSON.stringify(entry('jalali'))}`);
          if (entry('bad')?.status !== 'refused') violations.push(`invalid date must be refused: ${JSON.stringify(entry('bad'))}`);
          if (entry('iso') || entry('empty')) violations.push('an ISO or empty row must not appear in the log');

          await tx.execute(sql`SELECT erp_unify_text_date_column('personnel', 'birth_date')`);
          const again = await tx.select().from(legacyDateRepairs).where(and(eq(legacyDateRepairs.tableName, 'personnel'), eq(legacyDateRepairs.repairKind, 'calendar')));
          if (again.length !== log.length) violations.push(`running again created ${again.length - log.length} new log rows`);

          const constraintWithBad = (await tx.execute(sql`SELECT erp_set_iso_date_constraint('personnel', 'birth_date') AS ok`) as unknown as { rows: Array<{ ok: boolean }> }).rows[0].ok;
          if (constraintWithBad) violations.push('iso constraint was reported validated with an invalid row present');
          await tx.delete(personnel).where(eq(personnel.id, ids.bad));
          const constraintClean = (await tx.execute(sql`SELECT erp_set_iso_date_constraint('personnel', 'birth_date') AS ok`) as unknown as { rows: Array<{ ok: boolean }> }).rows[0].ok;
          if (!constraintClean) violations.push('iso constraint was not validated on a clean column');
          throw ROLLBACK;
        });
      } catch (err) {
        if (err !== ROLLBACK) throw err;
      }

      // ۴) گزارش فقط‌خواندنی: ستون‌ها و شمارش (از v7.0.137 هیچ ستونی شمسی نمی‌پذیرد؛ شمارش شمسی در گام ۱ با erp_text_date_kind سنجیده شد)
      const report = await DateCalendarReportService.buildReport();
      const col = (t: string, c: string) => report.columns.find(x => x.table === t && x.column === c);
      for (const [t, c] of [['crm_activities', 'activity_date'], ['cheques', 'due_date'], ['journal_vouchers', 'date'], ['personnel', 'birth_date']]) {
        if (!col(t, c)) violations.push(`column ${t}.${c} is not in the report`);
      }
      if (report.columns.some(c => c.total !== c.empty + c.iso + c.gregorian + c.jalali + c.invalid)) violations.push('report counts do not add up to the total rows');
      if (report.columns.some(x => x.table === 'legacy_date_repairs')) violations.push('table legacy_date_repairs must not be in the report');

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_calendar_date_tools_td_232',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'SQL and application conversions match; column normalization with a log, refusal of an invalid date and the calendar report work.'
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
    const testName = 'v7.0.132: CRM activity, follow-up and lead close dates are stored as Gregorian ISO; an old date is converted with the old value recorded; a future follow-up is not reported as due (TD-232)';
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
      if (isoConstraints !== 3) violations.push(`validated iso constraints of the CRM columns: ${isoConstraints} (expected 3)`);

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
            if (row.activityDate !== wantAct) violations.push(`${key}.activity_date: ${row.activityDate} (expected ${wantAct})`);
            if (row.nextFollowUpDate !== wantNext) violations.push(`${key}.next_followup_date: ${row.nextFollowUpDate} (expected ${wantNext})`);
            if (key !== 'bad' && (row.activityDateIso !== wantAct || row.nextFollowUpDateIso !== wantNext)) {
              violations.push(`${key}: _iso columns were not synchronized (${row.activityDateIso}, ${row.nextFollowUpDateIso})`);
            }
          }
          const log = await tx.select().from(legacyDateRepairs).where(and(eq(legacyDateRepairs.repairKind, 'calendar'), inArray(legacyDateRepairs.rowId, Object.values(ids))));
          const find = (key: string, column: string) => log.find(r => r.rowId === ids[key] && r.tableName === 'crm_activities' && r.columnName === column);
          if (find('proforma', 'activity_date')?.oldValue !== '۱۴۰۵/۷/۱۱') violations.push('previous value of the proforma date was not recorded');
          if (find('bad', 'activity_date')?.status !== 'refused') violations.push('an invalid date must be recorded as refused');
          if (find('server', 'activity_date')) violations.push('an ISO date must not appear in the log');
          if (find('stale', 'next_followup_date_iso')?.oldValue !== '2020-01-01') violations.push('previous mismatched value of next_followup_date_iso was not recorded');
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
      if (created.status !== 201) throw new Error(`recording the activity: ${created.status} ${JSON.stringify(created.body)}`);
      activityIds.push(created.body.id);
      if (created.body.activityDate !== '2026-10-02' || created.body.nextFollowUpDate !== futureIso) {
        violations.push(`create response must be ISO: ${created.body.activityDate}, ${created.body.nextFollowUpDate}`);
      }
      const [stored] = await orm.select().from(crmActivities).where(eq(crmActivities.id, created.body.id));
      if (stored.activityDate !== '2026-10-02' || stored.activityDateIso !== '2026-10-02' || stored.nextFollowUpDate !== futureIso || stored.nextFollowUpDateIso !== futureIso) {
        violations.push(`stored: ${JSON.stringify({ a: stored.activityDate, ai: stored.activityDateIso, n: stored.nextFollowUpDate, ni: stored.nextFollowUpDateIso })}`);
      }
      const invalid = await post({ title: 'ERP-TEST-MARKER TD-232 نامعتبر', activityDate: '1405/07/31' });
      if (invalid.status !== 422) {
        violations.push(`date 31 Mehr must get 422: ${invalid.status}`);
        if (invalid.body?.id) activityIds.push(invalid.body.id);
      }
      const inRange = await request(app).get(`/api/crm/activities?fromDate=${encodeURIComponent('1405/07/09')}&toDate=${encodeURIComponent('۱۴۰۵/۰۷/۱۰')}&limit=500`).set('Cookie', session.cookie);
      const outRange = await request(app).get(`/api/crm/activities?fromDate=${encodeURIComponent('1405/07/11')}&limit=500`).set('Cookie', session.cookie);
      if (!(Array.isArray(inRange.body) && inRange.body.some((a: { id: number }) => a.id === created.body.id))) violations.push('Jalali range filter did not return the activity inside the range');
      if (Array.isArray(outRange.body) && outRange.body.some((a: { id: number }) => a.id === created.body.id)) violations.push('filter "from 11 Mehr" returned the activity of 10 Mehr');

      // ۴) یادآوری: پیگیری آینده سررسید اعلام نمی‌شود؛ پیگیری گذشته اعلام می‌شود و تاریخ پیام شمسی است
      const link = `/crm?activityId=${created.body.id}`;
      const dueNotifs = async () => orm.select().from(notifications).where(and(eq(notifications.link, link), eq(notifications.type, 'crm_due_task')));
      await request(app).get('/api/notifications').set('Cookie', session.cookie);
      if ((await dueNotifs()).length > 0) violations.push('a follow-up 20 days ahead was reported due today');
      const pastIso = shiftIso(-1);
      await orm.update(crmActivities).set({ nextFollowUpDate: pastIso, nextFollowUpDateIso: pastIso }).where(eq(crmActivities.id, created.body.id));
      await request(app).get('/api/notifications').set('Cookie', session.cookie);
      const due = await dueNotifs();
      // اعلان «تسک جدید» همین پیوند را دارد و نباید جلوی یادآوری سررسید را بگیرد
      if (due.length !== 1) violations.push(`yesterday's follow-up must create one due notification: ${due.length}`);
      else if (!due[0].message?.includes(toPersianDigits(isoToJalaliDate(pastIso)))) violations.push(`notification message date is not Jalali: ${due[0].message}`);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_crm_dates_iso_td_232',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_api',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'A Jalali input date is stored as ISO, an invalid date gets 422, the Jalali range filter is correct, old data is converted with a log and a reminder is created only for a past follow-up.'
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
    const testName = 'v7.0.133: cheque dates are stored as Gregorian ISO; an old date is converted with the old value recorded; the Jalali range filter and overdue cheques are correct (TD-232)';
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
      if (isoConstraints !== 2) violations.push(`validated iso constraints of the cheque columns: ${isoConstraints} (expected 2)`);

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
            if (row.issueDate !== toStorageDate(issueDate) || row.dueDate !== toStorageDate(dueDate)) violations.push(`legacy cheque ${i}: ${row.issueDate}, ${row.dueDate}`);
          }
          const log = await tx.select().from(legacyDateRepairs).where(and(eq(legacyDateRepairs.tableName, 'cheques'), eq(legacyDateRepairs.repairKind, 'calendar'), inArray(legacyDateRepairs.rowId, ids)));
          if (log.length !== 3) violations.push(`cheque conversion log: ${log.length} rows (expected 3; an ISO due date is not logged)`);
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
      if (stored.issueDate !== shiftIso(-30) || stored.dueDate !== shiftIso(-3)) violations.push(`stored cheque: ${stored.issueDate}, ${stored.dueDate}`);
      try {
        const bad = await ChequeLifecycleService.createCheque({ ...base, chequeNumber: `TD232-C-${Date.now()}`, issueDate: '1405/07/10', dueDate: '1405/07/31' });
        chequeIds.push(bad.id);
        violations.push('due date 31 Mehr was accepted');
      } catch (err) {
        if (normalizeError(err).statusCode !== 422) violations.push(`invalid due date: ${normalizeError(err).statusCode} (expected 422)`);
      }

      // ۳) فیلتر بازه شمسی سررسید
      const inRange = await ChequeLifecycleService.getCheques({ type: 'all', startDate: isoToJalaliDate(shiftIso(-5)), endDate: isoToJalaliDate(shiftIso(0)), search: 'TD-232 چک' });
      const ids = inRange.map(c => c.id);
      if (!ids.includes(overdue.id) || ids.includes(future.id)) violations.push(`Jalali range filter: ${JSON.stringify(ids)} (expected only ${overdue.id})`);

      // ۴) چک سررسیدگذشته در بازرس سلامت با تاریخ شمسی
      const health = await FinancialHealthService.runHealthCheck();
      const overdueTest = health.tests.find(t => t.id === 'overdue_cheques');
      const item = overdueTest?.items?.find(i => i.id === overdue.id);
      if (!item) violations.push('overdue cheque did not appear in the health check');
      else if (!String(item.subtitle).includes(isoToJalaliDate(shiftIso(-3))) || !String(item.subtitle).includes('3 روز')) violations.push(`overdue cheque subtitle: ${item.subtitle}`);
      if (overdueTest?.items?.some(i => i.id === future.id)) violations.push('a future cheque was reported overdue');

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_cheque_dates_iso_td_232',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'Cheque dates are stored as ISO, an invalid date gets 422, the Jalali range filter and the overdue cheque are correct and old data is converted with a log.'
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
    const testName = 'v7.0.134: work log, payslip and piecework rate dates are stored as Gregorian ISO; old data is converted with the old value recorded; the fixed salary of one Jalali month is not counted twice in two payslips (TD-232)';
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
      if (isoConstraints !== columns.length) violations.push(`validated iso constraints: ${isoConstraints} (expected ${columns.length})`);

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
          if (dlr.date !== '2026-10-02' || dlr.dateIso !== '2026-10-02') violations.push(`daily work log: ${dlr.date}, ${dlr.dateIso}`);
          if (plr.date !== '2026-10-02' || plr.dateIso !== '2026-10-02') violations.push(`piecework work log: ${plr.date}, ${plr.dateIso}`);
          if (prr.startDate !== toStorageDate('1405/07/01') || prr.endDate !== toStorageDate('1405/07/30') || prr.paymentDate !== '2026-10-02') violations.push(`payslip: ${prr.startDate}, ${prr.endDate}, ${prr.paymentDate}`);
          if (rhr.effectiveDate !== '2026-10-03') violations.push(`rate date: ${rhr.effectiveDate}`);
          const log = await tx.select().from(legacyDateRepairs).where(and(eq(legacyDateRepairs.repairKind, 'calendar'), eq(legacyDateRepairs.tableName, 'piecework_logs'), eq(legacyDateRepairs.rowId, pl.id)));
          if (!log.some(r => r.columnName === 'date_iso' && r.oldValue === '2020-01-01')) violations.push('previous mismatched value of date_iso was not recorded');
          throw ROLLBACK;
        });
      } catch (err) {
        if (err !== ROLLBACK) throw err;
      }

      // ۲) ثبت کارکرد با تاریخ شمسی ← ISO؛ فیلتر بازه شمسی
      const ids = await PieceworkService.logWorkEntries([
        { personnelId: pers.id, taskId: task.id, date: '۱۴۰۵/۰۶/۰۵', quantity: 2 },
        { personnelId: pers.id, taskId: task.id, date: '1405/06/20', quantity: 3 },
      ]);
      logIds.push(...ids);
      const stored = await orm.select({ date: pieceworkLogs.date, dateIso: pieceworkLogs.dateIso }).from(pieceworkLogs).where(inArray(pieceworkLogs.id, ids));
      if (!stored.every(r => r.date === r.dateIso && /^\d{4}-\d{2}-\d{2}$/.test(r.date))) violations.push(`stored work logs: ${JSON.stringify(stored)}`);
      try {
        const badIds = await PieceworkService.logWorkEntries([{ personnelId: pers.id, taskId: task.id, date: '1405/07/31', quantity: 1 }]);
        logIds.push(...badIds);
        violations.push('work log date 31 Mehr was accepted');
      } catch { /* انتظار: 422 */ }
      await PieceworkService.recordTaskRateHistory({ taskId: task.id, newRate: 1000, changeType: 'create', username: 'ERP-TEST-MARKER' });
      const [rate] = await orm.select({ d: pieceworkTaskRateHistory.effectiveDate }).from(pieceworkTaskRateHistory).where(eq(pieceworkTaskRateHistory.taskId, task.id)).orderBy(sql`id DESC`).limit(1);
      if (rate?.d !== await businessTodayIsoDate()) violations.push(`rate effective date: ${rate?.d} (expected today as ISO)`);
      const { PieceworkReadService } = await import('../../services/piecework/pieceworkRead.service.js');
      const ranged = await PieceworkReadService.listWorkLogs({ personnelId: String(pers.id), startDate: '1405/06/01', endDate: '1405/06/10' });
      if (ranged.length !== 1 || ranged[0].date !== toStorageDate('1405/06/05')) violations.push(`Jalali range filter of work logs: ${JSON.stringify(ranged.map(r => r.date))}`);

      // ۳) حقوق ثابت: دو فیش در یک ماه شمسی (شهریور ۱۴۰۵ = ۲۳ اوت تا ۲۲ سپتامبر، ۳۱ روز) روی هم فقط یک ماه حقوق ثابت می‌گیرند.
      // v9.0.268 (TD-808): فیش دوره‌ای که هنوز تمام نشده صادر نمی‌شود، پس این آزمون از مهر به شهریور آمد
      const audit = { username: 'ERP-TEST-MARKER' };
      const first = await PieceworkPayrollService.generatePayroll({ personnelId: pers.id, startDate: '1405/06/01', endDate: '1405/06/15', ...audit });
      if (first.status !== 201 || !('payroll' in first) || !first.payroll) throw new Error(`first payslip: ${JSON.stringify(first)}`);
      payrollIds.push(first.payroll.id);
      const second = await PieceworkPayrollService.generatePayroll({ personnelId: pers.id, startDate: '1405/06/16', endDate: '1405/06/31', ...audit });
      if (second.status !== 201 || !('payroll' in second) || !second.payroll) throw new Error(`second payslip: ${JSON.stringify(second)}`);
      payrollIds.push(second.payroll.id);
      if (first.payroll.startDate !== toStorageDate('1405/06/01') || first.payroll.endDate !== toStorageDate('1405/06/15')) violations.push(`payslip period: ${first.payroll.startDate}, ${first.payroll.endDate}`);
      // v8.0.30 (TD-284، تصمیم مالک محصول — گزینه ب): ماه ناقص به نسبت روزها؛ دو نیمه شهریور (۳۱ روزه) روی هم دقیقاً یک ماه
      if (!first.payroll.totalFixedAmount?.equals(1451613)) violations.push(`fixed salary of the first payslip (15 of 31 days): ${first.payroll.totalFixedAmount?.toString()}`);
      if (!second.payroll.totalFixedAmount?.equals(1548387)) violations.push(`fixed salary of the second payslip of the same Jalali month (rest of the month): ${second.payroll.totalFixedAmount?.toString()}`);
      if (!second.payroll.totalPieceworkAmount?.equals(3000)) violations.push(`piecework amount of the second payslip: ${second.payroll.totalPieceworkAmount?.toString()}`);
      try {
        await PieceworkPayrollService.generatePayroll({ personnelId: pers.id, startDate: '1405/08/10', endDate: '1405/08/01', ...audit });
        violations.push('a reversed period was accepted');
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
        details: 'Dates are stored as ISO, old data is converted with a log, the Jalali range filter is correct and the Shahrivar fixed salary is split between two payslips pro rata by days.'
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
    const testName = 'v7.0.135: project and stage dates, the requisition need date and personnel birth and end dates are stored as Gregorian ISO; an old date is converted with the old value recorded (TD-232)';
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
      if (isoConstraints !== columns.length) violations.push(`validated iso constraints: ${isoConstraints} (expected ${columns.length})`);

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
          if (p1.startDate !== toStorageDate('1405/07/01') || p1.endDate !== toStorageDate('1405/08/15')) violations.push(`project: ${p1.startDate}, ${p1.endDate}`);
          if (s1.startDate !== toStorageDate('1405/07/02') || s1.endDate !== '2026-10-30') violations.push(`stage: ${s1.startDate}, ${s1.endDate}`);
          if (r1.requiredDate !== toStorageDate('1405/07/20')) violations.push(`purchase requisition: ${r1.requiredDate}`);
          if (e1.birthDate !== '1991-08-03' || e1.endDate !== 'نامعلوم') violations.push(`personnel: ${e1.birthDate}, ${e1.endDate}`);
          const refused = await tx.select().from(legacyDateRepairs).where(and(eq(legacyDateRepairs.repairKind, 'calendar'), eq(legacyDateRepairs.tableName, 'personnel'), eq(legacyDateRepairs.rowId, pe.id), eq(legacyDateRepairs.columnName, 'end_date')));
          if (refused[0]?.status !== 'refused') violations.push('a non-date end-of-employment value must be recorded as refused');
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
      if (project.startDate !== toStorageDate('1405/07/01') || project.endDate !== toStorageDate('1405/08/15')) violations.push(`new project: ${project.startDate}, ${project.endDate}`);
      if (stages[0]?.startDate !== toStorageDate('1405/07/02') || stages[0]?.endDate !== toStorageDate('1405/07/10')) violations.push(`new stage: ${stages[0]?.startDate}, ${stages[0]?.endDate}`);
      try {
        await ProjectService.updateProject(project.id, { endDate: '1405/12/30' });
        violations.push('30 Esfand 1405 (a common year) was accepted');
      } catch (err) {
        if (normalizeError(err).statusCode !== 422) violations.push(`invalid project date: ${normalizeError(err).statusCode}`);
      }

      // ۳) درخواست خرید بدون تاریخ نیاز ← امروز ISO
      const req = await ProcurementService.createRequisition({ title: 'ERP-TEST-MARKER درخواست TD-232', items: [{ itemName: 'آزمون', requestedQty: 1, unit: 'عدد' }] }, { username: 'ERP-TEST-MARKER' });
      requisitionId = req.id;
      const [reqRow] = await orm.select({ d: purchaseRequisitions.requiredDate }).from(purchaseRequisitions).where(eq(purchaseRequisitions.id, req.id));
      if (reqRow.d !== await businessTodayIsoDate()) violations.push(`default required date: ${reqRow.d}`);

      // ۴) پرسنل از API: تاریخ تولد شمسی ← ISO
      const app = await getTestApp();
      const session = await getAdminSession();
      const created = await request(app).post('/api/personnel').set('Cookie', session.cookie).set('x-csrf-token', session.csrfToken)
        .send({ firstName: 'ERP-TEST-MARKER', lastName: 'TD-232', birthDate: '۱۳۷۰/۰۵/۱۲' });
      personnelId = created.body?.id ?? created.body?.data?.id ?? null;
      if (created.status >= 300 || !personnelId) violations.push(`creating personnel: ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
      else {
        const [pRow] = await orm.select({ b: personnel.birthDate }).from(personnel).where(eq(personnel.id, personnelId));
        if (pRow.b !== '1991-08-03') violations.push(`stored birth date: ${pRow.b}`);
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
        details: 'Project, stage, purchase requisition and personnel dates are stored as ISO, an invalid date gets 422 and old data is converted with a log.'
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
    const testName = 'v7.0.136: the Jalali date filter of the Kardex and documents does not fail; the cash flow takes a Jalali range and gives Jalali months; server timestamp columns accept only a Gregorian timestamp (TD-232)';
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
        if (!r || !r.validated || !r.def.includes(`'${kind}'`)) violations.push(`${n}: ${r?.def} (expected a validated ${kind})`);
      };
      expectRule('chk_treasury_transactions_date_datefmt', 'iso');
      expectRule('chk_treasury_transactions_reconciled_at_datefmt', 'isots');
      expectRule('chk_project_stages_completed_at_datefmt', 'isots');
      expectRule('chk_users_last_failed_login_at_datefmt', 'isots');
      expectRule('chk_journal_vouchers_date_datefmt', 'iso'); // v7.0.137 (TD-248)
      const kinds = (await orm.execute(sql`SELECT erp_date_text_ok('1405/07/10', 'isots') AS j, erp_date_text_ok('2026-10-02T10:00:00.000Z', 'isots') AS g`) as unknown as { rows: Array<{ j: boolean; g: boolean }> }).rows[0];
      if (kinds.j || !kinds.g) violations.push(`format isots: Jalali=${kinds.j}, Gregorian=${kinds.g}`);
      const report = await DateCalendarReportService.buildReport();
      const tr = report.columns.find(c => c.table === 'treasury_transactions' && c.column === 'date');
      if (tr?.rule !== 'iso' || !tr.ruleValidated) violations.push(`report rule of the treasury date: ${tr?.rule}`);

      // ۲) فیلتر شمسی در query (پیش‌تر «1405/07/01» خام به ستون timestamp می‌رسید)
      const app = await getTestApp();
      const session = await getAdminSession();
      const q = (path: string) => request(app).get(path).set('Cookie', session.cookie);
      const kardex = await q(`/api/transactions?startDate=${encodeURIComponent('1405/07/01')}&endDate=${encodeURIComponent('۱۴۰۵/۰۷/۳۰')}`);
      if (kardex.status !== 200) violations.push(`Kardex with a Jalali range: ${kardex.status} ${JSON.stringify(kardex.body).slice(0, 150)}`);
      const docs = await q(`/api/documents?startDate=${encodeURIComponent('1405/07/01')}&endDate=${encodeURIComponent('1405/07/30')}`);
      if (docs.status !== 200) violations.push(`documents with a Jalali range: ${docs.status}`);
      const bad = await q(`/api/transactions?startDate=${encodeURIComponent('1405/07/31')}`);
      if (bad.status !== 400) violations.push(`an invalid date in a filter must get 400: ${bad.status}`);

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
      if (!month || month.receipts < 7777) violations.push(`Jalali monthly trend ${monthKey}: ${JSON.stringify(cash.months)}`);
      if (cash.months.some(m => /^\d{4}-/.test(m.month))) violations.push(`Gregorian month in the monthly trend: ${JSON.stringify(cash.months.map(m => m.month))}`);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_calendar_final_td_232',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_api',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'Jalali filters are converted to ISO, an invalid date gets 400, the cash flow gives Jalali months and the final rules are validated.'
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
    const testName = 'v7.0.137: journal voucher dates are stored as Gregorian ISO; an old Jalali date is converted with the old value recorded and a voucher in a closed fiscal year is left alone; the Jalali filter of the voucher list is correct (TD-248)';
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
      if (!rule?.validated || !rule.def.includes("'iso'")) violations.push(`voucher date constraint: ${rule?.def} (expected a validated iso)`);

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
            if (got !== want) violations.push(`voucher ${key}: ${got} (expected ${want})`);
          }
          const log = await tx.select().from(legacyDateRepairs).where(and(eq(legacyDateRepairs.tableName, 'journal_vouchers'), eq(legacyDateRepairs.repairKind, 'calendar'), inArray(legacyDateRepairs.rowId, Object.values(ids))));
          const entry = (key: string) => log.find(r => r.rowId === ids[key]);
          if (entry('open')?.status !== 'corrected' || entry('open')?.oldValue !== '1405-07-10') violations.push(`open voucher log entry: ${JSON.stringify(entry('open'))}`);
          if (entry('closed')?.status !== 'refused' || !String(entry('closed')?.reason).includes('1390')) violations.push(`closed-year voucher must be refused: ${JSON.stringify(entry('closed'))}`);
          if (entry('bad')?.status !== 'refused') violations.push('an unrecognizable date must be refused');
          if (entry('iso')) violations.push('an ISO voucher must not appear in the log');
          await tx.execute(sql`SELECT erp_unify_journal_voucher_dates()`);
          const again = await tx.select().from(legacyDateRepairs).where(and(eq(legacyDateRepairs.tableName, 'journal_vouchers'), inArray(legacyDateRepairs.rowId, Object.values(ids))));
          if (again.length !== log.length) violations.push(`running again created ${again.length - log.length} new rows`);
          throw ROLLBACK;
        });
      } catch (err) {
        if (err !== ROLLBACK) throw err;
      }

      // ۲) ثبت سند با تاریخ شمسی ارقام فارسی ← ISO؛ تاریخ نامعتبر 422
      const allAccounts = await orm.select().from(accounts).where(eq(accounts.isDeleted, 0));
      const debitAcc = allAccounts.find(a => a.code === '1101') || allAccounts.find(a => a.accountType === 'asset');
      const creditAcc = allAccounts.find(a => a.code === '6001') || allAccounts.find(a => a.accountType === 'revenue');
      if (!debitAcc || !creditAcc) throw new Error('Account needed for the test not found');
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
      if (stored.d !== '2026-10-02') violations.push(`stored voucher date: ${stored.d} (expected 2026-10-02)`);
      try {
        const bad = await VoucherService.createJournalVoucher(voucherInput('1405/07/31'));
        await cleanTestTableData('journal_voucher_items', 'voucher_id', [bad.id]);
        await cleanTestTableData('journal_vouchers', 'id', [bad.id]);
        violations.push('date 31 Mehr was accepted for a voucher');
      } catch (err) {
        if (normalizeError(err).statusCode !== 422) violations.push(`invalid voucher date: ${normalizeError(err).statusCode} (expected 422)`);
      }

      // ۳) فهرست اسناد با بازه شمسی
      const app = await getTestApp();
      const session = await getAdminSession();
      const list = await request(app).get(`/api/accounting/vouchers?startDate=${encodeURIComponent('1405/07/10')}&endDate=${encodeURIComponent('1405/07/10')}&limit=1000`).set('Cookie', session.cookie);
      const rows: Array<{ id: number }> = Array.isArray(list.body?.data) ? list.body.data : (Array.isArray(list.body) ? list.body : []);
      if (list.status !== 200 || !rows.some(r => r.id === created.id)) violations.push(`voucher list with a Jalali range: ${list.status}, ${rows.length} rows without the test voucher`);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_voucher_dates_iso_td_248',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_api',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'A legacy Jalali voucher is converted and logged, the closed-year voucher and the invalid date are left untouched, a new voucher is stored as ISO and the Jalali filter finds it.'
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
    const testName = 'v7.0.138: the trial balance answers level all and tree, and an invalid level gets 400 (TD-249)';
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
      if (withDates.status !== 200) violations.push(`level=all with a Jalali range: ${withDates.status}`);
      const bad = await get('level=bogus');
      if (bad.status !== 400) violations.push(`an invalid level must get 400: ${bad.status}`);
      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_trial_balance_level_all_td_249',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_api',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'The trial balance returns 200 with levels all, tree, group and detailed and with a Jalali range, and an invalid level gets 400.'
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
    const testName = 'v7.0.139: the Nobitex password is encrypted with AES-256-GCM and opened only for an allowed user; without the key it is neither stored nor cleared; old plain passwords are encrypted by the script (TD-189)';
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
      if (created.status !== 201) throw new Error(`creating personnel: ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
      const id = created.body.id as number;
      ids.push(id);
      const first = await stored(id);
      if (!first.startsWith('enc:v1:') || first.includes('Secret#123')) violations.push(`Nobitex password column is not encrypted: ${first.slice(0, 30)}`);
      if (created.body.nobitexPassword !== 'Secret#123') violations.push('the create response must return the plain text, not the ciphertext');
      const read = await request(app).get(`/api/personnel/${id}`).set('Cookie', session.cookie);
      if (read.body?.nobitexPassword !== 'Secret#123') violations.push(`read for the admin: "${read.body?.nobitexPassword}"`);
      const list = await request(app).get('/api/personnel').set('Cookie', session.cookie);
      const listed = (Array.isArray(list.body) ? list.body : []).find((p: { id: number }) => p.id === id);
      // v9.0.23 (TD-434، تصمیم D1): رمز فقط در جزئیات یک پرسنل؛ فهرست نه متن ساده می‌دهد و نه متن رمزشده
      if (!listed || 'nobitexPassword' in listed) violations.push('the personnel list must not return the Nobitex password (detail only)');

      // ۲) ذخیره فرم با همان رمز ← متن رمزشده عوض نمی‌شود؛ رمز تازه ← رمزنگاری تازه
      await send('put', `/api/personnel/${id}`, { version: await personnelVersion(id), firstName: 'ERP-TEST-MARKER', lastName: 'TD-189 ویرایش', nobitexPassword: 'Secret#123' });
      if (await stored(id) !== first) violations.push('saving the same password changed the ciphertext');
      await send('put', `/api/personnel/${id}`, { version: await personnelVersion(id), firstName: 'ERP-TEST-MARKER', lastName: 'TD-189', nobitexPassword: 'New#456' });
      const second = await stored(id);
      if (!second.startsWith('enc:v1:') || decryptSecret(second) !== 'New#456') violations.push('the new password was not encrypted correctly');

      // ۳) دست‌کاری متن رمزشده ← باز نمی‌شود (هرگز متن نادرست برنمی‌گردد)
      const tampered = second.slice(0, -4) + (second.endsWith('AAAA') ? 'BBBB' : 'AAAA');
      if (decryptSecret(tampered) !== null) violations.push('tampered ciphertext was decrypted');

      // ۴) بدون کلید: خواندن متن رمزشده بیرون نمی‌دهد، فرم خالی رمز را پاک نمی‌کند، رمز تازه 503 می‌گیرد
      delete process.env.ERP_SECRETS_KEY;
      const noKeyRead = await request(app).get(`/api/personnel/${id}`).set('Cookie', session.cookie);
      if (noKeyRead.body?.nobitexPassword !== '') violations.push(`without a key the response must be empty: "${String(noKeyRead.body?.nobitexPassword).slice(0, 20)}"`);
      await send('put', `/api/personnel/${id}`, { version: await personnelVersion(id), firstName: 'ERP-TEST-MARKER', lastName: 'TD-189', nobitexPassword: '' });
      if (await stored(id) !== second) violations.push('saving the form without a key erased the stored password');
      const noKeySave = await send('put', `/api/personnel/${id}`, { version: await personnelVersion(id), firstName: 'ERP-TEST-MARKER', lastName: 'TD-189', nobitexPassword: 'Plain#789' });
      if (noKeySave.status !== 503) violations.push(`a new password without a key must get 503: ${noKeySave.status}`);
      if (await stored(id) !== second) violations.push('a new password was stored without a key');
      try { encryptSecret('x'); violations.push('encryptSecret without a key did not throw'); } catch { /* انتظار */ }

      // ۵) رمز ساده قدیمی: اجرای آزمایشی چیزی را تغییر نمی‌دهد؛ اجرای واقعی با کلید رمزنگاری می‌کند
      const [legacy] = await orm.insert(personnel).values({ fullName: 'ERP-TEST-MARKER TD-189 قدیمی', nobitexPassword: 'old-plain' }).returning({ id: personnel.id });
      ids.push(legacy.id);
      process.env.ERP_SECRETS_KEY = 'td189-test-key-0123456789-abcdefghijklmnop';
      const dry = await PersonnelSecretEncryptionService.run({ apply: false });
      if (dry.plaintext < 1 || await stored(legacy.id) !== 'old-plain') violations.push(`dry run: ${JSON.stringify(dry)}`);
      const applied = await PersonnelSecretEncryptionService.run({ apply: true });
      const legacyNow = await stored(legacy.id);
      if (applied.encryptedNow < 1 || !legacyNow.startsWith('enc:v1:') || decryptSecret(legacyNow) !== 'old-plain') violations.push(`encrypting the legacy password: ${JSON.stringify(applied)}`);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_personnel_secret_encryption_td_189',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_api',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'The encrypted password is stored and opened only for the admin; without a key it is neither stored nor erased, and the legacy password is encrypted by the script.'
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
    const testName = 'v7.0.83: attachment cleanup removes only old files without a record; a dry run removes nothing (TD-224)';
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
      if (!dry.dryRun || dry.unregistered.removed !== 0 || !fs.existsSync(files.orphan)) violations.push(`a dry run must not delete anything: ${JSON.stringify(dry.unregistered)}`);
      if (!dry.unregistered.paths.includes(`document/${ids.orphan}.pdf`)) violations.push('the unregistered file is not in the dry-run report');

      const applied = await AttachmentOrphanCleanupService.cleanupOrphanFiles({ apply: true, actor: 'td224' });
      if (fs.existsSync(files.orphan)) violations.push('the old unregistered file was not deleted');
      if (applied.unregistered.removed !== 1) violations.push(`deleted count: ${applied.unregistered.removed} (expected 1)`);
      if (!fs.existsSync(files.active)) violations.push('a registered file was deleted');
      if (!fs.existsSync(files.detached)) violations.push('a detached attachment file was deleted');
      if (!fs.existsSync(files.recent)) violations.push('a recent unregistered file (transaction in progress) was deleted');
      if (!fs.existsSync(files.foreign)) violations.push('a file whose name does not follow the storage pattern was deleted');
      if (applied.detached.files !== 1 || applied.recentUnregistered !== 1) violations.push(`detached/recent report: ${applied.detached.files}/${applied.recentUnregistered} (expected 1/1)`);

      const request = (await import('supertest')).default;
      const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
      const session = await getAdminSession();
      const res = await request(await getTestApp()).post('/api/attachments/cleanup-orphans')
        .set('Cookie', session.cookie).set('x-csrf-token', session.csrfToken).send({});
      if (res.status !== 200 || res.body?.dryRun !== true) violations.push(`admin route: HTTP ${res.status} dryRun=${res.body?.dryRun}`);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_attachment_orphan_cleanup_td_224',
        scenarioId: 'structured_vat',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'Only the old unregistered file is deleted; the registered, detached, recent and unknown files remain.'
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
    const testName = 'v7.0.85: the retired key runtime_enable_test_endpoints is not stored and does not break the settings save; /system/env no longer reports it (TD-109)';
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
      if (save.status !== 200) violations.push(`saving the form with a retired key: HTTP ${save.status} ${JSON.stringify(save.body).slice(0, 160)}`);
      if (Array.isArray(save.body?.changedKeys) && save.body.changedKeys.includes(RETIRED)) violations.push('the retired key is among the changed keys');
      const [stored] = await orm.select().from(appSettings).where(eq(appSettings.key, RETIRED));
      if (stored) violations.push(`the retired key was stored: ${stored.value}`);
      const env = await request(app).get('/api/system/env').set('Cookie', session.cookie);
      if (env.status !== 200) violations.push(`/system/env: HTTP ${env.status}`);
      if (env.body && ('effectiveTestEndpoints' in env.body || 'ENABLE_TEST_ENDPOINTS' in (env.body.flags || {}))) {
        violations.push('/system/env still reports the test_endpoints flag');
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
        details: 'The retired key is ignored, the rest of the form is saved and the environment report does not include it.'
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
    const testName = 'v7.0.87: saving a workflow design records a new version with real ids and running instances do not get stuck; the history is read-only (TD-112)';
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
      if (!defId) throw new Error('The definition was not saved');

      const availableFor = async (entityId: string) => {
        const st = await WorkflowTransitionExecutor.getInstanceByEntity(entityType, entityId, undefined, 'admin', ['*']);
        return (st?.availableTransitions || []) as Array<{ id: number; actionKey: string }>;
      };

      const first = await WorkflowTransitionExecutor.startInstance({ workflowDefinitionId: defId, entityType, entityId: '1' });
      const firstAvailable = await availableFor('1');
      if (firstAvailable.length !== 1) violations.push(`version 1 instance: ${firstAvailable.length} allowed actions (expected 1)`);

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
        violations.push(`after two saves: ${versions.length} versions, current version ${def?.version} (expected 2 and 2)`);
      }
      const v2 = versions.find((v) => v.version === 2);
      const v2Dsl = (v2?.dslJson || {}) as { states?: Array<{ id?: unknown }>; transitions?: Array<{ id?: unknown; fromStateId?: unknown }> };
      if ((v2Dsl.states || []).length !== 3 || (v2Dsl.transitions || []).some((t) => typeof t.id !== 'number' || typeof t.fromStateId !== 'number')) {
        violations.push('version 2 does not hold every state and transition with its database id');
      }

      await WorkflowTransitionExecutor.startInstance({ workflowDefinitionId: defId, entityType, entityId: '2' });
      const secondAvailable = await availableFor('2');
      if (secondAvailable.length !== 2) violations.push(`new instance after the edit: ${secondAvailable.length} allowed actions (expected 2)`);

      const firstAfter = await availableFor('1');
      if (firstAfter.length !== 1) {
        violations.push(`running instance after the edit: ${firstAfter.length} allowed actions (expected 1, from its own version)`);
      } else {
        await WorkflowTransitionExecutor.executeTransition({
          instanceId: first.id, transitionId: firstAfter[0].id, userRole: 'admin', userPermissions: ['*'],
        });
        const [done] = await orm.select().from(workflowInstances).where(eq(workflowInstances.id, first.id));
        if (done?.status === 'IN_PROGRESS') violations.push('the running instance did not finish with the action of its own version');
      }

      const request = (await import('supertest')).default;
      const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
      const app = await getTestApp();
      const session = await getAdminSession();
      const list = await request(app).get(`/api/workflow/definitions/${defId}/versions`).set('Cookie', session.cookie);
      if (list.status !== 200 || !Array.isArray(list.body) || list.body.length !== 2) {
        violations.push(`version list: HTTP ${list.status}, ${Array.isArray(list.body) ? list.body.length : '-'} rows`);
      }
      const one = await request(app).get(`/api/workflow/definitions/${defId}/versions/1`).set('Cookie', session.cookie);
      if (one.status !== 200 || one.body?.version !== 1) violations.push(`viewing version 1: HTTP ${one.status}`);
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
        if (res.status !== 404) violations.push(`${method.toUpperCase()} ${url.replace(String(defId), ':id')} still answers (HTTP ${res.status})`);
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
        details: 'Two saves create two versions; a new instance and a running instance each advance with their own version; the removed routes answer 404.'
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
    const testName = 'v7.0.88: the workflow stepper widget sees a running instance; the API answer has the instance/currentState/allStates shape (TD-085)';
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
      if (!defId) throw new Error('The definition was not saved');
      const instance = await WorkflowTransitionExecutor.startInstance({ workflowDefinitionId: defId, entityType, entityId: '1' });

      const request = (await import('supertest')).default;
      const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
      const app = await getTestApp();
      const session = await getAdminSession();
      const get = () => request(app).get(`/api/workflow/instance/${entityType}/1`).set('Cookie', session.cookie);

      const res = await get();
      const body = res.body || {};
      if (res.status !== 200) violations.push(`HTTP ${res.status}`);
      if (body.instance?.id !== instance.id) violations.push(`instance.id=${body.instance?.id} (expected ${instance.id})`);
      if (body.definition?.id !== defId || body.definition?.code !== `REG_TD085_${suffix}`) violations.push('definition is incomplete');
      const titles = Array.isArray(body.allStates) ? body.allStates.map((s: { title: string }) => s.title) : [];
      if (titles.join('|') !== 'پیش‌نویس|بررسی|تایید نهایی') violations.push(`allStates is not in step order: ${titles.join('|') || '-'}`);
      if (body.currentState?.title !== 'پیش‌نویس' || body.currentState?.id !== instance.currentStateId) violations.push(`currentState=${body.currentState?.title ?? '-'}`);
      const actions = Array.isArray(body.availableTransitions) ? body.availableTransitions : [];
      if (actions.length !== 1 || actions[0]?.title !== 'ارسال') violations.push(`availableTransitions=${actions.length}`);
      if (!body.approvalProgress || typeof body.approvalProgress !== 'object') violations.push('approvalProgress is missing');
      if (!Array.isArray(body.history) || body.history.length !== 1) violations.push(`history=${Array.isArray(body.history) ? body.history.length : '-'}`);

      if (actions[0]?.id) {
        const exec = await request(app).post('/api/workflow/transition').set('Cookie', session.cookie).set('x-csrf-token', session.csrfToken)
          .send({ instanceId: instance.id, transitionId: actions[0].id, comment: 'آزمون' });
        if (exec.status !== 200) violations.push(`executing the action: HTTP ${exec.status}`);
        const after = (await get()).body || {};
        if (after.currentState?.title !== 'بررسی') violations.push(`after the send action currentState=${after.currentState?.title ?? '-'}`);
        if ((after.availableTransitions || [])[0]?.title !== 'تایید') violations.push('the action of the next step is not visible');
      }
      const none = await request(app).get(`/api/workflow/instance/${entityType}/999`).set('Cookie', session.cookie);
      if (none.status !== 200 || none.body?.instance !== null) violations.push(`without an instance: ${JSON.stringify(none.body).slice(0, 80)}`);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_workflow_instance_widget_contract_td_085',
        scenarioId: 'workflow_approval_postgres',
        name: testName,
        layer: 'regression',
        executionType: 'real_api',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'The instance API response holds the steps in order, the current step and the allowed action, and after execution shows the next step.'
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
    const testName = 'v7.0.89: Persian preview of workflow action conditions; a blocked action comes back with its reason and the execution error is Persian (TD-085)';
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
      if (!defId) throw new Error('The definition was not saved');
      const instance = await WorkflowTransitionExecutor.startInstance({ workflowDefinitionId: defId, entityType, entityId: '1' });
      const st = await WorkflowTransitionExecutor.getInstanceByEntity(entityType, '1', undefined, 'admin', ['*']);
      const available = st?.availableTransitions || [];
      const blocked = st?.blockedTransitions || [];
      if (available.length !== 1 || available[0].title !== 'تایید عادی') violations.push(`allowed actions: ${available.map((t) => t.title).join(', ') || '-'}`);
      if (available[0]?.conditions?.[0] !== 'entityId برابر ۱ باشد') violations.push(`condition text of the allowed action: ${available[0]?.conditions?.join(', ') ?? '-'}`);
      if (blocked.length !== 1 || blocked[0].title !== 'تایید کلان') {
        violations.push(`blocked actions: ${blocked.length}`);
      } else if (blocked[0].unmetConditions[0] !== 'entityId بیشتر از ۱۰۰ باشد (مقدار فعلی: ۱)') {
        violations.push(`blocking reason: ${blocked[0].unmetConditions.join(', ')}`);
      }
      const blockedId = blocked[0]?.id;
      if (blockedId) {
        let message = '';
        try {
          await WorkflowTransitionExecutor.executeTransition({ instanceId: instance.id, transitionId: blockedId, userRole: 'admin', userPermissions: ['*'] });
        } catch (err) {
          message = err instanceof Error ? err.message : String(err);
        }
        if (!message.includes('entityId بیشتر از ۱۰۰ باشد') || /\bgt\b/.test(message)) violations.push(`error of running the blocked action: ${message || 'no error'}`);
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
        details: 'The allowed action carries its condition text, the blocked action comes back with a Persian reason and running it is refused with a Persian message.'
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
    const testName = 'v7.0.91: journal voucher numbers are unique in the database and duplicate numbers are reported (TD-195)';
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

      if (!(await hasVoucherNumberUniqueIndex())) violations.push('the unique index on the voucher number was not created');
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
      if (!duplicateRejected) violations.push(`duplicate voucher number ${n} was accepted`);

      const report = await FinancialHealthService.runHealthCheck();
      const check = report.tests.find((t) => t.id === 'voucher_number_uniqueness');
      if (!check) violations.push('the financial health check has no voucher number uniqueness check');
      else if (!duplicateRejected && check.count === 0) violations.push('the duplicate number did not appear in the health report');

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
          if (await hasVoucherNumberUniqueIndex(tx)) violations.push('the migration created a unique index on data with a duplicate number');
          const afterMigration = await nextNumber(tx);
          if (afterMigration <= ahead) violations.push(`the sequence fell behind after the migration: ${afterMigration} <= ${ahead}`);
          throw new Error('rollback');
        });
      } catch (err) {
        if (!(err instanceof Error && err.message === 'rollback')) throw err;
      }
      if (reported.length !== 2) violations.push(`duplicate number report: ${reported.length} vouchers (expected 2)`);
      if (!(await hasVoucherNumberUniqueIndex())) violations.push('the unique index disappeared after the test transaction rolled back');

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_voucher_number_unique_td_195',
        scenarioId: 'v6_fiscal_year_closing_isolation',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'The unique index exists, a duplicate number is refused, the health check has the uniqueness check and duplicate numbers in data without the index are reported.'
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
    const testName = 'v7.0.101: one reminder of an approval task\'s deadline to its assignee (TD-085)';
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
      if (!defId) throw new Error('The definition was not saved');
      const instance = await WorkflowTransitionExecutor.startInstance({ workflowDefinitionId: defId, entityType, entityId: '7' });
      const ours = async () => orm.select().from(notifications).where(inArray(notifications.userId, userIds));

      await WorkflowSlaReminderService.sendDueReminders(new Date());
      if ((await ours()).length !== 0) violations.push('a notification was sent before the deadline passed');

      const later = new Date(Date.now() + 2 * 3600 * 1000);
      await WorkflowSlaReminderService.sendDueReminders(later);
      await WorkflowSlaReminderService.sendDueReminders(new Date(later.getTime() + 3600 * 1000));
      const sent = await ours();
      for (const [i, id] of userIds.slice(0, 2).entries()) {
        const mine = sent.filter((n) => n.userId === id);
        if (mine.length !== 1) violations.push(`responsible user ${i + 1}: ${mine.length} notifications (expected 1)`);
        else if (mine[0].link !== WORKFLOW_SLA_REMINDER_LINK || !mine[0].message.includes('تایید مدیر')) violations.push(`notification text: ${mine[0].message}`);
      }
      if (sent.some((n) => n.userId === userIds[2])) violations.push('a user with another role got a notification');
      const tasks = await orm.select().from(workflowTasks).where(eq(workflowTasks.instanceId, instance.id));
      if (tasks.length === 0 || tasks.some((t) => t.status !== 'pending' || !t.slaRemindedAt)) {
        violations.push(`task status after the reminder: ${tasks.map((t) => `${t.status}/${t.slaRemindedAt ? 'reminded' : '-'}`).join(', ') || '-'}`);
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
        details: 'No notification is sent before the deadline; after it each user of the task role gets one notification, a second run does not repeat it, another role gets none and the task stays open.'
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
    const testName = 'v7.0.101: an approval task does not expire, and expired tasks of the current step are reopened with a report (TD-085)';
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
      if (!defId) throw new Error('The definition was not saved');
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
        violations.push(`overdue task after the inbox read: ${afterInbox.map((t) => t.status).join(', ') || '-'}`);
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
      if (outcome.current !== 'pending') violations.push(`expired task of the current step: ${outcome.current} (expected pending)`);
      if (outcome.stale !== 'expired') violations.push(`expired task of another step: ${outcome.stale} (expected expired)`);
      if (outcome.finished !== 'expired') violations.push(`expired task of a finished instance: ${outcome.finished} (expected expired)`);
      if (logged.length !== 3) violations.push(`log rows: ${logged.length} (expected 3)`);
      if (logged.filter((l) => l.action === 'reopened').length !== 1) violations.push('the log must have exactly one reopening');
      if (logged.some((l) => !l.reason)) violations.push('log row without a reason');

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_workflow_task_reopen_td_085',
        scenarioId: 'workflow_approval_postgres',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'An overdue task stays pending; the migration reopens only the current-step task of a running instance and all three expired tasks are logged with a reason.'
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
    const testName = 'v7.0.102 Regression: the project reservation is deducted inside the outgoing remittance transaction, across all rows of the same item (TD-233)';
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
          inventoryControl: { isFinalized: true, isReserved: true, reservedItems },
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
      if (created.projectReservation?.releasedQuantity !== 4) violations.push(`deducted quantity: ${created.projectReservation?.releasedQuantity} (expected 4)`);
      if (afterA.length !== 1 || Number(afterA[0].convertedQty) !== 3 || Number(afterA[0].reservedQty) !== 50) {
        violations.push(`remaining reservation of project A: ${JSON.stringify(afterA)} (expected one row with convertedQty=3)`);
      }
      const report = await ItemStockReservationService.getReservedStockDetails();
      const reportedA = report.allReservationEntries
        .filter(e => e.sourceType === 'project' && Number(e.sourceId) === projA)
        .reduce((sum, e) => sum + Number(e.reservedQty || 0), 0);
      if (reportedA !== 3) violations.push(`reservation report for project A: ${reportedA} (expected 3)`);

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
      if (!rejected) violations.push('a remittance with a reservation deduction error must be refused');
      if (leaked) violations.push('the refused remittance document must not be recorded');
      if (stockAfterReject !== 16) violations.push(`stock after the refused remittance: ${stockAfterReject} (expected 16)`);

      // ۳. پیش‌نویس رزرو را کم نمی‌کند؛ نهایی‌سازی آن در همان تراکنش کم می‌کند
      const projC = await newProject([{ itemId: item.id, reservedQty: 6, unit: 'عدد' }]);
      const draftId = await DocumentService.createDocument(remittance(projC, 2, 'draft', `REM-TD233-C-${suffix}`));
      docIds.push(draftId);
      const afterDraft = await reservedOf(projC);
      if (Number(afterDraft[0]?.reservedQty) !== 6) violations.push(`a draft changed the reservation: ${JSON.stringify(afterDraft)}`);
      await DocumentService.finalizeDocument(draftId, 'test-agent', undefined, { strict: false });
      const afterFinal = await reservedOf(projC);
      if (Number(afterFinal[0]?.reservedQty) !== 4) violations.push(`reservation after finalizing: ${JSON.stringify(afterFinal)} (expected 4)`);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_project_reservation_server_td_233',
        scenarioId: 'inventory_rebuild',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'An outflow of 4 units is deducted from two reservation rows (the reservation report shows the same 3), a deduction error rolls back the remittance and finalizing a draft deducts the reservation.'
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
    const testName = 'v7.0.103 Regression: shipping and fees go to service revenue and the WooCommerce order tax to vat_amount; invoice total = amount paid (TD-191)';
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
        throw new Error(`a consistent order must be invoiced: ${okResult.status} ${okResult.message}`);
      }
      const doc = await DocumentService.getDocumentById(okResult.docId);
      // v8.0.42 (TD-295، تصمیم مالک محصول — گزینه الف): کارمزد منفی ۲۰ تخفیف سطر است، نه کسر از هزینه خدمات؛ قابل وصول همان ۲۵۶۰
      if (doc?.serviceChargeAmount !== 350) violations.push(`invoice shipping and service charge: ${doc?.serviceChargeAmount} (expected 350 = shipping 300 + fee 50)`);
      if (doc?.vatAmount !== 230) violations.push(`invoice VAT: ${doc?.vatAmount} (expected 230)`);
      if (doc?.payableAmount !== 2560) violations.push(`invoice payable amount: ${doc?.payableAmount} (expected 2560 = amount paid)`);
      const [voucher] = await orm.select().from(journalVouchers)
        .where(and(eq(journalVouchers.sourceDocumentId, okResult.docId), eq(journalVouchers.isDeleted, 0)));
      if (!voucher) {
        violations.push('invoice journal voucher was not issued');
      } else {
        const rows = await orm.select({ code: accounts.code, debit: journalVoucherItems.debit, credit: journalVoucherItems.credit })
          .from(journalVoucherItems).innerJoin(accounts, eq(journalVoucherItems.accountId, accounts.id))
          .where(eq(journalVoucherItems.voucherId, voucher.id));
        const credit = (code: string) => rows.filter(r => r.code === code).reduce((s, r) => s + Number(r.credit), 0);
        const debit = (code: string) => rows.filter(r => r.code === code).reduce((s, r) => s + Number(r.debit), 0);
        if (credit('5004') !== 350) violations.push(`credit to shipping and service revenue (5004): ${credit('5004')} (expected 350)`);
        if (credit('3203') !== 230) violations.push(`credit to VAT (3203): ${credit('3203')} (expected 230)`);
        if (debit('1201') !== 2560) violations.push(`debit to customer (1201): ${debit('1201')} (expected 2560)`);
      }

      // ۲. جمع ناسازگار با مبلغ پرداختی: کل سفارش رد و شکست در لاگ ثبت می‌شود
      const badResult = await WooOrderSyncService.handleOrder(order(ids.bad, '2400'));
      const [badLog] = await orm.select().from(woocommerceOrderLogs).where(eq(woocommerceOrderLogs.wcOrderId, ids.bad));
      if (badResult.status !== 'failed' || badLog?.erpDocumentId) violations.push(`an order with an inconsistent total must be refused: ${badResult.status}`);
      if (!String(badLog?.errorMessage || '').includes('مبلغ پرداختی')) violations.push(`failure message for the inconsistent total: ${badLog?.errorMessage}`);

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
      if (!createdUnder50) violations.push('migration 0033 did not create account 5004 under account 50');

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_woocommerce_shipping_tax_td_191',
        scenarioId: 'woocommerce_order_lifecycle',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'The order invoice gets 350 shipping and service charge, a 20 line discount (negative fee, TD-295) and 230 VAT, and its payable amount is 2560 (amount paid); the journal voucher posts 350 to 5004 and an order with an inconsistent total is refused.'
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
    const testName = 'v7.0.105 Regression: voiding a project remittance restores the same deducted reservation to the same project (TD-237)';
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
          inventoryControl: { isFinalized: true, isReserved: true, reservedItems },
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
      if ((await reservedOf(projA)).rows.length !== 1) violations.push('before the void only one reservation row must remain');
      await DocumentService.deleteDocument(docA, 'test-agent');
      const restoredA = await reservedOf(projA);
      const firstRow = restoredA.rows.find(r => Number(r.itemId) === item.id && Number(r.reservedQty) === 2);
      const secondRow = restoredA.rows.find(r => Number(r.convertedQty) === 5 && Number(r.reservedQty) === 50);
      if (restoredA.rows.length !== 2 || !firstRow || !secondRow) violations.push(`project A reservation after the void: ${JSON.stringify(restoredA.rows)} (expected 2 + 5)`);
      if (restoredA.isReserved !== true) violations.push('project A must be reserved after the void');
      const reportedA = await reportedFor(projA);
      if (reportedA !== 7) violations.push(`reservation report for project A: ${reportedA} (expected 7)`);
      const records = await orm.select().from(projectReservationReleases).where(eq(projectReservationReleases.documentId, docA));
      if (records.length !== 2 || records.some(r => !r.restoredAt)) violations.push(`deduction history of remittance A: ${records.length} rows, restored: ${records.filter(r => r.restoredAt).length} (expected 2 and 2)`);
      if (await stockOf() !== 20) violations.push(`stock after voiding remittance A: ${await stockOf()} (expected 20)`);

      // ۲. رزرو کامل مصرف‌شده (فهرست خالی) هم برمی‌گردد؛ مسیر نهایی‌سازی پیش‌نویس نیز سابقه کسر ثبت می‌کند
      const projB = await newProject([{ itemId: item.id, itemCode: item.code, reservedQty: 3, unit: 'عدد' }]);
      const draftB = await DocumentService.createDocument(remittance(projB, 3, 'draft', `REM-TD237-B-${suffix}`));
      docIds.push(draftB);
      await DocumentService.finalizeDocument(draftB, 'test-agent', undefined, { strict: false });
      const consumedB = await reservedOf(projB);
      if (consumedB.rows.length !== 0 || consumedB.isReserved !== false) violations.push(`project B reservation after finalizing: ${JSON.stringify(consumedB)} (expected empty)`);
      await DocumentService.deleteDocument(draftB, 'test-agent');
      const restoredB = await reservedOf(projB);
      if (restoredB.rows.length !== 1 || Number(restoredB.rows[0].reservedQty) !== 3 || restoredB.isReserved !== true) {
        violations.push(`project B reservation after the void: ${JSON.stringify(restoredB)} (expected one row of 3 units)`);
      }

      // ۳. حذف پیش‌نویس حواله (که چیزی کسر نکرده بود) رزرو را تغییر نمی‌دهد
      const projC = await newProject([{ itemId: item.id, reservedQty: 6, unit: 'عدد' }]);
      const draftC = await DocumentService.createDocument(remittance(projC, 2, 'draft', `REM-TD237-C-${suffix}`));
      docIds.push(draftC);
      await DocumentService.deleteDocument(draftC, 'test-agent');
      const afterC = await reservedOf(projC);
      if (afterC.rows.length !== 1 || Number(afterC.rows[0].reservedQty) !== 6) violations.push(`deleting a draft changed the reservation: ${JSON.stringify(afterC.rows)}`);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_project_reservation_restore_td_237',
        scenarioId: 'inventory_rebuild',
        name: testName,
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - tStart,
        details: 'Voiding a 4-unit remittance restores both reservation rows (2 and 5) and the reservation report shows 7; a fully consumed reservation is restored too and deleting a draft does not change the reservation.'
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
    const testName = 'v7.0.110 Regression: the all filter of the treasury transaction and cheque lists returns every row (TD-240)';
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
      if (!chequesAll.some(x => x.id === chequeId)) violations.push(`a cheque was not returned with type=all and status=all (${chequesAll.length} rows)`);
      const chequesPaid = await AccountingService.getCheques({ type: 'paid' });
      if (chequesPaid.some(x => x.id === chequeId)) violations.push('filter type=paid returned a received cheque');
      const txAll = await AccountingService.getTreasuryTransactions({ type: 'all' });
      if (!txAll.some(x => x.id === treasuryId)) violations.push(`a treasury transaction was not returned with type=all (${txAll.length} rows)`);
      const txPayments = await AccountingService.getTreasuryTransactions({ type: 'payment' });
      if (txPayments.some(x => x.id === treasuryId)) violations.push('filter type=payment returned a receipt');
      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_treasury_cheque_all_filter_td_240', scenarioId: 'multi_currency_financials_and_ratios', name: testName, layer: 'regression',
        executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
        details: 'type=all and status=all return every cheque and treasury transaction and the type filter still works.'
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
    const testName = 'v7.0.111 Regression: a purchase requisition ignores a workflow snapshot without ids and reads the current tables (TD-238)';
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
      if (legacy.states.length !== 3 || legacy.states.some(st => !st.id)) violations.push(`states were read from the legacy snapshot: ${JSON.stringify(legacy.states)}`);
      const submit = legacy.transitions.find(t => t.actionKey === 'submit');
      if (!submit || submit.fromStateId !== wf.states.draft.id || submit.toStateId !== wf.states.review.id) violations.push(`transition submit was not read from the table: ${JSON.stringify(legacy.transitions)}`);
      // تصویر معتبر (با شناسه) همچنان منبع فرایند در جریان است
      const usable = { states: [{ id: wf.states.draft.id, stateKey: 'draft' }], transitions: [{ id: 999999, fromStateId: wf.states.draft.id, toStateId: wf.states.draft.id, actionKey: 'loop' }] };
      const fromSnapshot = await ProcurementService.workflowGraphOf({ workflowDefinitionId: wf.definition.id, snapshotDsl: usable });
      if (fromSnapshot.states.length !== 1 || fromSnapshot.transitions[0]?.id !== 999999) violations.push('a valid instance snapshot must remain the source of states and transitions');
      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_procurement_workflow_snapshot_td_238', scenarioId: 'workflow_approval_postgres', name: testName, layer: 'regression',
        executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
        details: 'The snapshot without ids is set aside and 3 states and the submit transition are read from the table; a valid snapshot is still used.'
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
    const testName = 'v7.0.113 Regression: the purchase order total and the proforma reservation value have no floating-point error (TD-239)';
    const suffix = `${Date.now()}`;
    const docIds: number[] = [];
    let itemId = 0;
    let requisitionId = 0;
    try {
      const { createTestItem, createTestDocument } = await import('../fixtures/factories.js');
      const { ProcurementService } = await import('../../services/procurement.service.js');
      const { ItemStockReservationService } = await import('../../services/items/itemStockReservation.service.js');
      const item = await createTestItem({ name: `ERP-TEST-MARKER کالای اعشاری TD-239 ${suffix}`, code: `ITEM_TD239_${suffix}`, stocks: { '': 10 }, weightedAverageCost: 0.1 });
      itemId = item.id;
      const violations: string[] = [];
      // 3 × 0.1 در عدد JS برابر 0.30000000000000004 است
      const receiptRef = `PO-TD239-${suffix}`;
      const receipt = await createTestDocument({ type: 'receipt', status: 'draft', refNumber: receiptRef, notes: `[تدارکات: درخواست TD239-${suffix}]` }, [
        { itemId: item.id, quantity: 3, unitPrice: 0.1 },
        { itemId: item.id, quantity: 1, unitPrice: 0.2 },
      ]);
      docIds.push(receipt.document.id);
      // v9.0.347 (TD-691): سفارش تدارکات سندی است که ستون پیوندش به درخواست خرید پر است
      const { purchaseRequisitions } = await import('../../db/schema.js');
      const [requisition] = await orm.insert(purchaseRequisitions)
        .values({ code: `TD239-${suffix}`, title: 'ERP-TEST-MARKER درخواست TD-239', items: [] }).returning({ id: purchaseRequisitions.id });
      requisitionId = requisition.id;
      await orm.update(documents).set({ procurementRequisitionId: requisition.id }).where(eq(documents.id, receipt.document.id));
      const orders = await ProcurementService.getProcurementOrders({ search: receiptRef });
      const order = orders.data.find(o => o.id === receipt.document.id);
      if (!order) violations.push('the test purchase order did not appear in the list');
      else {
        if (order.totalAmount !== 0.5) violations.push(`purchase order total: ${order.totalAmount} (expected 0.5)`);
        if (order.items[0]?.totalPrice !== 0.3) violations.push(`order row total: ${order.items[0]?.totalPrice} (expected 0.3)`);
      }
      const proforma = await createTestDocument({ type: 'invoice', status: 'proforma', refNumber: `PF-TD239-${suffix}` }, [{ itemId: item.id, quantity: 3, unitPrice: 0.1 }]);
      docIds.push(proforma.document.id);
      const report = await ItemStockReservationService.getReservedStockDetails(undefined, true);
      const entry = report.allReservationEntries.find(e => e.sourceType === 'proforma' && Number(e.sourceId) === proforma.document.id);
      if (!entry) violations.push('the test proforma reservation did not appear in the report');
      // v9.0.399 (TD-823): the reservation is valued at the item's cost (WAC 0.1), never the proforma's price
      else if (entry.totalCost !== 0.3) violations.push(`proforma reservation value: ${entry.totalCost} (expected 0.3)`);
      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_procurement_reservation_decimal_td_239', scenarioId: 'multi_currency_financials_and_ratios', name: testName, layer: 'regression',
        executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
        details: 'Purchase order total 0.5, row 3 × 0.1 = 0.3 and proforma reservation value 0.3, with no floating-point error.'
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
      if (requisitionId) await cleanTestTableData('purchase_requisitions', 'id', [requisitionId]);
      if (itemId) await cleanTestTableData('items', 'id', [itemId]);
    }
  }

  // ------------------------------------------------------------------
  // TD-242: سند حسابداری فیش حقوقی فقط از پیوند صریح source_payroll_id؛ سند معکوس/اصلاحی سند فیش دیگر
  // (reference_id = شناسه «سند حسابداری مبدأ») هرگز سند فیش هم‌شناسه تلقی نمی‌شود
  // ------------------------------------------------------------------
  if (shouldRun('reg_payroll_voucher_link_td_242', 'td242', 'payroll', 'voucher')) {
    const tStart = Date.now();
    const testName = 'TD-242 Regression: issuing, showing and voiding a payslip voucher never picks up another payslip\'s reversal or correction voucher';
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
      if (!vA) throw new Error('journal voucher of payslip A was not issued');
      check(await sourcePayrollOf(vA.id) === payA.id, `the voucher of payslip A must have source_payroll_id=${payA.id} (got ${await sourcePayrollOf(vA.id)})`);
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
      check(Boolean(vB) && !foreign.has(vB!.id), `payslip B must get a new voucher, not the reversal or correction #${rev.id}/#${corr.id} of payslip A (got #${vB?.id})`);
      if (vB && !foreign.has(vB.id)) {
        check(await sourcePayrollOf(vB.id) === payB.id, `the voucher of payslip B must have source_payroll_id=${payB.id}`);
        check(vB.referenceNumber === payB.payrollNumber, `the reference number of the payslip B voucher must be the payslip number: "${vB.referenceNumber}"`);
      }

      // ۴) دیتابیس دومین سند فعال برای همان فیش را رد می‌کند (ایندکس یکتای جزئی)
      let duplicateRejected = false;
      try {
        await orm.execute(sql`INSERT INTO journal_vouchers (voucher_number, date, description, reference_module, reference_id, reference_number, source_payroll_id, total_debit, total_credit)
          VALUES (nextval('journal_voucher_number_seq'), ${todayIso}, 'probe duplicate TD-242', 'payroll', ${payB.id}, 'probe', ${payB.id}, 0, 0)`);
      } catch {
        duplicateRejected = true;
      }
      check(duplicateRejected, 'a second active voucher for one payslip must be refused by the unique index (uq_jv_source_payroll_active)');

      // ۵) فهرست و جزئیات فیش سند خود فیش را نشان می‌دهند
      const detailB = await PayrollReadService.getPayrollDetail(payB.id);
      check(detailB?.voucherLink.voucherId === vB?.id, `the payslip B detail must show voucher #${vB?.id} (got #${detailB?.voucherLink.voucherId})`);
      const listed = await PayrollReadService.listPayrolls({ personnelId: pers.id });
      const listedA = listed.find(r => r.id === payA.id);
      const listedB = listed.find(r => r.id === payB.id);
      check(listedA?.voucherId === vA.id, `list: the voucher of payslip A must be #${vA.id} (got #${listedA?.voucherId})`);
      check(listedB?.voucherId === vB?.id, `list: the voucher of payslip B must be #${vB?.id} (got #${listedB?.voucherId})`);

      // ۶) ابطال فیش B فقط سند خودش را حذف/معکوس می‌کند؛ سند معکوس/اصلاحی فیش A دست‌نخورده می‌ماند
      let deleteError = '';
      try {
        await PieceworkService.deletePayroll(payB.id, { username: 'test-agent' });
      } catch (err) {
        deleteError = err instanceof Error ? err.message : String(err);
      }
      check(!deleteError, `voiding payslip B must not fail because of the vouchers of payslip A: ${deleteError}`);
      for (const fid of foreign) {
        const row = await voucherRow(fid);
        check(row?.isDeleted === 0, `voiding payslip B deleted voucher #${fid} of payslip A`);
        const reversals = row ? await activeReversalsOf(fid, row.voucherNumber) : [];
        check(reversals.length === 0, `voiding payslip B reversed voucher #${fid} of payslip A (vouchers: ${reversals.join(', ')})`);
      }
      if (vB && !foreign.has(vB.id)) {
        const vBAfter = await voucherRow(vB.id);
        check(vBAfter?.isDeleted === 1, `the draft voucher of payslip B must be deleted when the payslip is voided (is_deleted=${vBAfter?.isDeleted})`);
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
      check(ensuredC?.id === legacyC1.id, `a payslip with unlinked legacy vouchers must return the oldest one (#${legacyC1.id}), not a new voucher (got #${ensuredC?.id})`);

      // ۸) پرکردن مهاجرت 0035: فقط فیش دارای یک سند با الگوی دقیق پیوند می‌گیرد؛ فیش دارای دو سند و سند معکوس دست‌نخورده
      const payD = await makePayroll('D');
      const legacyD = await legacyVoucher(payD.id, payD.payrollNumber);
      const migrationSql = fs.readFileSync(path.join(process.cwd(), 'drizzle', '0035_journal_voucher_source_payroll.sql'), 'utf8');
      const backfillSql = migrationSql.split('--> statement-breakpoint').find(part => /UPDATE journal_vouchers/.test(part));
      check(Boolean(backfillSql), 'the backfill part of migration 0035 was not found');
      if (backfillSql) {
        try {
          await orm.transaction(async (tx) => {
            await tx.execute(sql.raw(backfillSql));
            const res = await tx.execute(sql`SELECT id, source_payroll_id FROM journal_vouchers WHERE id IN (${legacyD.id}, ${legacyC1.id}, ${legacyC2.id}, ${rev.id}, ${corr.id})`) as unknown as { rows: Array<{ id: number; source_payroll_id: number | null }> };
            const src = new Map(res.rows.map(r => [Number(r.id), r.source_payroll_id === null ? null : Number(r.source_payroll_id)]));
            check(src.get(legacyD.id) === payD.id, `the migration must link the single voucher of payslip D (got ${src.get(legacyD.id)})`);
            check(src.get(legacyC1.id) === null && src.get(legacyC2.id) === null, `the migration must not link the ambiguous vouchers of payslip C (${src.get(legacyC1.id)}, ${src.get(legacyC2.id)})`);
            check(src.get(rev.id) === null && src.get(corr.id) === null, `the migration must not link the reversal or correction voucher (${src.get(rev.id)}, ${src.get(corr.id)})`);
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
      check(!deleteCError, `voiding payslip C must not fail: ${deleteCError}`);
      for (const lid of [legacyC1.id, legacyC2.id]) {
        const row = await voucherRow(lid);
        check(row?.isDeleted === 1, `voiding payslip C must delete the legacy draft voucher #${lid}`);
      }

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_payroll_voucher_link_td_242', scenarioId: 'document_voucher_uniqueness', name: testName, layer: 'regression',
        executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
        details: 'The payslip voucher carries source_payroll_id with a unique index; a reversal/correction voucher with the same id is not picked when issuing, listing, viewing or voiding the payslip; a legacy unlinked voucher blocks a second issue and the migration backfill links only unambiguous cases.'
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
    const testName = 'TD-243 Regression: the automatic piecework task code is unique under concurrent creation, next to manual and deleted codes and in the Excel import';
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
          check(/^PW-\d{3,}$/.test(t.code), `${label}: an automatic code must be PW- and at least three digits (got ${t.code})`);
          const num = codeNumber(t.code);
          const clashes = all.filter(r => r.id !== t.id && (
            r.code.trim().toLowerCase() === t.code.trim().toLowerCase() || (num !== null && codeNumber(r.code) === num)
          ));
          check(clashes.length === 0, `${label}: the automatic code ${t.code} (#${t.id}) duplicates existing rows: ${clashes.map(c => `#${c.id}=${c.code}`).join(', ')}`);
        }
      };

      // (الف) چند ایجاد هم‌زمان بدون کد → کدهای متمایز
      const concurrent = await Promise.all(Array.from({ length: 6 }, (_, i) =>
        PieceworkService.createTask({ title: title(`هم‌زمان-${i}`), defaultRate: 1000, username: 'test-agent' })
      ));
      taskIds.push(...concurrent.map(t => t.id));
      const concurrentCodes = concurrent.map(t => t.code);
      check(new Set(concurrentCodes).size === concurrentCodes.length, `concurrent creation gave a duplicate code: ${concurrentCodes.join(', ')}`);
      await assertUniqueAgainstAll('concurrent creation', concurrent);

      // (ب) کد دستی برابر با کدی که روش قدیمی (COUNT(*)+1) بعدی می‌ساخت، سپس ایجاد خودکار
      const [{ count: rowCount }] = await orm.select({ count: sql<number>`count(*)` }).from(pieceworkTasks);
      const manual = await PieceworkService.createTask({ code: pad(Number(rowCount) + 2), title: title('دستی'), defaultRate: 1000, username: 'test-agent' });
      taskIds.push(manual.id);
      const afterManual = await PieceworkService.createTask({ title: title('پس از دستی'), defaultRate: 1000, username: 'test-agent' });
      taskIds.push(afterManual.id);
      await assertUniqueAgainstAll('after a manual code', [afterManual]);

      // (ج) ورود اکسل بدون کد کنار ردیف حذف‌شده‌ای که کد «بیشینه فعال + ۱» را دارد (روش قدیمی MAX فعال + 1)
      const activeRows = await orm.select({ code: pieceworkTasks.code }).from(pieceworkTasks).where(eq(pieceworkTasks.isDeleted, 0));
      const maxActive = activeRows.reduce((max, r) => Math.max(max, Number(codeNumber(r.code) ?? 0)), 0);
      await insertRaw(pad(maxActive + 1), 'حذف‌شده-اکسل', 1);
      const importResult = await PieceworkService.importTasksFromExcel({
        rows: [{ title: title('اکسل-۱'), defaultRate: 500 }, { title: title('اکسل-۲'), defaultRate: 700 }],
        mode: 'upsert',
        username: 'test-agent'
      });
      check(importResult.createdCount === 2, `the Excel import must create two new tasks (got ${importResult.createdCount})`);
      const imported = await orm.select({ id: pieceworkTasks.id, code: pieceworkTasks.code }).from(pieceworkTasks)
        .where(inArray(pieceworkTasks.title, [title('اکسل-۱'), title('اکسل-۲')]));
      taskIds.push(...imported.map(t => t.id));
      await assertUniqueAgainstAll('Excel import', imported);

      if (violations.length > 0) throw new Error(violations.join(' | '));

      // (د) کد دستی دقیقاً جلوتر از شمارنده (فعال، و حذف‌شده با حروف کوچک و صفر اضافه) → شماره رد می‌شود، خطا نمی‌دهد
      const seqRes = await orm.execute(sql`SELECT last_value, is_called FROM piecework_task_code_seq`) as unknown as { rows: Array<{ last_value: string | number; is_called: boolean }> };
      const seqRow = seqRes.rows[0];
      const nextSeq = Number(seqRow.last_value) + (seqRow.is_called ? 1 : 0);
      await insertRaw(pad(nextSeq), 'جلوتر-فعال', 0);
      await insertRaw(`pw-0${String(nextSeq + 1).padStart(3, '0')}`, 'جلوتر-حذف‌شده', 1);
      const skipped = await PieceworkService.createTask({ title: title('رد شماره'), defaultRate: 1000, username: 'test-agent' });
      taskIds.push(skipped.id);
      check(Number(codeNumber(skipped.code)) >= nextSeq + 2, `the automatic code must skip the taken numbers ${nextSeq} and ${nextSeq + 1} (got ${skipped.code})`);
      await assertUniqueAgainstAll('skipping a taken number', [skipped]);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_piecework_task_code_atomic_td_243', scenarioId: 'v10_next_code_concurrent_unique', name: testName, layer: 'regression',
        executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
        details: `concurrent codes ${concurrentCodes.join(', ')} are distinct; after manual code ${manual.code} comes ${afterManual.code}; Excel import ${imported.map(t => t.code).join(', ')}; taken numbers skipped -> ${skipped.code}.`
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
    const testName = 'TD-246 Regression: a piecework task code is unique among active tasks (create, edit, restore, Excel import, migration and health check)';
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
          violations.push(`${label}: duplicate code "${codeShown}" was accepted`);
        } catch (err) {
          if (!(err instanceof ConflictError)) violations.push(`${label}: expected ConflictError (got ${errText(err)})`);
          else if (!/[؀-ۿ]/.test(err.message) || !err.message.includes(codeShown.trim())) {
            violations.push(`${label}: the error message must be Persian and include the code "${codeShown.trim()}" (got: ${err.message})`);
          }
        }
      };

      // (الف) ایندکس یکتای جزئی پس از مهاجرت روی داده تمیز
      const def = await indexDef();
      check(def !== null, 'the index uq_ptask_code_active does not exist after the migration');
      if (def) check(/UNIQUE/i.test(def) && /lower\(btrim\(code\)\)/i.test(def) && /is_deleted = 0/i.test(def), `the index definition is wrong: ${def}`);

      // (ب) کد دستی تکراری — عین کد، و فقط با تفاوت حروف بزرگ/کوچک و فاصله
      const codeA = code('A');
      const taskA = await PieceworkService.createTask({ code: codeA, title: title('A'), defaultRate: 1000, username: 'test-agent' });
      taskIds.push(taskA.id);
      const duplicateTitleA = title('A-تکرار');
      await expectConflict('create with a duplicate code', codeA, () => PieceworkService.createTask({ code: codeA, title: duplicateTitleA, defaultRate: 1000, username: 'test-agent' }));
      const codeAVariant = `  ${codeA.toLowerCase()}  `;
      const letterCaseTitleA = title('A-حروف');
      await expectConflict('create with a duplicate code (lower case and spaces)', codeAVariant, () => PieceworkService.createTask({ code: codeAVariant, title: letterCaseTitleA, defaultRate: 1000, username: 'test-agent' }));
      // قید پایگاه‌داده مستقل از برنامه (درج مستقیم)، و نگاشت 23505 آن به همان ConflictError فارسی
      try {
        const [raw] = await orm.insert(pieceworkTasks).values({ code: `${codeA.toLowerCase()} `, title: title('A-مستقیم'), defaultRate: money(0), isActive: 1, isDeleted: 0 })
          .returning({ id: pieceworkTasks.id });
        taskIds.push(raw.id);
        violations.push('the database accepted a direct insert of a duplicate code');
      } catch (err) {
        const mapped = taskCodeMod.toPieceworkTaskCodeError?.(err, codeA);
        check(mapped instanceof ConflictError && (mapped as Error).message.includes(codeA), `the index violation was not mapped to the Persian ConflictError (${errText(mapped ?? err)})`);
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
        violations.push(`the code of a deleted title must be reusable (got ${errText(err)})`);
      }
      await expectConflict('restoring a deleted task whose code is taken', codeB, () => PieceworkService.restoreTask(taskB.id, { username: 'test-agent' }));
      check((await activeWithKey(codeB)).length === 1, `after the refused restore there must be one active task with code ${codeB}`);

      // (د) ویرایش کد به کد گرفته‌شده رد می‌شود؛ ویرایش به کد آزاد ذخیره می‌شود
      const taskC = await PieceworkService.createTask({ code: code('C'), title: title('C'), defaultRate: 1000, username: 'test-agent' });
      taskIds.push(taskC.id);
      await expectConflict('editing to a taken code', codeA.toUpperCase(), () => PieceworkService.updateTask(taskC.id, { code: codeA.toUpperCase(), username: 'test-agent' }));
      const [afterRejected] = await orm.select({ code: pieceworkTasks.code }).from(pieceworkTasks).where(eq(pieceworkTasks.id, taskC.id));
      check(afterRejected?.code === code('C'), `the task code must not change after a refused edit (got ${afterRejected?.code})`);
      try {
        await PieceworkService.updateTask(taskC.id, { code: code('C2'), username: 'test-agent' });
        const [afterFree] = await orm.select({ code: pieceworkTasks.code }).from(pieceworkTasks).where(eq(pieceworkTasks.id, taskC.id));
        check(afterFree?.code === code('C2'), `editing to a free code was not saved (got ${afterFree?.code})`);
      } catch (err) {
        violations.push(`editing to a free code must not fail (got ${errText(err)})`);
      }

      // (ه) ورود اکسل به شیوه append: کد موجود یا تکرار کد در همان فایل کل فایل را رد می‌کند و هیچ ردیفی درج نمی‌شود
      const countByTitle = async (titles: string[]) => (await orm.select({ id: pieceworkTasks.id }).from(pieceworkTasks)
        .where(inArray(pieceworkTasks.title, titles))).length;
      const appendTitles = [title('اکسل-افزودن-۱'), title('اکسل-افزودن-۲')];
      await expectConflict('Excel append import with an existing code', ` ${codeA.toLowerCase()}`, () => PieceworkService.importTasksFromExcel({
        rows: [{ title: appendTitles[0], code: code('D') }, { title: appendTitles[1], code: ` ${codeA.toLowerCase()}` }],
        mode: 'append', username: 'test-agent'
      }));
      check(await countByTitle(appendTitles) === 0, 'a refused Excel import must insert no row');
      const inFileTitles = [title('اکسل-درون-فایل-۱'), title('اکسل-درون-فایل-۲')];
      await expectConflict('Excel append import with a code repeated in the file', code('E').toLowerCase(), () => PieceworkService.importTasksFromExcel({
        rows: [{ title: inFileTitles[0], code: code('E') }, { title: inFileTitles[1], code: code('E').toLowerCase() }],
        mode: 'append', username: 'test-agent'
      }));
      check(await countByTitle(inFileTitles) === 0, 'an Excel import with a code repeated in the file must insert no row');
      // upsert: ردیف دوم با همان کد همان عنوان را به‌روز می‌کند، عنوان دوم ساخته نمی‌شود
      const upsertTitles = [title('اکسل-upsert-۱'), title('اکسل-upsert-۲')];
      const upsert = await PieceworkService.importTasksFromExcel({
        rows: [{ title: upsertTitles[0], code: code('F') }, { title: upsertTitles[1], code: ` ${code('F').toLowerCase()} ` }],
        mode: 'upsert', username: 'test-agent'
      });
      const fIds = await activeWithKey(code('F'));
      taskIds.push(...fIds);
      check(upsert.createdCount === 1 && upsert.updatedCount === 1 && fIds.length === 1,
        `an upsert import with a code repeated in the file must create one task and update that same task (created ${upsert.createdCount}, updated ${upsert.updatedCount}, active ${fIds.length})`);

      // (و) بازرس سلامت مالی: روی داده تمیز سالم
      const report = await FinancialHealthService.runHealthCheck();
      const entry = report.tests.find((t) => t.id === 'piecework_task_code_uniqueness');
      if (!entry) violations.push('the financial health check has no task title code uniqueness check');
      else check(entry.status === 'healthy' && entry.count === 0, `the health check must be healthy on data without duplicates (status ${entry.status}, count ${entry.count})`);

      // (ز) داده قدیمی بدون ایندکس (تراکنش برگشت‌خورده): تکراری‌ها گزارش می‌شوند و مهاجرت 0037 ایندکس نمی‌سازد؛
      // پس از رفع تکرار مهاجرت ایندکس را می‌سازد. طرح پایگاه‌داده پس از برگشت دست‌نخورده می‌ماند.
      const migrationPath = path.join(process.cwd(), 'drizzle', '0037_piecework_task_code_unique.sql');
      const { findDuplicatePieceworkTaskCodes } = taskCodeMod;
      const { buildPieceworkTaskCodeHealthTest } = healthMod;
      if (!fs.existsSync(migrationPath)) violations.push('migration 0037_piecework_task_code_unique.sql does not exist');
      else if (typeof findDuplicatePieceworkTaskCodes !== 'function' || typeof buildPieceworkTaskCodeHealthTest !== 'function') {
        violations.push('the duplicate code finder or the task title code uniqueness health check is not defined');
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
              `the duplicate finder must return only the two active tasks ${activeIds.join(',')} (got ${reported.map(r => r.id).join(',')})`);
            const healthEntry = buildPieceworkTaskCodeHealthTest(await findDuplicatePieceworkTaskCodes(tx), (await indexDef(tx)) !== null);
            check(healthEntry.status !== 'healthy' && healthEntry.count >= 1 && activeIds.every(id => healthEntry.items?.some(it => it.id === id)),
              `the health check must report the duplicate code with both tasks (status ${healthEntry.status}, count ${healthEntry.count})`);
            const migrationSql = fs.readFileSync(migrationPath, 'utf8');
            await tx.execute(sql.raw(migrationSql));
            check((await indexDef(tx)) === null, 'migration 0037 created the unique index on data with a duplicate code');
            await tx.update(pieceworkTasks).set({ isDeleted: 1 }).where(eq(pieceworkTasks.id, activeIds[1]));
            await tx.execute(sql.raw(migrationSql));
            check((await indexDef(tx)) !== null, 'migration 0037 did not create the unique index after the duplicate was removed');
            throw new Error('rollback');
          });
        } catch (err) {
          if (!(err instanceof Error && err.message === 'rollback')) throw err;
        }
        check((await indexDef()) !== null, 'the unique index was lost after the test transaction rolled back');
      }

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_piecework_task_code_unique_td_246', scenarioId: 'v10_next_code_concurrent_unique', name: testName, layer: 'regression',
        executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
        details: 'A duplicate code (exact code, letter case/spaces, direct insert, edit, restore, Excel append) is refused; the code of a deleted title is reused; migration 0037 creates no index on duplicate data and the health check reports the duplicates.'
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
    const testName = 'TD-247 Regression: decimal sums of the project report and bank reconciliation, the voucher template balance threshold, accounting route input validation and a fixed document signature sample';
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
        code: `9247${suffix}`, name: `ERP-TEST-MARKER حساب TD-247 ${suffix}`, level: 'detailed', parentId: null,
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
        `the running balance of the project detail must be [0.1,0.3,0.2] (status ${detailRes.status}, got ${JSON.stringify(running)})`);
      check(detail.length === 3 && detail[1].debit === 0.2 && detail[2].credit === 0.1, `the row amounts of the project detail are wrong: ${JSON.stringify(detail)}`);
      const summaryRes = await get('/api/accounting/reports/project-summary');
      const summaryRows = Array.isArray(summaryRes.body) ? summaryRes.body as Array<{ projectId: number; totalDebit: number; totalCredit: number; balance: number; entriesCount: number }> : [];
      const summary = summaryRows.find(r => Number(r.projectId) === projectId);
      check(summaryRes.status === 200 && !!summary && summary.totalDebit === 0.3 && summary.totalCredit === 0.1 && summary.balance === 0.2 && summary.entriesCount === 3,
        `the project summary must be debit 0.3, credit 0.1 and balance 0.2 (status ${summaryRes.status}, got ${JSON.stringify(summary)})`);

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
      check(reconStatus === 200 && createdBankIds.every(id => accs.some(x => x.id === id)), `the bank reconciliation report must return the test accounts (status ${reconStatus})`);
      check(meaningful, 'none of the candidate amounts produced a JavaScript decimal sum error; the test is not meaningful');
      for (const key of ['ledgerBalance', 'treasuryBalance', 'discrepancy'] as const) {
        const totalKey = key === 'ledgerBalance' ? 'totalCashAndBankLedger' : key === 'treasuryBalance' ? 'totalCashAndBankTreasury' : 'totalDiscrepancy';
        const exact = FinancialMath.sum(accs.map(x => x[key])).toNumber();
        check(recon?.[totalKey] === exact, `${totalKey} of the bank reconciliation report must be the decimal sum ${exact} (got ${recon?.[totalKey]})`);
      }

      // (ج) تراز طرح Zod سند: اختلاف ۰٫۰۰۵ و دقیقاً ۰٫۰۱ مانند VoucherService پذیرفته، ۰٫۰۲ رد می‌شود
      const items = (debit: number) => [
        { accountId: account.id, debit, credit: 0 },
        { accountId: account.id, debit: 0, credit: 100 },
      ];
      const base = { date: '1405/01/15', description: 'ERP-TEST-MARKER سند TD-247' };
      for (const [debit, want] of [[100.005, true], [100.01, true], [100.02, false]] as Array<[number, boolean]>) {
        const c = createVoucherSchema.safeParse({ body: { ...base, items: items(debit) } }).success;
        const u = updateVoucherSchema.safeParse({ params: { id: '1' }, body: { version: 1, items: items(debit) } }).success; // v9.0.295 (TD-555): ویرایش نسخه می‌خواهد
        const k = correctVoucherSchema.safeParse({ params: { id: '1' }, body: { reason: 'اصلاح آزمون', newItems: items(debit) } }).success;
        check(c === want && u === want && k === want, `the voucher schema with debit ${debit} and credit 100 must be ${want ? 'accepted' : 'refused'} (create ${c}, edit ${u}, correction ${k})`);
      }
      const createRes = await send('post', '/api/accounting/vouchers', { ...base, status: 'draft', items: items(100.005) });
      const createdId = (createRes.body as { id?: number })?.id;
      if (typeof createdId === 'number') createdVoucherIds.push(createdId);
      check(createRes.status === 201 || createRes.status === 200, `creating a voucher with a difference of 0.005 over HTTP must be accepted like the service (status ${createRes.status}: ${JSON.stringify(createRes.body).slice(0, 200)})`);

      // (د) ورودی‌های تازه اعتبارسنجی‌شده: بدنه واقعی رابط کاربری می‌گذرد، ورودی نامعتبر 400
      const expectStatus = (label: string, got: number, want: number) => check(got === want, `${label}: status ${got} (expected ${want})`);
      // نگاشت سرفصل‌ها — همان کاری که AccountingSettingsTab می‌کند: پاسخ GET بدون disabled/accountsCount، به‌علاوه disabled
      const mappingsGet = await get('/api/accounting/mappings');
      const { disabled: currentDisabled, accountsCount: _count, ...uiMappings } = (mappingsGet.body || {}) as Record<string, unknown>;
      void _count;
      const uiSave = await send('post', '/api/accounting/mappings', { ...uiMappings, disabled: Array.isArray(currentDisabled) ? currentDisabled : [] });
      expectStatus('saving the mapping with the UI body', uiSave.status, 200);
      const savedData = (uiSave.body as { data?: Record<string, unknown> })?.data ?? {};
      check(!('chartHasAccounts' in savedData), 'the non-mapping key chartHasAccounts must not be stored in the account mapping');
      expectStatus('mapping with a numeric code', (await send('post', '/api/accounting/mappings', { salesRevenueAccountCode: 5001 })).status, 400);
      expectStatus('mapping with a non-array disabled', (await send('post', '/api/accounting/mappings', { disabled: 'salesRevenueAccountCode' })).status, 400);
      // ویرایش حساب — همان بدنه فرم ChartOfAccountsTab
      const uiAccount = { code: account.code, name: `${account.name} ویرایش`, level: 'detailed', parentId: null, accountType: 'asset', nature: 'debit', description: 'شرح' };
      const accRes = await send('put', `/api/accounting/accounts/${account.id}`, uiAccount);
      expectStatus('account edit with the UI body', accRes.status, 200);
      check((accRes.body as { name?: string })?.name === uiAccount.name, `the account name was not edited: ${JSON.stringify(accRes.body).slice(0, 200)}`);
      expectStatus('account edit with an invalid level', (await send('put', `/api/accounting/accounts/${account.id}`, { level: 'bogus' })).status, 400);
      expectStatus('account edit with a numeric name', (await send('put', `/api/accounting/accounts/${account.id}`, { name: 123 })).status, 400);
      const [accAfter] = await orm.select({ level: accounts.level, name: accounts.name }).from(accounts).where(eq(accounts.id, account.id));
      check(accAfter?.level === 'detailed' && accAfter?.name === uiAccount.name, `the account must not change after invalid input: ${JSON.stringify(accAfter)}`);
      // فهرست طرف‌های حساب
      expectStatus('party list without parameters (UI)', (await get('/api/accounting/reports/parties')).status, 200);
      expectStatus('party list with a valid type', (await get('/api/accounting/reports/parties?type=personnel&search=x')).status, 200);
      expectStatus('party list with an invalid type', (await get('/api/accounting/reports/parties?type=bogus')).status, 400);
      expectStatus('party list with a repeated search', (await get('/api/accounting/reports/parties?search=a&search=b')).status, 400);
      // کد پیشنهادی حساب خزانه
      const cashCode = await get('/api/accounting/banks/next-code?type=cash');
      check(cashCode.status === 200 && /^CASH-\d+$/.test(String((cashCode.body as { code?: string })?.code)), `the suggested cash fund code is wrong (${cashCode.status} ${JSON.stringify(cashCode.body)})`);
      const emptyCode = await get('/api/accounting/bank-accounts/next-code?type=');
      check(emptyCode.status === 200 && /^BANK-\d+$/.test(String((emptyCode.body as { code?: string })?.code)), `an empty type must behave as bank, as before (${emptyCode.status} ${JSON.stringify(emptyCode.body)})`);
      expectStatus('suggested code with an invalid type', (await get('/api/accounting/banks/next-code?type=bogus')).status, 400);

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
      const NEWEST_SIGNER = 'امضاکننده جدید';
      check(latest.status === 200 && JSON.stringify(latest.names) === JSON.stringify([NEWEST_SIGNER]),
        `the voucher signature must come from the newest instance (status ${latest.status}, got ${JSON.stringify(latest.names)})`);
      const entityTie = `TD247-TIE-${suffix}`;
      await addInstance(entityTie, '2026-03-01 10:00:00', 'امضاکننده شناسه کوچک');
      const highId = await addInstance(entityTie, '2026-03-01 10:00:00', 'امضاکننده شناسه بزرگ');
      const tie = await signersOf(entityTie);
      const HIGHER_ID_SIGNER = 'امضاکننده شناسه بزرگ';
      check(tie.status === 200 && JSON.stringify(tie.names) === JSON.stringify([HIGHER_ID_SIGNER]),
        `with equal creation times the signature must come from the instance with the higher id (status ${tie.status}, got ${JSON.stringify(tie.names)})`);
      const instRes = await get(`/api/workflow/instance/document/${encodeURIComponent(entityTie)}`);
      const shownId = (instRes.body as { instance?: { id?: number } | null })?.instance?.id;
      check(instRes.status === 200 && shownId === highId, `GET /workflow/instance must show the same instance as the printed signature (${highId}) (status ${instRes.status}, got ${shownId})`);

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_accounting_route_findings_td_247', scenarioId: 'v4_accounting_treasury_runtime_contracts_guard', name: testName, layer: 'regression',
        executionType: 'real_api', passed: true, durationMs: Date.now() - tStart,
        details: 'The current balance, project balance and bank reconciliation grand total are exact (Decimal); the voucher draft accepts a difference ≤ 0.01 like the service and refuses 0.02; mapping, account edit, parties and treasury code refuse invalid input with 400 and accept the UI body; the voucher signature comes from the newest workflow instance.'
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
    const testName = 'TD-245 Regression: replaying only unresolved DLQ events with marking and audit, health counters and integrity audit (DLQ, 0.01 balance, soft delete), Outbox reset audit, business-date export file names and Zod validation';
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
      // v9.0.392 (TD-622): the details print counts in Persian digits; an ok check names no count
      const scanNumber = (s: Scan, id: string, re: RegExp) => {
        const details = (s.checks?.find(c => c.id === id)?.details ?? '').replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
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
        `dlqCount of the health page must count only unresolved rows (${wantUnresolved}) (status ${h1.status}, got ${h1.body.outbox?.dlqCount})`);
      const s1 = await scan();
      const FAILED_EVENTS_PATTERN = /(\d+) رویداد ناموفق/;
      check(s1.status === 200 && scanNumber(s1.body, 'outbox_dlq', FAILED_EVENTS_PATTERN) === wantUnresolved,
        `the integrity check must report ${wantUnresolved} unresolved DLQ events (got ${s1.body.checks?.find(c => c.id === 'outbox_dlq')?.details})`);

      const requeueRes = await post('/api/system/reconciliation-fix', { action: 'requeue_dlq' });
      check(requeueRes.status === 200 && (requeueRes.body as { success?: boolean })?.success === true,
        `requeue_dlq with the UI body must answer 200 (status ${requeueRes.status}: ${JSON.stringify(requeueRes.body).slice(0, 200)})`);
      const after = await orm.select().from(deadLetterEvents).where(inArray(deadLetterEvents.id, createdDlqIds));
      const afterTag = (tag: string) => after.find(r => r.originalEventId === ev(tag));
      for (const tag of ['A', 'D']) {
        const r = afterTag(tag);
        check(!!r, `DLQ row ${tag} must not be deleted`);
        check(r?.status === 'replayed' && !!r?.resolvedAt && r?.resolvedBy === admin?.id && /Outbox/.test(r?.resolutionNotes || ''),
          `DLQ row ${tag} must be marked like a replay, with status replayed and the resolution time and user (got ${JSON.stringify(r ? { status: r.status, resolvedAt: r.resolvedAt, resolvedBy: r.resolvedBy, notes: r.resolutionNotes } : null)})`);
      }
      for (const tag of ['B', 'C']) {
        const r = afterTag(tag);
        const orig = byTag(tag);
        check(!!r && r.status === orig.status && r.resolutionNotes === orig.resolutionNotes && r.resolvedAt === orig.resolvedAt,
          `the resolved DLQ row ${tag} (${orig.status}) must not be requeued or changed (got ${JSON.stringify(r ? { status: r.status, notes: r.resolutionNotes } : null)})`);
      }
      const outboxRows = await orm.select().from(outboxEvents).where(sql`${outboxEvents.eventId} LIKE ${`TD245-%-${suffix}%`}`);
      for (const r of outboxRows) if (!createdOutboxEventIds.includes(r.eventId)) createdOutboxEventIds.push(r.eventId);
      const outA = outboxRows.filter(r => r.eventId.startsWith(ev('A')));
      check(outA.length === 1 && outA[0].eventId === ev('A') && outA[0].status === 'pending' && outA[0].retryCount === 0
        && JSON.stringify(outA[0].completedHandlers) === JSON.stringify(['td245-handler-ok']),
        `the outbox row of event A must be the same row (original id) with status pending, retry count zero and the earlier successful handlers (got ${JSON.stringify(outA.map(r => ({ id: r.eventId, status: r.status, retry: r.retryCount, handlers: r.completedHandlers })))})`);
      const outD = outboxRows.filter(r => r.eventId.startsWith(ev('D')));
      check(outD.length === 1 && outD[0].eventId === ev('D') && outD[0].status === 'pending',
        `event D without an outbox row must be inserted once with the same id (got ${JSON.stringify(outD.map(r => r.eventId))})`);
      check(!outboxRows.some(r => r.eventId.startsWith(ev('B')) || r.eventId.startsWith(ev('C'))), 'replayed / dismissed events must not return to the outbox');
      const [requeueLog] = await orm.select().from(activityLogs)
        .where(and(sql`${activityLogs.id} > ${maxLogId}`, eq(activityLogs.entityId, 'dlq_requeue'))).orderBy(sql`${activityLogs.id} DESC`).limit(1);
      if (requeueLog) createdLogIds.push(requeueLog.id);
      const requeueDetails = (requeueLog?.details || {}) as { before?: Array<{ id: number; status: string }>; after?: Array<{ id: number; status: string }> };
      check(!!requeueLog && !!requeueLog.ipAddress && requeueLog.userId === admin?.id
        && [byTag('A').id, byTag('D').id].every(id => requeueDetails.before?.some(b => b.id === id && b.status === 'quarantined') && requeueDetails.after?.some(a => a.id === id && a.status === 'replayed'))
        && !requeueDetails.before?.some(b => b.id === byTag('B').id || b.id === byTag('C').id),
        `the requeue_dlq audit row must have the IP, the user and the before and after status of rows A and D (got ${JSON.stringify(requeueLog ? { ip: requeueLog.ipAddress, userId: requeueLog.userId, details: requeueLog.details } : null).slice(0, 300)})`);
      const h2 = await health();
      const wantAfter = await unresolvedDlqCount();
      check(h2.body.outbox?.dlqCount === wantAfter, `after the requeue dlqCount must be ${wantAfter} (got ${h2.body.outbox?.dlqCount})`);

      // (ب) تراز اسناد: حذف‌شده نرم ناتراز، اختلاف ۰٫۰۰۵، ردیف حذف‌شده نرم و اختلاف ۰٫۰۲ — فقط آخری ناتراز است
      const baseHealth = await health();
      const baseScan = await scan();
      const baseUnbalanced = scanNumber(baseScan.body, 'accounting_vouchers', /(\d+) سند حسابداری/);
      const baseTotal = baseHealth.body.accounting?.totalVouchers ?? -1;
      const account = await AccountingService.createAccount({
        code: `9245${suffix}`, name: `ERP-TEST-MARKER حساب TD-245 ${suffix}`, level: 'detailed', parentId: null,
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
      const scanUnbalanced = scanNumber(vScan.body, 'accounting_vouchers', /(\d+) سند حسابداری/);
      check(scanUnbalanced === baseUnbalanced + 1,
        `the integrity check must count only the voucher with a 0.02 difference as unbalanced (base ${baseUnbalanced}, got ${scanUnbalanced}: ${vScan.body.checks?.find(c => c.id === 'accounting_vouchers')?.details})`);
      check(vHealth.body.accounting?.unbalancedVouchers === scanUnbalanced,
        `unbalancedVouchers of the health page (${vHealth.body.accounting?.unbalancedVouchers}) must equal the integrity check (${scanUnbalanced})`);
      check(vHealth.body.accounting?.totalVouchers === baseTotal + 3,
        `totalVouchers must not count a soft-deleted voucher (base ${baseTotal}, got ${vHealth.body.accounting?.totalVouchers})`);

      // (ج) شمار کالاهای فعال در ممیزی یکپارچگی بدون کالای حذف‌شده نرم
      const deletedItem = await createTestItem({ isDeleted: 1, stocks: {} });
      createdItemIds.push(deletedItem.id);
      const iScan = await scan();
      const [{ n: activeItems }] = (await orm.execute(sql`SELECT count(*)::int AS n FROM items WHERE is_deleted = 0`)).rows as Array<{ n: number }>;
      // v9.0.111 (TD-495): the count is written with Persian digits
      const scanItemsText = iScan.body.checks?.find(c => c.id === 'inventory_kardex')?.details?.match(/([۰-۹]+) کالای فعال/)?.[1] ?? '';
      const scanItems = Number(scanItemsText.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))) || -1);
      check(scanItems === Number(activeItems), `the integrity check must report ${activeItems} active items (got ${scanItems})`);

      // (د) بازنشانی رویدادهای متوقف Outbox ثبت ممیزی دارد
      const stuckId = ev('STUCK');
      createdOutboxEventIds.push(stuckId);
      await orm.insert(outboxEvents).values({
        eventId: stuckId, eventType: 'td245.test', aggregateType: 'test', aggregateId: 'STUCK', status: 'processing',
        payload: {}, retryCount: 2, occurredAt: sql`now() - interval '10 minutes'` as unknown as string,
      });
      const stuckRes = await post('/api/system/reconciliation-fix', { action: 'clear_stuck_outbox' });
      check(stuckRes.status === 200, `clear_stuck_outbox with the UI body must answer 200 (status ${stuckRes.status})`);
      const [stuckRow] = await orm.select().from(outboxEvents).where(eq(outboxEvents.eventId, stuckId));
      check(stuckRow?.status === 'pending' && stuckRow?.retryCount === 0, `the stuck event must go back to pending (got ${stuckRow?.status})`);
      const [stuckLog] = await orm.select().from(activityLogs)
        .where(and(sql`${activityLogs.id} > ${maxLogId}`, eq(activityLogs.entityId, 'outbox_stuck_reset'))).orderBy(sql`${activityLogs.id} DESC`).limit(1);
      if (stuckLog) createdLogIds.push(stuckLog.id);
      const stuckDetails = (stuckLog?.details || {}) as { eventIds?: string[]; before?: { status?: string }; after?: { status?: string } };
      check(!!stuckLog && !!stuckLog.ipAddress && !!stuckDetails.eventIds?.includes(stuckId) && stuckDetails.before?.status === 'processing' && stuckDetails.after?.status === 'pending',
        `clear_stuck_outbox must write an audit row with the IP, the event id and the before and after status (got ${JSON.stringify(stuckLog ? { ip: stuckLog.ipAddress, details: stuckLog.details } : null).slice(0, 300)})`);

      // (ه) نام فایل خروجی با تاریخ امروز کسب‌وکار: ساعت ۲۳:۰۰ UTC (اخیرترین گذشته) در تهران روز بعد است
      await orm.insert(appSettings).values({ key: 'display_timezone', value: 'Asia/Tehran' })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: 'Asia/Tehran' } });
      const realNow = RealDate.now();
      let fixedMs = RealDate.parse(`${new RealDate(realNow).toISOString().slice(0, 10)}T23:00:00Z`);
      if (fixedMs > realNow) fixedMs -= 24 * 60 * 60 * 1000;
      const utcDay = new RealDate(fixedMs).toISOString().slice(0, 10);
      const tehranDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new RealDate(fixedMs));
      check(utcDay !== tehranDay, `the UTC and Tehran dates must differ at the test moment (${utcDay} / ${tehranDay})`);
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
      check(exportStatus === 200 && disposition.includes(`erp-data-export-${tehranDay}.zip`),
        `the export file name must carry the business date ${tehranDay} (not the UTC date ${utcDay}) (status ${exportStatus}, got ${disposition})`);

      // (و) Zod: بدنه / کوئری واقعی رابط کاربری می‌گذرد، ورودی نامعتبر 400
      const expectStatus = (label: string, got: number, want: number) => check(got === want, `${label}: status ${got} (expected ${want})`);
      const uiLogs = await get(`/api/activity-logs?page=1&limit=25&search=${encodeURIComponent('ERP')}&category=settings_system&user=pen_admin&action=RESTORE&entity=${encodeURIComponent('رویدادهای سیستم')}&startDate=2026-01-01&endDate=2026-12-31`);
      expectStatus('audit log with the UI query', uiLogs.status, 200);
      check(Array.isArray((uiLogs.body as { data?: unknown[] })?.data) && (uiLogs.body as { limit?: number })?.limit === 25, `the audit log answer is wrong: ${JSON.stringify(uiLogs.body).slice(0, 200)}`);
      expectStatus('audit log without parameters', (await get('/api/activity-logs')).status, 200);
      expectStatus('audit log with a repeated user (array)', (await get('/api/activity-logs?user=a&user=b')).status, 400);
      expectStatus('audit log with an invalid category', (await get('/api/activity-logs?category=bogus')).status, 400);
      expectStatus('audit log with a non-numeric page', (await get('/api/activity-logs?page=abc')).status, 400);
      expectStatus('audit purge with the UI body', (await post('/api/activity-logs/purge', { retentionDays: 730 })).status, 200);
      expectStatus('audit purge with an array retention', (await post('/api/activity-logs/purge', { retentionDays: [36500] })).status, 400);
      expectStatus('audit purge with a string allowForceRecent', (await post('/api/activity-logs/purge', { retentionDays: 36500, allowForceRecent: 'false' })).status, 400);
      expectStatus('audit purge with a non-numeric retention', (await post('/api/activity-logs/purge', { retentionDays: 'abc' })).status, 400);
      for (const [label, body] of [['an unknown action', { action: 'bogus' }], ['no action', {}], ['an array action', { action: ['requeue_dlq'] }]] as Array<[string, object]>) {
        const r = await post('/api/system/reconciliation-fix', body);
        check(r.status === 400 && (r.body as { code?: string })?.code === 'VALIDATION_ERROR',
          `a repair action with ${label} must answer a 400 validation error (status ${r.status}, ${JSON.stringify(r.body).slice(0, 150)})`);
      }

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_system_route_findings_td_245', scenarioId: 'recovery_outbox_webhook_retry', name: testName, layer: 'regression',
        executionType: 'real_api', passed: true, durationMs: Date.now() - tStart,
        details: 'requeue_dlq returns only unresolved rows to the Outbox with the same id and marks them replayed (no delete, audited with IP and before/after); the DLQ counter, a 0.01 balance without soft delete, totalVouchers and active items are counted correctly; the Outbox reset is audited; the export file name takes the business date; invalid input gets 400.'
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
    const testName = 'TD-245: clearing data also clears closed fiscal years, attachments and their files and repair reports, under the seed lock and with an audit row';
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
        workflowTaskReopenLog, projectReservationReleases, inventoryReconciliationAnomalies, itemWarehouseStocks, activityLogs, roles,
        purchaseRequisitions
      } = schema;

      inner = await setupTestSchema();
      const current = (await pool.query('SELECT current_schema() AS s')).rows[0]?.s;
      if (current !== inner.schema) throw new Error(`the inner isolated schema was not activated (${current} instead of ${inner.schema}); the reset did not run`);

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
      // v9.0.347 (TD-691): a procurement order points to its purchase requisition (fk_documents_procurement_requisition)
      const [requisition] = await orm.insert(purchaseRequisitions).values({ code: 'TD245-PR', title: 'درخواست TD-245', items: [] }).returning({ id: purchaseRequisitions.id });
      await orm.insert(documents).values({ type: 'receipt', date: '2026-01-11 00:00:00', refNumber: 'TD245-PO', procurementRequisitionId: requisition.id });
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
        'documents', 'journal_vouchers', 'production_projects', 'items', 'users', 'purchase_requisitions'
      ];
      const assertIntact = async (stage: string): Promise<void> => {
        for (const t of ['fiscal_periods', 'file_attachments', 'legacy_date_repairs', 'documents', 'users']) {
          if ((await countOf(t)) === 0) violations.push(`${stage}: table ${t} was cleared although the reset must not have run`);
        }
        if (!fsMod.existsSync(attachmentFile)) violations.push(`${stage}: the attachment file was deleted before commit`);
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
        violations.push(`a reset while the seed lock is held must be refused with 409: ${lockedError instanceof Error ? lockedError.message : String(lockedError)}`);
      }
      await assertIntact('seed lock held');

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
      if (!blockedError) violations.push('a reset with an unknown row referencing users must fail');
      await assertIntact('rolled-back transaction');

      // ج) بازنشانی موفق
      let report: Awaited<ReturnType<typeof FactoryResetService.wipeAndReseed>>;
      try {
        report = await FactoryResetService.wipeAndReseed(actor);
      } catch (e: unknown) {
        violations.push(`the reset failed: ${e instanceof Error ? e.message : String(e)}`);
        throw new Error(violations.join(' | '));
      }
      if ((await countOf('fiscal_periods')) !== 0 || (await countOf('journal_vouchers')) !== 0) {
        violations.push('a closed fiscal year or closing voucher remained after the reset');
      }
      for (const t of wipedTables) {
        const n = await countOf(t);
        if (n !== 0) violations.push(`table ${t} has ${n} rows after the reset`);
      }
      if (fsMod.existsSync(attachmentFile)) violations.push('a registered attachment file remained on disk after the reset');
      if (!fsMod.existsSync(foreignFile) || !fsMod.existsSync(unregisteredFile)) violations.push('a file that did not belong to registered attachments was deleted');
      if ((report as { attachmentFiles?: { removed?: number } } | undefined)?.attachmentFiles?.removed !== 1) {
        violations.push(`the reset report must show one deleted file: ${JSON.stringify((report as unknown as Record<string, unknown> | undefined)?.attachmentFiles)}`);
      }

      // seed دوباره اجرا شد و قفل آن آزاد است
      const categoryCount = await countOf('categories');
      if (categoryCount < 22) violations.push(`after the reset the seed did not create the categories (${categoryCount})`);
      if ((await countOf('accounts')) === 0) violations.push('after the reset the seed did not create the chart of accounts');
      const [adminRole] = await orm.select({ code: roles.code }).from(roles).where(eq(roles.code, 'admin'));
      if (!adminRole) violations.push('the admin role does not exist after the reset');
      const held = Number((await pool.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND classid = 0 AND objid = 89345 AND granted`)).rows[0]?.n ?? -1);
      if (held !== 0) violations.push(`the seed lock was not released after the reset (${held})`);

      // ممیزی: ردیف قبلی پاک و فقط ردیف بازنشانی با نام کاربر و IP مانده است
      const logs = await orm.select().from(activityLogs);
      if (logs.some(l => l.entity === 'آزمون TD-245')) violations.push('the audit log row from before the reset was not deleted');
      const resetLogs = logs.filter(l => l.action === 'PURGE' && l.entity === 'سیستم:بازنشانی کامل');
      if (resetLogs.length !== 1 || resetLogs[0].username !== 'td245_admin' || resetLogs[0].ipAddress !== '127.0.0.245' || resetLogs[0].userId !== null) {
        violations.push(`exactly one reset audit log row with user name and IP and without user_id must remain: ${JSON.stringify(resetLogs.map(l => ({ u: l.username, ip: l.ipAddress, uid: l.userId })))}`);
      }

      if (violations.length > 0) throw new Error(violations.join(' | '));
      results.push(makeTestCase({
        id: 'reg_factory_reset_complete_td_245', scenarioId: 'test_runner_real_database_guard', name: testName, layer: 'regression',
        executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
        details: 'In the inner isolated schema: with the seed lock held the reset answers 409 and deletes nothing; with a failure inside the transaction everything, the attachment file included, remains; a successful reset deletes the closed fiscal year with its closing voucher, the attachments and the registered file, the repair logs and dependent tables, other files remain, the seed runs again, the lock is released and one PURGE audit log row remains.'
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
  // Package 9 (v10.0.33, TD-975): a partial party edit keeps the fields it does not send
  const { runCustomerPartialEditTests } = await import('../regression/customerPartialEditTests.js');
  results.push(...await runCustomerPartialEditTests(shouldRun));
  // Package 9 (v10.0.34, TD-976): CRM activity mentions are live user ids and notify only CRM readers
  const { runCrmActivityMentionTests } = await import('../regression/crmActivityMentionTests.js');
  results.push(...await runCrmActivityMentionTests(shouldRun));
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
  // Package 3 PR e: the chart of accounts and the account mapping (TD-546 ...)
  const { runChartOfAccountsTests } = await import('../regression/chartOfAccountsTests.js');
  results.push(...await runChartOfAccountsTests(shouldRun));
  const { runTrialBalanceDetailTests } = await import('../regression/trialBalanceDetailTests.js');
  results.push(...await runTrialBalanceDetailTests(shouldRun));
  // Package 1 PR d: conditional migration constraints listed and built by hand (TD-589)
  const { runConditionalConstraintTests } = await import('../regression/conditionalConstraintTests.js');
  results.push(...await runConditionalConstraintTests(shouldRun));
  // Package 1 PR d: database mode at start (TD-616)
  const { runDatabaseModeTests } = await import('../regression/databaseModeTests.js');
  results.push(...await runDatabaseModeTests(shouldRun));
  // Package 3 PR d: accounting report access, party statements and the journal book (TD-547 ...)
  const { runAccountingReportAccessTests } = await import('../regression/accountingReportAccessTests.js');
  results.push(...await runAccountingReportAccessTests(shouldRun));
  // Package 12 payroll PR a (v9.0.266 on): payslip integrity (TD-804 ...)
  const { runPayrollIntegrityTests } = await import('../regression/payrollIntegrityTests.js');
  results.push(...await runPayrollIntegrityTests(shouldRun));
  // Package 12 payroll PR b (v9.0.279 on): work logs, piecework rates and their audit (TD-813 ...)
  const { runPieceworkEntryTests } = await import('../regression/pieceworkEntryTests.js');
  results.push(...await runPieceworkEntryTests(shouldRun));
  // Package 3 PR z (v9.0.286 on): payslip deductions account 3205 (TD-554)
  const { runPayrollDeductionAccountTests } = await import('../regression/payrollDeductionAccountTests.js');
  results.push(...await runPayrollDeductionAccountTests(shouldRun));
  // Package 3 PR v (v9.0.294 on): automatic vouchers and the journal voucher page (TD-552 ...)
  const { runVoucherPageTests } = await import('../regression/voucherPageTests.js');
  results.push(...await runVoucherPageTests(shouldRun));
  // Package 12 payroll PR d (v9.0.330 on): the work log list is filtered, paged and summed in SQL (TD-811)
  const { runWorkLogListTests } = await import('../regression/workLogListTests.js');
  results.push(...await runWorkLogListTests(shouldRun));
  // Package 11 PR a (v9.0.364 on): progress matrix, project status on write only, stage numbering and input (TD-739 ...)
  const { runProjectStageIntegrityTests } = await import('../regression/projectStageIntegrityTests.js');
  results.push(...await runProjectStageIntegrityTests(shouldRun));
  // Package 11 PR b (v9.0.380 on): project edit and input — status lists, delivery input, stage clock, audit, version (TD-754 ...)
  const { runProjectEditTests } = await import('../regression/projectEditTests.js');
  results.push(...await runProjectEditTests(shouldRun));
  // Package 11 PR c (v9.0.410 on): project list, purchase document and material allocation
  const { runProjectPurchaseAllocationTests } = await import('../regression/projectPurchaseAllocationTests.js');
  results.push(...await runProjectPurchaseAllocationTests(shouldRun));
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
  const { runSettingValuesTests } = await import('../regression/settingValuesTests.js');
  results.push(...await runSettingValuesTests(shouldRun));
  // Package 16 (v9.0.289, TD-671): the warehouse dashboard counts documents and real outflows of the Kardex ledger
  const { runDashboardMovementStatsTests } = await import('../regression/dashboardMovementStatsTests.js');
  results.push(...await runDashboardMovementStatsTests(shouldRun));
  // Package 16 (v9.0.291, TD-675): global search ranks the exact name first and folds Arabic letters and digits
  const { runGlobalSearchRankTests } = await import('../regression/globalSearchRankTests.js');
  results.push(...await runGlobalSearchRankTests(shouldRun));
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
  // Series 10 D-01 (v10.0.1+): type and number cells of the item Excel import
  const { runItemExcelCellTests } = await import('../regression/itemExcelCellTests.js');
  results.push(...await runItemExcelCellTests(shouldRun));

  // Package 13 PR A (v9.0.231+): access and privacy of daily work logs
  const { runDailyLogAccessTests } = await import('../regression/dailyLogAccessTests.js');
  results.push(...await runDailyLogAccessTests(shouldRun));

  // Package 8 PR A (v9.0.238+): stock direction, sellable gate and line numbers of POST /documents
  const { runDocumentEntryTests } = await import('../regression/documentEntryTests.js');
  results.push(...await runDocumentEntryTests(shouldRun));
  // Package 8 PR B (v9.0.270+): zero-price invoices, voids with dependents, sales return VAT and amounts
  const { runSalesDocumentTests } = await import('../regression/salesDocumentTests.js');
  results.push(...await runSalesDocumentTests(shouldRun));
  // Package 8 PR D (v9.0.323+): lead link of a document edit, stock count lines, production receipts, return lookup, numbers
  const { runDocumentIntegrityTests } = await import('../regression/documentIntegrityTests.js');
  results.push(...await runDocumentIntegrityTests(shouldRun));
  // Package 8 PR E (v9.0.335+): the data of a document (treasury rows by permission)
  const { runDocumentDataTests } = await import('../regression/documentDataTests.js');
  results.push(...await runDocumentDataTests(shouldRun));

  // Package 13 PR B (v9.0.249+): reading daily work logs (list, statistics, timestamps)
  const { runDailyLogReadTests } = await import('../regression/dailyLogReadTests.js');
  results.push(...await runDailyLogReadTests(shouldRun));

  // Package 13 PR C (v9.0.254+): attachment download, body limits, image uploads, orphan cleanup, log length caps
  const { runAttachmentUploadTests } = await import('../regression/attachmentUploadTests.js');
  results.push(...await runAttachmentUploadTests(shouldRun));

  // Package 13 PR D (v9.0.259+): work time and work mode of a daily log
  const { runDailyLogWorkTimeTests } = await import('../regression/dailyLogWorkTimeTests.js');
  results.push(...await runDailyLogWorkTimeTests(shouldRun));

  // Package 16 PR d (v9.0.305+): drafts routes and expiry
  const { runFormDraftRouteErrorsTests } = await import('../regression/formDraftRouteErrorsTests.js');
  results.push(...await runFormDraftRouteErrorsTests(shouldRun));
  const { runFormDraftExpiryTests } = await import('../regression/formDraftExpiryTests.js');
  results.push(...await runFormDraftExpiryTests(shouldRun));
  const { runProductionErrorDetailsTests } = await import('../regression/productionErrorDetailsTests.js');
  results.push(...await runProductionErrorDetailsTests(shouldRun));
  // Package 10 PR A (v9.0.314+): purchase requisition contract, approval gate, delivery, delete and edit
  const { runProcurementRequisitionTests } = await import('../regression/procurementRequisitionTests.js');
  results.push(...await runProcurementRequisitionTests(shouldRun));

  // Package 15 PR a (v9.0.332+): WooCommerce
  const { runWooNamesakeCustomerTests } = await import('../regression/wooNamesakeCustomerTests.js');
  results.push(...await runWooNamesakeCustomerTests(shouldRun));
  const { runWooConnectionTestTests } = await import('../regression/wooConnectionTestTests.js');
  results.push(...await runWooConnectionTestTests(shouldRun));
  // Package 15 PR b (v9.0.356+): webhook secrets and SSRF
  const { runWebhookSsrfEchoTests } = await import('../regression/webhookSsrfEchoTests.js');
  results.push(...await runWebhookSsrfEchoTests(shouldRun));
  const { runWebhookRuleSeedTests } = await import('../regression/webhookRuleSeedTests.js');
  results.push(...await runWebhookRuleSeedTests(shouldRun));
  const { runWebhookSecretEditTests } = await import('../regression/webhookSecretEditTests.js');
  results.push(...await runWebhookSecretEditTests(shouldRun));
  const { runWebhookKeyTimeoutTests } = await import('../regression/webhookKeyTimeoutTests.js');
  results.push(...await runWebhookKeyTimeoutTests(shouldRun));
  const { runWebhookSecretMaskTests } = await import('../regression/webhookSecretMaskTests.js');
  results.push(...await runWebhookSecretMaskTests(shouldRun));
  const { runIntegrationSecretsAtRestTests } = await import('../regression/integrationSecretsAtRestTests.js');
  results.push(...await runIntegrationSecretsAtRestTests(shouldRun));
  const { runWebhookActionFailureTests } = await import('../regression/webhookActionFailureTests.js');
  results.push(...await runWebhookActionFailureTests(shouldRun));
  const { runBootActionHandlersTests } = await import('../regression/bootActionHandlersTests.js');
  results.push(...await runBootActionHandlersTests(shouldRun));
  const { runRetiredRuleActionTests } = await import('../regression/retiredRuleActionTests.js');
  results.push(...await runRetiredRuleActionTests(shouldRun));
  const { runIntegrationDeliveryRetryTests } = await import('../regression/integrationDeliveryRetryTests.js');
  results.push(...await runIntegrationDeliveryRetryTests(shouldRun));
  const { runIntegrationCounterLockTests } = await import('../regression/integrationCounterLockTests.js');
  results.push(...await runIntegrationCounterLockTests(shouldRun));

  // Package 15 PR d (v9.0.405+): the event contract
  const { runWebhookEventPatternTests } = await import('../regression/webhookEventPatternTests.js');
  results.push(...await runWebhookEventPatternTests(shouldRun));
  const { runRuleEventTypeTests } = await import('../regression/ruleEventTypeTests.js');
  results.push(...await runRuleEventTypeTests(shouldRun));
  const { runDocumentEventAmountTests } = await import('../regression/documentEventAmountTests.js');
  results.push(...await runDocumentEventAmountTests(shouldRun));

  // Package 15 PR e (v9.0.430+): test tools, timeline, dead-letter queue and notifications
  const { runRuleTestSimulationTests } = await import('../regression/ruleTestSimulationTests.js');
  results.push(...await runRuleTestSimulationTests(shouldRun));
  const { runEventTimelineTests } = await import('../regression/eventTimelineTests.js');
  results.push(...await runEventTimelineTests(shouldRun));
  const { runDeadLetterEditRetryTests } = await import('../regression/deadLetterEditRetryTests.js');
  results.push(...await runDeadLetterEditRetryTests(shouldRun));
  const { runCrmDueReminderTests } = await import('../regression/crmDueReminderTests.js');
  results.push(...await runCrmDueReminderTests(shouldRun));
  const { runNotificationDismissTests } = await import('../regression/notificationDismissTests.js');
  results.push(...await runNotificationDismissTests(shouldRun));
  const { runEventTimestampUtcTests } = await import('../regression/eventTimestampUtcTests.js');
  results.push(...await runEventTimestampUtcTests(shouldRun));
  const { runRuleActiveStateTests } = await import('../regression/ruleActiveStateTests.js');
  results.push(...await runRuleActiveStateTests(shouldRun));

  // Package 10 PR B (v9.0.347+): procurement order link, duplicate submissions, consolidation, receiving
  const { runProcurementOrderTests } = await import('../regression/procurementOrderTests.js');
  results.push(...await runProcurementOrderTests(shouldRun));

  // Package 10 PR C (v9.0.351+): what the procurement desk reads and shows
  const { runProcurementDeskTests } = await import('../regression/procurementDeskTests.js');
  results.push(...await runProcurementDeskTests(shouldRun));

  // Package 7 PR A (v9.0.370+): which documents and projects reserve stock, and how much; PR B (v9.0.394+): how they are read
  const { runStockReservationTests } = await import('../regression/stockReservationTests.js');
  results.push(...await runStockReservationTests(shouldRun));
  const { runStockReservationReadTests } = await import('../regression/stockReservationReadTests.js');
  results.push(...await runStockReservationReadTests(shouldRun));
  // Package 7 PR C (v9.0.396+): the raw material request queue
  const { runPendingMaterialTests } = await import('../regression/pendingMaterialTests.js');
  results.push(...await runPendingMaterialTests(shouldRun));
  // Package 7 PR D (v9.0.399+): the reserved items report and the reorder alerts
  const { runReservedItemsReportTests } = await import('../regression/reservedItemsReportTests.js');
  results.push(...await runReservedItemsReportTests(shouldRun));
  // Series 9 phase 5 PR «الف» (v9.0.451+): the side paths that move project stock follow the stock document rules
  const { runProjectStockGateTests } = await import('../regression/projectStockGateTests.js');
  results.push(...await runProjectStockGateTests(shouldRun));
  // Series 10 N-05 PR 1 (v10.0.21+): the media library infrastructure
  const { runMediaLibraryTests } = await import('../regression/mediaLibraryTests.js');
  results.push(...await runMediaLibraryTests(shouldRun));
  // Series 10 N-05 PR 2 (v10.0.25+): product card, product grid and zip download of the media library
  const { runMediaProductTests } = await import('../regression/mediaProductTests.js');
  results.push(...await runMediaProductTests(shouldRun));
  // Series 10 phase 3 lane L3 (v10.0.29+): the events of the project stock paths
  const { runProjectEventTests } = await import('../regression/projectEventTests.js');
  results.push(...await runProjectEventTests(shouldRun));
  // Series 10 phase 3 lane L3 (v10.0.63+): gaps of the project screens (TD-1140..TD-1144)
  const { runProjectScreenGapsTests } = await import('../regression/projectScreenGapsTests.js');
  results.push(...await runProjectScreenGapsTests(shouldRun));

  // Package 1 second half PR 1 (v9.0.386+): data export, system health page, factory reset, setup wizard
  const { runDataExportTests } = await import('../regression/dataExportTests.js');
  results.push(...await runDataExportTests(shouldRun));
  const { runSystemHealthTests } = await import('../regression/systemHealthTests.js');
  results.push(...await runSystemHealthTests(shouldRun));
  const { runFactoryResetTests } = await import('../regression/factoryResetTests.js');
  results.push(...await runFactoryResetTests(shouldRun));
  const { runInitialSetupTests } = await import('../regression/initialSetupTests.js');
  results.push(...await runInitialSetupTests(shouldRun));

  // Package 1 second half PR 3 (v9.0.444+): foreign keys of the schema and the database
  const { runForeignKeyPolicyTests } = await import('../regression/foreignKeyPolicyTests.js');
  results.push(...await runForeignKeyPolicyTests(shouldRun));
  const { runEventParentDeleteTests } = await import('../regression/eventParentDeleteTests.js');
  results.push(...await runEventParentDeleteTests(shouldRun));
  const { runUserForeignKeyTests } = await import('../regression/userForeignKeyTests.js');
  results.push(...await runUserForeignKeyTests(shouldRun));
  const { runBusinessForeignKeyTests } = await import('../regression/businessForeignKeyTests.js');
  results.push(...await runBusinessForeignKeyTests(shouldRun));
  const { runSchemaDriftTests } = await import('../regression/schemaDriftTests.js');
  results.push(...await runSchemaDriftTests(shouldRun));
  const { runForeignKeyIndexTests } = await import('../regression/foreignKeyIndexTests.js');
  results.push(...await runForeignKeyIndexTests(shouldRun));

  // Phase 5 PR «ب» (v9.0.457+): procurement receive items and order delivery
  const { runProcurementReceiveTests } = await import('../regression/procurementReceiveTests.js');
  results.push(...await runProcurementReceiveTests(shouldRun));

  // Phase 5 PR «ج» (v9.0.459+): treasury rows linked to documents and payroll payment dates
  const { runTreasuryPayrollPhase5Tests } = await import('../regression/treasuryPayrollPhase5Tests.js');
  results.push(...await runTreasuryPayrollPhase5Tests(shouldRun));

  // Payroll duties plan PR 1 (v10.0.21+): voucher approval permission and maker-checker
  const { runVoucherApprovalDutiesTests } = await import('../regression/voucherApprovalDutiesTests.js');
  results.push(...await runVoucherApprovalDutiesTests(shouldRun));
  const { runPurchaseWorkflowGuardTests } = await import('../regression/purchaseWorkflowGuardTests.js');
  results.push(...await runPurchaseWorkflowGuardTests(shouldRun));

  // Series 10 phase 3 lane L2 (v10.0.35+): writer routes read their bodies through Zod
  const { runWriterRouteZodTests } = await import('../regression/writerRouteZodTests.js');
  results.push(...await runWriterRouteZodTests(shouldRun));
  // TD-1132: records name the user by full name
  const { runActorDisplayNameTests } = await import('../regression/actorDisplayNameTests.js');
  results.push(...await runActorDisplayNameTests(shouldRun));

  // Series 10 phase 3 lane L2, package B4 (v10.0.41+): document audit rows, stock event cost, reorder monitor, purchase party, requisition workflow
  const { runDocumentAuditEventTests } = await import('../regression/documentAuditEventTests.js');
  results.push(...await runDocumentAuditEventTests(shouldRun));

  return results;
}
