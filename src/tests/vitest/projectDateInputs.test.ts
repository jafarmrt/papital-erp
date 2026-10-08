import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');
/** package 11 screens: projects page, project forms and tabs, BOM allocations */
const PACKAGE_11 = [
  'pages/ProjectsPage.tsx', 'components/ProjectModal.tsx', 'components/ProjectDetailModal.tsx', 'components/project/',
  'components/project-modal/', 'components/inventory/ProjectBomAllocationsTab.tsx', 'hooks/useProjectInventory.ts',
];

const filesUnder = (path: string): string[] => {
  const full = join(ROOT, path);
  if (!statSync(full).isDirectory()) return [full];
  return readdirSync(full).flatMap(name => filesUnder(join(path, name)));
};
const sources = () => PACKAGE_11.flatMap(filesUnder).filter(f => /\.tsx?$/.test(f)).map(f => ({ file: relative(ROOT, f), text: readFileSync(f, 'utf8') }));
const offending = (pattern: RegExp) => sources().filter(s => pattern.test(s.text)).map(s => s.file);

// v9.0.396 (TD-764): package 11 used react-multi-date-picker directly, Jalali text fields and toLocaleDateString
describe('package 11 date inputs follow the date rule (TD-764)', () => {
  it('picks dates only through JalaliDateInput', () => {
    expect(offending(/from ['"]react-multi-date-picker['"]/)).toEqual([]);
  });

  it('has no text field with a typed Jalali sample date', () => {
    expect(offending(/placeholder="[0-9۰-۹]{4}\/[0-9۰-۹]{2}\/[0-9۰-۹]{2}"/)).toEqual([]);
  });

  it('shows dates with formatPersianDate, never toLocaleDateString', () => {
    expect(offending(/toLocaleDateString/)).toEqual([]);
  });
});
