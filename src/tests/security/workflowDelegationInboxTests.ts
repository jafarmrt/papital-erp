import { TestCaseResult } from '../types.js';
import { runCase, type Harness, type Row, type ShouldRun } from './workflowTestHarness.js';

/**
 * v10.1.14 (D-06 part C, TD-1268 / TD-1265): an approver gives a deputy from the inbox and reads «تفویض‌های من» without the
 * design keys; an overlapping delegation of the same delegator is refused (decision ت۹, OBS-R2-66); and the system admin
 * closes a running record that cannot move on, with a required reason. All through the real Express routes. Red on
 * v10.1.11, where an overlapping delegation was stored, `/workflow/delegation-scopes` and `?mine=1` did not exist, and
 * `/workflow/instances/:id/terminate` was 404.
 */

const DELEGATION_AUDIT = 'تفویض اختیار ورکفلو';

/** Days far in the future, so no other test's delegation of the same user meets these windows */
const day = (offset: number): string => {
  const base = Date.UTC(2031, 0, 1) + offset * 86400000;
  return new Date(base).toISOString().slice(0, 10);
};

const delegate = (h: Harness, s: Parameters<Harness['post']>[2], body: Row) => h.post('/api/workflow/delegations', body, s);

async function dropDelegations(h: Harness, userIds: number[]): Promise<void> {
  if (userIds.length === 0) return;
  await h.q(`DELETE FROM workflow_delegations WHERE from_user_id = ANY($1::int[]) OR to_user_id = ANY($1::int[])`, [userIds]);
}

async function activeCode(h: Harness, entityType: string): Promise<string> {
  const [row] = await h.q(`SELECT code FROM workflow_definitions WHERE entity_type = $1 AND is_active = 1 ORDER BY id LIMIT 1`, [entityType]);
  if (!row?.code) throw new Error(`no active ${entityType} workflow in the test schema`);
  return String(row.code);
}

export async function runWorkflowDelegationInboxTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_workflow_delegation_overlap_td_1268', 'security', 'td1268', 'd-06', 'workflow', 'delegation')) {
    await runCase(results, {
      id: 'sec_workflow_delegation_overlap_td_1268',
      name: 'v10.1.14: one delegator has one deputy per workflow in any window; an overlapping delegation is 409 WF_DELEGATION_OVERLAP naming the existing one, two saved at once keep one (TD-1268, OBS-R2-66)',
      details: 'ALL then ALL overlapping 409, a workflow scope inside ALL 409, a later window 200, two different workflow scopes over one window 200, after revoking the first the overlapping one 200; two concurrent saves of one window: one 200 and one 409; one audit row per delegation',
    }, async (h, wrong) => {
      const owner = await h.sessionWith(['workflow.approve']);
      const deputyA = await h.sessionWith(['workflow.approve']);
      const deputyB = await h.sessionWith(['workflow.approve']);
      const racer = await h.sessionWith(['workflow.approve']);
      const codes = (await h.q(`SELECT code FROM workflow_definitions WHERE COALESCE(is_archived, 0) = 0 ORDER BY id LIMIT 2`)).map(r => String(r.code));
      try {
        if (codes.length < 2) throw new Error('the test schema has fewer than two workflows');
        const first = await delegate(h, owner, { toUserId: deputyA.userId, scope: 'ALL', startDate: day(0), endDate: day(6), reason: 'مرخصی' });
        if (first.status !== 200) throw new Error(`the first delegation returned ${first.status}: ${JSON.stringify(first.body).slice(0, 200)}`);
        const firstId = Number(first.body?.data?.id);

        const overlapAll = await delegate(h, owner, { toUserId: deputyB.userId, scope: 'ALL', startDate: day(3), endDate: day(9) });
        if (overlapAll.status !== 409 || overlapAll.body?.code !== 'WF_DELEGATION_OVERLAP') wrong.push(`an overlapping ALL delegation returned ${overlapAll.status} ${String(overlapAll.body?.code)}`);
        else if (Number(overlapAll.body?.details?.delegationId) !== firstId) wrong.push(`the overlap refusal named delegation ${String(overlapAll.body?.details?.delegationId)}, not ${firstId}`);

        const overlapScoped = await delegate(h, owner, { toUserId: deputyB.userId, scope: codes[0], startDate: day(6), endDate: day(8) });
        if (overlapScoped.status !== 409) wrong.push(`a workflow delegation inside an ALL one returned ${overlapScoped.status}`);

        const later = await delegate(h, owner, { toUserId: deputyB.userId, scope: 'ALL', startDate: day(7), endDate: day(9) });
        if (later.status !== 200) wrong.push(`a delegation after the first window returned ${later.status}`);

        const scopedX = await delegate(h, deputyA, { toUserId: deputyB.userId, scope: codes[0], startDate: day(20), endDate: day(25) });
        const scopedY = await delegate(h, deputyA, { toUserId: owner.userId, scope: codes[1], startDate: day(20), endDate: day(25) });
        if (scopedX.status !== 200 || scopedY.status !== 200) wrong.push(`two delegations of different workflows over one window returned ${scopedX.status} / ${scopedY.status}`);
        const scopedAll = await delegate(h, deputyA, { toUserId: owner.userId, scope: 'ALL', startDate: day(22), endDate: day(23) });
        if (scopedAll.status !== 409) wrong.push(`an ALL delegation over two workflow delegations returned ${scopedAll.status}`);

        const revoke = await h.post(`/api/workflow/delegations/${firstId}/revoke`, {}, owner);
        if (revoke.status !== 200) wrong.push(`revoking the first delegation returned ${revoke.status}`);
        const afterRevoke = await delegate(h, owner, { toUserId: deputyB.userId, scope: 'ALL', startDate: day(3), endDate: day(6) });
        if (afterRevoke.status !== 200) wrong.push(`the overlapping delegation after the revoke returned ${afterRevoke.status}`);

        const raced = await Promise.all([
          delegate(h, racer, { toUserId: deputyA.userId, scope: 'ALL', startDate: day(40), endDate: day(41) }),
          delegate(h, racer, { toUserId: deputyB.userId, scope: 'ALL', startDate: day(40), endDate: day(41) }),
        ]);
        const statuses = raced.map(r => r.status).sort();
        if (statuses.join(',') !== '200,409') wrong.push(`two delegations of one window saved at once returned ${statuses.join(',')}`);
        const [{ n: stored }] = await h.q(`SELECT count(*)::int AS n FROM workflow_delegations WHERE from_user_id = $1`, [racer.userId]);
        if (Number(stored) !== 1) wrong.push(`two delegations saved at once stored ${String(stored)} rows`);

        const audits = await h.q(`SELECT count(*)::int AS n FROM activity_logs WHERE entity = $1 AND action = 'CREATE' AND entity_id IN (SELECT id::text FROM workflow_delegations WHERE from_user_id = ANY($2::int[]))`, [DELEGATION_AUDIT, [owner.userId, deputyA.userId, racer.userId]]);
        const [{ n: rows }] = await h.q(`SELECT count(*)::int AS n FROM workflow_delegations WHERE from_user_id = ANY($1::int[])`, [[owner.userId, deputyA.userId, racer.userId]]);
        if (Number(audits[0]?.n) !== Number(rows)) wrong.push(`${String(rows)} delegations have ${String(audits[0]?.n)} audit rows`);
      } finally {
        await dropDelegations(h, [owner.userId, deputyA.userId, deputyB.userId, racer.userId]);
      }
    });
  }

  if (shouldRun('sec_workflow_delegation_inbox_access_td_1268', 'security', 'td1268', 'd-06', 'workflow', 'delegation', 'inbox')) {
    await runCase(results, {
      id: 'sec_workflow_delegation_inbox_access_td_1268',
      name: 'v10.1.14: an approver reads the delegation scopes and only their own delegations (given and received, with the scope title) from the inbox; a reader without the delegation keys gets 403 (TD-1268, OBS-R2-73)',
      details: 'workflow.approve: GET /workflow/delegation-scopes 200 with workflow titles and no archived workflow; GET /workflow/delegations?mine=1 lists the delegations the user gave and received and no one else\'s, the system admin\'s mine=1 too; workflow.view only: delegation-scopes 403; an unknown query key 400',
    }, async (h, wrong) => {
      const approver = await h.sessionWith(['workflow.approve']);
      const deputy = await h.sessionWith(['workflow.approve']);
      const stranger = await h.sessionWith(['workflow.approve']);
      const viewer = await h.sessionWith(['workflow.view']);
      const [code] = (await h.q(`SELECT code FROM workflow_definitions WHERE COALESCE(is_archived, 0) = 0 ORDER BY id LIMIT 1`)).map(r => String(r.code));
      try {
        const scopes = await h.get('/api/workflow/delegation-scopes', approver);
        const list = (scopes.body?.data ?? []) as Row[];
        if (scopes.status !== 200 || !list.some(s => s.code === code && typeof s.title === 'string')) wrong.push(`delegation-scopes for an approver returned ${scopes.status} without workflow ${code}`);
        const archived = await h.q(`SELECT code FROM workflow_definitions WHERE is_archived = 1`);
        if (list.some(s => archived.some(a => a.code === s.code))) wrong.push('delegation-scopes offered an archived workflow');
        const viewerScopes = await h.get('/api/workflow/delegation-scopes', viewer);
        if (viewerScopes.status !== 403) wrong.push(`delegation-scopes for workflow.view only returned ${viewerScopes.status}`);

        const given = await delegate(h, approver, { toUserId: deputy.userId, scope: code, startDate: day(60), endDate: day(61) });
        const received = await delegate(h, deputy, { toUserId: approver.userId, scope: 'ALL', startDate: day(70), endDate: day(71) });
        const other = await delegate(h, stranger, { toUserId: deputy.userId, scope: 'ALL', startDate: day(80), endDate: day(81) });
        if ([given, received, other].some(r => r.status !== 200)) throw new Error(`creating the delegations returned ${[given, received, other].map(r => r.status).join(',')}`);

        const mine = await h.get('/api/workflow/delegations?mine=1', approver);
        const ids = ((mine.body?.data ?? []) as Row[]).map(r => Number(r.id));
        const givenId = Number(given.body?.data?.id);
        if (!ids.includes(givenId) || !ids.includes(Number(received.body?.data?.id))) wrong.push('«my delegations» left out a delegation the user gave or received');
        if (ids.includes(Number(other.body?.data?.id))) wrong.push('«my delegations» listed another user\'s delegation');
        const givenRow = ((mine.body?.data ?? []) as Row[]).find(r => Number(r.id) === givenId);
        if (!givenRow?.scopeTitle) wrong.push('a workflow-scoped delegation came without its scope title');

        const adminMine = await h.get('/api/workflow/delegations?mine=1');
        if (((adminMine.body?.data ?? []) as Row[]).some(r => Number(r.id) === givenId)) wrong.push('the system admin\'s «my delegations» listed another user\'s delegation');
        const adminAll = await h.get('/api/workflow/delegations');
        if (!((adminAll.body?.data ?? []) as Row[]).some(r => Number(r.id) === givenId)) wrong.push('the system admin\'s full delegation list lost another user\'s delegation');

        const badQuery = await h.get('/api/workflow/delegations?mine=yes', approver);
        if (badQuery.status !== 400) wrong.push(`an unknown mine value returned ${badQuery.status}`);
      } finally {
        await dropDelegations(h, [approver.userId, deputy.userId, stranger.userId]);
      }
    });
  }

  if (shouldRun('sec_workflow_instance_terminate_td_1265', 'security', 'td1265', 'd-06', 'workflow', 'terminate')) {
    await runCase(results, {
      id: 'sec_workflow_instance_terminate_td_1265',
      name: 'v10.1.14: the system admin closes a running record that cannot move on with a required reason, under the instance lock, with a terminate history row and an audit row; a purchase requisition is refused (TD-1265)',
      details: 'workflow.manage 403; a short reason 400; a running journal voucher record 200: instance TERMINATED, pending tasks canceled, history row terminate with the reason, audit row; closing it again 409 WF_INSTANCE_NOT_RUNNING; a running purchase requisition 409 WF_INSTANCE_TERMINATE_REFUSED and still running',
    }, async (h, wrong) => {
      const instanceIds: number[] = [];
      let voucherEntityId = '';
      let requisitionId = 0;
      try {
        const { createTestVoucher, createTestItem } = await import('../fixtures/factories.js');
        const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
        const { voucher } = await createTestVoucher({ status: 'draft', date: await businessTodayIsoDate(), totalDebit: 3000, totalCredit: 3000 } as never);
        voucherEntityId = String(voucher.id);
        const voucherStart = await h.start({ workflowCode: await activeCode(h, 'journal_voucher'), entityType: 'journal_voucher', entityId: voucher.id });
        const item = await createTestItem({ type: 'raw_material', code: `WF1265-${h.tag}` } as never);
        const reqRes = await h.post('/api/procurement/requisitions', { title: `درخواست آزمون ۱۲۶۵ ${h.tag}`, items: [{ itemId: item.id, itemName: item.name, requestedQty: 2, unit: 'عدد' }] });
        const reqId = Number(reqRes.body?.id ?? reqRes.body?.data?.id);
        const openOf = async (type: string, id: string | number) => Number((await h.q(`SELECT id FROM workflow_instances WHERE entity_type = $1 AND entity_id = $2 AND status = 'IN_PROGRESS'`, [type, String(id)]))[0]?.id);
        const voucherInstance = await openOf('journal_voucher', voucher.id);
        const requisitionInstance = await openOf('purchase_requisition', reqId);
        if (!(voucherInstance > 0) || !(requisitionInstance > 0)) throw new Error(`starting the test records returned ${voucherStart.status} / ${reqRes.status}: ${JSON.stringify(voucherStart.body).slice(0, 200)} ${JSON.stringify(reqRes.body).slice(0, 200)}`);
        instanceIds.push(voucherInstance);
        requisitionId = reqId;

        const designer = await h.sessionWith(['workflow.manage']);
        const byDesigner = await h.post(`/api/workflow/instances/${voucherInstance}/terminate`, { reason: 'گام امضاکننده ندارد' }, designer);
        if (byDesigner.status !== 403) wrong.push(`workflow.manage closed a record (${byDesigner.status})`);
        const short = await h.post(`/api/workflow/instances/${voucherInstance}/terminate`, { reason: 'نه' });
        if (short.status !== 400) wrong.push(`a short reason returned ${short.status}`);

        const reason = `گام بررسی امضاکننده ندارد ${h.tag}`;
        const closed = await h.post(`/api/workflow/instances/${voucherInstance}/terminate`, { reason });
        if (closed.status !== 200) throw new Error(`closing the voucher record returned ${closed.status}: ${JSON.stringify(closed.body).slice(0, 200)}`);
        const [inst] = await h.q(`SELECT status FROM workflow_instances WHERE id = $1`, [voucherInstance]);
        if (inst?.status !== 'TERMINATED') wrong.push(`the closed record is ${String(inst?.status)}`);
        const pending = await h.q(`SELECT id FROM workflow_tasks WHERE instance_id = $1 AND status = 'pending'`, [voucherInstance]);
        if (pending.length > 0) wrong.push(`${pending.length} inbox tasks stayed pending`);
        const history = await h.q(`SELECT comment FROM workflow_history_logs WHERE instance_id = $1 AND action_key = 'terminate'`, [voucherInstance]);
        if (history.length !== 1 || history[0].comment !== reason) wrong.push(`the terminate history rows are ${JSON.stringify(history)}`);
        const audit = await h.q(`SELECT id FROM activity_logs WHERE entity = 'ورکفلو (journal_voucher)' AND entity_id = $1 AND description LIKE $2`, [voucherEntityId, `%${reason}%`]);
        if (audit.length !== 1) wrong.push(`the close wrote ${audit.length} audit rows`);

        const again = await h.post(`/api/workflow/instances/${voucherInstance}/terminate`, { reason });
        if (again.status !== 409 || again.body?.code !== 'WF_INSTANCE_NOT_RUNNING') wrong.push(`closing a closed record returned ${again.status} ${String(again.body?.code)}`);

        const refused = await h.post(`/api/workflow/instances/${requisitionInstance}/terminate`, { reason });
        if (refused.status !== 409 || refused.body?.code !== 'WF_INSTANCE_TERMINATE_REFUSED') wrong.push(`closing a purchase requisition returned ${refused.status} ${String(refused.body?.code)}`);
        const [req] = await h.q(`SELECT status FROM workflow_instances WHERE id = $1`, [requisitionInstance]);
        if (req?.status !== 'IN_PROGRESS') wrong.push(`the refused requisition record is ${String(req?.status)}`);
      } finally {
        if (requisitionId > 0) await h.del(`/api/procurement/requisitions/${requisitionId}`);
        if (instanceIds.length > 0) await h.q(`DELETE FROM workflow_instances WHERE id = ANY($1::int[])`, [instanceIds]);
      }
    });
  }

  return results;
}
