/**
 * کاردکس تفصیلی یک کالا (GET /inventory/item-kardex/:itemId): شکل پاسخ و نرمال‌سازی دفاعی آن.
 * V10-0.2: هر شکل پاسخ (پاکت کامل، آرایه خام legacy یا پاکت داخل data) به { item, summary, entries } تبدیل می‌شود
 * تا هیچ deref بدون گارد در مودال نماند.
 */

export interface RunningKardexItem {
  id?: number;
  code?: string;
  name?: string;
  unit?: string;
  category?: string | null;
  type?: string | null;
  currentStock?: number;
  weightedAverageCost?: number;
}

export interface RunningKardexSummary {
  totalIn?: number;
  totalOut?: number;
  netBalance?: number;
  transactionCount?: number;
  valuation?: number;
}

export interface RunningKardexEntry {
  transactionId?: number;
  date: string;
  type: string;
  documentType?: string;
  documentRef?: string;
  location?: string;
  quantity: number;
  unitPrice: number;
  totalAmount?: number;
  runningBalance?: number;
  runningLocationStock?: number;
  runningGlobalStock?: number;
  runningWac?: number;
  runningTotalValue?: number;
  notes?: string;
  createdBy?: string;
  reversalOfId?: number | null;
  /** ردیف معکوسِ ابطال یک سند (در تاریخ ابطال) */
  isReversal?: boolean;
  /** v8.0.7 (TD-266): ردیف اصلی سند ابطال‌شده (در تاریخ خود سند) */
  isVoided?: boolean;
}

/** v8.0.7 (TD-266): برچسب ردیف سند ابطال‌شده و ردیف معکوس آن در کاردکس تفصیلی؛ رشته خالی برای گردش عادی */
export function runningKardexEntryLabel(entry: Pick<RunningKardexEntry, 'isVoided' | 'isReversal'>): string {
  if (entry.isVoided) return 'باطل‌شده';
  if (entry.isReversal) return 'معکوس ابطال';
  return '';
}

export interface RunningKardexData {
  item: RunningKardexItem | null;
  summary: RunningKardexSummary | null;
  entries: RunningKardexEntry[];
}

interface KardexEnvelope {
  item?: RunningKardexItem | null;
  summary?: RunningKardexSummary | null;
  entries?: unknown;
}

const isObject = (value: unknown): value is KardexEnvelope => typeof value === 'object' && value !== null;

export function normalizeRunningKardex(res: unknown): RunningKardexData {
  if (Array.isArray(res)) {
    return { item: null, summary: null, entries: res as RunningKardexEntry[] };
  }
  if (isObject(res) && Array.isArray(res.entries)) {
    return { item: res.item ?? null, summary: res.summary ?? null, entries: res.entries as RunningKardexEntry[] };
  }
  // هر شکل دیگر (از جمله { data: [...] } که شاخه قبلی مودال هم به کاردکس خالی تبدیلش می‌کرد): کاردکس خالی
  return { item: null, summary: null, entries: [] };
}
