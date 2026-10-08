/**
 * The reserved items report (`GET /inventory/reserved-items`), shared by the server (`ItemStockReservationService`) and the
 * page (`ReservedItemsReportPage`).
 *
 * v9.0.399 (TD-823، یافته B07-07، تصمیم ت۶ «الف»): ارزش هر رزرو همیشه به بهای تمام‌شده و ریال است: مقدار × میانگین موزون
 * بهای کالا (`unitCost` / `totalCost`)، برای پیش‌فاکتور و پروژه یکسان. پیش‌تر ارزش پیش‌فاکتور مقدار × قیمت فروش به ارز همان سند
 * بود و ارزش پروژه مقدار × بها، و جمع، مبلغ دلاری خام را با ریال جمع می‌زد (۲ × ۱۰۰ دلار ← ۲۰۰ «ریال»)؛ `buyPrice` و
 * `sellPrice` خلاصه هر دو همان بها بودند و یک فیلد `weightedAverageCost` جایشان را گرفت.
 */

import { PERMISSION_KEYS } from '../permissions/permissionCatalog.js';

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
  /** v9.0.400 (TD-829): what the reader may see; the server leaves out what it may not */
  access?: ReservedItemsReportAccess;
}

/**
 * v9.0.400 (TD-829، یافته B07-13، تصمیم ت۶ «الف»): بها و ارزش رزرو فقط برای خوانندگان بها در P05 ت۱۰-۲ (`products.view`،
 * `products.edit_price`، مجوزهای انبار و `accounting.*`) و نام خریدار پیش‌فاکتور فقط برای دارندگان `documents.view`؛ دیگر
 * خوانندگان گزارش مقدار و منبع را می‌بینند. پیش‌تر هر خواننده گزارش (از جمله `documents.create` و `reports.view`) بهای کالا،
 * قیمت فروش و خریدار پیش‌فاکتورهای همه مشتریان را می‌گرفت.
 */
export const ITEM_COST_READ_PERMISSIONS: readonly string[] = PERMISSION_KEYS.filter(key =>
  key === 'products.view' || key === 'products.edit_price' || key.startsWith('warehouse.') || key.startsWith('accounting.'));

export const RESERVATION_BUYER_READ_PERMISSIONS: readonly string[] = ['documents.view'];

/** What the reader of the report may see (`access` of the response) */
export interface ReservedItemsReportAccess {
  cost: boolean;
  buyer: boolean;
}

/** A sales proforma's title in the report, with its buyer only when the reader may see it */
export const proformaSourceTitle = (refNumber: string, buyerName?: string | null): string =>
  buyerName ? `پیش‌فاکتور ${refNumber} (${buyerName})` : `پیش‌فاکتور ${refNumber}`;

function entryForAccess(entry: ReservedItemDetail, access: ReservedItemsReportAccess): ReservedItemDetail {
  const { unitCost, totalCost, ...rest } = entry;
  const scoped: ReservedItemDetail = access.cost ? { ...rest, unitCost, totalCost } : rest;
  if (access.buyer || entry.sourceType !== 'proforma') return scoped;
  return { ...scoped, buyerOrCustomer: '', sourceTitle: proformaSourceTitle(entry.sourceRef) };
}

/** The report as its reader may see it; the server sends only this (`GET /inventory/reserved-items`) */
export function reservedItemsReportForAccess(report: ReservedItemsFullReport, access: ReservedItemsReportAccess): ReservedItemsFullReport {
  const { totalReservedCost, ...metrics } = report.summaryMetrics;
  return {
    summaryMetrics: access.cost ? { ...metrics, totalReservedCost } : metrics,
    itemSummaries: report.itemSummaries.map(({ weightedAverageCost, totalReservedCost: itemCost, reservations, ...summary }) => ({
      ...summary,
      ...(access.cost ? { weightedAverageCost, totalReservedCost: itemCost } : {}),
      reservations: reservations.map(entry => entryForAccess(entry, access)),
    })),
    allReservationEntries: report.allReservationEntries.map(entry => entryForAccess(entry, access)),
    access,
  };
}
