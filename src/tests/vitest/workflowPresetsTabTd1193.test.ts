import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { newWorkflowPreset } from '../../lib/settings/workflowPresetDraft';

// v10.0.89 (TD-1193): the stage preset screen points to the task titles settings, uses Persian words and digits,
// and does not save a placeholder as the description
const TAB = 'src/components/settings/WorkflowPresetsTab.tsx';
const RETIRED_WORDS = ['حقوق و دستمزد', 'ماژول', 'اتوماتیک', "description: 'شرح مختصر"];

describe('stage preset screen (TD-1193)', () => {
  it('numbers a new preset with Persian digits and leaves its description empty', () => {
    const preset = newWorkflowPreset('preset_1', 12);
    expect(preset.title).toBe('الگوی مراحل تولید ۱۲');
    expect(preset.description).toBe('');
  });

  it('names the task titles settings, not payroll, and has no transliteration', () => {
    const source = readFileSync(TAB, 'utf8');
    for (const word of RETIRED_WORDS) expect(source).not.toContain(word);
    expect(source).toContain('عناوین و دسته‌بندی‌های کاری');
  });
});
