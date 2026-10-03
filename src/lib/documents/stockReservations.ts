import type { Item } from '../../types';

/**
 * TD-080 (بخش ۳): منطق خالص رزرو کالا در فرم رسید/حواله انبار — منتقل‌شده بدون تغییر رفتار از DocumentsPage.
 * هر قاعده تطبیق کالا با رزرو دقیقاً همان معنای جای اصلی خود را دارد؛ به همین دلیل دو تابع جدا وجود دارد (کسر رزرو از v7.0.102 در سرور است).
 */

/** یک ردیف رزرو سراسری (پروژه یا پیش‌فاکتور) — هم‌شکل GlobalReservationRow در GlobalReservationsPanel */
export interface GlobalReservation {
  sourceType?: 'proforma' | 'project';
  sourceLabel?: string;
  projectId?: string | number;
  projectCode: string;
  projectTitle: string;
  itemId?: number | string;
  itemCode: string;
  itemName: string;
  reservedQty: number;
  unit: string;
  reservedAt?: string;
}

/** یک ردیف از پاسخ GET /inventory/reserved-items (allReservationEntries) */
export interface ReservedItemsEntry {
  sourceType?: 'proforma' | 'project';
  sourceLabel?: string;
  sourceId?: string | number;
  sourceRef?: string;
  sourceTitle?: string;
  itemId?: number | string;
  itemCode?: string;
  itemName?: string;
  reservedQty?: number | string;
  unit?: string;
  date?: string;
}

export interface ReservedItemsResponse {
  allReservationEntries?: ReservedItemsEntry[];
}

/** رزرو ذخیره‌شده در inventory_control.reservedItems یک پروژه */
export interface StoredReservedItem {
  itemId?: number | string;
  itemCode?: string;
  itemName?: string;
  reservedQty?: number | string;
  unit?: string;
  reservedAt?: string;
  [key: string]: unknown;
}

export interface StockDocProjectInventoryControl {
  reservedItems?: unknown;
  [key: string]: unknown;
}

/** پروژه در لیست /projects و پاسخ /projects/:id (فقط فیلدهایی که فرم انبار می‌خواند) */
export interface StockDocProject {
  id: number | string;
  project_code?: string;
  title?: string;
  inventory_control?: StockDocProjectInventoryControl | null;
  inventoryControl?: StockDocProjectInventoryControl | null;
}

type MatchableItem = Pick<Item, 'id' | 'code' | 'name'>;

/**
 * همه رزروهای سراسری: ردیف‌های /inventory/reserved-items، و اگر آن پاسخ هنوز آماده/خالی است
 * رزروهای inventory_control.reservedItems پروژه‌ها.
 */
export function buildGlobalReservations(
  reservedItemsResponse: ReservedItemsResponse | null | undefined,
  projectsList: StockDocProject[],
): GlobalReservation[] {
  const list: GlobalReservation[] = [];

  const entries = reservedItemsResponse?.allReservationEntries;
  if (Array.isArray(entries) && entries.length > 0) {
    entries.forEach((r: ReservedItemsEntry) => {
      list.push({
        sourceType: r.sourceType,
        sourceLabel: r.sourceLabel || (r.sourceType === 'proforma' ? 'پیش‌فاکتور' : 'پروژه'),
        projectId: r.sourceType === 'project' ? r.sourceId : undefined,
        projectCode: r.sourceRef || '',
        projectTitle: r.sourceTitle || '',
        itemId: r.itemId,
        itemCode: r.itemCode || '',
        itemName: r.itemName || '',
        reservedQty: Number(r.reservedQty || 0),
        unit: r.unit || 'عدد',
        reservedAt: r.date
      });
    });
    return list;
  }

  // Fallback if reserved-items endpoint not ready yet:
  projectsList.forEach(p => {
    const reservedItems = p.inventory_control?.reservedItems || p.inventoryControl?.reservedItems;
    if (Array.isArray(reservedItems) && reservedItems.length > 0) {
      reservedItems.forEach((rItem: StoredReservedItem) => {
        list.push({
          sourceType: 'project',
          sourceLabel: 'پروژه',
          projectId: p.id,
          projectCode: p.project_code || `PRJ-${p.id}`,
          projectTitle: p.title || 'بدون عنوان',
          itemId: rItem.itemId,
          itemCode: rItem.itemCode || '',
          itemName: rItem.itemName || '',
          reservedQty: Number(rItem.reservedQty || 0),
          unit: rItem.unit || 'عدد',
          reservedAt: rItem.reservedAt
        });
      });
    }
  });

  return list;
}

/**
 * قاعده تطبیق خلاصه رزرو کالا: شناسه (هر دو طرف باید مقدار داشته باشند)، وگرنه کد (بی‌توجه به حروف
 * بزرگ/کوچک با toUpperCase)، وگرنه نام (toLowerCase).
 */
export function reservationMatchesItem(r: GlobalReservation, it: MatchableItem): boolean {
  return Boolean(
    (r.itemId && it.id && Number(r.itemId) === Number(it.id)) ||
    (r.itemCode && it.code && r.itemCode.trim().toUpperCase() === it.code.trim().toUpperCase()) ||
    (r.itemName && it.name && r.itemName.trim().toLowerCase() === it.name.trim().toLowerCase())
  );
}

/**
 * قاعده تطبیق رزرو پروژه با کالای لیست/سند (افزودن همه، افزودن تکی، «در سند»): شناسه بدون شرط
 * مقدار داشتن شناسه کالا، وگرنه کد (toUpperCase)، وگرنه نام (toLowerCase).
 */
export function reservationMatchesListItem(rItem: GlobalReservation, i: MatchableItem): boolean {
  return Boolean(
    (rItem.itemId && Number(i.id) === Number(rItem.itemId)) ||
    (rItem.itemCode && i.code && i.code.trim().toUpperCase() === rItem.itemCode.trim().toUpperCase()) ||
    (rItem.itemName && i.name && i.name.trim().toLowerCase() === rItem.itemName.trim().toLowerCase())
  );
}

export interface ItemReservationSummary {
  matchingReservations: GlobalReservation[];
  totalReservedQty: number;
  reservedForSelectedProject: number;
  reservedForOtherProjects: number;
  maxAllowedForExit: number;
}

/** معیارهای رزرو یک کالا برای پروژه انتخاب‌شده (getItemReservationSummary صفحه) */
export function itemReservationSummary(
  reservations: GlobalReservation[],
  it: Pick<Item, 'id' | 'code' | 'name' | 'current_stock'>,
  selectedProjectId: string,
): ItemReservationSummary {
  const matchingReservations = reservations.filter(r => reservationMatchesItem(r, it));

  const totalReservedQty = matchingReservations.reduce((acc, r) => acc + r.reservedQty, 0);

  const reservedForSelectedProject = selectedProjectId
    ? matchingReservations.filter(r => r.sourceType === 'project' && String(r.projectId) === String(selectedProjectId)).reduce((acc, r) => acc + r.reservedQty, 0)
    : 0;

  const reservedForOtherProjects = totalReservedQty - reservedForSelectedProject;

  // Max allowed exit for this document selection
  const maxAllowedForExit = Math.max(0, it.current_stock - reservedForOtherProjects);

  return {
    matchingReservations,
    totalReservedQty,
    reservedForSelectedProject,
    reservedForOtherProjects,
    maxAllowedForExit
  };
}
