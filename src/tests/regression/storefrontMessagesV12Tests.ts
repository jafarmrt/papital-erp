import request from 'supertest';
import { and, desc, eq, inArray, like, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, appSettings, crmActivities, crmLeadStageHistory, crmLeads, notifications, storefrontForms, storefrontMessages } from '../../db/schema.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { readPricingStrategies } from '../../lib/items/pricingStrategies.js';
import { MESSAGES_HOURLY_CAP, MESSAGES_PER_VISITOR_HOUR, MESSAGE_TRIES_PER_MINUTE, messagesWarnAt } from '../../lib/storefront/storefrontMessageRules.js';
import { formStampOf } from '../../services/storefront/storefrontFormStamp.js';

/**
 * v12 phase 10f, part 2 (migration 0038, docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2 «۱۰و»): «پیام‌های سایت» on real
 * Express routes and PostgreSQL. The site sends a visitor's answers to a form that is on the site
 * (`POST /api/storefront/v1/forms/:key/submit`): each answer is checked against its field and kept as plain text with
 * the field's name; a repeat of the same request answers the same message; a form that is off, removed or unknown
 * takes none; the site as a whole sends a bounded number an hour, with one bell before it is full. The holders of
 * `site_messages.view` get a bell that carries nothing of the message, and read the messages; `site_messages.manage`
 * sets a status and removes, under the message's version; the keys of the site's content open none of it. No audit
 * row and no notification holds what a visitor wrote. A form whose «پروندهٔ فروش هم بساز» is on also opens a sales lead.
 * The CHECK constraints of migration 0038 hold against a direct write.
 */
interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;

export async function runStorefrontMessagesV12Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_messages_v12_p10f';
  if (!shouldRun(id, 'v12', 'phase10', 'storefront', 'forms', 'messages', 'migration', 'security')) return results;

  const name = 'v12 phase 10f: a visitor\'s answers to a form on the site become a message read and handled only with its own keys, checked field by field, bounded an hour, and never copied into a bell or the audit log';
  const tStart = Date.now();
  const wrong: string[] = [];
  const tag = String(Date.now()).slice(-7);
  const keyOf = (word: string) => `${word}-${tag}`;
  const SECRET_NAME = `نام‌خانوادگی‌محرمانه${tag}`;
  const SECRET_WORDS = `متن‌محرمانهٔ پیام ${tag}`;
  const leadIds: number[] = [];
  const savedSettings = await orm.select().from(appSettings).where(like(appSettings.key, 'sf\\_%'));
  const savedStrategies = await orm.select().from(appSettings).where(eq(appSettings.key, 'pricing_strategies'));
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
    const userWith = async (...permissions: string[]) => {
      const user = await createTestUser({ role: (await createTestRole({ permissions })).code });
      return { id: user.id, ...as(await loginTestUserWithSession(app, user.username)) };
    };
    const keys = (value: unknown) => Object.keys((value ?? {}) as Body).sort().join(',');

    // the site on, with its key
    const retailList = `تکی پیام ${tag}`;
    const current = readPricingStrategies(savedStrategies[0]?.value);
    const strategies = 'titles' in current ? current.titles : [];
    await orm.insert(appSettings).values({ key: 'pricing_strategies', value: JSON.stringify([...strategies, retailList]) })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify([...strategies, retailList]) } });
    invalidateSettingsCache();
    const base = (await erp.get('/api/storefront/settings')).body.data;
    const shop = (enabled: boolean, version: number): Body => ({
      cardNumber: '', cardHolder: '', bankName: '', iban: '', freeShippingThreshold: '', reservationHours: 24, retailPriceList: retailList,
      wholesalePriceList: '', lowStockThreshold: 3, stockDisplay: 'status', warehouseCode: '', whatsappNumber: '', whatsappEnabled: false,
      enabled, ordersEnabled: false, treasuryAccountId: 0, openOrdersPerPhone: 3, version,
    });
    const on = await erp.put('/api/storefront/settings', shop(true, base.version));
    if (on.status !== 200) throw new Error(`turning the site on: ${on.status} ${JSON.stringify(on.body)}`);
    const apiKey = String((await erp.post('/api/storefront/api-key')).body.data?.apiKey ?? '');
    let n = 0;
    const requestKey = () => `req-${tag}-${String(++n).padStart(8, '0')}`;
    // each request as another visitor (the route is limited per visitor address, a few a minute)
    let visitor = 0;
    const submit = (key: string, answers: unknown, over: Body = {}) => request(app).post(`/api/storefront/v1/forms/${key}/submit`).set('Authorization', `Bearer ${apiKey}`)
      .set('X-Storefront-Client-IP', `10.77.${Math.floor(++visitor / 250)}.${(visitor % 250) + 1}`).send({ requestKey: requestKey(), formStamp, answers, ...over });

    // a form with one field of each kind, on the site
    const made = await erp.post('/api/storefront/forms', { title: `فرم پیام ${tag}`, key: keyOf('all'), template: null });
    const formId = Number(made.body.data?.id);
    const fields = [
      { id: 'f1', kind: 'shortText', label: 'نام', required: true, help: '', options: [] },
      { id: 'f2', kind: 'mobile', label: 'همراه', required: false, help: '', options: [] },
      { id: 'f3', kind: 'email', label: 'ایمیل', required: false, help: '', options: [] },
      { id: 'f4', kind: 'number', label: 'تعداد', required: false, help: '', options: [] },
      { id: 'f5', kind: 'choice', label: 'موضوع', required: false, help: '', options: ['فروش', 'پشتیبانی'] },
      { id: 'f6', kind: 'choices', label: 'علاقه', required: false, help: '', options: ['گردنبند', 'گوشواره', 'ست'] },
      { id: 'f7', kind: 'date', label: 'روز', required: false, help: '', options: [] },
      { id: 'f8', kind: 'longText', label: 'پیام', required: false, help: '', options: [] },
      { id: 'f9', kind: 'consent', label: 'قوانین را می‌پذیرم', required: true, help: '', options: [] },
    ];
    const saved = await erp.put(`/api/storefront/forms/${formId}`, { key: keyOf('all'), title: `فرم پیام ${tag}`, intro: '', fields, submitLabel: '', successMessage: '', version: 1 });
    if (saved.status !== 200) throw new Error(`saving the form: ${saved.status} ${JSON.stringify(saved.body)}`);

    // the stamp of the form a visitor filled in, as the site read it with the form
    const stampOf = async (id: number) => formStampOf((await orm.select().from(storefrontForms).where(eq(storefrontForms.id, id)))[0]);
    let formStamp = await stampOf(formId);
    // 1) a form that is off, removed or unknown takes no answer; nor a request without the site's key
    const offForm = await submit(keyOf('all'), { f1: 'نام', f9: true });
    const turnedOn = await erp.put(`/api/storefront/forms/${formId}/enabled`, { enabled: true, version: 2 });
    // putting the form on the site changes no field: the stamp a visitor's page carries stays good
    if (await stampOf(formId) !== formStamp || !/^[0-9a-f]{32}$/.test(formStamp)) wrong.push(`the stamp of a form turned on: ${formStamp} -> ${await stampOf(formId)}`);
    const closed = [
      `${offForm.status}:${String(offForm.body.code)}`, `${(await submit(keyOf('nobody'), { f1: 'x' })).status}`, `${(await submit('Bad Key', { f1: 'x' })).status}`,
      `${(await request(app).post(`/api/storefront/v1/forms/${keyOf('all')}/submit`).send({ requestKey: requestKey(), formStamp, answers: { f1: 'x', f9: true } })).status}`,
    ].join(' ');
    if (turnedOn.status !== 200 || closed !== '404:STOREFRONT_FORM_NOT_FOUND 404 400 401') wrong.push(`a form that is off, unknown, misnamed, and a request without the key: ${turnedOn.status} ${closed}`);

    // 2) each answer is checked against its field
    const good: Body = { f1: `  ${SECRET_NAME}  `, f2: '۰۹۱۲ ۳۴۵ ۶۷۸۹', f3: ' Buyer@Example.COM ', f4: '۱٬۲۵۰', f5: 'پشتیبانی', f6: ['ست', 'گردنبند'], f7: '۱۴۰۵/۰۹/۰۳', f8: `${SECRET_WORDS}\r\n\r\n\r\n<script>alert(1)</script>`, f9: true };
    const refusals: Array<[string, Body, string]> = [
      ['a required field left empty', { ...good, f1: '   ' }, 'STOREFRONT_MESSAGE_FIELD_REQUIRED'],
      ['a required field with nothing that can be seen', { ...good, f1: String.fromCharCode(0x200b, 0x200c, 0xad, 0x2800, 0x3164) }, 'STOREFRONT_MESSAGE_FIELD_REQUIRED'],
      ['a required tick not ticked', { ...good, f9: false }, 'STOREFRONT_MESSAGE_FIELD_REQUIRED'],
      ['a field the form does not have', { ...good, f10: 'x' }, 'STOREFRONT_MESSAGE_FORM_CHANGED'],
      ['a mobile number that is none', { ...good, f2: '12345' }, 'STOREFRONT_MESSAGE_FIELD_INVALID'],
      ['an email that is none', { ...good, f3: 'buyer@' }, 'STOREFRONT_MESSAGE_FIELD_INVALID'],
      ['a number with letters', { ...good, f4: '12a' }, 'STOREFRONT_MESSAGE_FIELD_INVALID'],
      ['a choice the form does not offer', { ...good, f5: 'دیگر' }, 'STOREFRONT_MESSAGE_FIELD_INVALID'],
      ['one of several choices the form does not offer', { ...good, f6: ['ست', 'انگشتر'] }, 'STOREFRONT_MESSAGE_FIELD_INVALID'],
      ['a day that is none', { ...good, f7: '۱۴۰۵/۱۳/۴۰' }, 'STOREFRONT_MESSAGE_FIELD_INVALID'],
      ['a hidden character in a text', { ...good, f8: `متن${String.fromCharCode(0x202e)}` }, 'STOREFRONT_MESSAGE_FIELD_INVALID'],
      ['a short text too long', { ...good, f1: 'ن'.repeat(201) }, 'STOREFRONT_MESSAGE_FIELD_INVALID'],
      ['a long text too long', { ...good, f8: 'پ'.repeat(2001) }, 'STOREFRONT_MESSAGE_FIELD_INVALID'],
      ['a list where one line is taken', { ...good, f1: ['نام'] }, 'STOREFRONT_MESSAGE_FIELD_INVALID'],
      ['a tick that is a text', { ...good, f9: 'yes' }, 'STOREFRONT_MESSAGE_FIELD_INVALID'],
    ];
    for (const [what, answers, code] of refusals) {
      const res = await submit(keyOf('all'), answers);
      if (res.status !== 422 || res.body.code !== code) wrong.push(`${what}: ${res.status} ${String(res.body.code)}`);
    }
    const shapes = [
      (await submit(keyOf('all'), 'text')).status, (await submit(keyOf('all'), { f1: { nested: 'x' } })).status, (await submit(keyOf('all'), good, { requestKey: 'short' })).status,
      (await submit(keyOf('all'), good, { extra: 1 })).status, (await submit(keyOf('all'), { ...good, f8: 'پ'.repeat(9000) })).status, (await submit(keyOf('all'), good, { formStamp: undefined })).status,
      (await submit(keyOf('all'), good, { formStamp: 7 })).status, (await submit(keyOf('all'), good, { formStamp: 'not-a-stamp' })).status,
    ].join('/');
    // answers written for another form, or for this one with other fields, are never read by this one's fields
    const otherVersion = await submit(keyOf('all'), good, { formStamp: '0'.repeat(32) });
    if (otherVersion.status !== 422 || otherVersion.body.code !== 'STOREFRONT_MESSAGE_FORM_CHANGED') wrong.push(`answers for another version of the form: ${otherVersion.status} ${String(otherVersion.body.code)}`);
    if (shapes !== '400/400/422/400/400/400/400/400') wrong.push(`requests of another shape: ${shapes}`);
    const [{ none }] = await orm.select({ none: sql<number>`count(*)::int` }).from(storefrontMessages).where(eq(storefrontMessages.formId, formId));
    if (none !== 0) wrong.push(`a refused request left ${none} message(s)`);

    // 3) a good message: kept as plain text under each field's name; a repeat answers the same message
    const viewer = await userWith('site_messages.view');
    const handler = await userWith('site_messages.view', 'site_messages.manage');
    const editor = await userWith('site_content.view', 'site_content.manage', 'storefront.view', 'storefront.manage');
    const salesHolder = await userWith('crm.view', 'crm.manage');
    const sameKey = requestKey();
    const sent = await submit(keyOf('all'), good, { requestKey: sameKey });
    const messageId = Number(sent.body.data?.reference);
    const again = await submit(keyOf('all'), good, { requestKey: sameKey });
    const reused = await submit(keyOf('all'), { ...good, f1: 'کس دیگر' }, { requestKey: sameKey });
    if (sent.status !== 201 || keys(sent.body.data) !== 'reference' || !(messageId > 0) || again.status !== 201 || again.body.data?.reference !== sent.body.data?.reference
      || reused.status !== 422 || reused.body.code !== 'STOREFRONT_REQUEST_KEY_REUSED') {
      wrong.push(`a message, its repeat and its key for another message: ${sent.status} ${JSON.stringify(sent.body)} / ${again.status} / ${reused.status} ${String(reused.body.code)}`);
    }
    // the same request arriving several times at once makes one message, and each is answered with it
    const racedKey = requestKey();
    const raced = await Promise.all(Array.from({ length: 5 }, () => submit(keyOf('all'), { f1: 'هم‌زمان', f9: true }, { requestKey: racedKey })));
    const [{ racedRows }] = await orm.select({ racedRows: sql<number>`count(*)::int` }).from(storefrontMessages).where(eq(storefrontMessages.requestKey, racedKey));
    if (raced.some(res => res.status !== 201 || res.body.data?.reference !== raced[0].body.data?.reference) || racedRows !== 1) wrong.push(`one request arriving five times at once: ${raced.map(res => `${res.status}:${String(res.body.data?.reference)}`).join(',')}, rows ${racedRows}`);
    const read = await viewer.get(`/api/storefront/messages/${messageId}`);
    const message = (read.body.data ?? {}) as Body & { answers?: Array<{ label: string; kind: string; value: string }> };
    const values = (message.answers ?? []).map(a => `${a.label}=${a.value}`).join('|');
    const expected = `نام=${SECRET_NAME}|همراه=09123456789|ایمیل=Buyer@example.com|تعداد=1250|موضوع=پشتیبانی|علاقه=گردنبند\nست|روز=2026-11-24|پیام=${SECRET_WORDS}\n\n<script>alert(1)</script>|قوانین را می‌پذیرم=پذیرفته شد`;
    if (read.status !== 200 || keys(message) !== 'answers,createdAt,formId,formTitle,id,leadId,status,statusAt,statusBy,version' || values !== expected || message.status !== 'new' || message.leadId !== null || message.version !== 1) {
      wrong.push(`the message as it is read: ${read.status} ${JSON.stringify(read.body).slice(0, 600)}`);
    }
    // a long text of quotes and line breaks is as long as the rules count it, not as its JSON is (review of #505, L4)
    const quotes = await submit(keyOf('all'), { f1: 'نقل', f8: '"\\\n'.repeat(660), f9: true });
    if (quotes.status !== 201) wrong.push(`a long text of quotes and line breaks: ${quotes.status} ${String(quotes.body.code)}`);
    // only the answers that are optional may be left out
    const short = await submit(keyOf('all'), { f1: 'کوتاه', f9: 'on' });
    const shortRead = (await viewer.get(`/api/storefront/messages/${Number(short.body.data?.reference)}`)).body.data as { answers?: Array<{ value: string }> } | undefined;
    if (short.status !== 201 || (shortRead?.answers ?? []).map(a => a.value).join('|') !== 'کوتاه||||||||پذیرفته شد') wrong.push(`a message with its optional fields empty: ${short.status} ${JSON.stringify(shortRead?.answers)}`);

    // 4) the bell and the audit row say that a message came, never what it says
    const bells = await orm.select().from(notifications).where(eq(notifications.link, `/site-messages?message=${messageId}`));
    const told = new Set(bells.map(b => b.userId));
    const audits = await orm.select().from(activityLogs).where(and(eq(activityLogs.entity, 'پیام سایت'), eq(activityLogs.entityId, `message-${messageId}`)));
    const leaked = JSON.stringify([bells, audits]);
    if (!told.has(viewer.id) || !told.has(handler.id) || told.has(editor.id) || bells.some(b => b.title !== 'پیام تازه از فرم سایت') || audits.length !== 1 || audits[0].action !== 'CREATE'
      || [SECRET_NAME, SECRET_WORDS, '09123456789', 'example.com'].some(secret => leaked.includes(secret))) {
      wrong.push(`the bell and the audit row of a message: bells to ${[...told].join(',')} (viewer ${viewer.id}, handler ${handler.id}, editor ${editor.id}), audit rows ${audits.length}, carrying the message ${[SECRET_NAME, SECRET_WORDS, '09123456789'].filter(secret => leaked.includes(secret)).join(',')}`);
    }

    // 5) who may: the view key reads; the manage key handles; the keys of the site's content and shop open nothing
    const access = [
      (await viewer.get('/api/storefront/messages')).status, (await viewer.put(`/api/storefront/messages/${messageId}/status`, { status: 'seen', version: 1 })).status,
      (await viewer.del(`/api/storefront/messages/${messageId}?version=1`)).status, (await editor.get('/api/storefront/messages')).status, (await editor.get(`/api/storefront/messages/${messageId}`)).status,
      (await editor.put(`/api/storefront/messages/${messageId}/status`, { status: 'seen', version: 1 })).status, (await request(app).get('/api/storefront/messages')).status,
      (await erp.get('/api/storefront/messages/2000000000')).status, (await erp.get('/api/storefront/messages?status=lost')).status,
    ].join('/');
    if (access !== '200/403/403/403/403/403/401/404/400') wrong.push(`who may read and handle the messages: ${access}`);
    const list = (await viewer.get('/api/storefront/messages?status=new')).body as Body & { data?: Body[]; counts?: Record<string, number> };
    const mine = (list.data ?? []).find(row => row.id === messageId);
    if (keys(list) !== 'counts,data,page,pageSize,total' || keys(mine) !== 'createdAt,formId,formTitle,id,preview,status,version' || !String(mine?.preview).startsWith(SECRET_NAME) || !((list.counts?.new ?? 0) >= 2)) {
      wrong.push(`the list of new messages: ${JSON.stringify(list).slice(0, 400)}`);
    }

    // 6) a status is the state to take, under the message's version; a repeat changes nothing
    const seen = await handler.put(`/api/storefront/messages/${messageId}/status`, { status: 'seen', version: 1 });
    const seenAgain = await handler.put(`/api/storefront/messages/${messageId}/status`, { status: 'seen', version: 2 });
    const staleStatus = await handler.put(`/api/storefront/messages/${messageId}/status`, { status: 'answered', version: 1 });
    const answered = await handler.put(`/api/storefront/messages/${messageId}/status`, { status: 'answered', version: 2 });
    const back = await handler.put(`/api/storefront/messages/${messageId}/status`, { status: 'new', version: 3 });
    const statusAudits = (await orm.select().from(activityLogs).where(and(eq(activityLogs.entity, 'پیام سایت'), eq(activityLogs.entityId, `message-${messageId}`))).orderBy(desc(activityLogs.id))).filter(row => row.action === 'UPDATE');
    if (seen.body.data?.status !== 'seen' || seen.body.data?.version !== 2 || !seen.body.data?.statusBy || !seen.body.data?.statusAt || seenAgain.body.data?.version !== 2
      || staleStatus.status !== 409 || staleStatus.body.code !== 'OCC_CONFLICT' || answered.body.data?.status !== 'answered' || back.body.data?.status !== 'new' || back.body.data?.statusBy !== '' || back.body.data?.statusAt !== ''
      || statusAudits.length !== 3 || JSON.stringify(statusAudits.map(row => row.details)).includes(SECRET_NAME)) {
      wrong.push(`the states of a message: seen ${seen.status} v${String(seen.body.data?.version)}, again v${String(seenAgain.body.data?.version)}, stale ${staleStatus.status}, answered ${String(answered.body.data?.status)}, back ${JSON.stringify(back.body.data).slice(0, 200)}, audit rows ${statusAudits.length}`);
    }

    // 7) «پروندهٔ فروش هم بساز»: a message of that form also opens a sales lead with the source of the site
    const formNow = Number((await erp.get(`/api/storefront/forms/${formId}`)).body.data?.version);
    const leadOn = await erp.put(`/api/storefront/forms/${formId}/makes-lead`, { enabled: true, version: formNow });
    const leadOnAgain = await erp.put(`/api/storefront/forms/${formId}/makes-lead`, { enabled: true, version: formNow + 1 });
    const viewerSwitch = await viewer.put(`/api/storefront/forms/${formId}/makes-lead`, { enabled: false, version: formNow + 1 });
    const withLead = await submit(keyOf('all'), { f1: `خریدار ${tag}`, f2: '09121112233', f8: 'می‌خواهم سفارش بدهم', f9: true });
    const leadMessage = (await viewer.get(`/api/storefront/messages/${Number(withLead.body.data?.reference)}`)).body.data as { leadId?: number | null } | undefined;
    const leadId = Number(leadMessage?.leadId);
    if (leadId > 0) leadIds.push(leadId);
    const [lead] = leadId > 0 ? await orm.select().from(crmLeads).where(eq(crmLeads.id, leadId)) : [];
    // the switch changed no field, so the page a visitor already had open still sends (review of #505, L2); the holders
    // of the sales files hear of the lead by the form's name, never by the visitor's
    const leadBells = leadId > 0 ? await orm.select().from(notifications).where(eq(notifications.link, `/crm?leadId=${leadId}`)) : [];
    if (await stampOf(formId) !== formStamp || leadBells.length === 0 || leadBells.some(b => b.title !== `پروندهٔ فروش تازه از فرم سایت «فرم پیام ${tag}»`) || JSON.stringify(leadBells).includes(`خریدار ${tag}`)
      || !leadBells.some(b => b.userId === salesHolder.id) || leadBells.some(b => b.userId === viewer.id)) {
      wrong.push(`the bell of a lead a form opened: ${JSON.stringify(leadBells.map(b => [b.userId, b.title]))} (sales holder ${salesHolder.id}), stamp ${formStamp} -> ${await stampOf(formId)}`);
    }
    if (leadOn.body.data?.makesLead !== true || leadOnAgain.body.data?.version !== formNow + 1 || viewerSwitch.status !== 403 || withLead.status !== 201 || !lead || lead.source !== 'وبسایت' || lead.customerName !== `خریدار ${tag}`
      || lead.phone !== '09121112233' || lead.title !== `پیام سایت: فرم پیام ${tag}` || !String(lead.notes).includes('پیام: می‌خواهم سفارش بدهم') || lead.stage !== 'lead') {
      wrong.push(`a message that opens a sales lead: switch ${leadOn.status} ${String(leadOn.body.data?.makesLead)}, again v${String(leadOnAgain.body.data?.version)}, viewer ${viewerSwitch.status}, message ${withLead.status}, lead ${JSON.stringify(lead ?? null).slice(0, 300)}`);
    }

    // a write the database refuses keeps nothing and answers without the query that failed, whose text holds what the
    // visitor wrote (review of #505, L3): here the lead's own table refuses one name
    const probe = `chk_probe_${tag}`;
    await orm.execute(sql.raw(`ALTER TABLE crm_leads ADD CONSTRAINT ${probe} CHECK (customer_name <> 'probe-${tag}') NOT VALID`));
    const refusedWrite = await submit(keyOf('all'), { f1: `probe-${tag}`, f2: '09125550011', f8: SECRET_WORDS, f9: true });
    await orm.execute(sql.raw(`ALTER TABLE crm_leads DROP CONSTRAINT ${probe}`));
    const [{ kept }] = await orm.select({ kept: sql<number>`count(*)::int` }).from(storefrontMessages).where(sql`${storefrontMessages.answers}::text like ${`%probe-${tag}%`}`);
    const refusedBody = JSON.stringify(refusedWrite.body);
    if (refusedWrite.status !== 500 || refusedWrite.body.code !== 'STOREFRONT_MESSAGE_WRITE_FAILED' || kept !== 0 || [`probe-${tag}`, '09125550011', SECRET_WORDS, 'insert into', 'params'].some(part => refusedBody.includes(part))) {
      wrong.push(`a write the database refused: ${refusedWrite.status} ${refusedBody.slice(0, 300)}, rows kept ${kept}`);
    }

    // the switch off again: the messages below open no lead
    const leadOff = await erp.put(`/api/storefront/forms/${formId}/makes-lead`, { enabled: false, version: formNow + 1 });
    if (leadOff.body.data?.makesLead !== false) wrong.push(`turning the sales lead off: ${leadOff.status}`);

    // 8) a form changed while a visitor wrote, and a form taken off the site, take no answer; the message already made stays as it was
    const formV = Number((await erp.get(`/api/storefront/forms/${formId}`)).body.data?.version);
    await erp.put(`/api/storefront/forms/${formId}`, { key: keyOf('all'), title: `فرم پیام تازه ${tag}`, intro: '', fields: fields.filter(f => f.id !== 'f8').map(f => (f.id === 'f1' ? { ...f, label: 'نام شما' } : f)), submitLabel: '', successMessage: '', version: formV });
    const firstStamp = formStamp;
    formStamp = await stampOf(formId);
    const oldShape = await submit(keyOf('all'), good, { formStamp: firstStamp });
    // a repeat of a request that was taken answers its message, though the form has changed since (review of #505, M3)
    const repeatAfterChange = await submit(keyOf('all'), good, { requestKey: sameKey, formStamp: firstStamp });
    // a visitor who opens the form again fills in the form as it is now: its fields, under its stamp
    const newShape = await submit(keyOf('all'), { f1: 'نام تازه', f9: true });
    const newRead = (await viewer.get(`/api/storefront/messages/${Number(newShape.body.data?.reference)}`)).body.data as { formTitle?: string; answers?: Array<{ label: string }> } | undefined;
    if (newShape.status !== 201 || newRead?.formTitle !== `فرم پیام تازه ${tag}` || newRead.answers?.[0]?.label !== 'نام شما' || newRead.answers.length !== 8) wrong.push(`a message of the changed form: ${newShape.status} ${JSON.stringify(newRead).slice(0, 200)}`);
    const stillOld = (await viewer.get(`/api/storefront/messages/${messageId}`)).body.data as { formTitle?: string; answers?: Array<{ label: string }> } | undefined;
    await erp.put(`/api/storefront/forms/${formId}/enabled`, { enabled: false, version: formV + 1 });
    const afterOff = await submit(keyOf('all'), { f1: 'نام', f9: true });
    const repeatWhileOff = await submit(keyOf('all'), good, { requestKey: sameKey, formStamp: firstStamp });
    await erp.put(`/api/storefront/forms/${formId}/enabled`, { enabled: true, version: formV + 2 });
    const siteOff = await erp.put('/api/storefront/settings', shop(false, on.body.data.version));
    const whileSiteOff = await submit(keyOf('all'), { f1: 'نام', f9: true });
    await erp.put('/api/storefront/settings', shop(true, siteOff.body.data?.version));
    if (firstStamp === formStamp || repeatAfterChange.status !== 201 || repeatAfterChange.body.data?.reference !== sent.body.data?.reference || repeatWhileOff.status !== 201 || repeatWhileOff.body.data?.reference !== sent.body.data?.reference) {
      wrong.push(`a repeat of a taken request after the form changed and while it is off: stamp ${firstStamp} -> ${formStamp}, ${repeatAfterChange.status} ${JSON.stringify(repeatAfterChange.body).slice(0, 120)}, ${repeatWhileOff.status}`);
    }
    if (oldShape.status !== 422 || oldShape.body.code !== 'STOREFRONT_MESSAGE_FORM_CHANGED' || stillOld?.formTitle !== `فرم پیام ${tag}` || stillOld.answers?.[0]?.label !== 'نام' || afterOff.status !== 404 || whileSiteOff.status !== 404) {
      wrong.push(`a form changed, a form off and the site off: ${oldShape.status} ${String(oldShape.body.code)}, the old message «${String(stillOld?.formTitle)}», off ${afterOff.status}, site off ${whileSiteOff.status}`);
    }

    // 9) removal: under the version, soft, read nowhere after; the lead it opened stays
    const leadMessageId = Number(withLead.body.data?.reference);
    const countsOf = async () => { const body = (await viewer.get('/api/storefront/messages')).body as { total?: number; counts?: Record<string, number> }; return `${String(body.total)}:${String(body.counts?.new)}`; };
    const [totalBefore, newBefore] = (await countsOf()).split(':').map(Number);
    const removal = [
      (await handler.del(`/api/storefront/messages/${leadMessageId}`)).status, (await handler.del(`/api/storefront/messages/${leadMessageId}?version=7`)).status,
      (await handler.del(`/api/storefront/messages/${leadMessageId}?version=1`)).status, (await viewer.get(`/api/storefront/messages/${leadMessageId}`)).status,
      (await handler.put(`/api/storefront/messages/${leadMessageId}/status`, { status: 'seen', version: 2 })).status,
    ].join('/');
    const [removed] = await orm.select().from(storefrontMessages).where(eq(storefrontMessages.id, leadMessageId));
    const stillListed = (((await viewer.get('/api/storefront/messages')).body.data ?? []) as Body[]).some(row => row.id === leadMessageId);
    const [leadKept] = leadId > 0 ? await orm.select({ isDeleted: crmLeads.isDeleted }).from(crmLeads).where(eq(crmLeads.id, leadId)) : [];
    // a removed message is counted nowhere
    if (await countsOf() !== `${totalBefore - 1}:${newBefore - 1}`) wrong.push(`the counts after a removal: ${totalBefore}:${newBefore} -> ${await countsOf()}`);
    if (removal !== '400/409/200/404/404' || removed?.isDeleted !== 1 || stillListed || leadKept?.isDeleted !== 0) wrong.push(`removing a message: ${removal}, row ${String(removed?.isDeleted)}, still listed ${stillListed}, its lead ${String(leadKept?.isDeleted)}`);

    // 9b) a form made again under a freed key is another form: answers written for the old one are not read by its
    //     fields, whatever the two versions are (review of #505, M1)
    const twinKey = keyOf('twin');
    const formOf = async (label: string) => {
      const created = await erp.post('/api/storefront/forms', { title: `فرم دوقلو ${tag}`, key: twinKey, template: null });
      const id = Number(created.body.data?.id);
      const kept = await erp.put(`/api/storefront/forms/${id}`, { key: twinKey, title: `فرم دوقلو ${tag}`, intro: '', fields: [{ id: 'f1', kind: 'shortText', label, required: true, help: '', options: [] }], submitLabel: '', successMessage: '', version: 1 });
      const live = await erp.put(`/api/storefront/forms/${id}/enabled`, { enabled: true, version: Number(kept.body.data?.version) });
      return { id, version: Number(live.body.data?.version), stamp: await stampOf(id) };
    };
    const oldTwin = await formOf('نام شما');
    const removedTwin = await erp.del(`/api/storefront/forms/${oldTwin.id}?version=${oldTwin.version}`);
    const newTwin = await formOf('کد تخفیف');
    const forOld = await submit(twinKey, { f1: 'زهرا احمدی' }, { formStamp: oldTwin.stamp });
    const forNew = await submit(twinKey, { f1: 'YALDA' }, { formStamp: newTwin.stamp });
    const [{ twinRows }] = await orm.select({ twinRows: sql<number>`count(*)::int` }).from(storefrontMessages).where(eq(storefrontMessages.formId, newTwin.id));
    if (removedTwin.status !== 200 || oldTwin.version !== newTwin.version || oldTwin.stamp === newTwin.stamp || forOld.status !== 422 || forOld.body.code !== 'STOREFRONT_MESSAGE_FORM_CHANGED' || forNew.status !== 201 || twinRows !== 1) {
      wrong.push(`a form made again under the same key: removal ${removedTwin.status}, versions ${oldTwin.version}/${newTwin.version}, stamps ${oldTwin.stamp}/${newTwin.stamp}, an answer for the old form ${forOld.status} ${String(forOld.body.code)}, for the new ${forNew.status}, rows ${twinRows}`);
    }

    // 9c) one visitor address: refused sends do not count, a few messages an hour are taken, then «too many», while
    //     another visitor still sends (review of #505, M2); the address has a count of its own, apart from sign-in's
    const one = '10.99.0.7';
    const from = (address: string, answers: unknown) => request(app).post(`/api/storefront/v1/forms/${keyOf('all')}/submit`).set('Authorization', `Bearer ${apiKey}`)
      .set('X-Storefront-Client-IP', address).send({ requestKey: requestKey(), formStamp, answers });
    const tries: number[] = [];
    for (let i = 0; i < 3; i++) tries.push((await from(one, { f1: '', f9: true })).status);
    for (let i = 0; i < MESSAGES_PER_VISITOR_HOUR; i++) tries.push((await from(one, { f1: `یک نشانی ${i}`, f9: true })).status);
    const overHour = await from(one, { f1: 'یکی بیشتر', f9: true });
    const otherVisitor = await from('10.99.0.8', { f1: 'بازدیدکنندهٔ دیگر', f9: true });
    const signIn = await request(app).post('/api/storefront/v1/auth/login').set('Authorization', `Bearer ${apiKey}`).set('X-Storefront-Client-IP', one).send({ contact: '09120000000', password: 'x' });
    if (tries.join(',') !== [...Array(3).fill(422), ...Array(MESSAGES_PER_VISITOR_HOUR).fill(201)].join(',') || overHour.status !== 429 || otherVisitor.status !== 201 || signIn.status === 429
      || !(MESSAGES_PER_VISITOR_HOUR + 3 < MESSAGE_TRIES_PER_MINUTE) || !(MESSAGES_PER_VISITOR_HOUR * 2 <= MESSAGES_HOURLY_CAP)) {
      wrong.push(`one visitor address in an hour: ${tries.join(',')}, one more ${overHour.status}, another visitor ${otherVisitor.status}, sign-in from the same address ${signIn.status}`);
    }
    // the sends one address tries in a minute, taken or not, are bounded too
    const hasty = '10.99.0.9';
    const hastyTries: number[] = [];
    for (let i = 0; i <= MESSAGE_TRIES_PER_MINUTE; i++) hastyTries.push((await from(hasty, { f1: '', f9: true })).status);
    if (hastyTries.slice(0, MESSAGE_TRIES_PER_MINUTE).some(status => status !== 422) || hastyTries[MESSAGE_TRIES_PER_MINUTE] !== 429) wrong.push(`the tries of one address in a minute: ${hastyTries.join(',')}`);

    // 10) the hour's cap for the whole site: one bell before it is full, then «try later», whatever the form
    const [{ soFar }] = await orm.select({ soFar: sql<number>`count(*)::int` }).from(storefrontMessages).where(sql`${storefrontMessages.createdAt} > now() - interval '1 hour'`);
    const fill = (count: number) => orm.insert(storefrontMessages).values(Array.from({ length: count }, (_, i) => ({
      formId, formTitle: `پرکننده ${tag}`, answers: [{ label: 'نام', kind: 'shortText' as const, value: 'پرکننده' }], requestKey: `fill-${tag}-${String(n)}-${String(i).padStart(6, '0')}`, requestHash: 'a'.repeat(64),
    })));
    const warnAt = messagesWarnAt(MESSAGES_HOURLY_CAP);
    if (soFar < warnAt - 1) await fill(warnAt - 1 - soFar);
    const busyBells = async () => (await orm.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.title, 'پیام‌های فرم‌های سایت به سقف ساعتی نزدیک است'), eq(notifications.link, '/site-messages'), eq(notifications.userId, handler.id)))).length;
    const bellsBefore = await busyBells();
    const atWarn = await submit(keyOf('all'), { f1: 'نزدیک سقف', f9: true });
    const bellsAtWarn = await busyBells();
    const pastWarn = await submit(keyOf('all'), { f1: 'پس از هشدار', f9: true });
    const bellsPastWarn = await busyBells();
    const [{ nowCount }] = await orm.select({ nowCount: sql<number>`count(*)::int` }).from(storefrontMessages).where(sql`${storefrontMessages.createdAt} > now() - interval '1 hour'`);
    // the last place of the hour is taken once, however many arrive together (review of #505, L1)
    if (nowCount < MESSAGES_HOURLY_CAP - 1) await fill(MESSAGES_HOURLY_CAP - 1 - nowCount);
    const together = await Promise.all(Array.from({ length: 6 }, (_, i) => submit(keyOf('all'), { f1: `هم‌زمان ${i}`, f9: true })));
    const [{ atCap }] = await orm.select({ atCap: sql<number>`count(*)::int` }).from(storefrontMessages).where(sql`${storefrontMessages.createdAt} > now() - interval '1 hour'`);
    if (together.filter(res => res.status === 201).length !== 1 || together.filter(res => res.status === 429 && res.body.code === 'STOREFRONT_MESSAGES_BUSY').length !== 5 || atCap !== MESSAGES_HOURLY_CAP) {
      wrong.push(`six arrivals for the hour's last place: ${together.map(res => res.status).join(',')}, in the hour ${atCap} of ${MESSAGES_HOURLY_CAP}`);
    }
    const full = await submit(keyOf('all'), { f1: 'بیش از سقف', f9: true });
    if (atWarn.status !== 201 || pastWarn.status !== 201 || bellsAtWarn !== bellsBefore + 1 || bellsPastWarn !== bellsAtWarn || full.status !== 429 || full.body.code !== 'STOREFRONT_MESSAGES_BUSY') {
      wrong.push(`the hour's cap: at the warning ${atWarn.status} (bells ${bellsBefore}→${bellsAtWarn}), after it ${pastWarn.status} (bells ${bellsPastWarn}), full ${full.status} ${String(full.body.code)}`);
    }

    // 11) the rules of migration 0038 hold against a direct write
    const row = (over: Body = {}) => ({ formId, formTitle: 'مستقیم', answers: [{ label: 'نام', kind: 'shortText' as const, value: 'x' }], requestKey: `direct-${tag}-${String(++n).padStart(8, '0')}`, requestHash: 'b'.repeat(64), ...over });
    const direct: Array<[string, () => Promise<unknown>]> = [
      ['a status nobody knows', () => orm.insert(storefrontMessages).values(row({ status: 'archived' }) as never)],
      ['a handled message without a handler', () => orm.insert(storefrontMessages).values(row({ status: 'seen' }) as never)],
      ['a new message with a handler', () => orm.insert(storefrontMessages).values(row({ statusBy: 'someone' }) as never)],
      ['answers that are no list', () => orm.insert(storefrontMessages).values(row({ answers: {} }) as never)],
      ['a message with no answer', () => orm.insert(storefrontMessages).values(row({ answers: [] }) as never)],
      ['a request key of another shape', () => orm.insert(storefrontMessages).values(row({ requestKey: 'short key' }) as never)],
      ['a request hash of another shape', () => orm.insert(storefrontMessages).values(row({ requestHash: 'xyz' }) as never)],
      ['a request key used twice', () => orm.insert(storefrontMessages).values(row({ requestKey: sameKey }) as never)],
      ['a form that is not there', () => orm.insert(storefrontMessages).values(row({ formId: 2_000_000_000 }) as never)],
      ['a removal flag that is neither', () => orm.update(storefrontMessages).set({ isDeleted: 2 }).where(eq(storefrontMessages.id, messageId))],
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
    const mine = await orm.select({ id: storefrontForms.id }).from(storefrontForms).where(like(storefrontForms.key, `%-${tag}`)).catch(() => []);
    // the bells this run rang, so a second run within the hour on the same database starts from none
    await orm.delete(notifications).where(and(eq(notifications.senderName, 'فروشگاه سایت'), like(notifications.link, '/site-messages%'))).catch(() => undefined);
    await orm.execute(sql.raw(`ALTER TABLE crm_leads DROP CONSTRAINT IF EXISTS chk_probe_${tag}`)).catch(() => undefined);
    if (mine.length > 0) await orm.delete(storefrontMessages).where(inArray(storefrontMessages.formId, mine.map(f => f.id))).catch(() => undefined);
    if (leadIds.length > 0) {
      await orm.delete(crmActivities).where(inArray(crmActivities.leadId, leadIds)).catch(() => undefined);
      await orm.delete(crmLeadStageHistory).where(inArray(crmLeadStageHistory.leadId, leadIds)).catch(() => undefined);
      await orm.delete(crmLeads).where(inArray(crmLeads.id, leadIds)).catch(() => undefined);
    }
    await orm.delete(storefrontForms).where(like(storefrontForms.key, `%-${tag}`)).catch(() => undefined);
    await orm.delete(appSettings).where(like(appSettings.key, 'sf\\_%')).catch(() => undefined);
    if (savedSettings.length > 0) await orm.insert(appSettings).values(savedSettings).catch(() => undefined);
    if (savedStrategies.length > 0) {
      await orm.update(appSettings).set({ value: savedStrategies[0].value }).where(eq(appSettings.key, 'pricing_strategies')).catch(() => undefined);
    } else {
      await orm.delete(appSettings).where(eq(appSettings.key, 'pricing_strategies')).catch(() => undefined);
    }
    invalidateSettingsCache();
  }
  return results;
}
