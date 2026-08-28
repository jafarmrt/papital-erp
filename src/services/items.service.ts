import {
  ItemStockReservationService,
  type ReservedItemDetail,
  type ItemReservedReportSummary,
  type ReservedItemsFullReport,
  type ReservedStockInfo
} from './items/itemStockReservation.service.js';
import { ItemPricingService } from './items/itemPricing.service.js';
import { ItemCatalogService } from './items/itemCatalog.service.js';
import { withLongQueryTimeout } from '../db/drizzle.js';

export type {
  ReservedItemDetail,
  ItemReservedReportSummary,
  ReservedItemsFullReport,
  ReservedStockInfo
};

export class ItemsService {
  static async syncMissingWarehouseStocks(): Promise<void> {
    return ItemStockReservationService.syncMissingWarehouseStocks();
  }

  static async getReservedStockDetails(): Promise<ReservedItemsFullReport> {
    return ItemStockReservationService.getReservedStockDetails();
  }

  static async getReservedStocksMap(): Promise<Record<string, ReservedStockInfo>> {
    return ItemStockReservationService.getReservedStocksMap();
  }

  static async getPricingStrategies(): Promise<string[]> {
    return ItemPricingService.getPricingStrategies();
  }

  static filterActivePrices(allPricesList: any[], activeStrategies?: string[]) {
    return ItemPricingService.filterActivePrices(allPricesList, activeStrategies);
  }

  static async getNextProductCode(year?: string, prefix?: string, transfer?: string): Promise<string> {
    return ItemCatalogService.getNextProductCode(year, prefix, transfer);
  }

  static async processUnifiedExport(typeFilter?: string) {
    return ItemCatalogService.processUnifiedExport(typeFilter);
  }

  static async processUnifiedImport(rows: any[], typeFilter: string | undefined, req: any) {
    return withLongQueryTimeout(async () => {
      return ItemCatalogService.processUnifiedImport(rows, typeFilter, req);
    });
  }
}
