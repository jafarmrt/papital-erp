import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// v9.0.424 (TD-769 / B11-35, owner decision t10 A of package 11): Persian text of the project and production screens and
// of the project server messages has no English word and none of the replaced loanwords.

const ROOT = join(__dirname, '..', '..');
const PERSIAN = /[؀-ۿ]/;
const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|>[^<>{}]*</g;

const PROJECT_TEXT = [
  'pages/ProjectsPage.tsx', 'pages/ProjectInventoryPage.tsx', 'components/ProjectModal.tsx', 'components/ProjectDetailModal.tsx',
  'components/project/', 'components/project-modal/', 'components/inventory/ProjectBomAllocationsTab.tsx',
  'components/settings/InventoryControlPresetTab.tsx', 'components/settings/WorkflowPresetsTab.tsx', 'constants/inventoryControlPresets.ts',
  'hooks/useProjectInventory.ts', 'hooks/queries/useProjectQueries.ts', 'lib/projects/', 'routes/projects.routes.ts', 'services/projects/',
];

/** t10 A: BOM → «فهرست مواد», freeze → «رزرو», Gantt → «نمودار زمان‌بندی», chart, server → «سامانه», item → «قلم», material, phase, catalog */
const REPLACED = /فریز|گانت|چارت|سرور|آیتم|متریال|(?:^|[\s«(])فاز(?:[\s»)،.]|$)|کاتالوگ/;
/** a Latin word inside Persian text, except key names, file formats and the debt ids the health check names */
const LATIN_WORD = /(?<![.\w])[A-Za-z]{2,}/g;
const ALLOWED_LATIN = new Set(['Esc', 'Enter', 'PDF', 'IRR', 'USD', 'EUR', 'AED', 'GBP']);
const englishWords = (text: string) => (text.replace(/\bTD-\d+/g, '').match(LATIN_WORD) ?? []).filter(w => !ALLOWED_LATIN.has(w));
/** a number shown with the Latin percent sign after a JSX expression (`{x}%`), not a CSS width (`${x}%`) */
const LATIN_PERCENT = /(?<!\$)\{[^{}]*\}%/;

/** a count shown beside Persian text with Latin digits (`{rows.length}`, `${shortfallCount}`) */
const LATIN_COUNT = /(?<![\w.])\$?\{[\w.?]+(?:\.length|Count)\}/;

/** the text without the code of its template placeholders, nested braces included */
function withoutPlaceholders(line: string): string {
  let out = '';
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '$' && line[i + 1] === '{') {
      let depth = 0;
      for (i += 1; i < line.length; i++) {
        if (line[i] === '{') depth++;
        else if (line[i] === '}' && --depth === 0) break;
      }
      continue;
    }
    out += line[i];
  }
  return out;
}

function sourceFiles(path: string): string[] {
  const full = join(ROOT, path);
  if (!statSync(full).isDirectory()) return [full];
  return readdirSync(full).flatMap(name => sourceFiles(join(path, name))).filter(f => /\.(ts|tsx)$/.test(f));
}

/** a source line without comments and without the code placed inside template literals (nested ones included) */
function codeLine(raw: string): string {
  let line = raw.trim();
  if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*') || line.startsWith('{/*')) return '';
  line = line.replace(/\s\/\/\s.*$/, '').replace(/\{\/\*.*?\*\/\}/g, '').replace(/\s[<>]=?\s|=>/g, ' ');
  return withoutPlaceholders(line);
}

function persianTexts(file: string): Array<{ line: number; text: string }> {
  const found: Array<{ line: number; text: string }> = [];
  readFileSync(file, 'utf8').split('\n').forEach((raw, i) => {
    const line = codeLine(raw);
    const texts: string[] = [...(line.match(LITERAL) ?? [])];
    if (!/[<>{}'"`=;]/.test(line)) texts.push(line);
    for (const text of texts) {
      const shown = text.replace(/^[>'"`]|[<'"`]$/g, '');
      if (PERSIAN.test(shown)) found.push({ line: i + 1, text: shown });
    }
  });
  return found;
}

function persianLines(file: string): Array<{ line: number; text: string }> {
  return readFileSync(file, 'utf8').split('\n').map((raw, i) => ({ line: i + 1, text: codeLine(raw) })).filter(t => PERSIAN.test(t.text));
}

const files = PROJECT_TEXT.flatMap(sourceFiles);
const where = (f: string, t: { line: number; text: string }) => `${relative(ROOT, f)}:${t.line}: ${t.text}`;

describe('Project UI wording (TD-769)', () => {
  it('reads the project files', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it('has no English words in Persian project text', () => {
    const offenders = files.flatMap(f => persianTexts(f).filter(t => englishWords(t.text).length > 0).map(t => where(f, t)));
    expect(offenders).toEqual([]);
  });

  it('uses the decided words, not the replaced ones', () => {
    const offenders = files.flatMap(f => persianLines(f).filter(t => REPLACED.test(t.text)).map(t => where(f, t)));
    expect(offenders).toEqual([]);
  });

  it('shows counts beside Persian text with Persian digits', () => {
    const offenders = files.flatMap(f => readFileSync(f, 'utf8').split('\n').map((raw, i) => ({ line: i + 1, text: raw.trim() }))
      .filter(t => !t.text.startsWith('//') && PERSIAN.test(t.text) && LATIN_COUNT.test(t.text)).map(t => where(f, t)));
    expect(offenders).toEqual([]);
  });

  it('shows percents with the Persian sign', () => {
    const offenders = files.filter(f => f.endsWith('.tsx')).flatMap(f => readFileSync(f, 'utf8').split('\n')
      .map((text, i) => ({ line: i + 1, text: text.trim() })).filter(t => LATIN_PERCENT.test(t.text)).map(t => where(f, t)));
    expect(offenders).toEqual([]);
  });
});
