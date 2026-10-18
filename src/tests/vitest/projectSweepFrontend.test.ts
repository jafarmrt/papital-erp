import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

// Closing sweep, project observations of package 11: OBS-R2-46 (decimal allocation price, server clock) and OBS-R2-47
// (the project screens abort their effect requests on cleanup; the project delete refusal reaches the user).
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('OBS-R2-46: the material allocation service reads money as decimals and takes the time from the clock helpers', () => {
  const source = read('src/services/inventory/projectBomAllocation.service.ts');

  it('never turns the weighted average cost into a JS number and has no lastPurchasePrice fallback', () => {
    expect(source).not.toMatch(/Number\(\s*item\.weightedAverageCost/);
    expect(source).not.toContain('lastPurchasePrice');
    expect(source).toMatch(/function allocationUnitPrice\(item: ItemRow\): string \{\s*return fin\(item\.weightedAverageCost \?\? 0\)\.toString\(\);/);
  });

  it('writes allocated, consumed and released times with systemNowUtcIso, never new Date().toISOString()', () => {
    expect(source).not.toContain('new Date().toISOString()');
    expect(source.match(/systemNowUtcIso\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});

describe('OBS-R2-47: the project screens abort their effect requests on cleanup', () => {
  const files = [
    'src/components/inventory/ProjectBomAllocationsTab.tsx',
    // v10.2.7 (10.2 package 10): the progress matrix load moved into the hook shared with the phone list
    'src/hooks/useProductProgressTicks.ts',
    'src/components/settings/WorkflowPresetsTab.tsx',
  ];

  it.each(files)('%s passes an abort signal to its loads and aborts it in the effect cleanup', (file) => {
    const source = read(file);
    expect(source).toContain('new AbortController()');
    expect(source).toMatch(/return \(\) => controller\.abort\(\);/);
    expect(source).toMatch(/, \{ signal(: controller\.signal)? \}\)/);
    expect(source).toContain('isAbortError(err)');
    expect(source).not.toContain('isMounted');
  });

  it('the allocations tab buttons call the load without passing the click event as a signal', () => {
    const source = read('src/components/inventory/ProjectBomAllocationsTab.tsx');
    expect(source).not.toMatch(/onClick=\{loadAllocations\}/);
    expect(source).not.toMatch(/onRetry=\{loadAllocations\}/);
  });

  it('the projects page deletes through the mutation whose onError shows the server message, never an uncaught mutateAsync', () => {
    const page = read('src/pages/ProjectsPage.tsx');
    expect(page).not.toContain('mutateAsync(');
    expect(page).toContain('deleteProjectMutation.mutate(id)');
    const hooks = read('src/hooks/queries/useProjectQueries.ts');
    expect(hooks).toMatch(/useDeleteProjectMutation[\s\S]*onError:[\s\S]*toast\.error\(/);
  });
});
