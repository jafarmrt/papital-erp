import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticateToken } from '../middleware/auth.js';
import { authorizePermission, requirePermission } from '../middleware/authorize.js';
import { decimalInput, numericIdString, validate } from '../middleware/validate.js';
import { READ_PERMISSIONS } from '../lib/recordReadPermissions.js';
import { PAYROLL_RATES_PERMISSION } from '../lib/permissions/pieceworkPermissions.js';
import { listStatutoryRates, previewPayrollStatutory, saveStatutoryRates } from '../services/piecework/payrollStatutory.js';
import { payrollStatutoryReport } from '../services/piecework/payrollStatutoryReport.js';

/**
 * v10.0.210 (TD-1087، طرح حقوق §۳.۳، تصمیم ت۴ الف): نرخ‌های سالانه بیمه و مالیات حقوق (نوشتن با `payroll.rates_manage`)
 * و پیش‌نمایش کسورات قانونی فرم صدور فیش؛ v10.0.211 (TD-1088، ت۷ الف): «فهرست بیمه و مالیات» ماهانه.
 */
const router = Router();
router.use(authenticateToken);

const yearParam = z.string().regex(/^\d{4}$/, 'سال جلالی چهار رقم است');

const saveRatesSchema = z.object({
  params: z.object({ year: yearParam }),
  body: z.object({
    employeeInsurancePercent: decimalInput('درصد بیمه سهم کارگر'),
    employerInsurancePercent: decimalInput('درصد بیمه سهم کارفرما'),
    insuranceWageCap: decimalInput('سقف دستمزد مشمول بیمه').optional(),
    taxBrackets: z.array(z.object({
      from: decimalInput('آغاز پله مالیات'),
      to: decimalInput('پایان پله مالیات').nullable().optional(),
      rate: decimalInput('نرخ پله مالیات'),
    }).strict()).max(20, 'حداکثر ۲۰ پله مالیات'),
    deductInsuranceFromTax: z.boolean().optional(),
    version: z.number().int().positive().optional(),
  }).strict(),
});

const previewSchema = z.object({
  query: z.object({
    personnelId: numericIdString,
    startDate: z.string().min(1, 'تاریخ شروع الزامی است'),
    endDate: z.string().min(1, 'تاریخ پایان الزامی است'),
    gross: decimalInput('ناخالص فیش'),
  }).passthrough(),
});

const reportSchema = z.object({
  query: z.object({ year: yearParam, month: z.string().regex(/^(0?[1-9]|1[0-2])$/, 'ماه جلالی ۱ تا ۱۲ است') }).passthrough(),
});

router.get('/piecework/statutory-rates', authorizePermission(PAYROLL_RATES_PERMISSION, ...READ_PERMISSIONS.payrolls), asyncHandler(async (_req, res) => {
  res.json({ data: await listStatutoryRates() });
}));

router.put('/piecework/statutory-rates/:year', requirePermission(PAYROLL_RATES_PERMISSION), validate(saveRatesSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof saveRatesSchema>['body'];
  res.json(await saveStatutoryRates({ ...body, taxBrackets: body.taxBrackets, jalaliYear: Number(req.params.year), req }));
}));

router.get('/piecework/statutory-preview', authorizePermission(...READ_PERMISSIONS.payrolls), validate(previewSchema), asyncHandler(async (req, res) => {
  const query = req.query as unknown as z.infer<typeof previewSchema>['query'];
  res.json(await previewPayrollStatutory({ personnelId: Number(query.personnelId), startDate: query.startDate, endDate: query.endDate, gross: query.gross ?? 0 }));
}));

router.get('/piecework/reports/statutory', authorizePermission(...READ_PERMISSIONS.payrolls), validate(reportSchema), asyncHandler(async (req, res) => {
  res.json(await payrollStatutoryReport(Number(req.query.year), Number(req.query.month)));
}));

export default router;
