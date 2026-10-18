/**
 * v10.2.2 (TD-1290، بستهٔ ۳ نسخهٔ ۱۰.۲، یافتهٔ D3): «مواد گرفته‌شده از انبار» هر پروژه، مشترک میان کارساز
 * (`GET /projects/:id/issued-materials`) و زبانهٔ مواد. همان ردیف‌هایی که مقدار داده‌شده به پروژه را می‌سازند
 * (`projectIssuedQuantities`): تخصیص مواد باز یا مصرف‌شده، و حواله و ضایعات قطعی و زندهٔ پروژه. بهای هر ردیف بهای کاردکس خروج
 * خود آن است و فقط به دارندهٔ مجوز دیدن بها (`ITEM_COST_READ_PERMISSIONS`) فرستاده می‌شود.
 */

export type IssuedMaterialSource = 'allocation' | 'remittance' | 'waste';

export interface IssuedMaterialRow {
  /** کلید یکتای ردیف در فهرست */
  key: string;
  source: IssuedMaterialSource;
  /** شناسهٔ تخصیص یا سند */
  sourceId: number;
  /** شمارهٔ سند؛ تخصیص شماره ندارد */
  refNumber: string | null;
  /** تخصیص: زمان کارساز با Z؛ سند: تاریخ سند */
  date: string | null;
  itemId: number;
  itemCode: string;
  itemName: string;
  unit: string;
  quantity: number;
  /** وضعیت تخصیص (allocated / consumed)؛ سند قطعی final */
  status: string;
  /** بهای کاردکس خروج به ریال؛ بی مجوز بها یا بی ردیف کاردکس null */
  cost: number | null;
}

export interface IssuedMaterialsReport {
  projectId: number;
  costVisible: boolean;
  /** تازه‌ترین ردیف‌ها، حداکثر `ISSUED_MATERIALS_MAX_ROWS` */
  rows: IssuedMaterialRow[];
  /** شمار همهٔ ردیف‌ها؛ بیش از `rows` یعنی ردیف‌های قدیمی‌تر نیامده‌اند */
  total: number;
  /** جمع بهای همهٔ ردیف‌ها به ریال؛ بی مجوز بها null */
  totalCost: number | null;
}

/** بیشینهٔ ردیف‌های یک پاسخ */
export const ISSUED_MATERIALS_MAX_ROWS = 500;

export const ISSUED_MATERIAL_SOURCE_LABELS: Record<IssuedMaterialSource, string> = {
  allocation: 'تخصیص مواد',
  remittance: 'حوالهٔ خروج',
  waste: 'ضایعات',
};

export const ISSUED_MATERIAL_STATUS_LABELS: Record<string, string> = {
  allocated: 'تخصیص‌یافته',
  consumed: 'مصرف‌شده',
  final: 'قطعی',
};

const SOURCES: readonly IssuedMaterialSource[] = ['allocation', 'remittance', 'waste'];
const textOrNull = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** پاسخ `GET /projects/:id/issued-materials`، یا null وقتی شکل آن نامعتبر است */
export function issuedMaterialsReportOf(raw: unknown): IssuedMaterialsReport | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  if (!Array.isArray(body.rows) || typeof body.costVisible !== 'boolean') return null;
  const rows: IssuedMaterialRow[] = [];
  for (const r of body.rows as unknown[]) {
    if (!r || typeof r !== 'object') return null;
    const row = r as Record<string, unknown>;
    const source = row.source as IssuedMaterialSource;
    if (!SOURCES.includes(source) || typeof row.key !== 'string') return null;
    const cost = body.costVisible && row.cost !== null && row.cost !== undefined && Number.isFinite(Number(row.cost)) ? Number(row.cost) : null;
    rows.push({
      key: row.key,
      source,
      sourceId: Number(row.sourceId) || 0,
      refNumber: textOrNull(row.refNumber),
      date: textOrNull(row.date),
      itemId: Number(row.itemId) || 0,
      itemCode: typeof row.itemCode === 'string' ? row.itemCode : '',
      itemName: typeof row.itemName === 'string' ? row.itemName : '',
      unit: typeof row.unit === 'string' && row.unit ? row.unit : 'عدد',
      quantity: Number(row.quantity) || 0,
      status: typeof row.status === 'string' ? row.status : '',
      cost,
    });
  }
  const totalCost = body.costVisible && Number.isFinite(Number(body.totalCost)) && body.totalCost !== null ? Number(body.totalCost) : null;
  return { projectId: Number(body.projectId) || 0, costVisible: body.costVisible, rows, total: Number(body.total) || rows.length, totalCost };
}
