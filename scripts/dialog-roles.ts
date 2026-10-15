/**
 * Hand-built windows behave like windows (v10.1.30, TD-1277, Vibe Farsi package 3b).
 *
 * A full-screen overlay (`fixed inset-0`, or `PHONE_SHEET_OVERLAY`) that is not a decorative
 * backdrop (`aria-hidden`) carries `role="dialog"` (or `alertdialog`) on itself or on its panel.
 * Every such window has `aria-modal="true"`, a name (`aria-label`, `aria-labelledby` or a heading,
 * which `DialogLayer` turns into its name) and, for `role="dialog"`, a `<DialogLayer>` so Esc
 * closes it when it is the topmost window. `Modal.tsx` does the same through `useDialogEscape`.
 * Vitest `dialogRolesTd1277.test.ts` requires no gap in browser code.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

export const DIALOG_ROOTS = ['src/pages', 'src/components', 'src/contexts', 'src/hooks', 'src/lib'];
/** Files that implement the behaviour themselves. */
export const DIALOG_BEHAVIOUR_FILES = new Set(['src/components/common/Modal.tsx']);

const OVERLAY_CLASS = /fixed inset-0|PHONE_SHEET_OVERLAY/;

type JsxNode = ts.JsxElement | ts.JsxSelfClosingElement;

export interface DialogGap {
  file: string;
  line: number;
  problem: 'no-role' | 'not-modal' | 'no-name' | 'no-escape';
}

function openingOf(node: JsxNode): ts.JsxOpeningLikeElement {
  return ts.isJsxElement(node) ? node.openingElement : node;
}

function attribute(node: JsxNode, name: string, sf: ts.SourceFile): ts.JsxAttribute | undefined {
  return openingOf(node)
    .attributes.properties.filter(ts.isJsxAttribute)
    .find((a) => a.name.getText(sf) === name);
}

function attributeText(node: JsxNode, name: string, sf: ts.SourceFile): string {
  return attribute(node, name, sf)?.initializer?.getText(sf) ?? '';
}

function elementChildren(node: JsxNode): JsxNode[] {
  if (!ts.isJsxElement(node)) return [];
  return node.children.filter((c): c is JsxNode => ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c));
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

const isDialogRole = (node: JsxNode, sf: ts.SourceFile) => /^["']?(alert)?dialog["']?$/.test(attributeText(node, 'role', sf));

export function dialogGapsOfSource(source: string, file: string): DialogGap[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const gaps: DialogGap[] = [];
  const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (OVERLAY_CLASS.test(attributeText(node, 'className', sf)) && !attribute(node, 'aria-hidden', sf)) {
        if (!isDialogRole(node, sf) && !elementChildren(node).some((child) => isDialogRole(child, sf))) {
          gaps.push({ file, line: lineOf(node), problem: 'no-role' });
        }
      }
      if (isDialogRole(node, sf)) {
        const inner = descendants(node);
        if (attributeText(node, 'aria-modal', sf) !== '"true"') gaps.push({ file, line: lineOf(node), problem: 'not-modal' });
        const named =
          attribute(node, 'aria-label', sf) ||
          attribute(node, 'aria-labelledby', sf) ||
          inner.some((child) => /^h[1-4]$/.test(openingOf(child).tagName.getText(sf)));
        if (!named) gaps.push({ file, line: lineOf(node), problem: 'no-name' });
        const isAlert = attributeText(node, 'role', sf).includes('alertdialog');
        const hasLayer = inner.some((child) => openingOf(child).tagName.getText(sf) === 'DialogLayer');
        if (!isAlert && !hasLayer && !DIALOG_BEHAVIOUR_FILES.has(file)) {
          gaps.push({ file, line: lineOf(node), problem: 'no-escape' });
        }
      }
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

export function repositoryDialogGaps(root = process.cwd()): DialogGap[] {
  return DIALOG_ROOTS.flatMap((dir) => tsxFiles(path.join(root, dir))).flatMap((full) =>
    dialogGapsOfSource(fs.readFileSync(full, 'utf8'), path.relative(root, full).split(path.sep).join('/')),
  );
}

if (process.argv[1]?.endsWith('dialog-roles.ts') || process.argv[1]?.endsWith('dialog-roles.js')) {
  const gaps = repositoryDialogGaps();
  for (const gap of gaps) console.log(`${gap.file}:${gap.line} ${gap.problem}`);
  console.log(gaps.length === 0 ? 'Dialog roles OK: every window has a role, a name and Esc' : `${gaps.length} window gaps`);
  process.exitCode = gaps.length === 0 ? 0 : 1;
}
