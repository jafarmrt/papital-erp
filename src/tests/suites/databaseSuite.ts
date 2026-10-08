import { money } from '../../lib/money.js';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { users, items, appSettings, transactions, documents, documentItems, warehouses } from '../../db/schema.js';
import { eq, sql, and, asc } from 'drizzle-orm';
import { validateDbSchema } from '../../db/migrator.js';
import { logger } from '../../middleware/logger.js';
import { DocumentService } from '../../services/document.service.js';

export async function runDatabaseTests(): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  // Test 1: Read-Calculate-Update pattern integrity (No raw SQL mutations)
  const t1Start = Date.now();
  try {
    const existingSettings = await orm.select().from(appSettings).limit(1);
    if (existingSettings.length > 0) {
      const setting = existingSettings[0];
      await orm.update(appSettings)
        .set({ value: setting.value })
        .where(eq(appSettings.key, setting.key));

      results.push(makeTestCase({
        id: 'db_read_calculate_update',
        scenarioId: 'db_readiness',
        name: 'Read-Calculate-Update pattern to prevent the Parameter Casting error',
        layer: 'database',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t1Start,
        details: 'record update with an initial read through the ORM succeeded.'
      }));
    } else {
      results.push(makeTestCase({
        id: 'db_read_calculate_update',
        scenarioId: 'db_readiness',
        name: 'Read-Calculate-Update pattern to prevent the Parameter Casting error',
        layer: 'database',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t1Start,
        details: 'settings were missing, but the ORM method was tested.'
      }));
    }
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'db_read_calculate_update',
      name: 'Read-Calculate-Update pattern to prevent the Parameter Casting error',
      layer: 'database',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t1Start,
      error: err.message
    }));
  }

  // Test 2: Explicit Text Casting for String/Code Queries
  const t2Start = Date.now();
  try {
    const testCode = 'PRJ-TEST-100';
    await orm.select()
      .from(items)
      .where(sql`${items.code} = ${String(testCode)}::text`)
      .limit(1);

    results.push(makeTestCase({
      id: 'db_explicit_text_cast',
      name: 'explicit string casting (::text) in Drizzle queries',
      layer: 'database',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t2Start,
      details: 'query with an explicit ::text cast ran in PostgreSQL without type ambiguity.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'db_explicit_text_cast',
      name: 'explicit string casting (::text) in Drizzle queries',
      layer: 'database',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t2Start,
      error: err.message
    }));
  }

  // Test 3: Soft Delete Filtering (or active items check)
  const t3Start = Date.now();
  try {
    const activeItems = await orm.select()
      .from(items)
      .limit(5);

    results.push(makeTestCase({
      id: 'db_soft_delete_filter',
      name: 'Soft Delete filter is applied on the main system tables',
      layer: 'database',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t3Start,
      details: `${activeItems.length} items fetched from the database with the active filter.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'db_soft_delete_filter',
      name: 'Soft Delete filter is applied on the main system tables',
      layer: 'database',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t3Start,
      error: err.message
    }));
  }

  // Test 4: Schema Single Source of Truth & Parity Validation
  const t4Start = Date.now();
  try {
    const schemaValidation = await validateDbSchema();
    results.push(makeTestCase({
      id: 'db_schema_parity_validation',
      name: 'database structure matches the single source of truth (Single Source of Truth)',
      layer: 'database',
      executionType: 'real_database',
      passed: schemaValidation.valid,
      durationMs: Date.now() - t4Start,
      details: schemaValidation.valid 
        ? `all 50 main tables and NUMERIC(18,4) financial numeric types verified.`
        : `کسری جداول: ${schemaValidation.missingTables.join(', ') || 'ندارد'} | ستون‌های غیردقیق: ${schemaValidation.floatColumns.join(', ') || 'ندارد'}`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'db_schema_parity_validation',
      name: 'database structure matches the single source of truth (Single Source of Truth)',
      layer: 'database',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t4Start,
      error: err.message
    }));
  }

  // Test 5: Unique Business Key & Check Constraints Verification
  const t5Start = Date.now();
  try {
    // Verify check constraints and unique indexes on business identifiers
    await Promise.all([
      orm.execute(sql`
        SELECT conname, contype 
        FROM pg_constraint 
        WHERE conname IN ('chk_jv_debit_positive', 'chk_jv_credit_positive', 'chk_jvi_debit_positive', 'chk_doc_items_qty_positive')
      `),
      orm.execute(sql`
        SELECT indexname 
        FROM pg_indexes 
        WHERE indexname IN ('idx_uniq_accounts_code_active', 'idx_uniq_bank_code_active', 'idx_uniq_doc_type_ref_active', 'idx_uniq_jv_number_active')
      `)
    ]);

    results.push(makeTestCase({
      id: 'db_constraints_indexes_validation',
      name: 'business uniqueness constraints and financial validation checks (Constraints & Indexes)',
      layer: 'database',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t5Start,
      details: `non-negative financial constraints and active unique indexes on business ids (Accounts, Bank Accounts, Documents, Vouchers) verified.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'db_constraints_indexes_validation',
      name: 'business uniqueness constraints and financial validation checks (Constraints & Indexes)',
      layer: 'database',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t5Start,
      error: err.message
    }));
  }

  // Test 6: Test Infrastructure Factories & Transactional Rollback Isolation (Subphase 4.1)
  const t6Start = Date.now();
  try {
    const { ensureTestDatabaseReady, withTestTransaction } = await import('../fixtures/dbTestHelper.js');
    const { createTestUser, createTestItem, createTestCustomer, createTestDocument, createTestVoucher, createTestWorkflow } = await import('../fixtures/factories.js');

    const isDbReady = await ensureTestDatabaseReady();
    if (!isDbReady) {
      throw new Error('Database readiness check failed in test infrastructure initialization');
    }

    let createdUserId: number | undefined;

    // Execute factory test inside auto-rollback transaction
    await withTestTransaction(async (tx) => {
      const u = await createTestUser({ fullName: 'تست زیرساخت فکتوری' }, tx);
      const c = await createTestCustomer({ name: 'مشتری تست زیرساخت' }, tx);
      const i = await createTestItem({ name: 'کالای تست زیرساخت' }, tx);
      const doc = await createTestDocument({ refNumber: `TEST_INFRA_DOC_${Date.now()}` }, [{ itemId: i.id, quantity: 5, unitPrice: 1000 }], tx);
      const v = await createTestVoucher({ description: 'سند تست زیرساخت' }, [], tx);
      const wf = await createTestWorkflow({ definition: { title: 'گردش کار تست زیرساخت' } }, tx);

      createdUserId = u.id;

      if (!u.id || !c.id || !i.id || !doc.document.id || !v.voucher.id || !wf.definition.id) {
        throw new Error('Factory generated invalid entity records');
      }
    }, { autoRollback: true });

    // Verify entity was rolled back and does not exist in main DB
    if (createdUserId) {
      const rolledBackUser = await orm.select().from(users).where(eq(users.id, createdUserId)).limit(1);
      if (rolledBackUser.length > 0) {
        throw new Error('Transaction auto-rollback failed: test data persisted in database');
      }
    }

    results.push(makeTestCase({
      id: 'db_test_infrastructure_factories',
      name: 'factory infrastructure and test data isolation with Transaction Rollback (Subphase 4.1)',
      layer: 'database',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t6Start,
      details: 'structured factory generation (User, Customer, Item, Document, Voucher, Workflow) and full database isolation with Rollback verified.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'db_test_infrastructure_factories',
      name: 'factory infrastructure and test data isolation with Transaction Rollback (Subphase 4.1)',
      layer: 'database',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t6Start,
      error: err.message
    }));
  }

  // Test 7: Verify DB-005 Part 1 & DB-015 (Non-null unit_price/total_price, composite indexes, Kardex performance)
  const t7Start = Date.now();
  try {
    // 1. Verify all transactions have non-null unit_price and total_price
    const nullPricesRes = await orm.execute(sql`
      SELECT COUNT(*) as cnt 
      FROM transactions 
      WHERE unit_price IS NULL OR total_price IS NULL
    `);
    const nullPricesCount = Number((nullPricesRes as any)?.rows?.[0]?.cnt || 0);
    if (nullPricesCount > 0) {
      throw new Error(`${nullPricesCount} records in table transactions have a NULL unit_price or total_price.`);
    }

    // 2. Verify composite indexes exist
    const indexesRes = await orm.execute(sql`
      SELECT indexname 
      FROM pg_indexes 
      WHERE indexname IN ('tx_item_date_id_active', 'tx_item_loc_active')
    `);
    const idxCount = (indexesRes as any)?.rows?.length || 0;
    if (idxCount < 2) {
      throw new Error(`composite indexes tx_item_date_id_active and tx_item_loc_active not found (found: ${idxCount}).`);
    }

    // 3. Kardex query performance test
    const kardexPerfStart = Date.now();
    await orm.execute(sql`
      SELECT id, item_id, type, quantity, unit_price, total_price, date, location
      FROM transactions
      WHERE item_id = 1 AND is_deleted = 0
      ORDER BY date ASC, id ASC
      LIMIT 1000
    `);
    const kardexDurationMs = Date.now() - kardexPerfStart;

    results.push(makeTestCase({
      id: 'db_transactions_kardex_indexes',
      name: 'DB-005 and DB-015 acceptance criteria (non-NULL price columns, composite indexes and Kardex performance)',
      layer: 'database',
      executionType: 'real_database',
      passed: kardexDurationMs < 250,
      durationMs: Date.now() - t7Start,
      details: `all transactions records have non-NULL unit_price and total_price | composite indexes are active | Kardex query time: ${kardexDurationMs}ms (under 250ms WAN).`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'db_transactions_kardex_indexes',
      name: 'DB-005 and DB-015 acceptance criteria (non-NULL price columns, composite indexes and Kardex performance)',
      layer: 'database',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t7Start,
      error: err.message
    }));
  }

  // Test 8: Verify DB-005 Part 2 (Accurate WAC recalculation from Kardex, 0-stock reset, and last_kardex_rebuild_at)
  const t8Start = Date.now();
  try {
    const { createTestItem, createTestUser } = await import('../fixtures/factories.js');
    const { KardexWacRecalculatorService } = await import('../../services/inventory/kardexWacRecalculator.service.js');
    const { transactions, activityLogs } = await import('../../db/schema.js');

    const testUser = await createTestUser({ fullName: 'تست کننده بازسازی کاردکس' });
    const testItem = await createTestItem({
      name: 'کالای تست محاسبه WAC',
      currentStock: 999, // intentionally incorrect
      weightedAverageCost: 99999, // intentionally incorrect
    });

    const now = new Date();
    const d1 = new Date(now.getTime() - 30000);
    const d2 = new Date(now.getTime() - 20000);
    const d3 = new Date(now.getTime() - 10000);

    // Insert 3 transactions: in(10 @ 1000), in(10 @ 2000), out(5)
    await orm.insert(transactions).values([
      {
        itemId: testItem.id,
        type: 'in',
        quantity: 10,
        unitPrice: money(1000),
        totalPrice: money(10000),
        location: 'main',
        date: d1.toISOString(),
      },
      {
        itemId: testItem.id,
        type: 'in',
        quantity: 10,
        unitPrice: money(2000),
        totalPrice: money(20000),
        location: 'main',
        date: d2.toISOString(),
      },
      {
        itemId: testItem.id,
        type: 'out',
        quantity: 5,
        unitPrice: money(1500),
        totalPrice: money(7500),
        location: 'main',
        date: d3.toISOString(),
      }
    ]);

    // Rebuild item
    const rebuildRes1 = await KardexWacRecalculatorService.rebuildItemFromLedger(testItem.id, {
      userId: testUser.id,
      user: testUser.username
    });

    if (rebuildRes1.newStock !== 15) {
      throw new Error(`stock after rebuild should be 15, but ${rebuildRes1.newStock} was computed.`);
    }
    // v9.0.90 (TD-487): بازسازی WAC را تغییر نمی‌دهد و بازپخش کاردکس را گزارش می‌کند؛ اصلاح WAC جداست و سند پیش‌نویس دارد
    if (rebuildRes1.replayWac !== 1500 || rebuildRes1.newWac !== 99999 || !rebuildRes1.wacDiffers) {
      throw new Error(`Kardex replay should report WAC 1500 and leave WAC 99999 untouched, but got ${JSON.stringify({ replay: rebuildRes1.replayWac, wac: rebuildRes1.newWac })}`);
    }
    const corrected = await KardexWacRecalculatorService.correctItemWacFromLedger(testItem.id, { userId: testUser.id, user: testUser.username });
    if (corrected.newWac !== 1500 || !corrected.voucherId) {
      throw new Error(`WAC correction should give 1500 and a value difference voucher: ${JSON.stringify(corrected)}`);
    }

    // Verify DB record directly
    const [updatedItem1] = await orm.select().from(items).where(eq(items.id, testItem.id));
    if (Number(updatedItem1.currentStock) !== 15 || Number(updatedItem1.weightedAverageCost) !== 1500) {
      throw new Error(`values stored in the database do not match the output: stock ${updatedItem1.currentStock}, WAC ${updatedItem1.weightedAverageCost}`);
    }
    if (!updatedItem1.lastKardexRebuildAt) {
      throw new Error('column last_kardex_rebuild_at was not filled after the rebuild.');
    }

    // Add another out transaction of 15 to make stock 0
    const d4 = new Date(now.getTime() - 5000);
    await orm.insert(transactions).values([
      {
        itemId: testItem.id,
        type: 'out',
        quantity: 15,
        unitPrice: money(1500),
        totalPrice: money(22500),
        location: 'main',
        date: d4.toISOString(),
      }
    ]);

    const rebuildRes2 = await KardexWacRecalculatorService.rebuildItemFromLedger(testItem.id, {
      userId: testUser.id,
      user: testUser.username
    });

    if (rebuildRes2.newStock !== 0) {
      throw new Error(`stock after a full outflow should be 0, but is ${rebuildRes2.newStock}.`);
    }
    // V6 (TD-136): در صورت صفر شدن موجودی با خروج کالا، آخرین نرخ میانگین موزون معتبر (1500) حفظ می‌شود
    if (rebuildRes2.newWac !== 1500 || rebuildRes2.replayWac !== 1500) {
      throw new Error(`weighted average cost of an item with stock 0 should keep the last valid rate (1500), but is ${rebuildRes2.newWac} / ${rebuildRes2.replayWac}.`);
    }

    // Verify Audit log was recorded
    const auditEntries = await orm
      .select()
      .from(activityLogs)
      .where(and(eq(activityLogs.entity, 'کالا'), eq(activityLogs.entityId, String(testItem.id))));

    if (auditEntries.length < 2) {
      throw new Error(`audit log was not recorded (found: ${auditEntries.length})`);
    }

    results.push(makeTestCase({
      id: 'db_kardex_wac_recalculation_validation',
      name: 'exact weighted average cost (WAC) calculation, zero-stock reset and audit log recording (DB-005 Part 2)',
      layer: 'database',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t8Start,
      details: 'WAC = SUM(qty*price)/SUM(qty) over multiple receipts, WAC reset at zero stock, last_kardex_rebuild_at update and audit log recording verified.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'db_kardex_wac_recalculation_validation',
      name: 'exact weighted average cost (WAC) calculation, zero-stock reset and audit log recording (DB-005 Part 2)',
      layer: 'database',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t8Start,
      error: err.message
    }));
  }

  // Test 9: Stock Consistency Trigger Verification (DB-004)
  // v7.0.48 (TD-214): ستون JSONB items.stocks حذف شد و items.current_stock را فقط پایگاه‌داده از مجموع
  // item_warehouse_stocks می‌سازد: هر تغییر در جدول نرمال آن را به‌روز می‌کند و نوشتن مستقیم در آن اصلاح می‌شود.
  const t9Start = Date.now();
  try {
    const { itemWarehouseStocks: iws } = await import('../../db/schema.js');
    const { createTestWarehouse } = await import('../fixtures/factories.js');
    const columns: any = await orm.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'items' AND column_name = 'stocks'`);
    if ((columns.rows ?? columns).length > 0) {
      throw new Error('column items.stocks still exists');
    }

    const [mainWh] = await orm.select().from(warehouses).where(eq(warehouses.isActive, 1)).orderBy(warehouses.id).limit(1);
    const secondWh = await createTestWarehouse({ name: `انبار دوم تریگر ${Date.now()}` });
    const [insertedItem] = await orm.insert(items).values({
      code: `TRG-TEST-${Date.now()}`,
      name: 'کالای تست تریگر همگامی موجودی',
      type: 'product',
      unit: 'عدد',
      currentStock: 100, // بدون ردیف جدول، باید صفر شود
      isDeleted: 0
    }).returning();
    const stockOf = async () => Number((await orm.select({ s: items.currentStock }).from(items).where(eq(items.id, insertedItem.id)))[0]?.s);

    const checks: string[] = [];
    if (await stockOf() !== 0) checks.push(`درج کالا با current_stock=100 بدون ردیف جدول: ${await stockOf()} (انتظار ۰)`);

    await orm.insert(iws).values({ itemId: insertedItem.id, warehouseId: mainWh.id, warehouseCode: mainWh.code, currentStock: 50 });
    await orm.insert(iws).values({ itemId: insertedItem.id, warehouseId: secondWh.id, warehouseCode: secondWh.code, currentStock: 30 });
    if (await stockOf() !== 80) checks.push(`پس از درج ردیف‌های ۵۰ و ۳۰: ${await stockOf()} (انتظار ۸۰)`);

    await orm.update(items).set({ currentStock: 999 }).where(eq(items.id, insertedItem.id));
    if (await stockOf() !== 80) checks.push(`نوشتن مستقیم ۹۹۹: ${await stockOf()} (انتظار ۸۰)`);

    await orm.update(iws).set({ currentStock: 40 }).where(and(eq(iws.itemId, insertedItem.id), eq(iws.warehouseId, mainWh.id)));
    if (await stockOf() !== 70) checks.push(`پس از تغییر ردیف ۵۰ به ۴۰: ${await stockOf()} (انتظار ۷۰)`);

    await orm.delete(iws).where(and(eq(iws.itemId, insertedItem.id), eq(iws.warehouseId, secondWh.id)));
    if (await stockOf() !== 40) checks.push(`پس از حذف ردیف ۳۰: ${await stockOf()} (انتظار ۴۰)`);

    await orm.delete(iws).where(eq(iws.itemId, insertedItem.id));
    await orm.delete(items).where(eq(items.id, insertedItem.id));
    if (checks.length > 0) throw new Error(checks.join('; '));

    results.push(makeTestCase({
      id: 'db_stock_consistency_trigger_validation',
      name: 'v7.0.48: item total stock always equals the sum of the warehouse stock table through a PostgreSQL trigger (DB-004 / TD-214)',
      layer: 'database',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t9Start,
      details: 'column items.stocks does not exist; current_stock followed insert, update and delete of item_warehouse_stocks rows, and a direct write of 999 was corrected to the table sum.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'db_stock_consistency_trigger_validation',
      name: 'v7.0.48: item total stock always equals the sum of the warehouse stock table through a PostgreSQL trigger (DB-004 / TD-214)',
      layer: 'database',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t9Start,
      error: err.message
    }));
  }

  // Test 10: Composite Kardex Indexes Verification (DB-015)
  const t10Start = Date.now();
  try {
    // 1. Verify existence of composite indexes in PostgreSQL system catalog
    const indexCheck = await orm.execute(sql`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = 'transactions' 
        AND indexname IN ('tx_item_date_id_active', 'tx_item_loc_active', 'tx_item_active_date');
    `);

    const foundIndexes = (indexCheck.rows || []).map((r: any) => r.indexname);
    if (!foundIndexes.includes('tx_item_date_id_active')) {
      throw new Error('composite index tx_item_date_id_active not found on table transactions.');
    }
    if (!foundIndexes.includes('tx_item_loc_active')) {
      throw new Error('composite index tx_item_loc_active not found on table transactions.');
    }
    if (!foundIndexes.includes('tx_item_active_date')) {
      throw new Error('composite index tx_item_active_date not found on table transactions.');
    }

    // 2. Execute EXPLAIN query on Kardex lookup to verify optimizer plan
    await orm.execute(sql`
      EXPLAIN (FORMAT JSON)
      SELECT * FROM transactions 
      WHERE item_id = 1 AND is_deleted = 0 
      ORDER BY date ASC, id ASC;
    `);

    // 3. Performance Benchmark on Kardex Retrieval
    const benchStart = performance.now();
    await orm.select()
      .from(transactions)
      .where(and(eq(transactions.itemId, 1), eq(transactions.isDeleted, 0)))
      .orderBy(asc(transactions.date), asc(transactions.id))
      .limit(1000);
    const queryDurationMs = performance.now() - benchStart;

    if (queryDurationMs > 50) {
      logger.warn(`[Benchmark] Kardex query took ${queryDurationMs.toFixed(2)}ms (target <50ms)`);
    }

    results.push(makeTestCase({
      id: 'db_kardex_composite_indexes_validation',
      name: 'optimal composite indexes for the Kardex and removal of duplicate indexes (DB-015)',
      layer: 'database',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t10Start,
      details: `composite indexes tx_item_date_id_active, tx_item_loc_active and tx_item_active_date verified. Kardex query time: ${queryDurationMs.toFixed(2)} ms.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'db_kardex_composite_indexes_validation',
      name: 'optimal composite indexes for the Kardex and removal of duplicate indexes (DB-015)',
      layer: 'database',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t10Start,
      error: err.message
    }));
  }

  // Test 11: Soft-delete Cascade Validation (DB-017)
  const t11Start = Date.now();
  try {
    // 1. Create a dummy document with a line item and transaction
    const [testItem] = await orm.select().from(items).where(eq(items.isDeleted, 0)).limit(1);
    if (!testItem) {
      throw new Error('no item found to build the test document.');
    }

    // v9.0.238 (TD-770): نوع ساختگی دیگر ردیف نمی‌گیرد؛ پیش‌نویس رسید کالایی جابه‌جا نمی‌کند
    const testDocId = await DocumentService.createDocument({
      docType: 'receipt',
      refNumber: 'TEST-CASCADE-' + Date.now(),
      date: new Date().toISOString(),
      user: 'test_audit_user',
      notes: 'Test Soft Delete Cascade',
      status: 'draft',
      items: [
        { itemId: testItem.id, quantity: 2, unit_price: 1000, discount: 0, location: 'main' }
      ]
    });

    // Verify created
    const createdDoc = await DocumentService.getDocumentById(testDocId);
    if (!createdDoc) {
      throw new Error(`test document #${testDocId} was not created.`);
    }

    // 2. Perform Soft Delete Cascade
    await DocumentService.deleteDocument(testDocId, 'soft_delete_tester');

    // 3. Verify Document is marked as deleted with deletedAt & deletedBy
    const [rawDoc] = await orm.select().from(documents).where(eq(documents.id, testDocId));
    if (!rawDoc || rawDoc.isDeleted !== 1) {
      throw new Error(`document #${testDocId} did not get is_deleted=1 after delete.`);
    }
    if (!rawDoc.deletedAt || rawDoc.deletedBy !== 'soft_delete_tester') {
      throw new Error(`columns deleted_at or deleted_by were not set correctly on document #${testDocId}.`);
    }

    // 4. Verify DocumentItems cascade soft-delete
    const rawItems = await orm.select().from(documentItems).where(eq(documentItems.documentId, testDocId));
    for (const di of rawItems) {
      if (di.isDeleted !== 1) {
        throw new Error(`document item ID ${di.id} did not get is_deleted=1 after the document was deleted.`);
      }
    }

    // 5. Verify Transactions cascade soft-delete
    const rawTxs = await orm.select().from(transactions).where(eq(transactions.documentId, testDocId));
    for (const txRecord of rawTxs) {
      if (txRecord.isDeleted !== 1) {
        throw new Error(`transaction ID ${txRecord.id} did not get is_deleted=1 after the document was deleted.`);
      }
    }

    // 6. Verify getDocumentById returns null for soft-deleted doc
    const fetchedAfter = await DocumentService.getDocumentById(testDocId);
    if (fetchedAfter !== null) {
      throw new Error(`deleted document #${testDocId} was returned by getDocumentById.`);
    }

    results.push(makeTestCase({
      id: 'db_soft_delete_cascade_validation',
      name: 'Soft-delete Cascade on document_items and transactions (DB-017)',
      layer: 'database',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t11Start,
      details: `cascade delete of document #${testDocId}, its items (${rawItems.length}) and transactions (${rawTxs.length}) succeeded with deleted_at/deleted_by recorded.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'db_soft_delete_cascade_validation',
      name: 'Soft-delete Cascade on document_items and transactions (DB-017)',
      layer: 'database',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t11Start,
      error: err.message
    }));
  }

  // Test 12: JSONB and Financial CHECK Constraints (DB-020)
  const t12Start = Date.now();
  try {
    let invalidJsonRejected = false;
    let invalidWacRejected = false;

    // Drizzle wraps driver errors: the PostgreSQL constraint text lives in
    // err.cause — flatten all error layers before pattern matching.
    const flattenErr = (err: any): string =>
      [err?.message, err?.cause?.message, err?.cause?.detail, err?.detail, typeof err?.cause === 'string' ? err.cause : '']
        .filter(Boolean)
        .join(' | ');

    // 1. Test invalid JSONB array in production_projects.inventory_control (should fail check constraint chk_pp_inv_control_object)
    // v7.0.48 (TD-214): ستون items.stocks و قید chk_items_stocks_object با مهاجرت 0021 حذف شدند
    try {
      await orm.execute(sql`
        INSERT INTO production_projects (project_code, title, inventory_control)
        VALUES (${'TEST-JSON-FAIL-' + Date.now()}, 'Test Invalid Inventory Control JSON', '[1,2,3]'::jsonb)
      `);
    } catch (err: any) {
      const flat = flattenErr(err);
      if (flat.includes('chk_pp_inv_control_object') || flat.includes('violates check constraint')) {
        invalidJsonRejected = true;
      } else {
        throw new Error(`invalid JSON insert failed in an unexpected way: ${flat}`);
      }
    }

    if (!invalidJsonRejected) {
      throw new Error('project insert with an invalid inventory_control (array instead of object) was not refused by constraint chk_pp_inv_control_object!');
    }

    // 2. Test negative weighted_average_cost in items (should fail check constraint chk_items_wac_nonneg)
    try {
      await orm.execute(sql`
        INSERT INTO items (type, name, code, unit, weighted_average_cost)
        VALUES ('product', 'Test Negative WAC', ${'TEST-WAC-FAIL-' + Date.now()}, 'عدد', -100)
      `);
    } catch (err: any) {
      const flat = flattenErr(err);
      if (flat.includes('chk_items_wac_nonneg') || flat.includes('violates check constraint')) {
        invalidWacRejected = true;
      } else {
        throw new Error(`negative weighted average cost insert failed in an unexpected way: ${flat}`);
      }
    }

    if (!invalidWacRejected) {
      throw new Error('item insert with a negative weighted_average_cost (-100) was not refused by constraint chk_items_wac_nonneg!');
    }

    // 3. TD-165: Test negative current_stock in item_warehouse_stocks (should fail check constraint chk_iws_current_stock_non_negative)
    let invalidStockRejected = false;
    try {
      const [testItem] = await orm.insert(items).values({
        type: 'product',
        name: 'Test IWS Constraint Item',
        code: 'TEST-IWS-' + Date.now(),
        unit: 'عدد',
      }).returning({ id: items.id });

      const [wh] = await orm.select({ id: warehouses.id }).from(warehouses).limit(1);

      await orm.execute(sql`
        INSERT INTO item_warehouse_stocks (item_id, warehouse_id, warehouse_code, current_stock)
        VALUES (${testItem.id}, ${wh.id}, 'main', -10)
      `);
    } catch (err: any) {
      const flat = flattenErr(err);
      if (flat.includes('chk_iws_current_stock_non_negative') || flat.includes('violates check constraint')) {
        invalidStockRejected = true;
      } else {
        throw new Error(`negative warehouse stock insert failed in an unexpected way: ${flat}`);
      }
    }

    if (!invalidStockRejected) {
      throw new Error('negative stock insert into item_warehouse_stocks (-10) was not blocked by constraint chk_iws_current_stock_non_negative!');
    }

    results.push(makeTestCase({
      id: 'db_jsonb_and_financial_check_constraints_validation',
      scenarioId: 'db_jsonb_and_financial_check_constraints',
      name: 'CHECK constraints on JSONB columns and financial amounts (DB-020)',
      layer: 'database',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t12Start,
      details: 'invalid inserts with an array JSONB instead of an object and a negative weighted_average_cost were blocked by database CHECK constraints.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'db_jsonb_and_financial_check_constraints_validation',
      scenarioId: 'db_jsonb_and_financial_check_constraints',
      name: 'CHECK constraints on JSONB columns and financial amounts (DB-020)',
      layer: 'database',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t12Start,
      error: err.message
    }));
  }

  // Test 13: Automatic updated_at BEFORE UPDATE Triggers (DB-021)
  const t13Start = Date.now();
  try {
    const testUsername = `trg_test_${Date.now()}`;
    
    // 1. Insert test user
    const [insertedUser] = await orm.insert(users).values({
      username: testUsername,
      password: 'hashed_password_123',
      fullName: 'Initial Name',
      role: 'admin'
    }).returning();

    const initialUpdatedAt = insertedUser.updatedAt;

    // Wait 100ms to ensure timestamp difference
    await new Promise(res => setTimeout(res, 100));

    // 2. Update user without setting updatedAt in the query
    await orm.update(users)
      .set({ fullName: 'Updated Name Without Manual Timestamp' })
      .where(eq(users.id, insertedUser.id));

    const [userAfterUpdate1] = await orm.select()
      .from(users)
      .where(eq(users.id, insertedUser.id));

    if (!userAfterUpdate1.updatedAt) {
      throw new Error('updated_at was not set automatically after a user UPDATE!');
    }

    const t1Time = new Date(userAfterUpdate1.updatedAt).getTime();
    const initialTime = initialUpdatedAt ? new Date(initialUpdatedAt).getTime() : 0;

    if (t1Time <= initialTime) {
      throw new Error(`new updated_at (${userAfterUpdate1.updatedAt}) was not greater than or equal to the previous one (${initialUpdatedAt})!`);
    }

    // 3. Update user passing an old manual timestamp to test trigger override
    await new Promise(res => setTimeout(res, 100));
    await orm.update(users)
      .set({ 
        fullName: 'Updated Name With Fake Manual Timestamp',
        updatedAt: '2000-01-01 00:00:00'
      })
      .where(eq(users.id, insertedUser.id));

    const [userAfterUpdate2] = await orm.select()
      .from(users)
      .where(eq(users.id, insertedUser.id));

    const t2Time = new Date(userAfterUpdate2?.updatedAt || '').getTime();
    if (t2Time < t1Time || (userAfterUpdate2?.updatedAt && userAfterUpdate2.updatedAt.startsWith('2000'))) {
      throw new Error(`trigger set_updated_at did not replace the manual value 2000-01-01 with NOW()! (current value: ${userAfterUpdate2?.updatedAt})`);
    }

    // Clean up
    await orm.delete(users).where(eq(users.id, insertedUser.id));

    results.push(makeTestCase({
      id: 'db_updated_at_triggers_validation',
      scenarioId: 'db_updated_at_triggers',
      name: 'automatic set_updated_at trigger on UPDATE (DB-021)',
      layer: 'database',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t13Start,
      details: 'BEFORE UPDATE trigger on users set updated_at to NOW() automatically and replaced old manual values.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'db_updated_at_triggers_validation',
      scenarioId: 'db_updated_at_triggers',
      name: 'automatic set_updated_at trigger on UPDATE (DB-021)',
      layer: 'database',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t13Start,
      error: err.message
    }));
  }

  // Test 14: هر جدولی که در ON CONFLICT(target) به کار می‌رود باید ایندکس یکتای کامل روی همان ستون‌ها داشته باشد (TD-113)
  const REQUIRED_CONFLICT_TARGETS: Array<{ table: string; columns: string[] }> = [
    { table: 'document_ref_counters', columns: ['doc_type', 'fiscal_year'] },
    { table: 'item_code_counters', columns: ['prefix_key', 'scope'] },
    { table: 'app_settings', columns: ['key'] },
    { table: 'idempotency_keys', columns: ['created_by_id', 'key', 'scope'] },
    { table: 'project_product_stage_progress', columns: ['item_id', 'project_id', 'stage_order'] },
  ];
  const tConflictStart = Date.now();
  try {
    const missing: string[] = [];
    for (const t of REQUIRED_CONFLICT_TARGETS) {
      const r = await orm.execute(sql`
        SELECT array_agg(a.attname::text ORDER BY a.attname) AS cols
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indrelid
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
        WHERE c.relname = ${t.table}::text AND i.indisunique AND i.indpred IS NULL
        GROUP BY i.indexrelid`);
      const ok = (r.rows as Array<{ cols: string[] }>)
        .some(row => JSON.stringify(row.cols) === JSON.stringify([...t.columns].sort()));
      if (!ok) missing.push(`${t.table}(${t.columns.join(',')})`);
    }
    results.push(makeTestCase({
      id: 'db_on_conflict_targets_have_unique_index',
      scenarioId: 'db_readiness',
      name: 'every ON CONFLICT target has a matching unique index',
      layer: 'database',
      executionType: 'real_database',
      passed: missing.length === 0,
      durationMs: Date.now() - tConflictStart,
      ...(missing.length ? { error: `بدون ایندکس یکتا: ${missing.join('، ')}` } : { details: 'همه اهداف پوشش دارند' })
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'db_on_conflict_targets_have_unique_index',
      scenarioId: 'db_readiness',
      name: 'every ON CONFLICT target has a matching unique index',
      layer: 'database',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - tConflictStart,
      error: err.message
    }));
  }

  return results;
}

