import { and, desc, eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, crmLeads, customerTagLinks, customerTags, customers } from '../../db/schema.js';

type ShouldRun = (id: string, ...extra: string[]) => boolean;
type Harness = Awaited<ReturnType<typeof import('../security/workflowTestHarness.js')['createHarness']>>;

/**
 * N-02 part 3 (v10.1.23), CRM plan decision ت۱۳: customer tags. A customers.manage holder defines tags (unique live name,
 * versioned edit, soft delete, each audited in its own transaction), a party carries several tags saved in its own create
 * or edit transaction, and the party list and the sales files filter by tag. All red on v10.1.18, which had no tag routes,
 * no `tagIds` on a party and no `tagId` filter.
 */
export async function runCustomerTagsTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<{ id: string; name: string; tags: string[]; run: (h: Harness, track: Track) => Promise<string> }> = [
    { id: 'reg_customer_tags_define_n02', name: 'v10.1.23: customer tags are defined, renamed with their version and deleted only by customers.manage, names unique, each change audited (N-02)', tags: ['n02', 'crm', 'customers', 'tags'], run: defineCase },
    { id: 'reg_customer_tags_party_n02', name: 'v10.1.23: a party saves its tags with its own create and edit, an unknown tag refuses the save, and the party list filters by tag (N-02)', tags: ['n02', 'crm', 'customers', 'tags'], run: partyCase },
    { id: 'reg_crm_leads_tag_filter_n02', name: 'v10.1.23: sales files filter by the tag of their party; a malformed tag id is 400 (N-02)', tags: ['n02', 'crm', 'tags'], run: leadFilterCase },
  ];
  const selected = cases.filter(c => shouldRun(c.id, ...c.tags));
  if (selected.length === 0) return results;

  const { createHarness } = await import('../security/workflowTestHarness.js');
  const h = await createHarness();
  const track: Track = { tags: [], customers: [], leads: [] };
  try {
    for (const c of selected) {
      const tStart = Date.now();
      try {
        const details = await c.run(h, track);
        results.push(makeTestCase({ id: c.id, name: c.name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details }));
      } catch (err) {
        results.push(makeTestCase({
          id: c.id, name: c.name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    }
  } finally {
    if (track.leads.length) await orm.update(crmLeads).set({ isDeleted: 1 }).where(inArray(crmLeads.id, track.leads)).catch(() => undefined);
    if (track.customers.length) {
      await orm.delete(customerTagLinks).where(inArray(customerTagLinks.customerId, track.customers)).catch(() => undefined);
      await orm.update(customers).set({ isDeleted: 1 }).where(inArray(customers.id, track.customers)).catch(() => undefined);
    }
    if (track.tags.length) {
      await orm.delete(customerTagLinks).where(inArray(customerTagLinks.tagId, track.tags)).catch(() => undefined);
      await orm.update(customerTags).set({ isDeleted: 1 }).where(inArray(customerTags.id, track.tags)).catch(() => undefined);
    }
    await h.cleanup();
  }
  return results;
}

interface Track { tags: number[]; customers: number[]; leads: number[] }

async function newTag(h: Harness, track: Track, name: string, color = 'blue'): Promise<{ id: number; version: number }> {
  const res = await h.post('/api/customers/tags', { name, color });
  if (res.status !== 201) throw new Error(`tag create answered ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  track.tags.push(Number(res.body.id));
  return { id: Number(res.body.id), version: Number(res.body.version) };
}

async function newParty(h: Harness, track: Track, name: string, tagIds?: number[]): Promise<{ id: number; status: number; body: Record<string, unknown> }> {
  const res = await h.post('/api/customers', { name, partyType: 'customer', ...(tagIds ? { tagIds } : {}) });
  if (res.status === 200 && res.body?.id) track.customers.push(Number(res.body.id));
  return { id: Number(res.body?.id), status: res.status, body: res.body };
}

async function tagIdsOf(customerId: number): Promise<number[]> {
  const rows = await orm.select({ tagId: customerTagLinks.tagId }).from(customerTagLinks).where(eq(customerTagLinks.customerId, customerId));
  return rows.map(r => r.tagId).sort((a, b) => a - b);
}

async function lastAudit(entity: string, entityId: number, action: string) {
  const [row] = await orm.select({ details: activityLogs.details }).from(activityLogs)
    .where(and(eq(activityLogs.entity, entity), eq(activityLogs.entityId, String(entityId)), eq(activityLogs.action, action)))
    .orderBy(desc(activityLogs.id)).limit(1);
  return row?.details as { before?: Record<string, unknown>; after?: Record<string, unknown> } | undefined;
}

async function defineCase(h: Harness, track: Track): Promise<string> {
  const wrong: string[] = [];
  const reader = await h.sessionWith(['crm.view']);
  const name = `عمده‌فروش ${h.tag}`;

  const denied = await h.post('/api/customers/tags', { name: `x ${h.tag}` }, reader);
  if (denied.status !== 403) wrong.push(`crm.view create answered ${denied.status}`);

  const tag = await newTag(h, track, name, 'emerald');
  if (tag.version !== 1) wrong.push(`new tag version ${tag.version}`);
  if (!(await lastAudit('برچسب مشتری', tag.id, 'CREATE'))) wrong.push('create wrote no audit row');

  const dup = await h.post('/api/customers/tags', { name: `  ${name.toUpperCase()}  ` });
  if (dup.status !== 409 || dup.body?.code !== 'CUSTOMER_TAG_NAME_TAKEN') wrong.push(`duplicate name answered ${dup.status} ${dup.body?.code}`);
  const blank = await h.post('/api/customers/tags', { name: '   ' });
  if (blank.status !== 422) wrong.push(`blank name answered ${blank.status}`);
  const badColor = await h.post('/api/customers/tags', { name: `y ${h.tag}`, color: 'black' });
  if (badColor.status !== 400) wrong.push(`unknown color answered ${badColor.status}`);

  const list = await h.get('/api/customers/tags', reader);
  const listed = (list.body?.data ?? []) as Array<{ id: number; name: string; customerCount: number }>;
  if (list.status !== 200 || !listed.some(t => t.id === tag.id && t.name === name && t.customerCount === 0)) {
    wrong.push(`crm.view could not read the tag list (${list.status})`);
  }

  const other = await newTag(h, track, `مغازه ${h.tag}`);
  const takenRename = await h.put(`/api/customers/tags/${other.id}`, { name, version: other.version });
  if (takenRename.status !== 409) wrong.push(`rename to a taken name answered ${takenRename.status}`);
  const renamed = await h.put(`/api/customers/tags/${tag.id}`, { name: `عمده ${h.tag}`, color: 'rose', version: 1 });
  if (renamed.status !== 200 || Number(renamed.body?.version) !== 2) wrong.push(`rename answered ${renamed.status} version ${renamed.body?.version}`);
  const stale = await h.put(`/api/customers/tags/${tag.id}`, { name: `دیگر ${h.tag}`, version: 1 });
  if (stale.status !== 409) wrong.push(`stale rename answered ${stale.status}`);
  const renameAudit = await lastAudit('برچسب مشتری', tag.id, 'UPDATE');
  if (renameAudit?.before?.name !== name || renameAudit?.after?.color !== 'rose') wrong.push(`rename audit ${JSON.stringify(renameAudit).slice(0, 200)}`);

  const deniedDel = await h.del(`/api/customers/tags/${tag.id}`, reader);
  if (deniedDel.status !== 403) wrong.push(`crm.view delete answered ${deniedDel.status}`);
  const del = await h.del(`/api/customers/tags/${tag.id}`);
  if (del.status !== 200) wrong.push(`delete answered ${del.status}`);
  const after = ((await h.get('/api/customers/tags')).body?.data ?? []) as Array<{ id: number }>;
  if (after.some(t => t.id === tag.id)) wrong.push('a deleted tag is still listed');
  if (!(await lastAudit('برچسب مشتری', tag.id, 'DELETE'))) wrong.push('delete wrote no audit row');
  const reuse = await h.post('/api/customers/tags', { name });
  if (reuse.status !== 201) wrong.push(`the name of a deleted tag answered ${reuse.status}`);
  else track.tags.push(Number(reuse.body.id));

  if (wrong.length) throw new Error(wrong.join(' | '));
  return 'crm.view reads only; unique name 409, stale version 409, soft delete frees the name, every change audited';
}

async function partyCase(h: Harness, track: Track): Promise<string> {
  const wrong: string[] = [];
  const a = await newTag(h, track, `نمایشگاه ${h.tag}`);
  const b = await newTag(h, track, `فروش برخط ${h.tag}`);

  const party = await newParty(h, track, `فروشگاه برچسب ${h.tag}`, [a.id, b.id]);
  if (party.status !== 200) throw new Error(`party create answered ${party.status} ${JSON.stringify(party.body).slice(0, 200)}`);
  if (JSON.stringify(await tagIdsOf(party.id)) !== JSON.stringify([a.id, b.id].sort((x, y) => x - y))) wrong.push(`create saved tags ${JSON.stringify(await tagIdsOf(party.id))}`);
  const createAudit = await lastAudit('طرف حساب', party.id, 'CREATE');
  if (!Array.isArray(createAudit?.after?.tags) || (createAudit?.after?.tags as unknown[]).length !== 2) wrong.push(`create audit tags ${JSON.stringify(createAudit?.after?.tags)}`);
  const plain = await newParty(h, track, `فروشگاه بی برچسب ${h.tag}`);

  const filtered = await h.get(`/api/customers?search=${encodeURIComponent(h.tag)}&tagId=${a.id}`);
  const rows = (filtered.body?.data ?? []) as Array<{ id: number; tags?: Array<{ id: number }> }>;
  if (filtered.status !== 200 || rows.map(r => r.id).join() !== String(party.id)) wrong.push(`tag filter returned ${JSON.stringify(rows.map(r => r.id))} (${filtered.status}), not [${party.id}] without ${plain.id}`);
  if (rows[0]?.tags?.length !== 2) wrong.push(`the row carries tags ${JSON.stringify(rows[0]?.tags)}`);

  const version = Number((await orm.select({ v: customers.version }).from(customers).where(eq(customers.id, party.id)))[0]?.v);
  const edited = await h.put(`/api/customers/${party.id}`, { name: `فروشگاه برچسب ${h.tag}`, version, tagIds: [b.id] });
  if (edited.status !== 200) wrong.push(`edit answered ${edited.status} ${JSON.stringify(edited.body).slice(0, 200)}`);
  if (JSON.stringify(await tagIdsOf(party.id)) !== JSON.stringify([b.id])) wrong.push(`edit left tags ${JSON.stringify(await tagIdsOf(party.id))}`);
  const editAudit = await lastAudit('طرف حساب', party.id, 'UPDATE');
  if ((editAudit?.before?.tags as unknown[] | undefined)?.length !== 2 || (editAudit?.after?.tags as unknown[] | undefined)?.length !== 1) wrong.push(`edit audit ${JSON.stringify({ b: editAudit?.before?.tags, a: editAudit?.after?.tags })}`);

  const version2 = Number((await orm.select({ v: customers.version }).from(customers).where(eq(customers.id, party.id)))[0]?.v);
  const unknown = await h.put(`/api/customers/${party.id}`, { name: `فروشگاه برچسب تازه ${h.tag}`, version: version2, tagIds: [b.id, 2_000_000_000] });
  if (unknown.status !== 422 || unknown.body?.code !== 'CUSTOMER_TAG_INVALID') wrong.push(`unknown tag answered ${unknown.status} ${unknown.body?.code}`);
  const [kept] = await orm.select({ name: customers.name }).from(customers).where(eq(customers.id, party.id));
  if (kept?.name !== `فروشگاه برچسب ${h.tag}`) wrong.push(`a refused save still renamed the party to «${kept?.name}»`);

  const keepTags = await h.put(`/api/customers/${party.id}`, { name: `فروشگاه برچسب ${h.tag}`, version: version2, notes: 'بی تغییر برچسب' });
  if (keepTags.status !== 200 || JSON.stringify(await tagIdsOf(party.id)) !== JSON.stringify([b.id])) wrong.push(`an edit without tagIds changed tags (${keepTags.status})`);

  const del = await h.del(`/api/customers/tags/${b.id}`);
  if (del.status !== 200) wrong.push(`tag delete answered ${del.status}`);
  const afterDel = (((await h.get(`/api/customers?search=${encodeURIComponent(h.tag)}`)).body?.data ?? []) as Array<{ id: number; tags?: unknown[] }>).find(r => r.id === party.id);
  if (afterDel?.tags?.length !== 0) wrong.push(`a deleted tag still shows on the party ${JSON.stringify(afterDel?.tags)}`);

  if (wrong.length) throw new Error(wrong.join(' | '));
  return 'tags saved and audited with create and edit, unknown tag 422 with nothing written, missing tagIds keeps tags, list filter and row tags';
}

async function leadFilterCase(h: Harness, track: Track): Promise<string> {
  const wrong: string[] = [];
  const tag = await newTag(h, track, `نمایندگی ${h.tag}`);
  const tagged = await newParty(h, track, `نماینده ${h.tag}`, [tag.id]);
  const plain = await newParty(h, track, `خریدار ساده ${h.tag}`);
  const lead = async (customerId: number | null, label: string) => {
    const [row] = await orm.insert(crmLeads).values({ title: `پرونده ${label} ${h.tag}`, customerId, customerName: label }).returning({ id: crmLeads.id });
    track.leads.push(row.id);
    return row.id;
  };
  const want = await lead(tagged.id, 'با برچسب');
  await lead(plain.id, 'بی برچسب');
  await lead(null, 'بی طرف حساب');

  const { buildLeadQueryParams } = await import('../../hooks/useCRMFilters.js');
  const params = buildLeadQueryParams({ searchTerm: h.tag, filterTag: String(tag.id) });
  const reader = await h.sessionWith(['crm.view']);
  const res = await h.get(`/api/crm/leads?${params.toString()}`, reader);
  const rows = (Array.isArray(res.body?.data) ? res.body.data : (Array.isArray(res.body) ? res.body : [])) as Array<{ id: number }>;
  if (res.status !== 200 || rows.map(r => r.id).join() !== String(want)) wrong.push(`tag filter "${params.toString()}" returned ${JSON.stringify(rows.map(r => r.id))} (${res.status}), not [${want}]`);
  const bad = await h.get('/api/crm/leads?tagId=abc', reader);
  if (bad.status !== 400) wrong.push(`a malformed tag id answered ${bad.status}`);

  if (wrong.length) throw new Error(wrong.join(' | '));
  return 'only the file of the tagged party is returned; a malformed tag id is 400';
}
