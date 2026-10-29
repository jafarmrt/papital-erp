import { addLog, fundedBank, newTask, newWorker } from '../invariants/payrollScenarios.js';
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
    await runCase(results, draftId, 'v10.0.193: a payslip is issued as a draft with its work logs; only piecework.payroll_approve approves it or puts it back to draft, and a draft is not paid (TD-1083)', async () => inFiscalSandbox(async () => {
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
    await runCase(results, dutiesId, 'v10.0.193: the issuer of a payslip does not approve it (403 PAYROLL_ISSUER_CANNOT_APPROVE), another user does; v11: once approved by another user the issuer pays it and voids that payment; the system admin is exempt (TD-1084)', async () => inFiscalSandbox(async () => {
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

      // v11 (owner's decision 7 Aban 1405): once a colleague approved it, the issuer pays it and voids that payment
      const selfPay = await issuer.post(`/api/piecework/payrolls/${payrollId}/register-payment`, { bankAccountId: bankId, method: 'bank_transfer', amount: 300_000 });
      const transactionId = Number((selfPay.body as { transactionId?: unknown } | undefined)?.transactionId);
      if (selfPay.status !== 200 || !transactionId) problems.push(`the issuer paying the approved payslip answered ${brief(selfPay)}, expected 200`);
      if (await payrollState(payrollId) !== 'partially_paid paid=300000 logs=approved') problems.push(`the issuer's payment left ${await payrollState(payrollId)}`);
      const selfVoid = await issuer.post(`/api/piecework/payrolls/${payrollId}/payments/${transactionId}/void`, { reason: 'issuer void after approval' });
      if (selfVoid.status !== 200) problems.push(`the issuer voiding that payment answered ${brief(selfVoid)}, expected 200`);
      if (await payrollState(payrollId) !== 'approved paid=0 logs=approved') problems.push(`the issuer's void left ${await payrollState(payrollId)}`);
      const paid = await colleague.post(`/api/piecework/payrolls/${payrollId}/register-payment`, { bankAccountId: bankId, method: 'bank_transfer', amount: 300_000 });
      if (paid.status !== 200) problems.push(`a colleague paying answered ${brief(paid)}, expected 200`);

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
      return 'The issuer was refused approval with 403 and nothing changed; a colleague approved; the issuer then paid and voided the payment; the system admin approved and paid their own payslip.';
    }));
  }

  const approverId = 'reg_payroll_issuer_pays_only_what_another_approved_v11';
  if (shouldRun(approverId, 'v11', 'payroll', 'approve', 'pay', 'duties')) {
    await runCase(results, approverId, 'v11: the payslip keeps who approved it; its issuer pays only a payslip another user approved, not one with no approver (approved before v11) or one they approved themselves (as system admin, since demoted); an approval names the net the approver saw and is refused with 409 when the payslip has another; back to draft forgets the approver', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const all = [VIEW, ISSUE, APPROVE, PAY];
      const issuer = await sandboxClientWith(all);
      const colleague = await sandboxClientWith(all);
      const bankId = await fundedBank();
      const issue = async (name: string) => {
        const res = await issuer.post('/api/piecework/payrolls/generate', { personnelId: await workerWithLog(name, 500_000), startDate: '2026-04-01', endDate: '2026-04-30' });
        const id = idOf(res);
        if (res.status !== 201 || !id) throw new Error(`setup: payslip ${brief(res)}`);
        return id;
      };
      const approverOf = async (payrollId: number) => {
        const [row] = await q('SELECT approved_by_id AS "approvedById", net_payable::text AS net FROM piecework_payrolls WHERE id = $1', [payrollId]);
        return { approvedById: row?.approvedById == null ? null : Number(row.approvedById), net: String(row?.net) };
      };
      const pay = (client: typeof issuer, payrollId: number) => client.post(`/api/piecework/payrolls/${payrollId}/register-payment`, { bankAccountId: bankId, method: 'bank_transfer', amount: 100_000 });

      // the approval names the net the approver saw
      const a = await issue('v11 approver A');
      const { net } = await approverOf(a);
      const stale = await colleague.put(`/api/piecework/payrolls/${a}/status`, { status: 'approved', expectedNetPayable: Number(net) + 1_000_000 });
      if (stale.status !== 409 || codeOf(stale) !== 'PAYROLL_CHANGED_SINCE_VIEWED') problems.push(`an approval of another net answered ${brief(stale)}, expected 409 PAYROLL_CHANGED_SINCE_VIEWED`);
      if (!(await payrollState(a)).startsWith('draft')) problems.push(`the refused approval left ${await payrollState(a)}`);
      const approved = await colleague.put(`/api/piecework/payrolls/${a}/status`, { status: 'approved', expectedNetPayable: net });
      if (approved.status !== 200 || (await approverOf(a)).approvedById !== colleague.userId) problems.push(`a colleague approving the net they saw answered ${brief(approved)}, approver ${(await approverOf(a)).approvedById}, expected 200 and ${colleague.userId}`);
      const detail = await issuer.get(`/api/piecework/payrolls/${a}`);
      if (Number((detail.body as { approvedById?: unknown } | undefined)?.approvedById) !== colleague.userId) problems.push(`the payslip detail does not carry its approver: ${brief(detail)}`);
      const issuerPays = await pay(issuer, a);
      if (issuerPays.status !== 200) problems.push(`the issuer paying what a colleague approved answered ${brief(issuerPays)}, expected 200`);

      // approved before v11 (no approver kept), or approved by the issuer themselves: the issuer does not pay it
      for (const [name, approvedBy] of [['no approver', null], ['issuer approved', issuer.userId]] as const) {
        const id = await issue(`v11 approver ${name}`);
        await q(`UPDATE piecework_payrolls SET status = 'approved', approved_by_id = $2 WHERE id = $1`, [id, approvedBy]);
        await q(`UPDATE piecework_logs SET status = 'approved' WHERE payroll_id = $1`, [id]);
        const refused = await pay(issuer, id);
        if (refused.status !== 403 || codeOf(refused) !== 'PAYROLL_ISSUER_CANNOT_PAY') problems.push(`the issuer paying a payslip with ${name} answered ${brief(refused)}, expected 403 PAYROLL_ISSUER_CANNOT_PAY`);
        if (!(await payrollState(id)).startsWith('approved paid=0')) problems.push(`the refused payment of ${name} left ${await payrollState(id)}`);
        const byColleague = await pay(colleague, id);
        if (byColleague.status !== 200) problems.push(`a colleague paying the payslip with ${name} answered ${brief(byColleague)}, expected 200`);
      }

      // back to draft forgets the approver
      const c = await issue('v11 approver C');
      await colleague.put(`/api/piecework/payrolls/${c}/status`, { status: 'approved' });
      const back = await colleague.put(`/api/piecework/payrolls/${c}/status`, { status: 'draft' });
      if (back.status !== 200 || (await approverOf(c)).approvedById !== null) problems.push(`back to draft answered ${brief(back)} and kept approver ${(await approverOf(c)).approvedById}, expected 200 and none`);

      assertNoProblems(problems);
      return 'An approval of another net was refused with 409; the colleague who approved is kept and the issuer paid; with no approver or a self approval the issuer was refused with 403 and a colleague paid; back to draft cleared the approver.';
    }));
  }

  return results;
}
