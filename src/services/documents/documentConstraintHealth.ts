import { sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import type { HealthCheckTestResult } from '../../types.js';

/**
 * v9.0.289 (TD-786، یافته B08-17): قیدهای پایگاه‌داده سند و ردیف سند (مهاجرت 0077). هر قید `NOT VALID` افزوده و فقط روی
 * داده تمیز اعتبارسنجی شد؛ این بررسی قید اعتبارسنجی‌نشده و ردیف‌های ناسازگار قدیمی را فهرست می‌کند و چیزی را بازنویسی
 * نمی‌کند. عبارت هر قید همان عبارت مهاجرت است و ردیف حذف نرم‌شده معاف است. مقدار صفر ردیف را پایگاه‌داده می‌پذیرد (شمارش
 * صفر انبارگردانی)، ولی سرویس‌ها در هر سند دیگری رد می‌کنند؛ ردیف قدیمی چنین هم فهرست می‌شود.
 */
export interface DocumentIntegrityRule {
  name: string;
  table: 'documents' | 'document_items';
  label: string;
  /** `false`: قاعده سرویس، نه قید پایگاه‌داده */
  constraint: boolean;
  /** ردیف‌هایی که قاعده را می‌شکنند (عبارت ثابت، بی ورودی کاربر) */
  violation: string;
}

const KNOWN_TYPES = "'receipt', 'purchase', 'production_receipt', 'return', 'invoice', 'proforma', 'remittance', 'waste', 'audit', 'transfer'";

export const DOCUMENT_INTEGRITY_RULES: readonly DocumentIntegrityRule[] = [
  { name: 'chk_documents_type', table: 'documents', constraint: true, label: 'سند با نوع ناشناخته',
    violation: `NOT (COALESCE(is_deleted, 0) = 1 OR type IN (${KNOWN_TYPES}))` },
  { name: 'chk_documents_status', table: 'documents', constraint: true, label: 'سند با وضعیت ناشناخته',
    violation: "NOT (COALESCE(is_deleted, 0) = 1 OR COALESCE(status, '') IN ('draft', 'proforma', 'final'))" },
  { name: 'chk_document_items_quantity', table: 'document_items', constraint: true, label: 'ردیف سند با مقدار منفی',
    violation: 'NOT (COALESCE(is_deleted, 0) = 1 OR quantity >= 0)' },
  { name: 'chk_document_items_unit_price', table: 'document_items', constraint: true, label: 'ردیف سند با قیمت واحد منفی',
    violation: 'NOT (COALESCE(is_deleted, 0) = 1 OR COALESCE(unit_price, 0) >= 0)' },
  { name: 'chk_document_items_discount', table: 'document_items', constraint: true, label: 'ردیف سند با تخفیف منفی',
    violation: 'NOT (COALESCE(is_deleted, 0) = 1 OR COALESCE(discount, 0) >= 0)' },
  { name: 'document_items_quantity_zero', table: 'document_items', constraint: false, label: 'ردیف سند (جز انبارگردانی) با مقدار صفر',
    violation: `COALESCE(is_deleted, 0) = 0 AND quantity = 0 AND EXISTS (SELECT 1 FROM documents d
      WHERE d.id = document_items.document_id AND COALESCE(d.is_deleted, 0) = 0 AND d.type <> 'audit')` },
];

export type DocumentConstraintState = 'valid' | 'not_valid' | 'missing' | 'service';

export interface DocumentIntegrityEntry {
  name: string;
  label: string;
  state: DocumentConstraintState;
  brokenRows: number;
}

export async function findDocumentIntegrityGaps(executor: DbExecutor = orm): Promise<DocumentIntegrityEntry[]> {
  const entries: DocumentIntegrityEntry[] = [];
  for (const rule of DOCUMENT_INTEGRITY_RULES) {
    let state: DocumentConstraintState = 'service';
    if (rule.constraint) {
      const stateRes = await executor.execute(sql`
        SELECT convalidated FROM pg_constraint WHERE conname = ${rule.name} AND conrelid = to_regclass(${rule.table})`);
      const row = (stateRes.rows as Array<{ convalidated?: boolean }>)[0];
      state = !row ? 'missing' : row.convalidated ? 'valid' : 'not_valid';
    }
    const countRes = await executor.execute(sql`SELECT COUNT(*)::int AS n FROM ${sql.identifier(rule.table)} WHERE ${sql.raw(rule.violation)}`);
    const brokenRows = Number((countRes.rows as Array<{ n?: number }>)[0]?.n ?? 0);
    if ((rule.constraint && state !== 'valid') || brokenRows > 0) entries.push({ name: rule.name, label: rule.label, state, brokenRows });
  }
  return entries;
}

const STATE_TEXT: Record<DocumentConstraintState, string> = {
  valid: 'قید برقرار است',
  not_valid: 'قید فقط ردیف‌های تازه را می‌سنجد',
  missing: 'قید در پایگاه‌داده نیست',
  service: 'ثبت و ویرایش سند مقدار صفر را رد می‌کنند؛ این ردیف‌ها پیش‌تر ثبت شده‌اند',
};

export function buildDocumentIntegrityHealthTest(entries: DocumentIntegrityEntry[]): HealthCheckTestResult {
  const broken = entries.reduce((sum, e) => sum + e.brokenRows, 0);
  return {
    id: 'document_integrity_constraints',
    category: 'documents',
    title: 'قیدهای پایگاه‌داده سند و ردیف سند',
    description: 'پایگاه‌داده نوع و وضعیت ناشناخته سند و مقدار، قیمت واحد و تخفیف منفی ردیف سند را نمی‌پذیرد. ردیف‌های قدیمی ناسازگار خودکار عوض نمی‌شوند و قیدشان فقط ردیف تازه را می‌سنجد',
    status: entries.length > 0 ? 'warning' : 'healthy',
    scoreImpact: 0,
    count: broken,
    message: entries.length === 0
      ? 'همه قیدهای سند و ردیف سند برقرارند.'
      : `${toPersianDigits(String(entries.length))} قاعده سند و ردیف سند کامل برقرار نیست${broken > 0 ? ` و ${toPersianDigits(String(broken))} ردیف قدیمی آن را می‌شکند` : ''}. سند را ابطال و درست دوباره ثبت کنید؛ سند ابطال‌شده معاف است.`,
    items: entries.map((e, index) => ({
      id: index + 1,
      code: e.name,
      title: e.label,
      subtitle: `${toPersianDigits(String(e.brokenRows))} ردیف ناسازگار`,
      details: `${STATE_TEXT[e.state]} (TD-786).`,
    })),
    metrics: { documentIntegrityGaps: entries.length, documentIntegrityBrokenRows: broken },
  };
}
