import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { validate } from '../../middleware/validate';

/**
 * v11 phase 6.3a (U21): a code or document number a screen shows goes through `formatPersianCode` (AGENTS §6.1), so the
 * same identifier never shows in Latin digits on one screen and in Persian on another («PR-1405-0001» in the list,
 * «PR-۱۴۰۵-۰۰۰۱» in the notice). This guard lists every JSX child that shows such a field raw.
 */
const IDENTIFIER_FIELDS = new Set(['code', 'refNumber', 'ref_number', 'voucherNumber', 'documentNumber', 'docNumber', 'invoiceNumber', 'orderNumber',
  'accountCode', 'account_code', 'projectCode', 'project_code', 'itemCode', 'item_code', 'customerCode', 'supplierCode', 'requisitionCode', 'requisition_code', 'sku']);
const SCREEN_ROOTS = ['src/pages', 'src/components'];

function screenFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) screenFiles(file, out);
    else if (file.endsWith('.tsx')) out.push(file);
  }
  return out;
}

function rawIdentifierChildren(file: string): string[] {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const operands = (node: ts.Expression): void => {
    let e = node;
    while (ts.isParenthesizedExpression(e)) e = e.expression;
    if (ts.isPropertyAccessExpression(e) && IDENTIFIER_FIELDS.has(e.name.text)) {
      found.push(`${path.relative(process.cwd(), file)}:${source.getLineAndCharacterOfPosition(e.getStart()).line + 1} ${e.getText()}`);
    } else if (ts.isBinaryExpression(e) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(e.operatorToken.kind)) {
      operands(e.left);
      operands(e.right);
    } else if (ts.isConditionalExpression(e)) {
      operands(e.whenTrue);
      operands(e.whenFalse);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) operands(node.expression);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('v11 phase 6.3a (U21): identifiers in Persian digits, no field key in a message', () => {
  it('no screen shows a code or document number without formatPersianCode', () => {
    const raw = SCREEN_ROOTS.flatMap(root => screenFiles(path.join(process.cwd(), root))).flatMap(rawIdentifierChildren);
    expect(raw).toEqual([]);
  });

  it('a validation message never starts with the raw key of a field that has no Persian label', async () => {
    const LABELLED_MESSAGE = 'نام طرف حساب الزامی است';
    const schema = z.object({ body: z.object({ someRawKey: z.string({ message: LABELLED_MESSAGE }) }) });
    const out = { status: 0, body: {} as { message?: string } };
    const res = { status(code: number) { out.status = code; return res; }, json(body: { message?: string }) { out.body = body; return res; } };
    await new Promise<void>(resolve => {
      validate(schema)({ body: {}, query: {}, params: {} } as never, res as never, () => resolve());
      setTimeout(resolve, 50);
    });
    expect(out.status).toBe(400);
    expect(out.body.message).toContain(LABELLED_MESSAGE);
    expect(out.body.message).not.toContain('someRawKey');
  });
});
