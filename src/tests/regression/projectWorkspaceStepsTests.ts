import { eq, inArray } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { items, productionProjects, projectBomAllocations, purchaseRequisitions } from '../../db/schema.js';
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
  const id = 'reg_project_step_counts_v10_2_p2';
  if (!shouldRun(id, 'project', 'steps', 'workspace', 'v10_2')) return results;

  const tStart = Date.now();
  const projectIds: number[] = [];
  const itemIds: number[] = [];
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

    const counts = await loadProjectStepCounts(project.id);
    const expected = {
      requisitions: { open: 1, ordered: 2, received: 1 },
      allocations: { open: 1, consumed: 2 },
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
      id, name: 'v10.2 package 2: the step bar counts live requisitions by stage, allocations not released and planned products',
      layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details: 'counts as expected',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name: 'v10.2 package 2: the step bar counts live requisitions by stage, allocations not released and planned products',
      layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (projectIds.length > 0) {
      await orm.update(purchaseRequisitions).set({ isDeleted: 1 }).where(inArray(purchaseRequisitions.projectId, projectIds)).catch(() => undefined);
      await orm.update(projectBomAllocations).set({ isDeleted: 1 }).where(inArray(projectBomAllocations.projectId, projectIds)).catch(() => undefined);
      await orm.update(productionProjects).set({ isDeleted: 1 }).where(inArray(productionProjects.id, projectIds)).catch(() => undefined);
    }
    for (const itemId of itemIds) await orm.update(items).set({ isDeleted: 1 }).where(eq(items.id, itemId)).catch(() => undefined);
  }
  return results;
}
