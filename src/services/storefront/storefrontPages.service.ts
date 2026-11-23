import type { Request } from 'express';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { items, mediaAssets, storefrontContentAssets, storefrontPages, type PublishedPage } from '../../db/schema.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { OptimisticLockError, nextVersion } from '../../lib/occHelper.js';
import { can } from '../../middleware/authorize.js';
import {
  BASE_PAGES, FIXED_PAGES, PAGES_MAX, PAGE_TEMPLATES, SECTION_KIND_TITLES, checkedPage, isPageKind, pageAssetIds, pageItemIds, sectionAssetIds, type BasePageSlug,
  type PageSection, type PageValues, type RichDoc, type RichNode,
} from '../../lib/storefront/storefrontPageRules.js';
import type { PageAssetInfo, PageCreateInput, PageDetail, PageListRow, PageSaveInput, PageStatus } from '../../lib/storefront/storefrontPageContracts.js';
import { menuPlacesOf } from './storefrontPageLinks.js';
import { clearRedirectFrom, redirectMovedPage } from './storefrontRedirects.service.js';

/**
 * v12 phase 10b (package 18, V12_SITE_NEXT_START_PLAN.md §7.2): «صفحه‌های سایت» on the ERP side. Reading needs
 * `site_content.view`, every change `site_content.manage`. The draft is what the builder saves; «انتشار» copies the
 * draft onto the site, «برگرداندن به نسخهٔ روی سایت» throws the draft's changes away, and taking a page off the site
 * empties its published copy. Each of these locks the page's row, refuses a stale version (409), and writes its audit
 * row in the same transaction. Every image a page names is a live image of the media library with a light version, and
 * naming a new one needs «مشاهده کتابخانه تصاویر» too, as a campaign page's hero does. A base page is never removed and
 * keeps its address; a custom page is removed softly. A page's address is one value, the one the site reads it by, so it
 * changes only while the page is off the site: a draft can never move a page that is on the site (10b review). Moving
 * a published page, with the redirect from its old address, is 10c's.
 */
type PageRecord = typeof storefrontPages.$inferSelect;

const AUDIT_ENTITY = 'صفحهٔ سایت';
const CONTENT_KIND = 'page';
const actorOf = (req: Request) => String((req.user as { username?: string } | undefined)?.username ?? '');
const invalid = (message: string, field: string, code: string, extra: Record<string, unknown> = {}) => new ValidationError(message, { field, ...extra }, code);
const baseSlugOf = (row: Pick<PageRecord, 'kind' | 'slug'>): BasePageSlug | null => (
  row.kind === 'base' ? (BASE_PAGES.find(page => page.slug === row.slug)?.slug ?? null) : null
);
/** v12 phase 10c: the row holds the words of a page whose work is in the site's code; its slug never changes */
const fixedSlugOf = (row: Pick<PageRecord, 'kind' | 'slug'>): string | null => (row.kind === 'fixed' ? row.slug : null);

const draftOf = (row: PageRecord): PageValues => ({
  title: row.title, slug: row.slug, seoTitle: row.seoTitle, seoDescription: row.seoDescription, noindex: row.noindex === 1,
  shareImageAssetId: row.shareImageAssetId, sections: Array.isArray(row.sections) ? row.sections : [],
});
const publishedCopyOf = ({ slug: _slug, ...page }: PageValues): PublishedPage => page;
/** A value as text with every object's keys in one order: PostgreSQL's jsonb keeps keys in its own order, not the one written */
const canonical = (value: unknown): string => JSON.stringify(value, (_key, inner: unknown) => (
  inner && typeof inner === 'object' && !Array.isArray(inner)
    ? Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
    : inner
));
const sameCopy = (a: PublishedPage, b: PublishedPage | null): boolean => b !== null && canonical(a) === canonical(b);

function statusOf(row: PageRecord): PageStatus {
  if (row.published === null) return 'draft';
  return sameCopy(publishedCopyOf(draftOf(row)), row.published) ? 'published' : 'changed';
}

const listRowOf = (row: PageRecord): PageListRow => ({
  id: row.id, kind: isPageKind(row.kind) ? row.kind : 'custom', slug: row.slug, title: row.title, status: statusOf(row),
  publishedAt: row.publishedAt ?? '', updatedAt: row.updatedAt, updatedBy: row.updatedBy, version: row.version,
});

async function assetInfos(executor: DbExecutor, ids: readonly number[]): Promise<PageAssetInfo[]> {
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

async function detailOf(executor: DbExecutor, row: PageRecord): Promise<PageDetail> {
  const draft = draftOf(row);
  return { ...listRowOf(row), draft, assets: await assetInfos(executor, pageAssetIds(draft)), menuPlaces: await menuPlacesOf(executor, row.id) };
}

/** `GET /api/storefront/pages`: every page, the five base ones first, then the fixed ones */
export async function listPages(executor: DbExecutor): Promise<PageListRow[]> {
  const rows = await executor.select().from(storefrontPages).where(eq(storefrontPages.isDeleted, 0)).orderBy(asc(storefrontPages.id));
  // the base pages, then the fixed ones (each in its own order), then the pages the shop made
  const order = (row: PageRecord) => (
    row.kind === 'base' ? BASE_PAGES.findIndex(page => page.slug === row.slug)
      : row.kind === 'fixed' ? BASE_PAGES.length + FIXED_PAGES.findIndex(page => page.slug === row.slug)
        : BASE_PAGES.length + FIXED_PAGES.length
  );
  return [...rows].sort((a, b) => (order(a) - order(b)) || (a.id - b.id)).map(listRowOf);
}

async function liveRow(executor: DbExecutor, id: number): Promise<PageRecord> {
  const [row] = await executor.select().from(storefrontPages).where(and(eq(storefrontPages.id, id), eq(storefrontPages.isDeleted, 0)));
  if (!row) throw new NotFoundError('این صفحه پیدا نشد.', undefined, 'STOREFRONT_PAGE_NOT_FOUND');
  return row;
}

/** `GET /api/storefront/pages/:id`: a page with its draft, as the builder opens it */
export async function pageDetail(executor: DbExecutor, id: number): Promise<PageDetail> {
  return detailOf(executor, await liveRow(executor, id));
}

/** The live page under its row lock and its version; `storefrontPageMove.service.ts` moves a page's address through it */
export const lockedPageRow = (tx: DbExecutor, id: number, expectedVersion: number): Promise<PageRecord> => lockedRow(tx, id, expectedVersion);

async function lockedRow(tx: DbExecutor, id: number, expectedVersion: number): Promise<PageRecord> {
  const [row] = await tx.select().from(storefrontPages).where(and(eq(storefrontPages.id, id), eq(storefrontPages.isDeleted, 0))).for('update');
  if (!row) throw new NotFoundError('این صفحه پیدا نشد.', undefined, 'STOREFRONT_PAGE_NOT_FOUND');
  if (row.version !== expectedVersion) {
    throw new OptimisticLockError({ entityType: 'StorefrontPage', entityId: String(id), expectedVersion, currentVersion: row.version });
  }
  return row;
}

/**
 * The images and products a page names exist. An image must be a live image of the library with a light version;
 * `mayKeep` names the images the page already had, which a draft may go on naming after they left the library (so the
 * colleague can open the page and replace them), though a published page may not.
 */
async function checkReferences(tx: DbExecutor, page: PageValues, mayKeep: readonly number[]): Promise<void> {
  const assets = await assetInfos(tx, pageAssetIds(page));
  const bad = assets.find(asset => !asset.usable && !mayKeep.includes(asset.assetId));
  if (bad) {
    throw invalid('یکی از عکس‌های صفحه در کتابخانهٔ تصاویر نیست یا نسخهٔ سبک ندارد؛ آن را عوض کنید.', 'sections', 'STOREFRONT_PAGE_IMAGE_UNKNOWN', { assetId: bad.assetId });
  }
  const itemIds = pageItemIds(page);
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
async function refuseNewImagesWithoutMedia(req: Request, page: PageValues, before: readonly number[]): Promise<void> {
  if (pageAssetIds(page).every(id => before.includes(id))) return;
  if (!(await can(req.user as { role?: string } | undefined, 'media.view'))) {
    throw new ForbiddenError('برای افزودن عکس به صفحه، دسترسی «مشاهده کتابخانه تصاویر» لازم است.', { field: 'sections' }, 'STOREFRONT_PAGE_IMAGE_FORBIDDEN');
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
const auditSections = (sections: readonly PageSection[]): Array<Record<string, unknown>> => sections.map(auditSection);
const auditOf = (page: PageValues) => ({
  title: page.title, slug: page.slug, seoTitle: page.seoTitle, seoDescription: page.seoDescription, noindex: page.noindex,
  shareImageAssetId: page.shareImageAssetId, sections: auditSections(page.sections),
});

function refused(problem: { field: string; section: number; message: string; code: string }): ValidationError {
  return invalid(problem.message, problem.field, problem.code, { section: problem.section });
}

/** `POST /api/storefront/pages`: a new custom page, empty or from a template; it starts as a draft */
export async function createPage(req: Request, input: PageCreateInput): Promise<PageDetail> {
  const template = input.template === null ? null : PAGE_TEMPLATES.find(t => t.key === input.template);
  if (input.template !== null && !template) throw invalid('این الگو شناخته نیست.', 'template', 'STOREFRONT_PAGE_TEMPLATE_UNKNOWN');
  const checked = checkedPage({ title: input.title, slug: input.slug, sections: template ? template.sections() : [] }, { forPublish: false, baseSlug: null });
  if (checked.problem) throw refused(checked.problem);
  const page = checked.page;
  const id = await orm.transaction(async (tx) => {
    const live = await tx.select({ id: storefrontPages.id, slug: storefrontPages.slug, kind: storefrontPages.kind }).from(storefrontPages).where(eq(storefrontPages.isDeleted, 0));
    // the ceiling is for the pages the shop makes: the base and the fixed rows are not counted against it
    if (live.filter(row => row.kind === 'custom').length >= PAGES_MAX) throw invalid('شمار صفحه‌ها به سقف رسیده است؛ صفحه‌ای را که لازم نیست بردارید.', 'title', 'STOREFRONT_PAGE_TOO_MANY');
    if (live.some(row => row.slug === page.slug)) throw new ConflictError('صفحهٔ دیگری همین نشانی را دارد.', { field: 'slug' }, 'STOREFRONT_PAGE_SLUG_TAKEN');
    const actor = actorOf(req);
    const [row] = await tx.insert(storefrontPages).values({
      kind: 'custom', slug: page.slug, title: page.title, sections: page.sections, createdBy: actor, updatedBy: actor,
    }).returning({ id: storefrontPages.id });
    await logActivity({
      req, tx, action: 'CREATE', entity: AUDIT_ENTITY, entityId: `page-${row.id}`,
      description: `صفحهٔ «${page.title}» ساخته شد (پیش‌نویس)`, details: { after: auditOf(page), template: input.template },
    });
    return row.id;
  });
  return pageDetail(orm, id);
}

/** `PUT /api/storefront/pages/:id`: «ذخیرهٔ پیش‌نویس»; the copy on the site does not change */
export async function saveDraft(req: Request, id: number, input: PageSaveInput): Promise<PageDetail> {
  const { version, ...raw } = input;
  await orm.transaction(async (tx) => {
    const row = await lockedRow(tx, id, version);
    const checked = checkedPage(raw, { forPublish: false, baseSlug: baseSlugOf(row), fixedSlug: fixedSlugOf(row) });
    if (checked.problem) throw refused(checked.problem);
    const page = checked.page;
    const before = draftOf(row);
    if (page.slug !== row.slug) {
      if (row.published !== null) {
        throw invalid('نشانی صفحه‌ای که روی سایت است با ذخیرهٔ پیش‌نویس عوض نمی‌شود؛ از «تغییر نشانی» استفاده کنید تا نشانی کنونی به نشانی تازه منتقل شود.', 'slug', 'STOREFRONT_PAGE_SLUG_ON_SITE');
      }
      const [taken] = await tx.select({ id: storefrontPages.id }).from(storefrontPages)
        .where(and(eq(storefrontPages.slug, page.slug), eq(storefrontPages.isDeleted, 0)));
      if (taken) throw new ConflictError('صفحهٔ دیگری همین نشانی را دارد.', { field: 'slug' }, 'STOREFRONT_PAGE_SLUG_TAKEN');
      // redirects that led to the page's old address follow it, though it is off the site now (10c review)
      await redirectMovedPage(req, tx, { from: `/pages/${row.slug}`, to: `/pages/${page.slug}`, title: page.title, onSite: false });
    }
    // the images the page already has: its draft's, and those of its copy on the site (which «برگرداندن» brings back)
    const had = [...pageAssetIds(before), ...(row.published ? pageAssetIds(row.published) : [])];
    await refuseNewImagesWithoutMedia(req, page, had);
    await checkReferences(tx, page, had);
    const actor = actorOf(req);
    await tx.update(storefrontPages).set({
      slug: page.slug, title: page.title, seoTitle: page.seoTitle, seoDescription: page.seoDescription, noindex: page.noindex ? 1 : 0,
      shareImageAssetId: page.shareImageAssetId, sections: page.sections, version: nextVersion(row.version), updatedBy: actor, updatedAt: systemNowUtcIso(),
    }).where(eq(storefrontPages.id, id));
    await logActivity({
      req, tx, action: 'UPDATE', entity: AUDIT_ENTITY, entityId: `page-${id}`,
      description: `پیش‌نویس صفحهٔ «${page.title}» ذخیره شد`, details: { before: auditOf(before), after: auditOf(page) },
    });
  });
  return pageDetail(orm, id);
}

/** The images a published content names: the rows are switched on and off, never removed */
async function writeContentAssets(tx: DbExecutor, contentId: number, assetIds: readonly number[]): Promise<void> {
  const saved = await tx.select().from(storefrontContentAssets)
    .where(and(eq(storefrontContentAssets.contentKind, CONTENT_KIND), eq(storefrontContentAssets.contentId, contentId))).for('update');
  const at = systemNowUtcIso();
  const off = saved.filter(row => row.isDeleted === 0 && !assetIds.includes(row.assetId)).map(row => row.id);
  if (off.length) await tx.update(storefrontContentAssets).set({ isDeleted: 1, updatedAt: at }).where(inArray(storefrontContentAssets.id, off));
  const on = saved.filter(row => row.isDeleted === 1 && assetIds.includes(row.assetId)).map(row => row.id);
  if (on.length) await tx.update(storefrontContentAssets).set({ isDeleted: 0, updatedAt: at }).where(inArray(storefrontContentAssets.id, on));
  const known = new Set(saved.map(row => row.assetId));
  const fresh = assetIds.filter(assetId => !known.has(assetId));
  if (fresh.length) await tx.insert(storefrontContentAssets).values(fresh.map(assetId => ({ contentKind: CONTENT_KIND, contentId, assetId })));
}

/** `POST /api/storefront/pages/:id/publish`: «انتشار»: the saved draft becomes the copy on the site */
export async function publishPage(req: Request, id: number, version: number): Promise<PageDetail> {
  await orm.transaction(async (tx) => {
    const row = await lockedRow(tx, id, version);
    // the draft was checked when it was saved; it is checked whole again here, now as a page that must be finished
    const checked = checkedPage(draftOf(row), { forPublish: true, baseSlug: baseSlugOf(row), fixedSlug: fixedSlugOf(row) });
    if (checked.problem) throw refused(checked.problem);
    const page = checked.page;
    await checkReferences(tx, page, []);
    const copy = publishedCopyOf(page);
    if (sameCopy(copy, row.published)) return;
    if (row.published === null && row.kind === 'custom') await clearRedirectFrom(req, tx, `/pages/${row.slug}`);
    const actor = actorOf(req);
    const at = systemNowUtcIso();
    await tx.update(storefrontPages).set({
      published: copy, publishedAt: at, publishedBy: actor, version: nextVersion(row.version), updatedBy: actor, updatedAt: at,
    }).where(eq(storefrontPages.id, id));
    await writeContentAssets(tx, id, pageAssetIds(page));
    await logActivity({
      req, tx, action: 'UPDATE', entity: AUDIT_ENTITY, entityId: `page-${id}`,
      description: `صفحهٔ «${page.title}» روی سایت منتشر شد`,
      details: { before: row.published ? { title: row.published.title, sections: auditSections(row.published.sections) } : null, after: auditOf(page) },
    });
  });
  return pageDetail(orm, id);
}

/** `POST /api/storefront/pages/:id/revert`: «برگرداندن به نسخهٔ روی سایت»: the draft's changes are thrown away */
export async function revertDraft(req: Request, id: number, version: number): Promise<PageDetail> {
  await orm.transaction(async (tx) => {
    const row = await lockedRow(tx, id, version);
    if (row.published === null) throw invalid('این صفحه هنوز نسخه‌ای روی سایت ندارد.', 'version', 'STOREFRONT_PAGE_NOT_PUBLISHED');
    const published = row.published;
    if (sameCopy(publishedCopyOf(draftOf(row)), published)) return;
    const actor = actorOf(req);
    await tx.update(storefrontPages).set({
      title: published.title, seoTitle: published.seoTitle, seoDescription: published.seoDescription, noindex: published.noindex ? 1 : 0,
      shareImageAssetId: published.shareImageAssetId, sections: published.sections, version: nextVersion(row.version), updatedBy: actor,
      updatedAt: systemNowUtcIso(),
    }).where(eq(storefrontPages.id, id));
    await logActivity({
      req, tx, action: 'UPDATE', entity: AUDIT_ENTITY, entityId: `page-${id}`,
      description: `پیش‌نویس صفحهٔ «${published.title}» به نسخهٔ روی سایت برگشت`,
      details: { before: auditOf(draftOf(row)), after: { title: published.title, sections: auditSections(published.sections) } },
    });
  });
  return pageDetail(orm, id);
}

/** `POST /api/storefront/pages/:id/unpublish`: the page leaves the site; its draft stays as it is */
export async function unpublishPage(req: Request, id: number, version: number): Promise<PageDetail> {
  await orm.transaction(async (tx) => {
    const row = await lockedRow(tx, id, version);
    if (row.published === null) return;
    const actor = actorOf(req);
    await tx.update(storefrontPages).set({
      published: null, publishedAt: null, publishedBy: '', version: nextVersion(row.version), updatedBy: actor, updatedAt: systemNowUtcIso(),
    }).where(eq(storefrontPages.id, id));
    await writeContentAssets(tx, id, []);
    await logActivity({
      req, tx, action: 'UPDATE', entity: AUDIT_ENTITY, entityId: `page-${id}`,
      description: `صفحهٔ «${row.title}» از روی سایت برداشته شد`, details: { before: { title: row.published.title, sections: auditSections(row.published.sections) }, after: null, linkedFromMenus: await menuPlacesOf(tx, id) },
    });
  });
  return pageDetail(orm, id);
}

/** `DELETE /api/storefront/pages/:id`: a custom page is removed softly; a base or a fixed page never */
export async function deletePage(req: Request, id: number, version: number): Promise<void> {
  await orm.transaction(async (tx) => {
    const row = await lockedRow(tx, id, version);
    if (row.kind === 'base') throw invalid('صفحه‌های پایهٔ سایت حذف نمی‌شوند؛ می‌توانید آن را از روی سایت بردارید.', 'id', 'STOREFRONT_PAGE_BASE_KEPT');
    if (row.kind !== 'custom') throw invalid('صفحه‌های ثابت سایت حذف نمی‌شوند؛ می‌توانید متن آن را از روی سایت بردارید.', 'id', 'STOREFRONT_PAGE_BASE_KEPT');
    const actor = actorOf(req);
    await tx.update(storefrontPages).set({
      isDeleted: 1, published: null, publishedAt: null, publishedBy: '', version: nextVersion(row.version), updatedBy: actor, updatedAt: systemNowUtcIso(),
    }).where(eq(storefrontPages.id, id));
    await writeContentAssets(tx, id, []);
    await logActivity({
      req, tx, action: 'DELETE', entity: AUDIT_ENTITY, entityId: `page-${id}`,
      description: `صفحهٔ «${row.title}» حذف شد`, details: { before: auditOf(draftOf(row)), wasOnSite: row.published !== null, linkedFromMenus: await menuPlacesOf(tx, id) },
    });
  });
}

/**
 * The images of published contents: a live image with a light version that a live row names. The site's image route
 * (10c, `contentImageFile`) asks the same of one file at a time, joined to the page being on the site.
 */
export async function publishedContentAssetIds(executor: DbExecutor): Promise<number[]> {
  const rows = await executor.select({ assetId: storefrontContentAssets.assetId }).from(storefrontContentAssets)
    .innerJoin(mediaAssets, eq(mediaAssets.id, storefrontContentAssets.assetId))
    .where(and(eq(storefrontContentAssets.isDeleted, 0), eq(mediaAssets.isDeleted, 0), eq(mediaAssets.kind, 'image'), isNotNull(mediaAssets.lightBytes)));
  return [...new Set(rows.map(r => r.assetId))];
}
