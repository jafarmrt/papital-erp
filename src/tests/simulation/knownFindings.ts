import type { SimulationFinding } from './businessYearSimulator.js';

/**
 * v8.0.1 — خط پایه یافته‌های شناخته‌شده ارزیابی صحت منطق کاری (docs/audit/BUSINESS_LOGIC_AUDIT_V8.md).
 *
 * الگوی «فقط کم شود» (مانند eslint-baseline.json): سوئیت business_invariants شبیه‌ساز و آزمون‌های متمرکز را اجرا می‌کند
 * و مجموعه کلاس یافته‌های دیده‌شده باید دقیقاً همین فهرست باشد. کلاس تازه (رگرسیون) یا کلاسی که دیگر رخ نمی‌دهد
 * (رفع‌شده) آزمون را قرمز می‌کند؛ نسخه‌ای که یک یافته را رفع می‌کند، کلاس آن را از این فهرست حذف و ردیف TD آن را
 * در TECH_DEBT.md می‌بندد. هرگز کلاسی به این فهرست اضافه نمی‌شود مگر یافته تازه ثبت‌شده با ردیف TD باز.
 */
export const KNOWN_FINDINGS: Readonly<Record<string, string>> = {
  // TD-250 در v8.0.9 رفع شد (inv_td_250_purchase_discount_in_cost)
  // TD-251 و TD-252 در v8.0.2 رفع شدند (آزمون‌های inv_td_251_void_deletes_draft_voucher و inv_td_252_closing_refuses_draft_vouchers)
  // TD-253 در v8.0.8 رفع شد (inv_td_253_return_within_sold)
  // TD-254 در v8.0.11 رفع شد (inv_td_254_void_outflow_restores_cost)
  // TD-255 در v8.0.3 رفع شد (آزمون inv_td_255_stock_count_voucher)
  // TD-256 در v8.0.12 رفع شد (inv_td_256_zero_price_receipt_at_wac)
  // TD-257 و TD-258 در v8.0.4 رفع شدند (inv_td_257_backdated_stock_movement، inv_td_258_rebuild_matches_live_engine)
  // TD-259 در v8.0.14 رفع شد (inv_td_259_vouchers_follow_account_mapping)
  // TD-260 در v8.0.16 رفع شد (inv_td_260_reports_convert_foreign_rows)
  // TD-261 در v8.0.18 رفع شد (inv_td_261_foreign_cost_rows_exact_in_irr)
  // حوزه C — خزانه و چک صیادی (v8.0.19؛ TD-271 در همان نسخه رفع شد: inv_td_271_cheque_delete_keeps_other_cheques)
  // TD-272 در v8.0.21 رفع شد (inv_td_272_paid_cheque_bounce_restores_supplier)
  // TD-273 در v8.0.22 رفع شد (inv_td_273_returned_cheque_moves_to_customer)
  // TD-274 در v8.0.20 رفع شد (inv_td_274_foreign_treasury_uses_rate)
  // TD-275 در v8.0.23 رفع شد (inv_td_275_foreign_cheque_refused)
  // TD-276 در v8.0.24 رفع شد (inv_td_276_cleared_cheque_keeps_bank_synced)
  // TD-277 در v8.0.25 رفع شد (inv_td_277_cheque_clearing_needs_ledger_account)
  // TD-278 در v8.0.26 رفع شد (inv_td_278_treasury_cheque_method_refused)
  // TD-279 با تصمیم مالک محصول (گزینه ب، ۱۲ مهر ۱۴۰۵) بی‌تغییر بسته شد؛ برگشت چک خرج‌شده با سند دستی
  // TD-280 در v8.0.27 یافته و رفع شد (inv_td_280_cheque_reconciliation_matches_ledger)
  // حوزه D — حقوق و کارمزدی (v8.0.28؛ TD-281 در همان نسخه رفع شد: inv_td_281_payroll_status_keeps_lifecycle)
  // TD-282 در v8.0.29 رفع شد (inv_td_282_advance_deduction_within_balance)
  // TD-283 در v8.0.31 رفع شد (inv_td_283_payroll_payment_voidable)
  // TD-284 در v8.0.30 رفع شد (inv_td_284_fixed_salary_prorated_by_month)
  // TD-264 در v8.0.5 رفع شد (inv_td_264_excel_wac_change_refused)
  // TD-265 در v8.0.6 رفع شد (inv_td_265_void_consumed_receipt_refused)
  // TD-266 در v8.0.7 رفع شد (inv_td_266_running_kardex_shows_voided)
  // TD-268 در v8.0.17 رفع شد (inv_td_268_free_goods_voucher_at_wac)
  // حوزه E — خرید، پروژه، BOM و تولید (v8.0.32؛ TD-287 در همان نسخه رفع شد: inv_td_287_bom_receipt_allocation_needs_receipt)
  // TD-285 در v8.0.35 رفع شد (inv_td_285_project_delivery_posts_voucher)
  // TD-286 در v8.0.34 رفع شد (inv_td_286_bom_allocation_posts_voucher)
  // TD-288 در v8.0.33 رفع شد (inv_td_288_bom_release_at_own_cost)
  // TD-289 در v8.0.38 رفع شد (inv_td_289_requisition_over_order_needs_reason)
  // TD-290 در v8.0.36 رفع شد (inv_td_290_requisition_receipt_sums_lines)
  // حوزه F — ووکامرس (v8.0.39؛ TD-292 در همان نسخه رفع شد: inv_td_292_woo_rial_units)
  'FOCUSED:woo-stock-outside-default-warehouse': 'TD-293',
  // TD-294 در v8.0.43 رفع شد (inv_td_294_woo_changed_order_flagged)
  // TD-295 در v8.0.42 رفع شد (inv_td_295_woo_negative_fee_as_line_discount)
  // TD-296 در v8.0.40 رفع شد (inv_td_296_woo_phone_matches_customer)
  // TD-297 در v8.0.41 رفع شد (inv_td_297_woo_exact_line_totals)
};

function parseSignature(sig: string): { op: string; tags: string[] } {
  const m = sig.match(/^([a-z_]+)\[(.*)\]$/);
  if (!m) return { op: sig, tags: [] };
  return { op: m[1], tags: m[2] ? m[2].split(',') : [] };
}

/** کلاس پایدار یک یافته شبیه‌ساز (علت ریشه‌ای)، یا null برای نتیجه تجمیعی که کلاس جدا ندارد */
export function classifyFinding(f: SimulationFinding): string | null {
  switch (f.invariant) {
    case 'I3_stock_value_equals_ledger': {
      if (f.key === 'inventory-value') return null; // جمع همه علت‌ها؛ هر علت کلاس gap جدا دارد
      const sig = f.key.replace(/^gap:/, '');
      if (sig === 'usd-rounding') return 'I3:foreign-rounding';
      const { op, tags } = parseSignature(sig);
      if ((op === 'purchase' || op === 'backdated_purchase') && tags.includes('discount')) return 'I3:purchase-discount';
      if (op === 'void' && tags.includes('had-discount')) return 'I3:purchase-discount';
      if (op === 'void' && tags.includes('zero-price')) return 'I3:zero-price-receipt-void';
      if (op === 'void' && tags.includes('wac-moved-since')) return 'I3:void-out-at-current-wac';
      if (op === 'stock_count') return 'I3:stock-count-without-voucher';
      return `I3:${sig}`;
    }
    case 'I6_void_trial_balance':
      return 'I6:void-draft-reversal-approved';
    case 'I13_kardex_rebuild_wac':
      if (f.message.includes('ابطال')) return 'I13:void-in-leaves-negative-history';
      return f.message.includes('مانده منفی') ? 'I13:backdated-out-before-stock' : 'I13:rebuild-wac-diverges';
    case 'I14_return_within_sold':
      return 'I14:over-return';
    default:
      return `${f.invariant}:${f.key}`;
  }
}
