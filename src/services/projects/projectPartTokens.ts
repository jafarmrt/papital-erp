import { createHash } from 'node:crypto';
import type { DbExecutor } from '../../db/drizzle.js';
import type { productionProjects } from '../../db/schema.js';
import { ConflictError } from '../../errors/customErrors.js';
import { PROJECT_PARTS, projectPartConflictMessage, type ProjectPart, type ProjectPartTokens } from '../../lib/projects/projectParts.js';
import { removedLoggedScheduleRows, scheduleWithoutLogLinks } from '../../lib/projects/scheduleWorkLog.js';
import { readProjectManagers } from './projectManagers.js';
import { projectVersionConflict } from './projectVersion.js';

/**
 * TD-1342 (بستهٔ ۱۲ بند ۴، گزینهٔ ب کارت ت۴۲): نشانهٔ هر بخش پروژه از مقدار ذخیره‌شدهٔ همان بخش، و سنجش ذخیرهٔ زبانه‌ای که از
 * نسخهٔ کهنه ساخته شده. نسخهٔ برابر همان قفل خوش‌بینانهٔ پیشین است (TD-742)؛ نسخهٔ کهنه فقط وقتی پذیرفته می‌شود که نشانهٔ هر بخشی
 * که بدنه می‌نویسد همان نشانهٔ امروز باشد. بدنهٔ بی نشانه (برنامهٔ قدیمی) مثل پیش ۴۰۹ می‌گیرد.
 */

type ProjectRow = typeof productionProjects.$inferSelect;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** JSON با کلیدهای مرتب، تا نشانه به ترتیب کلیدها بستگی نداشته باشد */
function canonical(value: unknown): Json {
  const plain = value && typeof value === 'object' && typeof (value as { toJSON?: unknown }).toJSON === 'function'
    ? (value as { toJSON: () => unknown }).toJSON()
    : value;
  if (plain === null || plain === undefined) return null;
  if (Array.isArray(plain)) return plain.map(v => (v === undefined ? null : canonical(v)));
  if (typeof plain === 'object') {
    const out: { [key: string]: Json } = {};
    for (const key of Object.keys(plain as object).sort()) {
      const v = (plain as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = canonical(v);
    }
    return out;
  }
  if (typeof plain === 'number') return Number.isFinite(plain) ? plain : null;
  if (typeof plain === 'boolean' || typeof plain === 'string') return plain;
  return String(plain);
}

const tokenOf = (value: unknown): string => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex').slice(0, 32);

/** کلیدهای کنترل موجودی که فقط کارساز می‌نویسد (رزرو، کسر و برگشت آن، کمبودها، زمان‌ها) و در نشانهٔ بخش نیستند */
const INVENTORY_SERVER_KEYS = new Set(['reservedItems', 'isReserved', 'finalizedAt', 'reservationShortages', 'lastUpdated']);

function inventoryUserPart(inventoryControl: unknown): Record<string, unknown> {
  if (!inventoryControl || typeof inventoryControl !== 'object' || Array.isArray(inventoryControl)) return {};
  return Object.fromEntries(Object.entries(inventoryControl as Record<string, unknown>).filter(([key]) => !INVENTORY_SERVER_KEYS.has(key)));
}

/** مقدار ذخیره‌شدهٔ هر بخش؛ مسئولان پروژه (شناسهٔ کاربران) جزو مشخصات‌اند */
function partValue(row: ProjectRow, part: ProjectPart, managerUserIds: readonly number[]): unknown {
  switch (part) {
    case 'specs':
      return {
        projectCode: row.projectCode, title: row.title, customerId: row.customerId, customerName: row.customerName,
        itemId: row.itemId, itemCode: row.itemCode, itemName: row.itemName, quantity: row.quantity, unit: row.unit,
        startDate: row.startDate, endDate: row.endDate, priority: row.priority, description: row.description,
        products: row.products, customStages: row.customStages, managers: [...managerUserIds].sort((a, b) => a - b),
      };
    case 'status': return row.status;
    case 'attachments': return row.attachments;
    case 'inventory': return inventoryUserPart(row.inventoryControl);
    case 'schedule': return scheduleWithoutLogLinks(row.stageSchedules);
  }
}

/** نشانهٔ همهٔ بخش‌های پروژه (پاسخ خواندن و ذخیرهٔ رکورد پروژه) */
export function projectPartTokens(row: ProjectRow, managerUserIds: readonly number[]): Required<ProjectPartTokens> {
  return Object.fromEntries(PROJECT_PARTS.map(part => [part, tokenOf(partValue(row, part, managerUserIds))])) as Required<ProjectPartTokens>;
}

/** فیلدهای بدنهٔ ویرایش پروژه به ازای بخش؛ هر فیلد فقط در یک بخش است */
export interface ProjectPartWrites {
  title?: unknown; projectCode?: unknown; customerId?: unknown; customerName?: unknown; itemId?: unknown; itemCode?: unknown;
  itemName?: unknown; quantity?: unknown; unit?: unknown; startDate?: unknown; endDate?: unknown; priority?: unknown;
  description?: unknown; products?: unknown; customStages?: unknown; managerUserIds?: unknown;
  status?: unknown; attachments?: unknown; inventoryControl?: unknown; stageSchedules?: unknown;
}

const SPEC_FIELDS = [
  'title', 'projectCode', 'customerId', 'customerName', 'itemId', 'itemCode', 'itemName', 'quantity', 'unit',
  'startDate', 'endDate', 'priority', 'description', 'products', 'customStages', 'managerUserIds',
] as const;

/** بخش‌هایی که بدنه می‌نویسد */
export function writtenProjectParts(input: ProjectPartWrites): ProjectPart[] {
  const parts: ProjectPart[] = [];
  if (SPEC_FIELDS.some(f => input[f] !== undefined)) parts.push('specs');
  if (input.status !== undefined) parts.push('status');
  if (input.attachments !== undefined) parts.push('attachments');
  if (input.inventoryControl !== undefined) parts.push('inventory');
  if (input.stageSchedules !== undefined) parts.push('schedule');
  return parts;
}

/** بدنه کنترل موجودی پروژه‌ای را که هنوز ثبت نهایی نشده ثبت نهایی می‌کند؟ */
function finalizesInventory(existing: ProjectRow, input: ProjectPartWrites): boolean {
  const isFinal = (value: unknown) => !!value && typeof value === 'object' && (value as { isFinalized?: unknown }).isFinalized === true;
  return isFinal(input.inventoryControl) && !isFinal(existing.inventoryControl);
}

/**
 * ذخیره از نسخهٔ `expectedVersion` با نشانه‌های `tokens` روی ردیف قفل‌شدهٔ پروژه پذیرفته می‌شود؟ نسخهٔ تازه‌تر از نسخهٔ ذخیره‌شده
 * هرگز. بدنهٔ بی نشانه (برنامهٔ قدیمی) فقط با نسخهٔ برابر. بدنهٔ نشانه‌دار فقط با نشانهٔ برابرِ همهٔ بخش‌هایی که می‌نویسد، هر نسخه‌ای
 * که بفرستد، چون صفحه ممکن است نسخهٔ تازه را از ذخیرهٔ بخش دیگری گرفته باشد و این بخش را هنوز کهنه نشان دهد. ثبت نهایی رزرو را
 * از محصولات پروژه هم می‌سازد، پس نشانهٔ «مشخصات» را هم می‌خواهد. برنامه‌ای که ردیف دارای کارکرد را از برنامهٔ امروز حذف می‌کند
 * هم تعارض همان بخش است، چون زبانه آن ردیف را ثبت‌شده نمی‌دید (زبانهٔ تازه ردیف ثبت‌شده را حذف نمی‌کند، TD-736)؛ بدنهٔ بی نشانه
 * هم با نسخهٔ برابر چنین ردیفی را حذف نمی‌کند (TD-1345).
 */
export async function assertProjectPartsWritable(
  executor: DbExecutor,
  existing: ProjectRow,
  expectedVersion: number,
  tokens: ProjectPartTokens | undefined,
  input: ProjectPartWrites,
): Promise<void> {
  const currentVersion = existing.version ?? 1;
  // review N1: a version the project never reached is no version a tab was built from
  if (expectedVersion > currentVersion) throw projectVersionConflict(existing.id, expectedVersion, currentVersion);
  const parts = writtenProjectParts(input);
  // review M1: finalizing reserves the need of the project's products, which belong to the specs part
  if (finalizesInventory(existing, input) && !parts.includes('specs')) parts.push('specs');
  const hasTokens = !!tokens && Object.keys(tokens).length > 0;
  const removesLoggedRow = parts.includes('schedule') && removedLoggedScheduleRows(input.stageSchedules, existing.stageSchedules).length > 0;
  if (!hasTokens || parts.length === 0) {
    if (currentVersion !== expectedVersion) throw projectVersionConflict(existing.id, expectedVersion, currentVersion);
    // review N-b (TD-1345): an old page sends no tokens and never knew which rows are logged, so it may not drop one either
    if (removesLoggedRow) throw new ConflictError(projectPartConflictMessage(['schedule']), { projectId: existing.id, expectedVersion, currentVersion, parts: ['schedule'] }, 'OCC_CONFLICT');
    return;
  }
  const managerIds = parts.includes('specs')
    ? ((await readProjectManagers(executor, [existing.id])).get(existing.id) ?? []).map(m => m.userId)
    : [];
  const current = projectPartTokens(existing, managerIds);
  const changed = parts.filter(part => tokens[part] !== current[part]);
  if (removesLoggedRow && !changed.includes('schedule')) changed.push('schedule');
  if (changed.length > 0) {
    throw new ConflictError(projectPartConflictMessage(changed), { projectId: existing.id, expectedVersion, currentVersion, parts: changed }, 'OCC_CONFLICT');
  }
}
