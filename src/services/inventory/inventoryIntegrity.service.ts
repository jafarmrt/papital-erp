import {
  StockReconciliationService,
  type DiscrepancyType,
  type ItemIntegrityAuditResult,
  type WarehouseReconciliationSummary,
  type InventoryIntegrityReport,
  type RunningKardexEntry,
  type RunningKardexResponse
} from './stockReconciliation.service.js';
import {
  KardexWacRecalculatorService,
  type KardexRebuildOptions
} from './kardexWacRecalculator.service.js';
import { InventoryStockRepairService } from './inventoryStockRepair.service.js';
import { buildItemRunningKardex } from './runningKardex.service.js';
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
import type { DbExecutor } from '../../db/drizzle.js';

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
  ProjectBomAllocationRecord,
  KardexRebuildOptions
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
    return buildItemRunningKardex(itemId);
  }

  /**
   * Rebuilds the per-warehouse stock of a single item from its Kardex ledger (quantities only, v9.0.77 TD-487)
   */
  static async rebuildItemFromLedger(
    itemId: number,
    optsOrUserId?: number | KardexRebuildOptions,
    username?: string
  ) {
    return KardexWacRecalculatorService.rebuildItemFromLedger(itemId, optsOrUserId, username);
  }

  /**
   * Rebuilds the per-warehouse stock of ALL items from their Kardex ledgers (quantities only, v9.0.77 TD-487)
   */
  static async rebuildAllFromLedger(
    optsOrUserId?: number | KardexRebuildOptions,
    username?: string
  ) {
    return KardexWacRecalculatorService.rebuildAllFromLedger(optsOrUserId, username);
  }

  /**
   * v9.0.77 (TD-487): sets an item's WAC to its Kardex replay with a draft voucher for the value difference
   */
  static async correctItemWacFromLedger(itemId: number, opts?: KardexRebuildOptions) {
    return KardexWacRecalculatorService.correctItemWacFromLedger(itemId, opts);
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
    allowBackdate?: boolean;
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
    externalTx?: DbExecutor;
  }) {
    return ProjectBomAllocationService.allocateMaterialsForProject(params);
  }

  static async allocateReceiptItemsForProjectBom(params: {
    projectId: number;
    allocations: BomReceiptAllocationInput[];
    userId?: number;
    username?: string;
    externalTx?: DbExecutor;
  }) {
    return ProjectBomAllocationService.allocateReceiptItemsForProjectBom(params);
  }

  static async consumeAllocation(allocationId: number, opts?: { userId?: number; username?: string; externalTx?: DbExecutor }) {
    return ProjectBomAllocationService.consumeAllocation(allocationId, opts);
  }

  static async releaseAllocation(allocationId: number, opts?: { reason?: string; userId?: number; username?: string; externalTx?: DbExecutor }) {
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
