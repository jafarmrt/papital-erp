import type { TestCaseResult } from '../types.js';
import type { Harness, ShouldRun } from '../security/workflowTestHarness.js';
import { newWorker } from '../invariants/payrollScenarios.js';
import { brief, fixture } from './documentEntryTests.js';
import { runReservationCases } from './stockReservationTests.js';

/**
 * v10.1.38 (N-01 part 2, TD-1284, mobile workshop plan §4.3): the workshop cartable's server.
 * - Decisions ت۲ الف, ت۵ الف, ت۶ الف, ت۷ الف: a worker reports a schedule row's final quantity (never above the row),
 *   edits or withdraws it before review; only a manager of the project approves it, which writes the row's work log at
 *   the server rate, or rejects it with a reason; the worker sees the amount only after approval, and the last approved
 *   row of a product in a stage brings the matrix tick suggestion.
 * - Decision ت۱ الف: the recipient answers a remittance or an allocation once; a discrepancy needs a note, notifies the
 *   recorder and the holders of warehouse.out, and stock never changes.
 * - Decision ت۸ الف: the bell reminds a worker once before and once after each deadline, never again after dismissal.
 * Through the real Express routes; red on v10.1.37, which had no /api/workshop routes and no workshop reminders.
 */
export async function runWorkshopCartablePartTwoTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_workshop_report_review_n01',
      'v10.1.38: a worker reports a schedule row up to its quantity and edits or withdraws it; only a project manager, never for their own work, approves it (one work log at the server rate, the worker notified with the amount, the matrix tick suggested after the last row) or rejects it with a reason (N-01, TD-1284)',
      ['n01', 'workshop', 'piecework', 'projects'], reportReviewCase],
    ['reg_workshop_delivery_confirm_n01',
      'v10.1.38: the recipient answers a final remittance or an allocation once; a discrepancy needs a note and notifies the recorder and warehouse.out holders; stock never changes (N-01, TD-1284)',
      ['n01', 'workshop', 'documents', 'allocations'], deliveryCase],
    ['reg_workshop_due_reminders_n01',
      'v10.1.38: the bell reminds a workshop worker once the day before a deadline and once after it, skips reported rows and never repeats a dismissed reminder (N-01, TD-1284)',
      ['n01', 'workshop', 'notifications'], remindersCase],
  ]);
}

const codeOf = (res: { body?: unknown }) => String((res.body as { code?: unknown } | undefined)?.code ?? '');
let serial = 0;
const unique = (label: string) => `${label}-${Date.now().toString().slice(-6)}-${++serial}`;
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

interface Row { id: string; taskId: number | null; taskTitle: string; assignedPersonnelId: number; quantity: number; endDate?: string }

/** A project with one stage whose product «prod-a» has the given schedule rows. */
async function scheduledProject(h: Harness, rows: Row[], endDate = ''): Promise<{ projectId: number; stageId: number }> {
  const [project] = await h.q(`INSERT INTO production_projects (project_code, title, end_date, products) VALUES ($1, $2, $3, $4) RETURNING id`,
    [unique('N01P2'), unique('workshop project'), endDate, JSON.stringify([{ id: 'prod-a', item_name: 'N01 product', item_code: '', quantity: 10, unit: 'عدد' }])]);
  const projectId = Number(project.id);
  const [stage] = await h.q(`INSERT INTO project_stages (project_id, stage_order, title) VALUES ($1, 1, 'برش') RETURNING id`, [projectId]);
  const stageId = Number(stage.id);
  const schedules = { [stageId]: { 'prod-a': { productId: 'prod-a', productName: 'N01 product', tasks: rows } } };
  await h.q(`UPDATE production_projects SET stage_schedules = $2 WHERE id = $1`, [projectId, JSON.stringify(schedules)]);
  return { projectId, stageId };
}

async function linkedWorker(h: Harness, permissions: string[], label: string) {
  const session = await h.sessionWith(permissions);
  const personnelId = await newWorker(label);
  await h.q(`UPDATE personnel SET user_id = $2 WHERE id = $1`, [personnelId, session.userId]);
  return { session, personnelId };
}

async function newTaskId(h: Harness, rate: number): Promise<number> {
  const [row] = await h.q(`INSERT INTO piecework_tasks (code, title, default_rate) VALUES ($1, $2, $3) RETURNING id`, [unique('PT'), unique('N01 task'), rate]);
  return Number(row.id);
}

const notificationsOf = (h: Harness, userId: number, type: string) => h.q(`SELECT message, link FROM notifications WHERE user_id = $1 AND type = $2 ORDER BY id`, [userId, type]);

async function reportReviewCase(h: Harness, wrong: string[]): Promise<string> {
  await fixture(h);
  const task = await newTaskId(h, 1_000);
  const { session: worker, personnelId } = await linkedWorker(h, ['workshop.self'], 'N01 worker');
  const other = await newWorker('N01 other');
  const manager = await h.sessionWith(['workshop.review', 'projects.view']);
  const outsider = await h.sessionWith(['workshop.review', 'projects.view']);
  const selfManager = await linkedWorker(h, ['workshop.self', 'workshop.review', 'projects.view'], 'N01 manager worker');
  const ownProject = await scheduledProject(h, [{ id: 'row-d', taskId: task, taskTitle: 'برش D', assignedPersonnelId: selfManager.personnelId, quantity: 1 }]);
  await h.q(`INSERT INTO project_managers (project_id, user_id) VALUES ($1, $2)`, [ownProject.projectId, selfManager.session.userId]);
  const { projectId, stageId } = await scheduledProject(h, [
    { id: 'row-a', taskId: task, taskTitle: 'برش A', assignedPersonnelId: personnelId, quantity: 5 },
    { id: 'row-b', taskId: task, taskTitle: 'برش B', assignedPersonnelId: personnelId, quantity: 3 },
    { id: 'row-c', taskId: task, taskTitle: 'برش C', assignedPersonnelId: other, quantity: 2 },
  ]);
  await h.q(`INSERT INTO project_managers (project_id, user_id) VALUES ($1, $2)`, [projectId, manager.userId]);
  const ref = (rowId: string) => ({ projectId, stageId, productId: 'prod-a', rowId });

  // my tasks: only the worker's rows, no amount
  const mine = await h.get('/api/workshop/my-tasks', worker);
  const rowIds = ((mine.body as { tasks?: Array<{ rowId: string; projectId: number }> }).tasks ?? []).filter(t => t.projectId === projectId).map(t => t.rowId).sort();
  if (mine.status !== 200 || JSON.stringify(rowIds) !== '["row-a","row-b"]') wrong.push(`my-tasks answered ${brief(mine)} with rows ${JSON.stringify(rowIds)}, expected row-a and row-b`);
  const unlinked = await h.sessionWith(['workshop.self']);
  const noPersonnel = await h.get('/api/workshop/my-tasks', unlinked);
  if (noPersonnel.status !== 422 || codeOf(noPersonnel) !== 'WORKSHOP_PERSONNEL_NOT_LINKED') wrong.push(`a user without personnel answered ${brief(noPersonnel)}, expected 422 WORKSHOP_PERSONNEL_NOT_LINKED`);

  // submit: above the row, someone else's row, then a valid one and a duplicate
  const over = await h.post('/api/workshop/reports', { ...ref('row-a'), quantity: '۶' }, worker);
  if (over.status !== 422 || codeOf(over) !== 'WORKSHOP_REPORT_QUANTITY_EXCEEDED') wrong.push(`a report of 6 on a row of 5 answered ${brief(over)}, expected 422 WORKSHOP_REPORT_QUANTITY_EXCEEDED`);
  const notMine = await h.post('/api/workshop/reports', { ...ref('row-c'), quantity: 1 }, worker);
  if (notMine.status !== 422 || codeOf(notMine) !== 'WORKSHOP_ROW_NOT_FOUND') wrong.push(`a report on another personnel's row answered ${brief(notMine)}, expected 422 WORKSHOP_ROW_NOT_FOUND`);
  const submitted = await h.post('/api/workshop/reports', { ...ref('row-a'), quantity: '۴', notes: 'تمام شد' }, worker);
  const report = (submitted.body as { report?: { id: number; version: number } }).report;
  if (submitted.status !== 201 || !report) throw new Error(`setup: submitting a report answered ${brief(submitted)}`);
  const again = await h.post('/api/workshop/reports', { ...ref('row-a'), quantity: 1 }, worker);
  if (again.status !== 409 || codeOf(again) !== 'WORKSHOP_REPORT_EXISTS') wrong.push(`a second report on the row answered ${brief(again)}, expected 409 WORKSHOP_REPORT_EXISTS`);
  if ((await notificationsOf(h, manager.userId, 'workshop_report_submitted')).length !== 1) wrong.push('the project manager got no report notification');
  if ((await notificationsOf(h, outsider.userId, 'workshop_report_submitted')).length !== 0) wrong.push('a reviewer of another project got the report notification');

  // edit before review; a stale version is refused
  const edited = await h.put(`/api/workshop/reports/${report.id}`, { version: report.version, quantity: 5 }, worker);
  const editedVersion = Number((edited.body as { report?: { version?: number } }).report?.version);
  if (edited.status !== 200) wrong.push(`editing the report answered ${brief(edited)}, expected 200`);
  const stale = await h.put(`/api/workshop/reports/${report.id}`, { version: report.version, quantity: 2 }, worker);
  if (stale.status !== 409 || codeOf(stale) !== 'OCC_CONFLICT') wrong.push(`a stale edit answered ${brief(stale)}, expected 409 OCC_CONFLICT`);

  // review: a reviewer of another project is refused; the manager approves and the work log is written once
  const refused = await h.post(`/api/workshop/reports/${report.id}/approve`, { version: editedVersion }, outsider);
  if (refused.status !== 403 || codeOf(refused) !== 'WORKSHOP_NOT_PROJECT_MANAGER') wrong.push(`an outside reviewer's approval answered ${brief(refused)}, expected 403 WORKSHOP_NOT_PROJECT_MANAGER`);
  // a manager never approves a report of their own work, which the approval would pay them for
  const own = (await h.post('/api/workshop/reports', { projectId: ownProject.projectId, stageId: ownProject.stageId, productId: 'prod-a', rowId: 'row-d', quantity: 1 }, selfManager.session)).body as { report?: { id: number; version: number } };
  const ownApproval = await h.post(`/api/workshop/reports/${own.report?.id}/approve`, { version: own.report?.version }, selfManager.session);
  if (ownApproval.status !== 403 || codeOf(ownApproval) !== 'WORKSHOP_OWN_REPORT') wrong.push(`a manager approving their own report answered ${brief(ownApproval)}, expected 403 WORKSHOP_OWN_REPORT`);
  if ((await h.q(`SELECT 1 FROM piecework_logs WHERE personnel_id = $1 AND is_deleted = 0`, [selfManager.personnelId])).length !== 0) wrong.push('a refused own approval wrote a work log');
  const approved = await h.post(`/api/workshop/reports/${report.id}/approve`, { version: editedVersion }, manager);
  const approval = approved.body as { pieceworkLogId?: number; matrixTickSuggestion?: unknown };
  if (approved.status !== 200 || !approval.pieceworkLogId) wrong.push(`the manager's approval answered ${brief(approved)}, expected 200 with a work log`);
  const [log] = await h.q(`SELECT quantity, unit_rate, total_amount, personnel_id, project_id FROM piecework_logs WHERE id = $1`, [approval.pieceworkLogId ?? 0]);
  if (!log || Number(log.quantity) !== 5 || Number(log.total_amount) !== 5_000 || Number(log.personnel_id) !== personnelId) {
    wrong.push(`the approval wrote log ${JSON.stringify(log ?? null)}, expected 5 × 1,000 = 5,000 for the worker`);
  }
  const [linked] = await h.q(`SELECT stage_schedules -> $2::text -> 'prod-a' -> 'tasks' -> 0 ->> 'pieceworkLogId' AS log_id FROM production_projects WHERE id = $1`, [projectId, String(stageId)]);
  if (Number(linked?.log_id) !== approval.pieceworkLogId) wrong.push(`the schedule row holds log ${JSON.stringify(linked ?? null)}, expected ${approval.pieceworkLogId}`);
  if (approval.matrixTickSuggestion !== null) wrong.push(`approving the first of two rows suggested the matrix tick ${JSON.stringify(approval.matrixTickSuggestion)}`);
  const twice = await h.post(`/api/workshop/reports/${report.id}/approve`, { version: editedVersion + 1 }, manager);
  if (twice.status !== 409 || codeOf(twice) !== 'WORKSHOP_REPORT_NOT_SUBMITTED') wrong.push(`approving again answered ${brief(twice)}, expected 409 WORKSHOP_REPORT_NOT_SUBMITTED`);
  const workerNote = await notificationsOf(h, worker.userId, 'workshop_report_approved');
  if (workerNote.length !== 1 || !String(workerNote[0]?.message).includes('۵٬۰۰۰')) wrong.push(`the worker's approval notification is ${JSON.stringify(workerNote)}, expected one naming ۵٬۰۰۰ ریال`);
  const after = await h.get('/api/workshop/my-tasks', worker);
  const body = after.body as { tasks?: Array<{ rowId: string; projectId: number }>; approved?: Array<{ amount: number; reportId: number }> };
  if ((body.tasks ?? []).some(t => t.projectId === projectId && t.rowId === 'row-a')) wrong.push('the approved row is still in my-tasks');
  if (!(body.approved ?? []).some(a => a.reportId === report.id && a.amount === 5_000)) wrong.push(`my-tasks lists approved ${JSON.stringify(body.approved ?? null)}, expected report ${report.id} with 5,000`);

  // row-b: withdraw, resubmit, reject without and with a reason, resubmit and approve with a corrected quantity
  const b1 = (await h.post('/api/workshop/reports', { ...ref('row-b'), quantity: 3 }, worker)).body as { report?: { id: number; version: number } };
  const withdrawn = await h.post(`/api/workshop/reports/${b1.report?.id}/withdraw`, { version: b1.report?.version }, worker);
  if (withdrawn.status !== 200) wrong.push(`withdrawing answered ${brief(withdrawn)}, expected 200`);
  const b2 = (await h.post('/api/workshop/reports', { ...ref('row-b'), quantity: 3 }, worker)).body as { report?: { id: number; version: number } };
  const noReason = await h.post(`/api/workshop/reports/${b2.report?.id}/reject`, { version: b2.report?.version, reason: '  ' }, manager);
  if (noReason.status !== 422 || codeOf(noReason) !== 'WORKSHOP_REJECT_REASON_REQUIRED') wrong.push(`a rejection without a reason answered ${brief(noReason)}, expected 422 WORKSHOP_REJECT_REASON_REQUIRED`);
  const rejected = await h.post(`/api/workshop/reports/${b2.report?.id}/reject`, { version: b2.report?.version, reason: 'شمارش دوباره' }, manager);
  if (rejected.status !== 200 || (await notificationsOf(h, worker.userId, 'workshop_report_rejected')).length !== 1) wrong.push(`a rejection answered ${brief(rejected)} or did not notify the worker`);
  // row-c of the other personnel counts as logged (a live work log linked to it), so row-b is the last open row
  await h.q(`UPDATE production_projects SET stage_schedules = jsonb_set(stage_schedules, ARRAY[$2::text, 'prod-a', 'tasks', '2', 'pieceworkLogId'], to_jsonb($3::int)) WHERE id = $1`,
    [projectId, String(stageId), approval.pieceworkLogId ?? 0]);
  const b3 = (await h.post('/api/workshop/reports', { ...ref('row-b'), quantity: 3 }, worker)).body as { report?: { id: number; version: number } };
  const last = await h.post(`/api/workshop/reports/${b3.report?.id}/approve`, { version: b3.report?.version, quantity: '2' }, manager);
  const suggestion = (last.body as { matrixTickSuggestion?: { stageId?: number; productId?: string } }).matrixTickSuggestion;
  if (last.status !== 200 || suggestion?.stageId !== stageId || suggestion?.productId !== 'prod-a') wrong.push(`approving the last row answered ${brief(last)}, expected the matrix tick suggestion for the stage and product`);
  const [b3row] = await h.q(`SELECT status, approved_quantity FROM workshop_task_reports WHERE id = $1`, [b3.report?.id ?? 0]);
  if (b3row?.status !== 'approved' || Number(b3row?.approved_quantity) !== 2) wrong.push(`the corrected report is ${JSON.stringify(b3row ?? null)}, expected approved with 2`);
  const [audits] = await h.q(`SELECT count(*)::int AS n FROM activity_logs WHERE entity = 'گزارش کار کارگاه'`);
  if (Number(audits?.n) < 8) wrong.push(`the report writes left ${audits?.n} audit rows, expected at least 8`);
  const [logs] = await h.q(`SELECT count(*)::int AS n FROM piecework_logs WHERE personnel_id = $1 AND is_deleted = 0`, [personnelId]);
  if (Number(logs?.n) !== 2) wrong.push(`the worker has ${logs?.n} work logs, expected 2`);
  return 'reports submitted, edited, withdrawn, rejected and approved into work logs by the project manager only';
}

async function deliveryCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const { session: worker, personnelId } = await linkedWorker(h, ['workshop.self'], 'N01 recipient');
  const { session: stranger } = await linkedWorker(h, ['workshop.self'], 'N01 stranger');
  const keeper = await h.sessionWith(['warehouse.out', 'warehouse.view']);
  const item = await f.item(20);
  const doc = await h.post('/api/documents', f.doc('remittance', 'final', [{ itemId: item, quantity: 2, unit_price: 1_000, location: f.wh }], { inOut: 'out', buyer_name: 'N01', recipientPersonnelId: personnelId }));
  const docId = Number((doc.body as { docId?: unknown }).docId);
  if (doc.status !== 200) throw new Error(`setup: the remittance answered ${brief(doc)}`);
  const project = await h.post('/api/projects', { title: unique('N01 delivery'), start_date: f.today, end_date: f.today, quantity: 1 });
  const projectId = Number((project.body as { id?: unknown }).id);
  const allocated = await h.post('/api/inventory/allocations/allocate', { projectId, recipientPersonnelId: personnelId, allocations: [{ itemId: item, quantity: 3, location: f.wh }] });
  const allocationId = Number((allocated.body as { data?: { allocations?: Array<{ id?: unknown }> } })?.data?.allocations?.[0]?.id);
  if (allocated.status !== 200) throw new Error(`setup: the allocation answered ${brief(allocated)}`);
  const stockBefore = await f.stock(item);

  const list = await h.get('/api/workshop/my-deliveries', worker);
  const deliveries = (list.body as { deliveries?: Array<{ kind: string; id: number; confirmation: unknown; lines: unknown[] }> }).deliveries ?? [];
  const has = (kind: string, id: number) => deliveries.some(d => d.kind === kind && d.id === id && d.confirmation === null && d.lines.length === 1);
  if (list.status !== 200 || !has('document', docId) || !has('allocation', allocationId)) wrong.push(`my-deliveries answered ${brief(list)}, expected the remittance and the allocation unanswered`);

  const noNote = await h.post('/api/workshop/deliveries/confirm', { kind: 'document', id: docId, status: 'discrepancy' }, worker);
  if (noNote.status !== 422 || codeOf(noNote) !== 'WORKSHOP_DISCREPANCY_NOTE_REQUIRED') wrong.push(`a discrepancy without a note answered ${brief(noNote)}, expected 422 WORKSHOP_DISCREPANCY_NOTE_REQUIRED`);
  const byStranger = await h.post('/api/workshop/deliveries/confirm', { kind: 'document', id: docId, status: 'received' }, stranger);
  if (byStranger.status !== 404 || codeOf(byStranger) !== 'WORKSHOP_DELIVERY_NOT_FOUND') wrong.push(`another worker's answer answered ${brief(byStranger)}, expected 404 WORKSHOP_DELIVERY_NOT_FOUND`);
  const discrepancy = await h.post('/api/workshop/deliveries/confirm', { kind: 'document', id: docId, status: 'discrepancy', note: 'یک عدد کم بود' }, worker);
  if (discrepancy.status !== 201) wrong.push(`a discrepancy with a note answered ${brief(discrepancy)}, expected 201`);
  const twice = await h.post('/api/workshop/deliveries/confirm', { kind: 'document', id: docId, status: 'received' }, worker);
  if (twice.status !== 409 || codeOf(twice) !== 'WORKSHOP_DELIVERY_ALREADY_CONFIRMED') wrong.push(`a second answer answered ${brief(twice)}, expected 409 WORKSHOP_DELIVERY_ALREADY_CONFIRMED`);
  const keeperNotes = await notificationsOf(h, keeper.userId, 'workshop_delivery_discrepancy');
  if (keeperNotes.length !== 1 || !String(keeperNotes[0]?.message).includes('یک عدد کم بود')) wrong.push(`the warehouse.out holder got ${JSON.stringify(keeperNotes)}, expected one discrepancy notification with the note`);
  const received = await h.post('/api/workshop/deliveries/confirm', { kind: 'allocation', id: allocationId, status: 'received' }, worker);
  if (received.status !== 201) wrong.push(`receiving the allocation answered ${brief(received)}, expected 201`);
  if ((await notificationsOf(h, keeper.userId, 'workshop_delivery_discrepancy')).length !== 1) wrong.push('a «received» answer sent a discrepancy notification');
  if (await f.stock(item) !== stockBefore) wrong.push(`answering deliveries moved stock from ${stockBefore} to ${await f.stock(item)}`);
  const [audits] = await h.q(`SELECT count(*)::int AS n FROM activity_logs WHERE entity = 'تأیید دریافت کالای کارگاه'`);
  if (Number(audits?.n) !== 2) wrong.push(`the answers left ${audits?.n} audit rows, expected 2`);
  return 'the recipient answered a remittance and an allocation once each; the discrepancy notified the warehouse';
}

async function remindersCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const task = await newTaskId(h, 1_000);
  const { session: worker, personnelId } = await linkedWorker(h, ['workshop.self'], 'N01 reminded');
  const { session: plain, personnelId: plainPersonnel } = await linkedWorker(h, ['projects.view'], 'N01 no key');
  const { projectId, stageId } = await scheduledProject(h, [
    { id: 'soon', taskId: task, taskTitle: 'فردا', assignedPersonnelId: personnelId, quantity: 1, endDate: addDays(f.today, 1) },
    { id: 'late', taskId: task, taskTitle: 'گذشته', assignedPersonnelId: personnelId, quantity: 1, endDate: addDays(f.today, -2) },
    { id: 'far', taskId: task, taskTitle: 'دور', assignedPersonnelId: personnelId, quantity: 1, endDate: addDays(f.today, 9) },
    { id: 'done', taskId: task, taskTitle: 'گزارش‌شده', assignedPersonnelId: personnelId, quantity: 1, endDate: addDays(f.today, -1) },
    { id: 'plain', taskId: task, taskTitle: 'بی مجوز', assignedPersonnelId: plainPersonnel, quantity: 1, endDate: addDays(f.today, -1) },
  ]);
  await h.q(`INSERT INTO workshop_task_reports (project_id, stage_id, product_id, row_id, personnel_id, task_id, quantity, created_by_id) VALUES ($1, $2, 'prod-a', 'done', $3, $4, 1, $5)`,
    [projectId, stageId, personnelId, task, worker.userId]);
  const reminders = async (userId: number) => h.q(
    `SELECT id, type, link FROM notifications WHERE user_id = $1 AND type IN ('workshop_task_due_soon', 'workshop_task_overdue') ORDER BY id`, [userId]);

  const bell = await h.get('/api/notifications', worker);
  const first = await reminders(worker.userId);
  const kinds = first.map(r => r.type).sort();
  if (bell.status !== 200 || JSON.stringify(kinds) !== '["workshop_task_due_soon","workshop_task_overdue"]') wrong.push(`the bell made reminders ${JSON.stringify(kinds)}, expected one due-soon and one overdue`);
  await h.del(`/api/notifications/${first[0]?.id}`, worker);
  await h.get('/api/notifications', worker);
  if ((await reminders(worker.userId)).length !== 2) wrong.push(`a second bell request left ${(await reminders(worker.userId)).length} reminders, expected the same 2 (dismissed one kept, none new)`);
  await h.get('/api/notifications', plain);
  if ((await reminders(plain.userId)).length !== 0) wrong.push('a user without workshop.self got a workshop reminder');
  return 'one reminder before and one after the deadline; reported rows and users without the key get none';
}
