import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticateToken } from '../middleware/auth.js';
import { authorizePermission, requirePermission } from '../middleware/authorize.js';
import { idempotency } from '../middleware/idempotency.js';
import { decimalInput, numericIdString, validate } from '../middleware/validate.js';
import { READ_PERMISSIONS } from '../lib/recordReadPermissions.js';
import { EIDI_METHODS, EIDI_OVERRIDE_REASON_MAX } from '../lib/payroll/eidi.js';
import { PAYROLL_RATES_PERMISSION, PIECEWORK_PAYROLL_PERMISSION } from '../lib/permissions/pieceworkPermissions.js';
import { listEidiRates, saveEidiRates } from '../services/piecework/payrollEidi.js';
import { issueEidiPayslip, previewEidiPayslip } from '../services/piecework/payrollEidiPayslip.js';
import { payrollEidiReport } from '../services/piecework/payrollEidiReport.js';

/**
 * v10.0.212 (TD-1089، طرح حقوق §۳.۸، ت۱۴ تا ت۱۶ الف): روش و نرخ عیدی هر سال (نوشتن با `payroll.rates_manage`)، پیش‌نمایش و
 * صدور «فیش عیدی» (`piecework.payroll`) و گزارش «عیدی سال» (خوانندگان فیش).
 */
const router = Router();
router.use(authenticateToken);

const yearParam = z.string().regex(/^\d{4}$/, 'سال جلالی چهار رقم است');

const saveRatesSchema = z.object({
  params: z.object({ year: yearParam }),
  body: z.object({
    method: z.enum(EIDI_METHODS, { message: 'روش محاسبه عیدی را انتخاب کنید' }),
    percent: decimalInput('درصد عیدی').optional(),
    yearlyCap: decimalInput('سقف سالانه عیدی').optional(),
    laborDays: decimalInput('روزهای مزد عیدی').optional(),
    laborCapDays: decimalInput('روزهای سقف عیدی').optional(),
    minDailyWage: decimalInput('حداقل مزد روزانه').optional(),
    fixedAmount: decimalInput('مبلغ عیدی سال').optional(),
    version: z.number().int().positive().optional(),
  }).strict(),
});

const previewSchema = z.object({
  query: z.object({ personnelId: numericIdString, year: yearParam }).passthrough(),
});

const issueSchema = z.object({
  body: z.object({
    personnelId: z.number().int().positive('پرسنل را انتخاب کنید'),
    year: z.number().int().min(1390).max(1500),
    amount: decimalInput('مبلغ عیدی').optional(),
    overrideReason: z.string().max(EIDI_OVERRIDE_REASON_MAX).optional(),
    notes: z.string().max(2000).optional(),
  }).strict(),
});

const reportSchema = z.object({ query: z.object({ year: yearParam }).passthrough() });

router.get('/piecework/eidi-rates', authorizePermission(PAYROLL_RATES_PERMISSION, ...READ_PERMISSIONS.payrolls), asyncHandler(async (_req, res) => {
  res.json({ data: await listEidiRates() });
}));

router.put('/piecework/eidi-rates/:year', requirePermission(PAYROLL_RATES_PERMISSION), validate(saveRatesSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof saveRatesSchema>['body'];
  res.json(await saveEidiRates({ ...body, jalaliYear: Number(req.params.year), req }));
}));

router.get('/piecework/eidi-preview', authorizePermission(...READ_PERMISSIONS.payrolls), validate(previewSchema), asyncHandler(async (req, res) => {
  res.json(await previewEidiPayslip(Number(req.query.personnelId), Number(req.query.year)));
}));

router.post('/piecework/eidi-payslips', requirePermission(PIECEWORK_PAYROLL_PERMISSION), idempotency({ scope: 'payroll' }), validate(issueSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof issueSchema>['body'];
  const { payroll, voucher } = await issueEidiPayslip({ ...body, userId: req.user?.id, username: req.user?.username || 'سیستم', req });
  res.status(201).json({ ...payroll, voucherId: voucher?.id ?? null, voucherNumber: voucher?.voucherNumber ?? null });
}));

router.get('/piecework/reports/eidi', authorizePermission(...READ_PERMISSIONS.payrolls), validate(reportSchema), asyncHandler(async (req, res) => {
  res.json(await payrollEidiReport(Number(req.query.year)));
}));

export default router;
