import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const SRC = path.join(__dirname, '..', '..', '..');

/**
 * 10.3 (ARCH review finding 3): the reads a source file (path under src) makes outside the shared cache, as file:line:
 * a call of any `fetch…` function (`fetchJson`, `fetch`, `fetchAccountingList`) that sends no method or `GET`, and a
 * renamed import of `fetchJson` (which would hide its calls)
 */
export function ownReads(file: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(path.join(SRC, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const at = (node: ts.Node) => `${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
  const methodOf = (init: ts.Expression | undefined): string | null => {
    if (init === undefined || !ts.isObjectLiteralExpression(init)) return null;
    const method = init.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(sf) === 'method');
    if (!method) return null;
    return ts.isStringLiteralLike(method.initializer) ? method.initializer.text.toUpperCase() : 'WRITE';
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportSpecifier(node) && node.propertyName?.getText(sf) === 'fetchJson') found.push(at(node));
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
      const method = methodOf(node.arguments[1]);
      if (/^fetch/.test(name) && (method === null || method === 'GET')) found.push(at(node));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}
