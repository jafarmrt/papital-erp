import { pool } from '../../db/drizzle.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { DocumentService } from '../../services/document.service.js';
import { getErrorMessage } from '../../utils/formatters.js';
import { createTestItem } from '../fixtures/factories.js';
import { accountIdByCode, outcomeProblems, raceBehindRowLock } from './concurrencyHarness.js';

/**
 * v8.0.68 — سناریوهای سخت‌گیرانه سند حسابداری حوزه J برای سوئیت business_invariants.
 * هر تابع فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
 */

async function voucherLines(amount: number) {
  return [
    { accountId: await accountIdByCode('1001'), debit: amount, credit: 0 },
    { accountId: await accountIdByCode('4001'), debit: 0, credit: amount },
  ];
}

async function approvedVoucher(description: string): Promise<number> {
  const voucher = await VoucherService.createJournalVoucher({
    date: '2026-04-01', status: 'approved', description, items: await voucherLines(1000000),
  });
  return voucher.id;
}

/** اسناد برگشتِ فعال یک سند: ابطال (REV-V…) یا ابطال برای بازثبت (VOID-REPOST-V…) */
async function activeReversals(voucherId: number): Promise<number> {
  const res = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM journal_vouchers r JOIN journal_vouchers o ON o.id = r.reference_id
      WHERE o.id = $1 AND r.is_deleted = 0
        AND r.reference_number IN ('REV-V' || o.voucher_number, 'VOID-REPOST-V' || o.voucher_number)`, [voucherId]);
  return res.rows[0]?.n ?? 0;
}

/**
 * TD-321: هر سند حسابداری فقط یک بار برگشت می‌خورد. پیش‌تر دو «سند اصلاحی» هم‌زمان، یا اصلاح و ابطال هم‌زمان، هر دو
 * پذیرفته می‌شدند (اصلاح سند مبدأ را قفل نمی‌کرد)، و «ابطال و بازثبت» پس از ابطال یا پیش از اصلاح، حتی پشت هم، سند را دو
 * بار برمی‌گرداند (هر مسیر فقط پیشوند خودش را می‌سنجید).
 */
export async function checkVoucherReversedOnce(): Promise<string[]> {
  const correction = async (voucherId: number) => VoucherService.correctVoucher({
    voucherId, reason: 'اصلاح مبلغ', date: '2026-04-02', newItems: await voucherLines(900000),
  });
  const repost = async (voucherId: number) => VoucherService.repostVoucher({
    voucherId, reason: 'بازثبت', date: '2026-04-02', newItems: await voucherLines(900000),
  });
  const reverse = (voucherId: number) => VoucherService.reverseVoucher({ voucherId, date: '2026-04-02', reason: 'ابطال' });

  const raced = await approvedVoucher('سند آزمون اصلاح هم‌زمان');
  const labels = ['اصلاح اول', 'اصلاح دوم', 'ابطال'];
  const outcomes = await raceBehindRowLock<unknown>('journal_vouchers', [raced], [() => correction(raced), () => correction(raced), () => reverse(raced)]);
  const problems = outcomeProblems(labels, outcomes, (_label, message) => message.includes('قبلاً'));
  const accepted = outcomes.filter(o => o.status === 'fulfilled').length;
  if (accepted !== 1) problems.push(`از دو اصلاح و یک ابطال هم‌زمان ${accepted} پذیرفته شد، نه یکی`);
  const racedReversals = await activeReversals(raced);
  if (racedReversals !== 1) problems.push(`سند پس از اصلاح و ابطال هم‌زمان ${racedReversals} سند برگشت فعال دارد، نه یکی`);

  const sequences: Array<[(id: number) => Promise<unknown>, (id: number) => Promise<unknown>, string]> = [
    [reverse, repost, 'ابطال سپس ابطال و بازثبت'],
    [repost, correction, 'ابطال و بازثبت سپس اصلاح'],
  ];
  for (const [first, second, label] of sequences) {
    const voucherId = await approvedVoucher(`سند آزمون ${label}`);
    await first(voucherId);
    let refused = '';
    try {
      await second(voucherId);
    } catch (err) {
      refused = getErrorMessage(err);
    }
    if (!refused.includes('قبلاً')) problems.push(`${label}: برگشت دوم رد نشد (${refused || 'پذیرفته شد'})`);
    const count = await activeReversals(voucherId);
    if (count !== 1) problems.push(`${label}: ${count} سند برگشت فعال، نه یکی`);
  }
  return problems;
}

async function rejection(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return getErrorMessage(err);
  }
}

/**
 * TD-323: سند پیش‌نویس برگشت یا اصلاح نمی‌خورد (قاعده TD-251)، و سندی که سند برگشت فعال دارد به پیش‌نویس برنمی‌گردد و حذف
 * نمی‌شود. پیش‌تر سند پیش‌نویس سند معکوس تأییدشده می‌گرفت، و سند حسابداری تأییدشده فاکتوری که ابطالش سند معکوس گرفته بود
 * به پیش‌نویس برمی‌گشت و حذف می‌شد؛ سند معکوس بی‌مبدأ می‌ماند.
 */
export async function checkReversalLifecycle(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const draft = await VoucherService.createJournalVoucher({
    date: '2026-04-01', status: 'draft', description: 'سند پیش‌نویس آزمون برگشت', items: await voucherLines(1000000),
  });
  const reverseDraft = await rejection(() => VoucherService.reverseVoucher({ voucherId: draft.id, date: '2026-04-02' }));
  if (!reverseDraft?.includes('پیش‌نویس')) problems.push(`ابطال سند پیش‌نویس رد نشد (${reverseDraft ?? 'پذیرفته شد'})`);
  const correctDraft = await rejection(async () => VoucherService.correctVoucher({
    voucherId: draft.id, reason: 'اصلاح', date: '2026-04-02', newItems: await voucherLines(900000),
  }));
  if (!correctDraft?.includes('پیش‌نویس')) problems.push(`اصلاح سند پیش‌نویس رد نشد (${correctDraft ?? 'پذیرفته شد'})`);
  if (await activeReversals(draft.id) !== 0) problems.push('سند پیش‌نویس سند برگشت گرفت');

  const manual = await approvedVoucher('سند آزمون بازگشت به پیش‌نویس');
  await VoucherService.reverseVoucher({ voucherId: manual, date: '2026-04-02' });
  const manualToDraft = await rejection(() => VoucherService.setVoucherStatus(manual, 'draft'));
  if (!manualToDraft?.includes('سند برگشت فعال')) problems.push(`سند ابطال‌شده به پیش‌نویس برگشت (${manualToDraft ?? 'پذیرفته شد'})`);

  const item = await createTestItem({ type: 'product', stocks: { [wh]: 5 }, weightedAverageCost: 100000 });
  const invoiceId = await DocumentService.createDocument({
    docType: 'invoice', inOut: 'out', status: 'final', date: '2026-04-01', user: 'inv', buyerName: 'مشتری آزمون برگشت سند',
    items: [{ itemId: item.id, quantity: 1, unitPrice: 250000, location: wh }],
  });
  const voucherRes = await pool.query<{ id: number }>('SELECT id FROM journal_vouchers WHERE source_document_id = $1 AND is_deleted = 0', [invoiceId]);
  const invoiceVoucher = voucherRes.rows[0]?.id;
  if (!invoiceVoucher) return [...problems, 'فاکتور سند حسابداری نگرفت'];
  await VoucherService.setVoucherStatus(invoiceVoucher, 'approved');
  await DocumentService.deleteDocument(invoiceId, 'inv');
  const invoiceToDraft = await rejection(() => VoucherService.setVoucherStatus(invoiceVoucher, 'draft'));
  // v9.0.278 (TD-552): سند منشأدار پیش از سنجش سند برگشت با قفل منشأ رد می‌شود؛ هر دو رد همان تضمین TD-323 است
  const refusedToDraft = invoiceToDraft?.includes('سند برگشت فعال') || invoiceToDraft?.includes('سند انبار یا فاکتور را ابطال');
  if (!refusedToDraft) problems.push(`سند فاکتور ابطال‌شده به پیش‌نویس برگشت (${invoiceToDraft ?? 'پذیرفته شد'})`);
  const deleteVoucher = await rejection(() => VoucherService.deleteJournalVoucher(invoiceVoucher));
  if (!deleteVoucher) problems.push('سند فاکتور ابطال‌شده حذف شد');
  const live = await pool.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM journal_vouchers WHERE id = $1 AND is_deleted = 0 AND status = \'approved\'', [invoiceVoucher]);
  if ((live.rows[0]?.n ?? 0) !== 1) problems.push('سند فاکتور ابطال‌شده دیگر تأییدشده و فعال نیست');
  if (await activeReversals(invoiceVoucher) !== 1) problems.push('سند فاکتور ابطال‌شده یک سند برگشت فعال ندارد');
  return problems;
}
