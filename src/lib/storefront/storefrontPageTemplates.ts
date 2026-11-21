import { emptyDoc, type PageSection, type RichNode, type SectionBackground, type SectionKind } from './storefrontPageParts.js';

/** A new, empty section of a kind, as the builder adds it */
export function emptySection(kind: SectionKind): PageSection {
  const background: SectionBackground = 'white';
  switch (kind) {
    case 'hero': return { kind, background: 'brand', title: '', text: '', imageAssetId: null, buttonLabel: '', buttonHref: '' };
    case 'text': return { kind, background, doc: emptyDoc() };
    case 'textImage': return { kind, background, title: '', doc: emptyDoc(), imageAssetId: null, imageAlt: '', imageSide: 'right', buttonLabel: '', buttonHref: '' };
    case 'iconCards': return { kind, background, title: '', cards: [{ icon: 'leaf', title: '', text: '' }, { icon: 'handshake', title: '', text: '' }] };
    case 'gallery': return { kind, background, title: '', images: [] };
    case 'people': return { kind, background, title: '', people: [{ imageAssetId: null, name: '', role: '', contact: '' }] };
    case 'map': return { kind, background, title: '', imageAssetId: null, address: '', neshanUrl: '', baladUrl: '', googleUrl: '' };
    case 'products': return { kind, background, title: '', source: 'items', itemIds: [], collection: '' };
    case 'button': return { kind, background, label: '', href: '' };
    case 'shippingMethods': return { kind, background, title: 'روش‌های ارسال' };
    default: return { kind: 'text', background, doc: emptyDoc() };
  }
}

const paragraph = (line: string): RichNode => ({ type: 'paragraph', content: [{ type: 'text', text: line }] });
const PLACEHOLDER = 'متن این بخش را اینجا بنویسید.';

/**
 * «شروع از الگو»: the layout of the previous site's pages (the table of start plan §7.1), with their headings and an
 * empty place for every photo and text. Names and contact details of people are never in a template: the repository is
 * public, and the owner writes them in the ERP.
 */
export const PAGE_TEMPLATES = [
  {
    key: 'about' as const,
    title: 'درباره ما',
    sections: (): PageSection[] => [
      { kind: 'hero', background: 'brand', title: 'درباره ما', text: '', imageAssetId: null, buttonLabel: '', buttonHref: '' },
      {
        kind: 'iconCards', background: 'white', title: '',
        cards: [{ icon: 'leaf', title: 'متعهد به محیط زیست پایدار', text: '' }, { icon: 'handshake', title: 'تجارت عادلانه', text: '' }],
      },
      { kind: 'textImage', background: 'cream', title: 'تیم پاپیتال', doc: { type: 'doc', content: [paragraph(PLACEHOLDER)] }, imageAssetId: null, imageAlt: '', imageSide: 'left', buttonLabel: '', buttonHref: '' },
      { kind: 'text', background: 'white', doc: { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'کارگاه‌های آموزشی' }] }, paragraph(PLACEHOLDER)] } },
      { kind: 'gallery', background: 'white', title: '', images: [] },
      { kind: 'people', background: 'cream', title: 'پاپیتال در همه جا', people: [{ imageAssetId: null, name: '', role: '', contact: '' }, { imageAssetId: null, name: '', role: '', contact: '' }, { imageAssetId: null, name: '', role: '', contact: '' }] },
      {
        kind: 'text', background: 'dark',
        doc: { type: 'doc', content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'از محصولات ما دیدن کنید' }] }, paragraph(PLACEHOLDER),
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'فروشگاه‌های منتخب' }] }, paragraph(PLACEHOLDER),
        ] },
      },
    ],
  },
  {
    key: 'contact' as const,
    title: 'تماس با ما',
    sections: (): PageSection[] => [
      { kind: 'hero', background: 'dark', title: 'تماس با ما', text: '', imageAssetId: null, buttonLabel: '', buttonHref: '' },
      {
        kind: 'iconCards', background: 'white', title: '',
        cards: [{ icon: 'map', title: 'نشانی', text: '' }, { icon: 'clock', title: 'ساعت کاری', text: '' }, { icon: 'mail', title: 'ایمیل', text: '' }, { icon: 'phone', title: 'شماره تماس', text: '' }],
      },
      { kind: 'map', background: 'white', title: 'مسیر کارگاه', imageAssetId: null, address: '', neshanUrl: '', baladUrl: '', googleUrl: '' },
    ],
  },
] as const;
export type PageTemplateKey = typeof PAGE_TEMPLATES[number]['key'];
export const isPageTemplateKey = (value: unknown): value is PageTemplateKey => PAGE_TEMPLATES.some(template => template.key === value);
