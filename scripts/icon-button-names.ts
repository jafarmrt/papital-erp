/**
 * Icon-only buttons need a spoken name (v10.1.27, TD-1276, Vibe Farsi package 3b).
 *
 * A `<button>` whose children are only icon components (no text, no expression, no image with
 * `alt`) and that has no `aria-label`, `aria-labelledby` or `title` reads as «دکمه» to a screen
 * reader. Vitest `iconButtonNamesTd1276.test.ts` requires none in browser code.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

export const ICON_BUTTON_ROOTS = ['src/pages', 'src/components', 'src/contexts', 'src/hooks', 'src/lib'];

const NAME_ATTRIBUTES = new Set(['aria-label', 'aria-labelledby', 'title']);
const PERSIAN_OR_EXPRESSION = /[؀-ۿ]|\{/;

export interface UnnamedIconButton {
  file: string;
  line: number;
  icons: string;
}

function tagNameOf(node: ts.JsxElement | ts.JsxSelfClosingElement, sf: ts.SourceFile): string {
  return (ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName).getText(sf);
}

function attributeNames(attrs: ts.JsxAttributes, sf: ts.SourceFile): string[] {
  return attrs.properties.filter(ts.isJsxAttribute).map((a) => a.name.getText(sf));
}

/** Whether a child element can name its button: text inside it, or an image with `alt`. */
function childGivesName(child: ts.JsxElement | ts.JsxSelfClosingElement, sf: ts.SourceFile): boolean {
  const attrs = ts.isJsxElement(child) ? child.openingElement.attributes : child.attributes;
  if (attributeNames(attrs, sf).some((name) => name === 'alt' || NAME_ATTRIBUTES.has(name))) return true;
  if (ts.isJsxSelfClosingElement(child)) return false;
  return PERSIAN_OR_EXPRESSION.test(child.getText(sf).replace(/<[A-Z]\w*[^>]*\/>/g, '').replace(/^<[^>]*>/, ''));
}

export function unnamedIconButtonsOfSource(source: string, file: string): UnnamedIconButton[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: UnnamedIconButton[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sf) === 'button') {
      const named = attributeNames(node.openingElement.attributes, sf).some((name) => NAME_ATTRIBUTES.has(name));
      const hasText = node.children.some(
        (c) => (ts.isJsxText(c) && c.text.trim() !== '') || (ts.isJsxExpression(c) && c.expression !== undefined),
      );
      const elements = node.children.filter(
        (c): c is ts.JsxElement | ts.JsxSelfClosingElement => ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c),
      );
      if (!named && !hasText && elements.length > 0 && !elements.some((e) => childGivesName(e, sf))) {
        found.push({
          file,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          icons: elements.map((e) => tagNameOf(e, sf)).join('+'),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function tsxFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    return entry.name.endsWith('.tsx') ? [full] : [];
  });
}

export function repositoryUnnamedIconButtons(root = process.cwd()): UnnamedIconButton[] {
  return ICON_BUTTON_ROOTS.flatMap((dir) => tsxFiles(path.join(root, dir))).flatMap((full) =>
    unnamedIconButtonsOfSource(fs.readFileSync(full, 'utf8'), path.relative(root, full).split(path.sep).join('/')),
  );
}

if (process.argv[1]?.endsWith('icon-button-names.ts') || process.argv[1]?.endsWith('icon-button-names.js')) {
  const found = repositoryUnnamedIconButtons();
  for (const site of found) console.log(`${site.file}:${site.line} ${site.icons}`);
  console.log(found.length === 0 ? 'Icon button names OK: every icon-only button has a name' : `${found.length} icon-only buttons without a name`);
  process.exitCode = found.length === 0 ? 0 : 1;
}
