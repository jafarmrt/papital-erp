import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import { TEXT_ALIGNS, TEXT_COLORS, pageLink, type RichDoc, type TextAlign, type TextColor } from '@erp/storefront/storefrontPageParts';
import { mediaPath } from '../lib/brand';
import { DOC_DEPTH_MAX, docIsBlank, pageImage } from '../lib/pages';

/**
 * v12 phase 10c: a text of the ERP's page builder (the editor's JSON) drawn as elements. No HTML comes from the ERP and
 * none is made from a string here: each node this file knows becomes its own element, a node it does not know is left
 * out, every word is a text node of React (so a `<script>` someone typed is shown as the letters they typed), a link is
 * only a path of this site or an https address, and an image is only a file of `/media`.
 */
type Node = { type?: unknown; attrs?: unknown; content?: unknown; text?: unknown; marks?: unknown };

/**
 * The colours of a word. On the two deep grounds («لاجوردی», «سرمه‌ای») the cobalt and the tile blue would not be read,
 * so both become one light sky blue there, grey becomes the ground's own light text dimmed, and red (which no deep
 * ground carries legibly) is the ground's own text.
 */
const COLOR_CLASSES: Readonly<Record<TextColor, string>> = {
  brand: 'text-brand in-data-[tone=deep]:text-accent-light', accent: 'text-accent-ink in-data-[tone=deep]:text-accent-light',
  muted: 'text-muted-foreground in-data-[tone=deep]:text-inherit in-data-[tone=deep]:opacity-75', danger: 'text-destructive in-data-[tone=deep]:text-inherit',
};
const LINK_CLASS = 'font-medium text-brand underline underline-offset-4 hover:no-underline in-data-[tone=deep]:text-inherit';

const attrsOf = (node: Node): Record<string, unknown> => (typeof node.attrs === 'object' && node.attrs !== null ? node.attrs as Record<string, unknown> : {});
const childrenOf = (node: Node): Node[] => (Array.isArray(node.content) ? node.content.filter((n): n is Node => typeof n === 'object' && n !== null) : []);
/** the side the ERP's editor chose for a line, written only when it chose one (a line without one follows the page) */
const alignOf = (node: Node): CSSProperties | undefined => {
  const align = attrsOf(node).textAlign;
  return TEXT_ALIGNS.includes(align as TextAlign) ? { textAlign: align as TextAlign } : undefined;
};

function marked(text: string, marks: unknown, key: number): ReactNode {
  let out: ReactNode = text;
  for (const raw of Array.isArray(marks) ? marks : []) {
    const mark = raw as { type?: unknown; attrs?: { color?: unknown; href?: unknown } } | null;
    switch (mark?.type) {
      case 'bold': out = <strong>{out}</strong>; break;
      case 'italic': out = <em>{out}</em>; break;
      case 'underline': out = <u>{out}</u>; break;
      case 'textColor':
        if (TEXT_COLORS.includes(mark.attrs?.color as TextColor)) out = <span className={COLOR_CLASSES[mark.attrs?.color as TextColor]}>{out}</span>;
        break;
      case 'link': {
        const href = pageLink(mark.attrs?.href);
        if (href?.startsWith('/')) out = <Link to={href} className={LINK_CLASS}>{out}</Link>;
        else if (href) out = <a href={href} rel="noopener noreferrer" className={`${LINK_CLASS} break-words`}>{out}</a>;
        break;
      }
      default: break;
    }
  }
  return <span key={key}>{out}</span>;
}

const inline = (nodes: Node[]): ReactNode[] => nodes.flatMap((node, i): ReactNode[] => {
  if (node.type === 'hardBreak') return [<br key={i} />];
  if (node.type === 'text' && typeof node.text === 'string') return [marked(node.text, node.marks, i)];
  return [];
});

function block(node: Node, key: number, depth: number): ReactNode {
  if (depth > DOC_DEPTH_MAX) return null;
  const inside = () => childrenOf(node).map((child, i) => block(child, i, depth + 1));
  switch (node.type) {
    case 'paragraph':
      return <p key={key} style={alignOf(node)}>{inline(childrenOf(node))}</p>;
    case 'heading': {
      const level = attrsOf(node).level;
      const words = inline(childrenOf(node));
      if (level === 2) return <h2 key={key} style={alignOf(node)} className="pt-2 text-xl font-extrabold lg:text-2xl">{words}</h2>;
      if (level === 3) return <h3 key={key} style={alignOf(node)} className="pt-1 text-lg font-bold lg:text-xl">{words}</h3>;
      return <h4 key={key} style={alignOf(node)} className="font-bold">{words}</h4>;
    }
    case 'bulletList':
      return <ul key={key} className="list-disc space-y-2 ps-6">{inside()}</ul>;
    case 'orderedList': {
      const start = attrsOf(node).start;
      return <ol key={key} start={typeof start === 'number' && Number.isInteger(start) && start > 1 ? start : undefined} className="list-decimal space-y-2 ps-6" style={{ listStyleType: 'persian' }}>{inside()}</ol>;
    }
    case 'listItem':
      return <li key={key} className="space-y-2">{inside()}</li>;
    case 'blockquote':
      return <blockquote key={key} className="space-y-3 border-s-4 border-tile ps-4 text-lg leading-9">{inside()}</blockquote>;
    case 'horizontalRule':
      return <hr key={key} className="border-current opacity-15" />;
    case 'libraryImage': {
      const image = pageImage(attrsOf(node));
      if (!image) return null;
      return (
        <img
          key={key} src={mediaPath(image.sha256)} alt={image.alt} width={image.width ?? 1600} height={image.height ?? 1000} loading="lazy" decoding="async"
          className="h-auto max-w-full rounded-surface"
        />
      );
    }
    case 'table':
      // a wide table scrolls inside its own box, so the page never does (the 360 px rule)
      return (
        <div key={key} className="max-w-full overflow-x-auto rounded-surface border border-current/15" tabIndex={0} role="group" aria-label="جدول">
          <table className="w-full min-w-max border-collapse text-start text-sm"><tbody>{inside()}</tbody></table>
        </div>
      );
    case 'tableRow':
      return <tr key={key} className="border-b border-current/15 last:border-b-0">{inside()}</tr>;
    case 'tableHeader':
      return <th key={key} className="space-y-2 px-3 py-2 text-start align-top font-bold">{inside()}</th>;
    case 'tableCell':
      return <td key={key} className="space-y-2 px-3 py-2 align-top">{inside()}</td>;
    default:
      return null;
  }
}

export function RichText({ doc, className = '' }: { doc: RichDoc; className?: string }) {
  if (docIsBlank(doc)) return null;
  return <div className={`space-y-4 leading-8 break-words ${className}`}>{childrenOf(doc).map((node, i) => block(node, i, 1))}</div>;
}
