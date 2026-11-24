import request from 'supertest';
import { and, desc, eq, like, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, storefrontForms } from '../../db/schema.js';
import { FORMS_MAX, FORM_FIELDS_MAX, FORM_FIELD_LABEL_MAX, type FormField } from '../../lib/storefront/storefrontFormRules.js';

/**
 * v12 phase 10f, part 1 (migration 0037, docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2 «۱۰و»): «فرم‌های سایت» on real
 * Express routes and PostgreSQL. `site_content.view` reads the forms, `site_content.manage` makes, saves, switches and
 * removes them (the shop's own `storefront.manage` does neither); a form is rebuilt from its known fields and anything
 * else is refused with its code; every change goes under the form's version and writes one audit row; a form with
 * nothing to fill in is never on the site; removing a form is a soft delete that frees its key. The CHECK constraints
 * and the unique key of migration 0037 hold against a direct write.
 */
interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;

export async function runStorefrontFormsV12Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_forms_v12_p10f';
  if (!shouldRun(id, 'v12', 'phase10', 'storefront', 'forms', 'migration', 'security')) return results;

  const name = 'v12 phase 10f: a form of the site is made, saved, switched and removed under its version by who may, rebuilt from known fields, audited, and never on the site with nothing to fill in';
  const tStart = Date.now();
  const wrong: string[] = [];
  const tag = String(Date.now()).slice(-7);
  const keyOf = (word: string) => `${word}-${tag}`;
  try {
    const { getTestApp, getAdminSession, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestRole, createTestUser } = await import('../fixtures/factories.js');
    const app = await getTestApp();
    const admin: Session = await getAdminSession();
    const as = (s: Session) => ({
      get: (url: string) => request(app).get(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken),
      put: (url: string, body: Body) => request(app).put(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
      post: (url: string, body: Body = {}) => request(app).post(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
      del: (url: string) => request(app).delete(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken),
    });
    const erp = as(admin);
    const userWith = async (...permissions: string[]) => as(await loginTestUserWithSession(app, (await createTestUser({ role: (await createTestRole({ permissions })).code })).username));
    const keys = (value: unknown) => Object.keys((value ?? {}) as Body).sort().join(',');
    const auditRows = async (formId: number) => orm.select().from(activityLogs).where(and(eq(activityLogs.entity, 'فرم سایت'), eq(activityLogs.entityId, `form-${formId}`))).orderBy(desc(activityLogs.id));

    // 1) a new form: empty, or from «فرم تماس»; it starts off the site
    const made = await erp.post('/api/storefront/forms', { title: `  فرم   آزمون ${tag} `, key: keyOf('probe'), template: null });
    const formId = Number(made.body.data?.id);
    const first = (made.body.data ?? {}) as Body & { form?: Body };
    if (made.status !== 201 || keys(first) !== 'enabled,fieldCount,form,id,key,makesLead,title,updatedAt,updatedBy,version' || first.makesLead !== false || keys(first.form) !== 'fields,intro,key,submitLabel,successMessage,title'
      || first.title !== `فرم آزمون ${tag}` || first.enabled !== false || first.version !== 1 || first.fieldCount !== 0 || first.form?.submitLabel !== 'فرستادن') {
      wrong.push(`a new form: ${made.status} ${JSON.stringify(made.body).slice(0, 400)}`);
    }
    const contact = await erp.post('/api/storefront/forms', { title: `تماس ${tag}`, key: keyOf('contact'), template: 'contact' });
    const contactId = Number(contact.body.data?.id);
    const contactFields = (contact.body.data?.form?.fields ?? []) as FormField[];
    if (contact.status !== 201 || contactFields.map(f => f.kind).join(',') !== 'shortText,mobile,email,shortText,longText' || contactFields.filter(f => f.required).map(f => f.id).join(',') !== 'f1,f5' || contact.body.data?.enabled !== false) {
      wrong.push(`a form from «فرم تماس»: ${contact.status} ${JSON.stringify(contactFields).slice(0, 300)}`);
    }
    const refusedNew = [
      await erp.post('/api/storefront/forms', { title: 'دوباره', key: keyOf('probe'), template: null }),
      await erp.post('/api/storefront/forms', { title: 'نام بد', key: 'Bad Key', template: null }),
      await erp.post('/api/storefront/forms', { title: '', key: keyOf('untitled'), template: null }),
      await erp.post('/api/storefront/forms', { title: 'الگوی ناشناخته', key: keyOf('other'), template: 'survey' }),
      await erp.post('/api/storefront/forms', { title: 'فیلد اضافه', key: keyOf('extra'), template: null, enabled: true }),
    ].map(res => `${res.status}:${String(res.body.code)}`).join(' ');
    if (refusedNew !== '409:STOREFRONT_FORM_KEY_TAKEN 422:STOREFRONT_FORM_KEY_INVALID 422:STOREFRONT_FORM_FIELD_INVALID 400:VALIDATION_ERROR 400:VALIDATION_ERROR') wrong.push(`new forms that must be refused: ${refusedNew}`);
    const [createAudit] = await auditRows(formId);
    if (createAudit?.action !== 'CREATE' || !String(createAudit.description).includes(`فرم آزمون ${tag}`)) wrong.push(`the audit row of a new form: ${JSON.stringify(createAudit).slice(0, 200)}`);

    // 2) who may: the view key reads and changes nothing; the shop's own keys do neither; no session, no answer
    const viewer = await userWith('site_content.view');
    const shopkeeper = await userWith('storefront.view', 'storefront.manage');
    const body = (over: Body = {}): Body => ({ key: keyOf('probe'), title: `فرم آزمون ${tag}`, intro: '', fields: [], submitLabel: '', successMessage: '', version: 1, ...over });
    const access = [
      (await viewer.get('/api/storefront/forms')).status, (await viewer.get(`/api/storefront/forms/${formId}`)).status,
      (await viewer.post('/api/storefront/forms', { title: 'x', key: keyOf('viewer'), template: null })).status, (await viewer.put(`/api/storefront/forms/${formId}`, body())).status,
      (await viewer.put(`/api/storefront/forms/${formId}/enabled`, { enabled: true, version: 1 })).status, (await viewer.del(`/api/storefront/forms/${formId}?version=1`)).status,
      (await shopkeeper.get('/api/storefront/forms')).status, (await shopkeeper.put(`/api/storefront/forms/${formId}`, body())).status,
      (await request(app).get('/api/storefront/forms')).status, (await erp.get('/api/storefront/forms/2000000000')).status,
    ].join('/');
    if (access !== '200/200/403/403/403/403/403/403/401/404') wrong.push(`who may read and change the forms: ${access}`);
    if (!((await viewer.get('/api/storefront/forms')).body.data as Body[]).some(row => row.id === formId) || (await viewer.get('/api/storefront/forms')).body.max !== FORMS_MAX) wrong.push('the list of forms does not carry the new form or the cap');

    // 3) a save rebuilds the form from its known fields: anything else is refused with its code, and nothing is kept of it
    const field = (over: Body = {}): Body => ({ id: 'f1', kind: 'shortText', label: 'نام', required: true, help: '', options: [], ...over });
    const refusals: Array<[string, Body, string]> = [
      ['a key in a field nobody knows', body({ fields: [field({ onSubmit: 'x' })] }), 'STOREFRONT_FORM_FIELD_UNKNOWN'],
      ['a kind nobody knows', body({ fields: [field({ kind: 'file' })] }), 'STOREFRONT_FORM_FIELD_INVALID'],
      ['a field without a name', body({ fields: [field({ label: '  ' })] }), 'STOREFRONT_FORM_FIELD_INVALID'],
      ['a name too long', body({ fields: [field({ label: 'ن'.repeat(FORM_FIELD_LABEL_MAX + 1) })] }), 'STOREFRONT_FORM_FIELD_TOO_LONG'],
      ['a hidden character in a name', body({ fields: [field({ label: `نام${String.fromCharCode(0x202e)}` })] }), 'STOREFRONT_FORM_FIELD_INVALID'],
      ['a line break in a name', body({ fields: [field({ label: 'نام\nدوم' })] }), 'STOREFRONT_FORM_FIELD_INVALID'],
      ['an id of another shape', body({ fields: [field({ id: 'F 1' })] }), 'STOREFRONT_FORM_FIELD_INVALID'],
      ['two fields by one id', body({ fields: [field(), field({ label: 'دوم' })] }), 'STOREFRONT_FORM_FIELD_INVALID'],
      ['two fields by one name', body({ fields: [field(), field({ id: 'f2' })] }), 'STOREFRONT_FORM_FIELD_INVALID'],
      ['options on a field that takes none', body({ fields: [field({ options: ['الف', 'ب'] })] }), 'STOREFRONT_FORM_FIELD_INVALID'],
      ['a choice of one option', body({ fields: [field({ kind: 'choice', options: ['الف'] })] }), 'STOREFRONT_FORM_FIELD_INVALID'],
      ['a choice with the same option twice', body({ fields: [field({ kind: 'choices', options: ['الف', ' الف '] })] }), 'STOREFRONT_FORM_FIELD_INVALID'],
      ['an option that is not text', body({ fields: [field({ kind: 'choice', options: ['الف', { html: '<b>' }] })] }), 'STOREFRONT_FORM_FIELD_INVALID'],
      ['a required that is not yes or no', body({ fields: [field({ required: 'yes' })] }), 'STOREFRONT_FORM_FIELD_INVALID'],
      ['more fields than a form takes', body({ fields: Array.from({ length: FORM_FIELDS_MAX + 1 }, (_, i) => field({ id: `f${i + 1}`, label: `فیلد ${i + 1}` })) }), 'STOREFRONT_FORM_TOO_MANY'],
      ['a hidden character in the words above', body({ intro: `متن${String.fromCharCode(0x2066)}` }), 'STOREFRONT_FORM_FIELD_INVALID'],
      ['a title that is empty', body({ title: ' ' }), 'STOREFRONT_FORM_FIELD_INVALID'],
    ];
    for (const [what, sent, code] of refusals) {
      const res = await erp.put(`/api/storefront/forms/${formId}`, sent);
      if (res.status !== 422 || res.body.code !== code) wrong.push(`${what}: ${res.status} ${String(res.body.code)}`);
    }
    const extraKey = await erp.put(`/api/storefront/forms/${formId}`, { ...body(), enabled: true });
    const unchanged = (await erp.get(`/api/storefront/forms/${formId}`)).body.data;
    if (extraKey.status !== 400 || unchanged?.version !== 1 || unchanged?.fieldCount !== 0 || (await auditRows(formId)).length !== 1) wrong.push(`a refused save must change nothing: ${extraKey.status}, version ${String(unchanged?.version)}, audit rows ${(await auditRows(formId)).length}`);

    // markup in a name is plain text: kept as it was written, never read as anything else
    const MARKUP = '<script>alert(1)</script> نام';
    const fields = [
      field({ label: `  ${MARKUP}  ` }), field({ id: 'f2', kind: 'mobile', label: 'شمارهٔ همراه', required: false, help: ' راهنما ' }),
      field({ id: 'f3', kind: 'choice', label: 'موضوع', required: false, options: [' فروش ', 'پشتیبانی'] }), field({ id: 'f4', kind: 'consent', label: 'قوانین را می‌پذیرم' }),
    ];
    const saved = await erp.put(`/api/storefront/forms/${formId}`, body({ intro: ' بند یک \r\n\n\n\n بند دو ', fields, submitLabel: ' بفرست ', successMessage: '' }));
    const kept = (saved.body.data?.form ?? {}) as Body & { fields?: FormField[] };
    if (saved.status !== 200 || saved.body.data?.version !== 2 || kept.intro !== 'بند یک\n\nبند دو' || kept.submitLabel !== 'بفرست' || kept.successMessage !== 'پیام شما رسید. سپاس از شما.'
      || kept.fields?.[0]?.label !== MARKUP || kept.fields?.[1]?.help !== 'راهنما' || JSON.stringify(kept.fields?.[2]?.options) !== '["فروش","پشتیبانی"]' || keys(kept.fields?.[3]) !== 'help,id,kind,label,options,required') {
      wrong.push(`a saved form: ${saved.status} ${JSON.stringify(saved.body).slice(0, 500)}`);
    }
    const [saveAudit] = await auditRows(formId);
    const saveDetails = (saveAudit?.details ?? {}) as { before?: { fields?: unknown[] }; after?: { fields?: unknown[] } };
    if (saveAudit?.action !== 'UPDATE' || saveDetails.before?.fields?.length !== 0 || saveDetails.after?.fields?.length !== 4) wrong.push(`the audit row of a save: ${JSON.stringify(saveAudit).slice(0, 300)}`);
    const stale = await erp.put(`/api/storefront/forms/${formId}`, body({ title: 'نسخهٔ کهنه', version: 1 }));
    if (stale.status !== 409 || stale.body.code !== 'OCC_CONFLICT') wrong.push(`a save under a stale version: ${stale.status} ${String(stale.body.code)}`);

    // 4) the switch: a form with nothing to fill in never goes on the site; a repeat changes nothing
    const emptyId = Number((await erp.post('/api/storefront/forms', { title: `خالی ${tag}`, key: keyOf('empty'), template: null })).body.data?.id);
    const emptyOn = await erp.put(`/api/storefront/forms/${emptyId}/enabled`, { enabled: true, version: 1 });
    await erp.put(`/api/storefront/forms/${emptyId}`, body({ key: keyOf('empty'), title: `خالی ${tag}`, fields: [field({ kind: 'consent', label: 'می‌پذیرم' })] }));
    const ticksOn = await erp.put(`/api/storefront/forms/${emptyId}/enabled`, { enabled: true, version: 2 });
    if (`${emptyOn.status}:${String(emptyOn.body.code)} ${ticksOn.status}:${String(ticksOn.body.code)}` !== '422:STOREFRONT_FORM_EMPTY 422:STOREFRONT_FORM_EMPTY') {
      wrong.push(`turning on a form with no field, and one of ticks alone: ${emptyOn.status}:${String(emptyOn.body.code)} ${ticksOn.status}:${String(ticksOn.body.code)}`);
    }
    const on = await erp.put(`/api/storefront/forms/${formId}/enabled`, { enabled: true, version: 2 });
    const auditsOn = (await auditRows(formId)).length;
    const again = await erp.put(`/api/storefront/forms/${formId}/enabled`, { enabled: true, version: 3 });
    if (on.status !== 200 || on.body.data?.enabled !== true || on.body.data?.version !== 3 || again.status !== 200 || again.body.data?.version !== 3 || (await auditRows(formId)).length !== auditsOn) {
      wrong.push(`the switch and its repeat: ${on.status} v${String(on.body.data?.version)}, again ${again.status} v${String(again.body.data?.version)}, audit rows ${auditsOn} then ${(await auditRows(formId)).length}`);
    }
    const [onAudit] = await auditRows(formId);
    if (JSON.stringify((onAudit?.details as Body | null)?.after) !== '{"enabled":true}' || !String(onAudit?.description).includes('روی سایت آمد')) wrong.push(`the audit row of the switch: ${JSON.stringify(onAudit).slice(0, 200)}`);
    // while it is on the site: its key stays, and it cannot be emptied
    const onSite = [
      await erp.put(`/api/storefront/forms/${formId}`, body({ key: keyOf('moved'), fields, version: 3 })),
      await erp.put(`/api/storefront/forms/${formId}`, body({ fields: [], version: 3 })),
      await erp.put(`/api/storefront/forms/${formId}/enabled`, { enabled: true, version: 2 }),
    ].map(res => `${res.status}:${String(res.body.code)}`).join(' ');
    if (onSite !== '422:STOREFRONT_FORM_KEY_ON_SITE 422:STOREFRONT_FORM_EMPTY 409:OCC_CONFLICT') wrong.push(`a form on the site whose key is changed, that is emptied, and a switch under a stale version: ${onSite}`);
    const off = await erp.put(`/api/storefront/forms/${formId}/enabled`, { enabled: false, version: 3 });
    const moved = await erp.put(`/api/storefront/forms/${formId}`, body({ key: keyOf('moved'), fields, version: 4 }));
    if (off.body.data?.enabled !== false || moved.status !== 200 || moved.body.data?.key !== keyOf('moved')) wrong.push(`off the site the key changes: ${off.status} ${moved.status} ${String(moved.body.data?.key)}`);
    const taken = await erp.put(`/api/storefront/forms/${formId}`, body({ key: keyOf('contact'), fields, version: 5 }));
    if (taken.status !== 409 || taken.body.code !== 'STOREFRONT_FORM_KEY_TAKEN') wrong.push(`a key another form has: ${taken.status} ${String(taken.body.code)}`);

    // 5) removal: under the version, soft, off the site, and the key is free again
    await erp.put(`/api/storefront/forms/${contactId}/enabled`, { enabled: true, version: 1 });
    const removals = [
      (await erp.del(`/api/storefront/forms/${contactId}`)).status, (await erp.del(`/api/storefront/forms/${contactId}?version=1`)).status,
      (await erp.del(`/api/storefront/forms/${contactId}?version=2`)).status, (await erp.get(`/api/storefront/forms/${contactId}`)).status,
      (await erp.del(`/api/storefront/forms/${contactId}?version=3`)).status,
    ].join('/');
    const [gone] = await orm.select().from(storefrontForms).where(eq(storefrontForms.id, contactId));
    const listed = ((await erp.get('/api/storefront/forms')).body.data as Body[]).some(row => row.id === contactId);
    const [removeAudit] = await auditRows(contactId);
    const reused = await erp.post('/api/storefront/forms', { title: `تماس دوباره ${tag}`, key: keyOf('contact'), template: null });
    if (removals !== '400/409/200/404/404' || gone?.isDeleted !== 1 || gone.enabled !== 0 || listed || removeAudit?.action !== 'DELETE' || (removeAudit.details as Body | null)?.wasOnSite !== true || reused.status !== 201) {
      wrong.push(`removing a form: ${removals}, row ${String(gone?.isDeleted)}/${String(gone?.enabled)}, still listed ${listed}, audit ${String(removeAudit?.action)}, its key again ${reused.status}`);
    }

    // 6) the cap on how many forms a shop has
    const [{ live }] = await orm.select({ live: sql<number>`count(*)::int` }).from(storefrontForms).where(eq(storefrontForms.isDeleted, 0));
    if (live < FORMS_MAX) await orm.insert(storefrontForms).values(Array.from({ length: FORMS_MAX - live }, (_, i) => ({ key: keyOf(`fill${i}`), title: `پرکننده ${i} ${tag}` })));
    const over = await erp.post('/api/storefront/forms', { title: 'یکی بیشتر', key: keyOf('over'), template: null });
    if (over.status !== 422 || over.body.code !== 'STOREFRONT_FORM_TOO_MANY') wrong.push(`one form more than the cap: ${over.status} ${String(over.body.code)}`);

    // 7) the rules of migration 0037 hold against a direct write
    const direct: Array<[string, () => Promise<unknown>]> = [
      ['a key of another shape', () => orm.update(storefrontForms).set({ key: 'Bad Key' }).where(eq(storefrontForms.id, formId))],
      ['fields that are no list', () => orm.update(storefrontForms).set({ fields: {} as never }).where(eq(storefrontForms.id, formId))],
      ['more fields than a form takes', () => orm.update(storefrontForms).set({ fields: Array.from({ length: FORM_FIELDS_MAX + 1 }, () => ({})) as never }).where(eq(storefrontForms.id, formId))],
      ['a switch that is neither on nor off', () => orm.update(storefrontForms).set({ enabled: 2 }).where(eq(storefrontForms.id, formId))],
      ['a sales lead flag that is neither', () => orm.update(storefrontForms).set({ makesLead: 2 }).where(eq(storefrontForms.id, formId))],
      ['an empty form on the site', () => orm.update(storefrontForms).set({ enabled: 1 }).where(eq(storefrontForms.id, emptyId)).then(() => orm.update(storefrontForms).set({ fields: [] }).where(eq(storefrontForms.id, emptyId)))],
      ['a removed form on the site', () => orm.update(storefrontForms).set({ enabled: 1 }).where(eq(storefrontForms.id, contactId))],
      ['a second live form by one key', () => orm.insert(storefrontForms).values({ key: keyOf('moved'), title: 'دومی' })],
      ['a title with a line break', () => orm.update(storefrontForms).set({ title: 'یک\nدو' }).where(eq(storefrontForms.id, formId))],
    ];
    for (const [what, write] of direct) {
      const refused = await write().then(() => false, () => true);
      if (!refused) wrong.push(`a direct write of ${what} was taken`);
    }

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: ((told: string) => (wrong.length > 0 && told !== wrong.join('; ') ? `${wrong.join('; ')}; ${told}` : told))(err instanceof Error ? err.message : String(err)),
    }));
  } finally {
    await orm.delete(storefrontForms).where(like(storefrontForms.key, `%-${tag}`)).catch(() => undefined);
  }
  return results;
}
