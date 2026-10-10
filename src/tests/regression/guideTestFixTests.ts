import { TestCaseResult, makeTestCase } from '../types.js';

/**
 * Phase 3 lane L2 (TD-1190..TD-1193): app bugs the fresh-eyes guide test found. Server-side cases only; the browser
 * cases are Vitest files. Each case fails on v10.0.86.
 */
type ShouldRun = (id: string, ...extra: string[]) => boolean;

/** TD-1192: the server refuses a price list saved twice under one name */
async function priceListDuplicateRefused(): Promise<string> {
  const { SystemSettingsService } = await import('../../services/settings/systemSettings.service.js');
  const { SYSTEM_ADMIN_ROLE } = await import('../../lib/permissions/permissionCatalog.js');
  let code = '';
  try {
    await SystemSettingsService.saveSettings(
      [{ key: 'pricing_strategies', value: 'فروشگاه,عمده, فروشگاه' }],
      { id: 1, username: 'td1192', role: SYSTEM_ADMIN_ROLE },
    );
  } catch (err) {
    code = String((err as { code?: unknown }).code ?? '');
  }
  if (code !== 'SETTING_PRICE_LIST_NAMES_INVALID') throw new Error(`a repeated price list name was accepted (code "${code}")`);
  return 'repeated price list name refused with 422 SETTING_PRICE_LIST_NAMES_INVALID';
}

export async function runGuideTestFixTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], () => Promise<string>]> = [
    ['reg_price_list_names_unique_td_1192', 'v10.0.90: a repeated price list name is refused (TD-1192)', ['td1192'], priceListDuplicateRefused],
  ];
  for (const [id, name, tags, run] of cases) {
    if (!shouldRun(id, 'package16', ...tags)) continue;
    const t = Date.now();
    try {
      const details = await run();
      results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - t, details }));
    } catch (err) {
      results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - t, error: err instanceof Error ? err.message : String(err) }));
    }
  }
  return results;
}
