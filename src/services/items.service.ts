import {
  ItemStockReservationService,
  type ReservedItemDetail,
  type ItemReservedReportSummary,
  type ReservedItemsFullReport,
  type ReservedStockInfo,
  type ReservationScope,
  type OthersReservationContext
} from './items/itemStockReservation.service.js';
import { ItemPricingService, type PriceItemRecord } from './items/itemPricing.service.js';
import { ItemCatalogService } from './items/itemCatalog.service.js';
import type { ItemImportPermissions } from '../lib/items/itemImportPermissions.js';
import type { ItemImportActor } from './items/itemExcelImport.js';

export type {
  ReservedItemDetail,
  ItemReservedReportSummary,
  ReservedItemsFullReport,
  ReservedStockInfo,
  PriceItemRecord
};

export class ItemsService {
  static async getReservedStockDetails(): Promise<ReservedItemsFullReport> {
    return ItemStockReservationService.getReservedStockDetails();
  }

  static async getReservedStocksMap(scope?: ReservationScope, others?: OthersReservationContext): Promise<Record<string, ReservedStockInfo>> {
    return ItemStockReservationService.getReservedStocksMap(scope, others);
  }

  /** v11 phase 3.2 (S3): the one item delete; the project reservations come from the reservation service, above the items core */
  static async deleteItem(id: number) {
    return ItemCatalogService.deleteItem(id, { reservingProjects: (tx, itemId) => ItemStockReservationService.reservingProjectCodes(tx, itemId) });
  }

  static async getPricingStrategies(): Promise<string[]> {
    return ItemPricingService.getPricingStrategies();
  }

  static filterActivePrices(allPricesList: PriceItemRecord[], activeStrategies?: string[]): PriceItemRecord[] {
    return ItemPricingService.filterActivePrices(allPricesList, activeStrategies);
  }

  static async getNextProductCode(year?: string, prefix?: string, transfer?: string): Promise<string> {
    return ItemCatalogService.getNextProductCode(year, prefix, transfer);
  }

  static async processUnifiedExport(typeFilter?: string) {
    return ItemCatalogService.processUnifiedExport(typeFilter);
  }

  static async processUnifiedImport(
    rows: Array<Record<string, unknown>>,
    typeFilter: string | undefined,
    req: { user?: ItemImportActor },
    permissions: ItemImportPermissions,
  ) {
    return ItemCatalogService.processUnifiedImport(rows, typeFilter, req, permissions);
  }
}
