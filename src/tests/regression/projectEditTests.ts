import { TestCaseResult } from '../types.js';
import { PROJECT_PRIORITIES, PROJECT_STATUSES, STAGE_STATUSES } from '../../lib/projects/projectStatus.js';
import { buildProjectValueHealthTest, findProjectFreeTextValues } from '../../services/projects/projectStageHealth.js';
import { type ShouldRun, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient } from './fiscalClosingTests.js';
import { brief, newProject, q } from './projectStageIntegrityTests.js';

/**
 * Package 11 (project control and production), PR «ب»: project edit and input — status and priority lists, delivery
 * and quantity input, stage completion time, audit rows, stages in the edit form and the project version. Runs on real
 * Express routes and PostgreSQL in an isolated schema and is red on the version before each fix.
 */

export async function runProjectEditTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const valuesId = 'reg_project_status_values_td_754';
  if (shouldRun(valuesId, 'td754', 'projects', 'package11')) {
    await runCase(results, valuesId, 'v9.0.338: a project status or priority or a stage status outside the UI lists is a 400 and is not stored; legacy free-text values are listed by the health check (TD-754)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const project = await newProject(api, {});
      const stored = async () => (await q('SELECT status, priority FROM production_projects WHERE id = $1', [project.id]))[0] ?? {};

      for (const body of [{ status: 'Completed' }, { status: 'تمام شده' }, { priority: 'خیلی فوری' }, { priority: 'normal' }]) {
        const res = await api.put(`/api/projects/${project.id}`, body);
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

      const valid = await api.put(`/api/projects/${project.id}`, { status: 'paused', priority: 'urgent' });
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

  return results;
}
