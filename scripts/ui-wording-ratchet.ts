import fs from 'fs';
import path from 'path';
import ts from 'typescript';

/**
 * v10.0.51 (TD-1168, product-owner glossary of packages 2, 8, 11 and 16): user-facing text says «سامانه», «فهرست», «دوطرفه» and
 * «پالایش» / «شرط‌های جستجو», never «سیستم», «کاتالوگ», «فیلتر» or «دوبل» (owner rule: only «کاردکس»,
 * «ترنسفر» and «وب‌هوک» stay transliterated). The per-package wording tests cover only their own
 * files, so these words were still shown on other screens. This ratchet counts, per browser source file, the user-facing
 * texts (string and template literals and JSX text, never comments) that hold one of these words, and fails when a file
 * gains one:
 *
 *   npm run ratchet:ui-wording              check against ui-wording-baseline.json
 *   npm run ratchet:ui-wording -- --update  write the current (lower) counts; the baseline may only shrink
 */

export const BASELINE_FILE = 'ui-wording-baseline.json';

/** Browser code: pages, components, hooks, contexts and the shared lib (whose messages the screens show) */
const ROOTS = ['src/pages', 'src/components', 'src/hooks', 'src/contexts', 'src/lib'];
/**
 * v10.0.117 (TD-1182): server code whose error messages reach the user as they are; only the literals inside
 * `new …Error(…)` count there, never logs or stored names
 */
const SERVER_ROOTS = ['src/services', 'src/routes', 'src/middleware', 'src/errors'];
const LETTER = '[\\u0621-\\u064A\\u067E\\u0686\\u0698\\u06A9\\u06AF\\u06CC]';
/** «سیستم» (and «سیستمی»), «کاتالوگ», «فیلتر» (and «فیلترها»), «دوبل»; a longer word that only starts with one is not matched */
export const FORBIDDEN = new RegExp(`(?<!${LETTER})((?:سیستم|کاتالوگ|فیلتر|دوبل)(?:‌?(?:هایی|های|ها)|ی)?)(?!${LETTER})`);

export type Baseline = Record<string, number>;

/** Number of user-facing texts in a source file that hold a forbidden word */
export function countFileSites(source: string, fileName = 'file.tsx'): number {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)
      || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)
    ) {
      if (FORBIDDEN.test(node.text)) count++;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return count;
}

const isTextNode = (node: ts.Node): boolean =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)
  || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);

/** Number of texts inside an error constructor's arguments (`new XxxError(…)`) that hold a forbidden word */
export function countServerMessageSites(source: string, fileName = 'file.ts'): number {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let count = 0;
  const visit = (node: ts.Node, inError: boolean): void => {
    const insideError = inError || (ts.isNewExpression(node) && /Error$/.test(node.expression.getText(sf)));
    if (insideError && isTextNode(node) && FORBIDDEN.test((node as ts.LiteralLikeNode).text)) count++;
    ts.forEachChild(node, child => visit(child, insideError));
  };
  visit(sf, false);
  return count;
}

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name) ? [full] : [];
  });
}

export function currentState(root = process.cwd()): Baseline {
  const state: Baseline = {};
  for (const dir of ROOTS) {
    for (const file of sourceFiles(path.join(root, dir))) {
      const rel = path.relative(root, file).split(path.sep).join('/');
      const count = countFileSites(fs.readFileSync(file, 'utf8'), rel);
      if (count > 0) state[rel] = count;
    }
  }
  for (const dir of SERVER_ROOTS) {
    for (const file of sourceFiles(path.join(root, dir))) {
      const rel = path.relative(root, file).split(path.sep).join('/');
      if (rel.includes('/tests/')) continue;
      const count = countServerMessageSites(fs.readFileSync(file, 'utf8'), rel);
      if (count > 0) state[rel] = count;
    }
  }
  return Object.fromEntries(Object.entries(state).sort(([a], [b]) => a.localeCompare(b)));
}

/** Files that gained a site, and files that lost one (the baseline must then be lowered) */
export function compareWithBaseline(current: Baseline, baseline: Baseline): { increased: string[]; decreased: string[] } {
  const files = new Set([...Object.keys(current), ...Object.keys(baseline)]);
  const increased: string[] = [];
  const decreased: string[] = [];
  for (const file of [...files].sort()) {
    const now = current[file] ?? 0;
    const before = baseline[file] ?? 0;
    if (now > before) increased.push(`${file}: ${before} -> ${now}`);
    else if (now < before) decreased.push(`${file}: ${before} -> ${now}`);
  }
  return { increased, decreased };
}

export function readBaseline(root = process.cwd()): Baseline {
  const file = path.join(root, BASELINE_FILE);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) as Baseline : {};
}

function main(): void {
  const update = process.argv.includes('--update');
  const current = currentState();
  const baseline = readBaseline();
  const { increased, decreased } = compareWithBaseline(current, baseline);
  const total = Object.values(current).reduce((a, b) => a + b, 0);
  const firstBaseline = update && !fs.existsSync(path.join(process.cwd(), BASELINE_FILE));
  if (increased.length > 0 && !firstBaseline) {
    console.error('UI wording ratchet FAILED: these files gained a forbidden word in user-facing text:');
    for (const line of increased) console.error(`  ${line}`);
    console.error('Use the glossary words instead (see AGENTS.md section 6); the baseline may never be raised.');
    process.exit(1);
  }
  if (update) {
    fs.writeFileSync(path.join(process.cwd(), BASELINE_FILE), `${JSON.stringify(current, null, 2)}\n`);
    console.log(`UI wording baseline written: ${total} sites in ${Object.keys(current).length} files`);
    return;
  }
  if (decreased.length > 0) {
    console.error('UI wording ratchet: counts went down; lower the baseline with npm run ratchet:ui-wording -- --update');
    for (const line of decreased) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log(`UI wording ratchet OK: ${total} sites in ${Object.keys(current).length} files`);
}

if (process.argv[1]?.endsWith('ui-wording-ratchet.ts') || process.argv[1]?.endsWith('ui-wording-ratchet.js')) {
  main();
}
