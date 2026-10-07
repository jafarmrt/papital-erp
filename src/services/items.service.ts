import {
  ItemStockReservationService,
  type ReservedItemDetail,
  type ItemReservedReportSummary,
  type ReservedItemsFullReport,
  type ReservedStockInfo,
  type ReservationScope
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

  static async getReservedStocksMap(scope?: ReservationScope): Promise<Record<string, ReservedStockInfo>> {
    return ItemStockReservationService.getReservedStocksMap(scope);
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
