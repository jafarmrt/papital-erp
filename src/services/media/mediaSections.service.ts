import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { orm, type DbTransaction } from '../../db/drizzle.js';
import { mediaAssets, mediaSections } from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { listLiveSections, MEDIA_AUDIT_ENTITY, type MediaActor, type MediaSectionView } from './mediaAsset.service.js';

/**
 * v10.0.27 (N-05 PR 3): the sections of the media library besides «محصولات» (approved plan, section 2). A section is
 * created, renamed, reordered and deleted by a holder of `media.manage`; the system section «محصولات» is never renamed
 * or deleted, only moved. A live title is unique (letter case and surrounding spaces ignored, `uq_media_sections_title_active`);
 * a section that still holds a live file is not deleted. Every change writes its audit row with `tx`.
 */

export const MEDIA_SECTION_TITLE_MAX = 100;
export const MEDIA_SECTION_DESCRIPTION_MAX = 1000;
const TITLE_INDEX = 'uq_media_sections_title_active';
const TITLE_TAKEN_TEXT = 'بخشی با همین عنوان در کتابخانه هست.';

type SectionRow = typeof mediaSections.$inferSelect;

const snapshot = (s: SectionRow) => ({ kind: s.kind, title: s.title, description: s.description, sortOrder: s.sortOrder });

function sectionTitle(input: unknown): string {
  const title = String(input ?? '').replace(/\s+/g, ' ').trim();
  if (!title) throw new ValidationError('عنوان بخش لازم است.', undefined, 'MEDIA_SECTION_TITLE_REQUIRED');
  if (title.length > MEDIA_SECTION_TITLE_MAX) throw new ValidationError('عنوان بخش حداکثر ۱۰۰ نویسه است.', undefined, 'MEDIA_SECTION_TITLE_TOO_LONG');
  return title;
}

function sectionDescription(input: unknown): string {
  const text = String(input ?? '').trim();
  if (text.length > MEDIA_SECTION_DESCRIPTION_MAX) {
    throw new ValidationError('توضیح بخش حداکثر ۱٬۰۰۰ نویسه است.', undefined, 'MEDIA_SECTION_DESCRIPTION_TOO_LONG');
  }
  return text;
}

async function assertTitleFree(tx: DbTransaction, title: string, excludeId?: number): Promise<void> {
  const conditions = [eq(mediaSections.isDeleted, 0), sql`lower(btrim(${mediaSections.title})) = ${title.toLowerCase()}`];
  if (excludeId) conditions.push(ne(mediaSections.id, excludeId));
  const [taken] = await tx.select({ id: mediaSections.id }).from(mediaSections).where(and(...conditions)).limit(1);
  if (taken) throw new ConflictError(TITLE_TAKEN_TEXT, { sectionId: taken.id }, 'MEDIA_SECTION_TITLE_TAKEN');
}

/** A concurrent save of the same title passes the check and hits the unique index: the same Persian 409 */
async function guardTitle<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    for (let e: unknown = err, depth = 0; e && typeof e === 'object' && depth < 3; e = (e as { cause?: unknown }).cause, depth++) {
      const pg = e as { code?: unknown; constraint?: unknown };
      if (pg.code === '23505' && pg.constraint === TITLE_INDEX) throw new ConflictError(TITLE_TAKEN_TEXT, undefined, 'MEDIA_SECTION_TITLE_TAKEN');
    }
    throw err;
  }
}

async function lockSection(tx: DbTransaction, id: number): Promise<SectionRow> {
  const [row] = await tx.select().from(mediaSections).where(and(eq(mediaSections.id, id), eq(mediaSections.isDeleted, 0))).for('update');
  if (!row) throw new NotFoundError('بخش کتابخانه یافت نشد.', undefined, 'MEDIA_SECTION_NOT_FOUND');
  return row;
}

function assertCustom(row: SectionRow): void {
  if (row.kind === 'products') {
    throw new ConflictError('بخش «محصولات» بخش ثابت سامانه است و تغییر نام یا حذف نمی‌شود.', undefined, 'MEDIA_SECTION_SYSTEM');
  }
}

const viewOf = async (tx: DbTransaction, id: number): Promise<MediaSectionView> => {
  const view = (await listLiveSections(tx)).find(s => s.id === id);
  if (!view) throw new NotFoundError('بخش کتابخانه یافت نشد.', undefined, 'MEDIA_SECTION_NOT_FOUND');
  return view;
};

export const MediaSectionService = {
  list: () => listLiveSections(orm),

  async create(input: { title: string; description?: string }, actor: MediaActor): Promise<MediaSectionView> {
    const title = sectionTitle(input.title);
    const description = sectionDescription(input.description);
    return guardTitle(() => orm.transaction(async (tx) => {
      await assertTitleFree(tx, title);
      const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${mediaSections.sortOrder}), 0) + 1` })
        .from(mediaSections).where(eq(mediaSections.isDeleted, 0));
      const [row] = await tx.insert(mediaSections).values({
        kind: 'custom', title, description, sortOrder: Number(next), createdBy: actor.username,
      }).returning();
      await logActivity({
        tx, req: actor.req, userId: actor.userId, username: actor.username, action: 'CREATE', entity: MEDIA_AUDIT_ENTITY,
        entityId: row.id, description: `ساخت بخش «${row.title}» در کتابخانه تصاویر`, details: { after: snapshot(row) },
      });
      return viewOf(tx, row.id);
    }));
  },

  async update(id: number, input: { version: number; title?: string; description?: string }, actor: MediaActor): Promise<MediaSectionView> {
    return guardTitle(() => orm.transaction(async (tx) => {
      const before = await lockSection(tx, id);
      assertCustom(before);
      if (before.version !== input.version) {
        throw new ConflictError('این بخش را کاربر دیگری تغییر داده؛ دوباره باز کنید.', undefined, 'OCC_CONFLICT');
      }
      const title = input.title === undefined ? before.title : sectionTitle(input.title);
      const description = input.description === undefined ? before.description : sectionDescription(input.description);
      if (title.toLowerCase() !== before.title.toLowerCase()) await assertTitleFree(tx, title, id);
      const [after] = await tx.update(mediaSections).set({ title, description, version: before.version + 1, updatedAt: sql`now()` })
        .where(eq(mediaSections.id, id)).returning();
      await logActivity({
        tx, req: actor.req, userId: actor.userId, username: actor.username, action: 'UPDATE', entity: MEDIA_AUDIT_ENTITY,
        entityId: id, description: `ویرایش بخش «${before.title}» کتابخانه تصاویر`, details: { before: snapshot(before), after: snapshot(after) },
      });
      return viewOf(tx, id);
    }));
  },

  /** Sets the display order: `ids` must name every live section exactly once */
  async reorder(ids: readonly number[], actor: MediaActor): Promise<MediaSectionView[]> {
    return orm.transaction(async (tx) => {
      const rows = await tx.select().from(mediaSections).where(eq(mediaSections.isDeleted, 0))
        .orderBy(asc(mediaSections.id)).for('update');
      const live = new Set(rows.map(r => r.id));
      if (new Set(ids).size !== ids.length || ids.length !== live.size || ids.some(id => !live.has(id))) {
        throw new ValidationError('ترتیب باید همه بخش‌های کتابخانه را یک بار نام ببرد.', undefined, 'MEDIA_ORDER_INVALID');
      }
      const before = rows.map(r => ({ id: r.id, sortOrder: r.sortOrder }));
      for (const [index, id] of ids.entries()) {
        await tx.update(mediaSections).set({ sortOrder: index + 1, updatedAt: sql`now()` }).where(eq(mediaSections.id, id));
      }
      await logActivity({
        tx, req: actor.req, userId: actor.userId, username: actor.username, action: 'UPDATE', entity: MEDIA_AUDIT_ENTITY,
        description: 'تغییر ترتیب بخش‌های کتابخانه تصاویر', details: { before, after: ids.map((id, i) => ({ id, sortOrder: i + 1 })) },
      });
      return listLiveSections(tx);
    });
  },

  /** Soft delete of an empty custom section */
  async remove(id: number, actor: MediaActor): Promise<void> {
    await orm.transaction(async (tx) => {
      const before = await lockSection(tx, id);
      assertCustom(before);
      const [{ files }] = await tx.select({ files: sql<number>`count(*)::int` }).from(mediaAssets)
        .where(and(eq(mediaAssets.sectionId, id), eq(mediaAssets.isDeleted, 0)));
      if (Number(files) > 0) {
        throw new ConflictError(`این بخش ${Number(files).toLocaleString('fa-IR')} فایل دارد؛ نخست فایل‌ها را حذف کنید.`, { files: Number(files) }, 'MEDIA_SECTION_NOT_EMPTY');
      }
      await tx.update(mediaSections).set({ isDeleted: 1, version: before.version + 1, updatedAt: sql`now()` }).where(eq(mediaSections.id, id));
      await logActivity({
        tx, req: actor.req, userId: actor.userId, username: actor.username, action: 'DELETE', entity: MEDIA_AUDIT_ENTITY,
        entityId: id, description: `حذف بخش «${before.title}» از کتابخانه تصاویر`, details: { before: snapshot(before) },
      });
    });
  },
};
