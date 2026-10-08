import { createTestItem } from '../fixtures/factories.js';
import { TestCaseResult } from '../types.js';
import { PROJECT_PRIORITIES, PROJECT_STATUSES, STAGE_STATUSES } from '../../lib/projects/projectStatus.js';
import { PROJECT_VERSION_CONFLICT_MESSAGE } from '../../lib/projects/projectVersion.js';
import { buildProjectValueHealthTest, findProjectFreeTextValues } from '../../services/projects/projectStageHealth.js';
import { type ShouldRun, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient } from './fiscalClosingTests.js';
import { brief, editProject, newProject, q } from './projectStageIntegrityTests.js';

/**
 * Package 11 (project control and production), PR «ب»: project edit and input — status and priority lists, delivery
 * and quantity input, stage completion time, audit rows, stages in the edit form and the project version. Runs on real
 * Express routes and PostgreSQL in an isolated schema and is red on the version before each fix.
 */

interface AuditDetails {
  projectId?: number;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  changes?: Record<string, { before: unknown; after: unknown }>;
}

export async function runProjectEditTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const valuesId = 'reg_project_status_values_td_754';
  if (shouldRun(valuesId, 'td754', 'projects', 'package11')) {
    await runCase(results, valuesId, 'v9.0.380: a project status or priority or a stage status outside the UI lists is a 400 and is not stored; legacy free-text values are listed by the health check (TD-754)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const project = await newProject(api, {});
      const stored = async () => (await q('SELECT status, priority FROM production_projects WHERE id = $1', [project.id]))[0] ?? {};

      for (const body of [{ status: 'Completed' }, { status: 'تمام شده' }, { priority: 'خیلی فوری' }, { priority: 'normal' }]) {
        const res = await editProject(api, project.id, body);
        if (res.status !== 400) problems.push(`PUT project ${JSON.stringify(body)} answered ${res.status} ${brief(res.body)}, expected 400`);
      }
      const after = await stored();
      if (after.status !== 'planned' || after.priority !== 'medium') problems.push(`refused edits still stored status ${after.status} and priority ${after.priority}`);

      const create = await api.post('/api/projects', { title: `TD-754 ${Date.now()}`, quantity: 1, priority: 'خیلی فوری' });
      if (create.status !== 400) problems.push(`creating a project with a free-text priority answered ${create.status} ${brief(create.body)}, expected 400`);
      const createStage = await api.post('/api/projects', { title: `TD-754 stage ${Date.now()}`, quantity: 1, initial_stages: [{ title: 'برش', status: 'تمام' }] });
      if (createStage.status !== 400) problems.push(`creating a project with a free-text initial stage status answered ${createStage.status} ${brief(createStage.body)}, expected 400`);
      const addStage = await api.post(`/api/projects/${project.id}/stages`, { title: 'بسته‌بندی', status: 'تمام' });
      if (addStage.status !== 400) problems.push(`adding a stage with a free-text status answered ${addStage.status} ${brief(addStage.body)}, expected 400`);
      const editStage = await api.put(`/api/projects/${project.id}/stages/${project.stages[0].id}`, { status: 'done' });
      if (editStage.status !== 400) problems.push(`editing a stage to status done answered ${editStage.status} ${brief(editStage.body)}, expected 400`);
      const stageStatuses = (await q('SELECT status FROM project_stages WHERE project_id = $1 AND is_deleted = 0', [project.id])).map(r => String(r.status));
      if (stageStatuses.some(s => !(STAGE_STATUSES as readonly string[]).includes(s))) problems.push(`a refused stage status was stored: ${stageStatuses.join(', ')}`);

      const valid = await editProject(api, project.id, { status: 'paused', priority: 'urgent' });
      if (valid.status !== 200) problems.push(`PUT project with status paused and priority urgent answered ${valid.status} ${brief(valid.body)}, expected 200`);

      const clean = buildProjectValueHealthTest(await findProjectFreeTextValues(PROJECT_STATUSES, PROJECT_PRIORITIES, STAGE_STATUSES));
      if (clean.status !== 'healthy' || clean.count !== 0) problems.push(`health check on list values answered ${clean.status} with ${clean.count} rows, expected healthy`);
      await q(`UPDATE production_projects SET status = 'Completed', priority = 'خیلی فوری' WHERE id = $1`, [project.id]);
      await q(`UPDATE project_stages SET status = 'تمام' WHERE id = $1`, [project.stages[1].id]);
      const legacy = buildProjectValueHealthTest(await findProjectFreeTextValues(PROJECT_STATUSES, PROJECT_PRIORITIES, STAGE_STATUSES));
      const kinds = (legacy.items ?? []).map(i => i.title).sort();
      if (legacy.status !== 'warning' || legacy.count !== 3 || legacy.id !== 'project_status_values') {
        problems.push(`health check on legacy free text answered ${legacy.id} ${legacy.status} with ${legacy.count} rows (${kinds.length}), expected a warning with 3 rows`);
      }
      const leftAsIs = await stored();
      if (leftAsIs.status !== 'Completed') problems.push('the health check rewrote a legacy status');
      assertNoProblems(problems);
      return 'free-text status, priority and stage status refused with 400; legacy values listed and left as they are';
    }));
  }

  const deliveryId = 'reg_project_delivery_input_td_741';
  if (shouldRun(deliveryId, 'td741', 'projects', 'package11')) {
    await runCase(results, deliveryId, 'v9.0.381: delivery quantity and unit price and the project quantity read Persian digits; a non-positive quantity or a negative price is a 422, never a silent 200 with nothing recorded (TD-741)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const item = await createTestItem({ type: 'product', weightedAverageCost: 100000 });
      const project = await newProject(api, { products: [{ itemId: item.id, qty: 5 }] });
      const deliver = (line: Record<string, unknown>) => api.post(`/api/projects/${project.id}/add-to-inventory`, { itemsToAdd: [{ itemId: item.id, ...line }] });
      const receiptLines = async () => q(
        `SELECT di.quantity::text AS quantity, di.unit_price::text AS unit_price FROM documents d JOIN document_items di ON di.document_id = d.id
          WHERE d.project_id = $1 AND d.type = 'production_receipt' AND d.is_deleted = 0 AND di.is_deleted = 0 ORDER BY di.id`, [project.id]);

      for (const [line, code] of [[{ quantity: '-3' }, 'PROJECT_DELIVERY_LINE_INVALID'], [{ quantity: 0 }, 'PROJECT_DELIVERY_LINE_INVALID'], [{ quantity: 2, unitPrice: '-5' }, 'PROJECT_DELIVERY_LINE_INVALID']] as const) {
        const res = await deliver(line);
        if (res.status !== 422 || res.body?.code !== code) problems.push(`delivering ${JSON.stringify(line)} answered ${res.status} ${brief(res.body)}, expected 422 ${code}`);
      }
      const text = await deliver({ quantity: 'abc' });
      if (text.status !== 400) problems.push(`delivering a text quantity answered ${text.status} ${brief(text.body)}, expected 400`);
      if ((await receiptLines()).length !== 0) problems.push('a refused delivery recorded a production receipt');

      const persian = await deliver({ quantity: '۲', unitPrice: '۱۵۰۰۰۰' });
      const lines = await receiptLines();
      if (persian.status !== 200 || persian.body?.addedCount !== 1 || lines.length !== 1 || Number(lines[0].quantity) !== 2 || Number(lines[0].unit_price) !== 150000) {
        problems.push(`delivering quantity 2 at 150000 in Persian digits answered ${persian.status} ${brief(persian.body)} with receipt lines ${JSON.stringify(lines)}, expected 1 line of 2 at 150000`);
      }

      const created = await api.post('/api/projects', { title: `TD-741 ${Date.now()}`, quantity: '۱۲' });
      const stored = created.body?.id ? (await q('SELECT quantity::text AS quantity FROM production_projects WHERE id = $1', [created.body.id]))[0]?.quantity : null;
      if (created.status !== 201 || Number(stored) !== 12) problems.push(`creating a project with quantity 12 in Persian digits answered ${created.status} ${brief(created.body)} and stored ${stored}, expected 12`);
      for (const quantity of [0, '-1']) {
        const res = await editProject(api, project.id, { quantity });
        if (res.status !== 422 || res.body?.code !== 'PROJECT_QUANTITY_INVALID') problems.push(`PUT project quantity ${quantity} answered ${res.status} ${brief(res.body)}, expected 422 PROJECT_QUANTITY_INVALID`);
      }
      const kept = (await q('SELECT quantity::text AS quantity FROM production_projects WHERE id = $1', [project.id]))[0]?.quantity;
      if (Number(kept) !== 5) problems.push(`refused quantity edits left the project quantity at ${kept}, expected 5`);
      assertNoProblems(problems);
      return 'Persian-digit delivery recorded at its price; invalid lines and project quantities refused with 422';
    }));
  }

  const clockId = 'reg_project_stage_completion_clock_td_756';
  if (shouldRun(clockId, 'td756', 'projects', 'package11')) {
    await runCase(results, clockId, 'v9.0.382: a stage completion time and a matrix tick time are written with one clock, the server UTC time with Z; a completed stage keeps its time and a reopened stage has none (TD-756)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const utcNow = (value: unknown, label: string) => {
        const text = String(value ?? '');
        const ms = Date.parse(text);
        if (!/(Z|[+-]\d{2}:?\d{2})$/.test(text) || !Number.isFinite(ms) || Math.abs(ms - Date.now()) > 120_000) {
          problems.push(`${label} is "${text}", expected the server UTC time with a zone (now ${new Date().toISOString()})`);
        }
      };
      const stageRow = async (id: number) => (await q('SELECT status, completed_at FROM project_stages WHERE id = $1', [id]))[0] ?? {};

      const item = await createTestItem({ type: 'product' });
      const matrix = await newProject(api, { products: [{ itemId: item.id, qty: 2 }] });
      const tick = await api.put(`/api/projects/${matrix.id}/product-progress`, { items: [{ item_id: item.id, stage_order: 1, status: 'completed' }] });
      if (tick.status !== 200) problems.push(`ticking stage 1 answered ${tick.status} ${brief(tick.body)}`);
      const synced = await stageRow(matrix.stages[0].id);
      if (synced.status !== 'completed') problems.push(`the ticked stage status is ${synced.status}, expected completed`);
      utcNow(synced.completed_at, 'the completion time the matrix sync wrote');
      const cell = (await q('SELECT updated_at FROM project_product_stage_progress WHERE project_id = $1 AND stage_order = 1', [matrix.id]))[0];
      utcNow(cell?.updated_at, 'the matrix tick time');

      const manual = await newProject(api, {});
      const stageId = manual.stages[0].id;
      const done = await api.put(`/api/projects/${manual.id}/stages/${stageId}`, { status: 'completed' });
      if (done.status !== 200) problems.push(`completing a manual stage answered ${done.status} ${brief(done.body)}`);
      const first = await stageRow(stageId);
      utcNow(first.completed_at, 'the completion time of a manual stage');
      await new Promise(resolve => setTimeout(resolve, 20));
      await api.put(`/api/projects/${manual.id}/stages/${stageId}`, { title: 'برش نهایی', status: 'completed' });
      const again = await stageRow(stageId);
      if (again.completed_at !== first.completed_at) problems.push(`saving a completed stage again moved its completion time from ${first.completed_at} to ${again.completed_at}`);
      await api.put(`/api/projects/${manual.id}/stages/${stageId}`, { status: 'in_progress' });
      const reopened = await stageRow(stageId);
      if (reopened.status !== 'in_progress' || (reopened.completed_at ?? '') !== '') problems.push(`a reopened stage is ${reopened.status} with completion time ${reopened.completed_at}, expected in_progress without one`);
      assertNoProblems(problems);
      return 'matrix and manual completion times and tick times in server UTC; kept on resave, cleared on reopen';
    }));
  }

  const auditId = 'reg_project_stage_audit_td_757';
  if (shouldRun(auditId, 'td757', 'projects', 'package11')) {
    await runCase(results, auditId, 'v9.0.383: a project edit is audited with before and after of the changed fields, and adding, editing and deleting a stage each write an audit row with the stage before and after, inside the write transaction (TD-757)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const project = await newProject(api, {});
      const auditRows = async (entity: string, entityId: number | string) => q(
        'SELECT action, details FROM activity_logs WHERE entity = $1 AND entity_id = $2 ORDER BY id', [entity, String(entityId)]);

      const edit = await editProject(api, project.id, { title: 'TD-757 renamed', priority: 'high' });
      if (edit.status !== 200) problems.push(`editing the project answered ${edit.status} ${brief(edit.body)}`);
      const projectRows = (await auditRows('پروژه تولید', project.id)).filter(r => r.action === 'UPDATE');
      const changes = (projectRows[projectRows.length - 1]?.details as { changes?: Record<string, { before: unknown; after: unknown }> } | undefined)?.changes ?? {};
      if (changes.title?.after !== 'TD-757 renamed' || !String(changes.title?.before ?? '').startsWith('TD-P11') || changes.priority?.before !== 'متوسط' || changes.priority?.after !== 'زیاد' || 'description' in changes) {
        problems.push(`the project edit audit row carries changes ${JSON.stringify(changes)}, expected only title and priority with before and after`);
      }

      const added = await api.post(`/api/projects/${project.id}/stages`, { title: 'TD-757 stage' });
      const stageId = Number(added.body?.id);
      if (added.status !== 201 || !stageId) problems.push(`adding a stage answered ${added.status} ${brief(added.body)}`);
      await api.put(`/api/projects/${project.id}/stages/${stageId}`, { title: 'TD-757 stage renamed', notes: 'n' });
      await api.del(`/api/projects/${project.id}/stages/${stageId}`);
      const stageRows = await auditRows('مرحله پروژه تولید', stageId);
      const [create, update, remove] = stageRows as Array<{ action: string; details?: AuditDetails }>;
      if (stageRows.length !== 3 || create?.action !== 'CREATE' || create.details?.after?.title !== 'TD-757 stage' || create.details?.projectId !== project.id) {
        problems.push(`stage add audit rows ${brief(stageRows)}, expected CREATE with the stage after and the project id`);
      }
      if (update?.action !== 'UPDATE' || update.details?.changes?.title?.after !== 'TD-757 stage renamed' || update.details?.changes?.title?.before !== 'TD-757 stage' || update.details?.changes?.status) {
        problems.push(`stage edit audit row ${brief(update)}, expected UPDATE with only the changed fields`);
      }
      if (remove?.action !== 'DELETE' || remove.details?.before?.title !== 'TD-757 stage renamed' || remove.details?.after) {
        problems.push(`stage delete audit row ${brief(remove)}, expected DELETE with the stage before`);
      }

      const before = (await auditRows('پروژه تولید', project.id)).length;
      const refused = await editProject(api, project.id, { title: 'TD-757 refused', start_date: '1404/12/31' });
      const after = (await auditRows('پروژه تولید', project.id)).length;
      if (refused.status < 400 || after !== before) problems.push(`a refused project edit answered ${refused.status} and left ${after - before} new audit rows, expected an error and none`);
      assertNoProblems(problems);
      return 'project edit, stage add, edit and delete audited with before and after inside their transaction';
    }));
  }

  const stagesId = 'reg_project_edit_stages_read_only_td_740';
  if (shouldRun(stagesId, 'td740', 'projects', 'package11')) {
    await runCase(results, stagesId, 'v9.0.384: editing a project never changes its stages; stages sent with a project edit are a 422 PROJECT_STAGES_READ_ONLY instead of a 200 that silently drops them (TD-740)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const project = await newProject(api, {});
      const stageTitles = async () => (await q('SELECT title FROM project_stages WHERE project_id = $1 AND is_deleted = 0 ORDER BY stage_order', [project.id])).map(r => String(r.title));
      const before = await stageTitles();

      const res = await editProject(api, project.id, {
        title: 'TD-740 edited',
        initial_stages: ['A', 'B', 'C', 'D'].map((title, i) => ({ title: `stage ${title}`, stage_order: i + 1 })),
      });
      if (res.status !== 422 || res.body?.code !== 'PROJECT_STAGES_READ_ONLY') problems.push(`a project edit with four new stages answered ${res.status} ${brief(res.body)}, expected 422 PROJECT_STAGES_READ_ONLY`);
      const title = String((await q('SELECT title FROM production_projects WHERE id = $1', [project.id]))[0]?.title);
      if (title === 'TD-740 edited') problems.push('the refused edit still stored the new title');
      const after = await stageTitles();
      if (JSON.stringify(after) !== JSON.stringify(before)) problems.push(`the stages changed from ${JSON.stringify(before)} to ${JSON.stringify(after)}`);

      const plain = await editProject(api, project.id, { title: 'TD-740 edited' });
      if (plain.status !== 200) problems.push(`a project edit without stages answered ${plain.status} ${brief(plain.body)}, expected 200`);
      assertNoProblems(problems);
      return 'stages in a project edit refused with 422 and left as they were; an edit without stages saved';
    }));
  }

  const versionId = 'reg_project_version_occ_td_742';
  if (shouldRun(versionId, 'td742', 'projects', 'package11')) {
    await runCase(results, versionId, 'v9.0.385: a project edit sends the version it was built from; without it 400, from a stale version 409 OCC_CONFLICT with nothing stored; every save and a status change by the progress matrix raise the version (TD-742)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const item = await createTestItem({ type: 'product' });
      const project = await newProject(api, { products: [{ itemId: item.id, qty: 1 }], stages: ['cut'] });
      const stored = async () => (await q('SELECT title, version FROM production_projects WHERE id = $1', [project.id]))[0] ?? {};

      const opened = await api.get(`/api/projects/${project.id}`);
      const v1 = Number(opened.body?.version);
      if (opened.status !== 200 || v1 !== 1) problems.push(`GET project answered ${opened.status} with version ${String(opened.body?.version)}, expected 1`);

      const missing = await api.put(`/api/projects/${project.id}`, { title: 'TD-742 no version' });
      if (missing.status !== 400) problems.push(`an edit without a version answered ${missing.status} ${brief(missing.body)}, expected 400`);

      // two users opened version 1: the first save wins, the second is refused and stores nothing
      const first = await api.put(`/api/projects/${project.id}`, { title: 'TD-742 first', version: v1 });
      if (first.status !== 200 || Number(first.body?.version) !== v1 + 1) problems.push(`the first save answered ${first.status} with version ${String(first.body?.version)}, expected 200 and ${v1 + 1}`);
      const second = await api.put(`/api/projects/${project.id}`, { title: 'TD-742 second', version: v1 });
      if (second.status !== 409 || second.body?.code !== 'OCC_CONFLICT' || String(second.body?.error ?? second.body?.message ?? '') !== PROJECT_VERSION_CONFLICT_MESSAGE) {
        problems.push(`the second save from the old version answered ${second.status} ${brief(second.body)}, expected 409 OCC_CONFLICT with the project message`);
      }
      const afterSecond = await stored();
      if (afterSecond.title !== 'TD-742 first' || Number(afterSecond.version) !== v1 + 1) problems.push(`after the refused save the project is ${brief(afterSecond)}, expected the first title at version ${v1 + 1}`);

      // the progress matrix completes the project: the version moves, so a form opened before cannot undo the status
      const tick = await api.put(`/api/projects/${project.id}/product-progress`, { items: [{ item_id: item.id, stage_order: 1, status: 'completed' }] });
      if (tick.status !== 200 || tick.body?.project_status !== 'completed') problems.push(`ticking the only cell answered ${tick.status} ${brief(tick.body)}, expected project_status completed`);
      const afterTick = Number((await stored()).version);
      if (afterTick <= v1 + 1) problems.push(`the matrix status change left version ${afterTick}, expected above ${v1 + 1}`);
      const stale = await api.put(`/api/projects/${project.id}`, { status: 'in_progress', version: v1 + 1 });
      if (stale.status !== 409) problems.push(`a save from before the matrix completion answered ${stale.status} ${brief(stale.body)}, expected 409`);
      const fresh = await api.put(`/api/projects/${project.id}`, { title: 'TD-742 fresh', version: afterTick });
      if (fresh.status !== 200 || Number(fresh.body?.version) !== afterTick + 1) problems.push(`a save from the current version answered ${fresh.status} with version ${String(fresh.body?.version)}, expected 200 and ${afterTick + 1}`);
      assertNoProblems(problems);
      return 'missing version 400; stale version 409 with nothing stored; saves and the matrix status change raise the version';
    }));
  }

  return results;
}
