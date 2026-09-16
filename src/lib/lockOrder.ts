import { eq, getTableName } from 'drizzle-orm';
import type { PgTableWithColumns } from 'drizzle-orm/pg-core';
import { logger } from '../middleware/logger.js';
import type { DbTransaction } from '../db/drizzle.js';

/**
 * System-wide Global Lock Ordering & Deadlock Prevention Policy
 * 
 * To prevent distributed and local database deadlocks (circular wait conditions),
 * any multi-table transaction in the ERP MUST acquire row-level locks strictly 
 * in ascending order of their assigned LockLevel priority:
 * 
 * Priority Hierarchy:
 * 1. BankAccounts (Level 10)
 * 2. Cheques (Level 20)
 * 3. Customers / Suppliers / Personnel (Level 30)
 * 4. Items & Stock (Level 40)
 * 5. ProductionProjects & Stages (Level 50)
 * 6. Documents & Orders (Level 60)
 * 7. JournalVouchers & Accounting Ledgers (Level 70)
 * 8. TreasuryTransactions (Level 80)
 * 9. WorkflowInstances & Tasks (Level 90)
 * 10. Outbox & ActionLogs (Level 100)
 * 
 * Rules:
 * 1. Within the same table, when locking multiple records, always sort by primary key (id ASC).
 * 2. When calling sub-services within an existing transaction, always pass the active `tx`
 *    so sub-services do not start isolated parallel transactions on parent tables.
 * 3. Never reverse this locking order across calling paths.
 */

export enum LockHierarchyLevel {
  BANK_ACCOUNTS = 10,
  CHEQUES = 20,
  PARTIES = 30,
  ITEMS_STOCK = 40,
  PRODUCTION = 50,
  DOCUMENTS = 60,
  JOURNAL_VOUCHERS = 70,
  TREASURY_TRANSACTIONS = 80,
  WORKFLOW = 90,
  OUTBOX = 100,
}

export interface LockOrderMetadata {
  level: LockHierarchyLevel;
  tableName: string;
  description: string;
}

export interface LockableResource {
  name: string;
  hierarchyLevel: LockHierarchyLevel | number;
}

export const LOCK_ORDER_MAP: Record<string, LockOrderMetadata> = {
  bank_accounts: {
    level: LockHierarchyLevel.BANK_ACCOUNTS,
    tableName: 'bank_accounts',
    description: 'Bank and cash accounts'
  },
  cheques: {
    level: LockHierarchyLevel.CHEQUES,
    tableName: 'cheques',
    description: 'Received and paid cheques'
  },
  customers: {
    level: LockHierarchyLevel.PARTIES,
    tableName: 'customers',
    description: 'Customer and supplier profiles'
  },
  items: {
    level: LockHierarchyLevel.ITEMS_STOCK,
    tableName: 'items',
    description: 'Raw materials, products, and inventory stock'
  },
  production_projects: {
    level: LockHierarchyLevel.PRODUCTION,
    tableName: 'production_projects',
    description: 'Production projects and stage tracking'
  },
  documents: {
    level: LockHierarchyLevel.DOCUMENTS,
    tableName: 'documents',
    description: 'Sales invoices, purchase orders, transfers, and inventory receipts'
  },
  journal_vouchers: {
    level: LockHierarchyLevel.JOURNAL_VOUCHERS,
    tableName: 'journal_vouchers',
    description: 'Double-entry accounting journal vouchers'
  },
  treasury_transactions: {
    level: LockHierarchyLevel.TREASURY_TRANSACTIONS,
    tableName: 'treasury_transactions',
    description: 'Receipt and payment transactions'
  },
  workflow_instances: {
    level: LockHierarchyLevel.WORKFLOW,
    tableName: 'workflow_instances',
    description: 'Workflow execution instances and approval tasks'
  },
  outbox_events: {
    level: LockHierarchyLevel.OUTBOX,
    tableName: 'outbox_events',
    description: 'Transactional outbox events and logs'
  }
};

/**
 * Sorts array of IDs in ascending order to prevent deadlocks when locking multiple rows of same entity.
 */
export function sortIdsForLocking(ids: (number | string)[]): number[] {
  const numeric = ids.map(id => Number(id)).filter(id => !isNaN(id));
  return Array.from(new Set(numeric)).sort((a, b) => a - b);
}

/**
 * Validates that requested locks adhere to standard lock hierarchy.
 * Supports array of LockableResource or 2-level number check.
 */
export function validateLockOrder(resources: LockableResource[]): void;
export function validateLockOrder(currentLevel: LockHierarchyLevel, requestedLevel: LockHierarchyLevel): boolean;
export function validateLockOrder(arg1: LockableResource[] | LockHierarchyLevel | number, arg2?: LockHierarchyLevel | number): boolean | void {
  if (Array.isArray(arg1)) {
    const resources = arg1;
    for (let i = 0; i < resources.length - 1; i++) {
      if (resources[i].hierarchyLevel > resources[i + 1].hierarchyLevel) {
        const msg = `Lock order violation: ${resources[i].name} (level ${resources[i].hierarchyLevel}) ` +
          `acquired before ${resources[i + 1].name} (level ${resources[i + 1].hierarchyLevel})`;
        if (process.env.NODE_ENV !== 'production') {
          throw new Error(msg);
        } else {
          logger.error(`[Lock Order] ${msg}`);
        }
      }
    }
    return true;
  }
  
  const currentLevel = Number(arg1);
  const requestedLevel = Number(arg2);
  const isOrdered = requestedLevel >= currentLevel;
  if (!isOrdered) {
    const msg = `Lock order violation: level ${currentLevel} acquired before level ${requestedLevel}`;
    if (process.env.NODE_ENV !== 'production') {
      logger.warn(`[Lock Order Warning] ${msg}`);
    } else {
      logger.error(`[Lock Order] ${msg}`);
    }
  }
  return isOrdered;
}

export interface LockResourceTarget {
  table: PgTableWithColumns<any> | any;
  tableName?: string;
  name?: string;
  id?: number | string;
  ids?: (number | string)[];
  level?: number;
}

/**
 * Resolves hierarchy level for a table or resource name from LOCK_ORDER_MAP.
 * Accepts either a LockResourceTarget object, a Drizzle table instance, or a resource string.
 */
export function resolveLockHierarchyLevel(
  targetOrResource: any,
  fallbackName?: string
): number {
  if (!targetOrResource) return 999;

  if (typeof targetOrResource === 'number') {
    return targetOrResource;
  }

  if (typeof targetOrResource.level === 'number') {
    return targetOrResource.level;
  }

  let extractedTableName: string | undefined;
  try {
    if (targetOrResource && typeof targetOrResource === 'object') {
      extractedTableName = getTableName(targetOrResource);
    }
  } catch {
    // not a drizzle table directly
  }

  let tableUnderScoreName: string | undefined;
  try {
    if (targetOrResource.table && typeof targetOrResource.table === 'object') {
      tableUnderScoreName = getTableName(targetOrResource.table);
    }
  } catch {
    // not a drizzle table
  }

  const candidateNames = [
    typeof targetOrResource === 'string' ? targetOrResource : undefined,
    fallbackName,
    extractedTableName,
    tableUnderScoreName,
    targetOrResource.tableName,
    targetOrResource.name,
    targetOrResource._?.name,
    targetOrResource[Symbol.for('drizzle:Name')],
    targetOrResource[Symbol.for('drizzle:OriginalName')],
    targetOrResource.table?._?.name,
    (targetOrResource.table as any)?.[Symbol.for('drizzle:Name')]
  ].filter(Boolean).map(n => String(n).toLowerCase());

  for (const name of candidateNames) {
    if (LOCK_ORDER_MAP[name]) {
      return LOCK_ORDER_MAP[name].level;
    }
    const normalizedName = name.replace(/[-_]/g, '');
    for (const [mapKey, meta] of Object.entries(LOCK_ORDER_MAP)) {
      const normalizedMapKey = mapKey.replace(/[-_]/g, '');
      if (normalizedName === normalizedMapKey || normalizedName.startsWith(normalizedMapKey) || normalizedMapKey.startsWith(normalizedName)) {
        return meta.level;
      }
    }
  }

  return 999;
}

/**
 * Helper wrapper for ordering and acquiring row-level locks across multiple resources in tx.
 * Automatically resolves lock hierarchy, sorts IDs in ascending order, validates sequence,
 * and acquires row-level exclusive locks (.for('update')) to prevent database deadlocks.
 */
export async function withOrderedLocks<T>(
  tx: DbTransaction | any,
  resources: Array<LockResourceTarget | { table: PgTableWithColumns<any>; id: number; level: number; name: string }>,
  fn: () => Promise<T>
): Promise<T> {
  // Normalize and resolve levels and IDs
  const normalized = resources.map((r, idx) => {
    const rawIds = 'ids' in r && Array.isArray(r.ids) 
      ? r.ids 
      : ('id' in r && r.id !== undefined ? [r.id] : []);
    const sortedIds = sortIdsForLocking(rawIds);
    const resolvedLevel = resolveLockHierarchyLevel(r);
    const candidateTableName = 'tableName' in r ? r.tableName : undefined;
    const resolvedName = r.name || candidateTableName || r.table?._?.name || `resource_${idx}`;

    return {
      table: r.table,
      name: resolvedName,
      level: resolvedLevel,
      ids: sortedIds
    };
  });

  // Validate locking sequence
  validateLockOrder(normalized.map(r => ({ name: r.name, hierarchyLevel: r.level })));

  // Sort resources strictly by hierarchy level
  const sortedResources = [...normalized].sort((a, b) => a.level - b.level);

  // Acquire locks in ascending hierarchy level, and for each entity in ascending ID order
  for (const resource of sortedResources) {
    if (!resource.table) continue;
    const idCol = resource.table.id;
    for (const targetId of resource.ids) {
      if (idCol) {
        await tx.select().from(resource.table).where(eq(idCol, targetId)).for('update');
      }
    }
  }

  return fn();
}


