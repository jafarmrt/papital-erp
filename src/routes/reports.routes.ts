import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticateToken } from '../middleware/auth.js';
import { can, requirePermission } from '../middleware/authorize.js';
import { numericIdString, storageDateParam, validate } from '../middleware/validate.js';
import { businessTodayIsoDate } from '../lib/businessClock.js';
import { ITEM_COST_READ_PERMISSIONS } from '../lib/inventory/reservedItemsReport.js';
import {
  AGING_REPORT_PERMISSION, LEDGER_CHECK_PERMISSIONS, SALES_REPORT_PERMISSION, VAT_REPORT_PERMISSION,
} from '../lib/permissions/reportPermissions.js';
import {
  AGING_KINDS, AGING_REPORT_DEFAULT_LIMIT, AGING_REPORT_EXPORT_LIMIT, AGING_REPORT_MAX_LIMIT, AGING_SORTS,
} from '../lib/reports/agingReport.js';
import { REPORT_COMPARE_MODES, REPORT_PERIOD_UNITS, presetRange } from '../lib/reports/reportPeriods.js';
import {
  SALES_CHANNELS, SALES_DIMENSIONS, SALES_REPORT_DEFAULT_LIMIT, SALES_REPORT_EXPORT_LIMIT, SALES_REPORT_MAX_LIMIT,
} from '../lib/reports/salesReport.js';
import {
  VAT_DIFFERENCE_PAGE_LIMIT, VAT_LIST_FILTERS, VAT_REPORT_DEFAULT_LIMIT, VAT_REPORT_EXPORT_LIMIT, VAT_REPORT_MAX_LIMIT,
} from '../lib/reports/vatReport.js';
import { agingReport } from '../services/reports/agingReport.service.js';
import { salesReport } from '../services/reports/salesReport.service.js';
import { vatReport } from '../services/reports/vatReport.service.js';

/**
 * v10.1.8 (D-03، طرح گزارش‌های مدیریتی §۵، تصمیم ت۲): API صفحه «گزارش‌های مدیریتی». گزارش فروش با کلید `reports.sales`؛
 * بها و سود ناخالص فقط برای خواننده بهای کالا (ت۳) و سطر هم‌خوانی با دفتر کل فقط برای خواننده گزارش‌های دفتر.
 * v10.1.10: «سن مطالبات و بدهی‌ها» با کلید `accounting.reports` (ت۲).
 * v10.1.12: «مالیات بر ارزش افزوده» با همان کلید (ت۲)، پیش‌فرض از آغاز فصل جاری تا امروز (ت۱۲).
 */
const router = Router();
router.use(authenticateToken);

const dimension = z.enum(SALES_DIMENSIONS);
const pageNumber = z.string().regex(/^[1-9]\d{0,5}$/, 'شماره صفحه عدد صحیح مثبت است');
const reportCurrency = z.string().regex(/^(all|[A-Za-z]{3,5})$/, 'ارز گزارش «all» یا کد ارز است');
const normalizeCurrency = (value: string | undefined) => (value ? (value.toLowerCase() === 'all' ? 'all' : value.toUpperCase()) : 'all');

const salesQuerySchema = z.object({
  query: z.object({
    from: storageDateParam,
    to: storageDateParam,
    groupBy: dimension.optional(),
    thenBy: z.union([dimension, z.literal('')]).optional(),
    period: z.enum(REPORT_PERIOD_UNITS).optional(),
    currency: reportCurrency.optional(),
    partyId: numericIdString.optional(),
    itemId: numericIdString.optional(),
    projectId: numericIdString.optional(),
    category: z.string().max(200).optional(),
    channel: z.enum(SALES_CHANNELS).optional(),
    compare: z.enum(REPORT_COMPARE_MODES).optional(),
    page: pageNumber.optional(),
    limit: pageNumber.optional(),
    export: z.enum(['true', 'false']).optional(),
  }).strict(),
});

type SalesQuery = z.infer<typeof salesQuerySchema>['query'];

router.get('/reports/sales', requirePermission(SALES_REPORT_PERMISSION), validate(salesQuerySchema), asyncHandler(async (req, res) => {
  const query = req.query as unknown as SalesQuery;
  const today = await businessTodayIsoDate();
  const thisMonth = presetRange('this_month', today);
  const exportAll = query.export === 'true';
  const limit = exportAll ? SALES_REPORT_EXPORT_LIMIT : Math.min(Number(query.limit ?? SALES_REPORT_DEFAULT_LIMIT), SALES_REPORT_MAX_LIMIT);
  const optionalId = (value: string | undefined) => (value ? Number(value) : null);
  const report = await salesReport({
    from: query.from ?? thisMonth?.from ?? today,
    to: query.to ?? today,
    groupBy: query.groupBy ?? 'item',
    thenBy: query.thenBy || null,
    period: query.period ?? 'month',
    currency: normalizeCurrency(query.currency),
    partyId: optionalId(query.partyId),
    itemId: optionalId(query.itemId),
    projectId: optionalId(query.projectId),
    category: query.category === undefined ? null : query.category,
    channel: query.channel ?? null,
    compare: query.compare ?? 'none',
    page: exportAll ? 1 : Number(query.page ?? 1),
    limit,
  }, {
    cost: await can(req.user, ...ITEM_COST_READ_PERMISSIONS),
    ledger: await can(req.user, ...LEDGER_CHECK_PERMISSIONS),
  });
  res.json(report);
}));

const agingQuerySchema = z.object({
  query: z.object({
    kind: z.enum(AGING_KINDS).optional(),
    asOf: storageDateParam,
    currency: reportCurrency.optional(),
    approvedOnly: z.enum(['true', 'false']).optional(),
    partyId: numericIdString.optional(),
    sort: z.enum(AGING_SORTS).optional(),
    page: pageNumber.optional(),
    limit: pageNumber.optional(),
    export: z.enum(['true', 'false']).optional(),
  }).strict(),
});

type AgingQuery = z.infer<typeof agingQuerySchema>['query'];

router.get('/reports/aging', requirePermission(AGING_REPORT_PERMISSION), validate(agingQuerySchema), asyncHandler(async (req, res) => {
  const query = req.query as unknown as AgingQuery;
  const exportAll = query.export === 'true';
  const report = await agingReport({
    kind: query.kind ?? 'receivable',
    asOf: query.asOf ?? await businessTodayIsoDate(),
    currency: normalizeCurrency(query.currency),
    approvedOnly: query.approvedOnly === 'true',
    partyId: query.partyId ? Number(query.partyId) : null,
    sort: query.sort ?? 'balance',
    page: exportAll ? 1 : Number(query.page ?? 1),
    limit: exportAll ? AGING_REPORT_EXPORT_LIMIT : Math.min(Number(query.limit ?? AGING_REPORT_DEFAULT_LIMIT), AGING_REPORT_MAX_LIMIT),
  });
  res.json(report);
}));

const vatQuerySchema = z.object({
  query: z.object({
    from: storageDateParam,
    to: storageDateParam,
    list: z.enum(VAT_LIST_FILTERS).optional(),
    page: pageNumber.optional(),
    limit: pageNumber.optional(),
    export: z.enum(['true', 'false']).optional(),
  }).strict(),
});

type VatQuery = z.infer<typeof vatQuerySchema>['query'];

router.get('/reports/vat', requirePermission(VAT_REPORT_PERMISSION), validate(vatQuerySchema), asyncHandler(async (req, res) => {
  const query = req.query as unknown as VatQuery;
  const today = await businessTodayIsoDate();
  const thisQuarter = presetRange('this_quarter', today);
  const exportAll = query.export === 'true';
  const report = await vatReport({
    from: query.from ?? thisQuarter?.from ?? today,
    to: query.to ?? today,
    list: query.list ?? 'all',
    page: exportAll ? 1 : Number(query.page ?? 1),
    limit: exportAll ? VAT_REPORT_EXPORT_LIMIT : Math.min(Number(query.limit ?? VAT_REPORT_DEFAULT_LIMIT), VAT_REPORT_MAX_LIMIT),
  }, { differenceLimit: exportAll ? VAT_REPORT_EXPORT_LIMIT : VAT_DIFFERENCE_PAGE_LIMIT });
  res.json(report);
}));

export default router;
