import { TestCaseResult, makeTestCase } from '../types.js';

type ShouldRun = (id: string, ...extra: string[]) => boolean;

/**
 * v10.0.25 (TD-959, OBS-R1-08): the seed logged each failed base data section and still answered `success: true`,
 * so the boot and the factory reset never knew a section was missing. Here one section's table is hidden in an
 * isolated schema; the seed must name that section in `failedSections`, answer `success: false` and still run the rest.
 */
export async function runSeedSectionTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const id = 'reg_seed_reports_failed_sections_td_959';
  if (!shouldRun(id, 'td959', 'obs-r1-08', 'seed', 'package1')) return [];
  const name = 'v10.0.21: the base data seed reports a failed section instead of success (TD-959)';
  const tStart = Date.now();
  const { pool } = await import('../../db/drizzle.js');
  let inner: { schema: string; teardown: () => Promise<void> } | null = null;
  let hidden = false;
  try {
    const { setupTestSchema } = await import('../setup/testDb.js');
    const { runSeed } = await import('../../db/seed.js');
    inner = await setupTestSchema();
    const current = (await pool.query('SELECT current_schema() AS s')).rows[0]?.s;
    if (current !== inner.schema) throw new Error(`isolated schema not active (${current} instead of ${inner.schema}); seed not run`);

    await pool.query(`ALTER TABLE "${inner.schema}".piecework_tasks RENAME TO piecework_tasks_td959`);
    hidden = true;
    const result = await runSeed({ migrate: async () => ({ success: true, appliedCount: 0, errors: [] }) });

    const wrong: string[] = [];
    if (result.success !== false) wrong.push(`success is ${String(result.success)} with a failed section`);
    const failed = (result as { failedSections?: string[] }).failedSections ?? [];
    if (!failed.includes('piecework tasks')) wrong.push(`failedSections does not name the piecework tasks: [${failed.join(', ')}]`);
    if (failed.length !== 1) wrong.push(`other sections reported as failed: [${failed.join(', ')}]`);
    if (wrong.length > 0) throw new Error(wrong.join('; '));
    return [makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: `seed result: ${result.message}`,
    })];
  } catch (err) {
    return [makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    })];
  } finally {
    if (inner && hidden) await pool.query(`ALTER TABLE "${inner.schema}".piecework_tasks_td959 RENAME TO piecework_tasks`);
    if (inner) await inner.teardown();
    const { invalidateSettingsCache } = await import('../../lib/memoryCache.js');
    invalidateSettingsCache();
  }
}
