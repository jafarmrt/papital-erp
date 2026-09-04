import { orm } from '../../db/drizzle.js';
import { runMigrations, validateDbSchema } from '../../db/migrator.js';
import { 
  users, 
  roles, 
  customers, 
  items, 
  itemPrices,
  projectBomAllocations,
  productionProjects,
  warehouses, 
  documents, 
  documentItems, 
  transactions, 
  treasuryTransactions, 
  journalVouchers, 
  journalVoucherItems, 
  workflowDefinitions, 
  workflowStates, 
  workflowTransitions, 
  workflowInstances, 
  workflowTasks, 
  workflowPendingApprovals, 
  workflowHistoryLogs, 
  outboxEvents, 
  deadLetterEvents,
  idempotencyKeys
} from '../../db/schema.js';
import { sql, or, ilike, inArray, eq, and } from 'drizzle-orm';
import { logger } from '../../middleware/logger.js';

export interface DbIsolationOptions {
  autoRollback?: boolean;
}

let isMigrationsDone = false;

/**
 * Ensures the PostgreSQL database is reachable and schema migrations are applied.
 */
export async function ensureTestDatabaseReady(): Promise<boolean> {
  try {
    // 1. Connectivity check
    await orm.execute(sql`SELECT 1`);
    
    // 2. Schema migration verification
    if (!isMigrationsDone) {
      await runMigrations();
      isMigrationsDone = true;
    }
    
    return true;
  } catch (err: any) {
    logger.error(`[TestDbHelper] Database connectivity or migration failed: ${err.message}`);
    return false;
  }
}

/**
 * Executes a test function inside a managed database transaction.
 * Automatically rolls back the transaction when `autoRollback: true` is passed,
 * ensuring zero test data pollution.
 */
export async function withTestTransaction<T>(
  testFn: (tx: typeof orm) => Promise<T>,
  options: DbIsolationOptions = { autoRollback: true }
): Promise<T> {
  let result: T;
  
  if (options.autoRollback) {
    try {
      await orm.transaction(async (tx) => {
        result = await testFn(tx as any);
        // Explicitly throw an intentional rollback error to undo transaction changes
        throw new TestRollbackSignal('TEST_ROLLBACK_INTENTIONAL');
      });
    } catch (err: any) {
      if (err instanceof TestRollbackSignal) {
        // Expected rollback signal — test completed safely without persist
        return result!;
      }
      throw err;
    }
    return result!;
  } else {
    return await testFn(orm);
  }
}

class TestRollbackSignal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TestRollbackSignal';
  }
}

/**
 * Cleans up specific test entities by IDs or prefixes if created without auto-rollback.
 */
export async function cleanTestTableData(tableName: string, idColumn = 'id', ids: Array<number | string> = []) {
  if (!ids || ids.length === 0) return;
  try {
    // TST-002: never interpolate values — bind ids as a single typed array param.
    // sql.raw is used ONLY for trusted internal identifiers (table/column names).
    const stringIds = ids.map(id => String(id));
    await orm.execute(
      sql`DELETE FROM ${sql.identifier(tableName)} WHERE ${sql.identifier(idColumn)} = ANY(${sql.param(stringIds)}::text[])`
    );
  } catch (err: any) {
    logger.warn(`[TestDbHelper] Failed to clean test data from ${tableName}: ${err.message}`);
  }
}

/**
 * V10-0.1 — Data Safety Hardening
 * ================================
 * This function previously contained FULL-TABLE deletes and catastrophic
 * ILIKE patterns (e.g. "documents ... OR id > 0", "%گردنبند%", "%طلاساز%",
 * "%ثبت فاکتور%") that destroyed REAL business data whenever tests ran
 * against a shared development database.
 *
 * Hardened per V10 Phase 0.1:
 *  1) HARD INTERNAL GATE: silently refuses to run unless
 *     NODE_ENV ∈ {test, development} AND ERP_ALLOW_TEST_CLEANUP === '1'.
 *     Every caller (suites' finally blocks, /api/setup, release-gate, ...)
 *     is now safe by construction.
 *  2) DE-FANGED PATTERNS: only rows carrying synthetic test identifiers are
 *     removed. Full-table DELETEs are replaced with subquery-scoped deletes;
 *     broad business-word patterns (گردنبند، ماده اولیه، طلاساز، استادکار،
 *     ثبت فاکتور، ...) and the "OR id > 0" catch-all were removed entirely.
 */

const CLEANUP_ALLOWED_ENVS = ['test', 'development'];

function isCleanupPermitted(): boolean {
  const env = process.env.NODE_ENV || 'development';
  return CLEANUP_ALLOWED_ENVS.includes(env) && process.env.ERP_ALLOW_TEST_CLEANUP === '1';
}

/** Synthetic-only document condition (ref prefixes used exclusively by suites) */
const TEST_DOC_COND = sql`(
  ref_number ILIKE 'CP-FIN-%' OR ref_number ILIKE 'DOC\\_%' OR ref_number ILIKE 'DOC-%'
  OR ref_number ILIKE 'STRESS-%' OR ref_number ILIKE 'IDEM-%' OR ref_number ILIKE 'ROLLBACK-%'
  OR ref_number ILIKE 'DOC_RACE%' OR ref_number ILIKE 'PURCHASE-E2E-%' OR ref_number ILIKE 'INV-E2E-%'
  OR ref_number ILIKE 'WOO-ORDER-%' OR ref_number ILIKE 'E2E-%' OR ref_number ILIKE 'TEST-%'
  OR ref_number ILIKE 'V9-%' OR ref_number ILIKE 'V9\\_%' OR ref_number ILIKE 'DIAG-%'
  OR notes ILIKE '%آزمایشی%' OR notes ILIKE '%E2E%' OR notes ILIKE '%تست%'
  OR buyer_name ILIKE '%آزمایشی%' OR buyer_name ILIKE '%استرس%' OR buyer_name ILIKE '%مسابقه نهاییسازی%'
  OR buyer_name ILIKE '%مشتری سازمانی تست%'
)`;

/** Synthetic-only item condition */
const TEST_ITEM_COND = sql`(
  code ILIKE 'ITEM\\_%' OR code ILIKE 'STRESS-%' OR code ILIKE 'SILVER-%' OR code ILIKE 'NECKLACE-%'
  OR code ILIKE 'WOO-%' OR code ILIKE 'DIAG\\_%' OR code ILIKE 'V9\\_%' OR code ILIKE 'V9-%'
  OR code ILIKE '1405-N-101-%' OR code ILIKE 'V10-CANARY-%'
  OR name ILIKE '%آزمایشی%' OR name ILIKE '%استرس%' OR name ILIKE '%فاز ۱۴%' OR name ILIKE '%فاز 14%'
  OR name ILIKE '%تستی%'
)`;

export async function cleanupAllTestFixtures(): Promise<void> {
  // ── HARD GATE ────────────────────────────────────────────────────────────
  if (!isCleanupPermitted()) {
    logger.error(
      '[TestDbHelper] cleanupAllTestFixtures REFUSED: requires NODE_ENV in {test,development} ' +
      'AND ERP_ALLOW_TEST_CLEANUP=1. No data was touched. (V10-0.1 safety gate)'
    );
    return;
  }
  logger.warn('[TestDbHelper] cleanupAllTestFixtures EXECUTING (synthetic artifacts only).');

  // 1. Clear workflow dependencies & instances
  try {
    await orm.execute(sql`DELETE FROM workflow_history_logs`);
    await orm.execute(sql`DELETE FROM workflow_tasks`);
    await orm.execute(sql`DELETE FROM workflow_pending_approvals`);
    await orm.execute(sql`DELETE FROM workflow_instances`);
    await orm.execute(sql`DELETE FROM workflow_delegations`);
    await orm.execute(sql`DELETE FROM workflow_transitions WHERE workflow_definition_id IN (SELECT id FROM workflow_definitions WHERE code ILIKE 'WF_%' OR title ILIKE '%آزمایشی%')`);
    await orm.execute(sql`DELETE FROM workflow_states WHERE workflow_definition_id IN (SELECT id FROM workflow_definitions WHERE code ILIKE 'WF_%' OR title ILIKE '%آزمایشی%')`);
    await orm.execute(sql`DELETE FROM workflow_definitions WHERE code ILIKE 'WF_%' OR title ILIKE '%آزمایشی%'`);
  } catch (err: any) {
    logger.warn(`[TestDbHelper] Error cleaning workflow fixtures: ${err.message}`);
  }

  // 2. Clear piecework artifacts BEFORE their parents (payroll/log scoped to synthetic refs)
  try {
    await orm.execute(sql`DELETE FROM piecework_logs WHERE payroll_id IN (SELECT id FROM piecework_payrolls WHERE payroll_number ILIKE 'PAY-%' OR payroll_number ILIKE 'PAYROLL-E2E-%' OR title ILIKE '%آزمایشی%' OR title ILIKE '%E2E%') OR created_by_id IN (SELECT id FROM users WHERE username ILIKE 'testuser_%' OR username ILIKE 'test_%' OR username ILIKE 'e2e_%') OR personnel_id IN (SELECT id FROM personnel WHERE full_name ILIKE '%آزمایشی%') OR notes ILIKE '%آزمایشی%'`);
    await orm.execute(sql`DELETE FROM piecework_payrolls WHERE payroll_number ILIKE 'PAY-%' OR payroll_number ILIKE 'PAYROLL-E2E-%' OR title ILIKE '%آزمایشی%' OR title ILIKE '%E2E%'`);
    // Personnel: only synthetic names (real workshop staff names like طلاساز/استادکار/جعفر/ناهید are NEVER matched)
    await orm.execute(sql`DELETE FROM personnel WHERE full_name ILIKE '%آزمایشی%' OR full_name ILIKE '%فاز ۱۴%' OR full_name ILIKE '%فاز 14%' OR full_name ILIKE 'پرسنل تستی%'`);
  } catch (err: any) {
    logger.warn(`[TestDbHelper] Error cleaning piecework fixtures: ${err.message}`);
  }

  // 3. Clear project dependencies & production projects (scoped)
  try {
    await orm.execute(sql`DELETE FROM daily_work_logs WHERE user_id IN (SELECT id FROM users WHERE username ILIKE 'testuser_%' OR username ILIKE 'test_%' OR username ILIKE 'e2e_%') OR title ILIKE '%آزمایشی%' OR title ILIKE '%تست%' OR content ILIKE '%آزمایشی%'`);
    await orm.execute(sql`DELETE FROM project_bom_allocations WHERE item_id IN (SELECT id FROM items WHERE ${TEST_ITEM_COND}) OR project_id IN (SELECT id FROM production_projects WHERE project_code ILIKE 'PROJ_%' OR project_code ILIKE 'E2E_%' OR project_code ILIKE 'PRJ_%' OR project_code ILIKE 'TEST_%' OR title ILIKE '%آزمایشی%' OR title ILIKE '%فاز ۱۴%' OR title ILIKE '%فاز 14%')`);
    await orm.execute(sql`DELETE FROM project_stages WHERE project_id IN (SELECT id FROM production_projects WHERE project_code ILIKE 'PROJ_%' OR project_code ILIKE 'E2E_%' OR project_code ILIKE 'PRJ_%' OR project_code ILIKE 'TEST_%' OR title ILIKE '%آزمایشی%' OR title ILIKE '%فاز ۱۴%' OR title ILIKE '%فاز 14%')`);
    await orm.execute(sql`DELETE FROM production_projects WHERE project_code ILIKE 'PROJ_%' OR project_code ILIKE 'E2E_%' OR project_code ILIKE 'PRJ_%' OR project_code ILIKE 'TEST_%' OR title ILIKE '%آزمایشی%' OR title ILIKE '%E2E%' OR title ILIKE '%فاز ۱۴%' OR title ILIKE '%فاز 14%'`);
  } catch (err: any) {
    logger.warn(`[TestDbHelper] Error cleaning project fixtures: ${err.message}`);
  }

  // 4. Clear CRM scoped
  try {
    await orm.execute(sql`DELETE FROM crm_activities WHERE lead_id IN (SELECT id FROM crm_leads WHERE title ILIKE '%آزمایشی%' OR title ILIKE '%Lead_%' OR title ILIKE '%تست%' OR company ILIKE '%آزمایشی%')`);
    await orm.execute(sql`DELETE FROM crm_leads WHERE title ILIKE '%آزمایشی%' OR title ILIKE '%Lead_%' OR title ILIKE '%تست%' OR company ILIKE '%آزمایشی%'`);
  } catch (err: any) {
    logger.warn(`[TestDbHelper] Error cleaning CRM fixtures: ${err.message}`);
  }

  // 5. Journals FIRST (so they can reference still-existing test documents), then documents & stock
  // Synthetic-voucher condition (aliased as "v"): includes reversals of synthetic originals,
  // but NEVER a legit manual reversal referencing a real voucher.
  const TEST_VOUCHER_COND = sql`(
      v.description ILIKE '%آزمایشی%' OR v.description ILIKE '%E2E%' OR v.description ILIKE '%تست%'
      OR v.description ILIKE '%مسابقه نهاییسازی%' OR v.description ILIKE '%آزمون تغییرناپذیری%'
      OR v.description ILIKE '%سند ابطال و برگشت جهت بازثبت%' OR v.description ILIKE '%سند بازثبت‌شده (Repost)%'
      OR v.description ILIKE '%سند اولیه جهت تست برگشت%' OR v.description ILIKE '%سند آزمایشی متوازن%'
      OR v.reference_number ILIKE 'WOO-ORDER-%' OR v.reference_number ILIKE 'PURCHASE-E2E-%'
      OR v.reference_number ILIKE 'INV-E2E-%' OR v.reference_number ILIKE 'PAY-%' OR v.reference_number ILIKE 'V9-%'
      OR v.reference_number ILIKE 'CP-FIN-%' OR v.reference_number ILIKE 'VOID-REPOST-%'
      OR v.reference_number ILIKE 'REPOST-%' OR v.reference_number ILIKE 'REV-V%' OR v.reference_number ILIKE 'TEST-%'
      OR (v.reference_module = 'invoice' AND v.reference_id IN (SELECT id FROM documents WHERE ${TEST_DOC_COND}))
      OR (v.reference_module = 'payroll' AND v.reference_id IN (SELECT id FROM piecework_payrolls WHERE payroll_number ILIKE 'PAY-%' OR title ILIKE '%آزمایشی%'))
      OR (v.voucher_type = 'adjustment' AND v.reference_id IN (
        SELECT o.id FROM journal_vouchers o
        WHERE o.description ILIKE '%آزمایشی%' OR o.description ILIKE '%E2E%' OR o.description ILIKE '%تست%'
          OR o.reference_number ILIKE 'WOO-ORDER-%' OR o.reference_number ILIKE 'PURCHASE-E2E-%'
          OR o.reference_number ILIKE 'INV-E2E-%' OR o.reference_number ILIKE 'PAY-%' OR o.reference_number ILIKE 'V9-%'
          OR o.reference_number ILIKE 'CP-FIN-%' OR o.reference_number ILIKE 'REV-V%'
          OR (o.reference_module = 'invoice' AND o.reference_id IN (SELECT id FROM documents WHERE ${TEST_DOC_COND}))
      ))
    )`;
  try {
    await orm.execute(sql`DELETE FROM journal_voucher_items WHERE voucher_id IN (SELECT v.id FROM journal_vouchers v WHERE ${TEST_VOUCHER_COND})`);
    await orm.execute(sql`DELETE FROM journal_vouchers WHERE id IN (SELECT v.id FROM journal_vouchers v WHERE ${TEST_VOUCHER_COND})`);
  } catch (err: any) {
    logger.warn(`[TestDbHelper] Error cleaning voucher fixtures: ${err.message}`);
  }

  try {
    await orm.execute(sql`DELETE FROM treasury_transactions WHERE document_id IN (SELECT id FROM documents WHERE ${TEST_DOC_COND}) OR party_name ILIKE '%آزمایشی%' OR party_name ILIKE '%استرس%'`);
    await orm.execute(sql`DELETE FROM document_items WHERE document_id IN (SELECT id FROM documents WHERE ${TEST_DOC_COND})`);
    await orm.execute(sql`DELETE FROM transactions WHERE document_id IN (SELECT id FROM documents WHERE ${TEST_DOC_COND}) OR item_id IN (SELECT id FROM items WHERE ${TEST_ITEM_COND}) OR document_ref ILIKE 'V9-%' OR document_ref ILIKE 'DIAG-%' OR document_ref ILIKE 'REVERSAL-%'`);
    await orm.execute(sql`DELETE FROM documents WHERE ${TEST_DOC_COND}`);
  } catch (err: any) {
    logger.warn(`[TestDbHelper] Error cleaning document fixtures: ${err.message}`);
  }

  // 6. Clear item prices & synthetic items (scoped; T-%/1405-N-%/گردنبند/ماده اولیه removed as REAL-code patterns)
  try {
    await orm.execute(sql`DELETE FROM project_bom_allocations WHERE item_id IN (SELECT id FROM items WHERE ${TEST_ITEM_COND})`);
    await orm.execute(sql`DELETE FROM document_items WHERE item_id IN (SELECT id FROM items WHERE ${TEST_ITEM_COND})`);
    await orm.execute(sql`DELETE FROM transactions WHERE item_id IN (SELECT id FROM items WHERE ${TEST_ITEM_COND})`);
    await orm.execute(sql`DELETE FROM item_prices WHERE item_id IN (SELECT id FROM items WHERE ${TEST_ITEM_COND})`);
    await orm.execute(sql`DELETE FROM items WHERE ${TEST_ITEM_COND}`);
  } catch (err: any) {
    logger.warn(`[TestDbHelper] Error cleaning item fixtures: ${err.message}`);
  }

  // 7. Clear synthetic customers only
  try {
    await orm.execute(sql`DELETE FROM customers WHERE name ILIKE '%آزمایشی%' OR name ILIKE '%طرف حساب آزمایشی%' OR name ILIKE 'مشتری سازمانی تست%' OR name ILIKE '%تست برگشت حسابداری%' OR notes ILIKE '%آزمایشی%'`);
  } catch (err: any) {
    logger.warn(`[TestDbHelper] Error cleaning customer fixtures: ${err.message}`);
  }

  // 8. System events & infrastructure telemetry (regenerable data — safe to clear)
  try {
    await orm.execute(sql`DELETE FROM outbox_events`);
    await orm.execute(sql`DELETE FROM dead_letter_events`);
    await orm.execute(sql`DELETE FROM idempotency_keys`);
    await orm.execute(sql`DELETE FROM event_action_logs`);
    await orm.execute(sql`DELETE FROM activity_logs WHERE action ILIKE 'TEST%' OR details::text ILIKE '%E2E%' OR details::text ILIKE '%آزمایشی%'`);
    await orm.delete(roles).where(and(ilike(roles.code, 'ROLE_%'), eq(roles.isSystem, 0)));
    await orm.delete(warehouses).where(ilike(warehouses.code, 'WH_%'));
  } catch (err: any) {
    logger.warn(`[TestDbHelper] Error cleaning system event & log fixtures: ${err.message}`);
  }

  // 9. Clear test users (keep 'admin' and system users; bare %تست% on full_name removed)
  try {
    const testUserCond = sql`(username ILIKE 'testuser_%' OR username ILIKE 'test_%' OR username ILIKE 'e2e_%' OR username ILIKE 'user_%' OR username ILIKE 'pen_admin%' OR username ILIKE 'sec009_%' OR username ILIKE 'v9_%' OR full_name ILIKE '%کاربر آزمایشی%')`;

    await orm.execute(sql`DELETE FROM form_drafts WHERE user_id IN (SELECT id FROM users WHERE ${testUserCond})`);
    await orm.execute(sql`DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE ${testUserCond}) OR sender_id IN (SELECT id FROM users WHERE ${testUserCond})`);
    await orm.execute(sql`DELETE FROM activity_logs WHERE user_id IN (SELECT id FROM users WHERE ${testUserCond})`);
    await orm.execute(sql`DELETE FROM workflow_delegations WHERE from_user_id IN (SELECT id FROM users WHERE ${testUserCond}) OR to_user_id IN (SELECT id FROM users WHERE ${testUserCond})`);
    await orm.execute(sql`UPDATE workflow_tasks SET assigned_user_id = NULL, delegated_to_user_id = NULL WHERE assigned_user_id IN (SELECT id FROM users WHERE ${testUserCond}) OR delegated_to_user_id IN (SELECT id FROM users WHERE ${testUserCond})`);
    await orm.execute(sql`UPDATE workflow_pending_approvals SET assigned_user_id = NULL WHERE assigned_user_id IN (SELECT id FROM users WHERE ${testUserCond})`);
    await orm.execute(sql`UPDATE workflow_history_logs SET performed_by = NULL WHERE performed_by IN (SELECT id FROM users WHERE ${testUserCond})`);
    await orm.execute(sql`UPDATE workflow_instances SET started_by = NULL WHERE started_by IN (SELECT id FROM users WHERE ${testUserCond})`);
    await orm.execute(sql`UPDATE journal_vouchers SET created_by_id = NULL, approved_by_id = NULL WHERE created_by_id IN (SELECT id FROM users WHERE ${testUserCond}) OR approved_by_id IN (SELECT id FROM users WHERE ${testUserCond})`);
    await orm.execute(sql`UPDATE treasury_transactions SET created_by_id = NULL WHERE created_by_id IN (SELECT id FROM users WHERE ${testUserCond})`);
    await orm.execute(sql`UPDATE piecework_logs SET created_by_id = NULL WHERE created_by_id IN (SELECT id FROM users WHERE ${testUserCond})`);
    await orm.execute(sql`UPDATE piecework_payrolls SET created_by_id = NULL WHERE created_by_id IN (SELECT id FROM users WHERE ${testUserCond})`);
    await orm.execute(sql`UPDATE cheques SET created_by_id = NULL WHERE created_by_id IN (SELECT id FROM users WHERE ${testUserCond})`);
    await orm.execute(sql`UPDATE personnel SET user_id = NULL WHERE user_id IN (SELECT id FROM users WHERE ${testUserCond})`);

    await orm.execute(sql`DELETE FROM users WHERE ${testUserCond}`);
  } catch (err: any) {
    logger.warn(`[TestDbHelper] Error cleaning test users: ${err.message}`);
  }

  logger.warn('[TestDbHelper] cleanupAllTestFixtures COMPLETED (scoped to synthetic artifacts).');
}

