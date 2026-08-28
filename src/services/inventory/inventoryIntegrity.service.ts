import {
  StockReconciliationService,
  type DiscrepancyType,
  type ItemIntegrityAuditResult,
  type WarehouseReconciliationSummary,
  type InventoryIntegrityReport,
  type RunningKardexEntry,
  type RunningKardexResponse
} from './stockReconciliation.service.js';
import { KardexWacRecalculatorService } from './kardexWacRecalculator.service.js';
import { InventoryStockRepairService } from './inventoryStockRepair.service.js';
import {
  NegativeStockPolicyService,
  type NegativeStockPolicyType,
  type NegativeStockCheckResult,
  type NegativeStockViolationItem
} from './negativeStockPolicy.service.js';
import {
  ProjectBomAllocationService,
  type BomAllocationItemInput,
  type BomReceiptAllocationInput,
  type ProjectBomAllocationRecord
} from './projectBomAllocation.service.js';

export type {
  DiscrepancyType,
  ItemIntegrityAuditResult,
  WarehouseReconciliationSummary,
  InventoryIntegrityReport,
  RunningKardexEntry,
  RunningKardexResponse,
  NegativeStockPolicyType,
  NegativeStockCheckResult,
  NegativeStockViolationItem,
  BomAllocationItemInput,
  BomReceiptAllocationInput,
  ProjectBomAllocationRecord
};

export class InventoryIntegrityService {
  /**
   * Performs 3-way stock reconciliation with per-warehouse and per-location verification.
   */
  static async getIntegrityReport(params?: {
    discrepancyOnly?: boolean;
    type?: string;
    search?: string;
  }): Promise<InventoryIntegrityReport> {
    return StockReconciliationService.getIntegrityReport(params);
  }

  /**
   * Generates sequential running Kardex for a specific item (V10-0.2 full envelope)
   */
  static async getItemRunningKardex(itemId: number): Promise<RunningKardexResponse> {
    return StockReconciliationService.getItemRunningKardex(itemId);
  }

  /**
   * Rebuilds stock and WAC for a single item from its sequential transaction ledger
   */
  static async rebuildItemFromLedger(itemId: number, optsOrUserId?: any, username?: string) {
    return KardexWacRecalculatorService.rebuildItemFromLedger(itemId, optsOrUserId, username);
  }

  /**
   * Rebuilds stock and WAC for ALL items from their transaction ledgers
   */
  static async rebuildAllFromLedger(optsOrUserId?: any, username?: string) {
    return KardexWacRecalculatorService.rebuildAllFromLedger(optsOrUserId, username);
  }

  /**
   * Executes inter-warehouse stock transfer
   */
  static async executeWarehouseTransfer(params: {
    itemId: number;
    fromLocation: string;
    toLocation: string;
    quantity: number;
    date?: string;
    notes?: string;
    createdBy?: string;
    user?: string;
  }) {
    return InventoryStockRepairService.executeWarehouseTransfer(params);
  }

  /**
   * Negative Stock Policy controls
   */
  static async getNegativeStockPolicy(): Promise<NegativeStockPolicyType> {
    return NegativeStockPolicyService.getPolicy();
  }

  static async setNegativeStockPolicy(policy: NegativeStockPolicyType): Promise<void> {
    return NegativeStockPolicyService.setPolicy(policy);
  }

  static async checkStockDeduction(params: {
    itemId: number;
    location?: string;
    requestedQty: number;
  }): Promise<NegativeStockCheckResult> {
    return NegativeStockPolicyService.checkStockDeduction(params);
  }

  static async getNegativeStockViolations(): Promise<NegativeStockViolationItem[]> {
    return NegativeStockPolicyService.getNegativeStockViolations();
  }

  /**
   * Project BOM Allocations with source transaction traceability
   */
  static async allocateMaterialsForProject(params: {
    projectId: number;
    allocations: BomAllocationItemInput[];
    userId?: number;
    username?: string;
  }) {
    return ProjectBomAllocationService.allocateMaterialsForProject(params);
  }

  static async allocateReceiptItemsForProjectBom(params: {
    projectId: number;
    allocations: BomReceiptAllocationInput[];
    userId?: number;
    username?: string;
  }) {
    return ProjectBomAllocationService.allocateReceiptItemsForProjectBom(params);
  }

  static async consumeAllocation(allocationId: number, opts?: { userId?: number; username?: string }) {
    return ProjectBomAllocationService.consumeAllocation(allocationId, opts);
  }

  static async releaseAllocation(allocationId: number, opts?: { reason?: string; userId?: number; username?: string }) {
    return ProjectBomAllocationService.releaseAllocation(allocationId, opts);
  }

  static async getProjectAllocations(projectId: number) {
    return ProjectBomAllocationService.getProjectAllocations(projectId);
  }

  static async getAllAllocations(params?: {
    projectId?: number;
    itemId?: number;
    status?: string;
    search?: string;
  }) {
    return ProjectBomAllocationService.getAllAllocations(params);
  }
}
