import { TestSuiteReport, TestCaseResult, LayerSummary, CriticalScenarioSummary, TestLayer, CriticalScenarioId } from './types.js';
import { ensureTestDatabaseReady, cleanupAllTestFixtures } from './fixtures/dbTestHelper.js';
import { runUnitTests } from './suites/unitSuite.js';
import { runDatabaseTests } from './suites/databaseSuite.js';
import { runWorkflowTests } from './suites/workflowSuite.js';
import { runConcurrencyTests } from './suites/concurrencySuite.js';
import { runIntegrationTests } from './suites/integrationSuite.js';
import { runSecurityTests } from './suites/securitySuite.js';
import { runApiTests } from './suites/apiSuite.js';
import { runRegressionTests } from './suites/regressionSuite.js';
import { runStressTests } from './suites/stressSuite.js';
import { runE2eTests } from './suites/e2eSuite.js';
import { runRecoveryTests } from './suites/recoverySuite.js';
import { runPenetrationTests } from './suites/penetrationSuite.js';
import { runCriticalPathTests } from './suites/criticalPathSuite.js';
import { runDocumentIntegrityTests } from './suites/documentIntegritySuite.js';
import { runBusinessLogicAuditTests } from './suites/businessLogicAuditSuite.js';

const LAYER_LABELS: Record<TestLayer, string> = {
  unit: 'تست‌های واحد (Unit Tests)',
  integration: 'تست‌های یکپارچه‌سازی (Integration Tests)',
  api: 'تست‌های رابط‌های برقراری ارتباط (API Tests)',
  database: 'تست‌های لایه دیتابیس (Database Tests)',
  workflow: 'تست‌های موتور ورکفلو (Workflow Tests)',
  concurrency: 'تست‌های همزمانی و قفل‌گذاری (Concurrency Tests)',
  security: 'تست‌های امنیت و مجوزها (Security Tests)',
  regression: 'تست‌های بازگشتی و پایداری (Regression Tests)',
  stress: 'آزمون‌های بارگذاری و یکپارچگی داده (Phase 23 Stress Tests)',
  e2e: 'تست‌های سناریوهای سرتاسری (Subphase 14.1 E2E Journeys)',
  recovery: 'آزمون‌های بازیابی، خودترمیمی و تطبیق داده‌ها (Subphase 14.2 Recovery & Reconciliation)',
  penetration: 'آزمون‌های نفوذ واقعی HTTP (Phase 8 Penetration Suite — TST-004/005)',
  critical_path: 'آزمون‌های یکپارچگی مسیرهای بحرانی (Phase 8 Critical Path Suite — TST-006)'
};

const CRITICAL_SCENARIO_TITLES: Record<CriticalScenarioId, string> = {
  unauthorized_workflow_access: 'Unauthorized workflow access',
  unauthorized_approval: 'Unauthorized approval',
  two_users_approve_simultaneously: 'Two users approve simultaneously',
  two_users_issue_same_stock: 'Two users issue same stock',
  two_webhook_deliveries: 'Two webhook deliveries',
  workflow_rejected: 'Workflow rejected',
  workflow_delegated: 'Workflow delegated',
  parallel_approval: 'Parallel approval',
  k_of_n_approval: 'K-of-N approval',
  rule_condition_failure: 'Rule condition failure',
  workflow_version_change: 'Workflow version change',
  task_model_idempotency: 'Task Model & Execution Idempotency',
  sla_bottleneck_analytics: 'Workflow SLA & Bottleneck Analytics',
  domain_event_contract: 'Domain Event Contract & Schema Validation',
  transactional_outbox: 'Transactional Outbox & Atomic Claim Locking',
  action_handlers: 'Idempotent & Auditable Action Handlers',
  accounting_reversal: 'Accounting reversal',
  inventory_rebuild: 'Inventory rebuild',
  woocommerce_retry: 'WooCommerce retry',
  regression_sanity: 'System Regression Sanity',
  db_readiness: 'Database Readiness & Connectivity Check',
  workflow_approval_postgres: 'PostgreSQL Workflow Transition Integration',
  concurrent_stock_issues_postgres: 'PostgreSQL Concurrent Stock Deduction',
  concurrent_workflow_transitions_postgres: 'PostgreSQL Concurrent Workflow Race',
  balanced_voucher_postgres: 'PostgreSQL Double-Entry Accounting Balance',
  voucher_reversal_postgres: 'PostgreSQL Accounting Voucher Reversal',
  woocommerce_webhook_idempotency: 'WooCommerce Webhook Idempotency Lock',
  outbox_processing_retries: 'Transactional Outbox Batch Processing',
  ledger_invariants_and_repost: 'Ledger Invariants, Immutability & Repost Workflow',
  period_closing_and_conceptual_mappings: 'Period Closing, Financial Statements & Conceptual Account Mappings',
  multi_currency_financials_and_ratios: 'Multi-Currency Financial Statements, Portfolio & Standard Ratios',
  inventory_integrity_3way_reconciliation: '3-Way Inventory Integrity Invariant & Kardex Rebuild',
  inventory_negative_stock_policy: 'Negative Stock Policy Enforcement & Violations',
  project_bom_allocation_traceability: 'Project BOM Allocations & Source Transaction Traceability',
  payroll_voucher_and_crm_accounting_read_model: 'Payroll Voucher Sync & CRM Customer Accounting Read Model',
  project_bom_receipt_allocation: 'Direct Project BOM Receipt Allocation & Traceability',
  server_backed_form_drafts: 'Server-Backed Form Drafts Lifecycle & Persistence',
  structured_error_contract: 'Structured API Error Contract (code, message, details)',
  e2e_purchase_receipt_inventory_accounting: 'E2E Journey 1: Purchase -> Receipt -> Inventory WAC -> Accounting',
  e2e_sales_approval_stockissue_accounting: 'E2E Journey 2: Sales Invoice -> Workflow Approval -> Stock Issue -> Accounting',
  e2e_workflow_approve_reject_delegate_parallel: 'E2E Journey 3: Workflow -> Approve / Reject / Delegate / Parallel',
  e2e_woocommerce_webhook_document_stock_audit: 'E2E Journey 4: WooCommerce Webhook -> Document -> Stock -> Audit',
  e2e_piecework_payroll_accounting_posting: 'E2E Journey 5: Piecework Payroll -> Accounting Posting',
  recovery_database_restart: 'Recovery: Database Reconnect & KeepAlive',
  recovery_worker_restart: 'Recovery: Background Outbox Worker Restart Resilience',
  recovery_outbox_webhook_retry: 'Recovery: Webhook/Outbox Retry & DLQ Quarantine',
  recovery_migration_failure_handling: 'Recovery: Idempotent Migration & Schema Self-Healing',
  recovery_backup_restore: 'Recovery: Data Backup Manifest & Restore Integrity',
  recovery_data_integrity_reconciliation: 'Recovery: 12-Point Data Integrity Reconciliation Scan',
  recovery_outbox_stuck: 'Recovery: Outbox Stuck Events Auto-Recovery',
  validate_lock_order_enforcement: 'Lock Hierarchy & Lock Acquisition Order Enforcement (DB-018)',
  db_jsonb_and_financial_check_constraints: 'JSONB Type & Non-Negative Financial CHECK Constraints (DB-020)',
  db_updated_at_triggers: 'Automatic updated_at BEFORE UPDATE Triggers Enforcement (DB-021)',
  jwt_forgery_rejected: 'Penetration: JWT Forgery & Expiry Rejection (TST-004)',
  csrf_enforced: 'Penetration: CSRF Guard on Cookie Sessions (SEC-006)',
  sqli_blocked: 'Penetration: SQL Injection Resilience (TST-004)',
  xss_sanitized: 'Penetration: Stored XSS Sanitization (TST-004)',
  ssrf_blocked: 'Penetration: SSRF Metadata-Target Blocking (SEC-010)',
  rate_limit_no_bypass: 'Penetration: XFF-Spoofing Rate-Limit Resistance (SEC-009)',
  path_traversal_blocked: 'Penetration: /uploads Path Traversal Containment (TST-004)',
  concurrent_voucher_unique_postgres: 'Critical Path: Concurrent Voucher SEQUENCE Uniqueness (DB-001)',
  finalize_race_single_deduction: 'Critical Path: Concurrent Finalize Single Stock Deduction (DB-002)',
  cheque_invalid_transition: 'Critical Path: Cheque Invalid State Transition Rejection',
  idempotent_duplicate_request: 'Critical Path: Idempotent Duplicate Request Replay (DB-010)',
  v9_finalization_bypass_blocked: 'Doc Integrity: PUT Document Finalization Bypass Blocked',
  v9_negative_item_validation: 'Doc Integrity: Negative/Zero Item Quantity & Price Validation',
  v9_document_delete_accounting_reversal: 'Doc Integrity: Accounting Voucher Reversal on Document Deletion',
  v9_peek_next_ref_non_destructive: 'Doc Integrity: Non-Destructive next-ref Peek',
  v9_pagination_nan_safe: 'Doc Integrity: NaN-Safe Pagination Caps',
  v9_auth_live_session_validation: 'Security: Live Session Validation tokenVersion & Soft-Delete',
  v10_kardex_envelope_contract: 'Business Logic: Kardex Envelope Contract {item, summary, entries}',
  v10_next_code_concurrent_unique: 'Business Logic: Atomic next-code Uniqueness Under Concurrency (8 parallel)',
  v10_payroll_paid_treasury_only: 'Business Logic: Payroll paid-state Reachable Only Via Treasury',
  v10_menu_visibility_deny_list: 'Business Logic: menu_visibility Deny-List & Admin Bypass',
  v10_cleanup_refusal_without_flag: 'Data Safety: Test-Cleanup Refusal Without Safety Flag (Silent No-Op)',
  v10_date_normalization_idempotence: 'Data Safety: Date-Normalization Idempotence (re-run Integrity Scan healthy)',
  v10_iso_date_standardization: 'Data Safety: ISO Date Standardization & Dual-Write Accuracy'
};


const RUNNER_ALLOWED_ENVS = ['test', 'development'];

function assertRunnerEnvironment(): void {
  const env = process.env.NODE_ENV || 'development';
  if (!RUNNER_ALLOWED_ENVS.includes(env)) {
    throw new Error(`Test runner can only run in test/development environment. Current: ${env}`);
  }
}

function isTestCleanupAllowed(): boolean {
  return (
    (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') &&
    process.env.ERP_ALLOW_TEST_CLEANUP === '1'
  );
}

export class Phase21TestRunner {
  static async runAllTests(layerFilter?: TestLayer): Promise<TestSuiteReport> {
    assertRunnerEnvironment();

    const startTime = Date.now();
    let allCases: TestCaseResult[] = [];

    // Ensure database schema migrations are applied and previous test artifacts are purged
    try {
      await ensureTestDatabaseReady();
      if (isTestCleanupAllowed()) {
        await cleanupAllTestFixtures();
      }
    } catch {
      // Non-blocking in mock environments
    }

    try {
      // Execute Suites based on filter or run all
      if (!layerFilter || layerFilter === 'unit') {
        allCases = allCases.concat(await runUnitTests());
      }
      if (!layerFilter || layerFilter === 'database') {
        allCases = allCases.concat(await runDatabaseTests());
      }
      if (!layerFilter || layerFilter === 'workflow') {
        allCases = allCases.concat(await runWorkflowTests());
      }
      if (!layerFilter || layerFilter === 'concurrency') {
        allCases = allCases.concat(await runConcurrencyTests());
      }
      if (!layerFilter || layerFilter === 'integration') {
        allCases = allCases.concat(await runIntegrationTests());
      }
      if (!layerFilter || layerFilter === 'security') {
        allCases = allCases.concat(await runSecurityTests());
      }
      if (!layerFilter || layerFilter === 'api') {
        allCases = allCases.concat(await runApiTests());
      }
      if (!layerFilter || layerFilter === 'regression') {
        allCases = allCases.concat(await runRegressionTests());
      }
      if (!layerFilter || layerFilter === 'stress') {
        allCases = allCases.concat(await runStressTests());
      }
      if (!layerFilter || layerFilter === 'e2e') {
        allCases = allCases.concat(await runE2eTests());
      }
      if (!layerFilter || layerFilter === 'recovery') {
        allCases = allCases.concat(await runRecoveryTests());
      }
      // Critical path MUST run before penetration: the penetration suite's
      // rate-limit probe intentionally exhausts the login throttle budget
      // (5/15min per socket address) shared by both suites' admin login.
      if (!layerFilter || layerFilter === 'critical_path') {
        allCases = allCases.concat(await runCriticalPathTests());
      }
      // آزمون‌های یکپارچگی اسناد و برگشت‌های مالی
      if (!layerFilter || layerFilter === 'regression') {
        allCases = allCases.concat(await runDocumentIntegrityTests());
      }
      // آزمون‌های ممیزی منطق کسب‌وکار و رفتارهای سیستمی
      if (!layerFilter || layerFilter === 'regression') {
        allCases = allCases.concat(await runBusinessLogicAuditTests());
      }
      if (!layerFilter || layerFilter === 'penetration') {
        allCases = allCases.concat(await runPenetrationTests());
      }
    } finally {
      // Purge test artifacts only when explicitly allowed via ERP_ALLOW_TEST_CLEANUP=1 (TST-003)
      if (isTestCleanupAllowed()) {
        try {
          await cleanupAllTestFixtures();
        } catch {
          // Safe ignore
        }
      }
    }

    const totalDurationMs = Date.now() - startTime;
    const passedCount = allCases.filter(c => c.status === 'PASS').length;
    const failedCount = allCases.filter(c => c.status === 'FAIL').length;
    const blockedCount = allCases.filter(c => c.status === 'BLOCKED').length;
    const notRunCount = allCases.filter(c => c.status === 'NOT_RUN' || c.status === 'N/A').length;

    // Build Layer Summaries
    const layersPresent = Array.from(new Set(allCases.map(c => c.layer))) as TestLayer[];
    const layerSummaries: LayerSummary[] = layersPresent.map(l => {
      const casesForLayer = allCases.filter(c => c.layer === l);
      return {
        layer: l,
        label: LAYER_LABELS[l] || l,
        total: casesForLayer.length,
        passed: casesForLayer.filter(c => c.status === 'PASS').length,
        failed: casesForLayer.filter(c => c.status === 'FAIL').length,
        blocked: casesForLayer.filter(c => c.status === 'BLOCKED').length,
        notRun: casesForLayer.filter(c => c.status === 'NOT_RUN' || c.status === 'N/A').length,
        durationMs: casesForLayer.reduce((acc, c) => acc + c.durationMs, 0)
      };
    });

    // Build Critical Scenario Summaries (MISSING TESTS NEVER DEFAULT TO PASS)
    const scenarioSummaries: CriticalScenarioSummary[] = Object.keys(CRITICAL_SCENARIO_TITLES).map(sKey => {
      const sId = sKey as CriticalScenarioId;
      const matchedCase = allCases.find(c => c.scenarioId === sId);
      if (matchedCase) {
        return {
          scenarioId: sId,
          title: CRITICAL_SCENARIO_TITLES[sId],
          status: matchedCase.status,
          executionType: matchedCase.executionType,
          passed: matchedCase.status === 'PASS',
          durationMs: matchedCase.durationMs,
          details: matchedCase.details || matchedCase.error || ''
        };
      } else {
        return {
          scenarioId: sId,
          title: CRITICAL_SCENARIO_TITLES[sId],
          status: 'NOT_RUN',
          executionType: 'simulation_logic',
          passed: false,
          durationMs: 0,
          details: 'این سناریو در اجرای جاری اجرا نگردیده است (NOT_RUN).'
        };
      }
    });

    let overallStatus: 'passed' | 'failed' | 'blocked' | 'incomplete' = 'passed';
    if (failedCount > 0) {
      overallStatus = 'failed';
    } else if (blockedCount > 0) {
      overallStatus = 'blocked';
    } else if (!layerFilter && (notRunCount > 0 || scenarioSummaries.some(s => s.status === 'NOT_RUN'))) {
      overallStatus = 'incomplete';
    }

    return {
      timestamp: new Date().toISOString(),
      totalTests: allCases.length,
      passedCount,
      failedCount,
      blockedCount,
      notRunCount,
      totalDurationMs,
      overallStatus,
      layerSummaries,
      scenarioSummaries,
      testCases: allCases
    };
  }
}
