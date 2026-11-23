import { STOREFRONT_SLUG_PATTERN } from './storefrontRules.js';
import {
  BUTTON_LABEL_MAX, CARD_TEXT_MAX, CARD_TITLE_MAX, COLLECTION_NAME_MAX, GALLERY_MAX, GALLERY_MIN, ICON_CARDS_MAX, ICON_CARDS_MIN, IMAGE_ALT_MAX,
  MAP_ADDRESS_MAX, PAGE_ICONS, PAGE_SECTIONS_MAX, PAGE_SEO_DESCRIPTION_MAX, PAGE_SEO_TITLE_MAX, PAGE_SLUG_MAX, PAGE_TITLE_MAX, PEOPLE_MAX, PERSON_CONTACT_MAX,
  PERSON_NAME_MAX, PERSON_ROLE_MAX, PRODUCT_ROW_MAX, Refused, SECTION_BACKGROUNDS, SECTION_KINDS, SECTION_KIND_TITLES, SECTION_TEXT_MAX, SECTION_TITLE_MAX,
  RESERVED_PAGE_SLUG_MESSAGE, SHIPPING_SECTION_PAGE, assetId, fa, isId, isRecord, isReservedPageSlug, link, list, oneOf, onlyKeys, refuse, text, type BasePageSlug, type GalleryImage, type IconCard,
  type PageProblem, type PageSection, type PageValues, type Person, FIXED_PAGE_TEXT_MAX,
 type SectionKind,
} from './storefrontPageParts.js';
import { docAssetIds, docIsEmpty, richDoc } from './storefrontPageRichText.js';

/**
 * v12 phase 10b: the sections of a page and the page itself, as they are checked before every write. The constants, the
 * types and the small checks are in `storefrontPageParts.ts`, the editor's text in `storefrontPageRichText.ts` and the
 * builder's templates in `storefrontPageTemplates.ts`; every one of them is reached through this file.
 */
export * from './storefrontPageParts.js';
export { safeRichDoc } from './storefrontPageRichText.js';
export * from './storefrontPageTemplates.js';

const BASE_KEYS = ['kind', 'background'] as const;

function sectionOf(raw: unknown): PageSection {
  if (!isRecord(raw)) return refuse('یکی از بخش‌های صفحه خوانا نیست.', 'STOREFRONT_PAGE_SECTION_INVALID');
  const kind = oneOf(raw.kind, SECTION_KINDS, 'نوع بخش');
  const background = oneOf(raw.background ?? 'white', SECTION_BACKGROUNDS, 'زمینهٔ بخش');
  const keys = (...own: string[]) => onlyKeys(raw, [...BASE_KEYS, ...own], `بخش «${SECTION_KIND_TITLES[kind]}»`);
  switch (kind) {
    case 'hero':
      keys('title', 'text', 'imageAssetId', 'buttonLabel', 'buttonHref');
      return {
        kind, background, title: text(raw.title ?? '', SECTION_TITLE_MAX, 'عنوان سربرگ'), text: text(raw.text ?? '', SECTION_TEXT_MAX, 'متن سربرگ'),
        imageAssetId: assetId(raw.imageAssetId, 'عکس سربرگ'), buttonLabel: text(raw.buttonLabel ?? '', BUTTON_LABEL_MAX, 'نوشتهٔ دکمه'),
        buttonHref: link(raw.buttonHref ?? '', 'پیوند دکمه'),
      };
    case 'text':
      keys('doc');
      return { kind, background, doc: richDoc(raw.doc) };
    case 'textImage':
      keys('title', 'doc', 'imageAssetId', 'imageAlt', 'imageSide', 'buttonLabel', 'buttonHref');
      return {
        kind, background, title: text(raw.title ?? '', SECTION_TITLE_MAX, 'عنوان بخش'), doc: richDoc(raw.doc),
        imageAssetId: assetId(raw.imageAssetId, 'عکس بخش'), imageAlt: text(raw.imageAlt ?? '', IMAGE_ALT_MAX, 'متن جایگزین عکس'),
        imageSide: oneOf(raw.imageSide ?? 'right', ['right', 'left'] as const, 'جای عکس'),
        buttonLabel: text(raw.buttonLabel ?? '', BUTTON_LABEL_MAX, 'نوشتهٔ دکمه'), buttonHref: link(raw.buttonHref ?? '', 'پیوند دکمه'),
      };
    case 'iconCards':
      keys('title', 'cards');
      return {
        kind, background, title: text(raw.title ?? '', SECTION_TITLE_MAX, 'عنوان بخش'),
        cards: list(raw.cards ?? [], ICON_CARDS_MAX, 'کارت‌ها').map((card): IconCard => {
          if (!isRecord(card)) return refuse('یکی از کارت‌ها خوانا نیست.', 'STOREFRONT_PAGE_SECTION_INVALID');
          onlyKeys(card, ['icon', 'title', 'text'], 'کارت');
          return { icon: oneOf(card.icon, PAGE_ICONS, 'آیکون کارت'), title: text(card.title ?? '', CARD_TITLE_MAX, 'عنوان کارت'), text: text(card.text ?? '', CARD_TEXT_MAX, 'متن کارت') };
        }),
      };
    case 'gallery':
      keys('title', 'images');
      return {
        kind, background, title: text(raw.title ?? '', SECTION_TITLE_MAX, 'عنوان بخش'),
        images: list(raw.images ?? [], GALLERY_MAX, 'عکس‌های گالری').map((image): GalleryImage => {
          if (!isRecord(image)) return refuse('یکی از عکس‌های گالری خوانا نیست.', 'STOREFRONT_PAGE_SECTION_INVALID');
          onlyKeys(image, ['assetId', 'alt'], 'عکس گالری');
          const id = assetId(image.assetId, 'عکس گالری');
          if (id === null) return refuse('یکی از عکس‌های گالری انتخاب نشده است.', 'STOREFRONT_PAGE_IMAGE_INVALID');
          return { assetId: id, alt: text(image.alt ?? '', IMAGE_ALT_MAX, 'متن جایگزین عکس') };
        }),
      };
    case 'people':
      keys('title', 'people');
      return {
        kind, background, title: text(raw.title ?? '', SECTION_TITLE_MAX, 'عنوان بخش'),
        people: list(raw.people ?? [], PEOPLE_MAX, 'افراد').map((person): Person => {
          if (!isRecord(person)) return refuse('یکی از کارت‌های افراد خوانا نیست.', 'STOREFRONT_PAGE_SECTION_INVALID');
          onlyKeys(person, ['imageAssetId', 'name', 'role', 'contact'], 'کارت فرد');
          return {
            imageAssetId: assetId(person.imageAssetId, 'عکس فرد'), name: text(person.name ?? '', PERSON_NAME_MAX, 'نام'),
            role: text(person.role ?? '', PERSON_ROLE_MAX, 'سمت'), contact: text(person.contact ?? '', PERSON_CONTACT_MAX, 'راه تماس'),
          };
        }),
      };
    case 'map': {
      keys('title', 'imageAssetId', 'address', 'neshanUrl', 'baladUrl', 'googleUrl');
      const outside = (value: unknown, title: string): string => {
        const kept = link(value ?? '', title);
        return kept.startsWith('/') ? refuse(`«${title}» نشانی یک برنامهٔ نقشه است و با https:// آغاز می‌شود.`, 'STOREFRONT_PAGE_LINK_INVALID') : kept;
      };
      return {
        kind, background, title: text(raw.title ?? '', SECTION_TITLE_MAX, 'عنوان بخش'), imageAssetId: assetId(raw.imageAssetId, 'عکس نقشه'),
        address: text(raw.address ?? '', MAP_ADDRESS_MAX, 'نشانی'), neshanUrl: outside(raw.neshanUrl, 'پیوند نشان'),
        baladUrl: outside(raw.baladUrl, 'پیوند بلد'), googleUrl: outside(raw.googleUrl, 'پیوند گوگل'),
      };
    }
    case 'products': {
      keys('title', 'source', 'itemIds', 'collection');
      const itemIds = list(raw.itemIds ?? [], PRODUCT_ROW_MAX, 'محصولات ردیف').map((id): number => (isId(id) ? id : refuse('یکی از محصولات ردیف خوانا نیست.', 'STOREFRONT_PAGE_SECTION_INVALID')));
      if (new Set(itemIds).size !== itemIds.length) return refuse('یک محصول دو بار در ردیف آمده است.', 'STOREFRONT_PAGE_SECTION_INVALID');
      return {
        kind, background, title: text(raw.title ?? '', SECTION_TITLE_MAX, 'عنوان بخش'), source: oneOf(raw.source ?? 'items', ['items', 'collection'] as const, 'منبع ردیف'),
        itemIds, collection: text(raw.collection ?? '', COLLECTION_NAME_MAX, 'نام کالکشن'),
      };
    }
    case 'button':
      keys('label', 'href');
      return { kind, background, label: text(raw.label ?? '', BUTTON_LABEL_MAX, 'نوشتهٔ دکمه'), href: link(raw.href ?? '', 'پیوند دکمه') };
    case 'shippingMethods':
      keys('title');
      return { kind, background, title: text(raw.title ?? '', SECTION_TITLE_MAX, 'عنوان بخش') };
    default:
      return refuse('نوع بخش شناخته نیست.', 'STOREFRONT_PAGE_SECTION_INVALID');
  }
}

/** Why a section cannot go onto the site yet (it may still be saved as a draft); null when it is finished */
function unfinished(section: PageSection): string | null {
  const buttonHalf = (label: string, href: string) => Boolean(label) !== Boolean(href);
  switch (section.kind) {
    case 'hero':
      if (!section.title) return 'سربرگ عنوان می‌خواهد.';
      return buttonHalf(section.buttonLabel, section.buttonHref) ? 'دکمهٔ سربرگ هم نوشته می‌خواهد و هم پیوند.' : null;
    case 'text':
      return docIsEmpty(section.doc) ? 'بخش متن خالی است.' : null;
    case 'textImage':
      if (section.imageAssetId === null) return 'بخش «متن و تصویر» عکس ندارد.';
      if (!section.imageAlt) return 'عکس بخش «متن و تصویر» متن جایگزین می‌خواهد.';
      if (!section.title && docIsEmpty(section.doc)) return 'بخش «متن و تصویر» متن ندارد.';
      return buttonHalf(section.buttonLabel, section.buttonHref) ? 'دکمهٔ بخش هم نوشته می‌خواهد و هم پیوند.' : null;
    case 'iconCards':
      if (section.cards.length < ICON_CARDS_MIN) return `بخش کارت‌ها دست‌کم ${fa(ICON_CARDS_MIN)} کارت می‌خواهد.`;
      return section.cards.some(card => !card.title) ? 'هر کارت عنوان می‌خواهد.' : null;
    case 'gallery':
      if (section.images.length < GALLERY_MIN) return `گالری دست‌کم ${fa(GALLERY_MIN)} عکس می‌خواهد.`;
      return section.images.some(image => !image.alt) ? 'هر عکس گالری متن جایگزین می‌خواهد.' : null;
    case 'people':
      if (section.people.length === 0) return 'بخش افراد دست‌کم یک نفر می‌خواهد.';
      return section.people.some(person => !person.name) ? 'هر کارت فرد نام می‌خواهد.' : null;
    case 'map':
      if (section.imageAssetId === null) return 'بخش نقشه عکس نقشه می‌خواهد.';
      return !section.neshanUrl && !section.baladUrl && !section.googleUrl ? 'بخش نقشه دست‌کم یک پیوند مسیریابی می‌خواهد.' : null;
    case 'products':
      if (section.source === 'items') return section.itemIds.length === 0 ? 'ردیف محصولات هنوز محصولی ندارد.' : null;
      return section.collection ? null : 'ردیف محصولات هنوز کالکشنی ندارد.';
    case 'button':
      return !section.label || !section.href ? 'دکمه هم نوشته می‌خواهد و هم پیوند.' : null;
    default:
      return null;
  }
}

export function sectionAssetIds(section: PageSection): number[] {
  switch (section.kind) {
    case 'hero': case 'map': return section.imageAssetId === null ? [] : [section.imageAssetId];
    case 'text': return docAssetIds(section.doc);
    case 'textImage': return [...(section.imageAssetId === null ? [] : [section.imageAssetId]), ...docAssetIds(section.doc)];
    case 'gallery': return section.images.map(image => image.assetId);
    case 'people': return section.people.flatMap(person => (person.imageAssetId === null ? [] : [person.imageAssetId]));
    default: return [];
  }
}

/** Every image of the media library a page names (its sections and its sharing image), each once */
export const pageAssetIds = (page: Pick<PageValues, 'sections' | 'shareImageAssetId'>): number[] => [
  ...new Set([...(page.shareImageAssetId === null ? [] : [page.shareImageAssetId]), ...page.sections.flatMap(sectionAssetIds)]),
];

/** Every item a page's product rows name, each once */
export const pageItemIds = (page: Pick<PageValues, 'sections'>): number[] => [
  ...new Set(page.sections.flatMap(section => (section.kind === 'products' && section.source === 'items' ? section.itemIds : []))),
];

const FIXED_PAGE_TEXT_ONLY = 'صفحهٔ ثابت فقط یک «متن» بالای صفحه می‌گیرد.';
/** the letters of a text, without its formatting */
const docChars = (node: { text?: string; content?: unknown[] }): number => (
  (typeof node.text === 'string' ? node.text.length : 0) + (Array.isArray(node.content) ? node.content : []).reduce<number>((sum, child) => sum + docChars(child as { text?: string; content?: unknown[] }), 0)
);

export type CheckedPage = { page: PageValues; problem: null } | { page: null; problem: PageProblem };

/**
 * A page as it is kept, from whatever a request carried: every text trimmed, every section rebuilt from its known fields
 * alone. `forPublish` also refuses a page that is safe but unfinished. `baseSlug`: the page is one of the five (its slug
 * is fixed, and only «ارسال و پرداخت» takes the shipping section). `fixedSlug` (10c): the row holds the words of a page
 * whose work is in the site's code: its slug is fixed too, it takes at most one section, a text, and neither «در موتور
 * جست‌وجو نیاید» nor a share image (the site's own code decides both for such a page).
 */
export function checkedPage(raw: unknown, options: {
  forPublish: boolean; baseSlug: BasePageSlug | null; fixedSlug?: string | null;
  /** v12 phase 10d: another content made of «بخش» checked by the same rules (a news item): what it is called and the kinds it takes */
  noun?: string; kinds?: readonly SectionKind[];
}): CheckedPage {
  let section = -1;
  const noun = options.noun ?? 'صفحه';
  try {
    if (!isRecord(raw)) return refuse(`${noun} خوانا نیست.`, 'STOREFRONT_PAGE_INVALID', 'page');
    const title = (() => { try { return text(raw.title ?? '', PAGE_TITLE_MAX, `عنوان ${noun}`); } catch (e) { return refuse((e as Error).message, 'STOREFRONT_PAGE_TITLE_INVALID', 'title'); } })();
    if (!title) return refuse(`${noun} عنوان می‌خواهد.`, 'STOREFRONT_PAGE_TITLE_INVALID', 'title');
    const slug = typeof raw.slug === 'string' ? raw.slug.trim() : '';
    const fixedSlug = options.fixedSlug ?? null;
    if (fixedSlug !== null && slug !== fixedSlug) return refuse('نشانی این صفحهٔ ثابت عوض نمی‌شود.', 'STOREFRONT_PAGE_SLUG_INVALID', 'slug');
    if (fixedSlug !== null ? false : options.baseSlug !== null ? slug !== options.baseSlug : (!slug || slug.length > PAGE_SLUG_MAX || !STOREFRONT_SLUG_PATTERN.test(slug))) {
      return refuse(
        options.baseSlug !== null ? 'نشانی این صفحهٔ پایه عوض نمی‌شود.' : `نشانی لاتین ${noun} حداکثر ${fa(PAGE_SLUG_MAX)} نویسه است و فقط حرف کوچک انگلیسی، رقم و خط تیره میان کلمه‌ها دارد، مانند our-story.`,
        'STOREFRONT_PAGE_SLUG_INVALID', 'slug',
      );
    }
    if (options.baseSlug === null && fixedSlug === null && isReservedPageSlug(slug)) return refuse(RESERVED_PAGE_SLUG_MESSAGE, 'STOREFRONT_PAGE_SLUG_INVALID', 'slug');
    const field = (name: 'seoTitle' | 'seoDescription', max: number, label: string) => {
      try { return text(raw[name] ?? '', max, label); } catch (e) { return refuse((e as Error).message, 'STOREFRONT_PAGE_FIELD_INVALID', name); }
    };
    const seoTitle = field('seoTitle', PAGE_SEO_TITLE_MAX, 'عنوان جست‌وجو');
    const seoDescription = field('seoDescription', PAGE_SEO_DESCRIPTION_MAX, 'توضیح جست‌وجو');
    if (raw.noindex !== undefined && typeof raw.noindex !== 'boolean') return refuse('«در موتور جست‌وجو نیاید» روشن یا خاموش است.', 'STOREFRONT_PAGE_FIELD_INVALID', 'noindex');
    const shareImageAssetId = (() => { try { return assetId(raw.shareImageAssetId, 'تصویر اشتراک‌گذاری'); } catch (e) { return refuse((e as Error).message, 'STOREFRONT_PAGE_IMAGE_INVALID', 'shareImageAssetId'); } })();
    if (fixedSlug !== null && raw.noindex === true) return refuse('دیده شدن صفحهٔ ثابت در موتور جست‌وجو را خود سایت تعیین می‌کند.', 'STOREFRONT_PAGE_FIELD_INVALID', 'noindex');
    if (fixedSlug !== null && shareImageAssetId !== null) return refuse('صفحهٔ ثابت تصویر اشتراک‌گذاری نمی‌گیرد.', 'STOREFRONT_PAGE_IMAGE_INVALID', 'shareImageAssetId');
    const rawSections = list(raw.sections ?? [], PAGE_SECTIONS_MAX, `بخش‌های ${noun}`);
    if (fixedSlug !== null && rawSections.length > 1) return refuse(FIXED_PAGE_TEXT_ONLY, 'STOREFRONT_PAGE_SECTION_INVALID');
    const sections: PageSection[] = [];
    for (const [index, rawSection] of rawSections.entries()) {
      section = index;
      const kept = sectionOf(rawSection);
      if (fixedSlug !== null && kept.kind !== 'text') return refuse(FIXED_PAGE_TEXT_ONLY, 'STOREFRONT_PAGE_SECTION_INVALID');
      if (options.kinds && !options.kinds.includes(kept.kind)) return refuse(`بخش «${SECTION_KIND_TITLES[kept.kind]}» در ${noun} نمی‌آید.`, 'STOREFRONT_PAGE_SECTION_INVALID');
      if (fixedSlug !== null && kept.kind === 'text' && docChars(kept.doc) > FIXED_PAGE_TEXT_MAX) {
        return refuse(`متن بالای صفحهٔ ثابت حداکثر ${fa(FIXED_PAGE_TEXT_MAX)} نویسه است.`, 'STOREFRONT_PAGE_SECTION_INVALID');
      }
      if (kept.kind === 'shippingMethods' && options.baseSlug !== SHIPPING_SECTION_PAGE) {
        return refuse('بخش «روش‌ها و هزینهٔ ارسال» فقط در صفحهٔ «ارسال و پرداخت» می‌آید.', 'STOREFRONT_PAGE_SECTION_INVALID');
      }
      if (options.forPublish) {
        const why = unfinished(kept);
        if (why) return refuse(`بخش ${fa(index + 1)}: ${why}`, 'STOREFRONT_PAGE_UNFINISHED');
      }
      sections.push(kept);
    }
    section = -1;
    if (sections.filter(s => s.kind === 'shippingMethods').length > 1) return refuse('بخش «روش‌ها و هزینهٔ ارسال» یک بار می‌آید.', 'STOREFRONT_PAGE_SECTION_INVALID');
    // a fixed page may go on the site with its title and search words alone
    if (options.forPublish && sections.length === 0 && fixedSlug === null) return refuse(`${noun} هنوز بخشی ندارد.`, 'STOREFRONT_PAGE_UNFINISHED');
    return { page: { title, slug, seoTitle, seoDescription, noindex: raw.noindex === true, shareImageAssetId, sections }, problem: null };
  } catch (error) {
    if (error instanceof Refused) return { page: null, problem: { field: error.field, section, message: error.message, code: error.code } };
    throw error;
  }
}
