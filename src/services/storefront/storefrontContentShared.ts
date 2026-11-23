import type { Request } from 'express';
import { and, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { items, mediaAssets, storefrontContentAssets } from '../../db/schema.js';
import { ForbiddenError, ValidationError } from '../../errors/customErrors.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { can } from '../../middleware/authorize.js';
import { SECTION_KIND_TITLES, sectionAssetIds, type PageSection, type RichDoc, type RichNode } from '../../lib/storefront/storefrontPageRules.js';
import type { PageAssetInfo } from '../../lib/storefront/storefrontPageContracts.js';

/**
 * v12 phase 10d: what every content of the site made of «بخش» shares on the ERP side, moved out of
 * `storefrontPages.service.ts` unchanged so «خبرهای سایت» uses the same code as «صفحه‌های سایت»: the images and
 * products a content names exist (and naming a new image needs «مشاهده کتابخانه تصاویر»), the short form of a section
 * for the audit row, and the rows that say which images a published content names (`storefront_content_assets`).
 * `noun` is what the content is called in a message («صفحه», «خبر»).
 */
const invalid = (message: string, field: string, code: string, extra: Record<string, unknown> = {}) => new ValidationError(message, { field, ...extra }, code);

export const canonical = (value: unknown): string => JSON.stringify(value, (_key, inner: unknown) => (
  inner && typeof inner === 'object' && !Array.isArray(inner)
    ? Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
    : inner
));

export async function assetInfos(executor: DbExecutor, ids: readonly number[]): Promise<PageAssetInfo[]> {
  if (ids.length === 0) return [];
  const rows = await executor.select({
    id: mediaAssets.id, title: mediaAssets.title, originalName: mediaAssets.originalName, kind: mediaAssets.kind, isDeleted: mediaAssets.isDeleted,
    lightBytes: mediaAssets.lightBytes,
  }).from(mediaAssets).where(inArray(mediaAssets.id, [...ids]));
  const byId = new Map(rows.map(r => [r.id, r]));
  return ids.map((assetId) => {
    const asset = byId.get(assetId);
    return { assetId, title: asset ? (asset.title || asset.originalName) : '', usable: Boolean(asset && asset.isDeleted === 0 && asset.kind === 'image' && asset.lightBytes !== null) };
  });
}

/**
 * The images and products a page names exist. An image must be a live image of the library with a light version;
 * `mayKeep` names the images the page already had, which a draft may go on naming after they left the library (so the
 * colleague can open the page and replace them), though a published page may not.
 */
export async function checkContentReferences(tx: DbExecutor, names: { assetIds: readonly number[]; itemIds: readonly number[] }, mayKeep: readonly number[], noun: string): Promise<void> {
  const assets = await assetInfos(tx, names.assetIds);
  const bad = assets.find(asset => !asset.usable && !mayKeep.includes(asset.assetId));
  if (bad) {
    throw invalid(`یکی از عکس‌های ${noun} در کتابخانهٔ تصاویر نیست یا نسخهٔ سبک ندارد؛ آن را عوض کنید.`, 'sections', 'STOREFRONT_PAGE_IMAGE_UNKNOWN', { assetId: bad.assetId });
  }
  const itemIds = [...names.itemIds];
  if (itemIds.length) {
    const found = new Set((await tx.select({ id: items.id }).from(items)
      .where(and(inArray(items.id, itemIds), eq(items.isDeleted, 0), eq(items.type, 'product')))).map(r => r.id));
    if (itemIds.some(id => !found.has(id))) throw invalid('یکی از محصولات «ردیف محصولات» در ERP نیست.', 'sections', 'STOREFRONT_PAGE_PRODUCT_UNKNOWN');
  }
}

/**
 * An image a page did not name before is a file of the media library going towards the site, so whoever adds it must be
 * allowed to see the library (the rule of a campaign page's hero); keeping the images a page already has needs nothing more
 */
export async function refuseNewContentImages(req: Request, assetIds: readonly number[], before: readonly number[], noun: string): Promise<void> {
  if (assetIds.every(id => before.includes(id))) return;
  if (!(await can(req.user as { role?: string } | undefined, 'media.view'))) {
    throw new ForbiddenError(`برای افزودن عکس به ${noun}، دسترسی «مشاهده کتابخانه تصاویر» لازم است.`, { field: 'sections' }, 'STOREFRONT_PAGE_IMAGE_FORBIDDEN');
  }
}

const AUDIT_TEXT_MAX = 200;

/** The words and the link addresses of a text, for the audit row */
function auditDoc(doc: RichDoc): { text: string; links: string[] } {
  const words: string[] = [];
  const links: string[] = [];
  const walk = (node: RichNode | RichDoc) => {
    const leaf = node as RichNode;
    if (typeof leaf.text === 'string') words.push(leaf.text);
    for (const mark of leaf.marks ?? []) if (mark.type === 'link' && mark.attrs?.href) links.push(mark.attrs.href);
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return { text: words.join(' ').slice(0, AUDIT_TEXT_MAX), links: [...new Set(links)] };
}

/**
 * A section as the audit row keeps it: its kind, its titles and the start of its words, every address it links to, the
 * images and products it names. Enough to see afterwards what a change put on the public site (a link moved to another
 * address, a text rewritten, an image swapped), without copying whole pages into the log (10b review).
 */
function auditSection(section: PageSection): Record<string, unknown> {
  const base = { kind: SECTION_KIND_TITLES[section.kind], background: section.background };
  const images = sectionAssetIds(section);
  const withImages = images.length ? { images } : {};
  switch (section.kind) {
    case 'hero': return { ...base, title: section.title, text: section.text.slice(0, AUDIT_TEXT_MAX), ...(section.buttonHref ? { button: section.buttonLabel, links: [section.buttonHref] } : {}), ...withImages };
    case 'text': return { ...base, ...auditDoc(section.doc), ...withImages };
    case 'textImage': {
      const doc = auditDoc(section.doc);
      return { ...base, title: section.title, text: doc.text, links: [...doc.links, ...(section.buttonHref ? [section.buttonHref] : [])], ...withImages };
    }
    case 'iconCards': return { ...base, title: section.title, cards: section.cards.map(card => `${card.title}: ${card.text}`.slice(0, AUDIT_TEXT_MAX)) };
    case 'gallery': return { ...base, title: section.title, ...withImages };
    case 'people': return { ...base, title: section.title, people: section.people.map(person => [person.name, person.role, person.contact].filter(Boolean).join('، ')), ...withImages };
    case 'map': return { ...base, title: section.title, address: section.address, links: [section.neshanUrl, section.baladUrl, section.googleUrl].filter(Boolean), ...withImages };
    case 'products': return { ...base, title: section.title, ...(section.source === 'items' ? { items: section.itemIds } : { collection: section.collection }) };
    case 'button': return { ...base, label: section.label, links: [section.href].filter(Boolean) };
    default: return { ...base, title: section.title };
  }
}
export const auditSections = (sections: readonly PageSection[]): Array<Record<string, unknown>> => sections.map(auditSection);

/** The images a published content names: the rows are switched on and off, never removed */
export async function writeContentAssetRows(tx: DbExecutor, contentKind: 'page' | 'news', contentId: number, assetIds: readonly number[]): Promise<void> {
  const saved = await tx.select().from(storefrontContentAssets)
    .where(and(eq(storefrontContentAssets.contentKind, contentKind), eq(storefrontContentAssets.contentId, contentId))).for('update');
  const at = systemNowUtcIso();
  const off = saved.filter(row => row.isDeleted === 0 && !assetIds.includes(row.assetId)).map(row => row.id);
  if (off.length) await tx.update(storefrontContentAssets).set({ isDeleted: 1, updatedAt: at }).where(inArray(storefrontContentAssets.id, off));
  const on = saved.filter(row => row.isDeleted === 1 && assetIds.includes(row.assetId)).map(row => row.id);
  if (on.length) await tx.update(storefrontContentAssets).set({ isDeleted: 0, updatedAt: at }).where(inArray(storefrontContentAssets.id, on));
  const known = new Set(saved.map(row => row.assetId));
  const fresh = assetIds.filter(assetId => !known.has(assetId));
  if (fresh.length) await tx.insert(storefrontContentAssets).values(fresh.map(assetId => ({ contentKind: contentKind, contentId, assetId })));
}

