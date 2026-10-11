import { addLog, fundedBank, newTask, newWorker } from '../invariants/payrollScenarios.js';
import { runMigrationRolledBack } from '../security/workflowLifecycleTests.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient, sandboxClientWith } from './fiscalClosingTests.js';
import { q } from './projectStageIntegrityTests.js';

/**
 * Payroll duties plan PR 3 (D-02 / D-14, decisions t1 to t3 «الف»): a payslip is issued as a draft, approved with its own
 * key, and its issuer neither approves nor pays it. Real Express routes on PostgreSQL in an isolated schema; each case is
 * red on v10.0.181, where a payslip was approved at issue and piecework.payroll alone changed its status.
 */

type Res = { status: number; body?: unknown };

const brief = (res: Res) => `${res.status} ${JSON.stringify(res.body ?? null).slice(0, 220)}`;
const codeOf = (res: Res) => String((res.body as { code?: unknown } | undefined)?.code ?? '');
const idOf = (res: Res) => Number((res.body as { id?: unknown } | undefined)?.id);

const VIEW = 'piecework.view';
const ISSUE = 'piecework.payroll';
const APPROVE = 'piecework.payroll_approve';
const PAY = 'piecework.pay';

const payrollState = async (payrollId: number) => {
  const [pay] = await q('SELECT status, paid_amount::text AS paid FROM piecework_payrolls WHERE id = $1', [payrollId]);
  const logs = await q('SELECT DISTINCT status FROM piecework_logs WHERE payroll_id = $1 ORDER BY status', [payrollId]);
  return `${String(pay?.status)} paid=${Number(pay?.paid ?? 0)} logs=${logs.map(l => String(l.status)).join(',')}`;
};

async function workerWithLog(name: string, amount: number): Promise<number> {
  const worker = await newWorker(name);
  await addLog(worker, await newTask(), '2026-04-08', amount);
  return worker;
}

export async function runPayrollApprovalDutiesTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const draftId = 'reg_payroll_issued_as_draft_td_1083';
  if (shouldRun(draftId, 'td1083', 'payroll', 'approve', 'permission', 'duties')) {
    await runCase(results, draftId, 'v10.0.182: a payslip is issued as a draft with its work logs; only piecework.payroll_approve approves it or puts it back to draft, and a draft is not paid (TD-1083)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const issuer = await sandboxClientWith([VIEW, ISSUE]);
      const approver = await sandboxClientWith([VIEW, APPROVE]);
      const payer = await sandboxClientWith([VIEW, PAY]);
      const worker = await workerWithLog('TD-1083 worker', 700_000);
      const issued = await issuer.post('/api/piecework/payrolls/generate', { personnelId: worker, startDate: '2026-04-01', endDate: '2026-04-30' });
      const payrollId = idOf(issued);
      if (issued.status !== 201 || !payrollId) throw new Error(`setup: payslip ${brief(issued)}`);
      if (await payrollState(payrollId) !== 'draft paid=0 logs=draft') problems.push(`the issued payslip is ${await payrollState(payrollId)}, expected draft with its logs in draft`);
      const [voucher] = await q('SELECT status FROM journal_vouchers WHERE source_payroll_id = $1 AND is_deleted = 0', [payrollId]);
      if (voucher?.status !== 'draft') problems.push(`the draft payslip voucher is ${String(voucher?.status)}, expected a draft voucher`);

      const bankId = await fundedBank();
      const early = await payer.post(`/api/piecework/payrolls/${payrollId}/register-payment`, { bankAccountId: bankId, method: 'bank_transfer' });
      if (early.status !== 409 || codeOf(early) !== 'PAYROLL_NOT_APPROVED') problems.push(`paying the draft answered ${brief(early)}, expected 409 PAYROLL_NOT_APPROVED`);

      const byIssuer = await issuer.put(`/api/piecework/payrolls/${payrollId}/status`, { status: 'approved' });
      if (byIssuer.status !== 403 || codeOf(byIssuer) !== 'PAYROLL_APPROVE_PERMISSION_REQUIRED') problems.push(`approving with piecework.payroll alone answered ${brief(byIssuer)}, expected 403 PAYROLL_APPROVE_PERMISSION_REQUIRED`);
      const notes = await issuer.put(`/api/piecework/payrolls/${payrollId}/status`, { notes: 'TD-1083 note' });
      if (notes.status !== 200) problems.push(`a notes-only edit by the issuer answered ${brief(notes)}, expected 200`);
      const notesByApprover = await approver.put(`/api/piecework/payrolls/${payrollId}/status`, { notes: 'TD-1083 approver note' });
      if (notesByApprover.status !== 403) problems.push(`a notes-only edit with the approve key alone answered ${brief(notesByApprover)}, expected 403`);
      if (await payrollState(payrollId) !== 'draft paid=0 logs=draft') problems.push(`the refused approval changed the payslip to ${await payrollState(payrollId)}`);

      const approved = await approver.put(`/api/piecework/payrolls/${payrollId}/status`, { status: 'approved' });
      if (approved.status !== 200) problems.push(`approving with piecework.payroll_approve answered ${brief(approved)}, expected 200`);
      if (await payrollState(payrollId) !== 'approved paid=0 logs=approved') problems.push(`the approved payslip is ${await payrollState(payrollId)}, expected approved`);
      const back = await approver.put(`/api/piecework/payrolls/${payrollId}/status`, { status: 'draft' });
      if (back.status !== 200 || await payrollState(payrollId) !== 'draft paid=0 logs=draft') problems.push(`back to draft answered ${brief(back)} and left ${await payrollState(payrollId)}, expected draft`);
      const again = await approver.put(`/api/piecework/payrolls/${payrollId}/status`, { status: 'approved' });
      if (again.status !== 200) problems.push(`approving again answered ${brief(again)}, expected 200`);
      const paid = await payer.post(`/api/piecework/payrolls/${payrollId}/register-payment`, { bankAccountId: bankId, method: 'bank_transfer' });
      if (paid.status !== 200 || await payrollState(payrollId) !== 'paid paid=700000 logs=paid') problems.push(`paying the approved payslip answered ${brief(paid)} and left ${await payrollState(payrollId)}, expected paid`);

      assertNoProblems(problems);
      return 'Issued as a draft with draft logs and a draft voucher; paying the draft 409; piecework.payroll alone may not approve (403) but edits notes; the approve key approves, puts back to draft and approves again; then it is paid.';
    }));
  }

  const dutiesId = 'reg_payroll_issuer_cannot_approve_or_pay_td_1084';
  if (shouldRun(dutiesId, 'td1084', 'payroll', 'approve', 'pay', 'duties')) {
    await runCase(results, dutiesId, 'v10.0.182: the issuer of a payslip neither approves it nor pays it nor voids its payment (403 PAYROLL_ISSUER_CANNOT_APPROVE / PAYROLL_ISSUER_CANNOT_PAY); another user does; the system admin is exempt (TD-1084)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const all = [VIEW, ISSUE, APPROVE, PAY];
      const issuer = await sandboxClientWith(all);
      const colleague = await sandboxClientWith(all);
      const bankId = await fundedBank();
      const worker = await workerWithLog('TD-1084 worker', 800_000);
      const issued = await issuer.post('/api/piecework/payrolls/generate', { personnelId: worker, startDate: '2026-04-01', endDate: '2026-04-30' });
      const payrollId = idOf(issued);
      if (issued.status !== 201 || !payrollId) throw new Error(`setup: payslip ${brief(issued)}`);
      const listed = await issuer.get(`/api/piecework/payrolls/${payrollId}`);
      if (Number((listed.body as { createdById?: unknown } | undefined)?.createdById) !== issuer.userId) problems.push(`the payslip detail does not carry its issuer: ${brief(listed)}`);

      const selfApprove = await issuer.put(`/api/piecework/payrolls/${payrollId}/status`, { status: 'approved' });
      if (selfApprove.status !== 403 || codeOf(selfApprove) !== 'PAYROLL_ISSUER_CANNOT_APPROVE') problems.push(`the issuer approving answered ${brief(selfApprove)}, expected 403 PAYROLL_ISSUER_CANNOT_APPROVE`);
      if (await payrollState(payrollId) !== 'draft paid=0 logs=draft') problems.push(`the refused approval left ${await payrollState(payrollId)}`);
      const approved = await colleague.put(`/api/piecework/payrolls/${payrollId}/status`, { status: 'approved' });
      if (approved.status !== 200) problems.push(`a colleague approving answered ${brief(approved)}, expected 200`);

      const selfPay = await issuer.post(`/api/piecework/payrolls/${payrollId}/register-payment`, { bankAccountId: bankId, method: 'bank_transfer', amount: 300_000 });
      if (selfPay.status !== 403 || codeOf(selfPay) !== 'PAYROLL_ISSUER_CANNOT_PAY') problems.push(`the issuer paying answered ${brief(selfPay)}, expected 403 PAYROLL_ISSUER_CANNOT_PAY`);
      if (await payrollState(payrollId) !== 'approved paid=0 logs=approved') problems.push(`the refused payment left ${await payrollState(payrollId)}`);
      const paid = await colleague.post(`/api/piecework/payrolls/${payrollId}/register-payment`, { bankAccountId: bankId, method: 'bank_transfer', amount: 300_000 });
      const transactionId = Number((paid.body as { transactionId?: unknown } | undefined)?.transactionId);
      if (paid.status !== 200 || !transactionId) problems.push(`a colleague paying answered ${brief(paid)}, expected 200`);
      const selfVoid = await issuer.post(`/api/piecework/payrolls/${payrollId}/payments/${transactionId}/void`, { reason: 'TD-1084 issuer void' });
      if (selfVoid.status !== 403 || codeOf(selfVoid) !== 'PAYROLL_ISSUER_CANNOT_PAY') problems.push(`the issuer voiding the payment answered ${brief(selfVoid)}, expected 403 PAYROLL_ISSUER_CANNOT_PAY`);
      if (await payrollState(payrollId) !== 'partially_paid paid=300000 logs=approved') problems.push(`the refused void left ${await payrollState(payrollId)}`);
      const voided = await colleague.post(`/api/piecework/payrolls/${payrollId}/payments/${transactionId}/void`, { reason: 'TD-1084 colleague void' });
      if (voided.status !== 200) problems.push(`a colleague voiding the payment answered ${brief(voided)}, expected 200`);

      // the system admin issues, approves and pays their own payslip
      const admin = await sandboxAdminClient();
      const adminWorker = await workerWithLog('TD-1084 admin worker', 400_000);
      const adminIssued = await admin.post('/api/piecework/payrolls/generate', { personnelId: adminWorker, startDate: '2026-04-01', endDate: '2026-04-30' });
      const adminPayroll = idOf(adminIssued);
      const adminApprove = await admin.put(`/api/piecework/payrolls/${adminPayroll}/status`, { status: 'approved' });
      const adminPay = await admin.post(`/api/piecework/payrolls/${adminPayroll}/register-payment`, { bankAccountId: bankId, method: 'bank_transfer' });
      if (adminApprove.status !== 200 || adminPay.status !== 200 || await payrollState(adminPayroll) !== 'paid paid=400000 logs=paid') {
        problems.push(`the system admin's own payslip: approve ${brief(adminApprove)}, pay ${brief(adminPay)}, state ${await payrollState(adminPayroll)}; expected both 200 and paid`);
      }

      assertNoProblems(problems);
      return 'The issuer was refused approve, pay and void with 403 and nothing changed; a colleague approved, paid and voided; the system admin approved and paid their own payslip.';
    }));
  }

  const migrationId = 'reg_payroll_approve_migration_td_1083';
  if (shouldRun(migrationId, 'td1083', 'payroll', 'approve', 'migration', 'duties')) {
    await runCase(results, migrationId, 'v10.0.182: migration 0101 gives piecework.payroll_approve to every role holding piecework.payroll and logs each change; other roles are untouched (TD-1083)', async () => {
      const problems: string[] = [];
      const tag = String(Date.now()).slice(-7);
      const codes = { issuer: `td1083_iss_${tag}`, both: `td1083_both_${tag}`, plain: `td1083_plain_${tag}` };
      const outcome = await runMigrationRolledBack('0101_payroll_approve_permission.sql', async (run) => {
        await run(`INSERT INTO roles (name, code, permissions, is_system) VALUES
          ($1, $1, '["piecework.view","piecework.payroll"]'::jsonb, 0),
          ($2, $2, '["piecework.view","piecework.payroll","piecework.payroll_approve"]'::jsonb, 0),
          ($3, $3, '["piecework.view","piecework.pay"]'::jsonb, 0)`, [codes.issuer, codes.both, codes.plain]);
      }, async (run) => ({
        roles: await run('SELECT id, code, permissions FROM roles WHERE code = ANY($1::text[])', [Object.values(codes)]),
        logs: await run(`SELECT entity_id, details FROM activity_logs WHERE details->>'migration' = '0101_payroll_approve_permission'
          AND entity_id = ANY(SELECT id::text FROM roles WHERE code = ANY($1::text[]))`, [Object.values(codes)]),
      }));
      const permsOf = (code: string) => JSON.stringify(outcome.roles.find(r => r.code === code)?.permissions ?? null);
      const expectPerms = (code: string, perms: string[]) => {
        if (permsOf(code) !== JSON.stringify(perms)) problems.push(`${code} after 0101: ${permsOf(code)}, expected ${JSON.stringify(perms)}`);
      };
      expectPerms(codes.issuer, ['piecework.view', 'piecework.payroll', 'piecework.payroll_approve']);
      expectPerms(codes.both, ['piecework.view', 'piecework.payroll', 'piecework.payroll_approve']);
      expectPerms(codes.plain, ['piecework.view', 'piecework.pay']);
      const issuerId = String(outcome.roles.find(r => r.code === codes.issuer)?.id);
      const logged = outcome.logs.map(l => String(l.entity_id));
      if (JSON.stringify(logged) !== JSON.stringify([issuerId])) problems.push(`activity_logs rows for roles ${logged.join(', ')}, expected only ${issuerId}`);
      assertNoProblems(problems);
      return 'The issuing role got piecework.payroll_approve with one activity_logs row; a role already holding it and a role without piecework.payroll were untouched.';
    });
  }

  return results;
}
