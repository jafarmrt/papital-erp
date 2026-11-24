import type { Request } from 'express';
import { and, asc, eq, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { storefrontForms } from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { OptimisticLockError, nextVersion } from '../../lib/occHelper.js';
import { FORMS_MAX, checkedForm, contactFormTemplate, type FormProblem, type FormValues } from '../../lib/storefront/storefrontFormRules.js';
import type { FormCreateInput, FormDetail, FormList, FormListRow, FormSaveInput } from '../../lib/storefront/storefrontFormContracts.js';

/**
 * v12 phase 10f (package 18, V12_SITE_NEXT_START_PLAN.md §7.2 «۱۰و»): «فرم‌های سایت» on the ERP side. Reading needs
 * `site_content.view`, every change `site_content.manage`. A form is rebuilt from its known fields on every save
 * (`checkedForm`); it is on the site only while its switch is on, and a form with nothing to fill in cannot be turned
 * on, nor emptied while it is on. Each change locks the row, refuses a stale version (409) and writes its audit row in
 * the same transaction. Removing a form is a soft delete, which also takes it off the site and frees its key.
 */
type FormRecord = typeof storefrontForms.$inferSelect;

const AUDIT_ENTITY = 'فرم سایت';
const actorOf = (req: Request) => String((req.user as { username?: string } | undefined)?.username ?? '');
const invalid = (message: string, field: string, code: string, extra: Record<string, unknown> = {}) => new ValidationError(message, { field, ...extra }, code);
const refused = (problem: FormProblem) => invalid(problem.message, problem.field, problem.code, { index: problem.index });
const notFound = () => new NotFoundError('این فرم پیدا نشد.', undefined, 'STOREFRONT_FORM_NOT_FOUND');

const valuesOf = (row: FormRecord): FormValues => ({
  key: row.key, title: row.title, intro: row.intro, fields: Array.isArray(row.fields) ? row.fields : [], submitLabel: row.submitLabel, successMessage: row.successMessage,
});
const listRowOf = (row: FormRecord): FormListRow => ({
  id: row.id, key: row.key, title: row.title, enabled: row.enabled === 1, fieldCount: Array.isArray(row.fields) ? row.fields.length : 0,
  updatedAt: row.updatedAt, updatedBy: row.updatedBy, version: row.version,
});
const detailOf = (row: FormRecord): FormDetail => ({ ...listRowOf(row), form: valuesOf(row) });
/** what an audit row keeps of a form: its words and the shape of its fields (a form holds no answer of anyone) */
const auditOf = (form: FormValues) => ({
  key: form.key, title: form.title, intro: form.intro, submitLabel: form.submitLabel, successMessage: form.successMessage,
  fields: form.fields.map(field => ({ id: field.id, kind: field.kind, label: field.label, required: field.required, help: field.help, options: field.options })),
});

/** `GET /api/storefront/forms`: the shop's forms, by title */
export async function listForms(executor: DbExecutor): Promise<FormList> {
  const rows = await executor.select().from(storefrontForms).where(eq(storefrontForms.isDeleted, 0)).orderBy(asc(storefrontForms.title), asc(storefrontForms.id));
  return { data: rows.map(listRowOf), max: FORMS_MAX };
}

/** `GET /api/storefront/forms/:id`: a form as the editor opens it */
export async function formDetail(executor: DbExecutor, id: number): Promise<FormDetail> {
  const [row] = await executor.select().from(storefrontForms).where(and(eq(storefrontForms.id, id), eq(storefrontForms.isDeleted, 0)));
  if (!row) throw notFound();
  return detailOf(row);
}

async function lockedRow(tx: DbExecutor, id: number, expectedVersion: number): Promise<FormRecord> {
  const [row] = await tx.select().from(storefrontForms).where(and(eq(storefrontForms.id, id), eq(storefrontForms.isDeleted, 0))).for('update');
  if (!row) throw notFound();
  if (row.version !== expectedVersion) {
    throw new OptimisticLockError({ entityType: 'StorefrontForm', entityId: String(id), expectedVersion, currentVersion: row.version });
  }
  return row;
}

/** Two creations never interleave: the cap reads the whole table */
const lockForms = (tx: DbExecutor) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'storefront_forms'}))`);

const keyTaken = () => new ConflictError('فرم دیگری همین نام لاتین را دارد.', { field: 'key' }, 'STOREFRONT_FORM_KEY_TAKEN');
async function refuseTakenKey(tx: DbExecutor, key: string): Promise<void> {
  const [taken] = await tx.select({ id: storefrontForms.id }).from(storefrontForms).where(and(eq(storefrontForms.key, key), eq(storefrontForms.isDeleted, 0)));
  if (taken) throw keyTaken();
}
/** Two requests that took one key at the same moment: the second is stopped by the unique index and gets the same answer */
function keyRace(err: unknown): never {
  // by the constraint's own name, never by the text of the error (which carries what the request sent)
  for (let e: unknown = err, depth = 0; e && typeof e === 'object' && depth < 3; e = (e as { cause?: unknown }).cause, depth++) {
    const pg = e as { code?: unknown; constraint?: unknown };
    if (pg.code === '23505' && pg.constraint === 'uq_storefront_forms_key_live') throw keyTaken();
  }
  throw err;
}

/** `POST /api/storefront/forms`: a new form, empty or from «فرم تماس»; it starts off the site */
export async function createForm(req: Request, input: FormCreateInput): Promise<FormDetail> {
  const start = input.template === 'contact' ? contactFormTemplate() : { intro: '', fields: [], submitLabel: '', successMessage: '' };
  const checked = checkedForm({ key: input.key, title: input.title, ...start }, { forSite: false });
  if (checked.problem) throw refused(checked.problem);
  const form = checked.form;
  const id = await orm.transaction(async (tx) => {
    await lockForms(tx);
    const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(storefrontForms).where(eq(storefrontForms.isDeleted, 0));
    if (total >= FORMS_MAX) throw invalid('شمار فرم‌ها به سقف رسیده است؛ فرمی را که لازم نیست حذف کنید.', 'title', 'STOREFRONT_FORM_TOO_MANY');
    await refuseTakenKey(tx, form.key);
    const actor = actorOf(req);
    const [row] = await tx.insert(storefrontForms).values({
      key: form.key, title: form.title, intro: form.intro, fields: form.fields, submitLabel: form.submitLabel, successMessage: form.successMessage, createdBy: actor, updatedBy: actor,
    }).returning({ id: storefrontForms.id });
    await logActivity({ req, tx, action: 'CREATE', entity: AUDIT_ENTITY, entityId: `form-${row.id}`, description: `فرم «${form.title}» ساخته شد`, details: { after: { ...auditOf(form), enabled: false } } });
    return row.id;
  }).catch(keyRace);
  return formDetail(orm, id);
}

/** `PUT /api/storefront/forms/:id`: the form's words and fields; a form on the site changes there at once */
export async function saveForm(req: Request, id: number, input: FormSaveInput): Promise<FormDetail> {
  const { version, ...raw } = input;
  await orm.transaction(async (tx) => {
    const row = await lockedRow(tx, id, version);
    // a form that is on the site must still have something to fill in after the save
    const checked = checkedForm(raw, { forSite: row.enabled === 1 });
    if (checked.problem) throw refused(checked.problem);
    const form = checked.form;
    if (form.key !== row.key) {
      // the site asks for a form by its key: one that is on the site keeps it
      if (row.enabled === 1) throw invalid('نام لاتین فرمی که روی سایت است عوض نمی‌شود؛ نخست آن را از روی سایت بردارید.', 'key', 'STOREFRONT_FORM_KEY_ON_SITE');
      await refuseTakenKey(tx, form.key);
    }
    await tx.update(storefrontForms).set({
      key: form.key, title: form.title, intro: form.intro, fields: form.fields, submitLabel: form.submitLabel, successMessage: form.successMessage,
      version: nextVersion(row.version), updatedBy: actorOf(req), updatedAt: systemNowUtcIso(),
    }).where(eq(storefrontForms.id, id));
    await logActivity({
      req, tx, action: 'UPDATE', entity: AUDIT_ENTITY, entityId: `form-${id}`,
      description: `فرم «${form.title}» ذخیره شد`, details: { before: auditOf(valuesOf(row)), after: auditOf(form), onSite: row.enabled === 1 },
    });
  }).catch(keyRace);
  return formDetail(orm, id);
}

/** `PUT /api/storefront/forms/:id/enabled`: «این فرم روی سایت باشد», sent its target state; a repeat changes nothing */
export async function setFormEnabled(req: Request, id: number, enabled: boolean, version: number): Promise<FormDetail> {
  await orm.transaction(async (tx) => {
    const row = await lockedRow(tx, id, version);
    if ((row.enabled === 1) === enabled) return;
    if (enabled) {
      const checked = checkedForm(valuesOf(row), { forSite: true });
      if (checked.problem) throw refused(checked.problem);
    }
    await tx.update(storefrontForms).set({ enabled: enabled ? 1 : 0, version: nextVersion(row.version), updatedBy: actorOf(req), updatedAt: systemNowUtcIso() }).where(eq(storefrontForms.id, id));
    await logActivity({
      req, tx, action: 'UPDATE', entity: AUDIT_ENTITY, entityId: `form-${id}`,
      description: enabled ? `فرم «${row.title}» روی سایت آمد` : `فرم «${row.title}» از روی سایت برداشته شد`,
      details: { before: { enabled: row.enabled === 1 }, after: { enabled } },
    });
  });
  return formDetail(orm, id);
}

/** `DELETE /api/storefront/forms/:id`: the form is removed softly, and leaves the site if it was on it */
export async function deleteForm(req: Request, id: number, version: number): Promise<void> {
  await orm.transaction(async (tx) => {
    const row = await lockedRow(tx, id, version);
    await tx.update(storefrontForms).set({ isDeleted: 1, enabled: 0, version: nextVersion(row.version), updatedBy: actorOf(req), updatedAt: systemNowUtcIso() }).where(eq(storefrontForms.id, id));
    await logActivity({
      req, tx, action: 'DELETE', entity: AUDIT_ENTITY, entityId: `form-${id}`,
      description: `فرم «${row.title}» حذف شد`, details: { before: auditOf(valuesOf(row)), wasOnSite: row.enabled === 1 },
    });
  });
}
