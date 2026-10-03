import path from 'path';
import { describe, expect, it } from 'vitest';
import { ANY_RULE, compareAnyByFile, countAnyByFile, countByRule } from '../../../scripts/eslint-ratchet';

// TD-106 (v7.0.106، تصمیم مالک محصول): any به تفکیک فایل شمرده می‌شود؛ هیچ فایلی any بیشتری نمی‌گیرد و فایل تازه بدون any است.
const cwd = '/repo';
const any = { ruleId: ANY_RULE };
const lint = (file: string, messages: Array<{ ruleId: string | null }>, suppressed: Array<{ ruleId: string | null }> = []) =>
  ({ filePath: path.join(cwd, file), messages, suppressedMessages: suppressed });

describe('per-file any ratchet (TD-106)', () => {
  it('counts any per file, including any silenced with eslint-disable', () => {
    const counts = countAnyByFile([
      lint('src/a.ts', [any, any, { ruleId: 'max-lines' }]),
      lint('src/b.ts', [], [any]),
      lint('src/clean.ts', [{ ruleId: 'max-lines' }]),
    ], cwd);
    expect(counts).toEqual({ 'src/a.ts': 2, 'src/b.ts': 1 });
  });

  it('rejects a new file with any and any moved between files even when the total stays the same', () => {
    const baseline = { 'src/a.ts': 2 };
    expect(compareAnyByFile({ 'src/a.ts': 2, 'src/new.ts': 1 }, baseline).increased).toEqual([{ file: 'src/new.ts', baseline: 0, current: 1 }]);
    const moved = compareAnyByFile({ 'src/a.ts': 1, 'src/b.ts': 1 }, baseline);
    expect(moved.increased.map(i => i.file)).toEqual(['src/b.ts']);
    expect(moved.decreased.map(d => d.file)).toEqual(['src/a.ts']);
  });

  it('leaves any out of the per-rule totals', () => {
    expect(countByRule([lint('src/a.ts', [any, { ruleId: 'max-lines' }])]).counts).toEqual({ 'max-lines': 1 });
  });
});

describe('no any in server money/stock paths (TD-106, v7.0.109)', () => {
  it('rejects error-level messages, active or silenced with eslint-disable, whatever the baseline', async () => {
    const { findBlockingErrors } = await import('../../../scripts/eslint-ratchet');
    const blocking = findBlockingErrors([
      { filePath: path.join(cwd, 'src/routes/accounting.routes.ts'), messages: [{ ruleId: ANY_RULE, severity: 2, line: 3 }], suppressedMessages: [{ ruleId: ANY_RULE, severity: 2, line: 9 }] },
      { filePath: path.join(cwd, 'src/pages/ItemsPage.tsx'), messages: [{ ruleId: ANY_RULE, severity: 1, line: 4 }] },
    ], cwd);
    expect(blocking).toEqual([
      { file: 'src/routes/accounting.routes.ts', line: 3, ruleId: ANY_RULE, suppressed: false },
      { file: 'src/routes/accounting.routes.ts', line: 9, ruleId: ANY_RULE, suppressed: true },
    ]);
  });

  it('marks any as an error in money/stock files and leaves other files on the per-file ratchet', async () => {
    const { ESLint } = await import('eslint');
    const eslint = new ESLint({ cwd: process.cwd() });
    const severityIn = async (filePath: string) => {
      const config = await eslint.calculateConfigForFile(filePath) as { rules?: Record<string, unknown> };
      const rule = config.rules?.[ANY_RULE];
      return Array.isArray(rule) ? rule[0] : rule;
    };
    for (const file of ['src/services/procurement.service.ts', 'src/services/items/itemStockReservation.service.ts', 'src/routes/accounting.routes.ts', 'src/routes/inventory.routes.ts', 'src/lib/stockAvailability.ts']) {
      expect(await severityIn(file), file).toBe(2);
    }
    expect(await severityIn('src/pages/ItemsPage.tsx')).toBe(1);
  });
});
