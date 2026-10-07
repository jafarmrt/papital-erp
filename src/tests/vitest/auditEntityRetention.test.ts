/**
 * v9.0.154 (TD-522, B02-07, owner decision t4 A): the audit purge deletes only operational sections and never a
 * financial, security, role or user event. Every entity name production code writes into activity_logs (logActivity,
 * a direct insert, a migration) must be classified as critical or purgeable in `src/lib/audit/auditRetention.ts`, and
 * both lists hold only names the code really writes. A new entity name fails here until it is classified.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  CRITICAL_AUDIT_ENTITIES,
  CRITICAL_AUDIT_ENTITY_PREFIXES,
  PURGEABLE_AUDIT_ENTITIES,
  PURGEABLE_AUDIT_ENTITY_LABELS,
} from '../../lib/audit/auditRetention';

const ROOT = path.resolve(__dirname, '../../..');

/** entity values that are runtime data, not code: an event rule's audit category is typed by the admin */
const RUNTIME_ENTITY_EXPRESSIONS = new Set(['auditConfig.category']);

interface EntityUse { file: string; line: number; names: string[]; heads: string[]; unresolved: string[] }

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
function declarationOf(name: string, from: ts.Node): ts.Expression | undefined {
  for (let scope: ts.Node | undefined = from.parent; scope; scope = scope.parent) {
    const statements = (scope as { statements?: ts.NodeArray<ts.Statement> }).statements;
    if (!statements) continue;
    let found: ts.Expression | undefined;
    for (const statement of statements) {
      if (statement.pos > from.pos) break;
      if (!ts.isVariableStatement(statement)) continue;
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name && decl.initializer) found = decl.initializer;
      }
    }
    if (found) return found;
  }
  return undefined;
}

function resolveEntity(expr: ts.Expression, sf: ts.SourceFile, use: EntityUse, depth = 0): void {
  if (depth > 6) { use.unresolved.push(expr.getText(sf)); return; }
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) { use.names.push(expr.text); return; }
  if (ts.isTemplateExpression(expr)) { use.heads.push(expr.head.text); return; }
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isNonNullExpression(expr)) {
    resolveEntity(expr.expression, sf, use, depth + 1);
    return;
  }
  if (ts.isConditionalExpression(expr)) {
    resolveEntity(expr.whenTrue, sf, use, depth + 1);
    resolveEntity(expr.whenFalse, sf, use, depth + 1);
    return;
  }
  if (ts.isBinaryExpression(expr) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(expr.operatorToken.kind)) {
    resolveEntity(expr.left, sf, use, depth + 1);
    resolveEntity(expr.right, sf, use, depth + 1);
    return;
  }
  if (ts.isIdentifier(expr)) {
    const init = declarationOf(expr.text, expr);
    if (init) { resolveEntity(init, sf, use, depth + 1); return; }
  }
  if (ts.isElementAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    const table = declarationOf(expr.expression.text, expr);
    if (table && ts.isObjectLiteralExpression(table)) {
      for (const prop of table.properties) {
        if (ts.isPropertyAssignment(prop)) resolveEntity(prop.initializer, sf, use, depth + 1);
      }
      return;
    }
  }
  if (!RUNTIME_ENTITY_EXPRESSIONS.has(expr.getText(sf))) use.unresolved.push(expr.getText(sf));
}

/**
 * the object a call writes into activity_logs: logActivity({...}) or insert(activityLogs).values({...}); the insert inside
 * logActivity itself (`src/lib/auditLogger.ts`) writes its caller's entity and is not a use
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

function codeEntityUses(): EntityUse[] {
  const uses: EntityUse[] = [];
  for (const file of productionFiles()) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    if (!text.includes('logActivity') && !text.includes('activityLogs')) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const obj = auditObjectOf(node, sf, file);
        if (obj) {
          const use: EntityUse = { file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, names: [], heads: [], unresolved: [] };
          if (!ts.isObjectLiteralExpression(obj)) {
            use.unresolved.push(`(not an object literal) ${obj.getText(sf)}`);
          } else {
            const prop = obj.properties.find(p => p.name && ts.isIdentifier(p.name) && p.name.text === 'entity');
            if (!prop) use.unresolved.push('(no entity)');
            else if (ts.isPropertyAssignment(prop)) resolveEntity(prop.initializer, sf, use);
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

function migrationEntityUses(): EntityUse[] {
  const uses: EntityUse[] = [];
  const dir = path.join(ROOT, 'drizzle');
  for (const name of fs.readdirSync(dir).filter(f => f.endsWith('.sql'))) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    for (const statement of text.split(/;\s*\n/)) {
      if (!/INSERT INTO activity_logs/i.test(statement)) continue;
      const names = [...statement.matchAll(/'(?:CREATE|UPDATE|DELETE|RESTORE|SEED|SETTING_CHANGE)',\s*'([^']+)'/g)].map(m => m[1]);
      uses.push({ file: `drizzle/${name}`, line: 0, names, heads: [], unresolved: names.length ? [] : ['(entity not found in the statement)'] });
    }
  }
  return uses;
}

const critical = new Set<string>(CRITICAL_AUDIT_ENTITIES);
const purgeable = new Set<string>(PURGEABLE_AUDIT_ENTITIES);

describe('audit entity retention (TD-522)', () => {
  const uses = [...codeEntityUses(), ...migrationEntityUses()];
  const writtenNames = new Set(uses.flatMap(u => u.names));
  const writtenHeads = new Set(uses.flatMap(u => u.heads));

  it('finds the audit writes of the code', () => {
    expect(uses.length).toBeGreaterThan(140);
    expect(writtenNames).toContain('journal_voucher');
    expect(writtenNames).toContain('ترنسفر');
    expect(writtenNames).toContain('نقش و دسترسی');
  });

  it('resolves every entity a production write uses', () => {
    const unresolved = uses.filter(u => u.unresolved.length > 0).map(u => `${u.file}:${u.line} ${u.unresolved.join(' | ')}`);
    expect(unresolved).toEqual([]);
  });

  it('classifies every written entity name exactly once', () => {
    const unclassified = [...writtenNames].filter(n => !critical.has(n) && !purgeable.has(n)).sort();
    expect(unclassified).toEqual([]);
    expect(PURGEABLE_AUDIT_ENTITIES.filter(n => critical.has(n))).toEqual([]);
  });

  it('keeps every variable entity name under a critical prefix', () => {
    const unknownHeads = [...writtenHeads].filter(h => !CRITICAL_AUDIT_ENTITY_PREFIXES.some(p => h.startsWith(p))).sort();
    expect(unknownHeads).toEqual([]);
    expect(PURGEABLE_AUDIT_ENTITIES.filter(n => CRITICAL_AUDIT_ENTITY_PREFIXES.some(p => n.startsWith(p)))).toEqual([]);
  });

  it('lists only names and prefixes the code really writes', () => {
    expect([...CRITICAL_AUDIT_ENTITIES, ...PURGEABLE_AUDIT_ENTITIES].filter(n => !writtenNames.has(n))).toEqual([]);
    expect(CRITICAL_AUDIT_ENTITY_PREFIXES.filter(p => ![...writtenHeads].some(h => h.startsWith(p)))).toEqual([]);
  });

  it('keeps the financial names of the finding (R09) and labels every purgeable section in Persian', () => {
    for (const name of ['journal_voucher', 'account', 'cheque', 'bank_account', 'treasury_transaction', 'treasury_transfer',
      'پرداخت حقوق', 'اسناد انبار', 'طرف حساب', 'فیش حقوقی', 'نقش و دسترسی', 'کاربران سیستم', 'احراز هویت']) {
      expect(critical.has(name), name).toBe(true);
    }
    for (const name of PURGEABLE_AUDIT_ENTITIES) {
      expect(PURGEABLE_AUDIT_ENTITY_LABELS[name]).toMatch(/^[؀-ۿ‌ ]+$/);
    }
  });
});
