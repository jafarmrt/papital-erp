import request from 'supertest';
import jwt from 'jsonwebtoken';
import { TestCaseResult, makeTestCase } from '../types.js';
import { createHarness, type Harness, type ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture } from './documentEntryTests.js';
import { createTestUser, TEST_PASSWORD } from '../fixtures/factories.js';
import { ROLE_TEMPLATES } from '../../lib/permissions/roleTemplates.js';
import { withRequiredPermissions } from '../../lib/permissions/permissionCatalog.js';

/**
 * v10.1.37 (N-01 part 1, TD-1283, mobile workshop plan): the data of the workshop cartable.
 * - Decision ت۱۱ الف: a role holding workshop.long_session (template «کارکن کارگاه») logs in for seven days, any other
 *   role, the system admin included, for 24 hours (token and cookie alike).
 * - Decision ت۳ الف: «مسئولان پروژه» are saved with the project (create and edit), read with the project record and
 *   audited; a deleted user or a repeated one refuses the save with nothing written.
 * - Decision ت۴ الف: a remittance and a material allocation carry their recipient personnel; only a remittance takes one,
 *   and a deleted or terminated personnel is refused before any stock movement.
 * Through the real Express routes with real sessions; red on the code before the change (24-hour login for everyone, no
 * managerUserIds, recipient ignored).
 */
export async function runWorkshopCartablePartOneTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (h: Harness, wrong: string[]) => Promise<string>]> = [
    ['reg_workshop_long_session_n01',
      'v10.1.37: a role holding only workshop.long_session and workshop.self logs in for seven days (token exp and cookie Max-Age), a role with any other key and the system admin for 24 hours, a permission change of such a role ends its users\' sessions, and the workshop worker template holds both workshop keys (N-01, TD-1283)',
      ['n01', 'workshop', 'auth', 'session'], longSessionCase],
    ['reg_project_managers_n01',
      'v10.1.37: project managers are saved on project create and edit, returned with the project record and audited with the added users; a newly added deleted user or a repeated one is 422 PROJECT_MANAGER_INVALID with nothing written, while a manager deleted later never blocks the save (N-01, TD-1283)',
      ['n01', 'workshop', 'projects'], projectManagersCase],
    ['reg_stock_recipient_n01',
      'v10.1.37: a remittance and a material allocation store their recipient personnel; a recipient on another document type is 422 RECIPIENT_REMITTANCE_ONLY and a deleted or terminated personnel 422 RECIPIENT_PERSONNEL_INVALID before any stock movement (N-01, TD-1283)',
      ['n01', 'workshop', 'documents', 'allocations'], recipientCase],
  ];
  for (const [id, name, tags, run] of cases) {
    if (!shouldRun(id, ...tags)) continue;
    const tStart = Date.now();
    let h: Harness | undefined;
    try {
      h = await createHarness();
      const wrong: string[] = [];
      const details = await run(h, wrong);
      if (wrong.length > 0) throw new Error(wrong.join('; '));
      results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details }));
    } catch (err) {
      results.push(makeTestCase({
        id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      await h?.cleanup();
    }
  }
  return results;
}

const codeOf = (res: { body?: unknown }) => (res.body as { code?: string })?.code;
const DAY = 24 * 60 * 60;

async function longSessionCase(h: Harness, wrong: string[]): Promise<string> {
  const loginLifetime = async (role: string) => {
    const user = await createTestUser({ role });
    try {
      const res = await request(h.app as never).post('/api/login').send({ username: user.username, password: TEST_PASSWORD });
      if (res.status !== 200) throw new Error(`login of ${role} answered ${brief(res)}`);
      const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find(c => c.startsWith('auth_token=')) ?? '';
      const token = raw.split(';')[0].replace(/^auth_token=/, '');
      const payload = jwt.decode(token) as { iat?: number; exp?: number } | null;
      const maxAge = Number(/Max-Age=(\d+)/i.exec(raw)?.[1]);
      return { tokenSeconds: Number(payload?.exp) - Number(payload?.iat), maxAge };
    } finally {
      await h.q(`DELETE FROM activity_logs WHERE user_id = $1`, [user.id]);
      await h.q(`DELETE FROM users WHERE id = $1`, [user.id]);
    }
  };
  const worker = await h.sessionWith(['workshop.self', 'workshop.long_session']);
  const keeper = await h.sessionWith(['warehouse.view', 'workshop.self']);
  const wider = await h.sessionWith(['workshop.self', 'workshop.long_session', 'warehouse.out']);
  const cases: Array<[string, string, number]> = [
    ['a role with workshop.long_session', worker.role, 7 * DAY],
    ['a role without it', keeper.role, DAY],
    ['a role with workshop.long_session and another key', wider.role, DAY],
    ['the system admin', 'admin', DAY],
  ];
  for (const [label, role, expected] of cases) {
    const got = await loginLifetime(role);
    if (got.tokenSeconds !== expected || got.maxAge !== expected) {
      wrong.push(`${label} logged in with a token of ${got.tokenSeconds} s and a cookie Max-Age of ${got.maxAge}, expected ${expected} for both`);
    }
  }

  // a permission change of a long-session role ends its users' sessions, so an old seven-day token gets no new key
  const member = await createTestUser({ role: worker.role });
  try {
    const versionOf = async () => Number((await h.q(`SELECT COALESCE(token_version, 0) AS v FROM users WHERE id = $1`, [member.id]))[0]?.v);
    const before = await versionOf();
    const [roleRow] = await h.q(`SELECT id FROM roles WHERE code = $1`, [worker.role]);
    const changed = await h.put(`/api/roles/${roleRow?.id}`, { permissions: ['workshop.self', 'workshop.long_session', 'warehouse.view'] });
    if (changed.status !== 200) wrong.push(`changing the long-session role answered ${brief(changed)}, expected 200`);
    if (await versionOf() !== before + 1) wrong.push(`after the long-session role changed its member has token version ${await versionOf()}, expected ${before + 1}`);
  } finally {
    await h.q(`DELETE FROM users WHERE id = $1`, [member.id]);
  }

  const template = ROLE_TEMPLATES.find(t => t.code === 'workshop_worker');
  if (!template || !template.permissions.includes('workshop.self') || !template.permissions.includes('workshop.long_session')) {
    wrong.push(`the workshop worker template is ${JSON.stringify(template ?? null)}, expected workshop.self and workshop.long_session`);
  } else if (withRequiredPermissions(template.permissions).length !== template.permissions.length) {
    wrong.push('the workshop worker template is not closed under requires');
  }
  return 'seven days for workshop.long_session, 24 hours otherwise';
}

interface ManagerRow { userId?: number; fullName?: string }

async function projectManagersCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const a = await createTestUser({ role: 'admin', fullName: `Manager A ${h.tag}` });
  const b = await createTestUser({ role: 'admin', fullName: `Manager B ${h.tag}` });
  const gone = await createTestUser({ role: 'admin', fullName: `Manager gone ${h.tag}` });
  await h.q(`UPDATE users SET is_deleted = 1 WHERE id = $1`, [gone.id]);
  const managersOf = async (projectId: number) => (await h.q(
    `SELECT user_id FROM project_managers WHERE project_id = $1 ORDER BY user_id`, [projectId])).map(r => Number(r.user_id));
  try {
    const created = await h.post('/api/projects', {
      title: `N01 managers ${h.tag} ${Math.floor(Math.random() * 1e6)}`, start_date: f.today, end_date: f.today, quantity: 1,
      managerUserIds: [a.id],
    });
    const projectId = Number((created.body as { id?: unknown }).id);
    if (created.status !== 201) throw new Error(`setup: project create answered ${brief(created)}`);
    if (JSON.stringify(await managersOf(projectId)) !== JSON.stringify([a.id])) wrong.push(`the created project has managers ${JSON.stringify(await managersOf(projectId))}, expected [${a.id}]`);
    const createdManagers = (created.body as { managers?: ManagerRow[] }).managers ?? [];
    if (createdManagers.length !== 1 || createdManagers[0]?.userId !== a.id) wrong.push(`the create answer carries managers ${JSON.stringify(createdManagers)}, expected user ${a.id}`);

    const versionOf = async () => Number((await h.q(`SELECT version FROM production_projects WHERE id = $1`, [projectId]))[0]?.version);
    const edited = await h.put(`/api/projects/${projectId}`, { version: await versionOf(), managerUserIds: [b.id, a.id] });
    if (edited.status !== 200) wrong.push(`editing the managers answered ${brief(edited)}, expected 200`);
    const expected = [a.id, b.id].sort((x, y) => x - y);
    if (JSON.stringify(await managersOf(projectId)) !== JSON.stringify(expected)) wrong.push(`after the edit the managers are ${JSON.stringify(await managersOf(projectId))}, expected ${JSON.stringify(expected)}`);
    const read = await h.get(`/api/projects/${projectId}`);
    const readIds = ((read.body as { managers?: ManagerRow[] }).managers ?? []).map(m => m.userId).sort((x, y) => Number(x) - Number(y));
    if (JSON.stringify(readIds) !== JSON.stringify(expected)) wrong.push(`GET /projects/:id returned managers ${JSON.stringify(readIds)}, expected ${JSON.stringify(expected)}`);
    const [audit] = await h.q(
      `SELECT details FROM activity_logs WHERE entity = 'پروژه تولید' AND entity_id = $1 AND description LIKE 'تغییر مسئولان پروژه%' ORDER BY id DESC LIMIT 1`,
      [String(projectId)]);
    const after = (audit?.details as { after?: { managers?: string[] } } | undefined)?.after?.managers ?? [];
    if (after.length !== 2) wrong.push(`the manager change audit row holds ${JSON.stringify(audit?.details ?? null)}, expected two managers after`);
    const addedIds = (audit?.details as { addedUserIds?: number[] } | undefined)?.addedUserIds ?? [];
    if (JSON.stringify(addedIds) !== JSON.stringify([b.id])) wrong.push(`the manager change audit row names added users ${JSON.stringify(addedIds)}, expected [${b.id}]`);

    // refusals: a deleted user and a repeated user change nothing (the project version stays too)
    const versionBefore = await versionOf();
    for (const [label, ids] of [['a deleted user', [a.id, gone.id]], ['a repeated user', [a.id, a.id]]] as Array<[string, number[]]>) {
      const res = await h.put(`/api/projects/${projectId}`, { version: versionBefore, managerUserIds: ids });
      if (res.status !== 422 || codeOf(res) !== 'PROJECT_MANAGER_INVALID') wrong.push(`${label} answered ${brief(res)}, expected 422 PROJECT_MANAGER_INVALID`);
    }
    if (JSON.stringify(await managersOf(projectId)) !== JSON.stringify(expected) || await versionOf() !== versionBefore) {
      wrong.push(`a refused manager change left managers ${JSON.stringify(await managersOf(projectId))} at version ${await versionOf()}, expected ${JSON.stringify(expected)} at ${versionBefore}`);
    }

    // an edit without managerUserIds keeps them; an empty list clears them
    const kept = await h.put(`/api/projects/${projectId}`, { version: await versionOf(), description: 'N01' });
    if (kept.status !== 200 || (await managersOf(projectId)).length !== 2) wrong.push(`an edit without managers answered ${brief(kept)} with ${(await managersOf(projectId)).length} managers, expected 200 and 2`);
    // a manager whose user was deleted later never blocks the project save: kept as is, or removed
    await h.q(`UPDATE users SET is_deleted = 1 WHERE id = $1`, [b.id]);
    const stays = await h.put(`/api/projects/${projectId}`, { version: await versionOf(), description: 'N01 b', managerUserIds: [a.id, b.id] });
    if (stays.status !== 200 || (await managersOf(projectId)).length !== 2) wrong.push(`keeping a manager whose user was deleted answered ${brief(stays)} with ${(await managersOf(projectId)).length} managers, expected 200 and 2`);
    const dropped = await h.put(`/api/projects/${projectId}`, { version: await versionOf(), managerUserIds: [a.id] });
    if (dropped.status !== 200 || JSON.stringify(await managersOf(projectId)) !== JSON.stringify([a.id])) wrong.push(`removing a deleted manager answered ${brief(dropped)} with managers ${JSON.stringify(await managersOf(projectId))}, expected 200 and [${a.id}]`);
    const cleared = await h.put(`/api/projects/${projectId}`, { version: await versionOf(), managerUserIds: [] });
    if (cleared.status !== 200 || (await managersOf(projectId)).length !== 0) wrong.push(`an empty manager list answered ${brief(cleared)} with ${(await managersOf(projectId)).length} managers, expected 200 and 0`);
    return `project ${projectId}: managers saved, read, audited and refused`;
  } finally {
    await h.q(`DELETE FROM project_managers WHERE user_id = ANY($1)`, [[a.id, b.id, gone.id]]);
    await h.q(`DELETE FROM users WHERE id = ANY($1)`, [[a.id, b.id, gone.id]]);
  }
}

async function recipientCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const newPersonnel = async (status: string, deleted = 0) => Number((await h.q(
    `INSERT INTO personnel (full_name, first_name, last_name, employment_status, is_deleted) VALUES ($1, 'N01', $1, $2, $3) RETURNING id`,
    [`N01 recipient ${h.tag} ${Math.floor(Math.random() * 1e6)}`, status, deleted]))[0]?.id);
  const active = await newPersonnel('فعال');
  const left = await newPersonnel('قطع همکاری');
  const removed = await newPersonnel('فعال', 1);
  const item = await f.item(30);
  const line = (qty: number) => [{ itemId: item, quantity: qty, unit_price: 1_000, location: f.wh }];
  const remittance = (extra: Record<string, unknown>) => f.doc('remittance', 'final', line(2), { inOut: 'out', buyer_name: 'N01', ...extra });

  // 1) a remittance stores its recipient
  const stored = await h.post('/api/documents', remittance({ recipientPersonnelId: active }));
  const docId = Number((stored.body as { docId?: unknown }).docId);
  if (stored.status !== 200) wrong.push(`a remittance with a recipient answered ${brief(stored)}, expected 200`);
  else {
    const [row] = await h.q(`SELECT recipient_personnel_id FROM documents WHERE id = $1`, [docId]);
    if (Number(row?.recipient_personnel_id) !== active) wrong.push(`the remittance stored recipient ${JSON.stringify(row ?? null)}, expected ${active}`);
  }
  const stockAfterFirst = await f.stock(item);

  // 2) refusals before any movement
  const refusals: Array<[string, Record<string, unknown>, string]> = [
    ['a terminated recipient', remittance({ recipientPersonnelId: left }), 'RECIPIENT_PERSONNEL_INVALID'],
    ['a deleted recipient', remittance({ recipientPersonnelId: removed }), 'RECIPIENT_PERSONNEL_INVALID'],
    ['a recipient on waste', f.doc('waste', 'final', line(1), { inOut: 'out', recipientPersonnelId: active }), 'RECIPIENT_REMITTANCE_ONLY'],
  ];
  for (const [label, body, code] of refusals) {
    const res = await h.post('/api/documents', body);
    if (res.status !== 422 || codeOf(res) !== code) wrong.push(`${label} answered ${brief(res)}, expected 422 ${code}`);
  }
  if (await f.stock(item) !== stockAfterFirst) wrong.push(`refused remittances moved stock to ${await f.stock(item)}, expected ${stockAfterFirst}`);

  // 3) a material allocation stores its recipient; a terminated one is refused with nothing moved
  const project = await h.post('/api/projects', { title: `N01 alloc ${h.tag} ${Math.floor(Math.random() * 1e6)}`, start_date: f.today, end_date: f.today, quantity: 1 });
  const projectId = Number((project.body as { id?: unknown }).id);
  if (project.status !== 201) throw new Error(`setup: project create answered ${brief(project)}`);
  const allocate = (recipientPersonnelId: number) => h.post('/api/inventory/allocations/allocate', {
    projectId, recipientPersonnelId, allocations: [{ itemId: item, quantity: 3, location: f.wh }],
  });
  const allocated = await allocate(active);
  const allocationId = Number((allocated.body as { data?: { allocations?: Array<{ id?: unknown }> } })?.data?.allocations?.[0]?.id);
  if (allocated.status !== 200) wrong.push(`an allocation with a recipient answered ${brief(allocated)}, expected 200`);
  else {
    const [row] = await h.q(`SELECT recipient_personnel_id FROM project_bom_allocations WHERE id = $1`, [allocationId]);
    if (Number(row?.recipient_personnel_id) !== active) wrong.push(`the allocation stored recipient ${JSON.stringify(row ?? null)}, expected ${active}`);
  }
  const stockAfterAllocation = await f.stock(item);
  const refused = await allocate(left);
  if (refused.status !== 422 || codeOf(refused) !== 'RECIPIENT_PERSONNEL_INVALID') wrong.push(`an allocation to a terminated recipient answered ${brief(refused)}, expected 422 RECIPIENT_PERSONNEL_INVALID`);
  if (await f.stock(item) !== stockAfterAllocation) wrong.push(`the refused allocation moved stock to ${await f.stock(item)}, expected ${stockAfterAllocation}`);
  return `remittance ${docId} and allocation ${allocationId} carry recipient ${active}`;
}
