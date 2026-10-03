/**
 * مسیرهای گزارش‌های مالی: آمار کلی، تراز آزمایشی، کارت حساب و دفتر طرف‌حساب، دفتر روزنامه، صورت‌های مالی،
 * جریان نقدی، آشتی‌سنجی چک، بازرس سلامت مالی، گزارش پروژه و امضای چاپ سند (AccountingReportService، AGENTS.md §11).
 * authenticateToken در src/routes/accounting.routes.ts پیش از این روتر اعمال می‌شود.
 */
import { Router } from 'express';
import { authorizePermission } from '../../middleware/authorize.js';
import { AccountingService } from '../../services/accounting.service.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { orm } from '../../db/drizzle.js';
import { sql, eq, and } from 'drizzle-orm';
import { workflowInstances, workflowHistoryLogs, workflowStates } from '../../db/schema.js';
import {
  type ValidatedQuery,
  dateRangeQuerySchema,
  trialBalanceQuerySchema,
  accountCardQuerySchema,
  partyLedgerQuerySchema,
  journalBookQuerySchema,
  financialRatiosQuerySchema,
  incomeStatementQuerySchema,
  balanceSheetQuerySchema,
  projectDetailQuerySchema,
  docSignaturesQuerySchema,
} from './accounting.schemas.js';

const router = Router();

// ==========================================
// 1. STATS & OVERVIEW
// ==========================================
const getStatsHandler = asyncHandler(async (req, res) => {
  const stats = await AccountingService.getFinancialOverviewStats();
  res.json({ stats, ...stats });
});
router.get('/accounting/stats', authorizePermission('accounting.view'), getStatsHandler);
router.get('/accounting/summary', authorizePermission('accounting.view'), getStatsHandler);

// V1.6.0: گزارش جریان نقدی خزانه

router.get('/accounting/reports/cash-flow', authorizePermission('accounting.reports', 'accounting.treasury', 'accounting.view'), validate(dateRangeQuerySchema), asyncHandler(async (req, res) => {
  const { startDate, endDate } = (req.query as ValidatedQuery<typeof dateRangeQuerySchema>) || {};
  const report = await AccountingService.getCashFlowReport({
    startDate: startDate as string,
    endDate: endDate as string,
  });
  res.json(report);
}));

// V1.6.0: آشتی‌سنجی دفتر چک صیادی با دفاتر دوبل
router.get('/accounting/reports/cheque-reconciliation', authorizePermission('accounting.reports', 'accounting.treasury', 'accounting.cheques', 'accounting.view'), asyncHandler(async (req, res) => {
  const rows = await AccountingService.getChequeReconciliationReport();
  res.json(rows);
}));

// ==========================================
// 6. REPORTS & FINANCIAL STATEMENTS
// ==========================================

router.get('/accounting/reports/trial-balance', authorizePermission('accounting.reports', 'accounting.view'), validate(trialBalanceQuerySchema), asyncHandler(async (req, res) => {
  const { level, startDate, endDate, currency } = (req.query as ValidatedQuery<typeof trialBalanceQuerySchema>) || {};
  const data = await AccountingService.getTrialBalance({
    level,
    startDate: startDate as string,
    endDate: endDate as string,
    currency: currency as string,
  });
  res.json({ report: data, ...data });
}));

const accountCardReportHandler = asyncHandler(async (req, res) => {
  const { accountId, detailedType, detailedId, detailedName, startDate, endDate, currency } = (req.query as ValidatedQuery<typeof accountCardQuerySchema>) || {};
  const data = await AccountingService.getDetailedAccountCard({
    accountId: accountId ? Number(accountId) : undefined,
    detailedType,
    detailedId: detailedId ? Number(detailedId) : undefined,
    detailedName: detailedName as string,
    startDate: startDate as string,
    endDate: endDate as string,
    currency: currency as string,
  });
  res.json({ report: data, ...data });
});
router.get('/accounting/reports/account-card', authorizePermission('accounting.reports', 'accounting.view', 'customers.view', 'customers.manage', 'sales.view', 'documents.view'), validate(accountCardQuerySchema), accountCardReportHandler);
router.get('/accounting/reports/ledger', authorizePermission('accounting.reports', 'accounting.view', 'customers.view', 'customers.manage', 'sales.view', 'documents.view'), validate(accountCardQuerySchema), accountCardReportHandler);

router.get('/accounting/reports/party-ledger', authorizePermission('accounting.reports', 'accounting.view', 'customers.view', 'customers.manage', 'sales.view', 'documents.view'), validate(partyLedgerQuerySchema), asyncHandler(async (req, res) => {
  const { partyId, partyType, partyName, startDate, endDate, currency, includeDrafts } = (req.query as ValidatedQuery<typeof partyLedgerQuerySchema>) || {};
  const data = await AccountingService.getDetailedPartyLedger({
    partyId: partyId ? Number(partyId) : undefined,
    partyType: partyType as string,
    partyName: partyName as string,
    startDate: startDate as string,
    endDate: endDate as string,
    currency: currency as string,
    includeDrafts: includeDrafts === 'true',
  });
  res.json({ report: data, ...data });
}));

router.get('/accounting/reports/parties', authorizePermission('accounting.reports', 'accounting.view', 'customers.view', 'customers.manage', 'sales.view', 'documents.view'), asyncHandler(async (req, res) => {
  const { search, type } = req.query || {};
  const data = await AccountingService.getPartiesList({
    search: search as string,
    type: type as string,
  });
  res.json({ data });
}));

router.get('/accounting/reports/journal-book', authorizePermission('accounting.reports', 'accounting.view'), validate(journalBookQuerySchema), asyncHandler(async (req, res) => {
  const { startDate, endDate, search, currency } = (req.query as ValidatedQuery<typeof journalBookQuerySchema>) || {};
  const data = await AccountingService.getJournalBook({
    startDate: startDate as string,
    endDate: endDate as string,
    search: search as string,
    currency: currency as string,
  });
  res.json({ report: data, ...data });
}));

router.get('/accounting/reports/financial-ratios', authorizePermission('accounting.reports', 'accounting.view'), validate(financialRatiosQuerySchema), asyncHandler(async (req, res) => {
  const { asOfDate, currency } = (req.query as ValidatedQuery<typeof financialRatiosQuerySchema>) || {};
  const data = await AccountingService.getFinancialRatios({
    asOfDate: asOfDate as string,
    currency: currency as string,
  });
  res.json({ report: data, ...data });
}));

router.get('/accounting/reports/income-statement', authorizePermission('accounting.reports', 'accounting.view'), validate(incomeStatementQuerySchema), asyncHandler(async (req, res) => {
  const { startDate, endDate, currency } = (req.query as ValidatedQuery<typeof incomeStatementQuerySchema>) || {};
  const data = await AccountingService.getIncomeStatement({
    startDate: startDate as string,
    endDate: endDate as string,
    currency: currency as string,
  });
  res.json({ report: data, ...data });
}));

router.get('/accounting/reports/balance-sheet', authorizePermission('accounting.reports', 'accounting.view'), validate(balanceSheetQuerySchema), asyncHandler(async (req, res) => {
  const { date, asOfDate, currency } = (req.query as ValidatedQuery<typeof balanceSheetQuerySchema>) || {};
  const data = await AccountingService.getBalanceSheet({
    date: (date || asOfDate) as string,
    currency: currency as string,
  });
  res.json({ report: data, ...data });
}));

// V3 PHASE 5: بازرس هوشمند سلامت مالی و ممیزی دفاتر (Financial Health Inspector)
router.get('/accounting/reports/health-check', authorizePermission('accounting.reports', 'accounting.view'), asyncHandler(async (req, res) => {
  const report = await AccountingService.runFinancialHealthCheck();
  res.json(report);
}));

// ==========================================
// PROJECT REPORT & DOC SIGNATURES (V10-PHASE6)
// ==========================================

/** ردیف خام SQL گزارش per-project (ستون‌های numeric در node-postgres رشته برمی‌گردند). */
type ProjectSummaryRow = {
  project_id: number | null;
  project_code: string | null;
  project_title: string | null;
  entries_count: number | string | null;
  total_debit: number | string | null;
  total_credit: number | string | null;
};

/** ردیف خام SQL ریز گردش یک پروژه. */
type ProjectDetailRow = {
  line_id: number;
  voucher_number: number | string | null;
  voucher_date: string | null;
  voucher_description: string | null;
  account_code: string;
  account_name: string;
  line_description: string | null;
  debit: number | string | null;
  credit: number | string | null;
};

// V10-6.1: گزارش حسابداری per-project — خلاصه گردش بدهکار/بستانکار به تفکیک پروژه
router.get('/accounting/reports/project-summary', authorizePermission('accounting.reports', 'accounting.view'), asyncHandler(async (req, res) => {
  const result = await orm.execute(sql`
    SELECT jvi.detailed_id AS project_id,
           MAX(pp.project_code) AS project_code,
           MAX(pp.title) AS project_title,
           COUNT(jvi.id)::int AS entries_count,
           COALESCE(SUM(jvi.debit), 0) AS total_debit,
           COALESCE(SUM(jvi.credit), 0) AS total_credit
    FROM journal_voucher_items jvi
    INNER JOIN journal_vouchers jv ON jv.id = jvi.voucher_id AND jv.is_deleted = 0
    LEFT JOIN production_projects pp ON pp.id = jvi.detailed_id
    WHERE jvi.detailed_type = 'project'
    GROUP BY jvi.detailed_id
    ORDER BY MAX(pp.created_at) DESC NULLS LAST
  `);

  const rows = (result.rows || []) as ProjectSummaryRow[];
  res.json(rows.map(r => ({
    projectId: r.project_id,
    projectCode: r.project_code || '',
    projectTitle: r.project_title || 'پروژه نامشخص / حذف‌شده',
    entriesCount: Number(r.entries_count) || 0,
    totalDebit: Number(r.total_debit) || 0,
    totalCredit: Number(r.total_credit) || 0,
    balance: (Number(r.total_debit) || 0) - (Number(r.total_credit) || 0)
  })));
}));

// V10-6.1: ریز گردش یک پروژه با تراز جاری (read-model ساده، بدون سطح ۵)
router.get('/accounting/reports/project-detail', authorizePermission('accounting.reports', 'accounting.view'), validate(projectDetailQuerySchema), asyncHandler(async (req, res) => {
  const projectId = Number(req.query.projectId);

  const result = await orm.execute(sql`
    SELECT jvi.id AS line_id,
           jv.voucher_number AS voucher_number,
           jv.date AS voucher_date,
           jv.description AS voucher_description,
           COALESCE(a.code, '') AS account_code,
           COALESCE(a.name, '') AS account_name,
           jvi.description AS line_description,
           jvi.debit, jvi.credit
    FROM journal_voucher_items jvi
    INNER JOIN journal_vouchers jv ON jv.id = jvi.voucher_id AND jv.is_deleted = 0
    LEFT JOIN accounts a ON a.id = jvi.account_id
    WHERE jvi.detailed_type = 'project' AND jvi.detailed_id = ${projectId}
    ORDER BY jv.date ASC, jv.id ASC, jvi.id ASC
  `);

  const rows = (result.rows || []) as ProjectDetailRow[];
  let running = 0;
  const detail = rows.map(r => {
    const debit = Number(r.debit) || 0;
    const credit = Number(r.credit) || 0;
    running += debit - credit;
    return {
      voucherNumber: r.voucher_number || '-',
      voucherDate: r.voucher_date,
      voucherDescription: r.voucher_description || '',
      accountCode: r.account_code,
      accountName: r.account_name,
      lineDescription: r.line_description || '',
      debit,
      credit,
      runningBalance: running
    };
  });

  res.json({ projectId, detail });
}));

// V10-6.2: تاییدکنندگان سند از تاریخچه ورکفلو — برای بخش امضای چاپ
router.get('/accounting/doc-signatures', authorizePermission('accounting.reports', 'accounting.view', 'documents.view'), validate(docSignaturesQuerySchema), asyncHandler(async (req, res) => {
  const entityId = String(req.query.entityId || '').trim();

  const instances = await orm
    .select({ id: workflowInstances.id })
    .from(workflowInstances)
    .where(and(eq(workflowInstances.entityType, 'document'), eq(workflowInstances.entityId, entityId)));

  if (instances.length === 0) {
    return res.json({ signatures: [] });
  }

  const instanceIds = instances.map(i => i.id);
  const logs = await orm
    .select({
      name: workflowHistoryLogs.performedByName,
      actionKey: workflowHistoryLogs.actionKey,
      actionTitle: workflowHistoryLogs.actionTitle,
      createdAt: workflowHistoryLogs.createdAt,
      stateTitle: workflowStates.title
    })
    .from(workflowHistoryLogs)
    .leftJoin(workflowStates, eq(workflowHistoryLogs.toStateId, workflowStates.id))
    .where(and(
      eq(workflowHistoryLogs.instanceId, instanceIds[0]),
      eq(workflowHistoryLogs.actionKey, 'approve')
    ))
    .orderBy(workflowHistoryLogs.createdAt);

  const signatures = logs
    .filter(l => (l.name || '').trim() !== '')
    .map(l => ({
      name: l.name,
      roleTitle: l.stateTitle || l.actionTitle || 'تایید کننده',
      date: l.createdAt
    }))
    .slice(0, 3);

  res.json({ signatures });
}));

export default router;
