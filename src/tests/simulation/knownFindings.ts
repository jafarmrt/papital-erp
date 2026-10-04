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
  'I3:purchase-discount': 'TD-250',
  // TD-251 و TD-252 در v8.0.2 رفع شدند (آزمون‌های inv_td_251_void_deletes_draft_voucher و inv_td_252_closing_refuses_draft_vouchers)
  'I14:over-return': 'TD-253',
  'I3:void-out-at-current-wac': 'TD-254',
  'I3:stock-count-without-voucher': 'TD-255',
  'I3:zero-price-receipt-void': 'TD-256',
  'I13:backdated-out-before-stock': 'TD-257',
  'I13:rebuild-wac-diverges': 'TD-258',
  'FOCUSED:purchase-voucher-ignores-account-mapping': 'TD-259',
  'FOCUSED:account-card-mixes-currencies': 'TD-260',
  'I3:foreign-rounding': 'TD-261',
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
      return f.message.includes('مانده منفی') ? 'I13:backdated-out-before-stock' : 'I13:rebuild-wac-diverges';
    case 'I14_return_within_sold':
      return 'I14:over-return';
    default:
      return `${f.invariant}:${f.key}`;
  }
}
