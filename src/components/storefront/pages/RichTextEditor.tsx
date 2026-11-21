import { useEffect, useId, useRef, useState } from 'react';
import { EditorContent, Mark, Node, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TableKit } from '@tiptap/extension-table';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, ImageIcon, Italic, Link2, Link2Off, List, ListOrdered, Minus, Quote, Redo2, Table, Trash2,
  Underline, Undo2,
} from 'lucide-react';
import { useHasPermission } from '../../../contexts/AuthContext';
import {
  IMAGE_ALT_MAX, RICH_TEXT_HEADING_LEVELS, TEXT_ALIGNS, TEXT_COLORS, TEXT_COLOR_TITLES, pageLink, type RichDoc, type TextAlign as Align, type TextColor,
} from '../../../lib/storefront/storefrontPageRules';
import { LibraryImageList, libraryThumbUrl } from './LibraryImageField';

/**
 * v12 phase 10b (owner's decision 4): the text editor of a page's section, Tiptap. It is loaded only by the page
 * builder. Its schema holds only what the server takes (`storefrontPageRichText.ts`): paragraphs, headings 2 to 4, lists,
 * a quote, a simple table, a rule, an image of the media library (by its id), bold, italic, underline, a colour of the
 * fixed palette, alignment and a link to this site or an https address; pasted content of any other kind is dropped by
 * the schema, and the server refuses what a forged request adds.
 */

/** A colour of the palette on a run of text, by its name (the site keeps its own colours) */
const TextColorMark = Mark.create({
  name: 'textColor',
  addAttributes() {
    return {
      color: {
        default: 'brand',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-text-color'),
        renderHTML: (attributes: { color?: string }) => ({ 'data-text-color': attributes.color }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-text-color]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', HTMLAttributes, 0];
  },
});

/** An image of the media library inside a text, kept by its id; the editor shows the library's own thumbnail */
const LibraryImage = Node.create({
  name: 'libraryImage',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      assetId: { default: null, parseHTML: (element: HTMLElement) => Number(element.getAttribute('data-asset-id')) || null },
      alt: { default: '', parseHTML: (element: HTMLElement) => element.getAttribute('alt') ?? '' },
    };
  },
  parseHTML() {
    return [{ tag: 'img[data-asset-id]' }];
  },
  renderHTML({ node }) {
    const assetId = Number(node.attrs.assetId) || 0;
    return ['img', { 'data-asset-id': String(assetId), src: assetId ? libraryThumbUrl(assetId) : '', alt: String(node.attrs.alt ?? ''), class: 'my-2 max-h-40 rounded-lg bg-slate-100' }];
  },
});

/** The editor's whole schema: nothing outside it can be typed, pasted or loaded into a page's text */
export const pageEditorExtensions = () => [
  StarterKit.configure({
    heading: { levels: [...RICH_TEXT_HEADING_LEVELS] }, code: false, codeBlock: false, strike: false,
    link: { openOnClick: false, autolink: false, linkOnPaste: false, protocols: ['https'], HTMLAttributes: { rel: null, target: null, class: null } },
  }),
  TextAlign.configure({ types: ['heading', 'paragraph'], alignments: [...TEXT_ALIGNS] }),
  TableKit.configure({ table: { resizable: false } }),
  TextColorMark,
  LibraryImage,
];

const ALIGN_ICONS = { right: AlignRight, center: AlignCenter, left: AlignLeft, justify: AlignJustify } as const;
const ALIGN_TITLES: Readonly<Record<Align, string>> = { right: 'راست‌چین', center: 'وسط‌چین', left: 'چپ‌چین', justify: 'هم‌تراز' };
const HEADING_TITLES: Readonly<Record<number, string>> = { 2: 'تیتر بزرگ', 3: 'تیتر میانه', 4: 'تیتر کوچک' };
const COLOR_CLASSES: Readonly<Record<TextColor, string>> = { brand: 'bg-sky-800', accent: 'bg-amber-400', muted: 'bg-slate-400', danger: 'bg-rose-600' };

const tool = (active: boolean) => `inline-flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-xs font-bold ${active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'} disabled:opacity-40`;
const CONTENT = [
  'min-h-32 rounded-b-xl border border-t-0 border-slate-200 bg-white px-3 py-2 text-sm leading-7 text-slate-800 focus:outline-none',
  '[&_h2]:mt-3 [&_h2]:text-lg [&_h2]:font-black [&_h3]:mt-3 [&_h3]:text-base [&_h3]:font-black [&_h4]:mt-2 [&_h4]:font-bold',
  '[&_ul]:list-disc [&_ul]:ps-6 [&_ol]:list-decimal [&_ol]:ps-6 [&_blockquote]:border-s-4 [&_blockquote]:border-slate-300 [&_blockquote]:ps-3 [&_blockquote]:text-slate-600',
  '[&_hr]:my-3 [&_hr]:border-slate-300 [&_a]:text-sky-700 [&_a]:underline',
  '[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-slate-300 [&_td]:p-1.5 [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-50 [&_th]:p-1.5',
  '[&_[data-text-color=brand]]:text-sky-800 [&_[data-text-color=accent]]:text-amber-600 [&_[data-text-color=muted]]:text-slate-500 [&_[data-text-color=danger]]:text-rose-600',
].join(' ');

function Toolbar({ editor, label, canPickImage }: { editor: Editor; label: string; canPickImage: boolean }) {
  const id = useId();
  const [panel, setPanel] = useState<'none' | 'link' | 'image'>('none');
  const [href, setHref] = useState('');
  const [alt, setAlt] = useState('');
  const linkProblem = href.trim() !== '' && !pageLink(href);
  const inTable = editor.isActive('table');
  const run = (command: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => { command(editor.chain().focus()).run(); };
  const openLink = () => {
    setHref(String(editor.getAttributes('link').href ?? ''));
    setPanel(p => (p === 'link' ? 'none' : 'link'));
  };
  const setLink = () => {
    const kept = pageLink(href);
    if (!kept) return;
    run(chain => chain.extendMarkRange('link').setLink({ href: kept }));
    setPanel('none');
  };

  return (
    <div className="rounded-t-xl border border-slate-200 bg-slate-50 p-1">
      <div role="toolbar" aria-label={`ابزار ${label}`} className="flex flex-wrap items-center gap-0.5">
        <button type="button" className={tool(editor.isActive('bold'))} aria-pressed={editor.isActive('bold')} aria-label="پررنگ" onClick={() => run(c => c.toggleBold())}><Bold className="h-4 w-4" /></button>
        <button type="button" className={tool(editor.isActive('italic'))} aria-pressed={editor.isActive('italic')} aria-label="کج" onClick={() => run(c => c.toggleItalic())}><Italic className="h-4 w-4" /></button>
        <button type="button" className={tool(editor.isActive('underline'))} aria-pressed={editor.isActive('underline')} aria-label="زیرخط" onClick={() => run(c => c.toggleUnderline())}><Underline className="h-4 w-4" /></button>
        {RICH_TEXT_HEADING_LEVELS.map(level => (
          <button key={level} type="button" className={tool(editor.isActive('heading', { level }))} aria-pressed={editor.isActive('heading', { level })}
            onClick={() => run(c => c.toggleHeading({ level }))}>{HEADING_TITLES[level]}</button>
        ))}
        <button type="button" className={tool(editor.isActive('bulletList'))} aria-pressed={editor.isActive('bulletList')} aria-label="فهرست نقطه‌ای" onClick={() => run(c => c.toggleBulletList())}><List className="h-4 w-4" /></button>
        <button type="button" className={tool(editor.isActive('orderedList'))} aria-pressed={editor.isActive('orderedList')} aria-label="فهرست شماره‌دار" onClick={() => run(c => c.toggleOrderedList())}><ListOrdered className="h-4 w-4" /></button>
        <button type="button" className={tool(editor.isActive('blockquote'))} aria-pressed={editor.isActive('blockquote')} aria-label="نقل‌قول" onClick={() => run(c => c.toggleBlockquote())}><Quote className="h-4 w-4" /></button>
        <button type="button" className={tool(false)} aria-label="خط جداکننده" onClick={() => run(c => c.setHorizontalRule())}><Minus className="h-4 w-4" /></button>
        {TEXT_ALIGNS.map((align) => {
          const Icon = ALIGN_ICONS[align];
          const active = editor.isActive({ textAlign: align });
          return (
            <button key={align} type="button" className={tool(active)} aria-pressed={active} aria-label={ALIGN_TITLES[align]}
              onClick={() => run(c => (active ? c.unsetTextAlign() : c.setTextAlign(align)))}><Icon className="h-4 w-4" /></button>
          );
        })}
        {TEXT_COLORS.map((color) => {
          const active = editor.isActive('textColor', { color });
          return (
            <button key={color} type="button" className={tool(active)} aria-pressed={active} aria-label={`رنگ ${TEXT_COLOR_TITLES[color]}`}
              onClick={() => run(c => (active ? c.unsetMark('textColor') : c.setMark('textColor', { color })))}>
              <span aria-hidden className={`h-4 w-4 rounded-full ${COLOR_CLASSES[color]}`} />
            </button>
          );
        })}
        <button type="button" className={tool(editor.isActive('link') || panel === 'link')} aria-expanded={panel === 'link'} aria-label="پیوند" onClick={openLink}><Link2 className="h-4 w-4" /></button>
        {editor.isActive('link') && (
          <button type="button" className={tool(false)} aria-label="برداشتن پیوند" onClick={() => run(c => c.extendMarkRange('link').unsetLink())}><Link2Off className="h-4 w-4" /></button>
        )}
        {canPickImage && (
          <button type="button" className={tool(panel === 'image')} aria-expanded={panel === 'image'} aria-label="عکس از کتابخانهٔ تصاویر" onClick={() => setPanel(p => (p === 'image' ? 'none' : 'image'))}><ImageIcon className="h-4 w-4" /></button>
        )}
        <button type="button" className={tool(inTable)} aria-label="جدول" disabled={inTable} onClick={() => run(c => c.insertTable({ rows: 3, cols: 2, withHeaderRow: true }))}><Table className="h-4 w-4" /></button>
        {inTable && (
          <>
            <button type="button" className={tool(false)} onClick={() => run(c => c.addRowAfter())}>ردیف تازه</button>
            <button type="button" className={tool(false)} onClick={() => run(c => c.addColumnAfter())}>ستون تازه</button>
            <button type="button" className={tool(false)} onClick={() => run(c => c.deleteRow())}>حذف ردیف</button>
            <button type="button" className={tool(false)} onClick={() => run(c => c.deleteColumn())}>حذف ستون</button>
            <button type="button" className={tool(false)} aria-label="حذف جدول" onClick={() => run(c => c.deleteTable())}><Trash2 className="h-4 w-4" /></button>
          </>
        )}
        <button type="button" className={tool(false)} aria-label="برگرداندن" disabled={!editor.can().undo()} onClick={() => run(c => c.undo())}><Undo2 className="h-4 w-4" /></button>
        <button type="button" className={tool(false)} aria-label="دوباره" disabled={!editor.can().redo()} onClick={() => run(c => c.redo())}><Redo2 className="h-4 w-4" /></button>
      </div>
      {panel === 'link' && (
        <div className="mt-1 flex flex-wrap items-end gap-2 rounded-lg bg-white p-2">
          <div className="min-w-48 flex-1">
            <label htmlFor={`${id}-href`} className="mb-1 block text-xs font-bold text-slate-700">نشانی پیوند</label>
            <input id={`${id}-href`} dir="ltr" value={href} onChange={e => setHref(e.target.value)} placeholder="/products یا https://"
              aria-invalid={linkProblem ? true : undefined} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setLink(); } }} />
          </div>
          <button type="button" disabled={!pageLink(href)} onClick={setLink} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">گذاشتن پیوند</button>
          {linkProblem && <p role="alert" className="w-full text-xs text-rose-700">پیوند باید مسیری از همین سایت باشد که با «/» آغاز می‌شود، یا نشانی‌ای که با https:// آغاز می‌شود.</p>}
        </div>
      )}
      {panel === 'image' && (
        <div className="mt-1 space-y-2 rounded-lg bg-white p-2">
          <div>
            <label htmlFor={`${id}-alt`} className="mb-1 block text-xs font-bold text-slate-700">متن جایگزین عکس</label>
            <input id={`${id}-alt`} value={alt} maxLength={IMAGE_ALT_MAX} onChange={e => setAlt(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm" />
          </div>
          <LibraryImageList value={null} onPick={(assetId, title) => {
            run(c => c.insertContent({ type: 'libraryImage', attrs: { assetId, alt: alt.trim() || title.slice(0, IMAGE_ALT_MAX) } }));
            setAlt('');
            setPanel('none');
          }} />
        </div>
      )}
    </div>
  );
}

export default function RichTextEditor({ label, value, disabled, onChange }: {
  /** what the text is, for the toolbar's and the field's names */
  label: string;
  value: RichDoc;
  disabled: boolean;
  onChange: (doc: RichDoc) => void;
}) {
  const canPickImage = useHasPermission('media.view');
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });
  const editor = useEditor({
    extensions: pageEditorExtensions(),
    content: value,
    editable: !disabled,
    editorProps: { attributes: { class: CONTENT, dir: 'rtl', role: 'textbox', 'aria-multiline': 'true', 'aria-label': label } },
    onUpdate: ({ editor: current }) => { onChangeRef.current(current.getJSON() as RichDoc); },
  });
  useEffect(() => { editor?.setEditable(!disabled); }, [editor, disabled]);
  if (!editor) return <p className="text-xs text-slate-500">در حال آماده شدن ویرایشگر…</p>;
  return (
    <div>
      {!disabled && <Toolbar editor={editor} label={label} canPickImage={canPickImage} />}
      <EditorContent editor={editor} />
    </div>
  );
}
