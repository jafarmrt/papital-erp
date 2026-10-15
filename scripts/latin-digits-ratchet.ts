import fs from 'fs';
import path from 'path';
import ts from 'typescript';

/**
 * v10.1.23 (TD-1274, Vibe Farsi audit item 2): a number put straight on a screen shows Latin digits («صفحه 3 از 10»,
 * «+12%», a count in a tab title), while the screens write numbers in Persian digits (AGENTS.md §6: `formatPersianNumber`,
 * and `formatPersianCode` for an id or a document number). This ratchet asks the TypeScript checker for the type of every
 * value a page or component shows, so it finds a number however it was computed, and counts per file:
 *
 *   - a JSX child whose value is a number (`{items.length}`, `{idx + 1}`, either branch of `a ? n : '-'`, `a || n`);
 *   - a number inside a template literal shown as a JSX child or in a text attribute (`title`, `placeholder`, `aria-label` …);
 *   - a number attribute value of those text attributes;
 *   - `.toFixed(…)` shown as a JSX child (its digits are Latin).
 *
 * A value wrapped in a formatter is a string and is not counted. It fails when a file gains a site:
 *
 *   npm run ratchet:latin-digits              check against latin-digits-baseline.json
 *   npm run ratchet:latin-digits -- --update  write the current (lower) counts; the baseline may only shrink
 */

export const BASELINE_FILE = 'latin-digits-baseline.json';

/** The screens: pages and components (hooks and lib return values, which a screen formats when it shows them) */
const ROOTS = ['src/pages', 'src/components'];

/** Attributes whose text the user reads (a tooltip, a placeholder, a screen-reader name, a prop shown as text) */
export const TEXT_ATTRIBUTES = new Set([
  'title', 'placeholder', 'aria-label', 'alt', 'label', 'description', 'message', 'subtitle', 'hint', 'helperText',
]);

export type Baseline = Record<string, number>;
export interface Site { file: string; line: number; text: string }

const IGNORED_FLAGS = ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void | ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral;

/** A number, or a number that may also be null, undefined or false (`cond && n`); never a mix with a string */
function isNumberType(type: ts.Type): boolean {
  const parts = type.isUnion() ? type.types : [type];
  let number = false;
  for (const part of parts) {
    if (part.flags & IGNORED_FLAGS) continue;
    if (part.flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.BigIntLike)) { number = true; continue; }
    return false;
  }
  return number;
}

/** The values an expression may show: both branches of a conditional, the right of `&&`, both sides of `||` / `??` */
function shownValues(expression: ts.Expression): ts.Expression[] {
  if (ts.isParenthesizedExpression(expression)) return shownValues(expression.expression);
  if (ts.isConditionalExpression(expression)) return [...shownValues(expression.whenTrue), ...shownValues(expression.whenFalse)];
  if (ts.isBinaryExpression(expression)) {
    const kind = expression.operatorToken.kind;
    if (kind === ts.SyntaxKind.AmpersandAmpersandToken) return shownValues(expression.right);
    if (kind === ts.SyntaxKind.BarBarToken || kind === ts.SyntaxKind.QuestionQuestionToken) {
      return [...shownValues(expression.left), ...shownValues(expression.right)];
    }
  }
  return [expression];
}

const isToFixedCall = (node: ts.Expression): boolean =>
  ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'toFixed';

/** Every place in one source file that shows a number with Latin digits */
export function sitesOfFile(sf: ts.SourceFile, checker: ts.TypeChecker, file = sf.fileName): Site[] {
  const sites: Site[] = [];
  const add = (node: ts.Node): void => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    sites.push({ file, line: line + 1, text: node.getText(sf) });
  };
  const checkTemplate = (template: ts.TemplateExpression): void => {
    for (const span of template.templateSpans) {
      for (const value of shownValues(span.expression)) if (isNumberType(checker.getTypeAtLocation(value))) add(value);
    }
  };
  const checkShown = (expression: ts.Expression, asChild: boolean): void => {
    for (const value of shownValues(expression)) {
      if (isNumberType(checker.getTypeAtLocation(value))) add(value);
      else if (asChild && isToFixedCall(value)) add(value);
      else if (ts.isTemplateExpression(value)) checkTemplate(value);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      checkShown(node.expression, true);
    } else if (
      ts.isJsxAttribute(node) && TEXT_ATTRIBUTES.has(node.name.getText(sf))
      && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression
    ) {
      checkShown(node.initializer.expression, false);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.tsx') ? [full] : [];
  });
}

function compilerOptions(root: string): ts.CompilerOptions {
  const parsed = ts.getParsedCommandLineOfConfigFile(path.join(root, 'tsconfig.json'), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: diagnostic => { throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')); },
  });
  if (!parsed) throw new Error('tsconfig.json could not be read');
  return { ...parsed.options, noEmit: true };
}

/** Sites of a small source held in memory (for the ratchet's own tests), checked with the repository's compiler options */
export function sitesOfSource(source: string, root = process.cwd()): Site[] {
  const fileName = path.join(root, 'src/components/__latin_digits_probe__.tsx');
  const options = compilerOptions(root);
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, ...rest) =>
    path.resolve(name) === fileName ? ts.createSourceFile(name, source, languageVersion, true, ts.ScriptKind.TSX) : getSourceFile(name, languageVersion, ...rest);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = name => path.resolve(name) === fileName || fileExists(name);
  const program = ts.createProgram([fileName], options, host);
  const sf = program.getSourceFile(fileName);
  if (!sf) throw new Error('probe source missing');
  return sitesOfFile(sf, program.getTypeChecker(), 'probe.tsx');
}

/** Every site in the repository's pages and components */
export function repositorySites(root = process.cwd()): Site[] {
  const files = ROOTS.flatMap(dir => sourceFiles(path.join(root, dir))).map(file => path.resolve(file));
  const wanted = new Set(files);
  const program = ts.createProgram(files, compilerOptions(root));
  const checker = program.getTypeChecker();
  return program.getSourceFiles()
    .filter(sf => wanted.has(path.resolve(sf.fileName)))
    .flatMap(sf => sitesOfFile(sf, checker, path.relative(root, sf.fileName).split(path.sep).join('/')));
}

export function countsOf(sites: Site[]): Baseline {
  const counts: Baseline = {};
  for (const site of sites) counts[site.file] = (counts[site.file] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
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
  const sites = repositorySites();
  const current = countsOf(sites);
  const baseline = readBaseline();
  const { increased, decreased } = compareWithBaseline(current, baseline);
  const firstBaseline = update && !fs.existsSync(path.join(process.cwd(), BASELINE_FILE));
  if (increased.length > 0 && !firstBaseline) {
    console.error('Latin digits ratchet FAILED: these files show a number with Latin digits:');
    for (const line of increased) console.error(`  ${line}`);
    for (const site of sites.filter(s => increased.some(line => line.startsWith(`${s.file}:`)))) {
      console.error(`    ${site.file}:${site.line} ${site.text}`);
    }
    console.error('Show it with formatPersianNumber (or formatPersianCode for an id); the baseline may never be raised.');
    process.exit(1);
  }
  if (update) {
    fs.writeFileSync(path.join(process.cwd(), BASELINE_FILE), `${JSON.stringify(current, null, 2)}\n`);
    console.log(`Latin digits baseline written: ${sites.length} sites in ${Object.keys(current).length} files`);
    return;
  }
  if (decreased.length > 0) {
    console.error('Latin digits ratchet: counts went down; lower the baseline with npm run ratchet:latin-digits -- --update');
    for (const line of decreased) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log(`Latin digits ratchet OK: ${sites.length} sites in ${Object.keys(current).length} files`);
}

if (process.argv[1]?.endsWith('latin-digits-ratchet.ts') || process.argv[1]?.endsWith('latin-digits-ratchet.js')) {
  main();
}
