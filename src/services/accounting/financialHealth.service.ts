import { orm } from '../../db/drizzle.js';
import { sql, asc, and, eq, or, like } from 'drizzle-orm';
import { documents, legacyDateRepairs, refFiscalYearCorrections } from '../../db/schema.js';
import { containsLikePattern } from '../../lib/sqlLike.js';
import { fin } from '../../lib/financialDecimal.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { findDuplicateVoucherNumbers, hasVoucherNumberUniqueIndex } from './voucherNumberIntegrity.js';
import { buildNoVoucherTreasuryHealthTest, findTreasuryEntriesWithoutVoucher } from './treasury/noVoucherTreasury.js';
import { buildLegacyChequePartyHealthTest, findLegacyChequePartyMismatches } from './treasury/chequePartyAccount.js';
import { buildFutureStockMovementHealthTest, findFutureStockMovements } from '../inventory/futureStockMovements.js';
import { buildOpeningVoucherHealthTest, findOpeningVoucherMismatches } from '../inventory/itemOpeningValue.js';
import { buildReservedWarehouseCodeHealthTest, findReservedCodeWarehouses } from '../inventory/reservedWarehouseCode.js';
import {
  buildEarlyClosedYearsHealthTest, buildManualClosingTypeHealthTest, buildOutOfOrderClosedYearsHealthTest,
  findEarlyClosedYears, findManualClosingTypeVouchers, findOutOfOrderClosedYears,
} from './fiscalClosingHealth.js';
import { buildUnknownPriceTitleHealthTest, findUnknownPriceTitles } from '../items/itemPriceTitles.js';
import { buildForeignRateHealthTest, findVouchersWithoutForeignRate } from './voucherForeignRateHealth.js';
import { buildPayrollVoucherHealthTest, findPayrollVoucherMismatches } from '../piecework/payrollVoucherHealth.js';
import { buildPersonnelRateHealthTest, findDuplicatePersonnelRates, hasPersonnelRateUniqueIndex } from '../piecework/personnelRate.js';
import { buildItemIdentityHealthTest, findDuplicateItemIdentities, hasItemIdentityIndexes } from '../items/itemIdentity.js';
import { buildDuplicateActivePriceHealthTest, buildInvalidActivePriceHealthTest, findDuplicateActivePrices, findInvalidActivePrices } from '../items/itemPriceIntegrity.js';
import {
  buildAccountMappingHealthTest, buildDeletedAccountRowsHealthTest, buildNonLatinAccountCodeHealthTest, buildNonPostingRowsHealthTest,
  findAccountMappingIssues, findDeletedAccountsWithVoucherRows, findNonLatinAccountCodes, findVouchersOnNonPostingAccounts,
} from './chartOfAccountsHealth.js';
import { buildAccountingIntegrityHealthTest, findAccountingIntegrityGaps } from './accountingConstraintHealth.js';
import { buildPayslipDeductionsHealthTest, findPayslipDeductionsInPrepayments } from './payrollDeductionHealth.js';
import { buildCategoryIntegrityHealthTest, findCategoryIntegrityIssues, hasCategoryNameUniqueIndex } from '../items/itemCategoryIdentity.js';
import { buildCustomerNameHealthTest, findDuplicateCustomerNames, hasCustomerNameUniqueIndex } from '../customers/customerNameIntegrity.js';
import { buildUnlinkedPartyDocumentHealthTest, findUnlinkedPartyDocuments } from '../documents/documentParty.js';
import { buildDocumentIntegrityHealthTest, findDocumentIntegrityGaps } from '../documents/documentConstraintHealth.js';
import {
  buildOverReservedHealthTest, buildProjectReservationHealthTest, findOverReservedItems, findProjectReservationIssues,
} from '../projects/projectReservationHealth.js';
import { buildOpenInstanceHealthTest, findDuplicateOpenInstances, hasOpenInstanceUniqueIndex } from '../workflow/workflowOpenInstances.js';
import { buildWorkflowReferenceHealthTest, findWorkflowReferenceGaps } from '../workflow/workflowReferenceIntegrity.js';
import { buildUnguardedDocumentApprovalHealthTest, findUnguardedDocumentApprovals } from '../workflow/docApprovalGuards.js';
import { buildWorkflowRoleReviewHealthTest, findWorkflowRoleReviews } from '../workflow/workflowRoleReview.js';
import { buildPersonnelCodeHealthTest, findDuplicatePersonnelCodes, hasPersonnelCodeUniqueIndex } from '../personnel/personnelCode.js';
import { buildSyntheticUsersHealthTest, findActiveSyntheticUsers } from '../users/syntheticUserHealth.js';
import { buildPersonnelUserLinkHealthTest, findDuplicatePersonnelUserLinks, hasPersonnelUserUniqueIndex } from '../personnel/personnelUserLink.js';
import {
  findDuplicatePieceworkTaskCodes,
  hasPieceworkTaskCodeUniqueIndex,
  pieceworkTaskCodeKey,
  type DuplicatePieceworkTaskCodeRow,
} from '../piecework/taskCode.js';
import type {
  FinancialHealthReport,
  HealthCheckTestResult,
  HealthCheckIssueItem,
  HealthCheckStatus,
} from '../../types.js';
import { formatPersianNumber, formatPersianPrice, toStorageDate, isoToJalaliDate } from '../../utils.js';

/**
 * TD-246 (تصمیم «قید یکتا»): آزمون یکتایی کد عناوین کاری فعال پرکیسی. مهاجرت 0037 ایندکس یکتا را روی داده دارای
 * کد تکراری نمی‌سازد و کدها خودکار عوض نمی‌شوند؛ این آزمون کدهای تکراری را با شناسه عناوین فهرست می‌کند.
 */
export function buildPieceworkTaskCodeHealthTest(
  duplicates: DuplicatePieceworkTaskCodeRow[],
  uniqueIndexPresent: boolean
): HealthCheckTestResult {
  const idsByKey = new Map<string, number[]>();
  for (const r of duplicates) {
    const key = pieceworkTaskCodeKey(r.code);
    idsByKey.set(key, [...(idsByKey.get(key) ?? []), r.id]);
  }
  const duplicateCodeCount = idsByKey.size;
  const penalty = Math.min(10, duplicateCodeCount * 2);
  return {
    id: 'piecework_task_code_uniqueness',
    category: 'system',
    title: 'یکتایی کد عناوین کاری کارمزدی',
    description: 'دو عنوان کاری فعال نباید کد یکسان داشته باشند (بدون توجه به حروف بزرگ/کوچک و فاصله)؛ پایگاه‌داده با ایندکس یکتا از کد تکراری جلوگیری می‌کند',
    status: duplicateCodeCount > 0 || !uniqueIndexPresent ? 'warning' : 'healthy',
    scoreImpact: -penalty,
    count: duplicateCodeCount,
    message: duplicateCodeCount > 0
      ? `${duplicateCodeCount} کد بین بیش از یک عنوان کاری فعال مشترک است و قید یکتایی کد در پایگاه‌داده اعمال نشده است؛ کدها خودکار تغییر داده نمی‌شوند و باید یکی از عناوین هم‌کد ویرایش یا حذف شود.`
      : (uniqueIndexPresent
        ? 'کد تکراری بین عناوین کاری فعال وجود ندارد و پایگاه‌داده از ثبت کد تکراری جلوگیری می‌کند.'
        : 'کد تکراری بین عناوین کاری فعال وجود ندارد اما قید یکتایی کد در پایگاه‌داده اعمال نشده است.'),
    items: duplicates.map((r) => {
      const ids = idsByKey.get(pieceworkTaskCodeKey(r.code)) ?? [r.id];
      return {
        id: r.id,
        code: r.code,
        title: r.title,
        subtitle: `عنوان کاری #${r.id} | دسته: ${r.category || '—'} | ${r.isActive === 0 ? 'غیرفعال' : 'فعال'}`,
        details: `عناوین هم‌کد: ${ids.map((id) => `#${id}`).join('، ')} (TD-246).`,
      };
    }),
    metrics: { duplicateCodes: duplicateCodeCount, duplicateTaskRows: duplicates.length, uniqueIndexPresent: uniqueIndexPresent ? 1 : 0 },
  };
}

/** v7.0.136 (TD-232): تاریخ زیرعنوان یافته‌ها شمسی نمایش داده می‌شود؛ مقدار غیرتاریخی همان‌طور می‌ماند */
const jalaliLabel = (v: unknown): string => {
  const raw = typeof v === 'string' ? v : v instanceof Date ? v.toISOString() : '';
  return isoToJalaliDate(raw) || String(v ?? '').substring(0, 10);
};

/**
 * v8.0.16 (TD-260): ردیف‌های فعال اسناد تأییدشده و دائم با مبلغ ریالی — همان قاعده تراز آزمایشی و کارت حساب
 * (`voucherItemAmount.ts`): ردیف ریالی با مبلغ خودش و ردیف ارزی با نرخ همان ردیف، گرد به ریال. پیش‌تر مانده‌ها مبلغ
 * خام ردیف ارزی را با ریال جمع می‌زدند (۲ دلار = ۲ ریال).
 */
const IRR_VOUCHER_ITEMS = sql.raw(`
  SELECT vi.account_id,
         CASE WHEN UPPER(COALESCE(NULLIF(vi.currency, ''), NULLIF(v.currency, ''), 'IRR')) = 'IRR' THEN vi.debit
              ELSE ROUND(vi.debit * COALESCE(NULLIF(vi.exchange_rate, 0), 1), 0) END AS debit_irr,
         CASE WHEN UPPER(COALESCE(NULLIF(vi.currency, ''), NULLIF(v.currency, ''), 'IRR')) = 'IRR' THEN vi.credit
              ELSE ROUND(vi.credit * COALESCE(NULLIF(vi.exchange_rate, 0), 1), 0) END AS credit_irr
    FROM journal_voucher_items vi
    JOIN journal_vouchers v ON vi.voucher_id = v.id AND v.is_deleted = 0 AND v.status IN ('approved', 'permanent')
   WHERE vi.is_deleted = 0`);

export class FinancialHealthService {
  /**
   * اجرای جامع اسکن سلامت دفاتر و آزمون‌های ممیزی خودکار
   */
  static async runHealthCheck(): Promise<FinancialHealthReport> {
    const startTime = Date.now();

    // 1. محاسبه تاریخ جاری میلادی و شمسی
    const now = new Date();
    // v7.0.133: «امروز» کسب‌وکار (منطقه زمانی توافقی) برای سررسید چک‌ها
    const businessToday = await businessTodayIsoDate();
    const todayJalaliParts = new Intl.DateTimeFormat('fa-IR-u-nu-latn', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    // تبدیل / به فرمت استاندارد 1403/06/15
    const todayJalali = todayJalaliParts.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

    // اجرای همزمان کوئری‌های آماری و پایشی برای حداکثر سرعت (< 100 میلی‌ثانیه)
    const [
      statsRes,
      unbalancedVouchersRes,
      unnaturalAccountsRes,
      inventoryPhysicalRes,
      inventoryLedgerRes,
      unlinkedDocsRes,
      abandonedDraftsRes,
      overdueChequesRes,
      bankMappingRes,
      duplicateDocVouchersRes,
    ] = await Promise.all([
      // الف: آمار کل رکوردها
      orm.execute(sql`
        SELECT 
          (SELECT COUNT(*)::int FROM journal_vouchers WHERE is_deleted = 0) AS total_vouchers,
          (SELECT COUNT(*)::int FROM journal_voucher_items vi JOIN journal_vouchers v ON vi.voucher_id = v.id WHERE v.is_deleted = 0 AND vi.is_deleted = 0) AS total_voucher_items,
          (SELECT COUNT(*)::int FROM accounts WHERE is_deleted = 0) AS total_accounts,
          (SELECT COUNT(*)::int FROM documents WHERE is_deleted = 0) AS total_documents,
          (SELECT COUNT(*)::int FROM cheques WHERE is_deleted = 0) AS total_cheques,
          (SELECT COUNT(*)::int FROM items WHERE is_deleted = 0) AS total_items
      `),

      // ب: آزمون تراز اسناد دوبل (Voucher Balance) — v9.0.190 (TD-551، ت۷): سند تک‌ارزی روی مبلغ خام و سند چندارزی به
      // ریال با قاعده TD-260 (ردیف ارزی × نرخ همان ردیف، گرد به ریال)؛ پیش‌تر «۱۰۰ دلار / ۱۰۰ ریال» تراز شمرده می‌شد
      orm.execute(sql`
        WITH rows AS (
          SELECT vi.voucher_id, vi.debit, vi.credit,
                 UPPER(COALESCE(NULLIF(vi.currency, ''), NULLIF(v.currency, ''), 'IRR')) AS cur,
                 COALESCE(NULLIF(vi.exchange_rate, 0), 1) AS rate
            FROM journal_voucher_items vi
            JOIN journal_vouchers v ON v.id = vi.voucher_id
           -- v8.0.15 (TD-270): ردیف‌های حذف نرم‌شده (همگام‌سازی دوباره سند پیش‌نویس) در هیچ آزمونی شمرده نمی‌شوند
           WHERE vi.is_deleted = 0
        ), sums AS (
          SELECT voucher_id,
                 COUNT(DISTINCT cur) AS currency_count,
                 SUM(debit) AS raw_debit, SUM(credit) AS raw_credit,
                 SUM(CASE WHEN cur = 'IRR' THEN debit ELSE ROUND(debit * rate, 0) END) AS irr_debit,
                 SUM(CASE WHEN cur = 'IRR' THEN credit ELSE ROUND(credit * rate, 0) END) AS irr_credit
            FROM rows GROUP BY voucher_id
        ), checked AS (
          SELECT v.id, v.voucher_number, v.date, v.status, v.description,
                 COALESCE(CASE WHEN s.currency_count > 1 THEN s.irr_debit ELSE s.raw_debit END, 0) AS calc_debit,
                 COALESCE(CASE WHEN s.currency_count > 1 THEN s.irr_credit ELSE s.raw_credit END, 0) AS calc_credit
            FROM journal_vouchers v
            LEFT JOIN sums s ON s.voucher_id = v.id
           WHERE v.is_deleted = 0
        )
        SELECT id, voucher_number, date, status, description,
               calc_debit::float AS calc_debit, calc_credit::float AS calc_credit,
               ABS(calc_debit - calc_credit)::float AS discrepancy
          FROM checked
         WHERE ABS(calc_debit - calc_credit) > 0.05
         ORDER BY voucher_number DESC
         LIMIT 50;
      `),

      // ج: آزمون حساب‌های با مانده خلاف ماهیت (Unnatural Balances)
      orm.execute(sql`
        SELECT 
          a.id,
          a.code,
          a.name,
          a.level,
          a.nature,
          a.account_type,
          COALESCE(SUM(vi.debit_irr), 0)::float AS total_debit,
          COALESCE(SUM(vi.credit_irr), 0)::float AS total_credit,
          (COALESCE(SUM(vi.debit_irr), 0) - COALESCE(SUM(vi.credit_irr), 0))::float AS net_balance
        FROM accounts a
        JOIN (${IRR_VOUCHER_ITEMS}) vi ON vi.account_id = a.id
        WHERE a.is_deleted = 0 AND a.level IN ('subsidiary', 'general')
        GROUP BY a.id, a.code, a.name, a.level, a.nature, a.account_type
        HAVING (a.nature = 'debit' AND (COALESCE(SUM(vi.debit_irr), 0) - COALESCE(SUM(vi.credit_irr), 0)) < -100)
            OR (a.nature = 'credit' AND (COALESCE(SUM(vi.credit_irr), 0) - COALESCE(SUM(vi.debit_irr), 0)) < -100)
        ORDER BY ABS(COALESCE(SUM(vi.debit_irr), 0) - COALESCE(SUM(vi.credit_irr), 0)) DESC
        LIMIT 50;
      `),

      // د: ارزش فیزیکی انبار فقط به بهای تمام‌شده میانگین موزون (v8.0.116، TD-401): کالای بی‌WAC ارزش صفر می‌گیرد و
      // جدا شمرده می‌شود (هرگز قیمت فهرست فروش، P2-4)؛ جمع در SQL به متن و در سرور با FinancialDecimal (§1.8)
      orm.execute(sql`
        SELECT 
          COUNT(*)::int AS total_items_count,
          COALESCE(SUM(CASE WHEN current_stock > 0 AND weighted_average_cost > 0 THEN current_stock * weighted_average_cost ELSE 0 END), 0)::text AS total_physical_valuation,
          COALESCE(SUM(CASE WHEN current_stock > 0 AND COALESCE(weighted_average_cost, 0) <= 0 THEN 1 ELSE 0 END), 0)::int AS unvalued_stock_count,
          COALESCE(SUM(CASE WHEN current_stock < 0 THEN 1 ELSE 0 END), 0)::int AS negative_stock_count
        FROM items
        WHERE is_deleted = 0;
      `),

      // هـ: مانده دفاتر حسابداری در گروه ۱۴ (موجودی مواد و کالا)
      orm.execute(sql`
        SELECT 
          COALESCE(SUM(vi.debit_irr - vi.credit_irr), 0)::text AS total_ledger_valuation
        FROM (${IRR_VOUCHER_ITEMS}) vi
        JOIN accounts a ON vi.account_id = a.id AND a.is_deleted = 0
        WHERE a.code LIKE '14%';
      `),

      // و: فاکتورهای نهایی بدون سند دوبل
      orm.execute(sql`
        SELECT 
          d.id,
          d.type,
          d.ref_number,
          d.date::text,
          d.buyer_name,
          d.status,
          COALESCE(SUM(di.quantity * di.unit_price - di.discount), 0)::float AS total_amount
        FROM documents d
        LEFT JOIN document_items di ON di.document_id = d.id AND di.is_deleted = 0
        -- v7.0.31 (TD-193): پیوند صریح سند حسابداری به سند انبار؛ انواع هم‌راستا با AUTO_VOUCHER_DOC_TYPES
        LEFT JOIN journal_vouchers v ON v.source_document_id = d.id AND v.is_deleted = 0
        WHERE d.is_deleted = 0 
          AND d.status = 'final' 
          AND d.type IN ('invoice', 'receipt', 'production_receipt', 'purchase', 'remittance', 'waste', 'return') 
          AND v.id IS NULL
        GROUP BY d.id, d.type, d.ref_number, d.date, d.buyer_name, d.status
        ORDER BY d.id DESC
        LIMIT 50;
      `),

      // ز: پیش‌نویس‌های معلق قدیمی (بیش از ۱۴ روز)
      orm.execute(sql`
        SELECT 
          d.id,
          d.type,
          d.ref_number,
          d.date::text,
          d.buyer_name,
          d.status,
          COALESCE(SUM(di.quantity * di.unit_price - di.discount), 0)::float AS total_amount
        FROM documents d
        LEFT JOIN document_items di ON di.document_id = d.id AND di.is_deleted = 0
        WHERE d.is_deleted = 0 
          AND d.status IN ('draft', 'proforma')
          AND d.date < (NOW() - INTERVAL '14 days')
        GROUP BY d.id, d.type, d.ref_number, d.date, d.buyer_name, d.status
        ORDER BY d.id DESC
        LIMIT 50;
      `),

      // ح: چک‌های دریافتی یا پرداختی در جریان
      orm.execute(sql`
        SELECT 
          c.id,
          c.type,
          c.cheque_number,
          c.sayad_number,
          c.bank_name,
          c.party_name,
          c.amount::float AS amount,
          c.due_date,
          c.status
        FROM cheques c
        WHERE c.is_deleted = 0 
          AND c.status IN ('received', 'in_treasury', 'in_collection')
        ORDER BY c.due_date ASC
        LIMIT 100;
      `),

      // ط: حساب‌های بانکی و صندوق‌ها بدون کد معین متصل
      orm.execute(sql`
        SELECT 
          b.id,
          b.code,
          b.title,
          b.type,
          b.current_balance::float AS current_balance,
          b.account_id,
          a.code AS account_code,
          a.name AS account_name
        FROM bank_accounts b
        LEFT JOIN accounts a ON b.account_id = a.id AND a.is_deleted = 0
        WHERE b.is_deleted = 0
        ORDER BY b.id ASC;
      `),

      // ی: v7.0.31 (TD-193 / P1-8) اسناد حسابداری تکراری قدیمی یک سند انبار/فاکتور (حاصل همزمانی بوت چند Pod)
      // که پیوند source_document_id نگرفته‌اند و هنوز معکوس نشده‌اند — تصمیم با حسابدار است
      orm.execute(sql`
        SELECT
          v.id,
          v.voucher_number,
          v.date,
          v.status,
          v.total_debit::float AS amount,
          d.id AS doc_id,
          d.type AS doc_type,
          d.ref_number,
          p.voucher_number AS primary_voucher_number
        FROM journal_vouchers v
        JOIN documents d ON d.id = v.reference_id AND v.reference_number = d.ref_number
        JOIN journal_vouchers p ON p.source_document_id = d.id AND p.is_deleted = 0
        WHERE v.is_deleted = 0
          AND v.reference_module = 'invoice'
          AND v.source_document_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM journal_vouchers r
            WHERE r.reference_id = v.id AND r.reference_number = 'REV-V' || v.voucher_number AND r.is_deleted = 0
          )
        ORDER BY v.id DESC
        LIMIT 50;
      `)
    ]);

    // پردازش آمارهای پایه
    const statsRow = (statsRes.rows?.[0] || {}) as {
      total_vouchers?: number;
      total_voucher_items?: number;
      total_accounts?: number;
      total_documents?: number;
      total_cheques?: number;
      total_items?: number;
    };

    const scannedStats = {
      totalVouchers: Number(statsRow.total_vouchers) || 0,
      totalVoucherItems: Number(statsRow.total_voucher_items) || 0,
      totalAccounts: Number(statsRow.total_accounts) || 0,
      totalDocuments: Number(statsRow.total_documents) || 0,
      totalCheques: Number(statsRow.total_cheques) || 0,
      totalItems: Number(statsRow.total_items) || 0,
    };

    const tests: HealthCheckTestResult[] = [];
    let overallScore = 100;

    // =========================================================================
    // آزمون ۱: تراز اسناد حسابداری (Voucher Balance Integrity)
    // =========================================================================
    const unbalancedRows = (unbalancedVouchersRes.rows || []) as Array<{
      id: number;
      voucher_number: number;
      date: string;
      status: string;
      description: string;
      calc_debit: number;
      calc_credit: number;
      discrepancy: number;
    }>;

    if (unbalancedRows.length === 0) {
      tests.push({
        id: 'vouchers_balance',
        category: 'vouchers',
        title: 'تراز و تعادل اسناد دوبل حسابداری',
        description: 'بررسی عدم وجود سند ناتراز یا اختلاف ریالی بین بدهکار و بستانکار در کلیه اسناد',
        status: 'healthy',
        scoreImpact: 0,
        count: 0,
        message: 'تمام اسناد ثبت‌شده در سیستم دارای توازن کامل بین جمع بدهکار و بستانکار هستند.',
        metrics: {
          totalVouchersChecked: scannedStats.totalVouchers,
          unbalancedCount: 0,
        },
      });
    } else {
      const penalty = Math.min(40, unbalancedRows.length * 20);
      overallScore -= penalty;
      tests.push({
        id: 'vouchers_balance',
        category: 'vouchers',
        title: 'تراز و تعادل اسناد دوبل حسابداری',
        description: 'بررسی عدم وجود سند ناتراز یا اختلاف ریالی بین بدهکار و بستانکار در کلیه اسناد',
        status: 'error',
        scoreImpact: -penalty,
        count: unbalancedRows.length,
        message: `${unbalancedRows.length} سند حسابداری با مغایرت ریالی بین بدهکار و بستانکار شناسایی شد!`,
        quickFixHint: 'اصلاح آرتیکل‌ها در ویرایش سند جهت برقراری تعادل',
        quickFixAction: 'open_vouchers',
        items: unbalancedRows.map(r => ({
          id: r.id,
          code: `سند #${r.voucher_number}`,
          title: r.description || `سند شماره ${r.voucher_number}`,
          subtitle: `تاریخ: ${jalaliLabel(r.date)} — بدهکار: ${formatPersianPrice(r.calc_debit)} | بستانکار: ${formatPersianPrice(r.calc_credit)}`,
          amount: r.discrepancy,
          discrepancy: r.discrepancy,
          date: r.date,
          details: `اختلاف ناترازی: ${formatPersianPrice(r.discrepancy)} ریال`,
          linkType: 'voucher',
          linkId: r.id,
        })),
        metrics: {
          totalVouchersChecked: scannedStats.totalVouchers,
          unbalancedCount: unbalancedRows.length,
        },
      });
    }

    // =========================================================================
    // آزمون ۲: حساب‌های با مانده خلاف ماهیت (Unnatural Balances)
    // =========================================================================
    const unnaturalRows = (unnaturalAccountsRes.rows || []) as Array<{
      id: number;
      code: string;
      name: string;
      level: string;
      nature: string;
      account_type: string;
      total_debit: number;
      total_credit: number;
      net_balance: number;
    }>;

    if (unnaturalRows.length === 0) {
      tests.push({
        id: 'unnatural_balances',
        category: 'accounts',
        title: 'صحت ماهیت مانده حساب‌ها (عدم مانده خلاف ماهیت)',
        description: 'بررسی بدهکار یا بستانکار بودن حساب‌ها مطابق ماهیت تعریف‌شده دارایی، بدهی، درآمد و هزینه',
        status: 'healthy',
        scoreImpact: 0,
        count: 0,
        message: 'هیچ حسابی با مانده خلاف ماهیت (مانند صندوق یا بانک منفی یا بدهی با مانده بدهکار) مشاهده نشد.',
        metrics: {
          accountsChecked: scannedStats.totalAccounts,
          unnaturalCount: 0,
        },
      });
    } else {
      const hasBankOrCashUnnatural = unnaturalRows.some(r => r.code.startsWith('10'));
      const penalty = Math.min(25, (hasBankOrCashUnnatural ? 15 : 5) + (unnaturalRows.length - 1) * 3);
      overallScore -= penalty;

      const issueItems: HealthCheckIssueItem[] = unnaturalRows.map(r => {
        const expectedPersian = r.nature === 'debit' ? 'بدهکار' : 'بستانکار';
        const actualPersian = r.nature === 'debit' ? 'بستانکار' : 'بدهکار';
        const absBalance = Math.abs(r.net_balance);
        return {
          id: r.id,
          code: r.code,
          title: `حساب ${r.code} - ${r.name}`,
          subtitle: `ماهیت استاندارد: ${expectedPersian} | مانده فعلی: ${actualPersian} (${formatPersianPrice(absBalance)} ریال)`,
          amount: absBalance,
          details: `گردش بدهکار: ${formatPersianPrice(r.total_debit)} | گردش بستانکار: ${formatPersianPrice(r.total_credit)}`,
          linkType: 'account',
          linkId: r.id,
        };
      });

      tests.push({
        id: 'unnatural_balances',
        category: 'accounts',
        title: 'صحت ماهیت مانده حساب‌ها (مانده خلاف ماهیت)',
        description: 'بررسی بدهکار یا بستانکار بودن حساب‌ها مطابق ماهیت تعریف‌شده دارایی، بدهی، درآمد و هزینه',
        status: hasBankOrCashUnnatural ? 'error' : 'warning',
        scoreImpact: -penalty,
        count: unnaturalRows.length,
        message: `${unnaturalRows.length} حساب با مانده خلاف ماهیت شناسایی شد.${hasBankOrCashUnnatural ? ' (شامل حساب‌های نقد و بانک)' : ''}`,
        quickFixHint: 'بررسی کارت حساب و صدور اسناد اصلاحی یا ثبت واریزی‌های معوق',
        items: issueItems,
        metrics: {
          accountsChecked: scannedStats.totalAccounts,
          unnaturalCount: unnaturalRows.length,
        },
      });
    }

    // =========================================================================
    // آزمون ۳: انطباق ارزش موجودی انبار با دفاتر حسابداری کالا (Account 14)
    // =========================================================================
    const physicalData = (inventoryPhysicalRes.rows?.[0] || {}) as {
      total_items_count?: number;
      total_physical_valuation?: string;
      unvalued_stock_count?: number;
      negative_stock_count?: number;
    };
    const ledgerData = (inventoryLedgerRes.rows?.[0] || {}) as {
      total_ledger_valuation?: string;
    };

    const warehouseValDec = fin(physicalData.total_physical_valuation).round(0);
    const ledgerValDec = fin(ledgerData.total_ledger_valuation).round(0);
    const invDiscrepancyDec = warehouseValDec.subtract(ledgerValDec).abs();
    const warehouseVal = warehouseValDec.toNumber();
    const ledgerVal = ledgerValDec.toNumber();
    const unvaluedStockCount = Number(physicalData.unvalued_stock_count) || 0;
    const negativeStockCount = Number(physicalData.negative_stock_count) || 0;
    const invDiscrepancy = invDiscrepancyDec.toNumber();
    const maxVal = Math.max(warehouseVal, ledgerVal, 1);
    const invDiscrepancyPercent = Number(((invDiscrepancy / maxVal) * 100).toFixed(1));

    const unvaluedNote = unvaluedStockCount > 0
      ? ` ${formatPersianNumber(unvaluedStockCount)} کالای دارای موجودی هنوز بهای تمام‌شده ندارد و با ارزش صفر شمرده شد.`
      : '';

    if (invDiscrepancy <= 1000 && negativeStockCount === 0) {
      tests.push({
        id: 'inventory_reconciliation',
        category: 'inventory',
        title: 'انطباق ریالی موجودی انبار با دفتر کل حسابداری',
        description: 'بررسی هم‌خوانی ارزش کاردکس و موجودی کالای فیزیکی با سرفصل ۱۴ (موجودی مواد و کالا)',
        status: 'healthy',
        scoreImpact: 0,
        count: 0,
        message: 'ارزش کاردکس فیزیکی انبار با مانده سرفصل کل ۱۴ حسابداری در تراز کامل قرار دارد.' + unvaluedNote,
        metrics: {
          warehouseValuation: warehouseVal,
          ledgerValuation: ledgerVal,
          discrepancy: invDiscrepancy,
          discrepancyPercent: invDiscrepancyPercent,
          negativeStockCount,
          unvaluedStockCount,
        },
      });
    } else {
      let penalty = 0;
      let status: HealthCheckStatus = 'warning';
      if (negativeStockCount > 0) {
        penalty += 10;
        status = 'error';
      }
      if (invDiscrepancyPercent > 5) {
        penalty += 15;
      } else if (invDiscrepancyPercent > 1) {
        penalty += 5;
      }
      overallScore -= penalty;

      const itemsList: HealthCheckIssueItem[] = [];
      if (negativeStockCount > 0) {
        itemsList.push({
          id: 'neg_stock',
          title: 'کالاهای دارای موجودی منفی فیزیکی',
          subtitle: `${negativeStockCount} قلم کالا دارای موجودی فیزیکی کمتر از صفر هستند که نیازمند انبارگردانی یا ثبت رسید خرید است.`,
          details: 'موجودی منفی باعث خطا در بهای تمام شده میانگین موزون می‌شود.',
          linkType: 'item',
        });
      }
      if (unvaluedStockCount > 0) {
        itemsList.push({
          id: 'unvalued_stock',
          title: 'کالاهای دارای موجودی بدون بهای تمام‌شده',
          subtitle: `${formatPersianNumber(unvaluedStockCount)} قلم کالا موجودی دارند ولی میانگین موزون ندارند و در ارزش انبار صفر شمرده شدند.`,
          details: 'ارزش انبار فقط به بهای تمام‌شده سنجیده می‌شود، نه قیمت فهرست فروش؛ رسید با قیمت یا بهای اولیه کالا را ثبت کنید.',
          linkType: 'item',
        });
      }
      if (invDiscrepancy > 1000) {
        itemsList.push({
          id: 'inv_diff',
          title: 'اختلاف ریالی ارزش انبار و مانده دفتر کل کالا',
          subtitle: `ارزش کاردکس انبار: ${formatPersianPrice(warehouseVal)} ریال | مانده دفتر کل (حساب ۱۴): ${formatPersianPrice(ledgerVal)} ریال`,
          amount: invDiscrepancy,
          discrepancy: invDiscrepancy,
          details: `درصد انحراف: ${invDiscrepancyPercent}٪ — علل متداول: فاکتورهای خرید بدون سند دوبل یا ثبت نشدن سند بهای تمام شده کالای فروش‌رفته (COGS).`,
        });
      }

      tests.push({
        id: 'inventory_reconciliation',
        category: 'inventory',
        title: 'انطباق ریالی موجودی انبار با دفتر کل حسابداری',
        description: 'بررسی هم‌خوانی ارزش کاردکس و موجودی کالای فیزیکی با سرفصل ۱۴ (موجودی مواد و کالا)',
        status,
        scoreImpact: -penalty,
        count: (negativeStockCount > 0 ? 1 : 0) + (invDiscrepancy > 1000 ? 1 : 0),
        message: negativeStockCount > 0
          ? `${negativeStockCount} کالای دارای موجودی منفی و اختلاف ریالی ${formatPersianPrice(invDiscrepancy)} ریال مشاهده شد.`
          : `مغایرت ریالی ${formatPersianPrice(invDiscrepancy)} ریالی (${invDiscrepancyPercent}٪) بین ارزش انبار و دفاتر ثبت شده است.`,
        quickFixHint: 'ثبت اسناد انبارگردانی و صدور اسناد مکانیزه ورود و خروج انبار',
        items: itemsList,
        metrics: {
          warehouseValuation: warehouseVal,
          ledgerValuation: ledgerVal,
          discrepancy: invDiscrepancy,
          discrepancyPercent: invDiscrepancyPercent,
          negativeStockCount,
          unvaluedStockCount,
        },
      });
    }

    // =========================================================================
    // آزمون ۴: فاکتورهای نهایی فاقد سند دوبل و پیش‌نویس‌های بلاتکلیف
    // =========================================================================
    const unlinkedRows = (unlinkedDocsRes.rows || []) as Array<{
      id: number;
      type: string;
      ref_number: string;
      date: string;
      buyer_name: string;
      status: string;
      total_amount: number;
    }>;
    const abandonedRows = (abandonedDraftsRes.rows || []) as Array<{
      id: number;
      type: string;
      ref_number: string;
      date: string;
      buyer_name: string;
      status: string;
      total_amount: number;
    }>;

    const totalDocIssues = unlinkedRows.length + abandonedRows.length;

    if (totalDocIssues === 0) {
      tests.push({
        id: 'commercial_docs_unlinked',
        category: 'documents',
        title: 'پوشش اسناد حسابداری فاکتورها و وضعیت پیش‌نویس‌ها',
        description: 'اطمینان از صدور خودکار سند دوبل برای تمام فاکتورهای نهایی و عدم انباشت پیش‌نویس‌های قدیمی',
        status: 'healthy',
        scoreImpact: 0,
        count: 0,
        message: 'تمام فاکتورها و رسیدهای نهایی دارای سند حسابداری متصل بوده و پیش‌نویس معوق وجود ندارد.',
        metrics: {
          documentsChecked: scannedStats.totalDocuments,
          unlinkedFinalDocs: 0,
          abandonedDrafts: 0,
        },
      });
    } else {
      const penalty = Math.min(20, unlinkedRows.length * 4 + abandonedRows.length * 2);
      overallScore -= penalty;

      const itemsList: HealthCheckIssueItem[] = [];
      for (const d of unlinkedRows) {
        itemsList.push({
          id: d.id,
          code: `سند تجاری #${d.ref_number}`,
          title: `فاکتور نهایی فاقد سند: ${d.ref_number} (${d.buyer_name || 'بدون نام'})`,
          subtitle: `نوع: ${d.type} | مبلغ کل: ${formatPersianPrice(d.total_amount)} ریال | تاریخ: ${jalaliLabel(d.date)}`,
          amount: d.total_amount,
          date: d.date?.substring(0, 10),
          linkType: 'document',
          linkId: d.id,
          details: 'فاکتور نهایی شده اما در دفاتر مالی سندی برای آن ثبت نشده است.',
        });
      }
      for (const d of abandonedRows.slice(0, 10)) {
        itemsList.push({
          id: d.id,
          code: `پیش‌نویس #${d.ref_number}`,
          title: `پیش‌نویس معوق قدیمی: ${d.ref_number} (${d.buyer_name || 'بدون نام'})`,
          subtitle: `تاریخ ایجاد: ${jalaliLabel(d.date)} — بیش از ۱۴ روز در وضعیت معلق قرار دارد.`,
          amount: d.total_amount,
          date: d.date?.substring(0, 10),
          linkType: 'document',
          linkId: d.id,
          details: 'تعیین تکلیف یا ابطال پیش‌نویس‌های بدون اقدام توصیه می‌شود.',
        });
      }

      tests.push({
        id: 'commercial_docs_unlinked',
        category: 'documents',
        title: 'پوشش اسناد حسابداری فاکتورها و وضعیت پیش‌نویس‌ها',
        description: 'اطمینان از صدور خودکار سند دوبل برای تمام فاکتورهای نهایی و عدم انباشت پیش‌نویس‌های قدیمی',
        status: unlinkedRows.length > 0 ? 'warning' : 'healthy',
        scoreImpact: -penalty,
        count: totalDocIssues,
        message: `${unlinkedRows.length} فاکتور نهایی فاقد سند حسابداری و ${abandonedRows.length} پیش‌نویس معوق یافت شد.`,
        quickFixHint: 'صدور مکانیزه اسناد حسابداری برای فاکتورهای نهایی معوق',
        quickFixAction: 'sync_vouchers',
        items: itemsList,
        metrics: {
          documentsChecked: scannedStats.totalDocuments,
          unlinkedFinalDocs: unlinkedRows.length,
          abandonedDrafts: abandonedRows.length,
        },
      });
    }

    // =========================================================================
    // آزمون ۵: چک‌های سررسیدگذشته بلاتکلیف (Overdue Cheques)
    // =========================================================================
    const chequesRows = (overdueChequesRes.rows || []) as Array<{
      id: number;
      type: string;
      cheque_number: string;
      sayad_number: string;
      bank_name: string;
      party_name: string;
      amount: number;
      due_date: string;
      status: string;
    }>;

    // پالایش چک‌هایی که تاریخ سررسید آن‌ها قبل از امروز است
    const overdueList: Array<typeof chequesRows[0] & { daysOverdue: number }> = [];
    for (const chq of chequesRows) {
      if (!chq.due_date) continue;
      // v7.0.133 (TD-232): سررسید میلادی ISO ذخیره می‌شود (مقدار قدیمی شمسی هم تبدیل می‌شود)
      const dueIso = toStorageDate(chq.due_date);
      if (dueIso && dueIso < businessToday) {
        const daysOverdue = Math.max(1, Math.round((Date.parse(businessToday) - Date.parse(dueIso)) / (1000 * 60 * 60 * 24)));
        overdueList.push({ ...chq, daysOverdue });
      }
    }

    if (overdueList.length === 0) {
      tests.push({
        id: 'overdue_cheques',
        category: 'treasury',
        title: 'چک‌های سررسیدگذشته بلاتکلیف در جریان خزانه‌داری',
        description: 'بررسی چک‌های دریافتی یا پرداختی که تاریخ سررسید آن‌ها گذشته ولی هنوز وصول، واخواست یا عودت نشده‌اند',
        status: 'healthy',
        scoreImpact: 0,
        count: 0,
        message: 'هیچ چک سررسیدگذشته بلاتکلیفی در خزانه‌داری یافت نشد؛ تمام اسناد وضعیت‌دهی شده‌اند.',
        metrics: {
          totalPendingChequesChecked: chequesRows.length,
          overdueChequesCount: 0,
        },
      });
    } else {
      const penalty = Math.min(15, overdueList.length * 3);
      overallScore -= penalty;

      tests.push({
        id: 'overdue_cheques',
        category: 'treasury',
        title: 'چک‌های سررسیدگذشته بلاتکلیف در جریان خزانه‌داری',
        description: 'بررسی چک‌های دریافتی یا پرداختی که تاریخ سررسید آن‌ها گذشته ولی هنوز وصول، واخواست یا عودت نشده‌اند',
        status: 'warning',
        scoreImpact: -penalty,
        count: overdueList.length,
        message: `${overdueList.length} فقره چک سررسیدگذشته در خزانه‌داری همچنان بدون ثبت وصولی یا واخواست باقی مانده‌اند.`,
        quickFixHint: 'ثبت وصول، خواباندن به حساب یا واخواست در بخش مدیریت چک‌ها',
        quickFixAction: 'open_treasury',
        items: overdueList.map(c => ({
          id: c.id,
          code: `چک #${c.cheque_number}`,
          title: `چک ${c.type === 'received' ? 'دریافتی' : 'پرداختی'} - ${c.party_name || 'طرف‌حساب نامشخص'}`,
          subtitle: `بانک ${c.bank_name} | سررسید: ${isoToJalaliDate(c.due_date) || c.due_date} (${c.daysOverdue} روز تأخیر) | مبلغ: ${formatPersianPrice(c.amount)} ریال`,
          amount: c.amount,
          date: c.due_date,
          linkType: 'cheque',
          linkId: c.id,
          details: `صیاد: ${c.sayad_number || 'فاقد شناسه صیاد'} — وضعیت فعلی: ${c.status}`,
        })),
        metrics: {
          totalPendingChequesChecked: chequesRows.length,
          overdueChequesCount: overdueList.length,
        },
      });
    }

    // =========================================================================
    // آزمون ۶: پیوند کدهای معین حساب‌های بانکی و صندوق‌ها
    // =========================================================================
    const bankRows = (bankMappingRes.rows || []) as Array<{
      id: number;
      code: string;
      title: string;
      type: string;
      current_balance: number;
      account_id: number | null;
      account_code: string | null;
      account_name: string | null;
    }>;

    const unlinkedBanks = bankRows.filter(b => !b.account_id);

    if (unlinkedBanks.length === 0) {
      tests.push({
        id: 'bank_accounts_mapping',
        category: 'treasury',
        title: 'پیوند حساب‌های بانکی و صندوق‌ها به سرفصل‌های معین',
        description: 'بررسی اتصال مستقیم هر حساب بانکی، صندوق یا پوز به کد معین حسابداری برای ثبت خودکار اسناد خزانه',
        status: 'healthy',
        scoreImpact: 0,
        count: 0,
        message: 'کلیه حساب‌های بانکی و صندوق‌ها به سرفصل‌های معین حسابداری متصل هستند.',
        metrics: {
          totalBankAccounts: bankRows.length,
          unlinkedCount: 0,
        },
      });
    } else {
      const penalty = Math.min(15, unlinkedBanks.length * 5);
      overallScore -= penalty;

      tests.push({
        id: 'bank_accounts_mapping',
        category: 'treasury',
        title: 'پیوند حساب‌های بانکی و صندوق‌ها به سرفصل‌های معین',
        description: 'بررسی اتصال مستقیم هر حساب بانکی، صندوق یا پوز به کد معین حسابداری برای ثبت خودکار اسناد خزانه',
        status: 'warning',
        scoreImpact: -penalty,
        count: unlinkedBanks.length,
        message: `${unlinkedBanks.length} حساب بانکی یا صندوق فاقد اتصال به کد حساب معین در سیستم است.`,
        quickFixHint: 'ویرایش اطلاعات حساب بانکی در خزانه‌داری و انتخاب سرفصل معین مربوطه',
        quickFixAction: 'open_treasury',
        items: unlinkedBanks.map(b => ({
          id: b.id,
          code: b.code,
          title: `${b.title} (${b.type})`,
          subtitle: `موجودی ثبت‌شده: ${formatPersianPrice(b.current_balance)} ریال — فاقد کد معین`,
          amount: b.current_balance,
          linkType: 'bank_account',
          linkId: b.id,
          details: 'برای صدور خودکار اسناد دریافت و پرداخت، تعیین کد معین الزامی است.',
        })),
        metrics: {
          totalBankAccounts: bankRows.length,
          unlinkedCount: unlinkedBanks.length,
        },
      });
    }

    // =========================================================================
    // آزمون ۷: v7.0.31 (TD-193) اسناد حسابداری تکراری یک سند انبار/فاکتور (ثبت دوباره درآمد/هزینه)
    // =========================================================================
    const duplicateRows = (duplicateDocVouchersRes.rows || []) as Array<{
      id: number;
      voucher_number: number;
      date: string;
      status: string;
      amount: number;
      doc_id: number;
      doc_type: string;
      ref_number: string;
      primary_voucher_number: number;
    }>;

    if (duplicateRows.length === 0) {
      tests.push({
        id: 'duplicate_document_vouchers',
        category: 'vouchers',
        title: 'یکتایی سند حسابداری اسناد انبار و فاکتورها',
        description: 'هر سند انبار یا فاکتور نهایی باید دقیقاً یک سند حسابداری فعال داشته باشد',
        status: 'healthy',
        scoreImpact: 0,
        count: 0,
        message: 'هیچ سند حسابداری تکراری برای اسناد انبار و فاکتورها یافت نشد.',
      });
    } else {
      const penalty = Math.min(25, duplicateRows.length * 5);
      overallScore -= penalty;
      tests.push({
        id: 'duplicate_document_vouchers',
        category: 'vouchers',
        title: 'یکتایی سند حسابداری اسناد انبار و فاکتورها',
        description: 'هر سند انبار یا فاکتور نهایی باید دقیقاً یک سند حسابداری فعال داشته باشد',
        status: 'error',
        scoreImpact: -penalty,
        count: duplicateRows.length,
        message: `${duplicateRows.length} سند حسابداری تکراری یافت شد که مبلغ سند انبار/فاکتور را دوباره در دفاتر ثبت کرده است؛ پس از بررسی، سند تکراری را با «صدور سند معکوس» خنثی کنید.`,
        quickFixHint: 'بررسی و صدور سند معکوس برای اسناد حسابداری تکراری',
        quickFixAction: 'open_vouchers',
        items: duplicateRows.map((r) => ({
          id: r.id,
          code: `سند حسابداری #${r.voucher_number}`,
          title: `سند تکراری برای سند شماره ${r.ref_number} (${r.doc_type})`,
          subtitle: `سند اصلی: #${r.primary_voucher_number} | وضعیت سند تکراری: ${r.status} | تاریخ: ${jalaliLabel(r.date)}`,
          amount: r.amount,
          date: String(r.date || '').substring(0, 10),
          linkType: 'voucher' as const,
          linkId: r.id,
          details: 'این سند پیش از v7.0.31 به‌صورت تکراری صادر شده است و به‌صورت خودکار تغییر داده نمی‌شود.',
        })),
        metrics: { duplicateVouchers: duplicateRows.length },
      });
    }

    // =========================================================================
    // آزمون ۸: v7.0.62 (TD-179) اصلاح سال مالی شماره‌گذاری اسناد روز مرزی نوروز (مهاجرت 0024)
    // =========================================================================
    const fyCorrections = await orm.select().from(refFiscalYearCorrections).orderBy(asc(refFiscalYearCorrections.id));
    const fyConflicts = fyCorrections.filter((c) => c.status === 'conflict');
    const fyPenalty = Math.min(10, fyConflicts.length * 2);
    overallScore -= fyPenalty;
    tests.push({
      id: 'ref_fiscal_year_boundary_corrections',
      category: 'documents',
      title: 'سال مالی شماره‌گذاری اسناد روز نوروز',
      description: 'اسنادی که پیش از v7.0.62 در روز ۲۰ مارس سال‌هایی با نوروز ۲۰ مارس ثبت شده بودند در سال مالی قبل شماره خورده بودند؛ سال مالی آن‌ها بدون تغییر شماره عطف اصلاح شد',
      status: fyConflicts.length > 0 ? 'warning' : 'healthy',
      scoreImpact: -fyPenalty,
      count: fyConflicts.length,
      message: fyCorrections.length === 0
        ? 'هیچ سندی در روز مرزی نوروز با سال مالی نادرست یافت نشد.'
        : `${fyCorrections.length - fyConflicts.length} سند به سال مالی درست منتقل شد${fyConflicts.length > 0 ? `؛ ${fyConflicts.length} سند به‌دلیل هم‌شماره بودن با سندی در سال مالی جدید منتقل نشد و باید بررسی شود` : ''}.`,
      quickFixAction: fyConflicts.length > 0 ? 'open_documents' : undefined,
      items: fyCorrections.map((c) => ({
        id: c.id,
        code: `سند ${c.refNumber}`,
        title: c.status === 'conflict'
          ? `منتقل نشد: هم‌شماره با سندی از نوع ${c.docType} در سال ${c.newFiscalYear}`
          : `از سال ${c.oldFiscalYear} به ${c.newFiscalYear} منتقل شد`,
        subtitle: `نوع: ${c.docType} | تاریخ: ${jalaliLabel(c.documentDate)}`,
        date: String(c.documentDate || '').substring(0, 10),
        linkType: 'document' as const,
        linkId: c.documentId,
        details: 'شماره عطف سند تغییر نکرده است.',
      })),
      metrics: { corrected: fyCorrections.length - fyConflicts.length, conflicts: fyConflicts.length },
    });

    // =========================================================================
    // آزمون ۹: v7.0.80 (TD-199) پیش‌فاکتورهای پیش از v7.0.32 که مالیات را فقط در متن یادداشت دارند
    // =========================================================================
    // تا v7.0.31 فرم فاکتور مالیات را به‌صورت «[ارزش افزوده: …]» به یادداشت می‌افزود؛ با تصمیم مالک محصول این داده منتقل
    // نشد. چنین پیش‌فاکتوری اگر بدون ویرایش نهایی شود، فاکتور و سند حسابداری بدون مالیات صادر می‌شوند.
    const legacyVatProformas = await orm
      .select({ id: documents.id, refNumber: documents.refNumber, date: documents.date, buyerName: documents.buyerName })
      .from(documents)
      .where(and(
        eq(documents.isDeleted, 0),
        or(eq(documents.status, 'proforma'), eq(documents.type, 'proforma')),
        sql`${documents.status} <> 'final'`,
        sql`COALESCE(${documents.vatAmount}, 0) = 0`,
        like(documents.notes, containsLikePattern('[ارزش افزوده:')),
      ))
      .orderBy(asc(documents.id));
    tests.push({
      id: 'legacy_proforma_vat_in_notes',
      category: 'documents',
      title: 'پیش‌فاکتورهای قدیمی با مالیات فقط در یادداشت',
      description: 'پیش‌فاکتورهای ثبت‌شده پیش از v7.0.32 مالیات را فقط در متن یادداشت دارند و بدون ویرایش، بدون مالیات نهایی می‌شوند',
      status: legacyVatProformas.length > 0 ? 'warning' : 'healthy',
      scoreImpact: 0,
      count: legacyVatProformas.length,
      message: legacyVatProformas.length === 0
        ? 'هیچ پیش‌فاکتور بازی با مالیات ثبت‌شده فقط در یادداشت یافت نشد.'
        : `${legacyVatProformas.length} پیش‌فاکتور باز مالیات را فقط در یادداشت دارد؛ پیش از نهایی‌سازی آن را در فرم ویرایش باز و مالیات را دوباره فعال کنید.`,
      quickFixAction: legacyVatProformas.length > 0 ? 'open_documents' : undefined,
      items: legacyVatProformas.map((d) => ({
        id: d.id,
        code: `پیش‌فاکتور ${d.refNumber}`,
        title: `خریدار: ${d.buyerName || '—'}`,
        subtitle: `تاریخ: ${jalaliLabel(d.date)}`,
        date: String(d.date || '').substring(0, 10),
        linkType: 'document' as const,
        linkId: d.id,
        details: 'مالیات این پیش‌فاکتور در ستون مالیات ثبت نشده است (TD-199).',
      })),
      metrics: { legacyVatProformas: legacyVatProformas.length },
    });

    // =========================================================================
    // آزمون ۱۰: v7.0.82 (TD-231) اصلاح تاریخ‌های قدیمی «07-10-1405 AP» (مهاجرت 0030)
    // =========================================================================
    const allDateRepairs = await orm.select().from(legacyDateRepairs).orderBy(asc(legacyDateRepairs.id));
    const dateRepairs = allDateRepairs.filter((r) => r.repairKind === 'mdy');
    const refusedDateRepairs = dateRepairs.filter((r) => r.status === 'refused');
    const dateRepairTableLabel: Record<string, string> = {
      journal_vouchers: 'سند حسابداری',
      treasury_transactions: 'تراکنش خزانه',
      piecework_payrolls: 'فیش حقوقی',
    };
    tests.push({
      id: 'legacy_mdy_date_repairs',
      category: 'vouchers',
      title: 'اصلاح تاریخ‌های قدیمی با قالب ماه-روز-سال',
      description: 'تا v7.0.73 برخی اسناد افتتاحیه، اسناد و تراکنش‌های پرداخت حقوق تاریخ «07-10-1405» گرفته بودند؛ این تاریخ‌ها به قالب درست برگردانده شدند و مقدار قبلی نگه داشته شد',
      status: refusedDateRepairs.length > 0 ? 'warning' : 'healthy',
      scoreImpact: 0,
      count: refusedDateRepairs.length,
      message: dateRepairs.length === 0
        ? 'هیچ تاریخی با قالب قدیمی ماه-روز-سال یافت نشد.'
        : `${dateRepairs.length - refusedDateRepairs.length} تاریخ اصلاح شد${refusedDateRepairs.length > 0 ? `؛ ${refusedDateRepairs.length} سند حسابداری در سال مالی بسته اصلاح نشد و باید بررسی شود` : ''}.`,
      quickFixAction: refusedDateRepairs.length > 0 ? 'open_vouchers' : undefined,
      items: dateRepairs.map((r) => ({
        id: r.id,
        code: `${dateRepairTableLabel[r.tableName] ?? r.tableName} #${r.rowId}`,
        title: r.status === 'refused'
          ? `اصلاح نشد: ${r.reason || ''} (تاریخ فعلی ${r.oldValue})`
          : `تاریخ «${r.oldValue}» به «${r.newValue}» اصلاح شد`,
        subtitle: `ستون: ${r.columnName}`,
        date: r.newValue,
        ...(r.tableName === 'journal_vouchers' ? { linkType: 'voucher' as const, linkId: r.rowId } : {}),
        details: 'مقدار قبلی در جدول legacy_date_repairs نگه داشته شده است.',
      })),
      metrics: { corrected: dateRepairs.length - refusedDateRepairs.length, refused: refusedDateRepairs.length },
    });

    // =========================================================================
    // آزمون ۱۰-ب: v7.0.131 (TD-232) یکسان‌سازی تاریخ‌های متنی به میلادی ISO (مهاجرت 0038 و بعدی‌ها)
    // =========================================================================
    const calendarRepairs = allDateRepairs.filter((r) => r.repairKind === 'calendar');
    const refusedCalendarRepairs = calendarRepairs.filter((r) => r.status === 'refused');
    tests.push({
      id: 'calendar_date_unification',
      category: 'system',
      title: 'یکسان‌سازی تقویم تاریخ‌ها',
      description: 'تاریخ‌های متنی که شمسی یا با قالب‌های مختلف ذخیره شده بودند به قالب واحد ذخیره (میلادی) برگردانده شدند و همه‌جا شمسی نمایش داده می‌شوند؛ مقدار قبلی هر ردیف نگه داشته شد',
      status: refusedCalendarRepairs.length > 0 ? 'warning' : 'healthy',
      scoreImpact: 0,
      count: refusedCalendarRepairs.length,
      message: calendarRepairs.length === 0
        ? 'تاریخی برای یکسان‌سازی یافت نشد.'
        : `${calendarRepairs.length - refusedCalendarRepairs.length} تاریخ یکسان‌سازی شد${refusedCalendarRepairs.length > 0 ? `؛ ${refusedCalendarRepairs.length} تاریخ قابل تشخیص نبود و دست نخورد — باید دستی اصلاح شود` : ''}.`,
      items: calendarRepairs.map((r) => ({
        id: r.id,
        code: `${r.tableName} #${r.rowId}`,
        title: r.status === 'refused'
          ? `اصلاح نشد: ${r.reason || ''} (مقدار فعلی «${r.oldValue}»)`
          : `«${r.oldValue}» به «${r.newValue}» تبدیل شد`,
        subtitle: `ستون: ${r.columnName}`,
        date: r.status === 'refused' ? '' : r.newValue,
        details: 'مقدار قبلی در جدول legacy_date_repairs نگه داشته شده است.',
      })),
      metrics: { corrected: calendarRepairs.length - refusedCalendarRepairs.length, refused: refusedCalendarRepairs.length },
    });

    // =========================================================================
    // آزمون ۱۱: v7.0.91 (TD-195) یکتایی شماره سند حسابداری (مهاجرت 0031)
    // =========================================================================
    const [duplicateNumbers, uniqueIndexPresent] = await Promise.all([findDuplicateVoucherNumbers(), hasVoucherNumberUniqueIndex()]);
    const duplicateNumberCount = new Set(duplicateNumbers.map((r) => r.voucherNumber)).size;
    const numberPenalty = Math.min(20, duplicateNumberCount * 5);
    overallScore -= numberPenalty;
    tests.push({
      id: 'voucher_number_uniqueness',
      category: 'vouchers',
      title: 'یکتایی شماره سند حسابداری',
      description: 'هر سند حسابداری باید شماره‌ای داشته باشد که سند دیگری ندارد؛ پایگاه‌داده با ایندکس یکتا از شماره تکراری جلوگیری می‌کند',
      status: duplicateNumberCount > 0 ? 'error' : (uniqueIndexPresent ? 'healthy' : 'warning'),
      scoreImpact: -numberPenalty,
      count: duplicateNumberCount,
      message: duplicateNumberCount > 0
        ? `${duplicateNumberCount} شماره سند بین بیش از یک سند حسابداری مشترک است و قید یکتایی شماره سند در پایگاه‌داده اعمال نشده است؛ شماره‌ها خودکار تغییر داده نمی‌شوند و اصلاح آن‌ها با تصمیم حسابدار است.`
        : (uniqueIndexPresent
          ? 'شماره تکراری وجود ندارد و پایگاه‌داده از ثبت شماره تکراری جلوگیری می‌کند.'
          : 'شماره تکراری وجود ندارد اما قید یکتایی شماره سند در پایگاه‌داده اعمال نشده است.'),
      quickFixAction: duplicateNumberCount > 0 ? 'open_vouchers' : undefined,
      items: duplicateNumbers.map((r) => ({
        id: r.id,
        code: `سند حسابداری #${r.voucherNumber}`,
        title: r.description,
        subtitle: `نوع: ${r.voucherType || '—'} | وضعیت: ${r.isDeleted === 1 ? 'حذف‌شده' : (r.status || '—')} | تاریخ: ${jalaliLabel(r.date)}`,
        date: String(r.date || '').substring(0, 10),
        linkType: 'voucher' as const,
        linkId: r.id,
        details: 'شماره این سند با سند دیگری یکی است (TD-195).',
      })),
      metrics: { duplicateNumbers: duplicateNumberCount, duplicateVoucherRows: duplicateNumbers.length, uniqueIndexPresent: uniqueIndexPresent ? 1 : 0 },
    });

    // =========================================================================
    // آزمون ۱۲: TD-246 یکتایی کد عناوین کاری فعال پرکیسی (مهاجرت 0037)
    // =========================================================================
    const [duplicateTaskCodes, taskCodeIndexPresent] = await Promise.all([findDuplicatePieceworkTaskCodes(), hasPieceworkTaskCodeUniqueIndex()]);
    const taskCodeTest = buildPieceworkTaskCodeHealthTest(duplicateTaskCodes, taskCodeIndexPresent);
    overallScore += taskCodeTest.scoreImpact;
    tests.push(taskCodeTest);

    // آزمون ۱۳: v8.0.118 (TD-409) تراکنش‌های خزانه و چک‌های ثبت‌شده «بدون سند حسابداری» (فقط با مجوز جدا)
    tests.push(buildNoVoucherTreasuryHealthTest(await findTreasuryEntriesWithoutVoucher()));
    // v9.0.84 (TD-497): چک‌های پیشین که سندشان با نوع طرف حساب نمی‌خواند (بازنویسی نمی‌شوند)
    tests.push(buildLegacyChequePartyHealthTest(await findLegacyChequePartyMismatches()));

    // آزمون ۱۴: v9.0.8 (TD-420) یکتایی نام طرف حساب‌های فعال (مهاجرت 0052)
    const [duplicateCustomerNames, customerNameIndexPresent] = await Promise.all([findDuplicateCustomerNames(), hasCustomerNameUniqueIndex()]);
    const customerNameTest = buildCustomerNameHealthTest(duplicateCustomerNames, customerNameIndexPresent);
    overallScore += customerNameTest.scoreImpact;
    tests.push(customerNameTest);

    // آزمون ۱۵: v9.0.24 (TD-435) هر کاربر حداکثر به یک پرسنل فعال (مهاجرت 0053)
    const [duplicateUserLinks, personnelUserIndexPresent] = await Promise.all([findDuplicatePersonnelUserLinks(), hasPersonnelUserUniqueIndex()]);
    const personnelUserLinkTest = buildPersonnelUserLinkHealthTest(duplicateUserLinks, personnelUserIndexPresent);
    overallScore += personnelUserLinkTest.scoreImpact;
    tests.push(personnelUserLinkTest);

    // آزمون ۱۶: v9.0.28 (TD-439) یکتایی کد پرسنلی پرسنل فعال (مهاجرت 0054)
    const [duplicatePersonnelCodes, personnelCodeIndexPresent] = await Promise.all([findDuplicatePersonnelCodes(), hasPersonnelCodeUniqueIndex()]);
    const personnelCodeTest = buildPersonnelCodeHealthTest(duplicatePersonnelCodes, personnelCodeIndexPresent);
    overallScore += personnelCodeTest.scoreImpact;
    tests.push(personnelCodeTest);

    // آزمون ۱۷: v9.0.35 (TD-445) اقدام قطعی‌سازی بی نقش و بی مجوز در گردش کار فعال اسناد
    const unguardedApprovalTest = buildUnguardedDocumentApprovalHealthTest(await findUnguardedDocumentApprovals());
    overallScore += unguardedApprovalTest.scoreImpact;
    tests.push(unguardedApprovalTest);

    // آزمون ۱۷ب: v9.0.128 (TD-542) گام‌های گردش کاری که مهاجرت 0065 برای بازبینی نقش فهرست کرد
    const workflowRoleReviewTest = buildWorkflowRoleReviewHealthTest(await findWorkflowRoleReviews());
    overallScore += workflowRoleReviewTest.scoreImpact;
    tests.push(workflowRoleReviewTest);

    // آزمون ۱۸: v9.0.37 (TD-455) یک فرایند در جریان برای هر موجودیت (مهاجرت 0056)
    const [duplicateOpenInstances, openInstanceIndexPresent] = await Promise.all([findDuplicateOpenInstances(), hasOpenInstanceUniqueIndex()]);
    const openInstanceTest = buildOpenInstanceHealthTest(duplicateOpenInstances, openInstanceIndexPresent);
    overallScore += openInstanceTest.scoreImpact;
    tests.push(openInstanceTest);

    // آزمون ۱۹: v9.0.51 (TD-461) کلیدهای خارجی گردش کار و یکتایی شماره نسخه تعریف (مهاجرت 0059)
    const workflowReferenceTest = buildWorkflowReferenceHealthTest(await findWorkflowReferenceGaps());
    overallScore += workflowReferenceTest.scoreImpact;
    tests.push(workflowReferenceTest);

    // آزمون ۲۰: v9.0.76 (TD-521) کاربران فعال با پیشوند کاربران آزمون (test_، e2e_، testuser_)
    const syntheticUsersTest = buildSyntheticUsersHealthTest(await findActiveSyntheticUsers());
    overallScore += syntheticUsersTest.scoreImpact;
    tests.push(syntheticUsersTest);

    // آزمون ۲۱: v9.0.79 (TD-483) گردش کاردکس با تاریخ پس از امروز (فقط فهرست، بی بازنویسی)
    const futureMovementTest = buildFutureStockMovementHealthTest(await findFutureStockMovements());
    overallScore += futureMovementTest.scoreImpact;
    tests.push(futureMovementTest);

    // آزمون ۲۲: v9.0.93 (TD-481) سند افتتاحیه کالا برابر ردیف‌های افتتاحیه کاردکس (فقط فهرست، بی بازنویسی)
    const openingVoucherTest = buildOpeningVoucherHealthTest(await findOpeningVoucherMismatches());
    overallScore += openingVoucherTest.scoreImpact;
    tests.push(openingVoucherTest);

    // آزمون ۲۳: v9.0.110 (TD-482) انبار با کد رزرو کاردکس «default» (فقط فهرست، بی تغییر خودکار)
    const reservedWarehouseCodeTest = buildReservedWarehouseCodeHealthTest(await findReservedCodeWarehouses());
    overallScore += reservedWarehouseCodeTest.scoreImpact;
    tests.push(reservedWarehouseCodeTest);

    // آزمون ۲۴: v9.0.152 (TD-647) قیمت فعال کالا با عنوانی بیرون از فهرست‌های قیمت تنظیم‌شده (فقط فهرست، بی پاک‌سازی)
    const unknownPriceTitleTest = buildUnknownPriceTitleHealthTest(await findUnknownPriceTitles());
    overallScore += unknownPriceTitleTest.scoreImpact;
    tests.push(unknownPriceTitleTest);

    // آزمون ۲۵: v9.0.160 (TD-559) اسناد دستی با نوع اختتامیه که بستن سال صادر نکرده (فقط فهرست، بی بازنویسی)
    tests.push(buildManualClosingTypeHealthTest(await findManualClosingTypeVouchers()));
    tests.push(buildForeignRateHealthTest(await findVouchersWithoutForeignRate())); // v9.0.190 (TD-551)

    // آزمون ۲۶: v9.0.161 (TD-543) سال مالی بسته‌شده پیش از پایانش (فقط فهرست؛ آخرین سال بسته با بازگشایی باز می‌شود)
    tests.push(buildEarlyClosedYearsHealthTest(await findEarlyClosedYears()));

    // آزمون ۲۷: v9.0.162 (TD-544) سال مالی بسته‌شده پیش از سال‌های پیشینِ دارای سند خود (فقط فهرست، بی اصلاح خودکار)
    tests.push(buildOutOfOrderClosedYearsHealthTest(await findOutOfOrderClosedYears()));

    // آزمون ۲۸: v9.0.170 (TD-653) کد یا نام مشترک میان کالاهای فعال (فقط فهرست، بی تغییر خودکار)
    const itemIdentityTest = buildItemIdentityHealthTest(await findDuplicateItemIdentities(), await hasItemIdentityIndexes());
    overallScore += itemIdentityTest.scoreImpact;
    tests.push(itemIdentityTest);

    // آزمون ۲۹: v9.0.175 (TD-660) بیش از یک قیمت فعال برای یک فهرست قیمت کالا (فقط فهرست، بی پاک‌سازی)
    const duplicatePriceTest = buildDuplicateActivePriceHealthTest(await findDuplicateActivePrices());
    overallScore += duplicatePriceTest.scoreImpact;
    tests.push(duplicatePriceTest);

    // آزمون ۳۰: v9.0.176 (TD-657) قیمت فعال با مبلغ صفر یا منفی یا ارز بیرون از فهرست §6 (فقط فهرست، بی تغییر خودکار)
    const invalidPriceTest = buildInvalidActivePriceHealthTest(await findInvalidActivePrices());
    overallScore += invalidPriceTest.scoreImpact;
    tests.push(invalidPriceTest);

    // آزمون ۳۱: v9.0.197 (TD-546) حساب حذف‌شده‌ای که ردیف سند دارد (فقط فهرست، بی احیای خودکار)
    tests.push(buildDeletedAccountRowsHealthTest(await findDeletedAccountsWithVoucherRows()));
    // آزمون ۳۲: v9.0.198 (TD-549) ردیف سند روی حساب گروه، کل یا دارای زیرحساب (فقط فهرست، بی بازنویسی)
    tests.push(buildNonPostingRowsHealthTest(await findVouchersOnNonPostingAccounts()));
    // آزمون ۳۳: v9.0.199 (TD-550) نگاشت حساب سندهای خودکار به حساب ناموجود، غیرقابل ثبت یا ناسازگار (فقط فهرست)
    tests.push(buildAccountMappingHealthTest(await findAccountMappingIssues()));
    // آزمون ۳۴: v9.0.201 (TD-558) کد حساب با رقم فارسی یا نویسه غیررقمی (فقط فهرست، بی بازنویسی)
    tests.push(buildNonLatinAccountCodeHealthTest(await findNonLatinAccountCodes()));
    // آزمون ۳۵: v9.0.202 (TD-562) قید پایگاه‌داده سند و سرفصل اعتبارسنجی‌نشده یا ردیف قدیمی ناسازگار (فقط فهرست)
    tests.push(buildAccountingIntegrityHealthTest(await findAccountingIntegrityGaps()));
    // آزمون ۳۶: v9.0.205 (TD-658) نام دسته‌بندی تکراری و کالای فعال با دسته‌ای که نیست (فقط فهرست، بی تغییر خودکار)
    const categoryIntegrityTest = buildCategoryIntegrityHealthTest(await findCategoryIntegrityIssues(), await hasCategoryNameUniqueIndex());
    overallScore += categoryIntegrityTest.scoreImpact;
    tests.push(categoryIntegrityTest);
    // آزمون ۳۷: v9.0.266 (TD-804) فیش حقوقی با پاداش یا کسورات منفی، بی سند یا ناهمخوان با سند (فقط فهرست، بی بازنویسی)
    tests.push(buildPayrollVoucherHealthTest(await findPayrollVoucherMismatches()));
    // آزمون ۳۸: v9.0.284 (TD-809) بیش از یک نرخ اختصاصی فعال برای یک پرسنل و عنوان کار (مهاجرت 0076؛ فقط فهرست)
    const [duplicatePersonnelRates, personnelRateIndexPresent] = await Promise.all([findDuplicatePersonnelRates(), hasPersonnelRateUniqueIndex()]);
    const personnelRateTest = buildPersonnelRateHealthTest(duplicatePersonnelRates, personnelRateIndexPresent);
    overallScore += personnelRateTest.scoreImpact;
    tests.push(personnelRateTest);
    // آزمون ۳۹: v9.0.286 (TD-554) کسورات فیش حقوق که سندهای پیشین در ۳۲۰۲ «پیش‌دریافت‌ها از مشتریان» گذاشته‌اند (فقط فهرست)
    tests.push(buildPayslipDeductionsHealthTest(await findPayslipDeductionsInPrepayments()));
    // آزمون ۴۰: v9.0.336 (TD-778) سند فروش و خرید با نام خریدار و بی شناسه طرف حساب (فقط فهرست، بی بازنویسی)
    tests.push(buildUnlinkedPartyDocumentHealthTest(await findUnlinkedPartyDocuments()));
    // آزمون ۴۱: v9.0.338 (TD-786) قید پایگاه‌داده سند و ردیف سند اعتبارسنجی‌نشده یا ردیف قدیمی ناسازگار (فقط فهرست)
    tests.push(buildDocumentIntegrityHealthTest(await findDocumentIntegrityGaps()));
    // آزمون ۴۲: v9.0.349 (TD-817) رزرو پروژه ناهمخوان با ثبت نهایی (پروژه‌های قدیمی؛ فقط فهرست، بی بازنویسی)
    tests.push(buildProjectReservationHealthTest(await findProjectReservationIssues()));
    // آزمون ۴۳: v9.0.351 (TD-819) کالای بیش از موجودی رزروشده (فقط فهرست)
    tests.push(buildOverReservedHealthTest(await findOverReservedItems()));

    // =========================================================================
    // محاسبه امتیاز نهایی، سطح کیفی و خلاصه آزمون‌ها
    // =========================================================================
    const boundedScore = Math.max(0, Math.min(100, overallScore));

    let healthGrade = 'عالی (تراز و استاندارد کامل)';
    let healthStatus: HealthCheckStatus = 'healthy';

    if (boundedScore >= 90) {
      healthGrade = 'عالی (تراز و استاندارد کامل)';
      healthStatus = 'healthy';
    } else if (boundedScore >= 75) {
      healthGrade = 'خوب (چند هشدار جزئی نیازمند توجه)';
      healthStatus = 'warning';
    } else if (boundedScore >= 50) {
      healthGrade = 'هشدار ممیزی (نیازمند رسیدگی و اصلاح اسناد)';
      healthStatus = 'warning';
    } else {
      healthGrade = 'بحرانی (دارای خطاهای ساختاری در دفاتر مالی)';
      healthStatus = 'error';
    }

    const healthyTestsCount = tests.filter(t => t.status === 'healthy').length;
    const warningTestsCount = tests.filter(t => t.status === 'warning').length;
    const errorTestsCount = tests.filter(t => t.status === 'error').length;
    const totalIssuesCount = tests.reduce((acc, t) => acc + (t.count || 0), 0);

    const scanDurationMs = Date.now() - startTime;

    return {
      overallScore: boundedScore,
      healthGrade,
      healthStatus,
      scannedAt: now.toISOString(),
      scannedAtJalali: todayJalali,
      scanDurationMs,
      scannedStats,
      summary: {
        healthyTestsCount,
        warningTestsCount,
        errorTestsCount,
        totalIssuesCount,
      },
      tests,
    };
  }
}
