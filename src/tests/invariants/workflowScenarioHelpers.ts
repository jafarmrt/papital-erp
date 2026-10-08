import { orm, pool } from '../../db/drizzle.js';
import { getDefaultWarehouseCode } from '../../services/inventory/warehouseResolver.js';
import { WorkflowDefinitionService, type SaveWorkflowDefinitionPayload } from '../../services/workflow/workflowDefinitionService.js';
import { WorkflowTransitionExecutor } from '../../services/workflow/workflowTransitionExecutor.js';
import { WorkflowEngineService } from '../../services/workflow/workflowEngineService.js';
import { getErrorMessage } from '../../utils/formatters.js';
import { createTestDocument, createTestRole, createTestUser } from '../fixtures/factories.js';

/**
 * v8.0.90 — ابزار سناریوهای گردش‌کار حوزه G: تعریف واقعی با saveWorkflowDefinition، نمونه با startInstance
 * و اجرای کار و انتقال با سرویس‌های واقعی روی PostgreSQL.
 */

export interface WfStateSpec { key: string; type?: 'initial' | 'normal' | 'terminal'; slaHours?: number }
export interface WfTransitionSpec { from: string; to: string; action: string; title?: string; role?: string; rule?: string; k?: number; permission?: string; excludeInitiator?: boolean }
export interface WfSpec { states: WfStateSpec[]; transitions: WfTransitionSpec[] }

export interface Wf {
  definitionId: number;
  code: string;
  entityType: string;
  spec: WfSpec;
  stateId: Record<string, number>;
  transitionId: Record<string, number>;
}

export interface WfUser { id: number; role: string; name: string; permissions: string[] }

let sequence = 0;
export const uniqueTag = (): string => `${Date.now().toString(36)}${(++sequence).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

function payloadOf(spec: WfSpec, code: string, entityType: string, id?: number): SaveWorkflowDefinitionPayload {
  return {
    id, code, entityType, title: `گردش‌کار آزمون حوزه G ${code}`,
    states: spec.states.map((s, i) => ({ stateKey: s.key, title: s.key, stateType: s.type ?? 'normal', stepOrder: i + 1, slaHours: s.slaHours ?? 24 })),
    transitions: spec.transitions.map(t => ({
      from: t.from, to: t.to, actionKey: t.action, title: t.title ?? t.action, requiredRole: t.role ?? '', requiredPermission: t.permission ?? '', isInitiatorExcluded: t.excludeInitiator ? 1 : 0,
      approvalRuleType: t.rule ?? 'SINGLE', kValue: t.k ?? 1,
    })),
  };
}

/**
 * v9.0.128 (TD-542): ذخیره طرح نقش تعریف‌نشده را نمی‌پذیرد؛ نقش‌های آزمون (بی مجوز) پیش از ذخیره تعریف می‌شوند تا
 * رفتار امضا همان کد نقش کاربر بماند
 */
async function ensureTransitionRoles(spec: WfSpec): Promise<void> {
  const codes = new Set(spec.transitions.map(t => (t.role ?? '').trim()).filter(r => r && r !== '*' && r !== 'ALL'));
  for (const code of codes) {
    const found = await pool.query('SELECT 1 FROM roles WHERE lower(code) = lower($1)', [code]);
    if (found.rowCount === 0) await createTestRole({ code, permissions: [] });
  }
}

export async function defineWorkflow(spec: WfSpec): Promise<Wf> {
  await ensureTransitionRoles(spec);
  const tag = uniqueTag();
  const code = `WFG_${tag}`;
  const entityType = `wfg_${tag}`;
  const saved = await WorkflowDefinitionService.saveWorkflowDefinition(payloadOf(spec, code, entityType));
  if (!saved) throw new Error('تعریف گردش‌کار آزمون ذخیره نشد');
  const stateId: Record<string, number> = {};
  for (const s of saved.states) stateId[s.stateKey] = s.id;
  const transitionId: Record<string, number> = {};
  for (const t of saved.transitions) transitionId[t.actionKey] = t.id;
  return { definitionId: saved.definition.id, code, entityType, spec, stateId, transitionId };
}

/** ذخیره دوباره همان طرح از طراح (وضعیت‌ها و انتقال‌ها با شناسه تازه ساخته می‌شوند) */
export async function resaveWorkflow(wf: Wf): Promise<void> {
  await ensureTransitionRoles(wf.spec);
  await WorkflowDefinitionService.saveWorkflowDefinition(payloadOf(wf.spec, wf.code, wf.entityType, wf.definitionId));
}

export async function startWf(wf: Wf, entityId = uniqueTag(), starter?: WfUser): Promise<number> {
  const instance = await WorkflowTransitionExecutor.startInstance({
    workflowDefinitionId: wf.definitionId, entityType: wf.entityType, entityId, userId: starter?.id, userName: starter?.name,
  });
  return instance.id;
}

export async function wfUser(role: string, permissions: string[] = ['workflow.approve'], isDeleted = 0): Promise<WfUser> {
  const user = await createTestUser({ role, isDeleted });
  return { id: user.id, role, name: user.fullName, permissions };
}

export interface InstanceRow { currentStateId: number; status: string; progress: Record<string, { requiredCount?: number; signatures?: Array<{ userId: number; signedBy?: number }> }> }

export async function instanceRow(instanceId: number): Promise<InstanceRow> {
  const res = await pool.query<{ current_state_id: number; status: string; approval_progress_json: InstanceRow['progress'] | null }>(
    'SELECT current_state_id, status, approval_progress_json FROM workflow_instances WHERE id = $1', [instanceId]);
  const row = res.rows[0];
  return { currentStateId: row.current_state_id, status: row.status, progress: row.approval_progress_json ?? {} };
}

export interface TaskRow { id: number; transition_id: number; status: string; due_at: string | null }

export async function tasksOf(instanceId: number, status = 'pending'): Promise<TaskRow[]> {
  const res = await pool.query<TaskRow>(
    'SELECT id, transition_id, status, due_at FROM workflow_tasks WHERE instance_id = $1 AND status = $2 ORDER BY id', [instanceId, status]);
  return res.rows;
}

// اجرای انتقال و کار از نمای WorkflowEngineService، همان مسیری که روت‌ها صدا می‌زنند (this آن کلاس نما است)
export function transit(instanceId: number, transitionId: number, user: WfUser) {
  return WorkflowEngineService.executeTransition({
    instanceId, transitionId, userId: user.id, userName: user.name, userRole: user.role, userPermissions: user.permissions,
  });
}

export function runTask(taskId: number, user: WfUser, action: 'approve' | 'reject' = 'approve', transitionId?: number) {
  return WorkflowEngineService.executeTaskById({
    taskId, userId: user.id, userName: user.name, userRole: user.role, userPermissions: user.permissions, action, transitionId,
  });
}

/** پیام خطا، یا null وقتی اجرا پذیرفته شد */
export async function refusal(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return getErrorMessage(err);
  }
}

/** کد وضعیت HTTP خطای برنامه (AppError)، یا 500 برای خطای خام */
export async function refusalStatus(run: () => Promise<unknown>): Promise<number | null> {
  try {
    await run();
    return null;
  } catch (err) {
    const status = (err as { statusCode?: unknown }).statusCode;
    return typeof status === 'number' ? status : 500;
  }
}

/**
 * v9.0.323 (TD-699، ت۴): سفارش پیش‌نویس درخواستی که پیش از ت۱ (TD-689) و بی تأیید صادر شده بود، با پیوند ستون و ردیف.
 * «دریافت کالا» فقط ردیف سفارش‌شده را می‌پذیرد؛ سناریوهای دریافت درخواستِ تأییدنشده همین داده قدیمی را می‌سازند.
 */
export async function legacyRequisitionOrder(requisitionId: number, itemId: number, quantity: number): Promise<number> {
  const location = (await getDefaultWarehouseCode(orm)) ?? '';
  const { document } = await createTestDocument({ type: 'receipt', status: 'draft', procurementRequisitionId: requisitionId },
    [{ itemId, quantity, unitPrice: 1000, location }]);
  await pool.query(
    `UPDATE purchase_requisitions SET items = (
       SELECT jsonb_agg(row || jsonb_build_object('orderedQty', $3::numeric, 'remainingQty', 0, 'linkedDocumentIds', jsonb_build_array($2::int)))
         FROM jsonb_array_elements(items) AS row)
      WHERE id = $1`, [requisitionId, document.id, quantity]);
  return document.id;
}
