import {
  CONTROL_IN_RICH_TEXT, IMAGE_ALT_MAX, RICH_TEXT_CHARS_MAX, RICH_TEXT_DEPTH_MAX, RICH_TEXT_HEADING_LEVELS, RICH_TEXT_NODES_MAX, RICH_TEXT_TABLE_COLUMNS_MAX,
  RICH_TEXT_TABLE_ROWS_MAX, Refused, TEXT_ALIGNS, TEXT_COLORS, fa, hasLoneSurrogate, isId, isRecord, link, list, oneOf, refuse, text, type RichDoc, type RichMark,
  type RichNode,
} from './storefrontPageParts.js';

/**
 * v12 phase 10b: the text of the editor (Tiptap's JSON) as the site's pages keep it. Only the nodes and marks named here
 * are taken, each rebuilt from its known attributes alone, so an attribute the editor adds of its own, or one a forged
 * request carries (an event handler, an image's address), never reaches the database; an unknown node or mark, or a
 * known one where it does not belong, is refused with a message that names it. (An attribute outside the known ones
 * carries no content of the page and is simply not kept: the editor itself adds several of its own.)
 * The shapes taken here are exactly the editor's schema (`RichTextEditor.tsx`): a quote and a table cell hold
 * paragraphs, a list item a paragraph and then lists, and nothing that holds content may be empty.
 */

/** The nodes by the names a colleague knows them by, for the messages */
const NODE_TITLES: Readonly<Record<string, string>> = {
  paragraph: 'پاراگراف', heading: 'تیتر', bulletList: 'فهرست نقطه‌ای', orderedList: 'فهرست شماره‌دار', listItem: 'گزینهٔ فهرست', blockquote: 'نقل‌قول',
  horizontalRule: 'خط جداکننده', libraryImage: 'عکس', table: 'جدول', tableRow: 'ردیف جدول', tableCell: 'خانهٔ جدول', tableHeader: 'خانهٔ سرستون جدول',
  text: 'متن', hardBreak: 'خط تازه',
};
const PARENT_TITLES: Readonly<Record<string, string>> = {
  doc: 'متن', bulletList: 'فهرست', orderedList: 'فهرست', listItem: 'گزینهٔ فهرست', blockquote: 'نقل‌قول', table: 'جدول', tableRow: 'ردیف جدول',
  tableCell: 'خانهٔ جدول', tableHeader: 'خانهٔ جدول',
};
/** a known node in a place it does not belong, or a node this text never takes */
const misplaced = (type: string, parent: string): never => (
  NODE_TITLES[type]
    ? refuse(`«${NODE_TITLES[type]}» درون ${PARENT_TITLES[parent] ?? 'این بخش'} نمی‌آید؛ آن را بیرون بیاورید.`, 'STOREFRONT_PAGE_NODE_MISPLACED')
    : refuse(`عنصر ناشناختهٔ «${type.slice(0, 40)}» در متن صفحه پذیرفته نمی‌شود.`, 'STOREFRONT_PAGE_NODE_UNKNOWN')
);

interface Budget { nodes: number; chars: number }

function marksOf(value: unknown): RichMark[] {
  if (value === undefined) return [];
  const raw = list(value, 8, 'قالب متن');
  const marks: RichMark[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.type !== 'string') return refuse('قالب متن ناشناخته است.', 'STOREFRONT_PAGE_MARK_UNKNOWN');
    const attrs = isRecord(item.attrs) ? item.attrs : {};
    switch (item.type) {
      case 'bold': case 'italic': case 'underline':
        marks.push({ type: item.type });
        break;
      case 'textColor':
        marks.push({ type: 'textColor', attrs: { color: oneOf(attrs.color, TEXT_COLORS, 'رنگ متن') } });
        break;
      case 'link': {
        const href = link(attrs.href, 'پیوند متن');
        if (!href) return refuse('پیوند متن نشانی ندارد.', 'STOREFRONT_PAGE_LINK_INVALID');
        marks.push({ type: 'link', attrs: { href } });
        break;
      }
      default:
        return refuse(`قالب «${item.type.slice(0, 40)}» در متن صفحه پذیرفته نمی‌شود.`, 'STOREFRONT_PAGE_MARK_UNKNOWN');
    }
  }
  if (new Set(marks.map(m => m.type)).size !== marks.length) return refuse('یک قالب دو بار روی یک تکه متن آمده است.', 'STOREFRONT_PAGE_MARK_UNKNOWN');
  return marks;
}

const alignOf = (attrs: Record<string, unknown>): Record<string, string> => (
  attrs.textAlign === null || attrs.textAlign === undefined ? {} : { textAlign: oneOf(attrs.textAlign, TEXT_ALIGNS, 'چینش متن') }
);

function inlineOf(value: unknown, budget: Budget): RichNode[] {
  if (value === undefined) return [];
  return list(value, RICH_TEXT_NODES_MAX, 'متن').map((raw): RichNode => {
    budget.nodes += 1;
    if (!isRecord(raw) || typeof raw.type !== 'string') return refuse('تکه‌ای از متن خوانا نیست.', 'STOREFRONT_PAGE_NODE_UNKNOWN');
    if (raw.type === 'hardBreak') return { type: 'hardBreak' };
    if (raw.type !== 'text') return misplaced(raw.type, 'paragraph');
    if (typeof raw.text !== 'string' || raw.text === '') return refuse('تکه‌ای از متن خالی است.', 'STOREFRONT_PAGE_NODE_UNKNOWN');
    if (CONTROL_IN_RICH_TEXT.test(raw.text) || hasLoneSurrogate(raw.text)) return refuse('متن نویسهٔ کنترلی دارد؛ آن را دوباره بنویسید.', 'STOREFRONT_PAGE_FIELD_INVALID');
    budget.chars += raw.text.length;
    const marks = marksOf(raw.marks);
    return marks.length ? { type: 'text', text: raw.text, marks } : { type: 'text', text: raw.text };
  });
}

function blocksOf(value: unknown, budget: Budget, depth: number, allowed: readonly string[], parent: string): RichNode[] {
  if (value === undefined) return [];
  if (depth > RICH_TEXT_DEPTH_MAX) return refuse('فهرست‌های تودرتوی متن بیش از اندازه عمیق‌اند.', 'STOREFRONT_PAGE_TEXT_TOO_DEEP');
  return list(value, RICH_TEXT_NODES_MAX, 'متن').map((raw): RichNode => {
    budget.nodes += 1;
    if (!isRecord(raw) || typeof raw.type !== 'string') return refuse('تکه‌ای از متن خوانا نیست.', 'STOREFRONT_PAGE_NODE_UNKNOWN');
    if (!allowed.includes(raw.type)) return misplaced(raw.type, parent);
    const attrs = isRecord(raw.attrs) ? raw.attrs : {};
    const withContent = (node: RichNode, content: RichNode[]): RichNode => (content.length ? { ...node, content } : node);
    switch (raw.type) {
      case 'paragraph': {
        const align = alignOf(attrs);
        return withContent(Object.keys(align).length ? { type: 'paragraph', attrs: align } : { type: 'paragraph' }, inlineOf(raw.content, budget));
      }
      case 'heading': {
        if (!RICH_TEXT_HEADING_LEVELS.includes(attrs.level as 2 | 3 | 4)) return refuse('تیتر متن فقط در سه اندازهٔ ۲ تا ۴ است.', 'STOREFRONT_PAGE_NODE_UNKNOWN');
        return withContent({ type: 'heading', attrs: { level: attrs.level as number, ...alignOf(attrs) } }, inlineOf(raw.content, budget));
      }
      case 'bulletList': case 'orderedList': {
        const items = blocksOf(raw.content, budget, depth + 1, ['listItem'], raw.type);
        if (items.length === 0) return refuse('فهرست دست‌کم یک گزینه دارد.', 'STOREFRONT_PAGE_NODE_EMPTY');
        // a numbered list may start past one (a list continued after a paragraph); nothing else of a list is kept
        const start = raw.type === 'orderedList' && Number.isInteger(attrs.start) && (attrs.start as number) > 1 && (attrs.start as number) <= 9999 ? attrs.start as number : 1;
        return start > 1 ? { type: raw.type, attrs: { start }, content: items } : { type: raw.type, content: items };
      }
      case 'listItem': {
        const inside = blocksOf(raw.content, budget, depth + 1, ['paragraph', 'bulletList', 'orderedList'], 'listItem');
        if (inside[0]?.type !== 'paragraph' || inside.slice(1).some(node => node.type === 'paragraph')) {
          return refuse('هر گزینهٔ فهرست یک پاراگراف دارد و سپس، اگر بخواهید، فهرست‌های درون خودش.', 'STOREFRONT_PAGE_NODE_EMPTY');
        }
        return { type: 'listItem', content: inside };
      }
      case 'blockquote': {
        const inside = blocksOf(raw.content, budget, depth + 1, ['paragraph'], 'blockquote');
        if (inside.length === 0) return refuse('نقل‌قول خالی است.', 'STOREFRONT_PAGE_NODE_EMPTY');
        return { type: 'blockquote', content: inside };
      }
      case 'horizontalRule':
        if (raw.content !== undefined) return refuse('خط جداکننده چیزی درون خود ندارد.', 'STOREFRONT_PAGE_NODE_MISPLACED');
        return { type: 'horizontalRule' };
      case 'libraryImage': {
        if (raw.content !== undefined) return refuse('عکس چیزی درون خود ندارد.', 'STOREFRONT_PAGE_NODE_MISPLACED');
        if (!isId(attrs.assetId)) return refuse('عکس درون متن باید از کتابخانهٔ تصاویر باشد.', 'STOREFRONT_PAGE_IMAGE_INVALID');
        return { type: 'libraryImage', attrs: { assetId: attrs.assetId, alt: text(attrs.alt ?? '', IMAGE_ALT_MAX, 'متن جایگزین عکس') } };
      }
      case 'table': {
        const rows = blocksOf(raw.content, budget, depth + 1, ['tableRow'], 'table');
        if (rows.length === 0 || rows.length > RICH_TEXT_TABLE_ROWS_MAX) return refuse(`جدول ۱ تا ${fa(RICH_TEXT_TABLE_ROWS_MAX)} ردیف دارد.`, 'STOREFRONT_PAGE_TABLE_INVALID');
        const widths = new Set(rows.map(row => row.content?.length ?? 0));
        if (widths.size !== 1 || widths.has(0) || [...widths][0] > RICH_TEXT_TABLE_COLUMNS_MAX) {
          return refuse(`جدول ساده است: همهٔ ردیف‌ها یک اندازه‌اند و حداکثر ${fa(RICH_TEXT_TABLE_COLUMNS_MAX)} ستون دارد.`, 'STOREFRONT_PAGE_TABLE_INVALID');
        }
        return { type: 'table', content: rows };
      }
      case 'tableRow':
        return withContent({ type: 'tableRow' }, blocksOf(raw.content, budget, depth + 1, ['tableCell', 'tableHeader'], 'tableRow'));
      case 'tableCell': case 'tableHeader': {
        // a simple table: no cell spans rows or columns
        if ((attrs.colspan ?? 1) !== 1 || (attrs.rowspan ?? 1) !== 1) return refuse('خانه‌های جدول ادغام نمی‌شوند.', 'STOREFRONT_PAGE_TABLE_INVALID');
        const inside = blocksOf(raw.content, budget, depth + 1, ['paragraph'], raw.type);
        if (inside.length === 0) return refuse('هر خانهٔ جدول دست‌کم یک پاراگراف دارد (می‌تواند خالی باشد).', 'STOREFRONT_PAGE_NODE_EMPTY');
        return { type: raw.type, content: inside };
      }
      default:
        return misplaced(raw.type, parent);
    }
  });
}

const TOP_BLOCKS = ['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote', 'horizontalRule', 'libraryImage', 'table'] as const;

/** The editor's JSON as it is kept: only the known nodes, marks and attributes; throws `Refused` for anything else */
export function richDoc(value: unknown): RichDoc {
  if (value === undefined || value === null) return { type: 'doc', content: [] };
  if (!isRecord(value) || value.type !== 'doc') return refuse('متن بخش خوانا نیست.', 'STOREFRONT_PAGE_NODE_UNKNOWN');
  const budget: Budget = { nodes: 0, chars: 0 };
  const content = blocksOf(value.content, budget, 1, TOP_BLOCKS, 'doc');
  if (budget.nodes > RICH_TEXT_NODES_MAX) return refuse('متن این بخش بیش از اندازه تکه‌تکه است؛ آن را در دو بخش بنویسید.', 'STOREFRONT_PAGE_TEXT_TOO_LONG');
  if (budget.chars > RICH_TEXT_CHARS_MAX) return refuse(`متن هر بخش حداکثر ${fa(RICH_TEXT_CHARS_MAX)} نویسه است.`, 'STOREFRONT_PAGE_TEXT_TOO_LONG');
  return { type: 'doc', content };
}

/** The editor's JSON checked on its own; `null` with the reason when it is refused */
export function safeRichDoc(value: unknown): { doc: RichDoc; problem: null } | { doc: null; problem: { message: string; code: string } } {
  try {
    return { doc: richDoc(value), problem: null };
  } catch (error) {
    if (error instanceof Refused) return { doc: null, problem: { message: error.message, code: error.code } };
    throw error;
  }
}

export const docIsEmpty = (doc: RichDoc): boolean => !doc.content.some(function filled(node: RichNode): boolean {
  return node.type === 'libraryImage' || node.type === 'horizontalRule' || Boolean(node.text?.trim()) || Boolean(node.content?.some(filled));
});

export function docAssetIds(node: RichNode | RichDoc): number[] {
  const own = node.type === 'libraryImage' && isId((node as RichNode).attrs?.assetId) ? [(node as RichNode).attrs!.assetId as number] : [];
  return [...own, ...(node.content ?? []).flatMap(docAssetIds)];
}
