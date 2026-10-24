import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 10.3 package 6 (I-05, package-2 leftover): the xlsx library is loaded only when a file is made or read
 * (`import('xlsx')`, `downloadSheet`), never with the page that offers the button. A value import of it anywhere in the
 * app put the library into that page's bundle.
 */
const ROOT = join(__dirname, '..', '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'tests' ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('xlsx_lazy_import_10_3', () => {
  it('no app file imports xlsx as a value', () => {
    const staticImport = /^\s*import\s+(?!type\b)[^;]*\bfrom\s+['"]xlsx['"]/m;
    const offenders = sources(ROOT).filter(file => staticImport.test(readFileSync(file, 'utf8'))).map(file => relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  it('the guard would see a value import', () => {
    const staticImport = /^\s*import\s+(?!type\b)[^;]*\bfrom\s+['"]xlsx['"]/m;
    expect(staticImport.test("import * as xlsx from 'xlsx';")).toBe(true);
    expect(staticImport.test("import { utils } from 'xlsx';")).toBe(true);
    expect(staticImport.test("import type { WorkBook } from 'xlsx';")).toBe(false);
  });
});
