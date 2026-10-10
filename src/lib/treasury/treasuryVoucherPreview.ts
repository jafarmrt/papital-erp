/**
 * v10.0.x (TD-1237): قرارداد پیش‌نمایش سند خزانه (`POST /accounting/treasury/preview-voucher`)، مشترک سرور و فرم.
 * سرور خود پیش‌نمایش را می‌فرستد — { debit, credit, warnings } — بی پوشش success / data.
 */
export interface TreasuryVoucherPreviewRow {
  accountId: number;
  accountCode: string;
  accountName: string;
  detailedName: string;
  amount: number;
}

export interface TreasuryVoucherPreview {
  debit: TreasuryVoucherPreviewRow | null;
  credit: TreasuryVoucherPreviewRow | null;
  warnings: string[];
  contraConceptLabel: string;
}

function isPreviewRow(value: unknown): value is TreasuryVoucherPreviewRow {
  return typeof value === 'object' && value !== null && 'accountCode' in value && 'amount' in value;
}

/** پاسخ سرور را می‌خواند؛ پاسخی که شکل پیش‌نمایش ندارد null است */
export function readTreasuryVoucherPreview(res: unknown): TreasuryVoucherPreview | null {
  if (typeof res !== 'object' || res === null || !('warnings' in res)) return null;
  const r = res as Record<string, unknown>;
  if (!Array.isArray(r.warnings)) return null;
  return {
    debit: isPreviewRow(r.debit) ? r.debit : null,
    credit: isPreviewRow(r.credit) ? r.credit : null,
    warnings: r.warnings.filter((w): w is string => typeof w === 'string'),
    contraConceptLabel: typeof r.contraConceptLabel === 'string' ? r.contraConceptLabel : '',
  };
}
