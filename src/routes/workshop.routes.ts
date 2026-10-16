import { Router } from 'express';
import { z } from 'zod';
import { orm } from '../db/drizzle.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticateToken } from '../middleware/auth.js';
import { can, requirePermission } from '../middleware/authorize.js';
import { idempotency } from '../middleware/idempotency.js';
import { decimalInput, numericIdString, storageDateParam, validate } from '../middleware/validate.js';
import { WORKSHOP_REVIEW_PERMISSION, WORKSHOP_SELF_PERMISSION } from '../lib/permissions/workshopPermissions.js';
import { DELIVERY_CONFIRMATION_STATUSES, WORKSHOP_NOTE_MAX } from '../lib/workshop/workshopSchedule.js';
import { workshopUserOf } from '../services/workshop/workshopAccess.js';
import { confirmDelivery, listMyDeliveries } from '../services/workshop/workshopDeliveries.js';
import { approveWorkshopReport, editWorkshopReport, rejectWorkshopReport, submitWorkshopReport, withdrawWorkshopReport } from '../services/workshop/workshopReports.js';
import { listMyTasks, listReviewReports, projectWorkshopReports } from '../services/workshop/workshopTasks.js';

/**
 * v10.1.39 (N-01 part 2, mobile workshop plan §4.3): the workshop cartable. A worker (`workshop.self`) reads their open
 * schedule rows and deliveries, answers each delivery once and reports the end of a task; a project manager
 * (`workshop.review`) approves a report, which writes the work log, or rejects it. Each write runs in one transaction in
 * its service, with its audit row and notifications.
 */
const router = Router();
router.use(authenticateToken);

const positiveId = (label: string) => z.coerce.number().int(`${label} نامعتبر است`).positive(`${label} نامعتبر است`);
const quantity = decimalInput('تعداد');
const note = z.string().max(WORKSHOP_NOTE_MAX, `توضیح حداکثر ${WORKSHOP_NOTE_MAX} نویسه است`);
const version = z.coerce.number().int().positive('نسخه گزارش لازم است');
const reportParams = z.object({ id: numericIdString });
const toNumber = (v: string | undefined) => (v === undefined ? undefined : Number(v));

const submitSchema = z.object({
  body: z.object({
    projectId: positiveId('پروژه'),
    stageId: positiveId('مرحله'),
    productId: z.string().min(1, 'محصول لازم است').max(200),
    rowId: z.string().min(1, 'ردیف برنامه لازم است').max(200),
    quantity,
    notes: note.optional(),
  }).strict(),
});
const editSchema = z.object({ params: reportParams, body: z.object({ version, quantity: quantity.optional(), notes: note.optional() }).strict() });
const withdrawSchema = z.object({ params: reportParams, body: z.object({ version }).strict() });
const approveSchema = z.object({
  params: reportParams,
  body: z.object({ version, quantity: quantity.optional(), date: storageDateParam, note: note.optional(), acknowledgedManualLogIds: z.array(z.number().int().positive()).max(500).optional() }).strict(),
});
const rejectSchema = z.object({ params: reportParams, body: z.object({ version, reason: note }).strict() });
const confirmSchema = z.object({
  body: z.object({
    kind: z.enum(['document', 'allocation']),
    id: positiveId('حواله یا تخصیص'),
    status: z.enum(DELIVERY_CONFIRMATION_STATUSES),
    note: note.optional(),
  }).strict(),
});
const reviewQuery = z.object({ query: z.object({ projectId: numericIdString.optional() }).passthrough() });
const projectParams = z.object({ params: z.object({ projectId: numericIdString }) });

const actorOf = (req: Parameters<Parameters<typeof router.get>[1]>[0]) => ({ user: workshopUserOf(req.user), req });

router.get('/workshop/my-tasks', requirePermission(WORKSHOP_SELF_PERMISSION), asyncHandler(async (req, res) => {
  res.json(await listMyTasks(orm, workshopUserOf(req.user)));
}));

router.get('/workshop/my-deliveries', requirePermission(WORKSHOP_SELF_PERMISSION), asyncHandler(async (req, res) => {
  res.json(await listMyDeliveries(orm, workshopUserOf(req.user).id));
}));

router.post('/workshop/deliveries/confirm', requirePermission(WORKSHOP_SELF_PERMISSION), idempotency({ scope: 'workshop' }), validate(confirmSchema), asyncHandler(async (req, res) => {
  const actor = actorOf(req);
  const confirmation = await orm.transaction(tx => confirmDelivery(tx, actor, req.body));
  res.status(201).json({ confirmation });
}));

router.post('/workshop/reports', requirePermission(WORKSHOP_SELF_PERMISSION), idempotency({ scope: 'workshop' }), validate(submitSchema), asyncHandler(async (req, res) => {
  const actor = actorOf(req);
  const body = req.body as z.infer<typeof submitSchema>['body'];
  const report = await orm.transaction(tx => submitWorkshopReport(tx, actor, { ...body, quantity: Number(body.quantity) }));
  res.status(201).json({ report });
}));

router.put('/workshop/reports/:id', requirePermission(WORKSHOP_SELF_PERMISSION), validate(editSchema), asyncHandler(async (req, res) => {
  const actor = actorOf(req);
  const body = req.body as z.infer<typeof editSchema>['body'];
  const report = await orm.transaction(tx => editWorkshopReport(tx, actor, Number(req.params.id), { ...body, quantity: toNumber(body.quantity) }));
  res.json({ report });
}));

router.post('/workshop/reports/:id/withdraw', requirePermission(WORKSHOP_SELF_PERMISSION), validate(withdrawSchema), asyncHandler(async (req, res) => {
  const actor = actorOf(req);
  const report = await orm.transaction(tx => withdrawWorkshopReport(tx, actor, Number(req.params.id), Number(req.body.version)));
  res.json({ report });
}));

router.get('/workshop/review/reports', requirePermission(WORKSHOP_REVIEW_PERMISSION), validate(reviewQuery), asyncHandler(async (req, res) => {
  const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
  res.json({ data: await listReviewReports(orm, workshopUserOf(req.user), projectId) });
}));

router.post('/workshop/reports/:id/approve', requirePermission(WORKSHOP_REVIEW_PERMISSION), idempotency({ scope: 'workshop' }), validate(approveSchema), asyncHandler(async (req, res) => {
  const actor = actorOf(req);
  const body = req.body as z.infer<typeof approveSchema>['body'];
  const result = await orm.transaction(tx => approveWorkshopReport(tx, actor, Number(req.params.id), { ...body, quantity: toNumber(body.quantity) }));
  res.json(result);
}));

router.post('/workshop/reports/:id/reject', requirePermission(WORKSHOP_REVIEW_PERMISSION), validate(rejectSchema), asyncHandler(async (req, res) => {
  const actor = actorOf(req);
  const report = await orm.transaction(tx => rejectWorkshopReport(tx, actor, Number(req.params.id), req.body));
  res.json({ report });
}));

// The project schedule tab: pending reports for its reviewers and each stage's approved share
router.get('/workshop/projects/:projectId/reports', requirePermission('projects.view', WORKSHOP_REVIEW_PERMISSION), validate(projectParams), asyncHandler(async (req, res) => {
  const canReview = await can(req.user, WORKSHOP_REVIEW_PERMISSION);
  res.json(await projectWorkshopReports(orm, workshopUserOf(req.user), Number(req.params.projectId), canReview));
}));

export default router;
