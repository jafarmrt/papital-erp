import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { mediaAssets, storefrontContentAssets, storefrontPages, type PublishedPage } from '../../db/schema.js';
import { NotFoundError } from '../../errors/customErrors.js';
import { mediaFilePath } from '../../lib/media/mediaPaths.js';
import { serverTimestampToUtcIso } from '../../lib/serverTimestamp.js';
import {
  PAGES_MAX, PRODUCT_ROW_MAX, isPageKind, pageAssetIds, pageLink, safeRichDoc, type PageSection, type RichDoc, type RichNode,
} from '../../lib/storefront/storefrontPageRules.js';
import type {
  StorefrontPageImage, StorefrontPageSection, StorefrontPageSummary, StorefrontPublicPage,
} from '../../lib/storefront/storefrontPagePublicContracts.js';
import { campaignCards } from './storefrontCatalog.service.js';

/**
 * v12 phase 10c (start plan §7.2, `AGENTS.md` §1.9): the pages of «صفحه‌های سایت» as the site reads them. Only the
 * published copy of a live page goes out, never its draft; an image is named by its file key and only while the library
 * still has it with a light version; a row of products is the cards of the items on the site now. A text is checked
 * again on its way out (`safeRichDoc`), so a row changed by hand in the database still cannot send an unknown node.
 */
export type PageRecord = typeof storefrontPages.$inferSelect;
type Images = ReadonlyMap<number, Omit<StorefrontPageImage, 'alt'>>;

const onSite = () => and(eq(storefrontPages.isDeleted, 0), isNotNull(storefrontPages.published), isNotNull(storefrontPages.publishedAt));
const notFound = () => new NotFoundError('صفحه پیدا نشد.', undefined, 'STOREFRONT_PAGE_NOT_FOUND');

/** A stored time as `2026-11-21T18:13:41.727Z` ('' when it cannot be read) */
export function isoOf(stored: string): string {
  const at = new Date(serverTimestampToUtcIso(stored) ?? '');
  return Number.isNaN(at.getTime()) ? '' : at.toISOString();
}

const summaryOf = (row: PageRecord): StorefrontPageSummary => ({
  slug: row.slug, kind: isPageKind(row.kind) ? row.kind : 'custom', title: row.published?.title ?? row.title,
  // a real ISO time with its zone (the column is read as UTC text without one): the site works out a day from it
  noindex: row.published?.noindex === true, updatedAt: isoOf(row.publishedAt ?? row.updatedAt),
});

/** `GET /api/storefront/v1/pages`: the pages on the site now, in the order of their addresses */
export async function publicPages(): Promise<StorefrontPageSummary[]> {
  const rows = await orm.select().from(storefrontPages).where(onSite()).orderBy(asc(storefrontPages.slug)).limit(PAGES_MAX);
  return rows.map(summaryOf);
}

async function imagesOf(ids: readonly number[]): Promise<Images> {
  const out = new Map<number, Omit<StorefrontPageImage, 'alt'>>();
  if (ids.length === 0) return out;
  const assets = await orm.select({
    id: mediaAssets.id, sha256: mediaAssets.sha256, width: mediaAssets.width, height: mediaAssets.height, thumbBytes: mediaAssets.thumbBytes,
  }).from(mediaAssets)
    .where(and(inArray(mediaAssets.id, [...new Set(ids)]), eq(mediaAssets.isDeleted, 0), eq(mediaAssets.kind, 'image'), isNotNull(mediaAssets.lightBytes)));
  for (const a of assets) out.set(a.id, { sha256: a.sha256, width: a.width, height: a.height, thumb: a.thumbBytes !== null });
  return out;
}

const imageOf = (images: Images, assetId: number | null, alt: string): StorefrontPageImage | null => {
  const image = assetId !== null ? images.get(assetId) : undefined;
  return image ? { ...image, alt } : null;
};

/** A text as the site gets it: checked again, and each image node named by its file (a node whose image has left is left out) */
function publicDoc(doc: RichDoc, images: Images): RichDoc {
  const safe = safeRichDoc(doc).doc;
  if (!safe) return { type: 'doc', content: [] };
  const nodes = (list: readonly RichNode[]): RichNode[] => list.flatMap((node): RichNode[] => {
    if (node.type === 'libraryImage') {
      const image = imageOf(images, typeof node.attrs?.assetId === 'number' ? node.attrs.assetId : null, String(node.attrs?.alt ?? ''));
      return image ? [{ type: 'libraryImage', attrs: { sha256: image.sha256, width: image.width, height: image.height, alt: image.alt, thumb: image.thumb ? 1 : 0 } }] : [];
    }
    return [node.content ? { ...node, content: nodes(node.content) } : node];
  });
  return { type: 'doc', content: nodes(safe.content) };
}

/** A link as it goes out: checked again like a text, so a row changed by hand cannot send another kind of address */
const linkOf = (value: unknown): string => pageLink(value) ?? '';

async function publicSection(section: PageSection, images: Images): Promise<StorefrontPageSection> {
  const { background } = section;
  switch (section.kind) {
    case 'hero':
      return {
        kind: 'hero', background, title: section.title, text: section.text, image: imageOf(images, section.imageAssetId, ''),
        buttonLabel: section.buttonLabel, buttonHref: linkOf(section.buttonHref),
      };
    case 'text':
      return { kind: 'text', background, doc: publicDoc(section.doc, images) };
    case 'textImage':
      return {
        kind: 'textImage', background, title: section.title, doc: publicDoc(section.doc, images),
        image: imageOf(images, section.imageAssetId, section.imageAlt), imageSide: section.imageSide, buttonLabel: section.buttonLabel, buttonHref: linkOf(section.buttonHref),
      };
    case 'iconCards':
      return { kind: 'iconCards', background, title: section.title, cards: section.cards.map(card => ({ icon: card.icon, title: card.title, text: card.text })) };
    case 'gallery':
      return { kind: 'gallery', background, title: section.title, images: section.images.flatMap(image => imageOf(images, image.assetId, image.alt) ?? []) };
    case 'people':
      return {
        kind: 'people', background, title: section.title,
        // the name is written beside the photo, so the photo itself says nothing more to a screen reader
        people: section.people.map(person => ({ image: imageOf(images, person.imageAssetId, ''), name: person.name, role: person.role, contact: person.contact })),
      };
    case 'map':
      return {
        kind: 'map', background, title: section.title, image: imageOf(images, section.imageAssetId, section.title || 'نقشهٔ نشانی'), address: section.address,
        neshanUrl: linkOf(section.neshanUrl), baladUrl: linkOf(section.baladUrl), googleUrl: linkOf(section.googleUrl),
      };
    case 'products':
      return {
        kind: 'products', background, title: section.title, collection: section.source === 'collection' ? section.collection : '',
        products: await campaignCards(section.source === 'collection' ? { collection: section.collection } : { itemIds: section.itemIds }, PRODUCT_ROW_MAX),
      };
    case 'button':
      return { kind: 'button', background, label: section.label, href: linkOf(section.href) };
    case 'shippingMethods':
      return { kind: 'shippingMethods', background, title: section.title };
  }
}

/**
 * One copy of a page as the site gets it: the copy on the site, or (10c, `storefrontPagePreview.service.ts`) the draft
 * for a preview link. The same building either way, so a preview shows what publishing would put on the site.
 */
export async function pageForSite(row: PageRecord, copy: PublishedPage, summary: StorefrontPageSummary): Promise<StorefrontPublicPage> {
  const sections = Array.isArray(copy.sections) ? copy.sections : [];
  const images = await imagesOf(pageAssetIds({ shareImageAssetId: copy.shareImageAssetId, sections }));
  const out: StorefrontPageSection[] = [];
  // one after another: a row of products reads the catalog, which is kept a few seconds
  for (const section of sections) out.push(await publicSection(section, images));
  return { ...summary, seoTitle: copy.seoTitle, seoDescription: copy.seoDescription, shareImage: imageOf(images, copy.shareImageAssetId, copy.title), sections: out };
}

/** `GET /api/storefront/v1/pages/:slug`: the copy on the site of one page, or the same 404 for any other address */
export async function publicPage(slug: string): Promise<StorefrontPublicPage> {
  const [row] = await orm.select().from(storefrontPages).where(and(onSite(), eq(storefrontPages.slug, slug))).limit(1);
  if (!row?.published) throw notFound();
  return pageForSite(row, row.published, summaryOf(row));
}

/** The light (or small) WEBP of a live image of the library by its file name, for a caller that has decided the image may be read */
export const MEDIA_FILE_NAME = /^([0-9a-f]{64})(-thumb)?\.webp$/;


/**
 * The light (or small) WEBP of an image that a page on the site now names (`storefront_content_assets`, written by
 * «انتشار»); any other file, an image of a draft among them, is the same 404
 */
export async function contentImageFile(file: string): Promise<string> {
  const match = MEDIA_FILE_NAME.exec(file);
  if (!match) throw new NotFoundError('پیدا نشد');
  const [sha256, thumb] = [match[1], Boolean(match[2])];
  const rows = await orm.select({ lightBytes: mediaAssets.lightBytes, thumbBytes: mediaAssets.thumbBytes }).from(mediaAssets)
    .innerJoin(storefrontContentAssets, eq(storefrontContentAssets.assetId, mediaAssets.id))
    .innerJoin(storefrontPages, eq(storefrontPages.id, storefrontContentAssets.contentId))
    .where(and(
      eq(mediaAssets.sha256, sha256), eq(mediaAssets.isDeleted, 0), eq(mediaAssets.kind, 'image'), isNotNull(mediaAssets.lightBytes),
      eq(storefrontContentAssets.contentKind, 'page'), eq(storefrontContentAssets.isDeleted, 0), onSite(),
    ));
  if (!rows.some(r => (thumb ? r.thumbBytes : r.lightBytes) !== null)) throw new NotFoundError('پیدا نشد');
  return mediaFilePath(sha256, thumb ? 'thumb' : 'light', 'webp');
}
