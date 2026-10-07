/**
 * Static scan of what production code writes into activity_logs (logActivity, a direct insert, a migration), shared by
 * the audit entity retention test (TD-522) and the audit action label test (TD-538). A written value is resolved from
 * literals, templates, conditionals, `||` / `??`, identifiers in scope and element access on object literals.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

export const ROOT = path.resolve(__dirname, '../../../..');

export interface AuditWriteUse { file: string; line: number; names: string[]; heads: string[]; unresolved: string[] }

function productionFiles(): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const child = path.posix.join(rel, entry.name);
      if (entry.isDirectory()) {
        if (child !== 'src/tests') walk(child);
      } else if (/\.tsx?$/.test(entry.name) && !/\.(test|d)\.tsx?$/.test(entry.name)) {
        out.push(child);
      }
    }
  };
  walk('src');
  return out;
}

/** the last declaration of `name` visible at `from` (block by block, outwards), or undefined */
function declarationOf(name: string, from: ts.Node): ts.VariableDeclaration | undefined {
  for (let scope: ts.Node | undefined = from.parent; scope; scope = scope.parent) {
    const statements = (scope as { statements?: ts.NodeArray<ts.Statement> }).statements;
    if (!statements) continue;
    let found: ts.VariableDeclaration | undefined;
    for (const statement of statements) {
      if (statement.pos > from.pos) break;
      if (!ts.isVariableStatement(statement)) continue;
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name && (decl.initializer || decl.type)) found = decl;
      }
    }
    if (found) return found;
  }
  return undefined;
}

/** the string literals of a declared type `'A' | 'B'`, or undefined when the type is anything else */
function literalTypeNames(type: ts.TypeNode): string[] | undefined {
  const parts = ts.isUnionTypeNode(type) ? [...type.types] : [type];
  const names = parts.map(t => (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal) ? t.literal.text : undefined));
  return names.every((n): n is string => n !== undefined) ? names : undefined;
}

function resolveValue(expr: ts.Expression, sf: ts.SourceFile, use: AuditWriteUse, runtime: ReadonlySet<string>, depth = 0): void {
  const next = (e: ts.Expression) => resolveValue(e, sf, use, runtime, depth + 1);
  if (depth > 6) { use.unresolved.push(expr.getText(sf)); return; }
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) { use.names.push(expr.text); return; }
  if (ts.isTemplateExpression(expr)) { use.heads.push(expr.head.text); return; }
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isNonNullExpression(expr)) { next(expr.expression); return; }
  if (ts.isConditionalExpression(expr)) { next(expr.whenTrue); next(expr.whenFalse); return; }
  if (ts.isBinaryExpression(expr) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(expr.operatorToken.kind)) {
    next(expr.left);
    next(expr.right);
    return;
  }
  if (ts.isIdentifier(expr)) {
    // a variable reassigned later (`let action: 'CREATE' | 'UPDATE' = 'CREATE'`) holds any literal of its declared type
    const decl = declarationOf(expr.text, expr);
    const declared = decl?.type ? literalTypeNames(decl.type) : undefined;
    if (declared) { use.names.push(...declared); return; }
    if (decl?.initializer) { next(decl.initializer); return; }
  }
  if (ts.isElementAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    const table = declarationOf(expr.expression.text, expr)?.initializer;
    if (table && ts.isObjectLiteralExpression(table)) {
      for (const prop of table.properties) {
        if (ts.isPropertyAssignment(prop)) next(prop.initializer);
      }
      return;
    }
  }
  if (!runtime.has(expr.getText(sf))) use.unresolved.push(expr.getText(sf));
}

/**
 * the object a call writes into activity_logs: logActivity({...}) or insert(activityLogs).values({...}); the insert inside
 * logActivity itself (`src/lib/auditLogger.ts`) writes its caller's values and is not a use
 */
function auditObjectOf(call: ts.CallExpression, sf: ts.SourceFile, file: string): ts.Expression | undefined {
  const callee = call.expression;
  if (/(^|\.)logActivity$/.test(callee.getText(sf))) return call.arguments[0];
  if (file !== 'src/lib/auditLogger.ts' && ts.isPropertyAccessExpression(callee) && callee.name.text === 'values' && ts.isCallExpression(callee.expression)
    && /(^|\.)insert$/.test(callee.expression.expression.getText(sf))
    && callee.expression.arguments[0]?.getText(sf) === 'activityLogs') {
    return call.arguments[0];
  }
  return undefined;
}

/**
 * every production write of `property` into activity_logs; `runtime` lists expressions whose value is runtime data, not
 * code (for example an event rule's audit category, typed by the admin)
 */
export function codeAuditWrites(property: 'entity' | 'action', runtime: ReadonlySet<string> = new Set()): AuditWriteUse[] {
  const uses: AuditWriteUse[] = [];
  for (const file of productionFiles()) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    if (!text.includes('logActivity') && !text.includes('activityLogs')) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const obj = auditObjectOf(node, sf, file);
        if (obj) {
          const use: AuditWriteUse = { file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, names: [], heads: [], unresolved: [] };
          if (!ts.isObjectLiteralExpression(obj)) {
            use.unresolved.push(`(not an object literal) ${obj.getText(sf)}`);
          } else {
            const prop = obj.properties.find(p => p.name && ts.isIdentifier(p.name) && p.name.text === property);
            if (!prop) use.unresolved.push(`(no ${property})`);
            else if (ts.isPropertyAssignment(prop)) resolveValue(prop.initializer, sf, use, runtime);
            else if (ts.isShorthandPropertyAssignment(prop)) resolveValue(prop.name, sf, use, runtime);
            else use.unresolved.push(prop.getText(sf));
          }
          uses.push(use);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return uses;
}

/** every migration insert into activity_logs, with the (action, entity) literal pairs it writes */
export function migrationAuditWrites(property: 'entity' | 'action'): AuditWriteUse[] {
  const uses: AuditWriteUse[] = [];
  const dir = path.join(ROOT, 'drizzle');
  for (const name of fs.readdirSync(dir).filter(f => f.endsWith('.sql'))) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    for (const statement of text.split(/;\s*\n/)) {
      if (!/INSERT INTO activity_logs/i.test(statement)) continue;
      const pairs = [...statement.matchAll(/'([A-Z][A-Z_]+)',\s*'([^']+)'/g)];
      const names = pairs.map(m => (property === 'action' ? m[1] : m[2]));
      uses.push({ file: `drizzle/${name}`, line: 0, names, heads: [], unresolved: names.length ? [] : [`(${property} not found in the statement)`] });
    }
  }
  return uses;
}
