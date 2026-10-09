import type { TestCaseResult } from '../types.js';
import type { Harness, ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture } from './documentEntryTests.js';
import { runReservationCases } from './stockReservationTests.js';
import { ALLOCATION_RELEASE_PLACE, allocationStatusLabel } from '../../lib/projects/allocationLabels.js';

/**
 * Series 10 phase 3, lane L3 (package 11): gaps of the project screens found while writing the role guide. Through the
 * real Express routes; each case is red on the code before its fix.
 */
export async function runProjectScreenGapsTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_open_allocation_refusal_names_release_place_td_1143',
      'v10.0.38: deleting or cancelling a project with an open allocation names the stock count page tab where it is released, not a project tab that does not exist (TD-1143)',
      ['td1143', 'projects', 'allocation', 'package11'], openAllocationRefusalCase],
    ['reg_allocation_refusal_status_label_td_1144',
      'v10.0.39: consuming or releasing an allocation that is no longer open says its status in Persian, never the status code (TD-1144)',
      ['td1144', 'projects', 'allocation', 'package11'], allocationStatusRefusalCase],
    ['reg_project_workflow_widget_startable_td_1142',
      'v10.0.40: the workflow widget learns there is no project workflow to start, and a project workflow is read only with the project read keys (TD-1142)',
      ['td1142', 'projects', 'workflow', 'package11'], projectWorkflowStartableCase],
  ]);
}

async function projectWithAllocation(h: Harness): Promise<{ projectId: number; allocationId: number }> {
  const f = await fixture(h);
  const material = await f.item(10, 1_000);
  const res = await h.post('/api/projects', { title: `P3 gaps ${h.tag} ${Math.floor(Math.random() * 1e6)}`, products: [] });
  if (res.status !== 201) throw new Error(`setup: project create answered ${brief(res)}`);
  const projectId = Number((res.body as { id?: unknown }).id);
  const allocated = await h.post('/api/inventory/allocations/allocate', { projectId, allocations: [{ itemId: material, quantity: 4, location: f.wh }] });
  const allocationId = Number((allocated.body as { data?: { allocations?: Array<{ id?: unknown }> } })?.data?.allocations?.[0]?.id);
  if (allocated.status !== 200 || !Number.isInteger(allocationId)) throw new Error(`setup: the allocation answered ${brief(allocated)}`);
  return { projectId, allocationId };
}

const messageOf = (res: { body: unknown }): string => String((res.body as { error?: unknown; message?: unknown })?.error ?? (res.body as { message?: unknown })?.message ?? '');

async function openAllocationRefusalCase(h: Harness, wrong: string[]): Promise<string> {
  const { projectId } = await projectWithAllocation(h);
  const deleted = await h.del(`/api/projects/${projectId}`);
  if (deleted.status < 400 || !messageOf(deleted).includes(ALLOCATION_RELEASE_PLACE)) wrong.push(`delete answered ${brief(deleted)}, expected a refusal naming the allocation tab of the stock count page`);
  const [row] = await h.q('SELECT version FROM production_projects WHERE id = $1', [projectId]);
  const cancelled = await h.put(`/api/projects/${projectId}`, { status: 'cancelled', version: Number(row?.version) });
  if (cancelled.status < 400 || !messageOf(cancelled).includes(ALLOCATION_RELEASE_PLACE)) wrong.push(`cancel answered ${brief(cancelled)}, expected a refusal naming the allocation tab of the stock count page`);
  return 'both refusals name where the allocation is released';
}

async function allocationStatusRefusalCase(h: Harness, wrong: string[]): Promise<string> {
  const { allocationId } = await projectWithAllocation(h);
  const released = await h.post(`/api/inventory/allocations/${allocationId}/release`, {});
  if (released.status !== 200) throw new Error(`setup: the release answered ${brief(released)}`);
  const releasedLabel = allocationStatusLabel('released');
  for (const action of ['release', 'consume']) {
    const again = await h.post(`/api/inventory/allocations/${allocationId}/${action}`, {});
    const text = messageOf(again);
    if (again.status !== 409) wrong.push(`${action} of a released allocation answered ${brief(again)}, expected 409`);
    if (/allocated|released|consumed/.test(text)) wrong.push(`${action} refusal prints a status code (${brief(again)})`);
    if (!text.includes(releasedLabel)) wrong.push(`${action} refusal does not name the released status in Persian (${brief(again)})`);
  }
  return 'both refusals name the allocation status in Persian';
}

async function projectWorkflowStartableCase(h: Harness, wrong: string[]): Promise<string> {
  const res = await h.post('/api/projects', { title: `P3 workflow ${h.tag} ${Math.floor(Math.random() * 1e6)}`, products: [] });
  if (res.status !== 201) throw new Error(`setup: project create answered ${brief(res)}`);
  const projectId = Number((res.body as { id?: unknown }).id);
  const [def] = await h.q(`SELECT count(*)::int AS n FROM workflow_definitions WHERE entity_type = 'project' AND is_active = 1`);
  const expected = Number(def?.n) > 0;
  const read = await h.get(`/api/workflow/instance/project/${projectId}`);
  const body = read.body as { instance?: unknown; startable?: unknown };
  if (read.status !== 200 || body.instance !== null || body.startable !== expected) wrong.push(`the project widget read answered ${brief(read)}, expected no instance and startable ${expected}`);
  const viewer = await h.sessionWith(['workflow.view']);
  const denied = await h.get(`/api/workflow/instance/project/${projectId}`, viewer);
  if (denied.status !== 403) wrong.push(`a workflow viewer without a project read key answered ${denied.status}, expected 403`);
  return `no instance, startable ${expected}; a viewer without a project key is refused`;
}
