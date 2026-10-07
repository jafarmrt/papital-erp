import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

/**
 * Package 1 (B01-45, owner rule t9): everything a terminal shows is English, because terminals render Persian
 * (right to left, joined letters) badly. This ratchet counts, per file, the places that still print Persian to a
 * terminal, and fails when a file gains one:
 *
 *   npm run ratchet:terminal-english              check against terminal-english-baseline.json
 *   npm run ratchet:terminal-english -- --update  write the current (lower) counts; the baseline may only shrink
 *
 * Counted (a "site" is one statement or call, whatever the number of Persian words in it):
 * - shell and PowerShell scripts (`*.sh`, `*.ps1`): every line that is not a comment and contains Persian;
 * - TypeScript and JavaScript: a `console.*`, `logger.*`, `process.stdout.write` or `process.stderr.write` call with a
 *   Persian literal among its arguments;
 * - CLI scripts, the check:version guards and tests (`scripts/`, `src/data/changelogs/`, `src/tests/`, `e2e/`):
 *   `new ...Error(...)`, a `fail(...)` / `die(...)` call and a message pushed onto a violation or error list
 *   (`violations.push(...)`, `errors.push(...)`, `v.push(...)`) with a Persian literal, since these end up printed;
 * - tests: a Vitest / Playwright name (`describe`, `it`, `test`), and a runner test name: the `name` (or `title`,
 *   `description`) of an object whose `id` is a test id or that has a `layer`, the Persian element of a tuple that
 *   starts with a test id, and a Persian argument of a call that also takes a test id.
 * Not counted (they stay Persian): comments, user-facing text (UI, API error messages), text a script writes into a
 * file (changelog, TECH_DEBT.md), and test data that is not a test name.
 */

export const BASELINE_FILE = 'terminal-english-baseline.json';

const PERSIAN = /[؀-ۿﭐ-﷿ﹰ-﻿]/;
/** A runner test id: lower-case words joined by underscores, such as `rec_td_603_update_rollback_stays_on_branch` */
const TEST_ID = /^[a-z][a-z0-9]*_[a-z0-9_]+$/;
const OUTPUT_OBJECTS = new Set(['console', 'logger']);
const TEST_NAME_CALLS = new Set(['describe', 'it', 'test']);
const NAME_KEYS = new Set(['name', 'title', 'description']);
/** Lists of messages that a script or test prints when it fails */
const MESSAGE_LISTS = /^(v|violations|errors|issues|problems|failures|warnings)$/;
const FAIL_CALLS = new Set(['fail', 'die', 'abort']);

/** Changelog entries are data shown in the app, not terminal output (the guards next to them are counted) */
const CHANGELOG_DATA = /^src\/data\/changelogs\/(\d+|archive_[\w]+)\.ts$/;

export type Baseline = Record<string, number>;

export const hasPersian = (text: string): boolean => PERSIAN.test(text);

/** Code part of a shell or PowerShell line: `#` starts a comment outside quotes (`$#` and `${#x}` are not comments) */
export function shellCodePart(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\' && quote === '"') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

export function countShellSites(source: string): number {
  let count = 0;
  let inBlockComment = false;
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (inBlockComment) {
      if (line.includes('#>')) inBlockComment = false;
      continue;
    }
    if (line.startsWith('<#')) {
      inBlockComment = !line.includes('#>');
      continue;
    }
    if (hasPersian(shellCodePart(line))) count++;
  }
  return count;
}

function literalTexts(node: ts.Node): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    else if (ts.isTemplateExpression(n)) {
      out.push(n.head.text, ...n.templateSpans.map(s => s.literal.text));
    } else if (ts.isJsxText(n)) out.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

const anyPersian = (nodes: readonly ts.Node[]): boolean => nodes.some(n => literalTexts(n).some(hasPersian));
const stringValue = (n: ts.Node | undefined): string | undefined =>
  n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : undefined;

/** `console.log`, `logger.error`, `process.stdout.write` */
function isOutputCall(callee: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(callee)) return false;
  const target = callee.expression;
  if (ts.isIdentifier(target)) return OUTPUT_OBJECTS.has(target.text);
  return ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.expression) && target.expression.text === 'process'
    && (target.name.text === 'stdout' || target.name.text === 'stderr') && callee.name.text === 'write';
}

/** `violations.push(...)`, `fail(...)` */
function isMessageCall(callee: ts.Expression): boolean {
  if (ts.isIdentifier(callee)) return FAIL_CALLS.has(callee.text);
  return ts.isPropertyAccessExpression(callee) && callee.name.text === 'push' && ts.isIdentifier(callee.expression)
    && MESSAGE_LISTS.test(callee.expression.text);
}

/** `describe(...)`, `it.only(...)`, `test.skip(...)` */
function isTestNameCall(callee: ts.Expression): boolean {
  if (ts.isIdentifier(callee)) return TEST_NAME_CALLS.has(callee.text);
  return ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && TEST_NAME_CALLS.has(callee.expression.text);
}

export function countSourceSites(file: string, source: string): number {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const terminalErrors = /^(scripts\/|src\/data\/changelogs\/|src\/tests\/|e2e\/)/.test(file);
  const tests = /^(src\/tests\/|e2e\/)/.test(file) || /\.(test|spec)\.tsx?$/.test(file);
  let count = 0;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (isOutputCall(callee)) {
        if (anyPersian(node.arguments)) count++;
      } else if (terminalErrors && isMessageCall(callee)) {
        if (anyPersian(node.arguments)) count++;
      } else if (tests && isTestNameCall(node.expression)) {
        if (node.arguments[0] && anyPersian([node.arguments[0]])) count++;
      } else if (tests && node.arguments.some(a => TEST_ID.test(stringValue(a) ?? ''))) {
        if (node.arguments.some(a => hasPersian(stringValue(a) ?? ''))) count++;
      }
    } else if (ts.isNewExpression(node) && terminalErrors) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && callee.text.endsWith('Error') && anyPersian(node.arguments ?? [])) count++;
    } else if (tests && ts.isObjectLiteralExpression(node)) {
      const props = new Map<string, ts.Expression>();
      for (const p of node.properties) {
        if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) props.set(p.name.text, p.initializer);
      }
      const isTestCase = TEST_ID.test(stringValue(props.get('id')) ?? '') || props.has('layer');
      if (isTestCase && [...NAME_KEYS].some(k => hasPersian(stringValue(props.get(k)) ?? ''))) count++;
    } else if (tests && ts.isArrayLiteralExpression(node)) {
      const [first, ...rest] = node.elements;
      if (TEST_ID.test(stringValue(first) ?? '') && rest.some(e => hasPersian(stringValue(e) ?? ''))) count++;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return count;
}

export function countFileSites(file: string, source: string): number {
  if (/\.(sh|ps1)$/.test(file)) return countShellSites(source);
  if (CHANGELOG_DATA.test(file)) return 0;
  if (/\.(ts|tsx|mjs|cjs|js)$/.test(file) && !file.endsWith('.d.ts')) return countSourceSites(file, source);
  return 0;
}

/** Tracked files that can print to a terminal: scripts, hooks, server and test sources (not the browser bundle's UI) */
export function terminalFiles(root = process.cwd()): string[] {
  const listed = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  return listed.filter(f =>
    /\.(sh|ps1)$/.test(f)
    || (/^(src|scripts|e2e)\//.test(f) && /\.(ts|tsx|mjs|cjs|js)$/.test(f))
    || /^(server|vite\.config|playwright\.config|vitest\.config)\.(ts|mjs|js)$/.test(f),
  ).filter(f => fs.existsSync(path.join(root, f))).sort();
}

export function currentState(root = process.cwd()): Baseline {
  const counts: Baseline = {};
  for (const file of terminalFiles(root)) {
    const n = countFileSites(file, fs.readFileSync(path.join(root, file), 'utf8'));
    if (n > 0) counts[file] = n;
  }
  return counts;
}

export interface RatchetReport {
  errors: string[];
  stale: string[];
}

/** A grown count or a new file is an error; a shrunk count is a stale baseline to lower */
export function compareWithBaseline(current: Baseline, baseline: Baseline): RatchetReport {
  const errors: string[] = [];
  const stale: string[] = [];
  for (const file of [...new Set([...Object.keys(current), ...Object.keys(baseline)])].sort()) {
    const c = current[file] ?? 0;
    const b = baseline[file] ?? 0;
    if (c > b) errors.push(`${file}: Persian terminal output ${b} -> ${c}; write terminal messages, logs and test names in English`);
    else if (c < b) stale.push(`${file}: Persian terminal output ${b} -> ${c}`);
  }
  return { errors, stale };
}

const total = (b: Baseline) => Object.values(b).reduce((a, n) => a + n, 0);

function main(): void {
  const baselinePath = path.resolve(process.cwd(), BASELINE_FILE);
  const current = currentState();
  const baseline: Baseline = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : {};
  const { errors, stale } = compareWithBaseline(current, baseline);
  if (errors.length > 0) {
    for (const e of errors) console.error(`FAIL ${e}`);
    console.error('The terminal-English baseline may only shrink; translate the new output instead of raising it.');
    process.exit(1);
  }
  if (process.argv.includes('--update')) {
    fs.writeFileSync(baselinePath, JSON.stringify(current, null, 2) + '\n');
    console.log(`Terminal-English baseline updated: ${total(current)} Persian output sites in ${Object.keys(current).length} files`);
    return;
  }
  if (stale.length > 0) {
    for (const s of stale) console.error(`LOWER ${s}`);
    console.error('Persian output went down; run `npm run ratchet:terminal-english -- --update` and commit terminal-english-baseline.json.');
    process.exit(1);
  }
  console.log(`Terminal-English ratchet OK: ${total(current)} Persian output sites in ${Object.keys(current).length} files`);
}

if (process.argv[1]?.endsWith('terminal-english-ratchet.ts') || process.argv[1]?.endsWith('terminal-english-ratchet.js')) {
  main();
}
