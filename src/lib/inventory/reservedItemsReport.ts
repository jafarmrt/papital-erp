/**
 * The reserved items report (`GET /inventory/reserved-items`), shared by the server (`ItemStockReservationService`) and the
 * page (`ReservedItemsReportPage`).
 *
 * v9.0.380 (TD-823، یافته B07-07، تصمیم ت۶ «الف»): ارزش هر رزرو همیشه به بهای تمام‌شده و ریال است: مقدار × میانگین موزون
 * بهای کالا (`unitCost` / `totalCost`)، برای پیش‌فاکتور و پروژه یکسان. پیش‌تر ارزش پیش‌فاکتور مقدار × قیمت فروش به ارز همان سند
 * بود و ارزش پروژه مقدار × بها، و جمع، مبلغ دلاری خام را با ریال جمع می‌زد (۲ × ۱۰۰ دلار ← ۲۰۰ «ریال»)؛ `buyPrice` و
 * `sellPrice` خلاصه هر دو همان بها بودند و یک فیلد `weightedAverageCost` جایشان را گرفت.
 */

export type ReservationSourceType = 'proforma' | 'project';

export interface ReservedItemDetail {
  id: string;
  sourceType: ReservationSourceType;
  sourceLabel: string;
  sourceId: number;
  sourceRef: string;
  sourceTitle: string;
  buyerOrCustomer: string;
  itemId?: number;
  itemCode: string;
  itemName: string;
  category: string;
  unit: string;
  reservedQty: number;
  /** The item's weighted average cost in IRR */
  unitCost?: number;
  /** reservedQty × unitCost, in IRR */
  totalCost?: number;
  date: string;
}

export interface ItemReservedReportSummary {
  itemId?: number;
  itemCode: string;
  itemName: string;
  category: string;
  unit: string;
  currentStock: number;
  stocks?: Record<string, number>;
  /** In IRR */
  weightedAverageCost?: number;
  proformaReservedQty: number;
  projectReservedQty: number;
  totalReservedQty: number;
  availableStock: number;
  /** In IRR */
  totalReservedCost?: number;
  reservations: ReservedItemDetail[];
}

export interface ReservedItemsSummaryMetrics {
  totalReservedItemsCount: number;
  totalReservedQty: number;
  /** In IRR */
  totalReservedCost?: number;
  proformaReservationsCount: number;
  projectReservationsCount: number;
}

export interface ReservedItemsFullReport {
  summaryMetrics: ReservedItemsSummaryMetrics;
  itemSummaries: ItemReservedReportSummary[];
  allReservationEntries: ReservedItemDetail[];
}
