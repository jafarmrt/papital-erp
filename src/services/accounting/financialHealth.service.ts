import { orm } from '../../db/drizzle.js';
import { sql } from 'drizzle-orm';
import type {
  FinancialHealthReport,
  HealthCheckTestResult,
  HealthCheckIssueItem,
  HealthCheckStatus,
} from '../../types.js';
import { jalaliToIsoDate, toEnglishDigits, formatPersianPrice } from '../../utils.js';

export class FinancialHealthService {
  /**
   * اجرای جامع اسکن سلامت دفاتر و آزمون‌های ممیزی خودکار
   */
  static async runHealthCheck(): Promise<FinancialHealthReport> {
    const startTime = Date.now();

    // 1. محاسبه تاریخ جاری میلادی و شمسی
    const now = new Date();
    const todayIso = now.toISOString().split('T')[0];
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
    ] = await Promise.all([
      // الف: آمار کل رکوردها
      orm.execute(sql`
        SELECT 
          (SELECT COUNT(*)::int FROM journal_vouchers WHERE is_deleted = 0) AS total_vouchers,
          (SELECT COUNT(*)::int FROM journal_voucher_items vi JOIN journal_vouchers v ON vi.voucher_id = v.id WHERE v.is_deleted = 0) AS total_voucher_items,
          (SELECT COUNT(*)::int FROM accounts WHERE is_deleted = 0) AS total_accounts,
          (SELECT COUNT(*)::int FROM documents WHERE is_deleted = 0) AS total_documents,
          (SELECT COUNT(*)::int FROM cheques WHERE is_deleted = 0) AS total_cheques,
          (SELECT COUNT(*)::int FROM items WHERE is_deleted = 0) AS total_items
      `),

      // ب: آزمون تراز اسناد دوبل (Voucher Balance)
      orm.execute(sql`
        SELECT 
          v.id,
          v.voucher_number,
          v.date,
          v.status,
          v.description,
          COALESCE(SUM(vi.debit), 0)::float AS calc_debit,
          COALESCE(SUM(vi.credit), 0)::float AS calc_credit,
          ABS(COALESCE(SUM(vi.debit), 0) - COALESCE(SUM(vi.credit), 0))::float AS discrepancy
        FROM journal_vouchers v
        LEFT JOIN journal_voucher_items vi ON vi.voucher_id = v.id
        WHERE v.is_deleted = 0
        GROUP BY v.id, v.voucher_number, v.date, v.status, v.description
        HAVING ABS(COALESCE(SUM(vi.debit), 0) - COALESCE(SUM(vi.credit), 0)) > 0.05
        ORDER BY v.voucher_number DESC
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
          COALESCE(SUM(vi.debit), 0)::float AS total_debit,
          COALESCE(SUM(vi.credit), 0)::float AS total_credit,
          (COALESCE(SUM(vi.debit), 0) - COALESCE(SUM(vi.credit), 0))::float AS net_balance
        FROM accounts a
        JOIN journal_voucher_items vi ON vi.account_id = a.id
        JOIN journal_vouchers v ON vi.voucher_id = v.id AND v.is_deleted = 0 AND v.status IN ('approved', 'permanent')
        WHERE a.is_deleted = 0 AND a.level IN ('subsidiary', 'general')
        GROUP BY a.id, a.code, a.name, a.level, a.nature, a.account_type
        HAVING (a.nature = 'debit' AND (COALESCE(SUM(vi.debit), 0) - COALESCE(SUM(vi.credit), 0)) < -100)
            OR (a.nature = 'credit' AND (COALESCE(SUM(vi.credit), 0) - COALESCE(SUM(vi.debit), 0)) < -100)
        ORDER BY ABS(COALESCE(SUM(vi.debit), 0) - COALESCE(SUM(vi.credit), 0)) DESC
        LIMIT 50;
      `),

      // د: ارزش فیزیکی انبار بر اساس قیمت میانگین موزون یا آخرین قیمت تعریف‌شده کالا
      orm.execute(sql`
        SELECT 
          COUNT(*)::int AS total_items_count,
          COALESCE(SUM(CASE WHEN current_stock > 0 THEN current_stock * COALESCE(NULLIF(weighted_average_cost, 0), (SELECT price FROM item_prices ip WHERE ip.item_id = items.id AND ip.is_deleted = 0 ORDER BY ip.id ASC LIMIT 1), 0) ELSE 0 END), 0)::float AS total_physical_valuation,
          COALESCE(SUM(CASE WHEN current_stock < 0 THEN 1 ELSE 0 END), 0)::int AS negative_stock_count
        FROM items
        WHERE is_deleted = 0;
      `),

      // هـ: مانده دفاتر حسابداری در گروه ۱۴ (موجودی مواد و کالا)
      orm.execute(sql`
        SELECT 
          COALESCE(SUM(vi.debit - vi.credit), 0)::float AS total_ledger_valuation
        FROM journal_voucher_items vi
        JOIN journal_vouchers v ON vi.voucher_id = v.id AND v.is_deleted = 0 AND v.status IN ('approved', 'permanent')
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
        LEFT JOIN journal_vouchers v ON v.reference_module = 'invoice' AND v.reference_id = d.id AND v.is_deleted = 0
        WHERE d.is_deleted = 0 
          AND d.status = 'final' 
          AND d.type IN ('invoice', 'receipt', 'production_receipt', 'purchase', 'return') 
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
          subtitle: `تاریخ: ${r.date} — بدهکار: ${formatPersianPrice(r.calc_debit)} | بستانکار: ${formatPersianPrice(r.calc_credit)}`,
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
      total_physical_valuation?: number;
      negative_stock_count?: number;
    };
    const ledgerData = (inventoryLedgerRes.rows?.[0] || {}) as {
      total_ledger_valuation?: number;
    };

    const warehouseVal = Math.round(Number(physicalData.total_physical_valuation) || 0);
    const ledgerVal = Math.round(Number(ledgerData.total_ledger_valuation) || 0);
    const negativeStockCount = Number(physicalData.negative_stock_count) || 0;
    const invDiscrepancy = Math.abs(warehouseVal - ledgerVal);
    const maxVal = Math.max(warehouseVal, ledgerVal, 1);
    const invDiscrepancyPercent = Number(((invDiscrepancy / maxVal) * 100).toFixed(1));

    if (invDiscrepancy <= 1000 && negativeStockCount === 0) {
      tests.push({
        id: 'inventory_reconciliation',
        category: 'inventory',
        title: 'انطباق ریالی موجودی انبار با دفتر کل حسابداری',
        description: 'بررسی هم‌خوانی ارزش کاردکس و موجودی کالای فیزیکی با سرفصل ۱۴ (موجودی مواد و کالا)',
        status: 'healthy',
        scoreImpact: 0,
        count: 0,
        message: 'ارزش کاردکس فیزیکی انبار با مانده سرفصل کل ۱۴ حسابداری در تراز کامل قرار دارد.',
        metrics: {
          warehouseValuation: warehouseVal,
          ledgerValuation: ledgerVal,
          discrepancy: invDiscrepancy,
          discrepancyPercent: invDiscrepancyPercent,
          negativeStockCount,
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
          subtitle: `نوع: ${d.type} | مبلغ کل: ${formatPersianPrice(d.total_amount)} ریال | تاریخ: ${d.date?.substring(0, 10)}`,
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
          subtitle: `تاریخ ایجاد: ${d.date?.substring(0, 10)} — بیش از ۱۴ روز در وضعیت معلق قرار دارد.`,
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
      // تبدیل تاریخ سررسید به ISO
      const dueIso = jalaliToIsoDate(chq.due_date);
      if (dueIso && dueIso < todayIso) {
        const dueMs = new Date(dueIso).getTime();
        const nowMs = now.getTime();
        const daysOverdue = Math.max(1, Math.floor((nowMs - dueMs) / (1000 * 60 * 60 * 24)));
        overdueList.push({ ...chq, daysOverdue });
      } else {
        // مقایسه مستقیم رشته‌ای جلالی
        const cleanDue = toEnglishDigits(chq.due_date).replace(/-/g, '/');
        const cleanToday = toEnglishDigits(todayJalali).replace(/-/g, '/');
        if (cleanDue < cleanToday) {
          overdueList.push({ ...chq, daysOverdue: 1 });
        }
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
          subtitle: `بانک ${c.bank_name} | سررسید: ${c.due_date} (${c.daysOverdue} روز تأخیر) | مبلغ: ${formatPersianPrice(c.amount)} ریال`,
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
