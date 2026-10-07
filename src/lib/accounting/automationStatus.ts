/**
 * v9.0.281 (TD-560، B03-18): «وضعیت صدور خودکار اسناد حسابداری»، مشترک میان سرور و پنل. فقط اسناد نهایی شمرده
 * می‌شوند (پیش‌فاکتور هرگز سند نمی‌گیرد و پیش‌تر «بی سند» شمرده می‌شد). انبارگردانی از v8.0.3 (TD-255) سند خودکار دارد،
 * ولی فقط وقتی اختلاف ارزش‌دار دارد؛ انتقال بین‌انباری اثر مالی ندارد و از پوشش بیرون است. پیش‌تر پنل انبارگردانی را
 * «نیازمند سند دستی» می‌خواند و سند دستی اختلاف انبار را دو بار در ۷۰۱۲ می‌نشاند.
 */
export const AUTOMATION_DOC_TYPES = [
  'invoice', 'receipt', 'production_receipt', 'purchase', 'remittance', 'waste', 'return', 'audit', 'transfer',
] as const;
export type AutomationDocType = typeof AUTOMATION_DOC_TYPES[number];

/** هر سند نهایی سند می‌گیرد؛ فقط اختلاف ارزش‌دار؛ هیچ (بی اثر مالی) */
export type AutomationVoucherRule = 'always' | 'valued_difference' | 'none';

export const AUTOMATION_VOUCHER_RULES: Record<AutomationDocType, AutomationVoucherRule> = {
  invoice: 'always',
  receipt: 'always',
  production_receipt: 'always',
  purchase: 'always',
  remittance: 'always',
  waste: 'always',
  return: 'always',
  audit: 'valued_difference',
  transfer: 'none',
};

export const AUTOMATION_DOC_LABELS: Record<AutomationDocType, string> = {
  invoice: 'فاکتور فروش',
  receipt: 'رسید خرید',
  production_receipt: 'رسید تولید',
  purchase: 'فاکتور خرید',
  remittance: 'حواله خروج',
  waste: 'سند ضایعات',
  return: 'مرجوعی فروش',
  audit: 'سند انبارگردانی',
  transfer: 'حواله انتقال بین‌انباری',
};

export interface AutomationRow {
  docType: AutomationDocType;
  label: string;
  voucherRule: AutomationVoucherRule;
  /** اسناد نهایی این نوع */
  totalDocs: number;
  /** اسنادی که باید سند حسابداری داشته باشند */
  needVoucher: number;
  withVoucher: number;
  missingVoucher: number;
}

export interface AutomationSummary {
  /** اسناد نهایی‌ای که باید سند حسابداری داشته باشند */
  totalDocs: number;
  coveredDocs: number;
  coveragePercent: number;
  /** فقط نوع‌هایی که سند نهایی بی سند حسابداری دارند */
  missingTypes: Array<{ docType: AutomationDocType; label: string; missingVoucher: number }>;
}

export interface AutomationStatus {
  report: AutomationRow[];
  summary: AutomationSummary;
}

export function automationRow(docType: AutomationDocType, counts: { totalDocs: number; needVoucher: number; withVoucher: number }): AutomationRow {
  const needVoucher = Math.max(0, counts.needVoucher);
  const withVoucher = Math.min(needVoucher, Math.max(0, counts.withVoucher));
  return {
    docType,
    label: AUTOMATION_DOC_LABELS[docType],
    voucherRule: AUTOMATION_VOUCHER_RULES[docType],
    totalDocs: Math.max(0, counts.totalDocs),
    needVoucher,
    withVoucher,
    missingVoucher: needVoucher - withVoucher,
  };
}

/** درصد پوشش تا همه پوشش نیابند ۱۰۰ نمی‌شود (۹۹۹ از ۱۰۰۰ = ۹۹٪، نه ۱۰۰٪) */
export function summarizeAutomation(report: AutomationRow[]): AutomationSummary {
  const totalDocs = report.reduce((sum, r) => sum + r.needVoucher, 0);
  const coveredDocs = report.reduce((sum, r) => sum + r.withVoucher, 0);
  const coveragePercent = totalDocs === 0 || coveredDocs >= totalDocs ? 100 : Math.min(99, Math.round((coveredDocs / totalDocs) * 100));
  return {
    totalDocs,
    coveredDocs,
    coveragePercent,
    missingTypes: report.filter(r => r.missingVoucher > 0).map(r => ({ docType: r.docType, label: r.label, missingVoucher: r.missingVoucher })),
  };
}
