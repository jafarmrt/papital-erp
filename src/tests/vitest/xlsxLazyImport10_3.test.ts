import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 10.3 package 6 (I-05, package-2 leftover): the xlsx library is loaded only when a file is made or read
 * (`import('xlsx')`, `downloadSheet`), never with the page that offers the button. A value import of it anywhere in the
 * app put the library into that page's bundle.
 */
const ROOT = join(__dirname, '..', '..');
/** a value import or re-export of xlsx, on one line or several; a type-only one is erased from the bundle */
const STATIC_XLSX = /^\s*(?:import|export)\s+(?!type\b)(?:[^;'"]*\bfrom\s+)?['"]xlsx['"]/m;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'tests' ? [] : sources(path);
    return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name) ? [path] : [];
  });
}

describe('xlsx_lazy_import_10_3', () => {
  it('no app file imports xlsx as a value', () => {
    const offenders = sources(ROOT).filter(file => STATIC_XLSX.test(readFileSync(file, 'utf8'))).map(file => relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  it('the guard would see a value import', () => {
    const seen = [
      "import * as xlsx from 'xlsx';",
      "import { utils } from 'xlsx';",
      "import {\n  utils,\n  writeFile,\n} from 'xlsx';",
      "import 'xlsx';",
      "export * from 'xlsx';",
      "export { utils } from \"xlsx\";",
    ];
    for (const source of seen) expect(STATIC_XLSX.test(source), source).toBe(true);
    const fine = [
      "import type { WorkBook } from 'xlsx';",
      "export type { WorkBook } from 'xlsx';",
      "const xlsx = await import('xlsx');",
      "import { a } from './a';\nconst name = 'xlsx';",
      "export const kind = 'xlsx';",
    ];
    for (const source of fine) expect(STATIC_XLSX.test(source), source).toBe(false);
  });
});
