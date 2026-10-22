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
 *    instead of throwing an AppError for `errorHandler`, also `res.status(cond ? 400 : 500)` (v10.0.253);
 *  - noopCatches (decision t5 A, OBS-R2-05, v10.0.253): `catch (err) { throw err; }`, a catch that only rethrows its own error;
 *  - serviceGenericErrors (decision t5 A): `throw new Error(` in `src/services/**` instead of an AppError subclass;
 *  - serviceErrorResults (decision t5 A, OBS-R2-05, v10.2.28): an error handed back as a value, an object literal with
 *    `status: 4xx|5xx` and `error` in `src/services/**` (payroll.service.ts), instead of throwing an AppError subclass;
 *  - unorderedTestRows (OT-A-09, v10.2.28): in `src/tests/**`, a row past the first (`rows[1]`, `[a, b] = await ...`) of a
 *    query that has no ORDER BY: PostgreSQL returns rows in no fixed order, and such a test fails now and then in CI;
 *  - packageBoundary (decision t3 A, OBS-R2-02): server imports against the package direction of
 *    scripts/ratchets/PACKAGE_MAP.txt (scripts/ratchets/packageBoundary.ts); a server file the map does not cover is refused;
 *  - auditWithoutTx (TD-963 part 2, OBS-R2-07): a `logActivity(...)` call whose argument names no `tx`, so the audit row
 *    is written on its own pool connection after the change committed, and a failed insert never refuses the change;
 *  - hardDeletes (OBS-R2-15, decision ت۴۰ item 19): a physical delete, `x.delete(<schema table>)` or SQL text holding
 *    `DELETE FROM`, in any production file. Business rows are soft-deleted (AGENTS.md, DB-009); the deletes that remain
 *    are the allowed exceptions, each file with its reason in scripts/ratchets/HARD_DELETES.md, and their count only shrinks.
 * Terminal output is English (AGENTS.md, owner rule t9).
 */

export const BASELINE_FILE = 'scripts/ratchets/architecture-baseline.json';

export const METRICS = ['routeWrites', 'ormFallback', 'routeErrorResponses', 'serviceGenericErrors', 'serviceErrorResults', 'noopCatches', 'auditWithoutTx', 'hardDeletes', 'unorderedTestRows', 'packageBoundary'] as const;
export type Metric = (typeof METRICS)[number];
export type ArchitectureBaseline = Record<Metric, Record<string, number>> & { unmappedServerFiles?: string[] };

const METRIC_ADVICE: Record<Metric, string> = {
  routeWrites: 'move the write into a service (decision t2 B)',
  ormFallback: 'take the caller\'s tx instead of falling back to the pool (decision t4 B)',
  routeErrorResponses: 'throw an AppError subclass and let errorHandler answer (decision t5 A)',
  serviceGenericErrors: 'throw an AppError subclass (decision t5 A)',
  serviceErrorResults: 'throw an AppError subclass instead of returning { status, error } (decision t5 A)',
  unorderedTestRows: 'add ORDER BY (orderBy) to the query, or find the row by a column instead of its position (OT-A-09)',
  noopCatches: 'remove the try / catch: asyncHandler already passes the error to errorHandler (decision t5 A)',
  auditWithoutTx: 'pass the write\'s own tx to logActivity so the audit row commits or rolls back with the change (TD-963)',
  hardDeletes: 'soft-delete the row (is_deleted = 1); a delete that must stay physical is listed with its reason in scripts/ratchets/HARD_DELETES.md (OBS-R2-15)',
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

/** An error status: a numeric literal of 400 or more, or a conditional with such a literal in a branch. */
function isErrorStatus(n: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(n)) return isErrorStatus(n.expression);
  if (ts.isNumericLiteral(n)) return Number(n.text) >= 400;
  return ts.isConditionalExpression(n) && (isErrorStatus(n.whenTrue) || isErrorStatus(n.whenFalse));
}

/** `catch (err) { throw err; }`: the catch clause only rethrows its own error. */
function isNoopCatch(n: ts.CatchClause): boolean {
  const name = n.variableDeclaration?.name;
  const only = n.block.statements.length === 1 ? n.block.statements[0] : undefined;
  return !!name && ts.isIdentifier(name) && !!only && ts.isThrowStatement(only) && !!only.expression
    && ts.isIdentifier(only.expression) && only.expression.text === name.text;
}

/** A `logActivity(...)` call whose argument is not an object literal naming `tx` (a spread may carry it, so it counts as named). */
function isAuditWithoutTx(n: ts.CallExpression): boolean {
  const callee = n.expression;
  const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
  if (name !== 'logActivity') return false;
  const arg = n.arguments[0];
  if (!arg || !ts.isObjectLiteralExpression(arg)) return true;
  return !arg.properties.some(p => ts.isSpreadAssignment(p)
    || ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && ts.isIdentifier(p.name) && p.name.text === 'tx'));
}

/** A database executor's name: a delete on it is a Drizzle delete whatever its argument (a table held in a variable too). */
const EXECUTOR_NAMES = new Set(['tx', 'trx', 'db', 'orm', 'executor', 'txEngine', 'externalTx', 'innerTx']);

/**
 * Closing sweep (#309 review): `x.delete(arg)` is a Drizzle delete when `x` is an executor (`tx.delete(entry.table)`) or
 * when the call is chained with `.where(...)` / `.returning(...)`, which a `Map` or `Set` delete never is.
 */
function isDrizzleDelete(n: ts.CallExpression): boolean {
  const receiver = (n.expression as ts.PropertyAccessExpression).expression;
  const name = ts.isIdentifier(receiver) ? receiver.text : ts.isPropertyAccessExpression(receiver) ? receiver.name.text : '';
  if (EXECUTOR_NAMES.has(name)) return true;
  const parent = n.parent;
  return ts.isPropertyAccessExpression(parent) && parent.expression === n && ['where', 'returning'].includes(parent.name.text);
}

/** `{ status: 4xx|5xx, error: ... }`: an error result object instead of a thrown AppError. */
function isErrorResult(n: ts.ObjectLiteralExpression): boolean {
  const names = new Map(n.properties.filter(ts.isPropertyAssignment).filter(p => ts.isIdentifier(p.name))
    .map(p => [(p.name as ts.Identifier).text, p.initializer]));
  const status = names.get('status');
  return !!status && ts.isNumericLiteral(status) && Number(status.text) >= 400 && n.properties.some(p => p.name && ts.isIdentifier(p.name) && p.name.text === 'error');
}

/** Method names of a call chain, `orm.select().from(t).where(x)` -> select, from, where (`await` and parentheses skipped). */
function chainMethods(n: ts.Expression): string[] {
  const out: string[] = [];
  let cur: ts.Expression = n;
  for (;;) {
    if (ts.isAwaitExpression(cur) || ts.isParenthesizedExpression(cur)) cur = cur.expression;
    else if (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression)) { out.unshift(cur.expression.name.text); cur = cur.expression.expression; }
    else if (ts.isPropertyAccessExpression(cur)) cur = cur.expression;
    else return out;
  }
}

/** SQL text of `x.execute(sql\`...\`)`, or null when the expression is no such call. */
function executedSql(n: ts.Expression): string | null {
  let cur: ts.Expression = n;
  while (ts.isAwaitExpression(cur) || ts.isParenthesizedExpression(cur)) cur = cur.expression;
  if (!ts.isCallExpression(cur) || !ts.isPropertyAccessExpression(cur.expression) || cur.expression.name.text !== 'execute') return null;
  const arg = cur.arguments[0];
  if (!arg || !ts.isTaggedTemplateExpression(arg)) return null;
  const t = arg.template;
  return ts.isNoSubstitutionTemplateLiteral(t) ? t.text : [t.head.text, ...t.templateSpans.map(s => s.literal.text)].join(' ');
}

/** A query whose rows come back in no fixed order: a Drizzle select without orderBy or a SQL SELECT without ORDER BY. */
function isUnorderedQuery(n: ts.Expression): boolean {
  const text = executedSql(n);
  if (text !== null) return /\bSELECT\b/i.test(text) && !/\bORDER\s+BY\b/i.test(text);
  const methods = chainMethods(n);
  return methods.includes('from') && !methods.includes('orderBy');
}

/** OT-A-09: positions past the first row of an unordered query in a test file. */
export function countTestSource(file: string, source: string): number {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  /** every declaration of a name, with whether it holds an unordered query, so an access finds the one in its scope */
  const declarations = new Map<string, Array<{ node: ts.VariableDeclaration; unordered: boolean }>>();
  let count = 0;
  const collect = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
      const unordered = !!n.initializer && ts.isAwaitExpression(n.initializer) && isUnorderedQuery(n.initializer);
      declarations.set(n.name.text, [...(declarations.get(n.name.text) ?? []), { node: n, unordered }]);
    }
    if (ts.isVariableDeclaration(n) && ts.isArrayBindingPattern(n.name) && n.initializer && ts.isAwaitExpression(n.initializer)
      && isUnorderedQuery(n.initializer) && n.name.elements.filter(e => !ts.isOmittedExpression(e)).length > 1) count++;
    ts.forEachChild(n, collect);
  };
  collect(sf);
  const scopeOf = (n: ts.Node): ts.Node => {
    let cur = n.parent;
    while (cur && !ts.isBlock(cur) && !ts.isSourceFile(cur) && !ts.isFunctionLike(cur)) cur = cur.parent;
    return cur ?? sf;
  };
  /** the nearest earlier declaration of `name` whose scope holds the access */
  const isUnorderedName = (name: string, at: ts.Node): boolean => {
    const visible = (declarations.get(name) ?? []).filter(d => {
      const scope = scopeOf(d.node);
      return d.node.pos < at.pos && scope.pos <= at.pos && at.end <= scope.end;
    });
    return visible.length > 0 && visible.reduce((a, b) => (b.node.pos > a.node.pos ? b : a)).unordered;
  };
  /** `name[k]` or `name.rows[k]` with k >= 1 on an unordered name, or `(await <unordered>).rows[k]` */
  const visit = (n: ts.Node) => {
    if (ts.isElementAccessExpression(n) && ts.isNumericLiteral(n.argumentExpression) && Number(n.argumentExpression.text) >= 1) {
      let base: ts.Expression = n.expression;
      if (ts.isPropertyAccessExpression(base) && base.name.text === 'rows') base = base.expression;
      while (ts.isParenthesizedExpression(base)) base = base.expression;
      if ((ts.isIdentifier(base) && isUnorderedName(base.text, n)) || (ts.isAwaitExpression(base) && isUnorderedQuery(base))) count++;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return count;
}

export function testSourceFiles(root = process.cwd()): string[] {
  const files: string[] = [];
  const walk = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (/\.ts$/.test(entry.name) && !entry.name.endsWith('.d.ts')) files.push(child);
    }
  };
  walk('src/tests');
  return files.sort();
}

/** Counts of every metric in one source file. */
export type SourceMetric = Exclude<Metric, 'packageBoundary' | 'unorderedTestRows'>;

export function countSource(file: string, source: string): Record<SourceMetric, number> {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const counts: Record<SourceMetric, number> = { routeWrites: 0, ormFallback: 0, routeErrorResponses: 0, serviceGenericErrors: 0, serviceErrorResults: 0, noopCatches: 0, auditWithoutTx: 0, hardDeletes: 0 };
  const tables = schemaImports(sf);
  const isTable = (n: ts.Expression) => (ts.isIdentifier(n) && tables.has(n.text))
    || (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && tables.has(`${n.expression.text}.*`));
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const method = n.expression.name.text;
      if (isRoute(file) && ['insert', 'update', 'delete'].includes(method) && n.arguments.length === 1 && isTable(n.arguments[0])) counts.routeWrites++;
      if (method === 'delete' && n.arguments.length === 1 && (isTable(n.arguments[0]) || isDrizzleDelete(n))) counts.hardDeletes++;
      if (isRoute(file) && method === 'status' && n.arguments.length === 1 && isErrorStatus(n.arguments[0])
        && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'res') counts.routeErrorResponses++;
    }
    if (ts.isCallExpression(n) && isAuditWithoutTx(n)) counts.auditWithoutTx++;
    if (ts.isCatchClause(n) && isNoopCatch(n)) counts.noopCatches++;
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n))
      && (/\bDELETE\s+FROM\b/i.test(n.text) || /\bTRUNCATE\s+(TABLE\s+)?["\w$]/.test(n.text) || /\btruncate\s+table\b/i.test(n.text))) counts.hardDeletes++;
    if (ts.isBinaryExpression(n) && isOrm(n.right)
      && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.EqualsToken].includes(n.operatorToken.kind)) counts.ormFallback++;
    if ((ts.isVariableDeclaration(n) || ts.isParameter(n)) && n.initializer && isOrm(n.initializer)) counts.ormFallback++;
    if (isService(file) && ts.isThrowStatement(n) && n.expression && ts.isNewExpression(n.expression)
      && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'Error') counts.serviceGenericErrors++;
    if (isService(file) && ts.isObjectLiteralExpression(n) && isErrorResult(n)) counts.serviceErrorResults++;
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
  for (const file of testSourceFiles(root)) {
    const n = countTestSource(file, fs.readFileSync(path.join(root, file), 'utf8'));
    if (n > 0) state.unorderedTestRows[file] = n;
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
