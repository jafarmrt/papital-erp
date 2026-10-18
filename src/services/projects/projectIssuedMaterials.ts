import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documentItems, documents, items, productionProjects, projectBomAllocations, transactions } from '../../db/schema.js';
import { getDisplayTimezone } from '../../lib/businessClock.js';
import { fin } from '../../lib/financialDecimal.js';
import { serverTimestampToUtcIso } from '../../lib/serverTimestamp.js';
import { PROJECT_ISSUE_DOCUMENT_TYPES } from '../../lib/transactions/projectIssueTypes.js';
import {
  ISSUED_MATERIALS_MAX_ROWS, type IssuedMaterialRow, type IssuedMaterialSource, type IssuedMaterialsReport,
} from '../../lib/projects/issuedMaterials.js';
import { NotFoundError } from '../../errors/customErrors.js';

interface SortedRow {
  row: IssuedMaterialRow;
  /** زمان دیواری منطقهٔ نمایش، برای چیدن دو نوع ردیف کنار هم */
  sortKey: string;
}

/**
 * v10.2.1 (TD-1290، یافتهٔ D3): «مواد گرفته‌شده از انبار» یک پروژه، همان ردیف‌هایی که `projectIssuedQuantities` می‌شمارد:
 * تخصیص مواد باز یا مصرف‌شده (بهای حرکت خروج خود تخصیص، همان مبلغ سند ۱۴۰۲، TD-286) و ردیف‌های زندهٔ حواله و ضایعات قطعی
 * پروژه (جمع بهای ردیف‌های خروج کاردکس همان سند و کالا، TD-400). تازه‌ترین ردیف اول، حداکثر `ISSUED_MATERIALS_MAX_ROWS`؛
 * بها و جمع آن فقط وقتی `costVisible` است. فقط خواندن.
 */
export async function projectIssuedMaterials(executor: DbExecutor, projectId: number, costVisible: boolean): Promise<IssuedMaterialsReport> {
  const [project] = await executor
    .select({ id: productionProjects.id })
    .from(productionProjects)
    .where(and(eq(productionProjects.id, projectId), eq(productionProjects.isDeleted, 0)));
  if (!project) throw new NotFoundError('پروژه مورد نظر یافت نشد', undefined, 'PROJECT_NOT_FOUND');

  const timeZone = await getDisplayTimezone();
  const allocationRows = await executor
    .select({
      id: projectBomAllocations.id,
      itemId: projectBomAllocations.itemId,
      itemCode: projectBomAllocations.itemCode,
      itemName: projectBomAllocations.itemName,
      unit: projectBomAllocations.unit,
      quantity: projectBomAllocations.quantity,
      status: projectBomAllocations.status,
      allocatedAt: projectBomAllocations.allocatedAt,
      sortKey: sql<string>`to_char((${projectBomAllocations.allocatedAt} AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}::text, 'YYYY-MM-DD HH24:MI:SS')`,
      txType: transactions.type,
      txUnitPrice: transactions.unitPrice,
      txQuantity: transactions.quantity,
    })
    .from(projectBomAllocations)
    .leftJoin(transactions, eq(transactions.id, projectBomAllocations.sourceTransactionId))
    .where(and(
      eq(projectBomAllocations.projectId, projectId), eq(projectBomAllocations.isDeleted, 0),
      inArray(projectBomAllocations.status, ['allocated', 'consumed']),
    ))
    .orderBy(desc(projectBomAllocations.allocatedAt), desc(projectBomAllocations.id))
    .limit(ISSUED_MATERIALS_MAX_ROWS);

  const kardexCost = sql<string | null>`(
    SELECT SUM(${transactions.totalPrice})::text FROM ${transactions}
    WHERE ${transactions.documentId} = ${documents.id} AND ${transactions.itemId} = ${documentItems.itemId}
      AND ${transactions.type} = 'out' AND ${transactions.isDeleted} = 0 AND ${transactions.reversalOfId} IS NULL
  )`;
  const documentRows = await executor
    .select({
      documentId: documents.id,
      type: documents.type,
      refNumber: documents.refNumber,
      date: documents.date,
      sortKey: sql<string>`to_char(${documents.date}, 'YYYY-MM-DD HH24:MI:SS')`,
      itemId: documentItems.itemId,
      itemCode: items.code,
      itemName: items.name,
      unit: items.unit,
      quantity: sql<string>`SUM(${documentItems.quantity})::text`,
      cost: kardexCost,
    })
    .from(documentItems)
    .innerJoin(documents, eq(documents.id, documentItems.documentId))
    .innerJoin(items, eq(items.id, documentItems.itemId))
    .where(and(
      eq(documents.projectId, projectId), eq(documents.isDeleted, 0), eq(documents.status, 'final'),
      inArray(documents.type, [...PROJECT_ISSUE_DOCUMENT_TYPES]), eq(documentItems.isDeleted, 0),
    ))
    .groupBy(documents.id, documents.type, documents.refNumber, documents.date, documentItems.itemId, items.code, items.name, items.unit)
    .orderBy(desc(documents.date), desc(documents.id), documentItems.itemId)
    .limit(ISSUED_MATERIALS_MAX_ROWS);

  const [allocationCount] = await executor
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(projectBomAllocations)
    .where(and(
      eq(projectBomAllocations.projectId, projectId), eq(projectBomAllocations.isDeleted, 0),
      inArray(projectBomAllocations.status, ['allocated', 'consumed']),
    ));
  const [documentLineCount] = await executor
    .select({ n: sql<number>`COUNT(DISTINCT (${documentItems.documentId}, ${documentItems.itemId}))::int` })
    .from(documentItems)
    .innerJoin(documents, eq(documents.id, documentItems.documentId))
    .where(and(
      eq(documents.projectId, projectId), eq(documents.isDeleted, 0), eq(documents.status, 'final'),
      inArray(documents.type, [...PROJECT_ISSUE_DOCUMENT_TYPES]), eq(documentItems.isDeleted, 0),
    ));

  const sorted: SortedRow[] = [];
  for (const a of allocationRows) {
    const cost = a.txType === 'out' ? fin(a.txUnitPrice ?? 0).multiply(a.txQuantity ?? 0).toNumber() : null;
    sorted.push({
      sortKey: a.sortKey || '',
      row: {
        key: `allocation:${a.id}`,
        source: 'allocation',
        sourceId: a.id,
        refNumber: null,
        date: serverTimestampToUtcIso(a.allocatedAt),
        itemId: a.itemId,
        itemCode: a.itemCode,
        itemName: a.itemName,
        unit: a.unit || 'عدد',
        quantity: fin(a.quantity).toNumber(),
        status: a.status || 'allocated',
        cost: costVisible ? cost : null,
      },
    });
  }
  for (const d of documentRows) {
    sorted.push({
      sortKey: d.sortKey || '',
      row: {
        key: `${d.type}:${d.documentId}:${d.itemId}`,
        source: d.type as IssuedMaterialSource,
        sourceId: d.documentId,
        refNumber: d.refNumber,
        date: d.date,
        itemId: d.itemId,
        itemCode: d.itemCode,
        itemName: d.itemName,
        unit: d.unit || 'عدد',
        quantity: fin(d.quantity).toNumber(),
        status: 'final',
        cost: costVisible && d.cost !== null ? fin(d.cost).toNumber() : null,
      },
    });
  }
  sorted.sort((a, b) => (a.sortKey === b.sortKey ? b.row.sourceId - a.row.sourceId : a.sortKey < b.sortKey ? 1 : -1));
  const rows = sorted.slice(0, ISSUED_MATERIALS_MAX_ROWS).map(s => s.row);

  let totalCost: number | null = null;
  if (costVisible) {
    totalCost = await projectIssuedCostTotal(executor, projectId);
  }
  return {
    projectId,
    costVisible,
    rows,
    total: Number(allocationCount?.n ?? 0) + Number(documentLineCount?.n ?? 0),
    totalCost,
  };
}

/** جمع بهای همهٔ مواد گرفته‌شده (نه فقط ردیف‌های فرستاده‌شده)، به ریال */
async function projectIssuedCostTotal(executor: DbExecutor, projectId: number): Promise<number> {
  const [allocation] = await executor
    .select({ total: sql<string>`COALESCE(SUM(${transactions.unitPrice} * ${transactions.quantity}), 0)::text` })
    .from(projectBomAllocations)
    .innerJoin(transactions, and(eq(transactions.id, projectBomAllocations.sourceTransactionId), eq(transactions.type, 'out')))
    .where(and(
      eq(projectBomAllocations.projectId, projectId), eq(projectBomAllocations.isDeleted, 0),
      inArray(projectBomAllocations.status, ['allocated', 'consumed']),
    ));
  const [kardex] = await executor
    .select({ total: sql<string>`COALESCE(SUM(${transactions.totalPrice}), 0)::text` })
    .from(transactions)
    .innerJoin(documents, eq(documents.id, transactions.documentId))
    .where(and(
      eq(documents.projectId, projectId), eq(documents.isDeleted, 0), eq(documents.status, 'final'),
      inArray(documents.type, [...PROJECT_ISSUE_DOCUMENT_TYPES]),
      eq(transactions.type, 'out'), eq(transactions.isDeleted, 0), isNull(transactions.reversalOfId),
    ));
  return fin(allocation?.total ?? 0).add(kardex?.total ?? 0).toNumber();
}
