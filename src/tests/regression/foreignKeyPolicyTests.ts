import { desc, eq, is, sql } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { orm } from '../../db/drizzle.js';
import * as schema from '../../db/schema.js';
import { workflowDefinitions, workflowDefinitionVersions, workflowHistoryLogs, workflowInstances, workflowStates, workflowTransitions } from '../../db/schema.js';
import { FOREIGN_KEY_EXCEPTIONS } from '../../db/foreignKeyPolicy.js';
import { WorkflowDefinitionService } from '../../services/workflow/workflowDefinitionService.js';
import { WorkflowEngineService } from '../../services/workflow/workflowEngineService.js';
import type { WorkflowSnapshotDsl } from '../../services/workflow/workflowTransitionExecutor.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient } from './fiscalClosingTests.js';

/**
 * Package 1 second half PR 3 (v9.0.430+, decision t6 «الف»): the foreign keys of the Drizzle schema and the database.
 *
 * - `reg_doc_signature_snapshot_title_td_612` (TD-612, B01-32): the print signature takes the step title from the
 *   instance's own snapshot. Red on v9.0.429, where it joined the live step table, so after an unchanged design save
 *   (new step ids) an old document's signature lost its step title.
 * - `reg_foreign_key_inventory_td_612`: every reference the Drizzle schema declares has a database foreign key, except the
 *   ones still pending below (this list only shrinks: a pending key that gets its constraint fails until it is removed
 *   here), and every documented exception of `FOREIGN_KEY_EXCEPTIONS` is a real column with neither.
 */

/** Declared references without a database constraint yet; each later release of PR 3 removes its keys */
const PENDING_FOREIGN_KEYS: readonly string[] = [
  'accounting_settings.account_id', 'bank_accounts.account_id', 'cheques.bank_account_id', 'cheques.voucher_id',
  'crm_activities.assigned_personnel_id', 'crm_activities.customer_id', 'crm_activities.lead_id',
  'crm_leads.assigned_personnel_id', 'crm_leads.customer_id', 'daily_work_logs.project_id', 'item_prices.item_id',
  'piecework_logs.payroll_id', 'piecework_logs.personnel_id', 'piecework_logs.project_id', 'piecework_logs.task_id',
  'piecework_payrolls.personnel_id', 'piecework_personnel_rates.personnel_id', 'piecework_personnel_rates.task_id',
  'piecework_task_rate_history.task_id', 'production_projects.customer_id', 'production_projects.item_id',
  'project_bom_allocations.item_id', 'project_bom_allocations.project_id',
  'project_bom_allocations.source_transaction_id', 'transactions.document_id', 'treasury_transactions.bank_account_id',
  'treasury_transactions.cheque_id', 'treasury_transactions.document_id', 'treasury_transactions.payroll_id',
  'treasury_transactions.voucher_id',
];

type DeclaredFk = { key: string; table: string; column: string; refTable: string; onDelete: string };

/** Single-column references declared in the Drizzle schema */
export function declaredForeignKeys(): DeclaredFk[] {
  const out: DeclaredFk[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const cfg = getTableConfig(value);
    for (const fk of cfg.foreignKeys) {
      const ref = fk.reference();
      if (ref.columns.length !== 1) continue;
      const column = ref.columns[0].name;
      out.push({ key: `${cfg.name}.${column}`, table: cfg.name, column, refTable: getTableConfig(ref.foreignTable).name, onDelete: fk.onDelete ?? 'no action' });
    }
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** Single-column foreign keys of the current schema, keyed table.column */
export async function databaseForeignKeys(): Promise<Map<string, { name: string; refTable: string; onDelete: string; validated: boolean }>> {
  const res = await orm.execute(sql`
    SELECT c.conname, cl.relname AS tbl, a.attname AS col, rcl.relname AS ref, c.confdeltype, c.convalidated
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_class rcl ON rcl.oid = c.confrelid
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1 AND c.connamespace = current_schema()::regnamespace`);
  const actions: Record<string, string> = { a: 'no action', r: 'restrict', c: 'cascade', n: 'set null', d: 'set default' };
  const out = new Map<string, { name: string; refTable: string; onDelete: string; validated: boolean }>();
  for (const r of res.rows as Array<{ conname: string; tbl: string; col: string; ref: string; confdeltype: string; convalidated: boolean }>) {
    out.set(`${r.tbl}.${r.col}`, { name: r.conname, refTable: r.ref, onDelete: actions[r.confdeltype] ?? r.confdeltype, validated: r.convalidated });
  }
  return out;
}

async function inventoryScenario(): Promise<string> {
  const problems: string[] = [];
  const declared = declaredForeignKeys();
  const db = await databaseForeignKeys();

  const missing = declared.filter(d => !db.has(d.key)).map(d => d.key);
  const pending = new Set(PENDING_FOREIGN_KEYS);
  const unexpected = missing.filter(k => !pending.has(k));
  if (unexpected.length > 0) problems.push(`declared references without a database foreign key (add the constraint in a migration): ${unexpected.join(', ')}`);
  const done = PENDING_FOREIGN_KEYS.filter(k => !missing.includes(k));
  if (done.length > 0) problems.push(`these keys have their constraint now; remove them from PENDING_FOREIGN_KEYS: ${done.join(', ')}`);
  for (const d of declared) {
    const c = db.get(d.key);
    if (c && c.refTable !== d.refTable) problems.push(`${d.key} references ${d.refTable} in Drizzle but ${c.refTable} in the database`);
  }

  const columns = await orm.execute(sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()`);
  const existing = new Set((columns.rows as Array<{ table_name: string; column_name: string }>).map(r => `${r.table_name}.${r.column_name}`));
  const declaredKeys = new Set(declared.map(d => d.key));
  for (const e of FOREIGN_KEY_EXCEPTIONS) {
    const key = `${e.table}.${e.column}`;
    if (!existing.has(key)) problems.push(`documented exception ${key} is not a column`);
    if (db.has(key)) problems.push(`documented exception ${key} has a database foreign key (${db.get(key)?.name}); remove it from FOREIGN_KEY_EXCEPTIONS`);
    if (declaredKeys.has(key)) problems.push(`documented exception ${key} is declared with references() in the Drizzle schema`);
    if (!e.reason.trim()) problems.push(`documented exception ${key} has no reason`);
  }

  assertNoProblems(problems);
  return `${declared.length} declared references: ${declared.length - missing.length} with a database foreign key, ${missing.length} pending; ${FOREIGN_KEY_EXCEPTIONS.length} documented exceptions checked`;
}

async function signatureScenario(): Promise<string> {
  const problems: string[] = [];
  const admin = await sandboxAdminClient();
  const code = 'DOC_APPROVAL_WORKFLOW';
  let [def] = await orm.select().from(workflowDefinitions).where(eq(workflowDefinitions.code, code));
  if (!def) {
    await WorkflowEngineService.seedDefaultWorkflows();
    [def] = await orm.select().from(workflowDefinitions).where(eq(workflowDefinitions.code, code));
  }
  if (!def) throw new Error(`no ${code} definition in the sandbox`);
  const [ver] = await orm.select().from(workflowDefinitionVersions)
    .where(eq(workflowDefinitionVersions.definitionId, def.id)).orderBy(desc(workflowDefinitionVersions.version)).limit(1);
  const snapshot = ver?.dslJson as WorkflowSnapshotDsl | undefined;
  const step = snapshot?.states?.find(s => s.stateType !== 'initial' && String(s.title ?? '').trim() !== '');
  if (!ver || !snapshot || !step) throw new Error(`the ${code} definition has no usable version snapshot`);

  const entityId = `TD612-${Date.now()}`;
  const [inst] = await orm.insert(workflowInstances).values({
    workflowDefinitionId: def.id, definitionVersion: ver.version, entityType: 'document', entityId,
    currentStateId: step.id, status: 'COMPLETED', snapshotDsl: snapshot, version: 1,
  }).returning({ id: workflowInstances.id });
  await orm.insert(workflowHistoryLogs).values({
    instanceId: inst.id, toStateId: step.id, performedByName: 'امضاکننده TD-612', actionKey: 'approve', actionTitle: 'تایید',
  });
  const roleTitle = async () => {
    const res = await admin.get(`/api/accounting/doc-signatures?entityId=${encodeURIComponent(entityId)}`);
    return { status: res.status, title: (res.body?.signatures?.[0] as { roleTitle?: string } | undefined)?.roleTitle };
  };

  const before = await roleTitle();
  if (before.status !== 200 || before.title !== step.title) problems.push(`before the design save the signature step is ${before.status} «${before.title}», expected «${step.title}»`);

  // an unchanged save of the design replaces the step rows (new ids), as the designer does
  const states = await orm.select().from(workflowStates).where(eq(workflowStates.workflowDefinitionId, def.id));
  const transitions = await orm.select().from(workflowTransitions).where(eq(workflowTransitions.workflowDefinitionId, def.id));
  await WorkflowDefinitionService.saveWorkflowDefinition({
    id: def.id, code: def.code, title: def.title, entityType: def.entityType,
    states: states.map(s => ({ ...s })),
    transitions: transitions.map(t => ({ ...t })),
  } as unknown as Parameters<typeof WorkflowDefinitionService.saveWorkflowDefinition>[0]);
  const [stillThere] = await orm.select({ id: workflowStates.id }).from(workflowStates).where(eq(workflowStates.id, step.id));
  if (stillThere) problems.push(`the design save kept step id ${step.id}, so the scenario proves nothing`);

  const after = await roleTitle();
  if (after.status !== 200 || after.title !== step.title) problems.push(`after the design save the signature step is ${after.status} «${after.title}», expected «${step.title}»`);

  assertNoProblems(problems);
  return `the signature kept the step title «${step.title}» after the design save replaced step id ${step.id}`;
}

export async function runForeignKeyPolicyTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  if (shouldRun('reg_doc_signature_snapshot_title_td_612', 'TD-612', 'B01-32')) {
    await runCase(results, 'reg_doc_signature_snapshot_title_td_612',
      'v9.0.430: the print signature keeps its step title after the workflow design is saved again (TD-612)', () => inFiscalSandbox(signatureScenario));
  }
  if (shouldRun('reg_foreign_key_inventory_td_612', 'TD-612', 'B01-31', 'B01-32')) {
    await runCase(results, 'reg_foreign_key_inventory_td_612',
      'v9.0.430: every declared reference has a database foreign key or is pending, and every documented exception has neither (TD-612)', inventoryScenario);
  }
  return results;
}
