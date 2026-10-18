import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { documents, items, productionProjects, projectBomAllocations, purchaseRequisitions, roles, users } from '../../db/schema.js';
import { loadProjectStepCounts } from '../../services/projects/projectSteps.js';
import { TestCaseResult, makeTestCase } from '../types.js';

/**
 * 10.2 package 2 (production projects review U4): the counts of a project page's step bar, `GET /projects/:id/steps`.
 * The route did not exist before, so the test is red on the version before it.
 */

type ShouldRun = (id: string, ...extra: string[]) => boolean;

let seq = 0;
const tagOf = () => `${String(Date.now()).slice(-6)}${++seq}`;

export async function runProjectWorkspaceStepsTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const counts = await runStepCountsTest(shouldRun);
  if (counts) results.push(counts);
  const access = await runStepsRouteAccessTest(shouldRun);
  if (access) results.push(access);
  return results;
}

async function runStepCountsTest(shouldRun: ShouldRun): Promise<TestCaseResult | null> {
  const results: TestCaseResult[] = [];
  const id = 'reg_project_step_counts_v10_2_p2';
  if (!shouldRun(id, 'project', 'steps', 'workspace', 'v10_2')) return null;

  const tStart = Date.now();
  const projectIds: number[] = [];
  const itemIds: number[] = [];
  const documentIds: number[] = [];
  try {
    const problems: string[] = [];
    const tag = tagOf();
    const [item] = await orm.insert(items).values({ code: `STEP-${tag}`, name: `step bead ${tag}`, type: 'raw_material', unit: 'عدد' })
      .returning({ id: items.id, code: items.code, name: items.name });
    itemIds.push(item.id);
    const [product] = await orm.insert(items).values({ code: `STEPP-${tag}`, name: `step necklace ${tag}`, type: 'product', unit: 'عدد' })
      .returning({ id: items.id, code: items.code, name: items.name });
    itemIds.push(product.id);
    const [project] = await orm.insert(productionProjects).values({
      projectCode: `STEP-${tag}`, title: `Step bar ${tag}`, status: 'in_progress',
      products: [{ id: 'p1', item_id: product.id, item_code: product.code, item_name: product.name, quantity: 12, unit: 'عدد' }],
    }).returning({ id: productionProjects.id, projectCode: productionProjects.projectCode });
    projectIds.push(project.id);

    const requisition = (suffix: string, status: string, isDeleted = 0) => ({
      code: `STEP-${tag}-${suffix}`, title: `step ${suffix}`, projectId: project.id, status, isDeleted, items: [],
    });
    await orm.insert(purchaseRequisitions).values([
      requisition('a', 'pending'),
      requisition('b', 'approved'),
      requisition('c', 'ordered'),
      requisition('d', 'received'),
      requisition('e', 'rejected'),
      requisition('f', 'consolidated'),
      requisition('g', 'pending', 1),
    ]);
    const allocation = (status: string, isDeleted = 0) => ({
      projectId: project.id, projectCode: project.projectCode, itemId: item.id, itemCode: item.code, itemName: item.name,
      quantity: 1, status, isDeleted,
    });
    await orm.insert(projectBomAllocations).values([allocation('allocated'), allocation('consumed'), allocation('consumed'), allocation('released'), allocation('allocated', 1)]);
    // review M4: a live final remittance or waste of the project issues material too; a draft, a voided one, another
    // project's and a sales invoice naming the project do not count
    const doc = (suffix: string, type: string, status: string, isDeleted = 0, projectId: number | null = project.id) => ({
      type, refNumber: `STEP-${tag}-${suffix}`, date: '2026-10-01 10:00:00', projectId, status, isDeleted, buyerName: 'step',
    });
    await orm.insert(documents).values([
      doc('r1', 'remittance', 'final'),
      doc('w1', 'waste', 'final'),
      doc('r2', 'remittance', 'draft'),
      doc('r3', 'remittance', 'final', 1),
      doc('r4', 'remittance', 'final', 0, null),
      doc('i1', 'invoice', 'final'),
    ]).returning({ id: documents.id }).then(rows => documentIds.push(...rows.map(r => r.id)));

    const counts = await loadProjectStepCounts(project.id);
    const expected = {
      requisitions: { open: 1, ordered: 2, received: 1 },
      allocations: { open: 1, consumed: 2, issueDocuments: 2 },
      delivery: { products: 1, completeProducts: 0, delivered: 0, planned: 12, unit: 'عدد' },
    };
    if (JSON.stringify(counts) !== JSON.stringify(expected)) problems.push(`counts ${JSON.stringify(counts)}, expected ${JSON.stringify(expected)}`);

    let missing = '';
    try {
      await loadProjectStepCounts(project.id + 1_000_000);
      missing = 'no error';
    } catch (err) {
      missing = (err as { statusCode?: number } | null)?.statusCode === 404 ? '' : `error ${String((err as Error)?.message)}`;
    }
    if (missing) problems.push(`a missing project must be 404 (${missing})`);

    if (problems.length > 0) throw new Error(problems.join(' | '));
    results.push(makeTestCase({
      id, name: 'v10.2 package 2: the step bar counts live requisitions by stage, allocations not released, final project issues and planned products',
      layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details: 'counts as expected',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name: 'v10.2 package 2: the step bar counts live requisitions by stage, allocations not released, final project issues and planned products',
      layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (projectIds.length > 0) {
      await orm.update(purchaseRequisitions).set({ isDeleted: 1 }).where(inArray(purchaseRequisitions.projectId, projectIds)).catch(() => undefined);
      await orm.update(projectBomAllocations).set({ isDeleted: 1 }).where(inArray(projectBomAllocations.projectId, projectIds)).catch(() => undefined);
      await orm.update(productionProjects).set({ isDeleted: 1 }).where(inArray(productionProjects.id, projectIds)).catch(() => undefined);
    }
    if (documentIds.length > 0) await orm.update(documents).set({ isDeleted: 1 }).where(inArray(documents.id, documentIds)).catch(() => undefined);
    for (const itemId of itemIds) await orm.update(items).set({ isDeleted: 1 }).where(eq(items.id, itemId)).catch(() => undefined);
  }
  return results[0] ?? null;
}

/** review L8: the route opens with the project read keys only and answers 404 for a deleted project */
async function runStepsRouteAccessTest(shouldRun: ShouldRun): Promise<TestCaseResult | null> {
  const id = 'reg_project_step_route_access_v10_2_p2';
  const name = 'v10.2 package 2: GET /projects/:id/steps answers a project reader, refuses another key with 403 and a deleted project with 404';
  if (!shouldRun(id, 'project', 'steps', 'workspace', 'v10_2')) return null;
  const tStart = Date.now();
  const roleIds: number[] = [];
  const userIds: number[] = [];
  const projectIds: number[] = [];
  try {
    const { getTestApp, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestRole, createTestUser } = await import('../fixtures/factories.js');
    const app = await getTestApp();
    const tag = tagOf();
    const [live, gone] = await orm.insert(productionProjects).values([
      { projectCode: `STEPR-${tag}`, title: `Step route ${tag}`, status: 'planned', products: [] },
      { projectCode: `STEPD-${tag}`, title: `Step route deleted ${tag}`, status: 'planned', products: [], isDeleted: 1 },
    ]).returning({ id: productionProjects.id });
    projectIds.push(live.id, gone.id);

    const wrong: string[] = [];
    for (const [permissions, projectId, expected] of [
      [['projects.view'], live.id, 200], [['products.view'], live.id, 403], [['projects.view'], gone.id, 404],
    ] as const) {
      const role = await createTestRole({ permissions: [...permissions] });
      roleIds.push(role.id);
      const user = await createTestUser({ role: role.code });
      userIds.push(user.id);
      const session = await loginTestUserWithSession(app, user.username);
      const res = await request(app).get(`/api/projects/${projectId}/steps`).set('Cookie', session.cookie);
      if (res.status !== expected) wrong.push(`${permissions.join('+')} on project ${projectId}: ${res.status}, not ${expected}`);
      if (expected === 200 && typeof res.body?.allocations?.issueDocuments !== 'number') wrong.push('the answer has no issue document count');
    }
    if (wrong.length > 0) throw new Error(wrong.join(' | '));
    return makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details: '200 / 403 / 404 as expected' });
  } catch (err) {
    return makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    if (projectIds.length > 0) await orm.update(productionProjects).set({ isDeleted: 1 }).where(inArray(productionProjects.id, projectIds)).catch(() => undefined);
    if (userIds.length > 0) await orm.update(users).set({ isDeleted: 1 }).where(inArray(users.id, userIds)).catch(() => undefined);
    if (roleIds.length > 0) await orm.delete(roles).where(inArray(roles.id, roleIds)).catch(() => undefined);
  }
}
