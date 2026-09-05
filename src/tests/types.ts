export type TestLayer =
  | 'unit'
  | 'integration'
  | 'api'
  | 'database'
  | 'workflow'
  | 'concurrency'
  | 'security'
  | 'regression'
  | 'stress'
  | 'e2e'
  | 'recovery'
  | 'penetration'
  | 'critical_path';

export type TestStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_RUN' | 'N/A';

// V3.0.9 (TD-055): 'real_code' برای تست‌هایی که کد واقعی production را صدا می‌زنند
// اما به DB دسترسی ندارند (lib-unit) — دیگر شبیه‌سازی‌ها را ماسک نمی‌کند.
export type ExecutionType = 'real_database' | 'real_api' | 'real_code' | 'simulation_logic';

export type CriticalScenarioId =
  | 'unauthorized_workflow_access'
  | 'unauthorized_approval'
  | 'two_users_approve_simultaneously'
  | 'two_users_issue_same_stock'
  | 'two_webhook_deliveries'
  | 'workflow_rejected'
  | 'workflow_delegated'
  | 'parallel_approval'
  | 'k_of_n_approval'
  | 'rule_condition_failure'
  | 'workflow_version_change'
  | 'task_model_idempotency'
  | 'sla_bottleneck_analytics'
  | 'domain_event_contract'
  | 'transactional_outbox'
  | 'action_handlers'
  | 'accounting_reversal'
  | 'inventory_rebuild'
  | 'woocommerce_retry'
  | 'regression_sanity'
  | 'db_readiness'
  | 'workflow_approval_postgres'
  | 'concurrent_stock_issues_postgres'
  | 'concurrent_workflow_transitions_postgres'
  | 'balanced_voucher_postgres'
  | 'voucher_reversal_postgres'
  | 'woocommerce_webhook_idempotency'
  | 'outbox_processing_retries'
  | 'ledger_invariants_and_repost'
  | 'period_closing_and_conceptual_mappings'
  | 'multi_currency_financials_and_ratios'
  | 'inventory_integrity_3way_reconciliation'
  | 'inventory_negative_stock_policy'
  | 'project_bom_allocation_traceability'
  | 'payroll_voucher_and_crm_accounting_read_model'
  | 'project_bom_receipt_allocation'
  | 'server_backed_form_drafts'
  | 'structured_error_contract'
  | 'e2e_purchase_receipt_inventory_accounting'
  | 'e2e_sales_approval_stockissue_accounting'
  | 'e2e_workflow_approve_reject_delegate_parallel'
  | 'e2e_woocommerce_webhook_document_stock_audit'
  | 'e2e_piecework_payroll_accounting_posting'
  | 'recovery_database_restart'
  | 'recovery_worker_restart'
  | 'recovery_outbox_webhook_retry'
  | 'recovery_migration_failure_handling'
  | 'recovery_backup_restore'
  | 'recovery_data_integrity_reconciliation'
  | 'recovery_outbox_stuck'
  | 'validate_lock_order_enforcement'
  | 'db_jsonb_and_financial_check_constraints'
  | 'db_updated_at_triggers'
  | 'jwt_forgery_rejected'
  | 'csrf_enforced'
  | 'sqli_blocked'
  | 'xss_sanitized'
  | 'ssrf_blocked'
  | 'rate_limit_no_bypass'
  | 'path_traversal_blocked'
  | 'concurrent_voucher_unique_postgres'
  | 'finalize_race_single_deduction'
  | 'cheque_invalid_transition'
  | 'idempotent_duplicate_request'
  | 'v9_finalization_bypass_blocked'
  | 'v9_negative_item_validation'
  | 'v9_document_delete_accounting_reversal'
  | 'v9_peek_next_ref_non_destructive'
  | 'v9_pagination_nan_safe'
  | 'v9_auth_live_session_validation'
  | 'v10_kardex_envelope_contract'
  | 'v10_next_code_concurrent_unique'
  | 'v10_payroll_paid_treasury_only'
  | 'v10_menu_visibility_deny_list'
  | 'v10_cleanup_refusal_without_flag'
  | 'v10_date_normalization_idempotence'
  | 'v10_iso_date_standardization';


export interface TestCaseResult {
  id: string;
  scenarioId?: CriticalScenarioId;
  name: string;
  layer: TestLayer;
  status: TestStatus;
  executionType: ExecutionType;
  passed: boolean;
  durationMs: number;
  error?: string;
  details?: string;
}

export function makeTestCase(
  params: Omit<TestCaseResult, 'status' | 'passed'> & { passed: boolean; status?: TestStatus }
): TestCaseResult {
  const status = params.status || (params.passed ? 'PASS' : 'FAIL');
  return {
    ...params,
    status,
    passed: status === 'PASS'
  };
}


export interface LayerSummary {
  layer: TestLayer;
  label: string;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  notRun: number;
  durationMs: number;
}

export interface CriticalScenarioSummary {
  scenarioId: CriticalScenarioId;
  title: string;
  status: TestStatus;
  executionType: ExecutionType;
  passed: boolean;
  durationMs: number;
  details: string;
}

export interface TestSuiteReport {
  timestamp: string;
  totalTests: number;
  passedCount: number;
  failedCount: number;
  blockedCount: number;
  notRunCount: number;
  totalDurationMs: number;
  overallStatus: 'passed' | 'failed' | 'blocked' | 'incomplete';
  layerSummaries: LayerSummary[];
  scenarioSummaries: CriticalScenarioSummary[];
  testCases: TestCaseResult[];
}

