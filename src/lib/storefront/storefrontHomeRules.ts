import {
  COLLECTION_INTROS_MAX, HOME_KICKER_MAX, HOME_KINDS_ONCE, HOME_SECTION_KIND_TITLES, SLIDES_MAX, SLIDE_TEXT_MAX, SLIDE_TITLE_MAX, WHY_POINTS_MAX, WHY_POINTS_MIN, WHY_POINT_TEXT_MAX,
  type HomeSection, type HomeSectionKind, type Slide, type WhyPoint,
} from './storefrontHomeParts.js';
import {
  BUTTON_LABEL_MAX, COLLECTION_NAME_MAX, IMAGE_ALT_MAX, PAGE_ICONS, SECTION_TEXT_MAX, SECTION_TITLE_MAX, assetId, fa, isCalendarDay, isRecord, link, list, oneOf, onlyKeys,
  refuse, text, type PageSection, type SectionBackground,
} from './storefrontPageParts.js';
import { checkedSiteLink, siteLinkWords, type SiteLink } from './storefrontSiteLinks.js';

/**
 * v12 phase 10e: the parts of the home page as they are checked before every write (`storefrontHomeParts.ts` has their
 * shapes). What makes a part unsafe is refused on every save; what only makes it unfinished is refused when the page is
 * published, and not at all while the part is switched off.
 */
const siteLink = (value: unknown, title: string): SiteLink | null => {
  const checked = checkedSiteLink(value, title);
  return checked.problem === null ? checked.link : refuse(checked.problem, 'STOREFRONT_PAGE_LINK_INVALID');
};
const day = (value: unknown, title: string): string => {
  if (value === undefined || value === null || value === '') return '';
  return typeof value === 'string' && isCalendarDay(value) ? value : refuse(`«${title}» یک روز تقویم است.`, 'STOREFRONT_PAGE_FIELD_INVALID');
};

function slideOf(raw: unknown): Slide {
  if (!isRecord(raw)) return refuse('یکی از اسلایدها خوانا نیست.', 'STOREFRONT_PAGE_SECTION_INVALID');
  onlyKeys(raw, ['imageAssetId', 'mobileImageAssetId', 'imageAlt', 'title', 'text', 'buttonLabel', 'link', 'startsOn', 'endsOn'], 'اسلاید');
  const [startsOn, endsOn] = [day(raw.startsOn, 'روز آغاز اسلاید'), day(raw.endsOn, 'روز پایان اسلاید')];
  if (startsOn && endsOn && endsOn < startsOn) return refuse('روز پایان اسلاید پیش از روز آغاز آن است.', 'STOREFRONT_PAGE_FIELD_INVALID');
  return {
    imageAssetId: assetId(raw.imageAssetId, 'عکس اسلاید'), mobileImageAssetId: assetId(raw.mobileImageAssetId, 'عکس اسلاید برای گوشی'),
    imageAlt: text(raw.imageAlt ?? '', IMAGE_ALT_MAX, 'متن جایگزین عکس اسلاید'), title: text(raw.title ?? '', SLIDE_TITLE_MAX, 'تیتر اسلاید'),
    text: text(raw.text ?? '', SLIDE_TEXT_MAX, 'متن اسلاید'), buttonLabel: text(raw.buttonLabel ?? '', BUTTON_LABEL_MAX, 'نوشتهٔ دکمهٔ اسلاید'),
    link: siteLink(raw.link, 'پیوند اسلاید'), startsOn, endsOn,
  };
}

/** A part of the home page from whatever a request carried, rebuilt from its known fields alone */
export function homeSectionOf(raw: Record<string, unknown>, kind: HomeSectionKind, background: SectionBackground, keys: (...own: string[]) => void): HomeSection {
  const title = () => text(raw.title ?? '', SECTION_TITLE_MAX, 'عنوان بخش');
  const button = () => ({ buttonLabel: text(raw.buttonLabel ?? '', BUTTON_LABEL_MAX, 'نوشتهٔ دکمه'), buttonHref: link(raw.buttonHref ?? '', 'پیوند دکمه') });
  switch (kind) {
    case 'slider':
      keys('slides');
      return { kind, background, slides: list(raw.slides ?? [], SLIDES_MAX, 'اسلایدها').map(slideOf) };
    case 'banner':
      keys('imageAssetId', 'mobileImageAssetId', 'imageAlt', 'link');
      return {
        kind, background, imageAssetId: assetId(raw.imageAssetId, 'عکس بنر'), mobileImageAssetId: assetId(raw.mobileImageAssetId, 'عکس بنر برای گوشی'),
        imageAlt: text(raw.imageAlt ?? '', IMAGE_ALT_MAX, 'متن جایگزین عکس بنر'), link: siteLink(raw.link, 'پیوند بنر'),
      };
    case 'collectionIntro':
      keys('title', 'collection');
      return { kind, background, title: title(), collection: text(raw.collection ?? '', COLLECTION_NAME_MAX, 'نام کالکشن') };
    case 'latestNews':
      keys('title');
      return { kind, background, title: title() };
    case 'homeIntro':
      keys('kicker', 'title', 'text', 'buttonLabel', 'buttonHref');
      return { kind, background, kicker: text(raw.kicker ?? '', HOME_KICKER_MAX, 'خط بالای تیتر'), title: title(), text: text(raw.text ?? '', SECTION_TEXT_MAX, 'متن سربرگ'), ...button() };
    case 'homeCategories':
      keys('title');
      return { kind, background, title: title() };
    case 'homeWhy':
      keys('points');
      return {
        kind, background,
        points: list(raw.points ?? [], WHY_POINTS_MAX, 'نکته‌ها').map((point): WhyPoint => {
          if (!isRecord(point)) return refuse('یکی از نکته‌ها خوانا نیست.', 'STOREFRONT_PAGE_SECTION_INVALID');
          onlyKeys(point, ['icon', 'text'], 'نکته');
          return { icon: oneOf(point.icon, PAGE_ICONS, 'آیکون نکته'), text: text(point.text ?? '', WHY_POINT_TEXT_MAX, 'متن نکته') };
        }),
      };
    case 'homeFeatured': case 'homeNewest':
      keys('title', 'buttonLabel', 'buttonHref');
      return { kind, background, title: title(), ...button() };
    case 'homeCollections':
      keys('title', 'text');
      return { kind, background, title: title(), text: text(raw.text ?? '', SECTION_TEXT_MAX, 'متن بخش') };
    default:
      keys('title', 'text', 'buttonLabel', 'buttonHref', 'secondLabel', 'secondHref');
      return {
        kind: 'homeWholesale', background, title: title(), text: text(raw.text ?? '', SECTION_TEXT_MAX, 'متن بخش'), ...button(),
        secondLabel: text(raw.secondLabel ?? '', BUTTON_LABEL_MAX, 'نوشتهٔ دکمهٔ دوم'), secondHref: link(raw.secondHref ?? '', 'پیوند دکمهٔ دوم'),
      };
  }
}

/** Why a part of the home page cannot go onto the site yet; null when it is finished */
export function homeUnfinished(section: HomeSection): string | null {
  const half = (label: string, href: string) => Boolean(label) !== Boolean(href);
  const name = HOME_SECTION_KIND_TITLES[section.kind];
  switch (section.kind) {
    case 'slider': {
      if (section.slides.length === 0) return 'اسلایدر دست‌کم یک اسلاید می‌خواهد.';
      const at = section.slides.findIndex(slide => slide.imageAssetId === null || !slide.imageAlt || Boolean(slide.buttonLabel) !== Boolean(slide.link));
      if (at < 0) return null;
      const slide = section.slides[at];
      const why = slide.imageAssetId === null ? 'عکس ندارد' : !slide.imageAlt ? 'متن جایگزین عکس می‌خواهد' : 'دکمه‌اش هم نوشته می‌خواهد و هم پیوند';
      return `اسلاید ${fa(at + 1)} ${why}.`;
    }
    case 'banner':
      if (section.imageAssetId === null) return 'بنر عکس ندارد.';
      return section.imageAlt ? null : 'عکس بنر متن جایگزین می‌خواهد.';
    case 'collectionIntro':
      return section.collection ? null : 'بخش «معرفی کالکشن» هنوز کالکشنی ندارد.';
    case 'homeWhy':
      if (section.points.length < WHY_POINTS_MIN) return `بخش «${name}» دست‌کم ${fa(WHY_POINTS_MIN)} نکته می‌خواهد.`;
      // the delivery point may stay empty: the site writes it from the shop's own free-delivery threshold
      return section.points.some(point => !point.text && point.icon !== 'truck') ? 'هر نکته متن می‌خواهد (فقط نکتهٔ «ارسال» می‌تواند خالی بماند تا سایت خودش بنویسد).' : null;
    case 'homeIntro': case 'homeFeatured': case 'homeNewest':
      if (!section.title) return `بخش «${name}» عنوان می‌خواهد.`;
      return half(section.buttonLabel, section.buttonHref) ? `دکمهٔ بخش «${name}» هم نوشته می‌خواهد و هم پیوند.` : null;
    case 'homeWholesale':
      if (!section.title) return `بخش «${name}» عنوان می‌خواهد.`;
      return half(section.buttonLabel, section.buttonHref) || half(section.secondLabel, section.secondHref) ? `هر دکمهٔ بخش «${name}» هم نوشته می‌خواهد و هم پیوند.` : null;
    default:
      return section.title ? null : `بخش «${name}» عنوان می‌خواهد.`;
  }
}

/** The images of the media library a part of the home page names */
export function homeSectionAssetIds(section: HomeSection): number[] {
  const ids = (...list: Array<number | null>) => list.filter((id): id is number => id !== null);
  if (section.kind === 'slider') return section.slides.flatMap(slide => ids(slide.imageAssetId, slide.mobileImageAssetId));
  return section.kind === 'banner' ? ids(section.imageAssetId, section.mobileImageAssetId) : [];
}

/** Every link chosen as in the menus that the sections name (a slide's button, a banner), with the words that name it in a message */
export function homeSectionLinks(sections: readonly PageSection[]): Array<{ link: SiteLink; label: string }> {
  return sections.flatMap((section) => {
    if (section.kind === 'banner') return section.link ? [{ link: section.link, label: 'بنر' }] : [];
    if (section.kind !== 'slider') return [];
    return section.slides.flatMap((slide, index) => (slide.link ? [{ link: slide.link, label: `اسلاید ${fa(index + 1)}` }] : []));
  });
}

/** A part of the home page as the audit row keeps it */
export function auditHomeSection(section: HomeSection): Record<string, unknown> {
  const images = homeSectionAssetIds(section);
  const withImages = images.length ? { images } : {};
  switch (section.kind) {
    case 'slider':
      return {
        ...withImages,
        slides: section.slides.map(slide => [slide.title, slide.text, slide.buttonLabel, siteLinkWords(slide.link), slide.startsOn && `از ${slide.startsOn}`, slide.endsOn && `تا ${slide.endsOn}`].filter(Boolean).join(' | ').slice(0, 300)),
      };
    case 'banner': return { ...withImages, alt: section.imageAlt, link: siteLinkWords(section.link) };
    case 'collectionIntro': return { title: section.title, collection: section.collection };
    case 'homeWhy': return { points: section.points.map(point => point.text) };
    case 'homeIntro': return { kicker: section.kicker, title: section.title, text: section.text, button: section.buttonLabel, links: [section.buttonHref].filter(Boolean) };
    case 'homeFeatured': case 'homeNewest': return { title: section.title, button: section.buttonLabel, links: [section.buttonHref].filter(Boolean) };
    case 'homeCollections': return { title: section.title, text: section.text };
    case 'homeWholesale': return { title: section.title, text: section.text, buttons: [section.buttonLabel, section.secondLabel].filter(Boolean), links: [section.buttonHref, section.secondHref].filter(Boolean) };
    default: return { title: section.title };
  }
}

/**
 * The first rule of the whole home page that its parts break, as a message; null when none. A part the page takes once
 * comes once, and «معرفی کالکشن» a few times at most (each one reads the catalog when the site asks for the page).
 */
export function homePartsProblem(sections: readonly PageSection[]): string | null {
  const twice = HOME_KINDS_ONCE.find(kind => sections.filter(section => section.kind === kind).length > 1);
  if (twice) return `بخش «${HOME_SECTION_KIND_TITLES[twice]}» یک بار می‌آید.`;
  const intros = sections.filter(section => section.kind === 'collectionIntro').length;
  return intros > COLLECTION_INTROS_MAX ? `صفحهٔ اصلی حداکثر ${fa(COLLECTION_INTROS_MAX)} بخش «معرفی کالکشن» می‌گیرد.` : null;
}
