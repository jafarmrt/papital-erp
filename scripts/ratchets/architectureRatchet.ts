import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { productionSourceFiles } from '../permission-ratchet';
import { boundaryState } from './packageBoundary';

/**
 * Series 10 roadmap §4 (phase-2 decisions t2 to t5): ratchets that only accept decreases, counted per production file
 * with the TypeScript parser (comments and strings never count). Data in scripts/ratchets/, run by Vitest
 * `architectureRatchet.test.ts`.
 *
 *   npm run ratchet:architecture              check against scripts/ratchets/architecture-baseline.json
 *   npm run ratchet:architecture -- --update  write the current (lower) counts; the baseline may only shrink
 *
 * Metrics:
 *  - routeWrites (decision t2 B, TD-960): `insert` / `update` / `delete` on a Drizzle table in `src/routes/**`;
 *  - ormFallback (decision t4 B, OBS-R2-03): an optional transaction replaced by the pool, `x || orm`, `x ?? orm`
 *    and `= orm` (a bare `orm`, never a query builder `orm.select()`);
 *  - routeErrorResponses (decision t5 A, OBS-R2-05): a hand-written error answer `res.status(4xx|5xx)` in `src/routes/**`
 *    instead of throwing an AppError for `errorHandler`;
 *  - serviceGenericErrors (decision t5 A): `throw new Error(` in `src/services/**` instead of an AppError subclass;
 *  - packageBoundary (decision t3 A, OBS-R2-02): server imports against the package direction of
 *    scripts/ratchets/PACKAGE_MAP.txt (scripts/ratchets/packageBoundary.ts); a server file the map does not cover is refused.
 * Terminal output is English (AGENTS.md, owner rule t9).
 */

export const BASELINE_FILE = 'scripts/ratchets/architecture-baseline.json';

export const METRICS = ['routeWrites', 'ormFallback', 'routeErrorResponses', 'serviceGenericErrors', 'packageBoundary'] as const;
export type Metric = (typeof METRICS)[number];
export type ArchitectureBaseline = Record<Metric, Record<string, number>> & { unmappedServerFiles?: string[] };

const METRIC_ADVICE: Record<Metric, string> = {
  routeWrites: 'move the write into a service (decision t2 B)',
  ormFallback: 'take the caller\'s tx instead of falling back to the pool (decision t4 B)',
  routeErrorResponses: 'throw an AppError subclass and let errorHandler answer (decision t5 A)',
  serviceGenericErrors: 'throw an AppError subclass (decision t5 A)',
  packageBoundary: 'import only towards a lower layer, or go through an event or the composition root (decision t3 A)',
};

const isRoute = (file: string) => file.startsWith('src/routes/');
const isService = (file: string) => file.startsWith('src/services/');

const SCHEMA_MODULE = /(^|\/)db\/schema(\/|\.|$)|(^|\/)schema(\/[a-zA-Z]+)?(\.js|\.ts)?$/;

/** Names a file imports from the Drizzle schema (`db/schema`), i.e. its table variables, static or `await import()`. */
function schemaImports(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name) && n.initializer) {
      const init = ts.isAwaitExpression(n.initializer) ? n.initializer.expression : n.initializer;
      if (ts.isCallExpression(init) && init.expression.kind === ts.SyntaxKind.ImportKeyword
        && init.arguments.length > 0 && ts.isStringLiteral(init.arguments[0]) && SCHEMA_MODULE.test(init.arguments[0].text)) {
        for (const el of n.name.elements) if (ts.isIdentifier(el.name)) names.add(el.name.text);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (!SCHEMA_MODULE.test(st.moduleSpecifier.text)) continue;
    const clause = st.importClause;
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) names.add(el.name.text);
    }
    if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) names.add(`${clause.namedBindings.name.text}.*`);
  }
  return names;
}

const isOrm = (n: ts.Node) => ts.isIdentifier(n) && n.text === 'orm';

/** Counts of every metric in one source file. */
export type SourceMetric = Exclude<Metric, 'packageBoundary'>;

export function countSource(file: string, source: string): Record<SourceMetric, number> {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const counts: Record<SourceMetric, number> = { routeWrites: 0, ormFallback: 0, routeErrorResponses: 0, serviceGenericErrors: 0 };
  const tables = isRoute(file) ? schemaImports(sf) : new Set<string>();
  const isTable = (n: ts.Expression) => (ts.isIdentifier(n) && tables.has(n.text))
    || (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && tables.has(`${n.expression.text}.*`));
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const method = n.expression.name.text;
      if (isRoute(file) && ['insert', 'update', 'delete'].includes(method) && n.arguments.length === 1 && isTable(n.arguments[0])) counts.routeWrites++;
      if (isRoute(file) && method === 'status' && n.arguments.length === 1 && ts.isNumericLiteral(n.arguments[0])
        && Number(n.arguments[0].text) >= 400 && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'res') counts.routeErrorResponses++;
    }
    if (ts.isBinaryExpression(n) && isOrm(n.right)
      && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.EqualsToken].includes(n.operatorToken.kind)) counts.ormFallback++;
    if ((ts.isVariableDeclaration(n) || ts.isParameter(n)) && n.initializer && isOrm(n.initializer)) counts.ormFallback++;
    if (isService(file) && ts.isThrowStatement(n) && n.expression && ts.isNewExpression(n.expression)
      && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'Error') counts.serviceGenericErrors++;
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return counts;
}

export function currentState(root = process.cwd()): ArchitectureBaseline {
  const state = Object.fromEntries(METRICS.map(m => [m, {}])) as ArchitectureBaseline;
  for (const file of productionSourceFiles(root)) {
    const counts = countSource(file, fs.readFileSync(path.join(root, file), 'utf8'));
    for (const m of Object.keys(counts) as SourceMetric[]) if (counts[m] > 0) state[m][file] = counts[m];
  }
  const boundary = boundaryState(root);
  state.packageBoundary = boundary.packageBoundary;
  // a server file the package map does not cover is always an error (not part of the baseline)
  if (boundary.unmappedServerFiles.length > 0) state.unmappedServerFiles = boundary.unmappedServerFiles;
  return state;
}

export const totalOf = (byFile: Record<string, number>) => Object.values(byFile).reduce((a, b) => a + b, 0);

export interface RatchetReport { errors: string[]; stale: string[] }

/** A file whose count grew is an error; a count that went down is a stale baseline to lower. */
export function compareWithBaseline(current: ArchitectureBaseline, baseline: ArchitectureBaseline): RatchetReport {
  const errors: string[] = [];
  const stale: string[] = [];
  for (const file of current.unmappedServerFiles ?? []) errors.push(`${file}: no rule of scripts/ratchets/PACKAGE_MAP.txt maps this server file; add one`);
  for (const m of METRICS) {
    const c = current[m] ?? {};
    const b = baseline[m] ?? {};
    for (const file of [...new Set([...Object.keys(c), ...Object.keys(b)])].sort()) {
      const now = c[file] ?? 0;
      const before = b[file] ?? 0;
      if (now > before) errors.push(`${m} ${file}: ${before} -> ${now}; ${METRIC_ADVICE[m]}`);
      else if (now < before) stale.push(`${m} ${file}: ${before} -> ${now}`);
    }
  }
  return { errors, stale };
}

const summary = (s: ArchitectureBaseline) => METRICS.map(m => `${m} ${totalOf(s[m])}`).join(', ');

function main(): void {
  const update = process.argv.includes('--update');
  const baselinePath = path.resolve(process.cwd(), BASELINE_FILE);
  const current = currentState();
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as ArchitectureBaseline;
  const { errors, stale } = compareWithBaseline(current, baseline);
  if (errors.length > 0) {
    for (const e of errors) console.error(`FAIL ${e}`);
    console.error('The architecture ratchet baseline may only shrink; fix the new occurrences instead of raising it.');
    process.exit(1);
  }
  if (update) {
    fs.writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
    console.log(`Architecture ratchet baseline updated: ${summary(current)}`);
    return;
  }
  if (stale.length > 0) {
    for (const s of stale) console.error(`LOWER ${s}`);
    console.error('Debt went down; run `npm run ratchet:architecture -- --update` and commit the baseline.');
    process.exit(1);
  }
  console.log(`Architecture ratchet OK: ${summary(current)}`);
}

if (process.argv[1]?.endsWith('architectureRatchet.ts') || process.argv[1]?.endsWith('architectureRatchet.js')) main();
