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
