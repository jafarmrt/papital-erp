import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { and, eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { journalVouchers, roles, workflowDefinitions, workflowStates, workflowTransitions } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { WorkflowEngineService } from '../../services/workflow/workflowEngineService.js';
import { upgradeLegacySeedGuards } from '../../services/workflow/seedGuardUpgrade.js';
import { JOURNAL_VOUCHER_GUARD_UPGRADE } from '../../services/workflow/voucherWorkflowGuards.js';
import { voucherStepPermissions } from '../../services/accounting/voucherWorkflowAction.js';
import { createTestRole, createTestUser } from '../fixtures/factories.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, accountIdsByCode, inFiscalSandbox, runCase, sandboxAdminClient } from './fiscalClosingTests.js';

/**
 * Payroll duties plan PR 1 (v10.0.21 on, TD-965, OBS-R1-44, decisions t9 / t10 / t3 «الف»): approving a voucher is
 * its own permission and the maker of a manual voucher does not approve it. Red on v10.0.20, where accounting.vouchers
 * alone recorded and approved.
 */

const brief = (res: request.Response) => `${res.status} ${JSON.stringify(res.body ?? {}).slice(0, 220)}`;

async function clientWith(permissions: string[]) {
  const { getTestApp, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  const role = await createTestRole({ permissions });
  const user = await createTestUser({ role: role.code });
  const s = await loginTestUserWithSession(app, user.username);
  return {
    userId: user.id,
    get: (url: string) => request(app).get(url).set('Cookie', s.cookie),
    post: (url: string, body: unknown) => request(app).post(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body as object),
    put: (url: string, body: unknown) => request(app).put(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body as object),
  };
}

type Client = Awaited<ReturnType<typeof clientWith>>;

const RECORD = ['accounting.view', 'accounting.vouchers'];
const APPROVE = [...RECORD, 'accounting.vouchers_approve'];

async function manualDraft(api: Client | Awaited<ReturnType<typeof sandboxAdminClient>>, extra: Record<string, unknown> = {}): Promise<{ id: number; version: number }> {
  const acc = await accountIdsByCode('7001', '1001');
  const res = await api.post('/api/accounting/vouchers', {
    date: await businessTodayIsoDate(), description: 'Duties test voucher', ...extra,
    items: [
      { accountId: acc['7001'], debit: 1000, credit: 0 },
      { accountId: acc['1001'], debit: 0, credit: 1000 },
    ],
  });
  if (res.status !== 201) throw new Error(`voucher create returned ${brief(res)}`);
  return { id: Number(res.body.id), version: Number(res.body.version ?? 1) };
}

async function statusOf(id: number): Promise<string> {
  const [row] = await orm.select({ status: journalVouchers.status }).from(journalVouchers).where(eq(journalVouchers.id, id));
  return row?.status ?? 'missing';
}

const expect = (cond: boolean, message: string) => { if (!cond) throw new Error(message); };

export async function runVoucherApprovalDutiesTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('reg_voucher_approve_permission_td_965', 'td-965', 'vouchers_approve')) {
    await runCase(results, 'reg_voucher_approve_permission_td_965', 'TD-965: approving, reverting and finalizing a voucher needs accounting.vouchers_approve', () => inFiscalSandbox(async () => {
      const recorder = await clientWith(RECORD);
      const draft = await manualDraft(recorder);
      for (const [label, res] of [
        ['status approved', await recorder.put(`/api/accounting/vouchers/${draft.id}/status`, { status: 'approved' })],
        ['batch approve', await recorder.post('/api/accounting/vouchers/batch-approve', { ids: [draft.id] })],
        ['finalize', await recorder.post(`/api/accounting/vouchers/${draft.id}/finalize`, {})],
        ['batch finalize', await recorder.post('/api/accounting/vouchers/batch-finalize', { ids: [draft.id] })],
      ] as const) {
        expect(res.status === 403, `${label} without the approve key returned ${brief(res)}`);
      }
      expect(await statusOf(draft.id) === 'draft', `voucher left draft: ${await statusOf(draft.id)}`);
      const checker = await clientWith(APPROVE);
      const approved = await checker.put(`/api/accounting/vouchers/${draft.id}/status`, { status: 'approved' });
      expect(approved.status === 200, `approve by another holder returned ${brief(approved)}`);
      const reverted = await recorder.put(`/api/accounting/vouchers/${draft.id}/status`, { status: 'draft' });
      expect(reverted.status === 403, `revert to draft without the approve key returned ${brief(reverted)}`);
      return 'recording key alone cannot approve, revert or finalize; the approve key can';
    }));
  }

  if (shouldRun('reg_voucher_maker_cannot_approve_td_965', 'td-965', 'maker')) {
    await runCase(results, 'reg_voucher_maker_cannot_approve_td_965', 'TD-965: the maker (creator or last editor) of a manual voucher does not approve it; the system admin may', () => inFiscalSandbox(async () => {
      const maker = await clientWith(APPROVE);
      const editor = await clientWith(APPROVE);
      const checker = await clientWith(APPROVE);
      const own = await manualDraft(maker);
      const single = await maker.put(`/api/accounting/vouchers/${own.id}/status`, { status: 'approved' });
      expect(single.status === 403 && single.body?.code === 'VOUCHER_MAKER_CANNOT_APPROVE', `maker approve returned ${brief(single)}`);
      const fin = await maker.post(`/api/accounting/vouchers/${own.id}/finalize`, {});
      expect(fin.status === 403 && fin.body?.code === 'VOUCHER_MAKER_CANNOT_APPROVE', `maker finalize returned ${brief(fin)}`);
      const batch = await maker.post('/api/accounting/vouchers/batch-approve', { ids: [own.id] });
      expect(batch.status === 200 && batch.body?.approvedCount === 0 && batch.body?.refused?.length === 1, `maker batch approve returned ${brief(batch)}`);
      const batchFin = await maker.post('/api/accounting/vouchers/batch-finalize', { ids: [own.id] });
      expect(batchFin.status === 200 && batchFin.body?.finalizedCount === 0, `maker batch finalize returned ${brief(batchFin)}`);
      expect(await statusOf(own.id) === 'draft', `maker's voucher left draft: ${await statusOf(own.id)}`);

      // the last editor is a maker too
      const edited = await manualDraft(maker);
      const acc = await accountIdsByCode('7001', '1001');
      const edit = await editor.put(`/api/accounting/vouchers/${edited.id}`, {
        version: edited.version, description: 'Edited by another user',
        items: [{ accountId: acc['7001'], debit: 2000, credit: 0 }, { accountId: acc['1001'], debit: 0, credit: 2000 }],
      });
      expect(edit.status === 200, `edit returned ${brief(edit)}`);
      const byEditor = await editor.put(`/api/accounting/vouchers/${edited.id}/status`, { status: 'approved' });
      expect(byEditor.status === 403, `last editor approve returned ${brief(byEditor)}`);

      const byChecker = await checker.put(`/api/accounting/vouchers/${own.id}/status`, { status: 'approved' });
      expect(byChecker.status === 200, `checker approve returned ${brief(byChecker)}`);

      const directApproved = await maker.post('/api/accounting/vouchers', {
        date: await businessTodayIsoDate(), description: 'Recorded as approved', status: 'approved',
        items: [{ accountId: acc['7001'], debit: 500, credit: 0 }, { accountId: acc['1001'], debit: 0, credit: 500 }],
      });
      expect(directApproved.status === 403, `recording a manual voucher as approved returned ${brief(directApproved)}`);

      const admin = await sandboxAdminClient();
      const adminOwn = await manualDraft(admin);
      const adminApprove = await admin.put(`/api/accounting/vouchers/${adminOwn.id}/status`, { status: 'approved' });
      expect(adminApprove.status === 200, `system admin approving own voucher returned ${brief(adminApprove)}`);
      return 'creator and last editor refused (single, batch, finalize, record as approved); another holder and the system admin approve';
    }));
  }

  if (shouldRun('reg_voucher_workflow_guard_td_965', 'td-965', 'workflow')) {
    await runCase(results, 'reg_voucher_workflow_guard_td_965', 'TD-965: the journal voucher workflow asks the approve key; an untouched old seed is upgraded once, an edited one never', () => inFiscalSandbox(async () => {
      await WorkflowEngineService.seedDefaultWorkflows();
      const [def] = await orm.select().from(workflowDefinitions).where(eq(workflowDefinitions.code, 'JOURNAL_VOUCHER_WORKFLOW'));
      expect(!!def, 'journal voucher workflow is not seeded');
      const guards = async () => {
        const rows = await orm.select({ actionKey: workflowTransitions.actionKey, perm: workflowTransitions.requiredPermission })
          .from(workflowTransitions).where(eq(workflowTransitions.workflowDefinitionId, def.id));
        return Object.fromEntries(rows.map(r => [r.actionKey, r.perm ?? '']));
      };
      const seeded = await guards();
      expect(seeded.approve_voucher === 'accounting.vouchers_approve' && seeded.finalize_voucher === 'accounting.vouchers_approve'
        && seeded.revert_to_draft === 'accounting.vouchers_approve' && seeded.reject_voucher === 'accounting.vouchers', `new seed guards ${JSON.stringify(seeded)}`);

      // back to the seed before v10.0.21, as an existing install holds it
      await orm.update(workflowTransitions).set({ requiredPermission: 'accounting.vouchers' })
        .where(and(eq(workflowTransitions.workflowDefinitionId, def.id), sql`${workflowTransitions.actionKey} <> 'reopen_voucher'`));
      expect(await upgradeLegacySeedGuards(JOURNAL_VOUCHER_GUARD_UPGRADE) === true, 'untouched old seed was not upgraded');
      const upgraded = await guards();
      expect(upgraded.approve_voucher === 'accounting.vouchers_approve' && upgraded.reject_voucher === 'accounting.vouchers', `upgraded guards ${JSON.stringify(upgraded)}`);
      expect(await upgradeLegacySeedGuards(JOURNAL_VOUCHER_GUARD_UPGRADE) === false, 'second run changed the definition again');

      // an edited old definition is left alone
      await orm.update(workflowTransitions).set({ requiredPermission: 'accounting.vouchers' })
        .where(and(eq(workflowTransitions.workflowDefinitionId, def.id), sql`${workflowTransitions.actionKey} <> 'reopen_voucher'`));
      await orm.update(workflowTransitions).set({ title: 'Edited by the admin' })
        .where(and(eq(workflowTransitions.workflowDefinitionId, def.id), eq(workflowTransitions.actionKey, 'reject_voucher')));
      expect(await upgradeLegacySeedGuards(JOURNAL_VOUCHER_GUARD_UPGRADE) === false, 'edited definition was upgraded');
      expect((await guards()).approve_voucher === 'accounting.vouchers', 'edited definition guards changed');

      // the domain action asks the approve key whatever the definition says
      const states = await orm.select({ key: workflowStates.stateKey }).from(workflowStates).where(eq(workflowStates.workflowDefinitionId, def.id));
      expect(states.length === 4, `unexpected states ${states.length}`);
      const draft = await manualDraft(await sandboxAdminClient());
      const perms = await voucherStepPermissions('approved', orm, String(draft.id));
      const reopen = await voucherStepPermissions('draft', orm, String(draft.id));
      expect(perms.join() === 'accounting.vouchers_approve' && reopen.join() === 'accounting.vouchers', `domain permissions ${perms} / ${reopen}`);
      return 'seed and domain action ask the approve key; upgrade runs once and only on the untouched old seed';
    }));
  }

  if (shouldRun('reg_voucher_approve_migration_td_965', 'td-965', 'migration')) {
    await runCase(results, 'reg_voucher_approve_migration_td_965', 'TD-965: migration 0096 gives the approve key to every role holding accounting.vouchers, once', () => inFiscalSandbox(async () => {
      const holder = await createTestRole({ permissions: RECORD });
      const other = await createTestRole({ permissions: ['accounting.view'] });
      const file = path.join(process.cwd(), 'drizzle', '0096_voucher_approve_permission.sql');
      const statements = fs.readFileSync(file, 'utf8').split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);
      const run = () => orm.transaction(async (tx) => { for (const s of statements) await tx.execute(sql.raw(s)); });
      await run();
      await run();
      const perms = async (id: number) => {
        const [row] = await orm.select({ p: roles.permissions }).from(roles).where(eq(roles.id, id));
        return (row?.p ?? []) as string[];
      };
      const h = await perms(holder.id);
      expect(h.filter(k => k === 'accounting.vouchers_approve').length === 1, `holder permissions ${JSON.stringify(h)}`);
      expect(!(await perms(other.id)).includes('accounting.vouchers_approve'), 'a role without accounting.vouchers got the key');
      return 'holder got the key exactly once, other role untouched';
    }));
  }

  return results;
}
