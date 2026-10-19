import { and, count, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { projectBomAllocations, transactions } from '../../db/schema.js';
import { foldedSearchSql } from '../../lib/search/searchSql.js';
import { normalizeSearchText } from '../../lib/search/searchText.js';
import { containsLikePattern } from '../../lib/sqlLike.js';
import type { BomAllocationStatusCounts } from '../../lib/inventory/bomAllocationList.js';
import { toAllocationRecord, type ProjectBomAllocationRecord } from './bomAllocationRecord.js';

/**
 * OBS-R2-45 (TD-1322): the allocation list is searched, filtered, counted and paged in SQL. The search folds Arabic letters
 * and digits on both sides (`normalizeSearchText`) over the project code, item code and name and the user name, the fields
 * the earlier in-memory search read.
 */
export interface BomAllocationFilter {
  projectId?: number;
  itemId?: number;
  status?: string;
  search?: string;
}

function baseConditions(filter: BomAllocationFilter): SQL[] {
  const conditions: SQL[] = [eq(projectBomAllocations.isDeleted, 0)];
  if (filter.projectId) conditions.push(eq(projectBomAllocations.projectId, filter.projectId));
  if (filter.itemId) conditions.push(eq(projectBomAllocations.itemId, filter.itemId));
  const q = normalizeSearchText(filter.search);
  if (q) {
    const pattern = containsLikePattern(q);
    const columns = [projectBomAllocations.projectCode, projectBomAllocations.itemCode, projectBomAllocations.itemName, projectBomAllocations.username];
    const matches = or(...columns.map(column => sql`${foldedSearchSql(column)} LIKE ${pattern}`));
    if (matches) conditions.push(matches);
  }
  return conditions;
}

function listConditions(filter: BomAllocationFilter): SQL {
  const conditions = baseConditions(filter);
  if (filter.status) conditions.push(eq(projectBomAllocations.status, filter.status));
  return and(...conditions) as SQL;
}

export async function listBomAllocations(filter: BomAllocationFilter, window: { limit?: number; offset?: number } = {}): Promise<ProjectBomAllocationRecord[]> {
  const query = orm
    .select({ alloc: projectBomAllocations, tx: transactions })
    .from(projectBomAllocations)
    .leftJoin(transactions, eq(projectBomAllocations.sourceTransactionId, transactions.id))
    .where(listConditions(filter))
    .orderBy(desc(projectBomAllocations.allocatedAt), desc(projectBomAllocations.id))
    .$dynamic();
  if (window.limit !== undefined) query.limit(window.limit);
  if (window.offset) query.offset(window.offset);
  return (await query).map(({ alloc, tx }) => toAllocationRecord(alloc, tx));
}

/** The tab's cards and status buttons: every status under the other filters, so they do not change with the status picked */
export async function bomAllocationStatusCounts(filter: BomAllocationFilter): Promise<BomAllocationStatusCounts> {
  const status = projectBomAllocations.status;
  const [row] = await orm.select({
    all: count(),
    allocated: sql<number>`count(*) FILTER (WHERE ${status} = 'allocated')`,
    consumed: sql<number>`count(*) FILTER (WHERE ${status} = 'consumed')`,
    released: sql<number>`count(*) FILTER (WHERE ${status} = 'released')`,
  }).from(projectBomAllocations).where(and(...baseConditions(filter)));
  return {
    all: Number(row?.all ?? 0), allocated: Number(row?.allocated ?? 0),
    consumed: Number(row?.consumed ?? 0), released: Number(row?.released ?? 0),
  };
}
