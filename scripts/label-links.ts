/**
 * Every form label names its field (v10.1.29, TD-1278, Vibe Farsi package 3b).
 *
 * A `<label>` followed by a field (the next element, or the only field inside it outside a list)
 * either wraps the field or points to it with `htmlFor`, and the field carries the same `id`; then a
 * screen reader reads the label as the field's name and a click on the label focuses the field.
 * Shared fields take the `id`: `DecimalInput`, `FinancialAmountInput`, `JalaliDateInput`,
 * `SearchableSelect`, `AccountSearchSelect`, `MentionTextarea`. A file or hidden input is left out.
 * Vitest `labelLinksTd1278.test.ts` requires no gap in pages and components.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

export const LABEL_ROOTS = ['src/pages', 'src/components'];

const FIELD = /^(input|select|textarea)$|Input$|Select$|Picker$|Textarea$|Dropzone$/;

type JsxNode = ts.JsxElement | ts.JsxSelfClosingElement;

export interface LabelGap {
  file: string;
  line: number;
  field: string;
  problem: 'unlinked' | 'id-mismatch';
}

const openingOf = (node: JsxNode) => (ts.isJsxElement(node) ? node.openingElement : node);
const tagOf = (node: JsxNode, sf: ts.SourceFile) => openingOf(node).tagName.getText(sf);

function attributeText(node: JsxNode, name: string, sf: ts.SourceFile): string | undefined {
  const found = openingOf(node)
    .attributes.properties.filter(ts.isJsxAttribute)
    .find((a) => a.name.getText(sf) === name);
  return found ? (found.initializer?.getText(sf) ?? '') : undefined;
}

function descendants(node: ts.Node): JsxNode[] {
  const found: JsxNode[] = [];
  const visit = (child: ts.Node) => {
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) found.push(child);
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

function insideList(node: ts.Node, stop: ts.Node, sf: ts.SourceFile): boolean {
  for (let p = node.parent; p && p !== stop; p = p.parent) {
    if (ts.isCallExpression(p) && /\.map$/.test(p.expression.getText(sf))) return true;
  }
  return false;
}

/** The field a label stands before: the next element, or the only field inside it outside a list. */
function fieldAfter(label: JsxNode, sf: ts.SourceFile): JsxNode | undefined {
  const parent = label.parent;
  if (!ts.isJsxElement(parent)) return undefined;
  const siblings = parent.children.filter((c): c is JsxNode => ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c));
  const next = siblings[siblings.indexOf(label) + 1];
  if (!next) return undefined;
  if (FIELD.test(tagOf(next, sf))) return next;
  const fields = descendants(next).filter((e) => FIELD.test(tagOf(e, sf)));
  if (fields.length !== 1 || insideList(fields[0], next, sf)) return undefined;
  return fields[0];
}

export function labelGapsOfSource(source: string, file: string): LabelGap[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const gaps: LabelGap[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && tagOf(node, sf) === 'label') {
      if (!descendants(node).some((e) => FIELD.test(tagOf(e, sf)))) {
        const field = fieldAfter(node, sf);
        const type = field ? (attributeText(field, 'type', sf) ?? '') : '';
        if (field && !/hidden|file/.test(type)) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          const htmlFor = attributeText(node, 'htmlFor', sf);
          const id = attributeText(field, 'id', sf);
          if (htmlFor === undefined) gaps.push({ file, line, field: tagOf(field, sf), problem: 'unlinked' });
          else if (htmlFor !== id) gaps.push({ file, line, field: tagOf(field, sf), problem: 'id-mismatch' });
        }
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return gaps;
}

function tsxFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    return entry.name.endsWith('.tsx') ? [full] : [];
  });
}

export function repositoryLabelGaps(root = process.cwd()): LabelGap[] {
  return LABEL_ROOTS.flatMap((dir) => tsxFiles(path.join(root, dir))).flatMap((full) =>
    labelGapsOfSource(fs.readFileSync(full, 'utf8'), path.relative(root, full).split(path.sep).join('/')),
  );
}

if (process.argv[1]?.endsWith('label-links.ts') || process.argv[1]?.endsWith('label-links.js')) {
  const gaps = repositoryLabelGaps();
  for (const gap of gaps) console.log(`${gap.file}:${gap.line} ${gap.field} ${gap.problem}`);
  console.log(gaps.length === 0 ? 'Label links OK: every label names its field' : `${gaps.length} labels without their field`);
  process.exitCode = gaps.length === 0 ? 0 : 1;
}
